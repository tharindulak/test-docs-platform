// search_docs for the MCP endpoint: the same index and search scopes as the
// search box (Search for WSO2 Docs).
//   This Edition                docSpace + edition (end-of-life allowed)
//   All Editions of a Doc space docSpace only, end-of-life left out
//   All of WSO2 Docs            neither: one Edition per Doc space, where its
//                               selector opens (Cloud first, a Cloud part
//                               included); Unlisted Doc spaces left out unless
//                               indexed (Contribute)
// Hits from the Edition that feeds latest move to their /latest/ URL unless the
// caller asked for that Edition. The backend sits behind a small interface,
// { search({ query, scope, limit }) → hits }, so tests use a fake; the real one
// queries Typesense with a search-only key.
//
// Vars: TYPESENSE_HOST (https://search-staging.docs.wso2.com), TYPESENSE_COLLECTION,
// secret TYPESENSE_SEARCH_KEY. Document fields follow the search collection
// (lib/search/schema.mjs: url, lvl0-3, content, formerNames, docSpace, edition), which the
// release's search-index step fills from _platform/search-records.json.

import { twinUrlPath } from './twin-paths.mjs';

// The search box's fields (lib/search/scopes.mjs searchParameters); Miniflare
// can't load modules outside worker/src, so test/mcp.test.mjs keeps them equal.
export const QUERY_BY = 'lvl1,lvl2,lvl3,content,formerNames';
export const INCLUDE_FIELDS = 'url,lvl0,lvl1,lvl2,lvl3,content,docSpace,edition';

// A component whose Cloud is a Cloud part (cloud.in) has its Cloud deployed
// when its platform's Cloud tree is; the part's records are the component's
// Cloud (docSpace <component>, edition cloud).
const partPlatform = (manifest, space) => (space.cloud?.in && !(space.editions ?? []).some((e) => e.id === 'cloud') ? manifest.docSpaces?.[space.cloud.in] : null);
const deployedEditions = (manifest, space) => {
  const own = Object.entries(space.deployments ?? {}).filter(([seg]) => seg !== 'latest').map(([seg, d]) => (seg === '_' ? '_' : d.edition));
  const platform = partPlatform(manifest, space);
  return platform?.deployments?.cloud && !own.includes('cloud') ? ['cloud', ...own] : own;
};
const statusOf = (space, id) => space.editions?.find((e) => e.id === id)?.status ?? 'live';
// An Unlisted Doc space (listed: false) searches only itself: it is left out of
// the all-Doc-spaces search unless indexed as an exception (indexed: true).
const onlyItself = (space) => space.listed === false && space.indexed !== true;
// The one Edition a Doc space gives the all-Doc-spaces search: where its
// selector opens (Cloud first, a Cloud part included), else its newest release.
const openEdition = (space, ids) => (ids.includes('cloud') ? 'cloud' : ids.includes(space.latest) ? space.latest : ids[0]);

// → { pairs: [{ docSpace, editions: [...] }], explicit } or { error }
export function searchScope(manifest, { docSpace, edition } = {}) {
  const spaces = manifest.docSpaces ?? {};
  if (edition && !docSpace) return { error: '"edition" needs "docSpace" too' };
  if (docSpace) {
    const space = spaces[docSpace];
    if (!space) return { error: `Unknown Doc space "${docSpace}". Call list_editions to see them.` };
    if (edition) {
      const id = edition === 'latest' ? space.latest : edition;
      if (!id || !deployedEditions(manifest, space).includes(id)) return { error: `"${docSpace}" has no Edition "${edition}" on WSO2 Docs. Call list_editions to see them.` };
      return { pairs: [{ docSpace, editions: [id] }], explicit: edition !== 'latest' };
    }
    const ids = deployedEditions(manifest, space).filter((id) => statusOf(space, id) !== 'end-of-life');
    return ids.length ? { pairs: [{ docSpace, editions: ids }], explicit: false } : { error: `"${docSpace}" has no live Editions` };
  }
  const pairs = [];
  for (const [slug, space] of Object.entries(spaces)) {
    if (onlyItself(space)) continue;
    const ids = deployedEditions(manifest, space).filter((id) => statusOf(space, id) !== 'end-of-life');
    if (!ids.length) continue;
    pairs.push({ docSpace: slug, editions: [openEdition(space, ids)] });
  }
  return { pairs, explicit: false };
}

