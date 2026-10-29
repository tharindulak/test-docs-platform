// Content repos in the new layout (Converter and Content repos in the new
// layout): one <slug>/ directory per Doc space, prefixed release branches,
// the path-filtered workflow's plan, the release-branch directory check, the
// converter writing that layout (sync.mjs), the family-level Doc space, the
// root files from templates/content-repo/, and compose reading main lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  TEMPLATE_FILES, docSpaceDirs, editionForBranch, outsideReleaseDir, parseBranch, planMainRelease, planPullRequest, planVersionRelease, writeRepoRoot,
  GUIDE_URL,
} from '../lib/content-repo.mjs';
import { compose, mainRef, readInputs, readRepoDocSpaces } from '../lib/compose.mjs';
import { loadContentRepo, showsCloudOnlyContent } from '../lib/content.mjs';
import { inferEditionId } from '../lib/edition.mjs';
import { checkReleaseScope } from '../lib/check/index.mjs';
import { resolveBase } from '../lib/check/git.mjs';
import { validate } from '../lib/schemas.mjs';
import { partialLinkResolver } from '../plugins/partials.mjs';
import isConfig from '../migration/products/identity-server.mjs';
import familyConfig from '../migration/products/identity-platform.mjs';
import apimConfig from '../migration/products/api-manager.mjs';
import aigConfig from '../migration/products/ai-gateway.mjs';
import apiPlatformConfig from '../migration/products/api-platform.mjs';
import agwConfig from '../migration/products/api-gateway.mjs';
import aiwConfig from '../migration/products/ai-workspace.mjs';
import apoConfig from '../migration/products/api-portal.mjs';
import fsConfig from '../migration/products/financial-services.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `wso2-${name}-`));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const space = (slug, extra = {}) => ({ schemaVersion: 1, slug, displayName: slug, owners: { team: `${slug}-docs` }, repo: 'wso2/docs-x', ...extra });
// A repo laid out as docs-identity-platform: a family Cloud and its part.
const identityDirs = [
  { dir: 'identity-platform', docspace: space('identity-platform', { editions: [{ id: 'cloud', parts: ['identity-server'] }] }) },
  { dir: 'identity-server', docspace: space('identity-server', { cloud: { in: 'identity-platform' }, editions: [{ id: '7.3.0' }, { id: '7.2.0' }] }) },
];

test('branches: main, <doc space>/release/<version>, or a one-Doc-space repo\'s release/<version>', () => {
  assert.deepEqual(parseBranch('main'), { main: true, space: null, version: null });
  assert.deepEqual(parseBranch('identity-server/release/7.3.0'), { main: false, space: 'identity-server', version: '7.3.0' });
  assert.deepEqual(parseBranch('origin/release/1.0.0'), { main: false, space: null, version: '1.0.0' });
  assert.equal(parseBranch('feature/x'), null);
  assert.equal(parseBranch('identity-server/release/7.3.0/extra'), null);
  // The main line of a Cloud part is its Cloud; a product without Cloud builds next there.
  assert.equal(editionForBranch(identityDirs[1].docspace, 'main'), 'cloud');
  assert.equal(editionForBranch(identityDirs[0].docspace, 'main'), 'cloud');
  assert.equal(editionForBranch(apimConfig.docspace, 'main'), 'next');
  assert.equal(editionForBranch(apimConfig.docspace, 'api-manager/release/4.6.0'), '4.6.0');
  assert.equal(inferEditionId('identity-server/release/7.2.0', 'versions-only'), '7.2.0');
  assert.equal(inferEditionId('main', 'versions-only', identityDirs[1].docspace), 'cloud');
  assert.equal(inferEditionId('main', 'versions-only'), 'next');
});

