// Boilerplate to copy and start: the template in templates/content-repo/ and
// `wso2-docs init`, composing from the published manifest (preview, check and
// a Content repo's compose check without other checkouts), a section that
// lists a Doc space before it exists, entries hidden until published, and
// manifests that read dates as plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { GUIDE_URL, TEMPLATE_DIR, TEMPLATE_FILES, addDocSpaceToRoot, docSpaceDirs, writeRepoRoot } from '../lib/content-repo.mjs';
import { compose, errorsIn, formatIssues, readManifestText, readRepoDocSpaces } from '../lib/compose.mjs';
import { initDocSpace, initReport, SECTION_TEMPLATE, SKELETON_DIR } from '../lib/init.mjs';
import { loadPolicy, publicManifest, sectionEntries } from '../lib/manifest.mjs';
import { baseFromPublished, composeWithPublished, localRepo, readPublished, sourcesFromPublished } from '../lib/published.mjs';
import { mergeManifest } from '../lib/release.mjs';
import { validate } from '../lib/schemas.mjs';
import { loadContentRepo } from '../lib/content.mjs';
import { loadStandards } from '../lib/standards.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsCli = path.join(root, 'bin', 'wso2-docs.mjs');
const releaseCli = path.join(root, 'bin', 'wso2-release.mjs');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `wso2-${name}-`));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const files = (dir) => execFileSync('find', [dir, '-type', 'f', '-not', '-path', '*/.git/*'], { encoding: 'utf8' }).split('\n').filter(Boolean).map((f) => path.relative(dir, f)).sort();
// The CLIs as a Content repo runs them: no Content repo checkouts.
const noCheckouts = () => {
  const env = { ...process.env, GITHUB_ACTIONS: '' };
  delete env.WSO2_DOCS_CONTENT_REPOS;
  delete env.WSO2_DOCS_MANIFEST;
  return env;
};
const docs = (cwd, ...args) => spawnSync(process.execPath, [docsCli, ...args], { cwd, encoding: 'utf8', env: noCheckouts() });
const release = (cwd, ...args) => spawnSync(process.execPath, [releaseCli, ...args], { cwd, encoding: 'utf8', env: noCheckouts() });

// The Pilot's world as published (staging), from the suite's fixture checkouts.
const policy = loadPolicy();
const publishedOf = (p = policy) => ({ schema: 1, environment: 'staging', ...publicManifest(p, { environment: 'staging' }) });
const writePublished = (dir, published) => {
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(published));
  return file;
};
// The section change merged first: api-platform lists a Doc space that is coming.
const withComing = (slug, extra = {}) => {
  const p = structuredClone(policy);
  p.sections['api-platform'].pending = [{ at: 3, docSpace: slug, ...extra }, { at: 3, product: { label: 'MCP Hub', opens: { docSpace: slug } } }];
  return publishedOf(p);
};

