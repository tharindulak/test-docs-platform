// Extension points for product teams, in the Platform: the `layout` front
// matter (overview cards, catalogs fed by data files), data files and their
// schemas, team notices and section link entries as the chrome reads them
// from the published manifest, the component catalogue and the extension
// proposal form. The builds of both layouts are in test/build.test.mjs, the
// data-files check's failures in test/check.test.mjs and the compose rules in
// test/compose.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { catalogNodes, isCardBody, overview } from '../plugins/remark-layouts.mjs';
import remarkLayouts from '../plugins/remark-layouts.mjs';
import { DEFAULT_VARIANTS, LAYOUTS, layoutFrontMatter, layoutOf } from '../lib/layouts.mjs';
import { checkDataFile, loadDataFile, namedKind, resolveHref, shownIn } from '../lib/data-files.mjs';
import { editionFromId } from '../lib/edition.mjs';
import { productsMenu, sectionMenu, teamNotices } from '../lib/switching.mjs';
import { COMPONENT_FORMS } from '../lib/markdown-forms.mjs';
import { loadStandards } from '../lib/standards.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stub = path.join(root, 'fixtures', 'stub-repo', 'identity-server');
const md = (s) => unified().use(remarkParse).use(remarkGfm).parse(s);
const names = (nodes) => nodes.map((n) => (n.type === 'mdxJsxFlowElement' ? n.name : n.type === 'heading' ? `h${n.depth}` : n.type));

// --- layout front matter --------------------------------------------------------

test('layouts: the fixed Platform list, in the front-matter standard and the component catalogue', () => {
  assert.deepEqual(LAYOUTS, ['default', 'overview', 'catalog', 'api-reference']);
  const S = loadStandards();
  assert.deepEqual(S.frontMatter.keys.layout.values, [...LAYOUTS, ...DEFAULT_VARIANTS], 'standards/front-matter.yaml lists every layout');
  assert.equal(S.frontMatter.keys.data.type, 'string');
  const C = yaml.load(fs.readFileSync(path.join(root, 'standards', 'components.yaml'), 'utf8'));
  const documented = C.layouts.flatMap((l) => l.name.split(/,\s*/));
  assert.deepEqual(documented.sort(), [...LAYOUTS, ...DEFAULT_VARIANTS].sort());
  assert.equal(layoutOf({}), 'default');
  assert.deepEqual(layoutFrontMatter({ layout: 'overview' }), { hide_table_of_contents: true, layout: 'overview' });
  assert.deepEqual(layoutFrontMatter({ layout: 'catalog', hide_table_of_contents: false }), { hide_table_of_contents: false, layout: 'catalog' }, 'the page\'s own keys win');
  assert.deepEqual(layoutFrontMatter({ title: 'x' }), { title: 'x' });
});

// --- overview -------------------------------------------------------------------

