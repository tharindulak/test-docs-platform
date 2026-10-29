// Several MkDocs sites of one product as one Doc space, one audience group
// each (migration/lib/sites.mjs; first Engineering Platform Cloud), on a tiny
// pair of sites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { convertProduct } from '../migration/lib/run.mjs';
import { siteResolver } from '../migration/lib/sites.mjs';
import apim from '../migration/products/api-manager.mjs';
import ep from '../migration/products/engineering-platform.mjs';
import { loadContentRepo } from '../lib/content.mjs';
import { checkSkeleton } from '../lib/check/source.mjs';
import { loadStandards } from '../lib/standards.mjs';
import { validate } from '../lib/schemas.mjs';

const LEGACY = 'https://wso2.com/engineering-platform/developer-platform/docs/';
const DEV = 'For developers';
const PE = 'For platform engineers';
const SITES = [
  { root: 'dev', folder: 'developers', label: DEV, legacyPath: '', legacyAliases: ['developer/'] },
  { root: 'pe', folder: 'platform-engineers', label: PE, legacyPath: 'platform-engineer/' },
];

test('sites: legacy paths map to the combined source and back', () => {
  const r = siteResolver({ sites: SITES });
  assert.equal(r.legacyUrlOf('developers/a/b.md'), 'a/b/');
  assert.equal(r.legacyUrlOf('developers/index.md'), '');
  assert.equal(r.legacyUrlOf('platform-engineers/a/index.md'), 'platform-engineer/a/');
  assert.equal(r.legacyUrlOf('index.md'), null, 'the combined home had no legacy page');
  assert.equal(r.srcPath('a/b'), 'developers/a/b');
  assert.equal(r.srcPath('developer/a/b'), 'developers/a/b');
  assert.equal(r.srcPath('platform-engineer/a'), 'platform-engineers/a');
  assert.equal(r.srcPath('platform-engineer'), 'platform-engineers');
  assert.equal(r.srcPath('platform-engineers/a.md'), 'platform-engineers/a.md');
  assert.equal(r.srcPath('assets/x.png', 'platform-engineers/a/b.md'), 'platform-engineers/assets/x.png', 'relative to the page\'s own site');
  assert.equal(r.assetPath('platform-engineers/assets/x.png'), 'assets/x.png');
});

