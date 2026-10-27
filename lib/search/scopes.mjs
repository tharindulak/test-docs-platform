// Query-time search rules (Search for WSO2 Docs; Search records for Cloud
// parts and family Clouds), worked out from the runtime Deployment manifest
// so none of them needs a re-index. Pure and browser-safe: the search box,
// the full results page and the tests all use these.
//
//   This Docs section      the default on a page in a Docs section: every Doc
//                          space the section's menu lists, at the Edition the
//                          reader is on for the Doc space being read, and at
//                          the Edition its selector opens (Cloud first) for the
//                          others. The section is the one the chrome draws (the
//                          session's section, else the home section), read
//                          from the live manifest, so a section that changes
//                          changes the scope without a rebuild.
//   All of WSO2 Docs       one click wider: the section's Doc spaces as above,
//                          plus one Edition of every other Doc space (the
//                          reader's remembered one, else where its selector opens)
//   This Edition           the Edition being read (end of life included)
//   All Editions           every live Edition of the Doc space, newer ranked higher
//
// A Cloud part's pages are its component's Cloud (docSpace <component>,
// edition cloud, cloudIn <platform>), so This Edition and All Editions of a
// component cover its Cloud part; a family Cloud's own pages are the family
// Doc space's. An Unlisted Doc space (listed: false) searches only itself
// and is in no other search; one indexed as an exception (indexed: true:
// Contribute) is in All of WSO2 Docs. End-of-life Editions appear only under
// This Edition. Hits from the newest release open under /<space>/latest/, and
// hits on another Docs deployment open with full-page navigation.
import { cloudIn, editionLabel as selectorLabel, editionList, editionName, hasCloud, latestOf, newestRelease } from '../switching.mjs';

export const SCOPES = {
  section: 'This Docs section',
  all: 'All of WSO2 Docs',
  edition: 'This Edition',
  docspace: 'All Editions',
};

const isEol = (e) => e?.status === 'end-of-life' || e?.status === 'eol';
const spacesOf = (manifest) => manifest?.docSpaces ?? {};
const unversionedSpace = (s) => s?.model === 'unversioned';

// Search only itself, in no other search: an Unlisted Doc space not indexed
// as an explicit exception.
export const searchesOnlyItself = (s) => s?.listed === false && s?.indexed !== true;
// On WSO2 Docs and searchable from elsewhere.
export const inWideSearch = (s) => Boolean(s) && s.status !== 'legacy' && !searchesOnlyItself(s);

const shortTitle = (title) => String(title ?? '').replace(/\s+Documentation$/, '');

// The Docs section the reader's search covers by default, as the chrome draws
// it (ctx.section, from lib/switching.mjs sectionFor), if the manifest has it.
const sectionOf = (ctx, manifest) => (ctx?.section && manifest?.sections?.[ctx.section] ? manifest.sections[ctx.section] : null);

// A scope's label: the section's short title ("Identity Platform docs").
export function scopeLabel(scope, ctx, manifest) {
  if (scope === 'section') {
    const sec = sectionOf(ctx, manifest);
    return sec ? `${shortTitle(sec.title)} docs` : SCOPES.section;
  }
  return SCOPES[scope];
}

// Which scopes a page offers, and its default. Without a manifest (or a
// section), Doc space pages keep the three scopes of the first Pilot.
export function scopesFor(ctx, manifest = null) {
  if (ctx.landing || !ctx.docSpace) return { scopes: ['all'], default: 'all' };
  const s = spacesOf(manifest)[ctx.docSpace];
  const several = !s || unversionedSpace(s) ? !s : liveEditions(s, manifest).length > 1;
  const own = several ? ['edition', 'docspace'] : ['edition'];
  if (s && searchesOnlyItself(s)) return { scopes: own, default: 'edition' };
  if (sectionOf(ctx, manifest)) return { scopes: ['section', 'all', ...own], default: 'section' };
  return { scopes: [...own, 'all'], default: 'edition' };
}

