// The Typesense collection every Docs deployment shares (Search for WSO2 Docs),
// and the mapping from a build's _platform/search-records.json (DocSearch
// shape: hierarchy, url, content) to its documents. Every document carries its
// Doc space, Edition, kind, product family and the release that indexed it,
// so a release can upsert its own records and then delete only its stale ones.
import crypto from 'node:crypto';
import semver from 'semver';
import { versionSemver } from '../edition.mjs';

// One collection per environment (staging and production never share one).
export { COLLECTIONS } from './environments.mjs';

export function collectionSchema(name) {
  return {
    name,
    fields: [
      { name: 'docSpace', type: 'string', facet: true },
      { name: 'docSpaceName', type: 'string', index: false, optional: true },
      { name: 'edition', type: 'string', facet: true },
      { name: 'kind', type: 'string', facet: true },
      { name: 'family', type: 'string', facet: true, optional: true },
      { name: 'editionRank', type: 'int64', sort: true },
      { name: 'release', type: 'string' },
      { name: 'page', type: 'string' },
      { name: 'anchor', type: 'string', index: false, optional: true },
      { name: 'url', type: 'string', index: false },
      { name: 'level', type: 'int32', sort: true },
      { name: 'lvl0', type: 'string', optional: true },
      { name: 'lvl1', type: 'string', optional: true },
      { name: 'lvl2', type: 'string', optional: true },
      { name: 'lvl3', type: 'string', optional: true },
      { name: 'content', type: 'string', optional: true },
      // Added with Search records for Cloud parts and family Clouds: the
      // platform whose Cloud tree serves a Cloud part's page, and the record
      // type ("page", or "catalog-item" for one item of a catalog page).
      { name: 'cloudIn', type: 'string', facet: true, optional: true },
      { name: 'type', type: 'string', facet: true, optional: true },
      // Added with former names (Asgardeo, Bijira): the Doc space's
      // formerNames, and for a Cloud part its platform's too, so a query
      // naming the old product finds its pages.
      { name: 'formerNames', type: 'string[]', optional: true },
    ],
    token_separators: ['-', '_', '/', '.'],
  };
}

// Analytics (popular and no-hit queries), tagged per deployment through each
// search's analytics_tag (<space>/<segment>, or "landing").
export function analyticsSetup(collection) {
  const dest = (kind) => ({
    name: `${collection}_${kind}_queries`,
    fields: [
      { name: 'q', type: 'string' },
      { name: 'count', type: 'int32' },
      { name: 'analytics_tag', type: 'string', facet: true, optional: true },
    ],
  });
  const rule = (kind, type) => ({
    name: `${collection}_${kind}`,
    type,
    collection,
    event_type: 'search',
    params: { destination_collection: `${collection}_${kind}_queries`, limit: 1000, capture_search_requests: true, meta_fields: ['analytics_tag'] },
  });
  return {
    collections: [dest('popular'), dest('nohits')],
    rules: [rule('popular', 'popular_queries'), rule('nohits', 'nohits_queries')],
  };
}

// Newer Editions rank higher in "All Editions of this Doc space". Cloud is the
// newest Edition of a product; `next` is ahead of every released version.
export function editionRank(id) {
  if (id === 'cloud') return 999_999_999_999;
  if (id === 'next') return 999_999_999_998;
  const v = versionSemver(id);
  if (!v) return 0;
  return semver.major(v) * 1_000_000_000 + semver.minor(v) * 1_000_000 + semver.patch(v) * 1_000;
}

const docId = (space, edition, page, anchor) => crypto.createHash('sha1').update(`${space}|${edition}|${page}#${anchor}`).digest('hex').slice(0, 32);

// Who a record belongs to. A family Cloud tree's records are its own pages
// (the family Doc space's Cloud) and its Cloud parts' pages, which are each
// component's Cloud: docSpace <component>, edition cloud, `cloudIn` the
// platform, the page relative to the part, lvl0 "<Component> Cloud". A part
// built on its own (cloudPartOf, a PR preview) is the same. → { docSpace,
// space, page, cloudIn?, lvl0? } or throws for a page outside the deployment.
function ownerOf(pathname, meta, policy) {
  if (!pathname.startsWith(meta.baseUrl)) return null;
  const rel = decodeURIComponent(pathname.slice(meta.baseUrl.length));
  if (meta.cloudPartOf) return { docSpace: meta.docSpace, page: rel, cloudIn: meta.cloudPartOf };
  const part = (meta.parts ?? []).find((p) => p.path && rel.startsWith(p.path));
  if (part) return { docSpace: part.docSpace, page: rel.slice(part.path.length), cloudIn: meta.docSpace, lvl0: part.editionName };
  return { docSpace: meta.docSpace, page: rel };
}

const partName = (space) => space?.editionNames?.cloud ?? `${space?.displayName} Cloud`;

