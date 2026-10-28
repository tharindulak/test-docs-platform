// Search indexing as a release step (Search for WSO2 Docs): each Docs
// deployment upserts its own records into its environment's shared collection
// and then deletes that Edition's stale ones by filter, never delete-first, so
// there is no gap with no results. /latest/ twins and legacy versions are never
// indexed. The weekly consistency check compares the index with every live
// deployment's page list, and can repair what drifted.
import fs from 'node:fs';
import path from 'node:path';
import { COMPOSED_KEY } from '../compose.mjs';
import { LANDING, NO_EDITION, STATE_KEY, readState, releasePrefix } from '../release.mjs';
import { analyticsSetup, collectionSchema, deploymentGroups, editionFilter, formerNamesOf, quote, staleFilter, toSearchDocuments } from './schema.mjs';
import { withRetry } from './typesense.mjs';

// Creates the collection, the analytics destination collections and rules, and
// adds any fields a newer schema gained (schemas only ever gain fields).
export async function ensureCollection(client, name) {
  const schema = collectionSchema(name);
  const existing = await client.getCollection(name);
  let created = false;
  let added = [];
  if (!existing) {
    await client.createCollection(schema);
    created = true;
  } else {
    const have = new Set(existing.fields.map((f) => f.name));
    added = schema.fields.filter((f) => !have.has(f.name));
    if (added.length) await client.updateCollection(name, { fields: added.map((f) => ({ ...f, optional: true })) });
  }
  const analytics = analyticsSetup(name);
  for (const c of analytics.collections) {
    if (!(await client.getCollection(c.name))) await client.createCollection(c);
  }
  for (const rule of analytics.rules) await client.upsertAnalyticsRule(rule);
  return { created, added: added.map((f) => f.name) };
}

// A search-only parent key for the collection: it can search that one
// collection and nothing else. Browser keys are scoped from it.
export const isSearchOnlyParent = (key, collection) => key.actions?.length === 1 && key.actions[0] === 'documents:search'
  && key.collections?.length === 1 && key.collections[0] === collection;

// The parent search-only key that browser keys are scoped from. An existing
// one is reused (the newest), so running setup again makes no new key; its
// value was printed when it was made, and only its value_prefix is known now
// ({ id, value_prefix, existed: true }). `value` asks for that exact key (the
// local preview's), made once. `fresh` makes a new one anyway (a key change).
export async function ensureSearchOnlyKey(client, collection, value, { fresh = false } = {}) {
  if (!fresh) {
    const parents = (await client.listKeys()).filter((k) => isSearchOnlyParent(k, collection)).sort((a, b) => b.id - a.id);
    const existing = value ? parents.find((k) => k.value_prefix === value.slice(0, 4)) : parents[0];
    if (existing) return { ...existing, ...(value ? { value } : {}), existed: true };
  }
  return client.createKey({
    description: `Search-only key for ${collection} (browsers get keys scoped from it)`,
    actions: ['documents:search'],
    collections: [collection],
    ...(value ? { value } : {}),
  });
}

export async function indexDeployment(client, { collection, records, meta, policy, release }) {
  const docs = toSearchDocuments(records, meta, policy, { release });
  if (!docs.length) throw new Error(`${meta.docSpace}/${meta.edition} has no search records; refusing to index (it would delete every record of the Edition)`);
  const { imported } = await client.importDocuments(collection, docs, { action: 'upsert' });
  // A family Cloud tree also holds its Cloud parts' records (each part is its
  // component's Cloud): each group's stale records go, never another deployment's.
  const groups = deploymentGroups(meta);
  let deleted = 0;
  const byGroup = {};
  for (const g of groups) {
    const n = await client.deleteByFilter(collection, staleFilter(g.docSpace, g.edition, release));
    deleted += n;
    byGroup[`${g.docSpace}/${g.edition}`] = { imported: docs.filter((d) => d.docSpace === g.docSpace).length, deleted: n };
  }
  return { docSpace: meta.docSpace, edition: meta.edition, release, imported, deleted, ...(groups.length > 1 ? { groups: byGroup } : {}) };
}

const readJsonFile = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function readBuild(dir) {
  const p = (f) => path.join(dir, '_platform', f);
  return { meta: readJsonFile(p('edition.json')), records: readJsonFile(p('search-records.json')), pages: readJsonFile(p('pages.json')) };
}

