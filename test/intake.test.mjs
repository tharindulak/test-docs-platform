// Intake (Releases and deployments, Intake): the Platform polls Content repo
// releases, keeps those that count, verifies each bundle once before any
// content code runs (digest, attestation, safe unpacking, bundle.json, content
// safety), and records it in releases/<slug>.yaml; withdrawals leave the
// record; a record change plans the release. GitHub's REST API and
// `gh attestation verify` are stubbed with fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UNPACK_LIMITS, readZip, unpackZip, writeZip } from '../lib/zip.mjs';
import { loadPolicy } from '../lib/manifest.mjs';
import { makeBundle } from '../lib/bundle.mjs';
import { bundleOf, loadContentRepo, mainBranchFiles, repoPathOf } from '../lib/content.mjs';
import { checkoutCommit, loadCloudParts } from '../lib/cloud-tree.mjs';
import {
  addEntry, bundleAssetName, compareTags, emptyRecord, formatRecord, listReleases, newestEntry, readRecord, removeEntry, triage, validateRecord,
  bundlesFor, checkRecordChange, fetchBundle, planFromRecords, recordChanges, runIntake, verifyBundle,
} from '../lib/intake.mjs';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `wso2-intake-${name}-`));

// A zip written by hand, so a test can make the bad ones writeZip refuses:
// entries [{ name, data, mode, localName, size }].
function rawZip(entries) {
  const parts = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '');
    const body = e.deflate ? zlib.deflateRawSync(data) : data;
    const name = Buffer.from(e.name);
    const localName = Buffer.from(e.localName ?? e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(zlib.crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.size ?? data.length, 22);
    local.writeUInt16LE(localName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(zlib.crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.size ?? data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(e.at ?? offset, 42);
    parts.push(local, localName, body);
    centrals.push(central, name);
    offset += 30 + localName.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

test('a bundle unpacks safely: only into an empty folder, no absolute paths, no .., no symlinks, within the size and ratio limits', () => {
  const dir = tmp('zip');
  const good = path.join(dir, 'good.zip');
  writeZip(good, [{ name: 'bundle.json', data: Buffer.from('{}') }, { name: 'a/docs/index.mdx', data: Buffer.from('# Hi\n') }]);
  const out = path.join(dir, 'out');
  assert.deepEqual(unpackZip(good, out), { files: 2, bytes: 7 });
  assert.equal(fs.readFileSync(path.join(out, 'a', 'docs', 'index.mdx'), 'utf8'), '# Hi\n');
  assert.throws(() => unpackZip(good, out), /not empty/);

  const refuse = (buf, re, limits) => assert.throws(() => unpackZip(buf, path.join(tmp('bad'), 'x'), limits), re);
  refuse(rawZip([{ name: '/etc/passwd', data: 'x' }]), /Unsafe/);
  refuse(rawZip([{ name: '../up.txt', data: 'x' }]), /Unsafe/);
  refuse(rawZip([{ name: 'a/../../up.txt', data: 'x' }]), /Unsafe/);
  refuse(rawZip([{ name: 'a\\..\\up.txt', data: 'x' }]), /Unsafe/);
  refuse(rawZip([{ name: 'link', data: '/etc/passwd', mode: 0o120777 }]), /symbolic links/);
  refuse(rawZip([{ name: 'dev', data: '', mode: 0o060644 }]), /regular files/);
  refuse(rawZip([{ name: 'a.txt', data: 'x', localName: 'b.txt' }]), /local header names another file/);
  refuse(rawZip([{ name: 'A.txt', data: 'x' }, { name: 'a.txt', data: 'y' }]), /Two zip entries/);
  refuse(rawZip([{ name: 'a.txt', data: 'xx' }, { name: 'b.txt', data: 'yy', at: 0 }]), /overlaps|local header/);
  // A small zip that claims (or inflates to) much more.
  refuse(rawZip([{ name: 'big', data: 'x', size: 2 * 1024 ** 3 }]), /more than/);
  refuse(rawZip([{ name: 'zeros', data: Buffer.alloc(4 * 1024 ** 2), deflate: true }]), /times/);
  refuse(rawZip([{ name: 'a', data: 'x' }, { name: 'b', data: 'y' }]), /2 files, more than 1/, { ...UNPACK_LIMITS, files: 1 });
  // Declared smaller than it inflates: never written past its size.
  refuse(rawZip([{ name: 'lie', data: 'hello world', deflate: true, size: 3 }]), /declared size|CRC/);
});

test('safe unpacking reads the real deterministic zip a bundle is', () => {
  const dir = tmp('zip-real');
  const files = Array.from({ length: 50 }, (_, i) => ({ name: `space/docs/p${i}.mdx`, data: Buffer.from(`# Page ${i}\n${'text '.repeat(i * 10)}`) }));
  const z = writeZip(path.join(dir, 'b.zip'), files);
  const r = unpackZip(path.join(dir, 'b.zip'), path.join(dir, 'out'));
  assert.equal(r.files, 50);
  assert.equal(z.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'b.zip'))).digest('hex'));
  assert.equal(fs.readFileSync(path.join(dir, 'out', 'space', 'docs', 'p3.mdx'), 'utf8'), files[3].data.toString());
});

// ---------------------------------------------------------------------------
// Which releases count, the intake record and withdrawals.

