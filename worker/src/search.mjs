// search_docs for the MCP endpoint: the same index and search scopes as the
// search box (Search for WSO2 Docs).
//   This Edition                docSpace + edition (end-of-life allowed)
//   All Editions of a Doc space docSpace only, end-of-life left out
//   All of WSO2 Docs            neither: one Edition per Doc space, where its
//                               selector opens (Cloud first, a Cloud part
//                               included); Unlisted Doc spaces left out unless
//                               indexed (Contribute)
//   Cloud of every Doc space    edition "cloud" only
// A family Cloud's Cloud also covers its Cloud parts. Hits from the Edition
// that feeds latest move to their /latest/ URL unless the caller asked for that
// Edition. The backend sits behind a small interface,
// { search({ query, scope, limit, includeSelfHosted }) → hits, best page first,
// up to three per page }, so tests use a fake; the real one queries Typesense
// with a search-only key.
//
// Vars: TYPESENSE_HOST (staging: https://141-148-145-173.sslip.io/_typesense), TYPESENSE_COLLECTION,
// secret TYPESENSE_SEARCH_KEY. Document fields follow the search collection
// (lib/search/schema.mjs: url, lvl0-3, content, formerNames, docSpace, edition), which the
// release's search-index step fills from _platform/search-records.json.

import { twinUrlPath } from './twin-paths.mjs';

// The search box's fields and weights (lib/search/scopes.mjs searchParameters); Miniflare
// can't load modules outside worker/src, so test/mcp.test.mjs keeps them equal.
export const QUERY_BY = 'lvl1,lvl2,lvl3,content,formerNames';
export const QUERY_BY_WEIGHTS = '8,5,3,1,1';
export const INCLUDE_FIELDS = 'url,lvl0,lvl1,lvl2,lvl3,content,docSpace,edition,cloudIn,selfHosted';
// The question stop-word set search-setup makes (lib/search/schema.mjs MCP_STOPWORDS_ID, MCP_STOPWORDS).
export const STOPWORDS_ID = 'wso2docs-question-words';
export const STOPWORDS = ['how', 'do', 'does', 'i', 'what', 'the', 'a', 'an', 'my', 'to', 'for', 'of', 'can', 'where',
  'which', 'when', 'why', 'with', 'and', 'or', 'you', 'your', 'we', 'our', 'me', 'their', 'them', 'from'];
const SECTION_TEXT = 2000;

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
const liveEditions = (manifest, space) => deployedEditions(manifest, space).filter((id) => statusOf(space, id) !== 'end-of-life');
// An Unlisted Doc space (listed: false) searches only itself: it is left out of
// the all-Doc-spaces search unless indexed as an exception (indexed: true).
const onlyItself = (space) => space.listed === false && space.indexed !== true;
// The one Edition a Doc space gives the all-Doc-spaces search: where its
// selector opens (Cloud first, a Cloud part included), else its newest release.
const openEdition = (space, ids) => (ids.includes('cloud') ? 'cloud' : ids.includes(space.latest) ? space.latest : ids[0]);
// The Cloud parts of a family Cloud, each searched as its component's Cloud.
const cloudParts = (manifest, family) => Object.entries(manifest.docSpaces ?? {})
  .filter(([, s]) => s.cloud?.in === family && !onlyItself(s) && partPlatform(manifest, s) && liveEditions(manifest, s).includes('cloud'))
  .map(([slug]) => ({ docSpace: slug, editions: ['cloud'] }));

// The Doc spaces search_docs offers as `product`: those the all-Doc-spaces search covers.
export const searchableProducts = (manifest) => Object.entries(manifest.docSpaces ?? {})
  .filter(([, s]) => !onlyItself(s) && liveEditions(manifest, s).length)
  .map(([slug]) => slug);