test('sites: two MkDocs sites of one product become two audience groups, each with its own legacy base', async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-sites-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-sites-out-'));
  const w = (p, s) => {
    fs.mkdirSync(path.dirname(path.join(src, p)), { recursive: true });
    fs.writeFileSync(path.join(src, p), s);
  };
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const plugins = (maps) => ['plugins:', '  - search', '  - include-markdown', '  - markdownextradata: {}', '  - redirects:', '      redirect_maps:', ...maps, 'extra:', '  product_name: WSO2 Developer Platform', ''];
  w('dev/mkdocs.yml', ['site_name: Dev', 'nav:', '  - Home: index.md', '  - Introduction:', '    - What is it?: what-is.md', '  - Develop:', '    - Service: develop/service.md',
    '  - References:', '    - FAQ: references/faq.md', ...plugins(['        "rest-api.md": "https://wso2.com/choreo/docs/develop/service/"'])].join('\n'));
  w('dev/docs/index.md', '---\ntemplate: templates/home-page-2.html\n---\n');
  w('dev/docs/what-is.md', '# What is it?\n\n{{ product_name }} for developers. See [the service](develop/service.md), [data planes](https://wso2.com/choreo/docs/platform-engineer/infra/data-planes/) and [the old service page](https://wso2.com/choreo/docs/rest-api/).\n\n![The logo](assets/img/logo.png)\n');
  w('dev/docs/develop/service.md', '# Service\n\nRead the [FAQ](../../references/faq/).\n\n{% include "service-body.md" %}\n');
  w('dev/docs/develop/service-body.md', 'Deploy it from the Console.\n');
  w('dev/docs/references/faq.md', '# {{ product_name }} FAQ\n\nAnswers for developers.\n\n## Sign in to {{ product_name }}\n\nUse the Console.\n');
  w('dev/docs/assets/img/logo.png', PNG);
  w('pe/mkdocs.yml', ['site_name: PE', 'nav:', '  - Home: index.md', '  - Introduction:', '    - What is it?: what-is.md', '  - Infrastructure:', '    - Data Planes: infra/data-planes.md',
    ...plugins(['        "old.md": "https://wso2.com/choreo/docs/platform-engineer/infra/data-planes/"'])].join('\n'));
  w('pe/docs/index.md', '---\ntemplate: templates/pe-home-page.html\n---\n');
  w('pe/docs/what-is.md', '# What is it?\n\nFor platform engineers. See [data planes](infra/data-planes.md) and [the developer service](https://wso2.com/engineering-platform/developer-platform/docs/develop/service/).\n\n![The logo](assets/img/logo.png)\n');
  w('pe/docs/infra/data-planes.md', '# Data planes\n\nSet them up.\n\n![The logo](../assets/img/logo.png)\n');
  w('pe/docs/overview.md', 'PE view\n');
  w('pe/docs/assets/img/logo.png', PNG);
  const config = {
    ...apim,
    slug: 'eng', sourceRepo: 'wso2/docs-eng', legacyBase: () => LEGACY, legacyLinkBases: ['https://wso2.com/choreo/docs/'], legacyHosts: [],
    sites: [
      { ...SITES[0], homeCards: [{ section: [{ title: 'Start', list_items: [{ title: 'What is it', url: 'developers/what-is.md' }] }] }] },
      { ...SITES[1], homeCards: [{ section: [{ title: 'Start', list_items: [{ title: 'Data planes', url: 'platform-engineers/infra/data-planes.md' }] }] }] },
    ],
    docspace: {
      schemaVersion: 1, slug: 'eng', displayName: 'Engineering Platform Cloud', home: 'eng', owners: { team: 't' }, repo: 'wso2/docs-eng',
      audienceGroups: ['developers', 'platform-engineers'], editions: [{ id: 'cloud' }],
    },
    editions: { cloud: { displayName: 'Engineering Platform Cloud', productName: 'WSO2 Developer Platform' } },
    variables: { product_name: { edition: 'productName' } },
    topLevel: { Home: { page: 'index' }, [DEV]: { folder: 'developers' }, [PE]: { folder: 'platform-engineers' } },
    sectionFolders: {
      [`${DEV} > Introduction`]: 'developers/get-started', [`${DEV} > Develop`]: 'developers/guides/develop', [`${DEV} > References`]: 'developers/reference',
      [`${PE} > Introduction`]: 'platform-engineers/get-started', [`${PE} > Infrastructure`]: 'platform-engineers/guides/infrastructure',
    },
    pageOverrides: { 'developers/index.md': 'developers/index', 'platform-engineers/index.md': 'platform-engineers/index' },
    skeleton: [
      { folder: 'developers', label: DEV, position: 1 }, { folder: 'developers/get-started', label: 'Get started', position: 1 },
      { folder: 'developers/guides', label: 'Guides', position: 2 }, { folder: 'developers/reference', label: 'Reference', position: 4 },
      { folder: 'platform-engineers', label: PE, position: 2 }, { folder: 'platform-engineers/get-started', label: 'Get started', position: 1 },
      { folder: 'platform-engineers/guides', label: 'Guides', position: 2 },
    ],
    types: { 'developers/get-started': 'quick-start', 'developers/guides': 'how-to', 'developers/reference': 'reference', 'platform-engineers/get-started': 'quick-start', 'platform-engineers/guides': 'how-to' },
    typeOverrides: { index: 'concept', 'developers/index': 'concept', 'platform-engineers/index': 'concept' },
    placeholders: {}, overrides: null, redirectsPlugin: true,
    excluded: ['platform-engineers/overview.md', 'developers/develop/service-body.md'], redirectToHome: [],
    homeIntro: 'Choose your role.',
    homeCards: [{ section: [{ title: DEV, list_items: [{ title: 'Developers', url: 'developers/index.md' }] }, { title: PE, list_items: [{ title: 'Platform engineers', url: 'platform-engineers/index.md' }] }] }],
  };
  const { summary, report } = await convertProduct({ config, sourceRoot: src, outDir: out, edition: 'cloud', legacyVersion: null, sourceRef: 'wso2/docs-eng@test' });
  assert.equal(summary.compileFailures, 0, JSON.stringify(report.items.filter((i) => i.kind === 'compile')));
  const read = (p) => fs.readFileSync(path.join(out, p), 'utf8');

  // Each site is a group with the skeleton inside; same-path pages stay one per group.
  const devWhat = read('docs/developers/get-started/what-is.mdx');
  const peWhat = read('docs/platform-engineers/get-started/what-is.mdx');
  assert.match(devWhat, /\{edition\.productName\} for developers/);
  assert.doesNotMatch(devWhat, /<Edition/);
  assert.match(peWhat, /For platform engineers/);
  // Links: relative, by the older address, and across the groups.
  assert.match(devWhat, /\[the service\]\(\.\.\/guides\/develop\/service\.mdx\)/);
  assert.match(devWhat, /\[data planes\]\(\.\.\/\.\.\/platform-engineers\/guides\/infrastructure\/data-planes\.mdx\)/);
  assert.match(devWhat, /\[the old service page\]\(\.\.\/guides\/develop\/service\.mdx\)/, 'a link through the site\'s own redirect map');
  assert.match(peWhat, /\[data planes\]\(\.\.\/guides\/infrastructure\/data-planes\.mdx\)/);
  assert.match(peWhat, /\[the developer service\]\(\.\.\/\.\.\/developers\/guides\/develop\/service\.mdx\)/);
  assert.match(read('docs/developers/guides/develop/service.mdx'), /\[FAQ\]\(\.\.\/\.\.\/reference\/faq\.mdx\)/);
  // An Edition variable in a heading: the title and the heading's id read the
  // Edition's value, as the build renders it; the body keeps the variable.
  const faq = read('docs/developers/reference/faq.mdx');
  assert.match(faq, /^title: WSO2 Developer Platform FAQ$/m);
  assert.match(faq, /^## Sign in to \{edition\.productName\}$/m, 'no explicit id: the build\'s id is the legacy one');
  assert.doesNotMatch(faq, /\u0002/);
  // mkdocs-include-markdown-plugin: the file, relative to the page, inlined.
  assert.match(read('docs/developers/guides/develop/service.mdx'), /Deploy it from the Console\./);
  // One copy of an image both sites hold.
  assert.deepEqual(fs.readdirSync(path.join(out, 'assets/img')), ['logo.png']);
  assert.match(read('docs/platform-engineers/guides/infrastructure/data-planes.mdx'), /assets\/img\/logo\.png/);
  assert.ok(!fs.existsSync(path.join(out, 'docs/platform-engineers/overview.mdx')));

  // Homes: the Doc space's from the config's cards, each group's from its site's.
  const home = read('docs/index.mdx');
  assert.match(home, /^layout: overview$/m);
  assert.match(home, /^title: Engineering Platform Cloud$/m);
  assert.match(home, /- \[Developers\]\(\.\/developers\/index\.mdx\)/);
  const peHome = read('docs/platform-engineers/index.mdx');
  assert.match(peHome, /^title: For platform engineers$/m);
  assert.match(peHome, /^layout: overview$/m);
  assert.match(peHome, /- \[Data planes\]\(\.\/guides\/infrastructure\/data-planes\.mdx\)/);
  assert.equal(yaml.load(read('docs/developers/_category_.yml')).label, DEV);
  assert.equal(yaml.load(read('docs/platform-engineers/_category_.yml')).position, 2);
  assert.equal(yaml.load(read('docs/developers/guides/_category_.yml')).label, 'Guides');

  // Legacy URLs: each site's pages under its own place; the base's root opens the developer home.
  const legacy = new Map(yaml.load(read('redirects.yaml')).legacy.map((r) => [r.from, r.to]));
  assert.equal(legacy.get(LEGACY), 'developers');
  assert.equal(legacy.get(`${LEGACY}what-is/`), 'developers/get-started/what-is');
  assert.equal(legacy.get(`${LEGACY}platform-engineer/`), 'platform-engineers');
  assert.equal(legacy.get(`${LEGACY}platform-engineer/what-is/`), 'platform-engineers/get-started/what-is');
  assert.equal(legacy.get(`${LEGACY}rest-api/`), 'developers/guides/develop/service');
  assert.equal(legacy.get(`${LEGACY}platform-engineer/old/`), 'platform-engineers/guides/infrastructure/data-planes');

  // The output passes the skeleton check with its audience groups.
  assert.deepEqual(yaml.load(read('docspace.yaml')).audienceGroups, ['developers', 'platform-engineers']);
  assert.deepEqual(checkSkeleton({ root: out, repo: loadContentRepo(out) }, loadStandards()), []);
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});

test('Engineering Platform Cloud: a family Cloud with two audience groups', () => {
  assert.deepEqual(validate('docspace', ep.docspace), []);
  assert.deepEqual(ep.docspace.audienceGroups, ep.sites.map((s) => s.folder));
  assert.deepEqual(ep.docspace.editions, [{ id: 'cloud' }]);
  // Every skeleton folder the config files into sits inside a group.
  const S = loadStandards();
  const skeleton = new Set(S.skeleton.folders.map((f) => f.id));
  for (const folder of Object.values(ep.sectionFolders)) {
    const [group, top] = folder.split('/');
    assert.ok(ep.docspace.audienceGroups.includes(group) && skeleton.has(top), folder);
  }
});
