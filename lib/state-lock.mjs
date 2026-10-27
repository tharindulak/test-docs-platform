// The one queue for storage-state changes (Releases and deployments: Storage
// and pointers). Every command that writes an environment's published state
// (state.json, the runtime files, the redirect table, or release folders gc
// deletes) holds a lock in that environment's own bucket while it runs:
// _platform/state.lock, made with a conditional write (create only if absent).
// A run that finds it held waits and tries again, so any number of writers
// (releases, rollbacks, Manifests, a retire run by hand) take their turn, and
// none is cancelled: GitHub's concurrency groups keep only one waiting run
// per group and cancel an older waiting one, so they no longer guard state.
// A lock carries a lease: one left by a run that died expires, and the next
// writer takes it over with a compare-and-swap (replace only if unchanged).
import os from 'node:os';
import crypto from 'node:crypto';

export const LOCK_KEY = '_platform/state.lock';
export const STATE_WRITERS = new Set(['flip', 'rollback', 'retire', 'manifest', 'redirects', 'gc']);
// Commands take seconds to a few minutes (gc the longest); a lease outlives them.
export const LEASE_MS = 30 * 60_000;
export const WAIT_MS = 45 * 60_000;
const POLL_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Who holds the lock: the workflow run and job in Actions, else this machine.
export function lockOwner(env = process.env) {
  const id = crypto.randomUUID().slice(0, 8);
  if (env.GITHUB_RUN_ID) return `${env.GITHUB_REPOSITORY ?? 'actions'} run ${env.GITHUB_RUN_ID}.${env.GITHUB_RUN_ATTEMPT ?? 1} ${env.GITHUB_JOB ?? ''} ${id}`.replace(/\s+/g, ' ');
  return `${os.userInfo().username}@${os.hostname()} pid ${process.pid} ${id}`;
}

export async function readLock(storage) {
  const obj = await storage.get(LOCK_KEY);
  if (!obj) return null;
  try {
    return { ...JSON.parse(new TextDecoder().decode(obj.body)), etag: obj.etag };
  } catch {
    return { owner: 'unreadable', expiresAt: new Date(0).toISOString(), etag: obj.etag };
  }
}

const describe = (l) => `${l.owner} (${l.command ?? 'unknown'}, since ${l.acquiredAt ?? '?'})`;

// Runs fn while holding the state lock of `storage`. Waits up to waitMs for
// it, polling every pollMs (plus jitter, so waiters don't move in step).
export async function withStateLock(storage, fn, {
  owner = lockOwner(), command = null, leaseMs = LEASE_MS, waitMs = WAIT_MS, pollMs = POLL_MS, jitterMs = pollMs / 2, log = () => {},
} = {}) {
  const start = Date.now();
  const body = () => {
    const now = new Date();
    return JSON.stringify({ owner, command, acquiredAt: now.toISOString(), expiresAt: new Date(now.getTime() + leaseMs).toISOString() });
  };
  let reported = null;
  for (;;) {
    if (await storage.putIf(LOCK_KEY, body(), { ifNoneMatch: '*', contentType: 'application/json' })) break;
    const held = await readLock(storage);
    if (!held) continue; // released between the two calls
    if (Date.parse(held.expiresAt) < Date.now()) {
      if (await storage.putIf(LOCK_KEY, body(), { ifMatch: held.etag, contentType: 'application/json' })) {
        log(`took over the expired state lock of ${describe(held)}`);
        break;
      }
      continue;
    }
    if (Date.now() - start > waitMs) {
      throw new Error(`The state lock is still held by ${describe(held)}, after waiting ${Math.round((Date.now() - start) / 1000)} s; it expires at ${held.expiresAt}. Re-run this step then, or remove a stuck lock with wso2-release state-lock --break`);
    }
    if (reported !== held.owner) {
      log(`waiting for the state lock, held by ${describe(held)}`);
      reported = held.owner;
    }
    await sleep(pollMs + Math.random() * jitterMs);
  }
  try {
    return await fn();
  } finally {
    // Only our own lock: if the lease ran out and another run took it over,
    // that run's lock stays.
    const now = await readLock(storage);
    if (now?.owner === owner) await storage.delete([LOCK_KEY]);
  }
}
