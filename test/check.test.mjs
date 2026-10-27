// `wso2-docs check` and `wso2-docs new` on a git copy of the stub Content
// repo: each blocking check fails on a crafted bad change and passes on a
// good one; lint only warns, and only on changed lines; overrides apply to
// policy checks only; the CLI exits 1 on a blocking failure and 0 otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContentRepo } from '../lib/content.mjs';
import { runCheck, formatText, formatAnnotations } from '../lib/check/index.mjs';
import { findVale } from '../lib/check/lint.mjs';
import { scaffoldPage } from '../lib/scaffold.mjs';
import { routeFor } from '../lib/check/content.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'fixtures', 'stub-repo', 'identity-server');
const cli = path.join(root, 'bin', 'wso2-docs.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-docs-check-'));
const repoDir = path.join(tmp, 'repo');
const routesDir = path.join(tmp, 'routes');

const git = (...args) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
fs.cpSync(fixture, repoDir, { recursive: true });
git('init', '-q', '-b', 'main');
git('add', '-A');
git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'base');
git('checkout', '-q', '-b', 'change');

// Route lists of the deployments the stub links to.
fs.mkdirSync(path.join(routesDir, 'api-manager', 'latest', '_platform'), { recursive: true });
fs.writeFileSync(path.join(routesDir, 'api-manager', 'latest', '_platform', 'pages.json'), JSON.stringify([
  { path: '', title: 'Home' }, { path: 'guides/', title: 'Guides', anchors: ['publish-an-api'] },
]));

// A real 1x1 PNG, so Docusaurus can read its size.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const file = (rel) => path.join(repoDir, rel);
const read = (rel) => fs.readFileSync(file(rel), 'utf8');
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), text);
};
const append = (rel, text) => fs.appendFileSync(file(rel), text);
const reset = () => {
  git('reset', '-q', '--hard', 'HEAD');
  git('clean', '-qfd');
};

async function check(opts = {}) {
  return runCheck({ repo: loadContentRepo(repoDir), routes: routesDir, requireRoutes: true, build: false, lint: false, ...opts });
}
const status = (report, id) => report.checks.find((c) => c.id === id).status;
const findings = (report, id) => report.checks.find((c) => c.id === id).findings;

// One case per blocking check: [check id, bad change, good change].
const PAGE = 'docs/guides/mfa.mdx';
const CATALOG_PAGE = 'docs/reference/connectors/index.mdx';
const CATALOG = 'docs/reference/connectors/connectors.yaml';
const CASES = [
  ['compile', () => append(PAGE, '\nA bare <tag here.\n'), () => append(PAGE, '\nA bare `<tag>` here.\n')],
  ['markers', () => append(PAGE, '\nUse {edition.nope} here.\n'), () => append(PAGE, '\nUse {edition.productName} here.\n')],
  ['markers', () => append(PAGE, '\n<Edition only="cloudy">Text.</Edition>\n'), () => append(PAGE, '\n<Edition only="cloud">Text.</Edition>\n')],
  ['front-matter', () => write(PAGE, read(PAGE).replace(/^description: .*\n/m, '')), () => write(PAGE, read(PAGE).replace(/^description: .*\n/m, 'description: A shorter description.\n'))],
  ['front-matter', () => write(PAGE, read(PAGE).replace('type: how-to', 'type: how-to\nauthor: someone')), () => write(PAGE, read(PAGE).replace('type: how-to', 'type: how-to\nsidebar_label: MFA'))],
  ['front-matter', () => write(PAGE, read(PAGE).replace(/^description: .*$/m, `description: ${'A'.repeat(161)}`)), () => write(PAGE, read(PAGE).replace(/^description: .*$/m, `description: ${'A'.repeat(160)}`))],
  ['front-matter', () => write(PAGE, read(PAGE).replace('type: how-to', 'type: howto')), () => write(PAGE, read(PAGE).replace('type: how-to\n', ''))],
  ['skeleton', () => write('docs/tutorials/first.mdx', '---\ntitle: First\ndescription: A tutorial.\ntype: tutorial\n---\n\nText.\n'),
    () => write('docs/get-started/first.mdx', '---\ntitle: First\ndescription: A tutorial.\ntype: tutorial\n---\n\nText.\n')],
  ['redirects', () => git('mv', PAGE, 'docs/guides/multi-factor.mdx'), () => {
    git('mv', PAGE, 'docs/guides/multi-factor.mdx');
    write('redirects.yaml', read('redirects.yaml').replaceAll('to: guides/mfa\n', 'to: guides/multi-factor\n').replace('moves:\n', 'moves:\n  - from: guides/mfa\n    to: guides/multi-factor\n'));
    // The catalog's link to the page follows it too (the data-files check).
    write(CATALOG, read(CATALOG).replace('href: guides/mfa\n', 'href: guides/multi-factor\n'));
  }],
  ['redirects', () => write('redirects.yaml', read('redirects.yaml').replace('to: guides/mfa\n', 'to: guides/gone\n')), () => write('redirects.yaml', read('redirects.yaml').replace('to: guides/mfa\n', 'to: guides/cloud-billing\n'))],
  ['marker-versions', () => append(PAGE, '\n<Edition selfHostedFrom="7.2.0">Old news.</Edition>\n'), () => append(PAGE, '\n<Edition selfHostedFrom="7.4.0">Coming soon.</Edition>\n')],
  ['image-size', () => write('assets/img/big.png', Buffer.alloc(1100 * 1024, 1)), () => write('assets/img/small.png', Buffer.alloc(10 * 1024, 1))],
  ['image-alt', () => { write('assets/img/x.png', PNG); append(PAGE, '\n![](../../assets/img/x.png)\n'); },
    () => { write('assets/img/x.png', PNG); append(PAGE, '\n![The sign-in method editor with a TOTP step](../../assets/img/x.png)\n'); }],
  ['image-alt', () => append(PAGE, '\n<img src="/x.png" />\n'), () => append(PAGE, '\n<img src="/x.png" alt="The console home page" />\n')],
  ['docs-links', () => append(PAGE, '\nSee [publishing](docs:api-manager/latest/nope/).\n'), () => append(PAGE, '\nSee [publishing](docs:api-manager/latest/guides/#publish-an-api).\n')],
  ['docs-links', () => append(PAGE, '\nSee [publishing](docs:api-manager/latest/guides/#nope).\n'), () => append(PAGE, '\nSee [publishing](docs:api-manager/latest/guides/).\n')],
  ['docs-links', () => append(PAGE, '\nSee [x](docs:no-such-space/latest/guides/).\n'), () => append(PAGE, '\nSee [x](docs:api-manager/4.6.0/guides/).\n')],
  // Content safety: no code in content, build-breaking (never overridden).
  ['content-safety', () => append(PAGE, '\nexport const x = 1;\n'), () => append(PAGE, '\nThe export runs nightly.\n')],
  ['content-safety', () => append(PAGE, '\n<iframe src="https://example.com/embed/x" title="A video" />\n'), () => append(PAGE, '\n<iframe src="https://www.youtube-nocookie.com/embed/x" title="A video" />\n')],
  ['openapi', () => write('docs/reference/apis/applications/openapi.yaml', read('docs/reference/apis/applications/openapi.yaml').replace(/^info:/m, 'notinfo:')), () => {}],
  // Data files: a catalog's data file, and one known by its name.
  ['data-files', () => write(CATALOG, read(CATALOG).replace('href: guides/mfa\n', 'href: guides/nope\n')), () => write(CATALOG, read(CATALOG).replace('href: guides/mfa\n', 'href: get-started/quick-start\n'))],
  ['data-files', () => write(CATALOG, read(CATALOG).replace('    status: beta\n', '    status: preview\n')), () => write(CATALOG, read(CATALOG).replace('    status: beta\n', '    status: deprecated\n'))],
  ['data-files', () => write(CATALOG, read(CATALOG).replace('category: fraud-detection\n    status', 'category: crm\n    status')), () => {}],
  ['data-files', () => write(CATALOG_PAGE, read(CATALOG_PAGE).replace('data: ./connectors.yaml\n', '')), () => {}],
  ['data-files', () => write(CATALOG_PAGE, read(CATALOG_PAGE).replace('data: ./connectors.yaml', 'data: ./gone.yaml')), () => {}],
  ['data-files', () => write('docs/release-notes/release-notes.yaml', 'schemaVersion: 1\nreleases:\n  - version: 7.3.0\n    items: []\n'),
    () => write('docs/release-notes/release-notes.yaml', 'schemaVersion: 1\nreleases:\n  - version: 7.3.0\n    date: 2026-09-01\n    items: []\n')],
];

