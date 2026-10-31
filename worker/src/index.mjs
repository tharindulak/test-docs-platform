// The WSO2 Docs Edge Worker: the only edge configuration (ticket 11).
// Serves every Docs deployment from its immutable release folder in R2, as the
// merged manifest (policy + state) points; redirects from Workers KV; noindex
// for end-of-life Editions, Unlisted Doc spaces and the whole staging host; runtime files; per-Doc
// space 404s; cache headers; cookie-free feedback and 404 counts in Workers
// Analytics Engine (Analytics and feedback). For AI tools (AI/LLM-friendly
// docs): Markdown twins at <page>.md, robots.txt for the whole host, the root
// llms.txt, and the read-only MCP endpoint at /mcp (staging only for the Pilot).
// Old Confluence paths (/display/, /pages/viewpage.action, /download/attachments/)
// get the 301s Cloudflare sends today; their targets are in confluence.mjs.
// The shared theme every page links, /_platform/theme/v<major>/..., comes from
// the live published theme of that major, or by theme id from its immutable
// folder (routing.mjs themeRoute). No page is rewritten: pages link it.
//
// Bindings (worker/wrangler.jsonc):
//   DOCS        R2 bucket: docs-staging or docs-prod (lib/release.mjs layout)
//   PREVIEWS    R2 bucket of PR previews (staging only, optional)
//   REDIRECTS   KV: compiled redirect table, key = path or host + path
//   FEEDBACK    Analytics Engine dataset for "Was this page helpful?" votes
//   NOT_FOUND   Analytics Engine dataset for 404s
// Vars: ENVIRONMENT, NOINDEX_ALL ("true" on staging), DOCS_HOST,
//   LEGACY_HOSTS (comma-separated; only at cutover), MANIFEST_TTL_SECONDS, HTML_MAX_AGE,
//   AI_CRAWLERS ("allow" or "disallow"), MCP_ENABLED, TYPESENSE_HOST, TYPESENSE_COLLECTION;
//   secret TYPESENSE_SEARCH_KEY (search-only key).
import { REASONS, THEME_PREFIX, THEME_SPACE, cacheControl, feedbackTarget, route, themeRoute } from './routing.mjs';
import { confluenceRedirect } from './confluence.mjs';
import { handleMcp } from './mcp.mjs';
import { robotsTxt } from './robots.mjs';
import { searchBackend } from './search.mjs';

const RUNTIME_FILES = { '/manifest.json': 'manifest.json', '/chrome.json': 'chrome.json', '/sitemap.xml': 'sitemap.xml', '/llms.txt': 'llms.txt' };
const TYPES = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json', xml: 'application/xml', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', yaml: 'application/yaml', yml: 'application/yaml',
};
const knownType = (key) => TYPES[/\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase()];
const typeOf = (key) => knownType(key) ?? 'application/octet-stream';
const truthy = (v) => v === true || v === 'true' || v === '1';

// The manifest is cached per isolate for MANIFEST_TTL_SECONDS (default 30), so
// a pointer flip or rollback reaches readers within that time.
const manifests = new WeakMap();
async function loadManifest(env) {
  const ttl = Number(env.MANIFEST_TTL_SECONDS ?? 30) * 1000;
  const hit = manifests.get(env);
  if (hit && Date.now() - hit.at < ttl) return hit.manifest;
  const obj = await env.DOCS.get('manifest.json');
  const manifest = obj ? await obj.json() : { docSpaces: {}, landing: null };
  manifests.set(env, { at: Date.now(), manifest });
  return manifest;
}

function baseHeaders(env, extra = {}) {
  const h = new Headers(extra);
  h.set('x-content-type-options', 'nosniff');
  if (truthy(env.NOINDEX_ALL)) h.set('x-robots-tag', 'noindex');
  return h;
}

function text(env, status, body, extra = {}) {
  return new Response(body, { status, headers: baseHeaders(env, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra }) });
}

function redirect(env, status, location, cache = status === 301 ? 'public, max-age=3600' : 'no-store') {
  return new Response(null, { status, headers: baseHeaders(env, { location, 'cache-control': cache }) });
}

function count(dataset, point) {
  try {
    dataset?.writeDataPoint(point);
  } catch {
    // Counting must never break a page.
  }
}

async function serveObject(request, env, bucket, key, { status = 200, maxAge, cache, extra = {} } = {}) {
  const obj = await bucket.get(key, status === 200 ? { onlyIf: request.headers } : undefined);
  if (!obj) return null;
  const headers = baseHeaders(env, extra);
  obj.writeHttpMetadata(headers);
  // The Worker's own table wins for the types it knows, so whatever tool
  // uploaded the bucket (aws s3 sync, rclone, the release CLI) and whatever
  // type it guessed, pages, twins and llms.txt go out as UTF-8 text.
  const known = knownType(key);
  if (known) headers.set('content-type', known);
  else if (!headers.get('content-type') || /^(application|binary)\/octet-stream$/.test(headers.get('content-type'))) headers.set('content-type', typeOf(key));
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', status === 200 ? (cache ?? cacheControl(key, maxAge)) : 'no-store');
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers });
}

