// The converter's Docusaurus-source mode (Integrator on the proof, ticket 19):
// a Docusaurus site's docs/ (`next`) and versioned_docs/ (releases), with their
// sidebars, become a Doc space in the Platform layout. The mini fixture
// (fixtures/docusaurus-mini) is converted with the real Integrator config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { autogenerate, exportedLiteral, parseSidebarsSource, planDocusaurus, readDocs, readVersion } from '../migration/lib/docusaurus.mjs';
import { rewriteBody } from '../migration/lib/docusaurus-pages.mjs';
import { validate } from '../lib/schemas.mjs';
import integrator from '../migration/products/integrator.mjs';
import agentManager from '../migration/products/agent-manager.mjs';
import agentPlatform from '../migration/products/agent-platform.mjs';
import healthcare from '../migration/products/healthcare.mjs';
import { convertDocusaurus } from '../migration/lib/docusaurus-run.mjs';
import { editionForBranch } from '../lib/content-repo.mjs';
import icp from '../migration/products/integration-control-plane.mjs';
import connectors from '../migration/products/connectors.mjs';
import integrationPlatform from '../migration/products/integration-platform.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'fixtures', 'docusaurus-mini');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `wso2-${name}-`));
const shape = (items) => items.map((i) => (i.kind === 'category' ? { label: i.label, link: i.linkId, items: shape(i.items) } : i.kind === 'doc' ? i.id : `link:${i.href}`));

test('the Integrator config writes a valid Doc space manifest: 5.1.0 and 5.0.0 on prefixed branches, its Cloud a part of Integration Platform Cloud', () => {
  assert.deepEqual(validate('docspace', integrator.docspace), []);
  assert.deepEqual(integrator.docspace.editions, [{ id: '5.1.0', branch: 'integrator/release/5.1.0' }, { id: '5.0.0', branch: 'integrator/release/5.0.0' }]);
  assert.equal(integrator.docspace.home, 'integration-platform');
  assert.deepEqual(integrator.docspace.cloud, { in: 'integration-platform' });
  assert.equal(integrator.sourceVersion('cloud'), 'next', 'the Cloud part is the saas site\'s docs/');
  assert.equal(integrator.sourceVersion('5.1.0'), '5.1.0');
  assert.equal(integrator.legacyBase('cloud'), 'https://wso2.com/integration-platform/docs/saas/');
  assert.equal(integrator.legacyBase('5.1.0'), 'https://wso2.com/integration-platform/docs/integrator/', 'the legacy site serves its newest release at its root');
  assert.equal(integrator.legacyBase('next'), 'https://wso2.com/integration-platform/docs/integrator/next/');
  assert.equal(integrator.legacyBase('5.0.0'), 'https://wso2.com/integration-platform/docs/integrator/5.0.0/');
});

test('the Healthcare config: an unversioned Doc space from a Docusaurus site\'s docs/, on main only', () => {
  assert.deepEqual(validate('docspace', healthcare.docspace), []);
  assert.equal(healthcare.docspace.model, 'unversioned');
  assert.equal(healthcare.docspace.home, 'solutions');
  assert.equal(healthcare.docspace.editions, undefined, 'no release branches');
  assert.equal(editionForBranch(healthcare.docspace, 'main'), '_');
  assert.equal(healthcare.sourceVersion('_'), 'next', 'its one Edition is the site\'s docs/');
  assert.equal(healthcare.legacyBase('_'), 'https://healthcare.docs.wso2.com/docs/');
});

test('override patches apply to a Docusaurus source too: fixed on every run, stale ones reported', async () => {
  const work = tmp('docusaurus-overrides');
  const list = path.join(work, 'overrides.yaml');
  fs.writeFileSync(list, yaml.dump({
    patches: [
      { file: 'docs/get-started/sign-up.md', find: 'Create an account on WSO2 Cloud.', replace: 'Go to `<PRODUCT_HOME>/bin` and sign up.', why: 'a bare <PRODUCT_HOME> is text in MDX 1, a tag in MDX 3' },
      { file: 'docs/get-started/sign-up.md', find: 'no such text', replace: 'x', why: 'stale' },
    ],
  }));
  const outDir = path.join(work, 'integrator');
  const { summary, report } = await convertDocusaurus({ config: { ...integrator, overrides: list }, siteDir: site, outDir, edition: 'next', sourceRef: 'test@0', compile: false });
  assert.match(fs.readFileSync(path.join(outDir, 'docs', 'get-started', 'sign-up.mdx'), 'utf8'), /^Go to `<PRODUCT_HOME>\/bin` and sign up\.$/m);
  assert.deepEqual(summary.overrides, { file: 'overrides.yaml', patches: 2, patchesApplied: 1, accepted: 0 });
  assert.ok(report.items.some((i) => i.kind === 'override' && i.file === 'docs/get-started/sign-up.md' && /no longer applies/.test(i.message)));
  const plain = await convertDocusaurus({ config: { ...integrator, overrides: list }, siteDir: site, outDir, edition: 'next', sourceRef: 'test@0', compile: false, useOverrides: false });
  assert.match(fs.readFileSync(path.join(outDir, 'docs', 'get-started', 'sign-up.mdx'), 'utf8'), /^Create an account on WSO2 Cloud\.$/m, '--no-overrides leaves them out');
  assert.equal(plain.summary.overrides.patches, 0);
});

test('sidebars.ts is read without running it: its object literal, literals only', () => {
  assert.deepEqual(parseSidebarsSource(fs.readFileSync(path.join(site, 'sidebars.ts'), 'utf8')), { mainSidebar: [{ type: 'autogenerated', dirName: '.' }] });
  assert.deepEqual(parseSidebarsSource("module.exports = {\n  docs: ['a', {type: 'category', label: 'B', items: ['b/c']}], // a comment\n};\n"), { docs: ['a', { type: 'category', label: 'B', items: ['b/c'] }] });
  assert.equal(parseSidebarsSource("const s = { docs: require('./gen.js') };\nexport default s;\n"), null, 'a function call: not read');
  assert.equal(parseSidebarsSource('export default { docs: [...items] };'), null, 'a spread: not read');
  assert.equal(parseSidebarsSource('export default makeSidebars();'), null);
  // sidebarSpreads: 'drop' (Connectors): a spread in a list is left out and counted.
  const dropped = { n: 0 };
  assert.deepEqual(parseSidebarsSource("export default { docs: ['a', ...hidden('x'), 'b'] };", { spreads: 'drop', dropped }), { docs: ['a', 'b'] });
  assert.equal(dropped.n, 1);
  assert.equal(parseSidebarsSource("export default { docs: ['a', make()] };", { spreads: 'drop' }), null, 'a call that is not spread: still not read');
});