// → { pairs: [{ docSpace, editions: [...] }], explicit, allEditions? } or { error }
export function searchScope(manifest, { docSpace, edition } = {}) {
  const spaces = manifest.docSpaces ?? {};
  if (docSpace) {
    const space = spaces[docSpace];
    if (!space) return { error: `Unknown product "${docSpace}". Valid: ${searchableProducts(manifest).join(', ')}` };
    let pairs;
    let explicit = false;
    let allEditions = false;
    if (edition) {
      const id = edition === 'latest' ? space.latest : edition;
      if (!id || !deployedEditions(manifest, space).includes(id)) return { error: `"${docSpace}" has no Edition "${edition}" on WSO2 Docs. Call list_editions to see them.` };
      pairs = [{ docSpace, editions: [id] }];
      explicit = edition !== 'latest';
    } else {
      const ids = liveEditions(manifest, space);
      if (!ids.length) return { error: `"${docSpace}" has no live Editions` };
      pairs = [{ docSpace, editions: ids }];
      allEditions = ids.length > 1;
    }
    return { pairs: pairs[0].editions.includes('cloud') ? [...pairs, ...cloudParts(manifest, docSpace)] : pairs, explicit, ...(allEditions ? { allEditions } : {}) };
  }
  if (edition && edition !== 'cloud') return { error: `Edition "${edition}" needs "product" too; only "cloud" searches every product` };
  const pairs = [];
  for (const [slug, space] of Object.entries(spaces)) {
    if (onlyItself(space)) continue;
    const ids = liveEditions(manifest, space);
    if (edition === 'cloud' ? !ids.includes('cloud') : !ids.length) continue;
    pairs.push({ docSpace: slug, editions: [edition === 'cloud' ? 'cloud' : openEdition(space, ids)] });
  }
  if (!pairs.length) return { error: edition === 'cloud' ? 'No product has a Cloud Edition on WSO2 Docs yet. Call list_editions to see them.' : 'No product is searchable on WSO2 Docs yet.' };
  return { pairs, explicit: edition === 'cloud' };
}

const quote = (v) => `\`${String(v).replace(/`/g, '')}\``;

export function typesenseFilter(pairs) {
  // "_" (an unversioned Doc space) is a token separator in the index and can't
  // be filtered on: such a Doc space is found by docSpace alone.
  const parts = pairs.map((p) => (p.editions.includes('_') ? `(docSpace:=${quote(p.docSpace)})` : `(docSpace:=${quote(p.docSpace)} && edition:=[${p.editions.map(quote).join(',')}])`));
  return parts.join(' || ');
}

// The scope, and Self-hosted additions in Cloud's records left out unless asked for.
export function searchFilter(scope, { includeSelfHosted = false } = {}) {
  const parts = [scope.pairs.length ? `(${typesenseFilter(scope.pairs)})` : '', includeSelfHosted ? '' : 'selfHosted:!=true'];
  return parts.filter(Boolean).join(' && ');
}

// One hit as the agent gets it: the page's URL as the reader should get it
// (the /latest/ copy for the Edition that feeds latest, on the host the MCP
// request came to: staging serves the same paths as production) and the
// section the hit is in.
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
  const section = new URL(url.pathname + url.hash, origin);
  const page = new URL(url.pathname, origin);
  const segs = page.pathname.split('/').filter(Boolean);
  const base = space?.model === 'unversioned' ? `/${segs[0]}/` : `/${segs.slice(0, 2).join('/')}/`;
  const title = hit.hierarchy?.lvl1 || page.href;
  return {
    title,
    url: page.href,
    markdownUrl: new URL(twinUrlPath(page.pathname, base), origin).href,
    product: hit.cloudIn || hit.docSpace,
    docSpace: hit.docSpace,
    edition: hit.edition,
    selfHosted: hit.selfHosted === true,
    section: {
      heading: [hit.hierarchy?.lvl2, hit.hierarchy?.lvl3].filter(Boolean).join(' › ') || title,
      url: section.href,
      text: (hit.content ?? '').slice(0, SECTION_TEXT),
    },
  };
}

// Hits → one result per page, in order: its best section, and up to two more.
export function presentPages(manifest, hits, { explicit, origin, limit }) {
  const pages = new Map();
  for (const hit of hits) {
    const r = presentHit(manifest, hit, { explicit, origin });
    if (!r) continue;
    const page = pages.get(r.url);
    if (!page) pages.set(r.url, { ...r, moreSections: [] });
    else if (page.moreSections.length < 2) page.moreSections.push({ heading: r.section.heading, url: r.section.url });
  }
  return [...pages.values()].slice(0, limit);
}

