// The MCP endpoint (worker/src/mcp.mjs) and its search scopes, with a fake
// manifest, fake release folders and a fake search backend; the Typesense
// client is checked against a fake fetch. edge-llm.test.mjs runs it in Miniflare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import GithubSlugger from 'github-slugger';
import { fileURLToPath } from 'node:url';
import { TOOLS, handleMcp, twinHeadings, twinKey, twinSection } from '../worker/src/mcp.mjs';
import { ALL_EDITIONS_SORT, EDITION_SORT, INCLUDE_FIELDS, QUERY_BY, QUERY_BY_WEIGHTS, STOPWORDS, STOPWORDS_ID, presentHit, presentPages, searchFilter, searchScope, searchableProducts, typesenseBackend, typesenseFilter } from '../worker/src/search.mjs';
import { collectionSchema, COLLECTIONS, MCP_STOPWORDS, MCP_STOPWORDS_ID } from '../lib/search/schema.mjs';
import { editionFromId } from '../lib/edition.mjs';
import { loadPolicy } from '../lib/manifest.mjs';
import { exportPageTree, parseMdx, printMarkdown } from '../lib/markdown-twin.mjs';
import matter from 'gray-matter';
import { additionsFor, editionVariables, listDocFiles, loadContentRepo } from '../lib/content.mjs';
import { pageShows } from '../lib/edition.mjs';
import { apiPageInfo } from '../lib/api-twin.mjs';
import remarkEdition from '../plugins/remark-edition.mjs';
import remarkLayouts from '../plugins/remark-layouts.mjs';
import remarkDocsLinks from '../plugins/remark-docs-links.mjs';
import { SEARCH_ENVIRONMENTS } from '../lib/search/environments.mjs';
import { searchParameters } from '../lib/search/scopes.mjs';
import { wranglerVars } from '../worker/local.mjs';

const manifest = {
  docSpaces: {
    'identity-platform': {
      displayName: 'WSO2 Identity Platform', model: 'cloud-plus-versions', status: 'live', latest: '7.3.0',
      editionNames: { cloud: 'Identity Platform Cloud', selfHosted: 'Identity Server {version}' },
      editions: [{ id: 'cloud', status: 'live' }, { id: '7.3.0', status: 'live' }, { id: '7.2.0', status: 'end-of-life' }, { id: '7.1.0', status: 'legacy', legacyUrl: 'https://is.docs.wso2.com/en/7.1.0/' }],
      deployments: {
        cloud: { release: 'c1', edition: 'cloud' }, '7.3.0': { release: 'r730', edition: '7.3.0' },
        latest: { release: 'r730', edition: '7.3.0' }, '7.2.0': { release: 'r720', edition: '7.2.0' },
      },
    },
    'api-manager': {
      displayName: 'API Manager', model: 'versions-only', status: 'live', latest: '4.7.0',
      editions: [{ id: '4.7.0', status: 'live' }, { id: '4.6.0', status: 'live' }],
      deployments: { '4.7.0': { release: 'a47', edition: '4.7.0' }, '4.6.0': { release: 'a46', edition: '4.6.0' } },
    },
  },
};
const longPage = ['---', 'title: Passkeys', '# not a heading in front matter', '---', '', '# Passkeys {#passkeys}', '', 'Intro.', '',
  '## Set up passkeys {#set-up-passkeys}', '', 'Step one.', '', '```sh', '# not a heading in code', '```', '', '### On `iOS` devices {#on-ios-devices}', '', 'Tap.', '',
  '#### Linux', '', 'A tab, as a generated heading.', '',
  '## Set up passkeys {#set-up-passkeys-1}', '', 'Again.', '', '## What\'s next? {#whats-next}', '', 'x'.repeat(30_000), ''].join('\n');
const objects = {
  '_releases/identity-platform/cloud/c1/guides/mfa.md': '# MFA (Cloud)\n',
  '_releases/identity-platform/cloud/c1/guides/passkeys.md': longPage,
  '_releases/identity-platform/cloud/c1/llms-full.txt': '# everything\n',
  '_releases/identity-platform/latest/r730/index.md': '# Home (latest)\n',
  '_releases/identity-platform/7.3.0/r730/llms.txt': '# llms 7.3.0\n',
};

function deps(search = null) {
  const calls = [];
  return {
    calls,
    manifest: async () => manifest,
    read: async (key) => objects[key] ?? null,
    search: search && { search: async (q) => { calls.push(q); return search(q); } },
    origin: 'https://docs-staging.wso2.com',
    host: 'docs-staging.wso2.com',
  };
}

async function rpc(d, method, params, id = 1) {
  const res = await handleMcp(new Request('https://docs-staging.wso2.com/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  }), d);
  return { status: res.status, headers: res.headers, body: res.status === 200 ? await res.json() : null };
}
const call = async (d, name, args) => (await rpc(d, 'tools/call', { name, arguments: args })).body.result;

test('initialize, tools/list, ping and the transport rules', async () => {
  const d = deps();
  const init = await rpc(d, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.status, 200);
  assert.equal(init.headers.get('content-type'), 'application/json');
  assert.equal(init.headers.get('access-control-allow-origin'), '*');
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } });
  assert.equal((await rpc(d, 'initialize', { protocolVersion: '1999-01-01' })).body.result.protocolVersion, '2025-11-25', 'unknown versions get the newest');
  const tools = (await rpc(d, 'tools/list')).body.result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['list_editions', 'get_page', 'search_docs']);
  assert.ok(tools.every((t) => t.annotations.readOnlyHint && t.inputSchema.type === 'object' && t.outputSchema.type === 'object'));
  assert.deepEqual(tools.map((t) => t.title), ['List Doc Spaces and Editions', 'Read a Page as Markdown', 'Search WSO2 Docs']);
  const search = tools.find((t) => t.name === 'search_docs').inputSchema.properties;
  assert.deepEqual(search.product.enum, ['identity-platform', 'api-manager'], 'the searchable Doc spaces, read from the manifest');
  assert.equal(search.docSpace.enum, undefined, 'the old name stays open');
  assert.deepEqual([search.limit.maximum, search.limit.default], [10, 5]);
  const broken = { ...d, manifest: async () => { throw new Error('no manifest'); } };
  const bare = (await rpc(broken, 'tools/list')).body.result.tools;
  assert.deepEqual(bare.map((t) => t.name), ['list_editions', 'get_page', 'search_docs'], 'no manifest: the tools, without product choices');
  assert.equal(bare[2].inputSchema.properties.product.enum, undefined);
  // The chrome's words: "newest release", never the first map's "latest release".
  for (const t of tools) assert.doesNotMatch(JSON.stringify(t), /latest release/i, t.name);
  assert.deepEqual((await rpc(d, 'ping')).body.result, {});
  assert.equal((await rpc(d, 'resources/list')).body.error.code, -32601);
  assert.equal((await rpc(d, 'tools/call', { name: 'delete_docs', arguments: {} })).body.error.code, -32602);

  const note = await handleMcp(new Request('https://x/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), d);
  assert.equal(note.status, 202);
  assert.equal((await handleMcp(new Request('https://x/mcp'), d)).status, 405, 'no server-sent event stream');
  assert.equal((await handleMcp(new Request('https://x/mcp', { method: 'OPTIONS' }), d)).status, 204);
  const bad = await handleMcp(new Request('https://x/mcp', { method: 'POST', body: '{nope' }), d);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);
  const batch = await handleMcp(new Request('https://x/mcp', { method: 'POST', body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]) }), d);
  assert.deepEqual(await batch.json(), [{ jsonrpc: '2.0', id: 1, result: {} }]);
  assert.equal(TOOLS.length, 3);
});

