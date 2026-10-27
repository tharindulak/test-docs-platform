// The one queue for storage-state changes: a lock in the bucket the state
// lives in, taken by every command that writes the published state (flip,
// rollback, retire, manifest, redirects, gc), so any number of runs wait
// their turn and none cancels another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FsStorage } from '../lib/storage.mjs';
import { LOCK_KEY, STATE_WRITERS, readLock, withStateLock } from '../lib/state-lock.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-lock-'));
const fast = { pollMs: 2, jitterMs: 0 };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('conditional writes: create only if absent, replace only if unchanged', async () => {
  const s = new FsStorage(tmp());
  assert.equal(await s.putIf('a.json', '1', { ifNoneMatch: '*' }), true);
  assert.equal(await s.putIf('a.json', '2', { ifNoneMatch: '*' }), false, 'already there');
  const { etag } = await s.get('a.json');
  assert.ok(etag);
  assert.equal(await s.putIf('a.json', '3', { ifMatch: '"other"' }), false);
  assert.equal(await s.putIf('a.json', '3', { ifMatch: etag }), true);
  assert.equal(new TextDecoder().decode((await s.get('a.json')).body), '3');
  assert.equal(await s.putIf('missing.json', 'x', { ifMatch: etag }), false);
});

test('state writers queue on the lock: every one runs, one at a time, in turn', async () => {
  const s = new FsStorage(tmp());
  const log = [];
  const writer = (i) => withStateLock(s, async () => {
    log.push(`start ${i}`);
    await pause(15);
    log.push(`end ${i}`);
    return i;
  }, { owner: `run-${i}`, command: 'flip', ...fast });
  // Five at once: GitHub's concurrency group would keep one running and one
  // waiting, and cancel the other three.
  assert.deepEqual(await Promise.all([0, 1, 2, 3, 4].map(writer)), [0, 1, 2, 3, 4]);
  assert.equal(log.length, 10);
  for (let i = 0; i < log.length; i += 2) assert.equal(log[i].replace('start', 'end'), log[i + 1], `no overlap: ${log.join(', ')}`);
  assert.equal(await s.get(LOCK_KEY), null, 'released');
});

test('the lock is released when the command fails, and names its holder', async () => {
  const s = new FsStorage(tmp());
  let seen;
  await assert.rejects(withStateLock(s, async () => {
    seen = await readLock(s);
    throw new Error('flip failed');
  }, { owner: 'run-9', command: 'flip', ...fast }), /flip failed/);
  assert.equal(seen.owner, 'run-9');
  assert.equal(seen.command, 'flip');
  assert.ok(Date.parse(seen.expiresAt) > Date.parse(seen.acquiredAt));
  assert.equal(await readLock(s), null);
});

test('an expired lock (a run that died holding it) is taken over; a live one makes the waiter give up in time', async () => {
  const s = new FsStorage(tmp());
  const old = new Date(Date.now() - 60 * 60_000);
  await s.put(LOCK_KEY, JSON.stringify({ owner: 'dead-run', command: 'gc', acquiredAt: old.toISOString(), expiresAt: new Date(old.getTime() + 60_000).toISOString() }));
  const messages = [];
  assert.equal(await withStateLock(s, async () => 'ran', { owner: 'run-2', command: 'flip', log: (m) => messages.push(m), ...fast }), 'ran');
  assert.ok(messages.some((m) => /took over the expired state lock of dead-run \(gc/.test(m)), messages.join('\n'));

  await s.put(LOCK_KEY, JSON.stringify({ owner: 'busy-run', command: 'redirects', acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }));
  await assert.rejects(withStateLock(s, async () => 'never', { owner: 'run-3', command: 'flip', waitMs: 30, ...fast }),
    /state lock is still held by busy-run \(redirects/);
  assert.equal((await readLock(s)).owner, 'busy-run', 'a waiter never removes a live lock');
});

test('a holder whose lock was taken over does not delete the new holder\'s lock', async () => {
  const s = new FsStorage(tmp());
  await withStateLock(s, async () => {
    // Its lease ran out mid-command and another run took the lock over.
    await s.put(LOCK_KEY, JSON.stringify({ owner: 'next-run', command: 'flip', acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }));
  }, { owner: 'slow-run', command: 'gc', ...fast });
  assert.equal((await readLock(s)).owner, 'next-run');
});

test('the commands that write the published state', () => {
  assert.deepEqual([...STATE_WRITERS].sort(), ['flip', 'gc', 'manifest', 'redirects', 'retire', 'rollback']);
});
