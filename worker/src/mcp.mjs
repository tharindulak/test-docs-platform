// The WSO2 Docs MCP server (AI/LLM-friendly docs, decision 10): a read-only
// endpoint at /mcp on the Streamable HTTP transport, stateless, answering each
// JSON-RPC POST with one JSON response (no sessions, no server-sent events).
// Three tools, each with an outputSchema its structuredContent follows:
//   list_editions(docSpace?)                Doc spaces and Editions, from manifest.json
//   get_page(url, section?, maxChars?)      a page's Markdown twin (or one section of it), from the release folder
//   search_docs(query, product?, edition?,  the search index, same scopes as the search box,
//     includeSelfHosted?, limit?)           one result per page with its best section
// Staging only during the Pilot (MCP_ENABLED). Nothing here logs a query.
import { route } from './routing.mjs';
import { presentPages, searchScope, searchableProducts } from './search.mjs';
import { pageOfTwin, twinUrlPath } from './twin-paths.mjs';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'wso2-docs', title: 'WSO2 Docs', version: '0.1.0' };
const MAX_BODY = 64 * 1024;
const MAX_CHARS = { min: 1000, max: 100_000, default: 20_000 };
const SEARCH_LIMIT = { max: 10, default: 5 };
const KNOWN_HOSTS = new Set(['docs.wso2.com', 'docs-staging.wso2.com']);
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, authorization, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
};

const INSTRUCTIONS = 'WSO2 Docs: product documentation for WSO2 Cloud and self-hosted products. '
  + 'Call list_editions to see Doc spaces and Editions, search_docs to find pages, and get_page to read one as Markdown (or one section of it). '
  + 'Prefer the "cloud" Edition for WSO2 Cloud products and "latest" for self-hosted ones unless the user names a version.';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const str = (description) => ({ type: 'string', description });