const policy = loadPolicy();
const API = 'wso2/docs-api-platform';
const sha = (c) => c.repeat(64).slice(0, 64);
const commit = (c) => c.repeat(40).slice(0, 40);
const slugOf = (tag) => (tag.includes('/') ? tag.split('/')[0] : 'sandbox');
// A GitHub release as the REST API lists it.
const ghRelease = (tag, { slug = slugOf(tag), assets, prerelease = false, immutable = true, draft = false } = {}) => ({
  tag_name: tag, draft, prerelease, immutable,
  assets: assets ?? [{ name: bundleAssetName(slug, tag), url: `https://api.github.com/repos/x/y/releases/assets/${encodeURIComponent(tag)}`, digest: `sha256:${sha('0')}`, size: 10 }],
});
const entry = (tag, c = 'a') => ({ tag, asset: bundleAssetName(slugOf(tag), tag), sha256: sha(c), sourceCommit: commit(c), acceptedAt: '2026-10-27T10:00:00.000Z' });

test('Docs release tags of one Edition order by date or docs number, and name their asset', () => {
  assert.equal(compareTags('ai-gateway/1.2.0-docs.10', 'ai-gateway/1.2.0-docs.9'), 1);
  assert.equal(compareTags('ai-gateway/1.2.0-docs.2', 'ai-gateway/1.2.0-docs.2'), 0);
  assert.equal(compareTags('api-platform/cloud-2026.10.27.1', 'api-platform/cloud-2026.10.28.1'), -1);
  assert.equal(compareTags('cloud-2026.10.27.12', 'cloud-2026.10.27.3'), 1);
  assert.equal(bundleAssetName('identity-server', 'identity-server/7.3.0-docs.2'), 'identity-server-7.3.0-docs.2.docs.zip');
  assert.equal(bundleAssetName('sandbox', 'cloud-2026.10.27.1'), 'sandbox-cloud-2026.10.27.1.docs.zip');
});