async function lookupRedirect(env, key) {
  const raw = await env.REDIRECTS?.get(key, { cacheTtl: 60 });
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    return typeof r.to === 'string' ? { to: r.to, status: r.status === 302 ? 302 : 301 } : null;
  } catch {
    return null;
  }
}

function refererHost(request) {
  try {
    return new URL(request.headers.get('referer')).host;
  } catch {
    return '';
  }
}

async function notFound(request, env, url, { space = null, segment = null, notFoundKey = null } = {}) {
  count(env.NOT_FOUND, {
    indexes: [space ?? '-'],
    blobs: [space ?? '', segment ?? '', url.pathname.slice(0, 512), refererHost(request), env.ENVIRONMENT ?? ''],
    doubles: [1],
  });
  if (notFoundKey) {
    const page = await serveObject(request, env, env.DOCS, notFoundKey, { status: 404 });
    if (page) return page;
  }
  return text(env, 404, 'Page not found on WSO2 Docs.\n');
}

// POST /api/feedback, the widget's payload from lib/page-links.mjs:
// {v: 1, kind: 'vote' | 'reason', page, vote: 'yes' | 'no', reason?}.
// Counted in Analytics Engine. No cookies, no free text, no personal data
// (Analytics and feedback, point 2).
async function feedback(request, env, url) {
  if (request.method !== 'POST') return text(env, 405, 'Use POST.\n', { allow: 'POST' });
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null' && new URL(origin).host !== url.host) return text(env, 403, 'Cross-site feedback is not accepted.\n');
  if (Number(request.headers.get('content-length') ?? 0) > 2048) return text(env, 413, 'Too large.\n');
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return text(env, 413, 'Too large.\n');
    body = JSON.parse(raw);
  } catch {
    return text(env, 400, 'Expected a JSON body.\n');
  }
  const target = feedbackTarget(await loadManifest(env), body?.page);
  if (!target) return text(env, 400, '"page" must be a page path of a deployed Edition.\n');
  if (body.v !== 1 || (body.kind !== 'vote' && body.kind !== 'reason')) return text(env, 400, '"v" must be 1 and "kind" "vote" or "reason".\n');
  if (body.vote !== 'yes' && body.vote !== 'no') return text(env, 400, '"vote" must be "yes" or "no".\n');
  if (body.kind === 'reason' && (body.vote !== 'no' || !REASONS.includes(body.reason))) {
    return text(env, 400, `A reason follows a "no" vote and must be one of: ${REASONS.join(', ')}.\n`);
  }
  if (body.kind === 'vote' && body.reason !== undefined) return text(env, 400, 'A vote carries no reason; send it as kind "reason".\n');
  count(env.FEEDBACK, {
    indexes: [target.space],
    blobs: [target.space, target.segment, target.edition, body.page.slice(0, 512), body.kind, body.vote, body.reason ?? '', env.ENVIRONMENT ?? ''],
    doubles: [1],
  });
  return new Response(null, { status: 204, headers: baseHeaders(env, { 'cache-control': 'no-store' }) });
}

// /_preview/<space>/pr-<n>/<edition>/... from the PREVIEWS bucket (staging).
async function preview(request, env, url) {
  if (!env.PREVIEWS) return null;
  const m = /^\/_preview\/([^/]+\/pr-\d+\/[^/]+\/)(.*)$/.exec(url.pathname);
  if (!m) return null;
  if (!url.pathname.endsWith('/') && !/\.[A-Za-z0-9]+$/.test(url.pathname)) return redirect(env, 301, `${url.pathname}/${url.search}`);
  const rel = m[2] === '' || m[2].endsWith('/') ? `${m[2]}index.html` : m[2];
  const extra = { 'x-robots-tag': 'noindex' };
  return (await serveObject(request, env, env.PREVIEWS, decodeURIComponent(m[1] + rel), { maxAge: 0, extra }))
    ?? (await serveObject(request, env, env.PREVIEWS, `${decodeURIComponent(m[1])}404.html`, { status: 404, extra }))
    ?? text(env, 404, 'No such preview.\n');
}