const q = (v) => {
  if (typeof v !== 'string' || v.includes('`')) throw new Error(`Invalid filter value ${v}`);
  return `\`${v}\``;
};
const list = (values) => (values.length === 1 ? `:=${q(values[0])}` : `:=[${values.map(q).join(',')}]`);
const NOTHING = 'docSpace:=`__none__`';

// Whether an Edition is deployed, when the manifest says (the published one
// carries `deployments`; a baked snapshot does not, and then every Edition
// counts). A component's Cloud is deployed when its platform's Cloud tree is.
export function isDeployed(manifest, slug, edition) {
  const spaces = spacesOf(manifest);
  const s = spaces[slug];
  if (!s) return false;
  const platform = edition === 'cloud' ? cloudIn(s) : null;
  const served = platform ? spaces[platform] : s;
  if (!served) return false;
  if (!served.deployments) return true;
  return Boolean(served.deployments[unversionedSpace(served) ? '_' : edition]);
}

// Editions a reader can see outside This Edition, in manifest order (Cloud
// first, a component's Cloud part included): not legacy (never indexed) and
// not end of life. `space` may be a slug's entry; Cloud parts need no manifest.
export function liveEditions(space, _manifest = null) {
  if (!space) return [];
  const eol = new Set((space.editions ?? []).filter(isEol).map((e) => e.id));
  return editionList(space).filter((id) => !eol.has(id));
}

// The Edition a Doc space's selector opens: Cloud where it has Cloud (its
// own, or its Cloud part) and that Cloud is deployed, else its newest release.
export function opensEdition(manifest, slug) {
  const s = spacesOf(manifest)[slug];
  if (!s || unversionedSpace(s)) return null;
  const live = liveEditions(s);
  const first = latestOf(s);
  if (first && live.includes(first) && isDeployed(manifest, slug, first)) return first;
  const newest = newestRelease(s);
  if (newest && live.includes(newest)) return newest;
  return live[0] ?? null;
}

// The one Edition a Doc space contributes to All of WSO2 Docs. `remembered`
// is the reader's stored choice ("latest" means follow where it opens).
export function oneEdition(manifest, slug, remembered) {
  const s = spacesOf(manifest)[slug];
  const live = liveEditions(s);
  if (remembered && remembered !== 'latest' && live.includes(remembered)) return remembered;
  return opensEdition(manifest, slug);
}

// The remembered Edition per Doc space (Version switching: one value per Doc
// space in localStorage, set only by an explicit dropdown choice).
export const rememberKey = (slug) => `wso2docs:edition:${slug}`;
export function readRemembered(storage, slugs) {
  const out = {};
  for (const slug of slugs) {
    try {
      const v = storage?.getItem(rememberKey(slug));
      if (v) out[slug] = v;
    } catch {
      // storage blocked: behave as if nothing is remembered
    }
  }
  return out;
}

// One Doc space at one Edition as a filter clause (an unversioned one by
// docSpace alone: its Edition "_" is a token separator in the index).
const clause = (slug, edition) => (edition === '_' ? `docSpace:=${q(slug)}` : `(docSpace:=${q(slug)} && edition:=${q(edition)})`);

// The Doc spaces of the reader's Docs section (its menu's Doc space entries,
// in order, plus the Doc space being read), each at its Edition: the one
// being read, else where its selector opens. Unlisted, legacy and unknown
// Doc spaces are left out. → [[slug, edition]]
export function sectionPairs(ctx, manifest) {
  const sec = sectionOf(ctx, manifest);
  if (!sec) return [];
  const spaces = spacesOf(manifest);
  const slugs = [...new Set([ctx.docSpace, ...(sec.menu ?? []).map((e) => e.docSpace).filter(Boolean)])];
  const out = [];
  for (const slug of slugs) {
    const s = spaces[slug];
    if (!inWideSearch(s)) continue;
    if (unversionedSpace(s)) {
      out.push([slug, '_']);
      continue;
    }
    const reading = slug === ctx.docSpace && liveEditions(s).includes(ctx.edition) ? ctx.edition : null;
    const e = reading ?? opensEdition(manifest, slug);
    if (e) out.push([slug, e]);
  }
  return out;
}