const EDITION_STATUS = ['live', 'end-of-life', 'legacy', 'not deployed'];
export const TOOLS = [
  {
    name: 'list_editions',
    title: 'List Doc Spaces and Editions',
    description: 'Lists the WSO2 Docs Doc spaces (one per product) and their Editions: Cloud, self-hosted versions and which one is the newest release (also served at /latest/). Each Edition has a URL and an llms.txt index.',
    inputSchema: {
      type: 'object',
      properties: { docSpace: { type: 'string', description: 'Only this Doc space, for example "identity-platform"' } },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        docSpaces: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              docSpace: str('Doc space slug'),
              name: str('Display name'),
              model: str('How the Doc space is versioned'),
              status: { type: 'string', enum: ['live', 'legacy'], description: 'legacy: not on WSO2 Docs yet (see legacyUrl)' },
              latest: { type: ['string', 'null'], description: 'The Edition readers open first' },
              legacyUrl: str('The old site'),
              editions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: ['string', 'null'], description: 'Edition id ("cloud", a version, "latest"); null for an unversioned Doc space' },
                    name: str('Display name'),
                    status: { type: 'string', enum: EDITION_STATUS, description: 'Edition status' },
                    url: str('Home page URL'),
                    llmsTxt: str('The llms.txt index URL'),
                    legacyUrl: str('The old site of a legacy version'),
                    feeds: str('For "latest": the Edition it serves'),
                  },
                  required: ['id'],
                },
              },
            },
            required: ['docSpace', 'status', 'editions'],
          },
        },
      },
      required: ['docSpaces'],
    },
    annotations: readOnly,
  },
  {
    name: 'get_page',
    title: 'Read a Page as Markdown',
    description: 'Returns the Markdown twin of a WSO2 Docs page: its text with front matter naming the title, Edition and canonical URL, or only one section of it. Accepts a page URL (https://docs.wso2.com/identity-platform/cloud/guides/mfa/), its .md URL, a path, or an llms.txt URL. Long pages are cut at maxChars.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Page URL or path on WSO2 Docs' },
        section: { type: 'string', description: 'Only this section: a heading anchor from a search result URL, with or without "#"' },
        maxChars: { type: 'integer', minimum: MAX_CHARS.min, maximum: MAX_CHARS.max, default: MAX_CHARS.default, description: `Cut the text after this many characters (default ${MAX_CHARS.default})` },
      },
      required: ['url'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        url: str('The page URL that was read'),
        text: str('The Markdown'),
        truncated: { type: 'boolean', description: 'The text was cut at maxChars' },
      },
      required: ['url', 'text', 'truncated'],
    },
    annotations: readOnly,
  },
  {
    name: 'search_docs',
    title: 'Search WSO2 Docs',
    description: 'Full-text search over WSO2 Docs; returns pages, best first, each with its best matching section. With no product it searches one Edition of every product, where its version selector opens (Cloud, else its newest release); edition "cloud" alone searches the Cloud docs of every product. With product, every live Edition of it, or only the given edition. Read a page with get_page.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'Keywords to search for, for example "enable MFA"' },
        product: { type: 'string', description: 'Doc space slug from list_editions. A family Cloud (identity-platform) also covers its Cloud parts (Identity Server Cloud)' },
        docSpace: { type: 'string', description: 'Old name of product' },
        edition: { type: 'string', description: 'An Edition from list_editions ("cloud", "7.3.0", "latest"). Without product only "cloud" is allowed' },
        includeSelfHosted: { type: 'boolean', default: false, description: 'Also return Self-hosted additions that Cloud docs show (default false)' },
        limit: { type: 'integer', minimum: 1, maximum: SEARCH_LIMIT.max, default: SEARCH_LIMIT.default, description: `Number of pages (default ${SEARCH_LIMIT.default})` },
      },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          description: 'Pages, best first',
          items: {
            type: 'object',
            properties: {
              title: str('Page title'),
              url: str('Page URL'),
              markdownUrl: str('The page\'s Markdown twin URL'),
              product: str('Product slug: the family Cloud for a Cloud part, else the Doc space'),
              docSpace: str('Doc space slug'),
              edition: str('Edition id'),
              selfHosted: { type: 'boolean', description: 'A Self-hosted addition that Cloud docs show' },
              section: {
                type: 'object',
                description: 'The best matching section',
                properties: { heading: str('Heading below the page title, or the page title'), url: str('Section URL'), text: str('Section text, at most 2,000 characters') },
                required: ['heading', 'url', 'text'],
              },
              moreSections: {
                type: 'array',
                maxItems: 2,
                description: 'Other matching sections of the page',
                items: { type: 'object', properties: { heading: str('Heading'), url: str('Section URL') }, required: ['heading', 'url'] },
              },
            },
            required: ['title', 'url', 'markdownUrl', 'product', 'docSpace', 'edition', 'selfHosted', 'section', 'moreSections'],
          },
        },
      },
      required: ['results'],
    },
    annotations: readOnly,
  },
];

// The tools with search_docs' product choices as the manifest has them when
// tools/list is called; the server checks product itself, so a client with an
// older list still gets a clear error. With no manifest, no choices are listed.
export function toolList(manifest) {
  const products = manifest ? searchableProducts(manifest) : [];
  if (!products.length) return TOOLS;
  return TOOLS.map((t) => (t.name !== 'search_docs' ? t : {
    ...t, inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties, product: { ...t.inputSchema.properties.product, enum: products } } },
  }));
}

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
      // A component whose Cloud is a Cloud part: that Cloud first, once its
      // platform's Cloud tree is deployed (as its version selector lists it).
      const platform = s.cloud?.in && !(s.editions ?? []).some((e) => e.id === 'cloud') ? s.cloud.in : null;
      const tree = platform && manifest.docSpaces?.[platform];
      if (tree?.deployments?.cloud) {
        const base = `${origin}/${platform}/cloud/${slug}/`;
        const status = tree.editions?.find((e) => e.id === 'cloud')?.status ?? 'live';
        entry.editions.push({ id: 'cloud', name: editionName(s, 'cloud'), status, partOf: platform, url: base, llmsTxt: `${base}llms.txt` });
      }
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
  pathname = `/${segs.join('/')}${pathname.endsWith('/') && segs.length ? '/' : ''}`;
  const base = `/${segs.slice(0, space.model === 'unversioned' ? 1 : 2).join('/')}/`;
  const target = /\.(md|txt)$/.test(pathname) ? pathname : twinUrlPath(pathname, base);
  if (target.endsWith('/llms-full.txt')) return { error: 'llms-full.txt holds a whole Edition, too much to read at once. Use search_docs, or get_page on a page that llms.txt lists.' };
  if (target.endsWith('.txt') && !target.endsWith('/llms.txt')) return { error: 'Only pages and llms.txt files can be read' };
  const r = route(manifest, target);
  if (r.type !== 'object') return { error: `${pathname} is not on a deployed Edition. Call list_editions to see them.` };
  // The page that was read, at its own address: the twin's page, or the llms.txt itself.
  const page = target.endsWith('.md') && target.startsWith(base) ? `${base}${pageOfTwin(target.slice(base.length))}` : target;
  return { key: r.key, path: target, page };
}

