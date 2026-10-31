// Boilerplate to copy and start: the template in templates/content-repo/ and
// `wso2-docs init`, composing from the published manifest (preview, check and
// a Content repo's compose check without other checkouts; end to end in
// test/build/boilerplate.test.mjs), a section that lists a Doc space before it
// exists, entries hidden until published, and manifests that read dates as
// plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { GUIDE_URL, TEMPLATE_DIR, TEMPLATE_FILES, addDocSpaceToRoot, docSpaceDirs, writeRepoRoot } from '../lib/content-repo.mjs';
import { compose, errorsIn, formatIssues, readManifestText, readRepoDocSpaces } from '../lib/compose.mjs';
import { initDocSpace, initReport, SECTION_TEMPLATE, SKELETON_DIR } from '../lib/init.mjs';
import { publicManifest, sectionEntries } from '../lib/manifest.mjs';
import { baseFromPublished, composeWithPublished, readPublished, sourcesFromPublished } from '../lib/published.mjs';
import { mergeManifest } from '../lib/release.mjs';
import { validate } from '../lib/schemas.mjs';
import { loadContentRepo } from '../lib/content.mjs';
import { loadStandards } from '../lib/standards.mjs';
import { docs, git, policy, publishedOf, read, release, root, tmp, withComing } from './helpers/content-repo-clis.mjs';

const files = (dir) => execFileSync('find', [dir, '-type', 'f', '-not', '-path', '*/.git/*'], { encoding: 'utf8' }).split('\n').filter(Boolean).map((f) => path.relative(dir, f)).sort();

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
  assert.deepEqual(sec.pending.filter((p) => p.docSpace).map((p) => [p.at, p.docSpace, p.versionIn]), [[0, 'api-platform', 'header'], [2, 'api-gateway', 'menu'], [3, 'ai-gateway', 'menu'], [4, 'ai-workspace', 'menu'], [5, 'api-portal', 'menu']], 'their places and the section\'s own version-in');
  assert.deepEqual(sec.products.map((p) => p.label), ['API Manager']);
  assert.ok(!manifest.productsMenu.find((g) => g.id === 'api-platform').entries.some((e) => e.opens.docSpace === 'ai-gateway'));
  assert.deepEqual(sectionEntries(sec).menu.map((e) => e.slug), ['api-platform', 'api-manager', 'api-gateway', 'ai-gateway', 'ai-workspace', 'api-portal'], 'the section manifest\'s order');
  // A Cloud part is published with its platform's Cloud; Identity Server has its own deployments anyway.
  assert.deepEqual(manifest.sections['identity-platform'].menu.map((m) => m.docSpace), ['identity-platform', 'identity-server']);
  const parts = mergeManifest(policy, state(['api-platform/cloud'])).manifest.sections['api-platform'];
  assert.deepEqual(parts.menu.map((m) => m.docSpace), ['api-platform', 'api-gateway', 'ai-gateway', 'ai-workspace', 'api-portal'], 'the four Cloud parts are published with API Platform Cloud');
  // Compose from that published file still sees every entry.
  const { manifest: again } = compose({ ...sourcesFromPublished({ environment: 'staging', ...manifest }), missingRepos: [] });
  assert.deepEqual(again.sections['api-platform'].menu.map((m) => m.docSpace), ['api-platform', 'api-manager', 'api-gateway', 'ai-gateway', 'ai-workspace', 'api-portal']);
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