test('overview: sections of text and links become cards, a row of cards one grid, the rest stays prose', () => {
  const tree = md(`Lead paragraph.

## Get started

- [Create an account](./a.mdx)
- [Connect an app](./b.mdx)

## Guides

Task guides.

- [Applications](./c.mdx)
- SDKs and integrations

## What is it?

Only prose here, so no card.

## Products

Every product, with its Cloud and its Self-hosted docs.

### Identity Server

Sign-in and user management.

- [Identity Server Cloud](docs:identity-server/cloud/)

### AI Gateway

---

Govern AI traffic.

- [AI Gateway Cloud](docs:ai-gateway/cloud/)

### Not a card

![A diagram](./d.png)

- [Link](./e.mdx)

## Compare

| A | B |
|---|---|
| 1 | 2 |
`);
  const { children, cards } = overview(tree.children);
  assert.equal(cards, 4);
  assert.deepEqual(names(children), ['paragraph', 'OverviewGrid', 'h2', 'paragraph', 'h2', 'paragraph', 'OverviewGrid', 'h3', 'paragraph', 'list', 'h2', 'table']);
  const [first, second] = [children[1], children[6]];
  assert.deepEqual(first.children.map((c) => c.children[0].children[0].value), ['Get started', 'Guides'], 'two H2 cards share a grid');
  assert.deepEqual(first.children.map((c) => c.attributes.find((a) => a.name === 'level').value), ['2', '2']);
  assert.deepEqual(second.children.map((c) => c.children[0].children[0].value), ['Identity Server', 'AI Gateway'], 'product cards under a prose H2');
  assert.equal(children[2].children[0].value, 'What is it?');
  assert.equal(children[4].children[0].value, 'Products');
  assert.equal(children[7].children[0].value, 'Not a card', 'an image keeps a section prose');
  // A card may end at a paragraph that is one link; text after a card's links is a label before the next row.
  const providers = overview(md(`## By provider

AI providers

### AWS

---

Govern Amazon Bedrock traffic.

[Explore AWS resources →](./aws.mdx)

Developer tools

### GitHub

Route Copilot through the gateway.

[Explore GitHub resources →](./github.mdx)
`).children);
  assert.equal(providers.cards, 2);
  assert.deepEqual(names(providers.children), ['h2', 'paragraph', 'OverviewGrid', 'paragraph', 'OverviewGrid']);
  assert.equal(providers.children[3].children[0].value, 'Developer tools');
  assert.ok(isCardBody(md('- [x](y)').children));
  assert.ok(isCardBody(md('Text.\n\n[Read more](./x.mdx)').children));
  assert.ok(!isCardBody(md('Text with [a link](./x.mdx) in it.').children), 'a link inside prose is no card');
  assert.ok(!isCardBody(md('Prose only.').children));
  assert.ok(!isCardBody(md('- item\n\n```js\ncode\n```').children));
  assert.ok(!isCardBody(md('- a [![img](i.png)](x)').children), 'nothing but text and links, deep down too');
  assert.ok(!isCardBody([]));
});

// --- data files and the catalog -------------------------------------------------