// Every Doc space in All of WSO2 Docs at its one Edition: the section's as in
// sectionPairs (so the switch only widens), then every other searchable Doc
// space at its remembered Edition, else where its selector opens.
export function allPairs(ctx, manifest, remembered = {}) {
  const spaces = spacesOf(manifest);
  const out = ctx.landing ? [] : sectionPairs(ctx, manifest);
  // A page outside any section still keeps its own Edition when widening.
  if (!ctx.landing && !out.length && ctx.docSpace && inWideSearch(spaces[ctx.docSpace])) {
    const s = spaces[ctx.docSpace];
    if (unversionedSpace(s)) out.push([ctx.docSpace, '_']);
    else if (liveEditions(s).includes(ctx.edition)) out.push([ctx.docSpace, ctx.edition]);
  }
  const done = new Set(out.map(([slug]) => slug));
  for (const [slug, s] of Object.entries(spaces).sort(([a], [b]) => a.localeCompare(b))) {
    if (done.has(slug) || !inWideSearch(s)) continue;
    if (unversionedSpace(s)) {
      out.push([slug, '_']);
      continue;
    }
    const e = oneEdition(manifest, slug, remembered[slug]);
    if (e) out.push([slug, e]);
  }
  return out;
}

// Filter chips a scope offers: Edition chips under All Editions; Doc space
// chips under the section and All of WSO2 Docs, plus product family chips on
// the landing page.
export function chipOptions(scope, ctx, manifest, remembered = {}) {
  const spaces = spacesOf(manifest);
  const none = { editions: [], docSpaces: [], families: [] };
  if (scope === 'docspace') return { ...none, editions: liveEditions(spaces[ctx.docSpace]) };
  if (scope === 'section' || scope === 'all') {
    const pairs = scope === 'section' ? sectionPairs(ctx, manifest) : allPairs(ctx, manifest, remembered);
    const docSpaces = pairs.map(([slug]) => ({ id: slug, label: spaces[slug]?.displayName ?? slug, family: spaces[slug]?.family ?? null }));
    const families = scope === 'all' && (ctx.landing || !ctx.docSpace) ? [...new Set(docSpaces.map((d) => d.family).filter(Boolean))].sort() : [];
    return { ...none, docSpaces, families };
  }
  return none;
}

// The Typesense filter_by for a scope. `chips` narrows it: { editions,
// docSpaces, families }. The result is parenthesised, because the InstantSearch
// adapter joins it to other filters with &&.
export function buildFilter({ scope, ctx, manifest, remembered = {}, chips = {} }) {
  const spaces = spacesOf(manifest);
  // An unversioned Doc space's one Edition, "_", is a token separator in the
  // index and can't be filtered on: its records are found by docSpace alone.
  const unversioned = ctx.docSpace && (ctx.edition === '_' || unversionedSpace(spaces[ctx.docSpace]));
  if (scope === 'edition') {
    if (!ctx.docSpace || !ctx.edition) return NOTHING;
    if (unversioned) return `(docSpace:=${q(ctx.docSpace)})`;
    return `(docSpace:=${q(ctx.docSpace)} && edition:=${q(ctx.edition)})`;
  }
  if (scope === 'docspace') {
    if (unversioned) return `(docSpace:=${q(ctx.docSpace)})`;
    let editions = liveEditions(spaces[ctx.docSpace]);
    if (chips.editions?.length) editions = editions.filter((e) => chips.editions.includes(e));
    if (!ctx.docSpace || !editions.length) return NOTHING;
    return `(docSpace:=${q(ctx.docSpace)} && edition${list(editions)})`;
  }
  if (scope === 'section' || scope === 'all') {
    // A Doc space that searches only itself is never widened.
    if (!ctx.landing && ctx.docSpace && searchesOnlyItself(spaces[ctx.docSpace])) return NOTHING;
    const pairs = (scope === 'section' ? sectionPairs(ctx, manifest) : allPairs(ctx, manifest, remembered))
      .filter(([slug]) => !chips.docSpaces?.length || chips.docSpaces.includes(slug))
      .filter(([slug]) => !chips.families?.length || chips.families.includes(spaces[slug]?.family));
    return pairs.length ? `(${pairs.map(([slug, e]) => clause(slug, e)).join(' || ')})` : NOTHING;
  }
  throw new Error(`Unknown search scope "${scope}"`);
}

