// The bundle store (Releases and deployments, Storage and pointers): the
// Platform keeps its own copy of every bundle an intake record names, at
// _bundles/<sha256>.zip in the staging bucket. release.yml's store job copies
// each planned bundle there (sha256 checked against the record) before any
// build; when GitHub no longer serves a bundle, the plan job hands the copy to
// the build, which falls back to it; GC keeps only the copies a record names;
// the Worker never serves them. GitHub's REST API is a stubbed fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FsStorage } from '../lib/storage.mjs';
import { writeZip } from '../lib/zip.mjs';
import { addEntry, emptyRecord, fetchBundle, formatRecord } from '../lib/intake.mjs';
import {
  BUNDLE_PREFIX, bundleKey, collectBundles, handOverCopies, plannedBundles, recordedSha256s, storeBundles,
} from '../lib/bundle-store.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `wso2-bundle-store-${name}-`));
const sha = (c) => c.repeat(64).slice(0, 64);
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const API = 'wso2/docs-api-platform';

// A small real bundle of one tag: bundle.json and its Doc space directory.
function bundle(tag) {
  const file = path.join(tmp('zip'), 'b.zip');
  const json = { repo: API, tag, docSpace: 'ai-gateway', path: 'ai-gateway', edition: '1.2.0', sourceCommit: 'c'.repeat(40) };
  writeZip(file, [
    { name: 'bundle.json', data: Buffer.from(JSON.stringify(json)) },
    { name: 'ai-gateway/docs/index.mdx', data: Buffer.from(`# ${tag}\n`) },
  ]);
  const bytes = fs.readFileSync(file);
  return { tag, asset: `ai-gateway-${tag.split('/')[1]}.docs.zip`, bytes, sha256: hash(bytes) };
}

// GitHub serving `served` bundles (by tag); every other tag answers 404.
function github(served) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(url);
    for (const [i, b] of served.entries()) {
      if (url === `https://api.github.com/repos/${API}/releases/tags/${encodeURIComponent(b.tag)}`) {
        return new Response(JSON.stringify({ tag_name: b.tag, assets: [{ name: b.asset, url: `https://api.github.com/assets/${i}` }] }), { status: 200 });
      }
      if (url === `https://api.github.com/assets/${i}`) {
        assert.equal(init.headers.Accept, 'application/octet-stream');
        return new Response(b.bytes, { status: 200 });
      }
    }
    return new Response('{"message":"Not Found"}', { status: 404 });
  };
  return { fetch, calls };
}

const planned = (b, extra = {}) => ({ repo: API, space: 'ai-gateway', segment: '1.2.0', tag: b.tag, asset: b.asset, sha256: b.sha256, ...extra });

test('a copy lives at _bundles/<sha256>.zip; a plan builds from one bundle per sha256, never the Platform\'s own or the Landing deployment', () => {
  assert.equal(BUNDLE_PREFIX, '_bundles/');
  assert.equal(bundleKey(sha('a')), `_bundles/${sha('a')}.zip`);
  assert.throws(() => bundleKey('../x'), /not a sha256/);
  const b = bundle('ai-gateway/1.2.0-docs.3');
  const list = plannedBundles([
    planned(b, { segment: 'latest' }), planned(b),
    { repo: 'wso2/docs-platform', space: 'contribute', segment: '_', tag: 'cloud-1', asset: '', sha256: '' },
    { repo: 'wso2/docs-platform', space: '_landing', segment: '_', tag: 'x', asset: '', sha256: '' },
  ]);
  assert.deepEqual(list, [{ repo: API, tag: b.tag, asset: b.asset, sha256: b.sha256 }]);
});

