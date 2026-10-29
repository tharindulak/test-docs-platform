// Converter rules on small inputs, plus one end-to-end run over a tiny MkDocs
// project (fixtures/mkdocs-mini). The real corpus is never converted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { mkdocsSlug, mkdocsUnique, sentenceCase, DocusaurusSlugger } from '../migration/lib/slug.mjs';
import { PageConverter, parseFenceInfo } from '../migration/lib/markdown.mjs';
import { planLayout, docUrl } from '../migration/lib/layout.mjs';
import { parseNav } from '../migration/lib/mkdocs.mjs';
import { similarity, words } from '../migration/lib/verify.mjs';
import { convertProduct, generatedDescription, nearestAnchor } from '../migration/lib/run.mjs';
import { loadOverrides, SourceOverrides } from '../migration/lib/overrides.mjs';
import apim from '../migration/products/api-manager.mjs';
import { loadContentRepo } from '../lib/content.mjs';
import { loadContext } from '../lib/check/content.mjs';
import { checkContentSafety } from '../lib/check/safety.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// A context whose resolvers echo their input, for converter-rule tests.
function stubCtx() {
  const reports = [];
  const imports = new Map();
  return {
    config: apim, legacyBase: 'https://legacy/en/1.0.0/', knownLanguages: new Set(['bash', 'toml', 'text', 'json']),
    stats: { unknownLanguages: new Set(), placeholders: 0, admonitions: 0, details: 0, tabSets: 0, codeBlocks: 0, htmlBlocks: 0, explicitIds: 0, indentedCode: 0, basePathInCode: 0, basePathInText: 0, unknownElements: 0 },
    reports, imports,
    report: (kind, message) => reports.push({ kind, message }),
    language: (l) => apim.languages[l] ?? l,
    admonitionType: (t) => apim.admonitions[t.toLowerCase()] ?? 'note',
    useTabs: () => imports.set('Tabs', '@theme/Tabs'),
    useAnchor: () => imports.set('Anchor', null),
    link: (href) => ({ href: href.replace('{{base_path}}', '/site') }),
    image: (src) => ({ src: src.replace('{{base_path}}', '../..'), local: true }),
    missingImage: () => '',
    partial: (p) => `P${path.basename(p, '.md').replace(/-/g, '')}`,
  };
}
const convert = (md, ctx = stubCtx()) => ({ out: new PageConverter(ctx).convert(md), ctx });

test('MkDocs heading ids and de-duplication', () => {
  assert.equal(mkdocsSlug('Step 1 - Create the API'), 'step-1-create-the-api');
  assert.equal(mkdocsSlug('What’s new in 4.7.0?'), 'whats-new-in-470');
  const seen = new Set();
  assert.deepEqual(['a', 'a', 'a'].map((x) => mkdocsUnique(x, seen)), ['a', 'a_1', 'a_2']);
});