test('list_editions reads the manifest', async () => {
  const r = await call(deps(), 'list_editions', {});
  const ip = r.structuredContent.docSpaces.find((s) => s.docSpace === 'identity-platform');
  assert.equal(ip.latest, '7.3.0');
  assert.deepEqual(ip.editions.find((e) => e.id === 'cloud'), { id: 'cloud', name: 'Identity Platform Cloud', status: 'live', url: 'https://docs-staging.wso2.com/identity-platform/cloud/', llmsTxt: 'https://docs-staging.wso2.com/identity-platform/cloud/llms.txt' });
  assert.equal(ip.editions.find((e) => e.id === '7.2.0').status, 'end-of-life');
  assert.equal(ip.editions.find((e) => e.id === '7.1.0').legacyUrl, 'https://is.docs.wso2.com/en/7.1.0/');
  assert.deepEqual(ip.editions.find((e) => e.id === 'latest'), { id: 'latest', feeds: '7.3.0', url: 'https://docs-staging.wso2.com/identity-platform/latest/', llmsTxt: 'https://docs-staging.wso2.com/identity-platform/latest/llms.txt' });
  assert.equal((await call(deps(), 'list_editions', { docSpace: 'api-manager' })).structuredContent.docSpaces.length, 1);
  assert.equal((await call(deps(), 'list_editions', { docSpace: 'nope' })).isError, true);
});