test('the workflow\'s path filter: a PR checks the Doc spaces it touches; a release branch, only its own, and nothing else may change', () => {
  const main = planPullRequest({ dirs: identityDirs, branch: 'main', paths: ['identity-server/docs/guides/mfa.mdx', 'README.md'] });
  assert.deepEqual(main.spaces, [{ dir: 'identity-server', slug: 'identity-server', edition: 'cloud' }]);
  assert.deepEqual(main.outside, []);
  assert.deepEqual(planPullRequest({ dirs: identityDirs, branch: 'main', paths: ['.github/workflows/docs.yml'] }).spaces, [], 'root files touch no Doc space');
  const rel = planPullRequest({ dirs: identityDirs, branch: 'identity-server/release/7.2.0', paths: ['identity-server/docs/a.mdx', 'identity-platform/docs/index.mdx', 'README.md'] });
  assert.deepEqual(rel.spaces, [{ dir: 'identity-server', slug: 'identity-server', edition: '7.2.0' }]);
  assert.deepEqual(rel.outside, ['identity-platform/docs/index.mdx', 'README.md']);
  assert.deepEqual(planPullRequest({ dirs: identityDirs, branch: 'identity-server/release/7.2.0', paths: [] }).spaces.map((s) => s.dir), ['identity-server'], 'always checked');
  assert.throws(() => planPullRequest({ dirs: identityDirs, branch: 'api-gateway/release/1.0.0', paths: [] }), /no directory/);
  assert.throws(() => planPullRequest({ dirs: identityDirs, branch: 'feature/x', paths: [] }), /No Doc space builds from branch/);
  // A repo with one Doc space keeps release/<version>.
  const one = [{ dir: 'sandbox', docspace: space('sandbox', { editions: [{ id: 'cloud' }, { id: '1.0.0' }] }) }];
  assert.deepEqual(planPullRequest({ dirs: one, branch: 'release/1.0.0', paths: ['sandbox/docs/x.mdx'] }).spaces, [{ dir: 'sandbox', slug: 'sandbox', edition: '1.0.0' }]);
  assert.deepEqual(outsideReleaseDir(['CODEOWNERS'], 'release/1.0.0', one), ['CODEOWNERS']);
});

test('releases: a push to main releases each touched Cloud (a part releases its platform) and unversioned Doc space; "Release docs" tags one version', () => {
  assert.deepEqual(planMainRelease({ dirs: identityDirs, paths: ['identity-server/docs/x.mdx'] }), [{ slug: 'identity-platform', tagPrefix: 'identity-platform/', ref: 'main', version: '' }]);
  assert.deepEqual(planMainRelease({ dirs: identityDirs, paths: ['identity-server/a', 'identity-platform/b'] }).map((r) => r.slug), ['identity-platform'], 'once');
  const apim = [{ dir: 'api-manager', docspace: apimConfig.docspace }];
  assert.deepEqual(planMainRelease({ dirs: apim, paths: ['api-manager/docs/x.mdx'] }), [], 'no Cloud, no main-line release');
  const security = [{ dir: 'platform-security', docspace: space('platform-security', { model: 'unversioned' }) }];
  assert.deepEqual(planMainRelease({ dirs: security, paths: ['platform-security/docs/x.mdx'] }), [{ slug: 'platform-security', tagPrefix: '', ref: 'main', version: '' }],
    'an unversioned Doc space releases its one Edition from main');
  assert.deepEqual(planMainRelease({ dirs: security, paths: ['README.md'] }), [], 'only when the merge touches it');
  assert.deepEqual(planVersionRelease({ dirs: apim, space: 'api-manager', version: '4.7.0' }), [{ slug: 'api-manager', tagPrefix: 'api-manager/', ref: 'api-manager/release/4.7.0', version: '4.7.0' }],
    'a shared repo with one Doc space so far: its prefixed branches give prefixed tags');
  assert.deepEqual(planVersionRelease({ dirs: identityDirs, space: 'identity-server', version: '7.2.0' })[0].ref, 'identity-server/release/7.2.0');
  assert.throws(() => planVersionRelease({ dirs: identityDirs, space: 'identity-server', version: '7.1.0' }), /no Edition 7\.1\.0/);
  assert.throws(() => planVersionRelease({ dirs: identityDirs, space: null, version: '7.3.0' }), /Name the Doc space/);
  assert.throws(() => planVersionRelease({ dirs: identityDirs, space: 'identity-server', version: 'v7' }), /must look like/);
});