test('init in an empty folder: the Doc space skeleton plus the repo root files the converter writes', () => {
  const dir = tmp('init-new');
  git(dir, 'init', '-q', '-b', 'main');
  const r = initDocSpace({ slug: 'agent-manager', root: dir, title: 'Agent Manager', home: 'agent-platform', cloud: true, selfHosted: '1.0.0' });
  assert.equal(r.rootFiles.kind, 'new');
  assert.deepEqual([r.repo, r.team, r.editions], ['wso2/' + path.basename(dir), 'agent-manager-docs', ['cloud', '1.0.0']]);
  const got = files(dir);
  for (const f of [
    'README.md', 'CODEOWNERS', ...TEMPLATE_FILES,
    'agent-manager/docspace.yaml', 'agent-manager/editions.yaml', 'agent-manager/redirects.yaml', 'agent-manager/partials/before-you-start.mdx',
    'agent-manager/assets/cloud/.gitkeep', 'agent-manager/assets/self-hosted/.gitkeep', 'agent-manager/docs/index.mdx',
    'agent-manager/docs/reference/catalog/index.mdx', 'agent-manager/docs/reference/catalog/catalog.yaml',
  ]) assert.ok(got.includes(f), f);
  for (const f of TEMPLATE_FILES) assert.equal(read(dir, f), read(TEMPLATE_DIR, f), `${f} as the template has it`);
  // Releases make Docs bundles (Releases and deployments, Docs bundles): the
  // workflow calls the Platform's docs-bundle.yml, and the report says to
  // turn on immutable releases.
  assert.match(read(dir, '.github', 'workflows', 'docs.yml'), /uses: wso2\/docs-platform\/\.github\/workflows\/docs-bundle\.yml@v1/);
  assert.match(initReport(r), /immutable releases/);
  // The same root files the converter writes (writeRepoRoot), README linking the guide.
  const twin = tmp('init-twin');
  fs.cpSync(path.join(dir, 'agent-manager'), path.join(twin, 'agent-manager'), { recursive: true });
  writeRepoRoot(twin, { repo: r.repo });
  for (const f of ['README.md', 'CODEOWNERS']) assert.equal(read(dir, f), read(twin, f), f);
  const readme = read(dir, 'README.md');
  assert.ok(readme.includes(GUIDE_URL), 'the README links the developer guide');
  assert.match(readme, /\| `agent-manager\/` \| Agent Manager \| Cloud on `main`; 1\.0\.0 on `release\/1\.0\.0` \|/);
  assert.match(read(dir, 'CODEOWNERS'), /^\/agent-manager\/ @wso2\/agent-manager-docs$/m);
  // The manifest: every placeholder filled, comments kept, valid against the schema.
  const text = read(dir, 'agent-manager', 'docspace.yaml');
  assert.doesNotMatch(text, /__[A-Z_]+__/);
  assert.match(text, /^# The home Docs section/m);
  assert.match(text, /`indexed: true` is the one exception/, 'the comment on indexed');
  const m = readManifestText(text);
  assert.deepEqual(validate('docspace', m), []);
  assert.deepEqual(m.editions, [{ id: 'cloud' }, { id: '1.0.0' }]);
  assert.deepEqual([m.home, m.owners.team, m.repo, m.editionNames], ['agent-platform', 'agent-manager-docs', r.repo, { cloud: 'Agent Manager Cloud', selfHosted: 'Agent Manager {version}' }]);
  const repo = loadContentRepo(path.join(dir, 'agent-manager'));
  assert.equal(repo.docspace.model, 'cloud-plus-versions');
  assert.equal(repo.editions['self-hosted'].displayName, 'Agent Manager {version}');
  // Refuses a slug that is there, writing nothing.
  const before = files(dir).length;
  assert.throws(() => initDocSpace({ slug: 'agent-manager', root: dir, home: 'agent-platform' }), /agent-manager\/ already exists .* nothing was written/);
  assert.throws(() => initDocSpace({ slug: 'Agent_Manager', root: dir, home: 'agent-platform' }), /lowercase words joined by hyphens/);
  assert.throws(() => initDocSpace({ slug: 'x', root: tmp('init-nohome') }), /Name the home Docs section/);
  assert.throws(() => initDocSpace({ slug: 'x', root: dir, home: 'agent-platform', selfHosted: 'v1' }), /exact version/);
  assert.equal(files(dir).length, before);
});

test('init in a repo with several Doc spaces: only <slug>/, a README row and a CODEOWNERS line, once', () => {
  const dir = tmp('init-existing');
  fs.cpSync(path.join(root, 'fixtures', 'stub-repo'), dir, { recursive: true });
  writeRepoRoot(dir, { repo: 'wso2/docs-identity-platform', generated: ['wso2/docs-is@abc'] });
  // A repo-local change to a Platform-managed file is brought back to the template.
  fs.writeFileSync(path.join(dir, '.github/workflows/docs.yml'), 'name: old\n');
  fs.rmSync(path.join(dir, '.github/workflows/docs-sync.yml'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'main');
  const before = Object.fromEntries(['identity-server', 'identity-platform'].map((d) => [d, files(path.join(dir, d)).map((f) => [f, read(dir, d, f)])]));
  const r = initDocSpace({ slug: 'agent-id', root: dir, title: 'Agent ID', selfHosted: '1.0.0' });
  assert.equal(r.rootFiles.kind, 'existing');
  assert.deepEqual(r.rootFiles.changed.sort(), ['.github/workflows/docs-sync.yml', '.github/workflows/docs.yml', 'CODEOWNERS', 'README.md']);
  assert.deepEqual([r.home, r.team, r.repo, r.editions], ['identity-platform', 'identity-platform-docs', 'wso2/docs-identity-platform', ['1.0.0']], "the repo's own home, team and name");
  for (const [d, list] of Object.entries(before)) for (const [f, text] of list) assert.equal(read(dir, d, f), text, `${d}/${f} is left alone`);
  const readme = read(dir, 'README.md');
  assert.match(readme, /Generated during the Pilot/, 'the rest of the README stays');
  const rows = readme.split('\n').filter((l) => l.startsWith('| `'));
  assert.deepEqual(rows.map((l) => l.split('`')[1]), ['agent-id/', 'identity-platform/', 'identity-server/'], 'by directory, as writeRepoRoot orders them');
  assert.match(rows[0], /1\.0\.0 on `agent-id\/release\/1\.0\.0`/, 'prefixed: the repo holds several Doc spaces');
  const owners = read(dir, 'CODEOWNERS').split('\n');
  assert.ok(owners.indexOf('/agent-id/ @wso2/identity-platform-docs') < owners.indexOf('/.github/ @wso2/docs-platform'));
  const m = readManifestText(read(dir, 'agent-id', 'docspace.yaml'));
  assert.deepEqual(validate('docspace', m), []);
  assert.match(read(dir, 'agent-id', 'docspace.yaml'), /^ {2}# cloud: Agent ID Cloud$/m, 'no Cloud Edition: its name is left as a comment');
  // Run for the root again: nothing changes.
  const snapshot = ['README.md', 'CODEOWNERS', ...TEMPLATE_FILES].map((f) => read(dir, f));
  assert.deepEqual(addDocSpaceToRoot(dir, 'agent-id').changed, []);
  assert.deepEqual(['README.md', 'CODEOWNERS', ...TEMPLATE_FILES].map((f) => read(dir, f)), snapshot);
  // Through the CLI: a second init of the slug stops.
  const again = docs(dir, 'init', 'agent-id');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /agent-id\/ already exists/);
  assert.deepEqual(docSpaceDirs(dir).map((d) => d.dir), ['agent-id', 'identity-platform', 'identity-server']);
});

test('init: a repo with one Doc space and unprefixed release branches is told to rename them', () => {
  const dir = tmp('init-rename');
  git(dir, 'init', '-q', '-b', 'main');
  initDocSpace({ slug: 'sandbox', root: dir, home: 'other', selfHosted: '1.0.0' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'main');
  git(dir, 'branch', 'release/1.0.0');
  const r = docs(dir, 'init', 'sandbox-two', '--title', 'Sandbox Two');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /git branch -m release\/1\.0\.0 sandbox\/release\/1\.0\.0/);
  assert.match(r.stdout, /navigation\/sections\/other\.yaml/);
  assert.match(r.stdout, /- docSpace: sandbox-two/);
});

test('init --root-files brings only the Platform-managed root files up to date, after a Platform release', () => {
  const dir = tmp('root-files');
  initDocSpace({ slug: 'agent-manager', root: dir, home: 'agent-platform' });
  const readme = read(dir, 'README.md');
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'docs.yml'), '# an older Platform version\n');
  fs.rmSync(path.join(dir, '.vscode', 'settings.json'));
  const r = docs(dir, 'init', '--root-files');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Updated from the Platform's template in .*: \.github\/workflows\/docs\.yml, \.vscode\/settings\.json\./);
  assert.match(r.stdout, /immutable releases/, 'a changed docs.yml makes Docs bundles: releases must be immutable');
  for (const f of TEMPLATE_FILES) assert.equal(read(dir, f), read(TEMPLATE_DIR, f), f);
  assert.equal(read(dir, 'README.md'), readme, 'README and CODEOWNERS are left alone');
  assert.match(docs(dir, 'init', '--root-files').stdout, /already match this Platform's template/);
  const empty = docs(tmp('root-files-empty'), 'init', '--root-files');
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /holds no Doc space directory/);
  assert.match(docs(dir, 'init', 'x', '--root-files').stderr, /takes no slug/);
});

