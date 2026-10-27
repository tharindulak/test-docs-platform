// The MCP endpoint (worker/src/mcp.mjs) and its search scopes, with a fake
// manifest, fake release folders and a fake search backend; the Typesense
// client is checked against a fake fetch. edge-llm.test.mjs runs it in Miniflare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.mjs';
import { TOOLS, handleMcp, twinKey } from '../worker/src/mcp.mjs';
import { INCLUDE_FIELDS, QUERY_BY, presentHit, searchScope, typesenseBackend, typesenseFilter } from '../worker/src/search.mjs';
import { collectionSchema, COLLECTIONS } from '../lib/search/schema.mjs';
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
const objects = {
  '_releases/identity-platform/cloud/c1/guides/mfa.md': '# MFA (Cloud)\n',
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
  assert.ok(tools.every((t) => t.annotations.readOnlyHint && t.inputSchema.type === 'object'));
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
});

test('search scopes: This Edition, all Editions of a Doc space, all of WSO2 Docs', () => {
  assert.deepEqual(searchScope(manifest, { docSpace: 'identity-platform', edition: '7.2.0' }), { pairs: [{ docSpace: 'identity-platform', editions: ['7.2.0'] }], explicit: true }, 'end of life only under This Edition');
  assert.deepEqual(searchScope(manifest, { docSpace: 'identity-platform', edition: 'latest' }), { pairs: [{ docSpace: 'identity-platform', editions: ['7.3.0'] }], explicit: false });
  assert.deepEqual(searchScope(manifest, { docSpace: 'identity-platform' }).pairs, [{ docSpace: 'identity-platform', editions: ['cloud', '7.3.0'] }]);
  assert.deepEqual(searchScope(manifest, {}).pairs, [{ docSpace: 'identity-platform', editions: ['cloud'] }, { docSpace: 'api-manager', editions: ['4.7.0'] }], 'one Edition per Doc space: where its selector opens (Cloud first, as the search box)');
  assert.match(searchScope(manifest, { edition: 'cloud' }).error, /needs "docSpace"/);
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
  delete m.docSpaces['identity-platform'].deployments.cloud;
  assert.deepEqual(searchScope(m, { docSpace: 'identity-server' }).pairs, [{ docSpace: 'identity-server', editions: ['7.3.0'] }], 'no Cloud tree deployed: no Cloud');

  const hit = { url: 'https://docs.wso2.com/identity-platform/7.3.0/guides/mfa/#choose-a-factor', docSpace: 'identity-platform', edition: '7.3.0', hierarchy: { lvl1: 'MFA', lvl2: 'Choose a factor' }, content: 'Pick TOTP' };
  const shown = presentHit(manifest, hit, { explicit: false, origin: 'https://docs-staging.wso2.com' });
  assert.equal(shown.url, 'https://docs-staging.wso2.com/identity-platform/latest/guides/mfa/#choose-a-factor', 'the Edition feeding latest is shown at /latest/');
  assert.equal(shown.markdownUrl, 'https://docs-staging.wso2.com/identity-platform/latest/guides/mfa.md');
  assert.equal(shown.title, 'MFA › Choose a factor');
  assert.equal(presentHit(manifest, hit, { explicit: true, origin: 'https://docs-staging.wso2.com' }).url, 'https://docs-staging.wso2.com/identity-platform/7.3.0/guides/mfa/#choose-a-factor');
  assert.equal(presentHit(manifest, { ...hit, url: 'https://docs.wso2.com/identity-platform/7.3.0/' }, { explicit: true, origin: 'https://x.test' }).markdownUrl, 'https://x.test/identity-platform/7.3.0/index.md');
});

test('search_docs through a fake backend', async () => {
  const d = deps(() => [{ url: 'https://docs.wso2.com/api-manager/4.7.0/guides/rate-limits/', docSpace: 'api-manager', edition: '4.7.0', hierarchy: { lvl1: 'Rate limits' }, content: 'Limit calls per minute.' }]);
  const r = await call(d, 'search_docs', { query: 'rate limit', docSpace: 'api-manager' });
  assert.equal(r.isError, undefined);
  assert.deepEqual(d.calls[0], { query: 'rate limit', scope: { pairs: [{ docSpace: 'api-manager', editions: ['4.7.0', '4.6.0'] }], explicit: false }, limit: 8 });
  assert.equal(r.structuredContent.results[0].markdownUrl, 'https://docs-staging.wso2.com/api-manager/4.7.0/guides/rate-limits.md');
  assert.match(r.content[0].text, /^1\. Rate limits \(api-manager 4\.7\.0\)\n {3}https:\/\/docs-staging\.wso2\.com\/api-manager\/4\.7\.0\/guides\/rate-limits\//);
  assert.equal((await call(deps(), 'search_docs', { query: 'x' })).isError, true, 'no backend configured');
  assert.equal((await call(d, 'search_docs', { query: '' })).isError, true);
  assert.equal((await call(deps(() => { throw new Error('boom'); }), 'search_docs', { query: 'x' })).isError, true);
});

test('the Typesense client sends the scope as a filter with a search-only key', async () => {
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url: new URL(url), init });
    return Response.json({ hits: [{ document: { url: 'https://docs.wso2.com/identity-platform/cloud/guides/mfa/', docSpace: 'identity-platform', edition: 'cloud', lvl1: 'MFA', content: 'Second factor' }, highlights: [{ field: 'content', snippet: 'Second <b>factor</b>' }] }] });
  };
  const backend = typesenseBackend({ host: 'https://search.test/', apiKey: 'search-only', collection: 'wso2-docs', fetchImpl: fakeFetch });
  const hits = await backend.search({ query: 'factor', scope: searchScope(manifest, { docSpace: 'identity-platform', edition: 'cloud' }), limit: 3 });
  const u = requests[0].url;
  assert.equal(u.pathname, '/collections/wso2-docs/documents/search');
  assert.equal(u.searchParams.get('q'), 'factor');
  assert.equal(u.searchParams.get('filter_by'), '(docSpace:=`identity-platform` && edition:=[`cloud`])');
  assert.equal(u.searchParams.get('per_page'), '3');
  assert.equal(requests[0].init.headers['x-typesense-api-key'], 'search-only');
  assert.deepEqual(hits[0].hierarchy, { lvl0: null, lvl1: 'MFA', lvl2: null, lvl3: null });
  assert.equal(hits[0].snippet, 'Second <b>factor</b>');
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
  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/search\.test\/collections\/wso2-docs\/documents\/search\?/);
    return Response.json({ hits: [] });
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
  const staging = wranglerVars('staging');
  assert.equal(staging.TYPESENSE_COLLECTION, COLLECTIONS.staging);
  assert.equal(staging.TYPESENSE_HOST, SEARCH_ENVIRONMENTS.staging.url);
});

test('search_docs finds Contribute by Doc space alone ("_" is a token separator in the index)', () => {
  assert.equal(typesenseFilter([{ docSpace: 'contribute', editions: ['_'] }, { docSpace: 'api-manager', editions: ['4.7.0'] }]),
    '(docSpace:=`contribute`) || (docSpace:=`api-manager` && edition:=[`4.7.0`])');
});