// /_platform/theme/v<major>/<file>: the live theme, cached 5 minutes (with
// stale-while-revalidate); /_platform/theme/v<major>/<theme id>/<file>: that
// published theme's file, cached a year. Any origin may load it (fonts need
// CORS), so a local preview can use the staging theme. A miss is counted.
async function theme(request, env, url) {
  const r = themeRoute(await loadManifest(env), url.pathname);
  if (r.type === 'bad') return text(env, 400, 'Malformed URL.\n');
  const cors = { 'access-control-allow-origin': '*' };
  if (r.type === 'object') {
    const res = await serveObject(request, env, env.DOCS, r.key, { cache: r.cache, extra: { ...cors, 'x-docs-theme': `v${r.major}/${r.release}` } });
    if (res) return res;
  }
  count(env.NOT_FOUND, {
    indexes: [THEME_SPACE],
    blobs: [THEME_SPACE, r.major ? `v${r.major}` : '', url.pathname.slice(0, 512), refererHost(request), env.ENVIRONMENT ?? ''],
    doubles: [1],
  });
  return text(env, 404, 'No such theme file on WSO2 Docs.\n', cors);
}

// /mcp: the read-only MCP server (worker/src/mcp.mjs), reading the same
// manifest and release folders as the pages.
function mcp(request, env, url) {
  if (!truthy(env.MCP_ENABLED)) return text(env, 404, 'Not found.\n');
  return handleMcp(request, {
    manifest: () => loadManifest(env),
    read: async (key) => {
      const obj = await env.DOCS.get(key);
      return obj ? obj.text() : null;
    },
    search: searchBackend(env),
    origin: url.origin,
    host: url.host,
  });
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const host = url.host.toLowerCase();

  // Legacy hosts (cutover only): page-level 301s, otherwise the legacy origin
  // keeps serving versions that have not moved yet.
  const legacy = (env.LEGACY_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (legacy.includes(host)) {
    const r = await lookupRedirect(env, `${host}${url.pathname}`);
    // Old redirects that already left WSO2 Docs keep their absolute target.
    if (r) return redirect(env, r.status, /^https?:\/\//.test(r.to) ? r.to : `https://${env.DOCS_HOST}${r.to}`);
    return fetch(request);
  }

  if (url.pathname === '/api/feedback') return feedback(request, env, url);
  if (url.pathname === '/mcp') return mcp(request, env, url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return text(env, 405, 'Method not allowed.\n', { allow: 'GET, HEAD' });

  if (url.pathname.startsWith(THEME_PREFIX)) return theme(request, env, url);
  if (url.pathname === '/robots.txt') return text(env, 200, robotsTxt(env), { 'cache-control': 'public, max-age=300' });
  if (RUNTIME_FILES[url.pathname]) {
    // The local preview reads the staging manifest from another origin.
    // The root llms.txt, like every llms.txt, is for AI tools: search engines index the pages.
    const ai = url.pathname === '/llms.txt' && !truthy(env.NOINDEX_ALL) ? { 'x-robots-tag': 'noindex' } : {};
    const r = await serveObject(request, env, env.DOCS, RUNTIME_FILES[url.pathname], { maxAge: 60, extra: { 'access-control-allow-origin': '*', ...ai } });
    if (r) return r;
  }
  if (url.pathname.startsWith('/_preview/')) {
    const r = await preview(request, env, url);
    if (r) return r;
  }

  // Old Confluence paths keep the 301s Cloudflare sends for them today.
  const archived = confluenceRedirect(url.pathname, url.search);
  if (archived) return redirect(env, 301, archived);

  const manifest = await loadManifest(env);
  const r = route(manifest, url.pathname);
  if (r.type === 'bad') return text(env, 400, 'Malformed URL.\n');
  // A redirect within WSO2 Docs keeps the query; one to an old site doesn't.
  if (r.type === 'redirect') return redirect(env, r.status, r.location.startsWith('/') ? `${r.location}${url.search}` : r.location);
  if (r.type === 'object') {
    const extra = { 'x-docs-release': `${r.space ?? '_landing'}/${r.segment ?? '_'}/${r.release}` };
    if (r.eol && !truthy(env.NOINDEX_ALL)) extra['x-robots-tag'] = 'noindex, follow';
    // Unlisted Doc spaces (reached from links, such as a console) stay out of search.
    else if (r.unlisted && !truthy(env.NOINDEX_ALL)) extra['x-robots-tag'] = 'noindex';
    // Twins and llms.txt files are for AI tools; search engines index the HTML page.
    else if (/\.md$|\/llms(?:-full)?\.txt$/.test(r.key) && !truthy(env.NOINDEX_ALL)) extra['x-robots-tag'] = 'noindex';
    const res = await serveObject(request, env, env.DOCS, r.key, { maxAge: Number(env.HTML_MAX_AGE ?? 300), extra });
    if (res) return res;
  }
  // A redirect never hides a live page: the table is only consulted on a miss.
  const moved = await lookupRedirect(env, url.pathname);
  if (moved) return redirect(env, moved.status, `${moved.to}${url.search}`);
  return notFound(request, env, url, r);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error(err?.stack ?? String(err));
      return text(env, 500, 'Something went wrong at the WSO2 Docs edge.\n');
    }
  },
};