test('the intake record keeps each Edition\'s accepted bundles newest first, the last 5, and validates against its schema', () => {
  let r = emptyRecord('ai-gateway', API);
  for (let n = 1; n <= 7; n++) r = addEntry(r, '1.2.0', entry(`ai-gateway/1.2.0-docs.${n}`));
  r = addEntry(r, '2026.09.24', entry('ai-gateway/2026.09.24-docs.1'));
  assert.deepEqual(r.editions['1.2.0'].map((e) => e.tag), [7, 6, 5, 4, 3].map((n) => `ai-gateway/1.2.0-docs.${n}`));
  assert.equal(newestEntry(r, '1.2.0').tag, 'ai-gateway/1.2.0-docs.7');
  assert.equal(newestEntry(r, '9.9.9'), null);
  const text = formatRecord(r);
  assert.match(text, /^# The intake record of ai-gateway/);
  const dir = tmp('record');
  fs.writeFileSync(path.join(dir, 'ai-gateway.yaml'), text);
  const back = readRecord(path.join(dir, 'ai-gateway.yaml'));
  assert.deepEqual(back, r);
  assert.deepEqual(validateRecord(back), []);
  assert.equal(readRecord(path.join(dir, 'none.yaml')), null);
  const removed = removeEntry(r, 'ai-gateway/1.2.0-docs.7');
  assert.equal(newestEntry(removed, '1.2.0').tag, 'ai-gateway/1.2.0-docs.6');
  assert.deepEqual(Object.keys(removeEntry(r, 'ai-gateway/2026.09.24-docs.1').editions), ['1.2.0']);
  // The schema refuses what intake never writes.
  const bad = structuredClone(r);
  bad.editions['1.2.0'][0].sha256 = 'nope';
  bad.owner = 'x';
  assert.equal(validateRecord(bad).length, 2);
});

test('a release counts when its tag, state, asset and Edition pass; older, equal and unrelated ones are ignored', () => {
  const records = { 'ai-gateway': addEntry(emptyRecord('ai-gateway', API), '1.2.0', entry('ai-gateway/1.2.0-docs.2')) };
  const releases = [
    ghRelease('ai-gateway/1.2.0-docs.3'),
    ghRelease('ai-gateway/1.2.0-docs.2'),
    ghRelease('ai-gateway/1.2.0-docs.1'),
    ghRelease('gateway/v1.2.0', { slug: 'api-platform-api-gateway' }),
    ghRelease('api-platform/cloud-2026.10.28.1', { draft: true }),
    ghRelease('api-platform/cloud-2026.10.27.1'),
    ghRelease('api-platform/cloud-2026.10.27.2'),
    ghRelease('api-manager/4.7.0-docs.1', { prerelease: true }),
    ghRelease('api-manager/4.6.0-docs.1', { immutable: false }),
    ghRelease('ai-gateway/2026.09.24-docs.1', { assets: [] }),
    ghRelease('api-manager/4.5.0-docs.1'),
    ghRelease('api-manager/9.9.9-docs.1'),
  ];
  const r = triage({ policy, repo: API, releases, records });
  assert.deepEqual(r.candidates.map((c) => [c.slug, c.edition, c.tag]), [
    ['ai-gateway', '1.2.0', 'ai-gateway/1.2.0-docs.3'],
    ['api-platform', 'cloud', 'api-platform/cloud-2026.10.27.2'],
  ]);
  const problems = Object.fromEntries(r.problems.map((p) => [p.tag, p.message]));
  assert.deepEqual(Object.keys(problems).sort(), ['ai-gateway/2026.09.24-docs.1', 'api-manager/4.5.0-docs.1', 'api-manager/4.6.0-docs.1', 'api-manager/4.7.0-docs.1', 'api-manager/9.9.9-docs.1']);
  assert.match(problems['api-manager/4.7.0-docs.1'], /prerelease/);
  assert.match(problems['api-manager/4.6.0-docs.1'], /immutable/);
  assert.match(problems['ai-gateway/2026.09.24-docs.1'], /exactly one asset, ai-gateway-2026\.09\.24-docs\.1\.docs\.zip/);
  assert.match(problems['api-manager/4.5.0-docs.1'], /legacy/);
  assert.match(problems['api-manager/9.9.9-docs.1'], /not in the manifest/);
  assert.equal(r.problems.find((p) => p.tag === 'api-manager/9.9.9-docs.1').slug, 'api-manager');
  // A wrongly named asset, or two.
  const wrong = triage({ policy, repo: API, releases: [ghRelease('ai-gateway/1.2.0-docs.3', { slug: 'other' })], records });
  assert.match(wrong.problems[0].message, /exactly one asset/);
  // A tag that failed before is not tried again, unless the run says so.
  assert.equal(triage({ policy, repo: API, releases, records, failed: new Set(['ai-gateway ai-gateway/1.2.0-docs.3']) }).candidates.length, 1);
});

test('a pinned Edition gets an issue and no PR; so does a Cloud part\'s own Cloud tag', () => {
  const pinned = structuredClone(policy);
  pinned.docSpaces['ai-gateway'].editions.find((e) => e.id === '2026.09.24').pin = 'ai-gateway/2026.09.24-docs.1';
  const r = triage({ policy: pinned, repo: API, releases: [ghRelease('ai-gateway/2026.09.24-docs.2'), ghRelease('ai-gateway/cloud-2026.10.27.1')], records: {} });
  assert.deepEqual(r.candidates, []);
  const problems = Object.fromEntries(r.problems.map((p) => [p.tag, p.message]));
  assert.match(problems['ai-gateway/2026.09.24-docs.2'], /pinned/);
  assert.match(problems['ai-gateway/cloud-2026.10.27.1'], /Cloud part/);
});

test('a recorded release deleted on GitHub is a withdrawal; the newest one moves the Edition back', () => {
  let rec = emptyRecord('ai-gateway', API);
  rec = addEntry(rec, '1.2.0', entry('ai-gateway/1.2.0-docs.1'));
  rec = addEntry(rec, '1.2.0', entry('ai-gateway/1.2.0-docs.2'));
  const r = triage({ policy, repo: API, releases: [ghRelease('ai-gateway/1.2.0-docs.1')], records: { 'ai-gateway': rec } });
  assert.deepEqual(r.candidates, []);
  assert.deepEqual(r.withdrawals, [{ slug: 'ai-gateway', edition: '1.2.0', tag: 'ai-gateway/1.2.0-docs.2', newest: true, back: 'ai-gateway/1.2.0-docs.1' }]);
  // An older one leaves the live release where it is.
  const older = triage({ policy, repo: API, releases: [ghRelease('ai-gateway/1.2.0-docs.2')], records: { 'ai-gateway': rec } });
  assert.deepEqual(older.withdrawals, [{ slug: 'ai-gateway', edition: '1.2.0', tag: 'ai-gateway/1.2.0-docs.1', newest: false, back: null }]);
});

test('releases are listed page by page from the REST API, with the token when there is one', async () => {
  const seen = [];
  const pages = {
    'https://api.github.com/repos/wso2/docs-api-platform/releases?per_page=100': { body: [ghRelease('ai-gateway/1.2.0-docs.1')], link: '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="last"' },
    'https://api.github.com/repositories/1/releases?per_page=100&page=2': { body: [ghRelease('ai-gateway/1.2.0-docs.2')] },
  };
  const fetch = async (url, init) => {
    seen.push([url, init.headers.Authorization ?? null]);
    const p = pages[url];
    return new Response(JSON.stringify(p.body), { status: 200, headers: p.link ? { link: p.link } : {} });
  };
  const list = await listReleases(API, { fetch, token: 't0k' });
  assert.deepEqual(list.map((x) => x.tag_name), ['ai-gateway/1.2.0-docs.1', 'ai-gateway/1.2.0-docs.2']);
  assert.deepEqual(seen.map((s) => s[1]), ['Bearer t0k', 'Bearer t0k']);
  await assert.rejects(listReleases(API, { fetch: async () => new Response('no', { status: 502 }) }), /502/);
  await assert.rejects(listReleases('not a repo', { fetch }), /owner\/name/);
});

// ---------------------------------------------------------------------------
// Verification, once, before any content code runs.

const IDP = 'wso2/docs-identity-platform';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const IDENTITY = 'https://github.com/wso2/docs-platform/.github/workflows/docs-bundle.yml@refs/tags/v1';

// A real bundle of the stub Content repo, made by `wso2-docs bundle`.
let made;
function stubBundle() {
  if (made) return made;
  const repo = tmp('repo');
  fs.cpSync(path.join(root, 'fixtures', 'stub-repo'), repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const out = tmp('bundle');
  const r = makeBundle({ dir: repo, tag: 'identity-server/7.3.0-docs.2', out, repo: IDP });
  assert.equal(r.result, 'pass', JSON.stringify(r.problems));
  made = { file: path.join(out, r.asset), sha256: r.sha256, commit: git(repo, 'rev-parse', 'HEAD'), bundle: r.bundle };
  return made;
}

// The same bundle with its entries changed: { name: data | null }.
function alteredBundle(changes) {
  const { file } = stubBundle();
  const dir = tmp('altered');
  const entries = new Map(Object.entries(Object.fromEntries(readZipFile(file).map((e) => [e.name, e.data]))));
  for (const [name, data] of Object.entries(changes)) {
    if (data === null) entries.delete(name);
    else entries.set(name, Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)));
  }
  const out = path.join(dir, 'b.zip');
  const z = writeZip(out, [...entries].map(([name, data]) => ({ name, data })));
  return { file: out, sha256: z.sha256 };
}
const readZipFile = (file) => readZip(fs.readFileSync(file));