test('the template: every data file, page and the sample section manifest are valid', () => {
  const S = loadStandards();
  // Pages: one of each Page type, in the skeleton folders, with the front matter the schema needs.
  const pages = files(path.join(SKELETON_DIR, 'docs')).filter((f) => f.endsWith('.mdx'));
  const types = new Set();
  for (const f of pages) {
    const fm = yaml.load(/^---\n([\s\S]*?)\n---/.exec(read(SKELETON_DIR, 'docs', f))[1].replaceAll('__TITLE__', 'X'));
    types.add(fm.type);
    assert.ok(fm.title && fm.description && fm.description.length <= 160, f);
  }
  assert.deepEqual([...types].sort(), S.pageTypeIds.slice().sort(), 'a sample of every Page type');
  const top = new Set(fs.readdirSync(path.join(SKELETON_DIR, 'docs'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
  assert.deepEqual([...top].sort(), S.skeleton.folders.map((x) => x.id).sort(), 'Get started, Guides, Concepts, Reference, Deploy and operate, Release notes');
  const home = read(SKELETON_DIR, 'docs', 'index.mdx');
  assert.match(home, /^layout: overview$/m);
  assert.match(home, /^# Optional: `layout: overview`/m);
  const catalog = read(SKELETON_DIR, 'docs', 'reference', 'catalog', 'index.mdx');
  assert.match(catalog, /^layout: catalog\ndata: \.\/catalog\.yaml$/m);
  assert.match(catalog, /^# Optional: `layout: catalog`/m);
  assert.deepEqual(validate('catalog', readManifestText(read(SKELETON_DIR, 'docs', 'reference', 'catalog', 'catalog.yaml'))), []);
  // The sample section manifest: valid, a borrowed Doc space and a link entry, and it composes with the Pilot.
  const sec = readManifestText(read(SECTION_TEMPLATE));
  assert.deepEqual(validate('section', sec), []);
  assert.ok(sec.menu.some((i) => i.url), 'a link entry');
  const inputs = { ...sourcesFromPublished(publishedOf()), missingRepos: [] };
  inputs.navigation.data.sections.push({ id: sec.id, in: 'agent-platform' });
  delete inputs.navigation.data.notYetOnWso2Docs['agent-manager'];
  inputs.sections[sec.id] = { file: `wso2/docs-platform:navigation/sections/${sec.id}.yaml`, data: sec };
  const { manifest, issues } = compose(inputs);
  assert.deepEqual(errorsIn(issues), [], formatIssues(issues));
  assert.deepEqual(issues.filter((i) => i.level !== 'warning' || i.code === 'unknown-docspace').map((i) => i.code).sort(), ['borrowed', 'unknown-docspace', 'unknown-docspace'], 'AI Gateway is borrowed; Agent Manager is coming');
  assert.deepEqual(manifest.sections[sec.id].menu.map((i) => i.docSpace ?? i.label), ['ai-gateway', 'Agent Platform on wso2.com']);
  assert.deepEqual(manifest.docSpaces['ai-gateway'].sections, ['api-platform', 'agent-platform'], 'one address, home first');
});

test('manifests read dates as plain text: an unquoted notice `until` passes the schema', () => {
  const dir = tmp('dates');
  fs.mkdirSync(path.join(dir, 'x'));
  fs.writeFileSync(path.join(dir, 'x', 'docspace.yaml'), 'schemaVersion: 1\nslug: x\ndisplayName: X\nhome: api-platform\nowners: { team: t }\nrepo: wso2/docs-x\neditions: [{ id: cloud }]\nnotices:\n  - text: Moving soon.\n    level: info\n    until: 2027-03-31\n');
  const [d] = readRepoDocSpaces(dir, { repo: 'wso2/docs-x' });
  assert.equal(d.data.notices[0].until, '2027-03-31');
  assert.deepEqual(validate('docspace', d.data), []);
  assert.equal(docSpaceDirs(dir)[0].docspace.notices[0].until, '2027-03-31');
  assert.equal(loadContentRepo(path.join(dir, 'x')).docspace.notices[0].until, '2027-03-31');
  // And compose warns once the day is past, comparing text with text.
  const published = withComing('x');
  const r = composeWithPublished(published, { repo: 'wso2/docs-x', docSpaces: [d] });
  assert.deepEqual(r.errors, [], formatIssues(r.issues));
  const past = composeWithPublished(published, { repo: 'wso2/docs-x', docSpaces: [{ ...d, data: { ...d.data, notices: [{ ...d.data.notices[0], until: '2020-01-01' }] } }] });
  assert.deepEqual(past.issues.map((i) => i.code), ['notice-ended']);
});

test('the published manifest gives back the team manifests it was made from', () => {
  for (const environment of ['staging', 'production']) {
    const published = { environment, ...publicManifest(policy, { environment }) };
    const { manifest, issues } = compose({ ...sourcesFromPublished(published), missingRepos: [] });
    assert.deepEqual(errorsIn(issues), [], formatIssues(issues));
    const again = publicManifest(manifest, { environment });
    assert.deepEqual(again.docSpaces, published.docSpaces, `${environment}: every Doc space as published`);
    assert.deepEqual(again.sections, published.sections);
    assert.deepEqual(again.productsMenu, published.productsMenu);
  }
  // A section's own version-in choice survives; a default is worked out again.
  const src = sourcesFromPublished(publishedOf());
  const menu = src.sections['identity-platform'].data.menu;
  assert.deepEqual(menu, policy.sources.sections['identity-platform'].data.menu.map((i) => (i['version-in'] ? i : { docSpace: i.docSpace })));
  const base = baseFromPublished(publishedOf());
  assert.equal(base.docSpaces['identity-server'].source.file, 'wso2/docs-identity-platform:identity-server/docspace.yaml', 'removing a Doc space still counts as removing it');
});

test('a section entry stays hidden until its Doc space is published', () => {
  const state = (deployments) => ({ environment: 'staging', deployments: Object.fromEntries(deployments.map((k) => [k, { release: 'r', tag: 't', edition: k.split('/')[1] }])) });
  // Nothing of API Platform's deployed yet but API Manager.
  const { manifest } = mergeManifest(policy, state(['api-manager/4.7.0', 'identity-server/7.3.0', 'identity-platform/cloud']));
  const sec = manifest.sections['api-platform'];
  assert.deepEqual(sec.menu.map((m) => m.docSpace), ['api-manager']);
  assert.deepEqual(sec.pending.filter((p) => p.docSpace).map((p) => [p.at, p.docSpace, p.versionIn]), [[0, 'api-platform', 'header'], [2, 'ai-gateway', 'menu']], 'their places and the section\'s own version-in');
  assert.deepEqual(sec.products.map((p) => p.label), ['API Manager']);
  assert.ok(!manifest.productsMenu.find((g) => g.id === 'api-platform').entries.some((e) => e.opens.docSpace === 'ai-gateway'));
  assert.deepEqual(sectionEntries(sec).menu.map((e) => e.slug), ['api-platform', 'api-manager', 'ai-gateway'], 'the section manifest\'s order');
  // A Cloud part is published with its platform's Cloud; Identity Server has its own deployments anyway.
  assert.deepEqual(manifest.sections['identity-platform'].menu.map((m) => m.docSpace), ['identity-platform', 'identity-server']);
  const parts = mergeManifest(policy, state(['api-platform/cloud'])).manifest.sections['api-platform'];
  assert.deepEqual(parts.menu.map((m) => m.docSpace), ['api-platform', 'ai-gateway'], 'AI Gateway is published as a Cloud part of API Platform Cloud');
  // Compose from that published file still sees every entry.
  const { manifest: again } = compose({ ...sourcesFromPublished({ environment: 'staging', ...manifest }), missingRepos: [] });
  assert.deepEqual(again.sections['api-platform'].menu.map((m) => m.docSpace), ['api-platform', 'api-manager', 'ai-gateway']);
});

test('preview and check compose from the published manifest and the repo alone; compose --pr shows each issue on its file', { timeout: 900_000 }, () => {
  const dir = tmp('from-published');
  const repoDir = path.join(dir, 'docs-api-platform');
  fs.mkdirSync(repoDir);
  git(repoDir, 'init', '-q', '-b', 'main');
  for (const d of ['api-platform', 'api-manager', 'ai-gateway']) {
    fs.cpSync(path.join(root, 'fixtures', 'content-repos', 'docs-api-platform', d), path.join(repoDir, d), { recursive: true });
  }
  writeRepoRoot(repoDir, { repo: 'wso2/docs-api-platform' });
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'main');
  git(repoDir, 'checkout', '-q', '-b', 'add-mcp-hub');
  const init = docs(repoDir, 'init', 'mcp-hub', '--title', 'MCP Hub', '--cloud', '--self-hosted', '1.0.0');
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /Home section: api-platform/);
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'Start MCP Hub');
  assert.deepEqual(localRepo(path.join(repoDir, 'mcp-hub')), { checkout: fs.realpathSync(repoDir), path: '', repo: 'wso2/docs-api-platform' });

  // Before the section lists it: check blocks on home-not-listing, in the Doc space manifest check.
  const early = writePublished(dir, publishedOf());
  let r = docs(repoDir, 'check', 'mcp-hub', '--no-build', '--no-lint', '--published', early, '--format', 'json');
  assert.equal(r.status, 1, r.stderr);
  let report = JSON.parse(r.stdout);
  const manifestCheck = report.checks.find((c) => c.id === 'manifest');
  assert.equal(manifestCheck.status, 'fail');
  assert.deepEqual(manifestCheck.findings.map((x) => [x.file, x.message.split(':')[0]]), [['docspace.yaml', 'home-not-listing']]);
  assert.match(manifestCheck.note, /composed with .*manifest\.json with wso2\/docs-api-platform's Doc space manifests/);
  r = release(dir, 'compose', '--pr', '--published', early, '--repo-dir', repoDir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error \[home-not-listing\] mcp-hub's home section is api-platform/);
  assert.match(r.stdout, /this change touches wso2\/docs-api-platform:mcp-hub\/docspace\.yaml$/m, 'only the new file: the rest is as on main');
  // In Actions the error sits on the file, with its owners.
  const actions = spawnSync(process.execPath, [releaseCli, 'compose', '--pr', '--published', early, '--repo-dir', repoDir, '--annotate', 'content/'], { cwd: dir, encoding: 'utf8', env: { ...noCheckouts(), GITHUB_ACTIONS: 'true' } });
  assert.match(actions.stdout, /^::error file=content\/mcp-hub\/docspace\.yaml,title=Compose home-not-listing::.*owners: api-platform-docs/m);

  // The section's change merged first (the entry waits, hidden): now both pass.
  const published = writePublished(dir, withComing('mcp-hub'));
  r = release(dir, 'compose', '--pr', '--published', published, '--repo-dir', repoDir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /compose: passes against the published manifest/);
  r = docs(repoDir, 'check', 'mcp-hub', '--published', published, '--format', 'json', '--build-out', path.join(dir, 'build'));
  report = JSON.parse(r.stdout);
  assert.equal(report.result, 'pass', JSON.stringify(report.checks.filter((c) => c.status === 'fail'), null, 2) + r.stderr);
  assert.equal(report.checks.find((c) => c.id === 'manifest').status, 'pass');
  assert.equal(report.checks.find((c) => c.id === 'preview-build').status, 'pass', 'the template builds as Cloud');
  assert.equal(report.checks.find((c) => c.id === 'data-files').status, 'pass');
  const composed = JSON.parse(read(os.homedir(), '.cache', 'wso2-docs', 'composed', 'mcp-hub.json'));
  assert.deepEqual(composed.sections['api-platform'].menu.map((m) => m.docSpace), ['api-platform', 'api-manager', 'ai-gateway', 'mcp-hub'], 'the menu the build drew');
  assert.deepEqual(composed.docSpaces['mcp-hub'].editions.map((e) => `${e.id}@${e.branch}`), ['cloud@main', '1.0.0@mcp-hub/release/1.0.0']);
  const home = read(dir, 'build', 'index.html');
  assert.match(home, /class="[^"]*overview/i, 'the overview home');
  assert.ok(fs.existsSync(path.join(dir, 'build', 'reference', 'catalog', 'index.html')));

  // A broken change to a Doc space manifest of this repo blocks with its own file named.
  const ds = path.join(repoDir, 'api-manager', 'docspace.yaml');
  fs.writeFileSync(ds, `${read(ds)}latest: 9.9.9\n`);
  r = release(dir, 'compose', '--pr', '--published', published, '--repo-dir', repoDir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error \[latest\] api-manager: latest is "9\.9\.9"/);
  assert.match(r.stdout, /1 blocking error in this change \(owners: api-platform-docs\)/);
  // Without a reachable published manifest, the message says what to set.
  r = docs(repoDir, 'check', 'mcp-hub', '--no-build', '--published', path.join(dir, 'missing.json'));
  assert.equal(r.status, 1);
});

test('readPublished: a URL is cached, and the cached copy is used when the host is down', async () => {
  const cacheDir = tmp('published-cache');
  const published = publishedOf();
  const ok = async () => ({ ok: true, status: 200, json: async () => published });
  assert.deepEqual(await readPublished('https://docs-staging.example/manifest.json', { cacheDir, fetchImpl: ok }), published);
  const logs = [];
  const down = async () => { throw new Error('offline'); };
  assert.deepEqual(await readPublished('https://docs-staging.example/manifest.json', { cacheDir, fetchImpl: down, log: (m) => logs.push(m) }), published);
  assert.match(logs[0], /can't read .* \(offline\); using the copy from/);
  await assert.rejects(readPublished('https://other.example/manifest.json', { cacheDir, fetchImpl: down }), /Can't read the published manifest .*WSO2_DOCS_CONTENT_REPOS/);
});