const quote = (v) => `\`${String(v).replace(/`/g, '')}\``;

export function typesenseFilter(pairs) {
  // "_" (an unversioned Doc space) is a token separator in the index and can't
  // be filtered on: such a Doc space is found by docSpace alone.
  const parts = pairs.map((p) => (p.editions.includes('_') ? `(docSpace:=${quote(p.docSpace)})` : `(docSpace:=${quote(p.docSpace)} && edition:=[${p.editions.map(quote).join(',')}])`));
  return parts.join(' || ');
}

// URL of a hit as the reader should get it: the /latest/ copy for the Edition
// that feeds latest, and the host the MCP request came to (staging serves the
// same paths as production).
export function presentHit(manifest, hit, { explicit, origin }) {
  let url;
  try {
    url = new URL(hit.url);
  } catch {
    return null;
  }
  const space = manifest.docSpaces?.[hit.docSpace];
  const latest = space?.latest;
  const prefix = `/${hit.docSpace}/${hit.edition}/`;
  if (!explicit && latest && hit.edition === latest && space.deployments?.latest && url.pathname.startsWith(prefix)) {
    url.pathname = `/${hit.docSpace}/latest/${url.pathname.slice(prefix.length)}`;
  }
  const page = new URL(url.pathname + url.hash, origin);
  const segs = page.pathname.split('/').filter(Boolean);
  const base = space?.model === 'unversioned' ? `/${segs[0]}/` : `/${segs.slice(0, 2).join('/')}/`;
  const markdown = new URL(twinUrlPath(page.pathname, base), origin);
  return {
    title: [hit.hierarchy?.lvl1, hit.hierarchy?.lvl2, hit.hierarchy?.lvl3].filter(Boolean).join(' › ') || hit.url,
    url: page.href,
    markdownUrl: markdown.href,
    docSpace: hit.docSpace,
    edition: hit.edition,
    snippet: (hit.snippet ?? hit.content ?? '').slice(0, 300),
  };
}

export function typesenseBackend({ host, apiKey, collection, fetchImpl = fetch }) {
  return {
    async search({ query, scope, limit = 8 }) {
      const params = new URLSearchParams({
        q: query, query_by: QUERY_BY, per_page: String(limit),
        include_fields: INCLUDE_FIELDS,
        highlight_fields: 'content', highlight_start_tag: '', highlight_end_tag: '',
      });
      if (scope.pairs.length) params.set('filter_by', typesenseFilter(scope.pairs));
      const res = await fetchImpl(`${host.replace(/\/$/, '')}/collections/${encodeURIComponent(collection)}/documents/search?${params}`, {
        headers: { 'x-typesense-api-key': apiKey },
      });
      if (!res.ok) throw new Error(`search answered ${res.status}`);
      const body = await res.json();
      return (body.hits ?? []).map((h) => {
        const d = h.document ?? {};
        const flat = (k) => d[k] ?? null;
        return {
          url: d.url, docSpace: d.docSpace, edition: d.edition, content: d.content,
          hierarchy: { lvl0: flat('lvl0'), lvl1: flat('lvl1'), lvl2: flat('lvl2'), lvl3: flat('lvl3') },
          snippet: h.highlights?.find((x) => x.field === 'content')?.snippet ?? h.highlight?.content?.snippet ?? null,
        };
      });
    },
  };
}

// The configured backend, or null when search isn't set up on this host.
export function searchBackend(env, fetchImpl = fetch) {
  if (!env.TYPESENSE_HOST || !env.TYPESENSE_SEARCH_KEY || !env.TYPESENSE_COLLECTION) return null;
  return typesenseBackend({ host: env.TYPESENSE_HOST, apiKey: env.TYPESENSE_SEARCH_KEY, collection: env.TYPESENSE_COLLECTION, fetchImpl });
}
