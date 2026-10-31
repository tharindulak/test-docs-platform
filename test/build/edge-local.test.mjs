// The local edge as the Platform team runs it to rehearse a process
// (Guide for running WSO2 Docs: Run WSO2 Docs locally): `npm run edge:local`
// with its own port and data folder, the R2_* variables in <data>/edge.env,
// and the release CLI's redirect table written into the edge's KV through
// `--kv local:<url>`, as CI writes it to Workers KV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from '../../lib/manifest.mjs';
import { S3Storage } from '../../lib/storage.mjs';

const execFileAsync = promisify(execFile);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 4197;
const ADMIN = 4198;

// A minimal stand-in for a wso2-docs build of one deployment, with one page move.
function fakeBuild(dir, { space = 'sandbox', segment = '1.0.0' } = {}) {
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data));
  };
  write('index.html', '<h1>Sandbox 1.0.0</h1>');
  write('guides/new-page/index.html', '<h1>New page</h1>');
  write('404.html', '<h1>404</h1>');
  write('sitemap.xml', '<urlset/>');
  write('_platform/edition.json', { docSpace: space, edition: segment, asLatest: false, baseUrl: `/${space}/${segment}/`, platformVersion: '0.1.0' });
  write('_platform/pages.json', [{ path: '' }, { path: 'guides/new-page/' }]);
  write('_platform/redirects.json', [{ from: `/${space}/${segment}/guides/old-page/`, to: `/${space}/${segment}/guides/new-page/` }]);
  return dir;
}