// A query made only of question words keeps them: with the set, Typesense would search for nothing.
// Words split as the collection splits them (whitespace and its token separators - _ / .).
const onlyStopwords = (query) => query.toLowerCase().split(/[\s\-_/.]+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)
  .every((w) => STOPWORDS.includes(w));
// The search box's orders (lib/search/scopes.mjs searchParameters): one Edition by match, then
// shallower records; All Editions with newer Editions first.
export const EDITION_SORT = '_text_match:desc,level:asc';
export const ALL_EDITIONS_SORT = '_text_match(buckets: 10):desc,editionRank:desc,level:asc';

// A collection that search-setup hasn't brought up to the schema yet answers
// 404 for the stop-word set, or 400 for grouping on page or filtering on
// selfHosted: the search again without what it lacks, or null.
function withoutMissing(search, r, { limit, scope }) {
  if ((r.code === 404 && /stopword/i.test(r.error ?? '')) || (r.code === 400 && /group by/i.test(r.error ?? ''))) {
    const { stopwords, group_by: g, group_limit: gl, ...rest } = search;
    return { ...rest, per_page: Math.min(limit * 20, 250) };
  }
  if (r.code === 400 && /filter field named `selfHosted`/.test(r.error ?? '') && search.filter_by) {
    const { filter_by: f, ...rest } = search;
    const filter = searchFilter(scope, { includeSelfHosted: true });
    return filter ? { ...rest, filter_by: filter } : rest;
  }
  return null;
}

// MCP searches only: question words dropped, hits grouped by page (a page is
// relative to its Doc space and Edition), and no analytics, so an agent's
// queries never show in popular or no-hit queries. A POST to /multi_search
// keeps the query out of URLs, and so out of access logs. On a collection not
// set up yet it searches again without what the collection lacks: without the
// stop words and the grouping (asking for 20 hits per page wanted, at most 250,
// Typesense's page size limit, for the caller to group), and without the
// selfHosted filter.
export function typesenseBackend({ host, apiKey, collection, fetchImpl = fetch }) {
  const post = async (search) => {
    const res = await fetchImpl(`${host.replace(/\/$/, '')}/multi_search`, {
      method: 'POST',
      headers: { 'x-typesense-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ searches: [{ collection, ...search }] }),
    });
    if (!res.ok) throw new Error(`search answered ${res.status}`);
    return (await res.json()).results?.[0] ?? {};
  };
  return {
    async search({ query, scope, limit = 5, includeSelfHosted = false }) {
      const base = {
        q: query, query_by: QUERY_BY, query_by_weights: QUERY_BY_WEIGHTS, text_match_type: 'max_weight', prioritize_exact_match: true,
        include_fields: INCLUDE_FIELDS, highlight_fields: 'none', enable_analytics: false,
      };
      const filter = searchFilter(scope, { includeSelfHosted });
      if (filter) base.filter_by = filter;
      base.sort_by = scope.allEditions ? ALL_EDITIONS_SORT : EDITION_SORT;
      let search = { ...base, ...(onlyStopwords(query) ? {} : { stopwords: STOPWORDS_ID }), group_by: 'docSpace,edition,page', group_limit: 3, per_page: limit };
      let body = await post(search);
      for (let i = 0; i < 2 && body.code; i += 1) {
        search = withoutMissing(search, body, { limit, scope });
        if (!search) break;
        body = await post(search);
      }
      if (body.code) throw new Error(`search answered ${body.code}`);
      return (body.grouped_hits?.flatMap((g) => g.hits ?? []) ?? body.hits ?? []).map((h) => {
        const d = h.document ?? {};
        const flat = (k) => d[k] ?? null;
        return {
          url: d.url, docSpace: d.docSpace, edition: d.edition, content: d.content, cloudIn: d.cloudIn ?? null, selfHosted: d.selfHosted === true,
          hierarchy: { lvl0: flat('lvl0'), lvl1: flat('lvl1'), lvl2: flat('lvl2'), lvl3: flat('lvl3') },
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