// A release of `tag` whose one asset is `file`, served by the returned fetch.
function served(tag, file, { digest } = {}) {
  const bytes = fs.readFileSync(file);
  const url = `https://api.github.com/repos/${IDP}/releases/assets/1`;
  const release = ghRelease(tag, { slug: 'identity-server', assets: [{ name: bundleAssetName('identity-server', tag), url, size: bytes.length, digest: digest ?? `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}` }] });
  const fetch = async (u, init) => {
    assert.equal(u, url);
    assert.equal(init.headers.Accept, 'application/octet-stream');
    return new Response(bytes, { status: 200 });
  };
  return { release, fetch };
}

// `gh attestation verify`, stubbed: the args it was given, and its answer.
function gh(cert = {}) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cert === 'fail') throw Object.assign(new Error('gh failed'), { stderr: 'no matching attestations' });
    return JSON.stringify([{ verificationResult: { signature: { certificate: {
      subjectAlternativeName: IDENTITY, runnerEnvironment: 'github-hosted', sourceRepositoryURI: `https://github.com/${IDP}`, sourceRepositoryRef: 'refs/heads/main', ...cert,
    } } } }]);
  };
  return { exec, calls };
}

const verify = (tag, file, opts = {}) => {
  const { release, fetch } = served(tag, file, opts);
  const attest = opts.gh ?? gh();
  return verifyBundle({
    policy, repo: IDP, candidate: { slug: 'identity-server', edition: '7.3.0', tag, release }, workDir: tmp('work'),
    fetch, exec: attest.exec, signerRepo: 'wso2/docs-platform', now: new Date('2026-10-27T12:00:00Z'),
  });
};

test('a bundle is verified before any content code: digest, attestation, safe unpacking, bundle.json, content safety', async () => {
  const b = stubBundle();
  const attest = gh();
  const r = await verify('identity-server/7.3.0-docs.2', b.file, { gh: attest });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.entry, { tag: 'identity-server/7.3.0-docs.2', asset: 'identity-server-7.3.0-docs.2.docs.zip', sha256: b.sha256, sourceCommit: b.commit, acceptedAt: '2026-10-27T12:00:00.000Z' });
  const [call] = attest.calls;
  assert.equal(call[0], 'gh');
  assert.deepEqual(call.slice(1, 3), ['attestation', 'verify']);
  const flag = (name) => call[call.indexOf(name) + 1];
  assert.equal(flag('--repo'), IDP);
  assert.equal(flag('--cert-identity'), IDENTITY);
  assert.equal(flag('--format'), 'json');
  assert.ok(call.includes('--deny-self-hosted-runners'));
  // A tag pushed by hand is attested at the tag.
  assert.deepEqual((await verify('identity-server/7.3.0-docs.2', b.file, { gh: gh({ sourceRepositoryRef: 'refs/tags/identity-server/7.3.0-docs.2' }) })).problems, []);
});

