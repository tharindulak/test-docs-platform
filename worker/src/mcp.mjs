// The WSO2 Docs MCP server (AI/LLM-friendly docs, decision 10): a read-only
// endpoint at /mcp on the Streamable HTTP transport, stateless, answering each
// JSON-RPC POST with one JSON response (no sessions, no server-sent events).
// Three tools:
//   list_editions(docSpace?)               Doc spaces and Editions, from manifest.json
//   get_page(url)                          a page's Markdown twin, from the release folder
//   search_docs(query, docSpace?, edition?) the search index, same scopes as the search box
// Staging only during the Pilot (MCP_ENABLED).
import { route } from './routing.mjs';
import { presentHit, searchScope } from './search.mjs';
import { twinUrlPath } from './twin-paths.mjs';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'wso2-docs', title: 'WSO2 Docs', version: '0.1.0' };
const MAX_BODY = 64 * 1024;
const MAX_PAGE = 1024 * 1024;
const KNOWN_HOSTS = new Set(['docs.wso2.com', 'docs-staging.wso2.com']);
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, authorization, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
};

const INSTRUCTIONS = 'WSO2 Docs: product documentation for WSO2 Cloud and self-hosted products. '
  + 'Call list_editions to see Doc spaces and Editions, search_docs to find pages, and get_page to read one as Markdown. '
  + 'Prefer the "cloud" Edition for WSO2 Cloud products and "latest" for self-hosted ones unless the user names a version.';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const TOOLS = [
  {
    name: 'list_editions',
    title: 'List Doc spaces and Editions',
    description: 'Lists the WSO2 Docs Doc spaces (one per product) and their Editions: Cloud, self-hosted versions and which one is the newest release (also served at /latest/). Each Edition has a URL and an llms.txt index.',
    inputSchema: {
      type: 'object',
      properties: { docSpace: { type: 'string', description: 'Only this Doc space, for example "identity-platform"' } },
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: 'get_page',
    title: 'Read a page as Markdown',
    description: 'Returns the Markdown twin of a WSO2 Docs page: its text with front matter naming the title, Edition and canonical URL. Accepts a page URL (https://docs.wso2.com/identity-platform/cloud/guides/mfa/), its .md URL, a path, or an llms.txt URL.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Page URL or path on WSO2 Docs' } },
      required: ['url'],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: 'search_docs',
    title: 'Search WSO2 Docs',
    description: 'Full-text search over WSO2 Docs. With no docSpace it searches one Edition of every product, where its version selector opens (Cloud, else its newest release); with docSpace, every live Edition of that product; with docSpace and edition, only that Edition. Returns page URLs and their Markdown URLs for get_page.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for' },
        docSpace: { type: 'string', description: 'Doc space slug from list_editions, for example "api-manager"' },
        edition: { type: 'string', description: 'Edition id from list_editions ("cloud", "7.3.0", "latest"); needs docSpace' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of results (default 8)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
];

const json = (status, body, extra = {}) => new Response(body === null ? null : JSON.stringify(body), {
  status,
  headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
});
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const toolText = (text, structured) => ({ content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}) });
const toolError = (text) => ({ content: [{ type: 'text', text }], isError: true });

// The Edition's display name, as the chrome shows it (lib/switching.mjs editionName).
function editionName(space, id) {
  if (id === 'cloud') return space.editionNames?.cloud ?? `${space.displayName} Cloud`;
  return (space.editionNames?.selfHosted ?? `${space.displayName} {version}`).replaceAll('{version}', id);
}

function editionsOf(manifest, origin, only) {
  const out = [];
  for (const [slug, s] of Object.entries(manifest.docSpaces ?? {})) {
    if (only && slug !== only) continue;
    const deployed = s.deployments ?? {};
    const entry = { docSpace: slug, name: s.displayName, model: s.model, status: s.status ?? 'live', latest: s.latest ?? null, editions: [] };
    if (s.legacyUrl) entry.legacyUrl = s.legacyUrl;
    if (s.model === 'unversioned') {
      entry.editions.push({ id: null, status: deployed._ ? 'live' : 'not deployed', ...(deployed._ ? { url: `${origin}/${slug}/`, llmsTxt: `${origin}/${slug}/llms.txt` } : {}) });
    } else {
      for (const e of s.editions ?? []) {
        const live = Boolean(deployed[e.id]);
        entry.editions.push({
          id: e.id, name: editionName(s, e.id), status: e.status ?? 'live',
          ...(live ? { url: `${origin}/${slug}/${e.id}/`, llmsTxt: `${origin}/${slug}/${e.id}/llms.txt` } : {}),
          ...(e.legacyUrl ? { legacyUrl: e.legacyUrl } : {}),
          ...(!live && !e.legacyUrl ? { status: 'not deployed' } : {}),
        });
      }
      if (deployed.latest) entry.editions.push({ id: 'latest', feeds: deployed.latest.edition, url: `${origin}/${slug}/latest/`, llmsTxt: `${origin}/${slug}/latest/llms.txt` });
    }
    out.push(entry);
  }
  return out;
}