test('the repo root: the template\'s workflow and editor settings, plus a README and CODEOWNERS from the Doc space manifests', () => {
  const dir = tmp('root');
  for (const d of identityDirs) write(dir, `${d.dir}/docspace.yaml`, yaml.dump(d.docspace));
  writeRepoRoot(dir, { repo: 'wso2/docs-identity-platform', generated: ['wso2/docs-is@abc'] });
  for (const f of TEMPLATE_FILES) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), fs.readFileSync(path.join(root, 'templates', 'content-repo', f), 'utf8'), f);
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  assert.match(readme, /^# docs-identity-platform$/m);
  assert.match(readme, /\| `identity-server\/` \| identity-server \| 7\.3\.0 on `identity-server\/release\/7\.3\.0`; 7\.2\.0 on `identity-server\/release\/7\.2\.0`; its Cloud part of identity-platform on `main` \|/);
  assert.match(readme, /Cloud on `main` \(Cloud parts: identity-server\)/);
  assert.match(readme, /Generated during the Pilot\. Do not edit here\..*`wso2\/docs-is@abc`/);
  assert.ok(readme.includes(`the developer guide for product teams, ${GUIDE_URL}`), 'the README links the guide, never repeats it');
  const owners = fs.readFileSync(path.join(dir, 'CODEOWNERS'), 'utf8');
  assert.match(owners, /^\/identity-server\/ @wso2\/identity-server-docs$/m);
  assert.match(owners, /^\/\.github\/ @wso2\/docs-platform$/m);
  assert.deepEqual(docSpaceDirs(dir).map((d) => d.dir), ['identity-platform', 'identity-server']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('wso2-docs check: a release branch may change only its own Doc space directory', () => {
  const dir = tmp('scope');
  for (const d of identityDirs) {
    write(dir, `${d.dir}/docspace.yaml`, yaml.dump(d.docspace));
    write(dir, `${d.dir}/docs/index.mdx`, '---\ntitle: Home\ndescription: Home.\ntype: concept\n---\n\nHome.\n');
  }
  write(dir, 'README.md', '# repo\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'main');
  git(dir, 'checkout', '-q', '-b', 'identity-server/release/7.3.0');
  const repo = loadContentRepo(path.join(dir, 'identity-server'));
  write(dir, 'identity-server/docs/index.mdx', '---\ntitle: Home\ndescription: Home.\ntype: concept\n---\n\nChanged.\n');
  const base = resolveBase(repo.root, 'identity-server/release/7.3.0');
  assert.deepEqual(checkReleaseScope(repo, base).findings, [], 'its own directory');
  write(dir, 'identity-platform/docs/index.mdx', 'changed\n');
  write(dir, 'README.md', '# changed\n');
  const r = checkReleaseScope(repo, base);
  assert.deepEqual(r.findings.map((x) => x.file), ['../README.md', '../identity-platform/docs/index.mdx']);
  assert.match(r.findings[0].message, /identity-server\/release\/7\.3\.0 builds only identity-server\//);
  // Checking the other Doc space on this branch is a mistake in itself.
  assert.match(checkReleaseScope(loadContentRepo(path.join(dir, 'identity-platform')), base).findings[0].message, /is identity-server's release branch, but this is identity-platform/);
  assert.deepEqual(checkReleaseScope(repo, resolveBase(repo.root, 'main')).findings, [], 'main: no limit');
  // The workflow's plan fails the PR too.
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'change');
  const cli = spawnSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'spaces', dir, '--branch', 'identity-server/release/7.3.0', '--base', 'main'], { encoding: 'utf8' });
  assert.equal(cli.status, 1, cli.stderr);
  const out = JSON.parse(cli.stdout.slice(0, cli.stdout.indexOf('\n::error')));
  assert.deepEqual(out.spaces, [{ dir: 'identity-server', slug: 'identity-server', edition: '7.3.0' }]);
  assert.deepEqual(out.outside, ['README.md', 'identity-platform/docs/index.mdx']);
  assert.match(cli.stdout, /::error file=README\.md::/);
  fs.rmSync(dir, { recursive: true, force: true });
  // A repo with one Doc space keeps release/<version>; its root files stay out too.
  const single = tmp('scope-one');
  write(single, 'sandbox/docspace.yaml', yaml.dump(space('sandbox', { editions: [{ id: 'cloud' }, { id: '1.0.0' }] })));
  write(single, 'README.md', '# repo\n');
  git(single, 'init', '-q', '-b', 'main');
  git(single, 'add', '-A');
  git(single, 'commit', '-q', '-m', 'main');
  git(single, 'checkout', '-q', '-b', 'release/1.0.0');
  write(single, 'README.md', '# changed on release/1.0.0\n');
  write(single, 'sandbox/docs/x.mdx', 'x\n');
  const sandbox = loadContentRepo(path.join(single, 'sandbox'));
  assert.deepEqual(checkReleaseScope(sandbox, resolveBase(sandbox.root, 'release/1.0.0')).findings.map((x) => x.file), ['../README.md']);
  fs.rmSync(single, { recursive: true, force: true });
});

test('wso2-docs spaces: the plan as GitHub outputs for a PR to main, a push and "Release docs"', () => {
  const dir = tmp('spaces');
  for (const d of identityDirs) write(dir, `${d.dir}/docspace.yaml`, yaml.dump(d.docspace));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'one');
  const first = git(dir, 'rev-parse', 'HEAD');
  write(dir, 'identity-server/docs/x.mdx', 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'two');
  const outFile = path.join(dir, '..', `${path.basename(dir)}.out`);
  const run = (...args) => {
    fs.rmSync(outFile, { force: true });
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'spaces', dir, ...args, '--github-output', outFile], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return Object.fromEntries(fs.readFileSync(outFile, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), JSON.parse(l.slice(l.indexOf('=') + 1))]));
  };
  assert.deepEqual(run('--branch', 'main', '--base', first).spaces, [{ dir: 'identity-server', slug: 'identity-server', edition: 'cloud' }]);
  assert.deepEqual(run('--push', '--base', first).releases, [{ slug: 'identity-platform', tagPrefix: 'identity-platform/', ref: 'main', version: '' }]);
  assert.deepEqual(run('--push', '--base', '0000000000000000000000000000000000000000').releases.map((r) => r.slug), ['identity-platform'], 'a new branch: everything');
  assert.deepEqual(run('--release', 'identity-server', '--version', '7.3.0').releases, [{ slug: 'identity-server', tagPrefix: 'identity-server/', ref: 'identity-server/release/7.3.0', version: '7.3.0' }]);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outFile, { force: true });
});