test('a heading keeps its MkDocs id only where Docusaurus would differ', () => {
  const { out } = convert('# Title\n\n## Step 1 - Do it\n\n## Plain heading\n\n## Plain heading\n');
  assert.match(out, /## Step 1 - Do it \{#step-1-do-it\}/);
  assert.match(out, /## Plain heading\n/);
  assert.match(out, /## Plain heading \{#plain-heading_1\}/);
  assert.doesNotMatch(out, /# Title/, 'a plain H1 moves to front matter');
});

test('Docusaurus slugger peeks without consuming', () => {
  const s = new DocusaurusSlugger();
  assert.equal(s.peek('A b'), 'a-b');
  assert.equal(s.commit('A b'), 'a-b');
  assert.equal(s.peek('A b'), 'a-b-1');
});

test('sentence case keeps acronyms and proper nouns', () => {
  assert.equal(sentenceCase('Install & Setup', apim.properNouns), 'Install & setup');
  assert.equal(sentenceCase('Configure the Developer Portal Theme', apim.properNouns), 'Configure the Developer Portal theme');
  assert.equal(sentenceCase('Create a GraphQL API with OAuth', apim.properNouns), 'Create a GraphQL API with OAuth');
});

test('admonitions map onto the five types and keep the legacy title', () => {
  const { out } = convert('1. Step\n\n    !!! example\n        Body text.\n\n    !!! note "Heads up"\n        More.\n\n!!! note\n    Same title.\n');
  assert.match(out, /^ {4}:::note\[Example\]\n {4}Body text\.\n {4}:::$/m);
  assert.match(out, /^ {4}:::note\[Heads up\]$/m);
  assert.match(out, /^:::note\nSame title\.\n:::$/m);
});

test('nested admonitions get longer fences', () => {
  const { out } = convert('!!! note\n    Outer.\n\n    !!! tip\n        Inner.\n');
  assert.match(out, /^::::note\nOuter\.\n\n:::tip\nInner\.\n:::\n::::$/m);
});

test('content tabs become linked Tabs, collapsibles become details', () => {
  const { out, ctx } = convert('=== "TOML"\n    ```toml\n    [a]\n    ```\n=== "YAML"\n    Text.\n\n??? info "More"\n    Hidden.\n');
  assert.match(out, /<Tabs groupId="tabs">\n<TabItem value="toml" label="TOML">\n\n```toml\n\[a\]\n```\n\n<\/TabItem>\n<TabItem value="yaml" label="YAML">/);
  assert.match(out, /<details>\n<summary>More<\/summary>\n\nHidden\.\n\n<\/details>/);
  assert.equal(ctx.imports.get('Tabs'), '@theme/Tabs');
});

test('code fences: language names and hl_lines', () => {
  assert.deepEqual(parseFenceInfo('sh hl_lines="1 3"', apim.languages, new Set(['bash'])), { lang: 'bash', meta: '{1,3}', unknown: false, original: 'sh' });
  assert.equal(parseFenceInfo('{.yml title="a.yaml"}', apim.languages, null).meta, 'title="a.yaml"');
  const { out } = convert('```\nplain\n```\n');
  assert.match(out, /^```text$/m);
});

test('placeholders are wrapped in backticks and stray braces escaped', () => {
  const { out } = convert('Run <API-M_HOME>/bin for {org}, but { this } stays text. Use `<code>` as is.\n');
  assert.equal(out.trim(), 'Run `<API-M_HOME>/bin` for `{org}`, but \\{ this \\} stays text. Use `<code>` as is.');
});

test('links, lightbox images and image styles', () => {
  const { out } = convert('[A]({{base_path}}/x/) [![Shot]({{base_path}}/assets/img/a.png){: style="width:50%"}]({{base_path}}/assets/img/a.png) <https://wso2.com>\n');
  assert.match(out, /\[A\]\(\/site\/x\/\)/);
  assert.match(out, /<img src=\{require\("..\/..\/assets\/img\/a.png"\).default\} alt="Shot" style=\{\{width: "50%"\}\} \/>/);
  assert.doesNotMatch(out, /\]\(\.\.\/\.\.\/assets\/img\/a\.png\)/, 'the lightbox link around the image is dropped');
  assert.match(out, /\[https:\/\/wso2\.com\]\(https:\/\/wso2\.com\)/);
});

test('YouTube embeds are written from youtube-nocookie.com, path and query kept, and pass content-safety', () => {
  const { out } = convert([
    '<iframe width="560" height="315" src="https://www.youtube.com/embed/ZnWnDZJ_c4o?rel=0&start=30" title="A" allowfullscreen></iframe>',
    '',
    '<div class="video"><iframe src="https://youtube.com/embed/abc_123" title="B"></iframe></div>',
    '',
    '<iframe src="https://youtu.be/xyz-9?t=5" title="C"></iframe>',
    '',
    '<iframe src="//www.youtube.com/embed/def" title="D"></iframe>',
    '',
    '<iframe src="https://www.youtube-nocookie.com/embed/ghi" title="E"></iframe>',
    '',
  ].join('\n'));
  const srcs = [...out.matchAll(/<iframe [^>]*src="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, [
    'https://www.youtube-nocookie.com/embed/ZnWnDZJ_c4o?rel=0&start=30',
    'https://www.youtube-nocookie.com/embed/abc_123',
    'https://www.youtube-nocookie.com/embed/xyz-9?t=5',
    'https://www.youtube-nocookie.com/embed/def',
    'https://www.youtube-nocookie.com/embed/ghi',
  ]);
  // The content-safety check accepts the converted page.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-embeds-'));
  fs.cpSync(path.join(here, '..', 'fixtures', 'stub-repo', 'identity-server'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'videos.mdx'), `---\ntitle: Videos\ndescription: Product videos.\ntype: concept\n---\n\n${out}\n`);
  assert.deepEqual(checkContentSafety(loadContext({ repo: loadContentRepo(dir), base: null })), []);
});

test('raw HTML: admonition divs, simple and complex tables, anchors', () => {
  const { out, ctx } = convert([
    '<html><div class="admonition warning">', '<p class="admonition-title">Careful</p>', '<p>Do <b>not</b> use **this**.</p>', '</div></html>',
    '', '<table><tr><th>Name</th><th>Value</th></tr><tr><td>a</td><td><code>{x}</code></td></tr></table>',
    '', '<table><tr><td colspan="2" class="confluenceTd">Wide<br>cell</td></tr></table>',
    '', '<a name="old-anchor"></a>', '',
  ].join('\n'));
  assert.match(out, /:::warning\[Careful\]\nDo \*\*not\*\* use \\\*\\\*this\\\*\\\*\.\n:::/, 'Markdown inside raw HTML stays literal');
  assert.match(out, /\| Name \| Value \|\n\| --- \| --- \|\n\| a \| `\{x\}` \|/);
  assert.match(out, /<td colSpan="2">Wide<br \/>cell<\/td>/);
  assert.match(out, /<Anchor id="old-anchor" \/>/);
  assert.ok(ctx.imports.has('Anchor'));
});

test('raw HTML: a block ends at its closing tag, as Python-Markdown ends it', () => {
  // Consecutive <p> lines stay separate paragraphs, and a --- after them is a
  // rule, never a setext heading over the paragraphs.
  const { out } = convert('<p class="doc-info">Published: May 1</p>\n<p class="doc-info">Severity: High</p>\n---\n\n### Overview\n');
  assert.match(out, /^Published: May 1\n\nSeverity: High\n\n---\n/);
  const list = convert('* item\n    <p>inside</p>\n    more\n').out;
  assert.doesNotMatch(list, /\n\n/, 'inside a list the item stays tight');
});

test('includes become partial components, also after a list marker', () => {
  const { out } = convert('1. {!includes/sign-in.md!}\n\n{!includes/other-part.md!}\n');
  assert.match(out, /^1\. <Psignin \/>$/m);
  assert.match(out, /^<Potherpart \/>$/m);
});

test('Jinja raw blocks keep their braces in code', () => {
  const { out } = convert('```json\n{"a": "{{ value }}"}\n```\n');
  assert.match(out, /\{"a": "\{\{ value \}\}"\}/);
});

test('layout: top level re-filed, sections named after their source folder, nav order kept', () => {
  const nav = parseNav([
    { Home: 'index.md' },
    { 'Design Things': [{ 'Create APIs': [{ One: 'guides/design/create/one.md' }, { Two: 'guides/design/create/two.md' }] }, { Mixed: [{ X: 'guides/design/x.md' }] }] },
  ]);
  const config = { ...apim, topLevel: { Home: { page: 'index' }, 'Design Things': { folder: 'guides/design-things' } } };
  const files = ['index.md', 'guides/design/create/one.md', 'guides/design/create/two.md', 'guides/design/x.md', 'guides/design/extra.md'];
  const { pages, categories } = planLayout({ nav, files, config });
  assert.equal(pages.get('guides/design/create/two.md').target, 'guides/design-things/create/two');
  assert.equal(pages.get('guides/design/create/two.md').position, 2);
  assert.equal(pages.get('guides/design/x.md').target, 'guides/design-things/mixed/x', 'a section with no folder of its own is named after its label');
  assert.equal(categories.get('guides/design-things/create').label, 'Create APIs');
  assert.equal(pages.get('guides/design/extra.md').inNav, false);
  assert.equal(docUrl('reference/apis/demo/index'), 'reference/apis/demo/');
  assert.equal(docUrl('a/b/b'), 'a/b/', 'a doc named like its folder is the folder');
});

test('layout: a nav entry for a missing file is reported, never read', () => {
  const nav = parseNav([{ Home: 'index.md' }, { 'Design Things': [{ Gone: 'guides/design/gone.md' }, { X: 'guides/design/x.md' }] }]);
  const config = { ...apim, topLevel: { Home: { page: 'index' }, 'Design Things': { folder: 'guides/design-things' } } };
  const files = ['index.md', 'guides/design/x.md'];
  const isApiPage = (src) => {
    if (!files.includes(src)) throw new Error(`read ${src}`);
    return false;
  };
  const { pages, issues } = planLayout({ nav, files, config, isApiPage });
  assert.ok(pages.has('guides/design/x.md'));
  assert.ok(issues.some((i) => i.kind === 'nav' && /points to a missing file/.test(i.message)));
});

test('generated descriptions use the first paragraph, up to 160 characters', () => {
  assert.equal(generatedDescription('import X from "y";\n\nThis page explains things. More text here.', 'T'), 'This page explains things.');
  assert.ok(generatedDescription(`${'word '.repeat(60)}`, 'T').length <= 160);
});

test('parity similarity', () => {
  const s = similarity(words('The quick brown fox'), words('the quick brown fox jumps'));
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 0.8);
});

test('end to end: a tiny MkDocs project becomes a Content repo branch', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-migration-'));
  const config = {
    ...apim,
    topLevel: { Home: { page: 'index' }, 'Get Started': { folder: 'get-started' }, 'Design Things': { folder: 'guides/design-things' }, Reference: { folder: 'reference' } },
    sectionFolders: { 'Reference > Product REST APIs': 'reference/apis' },
    pageOverrides: {}, placeholders: {}, typeOverrides: {}, overrides: null,
  };
  const { summary, report } = await convertProduct({
    config, sourceRoot: path.join(here, '..', 'fixtures', 'mkdocs-mini', 'en'), outDir: out,
    edition: '1.0.0', legacyVersion: '1.0.0', sourceRef: 'wso2/docs-mini@test',
  });
  const read = (p) => fs.readFileSync(path.join(out, p), 'utf8');
  assert.equal(summary.compileFailures, 0, JSON.stringify(report.items.filter((i) => i.kind === 'compile')));

  const overview = read('docs/get-started/overview.mdx');
  assert.match(overview, /^title: Overview$/m);
  assert.match(overview, /^type: quick-start$/m);
  assert.match(overview, /^description: .*# generated from the first paragraph/m);
  assert.match(overview, /version \{edition\.version\}/);
  assert.match(overview, /\[Create an API\]\(\.\.\/guides\/design-things\/create-api\.mdx#step-1-sign-in\)/);

  const create = read('docs/guides/design-things/create-api.mdx');
  assert.match(create, /^import SignIn from '\.\.\/\.\.\/\.\.\/partials\/sign-in\.mdx';$/m, 'partials live next to docs/');
  assert.ok(fs.existsSync(path.join(out, 'partials/sign-in.mdx')));
  assert.ok(!fs.existsSync(path.join(out, 'docs/_partials')));
  assert.match(overview, /\[old link\]\(\.\.\/guides\/design-things\/create-api\.mdx\)/, 'a link to a moved page follows the legacy redirect');
  assert.match(overview, /\[here\]\(\.\/not-in-nav\.mdx\)/);
  assert.doesNotMatch(create, /\[missing\]/, 'a link with no target keeps only its text');
  assert.match(create, /src=\{require\("\.\.\/\.\.\/\.\.\/assets\/img\/shot\.png"\)\.default\}/);
  assert.ok(fs.existsSync(path.join(out, 'assets/img/shot.png')));

  const tabs = read('docs/guides/design-things/advanced-topics/tabs-and-html.mdx');
  assert.match(tabs, /^import Tabs from '@theme\/Tabs';$/m);
  assert.match(tabs, /\[the anchor\]\(#legacy-anchor\)/);
  assert.match(tabs, /or a broken one\./, 'a broken same-page anchor link keeps its text');

  const api = read('docs/reference/apis/demo-v1/index.mdx');
  assert.match(api, /^layout: api-reference$/m);
  assert.ok(fs.existsSync(path.join(out, 'docs/reference/apis/demo-v1/openapi.yaml')));

  assert.match(read('docs/get-started/not-in-nav.mdx'), /^unlisted: true$/m);
  assert.deepEqual(yaml.load(read('docs/guides/design-things/_category_.yml')), { label: 'Design things', position: 1 });

  const redirects = yaml.load(read('redirects.yaml'));
  const map = new Map(redirects.legacy.map((l) => [l.from, l.to]));
  const base = 'https://apim.docs.wso2.com/en/1.0.0/';
  assert.equal(map.get(`${base}guides/design/create-api/`), 'guides/design-things/create-api');
  assert.equal(map.get(`${base}older/create/`), 'guides/design-things/create-api', 'redirect chains are flattened');
  assert.equal(map.get(`${base}gone/`), '', 'a redirect to a missing page goes to the Edition home');
  assert.equal(map.get(`${base}includes/sign-in/`), 'guides/design-things/create-api', 'include URLs go to their first page');
  assert.equal(map.get(`${base}reference/product-apis/demo-v1/demo-v1/`), 'reference/apis/demo-v1');
  assert.deepEqual(yaml.load(read('docspace.yaml')), apim.docspace, 'the full Doc space manifest');
  assert.ok(!fs.existsSync(path.join(out, 'assets/self-hosted')) && !fs.existsSync(path.join(out, 'assets/cloud')), 'one kind of Edition: no Edition-only folders');
  assert.ok(report.items.some((i) => i.kind === 'broken-link'), 'broken links are reported');
  fs.rmSync(out, { recursive: true, force: true });
});

test('override list: patches the legacy source, accepts legacy-broken links, reports stale entries', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-overrides-'));
  const list = path.join(out, 'mini.overrides.yaml');
  fs.writeFileSync(list, yaml.dump({
    patches: [
      // A typo fix in the legacy source, and a link to a page that moved without a redirect.
      { file: 'docs/guides/design/create-api.md', find: '[missing]({{base_path}}/nope/)', replace: '[missing]({{base_path}}/get-started/overview/)', why: 'page moved' },
      { file: 'docs/guides/design/create-api.md', find: 'never in the source', replace: 'x', why: 'fixed upstream' },
      { file: 'docs/guides/design/create-api.md', find: 'Read <https://wso2.com>', replace: 'Read <https://wso2.com/>', why: 'other Edition only', editions: ['2.0.0'] },
    ],
    accepted: [{ page: 'guides/design/tabs-and-html.md', href: '#nope', why: 'the anchor is not on the legacy page either' }],
  }));
  const config = {
    ...apim,
    topLevel: { Home: { page: 'index' }, 'Get Started': { folder: 'get-started' }, 'Design Things': { folder: 'guides/design-things' }, Reference: { folder: 'reference' } },
    sectionFolders: { 'Reference > Product REST APIs': 'reference/apis' },
    pageOverrides: {}, placeholders: {}, typeOverrides: {}, overrides: list,
  };
  const run = (dir, useOverrides) => convertProduct({
    config, sourceRoot: path.join(here, '..', 'fixtures', 'mkdocs-mini', 'en'), outDir: path.join(out, dir),
    edition: '1.0.0', legacyVersion: '1.0.0', sourceRef: 'wso2/docs-mini@test', compile: false, useOverrides,
  });
  const { summary, report } = await run('with', true);
  const create = fs.readFileSync(path.join(out, 'with', 'docs/guides/design-things/create-api.mdx'), 'utf8');
  assert.match(create, /\[missing\]\(\.\.\/\.\.\/get-started\/overview\.mdx\)/, 'the patched link reaches the page');
  assert.ok(!report.items.some((i) => i.kind === 'broken-link' && /nope/.test(i.message)));
  const anchor = report.items.find((i) => i.kind === 'broken-anchor' && i.detail?.href === '#nope');
  assert.equal(anchor.accepted, 'the anchor is not on the legacy page either');
  assert.equal(summary.issues['broken-anchor'], undefined, 'accepted items are not outstanding');
  assert.equal(summary.stats.acceptedByOverrides, 1);
  assert.deepEqual(summary.overrides, { file: 'mini.overrides.yaml', patches: 2, patchesApplied: 1, accepted: 1 }, 'the 2.0.0-only patch is not in this run');
  const stale = report.items.filter((i) => i.kind === 'override');
  assert.equal(stale.length, 1);
  assert.match(stale[0].message, /"never in the source" not found/);
  assert.match(fs.readFileSync(path.join(out, 'with', '.migration', 'report.md'), 'utf8'), /## Accepted by the override list/);

  // Without the list the same source reports both links as outstanding.
  const bare = await run('without', false);
  assert.equal(bare.summary.issues['broken-anchor'], 1);
  assert.ok(bare.report.items.some((i) => i.kind === 'broken-link' && i.detail?.href === '{{base_path}}/nope/'));
  fs.rmSync(out, { recursive: true, force: true });
});

test('override list: entries need a reason; patches read once per file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-overrides-'));
  const bad = path.join(dir, 'bad.yaml');
  fs.writeFileSync(bad, yaml.dump({ patches: [{ file: 'a.md', find: 'x', replace: 'y' }], accepted: [{ page: 'a.md' }] }));
  assert.throws(() => loadOverrides(bad), /patches\[0\] needs a "why"[\s\S]*accepted\[0\] needs page and href/);
  assert.deepEqual(loadOverrides(path.join(dir, 'missing.yaml')), { patches: [], accepted: [] });
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'a.md'), 'one `<X_HOME>/conf\n` two, one again');
  const o = new SourceOverrides({ patches: [{ file: 'docs/a.md', find: '`<X_HOME>/conf\n`', replace: '`<X_HOME>/conf`', why: 'span' }, { file: 'docs/a.md', find: 'one', replace: 'ONE', why: 'all occurrences' }], accepted: [] }, { sourceRoot: dir, edition: '1.0.0' });
  assert.equal(o.read(path.join(dir, 'docs', 'a.md')), 'ONE `<X_HOME>/conf` two, ONE again');
  assert.deepEqual(o.stale(), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nearest anchor: every old word still there, or nearly the same words; never a tie', () => {
  assert.deepEqual(nearestAnchor('onboard-a-user', ['onboard-users', 'filter-users']), { anchor: 'onboard-users', score: 1 });
  assert.deepEqual(nearestAnchor('starting-the-server', ['starting-the-api-m-server', 'stopping-the-server']), { anchor: 'starting-the-api-m-server', score: 0.5 });
  assert.equal(nearestAnchor('register-an-api-resource', ['register-a-business-api']), null, 'a word is missing');
  assert.equal(nearestAnchor('configure', ['configure-users', 'configure-groups']), null, 'a tie is no suggestion');
});

test('unversioned: custom markdownextradata delimiters, a template-drawn home from the config\'s cards', async () => {
  // A docs-security-shaped project: {{#base_path#}} variables, {{x}} left as
  // written, and a home page with no Markdown (its theme template drew it).
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-unversioned-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-unversioned-'));
  const w = (p, s) => {
    fs.mkdirSync(path.dirname(path.join(src, p)), { recursive: true });
    fs.writeFileSync(path.join(src, p), s);
  };
  w('mkdocs.yml', [
    'site_name: WSO2 Security Documentation',
    'plugins:',
    '  - markdownextradata:',
    '      jinja_options:',
    "        variable_start_string: '{{#'",
    "        variable_end_string: '#}}'",
    'nav:',
    '  - Home: index.md',
    '  - Processes:',
    '    - Vulnerability Management: processes/vulnerability-management.md',
    '  - Announcements:',
    "    - '': announcements/index.md",
    '    - WSO2-1: announcements/wso2-1.md',
    'extra:',
    "  base_path: '/en/latest'",
    '',
  ].join('\n'));
  w('docs/index.md', '---\ntemplate: templates/home-page.html\n---\n\n<!-- drawn by the template -->\n');
  w('docs/processes/vulnerability-management.md', '# Vulnerability management\n\nSee [the advisories]({{#base_path#}}/announcements/).\n');
  w('docs/announcements/index.md', '# Announcements\n\n* [WSO2-1]({{#base_path#}}/announcements/wso2-1/)\n');
  w('docs/announcements/wso2-1.md', '# WSO2-1\n\n<p class="doc-info">Severity: {{severity}}</p>\n\nPlain text.\n');
  const config = {
    ...apim,
    slug: 'sec', sourceRepo: 'wso2/docs-sec', legacyBase: () => 'https://security.docs.wso2.com/en/latest/', legacyHosts: ['security.docs.wso2.com'],
    docspace: { schemaVersion: 1, slug: 'sec', displayName: 'Sec', model: 'unversioned', owners: { team: 't' }, repo: 'wso2/docs-sec' },
    editions: { cloud: { displayName: 'Sec' } },
    topLevel: { Home: { page: 'index' }, Processes: { folder: 'concepts/processes' }, Announcements: { folder: 'reference/announcements' } },
    sectionFolders: {}, pageOverrides: {}, placeholders: {}, typeOverrides: { index: 'concept' }, overrides: null, redirectsPlugin: true,
    variables: { base_path: { remove: true } },
    homeIntro: 'Security resources.',
    homeCards: [{ section: [{ title: 'Announcements', list_items: [{ title: 'All announcements', url: 'Announcements|' }, { title: 'Vulnerability management', url: 'Processes|Vulnerability Management' }] }] }],
  };
  const { summary, report } = await convertProduct({ config, sourceRoot: src, outDir: out, edition: '_', legacyVersion: null, sourceRef: 'wso2/docs-sec@test' });
  assert.equal(summary.compileFailures, 0, JSON.stringify(report.items.filter((i) => i.kind === 'compile')));
  const read = (p) => fs.readFileSync(path.join(out, p), 'utf8');
  assert.match(read('docs/concepts/processes/vulnerability-management.mdx'), /\[the advisories\]\(\.\.\/\.\.\/reference\/announcements\/index\.mdx\)/, '{{#base_path#}} links resolve');
  assert.match(read('docs/reference/announcements/index.mdx'), /\[WSO2-1\]\(\.\/wso2-1\.mdx\)/);
  assert.match(read('docs/reference/announcements/wso2-1.mdx'), /severity/i);
  const home = read('docs/index.mdx');
  assert.match(home, /^layout: overview$/m);
  assert.match(home, /Security resources\./);
  assert.match(home, /## Announcements/);
  assert.match(home, /- \[All announcements\]\(\.\/reference\/announcements\/index\.mdx\)/);
  assert.match(home, /- \[Vulnerability management\]\(\.\/concepts\/processes\/vulnerability-management\.mdx\)/);
  assert.ok(!report.items.some((i) => i.kind === 'broken-link'), JSON.stringify(report.items.filter((i) => i.kind === 'broken-link')));
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});

test('unversioned: a nav-listed 404 page is left out; the config\'s cards replace a template\'s hard-coded home', async () => {
  // A docs-updates-shaped project: `'': page-not-found.md` in the nav, and a
  // home page whose Markdown is the template's inline-SVG cards.
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-updates-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-updates-'));
  const w = (p, s) => {
    fs.mkdirSync(path.dirname(path.join(src, p)), { recursive: true });
    fs.writeFileSync(path.join(src, p), s);
  };
  w('mkdocs.yml', [
    'site_name: WSO2 Updates 2.0 Documentation',
    'nav:',
    '  - Home: index.md',
    '  - Updates:',
    '    - Get Started:',
    '      - Overview: updates/overview.md',
    '    - Hotfixes: updates/hotfixes.md',
    "  - '': page-not-found.md",
    '',
  ].join('\n'));
  w('docs/index.md', '---\ntemplate: templates/home-page.html\n---\n\n# WSO2 Updates Documentation\nWe bring updates.\n\n<div style="display: flex"><a href="updates/overview"><svg><g><line x1="1"/></g></svg>Overview</a></div>\n');
  w('docs/updates/overview.md', '# Overview\n\nAbout updates.\n');
  w('docs/updates/hotfixes.md', '# Hotfixes\n\nAbout hotfixes.\n');
  w('docs/page-not-found.md', '# Page not found\n');
  const config = {
    ...apim,
    slug: 'upd', sourceRepo: 'wso2/docs-upd', legacyBase: () => 'https://updates.docs.wso2.com/en/latest/', legacyHosts: ['updates.docs.wso2.com'],
    docspace: { schemaVersion: 1, slug: 'upd', displayName: 'Upd', model: 'unversioned', owners: { team: 't' }, repo: 'wso2/docs-upd' },
    editions: { cloud: { displayName: 'Upd' } },
    topLevel: { Home: { page: 'index' }, Updates: { folder: 'guides' } },
    sectionFolders: { 'Updates > Get Started': 'get-started' },
    skeleton: [{ folder: 'get-started', label: 'Get started' }, { folder: 'guides', label: 'Guides' }],
    pageOverrides: {}, placeholders: {}, typeOverrides: { index: 'concept' }, overrides: null, redirectsPlugin: false, variables: {},
    excluded: ['page-not-found.md'], redirectToHome: ['page-not-found.md'],
    homeIntro: 'Updates for WSO2 products.',
    homeCards: [{ section: [{ title: 'Start', list_items: [{ title: 'Overview', url: 'Updates|Get Started|Overview' }, { title: 'Hotfixes', url: 'Updates|Hotfixes' }] }] }],
  };
  const { summary, report } = await convertProduct({ config, sourceRoot: src, outDir: out, edition: '_', legacyVersion: null, sourceRef: 'wso2/docs-upd@test' });
  assert.equal(summary.compileFailures, 0, JSON.stringify(report.items.filter((i) => i.kind === 'compile')));
  assert.ok(!fs.existsSync(path.join(out, 'docs/page-not-found.mdx')), 'the 404 page is no page');
  assert.ok(fs.existsSync(path.join(out, 'docs/get-started/overview.mdx')));
  const home = fs.readFileSync(path.join(out, 'docs/index.mdx'), 'utf8');
  assert.match(home, /^layout: overview$/m);
  assert.match(home, /^title: WSO2 Updates 2\.0$/m);
  assert.match(home, /Updates for WSO2 products\./);
  assert.match(home, /- \[Overview\]\(\.\/get-started\/overview\.mdx\)/);
  assert.match(home, /- \[Hotfixes\]\(\.\/guides\/hotfixes\.mdx\)/);
  assert.doesNotMatch(home, /svg|line|We bring updates/, 'the template\'s hard-coded cards are replaced');
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});

test('home cards per Edition: a config function gives each version the cards its own nav has', async () => {
  // docs-open-banking's versions hard-code different cards (3.0.0 has a Data
  // Publishing card 4.0.0 dropped), under navs that differ.
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-cards-src-'));
  const w = (p, s) => {
    fs.mkdirSync(path.dirname(path.join(src, p)), { recursive: true });
    fs.writeFileSync(path.join(src, p), s);
  };
  w('mkdocs.yml', 'site_name: Acc Documentation\nnav:\n  - Home: index.md\n  - Learn:\n    - Consent: learn/consent.md\n    - Data Publishing: learn/data.md\nextra:\n  site_version: 3.0.0\n');
  w('docs/index.md', '<div class="card" onclick="location.href=\'learn/data/\';">Data</div>\n');
  w('docs/learn/consent.md', '# Consent\n\nText.\n');
  w('docs/learn/data.md', '# Data\n\nText.\n');
  const config = {
    ...apim,
    slug: 'acc', sourceRepo: 'wso2/docs-acc', legacyBase: (v) => `https://acc.docs.wso2.com/en/${v}/`, legacyHosts: ['acc.docs.wso2.com'],
    docspace: { schemaVersion: 1, slug: 'acc', displayName: 'Acc', owners: { team: 't' }, repo: 'wso2/docs-acc', editions: [{ id: '3.0.0', branch: 'release/3.0.0' }] },
    editions: { 'self-hosted': { displayName: 'Acc {version}' } },
    topLevel: { Home: { page: 'index' }, Learn: { folder: 'guides' } },
    sectionFolders: {}, skeleton: [{ folder: 'guides', label: 'Guides' }],
    pageOverrides: {}, placeholders: {}, typeOverrides: { index: 'concept' }, overrides: null, redirectsPlugin: false, variables: {},
    excluded: [], redirectToHome: [],
    homeCards: (edition) => [{
      section: [{
        title: 'Learn',
        list_items: [
          { title: 'Consent', url: 'Learn|Consent' },
          ...(edition === '3.0.0' ? [{ title: 'Data publishing', url: 'Learn|Data Publishing' }] : []),
        ],
      }],
    }],
  };
  const run = async (edition) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-cards-'));
    const { summary } = await convertProduct({ config, sourceRoot: src, outDir: out, edition, legacyVersion: edition === 'next' ? null : edition, sourceRef: 'wso2/docs-acc@test' });
    assert.equal(summary.compileFailures, 0);
    const home = fs.readFileSync(path.join(out, 'docs/index.mdx'), 'utf8');
    fs.rmSync(out, { recursive: true, force: true });
    return home;
  };
  const v3 = await run('3.0.0');
  assert.match(v3, /^layout: overview$/m);
  assert.match(v3, /- \[Consent\]\(\.\/guides\/consent\.mdx\)/);
  assert.match(v3, /- \[Data publishing\]\(\.\/guides\/data\.mdx\)/);
  assert.doesNotMatch(v3, /onclick/);
  const next = await run('next');
  assert.match(next, /- \[Consent\]\(\.\/guides\/consent\.mdx\)/);
  assert.doesNotMatch(next, /Data publishing/, 'the function is called with the run\'s Edition');
  fs.rmSync(src, { recursive: true, force: true });
});