// Typesense search parameters per scope. analyticsTag tags the query for
// popular and no-hit analytics with the deployment it came from.
export function searchParameters(scope, { analyticsTag } = {}) {
  return {
    // formerNames: a query naming a former product name (Asgardeo) finds
    // that Doc space's pages; tokens match across fields.
    query_by: 'lvl1,lvl2,lvl3,content,formerNames',
    query_by_weights: '8,5,3,1,1',
    text_match_type: 'max_weight',
    prioritize_exact_match: true,
    highlight_full_fields: 'lvl1,lvl2,lvl3',
    highlight_affix_num_tokens: 8,
    exclude_fields: 'release',
    sort_by: scope === 'docspace' ? '_text_match(buckets: 10):desc,editionRank:desc,level:asc' : '_text_match:desc,level:asc',
    ...(analyticsTag ? { analytics_tag: analyticsTag } : {}),
  };
}

// The page a search starts from. `docSpace` and `edition` are what the reader
// is reading (inside a Cloud part: the component and "cloud"); `served` is the
// deployment serving the page ({ space, segment }: the platform's Cloud tree
// for a Cloud part); `segment` is the Edition or "latest"; `section` is the
// Docs section the chrome draws (null outside any).
export function deploymentContext({ docSpace, edition, asLatest, landing = false, served = null, section = null }) {
  if (landing || !docSpace) return { landing: true, docSpace: null, edition: null, segment: null, served: null, section: null };
  const segment = asLatest ? 'latest' : edition;
  return { landing: false, docSpace, edition, segment, served: served ?? { space: docSpace, segment }, section: section ?? null };
}

// The context of a page from its navigation view (lib/switching.mjs focus):
// a Cloud part's page is its component's Cloud, served by the platform's tree.
export function contextFromView(view, f, section = null) {
  if (!view || !f) return deploymentContext({ landing: true });
  return deploymentContext({
    docSpace: f.doc, edition: f.edition, asLatest: Boolean(view.asLatest) && !f.inPart, section,
    served: { space: view.space, segment: view.asLatest ? 'latest' : view.edition },
  });
}

export const analyticsTag = (ctx) => (ctx.landing ? 'landing' : `${ctx.docSpace}/${ctx.segment}`);