test('the converter\'s Doc space manifests are the Pilot\'s, valid against the schema', () => {
  const fixture = (repo, slug) => yaml.load(fs.readFileSync(path.join(root, 'fixtures', 'content-repos', repo, slug, 'docspace.yaml'), 'utf8'));
  for (const [config, repo] of [[isConfig, 'docs-identity-platform'], [familyConfig, 'docs-identity-platform'], [apimConfig, 'docs-api-platform'], [aigConfig, 'docs-api-platform'], [agwConfig, 'docs-api-platform'], [aiwConfig, 'docs-api-platform'], [apoConfig, 'docs-api-platform'], [apiPlatformConfig, 'docs-api-platform']]) {
    assert.deepEqual(validate('docspace', config.docspace), [], config.slug);
    assert.deepEqual(config.docspace, fixture(repo, config.slug), `${config.slug}: fixtures/content-repos/ is what the converter writes`);
    assert.equal(config.docspace.slug, config.slug);
  }
  // The family-level Doc space and its part point at each other.
  assert.deepEqual(familyConfig.docspace.editions, [{ id: 'cloud', parts: ['identity-server'] }]);
  assert.equal(isConfig.docspace.cloud.in, 'identity-platform');
  assert.deepEqual(familyConfig.parts.map((p) => p.docSpace), familyConfig.docspace.editions[0].parts);
});