// The former names a record is found by: its Doc space's, and for a Cloud
// part's page its platform's too (Asgardeo was the whole Identity Platform
// Cloud tree). Read from the manifest at indexing time.
export function formerNamesOf(policy, docSpace, cloudIn) {
  const names = [...(policy.docSpaces?.[docSpace]?.formerNames ?? []), ...(cloudIn ? policy.docSpaces?.[cloudIn]?.formerNames ?? [] : [])];
  return [...new Set(names)];
}

// Maps one deployment's records. `meta` is its _platform/edition.json; the
// policy gives the product family (a catalog grouping, so it can change
// without a rebuild). Throws for builds that must never be indexed.
export function toSearchDocuments(records, meta, policy, { release }) {
  if (meta.asLatest) throw new Error(`${meta.docSpace}/latest is never indexed; index the pinned Edition ${meta.edition} instead`);
  const space = policy.docSpaces?.[meta.docSpace];
  if (!space) throw new Error(`Doc space "${meta.docSpace}" is not in the manifest policy`);
  if (space.status === 'legacy') throw new Error(`Doc space "${meta.docSpace}" is legacy (not on WSO2 Docs); it is never indexed`);
  const known = space.editions?.find((e) => e.id === meta.edition);
  if (known?.status === 'legacy') throw new Error(`${meta.docSpace} ${meta.edition} is a legacy version; legacy versions are never indexed`);
  if (!release) throw new Error('a release id is required');
  if (/\/latest\//.test(meta.baseUrl ?? '')) throw new Error(`${meta.baseUrl} is a /latest/ address; it is never indexed`);
  for (const p of meta.parts ?? []) {
    if (!policy.docSpaces?.[p.docSpace]) throw new Error(`Cloud part "${p.docSpace}" is not in the manifest policy`);
  }
  const byId = new Map();
  for (const r of records) {
    const u = new URL(r.url);
    const owner = ownerOf(u.pathname, meta, policy);
    if (!owner) throw new Error(`record ${r.url} is outside ${meta.baseUrl}`);
    const ownSpace = policy.docSpaces[owner.docSpace];
    const anchor = decodeURIComponent(u.hash.slice(1));
    const h = r.hierarchy ?? {};
    const id = docId(owner.docSpace, meta.edition, owner.page, anchor);
    const prev = byId.get(id);
    if (prev) {
      prev.content = [prev.content, r.content].filter(Boolean).join(' ');
      continue;
    }
    const lvl0 = owner.cloudIn ? owner.lvl0 ?? partName(ownSpace) : h.lvl0 ?? ownSpace.displayName;
    const formerNames = formerNamesOf(policy, owner.docSpace, owner.cloudIn);
    byId.set(id, {
      id,
      docSpace: owner.docSpace,
      docSpaceName: owner.cloudIn ? ownSpace.displayName : h.lvl0 ?? ownSpace.displayName,
      edition: meta.edition,
      kind: r.kind ?? meta.kind,
      ...(ownSpace.family ? { family: ownSpace.family } : {}),
      editionRank: editionRank(meta.edition),
      release,
      page: owner.page,
      anchor,
      url: r.url,
      level: h.lvl3 ? 3 : h.lvl2 ? 2 : 1,
      lvl0,
      lvl1: h.lvl1 ?? '',
      ...(h.lvl2 ? { lvl2: h.lvl2 } : {}),
      ...(h.lvl3 ? { lvl3: h.lvl3 } : {}),
      content: r.content ?? '',
      ...(owner.cloudIn ? { cloudIn: owner.cloudIn } : {}),
      type: r.type ?? 'page',
      ...(formerNames.length ? { formerNames } : {}),
    });
  }
  return [...byId.values()];
}

// The (Doc space, Edition) groups a deployment's documents fall into: the
// deployment's own, plus each Cloud part's (component, cloud). Each group is
// upserted and cleaned on its own, and checked against its own page list.
export function deploymentGroups(meta) {
  const own = { docSpace: meta.docSpace, edition: meta.edition, prefix: '' };
  if (meta.cloudPartOf) return [{ ...own, cloudIn: meta.cloudPartOf }];
  return [own, ...(meta.parts ?? []).map((p) => ({ docSpace: p.docSpace, edition: meta.edition, prefix: p.path, cloudIn: meta.docSpace }))];
}

// Typesense filter values are wrapped in backticks; ids never contain one.
export const quote = (v) => {
  if (String(v).includes('`')) throw new Error(`Invalid filter value ${v}`);
  return `\`${v}\``;
};

// "_", the one Edition of an unversioned Doc space (Contribute), is nothing but
// a token separator in this schema, so an exact filter on it matches no record:
// those Doc spaces are filtered by docSpace alone.
export const editionFilter = (space, edition) => (edition === '_' ? `docSpace:=${quote(space)}` : `docSpace:=${quote(space)} && edition:=${quote(edition)}`);
export const staleFilter = (space, edition, release) => `${editionFilter(space, edition)} && release:!=${quote(release)}`;
