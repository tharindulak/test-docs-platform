// Docs bundles (Releases and deployments): `wso2-docs bundle` packs one Doc
// space's directory for one Edition as a deterministic zip with a generated
// bundle.json, on a git copy of the stub Content repo. A Self-hosted bundle
// leaves out assets/cloud/; a family Cloud's bundle holds its Cloud parts as
// siblings; symlinks, references outside the packed directories, the limits
// and content safety stop it; --dry-run writes nothing but its report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, writeZip } from '../lib/zip.mjs';
import { LIMITS, makeBundle } from '../lib/bundle.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'wso2-docs.mjs');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `wso2-bundle-${name}-`));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, data) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), data);
};

// A git copy of the stub Content repo (identity-platform, the family Cloud,
// and identity-server, its Cloud part with versions), with Edition-only
// assets and one root file that no bundle carries.
function stubRepo() {
  const dir = tmp('repo');
  fs.cpSync(path.join(root, 'fixtures', 'stub-repo'), dir, { recursive: true });
  write(dir, 'identity-server/assets/cloud/console.png', 'cloud only');
  write(dir, 'identity-server/assets/self-hosted/carbon.png', 'self-hosted only');
  write(dir, 'identity-server/notes.txt', 'not part of the Doc space layout');
  write(dir, 'README.md', '# repo\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}
const entries = (file) => readZip(fs.readFileSync(file));
const names = (file) => entries(file).map((e) => e.name);
const bundleJson = (file) => JSON.parse(entries(file).find((e) => e.name === 'bundle.json').data);

test('the zip is deterministic: sorted entries, fixed time and mode, no extra fields, same bytes for the same files', () => {
  const dir = tmp('zip');
  const files = [{ name: 'b/two.txt', data: Buffer.from('two') }, { name: 'a.txt', data: Buffer.from('one '.repeat(100)) }, { name: 'empty', data: Buffer.alloc(0) }];
  const one = writeZip(path.join(dir, '1.zip'), files);
  const two = writeZip(path.join(dir, '2.zip'), [...files].reverse());
  const bytes = fs.readFileSync(path.join(dir, '1.zip'));
  assert.ok(bytes.equals(fs.readFileSync(path.join(dir, '2.zip'))));
  assert.equal(one.sha256, two.sha256);
  assert.equal(one.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(one.bytes, bytes.length);
  assert.deepEqual(readZip(bytes).map((e) => [e.name, e.data.toString()]), [['a.txt', 'one '.repeat(100)], ['b/two.txt', 'two'], ['empty', '']]);
  // Every local header: 1980-01-01 00:00, no extra field.
  let at = 0;
  for (let i = 0; i < 3; i++) {
    assert.equal(bytes.readUInt32LE(at), 0x04034b50);
    assert.equal(bytes.readUInt16LE(at + 10), 0);
    assert.equal(bytes.readUInt16LE(at + 12), 33);
    assert.equal(bytes.readUInt16LE(at + 28), 0);
    at += 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt32LE(at + 18);
  }
  // The system's unzip reads it, with rw-r--r-- files.
  const listing = spawnSync('unzip', ['-Z', path.join(dir, '1.zip')], { encoding: 'utf8' });
  if (listing.status === 0) assert.match(listing.stdout, /-rw-r--r--.*a\.txt/);
  for (const bad of ['/abs', '../up', 'a/../b', 'a//b', 'a\\b', '']) assert.throws(() => writeZip(path.join(dir, 'x.zip'), [{ name: bad, data: Buffer.from('x') }]), /Unsafe/, bad);
  assert.throws(() => writeZip(path.join(dir, 'x.zip'), [{ name: 'A.txt', data: Buffer.from('x') }, { name: 'a.txt', data: Buffer.from('y') }]), /Two zip entries/);
});

test('a Self-hosted bundle: the Doc space directory as it is, without assets/cloud/, and bundle.json', () => {
  const repo = stubRepo();
  const head = git(repo, 'rev-parse', 'HEAD');
  const out = tmp('out');
  const r = makeBundle({ dir: repo, tag: 'identity-server/7.3.0-docs.2', out, repo: 'tharindulak/docs-identity-platform' });
  assert.equal(r.result, 'pass', JSON.stringify(r.problems));
  assert.equal(r.asset, 'identity-server-7.3.0-docs.2.docs.zip');
  const zip = path.join(out, r.asset);
  assert.deepEqual(fs.readdirSync(out).sort(), [r.asset, 'bundle.json'].sort());
  assert.equal(r.sha256, crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'));
  const list = names(zip);
  for (const f of ['bundle.json', 'identity-server/docspace.yaml', 'identity-server/editions.yaml', 'identity-server/redirects.yaml',
    'identity-server/docs/guides/mfa.mdx', 'identity-server/partials/sign-in-options.mdx', 'identity-server/assets/logos/totp.svg',
    'identity-server/assets/self-hosted/carbon.png']) assert.ok(list.includes(f), f);
  assert.ok(!list.some((f) => f.startsWith('identity-server/assets/cloud/')), 'a Self-hosted bundle leaves out assets/cloud/');
  assert.ok(!list.some((f) => f.startsWith('identity-platform/') || f === 'README.md' || f === 'identity-server/notes.txt'), list.join(' '));
  // Markers are not applied: the page is as written.
  const mfa = entries(zip).find((e) => e.name === 'identity-server/docs/guides/mfa.mdx').data;
  assert.ok(mfa.equals(fs.readFileSync(path.join(repo, 'identity-server/docs/guides/mfa.mdx'))));
  const b = bundleJson(zip);
  assert.deepEqual(b, JSON.parse(fs.readFileSync(path.join(out, 'bundle.json'), 'utf8')));
  assert.equal(b.schema, 1);
  assert.equal(b.repo, 'tharindulak/docs-identity-platform');
  assert.equal(b.path, 'identity-server');
  assert.equal(b.docSpace, 'identity-server');
  assert.equal(b.tag, 'identity-server/7.3.0-docs.2');
  assert.equal(b.edition, '7.3.0');
  assert.equal(b.sourceCommit, head);
  assert.equal(b.platformVersion, pkg.version);
  assert.deepEqual(b.parts, []);
  assert.ok(b.mainFiles.includes('identity-server/docs/guides/mfa.mdx'), 'the files on main, for "Edit this page"');
  assert.ok(b.mainFiles.every((f) => f.startsWith('identity-server/docs/')));
});

test('the same commit gives the same bundle, byte for byte', () => {
  const repo = stubRepo();
  const a = makeBundle({ dir: repo, tag: 'identity-server/7.3.0-docs.1', out: tmp('a'), repo: 'x/y' });
  // Another checkout of the same commit, with other file times.
  const again = tmp('again');
  fs.cpSync(repo, again, { recursive: true });
  fs.utimesSync(path.join(again, 'identity-server/docs/guides/mfa.mdx'), new Date(2001, 1, 1), new Date(2001, 1, 1));
  const b = makeBundle({ dir: again, tag: 'identity-server/7.3.0-docs.1', out: tmp('b'), repo: 'x/y' });
  assert.equal(a.sha256, b.sha256);
});

test('a family Cloud bundle holds its Cloud parts as siblings, both asset folders, and lists the parts', () => {
  const repo = stubRepo();
  const out = tmp('out');
  const r = makeBundle({ dir: repo, tag: 'identity-platform/cloud-2026.10.27.1', out, repo: 'x/y' });
  assert.equal(r.result, 'pass', JSON.stringify(r.problems));
  assert.equal(r.asset, 'identity-platform-cloud-2026.10.27.1.docs.zip');
  const list = names(path.join(out, r.asset));
  for (const f of ['identity-platform/docspace.yaml', 'identity-platform/docs/index.mdx', 'identity-server/docspace.yaml', 'identity-server/docs/guides/mfa.mdx',
    'identity-server/assets/cloud/console.png', 'identity-server/assets/self-hosted/carbon.png']) assert.ok(list.includes(f), f);
  const b = bundleJson(path.join(out, r.asset));
  assert.equal(b.edition, 'cloud');
  assert.equal(b.docSpace, 'identity-platform');
  assert.equal(b.path, 'identity-platform');
  assert.deepEqual(b.parts, [{ slug: 'identity-server', path: 'identity-server' }]);
  assert.ok(b.mainFiles.includes('identity-server/docs/guides/mfa.mdx') && b.mainFiles.includes('identity-platform/docs/index.mdx'));
});

test('the Doc space, tag and Edition: from the tag at HEAD, explicit flags win; a Cloud part bundles its family', () => {
  const repo = stubRepo();
  git(repo, 'tag', 'identity-server/7.2.0-docs.3');
  const r = makeBundle({ dir: repo, out: tmp('out'), dryRun: true, repo: 'x/y' });
  assert.equal(r.bundle.tag, 'identity-server/7.2.0-docs.3');
  assert.equal(r.bundle.edition, '7.2.0');
  assert.equal(makeBundle({ dir: repo, out: tmp('out'), dryRun: true, edition: '7.3.0', repo: 'x/y' }).bundle.edition, '7.3.0');
  assert.equal(makeBundle({ dir: path.join(repo, 'identity-server'), tag: 'identity-server/7.3.0-docs.1', dryRun: true, repo: 'x/y' }).bundle.docSpace, 'identity-server');
  // No tag: a pull request's dry run, with the Edition its branch builds. On
  // main, identity-server's main line is its Cloud part of identity-platform.
  const fresh = stubRepo();
  const d = makeBundle({ dir: path.join(fresh, 'identity-server'), dryRun: true, repo: 'x/y' });
  assert.equal(d.result, 'pass', JSON.stringify(d.problems));
  assert.equal(d.bundle.tag, null);
  assert.equal(d.bundle.docSpace, 'identity-platform');
  assert.equal(d.bundle.edition, 'cloud');
  git(fresh, 'checkout', '-q', '-b', 'identity-server/release/7.3.0');
  assert.equal(makeBundle({ dir: path.join(fresh, 'identity-server'), dryRun: true, repo: 'x/y' }).bundle.edition, '7.3.0');
  assert.throws(() => makeBundle({ dir: fresh, out: tmp('out'), repo: 'x/y' }), /tag/, 'publishing needs a tag');
  assert.throws(() => makeBundle({ dir: fresh, tag: 'nope', dryRun: true, repo: 'x/y' }), /not a Docs release tag/);
  assert.throws(() => makeBundle({ dir: fresh, tag: 'api-manager/4.6.0-docs.1', dryRun: true, repo: 'x/y' }), /api-manager/);
});

test('--dry-run packs and checks but writes nothing', () => {
  const repo = stubRepo();
  const out = tmp('out');
  const before = fs.readdirSync(os.tmpdir()).length;
  const r = makeBundle({ dir: repo, tag: 'identity-server/7.3.0-docs.1', out, dryRun: true, repo: 'x/y' });
  assert.equal(r.result, 'pass');
  assert.equal(r.dryRun, true);
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.ok(r.bytes > 0 && r.files > 10);
  assert.deepEqual(fs.readdirSync(out), []);
  assert.ok(fs.readdirSync(os.tmpdir()).length <= before, 'no temporary file is left');
});

test('symlinks, references outside the packed directories, script files and code in pages stop the bundle', () => {
  const repo = stubRepo();
  fs.symlinkSync('../../README.md', path.join(repo, 'identity-server/docs/readme-link.md'));
  write(repo, 'shared/logo.png', 'x');
  fs.appendFileSync(path.join(repo, 'identity-server/docs/guides/mfa.mdx'), '\n![The logo](../../../shared/logo.png)\n\n[The family](../../../identity-platform/docs/index.mdx)\n');
  write(repo, 'identity-server/assets/widget.js', 'alert(1)');
  fs.appendFileSync(path.join(repo, 'identity-server/docs/guides/mfa.mdx'), '\n<div onClick="go()">x</div>\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'bad');
  const out = tmp('out');
  const r = makeBundle({ dir: repo, tag: 'identity-server/7.3.0-docs.1', out, repo: 'x/y' });
  assert.equal(r.result, 'fail');
  const msg = r.problems.map((p) => `${p.file}: ${p.message}`).join('\n');
  assert.match(msg, /identity-server\/docs\/readme-link\.md: .*symbolic link/);
  assert.match(msg, /identity-server\/docs\/guides\/mfa\.mdx: .*shared\/logo\.png.*outside/);
  assert.match(msg, /identity-platform\/docs\/index\.mdx.*outside/, 'another Doc space is outside a Self-hosted bundle');
  assert.match(msg, /identity-server\/assets\/widget\.js: .*script file/);
  assert.match(msg, /onClick/);
  assert.deepEqual(fs.readdirSync(out), [], 'nothing is written when a check fails');
});

test('limits: at most 30,000 files and 1 GiB, a warning above 500 MB', () => {
  assert.deepEqual(LIMITS, { files: 30_000, bytes: 1024 ** 3, warnBytes: 500 * 1024 ** 2 });
  const repo = stubRepo();
  const small = makeBundle({ dir: repo, tag: 'identity-server/7.3.0-docs.1', dryRun: true, repo: 'x/y', limits: { files: 5, bytes: 100, warnBytes: 50 } });
  assert.equal(small.result, 'fail');
  assert.match(small.problems.map((p) => p.message).join('\n'), /files, more than 5[^]*bytes, more than 100/);
  const warn = makeBundle({ dir: repo, tag: 'identity-server/7.3.0-docs.1', dryRun: true, repo: 'x/y', limits: { ...LIMITS, warnBytes: 50 } });
  assert.equal(warn.result, 'pass');
  assert.match(warn.warnings.join('\n'), /more than 50 bytes/);
});

test('the CLI: bundle writes the asset and its GitHub outputs, exits 1 on a problem', () => {
  const repo = stubRepo();
  const out = tmp('out');
  const gh = path.join(tmp('gh'), 'out.txt');
  const ok = spawnSync(process.execPath, [cli, 'bundle', repo, '--tag', 'identity-server/7.3.0-docs.1', '--out', out, '--repo', 'x/y', '--github-output', gh], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.match(ok.stdout, /identity-server-7\.3\.0-docs\.1\.docs\.zip/);
  const outputs = Object.fromEntries(fs.readFileSync(gh, 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
  assert.equal(outputs.asset, 'identity-server-7.3.0-docs.1.docs.zip');
  assert.equal(outputs.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(out, outputs.asset))).digest('hex'));
  assert.equal(outputs.edition, '7.3.0');
  assert.equal(outputs['source-commit'], git(repo, 'rev-parse', 'HEAD'));
  const report = path.join(tmp('report'), 'bundle.json');
  write(repo, 'identity-server/docs/guides/bad.mdx', '---\ntitle: Bad\ndescription: Bad.\ntype: how-to\n---\n\nexport const x = 1;\n');
  const bad = spawnSync(process.execPath, [cli, 'bundle', repo, '--dry-run', '--tag', 'identity-server/7.3.0-docs.1', '--repo', 'x/y', '--report', report], { encoding: 'utf8' });
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /export/);
  assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).result, 'fail');
});