test('compose reads the Pilot as it is (fixtures/content-repos/): two Doc spaces in docs-identity-platform, six in docs-api-platform', () => {
  const inputs = readInputs({ contentDir: path.join(root, 'fixtures', 'content-repos') });
  assert.deepEqual(inputs.missingRepos, []);
  const { manifest, issues } = compose(inputs);
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
  const s = manifest.docSpaces;
  assert.deepEqual(s['identity-platform'].editions.map((e) => [e.id, e.branch, e.parts]), [['cloud', 'main', ['identity-server']]]);
  assert.equal(s['identity-platform'].model, 'cloud-only');
  assert.deepEqual(s['identity-server'].editions.filter((e) => e.status !== 'legacy').map((e) => e.branch), ['identity-server/release/7.3.0', 'identity-server/release/7.2.0']);
  assert.equal(s['identity-server'].tagPrefix, 'identity-server/');
  assert.equal(s['identity-server'].latest, '7.3.0');
  assert.deepEqual(s['api-manager'].editions.filter((e) => e.status !== 'legacy').map((e) => e.branch), ['api-manager/release/4.7.0', 'api-manager/release/4.6.0']);
  assert.equal(s['api-manager'].tagPrefix, 'api-manager/', 'prefixed branches give prefixed tags, though docs-api-platform builds one Doc space so far');
  assert.equal(s['api-manager'].repo, 'wso2/docs-api-platform');
  // Legacy versions (product placement): 4.5.0 to 3.0.0 on apim.docs.wso2.com, 2.6.0 and older on Confluence.
  const legacy = s['api-manager'].editions.filter((e) => e.status === 'legacy');
  assert.deepEqual(legacy.map((e) => e.id), ['4.5.0', '4.4.0', '4.3.0', '4.2.0', '4.1.0', '4.0.0', '3.2.0', '3.1.0', '3.0.0', '2.6.0', '2.5.0', '2.2.0', '2.1.0', '2.0.0', '1.10.0', '1.9.1', '1.9.0']);
  assert.ok(legacy.slice(0, 9).every((e) => e.legacyUrl === `https://apim.docs.wso2.com/en/${e.id}/`));
  assert.equal(legacy.find((e) => e.id === '2.6.0').legacyUrl, 'https://wso2docs.atlassian.net/wiki/spaces/AM260/overview');
  assert.equal(legacy.find((e) => e.id === '1.10.0').legacyUrl, 'https://wso2docs.atlassian.net/wiki/spaces/AM1100/overview');
  // On WSO2 Docs since Convert API Platform Cloud and AI Gateway: the family Cloud and its part.
  for (const slug of ['api-platform', 'ai-gateway', 'api-gateway', 'ai-workspace', 'api-portal']) assert.equal(s[slug].status, 'live', slug);
  assert.deepEqual(s['api-platform'].editions.map((e) => [e.id, e.branch, e.parts]), [['cloud', 'main', ['ai-gateway', 'api-gateway', 'ai-workspace', 'api-portal']]]);
  assert.deepEqual(s['ai-gateway'].cloud, { in: 'api-platform' });
  assert.deepEqual(s['ai-gateway'].editions.filter((e) => e.status !== 'legacy').map((e) => e.branch), ['ai-gateway/release/1.2.0', 'ai-gateway/release/2026.09.24']);
  assert.equal(s['ai-gateway'].tagPrefix, 'ai-gateway/');
  // API Gateway, the second Cloud part: three Editions, 1.2.0 the latest.
  assert.deepEqual(s['api-gateway'].cloud, { in: 'api-platform' });
  assert.deepEqual(s['api-gateway'].editions.map((e) => e.branch), ['api-gateway/release/1.2.0', 'api-gateway/release/1.1.0', 'api-gateway/release/1.0.0']);
  assert.equal(s['api-gateway'].latest, '1.2.0');
  assert.equal(s['api-gateway'].tagPrefix, 'api-gateway/');
  // AI Workspace and API Portal & MCP Hub, the third and fourth Cloud parts: one Edition each.
  for (const slug of ['ai-workspace', 'api-portal']) {
    assert.deepEqual(s[slug].cloud, { in: 'api-platform' }, slug);
    assert.deepEqual(s[slug].editions.map((e) => e.branch), [`${slug}/release/1.0.0`], slug);
    assert.equal(s[slug].latest, '1.0.0', slug);
    assert.equal(s[slug].tagPrefix, `${slug}/`, slug);
  }
  assert.deepEqual(manifest.sections['api-platform'].menu.map((m) => m.docSpace), ['api-platform', 'api-manager', 'api-gateway', 'ai-gateway', 'ai-workspace', 'api-portal']);
  assert.ok(!s['docs-api-manager']);
});