test('verification refuses a wrong digest, a failed or wrong attestation, and a bundle.json that does not match', async () => {
  const b = stubBundle();
  const tag = 'identity-server/7.3.0-docs.2';
  const attest = gh();
  const digest = await verify(tag, b.file, { digest: `sha256:${sha('f')}`, gh: attest });
  assert.match(digest.problems.join('\n'), /sha256 .* is not GitHub's digest/);
  assert.equal(attest.calls.length, 0, 'nothing else runs on a wrong digest');
  assert.match((await verify(tag, b.file, { digest: 'none' })).problems.join('\n'), /digest/);
  assert.match((await verify(tag, b.file, { gh: gh('fail') })).problems.join('\n'), /attestation.*no matching attestations/s);
  assert.match((await verify(tag, b.file, { gh: gh({ sourceRepositoryRef: 'refs/heads/identity-server/release/7.3.0' }) })).problems.join('\n'), /attestation/);
  assert.match((await verify(tag, b.file, { gh: gh({ runnerEnvironment: 'self-hosted' }) })).problems.join('\n'), /attestation/);
  assert.match((await verify(tag, b.file, { gh: gh({ subjectAlternativeName: `${IDENTITY}x` }) })).problems.join('\n'), /attestation/);
  assert.match((await verify(tag, b.file, { gh: gh({ sourceRepositoryURI: 'https://github.com/evil/docs' }) })).problems.join('\n'), /attestation/);

  const json = (over) => alteredBundle({ 'bundle.json': { ...b.bundle, ...over } }).file;
  // The release of docs.3 carrying docs.2's bundle.
  assert.match((await verify('identity-server/7.3.0-docs.3', b.file)).problems.join('\n'), /bundle\.json.*tag identity-server\/7\.3\.0-docs\.2, not identity-server\/7\.3\.0-docs\.3/);
  assert.match((await verify(tag, json({ repo: 'evil/docs' }))).problems.join('\n'), /bundle\.json.*repo/);
  assert.match((await verify(tag, json({ edition: '7.2.0' }))).problems.join('\n'), /bundle\.json.*Edition/);
  assert.match((await verify(tag, json({ path: 'other' }))).problems.join('\n'), /bundle\.json.*directory/);
  assert.match((await verify(tag, json({ docSpace: 'identity-platform' }))).problems.join('\n'), /bundle\.json.*Doc space/);
  assert.match((await verify(tag, json({ sourceCommit: 'main' }))).problems.join('\n'), /source commit/);
  assert.match((await verify(tag, alteredBundle({ 'bundle.json': null }).file)).problems.join('\n'), /no bundle\.json/);
  assert.match((await verify(tag, alteredBundle({ 'evil/run.md': 'x' }).file)).problems.join('\n'), /evil\/run\.md.*outside/);
});

test('intake runs content safety on the unpacked bundle, since it cannot rely on a Content repo\'s own check', async () => {
  const tag = 'identity-server/7.3.0-docs.2';
  const bad = alteredBundle({
    'identity-server/docs/evil.mdx': '---\ntitle: Evil\n---\n\n<script>alert(1)</script>\n',
    'identity-server/assets/x.js': 'alert(1)',
  });
  const r = await verify(tag, bad.file);
  const text = r.problems.join('\n');
  assert.match(text, /content-safety: identity-server\/docs\/evil\.mdx:\d+/);
  assert.match(text, /x\.js is a script file/);
  assert.equal(r.entry, null);
});

// ---------------------------------------------------------------------------
// One intake run: records written, issues once per Doc space and tag.

test('an intake run records what verifies, removes withdrawals, and reports failures once per Doc space and tag', async () => {
  const b = stubBundle();
  const good = served('identity-server/7.3.0-docs.2', b.file);
  const releases = [good.release, ghRelease('identity-platform/cloud-2026.10.27.1', { prerelease: true }), ghRelease('identity-server/7.2.0-docs.1')];
  const fetch = async (url, init) => {
    if (url === `https://api.github.com/repos/${IDP}/releases?per_page=100`) return new Response(JSON.stringify(releases), { status: 200 });
    if (url.endsWith('/releases?per_page=100')) return new Response('[]', { status: 200 });
    return good.fetch(url, init);
  };
  const records = tmp('records');
  const pending = tmp('pending');
  let rec = emptyRecord('identity-server', IDP);
  rec = addEntry(rec, '7.2.0', entry('identity-server/7.2.0-docs.1', 'b'));
  rec = addEntry(rec, '7.2.0', entry('identity-server/7.2.0-docs.2', 'c'));
  fs.writeFileSync(path.join(records, 'identity-server.yaml'), formatRecord(rec));
  // A pending intake PR's record wins over main's: what it adds is not tried again.
  fs.writeFileSync(path.join(pending, 'identity-server.yaml'), formatRecord(rec));
  const out = tmp('out');
  const run = (over = {}) => runIntake({
    policy, recordsDir: records, pendingDir: pending, outDir: out, workDir: tmp('work'), fetch, exec: gh().exec,
    signerRepo: 'wso2/docs-platform', now: new Date('2026-10-27T12:00:00Z'), log: () => {}, ...over,
  });
  const r = await run({ repo: IDP });
  assert.deepEqual(r.changes.map((c) => [c.slug, c.added, c.removed]), [
    ['identity-server', [{ edition: '7.3.0', tag: 'identity-server/7.3.0-docs.2' }], [{ edition: '7.2.0', tag: 'identity-server/7.2.0-docs.2' }]],
  ]);
  const written = readRecord(path.join(out, 'identity-server.yaml'));
  assert.deepEqual(validateRecord(written), []);
  assert.deepEqual(Object.fromEntries(Object.entries(written.editions).map(([id, l]) => [id, l.map((e) => e.tag)])), {
    '7.3.0': ['identity-server/7.3.0-docs.2'], '7.2.0': ['identity-server/7.2.0-docs.1'],
  });
  assert.equal(written.editions['7.3.0'][0].sha256, b.sha256);
  assert.deepEqual(r.issues.map((i) => i.title), [
    'Bundle intake: identity-platform identity-platform/cloud-2026.10.27.1',
    'Bundle withdrawn: identity-server identity-server/7.2.0-docs.2',
  ]);
  const [failed, withdrawn] = r.issues;
  assert.match(failed.body, /prerelease/);
  assert.match(failed.body, /@wso2\/identity-platform-docs/);
  assert.match(failed.body, /not try this tag again/);
  assert.match(withdrawn.body, /back to `identity-server\/7\.2\.0-docs\.1`/);

  // The next poll: the failed tag has its issue, so nothing is tried or reported again.
  const issues = r.issues.map((i) => ({ title: i.title }));
  const again = await run({ repo: IDP, issues, outDir: tmp('out2') });
  assert.deepEqual(again.issues, []);
  // A manual run tries the tag again, but its issue is not repeated.
  const manual = await run({ repo: IDP, issues, retry: true, outDir: tmp('out3') });
  assert.deepEqual(manual.issues.map((i) => i.title), []);
  // Only one Doc space, by hand.
  const one = await run({ space: 'identity-platform', outDir: tmp('out4') });
  assert.deepEqual(one.changes, []);
  assert.deepEqual(one.issues.map((i) => i.slug), ['identity-platform']);
  // The Platform's own repo has no bundles: it is never polled.
  const polled = [];
  await run({ fetch: async (url, init) => { polled.push(url); return fetch(url, init); }, outDir: tmp('out5') });
  assert.ok(!polled.some((u) => u.includes('/wso2/docs-platform/')), polled.join(' '));
});

// ---------------------------------------------------------------------------
// The intake PR's required check, and releases from the record.

const agRecord = (...tags) => tags.reduceRight((r, t) => addEntry(r, '1.2.0', entry(t, t.slice(-1))), emptyRecord('ai-gateway', API));

test('the intake PR check passes only a change to that Doc space\'s release entries', () => {
  const before = formatRecord(agRecord('ai-gateway/1.2.0-docs.2'));
  const after = formatRecord(agRecord('ai-gateway/1.2.0-docs.3', 'ai-gateway/1.2.0-docs.2'));
  const check = (branch, files, head, base = { 'releases/ai-gateway.yaml': before }) => checkRecordChange({
    branch, files, base: (f) => base[f] ?? null, head: (f) => head[f] ?? null,
  });
  const file = 'releases/ai-gateway.yaml';
  assert.deepEqual(check('intake/ai-gateway', [file], { [file]: after }), []);
  // A new record (a Doc space's first bundle).
  assert.deepEqual(check('intake/ai-gateway', [file], { [file]: after }, {}), []);
  assert.match(check('intake/ai-gateway', [file, 'lib/release.mjs'], { [file]: after }).join('\n'), /lib\/release\.mjs.*only releases\/ai-gateway\.yaml/);
  assert.match(check('intake/ai-gateway', ['releases/api-manager.yaml'], { 'releases/api-manager.yaml': after }).join('\n'), /only releases\/ai-gateway\.yaml/);
  assert.match(check('intake/ai-gateway', [file], { [file]: after.replace('repo: wso2/docs-api-platform', 'repo: evil/docs') }).join('\n'), /repo/);
  assert.match(check('intake/ai-gateway', [file], { [file]: after.replace('sha256: ', 'sha256: x') }).join('\n'), /sha256/);
  // An entry already recorded may not change.
  const changed = agRecord('ai-gateway/1.2.0-docs.3', 'ai-gateway/1.2.0-docs.2');
  changed.editions['1.2.0'][1] = { ...changed.editions['1.2.0'][1], sha256: sha('e') };
  assert.match(check('intake/ai-gateway', [file], { [file]: formatRecord(changed) }).join('\n'), /ai-gateway\/1\.2\.0-docs\.2.*changed/);
  // Newest first.
  const unordered = `${formatRecord(agRecord())}`.replace('editions: {}', `editions:\n  1.2.0:\n${['ai-gateway/1.2.0-docs.2', 'ai-gateway/1.2.0-docs.3'].map((t) => {
    const e = entry(t);
    return `    - tag: ${e.tag}\n      asset: ${e.asset}\n      sha256: ${e.sha256}\n      sourceCommit: ${e.sourceCommit}\n      acceptedAt: "${e.acceptedAt}"`;
  }).join('\n')}`);
  assert.match(check('intake/ai-gateway', [file], { [file]: unordered }).join('\n'), /newest first/);
  // Other branches: the record must still be valid; the owners review the rest.
  assert.deepEqual(check('fix/thing', [file, 'lib/release.mjs'], { [file]: after }), []);
  assert.match(check('fix/thing', [file], { [file]: 'schemaVersion: 2\n' }).join('\n'), /schemaVersion/);
  // A removed entry (a withdrawal) is a release-entry change too.
  assert.deepEqual(check('intake/ai-gateway', [file], { [file]: formatRecord(agRecord('ai-gateway/1.2.0-docs.1')) }, { [file]: formatRecord(agRecord('ai-gateway/1.2.0-docs.2', 'ai-gateway/1.2.0-docs.1')) }), []);
});

test('a record change plans the release: tag scope per new entry, with its bundle; a withdrawal goes back', async () => {
  const before = { 'ai-gateway': agRecord('ai-gateway/1.2.0-docs.2', 'ai-gateway/1.2.0-docs.1') };
  const added = { 'ai-gateway': agRecord('ai-gateway/1.2.0-docs.3', 'ai-gateway/1.2.0-docs.2', 'ai-gateway/1.2.0-docs.1') };
  const changes = recordChanges(before, added);
  assert.deepEqual(changes.releases.map((r) => [r.slug, r.edition, r.tag]), [['ai-gateway', '1.2.0', 'ai-gateway/1.2.0-docs.3']]);
  assert.deepEqual(changes.withdrawals, []);
  const plan = await planFromRecords(policy, changes, { rebuildId: '77', exists: async () => true });
  // ai-gateway's latest is 1.2.0: its latest twin builds first, from the same bundle.
  assert.deepEqual(plan.deployments.map((d) => [d.space, d.segment, d.release, d.asset, d.sha256, d.backwards]), [
    ['ai-gateway', 'latest', '1.2.0-docs.3', 'ai-gateway-1.2.0-docs.3.docs.zip', sha('3'), false],
    ['ai-gateway', '1.2.0', '1.2.0-docs.3', 'ai-gateway-1.2.0-docs.3.docs.zip', sha('3'), false],
  ]);
  assert.deepEqual(plan.flipBack, []);

  // The newest entry withdrawn: back to the previous entry's release folder.
  const withdrawn = { 'ai-gateway': agRecord('ai-gateway/1.2.0-docs.1') };
  const w = recordChanges(before, withdrawn);
  assert.deepEqual(w.withdrawals.map((x) => [x.slug, x.edition, x.tag, x.back?.tag]), [['ai-gateway', '1.2.0', 'ai-gateway/1.2.0-docs.2', 'ai-gateway/1.2.0-docs.1']]);
  const back = await planFromRecords(policy, w, { rebuildId: '77', exists: async () => true });
  assert.deepEqual(back.deployments, []);
  assert.deepEqual(back.flipBack, [{ space: 'ai-gateway', segment: 'latest', release: '1.2.0-docs.1' }, { space: 'ai-gateway', segment: '1.2.0', release: '1.2.0-docs.1' }]);
  // ... or a rebuild from its bundle when that folder was collected.
  const rebuilt = await planFromRecords(policy, w, { rebuildId: '77', exists: async (s, seg) => seg !== 'latest' });
  assert.deepEqual(rebuilt.deployments.map((d) => [d.segment, d.release, d.tag, d.sha256, d.backwards]), [
    ['latest', '1.2.0-docs.1.r77', 'ai-gateway/1.2.0-docs.1', sha('1'), true],
    ['1.2.0', '1.2.0-docs.1.r77', 'ai-gateway/1.2.0-docs.1', sha('1'), true],
  ]);
  assert.deepEqual(rebuilt.flipBack, [{ space: 'ai-gateway', segment: 'latest', release: '1.2.0-docs.1.r77' }, { space: 'ai-gateway', segment: '1.2.0', release: '1.2.0-docs.1.r77' }]);
  // Withdrawing an older entry, or the only one, moves nothing.
  assert.deepEqual(recordChanges(before, { 'ai-gateway': agRecord('ai-gateway/1.2.0-docs.2') }).withdrawals, []);
  const only = recordChanges({ 'ai-gateway': agRecord('ai-gateway/1.2.0-docs.2') }, {});
  assert.deepEqual(only.withdrawals.map((x) => x.back), [null]);
  assert.deepEqual((await planFromRecords(policy, only, { rebuildId: '77', exists: async () => true })).flipBack, []);
});

test('wso2-release: plan --scope records from a push, record-check on an intake branch, flip --backwards', () => {
  const cli = path.join(root, 'bin', 'wso2-release.mjs');
  const dir = tmp('platform');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'releases'));
  const file = path.join(dir, 'releases', 'ai-gateway.yaml');
  fs.writeFileSync(file, formatRecord(agRecord('ai-gateway/1.2.0-docs.2', 'ai-gateway/1.2.0-docs.1')));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'a');
  const base = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-qb', 'intake/ai-gateway');
  fs.writeFileSync(file, formatRecord(agRecord('ai-gateway/1.2.0-docs.3', 'ai-gateway/1.2.0-docs.2', 'ai-gateway/1.2.0-docs.1')));
  git(dir, 'commit', '-qam', 'b');
  const store = tmp('store');
  let r = run('plan', '--scope', 'records', '--base', base, '--storage', `file:${store}`, '--rebuild-id', '5');
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.flip, 'ai-gateway/latest=1.2.0-docs.3 ai-gateway/1.2.0=1.2.0-docs.3');
  assert.equal(plan.flipBack, '');
  assert.deepEqual(plan.latest.include.map((d) => [d.asset, d.sha256]), [['ai-gateway-1.2.0-docs.3.docs.zip', sha('3')]]);
  // A first record: everything in it is new.
  r = run('plan', '--scope', 'records', '--base', '0000000000000000000000000000000000000000', '--storage', `file:${store}`);
  assert.equal(JSON.parse(r.stdout).flip, 'ai-gateway/latest=1.2.0-docs.3 ai-gateway/1.2.0=1.2.0-docs.3');

  r = run('record-check', '--base', base, '--branch', 'intake/ai-gateway');
  assert.equal(r.status, 0, r.stderr);
  fs.writeFileSync(path.join(dir, 'other.txt'), 'x');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'c');
  r = run('record-check', '--base', base, '--branch', 'intake/ai-gateway');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /other\.txt: an intake pull request/);
  assert.match(run('help').stdout, /flip .*--backwards/);

  // An intake run with nothing new still writes its report, its folder made
  // (intake.yml reads it; a quiet run used to fail on the missing folder).
  const empty = path.join(dir, 'empty.json');
  fs.writeFileSync(empty, JSON.stringify({ docSpaces: {} }));
  const reportFile = path.join(dir, 'intake', 'intake.json');
  r = run('intake', '--policy', empty, '--records', path.join(dir, 'none'), '--report', reportFile, '--work', path.join(dir, 'work'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportFile, 'utf8')), { changes: [], issues: [], errors: [] });
});