async function waitFor(file, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${file} did not appear`);
}

test('npm run edge:local takes a port and a data folder; the release CLI publishes, flips and writes redirects into its KV', { timeout: 120_000 }, async (t) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-edge-local-'));
  const edge = spawn(process.execPath, [path.join(root, 'worker', 'local.mjs'), '--port', String(PORT), '--admin-port', String(ADMIN), '--data', data], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  edge.stdout.on('data', (c) => { out += c; });
  edge.stderr.on('data', (c) => { out += c; });
  t.after(() => edge.kill('SIGTERM'));
  await waitFor(path.join(data, 'edge.env'), 60_000);
  const vars = Object.fromEntries(fs.readFileSync(path.join(data, 'edge.env'), 'utf8').trim().split('\n').map((l) => l.replace(/^export /, '').split('=')));
  assert.deepEqual(Object.keys(vars), ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
  assert.equal(vars.R2_ENDPOINT, `http://127.0.0.1:${PORT}/cdn-cgi/local/r2/s3`);
  const release = (...args) => execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), ...args], { env: { ...process.env, ...vars }, encoding: 'utf8' });

  release('publish', '--storage', 's3://docs-staging', '--dir', fakeBuild(path.join(data, 'build')), '--space', 'sandbox', '--segment', '1.0.0', '--edition', '1.0.0', '--tag', '1.0.0-docs.1');
  release('flip', '--storage', 's3://docs-staging', '--env', 'staging', '--deploy', 'sandbox/1.0.0=1.0.0-docs.1');
  assert.match(release('redirects', '--storage', 's3://docs-staging', '--kv', `local:http://127.0.0.1:${ADMIN}`), /Redirect table: 1 entries, 1 written, 0 deleted/);
  assert.match(out, new RegExp(`--kv local:http://127\\.0\\.0\\.1:${ADMIN}`), 'the edge prints the redirects command');

  const get = (p) => fetch(`http://127.0.0.1:${PORT}${p}`, { redirect: 'manual' });
  const page = await get('/sandbox/1.0.0/guides/new-page/');
  assert.equal(page.status, 200);
  const moved = await get('/sandbox/1.0.0/guides/old-page/');
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get('location'), '/sandbox/1.0.0/guides/new-page/');
  const kv = await fetch(`http://127.0.0.1:${ADMIN}/kv/${encodeURIComponent('/sandbox/1.0.0/guides/old-page/')}`);
  assert.deepEqual(JSON.parse((await kv.json()).value), { to: '/sandbox/1.0.0/guides/new-page/', status: 301 });

  // A second sync with nothing changed writes nothing; a dropped redirect is deleted from KV.
  assert.match(release('redirects', '--storage', 's3://docs-staging', '--kv', `local:http://127.0.0.1:${ADMIN}`), /1 entries, 0 written, 0 deleted/);
  assert.equal((await fetch(`http://127.0.0.1:${ADMIN}/kv/put`, { method: 'POST', body: '{"no":1}' })).status, 400);

  // Sending 1.0.0 back to its old site: its team moves it to legacyVersions,
  // the Platform team retires the deployment, and its addresses 302 there.
  const policy = loadPolicy();
  const sandbox = policy.docSpaces.sandbox;
  sandbox.editions = sandbox.editions.map((e) => (e.id === '1.0.0' ? { id: '1.0.0', status: 'legacy', legacyUrl: 'https://sandbox-old.example.com/1.0.0/' } : e));
  sandbox.latest = null;
  const file = path.join(data, 'composed.json');
  fs.writeFileSync(file, JSON.stringify(policy));
  assert.match(release('retire', '--storage', 's3://docs-staging', '--env', 'staging', '--policy', file, '--deployment', 'sandbox/1.0.0'), /sandbox\/1\.0\.0 retired/);
  assert.match(release('redirects', '--storage', 's3://docs-staging', '--kv', `local:http://127.0.0.1:${ADMIN}`), /0 entries, 0 written, 1 deleted/);
  for (const p of ['/sandbox/1.0.0/', '/sandbox/1.0.0/guides/new-page/', '/sandbox/1.0.0/guides/old-page/']) {
    const r = await get(p);
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), 'https://sandbox-old.example.com/1.0.0/', p);
  }

  // One queue for state changes: R2's S3 API (here Miniflare's) takes the
  // conditional writes the state lock is made of.
  const s3 = new S3Storage({ endpoint: vars.R2_ENDPOINT, bucket: 'docs-staging', accessKeyId: vars.R2_ACCESS_KEY_ID, secretAccessKey: vars.R2_SECRET_ACCESS_KEY });
  assert.equal(await s3.putIf('_platform/probe.lock', 'a', { ifNoneMatch: '*' }), true);
  assert.equal(await s3.putIf('_platform/probe.lock', 'b', { ifNoneMatch: '*' }), false);
  const { etag } = await s3.get('_platform/probe.lock');
  assert.equal(await s3.putIf('_platform/probe.lock', 'c', { ifMatch: '"stale"' }), false);
  assert.equal(await s3.putIf('_platform/probe.lock', 'c', { ifMatch: etag }), true);
  await s3.delete(['_platform/probe.lock']);

  // Three flips at once, as three release runs reach their flip: each waits
  // its turn on the lock, none is lost, and the lock is free afterwards.
  const flips = [['identity-server', '7.3.0', '7.3.0-docs.1'], ['identity-server', '7.2.0', '7.2.0-docs.1'], ['identity-platform', 'cloud', 'cloud-2026.10.27.1']];
  for (const [space, segment, tag] of flips) {
    const dir = fakeBuild(path.join(data, `build-${space}-${segment}`), { space, segment });
    release('publish', '--storage', 's3://docs-staging', '--dir', dir, '--space', space, '--segment', segment, '--edition', segment, '--tag', tag);
  }
  const runs = flips.map(([space, segment, tag]) => execFileAsync(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), 'flip', '--storage', 's3://docs-staging', '--env', 'staging',
    '--deploy', `${space}/${segment}=${tag}`], { env: { ...process.env, ...vars }, encoding: 'utf8' }));
  const outs = await Promise.all(runs);
  const state = JSON.parse(release('status', '--storage', 's3://docs-staging'));
  for (const [space, segment] of flips) assert.ok(state.deployments[`${space}/${segment}`], `${space}/${segment} flipped (${outs.map((o) => o.stderr).join(' | ')})`);
  assert.deepEqual(JSON.parse(release('state-lock', '--storage', 's3://docs-staging')), { free: true });
});