test('every blocking check fails on a bad change and passes on a good one', { timeout: 300_000 }, async (t) => {
  // docs:api-manager/4.6.0 needs its own route list for the last good case.
  fs.mkdirSync(path.join(routesDir, 'api-manager', '4.6.0'), { recursive: true });
  fs.writeFileSync(path.join(routesDir, 'api-manager', '4.6.0', 'pages.json'), JSON.stringify([{ path: 'guides/' }]));
  reset();
  const clean = await check();
  assert.equal(clean.result, 'pass', formatText(clean));
  assert.equal(clean.base.label, 'main');

  for (const [i, [id, bad, good]] of CASES.entries()) {
    await t.test(`${id} #${i}`, async () => {
      reset();
      bad();
      const b = await check();
      assert.equal(status(b, id), 'fail', `${id} should fail:\n${formatText(b)}`);
      assert.equal(b.result, 'fail');
      for (const f of findings(b, id)) assert.match(f.link, new RegExp(`/contribute/reference/checks/#${id}$`));
      reset();
      good();
      const g = await check();
      assert.equal(g.result, 'pass', `${id} good change should pass:\n${formatText(g)}`);
    });
  }
  reset();
});

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

test('Markdown twins: the Platform twin checks run on the build', { timeout: 600_000 }, async () => {
  reset();
  const build = path.join(tmp, 'build');
  const r = await check({ build: true, buildOut: build });
  assert.equal(status(r, 'twins'), 'pass', formatText(r));
  assert.match(r.checks.find((c) => c.id === 'twins').note, /^\d+ twins$/);
  const twin = path.join(build, 'guides', 'mfa.md');
  fs.appendFileSync(twin, '\n<Tabs>\n\nSee [gone](https://docs.wso2.com/identity-platform/cloud/identity-server/guides/gone/).\n');
  const bad = await check({ buildDir: build });
  assert.equal(status(bad, 'twins'), 'fail');
  const messages = findings(bad, 'twins').map((f) => f.message).join('\n');
  assert.match(messages, /leftover JSX/);
  assert.match(messages, /no such page/);
  reset();
});

test('the preview build fails on a broken link or anchor, with its file', { timeout: 600_000 }, async () => {
  reset();
  append('docs/get-started/quick-start.mdx', '\nSee [the factors](../guides/mfa.mdx#no-such-heading).\n');
  const r = await check({ build: true, edition: '7.3.0' });
  assert.equal(status(r, 'preview-build'), 'fail', formatText(r));
  const f = findings(r, 'preview-build')[0];
  assert.equal(f.file, 'docs/get-started/quick-start.mdx');
  assert.match(f.message, /#no-such-heading/);
  assert.match(formatAnnotations(r, 'content/'), /^::error file=content\/docs\/get-started\/quick-start\.mdx,line=1,title=Preview build::/m);
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