test('get_page returns the Markdown twin for any form of the page URL', async () => {
  for (const url of ['https://docs.wso2.com/identity-platform/cloud/guides/mfa/', 'https://docs-staging.wso2.com/identity-platform/cloud/guides/mfa', '/identity-platform/cloud/guides/mfa.md', 'https://docs.wso2.com/identity-platform/cloud/guides/mfa/#choose-a-factor']) {
    const r = await call(deps(), 'get_page', { url });
    assert.equal(r.content[0].text, '# MFA (Cloud)\n', url);
  }
  assert.equal((await call(deps(), 'get_page', { url: 'https://docs.wso2.com/identity-platform/latest/' })).content[0].text, '# Home (latest)\n');
  assert.equal((await call(deps(), 'get_page', { url: '/identity-platform/7.3.0/llms.txt' })).content[0].text, '# llms 7.3.0\n');
  const missing = await call(deps(), 'get_page', { url: '/identity-platform/cloud/guides/nope/' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /No Markdown page at https:\/\/docs-staging\.wso2\.com\/identity-platform\/cloud\/guides\/nope\.md/);
  assert.match((await call(deps(), 'get_page', { url: 'https://example.com/x/' })).content[0].text, /not WSO2 Docs/);
  assert.match((await call(deps(), 'get_page', { url: '/identity-platform/9.9.9/x/' })).content[0].text, /not on a deployed Edition/);
  assert.equal(twinKey(manifest, '/identity-platform/7.3.0/', 'x').key, '_releases/identity-platform/7.3.0/r730/index.md');
  const full = await call(deps(), 'get_page', { url: '/identity-platform/cloud/llms-full.txt' });
  assert.equal(full.isError, true);
  assert.match(full.content[0].text, /llms-full\.txt .*Use search_docs, or get_page on a page/);
});

test('get_page returns structured content, one section, and cuts long pages', async () => {
  const mfa = await call(deps(), 'get_page', { url: 'https://docs.wso2.com/identity-platform/cloud/guides/mfa/' });
  assert.deepEqual(mfa.structuredContent, { url: 'https://docs-staging.wso2.com/identity-platform/cloud/guides/mfa/', text: '# MFA (Cloud)\n', truncated: false });
  const url = 'https://docs.wso2.com/identity-platform/cloud/guides/passkeys/';
  const whole = await call(deps(), 'get_page', { url });
  assert.equal(whole.structuredContent.truncated, true, 'the default is 20,000 characters');
  assert.equal(whole.content[0].text, whole.structuredContent.text);
  assert.ok(whole.structuredContent.text.endsWith('\n\n[Cut at 20000 characters. Use section or a larger maxChars.]'));
  assert.equal(whole.structuredContent.text.indexOf('\n\n[Cut'), 20_000);
  assert.equal((await call(deps(), 'get_page', { url, maxChars: 100_000 })).structuredContent.truncated, false);

  const first = await call(deps(), 'get_page', { url, section: '#set-up-passkeys' });
  assert.equal(first.structuredContent.text, '## Set up passkeys {#set-up-passkeys}\n\nStep one.\n\n```sh\n# not a heading in code\n```\n\n### On `iOS` devices {#on-ios-devices}\n\nTap.\n\n#### Linux\n\nA tab, as a generated heading.', 'to the next heading of the same or a higher level');
  assert.equal((await call(deps(), 'get_page', { url, section: 'on-ios-devices' })).structuredContent.text, '### On `iOS` devices {#on-ios-devices}\n\nTap.\n\n#### Linux\n\nA tab, as a generated heading.');
  assert.equal((await call(deps(), 'get_page', { url, section: 'set-up-passkeys-1' })).structuredContent.text, '## Set up passkeys {#set-up-passkeys-1}\n\nAgain.');
  const next = await call(deps(), 'get_page', { url, section: 'whats-next', maxChars: 1000 });
  assert.equal(next.structuredContent.truncated, true);
  assert.match(next.structuredContent.text, /^## What's next\? \{#whats-next\}\n\nxxx/);
  const missing = await call(deps(), 'get_page', { url, section: 'nope' });
  assert.equal(missing.isError, true);
  assert.equal(missing.content[0].text, 'No section "nope" on this page. Its sections: passkeys, set-up-passkeys, on-ios-devices, set-up-passkeys-1, whats-next.');
  for (const maxChars of [999, 100_001, 5.5, '2000']) assert.equal((await call(deps(), 'get_page', { url, maxChars })).isError, true, String(maxChars));
  assert.equal((await call(deps(), 'get_page', { url, section: '#' })).isError, true);
  assert.equal((await call(deps(), 'get_page', { url, section: 'linux' })).isError, true, 'a generated heading has no anchor');

  // The URL read is the page's own address on this host, whatever form it was asked for in.
  for (const asked of ['//identity-platform/cloud/guides/mfa', '/identity-platform//cloud/guides/mfa.md', 'https://docs.wso2.com/identity-platform/cloud/guides/mfa?x=1#y']) {
    assert.equal((await call(deps(), 'get_page', { url: asked })).structuredContent.url, 'https://docs-staging.wso2.com/identity-platform/cloud/guides/mfa/', asked);
  }
  assert.equal((await call(deps(), 'get_page', { url: '/identity-platform/7.3.0/llms.txt' })).structuredContent.url, 'https://docs-staging.wso2.com/identity-platform/7.3.0/llms.txt');
  assert.equal((await call(deps(), 'get_page', { url: '//evil.test/identity-platform/' })).isError, true);
});

// The ids the site gives a page's headings: its MDX through the Platform's
// remark steps, then Docusaurus's own headings plugin, once per file; an
// imported partial's ids where it is used, numbered on their own.
const docusaurusHeadings = createRequire(import.meta.url)('@docusaurus/mdx-loader/lib/remark/headings').default;
async function siteIds(file, opts, isPage = true) {
  const { content, data } = matter(fs.readFileSync(file, 'utf8'));
  const tree = parseMdx(content);
  const vfile = { path: file, data: { frontMatter: isPage ? data : {} } };
  remarkEdition({ edition: opts.edition, vars: opts.vars, showMarkers: false, substituteCode: !opts.edition.unversioned, additions: opts.additions ?? null })(tree, vfile);
  remarkLayouts({ edition: opts.edition, docsDir: opts.docsDir })(tree, vfile);
  remarkDocsLinks({ policy: opts.policy, host: opts.linkHost })(tree, vfile);
  await docusaurusHeadings({ anchorsMaintainCase: false })(tree);
  const partials = new Map();
  const ids = [];
  const walk = async (n) => {
    if (n.type === 'mdxjsEsm') for (const m of n.value.matchAll(/import\s+(\w+)\s+from\s+['"](\.{1,2}\/[^'"]+\.mdx?)['"]/g)) partials.set(m[1], path.resolve(path.dirname(file), m[2]));
    if (n.type === 'heading') ids.push(n.data.id);
    if ((n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') && partials.has(n.name)) ids.push(...await siteIds(partials.get(n.name), opts, false));
    for (const c of n.children ?? []) await walk(c);
  };
  await walk(tree);
  return ids;
}
const twinOf = (file, opts) => printMarkdown(exportPageTree(file, opts, { resolveLink: (u) => u, resolveImage: (u) => u, siblingPages: () => [] }));
const twinIds = (md) => twinHeadings(md).headings.map((h) => h.anchor).filter(Boolean);

test('a twin carries the id the page gives each of its headings, and no other', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-mcp-twin-'));
  fs.writeFileSync(path.join(dir, '_steps.mdx'), '## Steps\n\n## Steps\n\n### What\'s next?\n');
  fs.writeFileSync(path.join(dir, 'page.mdx'), `import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import Steps from './_steps.mdx';

## MDX compile {#compile}

## Using _custom_ claims and the \`_id_\` field

## Use \\<String\\> values

## Comment id {/* #a*b */}

## Spaced id {# my-id }

## What's next?

## What's next?

<Steps />

## Steps

<Tabs>
<TabItem value="linux" label="Linux">

### Install

</TabItem>
<TabItem value="windows" label="Windows">

### Install

</TabItem>
</Tabs>

\`\`\`\`md
## Not a heading
\`\`\`
## Still not a heading
\`\`\`
\`\`\`\`

## {#only-id}

## Lead {#_lead}
`);
  const opts = { edition: editionFromId('7.3.0'), vars: { id: '7.3.0' }, policy: loadPolicy(), linkHost: 'https://docs.wso2.com', docsDir: dir };
  const twin = twinOf(path.join(dir, 'page.mdx'), opts);
  const ids = await siteIds(path.join(dir, 'page.mdx'), opts);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(twinIds(twin), ids);
  assert.deepEqual(ids, ['compile', 'using-custom-claims-and-the-_id_-field', 'use-string-values', 'a*b', 'my-id', 'whats-next', 'whats-next-1',
    'steps', 'steps-1', 'whats-next', 'steps', 'install', 'install-1', 'only-id', '_lead'], 'a partial numbers its own headings; explicit ids are never numbered');
  assert.match(twin, /^## \{#only-id\}$/m, 'a heading of an id alone');
  assert.match(twin, /^#{2,3} Linux$/m, 'a tab label is a heading with no id');
  assert.match(twin, /^## Lead \{#_lead\}$/m, 'the id as written, unescaped');
  for (const id of new Set(ids)) assert.match(twinSection(twin, id).text ?? '', /^#{2,3} /, `get_page section "${id}"`);
  const d = deps();
  d.read = async () => twin;
  assert.equal((await call(d, 'get_page', { url: '/identity-platform/cloud/guides/mfa/', section: 'only-id' })).structuredContent.text, '## {#only-id}');
});

test('every heading of every page in the repo\'s Content gets the id the site gives it', async (t) => {
  const policy = loadPolicy();
  const repos = [
    ['fixtures/stub-repo/identity-server', '7.3.0'], ['fixtures/stub-repo/identity-server', 'cloud'],
    ['fixtures/stub-repo/identity-platform', 'cloud'], ['standards/contribute', '_'],
  ];
  let pages = 0;
  let ids = 0;
  for (const [dir, id] of repos) {
    const repo = loadContentRepo(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', dir));
    const edition = editionFromId(id);
    const additions = additionsFor(repo, edition);
    const opts = { edition, vars: editionVariables(repo, edition), policy, linkHost: 'https://docs.wso2.com', docsDir: repo.docsDir, additions: additions && { ...additions, base: '/x/' } };
    for (const file of listDocFiles(repo.docsDir)) {
      const fm = matter(fs.readFileSync(file, 'utf8')).data;
      if (path.relative(repo.docsDir, file).split(path.sep).some((p) => p.startsWith('_'))) continue;
      if (!pageShows(edition, fm, additions?.newestRelease) || apiPageInfo(file, fm, { docsDir: repo.docsDir, editionKind: edition.kind })) continue;
      const site = await siteIds(file, opts);
      assert.deepEqual(twinIds(twinOf(file, opts)), site, `${dir} ${id}: ${path.relative(repo.docsDir, file)}`);
      pages += 1;
      ids += site.length;
    }
  }
  t.diagnostic(`${pages} pages, ${ids} ids`);
  assert.ok(pages > 80 && ids > 400, `${pages} pages, ${ids} ids`);
});

test('an older twin, with no ids, still finds its sections by the headings\' slugged text', () => {
  const titles = ['Set up passkeys', 'What\'s next?', 'What\'s next?', 'On `iOS` devices', 'Use [OAuth 2.0](https://x.test/) flows', 'Using _custom_ claims',
    'The `_id_` field', 'Use \\<String\\> values', 'Ünïcode & spaces  twice', 'C# and .NET', 'snake_case and kebab-case'];
  const md = ['---', 'title: Old', '---', '', ...titles.flatMap((t, i) => [`${'#'.repeat(1 + (i % 3))} ${t}`, '', 'Text.', ''])].join('\n');
  const slugger = new GithubSlugger();
  const site = ['set-up-passkeys', 'whats-next', 'whats-next-1', 'on-ios-devices', 'use-oauth-20-flows', 'using-custom-claims',
    'the-_id_-field', 'use-string-values', 'ünïcode--spaces--twice', 'c-and-net', 'snake_case-and-kebab-case'];
  assert.deepEqual(site, ['Set up passkeys', 'What\'s next?', 'What\'s next?', 'On iOS devices', 'Use OAuth 2.0 flows', 'Using custom claims',
    'The _id_ field', 'Use <String> values', 'Ünïcode & spaces  twice', 'C# and .NET', 'snake_case and kebab-case'].map((t) => slugger.slug(t)), 'what the site makes of each');
  assert.deepEqual(twinIds(md), site);
  assert.equal(twinSection(md, 'whats-next-1').text, '### What\'s next?\n\nText.');
  // With ids, only ids count: a heading without one is not found by its text.
  const withIds = '## Install {#install}\n\nA.\n\n### Linux\n\nB.\n';
  assert.deepEqual(twinIds(withIds), ['install']);
  assert.match(twinSection(withIds, 'linux').error, /No section "linux"/);
});

test('twin code fences follow CommonMark: same character, at least as long, nothing after; no backtick in a backtick fence\'s info', () => {
  const anchors = (md) => twinIds(md);
  assert.deepEqual(anchors('````md\n```\n## In {#in}\n```\n````\n## Out {#out}\n'), ['out']);
  assert.deepEqual(anchors('```\n~~~\n## In {#in}\n``` js\n## In too {#in2}\n```\n## Out {#out}\n'), ['out']);
  assert.deepEqual(anchors('~~~~\n## In {#in}\n~~~\n## In too {#in2}\n~~~~~\n## Out {#out}\n'), ['out']);
  assert.deepEqual(anchors('``` js `x`\n## Not fenced {#a}\n'), ['a'], 'a backtick in the info string: not a fence');
  assert.deepEqual(anchors('~~~ js `x`\n## In {#in}\n~~~\n## Out {#out}\n'), ['out'], 'a tilde fence may have one');
});

test('search scopes: This Edition, all Editions of a Doc space, all of WSO2 Docs', () => {
  assert.deepEqual(searchScope(manifest, { docSpace: 'identity-platform', edition: '7.2.0' }), { pairs: [{ docSpace: 'identity-platform', editions: ['7.2.0'] }], explicit: true }, 'end of life only under This Edition');
  assert.deepEqual(searchScope(manifest, { docSpace: 'identity-platform', edition: 'latest' }), { pairs: [{ docSpace: 'identity-platform', editions: ['7.3.0'] }], explicit: false });
  assert.deepEqual(searchScope(manifest, { docSpace: 'identity-platform' }).pairs, [{ docSpace: 'identity-platform', editions: ['cloud', '7.3.0'] }]);
  assert.deepEqual(searchScope(manifest, {}).pairs, [{ docSpace: 'identity-platform', editions: ['cloud'] }, { docSpace: 'api-manager', editions: ['4.7.0'] }], 'one Edition per Doc space: where its selector opens (Cloud first, as the search box)');
  assert.match(searchScope(manifest, { edition: '7.3.0' }).error, /Edition "7\.3\.0" needs "product" too; only "cloud" searches every product/);
  assert.deepEqual(searchScope(manifest, { edition: 'cloud' }), { pairs: [{ docSpace: 'identity-platform', editions: ['cloud'] }], explicit: true }, 'Cloud of every product that has one');
  const noCloud = structuredClone(manifest);
  delete noCloud.docSpaces['identity-platform'].deployments.cloud;
  assert.match(searchScope(noCloud, { edition: 'cloud' }).error, /No product has a Cloud Edition/, 'never an empty scope, which would search everything');
  assert.equal(searchScope(manifest, { docSpace: 'nope' }).error, 'Unknown product "nope". Valid: identity-platform, api-manager');
  assert.match(searchScope(manifest, { docSpace: 'identity-platform', edition: '7.1.0' }).error, /no Edition "7.1.0"/);
  assert.equal(typesenseFilter(searchScope(manifest, {}).pairs), '(docSpace:=`identity-platform` && edition:=[`cloud`]) || (docSpace:=`api-manager` && edition:=[`4.7.0`])');
  // A component whose Cloud is a Cloud part, an Unlisted Doc space, and Contribute (Unlisted but indexed).
  const m = structuredClone(manifest);
  m.docSpaces['identity-server'] = {
    displayName: 'Identity Server', model: 'versions-only', status: 'live', latest: '7.3.0', cloud: { in: 'identity-platform' },
    editions: [{ id: '7.3.0', status: 'live' }], deployments: { '7.3.0': { release: 'x', edition: '7.3.0' }, latest: { release: 'x', edition: '7.3.0' } },
  };
  m.docSpaces.sandbox = { displayName: 'Docs Sandbox', model: 'cloud-plus-versions', status: 'live', latest: '1.0.0', listed: false, editions: [{ id: '1.0.0', status: 'live' }], deployments: { '1.0.0': { release: 's', edition: '1.0.0' } } };
  m.docSpaces.contribute = { displayName: 'Contribute', model: 'unversioned', status: 'live', latest: null, listed: false, indexed: true, editions: [], deployments: { _: { release: 'v1', edition: '_' } } };
  assert.deepEqual(searchScope(m, { docSpace: 'identity-server' }).pairs, [{ docSpace: 'identity-server', editions: ['cloud', '7.3.0'] }], 'its Cloud part is its Cloud');
  assert.deepEqual(searchScope(m, { docSpace: 'identity-server', edition: 'cloud' }).pairs, [{ docSpace: 'identity-server', editions: ['cloud'] }]);
  const wide = searchScope(m, {}).pairs;
  assert.deepEqual(wide.map((p) => `${p.docSpace}/${p.editions}`), ['identity-platform/cloud', 'api-manager/4.7.0', 'identity-server/cloud', 'contribute/_'], 'no Sandbox; Contribute in');
  assert.deepEqual(searchScope(m, { docSpace: 'sandbox' }).pairs, [{ docSpace: 'sandbox', editions: ['1.0.0'] }], 'an Unlisted Doc space searches itself');
  assert.deepEqual(searchableProducts(m), ['identity-platform', 'api-manager', 'identity-server', 'contribute'], 'not the Unlisted Sandbox');
  assert.deepEqual(searchScope(m, { docSpace: 'identity-platform' }).pairs, [{ docSpace: 'identity-platform', editions: ['cloud', '7.3.0'] }, { docSpace: 'identity-server', editions: ['cloud'] }], 'a family Cloud covers its Cloud parts');
  assert.deepEqual(searchScope(m, { docSpace: 'identity-platform', edition: 'cloud' }).pairs.map((p) => p.docSpace), ['identity-platform', 'identity-server']);
  assert.deepEqual(searchScope(m, { docSpace: 'identity-platform', edition: '7.3.0' }).pairs, [{ docSpace: 'identity-platform', editions: ['7.3.0'] }], 'a version has no Cloud parts');
  assert.deepEqual(searchScope(m, { edition: 'cloud' }).pairs, [{ docSpace: 'identity-platform', editions: ['cloud'] }, { docSpace: 'identity-server', editions: ['cloud'] }], 'every Cloud, Cloud parts included');
  const unlistedPart = structuredClone(m);
  unlistedPart.docSpaces['identity-server'].listed = false;
  assert.deepEqual(searchScope(unlistedPart, { docSpace: 'identity-platform', edition: 'cloud' }).pairs.map((p) => p.docSpace), ['identity-platform'], 'an Unlisted Cloud part searches only itself');
  assert.equal(searchScope(m, { docSpace: 'identity-server' }).allEditions, true, 'all Editions of a Doc space: newer ones rank first');
  assert.equal(searchScope(m, { docSpace: 'identity-server', edition: 'cloud' }).allEditions, undefined);
  delete m.docSpaces['identity-platform'].deployments.cloud;
  assert.deepEqual(searchScope(m, { docSpace: 'identity-server' }).pairs, [{ docSpace: 'identity-server', editions: ['7.3.0'] }], 'no Cloud tree deployed: no Cloud');

  const hit = { url: 'https://docs.wso2.com/identity-platform/7.3.0/guides/mfa/#choose-a-factor', docSpace: 'identity-platform', edition: '7.3.0', hierarchy: { lvl1: 'MFA', lvl2: 'Choose a factor' }, content: 'Pick TOTP' };
  const shown = presentHit(manifest, hit, { explicit: false, origin: 'https://docs-staging.wso2.com' });
  assert.deepEqual(shown, {
    title: 'MFA',
    url: 'https://docs-staging.wso2.com/identity-platform/latest/guides/mfa/',
    markdownUrl: 'https://docs-staging.wso2.com/identity-platform/latest/guides/mfa.md',
    product: 'identity-platform', docSpace: 'identity-platform', edition: '7.3.0', selfHosted: false,
    section: { heading: 'Choose a factor', url: 'https://docs-staging.wso2.com/identity-platform/latest/guides/mfa/#choose-a-factor', text: 'Pick TOTP' },
  }, 'the Edition feeding latest is shown at /latest/');
  assert.equal(presentHit(manifest, hit, { explicit: true, origin: 'https://docs-staging.wso2.com' }).section.url, 'https://docs-staging.wso2.com/identity-platform/7.3.0/guides/mfa/#choose-a-factor');
  assert.equal(presentHit(manifest, { ...hit, hierarchy: { lvl1: 'MFA', lvl2: 'A', lvl3: 'B' } }, { explicit: true, origin: 'https://x.test' }).section.heading, 'A › B');
  assert.equal(presentHit(manifest, { ...hit, hierarchy: { lvl1: 'MFA' } }, { explicit: true, origin: 'https://x.test' }).section.heading, 'MFA', 'a page-level hit');
  assert.equal(presentHit(manifest, { ...hit, hierarchy: {}, content: 'y'.repeat(3000) }, { explicit: true, origin: 'https://x.test' }).title, 'https://x.test/identity-platform/7.3.0/guides/mfa/');
  assert.equal(presentHit(manifest, { ...hit, content: 'y'.repeat(3000) }, { explicit: true, origin: 'https://x.test' }).section.text.length, 2000);
  assert.equal(presentHit(manifest, { ...hit, url: 'https://docs.wso2.com/identity-platform/7.3.0/' }, { explicit: true, origin: 'https://x.test' }).markdownUrl, 'https://x.test/identity-platform/7.3.0/index.md');
});

test('search_docs through a fake backend', async () => {
  const rl = 'https://docs.wso2.com/api-manager/4.7.0/guides/rate-limits/';
  const d = deps(() => [
    { url: `${rl}#per-minute`, docSpace: 'api-manager', edition: '4.7.0', hierarchy: { lvl1: 'Rate limits', lvl2: 'Per minute' }, content: `Limit calls per minute. ${'More words here. '.repeat(40)}` },
    { url: rl, docSpace: 'api-manager', edition: '4.7.0', hierarchy: { lvl1: 'Rate limits' }, content: 'Intro.' },
    { url: 'https://docs.wso2.com/api-manager/4.6.0/guides/rate-limits/', docSpace: 'api-manager', edition: '4.6.0', hierarchy: { lvl1: 'Rate limits' }, content: '' },
    { url: `${rl}#burst`, docSpace: 'api-manager', edition: '4.7.0', hierarchy: { lvl1: 'Rate limits', lvl2: 'Burst' }, content: 'Burst.' },
    { url: `${rl}#spike`, docSpace: 'api-manager', edition: '4.7.0', hierarchy: { lvl1: 'Rate limits', lvl2: 'Spike' }, content: 'Spike.' },
  ]);
  const r = await call(d, 'search_docs', { query: ' rate limit ', product: 'api-manager' });
  assert.equal(r.isError, undefined);
  assert.deepEqual(d.calls[0], { query: 'rate limit', scope: { pairs: [{ docSpace: 'api-manager', editions: ['4.7.0', '4.6.0'] }], explicit: false, allEditions: true }, limit: 5, includeSelfHosted: false });
  const [top, older] = r.structuredContent.results;
  assert.equal(r.structuredContent.results.length, 2, 'one result per page');
  assert.equal(top.markdownUrl, 'https://docs-staging.wso2.com/api-manager/4.7.0/guides/rate-limits.md');
  assert.equal(top.url, 'https://docs-staging.wso2.com/api-manager/4.7.0/guides/rate-limits/');
  assert.deepEqual(top.section.heading, 'Per minute');
  assert.deepEqual(top.moreSections, [
    { heading: 'Rate limits', url: 'https://docs-staging.wso2.com/api-manager/4.7.0/guides/rate-limits/' },
    { heading: 'Burst', url: 'https://docs-staging.wso2.com/api-manager/4.7.0/guides/rate-limits/#burst' },
  ], 'at most two more sections');
  assert.equal(older.edition, '4.6.0');
  const [item1, item2] = r.content[0].text.split('\n2. ');
  const lines = item1.split('\n');
  assert.deepEqual(lines.slice(0, 2), ['1. Rate limits (api-manager 4.7.0)', '   https://docs-staging.wso2.com/api-manager/4.7.0/guides/rate-limits/ (Markdown: https://docs-staging.wso2.com/api-manager/4.7.0/guides/rate-limits.md)']);
  assert.match(lines[2], /^ {3}Per minute \(#per-minute\): Limit calls per minute\. More words.*…$/, 'the section with its anchor for get_page');
  assert.ok(lines[2].length < 340, 'the text form cuts the section to about 300 characters');
  assert.equal(lines[3], '   Also: Rate limits; Burst (#burst)', 'the other sections, with their anchors');
  assert.equal(item2, 'Rate limits (api-manager 4.6.0)\n   https://docs-staging.wso2.com/api-manager/4.6.0/guides/rate-limits/ (Markdown: https://docs-staging.wso2.com/api-manager/4.6.0/guides/rate-limits.md)\n   Rate limits');
  assert.equal((await call(d, 'search_docs', { query: 'x', product: 'api-manager', limit: 1 })).structuredContent.results.length, 1);
  assert.deepEqual(d.calls.at(-1).limit, 1);

  await call(d, 'search_docs', { query: 'x', docSpace: 'api-manager', includeSelfHosted: true });
  assert.deepEqual([d.calls.at(-1).scope.pairs[0].docSpace, d.calls.at(-1).includeSelfHosted], ['api-manager', true], 'docSpace is the old name of product');
  await call(d, 'search_docs', { query: 'x', product: 'api-manager', docSpace: 'api-manager' });
  assert.match((await call(d, 'search_docs', { query: 'x', product: 'api-manager', docSpace: 'identity-platform' })).content[0].text, /old name of "product" and they differ/);
  assert.match((await call(d, 'search_docs', { query: 'x', product: 'nope' })).content[0].text, /^Unknown product "nope"\. Valid: identity-platform, api-manager$/);
  await call(d, 'search_docs', { query: 'x', edition: 'cloud' });
  assert.deepEqual(d.calls.at(-1).scope, { pairs: [{ docSpace: 'identity-platform', editions: ['cloud'] }], explicit: true });
  for (const bad of [{ limit: 0 }, { limit: 11 }, { limit: 2.5 }, { includeSelfHosted: 'yes' }, { query: 'x'.repeat(201) }, { query: '  ' }, { edition: 7 }]) {
    assert.equal((await call(d, 'search_docs', { query: 'x', ...bad })).isError, true, JSON.stringify(bad));
  }
  assert.equal((await call(deps(), 'search_docs', { query: 'x' })).isError, true, 'no backend configured');
  assert.equal((await call(deps(() => { throw new Error('boom'); }), 'search_docs', { query: 'x' })).isError, true);

  // A Cloud part's hit belongs to its family Cloud; a Self-hosted addition says so.
  const part = deps(() => [{ url: 'https://docs.wso2.com/identity-platform/cloud/identity-server/guides/mfa/', docSpace: 'identity-server', edition: 'cloud', cloudIn: 'identity-platform', selfHosted: true, hierarchy: { lvl1: 'MFA' }, content: 'x' }]);
  const shown = (await call(part, 'search_docs', { query: 'mfa', includeSelfHosted: true })).structuredContent.results[0];
  assert.deepEqual([shown.product, shown.docSpace, shown.selfHosted], ['identity-platform', 'identity-server', true]);
});

test('search_docs logs no query text', async () => {
  const logged = [];
  const saved = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map((k) => [k, console[k]]));
  for (const k of Object.keys(saved)) console[k] = (...a) => logged.push(a.map(String).join(' '));
  try {
    await call(deps(() => []), 'search_docs', { query: 'secret-ish words' });
    await call(deps(() => { throw new Error('boom'); }), 'search_docs', { query: 'secret-ish words' });
  } finally {
    Object.assign(console, saved);
  }
  assert.ok(!logged.some((l) => l.includes('secret-ish')), logged.join('\n'));
});

const doc = (url) => ({ document: { url, docSpace: 'identity-platform', edition: 'cloud', lvl1: 'MFA', content: 'Second factor' } });
const MFA = 'https://docs.wso2.com/identity-platform/cloud/guides/mfa/';
function fakeTypesense(...answers) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: new URL(url), init, search: JSON.parse(init.body).searches[0] });
    return Response.json({ results: [answers[Math.min(requests.length, answers.length) - 1]] });
  };
  return { requests, backend: typesenseBackend({ host: 'https://search.test/', apiKey: 'search-only', collection: 'wso2-docs', fetchImpl }) };
}

test('the Typesense client posts the query to /multi_search with the scope as a filter and a search-only key', async () => {
  const { requests, backend } = fakeTypesense({ grouped_hits: [{ group_key: ['identity-platform', 'cloud', 'guides/mfa/'], hits: [doc(`${MFA}#a`), doc(MFA)] }, { hits: [doc(`${MFA.replace('mfa', 'sso')}`)] }] });
  const hits = await backend.search({ query: 'factor', scope: searchScope(manifest, { docSpace: 'identity-platform', edition: 'cloud' }), limit: 3 });
  const { url, init, search } = requests[0];
  assert.equal(`${url}`, 'https://search.test/multi_search', 'the query is in the body, never in a URL an access log records');
  assert.equal(init.method, 'POST');
  assert.deepEqual(search, {
    collection: 'wso2-docs', q: 'factor', query_by: QUERY_BY, query_by_weights: QUERY_BY_WEIGHTS, text_match_type: 'max_weight', prioritize_exact_match: true,
    include_fields: INCLUDE_FIELDS, highlight_fields: 'none', enable_analytics: false,
    filter_by: '((docSpace:=`identity-platform` && edition:=[`cloud`])) && selfHosted:!=true',
    sort_by: EDITION_SORT, stopwords: STOPWORDS_ID, group_by: 'docSpace,edition,page', group_limit: 3, per_page: 3,
  }, 'per_page counts pages; analytics off for agents');
  assert.equal(init.headers['x-typesense-api-key'], 'search-only');
  assert.deepEqual(hits.map((h) => h.url.split('/guides/')[1]), ['mfa/#a', 'mfa/', 'sso/'], 'groups flattened in order');
  assert.deepEqual(hits[0].hierarchy, { lvl0: null, lvl1: 'MFA', lvl2: null, lvl3: null });
  assert.deepEqual(presentPages(manifest, hits, { explicit: true, origin: 'https://x.test', limit: 3 }).map((p) => p.moreSections.length), [1, 0]);
  await backend.search({ query: 'factor', scope: { pairs: [] }, includeSelfHosted: true });
  assert.equal(requests[1].search.filter_by, undefined);
  await backend.search({ query: 'factor', scope: searchScope(manifest, { docSpace: 'identity-platform' }) });
  assert.equal(requests[2].search.sort_by, ALL_EDITIONS_SORT);
  assert.equal(ALL_EDITIONS_SORT, searchParameters('docspace').sort_by, 'the search box\'s All Editions order');
  assert.equal(EDITION_SORT, searchParameters('edition').sort_by, 'the search box\'s one-Edition order');
  assert.equal(searchParameters('edition').prioritize_exact_match, true);
  assert.equal(requests[1].search.per_page, 5);
  assert.equal(searchFilter({ pairs: [] }), 'selfHosted:!=true');
});

test('a query of question words only keeps them', async () => {
  const { requests, backend } = fakeTypesense({ hits: [] });
  await backend.search({ query: 'How do I?', scope: { pairs: [] } });
  await backend.search({ query: 'How do I enable SSO?', scope: { pairs: [] } });
  await backend.search({ query: 'how-to', scope: { pairs: [] } });
  await backend.search({ query: 'what_does/to.do', scope: { pairs: [] } });
  await backend.search({ query: 'how-to SSO', scope: { pairs: [] } });
  assert.deepEqual(requests.map((r) => r.search.stopwords), [undefined, STOPWORDS_ID, undefined, undefined, STOPWORDS_ID], 'words split on the collection\'s token separators');
});

test('before search-setup has run, search_docs searches without stop words and grouping, and groups by page itself', async () => {
  for (const error of [{ code: 404, error: 'Could not find the stopword set named `wso2docs-question-words`.' }, { code: 400, error: 'Group by field `page` should be a facet field.' }]) {
    const { requests, backend } = fakeTypesense(error, { hits: [doc(`${MFA}#a`), doc(`${MFA}#b`), doc(`${MFA}#c`), doc(`${MFA}#d`), doc(MFA.replace('mfa', 'sso'))] });
    const hits = await backend.search({ query: 'factor', scope: { pairs: [] }, limit: 2 });
    assert.equal(requests.length, 2, error.error);
    const [, again] = requests;
    assert.deepEqual([again.search.stopwords, again.search.group_by, again.search.group_limit, again.search.per_page, again.search.enable_analytics], [undefined, undefined, undefined, 40, false]);
    const pages = presentPages(manifest, hits, { explicit: true, origin: 'https://x.test', limit: 2 });
    assert.deepEqual(pages.map((p) => [p.url.split('/guides/')[1], p.moreSections.length]), [['mfa/', 2], ['sso/', 0]]);
  }
  // One page with many hits still leaves room for the others.
  const many = [...Array(45)].map((_, i) => doc(`${MFA}#s${i}`));
  const dominated = fakeTypesense({ code: 404, error: 'Could not find the stopword set named `wso2docs-question-words`.' }, { hits: [...many, doc(MFA.replace('mfa', 'sso')), doc(MFA.replace('mfa', 'otp'))] });
  const pages = presentPages(manifest, await dominated.backend.search({ query: 'mfa', scope: { pairs: [] }, limit: 3 }), { explicit: true, origin: 'https://x.test', limit: 3 });
  assert.equal(dominated.requests[1].search.per_page, 60);
  assert.deepEqual(pages.map((p) => p.url.split('/guides/')[1]), ['mfa/', 'sso/', 'otp/']);
  const big = fakeTypesense({ code: 404, error: 'Could not find the stopword set named `x`.' }, { hits: [] });
  await big.backend.search({ query: 'x', scope: { pairs: [] }, limit: 20 });
  assert.equal(big.requests[1].search.per_page, 250, 'Typesense answers at most 250 hits');

  // A collection from before selfHosted: searched again without that filter, keeping the rest.
  const old = fakeTypesense({ code: 400, error: 'Could not find a filter field named `selfHosted` in the schema.' }, { grouped_hits: [] });
  await old.backend.search({ query: 'mfa', scope: searchScope(manifest, { docSpace: 'api-manager', edition: '4.7.0' }), limit: 2 });
  assert.deepEqual(old.requests.map((r) => r.search.filter_by), ['((docSpace:=`api-manager` && edition:=[`4.7.0`])) && selfHosted:!=true', '((docSpace:=`api-manager` && edition:=[`4.7.0`]))']);
  assert.deepEqual([old.requests[1].search.stopwords, old.requests[1].search.group_by], [STOPWORDS_ID, 'docSpace,edition,page']);
  const oldest = fakeTypesense({ code: 404, error: 'Could not find the stopword set named `wso2docs-question-words`.' }, { code: 400, error: 'Could not find a filter field named `selfHosted` in the schema.' }, { hits: [] });
  await oldest.backend.search({ query: 'mfa', scope: { pairs: [] }, limit: 2 });
  assert.deepEqual(oldest.requests.map((r) => [r.search.stopwords ?? '-', r.search.filter_by ?? '-']), [[STOPWORDS_ID, 'selfHosted:!=true'], ['-', 'selfHosted:!=true'], ['-', '-']], 'each thing it lacks, once');

  const { requests, backend } = fakeTypesense({ code: 400, error: 'Could not parse the filter query.' });
  await assert.rejects(backend.search({ query: 'x', scope: { pairs: [] } }), /search answered 400/);
  assert.equal(requests.length, 1, 'any other error is not retried');
});

test('the Edge Worker: /mcp on staging only, search wired from vars', async () => {
  const bucket = {
    async get(key) {
      const body = key === 'manifest.json' ? JSON.stringify(manifest) : objects[key];
      return body === undefined ? null : { text: async () => body, json: async () => JSON.parse(body) };
    },
  };
  const env = (vars) => ({ DOCS: bucket, NOINDEX_ALL: 'true', MANIFEST_TTL_SECONDS: '0', ...vars });
  const post = (e, body) => worker.fetch(new Request('https://docs-staging.wso2.com/mcp', { method: 'POST', body: JSON.stringify(body) }), e);
  assert.equal((await post(env({ MCP_ENABLED: 'false' }), { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 404, 'off in production');
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://search.test/multi_search');
    assert.equal(JSON.parse(init.body).searches[0].collection, 'wso2-docs');
    return Response.json({ results: [{ hits: [] }] });
  };
  try {
    const e = env({ MCP_ENABLED: 'true', TYPESENSE_HOST: 'https://search.test', TYPESENSE_COLLECTION: 'wso2-docs', TYPESENSE_SEARCH_KEY: 'k' });
    const r = await post(e, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_docs', arguments: { query: 'mfa' } } });
    assert.equal((await r.json()).result.content[0].text, 'No results for "mfa".');
    const page = await post(e, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_page', arguments: { url: '/identity-platform/cloud/guides/mfa/' } } });
    assert.equal((await page.json()).result.content[0].text, '# MFA (Cloud)\n');
  } finally {
    globalThis.fetch = real;
  }
});

test('search_docs queries the fields and the collection the release indexes', () => {
  const fields = new Set(collectionSchema('x').fields.map((f) => f.name));
  for (const f of [...QUERY_BY.split(','), ...INCLUDE_FIELDS.split(',')]) assert.ok(fields.has(f), `${f} is in the search collection`);
  assert.equal(QUERY_BY, searchParameters('edition').query_by, 'the same fields as the search box');
  assert.equal(QUERY_BY_WEIGHTS, searchParameters('edition').query_by_weights);
  assert.ok(collectionSchema('x').fields.find((f) => f.name === 'page').facet, 'search_docs groups by page');
  assert.equal(STOPWORDS_ID, MCP_STOPWORDS_ID, 'the stop-word set search-setup makes');
  assert.deepEqual(STOPWORDS, MCP_STOPWORDS);
  const staging = wranglerVars('staging');
  assert.equal(staging.TYPESENSE_COLLECTION, COLLECTIONS.staging);
  assert.equal(staging.TYPESENSE_HOST, SEARCH_ENVIRONMENTS.staging.url);
});

test('search_docs finds Contribute by Doc space alone ("_" is a token separator in the index)', () => {
  assert.equal(typesenseFilter([{ docSpace: 'contribute', editions: ['_'] }, { docSpace: 'api-manager', editions: ['4.7.0'] }]),
    '(docSpace:=`contribute`) || (docSpace:=`api-manager` && edition:=[`4.7.0`])');
});
