// `wso2-docs check` and `wso2-docs new` on a git copy of the stub Content
// repo (test/helpers/check-repo.mjs), without the preview build: lint only
// warns, and only on changed lines; overrides apply to policy checks only;
// the CLI exits 1 on a blocking failure and 0 otherwise. Each blocking check
// and the build's checks are in test/build/check.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadContentRepo } from '../lib/content.mjs';
import { formatText } from '../lib/check/index.mjs';
import { findVale } from '../lib/check/lint.mjs';
import { scaffoldPage } from '../lib/scaffold.mjs';
import { routeFor } from '../lib/check/content.mjs';
import { checkSkeleton, skeletonFolderOf } from '../lib/check/source.mjs';
import { loadStandards } from '../lib/standards.mjs';
import { validate } from '../lib/schemas.mjs';
import { CATALOG, PAGE, append, check, cli, file, findings, git, read, repoDir, reset, routesDir, status, tmp, write } from './helpers/check-repo.mjs';

test('data files: findings name the data file and the line of the item, and the build does not report them twice', async () => {
  reset();
  write(CATALOG, read(CATALOG).replace('href: guides/mfa\n', 'href: guides/nope\n'));
  const r = await check();
  const [x] = findings(r, 'data-files');
  assert.equal(x.file, CATALOG);
  assert.equal(x.line, read(CATALOG).split('\n').findIndex((l) => l.includes('- id: totp')) + 1, 'the line of the item');
  assert.match(x.message, /items\.0 \(totp\): href "guides\/nope" is not a page in this Doc space \(schema: catalog/);
  assert.equal(status(r, 'compile'), 'pass', 'the compile check leaves data files to the data-files check');
  assert.match(r.checks.find((c) => c.id === 'data-files').note, /docs\/reference\/connectors\/connectors\.yaml \(catalog\)/);
  reset();
  write(PAGE, read(PAGE).replace('type: how-to', 'type: how-to\ndata: ./x.yaml'));
  assert.match(findings(await check(), 'data-files')[0].message, /"data" is read only by the catalog layout; this page's layout is default/);
  reset();
});

test('docs: links in a catalog data file are checked against the target\'s route list', async () => {
  reset();
  const r0 = await check();
  assert.deepEqual(findings(r0, 'docs-links'), [], 'the stub catalog\'s docs:api-manager/latest/guides/ is in the route list');
  write(CATALOG, read(CATALOG).replace("href: 'docs:api-manager/latest/guides/'", "href: 'docs:api-manager/latest/nope/'"));
  const [x] = findings(await check(), 'docs-links');
  assert.equal(x.file, CATALOG);
  assert.equal(x.line, read(CATALOG).split('\n').findIndex((l) => l.includes('docs:api-manager/latest/nope/')) + 1);
  assert.match(x.message, /docs:api-manager\/latest\/nope\/: api-manager\/latest has no page "nope\/"/);
  reset();
});

test('image size warns over 300 KB; a repo-wide pre-existing marker is not flagged', async () => {
  reset();
  write('assets/img/medium.png', Buffer.alloc(400 * 1024, 1));
  const r = await check();
  assert.equal(status(r, 'image-size'), 'warn');
  assert.equal(r.result, 'pass');
  // quick-start.mdx has selfHostedFrom="7.3.0" (= latest) on an unchanged line.
  assert.equal(status(r, 'marker-versions'), 'pass');
  reset();
});

test('overrides apply to policy checks only, and need a reason', async () => {
  reset();
  git('mv', PAGE, 'docs/guides/multi-factor.mdx');
  write(CATALOG, read(CATALOG).replace('href: guides/mfa\n', 'href: guides/multi-factor\n')); // the catalog's link follows the page
  append('docs/guides/multi-factor.mdx', '\nUse {edition.nope}.\n');
  const r = await check({ override: 'the page was renamed on purpose' });
  assert.equal(status(r, 'redirects'), 'overridden');
  assert.equal(status(r, 'markers'), 'fail', 'build-breaking checks are never overridable');
  append('docs/guides/multi-factor.mdx', '\n<div onClick="go()">x</div>\n');
  assert.equal(status(await check({ override: 'on purpose' }), 'content-safety'), 'fail', 'content safety is never overridable');
  write('docs/guides/multi-factor.mdx', read('docs/guides/multi-factor.mdx').replace('\n<div onClick="go()">x</div>\n', ''));
  assert.equal(r.result, 'fail');
  assert.equal(r.override.reason, 'the page was renamed on purpose');
  write('docs/guides/multi-factor.mdx', read('docs/guides/multi-factor.mdx').replace('Use {edition.nope}.', ''));
  const ok = await check({ override: 'the page was renamed on purpose' });
  assert.equal(ok.result, 'pass', formatText(ok));
  assert.equal(ok.summary.overridden, findings(ok, 'redirects').length);
  reset();
});

test('lint only warns, and only on changed lines', async () => {
  reset();
  // A typo on an unchanged line of the base, and one on a new line.
  git('checkout', '-q', 'main');
  append(PAGE, '\nThis line has a speling mistake.\n');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qam', 'typo on main');
  git('checkout', '-q', 'change');
  git('reset', '-q', '--hard', 'main');
  append(PAGE, '\nAnother tpyo here.\n\n#### Skipped level\n\n```\nno language\n```\n\n[click here](../index.mdx)\n');
  const r = await check({ lint: true });
  assert.equal(r.result, 'pass');
  const words = findings(r, 'spelling').map((f) => f.message);
  assert.ok(words.some((m) => /"tpyo"/.test(m)), words.join('\n'));
  assert.ok(!words.some((m) => /"speling"/.test(m)), 'unchanged lines are not linted');
  const rules = findings(r, 'headings').map((f) => f.rule);
  for (const rule of ['heading-order', 'code-language', 'link-text']) assert.ok(rules.includes(rule), rules.join(', '));
  for (const id of ['spelling', 'headings']) assert.equal(status(r, id), 'warn');
  git('reset', '-q', '--hard', 'main');
  git('checkout', '-q', 'main');
  git('reset', '-q', '--hard', 'HEAD~1');
  git('checkout', '-q', 'change');
  git('reset', '-q', '--hard', 'main');
});

test('Vale: product-name rules are errors but do not block until promoted', { skip: !findVale() && 'Vale is not installed (set WSO2_DOCS_VALE)' }, async () => {
  reset();
  append(PAGE, '\nConfigure IS to log in to Asgardeo. WSO2 Identity Platform (formerly Asgardeo) is fine.\n');
  const r = await check({ lint: true });
  const vale = findings(r, 'vale');
  const byRule = (rule) => vale.filter((f) => f.rule === rule);
  assert.equal(byRule('WSO2.ProductNames')[0]?.level, 'error', JSON.stringify(vale));
  assert.equal(byRule('WSO2.RetiredNames').length, 1, 'only the bare retired name');
  assert.ok(byRule('WSO2.PreferredTerms').length >= 1);
  for (const f of vale) assert.match(f.link, /^https:\/\/docs\.wso2\.com\/contribute\/reference\//);
  assert.equal(r.result, 'pass', 'not blocking until cutover');
  reset();
});

test('the CLI: JSON for CI, exit 1 on a blocking failure, 0 otherwise', () => {
  reset();
  const run = () => spawnSync(process.execPath, [cli, 'check', repoDir, '--no-build', '--no-lint', '--routes', routesDir, '--format', 'json'], { encoding: 'utf8' });
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).result, 'pass');
  append(PAGE, '\nUse {edition.nope} here.\n');
  const bad = run();
  assert.equal(bad.status, 1);
  const report = JSON.parse(bad.stdout);
  assert.equal(report.schema, 1);
  assert.equal(report.summary.blocking, 1);
  assert.deepEqual(Object.keys(report.checks[0]).sort(), ['blocking', 'findings', 'id', 'link', 'note', 'overridable', 'status', 'title']);
  reset();
});

test('release mode runs only the blocking checks that do not depend on the change', async () => {
  reset();
  git('mv', PAGE, 'docs/guides/multi-factor.mdx');
  const r = await check({ release: true, edition: 'cloud' });
  for (const id of ['redirects', 'marker-versions', 'image-size', 'image-alt', 'vale', 'spelling', 'headings']) assert.equal(status(r, id), 'skipped', id);
  assert.equal(r.mode, 'release');
  reset();
});

test('new scaffolds a valid page of every type', async () => {
  reset();
  const repo = loadContentRepo(repoDir);
  const made = [];
  for (const type of ['quick-start', 'tutorial', 'how-to', 'concept', 'reference', 'release-notes']) {
    made.push(scaffoldPage(repo, { type, title: `A new ${type} page` }).file);
  }
  assert.deepEqual(made, [
    'docs/get-started/a-new-quick-start-page.mdx', 'docs/get-started/a-new-tutorial-page.mdx', 'docs/guides/a-new-how-to-page.mdx',
    'docs/concepts/a-new-concept-page.mdx', 'docs/reference/a-new-reference-page.mdx', 'docs/release-notes/a-new-release-notes-page.mdx',
  ]);
  assert.ok(fs.existsSync(file('docs/concepts/_category_.yml')), 'a new skeleton folder gets its _category_.yml');
  assert.throws(() => scaffoldPage(repo, { type: 'how-to', title: 'A new how-to page' }), /already exists/);
  assert.throws(() => scaffoldPage(repo, { type: 'faq', title: 'X' }), /Unknown page type/);
  assert.throws(() => scaffoldPage(repo, { type: 'how-to', title: 'X', folder: 'tutorials' }), /skeleton/);
  const r = await check({ lint: true });
  assert.equal(r.result, 'pass', formatText(r));
  assert.ok(findings(r, 'headings').some((f) => f.rule === 'template-text'), 'the template text is flagged until replaced');

  const out = spawnSync(process.execPath, [cli, 'new', 'how-to', repoDir, '--title', 'Rotate signing keys', '--description', 'Rotate the keys that sign tokens.', '--folder', 'guides/keys'], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Created docs\/guides\/keys\/rotate-signing-keys\.mdx/);
  assert.match(read('docs/guides/keys/rotate-signing-keys.mdx'), /^---\ntitle: Rotate signing keys\ndescription: Rotate the keys that sign tokens\.\ntype: how-to\n---/);
  reset();
});

test('routes follow Docusaurus: index pages, number prefixes and slugs', () => {
  assert.equal(routeFor('index.mdx'), '');
  assert.equal(routeFor('guides/index.mdx'), 'guides/');
  assert.equal(routeFor('guides/mfa/mfa.mdx'), 'guides/mfa/');
  assert.equal(routeFor('01-guides/02-mfa.mdx'), 'guides/mfa/');
  assert.equal(routeFor('guides/a.mdx', { slug: '/elsewhere/b' }), 'elsewhere/b/');
  assert.equal(routeFor('guides/a.mdx', { slug: 'b' }), 'guides/b/');
});

test('audience groups: declared top-level folders, each with the skeleton one level down', () => {
  const S = loadStandards();
  const dir = fs.mkdtempSync(path.join(tmp, 'audience-'));
  const page = (rel) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), '---\ntitle: X\ndescription: X page.\n---\n\nText.\n');
  };
  const manifest = {
    schemaVersion: 1, slug: 'engineering-platform', displayName: 'Engineering Platform Cloud', model: 'cloud-only', home: 'engineering-platform',
    owners: { team: 't' }, repo: 'wso2/docs-x', audienceGroups: ['developers', 'platform-engineers'],
  };
  assert.deepEqual(validate('docspace', manifest), []);
  assert.notDeepEqual(validate('docspace', { ...manifest, audienceGroups: ['Developers'] }), [], 'a group is a folder slug');
  assert.notDeepEqual(validate('docspace', { ...manifest, audienceGroups: ['guides', 'developers'] }), [], 'a skeleton folder is no group');
  fs.writeFileSync(path.join(dir, 'docspace.yaml'), JSON.stringify(manifest));
  page('docs/index.mdx');
  page('docs/developers/index.mdx');
  page('docs/developers/guides/deploy.mdx');
  page('docs/platform-engineers/concepts/data-planes.mdx');
  const ctx = () => ({ root: dir, repo: loadContentRepo(dir) });
  assert.deepEqual(checkSkeleton(ctx(), S), []);

  // The skeleton applies inside each group, and only groups sit at the top.
  page('docs/developers/tutorials/first.mdx');
  page('docs/guides/shared.mdx');
  page('docs/operators/guides/x.mdx');
  const found = checkSkeleton(ctx(), S).map((x) => x.file).sort();
  assert.deepEqual(found, ['docs/developers/tutorials', 'docs/guides', 'docs/operators']);

  // The page type defaults from the skeleton folder inside the group.
  const groups = manifest.audienceGroups;
  assert.equal(skeletonFolderOf('developers/guides/deploy.mdx', groups), 'guides');
  assert.equal(skeletonFolderOf('developers/index.mdx', groups), null);
  assert.equal(skeletonFolderOf('guides/deploy.mdx', []), 'guides');
  assert.equal(skeletonFolderOf('guides/deploy.mdx', undefined), 'guides');

  // new: the folder names the group; without one, it asks for it.
  const repo = loadContentRepo(dir);
  assert.equal(scaffoldPage(repo, { type: 'how-to', title: 'Scale a component', folder: 'developers/guides' }).file, 'docs/developers/guides/scale-a-component.mdx');
  assert.ok(fs.existsSync(path.join(dir, 'docs/developers/guides/_category_.yml')));
  assert.throws(() => scaffoldPage(repo, { type: 'how-to', title: 'Y' }), /audience group/);
  assert.throws(() => scaffoldPage(repo, { type: 'how-to', title: 'Y', folder: 'developers/tutorials' }), /skeleton/);
});