test('data files: the catalog schema and its own rules, with every problem named', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-data-'));
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(path.join(docsDir, 'guides'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'guides', 'sift.mdx'), '---\ntitle: Sift\n---\n');
  fs.writeFileSync(path.join(dir, 'assets', 'sift.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const file = path.join(docsDir, 'connectors.yaml');
  const write = (data) => fs.writeFileSync(file, yaml.dump(data));
  const good = {
    schemaVersion: 1,
    categories: [{ id: 'fraud', label: 'Fraud detection' }],
    items: [
      { id: 'sift', name: 'Sift', description: 'Fraud detection.', href: 'guides/sift', links: [{ label: 'Connector store', url: 'https://store.wso2.com/connector/sift' }], category: 'fraud', logo: 'assets/sift.svg' },
      { id: 'duo', name: 'Duo', description: 'Two factors.', href: './guides/sift.mdx', category: 'fraud', editions: ['self-hosted'] },
    ],
  };
  write(good);
  assert.deepEqual(checkDataFile('catalog', file, { docsDir }).problems, []);
  write({ ...good, items: [...good.items, { ...good.items[0] }] });
  assert.deepEqual(checkDataFile('catalog', file, { docsDir }).problems, ['items.2 (sift): the id "sift" is used twice']);
  write({ ...good, items: [{ ...good.items[0], category: 'crm', href: 'guides/nope', logo: 'assets/nope.svg', links: [{ label: 'x', url: '../missing.mdx' }] }] });
  assert.deepEqual(checkDataFile('catalog', file, { docsDir }).problems, [
    'items.0 (sift): category "crm" is not in categories (fraud)',
    'items.0 (sift): href "guides/nope" is not a page in this Doc space',
    'items.0 (sift): links.0.url "../missing.mdx" is not a page in this Doc space',
    'items.0 (sift): logo "assets/nope.svg" is not in this Doc space\'s assets/',
  ]);
  write({ schemaVersion: 1, items: [{ id: 'Sift', name: 'Sift', href: 'javascript:alert(1)' }] });
  assert.deepEqual(checkDataFile('catalog', file, { docsDir }).problems, ['items.0: "description" is required', 'items.0.id: must match pattern "^[a-z0-9]+([._-][a-z0-9]+)*$"', 'items.0.href: must match pattern "^(docs:|https?://|/|\\./|\\.\\./|[a-z0-9][^:]*$)"'], 'no other URL schemes');
  fs.writeFileSync(file, 'items: [unclosed');
  assert.match(checkDataFile('catalog', file).problems[0], /connectors\.yaml is not valid YAML/);
  assert.throws(() => loadDataFile('catalog', file), /data file connectors\.yaml does not follow the catalog schema/);
  assert.throws(() => loadDataFile('catalog', path.join(docsDir, 'gone.yaml')), /data file gone\.yaml not found/);
  // Release notes and SDK lists are known by their name.
  assert.equal(namedKind('docs/release-notes/release-notes.yaml'), 'release-notes');
  assert.equal(namedKind('docs/reference/sdks.json'), 'sdks');
  assert.equal(namedKind('docs/reference/connectors.yaml'), null);
  const sdks = path.join(docsDir, 'sdks.yaml');
  fs.writeFileSync(sdks, yaml.dump({ schemaVersion: 1, sdks: [{ id: 'react', name: 'React', language: 'JavaScript', repo: 'https://github.com/x' }, { id: 'react', name: 'React 2', language: 'JavaScript', repo: 'https://github.com/y' }] }));
  assert.deepEqual(checkDataFile('sdks', sdks).problems, ['sdks.1: the id "react" is used twice']);
  // Where hrefs point.
  assert.deepEqual(resolveHref('docs:identity-server/latest/', { dataFile: file, docsDir }), { kind: 'docs', url: 'docs:identity-server/latest/' });
  assert.equal(resolveHref('guides/sift#set-up', { dataFile: file, docsDir }).file, path.join(docsDir, 'guides', 'sift.mdx'));
  assert.equal(resolveHref('guides/sift#set-up', { dataFile: file, docsDir }).hash, 'set-up');
});

test('catalog: the items this Edition shows, as MDX the build and the Markdown twin both draw', () => {
  const docsDir = path.join(stub, 'docs');
  const pageFile = path.join(docsDir, 'reference', 'connectors', 'index.mdx');
  const dataFile = path.join(docsDir, 'reference', 'connectors', 'connectors.yaml');
  const data = loadDataFile('catalog', dataFile, { docsDir });
  const nodes = (id) => catalogNodes(data, { edition: editionFromId(id), docsDir, dataFile, pageFile, where: 'reference/connectors/index.mdx' });
  const ids = (n) => n.children.map((c) => c.attributes.find((a) => a.name === 'id').value);
  assert.deepEqual(ids(nodes('cloud')), ['totp', 'billing-alerts', 'api-publishing']);
  assert.deepEqual(ids(nodes('7.3.0')), ['totp', 'fraud-signals', 'api-publishing']);
  const cloud = nodes('cloud');
  assert.deepEqual(JSON.parse(cloud.attributes.find((a) => a.name === 'categories').value), [{ id: 'authentication', label: 'Authentication' }, { id: 'fraud-detection', label: 'Fraud detection' }]);
  const [totp] = cloud.children;
  assert.deepEqual(names(totp.children), ['CatalogLogo', 'paragraph', 'paragraph', 'paragraph']);
  assert.equal(totp.children[0].children[0].children[0].url, '../../../assets/logos/totp.svg', 'the logo, relative to the page, so the build bundles it');
  assert.equal(totp.children[0].children[0].children[0].alt, '', 'decorative: the name says what it is');
  assert.equal(totp.children[1].children[0].children[0].url, '../../guides/mfa.mdx', 'a page path becomes a file link the build resolves and checks');
  assert.equal(cloud.children[1].children[0].children[0].children[0].url, '../../guides/cloud-billing.mdx');
  assert.equal(cloud.children[2].children[0].children[0].children[0].url, 'docs:api-manager/latest/guides/', 'docs: links are left to the docs: links step');
  const beta = nodes('7.3.0').children[1];
  assert.equal(beta.attributes.find((a) => a.name === 'status').value, 'beta');
  assert.equal(beta.attributes.find((a) => a.name === 'tags'), undefined);
  assert.equal(totp.attributes.find((a) => a.name === 'tags').value, 'mfa|otp');
  // Every node a layout makes has a Markdown form.
  for (const n of ['Catalog', 'CatalogItem', 'CatalogLogo', 'OverviewGrid', 'OverviewCard']) assert.ok(Object.hasOwn(COMPONENT_FORMS, n), n);
  assert.ok(shownIn(editionFromId('7.3.0'), ['7.3.0']) && !shownIn(editionFromId('7.2.0'), ['7.3.0']) && shownIn(editionFromId('next'), undefined));
});

test('the layout step: a catalog page without its data file, or with a broken one, fails the build with the file named', () => {
  const run = (fm, file = path.join(stub, 'docs', 'reference', 'connectors', 'index.mdx')) => {
    const tree = md('Intro.');
    remarkLayouts({ edition: editionFromId('cloud'), docsDir: path.join(stub, 'docs') })(tree, { path: file, data: { frontMatter: fm } });
    return tree;
  };
  assert.deepEqual(names(run({ layout: 'catalog', data: './connectors.yaml' }).children), ['paragraph', 'Catalog']);
  assert.throws(() => run({ layout: 'catalog' }), /reference\/connectors\/index\.mdx: a catalog page names its data file in front matter/);
  assert.throws(() => run({ layout: 'catalog', data: './nope.yaml' }), /reference\/connectors\/index\.mdx: data file nope\.yaml not found/);
  assert.deepEqual(names(run({}).children), ['paragraph'], 'the default layout draws the page as written');
});

// --- team notices and link entries, as the chrome reads them --------------------

test('team notices: from the published manifest, for the Edition read, until their last day', () => {
  const manifest = {
    docSpaces: {
      'api-manager': {
        displayName: 'API Manager', latest: '4.7.0', editions: [{ id: '4.7.0' }, { id: '4.6.0' }],
        notices: [
          { text: 'Everyone sees this.', level: 'info' },
          { text: '4.6.0 reaches end of life in March.', level: 'warning', editions: ['4.6.0'] },
          { text: 'Maintenance on 30 October.', level: 'info', until: '2026-10-30' },
        ],
      },
    },
  };
  const texts = (edition, now) => teamNotices(manifest, 'api-manager', edition, new Date(now)).map((n) => n.text);
  assert.deepEqual(texts('4.7.0', '2026-10-26T12:00:00Z'), ['Everyone sees this.', 'Maintenance on 30 October.']);
  assert.deepEqual(texts('4.6.0', '2026-10-30T23:59:00Z'), ['Everyone sees this.', '4.6.0 reaches end of life in March.', 'Maintenance on 30 October.'], 'the last day is inclusive');
  assert.deepEqual(texts('4.6.0', '2026-10-31T00:00:00Z'), ['Everyone sees this.', '4.6.0 reaches end of life in March.']);
  assert.equal(teamNotices(manifest, 'api-manager', '4.6.0', new Date('2026-10-26'))[1].level, 'warning');
  assert.deepEqual(teamNotices(manifest, 'ai-gateway', 'cloud'), []);
  assert.deepEqual(teamNotices(null, 'api-manager', '4.7.0'), []);
  // The chrome reads them from the published copy only, never the baked-in snapshot.
  const notices = fs.readFileSync(path.join(root, 'site', 'src', 'components', 'chrome', 'EditionNotices.js'), 'utf8');
  assert.match(notices, /useLiveManifest\(\)/);
  assert.match(notices, /teamNotices\(live,/);
});

test('link entries: a section\'s menu and the product switcher show them with ↗', () => {
  const manifest = {
    families: ['Integration Platform'],
    docSpaces: { integrator: { displayName: 'Integrator', family: 'Integration Platform', model: 'versions-only', editions: [{ id: '5.1.0' }, { id: '5.0.0' }] } },
    sections: {
      'integration-platform': {
        title: 'Integration Platform Documentation', family: 'Integration Platform',
        menu: [{ docSpace: 'integrator', versionIn: 'menu' }, { docSpace: 'not-here', versionIn: 'header' }, { label: 'Ballerina', url: 'https://ballerina.io/' }],
      },
    },
  };
  assert.deepEqual(sectionMenu(manifest, 'integration-platform'), {
    id: 'integration-platform', title: 'Integration Platform Documentation',
    entries: [
      { kind: 'docSpace', slug: 'integrator', name: 'Integrator', href: '/integrator/', versionIn: 'menu' },
      { kind: 'link', label: 'Ballerina', href: 'https://ballerina.io/', external: true },
    ],
  });
  assert.equal(sectionMenu(manifest, 'nope'), null);
  const [group] = productsMenu(manifest);
  assert.deepEqual(group.entries.map((e) => [e.label, e.external, e.linksOut]), [['Ballerina', true, true]], 'no products listed: only the section\'s link entry');
});

// --- the component catalogue and the extension proposal form ------------------

test('the component catalogue documents every registered component, each with its Markdown form, accessibility and owner', () => {
  const C = yaml.load(fs.readFileSync(path.join(root, 'standards', 'components.yaml'), 'utf8'));
  const documented = new Set(C.components.flatMap((c) => c.name.replace(/\s*\(.*\)$/, '').split(/,\s*/)));
  for (const name of Object.keys(COMPONENT_FORMS)) assert.ok(documented.has(name), `standards/components.yaml documents ${name}`);
  assert.ok(documented.has('a') && documented.has('Edition'));
  for (const c of [...C.components, ...C.layouts]) {
    for (const k of ['what', 'markdownForm', 'accessibility', 'owner', 'since']) assert.ok(typeof c[k] === 'string' && c[k].trim(), `${c.name}: ${k}`);
  }
  for (const c of C.components) assert.ok(['written', 'generated', 'migration'].includes(c.use), c.name);
  for (const d of C.dataFiles) assert.ok(fs.existsSync(path.join(root, d.schema)), d.schema);
  const page = fs.readFileSync(path.join(root, 'standards', 'contribute', 'docs', 'reference', 'components.mdx'), 'utf8');
  assert.match(page, /^title: Components and layouts$/m);
  for (const anchor of ['layout-overview', 'layout-catalog', 'catalog', 'overviewgrid', 'propose']) assert.match(page, new RegExp(`\\{#${anchor}\\}`), anchor);
  assert.match(page, /issues\/new\?template=extension-proposal\.yml/);
});

test('the extension proposal issue form asks for what joining the catalogue needs', () => {
  const file = path.join(root, '.github', 'ISSUE_TEMPLATE', 'extension-proposal.yml');
  const form = yaml.load(fs.readFileSync(file, 'utf8'));
  assert.equal(form.name, 'Extension proposal');
  assert.ok(form.description.length <= 200);
  assert.deepEqual(form.labels, ['extension-proposal']);
  const ids = form.body.filter((b) => b.id).map((b) => b.id);
  for (const id of ['kind', 'name', 'need', 'why-not-existing', 'doc-spaces', 'markdown-form', 'accessibility', 'owner']) {
    assert.ok(ids.includes(id), id);
    assert.equal(form.body.find((b) => b.id === id).validations?.required, true, `${id} is required`);
  }
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const kinds = form.body.find((b) => b.id === 'kind').attributes.options;
  for (const k of ['MDX component', 'Page layout', 'Manifest field (Doc space, Docs section or navigation)', 'Menu entry kind']) assert.ok(kinds.includes(k), k);
  const C = yaml.load(fs.readFileSync(path.join(root, 'standards', 'components.yaml'), 'utf8'));
  assert.match(C.proposal, /\/issues\/new\?template=extension-proposal\.yml$/);
});