test('a module\'s exported literal is read without running it (a catalog\'s data module)', () => {
  const text = fs.readFileSync(path.join(root, 'fixtures', 'docusaurus-connectors-mini', 'src', 'data', 'connectors.ts'), 'utf8');
  assert.deepEqual(exportedLiteral(text, 'CATEGORIES'), ['Communication', 'CRM & Sales']);
  assert.equal(exportedLiteral(text, 'CONNECTORS').length, 3, 'its comments are not items');
  assert.equal(exportedLiteral(text, 'CONNECTORS')[0].link, 'crm-sales/salesforce/overview');
  assert.equal(exportedLiteral(text, 'VENDORS'), null, 'no such export');
  assert.equal(exportedLiteral('export const X = [fn()];', 'X'), null, 'code: not read');
});

test('docs: ids, legacy URLs (slug, id, index and same-name docs), partials apart', () => {
  const { docs, partials } = readDocs(path.join(site, 'docs'));
  const d = (id) => docs.get(id);
  assert.equal(d('overview/overview').url, 'overview', 'front matter id names the doc; its slug is the URL');
  assert.equal(d('get-started/get-started').isIndex, true, 'a doc named like its folder is the folder\'s index');
  assert.equal(d('get-started/quick-start').url, 'get-started/quickstarts/build-automation');
  assert.equal(d('get-started/sign-up').url, 'get-started/sign-up', 'no slug: the path');
  assert.equal(d('get-started/sign-up').title, 'Sign up', 'no title: the H1');
  assert.equal(d('develop/patterns/content-router').url, 'develop/patterns/content-router');
  assert.deepEqual(partials, ['develop/_foundations.md']);
});

test('an autogenerated sidebar is the folders, as Docusaurus orders them', () => {
  const { docs, categories } = readDocs(path.join(site, 'docs'));
  assert.deepEqual(shape(autogenerate(docs, categories)), [
    { label: 'Platform Overview', link: 'overview/overview', items: [] },
    { label: 'Get Started', link: 'get-started/get-started', items: ['get-started/sign-up', 'get-started/quick-start'] },
    // Positions first, then the rest by file name; `link: null` keeps no index.
    { label: 'Develop and Test', link: 'develop/develop', items: ['develop/concepts', { label: 'Integration Patterns', link: null, items: ['develop/patterns/content-router', 'develop/patterns/message-filter'] }] },
    { label: 'Integration Control Plane', link: null, items: ['icp/start'] },
  ]);
});

test('layout: the top level re-filed into the skeleton, categories as folders, the link doc as index, unlisted docs kept', () => {
  const next = readVersion(site, 'next', { sidebar: integrator.sidebar });
  assert.match(next.sidebarHow, /sidebars\.ts \(its object literal parsed, not run\)/);
  const plan = planDocusaurus({ tree: next.tree, docs: next.docs, config: integrator });
  const t = (id) => plan.pages.get(id)?.target;
  assert.equal(t('overview/overview'), 'index', 'Platform Overview is the Edition home');
  assert.equal(t('get-started/get-started'), 'get-started/index');
  assert.equal(t('get-started/quick-start'), 'get-started/quick-start');
  assert.equal(plan.pages.get('get-started/quick-start').position, 2);
  assert.equal(plan.pages.get('get-started/quick-start').sidebarLabel, 'Automation quick start');
  assert.equal(t('develop/develop'), 'guides/develop-and-test/index');
  assert.equal(t('develop/patterns/message-filter'), 'guides/develop-and-test/patterns/message-filter');
  assert.deepEqual(plan.categories.get('guides/develop-and-test'), { label: 'Develop and test', position: 1 });
  assert.deepEqual(plan.categories.get('guides/develop-and-test/patterns'), { label: 'Integration patterns', position: 2 });
  assert.deepEqual(plan.excluded, ['icp/start'], 'icp/ is another Doc space');

  const v1 = readVersion(site, '1.0.0', { sidebar: integrator.sidebar });
  assert.match(v1.sidebarHow, /version-1\.0\.0-sidebars\.json \(JSON\)/);
  const p1 = planDocusaurus({ tree: v1.tree, docs: v1.docs, config: integrator });
  assert.equal(p1.pages.get('get-started/introduction').target, 'index', 'the first category\'s link doc is the home');
  assert.equal(p1.pages.get('get-started/install').target, 'get-started/install');
  // A sidebar category whose docs share their parent's folder gets a folder of its own.
  assert.equal(p1.pages.get('develop/http-service').target, 'guides/develop/services/http-service');
  assert.equal(p1.pages.get('develop/http-service').sidebarLabel, 'HTTP service');
  assert.deepEqual({ ...p1.pages.get('develop/old-page'), navPath: undefined }, { id: 'develop/old-page', src: 'develop/old-page.md', target: 'guides/develop/old-page', url: 'guides/develop/old-page/', position: null, sidebarLabel: null, inSidebar: false, navPath: undefined });
  assert.deepEqual(p1.excluded, ['connectors/overview'], 'connectors/ is another Doc space');
});