test('compose reads a checkout\'s main line, not the branch checked out', () => {
  const dir = tmp('mainref');
  write(dir, 'a/docspace.yaml', yaml.dump(space('a', { displayName: 'On main' })));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'main');
  git(dir, 'checkout', '-q', '-b', 'a/release/1.0.0');
  write(dir, 'a/docspace.yaml', yaml.dump(space('a', { displayName: 'On the release branch' })));
  write(dir, 'b/docspace.yaml', yaml.dump(space('b')));
  assert.equal(mainRef(dir), 'main');
  assert.deepEqual(readRepoDocSpaces(dir, { repo: 'wso2/docs-x' }, { ref: 'main' }).map((d) => [d.dir, d.data.displayName, d.file]), [['a', 'On main', 'wso2/docs-x:a/docspace.yaml']]);
  assert.deepEqual(readRepoDocSpaces(dir, { repo: 'wso2/docs-x' }).map((d) => d.data.displayName), ['On the release branch', 'b'], 'the working tree (a PR)');
  assert.equal(mainRef(path.join(dir, 'a')), null, 'a subfolder is no checkout of its own');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('partials/ next to docs/: a link from a partial to a page resolves to the page\'s URL', () => {
  const docsDir = path.join(root, 'fixtures', 'stub-repo', 'identity-server', 'docs');
  const resolve = partialLinkResolver({ docsDir, baseUrl: '/identity-server/7.3.0/' });
  const from = path.join(root, 'fixtures', 'stub-repo', 'identity-server', 'partials', 'sign-in-options.mdx');
  assert.equal(resolve({ linkPathname: '../docs/get-started/quick-start.mdx', sourceFilePath: from }), '/identity-server/7.3.0/get-started/quick-start/');
  assert.equal(resolve({ linkPathname: '../docs/index.mdx', sourceFilePath: from }), '/identity-server/7.3.0/');
  assert.equal(resolve({ linkPathname: '../docs/missing.mdx', sourceFilePath: from }), null);
  assert.equal(resolve({ linkPathname: '../README.md', sourceFilePath: from }), null, 'only pages');
});

test('sync: the converter regenerates <repo>/<slug>/ on main and prefixed release branches, with the family overview and the root files', async () => {
  const work = tmp('sync');
  // A docs-is source checkout: the mini project, with an IS next tree for main
  // and home page cards for the family overview.
  const src = path.join(work, 'docs-is');
  fs.cpSync(path.join(root, 'fixtures', 'mkdocs-is-mini'), src, { recursive: true });
  const en = path.join(src, 'en');
  fs.cpSync(path.join(en, 'identity-server', '7.3.0'), path.join(en, 'identity-server', 'next'), { recursive: true });
  const nextYml = path.join(en, 'identity-server', 'next', 'mkdocs.yml');
  fs.writeFileSync(nextYml, fs.readFileSync(nextYml, 'utf8').replace('is_version: 7.3.0', 'is_version: next').replace('/en/7.3.0', '/en/next'));
  const asg = path.join(en, 'asgardeo', 'mkdocs.yml');
  fs.writeFileSync(asg, fs.readFileSync(asg, 'utf8').replace('plugins:', [
    '  home_page_cards:',
    '    - section:',
    '      - title: Guides',
    '        list_items:',
    '          - title: Add MFA',
    '            url: Guides|Add MFA',
    '          - title: Nowhere',
    '            url: Guides|Gone',
    '          - title: Help',
    '            url: https://discord.com/invite/wso2',
    'plugins:',
  ].join('\n')));
  git(src, 'init', '-q', '-b', 'master');
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', 'source');
  // The repo has an old-layout main, kept as old/main.
  const repo = path.join(work, 'docs-identity-platform');
  write(repo, 'docspace.yaml', 'slug: identity-platform\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'old layout');
  git(repo, 'branch', '-m', 'main', 'old/main');
  const sync = (...args) => {
    const r = spawnSync(process.execPath, [path.join(root, 'migration', 'sync.mjs'), ...args, '--source', src, '--repo', repo, '--no-compile', '--trailer', 'Co-Authored-By: Test <test@example.invalid>'], {
      encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
    });
    return r;
  };
  let r = sync('identity-server', '--branch', 'main');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = sync('identity-platform', '--branch', 'main');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = sync('identity-server', '--branch', 'identity-server/release/7.3.0');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // Unprefixed or another Doc space's branches are refused.
  assert.match(sync('identity-server', '--branch', 'release/7.3.0').stderr, /converts to main or identity-server\/release\/<version>/);
  assert.match(sync('identity-platform', '--branch', 'identity-platform/release/1.0.0').stderr, /family-level Doc space: Cloud only, on main/);

  const files = (ref) => git(repo, 'ls-tree', '-r', '--name-only', ref).split('\n');
  const mainFiles = files('main');
  assert.ok(!mainFiles.includes('docspace.yaml'), 'main starts fresh in the new layout');
  assert.equal(git(repo, 'rev-list', '--count', 'main'), '2');
  assert.ok(files('old/main').includes('docspace.yaml'), 'the old branch stays');
  for (const f of ['README.md', 'CODEOWNERS', ...TEMPLATE_FILES, 'identity-server/docspace.yaml', 'identity-server/editions.yaml', 'identity-server/redirects.yaml',
    'identity-server/docs/guides/mfa.mdx', 'identity-server/assets/cloud/img/mfa.png', 'identity-platform/docspace.yaml', 'identity-platform/docs/index.mdx']) {
    assert.ok(mainFiles.includes(f), f);
  }
  assert.ok(!mainFiles.some((f) => /^(docs|assets)\//.test(f)), 'nothing at the root but shared files');
  const show = (ref, f) => git(repo, 'show', `${ref}:${f}`);
  assert.deepEqual(yaml.load(show('main', 'identity-server/docspace.yaml')), isConfig.docspace);
  assert.deepEqual(yaml.load(show('main', 'identity-platform/docspace.yaml')), familyConfig.docspace);
  const overview = show('main', 'identity-platform/docs/index.mdx');
  assert.match(overview, /^title: Identity Platform Cloud$/m);
  assert.match(overview, /^layout: overview$/m, 'drawn as cards (the overview layout)');
  assert.match(overview, /## Products\n\n### Identity Server\n\nSingle sign-on, [^\n]+\n\n- \[Identity Server Cloud\]\(docs:identity-server\/cloud\/\)\n- \[Identity Server Self-hosted \(newest release\)\]\(docs:identity-server\/latest\/\)(\n|$)/, 'one product card per Cloud part, with its Cloud and its newest release');
  assert.match(overview, /- \[Add MFA\]\(docs:identity-server\/cloud\/guides\/mfa\/\)/, 'a card links into the Cloud part');
  assert.match(overview, /^- Nowhere$/m);
  assert.match(overview, /- \[Help\]\(https:\/\/discord\.com\/invite\/wso2\)/);
  assert.match(show('main', 'README.md'), /\| `identity-platform\/` \| Identity Platform Cloud \|/);
  // The release branch: cut from main; its commit changes only identity-server/.
  const changed = git(repo, 'diff', '--name-only', 'main', 'identity-server/release/7.3.0').split('\n');
  assert.ok(changed.length && changed.every((f) => f.startsWith('identity-server/')), changed.join(', '));
  assert.equal(git(repo, 'merge-base', 'main', 'identity-server/release/7.3.0'), git(repo, 'rev-parse', 'main'));
  assert.match(git(repo, 'log', '-1', '--format=%B', 'identity-server/release/7.3.0'), /^Convert Identity Server 7\.3\.0 from wso2\/docs-is@[0-9a-f]{40}\n\nconverted from .* into identity-server\/\.[\s\S]*Co-Authored-By: Test/);
  assert.match(git(repo, 'log', '-1', '--format=%s', 'main'), /^Convert Identity Platform Cloud from wso2\/docs-is@/);
  // A second run with nothing new makes no commit.
  r = sync('identity-server', '--branch', 'identity-server/release/7.3.0');
  assert.match(r.stdout, /no changes/);
  fs.rmSync(work, { recursive: true, force: true });
});

test('sync: a one-Doc-space repo cuts unprefixed release branches (Accelerator for Financial Services); its home cards follow each version\'s nav', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-fs-sync-'));
  const src = path.join(work, 'docs-open-banking');
  const write = (root, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  // A docs-open-banking-shaped master: the home's cards are inline HTML with
  // onclick handlers, the 404 page is in the nav.
  write(src, 'en/mkdocs.yml', [
    'site_name: WSO2 Open Banking Accelerator Documentation',
    'site_url: https://ob.docs.wso2.com/en/latest/',
    'nav:',
    "  - 'Home': index.md",
    "  - 'Get Started':",
    "    - 'Quick Start Guide':",
    "      - 'Accelerator with WSO2 Identity server':",
    "        - 'Get Started': get-started/quick-start-guide-with-is.md",
    "  - 'Learn':",
    "    - 'Consent Management':",
    "      - 'Introduction': learn/consent-management.md",
    "  - '': page-not-found.md",
    'extra:',
    '  site_version: 4.0.0',
    '',
  ].join('\n'));
  write(src, 'en/docs/index.md', '---\ntemplate: templates/single-column.html\n---\n\n<div>\n<h1>Welcome</h1>\n<div class="card" onclick="location.href=\'learn/consent-management/\';"><p class="title">Consent Management</p></div>\n</div>\n');
  write(src, 'en/docs/get-started/quick-start-guide-with-is.md', '# Quick start\n\nSet up the accelerator.\n');
  write(src, 'en/docs/learn/consent-management.md', '# Consent management\n\nConsents.\n');
  write(src, 'en/docs/page-not-found.md', '# Page not found\n');
  git(src, 'init', '-q', '-b', 'master');
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', 'source');
  const repo = path.join(work, 'docs-open-banking-target');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  const sync = (...args) => spawnSync(process.execPath, [path.join(root, 'migration', 'sync.mjs'), 'financial-services', ...args, '--source', src, '--repo', repo, '--no-compile', '--trailer', 'Co-Authored-By: Test <test@example.invalid>'], { encoding: 'utf8', env });
  let r = sync('--branch', 'main');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = sync('--branch', 'release/4.0.0');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(sync('--branch', 'other/release/4.0.0').stderr, /converts to main or financial-services\/release\/<version>/);

  const show = (ref, f) => git(repo, 'show', `${ref}:${f}`);
  assert.deepEqual(yaml.load(show('main', 'financial-services/docspace.yaml')), fsConfig.docspace);
  assert.deepEqual(validate('docspace', fsConfig.docspace), []);
  assert.deepEqual(fsConfig.docspace.editions, [{ id: '4.0.0', branch: 'release/4.0.0' }, { id: '3.0.0', branch: 'release/3.0.0' }], 'product placement: 4.0.0 and 3.0.0, unprefixed branches');
  assert.equal(fsConfig.docspace.home, 'solutions');
  assert.equal(editionForBranch(fsConfig.docspace, 'main'), 'next', 'versions only: main is the next preview');
  assert.equal(editionForBranch(fsConfig.docspace, 'release/3.0.0'), '3.0.0');
  // The release branch: cut from main, its commit changes only financial-services/.
  const changed = git(repo, 'diff', '--name-only', 'main', 'release/4.0.0').split('\n').filter(Boolean);
  assert.ok(changed.every((f) => f.startsWith('financial-services/')), changed.join(', '));
  assert.equal(git(repo, 'merge-base', 'main', 'release/4.0.0'), git(repo, 'rev-parse', 'main'));
  assert.match(git(repo, 'log', '-1', '--format=%B', 'release/4.0.0'), /^Convert Accelerator for Financial Services 4\.0\.0 from wso2\/docs-open-banking@[0-9a-f]{40}\n/);
  // The home: the config's cards for 4.0.0's nav replace the inline HTML.
  const home = show('release/4.0.0', 'financial-services/docs/index.mdx');
  assert.match(home, /^layout: overview$/m);
  assert.match(home, /- \[Quick start with Identity Server\]\([^)]*quick-start-guide-with-is\.mdx\)/);
  assert.match(home, /- \[Consent management\]\([^)]*consent-management[^)]*\.mdx\)/);
  assert.doesNotMatch(home, /onclick|Welcome/);
  // A second Doc space in the repo: unprefixed release branches are refused.
  git(repo, 'checkout', '-q', 'main');
  write(repo, 'other/docspace.yaml', 'slug: other\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'a second Doc space');
  assert.match(sync('--branch', 'release/3.0.0').stderr, /one Doc space/);
  fs.rmSync(work, { recursive: true, force: true });
});

test('the Cloud notice\'s claim: a page shows Cloud-only content when it is Cloud-only or holds a Cloud-only block, partials included', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-cloud-content-'));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
    return path.join(dir, rel);
  };
  const shows = (text) => showsCloudOnlyContent(write('page.mdx', text));
  assert.equal(shows('---\ntitle: A\neditions: cloud\n---\n\nText.\n'), true, 'a Cloud-only page');
  assert.equal(shows('---\ntitle: A\n---\n\nShared.\n'), false);
  assert.equal(shows('Shared.\n\n<Edition only="cloud">\nCloud.\n</Edition>\n'), true);
  assert.equal(shows('A <Variants><Edition only="cloud">Console</Edition><Edition only="self-hosted">Management Console</Edition></Variants>.\n'), true, 'the Cloud form of a variant');
  assert.equal(shows('<Edition only="self-hosted">\nServer.\n\n<Edition only="cloud">\nNever shown.\n</Edition>\n</Edition>\n'), false, 'nothing inside Self-hosted-only content counts');
  assert.equal(shows('---\ntitle: A\neditions: self-hosted\n---\n\n<Edition only="cloud">\nNever shown.\n</Edition>\n'), false, 'nor on a Self-hosted-only page');
  assert.equal(shows('<Edition selfHostedFrom="next">\nComing.\n</Edition>\n'), false, 'shared content from a version is not Cloud-only');
  write('_partials/_note.mdx', '<Edition only="cloud">\nCloud.\n</Edition>\n');
  assert.equal(shows("import Note from './_partials/_note.mdx';\n\n<Note />\n"), true, 'a partial it imports');
});