// Where a hit opens. A Cloud part's hit opens in its platform's Cloud tree
// (/<platform>/cloud/<part>/<page>). Hits from the newest release go to
// /<space>/latest/ (so readers on /latest/ stay there), except for a reader on
// that Edition's pinned deployment, who stays on it; Cloud never moves (it has
// no /latest/ copy). `sameDeployment` false means full-page navigation, since
// the current site's base path must not be prefixed.
export function hitTarget(hit, ctx, manifest) {
  const space = spacesOf(manifest)[hit.docSpace];
  const onPinnedTwin = ctx.docSpace === hit.docSpace && ctx.segment === hit.edition;
  const latest = hit.edition !== 'cloud' && hit.edition !== '_' && space?.latest === hit.edition && !onPinnedTwin;
  const segment = latest ? 'latest' : hit.edition;
  const page = (hit.page ?? '').replace(/^\//, '');
  const anchor = hit.anchor ? `#${hit.anchor}` : '';
  const platform = hit.edition === 'cloud' ? hit.cloudIn ?? cloudIn(space) : null;
  const servedSpace = platform ?? hit.docSpace;
  // Unversioned Doc spaces have no Edition segment: /contribute/<page>.
  const href = platform
    ? `/${platform}/cloud/${hit.docSpace}/${page}${anchor}`
    : `/${hit.docSpace}/${segment === '_' ? '' : `${segment}/`}${page}${anchor}`;
  const here = ctx.served ?? { space: ctx.docSpace, segment: ctx.segment };
  return { href, segment, sameDeployment: !ctx.landing && !ctx.elsewhere && here.space === servedSpace && here.segment === segment };
}

// The Edition badge on a hit, in the chrome's words (lib/switching.mjs): the
// newest release is "(newest release)" where the Doc space has Cloud and
// "(latest)" where it does not. Under All Editions (one Doc space) it is the
// selector's label ("Cloud", "Identity Server 7.3.0 (newest release)"); in
// wider scopes (`withName`) a Cloud names its Doc space ("Identity Server
// Cloud", "Identity Platform Cloud") and an unversioned Doc space is its name.
export function editionLabel(hit, manifest, { withName = false } = {}) {
  const space = spacesOf(manifest)[hit.docSpace];
  if (hit.edition === '_' || unversionedSpace(space)) return space?.displayName ?? hit.docSpaceName ?? hit.docSpace;
  if (!space) return hit.edition === 'cloud' ? 'Cloud' : hit.edition;
  if (hit.edition === 'cloud') return withName ? editionName(space, 'cloud') : selectorLabel(space, 'cloud');
  if (withName) return selectorLabel(space, hit.edition);
  const newest = newestRelease(space);
  return hit.edition === newest ? `${hit.edition} ${hasCloud(space) ? '(newest release)' : '(latest)'}` : hit.edition;
}

// "See all results": the full search page on the Landing deployment.
export function searchPageUrl({ query, scope, ctx }) {
  const p = new URLSearchParams();
  if (query) p.set('q', query);
  p.set('scope', scope);
  if (!ctx.landing && ctx.docSpace && (scope !== 'all' || ctx.section)) {
    if (ctx.section) p.set('section', ctx.section);
    p.set('space', ctx.docSpace);
    if (ctx.edition) p.set('edition', ctx.edition);
    if (ctx.segment === 'latest') p.set('from', 'latest');
  }
  return `/search/?${p.toString()}`;
}

// The full search page reads its context from its own URL: it lives on the
// Landing deployment, not on the Doc space the reader came from. With the
// manifest, the scopes it offers are the ones the reader's page offered.
export function parseSearchPageUrl(search, manifest = null) {
  const p = new URLSearchParams(search);
  const docSpace = p.get('space');
  const edition = p.get('edition');
  const scope = p.get('scope');
  // The search page itself is on the Landing deployment (`elsewhere`): every
  // hit opens another deployment with full-page navigation.
  const ctx = docSpace
    ? { ...deploymentContext({ docSpace, edition, asLatest: p.get('from') === 'latest', section: p.get('section') }), elsewhere: true }
    : { ...deploymentContext({ landing: true }) };
  let offered;
  if (!docSpace) offered = ['all'];
  else if (manifest) offered = scopesFor(ctx, manifest).scopes.filter((s) => s !== 'edition' || edition);
  else offered = [...(ctx.section ? ['section'] : []), ...(edition ? ['edition'] : []), 'docspace', 'all'];
  const fallback = offered.includes('section') ? 'section' : offered.includes('all') ? 'all' : offered[0];
  return { query: p.get('q') ?? '', scope: offered.includes(scope) ? scope : fallback, ctx, offered };
}