// A context that records what the rewrite asked for.
function rw(body) {
  const counts = {};
  const items = [];
  const ctx = {
    link: (url) => {
      const [p, hash = ''] = url.split(/(?=#)/);
      if (p.startsWith('/')) return `../pages${p}.mdx${hash}`;
      if (p.startsWith('product://')) return `https://legacy/${p.slice(10)}${hash}`;
      return p === './gone.md' ? null : undefined;
    },
    image: (url) => (url.includes('missing') ? null : `../../assets${url.startsWith('/') ? url : `/pages/${url.replace(/^\.\//, '')}`}`),
    partial: (spec) => `../../partials/${spec.replace(/^\.\/_/, '').replace(/\.md$/, '.mdx')}`,
    site: (name, p) => `https://legacy/${name}/${p.replace(/^\//, '')}`,
    admonitions: integrator.admonitions,
    count: (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; },
    item: (kind, message) => items.push({ kind, message }),
  };
  return { ...rewriteBody(body, ctx), counts, items };
}
const bodyOf = (...p) => fs.readFileSync(path.join(site, ...p), 'utf8').replace(/^---[\s\S]*?---\n/, '');

test('rewrite: <ThemedImage sources={{ useBaseUrl() }}> becomes <ThemedImage light dark alt>, its imports dropped', () => {
  const r = rw(`import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Tabs from '@theme/Tabs';

# Build it {#build}

1. Click **Create**.

   <ThemedImage
      alt="The home screen"
      sources={{
         light: useBaseUrl('/img/a.png'),
         dark: useBaseUrl('/img/a-dark.png'),
      }}
   />

<ThemedImage alt="Missing" sources={{ light: useBaseUrl('/img/missing.png'), dark: useBaseUrl('/img/missing.png') }} />
`);
  assert.equal(r.h1, 'Build it', 'the H1 moves to front matter');
  assert.equal(r.body, `import Tabs from '@theme/Tabs';

1. Click **Create**.

   <ThemedImage light="../../assets/img/a.png" dark="../../assets/img/a-dark.png" alt="The home screen" />

*Image: Missing*
`);
  assert.equal(r.counts.ThemedImage, 1);
  assert.match(r.items[0].message, /light image \/img\/missing\.png is missing/);
});

test('rewrite: the site\'s own components map where a Platform feature fits, the rest is plain Markdown (Q75)', () => {
  const r = rw(bodyOf('docs', 'get-started', 'quick-start.md'));
  assert.match(r.body, /^\*\*Time:\*\* Under 10 minutes\n\n\*\*What you'll build:\*\* An automation that prints <code>Hello World<\/code> when it runs\.$/m);
  assert.match(r.body, /:::info\[Local setup\]\n\nInstall and launch WSO2 Integrator on your machine\. See \[Local setup\]\(\.\.\/pages\/get-started\.mdx\)\.\n\n:::/);
  assert.match(r.body, /:::info\[WSO2 Cloud account\]\n\nFor AI-assisted development\. See \[WSO2 Cloud account\]\(https:\/\/legacy\/saas\/get-started\/sign-up\)\./, 'cloud: the WSO2 Cloud docs');
  assert.doesNotMatch(r.body, /Prerequisites>|Steps>|QuickstartHeader|PrereqCard/);
  assert.match(r.body, /## Step 1: Create the integration \{#create\}/, 'heading ids stay');
  assert.match(r.body, /Deploy it from the \[Cloud console\]\(https:\/\/legacy\/saas\/manage\/integrations\)\./);
  assert.match(r.body, /\[HTTP connector\]\(https:\/\/legacy\/connectors\/catalog\/http\)/);
  assert.deepEqual(Object.keys(r.counts).sort(), ['CloudDocsLink', 'PrereqCard', 'Prerequisites', 'QuickstartHeader', 'Steps', 'ThemedImage']);

  const p = rw(bodyOf('docs', 'develop', 'patterns', 'message-filter.md'));
  assert.match(p.body, /^import Tabs from '@theme\/Tabs';\nimport TabItem from '@theme\/TabItem';\n\nUse a message filter/, 'PatternImplementationTabs needs Tabs; the site imports go');
  assert.match(p.body, /\[Message Filter reference\]\(https:\/\/www\.enterpriseintegrationpatterns\.com\/patterns\/messaging\/Filter\.html\)/);
  assert.match(p.body, /<Tabs>\n<TabItem value="ui" label="Visual Designer" default>[^]*<\/TabItem>\n<\/Tabs>/);
  assert.match(p.body, /!\[Message Filter flow\]\(\.\.\/\.\.\/assets\/img\/develop\/pattern\.png\)/);
  assert.doesNotMatch(p.body, /TabAwareToc|PatternImplementationTabs|EipReferenceLink|PatternImage/);
  assert.deepEqual(p.counts, { EipReferenceLink: 1, TabAwareToc: 1, PatternImage: 1, PatternImplementationTabs: 1 });
});

test('rewrite: Palette cards, chips and grids become headings, text and link lists', () => {
  const r = rw(bodyOf('docs', 'develop', 'develop.md'));
  assert.equal(r.body, `## [Integration patterns](../pages/develop/patterns/message-filter.mdx)

Proven designs such as the <code>Message Filter</code>.

## Connect to services

Add a connector from the palette.

- [Browse connectors](https://legacy/connectors/catalog)
- [Projects](../pages/develop/concepts.mdx#project)
`);
  assert.deepEqual(r.counts, { 'palette-card': 2, 'palette-chip': 2, 'palette-grid': 1 });
  const c = rw(bodyOf('docs', 'develop', 'concepts.mdx'));
  assert.equal(c.body, `import Foundations from '../../partials/foundations.mdx';

## Foundations

Concepts that apply at every phase.

- [Project](#project)

<Foundations />
`, 'a <div class="palette-card"> too; a partial import points at partials/');
  const s = rw(`## Build

<div class="palette-card--standalone">

<PaletteCard icon="ai" href="/editor/copilot">
  <h3 class="palette-card-title">Editor tour<span class="palette-card-badge">Prerequisite</span></h3>
  <ul class="palette-card-list">
    <li>Prompt <code>Copilot</code></li>
    <li>Iterate in chat</li>
  </ul>
</PaletteCard>

</div>
`);
  assert.equal(s.body, `## Build

<div class="palette-card--standalone">

### [Editor tour (Prerequisite)](../pages/editor/copilot.mdx)

- Prompt <code>Copilot</code>
- Iterate in chat

</div>
`, 'a wrapper class is not a card; card lists become Markdown lists, in order');
});

test('rewrite: links, admonitions and code stay safe', () => {
  const r = rw(`Text [gone](./gone.md) and [kept](https://example.com).

:::caution Careful
Back up first.
:::

\`\`\`md
:::caution not a directive
<ThemedImage sources={{light: useBaseUrl('/img/x.png')}} />
\`\`\`
`);
  assert.match(r.body, /^Text gone and \[kept\]\(https:\/\/example\.com\)\./, 'a link to no page: its text kept');
  assert.match(r.body, /:::warning\[Careful\]\nBack up first\.\n:::/, 'caution → warning, the title as the label');
  assert.match(r.body, /```md\n:::caution\[not a directive\]\n<ThemedImage sources=\{\{light: useBaseUrl\('\/img\/x\.png'\)\}\} \/>\n```/, 'code stays as written (Docusaurus labels admonition titles in code too)');
});

test('sync: main (the Cloud part) from the saas site docs/ and a release branch from versioned_docs/, compiled, safe and bundled', async () => {
  const work = tmp('docusaurus');
  const src = path.join(work, 'docs-integrator', 'en');
  fs.cpSync(site, src, { recursive: true });
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(path.dirname(src), 'init', '-q', '-b', 'wso2-integrator');
  git(path.dirname(src), 'add', '-A');
  git(path.dirname(src), 'commit', '-q', '-m', 'source');
  const repo = path.join(work, 'target');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  for (const b of ['main', 'integrator/release/1.0.0']) {
    // The checkout (the site at its sourceRoot, en/) or the site itself.
    const source = b === 'main' ? path.dirname(src) : src;
    execFileSync(process.execPath, [path.join(root, 'migration', 'sync.mjs'), 'integrator', '--source', source, '--repo', repo, '--branch', b, '--trailer', 'Co-Authored-By: Test <test@example.invalid>'], { encoding: 'utf8', env });
  }
  const show = (ref, f) => git(repo, 'show', `${ref}:${f}`);
  const files = (ref) => git(repo, 'ls-tree', '-r', '--name-only', ref).split('\n');

  const main = files('main');
  assert.deepEqual(main.filter((f) => f.startsWith('integrator/docs/') || f.startsWith('integrator/partials/') || f.startsWith('integrator/assets/')), [
    'integrator/assets/img/develop/pattern.png', 'integrator/assets/img/flow-dark.png', 'integrator/assets/img/flow-light.png',
    'integrator/docs/get-started/_category_.yml', 'integrator/docs/get-started/index.mdx', 'integrator/docs/get-started/quick-start.mdx', 'integrator/docs/get-started/sign-up.mdx',
    'integrator/docs/guides/_category_.yml', 'integrator/docs/guides/develop-and-test/_category_.yml', 'integrator/docs/guides/develop-and-test/concepts.mdx', 'integrator/docs/guides/develop-and-test/index.mdx',
    'integrator/docs/guides/develop-and-test/patterns/_category_.yml', 'integrator/docs/guides/develop-and-test/patterns/content-router.mdx', 'integrator/docs/guides/develop-and-test/patterns/message-filter.mdx',
    'integrator/docs/index.mdx', 'integrator/partials/develop/foundations.mdx',
  ], 'only referenced images (Q76); icp/ left out (Q72)');
  assert.ok(main.includes('README.md') && main.includes('integrator/redirects.yaml') && main.includes('integrator/.migration/report.md'));
  assert.equal(show('main', 'integrator/docs/index.mdx'), `---
title: Platform overview
description: What WSO2 Integrator is and how its parts fit together.
type: concept
---

WSO2 Integrator builds integrations, AI agents and APIs. Start with the [quick start](./get-started/quick-start.mdx).`);
  const qs = show('main', 'integrator/docs/get-started/quick-start.mdx');
  assert.match(qs, /^---\ntitle: Build an automation\ndescription: Build an automation that prints Hello World when it runs\.\ntype: quick-start\nsidebar_label: Automation quick start\nsidebar_position: 2\nkeywords:\n {2}- automation\n {2}- quick start\n---\n/);
  assert.match(qs, /<ThemedImage light="\.\.\/\.\.\/assets\/img\/flow-light\.png" dark="\.\.\/\.\.\/assets\/img\/flow-dark\.png" alt="The home screen with the Create card" \/>/);
  assert.match(qs, /\[patterns\]\(\.\.\/guides\/develop-and-test\/patterns\/message-filter\.mdx#how-it-works\)/);
  assert.match(qs, /\[control plane\]\(https:\/\/wso2\.com\/integration-platform\/docs\/saas\/icp\/start\)/, 'icp/ is on the legacy site');
  assert.match(qs, /\[HTTP connector\]\(https:\/\/wso2\.com\/integration-platform\/docs\/connectors\/catalog\/http\)/);
  assert.match(qs, /\[Cloud console\]\(https:\/\/wso2\.com\/integration-platform\/docs\/saas\/manage\/integrations\)/);
  const router = show('main', 'integrator/docs/guides/develop-and-test/patterns/content-router.mdx');
  assert.match(router, /\{\/\* TODO: compare with the Cloud docs \*\/\}\nDeploy it on \[WSO2 Cloud\]\(https:\/\/wso2\.com\/integration-platform\/docs\/saas\/deploy\)\./, 'an HTML comment becomes an MDX one; a path on the legacy host stays there');
  assert.match(show('main', 'integrator/docs/guides/develop-and-test/concepts.mdx'), /^import Foundations from '\.\.\/\.\.\/\.\.\/partials\/develop\/foundations\.mdx';$/m);
  assert.match(show('main', 'integrator/partials/develop/foundations.mdx'), /\[quick start\]\(\.\.\/\.\.\/docs\/get-started\/quick-start\.mdx\)[^]*!\[Pattern overview\]\(\.\.\/\.\.\/assets\/img\/develop\/pattern\.png\)/, 'a partial links from where it now is');
  assert.deepEqual(yaml.load(show('main', 'integrator/docs/guides/develop-and-test/_category_.yml')), { label: 'Develop and test', position: 1 });
  const map = new Map(yaml.load(show('main', 'integrator/redirects.yaml')).legacy.map((l) => [l.from, l.to]));
  const NEXT = 'https://wso2.com/integration-platform/docs/saas/'; // the Cloud docs' legacy site
  assert.equal(map.get(`${NEXT}get-started/quickstarts/build-automation`), 'get-started/quick-start');
  assert.equal(map.get(`${NEXT}overview`), '');
  assert.equal(map.get(`${NEXT}develop`), 'guides/develop-and-test');
  assert.deepEqual(yaml.load(show('main', 'integrator/docspace.yaml')), integrator.docspace);
  const report = JSON.parse(show('main', 'integrator/.migration/report.json')).summary;
  assert.equal(report.compileFailures, 0);
  assert.equal(report.contentSafetyFindings, 0);
  assert.equal(report.stats.images, 3);
  assert.equal(report.stats.excludedPages, 1);
  assert.deepEqual(report.stats.components, {
    ThemedImage: 1, QuickstartHeader: 1, PrereqCard: 2, Prerequisites: 1, Steps: 1, CloudDocsLink: 1,
    PaletteIcon: 1, 'palette-card': 3, 'palette-chip': 3, 'palette-grid': 1, 'HTML comment': 1,
    EipReferenceLink: 1, TabAwareToc: 1, PatternImage: 1, PatternImplementationTabs: 1,
  });
  assert.match(show('main', 'integrator/.migration/report.md'), /\| Sidebar read from \| sidebars\.ts \(its object literal parsed, not run\) \|/);
  assert.match(git(repo, 'log', '-1', '--format=%B', 'main'), /^Convert Integrator cloud from wso2\/docs-integrator@[0-9a-f]{40}\n[^]*Co-Authored-By: Test <test@example\.invalid>$/);

  // The release branch: cut from main, only integrator/ changed.
  const rel = files('integrator/release/1.0.0');
  assert.ok(rel.includes('integrator/docs/guides/develop/services/http-service.mdx') && rel.includes('integrator/docs/index.mdx'));
  assert.ok(!rel.some((f) => /connectors|quick-start|patterns/.test(f)), 'its own pages only');
  assert.match(show('integrator/release/1.0.0', 'integrator/docs/guides/develop/old-page.mdx'), /^unlisted: true$/m, 'a page in no sidebar is unlisted');
  assert.match(show('integrator/release/1.0.0', 'integrator/docs/index.mdx'), /\[connectors\]\(https:\/\/wso2\.com\/integration-platform\/docs\/integrator\/1\.0\.0\/connectors\/overview\)/);
  assert.equal(new Map(yaml.load(show('integrator/release/1.0.0', 'integrator/redirects.yaml')).legacy.map((l) => [l.from, l.to])).get('https://wso2.com/integration-platform/docs/integrator/1.0.0/develop/http-service'), 'guides/develop/services/http-service');

  // The release branch (checked out by the last run) bundles: every Platform
  // check passes on it.
  assert.equal(git(repo, 'branch', '--show-current'), 'integrator/release/1.0.0');
  const out = execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'bundle', path.join(repo, 'integrator'), '--tag', 'integrator/1.0.0-docs.1', '--dry-run'], { encoding: 'utf8', env });
  assert.match(out, /dry run/i);
});

// ---- Agent Manager and Agent Platform Cloud (wso2/docs-agent-platform) ----------------
// One docs plugin: version-cloud (the Cloud part, on main), version-v1.0.0
// (agent-manager/release/1.0.0), docs/ (Next, unreleased: not converted).
const ampSite = path.join(root, 'fixtures', 'docusaurus-amp-mini');

test('the Agent Manager and Agent Platform configs: a product whose Cloud is a part of the family Cloud', () => {
  assert.deepEqual(validate('docspace', agentManager.docspace), []);
  assert.deepEqual(validate('docspace', agentPlatform.docspace), []);
  assert.deepEqual(agentManager.docspace.cloud, { in: 'agent-platform' });
  assert.deepEqual(agentManager.docspace.editions, [{ id: '1.0.0', branch: 'agent-manager/release/1.0.0' }]);
  assert.deepEqual(agentPlatform.docspace.editions, [{ id: 'cloud', parts: ['agent-manager'] }]);
  assert.equal(agentManager.sourceVersion('1.0.0'), 'v1.0.0', 'the site\'s version folders carry a v');
  assert.equal(agentManager.sourceVersion('cloud'), 'cloud');
  assert.equal(agentManager.legacyBase('cloud'), 'https://wso2.com/agent-platform/docs/cloud/');
  assert.equal(agentManager.legacyBase('1.0.0'), 'https://wso2.com/agent-platform/docs/v1.0.0/');
});

test('layout: with no category link, the first category\'s first page is the Edition home (home: first-doc)', () => {
  const cloud = readVersion(ampSite, 'cloud', { sidebar: agentManager.sidebar });
  const plan = planDocusaurus({ tree: cloud.tree, docs: cloud.docs, config: agentManager });
  const t = (p, id) => p.pages.get(id)?.target;
  assert.equal(t(plan, 'get-started/what-is-amp'), 'index');
  assert.equal(t(plan, 'concepts/project'), 'concepts/project');
  assert.equal(t(plan, 'guides/register-mcp-proxy'), 'guides/platform-administration/register-mcp-proxy');
  assert.equal(plan.pages.get('guides/register-mcp-proxy').sidebarLabel, 'MCP proxies');

  const v1 = readVersion(ampSite, 'v1.0.0', { sidebar: agentManager.sidebar });
  const p1 = planDocusaurus({ tree: v1.tree, docs: v1.docs, config: agentManager });
  assert.equal(t(p1, 'get-started/what-is-amp'), 'index');
  assert.equal(t(p1, 'get-started/quick-start'), 'get-started/quick-start');
  assert.equal(p1.pages.get('get-started/quick-start').position, 1, 'the rest of the category keeps its order');
  assert.equal(t(p1, 'contributing'), 'reference/contributing');
});

test('rewrite: a Mermaid diagram stays a code block, counted and listed as a fallback', () => {
  const r = rw('Text.\n\n```mermaid\ngraph LR\n  A --> B\n```\n');
  assert.match(r.body, /```mermaid\ngraph LR\n {2}A --> B\n```/);
  assert.equal(r.counts['mermaid (shown as code)'], 1);
  assert.match(r.items.find((i) => i.kind === 'fallback').message, /Mermaid diagram is shown as its code/);
});

test('sync: Agent Manager\'s Cloud part on main from version-cloud, 1.0.0 from version-v1.0.0, and the family Cloud overview', () => {
  const work = tmp('docusaurus-amp');
  const src = path.join(work, 'docs-agent-platform');
  fs.cpSync(ampSite, src, { recursive: true });
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(src, 'init', '-q', '-b', 'main');
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', 'source');
  const repo = path.join(work, 'target');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  const sync = (product, branch) => execFileSync(process.execPath, [path.join(root, 'migration', 'sync.mjs'), product, '--source', src, '--repo', repo, '--branch', branch], { encoding: 'utf8', env });
  sync('agent-manager', 'main');
  sync('agent-platform', 'main');
  sync('agent-manager', 'agent-manager/release/1.0.0');
  const show = (ref, f) => git(repo, 'show', `${ref}:${f}`);
  const files = (ref, dir) => git(repo, 'ls-tree', '-r', '--name-only', ref).split('\n').filter((f) => f.startsWith(dir));

  assert.deepEqual(files('main', 'agent-manager/docs/').concat(files('main', 'agent-manager/assets/')), [
    'agent-manager/docs/concepts/_category_.yml', 'agent-manager/docs/concepts/project.mdx', 'agent-manager/docs/guides/_category_.yml',
    'agent-manager/docs/guides/platform-administration/_category_.yml',
    'agent-manager/docs/guides/platform-administration/register-mcp-proxy.mdx', 'agent-manager/docs/index.mdx',
    'agent-manager/assets/pages/img/project.png',
  ], 'the Cloud pages only (not Next), and only the referenced images');
  assert.equal(show('main', 'agent-manager/docs/index.mdx'), `---
title: WSO2 Agent Manager
description: An open control plane for AI agents.
type: concept
---

An open control plane for AI agents. Start with [projects](./concepts/project.mdx).`);
  const project = show('main', 'agent-manager/docs/concepts/project.mdx');
  assert.match(project, /\[MCP proxies\]\(\.\.\/guides\/platform-administration\/register-mcp-proxy\.mdx#register\)/);
  assert.match(project, /!\[Project view\]\(\.\.\/\.\.\/assets\/pages\/img\/project\.png\)/);
  assert.match(project, /^:::warning$/m);
  const map = new Map(yaml.load(show('main', 'agent-manager/redirects.yaml')).legacy.map((l) => [l.from, l.to]));
  assert.equal(map.get('https://wso2.com/agent-platform/docs/cloud/get-started/what-is-amp'), '');
  assert.equal(map.get('https://wso2.com/agent-platform/docs/cloud/guides/register-mcp-proxy'), 'guides/platform-administration/register-mcp-proxy');
  const report = JSON.parse(show('main', 'agent-manager/.migration/report.json')).summary;
  assert.equal(report.compileFailures, 0);
  assert.equal(report.contentSafetyFindings, 0);
  assert.equal(report.stats.components['mermaid (shown as code)'], 1);

  // The family Cloud: an overview with one product card per part.
  const overview = show('main', 'agent-platform/docs/index.mdx');
  assert.match(overview, /^title: Agent Platform Cloud$/m);
  assert.match(overview, /^layout: overview$/m);
  assert.match(overview, /\[Agent Manager Cloud\]\(docs:agent-manager\/cloud\/\)/);
  assert.match(overview, /\[Agent Manager Self-hosted \(newest release\)\]\(docs:agent-manager\/latest\/\)/);
  assert.deepEqual(yaml.load(show('main', 'agent-platform/docspace.yaml')), agentPlatform.docspace);

  // The release branch: version-v1.0.0, the top-level Contributing page, and
  // a partial that takes props, inlined into each page that uses it.
  assert.deepEqual(files('agent-manager/release/1.0.0', 'agent-manager/docs/').filter((f) => f.endsWith('.mdx')), [
    'agent-manager/docs/concepts/project.mdx', 'agent-manager/docs/get-started/quick-start.mdx', 'agent-manager/docs/guides/installation/on-k3d.mdx',
    'agent-manager/docs/guides/installation/on-your-environment.mdx', 'agent-manager/docs/index.mdx', 'agent-manager/docs/reference/contributing.mdx',
  ]);
  assert.deepEqual(files('agent-manager/release/1.0.0', 'agent-manager/partials/'), [], 'a partial with props has no file of its own');
  const k3d = show('agent-manager/release/1.0.0', 'agent-manager/docs/guides/installation/on-k3d.mdx');
  assert.equal(k3d, `---
title: On k3d
description: Install OpenChoreo first.
type: how-to
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

Install OpenChoreo first.

{/* Shared partial. Props expected from parent:
       - props.production — (boolean, optional) the production variants
       - props.expandRegistryConfig — (boolean, optional) registry config expanded
*/}

Run the installer, then open the [console](../../index.mdx).

![Installer](../../../assets/pages/img/project.png)

<Tabs groupId="distribution">
<TabItem value="community" label="Community" default>

The community images are public.

</TabItem>
</Tabs>

\`\`\`bash
helm install amp --set debug=true
\`\`\`

<details>
<summary>Container registry configuration</summary>

Override the registry settings:

\`\`\`bash
helm install amp-platform-resources \\
  --version \${VERSION}
\`\`\`

<table>
  <thead><tr><th>Value</th><th>Default</th></tr></thead>
  <tbody>
    <tr><td><code>global.baseDomain</code></td><td><code>""</code></td></tr>
  </tbody>
</table>

</details>
`.replace(/\n$/, ''));
  const env1 = show('agent-manager/release/1.0.0', 'agent-manager/docs/guides/installation/on-your-environment.mdx');
  assert.match(env1, /^import Tabs from '@theme\/Tabs';\nimport TabItem from '@theme\/TabItem';\n/m, 'the partial\'s imports move to the page');
  assert.match(env1, /--set replicas=3/);
  assert.doesNotMatch(env1, /debug=true|<details>|\{props\./);
  assert.match(env1, /^##### Container registry configuration\n\nOverride the registry settings:/m);
  const relReport = JSON.parse(show('agent-manager/release/1.0.0', 'agent-manager/.migration/report.json')).summary;
  assert.equal(relReport.contentSafetyFindings, 0);
  assert.equal(relReport.compileFailures, 0);
  assert.equal(relReport.stats.components['partial with props (inlined)'], 2);
  const relMap = new Map(yaml.load(show('agent-manager/release/1.0.0', 'agent-manager/redirects.yaml')).legacy.map((l) => [l.from, l.to]));
  assert.equal(relMap.get('https://wso2.com/agent-platform/docs/v1.0.0/get-started/quick-start'), 'get-started/quick-start');

  // Both Editions bundle: every Platform check passes.
  assert.match(execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'bundle', path.join(repo, 'agent-manager'), '--tag', 'agent-manager/1.0.0-docs.1', '--dry-run'], { encoding: 'utf8', env }), /dry run/i);
  git(repo, 'checkout', '-q', 'main');
  assert.match(execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'bundle', repo, '--tag', 'agent-platform/cloud-2026.10.29.1', '--dry-run'], { encoding: 'utf8', env }), /dry run/i);
});

// ---- Integration Control Plane, Connectors and Integration Platform Cloud ------------
// The rest of wso2/docs-integrator: ICP is icp/ of the Integrator site
// (docusaurus-icp-mini), Connectors its own site whose docs plugin reads
// docs/connectors/ (docusaurus-connectors-mini), and Integration Platform
// Cloud the family overview over Integrator's Cloud part.
const icpSite = path.join(root, 'fixtures', 'docusaurus-icp-mini');
const connectorsSite = path.join(root, 'fixtures', 'docusaurus-connectors-mini');

test('the ICP, Connectors and Integration Platform Cloud configs write valid Doc space manifests', () => {
  for (const c of [icp, connectors, integrationPlatform]) assert.deepEqual(validate('docspace', c.docspace), [], c.slug);
  assert.deepEqual(icp.docspace.editions, [{ id: '2.1.0', branch: 'integration-control-plane/release/2.1.0' }]);
  assert.equal(icp.docspace.cloud, undefined, 'ICP has no Cloud');
  assert.equal(icp.sourceVersion('2.1.0'), '5.1.0', 'ICP 2.1.0 is icp/ of Integrator 5.1.0');
  assert.equal(icp.sourceVersion('next'), 'next');
  assert.equal(icp.legacyBase('2.1.0'), 'https://wso2.com/integration-platform/docs/integrator/');
  assert.equal(icp.legacyBase('next'), 'https://wso2.com/integration-platform/docs/integrator/next/');
  assert.equal(connectors.docspace.model, 'unversioned');
  assert.equal(connectors.docspace.cloud, undefined, 'an unversioned Doc space is not a Cloud part (spec/open-items.md)');
  assert.equal(connectors.legacyBase('_'), 'https://wso2.com/integration-platform/docs/connectors/');
  assert.deepEqual(integrationPlatform.docspace.editions, [{ id: 'cloud', parts: ['integrator'] }]);
  assert.deepEqual(integrationPlatform.docspace.formerNames, ['Devant']);
  assert.equal(integrationPlatform.docspace.brand, 'WSO2 Cloud');
  for (const c of [icp, connectors, integrationPlatform, integrator]) {
    assert.equal(c.docspace.repo, 'wso2/docs-integrator');
    assert.equal(c.docspace.home, 'integration-platform');
  }
});

test('layout: a Doc space carved out of another\'s site reads only its folder (only, sidebarItems), re-filed into the skeleton', () => {
  const next = readVersion(icpSite, 'next', { items: icp.sidebarItems });
  assert.match(next.sidebarHow, /sidebarItems/);
  const plan = planDocusaurus({ tree: next.tree, docs: next.docs, config: icp });
  const t = (id) => plan.pages.get(id)?.target;
  assert.equal(t('icp/index'), 'index', 'the overview is the Edition home');
  assert.equal(t('icp/quick-start'), 'get-started/quick-start');
  assert.equal(t('icp/user-stores/ldap-user-store'), 'guides/user-stores/ldap-user-store');
  assert.equal(t('icp/management-api'), 'reference/management-api');
  assert.equal(t('get-started/get-started'), undefined, 'Integrator\'s own pages are left out, not unlisted');
  assert.deepEqual(plan.excluded, ['get-started/get-started']);
  assert.deepEqual(plan.categories.get('guides/user-stores'), { label: 'User stores', position: 1 });
});

test('layout: Connectors reads docs/connectors/, leaves the sidebar\'s spreads out and keeps the hidden pages unlisted', () => {
  const v = readVersion(connectorsSite, 'next', { sidebar: connectors.sidebar, docsPath: connectors.docsPath, spreads: connectors.sidebarSpreads });
  assert.match(v.sidebarHow, /sidebars\.ts \(its object literal parsed, not run; 1 spreads left out\)/);
  assert.match(v.issues[0].message, /1 spreads in the sidebar/);
  const plan = planDocusaurus({ tree: v.tree, docs: v.docs, config: connectors });
  const p = (id) => plan.pages.get(id);
  assert.equal(p('catalog/index').target, 'reference/catalog/index', 'the Connector Catalog, its data file beside it (only index files sit directly under docs/)');
  assert.equal(p('catalog/crm-sales/salesforce/overview').target, 'reference/catalog/salesforce/index');
  assert.equal(p('catalog/crm-sales/salesforce/setup-guide').target, 'reference/catalog/salesforce/setup-guide');
  assert.equal(p('overview').target, 'index', 'the Overview is the Edition home');
  assert.equal(p('reference/faq').target, 'reference/faq');
  assert.deepEqual([p('catalog/communication/twilio/4.0.x/actions').target, p('catalog/communication/twilio/4.0.x/actions').inSidebar], ['reference/catalog/twilio/4.0.x/actions', false]);
});

test('rewrite: a catalog component goes (the page takes the catalog layout); ConnectorHeader becomes its description and facts', () => {
  const r = rw('Intro.\n\n<ConnectorCatalog categories={CATEGORIES} connectors={CONNECTORS} />\n');
  assert.match(r.body, /<ConnectorCatalog/, 'a catalog only where the config names it');
  const used = [];
  const counts = {};
  const out = rewriteBody('Intro.\n\n<ConnectorCatalog categories={CATEGORIES} connectors={CONNECTORS} />\n\nAfter.\n', {
    link: () => undefined, image: () => null, partial: () => null, site: () => '', item: () => {},
    count: (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; },
    catalog: (name) => (name === 'ConnectorCatalog' ? (used.push(name), true) : false),
  });
  assert.equal(out.body, 'Intro.\n\nAfter.\n');
  assert.deepEqual(used, ['ConnectorCatalog']);
  assert.equal(counts['ConnectorCatalog (catalog layout)'], 1);
  const h = rw('<ConnectorHeader\n  name="Alfresco"\n  version="2.0.2"\n  vendor="Alfresco"\n  category="Storage & Files"\n  description="Content management"\n  packageName="ballerinax/alfresco"\n/>\n\nSet it up.\n');
  assert.equal(h.body, 'Content management\n\n**Version:** 2.0.2 · **Package:** `ballerinax/alfresco` · **Vendor:** Alfresco · **Category:** Storage & Files\n\nSet it up.\n');
  assert.equal(h.counts.ConnectorHeader, 1);
});

test('sync: Integrator\'s Cloud part, Integration Platform Cloud, Connectors and ICP on main; ICP 2.1.0 on its release branch; each bundles', () => {
  const work = tmp('docusaurus-integration');
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // Three source checkouts, as the branches are: saas (the Integrator Cloud
  // site), wso2-integrator (with icp/) and wso2-connectors.
  const checkout = (from, name) => {
    const dir = path.join(work, name);
    fs.cpSync(from, path.join(dir, 'en'), { recursive: true });
    git(dir, 'init', '-q', '-b', name);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'source');
    return dir;
  };
  const saas = checkout(site, 'saas');
  const integratorSite = checkout(icpSite, 'wso2-integrator');
  const connectorsSrc = checkout(connectorsSite, 'wso2-connectors');
  const repo = path.join(work, 'target');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  const sync = (product, source, branch) => execFileSync(process.execPath, [path.join(root, 'migration', 'sync.mjs'), product, '--source', source, '--repo', repo, '--branch', branch], { encoding: 'utf8', env });
  sync('integrator', saas, 'main');
  sync('integration-platform', saas, 'main');
  sync('connectors', connectorsSrc, 'main');
  sync('integration-control-plane', integratorSite, 'main');
  sync('integration-control-plane', integratorSite, 'integration-control-plane/release/2.1.0');
  const show = (ref, f) => git(repo, 'show', `${ref}:${f}`);
  const files = (ref, dir) => git(repo, 'ls-tree', '-r', '--name-only', ref).split('\n').filter((f) => f.startsWith(dir));
  const subjects = git(repo, 'log', '--format=%s', 'main').split('\n').map((s) => s.replace(/@[0-9a-f]{40}$/, '@…'));
  assert.deepEqual(subjects, [
    'Convert Integration Control Plane next from wso2/docs-integrator@…',
    'Convert Connectors from wso2/docs-integrator@…',
    'Convert Integration Platform Cloud from wso2/docs-integrator@…',
    'Convert Integrator cloud from wso2/docs-integrator@…',
  ]);

  // Integrator's main line is its Cloud part; the family Cloud lists it.
  assert.deepEqual(yaml.load(show('main', 'integrator/docspace.yaml')).cloud, { in: 'integration-platform' });
  assert.deepEqual(yaml.load(show('main', 'integrator/editions.yaml')).cloud, { displayName: 'Integrator Cloud', productName: 'WSO2 Integrator' });
  const overview = show('main', 'integration-platform/docs/index.mdx');
  assert.match(overview, /^title: Integration Platform Cloud$/m);
  assert.match(overview, /^layout: overview$/m);
  assert.match(overview, /\[Integrator Cloud\]\(docs:integrator\/cloud\/\)/);
  assert.deepEqual(yaml.load(show('main', 'integration-platform/docspace.yaml')), integrationPlatform.docspace);

  // Connectors: the Overview home; the catalog over connectors.yaml at reference/catalog/, each connector's pages below it.
  assert.deepEqual(files('main', 'connectors/docs/').filter((f) => !f.endsWith('_category_.yml')), [
    'connectors/docs/guides/using-connectors.mdx', 'connectors/docs/index.mdx',
    'connectors/docs/reference/catalog/connectors.yaml', 'connectors/docs/reference/catalog/index.mdx',
    'connectors/docs/reference/catalog/salesforce/actions.mdx', 'connectors/docs/reference/catalog/salesforce/index.mdx', 'connectors/docs/reference/catalog/salesforce/setup-guide.mdx',
    'connectors/docs/reference/catalog/twilio/4.0.x/actions.mdx', 'connectors/docs/reference/catalog/twilio/actions.mdx', 'connectors/docs/reference/catalog/twilio/index.mdx',
    'connectors/docs/reference/faq.mdx',
  ]);
  const home = show('main', 'connectors/docs/reference/catalog/index.mdx');
  assert.match(home, /^layout: catalog\ndata: \.\/connectors\.yaml$/m);
  assert.doesNotMatch(home, /ConnectorCatalog|@site/);
  const data = yaml.load(show('main', 'connectors/docs/reference/catalog/connectors.yaml'));
  assert.deepEqual(validate('catalog', data), []);
  assert.deepEqual(data.items.map((i) => [i.id, i.href, i.category, i.tags]), [
    ['salesforce', './salesforce/index.mdx', 'crm-and-sales', ['Salesforce']],
    ['twilio', './twilio/index.mdx', 'communication', ['Twilio']],
  ], 'a connector whose page is gone is left out; logos on another host too');
  assert.match(show('main', 'connectors/docs/reference/catalog/salesforce/index.mdx'), /\[integration\]\(https:\/\/wso2\.com\/integration-platform\/docs\/integrator\/develop-and-test\/build-integrations\)/, 'links into Integrator go to the legacy site');
  assert.match(show('main', 'connectors/docs/reference/catalog/twilio/4.0.x/actions.mdx'), /^unlisted: true$/m);
  const using = show('main', 'connectors/docs/guides/using-connectors.mdx');
  assert.match(using, /\[what a connector is\]\(\.\.\/index\.mdx#what-a-connector-is\)/, 'an anchor the page has stays');
  assert.match(using, /\[its modules\]\(\.\.\/index\.mdx\)/, 'an anchor the page lacks goes; the link to the page stays');
  assert.match(show('main', 'connectors/.migration/report.md'), /link to \.\/overview\.md#modules: the page has no heading #modules; the link goes to the page/);
  const connMap = new Map(yaml.load(show('main', 'connectors/redirects.yaml')).legacy.map((l) => [l.from, l.to]));
  assert.equal(connMap.get('https://wso2.com/integration-platform/docs/connectors/catalog'), 'reference/catalog', 'the legacy catalog lands on the catalog');
  assert.equal(connMap.get('https://wso2.com/integration-platform/docs/connectors/catalog/crm-sales/salesforce/setup-guide'), 'reference/catalog/salesforce/setup-guide');
  const connReport = JSON.parse(show('main', 'connectors/.migration/report.json')).summary;
  assert.equal(connReport.compileFailures, 0);
  assert.equal(connReport.contentSafetyFindings, 0);
  assert.equal(connReport.stats.catalogItems, 2);

  // ICP: main is the next preview from docs/icp/; the release branch 5.1.0's icp/.
  assert.deepEqual(files('main', 'integration-control-plane/docs/').filter((f) => f.endsWith('.mdx')), [
    'integration-control-plane/docs/get-started/quick-start.mdx', 'integration-control-plane/docs/guides/user-stores/configure-user-stores.mdx',
    'integration-control-plane/docs/guides/user-stores/ldap-user-store.mdx', 'integration-control-plane/docs/index.mdx', 'integration-control-plane/docs/reference/management-api.mdx',
  ]);
  assert.match(show('main', 'integration-control-plane/docs/index.mdx'), /\[get started with Integrator\]\(https:\/\/wso2\.com\/integration-platform\/docs\/integrator\/next\/get-started\)/);
  assert.deepEqual(files('integration-control-plane/release/2.1.0', 'integration-control-plane/docs/').filter((f) => f.endsWith('.mdx')), [
    'integration-control-plane/docs/get-started/quick-start.mdx', 'integration-control-plane/docs/index.mdx',
  ]);
  assert.match(show('integration-control-plane/release/2.1.0', 'integration-control-plane/docs/index.mdx'), /ICP 2\.1\.0 supports/);
  const icpMap = new Map(yaml.load(show('integration-control-plane/release/2.1.0', 'integration-control-plane/redirects.yaml')).legacy.map((l) => [l.from, l.to]));
  assert.equal(icpMap.get('https://wso2.com/integration-platform/docs/integrator/icp/quick-start'), 'get-started/quick-start');
  assert.deepEqual(files('integration-control-plane/release/2.1.0', 'connectors/'), files('main', 'connectors/'), 'a release branch is a copy of main');

  // Each bundles: ICP 2.1.0 on its branch, Connectors (`_`) and the Cloud tree on main.
  const bundle = (dir, tag) => execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'bundle', path.join(repo, dir), '--tag', tag, '--dry-run'], { encoding: 'utf8', env });
  assert.match(bundle('integration-control-plane', 'integration-control-plane/2.1.0-docs.1'), /dry run/i);
  git(repo, 'checkout', '-q', 'main');
  assert.match(bundle('connectors', 'connectors/cloud-2026.10.29.1'), /dry run/i);
  assert.match(bundle('integration-platform', 'integration-platform/cloud-2026.10.29.1'), /dry run/i);
});