test('the store job copies each planned bundle once: fetched from GitHub, sha256 checked against the record, skipped when present', async () => {
  const storage = new FsStorage(tmp('bucket'));
  const b = bundle('ai-gateway/1.2.0-docs.3');
  const gh = github([b]);
  const work = tmp('work');
  let r = await storeBundles(storage, plannedBundles([planned(b)]), { fetch: gh.fetch, workDir: work });
  assert.deepEqual(r, { stored: [b.sha256], present: [] });
  assert.deepEqual(Buffer.from((await storage.get(bundleKey(b.sha256))).body), b.bytes, 'the exact bytes the record names');
  assert.deepEqual(fs.readdirSync(work), [], 'no download is left behind');

  gh.calls.length = 0;
  r = await storeBundles(storage, plannedBundles([planned(b)]), { fetch: gh.fetch, workDir: work });
  assert.deepEqual(r, { stored: [], present: [b.sha256] });
  assert.deepEqual(gh.calls, [], 'a copy already stored is not fetched again');

  // An asset that is not what the record names is never stored; the job fails.
  const other = bundle('ai-gateway/1.2.0-docs.4');
  await assert.rejects(storeBundles(storage, [{ repo: API, tag: other.tag, asset: other.asset, sha256: sha('9') }], { fetch: github([other]).fetch, workDir: work }),
    /sha256 .* not the record's/);
  assert.equal(await storage.get(bundleKey(sha('9'))), null);
  assert.deepEqual((await storage.list(BUNDLE_PREFIX)), [bundleKey(b.sha256)]);
  // GitHub no longer serving a bundle with no copy fails the job too.
  await assert.rejects(storeBundles(storage, [{ repo: API, tag: other.tag, asset: other.asset, sha256: other.sha256 }], { fetch: github([]).fetch, workDir: work }), /404/);
});

test('GC deletes the copies no intake record names, never one a record names, and nothing it does not recognise', async () => {
  const storage = new FsStorage(tmp('bucket'));
  for (const c of ['1', '2', '3']) await storage.put(bundleKey(sha(c)), 'zip');
  await storage.put('_bundles/notes.txt', 'kept');
  await storage.put('_releases/ai-gateway/1.2.0/r/index.html', 'page');
  const entry = (tag, c) => ({ tag, asset: 'a.docs.zip', sha256: sha(c), sourceCommit: 'c'.repeat(40), acceptedAt: '2026-10-28T00:00:00.000Z' });
  const records = {
    'ai-gateway': addEntry(addEntry(emptyRecord('ai-gateway', API), '1.2.0', entry('ai-gateway/1.2.0-docs.1', '1')), '1.2.0', entry('ai-gateway/1.2.0-docs.2', '2')),
  };
  assert.deepEqual([...recordedSha256s(records)].sort(), [sha('1'), sha('2')]);
  assert.deepEqual(await collectBundles(storage, records, { dryRun: true }), [bundleKey(sha('3'))]);
  assert.ok(await storage.get(bundleKey(sha('3'))), 'a dry run deletes nothing');
  assert.deepEqual(await collectBundles(storage, records), [bundleKey(sha('3'))]);
  assert.deepEqual(await storage.list(BUNDLE_PREFIX), [bundleKey(sha('1')), bundleKey(sha('2')), '_bundles/notes.txt']);
  assert.ok(await storage.get('_releases/ai-gateway/1.2.0/r/index.html'));
});

test('the plan job hands the build a stored copy only for a bundle GitHub no longer serves, checked against the record', async () => {
  const storage = new FsStorage(tmp('bucket'));
  const live = bundle('ai-gateway/1.2.0-docs.3');
  const gone = bundle('ai-gateway/1.2.0-docs.2');
  const lost = bundle('ai-gateway/1.2.0-docs.1');
  await storage.put(bundleKey(live.sha256), live.bytes);
  await storage.put(bundleKey(gone.sha256), gone.bytes);
  const out = path.join(tmp('copies'), 'bundle-copies');
  const r = await handOverCopies(storage, plannedBundles([planned(live), planned(gone), planned(lost)]), { fetch: github([live]).fetch, out });
  assert.deepEqual(r.handed, [gone.sha256]);
  assert.deepEqual(r.missing, [lost.sha256], 'no copy: the build fails on its own fetch');
  assert.deepEqual(fs.readdirSync(out), [`${gone.sha256}.zip`]);
  assert.deepEqual(fs.readFileSync(path.join(out, `${gone.sha256}.zip`)), gone.bytes);
  // A stored copy that is not what the record names is never handed over.
  await storage.put(bundleKey(lost.sha256), 'tampered');
  await assert.rejects(handOverCopies(storage, plannedBundles([planned(lost)]), { fetch: github([]).fetch, out: path.join(tmp('copies'), 'c') }), /stored copy .* not the record's/);
});

test('a build fetches from GitHub first and falls back to the copy the plan handed over, checked against the record', async () => {
  const b = bundle('ai-gateway/1.2.0-docs.2');
  const copy = path.join(tmp('copies'), `${b.sha256}.zip`);
  fs.writeFileSync(copy, b.bytes);
  const args = { repo: API, tag: b.tag, asset: b.asset, sha256: b.sha256 };
  let r = await fetchBundle({ ...args, out: path.join(tmp('fetch'), 'b'), fetch: github([b]).fetch, copy });
  assert.equal(r.source, 'github');
  r = await fetchBundle({ ...args, out: path.join(tmp('fetch'), 'b'), fetch: github([]).fetch, copy });
  assert.equal(r.source, 'copy');
  assert.match(r.githubError, /404/);
  assert.equal(r.edition, '1.2.0');
  assert.ok(fs.existsSync(path.join(r.dir, 'docs', 'index.mdx')));
  // No copy handed over: GitHub's failure stands.
  await assert.rejects(fetchBundle({ ...args, out: path.join(tmp('fetch'), 'b'), fetch: github([]).fetch, copy: path.join(tmp('none'), 'x.zip') }), /404/);
  // A copy that is not what the record names is refused.
  const bad = path.join(tmp('copies'), 'bad.zip');
  fs.writeFileSync(bad, 'tampered');
  await assert.rejects(fetchBundle({ ...args, out: path.join(tmp('fetch'), 'b'), fetch: github([]).fetch, copy: bad }), /copy's sha256 .* not the record's/);
});

test('wso2-release gc-bundles reads the records folder; a missing folder collects nothing', () => {
  const cli = path.join(root, 'bin', 'wso2-release.mjs');
  const dir = tmp('platform');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
  const store = tmp('bucket');
  const storage = new FsStorage(store);
  fs.mkdirSync(path.join(dir, 'releases'));
  const e = { tag: 'ai-gateway/1.2.0-docs.1', asset: 'a.docs.zip', sha256: sha('1'), sourceCommit: 'c'.repeat(40), acceptedAt: '2026-10-28T00:00:00.000Z' };
  fs.writeFileSync(path.join(dir, 'releases', 'ai-gateway.yaml'), formatRecord(addEntry(emptyRecord('ai-gateway', API), '1.2.0', e)));
  return (async () => {
    await storage.put(bundleKey(sha('1')), 'zip');
    await storage.put(bundleKey(sha('2')), 'zip');
    let r = run('gc-bundles', '--storage', `file:${store}`, '--records', path.join(dir, 'nowhere'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no intake records/i);
    assert.equal((await storage.list(BUNDLE_PREFIX)).length, 2);
    r = run('gc-bundles', '--storage', `file:${store}`, '--records', 'releases');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Removed: ${bundleKey(sha('2'))}`));
    assert.deepEqual(await storage.list(BUNDLE_PREFIX), [bundleKey(sha('1'))]);
    const help = run('help').stdout;
    for (const verb of ['store-bundles', 'bundle-copies', 'gc-bundles']) assert.match(help, new RegExp(`\\n  ${verb} `), verb);
    assert.match(help, /fetch-bundle .*--copy <zip>/);
  })();
});