// A twin written before headings carried ids has none: its anchors are its
// headings' text slugged as the site does (github-slugger), numbered when
// repeated, with links, emphasis and escapes gone and code spans kept.
const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
const unescape = (md) => md.replace(/\\([!-/:-@[-`{-~])/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
function headingText(md) {
  const code = [];
  const prose = md.replace(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g, (_, ticks, c) => `\u0000${code.push(/^ .* $/.test(c) ? c.slice(1, -1) : c) - 1}\u0000`);
  return unescape(prose.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(?<!\\)<[^>]+>|(?<!\\)\*/g, '')
    .replace(/(^|[^\p{L}\p{N}\\])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}])/gu, '$1$2'))
    .replace(/\u0000(\d+)\u0000/g, (_, i) => code[i]).trim();
}
function slugAnchors(headings) {
  const seen = new Map();
  for (const h of headings) {
    const base = slug(headingText(h.text));
    let anchor = base;
    while (seen.has(anchor)) {
      seen.set(base, seen.get(base) + 1);
      anchor = `${base}-${seen.get(base)}`;
    }
    seen.set(anchor, 0);
    h.anchor = anchor;
  }
}

// The headings of a Markdown twin, outside front matter and code fences. The
// exporter ends each of the page's own headings with {#id}, the id the page
// gives it; generated ones (tab labels, an added title) have none, but still
// end a section. A twin with no ids at all is an older one: its anchors are slugged.
export function twinHeadings(md) {
  const lines = md.split('\n');
  const out = [];
  let fence = lines[0] === '---' ? '---' : null;
  lines.forEach((line, i) => {
    if (fence === '---') {
      if (i > 0 && line === '---') fence = null;
      return;
    }
    // CommonMark fences: a backtick fence's info string has no backtick; a fence
    // closes on the same character, at least as long, with nothing after it.
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
      return;
    }
    if (f && !(f[1][0] === '`' && f[2].includes('`'))) {
      fence = f[1];
      return;
    }
    const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (m) out.push({ level: m[1].length, anchor: /(?:^| )\{#([^}]+)\}$/.exec(m[2] ?? '')?.[1] ?? null, line: i, text: m[2] ?? '' });
  });
  if (!out.some((h) => h.anchor)) slugAnchors(out);
  return { lines, headings: out };
}

// One section of a twin: its heading to the next heading of the same or a higher level.
export function twinSection(md, section) {
  let want = section.replace(/^#/, '');
  try {
    want = decodeURIComponent(want);
  } catch {
    // not encoded
  }
  const { lines, headings } = twinHeadings(md);
  const at = headings.findIndex((h) => h.anchor === want);
  if (at < 0) {
    const anchors = headings.map((h) => h.anchor).filter(Boolean);
    const list = anchors.slice(0, 20).join(', ');
    return { error: `No section "${want}" on this page.${list ? ` Its sections: ${list}${anchors.length > 20 ? ', …' : ''}.` : ''}` };
  }
  const next = headings.slice(at + 1).find((h) => h.level <= headings[at].level);
  return { text: lines.slice(headings[at].line, next?.line ?? lines.length).join('\n').trimEnd() };
}

// A section's anchor for get_page's section, as " (#anchor)", or nothing for a page.
const anchorOf = (url) => (new URL(url).hash ? ` (${new URL(url).hash})` : '');

// The first `max` characters of a section's text, cut back to a word.
function excerpt(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max / 2 ? cut.lastIndexOf(' ') : max)}…`;
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
    const { section, maxChars = MAX_CHARS.default } = args;
    if (section !== undefined && (typeof section !== 'string' || !section.replace(/^#/, '').trim())) return toolError('"section" must be a heading anchor, such as "#configure-mfa"');
    if (!Number.isInteger(maxChars) || maxChars < MAX_CHARS.min || maxChars > MAX_CHARS.max) return toolError(`"maxChars" must be an integer from ${MAX_CHARS.min} to ${MAX_CHARS.max}`);
    const t = twinKey(manifest, args.url, deps.host);
    if (t.error) return toolError(t.error);
    let text = await deps.read(t.key);
    if (text === null) return toolError(`No Markdown page at ${deps.origin}${t.path}. Use search_docs to find the right URL.`);
    if (section !== undefined) {
      const s = twinSection(text, section);
      if (s.error) return toolError(s.error);
      text = s.text;
    }
    const truncated = text.length > maxChars;
    if (truncated) text = `${text.slice(0, maxChars)}\n\n[Cut at ${maxChars} characters. Use section or a larger maxChars.]`;
    return toolText(text, { url: new URL(t.page, deps.origin).href, text, truncated });
  }
  if (name === 'search_docs') {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query || query.length > 200) return toolError('"query" must be 1 to 200 characters');
    if (args.product !== undefined && args.docSpace !== undefined && args.product !== args.docSpace) return toolError('"docSpace" is the old name of "product" and they differ; give only "product"');
    const product = args.product ?? args.docSpace;
    if (product !== undefined && typeof product !== 'string') return toolError('"product" must be a Doc space slug from list_editions');
    if (args.edition !== undefined && typeof args.edition !== 'string') return toolError('"edition" must be an Edition id from list_editions, such as "cloud"');
    if (args.includeSelfHosted !== undefined && typeof args.includeSelfHosted !== 'boolean') return toolError('"includeSelfHosted" must be true or false');
    const limit = args.limit ?? SEARCH_LIMIT.default;
    if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_LIMIT.max) return toolError(`"limit" must be an integer from 1 to ${SEARCH_LIMIT.max} (pages)`);
    const scope = searchScope(manifest, { docSpace: product || undefined, edition: args.edition || undefined });
    if (scope.error) return toolError(scope.error);
    if (!deps.search) return toolError('Search is not configured on this host yet. Use list_editions and the llms.txt indexes instead.');
    let hits;
    try {
      hits = await deps.search.search({ query, scope, limit, includeSelfHosted: args.includeSelfHosted === true });
    } catch (err) {
      return toolError(`Search failed (${err.message}). Try again, or use the llms.txt indexes.`);
    }
    const results = presentPages(manifest, hits, { explicit: scope.explicit, origin: deps.origin, limit });
    const text = results.length
      ? results.map((r, i) => [
        `${i + 1}. ${r.title} (${r.product} ${r.edition})`,
        `   ${r.url} (Markdown: ${r.markdownUrl})`,
        `   ${r.section.heading}${anchorOf(r.section.url)}${r.section.text ? `: ${excerpt(r.section.text, 300)}` : ''}`,
        ...(r.moreSections.length ? [`   Also: ${r.moreSections.map((m) => `${m.heading}${anchorOf(m.url)}`).join('; ')}`] : []),
      ].join('\n')).join('\n')
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
      return { jsonrpc: '2.0', id, result: { tools: toolList(await deps.manifest().catch(() => null)) } };
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