async function readStorageJson(storage, key) {
  const obj = await storage.get(key);
  if (!obj) throw new Error(`${storage.name ?? 'storage'} has no ${key}`);
  return JSON.parse(new TextDecoder().decode(obj.body));
}

export async function readRelease(storage, { space, segment, release }) {
  const prefix = `${releasePrefix(space, segment, release)}_platform/`;
  const [meta, records, pages] = await Promise.all(['edition.json', 'search-records.json', 'pages.json'].map((f) => readStorageJson(storage, prefix + f)));
  return { meta, records, pages };
}

// What a search host's gate indexes and checks from (the 141 VM for staging,
// hosting/vm/): the deployment state, the composed manifest and each
// deployment's three search files (edition.json, search-records.json,
// pages.json), written under `outDir` laid out as the bucket, so the gate runs
// search-index and search-check against it as file storage. `deployments`
// lists the ones to copy; without it, every live one (for the consistency
// check). /latest/ twins and the Landing deployment are never indexed, so
// never copied. `composed` (bytes) replaces the stored composed manifest, as
// production flips with the one staging composed.
// → { deployments: ['<space>/<segment>=<release>', ...] }
export async function exportSearchInputs(storage, outDir, { deployments, composed } = {}) {
  const state = await readState(storage);
  const list = deployments ?? Object.entries(state.deployments).map(([key, d]) => {
    const [space, segment] = key.split('/');
    return { space, segment, release: d.release };
  });
  const write = (key, body) => {
    const file = path.join(outDir, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  const copied = [];
  for (const d of [...list].sort((a, b) => `${a.space}/${a.segment}`.localeCompare(`${b.space}/${b.segment}`))) {
    if (d.segment === 'latest' || d.space === LANDING) continue;
    const prefix = `${releasePrefix(d.space, d.segment, d.release)}_platform/`;
    for (const f of ['edition.json', 'search-records.json', 'pages.json']) {
      const obj = await storage.get(prefix + f);
      if (!obj) throw new Error(`${storage.name ?? 'storage'} has no ${prefix}${f}`);
      write(prefix + f, obj.body);
    }
    copied.push(`${d.space}/${d.segment}=${d.release}`);
  }
  write(STATE_KEY, `${JSON.stringify(state, null, 2)}\n`);
  const policy = composed ?? (await storage.get(COMPOSED_KEY))?.body;
  if (policy) write(COMPOSED_KEY, policy);
  return { deployments: copied };
}

// Release step 6 (staging) or 8 (production): index every flipped deployment
// except latest twins. Each one retries on its own; failures are reported, not
// thrown, so the caller can alert without blocking the release.
export async function indexReleases(client, storage, { collection, policy, deployments, attempts = 3, delayMs = 2000, log = () => {} }) {
  const results = [];
  const failures = [];
  const skipped = [];
  await ensureCollection(client, collection);
  for (const d of deployments) {
    const key = `${d.space}/${d.segment}`;
    if (d.segment === 'latest') {
      skipped.push({ deployment: key, reason: '/latest/ is never indexed' });
      continue;
    }
    if (d.space === LANDING) {
      skipped.push({ deployment: key, reason: 'the Landing deployment has no pages to index' });
      continue;
    }
    try {
      const r = await withRetry(async () => {
        const { meta, records } = await readRelease(storage, d);
        return indexDeployment(client, { collection, records, meta, policy, release: d.release });
      }, { attempts, delayMs, onRetry: (err, i) => log(`search: ${key} attempt ${i} failed (${err.message}); retrying`) });
      results.push({ deployment: key, ...r });
    } catch (err) {
      failures.push({ deployment: key, release: d.release, error: err.message });
    }
  }
  return { results, failures, skipped };
}

const groupKey = (space, edition) => `${space}/${edition}`;

// The weekly consistency check. For each live deployment (latest twins
// excluded): pages with records in its release but missing from the index,
// pages in the index that its page list no longer has, and records left by
// another release. Editions in the index with no live deployment (removed,
// legacy, or never meant to be indexed) are orphans. `fix` re-indexes drifted
// deployments from their release folders and deletes orphans.
export async function checkConsistency(client, storage, { collection, policy, fix = false }) {
  const state = await readState(storage);
  const indexed = new Map();
  for (const doc of await client.exportDocuments(collection, { includeFields: 'docSpace,edition,page,release,formerNames' })) {
    const g = indexed.get(groupKey(doc.docSpace, doc.edition)) ?? { pages: new Set(), releases: new Set(), names: new Set(), docs: 0 };
    g.pages.add(doc.page);
    g.releases.add(doc.release);
    g.names.add(JSON.stringify(doc.formerNames ?? []));
    g.docs += 1;
    indexed.set(groupKey(doc.docSpace, doc.edition), g);
  }
  const report = { collection, checkedAt: new Date().toISOString(), deployments: [], orphans: [], fixed: [] };
  const live = new Set();
  for (const [key, d] of Object.entries(state.deployments).sort(([a], [b]) => a.localeCompare(b))) {
    const [space, segment] = key.split('/');
    if (segment === 'latest') continue;
    const policySpace = policy.docSpaces?.[space];
    // Unversioned Doc spaces (Contribute) have no Editions in the policy: their one deployment is `_`.
    const policyEdition = segment === NO_EDITION && policySpace?.model === 'unversioned' ? {} : policySpace?.editions?.find((e) => e.id === d.edition);
    if (!policyEdition || policyEdition.status === 'legacy' || policySpace.status === 'legacy') continue;
    const { meta, records, pages } = await readRelease(storage, { space, segment, release: d.release });
    const docs = toSearchDocuments(records, meta, policy, { release: d.release });
    // A family Cloud tree is checked per group: its own pages, then each Cloud
    // part's (its component's Cloud), against the tree's page list.
    const groups = deploymentGroups(meta);
    const partPrefixes = groups.filter((g) => g.prefix).map((g) => g.prefix);
    let drifted = false;
    const extras = [];
    for (const g of groups) {
      live.add(groupKey(g.docSpace, g.edition));
      const expected = new Set(docs.filter((x) => x.docSpace === g.docSpace).map((x) => x.page));
      const pageList = new Set(pages.map((p) => p.path)
        .filter((p) => (g.prefix ? p.startsWith(g.prefix) : !partPrefixes.some((pre) => p.startsWith(pre))))
        .map((p) => p.slice(g.prefix.length)));
      const got = indexed.get(groupKey(g.docSpace, g.edition)) ?? { pages: new Set(), releases: new Set(), names: new Set(), docs: 0 };
      const entry = {
        deployment: g.prefix ? `${key} (${g.docSpace} Cloud part)` : key, release: d.release, records: got.docs,
        missing: [...expected].filter((p) => !got.pages.has(p)).sort(),
        extra: [...got.pages].filter((p) => !pageList.has(p)).sort(),
        otherReleases: [...got.releases].filter((r) => r !== d.release).sort(),
      };
      // Records carry the manifest's former names; a change of formerNames
      // (or records from before it) is drift that --fix re-indexes.
      const names = formerNamesOf(policy, g.docSpace, g.cloudIn);
      if (got.docs && [...got.names].some((n) => n !== JSON.stringify(names))) {
        entry.formerNames = { expected: names, indexed: [...new Set([...got.names].flatMap((n) => JSON.parse(n)))] };
      }
      entry.ok = !entry.missing.length && !entry.extra.length && !entry.otherReleases.length && !entry.formerNames;
      report.deployments.push(entry);
      if (!entry.ok) drifted = true;
      if (entry.extra.length) extras.push([g, entry.extra]);
    }
    if (drifted && fix) {
      const r = await indexDeployment(client, { collection, records, meta, policy, release: d.release });
      // Pages the page list no longer has, even if tagged with the live release.
      for (const [g, extra] of extras) r.deleted += await client.deleteByFilter(collection, `${editionFilter(g.docSpace, g.edition)} && page:=[${extra.map(quote).join(',')}]`);
      report.fixed.push({ deployment: key, ...r });
    }
  }
  for (const [key, g] of indexed) {
    if (live.has(key)) continue;
    const [space, edition] = key.split('/');
    report.orphans.push({ docSpace: space, edition, records: g.docs });
    if (fix) report.fixed.push({ orphan: key, deleted: await client.deleteByFilter(collection, editionFilter(space, edition)) });
  }
  report.ok = report.deployments.every((e) => e.ok) && !report.orphans.length;
  return report;
}