// A page URL, .md URL, path or llms.txt URL → the release-folder key of the twin.
export function twinKey(manifest, input, requestHost) {
  let pathname;
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) return { error: '"url" must be a WSO2 Docs URL or path' };
  const raw = input.trim();
  if (raw.startsWith('/')) pathname = raw.split(/[?#]/)[0];
  else {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return { error: `"${raw}" is not a URL` };
    }
    if (!KNOWN_HOSTS.has(u.host) && u.host !== requestHost) return { error: `${u.host} is not WSO2 Docs; use a docs.wso2.com URL` };
    pathname = u.pathname;
  }
  const segs = pathname.split('/').filter(Boolean);
  const space = manifest.docSpaces?.[segs[0]];
  if (!space) return { error: `No Doc space "${segs[0] ?? ''}" on WSO2 Docs. Call list_editions to see them.` };
  let target = pathname;
  if (!/\.(md|txt)$/.test(pathname)) {
    const baseSegs = space.model === 'unversioned' ? 1 : 2;
    const base = `/${segs.slice(0, baseSegs).join('/')}/`;
    target = twinUrlPath(pathname, base);
  }
  if (target.endsWith('.txt') && !/\/llms(-full)?\.txt$/.test(target)) return { error: 'Only pages and llms.txt files can be read' };
  const r = route(manifest, target);
  if (r.type !== 'object') return { error: `${pathname} is not on a deployed Edition. Call list_editions to see them.` };
  return { key: r.key, path: target };
}

async function callTool(name, args, deps) {
  const manifest = await deps.manifest();
  if (name === 'list_editions') {
    if (args.docSpace !== undefined && typeof args.docSpace !== 'string') return toolError('"docSpace" must be a string');
    const list = editionsOf(manifest, deps.origin, args.docSpace);
    if (args.docSpace && !list.length) return toolError(`Unknown Doc space "${args.docSpace}"`);
    return toolText(JSON.stringify({ docSpaces: list }, null, 2), { docSpaces: list });
  }
  if (name === 'get_page') {
    const t = twinKey(manifest, args.url, deps.host);
    if (t.error) return toolError(t.error);
    const text = await deps.read(t.key);
    if (text === null) return toolError(`No Markdown page at ${deps.origin}${t.path}. Use search_docs to find the right URL.`);
    return toolText(text.length > MAX_PAGE ? `${text.slice(0, MAX_PAGE)}\n\n[Truncated at ${MAX_PAGE} characters]` : text);
  }
  if (name === 'search_docs') {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query || query.length > 200) return toolError('"query" must be 1 to 200 characters');
    const limit = Math.min(Math.max(Number.isInteger(args.limit) ? args.limit : 8, 1), 20);
    const scope = searchScope(manifest, { docSpace: args.docSpace, edition: args.edition });
    if (scope.error) return toolError(scope.error);
    if (!deps.search) return toolError('Search is not configured on this host yet. Use list_editions and the llms.txt indexes instead.');
    let hits;
    try {
      hits = await deps.search.search({ query, scope, limit });
    } catch (err) {
      return toolError(`Search failed (${err.message}). Try again, or use the llms.txt indexes.`);
    }
    const results = hits.map((h) => presentHit(manifest, h, { explicit: scope.explicit, origin: deps.origin })).filter(Boolean);
    const text = results.length
      ? results.map((r, i) => `${i + 1}. ${r.title} (${r.docSpace} ${r.edition})\n   ${r.url}\n   Markdown: ${r.markdownUrl}${r.snippet ? `\n   ${r.snippet.replace(/\s+/g, ' ')}` : ''}`).join('\n')
      : `No results for "${query}".`;
    return toolText(text, { results });
  }
  return null;
}

async function answer(msg, deps) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    // Responses from the client, or junk: nothing to answer.
    return msg && typeof msg === 'object' && ('result' in msg || 'error' in msg) ? null : rpcError(msg?.id, -32600, 'Invalid JSON-RPC request');
  }
  const isNotification = !('id' in msg);
  if (isNotification) return null;
  const { id, method, params = {} } = msg;
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    case 'tools/call': {
      const result = await callTool(params.name, params.arguments ?? {}, deps);
      return result ? { jsonrpc: '2.0', id, result } : rpcError(id, -32602, `Unknown tool "${params.name}"`);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// deps: { manifest(): Promise<manifest>, read(key): Promise<string|null>, search: backend|null, origin, host }
export async function handleMcp(request, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
  if (request.method !== 'POST') return json(405, rpcError(null, -32000, 'Use POST: this server does not open event streams'), { allow: 'POST, OPTIONS' });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json(413, rpcError(null, -32600, 'Request too large'));
  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json(413, rpcError(null, -32600, 'Request too large'));
    body = JSON.parse(raw);
  } catch {
    return json(400, rpcError(null, -32700, 'Parse error'));
  }
  if (Array.isArray(body)) {
    if (!body.length) return json(400, rpcError(null, -32600, 'Empty batch'));
    const out = (await Promise.all(body.slice(0, 20).map((m) => answer(m, deps)))).filter(Boolean);
    return out.length ? json(200, out) : new Response(null, { status: 202, headers: CORS });
  }
  const res = await answer(body, deps);
  return res ? json(200, res) : new Response(null, { status: 202, headers: CORS });
}