test('rebuilds build each deployed tag from its recorded bundle; the Platform\'s own Doc space builds from the Platform', () => {
  const records = { 'ai-gateway': agRecord('ai-gateway/1.2.0-docs.2') };
  const skipped = [];
  const list = bundlesFor([
    { space: 'ai-gateway', segment: '1.2.0', repo: API, tag: 'ai-gateway/1.2.0-docs.2' },
    { space: 'ai-gateway', segment: '2026.09.24', repo: API, tag: 'ai-gateway/2026.09.24-docs.1' },
    { space: 'contribute', segment: '_', repo: 'wso2/docs-platform', tag: 'cloud-2026.10.27.1' },
  ], records, { platformRepo: 'wso2/docs-platform', onSkip: (d) => skipped.push(d) });
  assert.deepEqual(list.map((d) => [d.space, d.segment, d.asset, d.sha256]), [
    ['ai-gateway', '1.2.0', 'ai-gateway-1.2.0-docs.2.docs.zip', sha('2')],
    ['contribute', '_', '', ''],
  ]);
  assert.match(skipped[0].reason, /not in releases\/ai-gateway\.yaml/);
});

test('a build fetches the recorded asset, checks its sha256 against the record and unpacks it into an empty folder', async () => {
  const b = stubBundle();
  const tag = 'identity-server/7.3.0-docs.2';
  const bytes = fs.readFileSync(b.file);
  const fetch = async (url, init) => {
    if (url === `https://api.github.com/repos/${IDP}/releases/tags/${encodeURIComponent(tag)}`) {
      return new Response(JSON.stringify({ tag_name: tag, assets: [{ name: 'identity-server-7.3.0-docs.2.docs.zip', url: 'https://api.github.com/a/1' }] }), { status: 200 });
    }
    assert.equal(url, 'https://api.github.com/a/1');
    assert.equal(init.headers.Accept, 'application/octet-stream');
    return new Response(bytes, { status: 200 });
  };
  const out = path.join(tmp('fetch'), 'bundle');
  const r = await fetchBundle({ repo: IDP, tag, asset: 'identity-server-7.3.0-docs.2.docs.zip', sha256: b.sha256, out, fetch });
  assert.equal(r.dir, path.join(out, 'identity-server'));
  assert.equal(r.edition, '7.3.0');
  assert.ok(fs.existsSync(path.join(r.dir, 'docs', 'guides', 'mfa.mdx')));
  assert.ok(fs.readFileSync(r.mainFiles, 'utf8').split('\n').includes('identity-server/docs/guides/mfa.mdx'));
  assert.ok(!fs.readdirSync(out).some((f) => f.endsWith('.zip')), 'the zip stays out of the build folder');
  await assert.rejects(fetchBundle({ repo: IDP, tag, asset: 'identity-server-7.3.0-docs.2.docs.zip', sha256: sha('9'), out: path.join(tmp('fetch'), 'b'), fetch }), /sha256 .* not the record's/);
  await assert.rejects(fetchBundle({ repo: IDP, tag, asset: 'other.docs.zip', sha256: b.sha256, out: path.join(tmp('fetch'), 'c'), fetch }), /no asset other\.docs\.zip/);
});

test('a build from an unpacked bundle reads the repo path, the files on main and the source commit from bundle.json, never from git', () => {
  // Unpacked inside another git checkout (as the Platform's own would be):
  // git would answer with that checkout's paths, main and commit.
  const host = tmp('host');
  git(host, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(host, 'x.txt'), 'x');
  git(host, 'add', '-A');
  git(host, 'commit', '-qm', 'host');
  const out = path.join(host, 'work', 'bundle');
  const b = stubBundle();
  unpackZip(b.file, out);
  const dir = path.join(out, 'identity-server');
  const repo = loadContentRepo(dir);
  assert.equal(repoPathOf(dir), 'identity-server');
  const main = mainBranchFiles(repo);
  assert.ok(main.has('identity-server/docs/guides/mfa.mdx'));
  assert.equal(main.size, b.bundle.mainFiles.length);
  assert.equal(checkoutCommit(repo), b.commit);
  // A stray bundle.json that describes another directory is not this one's.
  assert.equal(bundleOf(path.join(host, 'work')), null);

  // A family Cloud bundle: its Cloud parts load from beside it, with no git.
  const repoDir = tmp('family');
  fs.cpSync(path.join(root, 'fixtures', 'stub-repo'), repoDir, { recursive: true });
  git(repoDir, 'init', '-q', '-b', 'main');
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-qm', 'base');
  const famZip = tmp('fam');
  const fam = makeBundle({ dir: repoDir, tag: 'identity-platform/cloud-2026.10.27.1', out: famZip, repo: IDP });
  const famOut = path.join(tmp('fam-out'), 'bundle');
  unpackZip(path.join(famZip, fam.asset), famOut);
  const family = loadContentRepo(path.join(famOut, 'identity-platform'));
  assert.deepEqual(loadCloudParts(family, 'cloud').map((p) => p.slug), ['identity-server']);
  assert.equal(checkoutCommit(family), git(repoDir, 'rev-parse', 'HEAD'));
  assert.equal(repoPathOf(path.join(famOut, 'identity-server')), 'identity-server', 'a Cloud part is in its family\'s bundle');
});
