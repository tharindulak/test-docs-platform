// The release path from tag to live (Platform build and deploy pipeline):
// plan the Docs deployments a tag needs, publish each build to an immutable
// release folder, flip the pointer (deployment state), merge policy and state
// into manifest.json, compile every deployment's redirects into the edge
// table, and garbage-collect old releases. Storage comes from lib/storage.mjs.
//
// Bucket layout (one bucket per environment: docs-staging, docs-prod):
//   _releases/<space>/<segment>/<release>/...   immutable build output
//   _releases/.../<release>/_platform/release.json   written last: "complete"
//   _platform/state.json             deployed release per deployment (pipeline-only)
//   _platform/redirect-table.json    the last table synced to Workers KV
//   manifest.json, chrome.json, sitemap.xml, llms.txt   runtime files the Edge Worker serves
// <segment> is the Edition id, `latest` for the latest twin, or `_` for a
// deployment without an Edition segment (unversioned Doc spaces, `_landing`).
import fs from 'node:fs';
import path from 'node:path';
import { rootLlmsTxt } from './llms.mjs';
import { docSpaceDir, publicManifest, sectionEntries } from './manifest.mjs';

export { docSpaceDir };
import { checkMarkdownTwins, formatProblems } from './twin-checks.mjs';
import { contentTypeFor, pool } from './storage.mjs';
import { platformRepoOf } from './platform-pins.mjs';

export const STATE_KEY = '_platform/state.json';
export const TABLE_KEY = '_platform/redirect-table.json';
export const MANIFEST_KEY = 'manifest.json';
export const CHROME_KEY = 'chrome.json';
export const SITEMAP_KEY = 'sitemap.xml';
export const LLMS_KEY = 'llms.txt';
// The Landing deployment's own sitemap: /sitemap.xml is the index, so the
// home page's sitemap is listed in it under this name.
export const LANDING_SITEMAP = 'sitemap-landing.xml';
export const KEEP_RELEASES = 5;
export const NO_EDITION = '_';
export const LANDING = '_landing';
const HISTORY = 20;
const PRODUCTION_SITE = 'https://docs.wso2.com';

export const releasePrefix = (space, segment, release) => `_releases/${space}/${segment}/${release}/`;
export const baseUrlFor = (space, segment) => {
  if (space === LANDING) return '/';
  return segment === NO_EDITION ? `/${space}/` : `/${space}/${segment}/`;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function checkId(what, value) {
  if (value === LANDING || value === NO_EDITION) return value;
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Invalid ${what} "${value}"`);
  return value;
}

// Docs release tags (Content repo contract; Repo structure for Platform,
// sections and Doc spaces): [<slug>/]cloud-<YYYY.MM.DD>.<n> on main and
// [<slug>/]<version>-docs.<n> on [<slug>/]release/<version>, where <version>
// is exact (7.3.0) or a date version (2026.09.24). The prefix names the Doc
// space in a repo that holds several.
const TAG = /^(?:([a-z0-9][a-z0-9-]*)\/)?(?:(cloud)-\d{4}\.\d{2}\.\d{2}\.\d+|(\d+\.\d+\.\d+|\d{4}\.\d{2}\.\d{2})-docs\.\d+)$/;
export function parseTag(tag) {
  const m = TAG.exec(String(tag ?? ''));
  if (!m) throw new Error(`"${tag}" is not a Docs release tag ([<doc space>/]cloud-<YYYY.MM.DD>.<n> or [<doc space>/]<version>-docs.<n>)`);
  return { prefix: m[1] ?? null, cloud: Boolean(m[2]), version: m[3] ?? null, release: m[1] ? String(tag).slice(m[1].length + 1) : String(tag) };
}

export function editionFromTag(tag, model) {
  const t = parseTag(tag);
  if (t.cloud) return model === 'versions-only' ? 'next' : 'cloud';
  return t.version;
}

// The release folder id of a tag: the tag without its Doc space prefix (the
// folder path already names the Doc space; release ids hold no slash).
// Other tags (a Landing build's) pass through, less any prefix.
export const releaseIdFor = (tag) => {
  try {
    return parseTag(tag).release;
  } catch {
    return String(tag ?? '').replace(/^[a-z0-9][a-z0-9-]*\//, '');
  }
};

// The Doc space a repo's tag releases: the one its prefix names, else the
// repo's one Doc space with unprefixed tags. A Doc space not on WSO2 Docs yet
// (status: legacy) has no Docs releases, so it never claims a repo's tags.
function spaceForTag(policy, repo, tag) {
  const { prefix, cloud } = parseTag(tag);
  const inRepo = Object.entries(policy.docSpaces).filter(([, s]) => s.status !== 'legacy' && s.repo?.toLowerCase() === String(repo).toLowerCase());
  if (!inRepo.length) throw new Error(`No Doc space in the manifest policy has repo "${repo}"`);
  if (prefix) {
    const hit = inRepo.find(([slug]) => slug === prefix);
    if (!hit) throw new Error(`Tag ${tag} names Doc space "${prefix}", which is not in ${repo}`);
    const [slug, s] = hit;
    if ((s.tagPrefix ?? '') !== `${slug}/`) throw new Error(`${slug}'s Docs release tags are unprefixed; tag ${tag.slice(prefix.length + 1)} instead`);
    if (cloud && s.cloud?.in && !s.editions?.some((e) => e.id === 'cloud')) {
      throw new Error(`${slug}'s Cloud is its Cloud part of ${s.cloud.in}; tag ${policy.docSpaces[s.cloud.in]?.tagPrefix ?? ''}cloud-<YYYY.MM.DD>.<n> to release the platform's Cloud tree`);
    }
    return slug;
  }
  const unprefixed = inRepo.filter(([, s]) => !s.tagPrefix);
  if (unprefixed.length === 1) return unprefixed[0][0];
  throw new Error(`${repo} holds several Doc spaces (${inRepo.map(([slug]) => slug).join(', ')}): its tags are <doc space>/${tag}`);
}

// A tag's Edition, plus its latest twin when it is the newest release
// (`latest`, the first Self-hosted Edition in manifest order). Cloud is never
// built twice: in a Cloud-only Doc space the edge answers /latest/ from /cloud/.
function deploymentsFor(policy, slug, edition, tag, release) {
  const space = policy.docSpaces[slug];
  const repo = space.repo ?? null;
  const dir = docSpaceDir(space, slug);
  if (space.model === 'unversioned') return [{ repo, dir, space: slug, edition: NO_EDITION, segment: NO_EDITION, asLatest: false, tag, release }];
  const out = [{ repo, dir, space: slug, edition, segment: edition, asLatest: false, tag, release }];
  if (space.latest === edition && edition !== 'cloud') out.unshift({ repo, dir, space: slug, edition, segment: 'latest', asLatest: true, tag, release });
  return out;
}

const landingDeployment = (policy, tag, release) => ({ repo: platformRepoOf(policy), dir: '.', space: LANDING, edition: NO_EDITION, segment: NO_EDITION, asLatest: false, tag, release });

// What a merged policy change needs (trigger table): a new Edition or a moved
// `latest` rebuilds that Doc space, so canonicals and sitemaps match; anything
// else (end of life, legacy URLs, names) only republishes the manifest.
export function policyChanges(before, after) {
  const rebuild = [];
  for (const [slug, s] of Object.entries(after.docSpaces)) {
    const old = before.docSpaces?.[slug];
    const live = (x) => (x?.editions ?? []).filter((e) => e.status !== 'legacy').map((e) => e.id).sort().join(',');
    if (!old || old.latest !== s.latest || live(old) !== live(s)) rebuild.push(slug);
  }
  const content = ({ composedAt, ...rest }) => JSON.stringify(rest);
  return { rebuild, republish: content(before) !== content(after) };
}

// Which Docs deployments to build (trigger table, ticket 11):
//   scope "tag":      the tagged Edition, plus its latest twin if it feeds latest
//   scope "docspace": every deployed Edition of one Doc space (latest moved, new version)
//   scope "all":      every deployed Edition whose Content repo pins `major`
//                     (a Platform release); `pins` from lib/platform-pins.mjs.
//                     The Platform's own deployments (Contribute, Landing)
//                     always count; each other one left out goes to onSkip.
//   scope "landing":  the Landing deployment, built from the Platform alone
// Rebuilds reuse the deployed tag under a new release id, since release folders are immutable.
export function planRelease(policy, { repo, tag, scope = 'tag', space: only, state, rebuildId, major, pins, onSkip = () => {}, now = new Date() } = {}) {
  let list = [];
  if (scope === 'tag') {
    const slug = spaceForTag(policy, repo, tag);
    const space = policy.docSpaces[slug];
    const edition = space.model === 'unversioned' ? NO_EDITION : editionFromTag(tag, space.model);
    const known = space.editions?.find((e) => e.id === edition);
    if (edition !== 'next' && edition !== NO_EDITION) {
      if (!known) throw new Error(`Edition ${edition} of ${slug} is not in the manifest policy; add it by PR first`);
      if (known.status === 'legacy') throw new Error(`Edition ${edition} of ${slug} is a legacy version (not on WSO2 Docs)`);
      // A pin holds the Edition on one Docs release: only that tag may be
      // (re)released until the Doc space manifest drops the pin.
      if (known.pin && known.pin !== tag) throw new Error(`Edition ${edition} of ${slug} is pinned to ${known.pin} in its docspace.yaml; remove the pin to release ${tag}`);
    }
    list = deploymentsFor(policy, slug, edition, tag, checkId('release', releaseIdFor(tag)));
  } else if (scope === 'landing') {
    // The Landing deployment is built from the Platform alone, so it has no
    // Docs release tag: its release id names the day and the run.
    if (!rebuildId) throw new Error('scope "landing" needs a rebuild id (for example the workflow run id)');
    const id = checkId('release', `landing-${now.toISOString().slice(0, 10).replaceAll('-', '.')}.${rebuildId}`);
    list = [landingDeployment(policy, id, id)];
  } else if (scope === 'docspace' || scope === 'all') {
    if (!state) throw new Error(`scope "${scope}" needs the deployment state`);
    if (!rebuildId) throw new Error(`scope "${scope}" needs a rebuild id (for example the workflow run id)`);
    if (scope === 'all' && !Number.isInteger(major)) throw new Error('scope "all" needs the Platform major the release is in (--major)');
    if (scope === 'all' && !pins) throw new Error('scope "all" needs each Content repo\'s pinned Platform major (the Content repo checkouts, --content)');
    const platform = platformRepoOf(policy).toLowerCase();
    const slugs = scope === 'all' ? Object.keys(policy.docSpaces) : [only];
    for (const slug of slugs) {
      const space = policy.docSpaces[slug];
      if (!space) throw new Error(`Unknown Doc space "${slug}"`);
      const ids = space.model === 'unversioned' ? [NO_EDITION] : (space.editions ?? []).filter((e) => e.status !== 'legacy').map((e) => e.id);
      const repoKey = String(space.repo ?? '').toLowerCase();
      const pin = repoKey === platform ? major : (pins?.[repoKey] ?? null);
      for (const id of ids) {
        const deployed = state.deployments[`${slug}/${id}`];
        if (!deployed) continue;
        if (scope === 'all' && pin !== major) {
          onSkip({ deployment: `${slug}/${id}`, repo: space.repo ?? null, pin });
          continue;
        }
        list.push(...deploymentsFor(policy, slug, id, deployed.tag, `${releaseIdFor(deployed.tag)}.r${checkId('rebuild id', String(rebuildId))}`));
      }
    }
    // The Landing deployment is the Platform's own, as Contribute is.
    const landing = state.deployments[`${LANDING}/${NO_EDITION}`];
    if (scope === 'all' && landing) list.push(landingDeployment(policy, landing.tag, `${releaseIdFor(landing.tag)}.r${checkId('rebuild id', String(rebuildId))}`));
  } else {
    throw new Error(`Unknown scope "${scope}"`);
  }
  // Latest twins first: older versions take their canonicals from latest's page list.
  return list.sort((a, b) => Number(b.asLatest) - Number(a.asLatest));
}

// Blocking structural check of one build before it is uploaded.
export function checkBuild(dir, { space, segment, edition }) {
  const problems = [];
  const read = (rel) => {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) {
      problems.push(`missing ${rel}`);
      return null;
    }
    return fs.readFileSync(file, 'utf8');
  };
  const meta = JSON.parse(read('_platform/edition.json') ?? 'null');
  if (meta) {
    const want = { docSpace: space === LANDING ? null : space, edition: segment === NO_EDITION ? meta.edition : edition, asLatest: segment === 'latest', baseUrl: baseUrlFor(space, segment) };
    for (const [k, v] of Object.entries(want)) {
      if (meta[k] !== v) problems.push(`_platform/edition.json: ${k} is ${JSON.stringify(meta[k])}, expected ${JSON.stringify(v)}`);
    }
    if (meta.showMarkers) problems.push('_platform/edition.json: a preview build with Edition markers shown (--show-markers) is never released');
  }
  const pages = JSON.parse(read('_platform/pages.json') ?? 'null');
  if (pages && !(Array.isArray(pages) && pages.length)) problems.push('_platform/pages.json lists no pages');
  const redirects = JSON.parse(read('_platform/redirects.json') ?? 'null');
  if (redirects && !Array.isArray(redirects)) problems.push('_platform/redirects.json is not a list');
  for (const rel of ['index.html', '404.html', 'sitemap.xml', ...(space === LANDING ? [LANDING_SITEMAP] : [])]) read(rel);
  // Markdown twins and llms.txt (AI/LLM-friendly docs), when the build has them.
  if (fs.existsSync(path.join(dir, '_platform', 'markdown.json'))) {
    const twins = checkMarkdownTwins(dir);
    if (twins.length) problems.push(`Markdown twins:\n    ${formatProblems(twins).split('\n').join('\n    ')}`);
  }
  return problems;
}

function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

// Uploads a built deployment to its immutable release folder. release.json is
// written last, so a folder without it is an interrupted upload and is never
// flipped to. Publishing an already-complete release is a no-op (re-runs).
export async function publishRelease(storage, dir, { space, segment, edition, tag, release = releaseIdFor(tag), source = {}, concurrency = 16, now = new Date() }) {
  const problems = checkBuild(dir, { space, segment, edition });
  if (problems.length) throw new Error(`Build in ${dir} is not publishable:\n  ${problems.join('\n  ')}`);
  const prefix = releasePrefix(checkId('Doc space', space), checkId('segment', segment), checkId('release', release));
  const marker = `${prefix}_platform/release.json`;
  if (await storage.get(marker)) return { prefix, skipped: true };
  const files = filesUnder(dir).filter((f) => f !== '_platform/release.json');
  let bytes = 0;
  await pool(files, concurrency, async (rel) => {
    const body = fs.readFileSync(path.join(dir, rel));
    bytes += body.length;
    await storage.put(prefix + rel, body, { contentType: contentTypeFor(rel) });
  });
  const meta = JSON.parse(fs.readFileSync(path.join(dir, '_platform', 'edition.json'), 'utf8'));
  const info = {
    docSpace: space, segment, edition, tag, release, publishedAt: now.toISOString(),
    files: files.length, bytes, platformVersion: meta.platformVersion ?? null, source,
  };
  await storage.put(marker, `${JSON.stringify(info, null, 2)}\n`, { contentType: 'application/json' });
  return { prefix, skipped: false, ...info };
}

async function readJson(storage, key) {
  const obj = await storage.get(key);
  return obj ? JSON.parse(new TextDecoder().decode(obj.body)) : null;
}

const putJson = (storage, key, data) => storage.put(key, `${JSON.stringify(data, null, 2)}\n`, { contentType: 'application/json' });

export async function readState(storage) {
  return (await readJson(storage, STATE_KEY)) ?? { schema: 1, environment: null, updatedAt: null, deployments: {} };
}

// Policy plus state, as published at /manifest.json for browsers and the Edge Worker.
export function mergeManifest(policy, state, { environment = state.environment, now = new Date() } = {}) {
  const base = publicManifest(policy, { environment });
  const warnings = [];
  const bySpace = {};
  for (const [key, d] of Object.entries(state.deployments)) {
    const [space, segment] = key.split('/');
    (bySpace[space] ??= {})[segment] = { release: d.release, tag: d.tag, edition: d.edition };
  }
  for (const [slug, s] of Object.entries(base.docSpaces)) {
    const deployments = bySpace[slug] ?? {};
    s.deployments = deployments;
    s.editions = s.editions.map((e) => (deployments[e.id] ? { ...e, tag: deployments[e.id].tag } : e));
    if (s.latest && deployments.latest && deployments.latest.edition !== s.latest) {
      warnings.push(`${slug}: policy says latest is ${s.latest} but the deployed latest twin is ${deployments.latest.edition}; rebuild the Doc space`);
    }
    // An Edition the manifest dropped (removed, or moved to legacyVersions)
    // keeps serving until its deployment is retired.
    for (const [segment, d] of Object.entries(deployments)) {
      if (segment === 'latest' || segment === NO_EDITION) continue;
      if (!s.editions.some((e) => e.id === d.edition && e.status !== 'legacy')) {
        warnings.push(`${slug}/${segment} is deployed, but ${d.edition} is no longer an Edition of ${slug}; take it down with wso2-release retire --deployment ${slug}/${segment}`);
      }
    }
  }
  hideUnpublished(base, policy, bySpace);
  const landing = bySpace[LANDING]?.[NO_EDITION] ?? null;
  return { manifest: { schema: 1, environment, generatedAt: now.toISOString(), ...base, landing }, warnings };
}

// A Doc space is published once it has a Docs deployment here (a Cloud part,
// once its platform's Cloud is deployed). Until then the section entries that
// list it wait in the section's `pending`, as entries for a Doc space with no
// manifest yet do: readers never get a menu line or a products-menu entry
// that leads nowhere, and compose from this file (lib/published.mjs) still
// sees that the section lists it. A Doc space with only Legacy versions (it
// links out) or a product not on WSO2 Docs yet has nothing to deploy and
// stays listed.
export function hideUnpublished(manifest, policy, bySpace) {
  const published = (slug) => {
    const s = policy.docSpaces[slug];
    if (!s?.source) return true;
    if (s.editions?.length && s.editions.every((e) => e.status === 'legacy')) return true;
    if (Object.keys(bySpace[slug] ?? {}).length) return true;
    return Boolean(s.cloud?.in && bySpace[s.cloud.in]?.cloud);
  };
  for (const sec of Object.values(manifest.sections ?? {})) {
    const { menu: allMenu, products: allProducts } = sectionEntries(sec);
    const hidden = (e) => e.pending || Boolean(e.slug && !published(e.slug));
    if (![...allMenu, ...allProducts].some((e) => hidden(e) && !e.pending)) continue;
    const pending = [];
    allMenu.forEach((e, at) => (hidden(e) ? pending.push({ at, docSpace: e.slug, ...((e.pending || e.item.versionInSet) && e.item.versionIn ? { versionIn: e.item.versionIn } : {}) }) : null));
    allProducts.forEach((e, at) => (hidden(e) ? pending.push({ at, product: e.item }) : null));
    Object.assign(sec, { menu: allMenu.filter((e) => !hidden(e)).map((e) => e.item), products: allProducts.filter((e) => !hidden(e)).map((e) => e.item), pending });
  }
  for (const g of manifest.productsMenu ?? []) g.entries = g.entries.filter((p) => published(p.opens.docSpace));
  // A component whose Cloud part waits for its platform's Cloud tree opens on
  // its latest Self-hosted version meanwhile (lib/switching.mjs cloudIn); its
  // cloud.in stays, so compose from this file still sees the Cloud part.
  for (const [slug, d] of Object.entries(manifest.docSpaces ?? {})) {
    const platform = policy.docSpaces[slug]?.cloud?.in;
    if (platform && !d.editions?.some((e) => e.id === 'cloud') && !bySpace[platform]?.cloud) d.cloudPartPending = true;
  }
}

// The deployments a deployment state names, by Doc space and segment: the
// environment's _platform/state.json (wso2-release status), or a published
// manifest.json (each Doc space's `deployments`).
export function deployedBySpace(deployed) {
  const bySpace = {};
  if (deployed?.deployments && !deployed.docSpaces) {
    for (const [key, d] of Object.entries(deployed.deployments)) {
      const [space, segment] = key.split('/');
      (bySpace[space] ??= {})[segment] = { release: d.release, tag: d.tag, edition: d.edition };
    }
    return bySpace;
  }
  if (!deployed?.docSpaces) throw new Error('Deployment state must be a _platform/state.json (wso2-release status) or a published manifest.json');
  for (const [space, s] of Object.entries(deployed.docSpaces)) {
    for (const [segment, d] of Object.entries(s.deployments ?? {})) (bySpace[space] ??= {})[segment] = { ...d };
  }
  return bySpace;
}

// The manifest snapshot a build bakes in (and server-renders its menus from).
// The live chrome redraws from the published manifest, whose menus list only
// deployed Doc spaces; with the environment's deployment state (`deployed`),
// the baked menus do the same, so the crawl gate passes while a merged Doc
// space waits for its first Docs release. `building` names the Doc spaces this
// build deploys (its own, its Cloud parts, the platform a part builds into):
// they count as deployed, since the flip makes them so. `edition` is the
// Edition this build deploys: a Cloud build deploys the platform's Cloud tree,
// so its Cloud parts open there. Without deployment state (a local build), the
// menus are the composed manifest's.
export function bakedManifest(policy, { environment = 'production', deployed = null, building = [], edition = null } = {}) {
  const base = publicManifest(policy, { environment });
  if (!deployed) return base;
  const bySpace = deployedBySpace(deployed);
  const segment = edition === 'cloud' ? 'cloud' : BUILDING;
  for (const slug of building.filter(Boolean)) bySpace[slug] = { ...(bySpace[slug] ?? {}), [segment]: {} };
  hideUnpublished(base, policy, bySpace);
  return base;
}
const BUILDING = '(this build)';

// The sitemap index (SEO and canonical strategy): one entry per live Docs
// deployment, always with production URLs, leaving out end-of-life Editions
// and Unlisted Doc spaces (listed: false; the edge sends them noindex), except
// those indexed as an explicit exception (indexed: true: Contribute).
// The Landing deployment's entry is its sitemap-landing.xml (the index itself
// takes /sitemap.xml).
export function sitemapIndex(manifest, siteUrl = PRODUCTION_SITE) {
  const locs = manifest.landing ? [`${siteUrl}/${LANDING_SITEMAP}`] : [];
  for (const [slug, s] of Object.entries(manifest.docSpaces)) {
    if (s.listed === false && s.indexed !== true) continue;
    for (const [segment, d] of Object.entries(s.deployments ?? {})) {
      const edition = s.editions.find((e) => e.id === d.edition);
      if (edition?.status === 'end-of-life') continue;
      // A deployment whose Edition the manifest dropped waits to be retired.
      if (segment !== NO_EDITION && (!edition || edition.status === 'legacy')) continue;
      locs.push(`${siteUrl}${baseUrlFor(slug, segment)}sitemap.xml`);
    }
  }
  const body = locs.sort().map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>\n`;
}

// Republishes the runtime files only. Enough for policy changes such as end of
// life, which need no rebuild.
export async function publishRuntime(storage, { policy, state, environment, chrome, now }) {
  const { manifest, warnings } = mergeManifest(policy, state, { environment, now });
  await putJson(storage, MANIFEST_KEY, manifest);
  await storage.put(SITEMAP_KEY, sitemapIndex(manifest), { contentType: 'application/xml' });
  await storage.put(LLMS_KEY, rootLlmsTxt(manifest), { contentType: 'text/plain; charset=utf-8' });
  if (chrome) await storage.put(CHROME_KEY, chrome, { contentType: 'application/json' });
  return { manifest, warnings };
}

// Going live: point each deployment at its release (one state write, so a
// tag's Edition and its latest twin flip together), then republish the manifest.
// Writers take turns on the state lock (lib/state-lock.mjs) and none is
// cancelled, so an older run can reach its flip after a newer one: a flip
// never moves a deployment to a release published before the live one (it
// is kept, with a warning). Only a rollback (backwards: true), or a release
// of the tag the Edition is pinned to, goes back.
export async function flip(storage, { environment, policy, deployments, chrome, now = new Date(), backwards = false }) {
  const state = await readState(storage);
  if (state.environment && environment && state.environment !== environment) {
    throw new Error(`Storage ${storage.name} holds ${state.environment} state, not ${environment}`);
  }
  const kept = [];
  const notes = [];
  for (const { space, segment, release } of deployments) {
    const info = await readJson(storage, `${releasePrefix(space, segment, release)}_platform/release.json`);
    if (!info) throw new Error(`Release ${space}/${segment}/${release} is missing or incomplete; publish it first`);
    const key = `${space}/${segment}`;
    const prev = state.deployments[key];
    // A pin names the tag to hold, so releasing the pinned tag again goes back too.
    const pinned = policy?.docSpaces?.[space]?.editions?.find((e) => e.id === info.edition)?.pin === info.tag;
    if (!backwards && !pinned && prev && prev.release !== release) {
      const live = await readJson(storage, `${releasePrefix(space, segment, prev.release)}_platform/release.json`);
      if (live?.publishedAt && info.publishedAt && live.publishedAt > info.publishedAt) {
        kept.push(key);
        notes.push(`${key} stays on ${prev.release}, published after ${release}; roll back to go back`);
        continue;
      }
    }
    const previous = prev ? [prev.release, ...prev.previous] : [];
    state.deployments[key] = {
      release, tag: info.tag, edition: info.edition, deployedAt: now.toISOString(),
      previous: [...new Set(previous.filter((r) => r !== release))].slice(0, HISTORY),
    };
  }
  state.environment = environment ?? state.environment;
  state.updatedAt = now.toISOString();
  await putJson(storage, STATE_KEY, state);
  const { manifest, warnings } = await publishRuntime(storage, { policy, state, environment: state.environment, chrome, now });
  return { state, manifest, warnings: [...notes, ...warnings], kept };
}

// Rollback is a flip back to the previous (or a named) release.
export async function rollback(storage, { environment, policy, space, segment, to, now }) {
  const state = await readState(storage);
  const cur = state.deployments[`${space}/${segment}`];
  if (!cur) throw new Error(`${space}/${segment} is not deployed`);
  const target = to ?? cur.previous[0];
  if (!target) throw new Error(`${space}/${segment} has no earlier release to roll back to`);
  return flip(storage, { environment, policy, deployments: [{ space, segment, release: target }], now, backwards: true });
}

// Takes a Docs deployment out of service: its pointer leaves the state, so the
// edge stops serving it, the sitemap index and the redirect table drop it, and
// the search consistency check (--fix) removes its records. For an Edition the
// Doc space manifest no longer lists (removed, or moved to legacyVersions);
// a live or end-of-life Edition is refused. Its release folders stay until gc.
export async function retire(storage, { environment, policy, space, segment, now = new Date() }) {
  const state = await readState(storage);
  const key = `${space}/${segment}`;
  const cur = state.deployments[key];
  if (!cur) throw new Error(`${key} is not deployed`);
  const s = policy.docSpaces?.[space];
  const listed = (id) => s?.editions?.some((e) => e.id === id && e.status !== 'legacy');
  if (segment === 'latest' ? Boolean(s?.latest && s.latest !== 'cloud' && listed(s.latest)) : listed(cur.edition)) {
    throw new Error(`${key} is still an Edition in the manifest (${segment === 'latest' ? `latest is ${s.latest}` : cur.edition}); remove it from ${space}'s docspace.yaml first, or mark it end-of-life to keep it with noindex`);
  }
  delete state.deployments[key];
  state.updatedAt = now.toISOString();
  await putJson(storage, STATE_KEY, state);
  const { manifest, warnings } = await publishRuntime(storage, { policy, state, environment: environment ?? state.environment, now });
  return { state, manifest, warnings, retired: { ...cur, deployment: key } };
}

// Keeps the newest `keep` complete releases of every deployment, plus the live
// one. Incomplete folders (no release.json) are left alone: an upload may be
// in progress.
export async function gc(storage, { keep = KEEP_RELEASES, dryRun = false } = {}) {
  const state = await readState(storage);
  const removed = [];
  for (const space of await storage.listFolders('_releases/')) {
    for (const segment of await storage.listFolders(`_releases/${space}/`)) {
      const live = state.deployments[`${space}/${segment}`]?.release;
      const releases = [];
      for (const release of await storage.listFolders(`_releases/${space}/${segment}/`)) {
        const info = await readJson(storage, `${releasePrefix(space, segment, release)}_platform/release.json`);
        if (info) releases.push({ release, publishedAt: info.publishedAt });
      }
      releases.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      for (const { release } of releases.slice(keep)) {
        if (release === live) continue;
        removed.push(`${space}/${segment}/${release}`);
        if (!dryRun) {
          const keys = await storage.list(releasePrefix(space, segment, release));
          // Drop release.json first, so a half-deleted folder reads as incomplete.
          const marker = keys.filter((k) => k.endsWith('/_platform/release.json'));
          await storage.delete(marker);
          await storage.delete(keys.filter((k) => !marker.includes(k)));
        }
      }
    }
  }
  return removed;
}

// KV key for a redirect source: the path on the docs host, or host + path for
// a legacy host (is.docs.wso2.com/en/7.3.0/...).
export function redirectKey(from) {
  if (/^https?:\/\//.test(from)) {
    const u = new URL(from);
    return `${u.host.toLowerCase()}${u.pathname}`;
  }
  return from.startsWith('/') ? from : `/${from}`;
}

// One table from every live deployment's _platform/redirects.json. Pinned
// Editions win over latest twins for legacy URLs (pinned legacy versions map to
// their pinned new version); any other clash is reported and the first kept.
export async function compileRedirectTable(storage) {
  const state = await readState(storage);
  const table = {};
  const source = {};
  const conflicts = [];
  const entries = Object.entries(state.deployments).sort(([a], [b]) => Number(a.endsWith('/latest')) - Number(b.endsWith('/latest')) || a.localeCompare(b));
  for (const [key, d] of entries) {
    const [space, segment] = key.split('/');
    const list = await readJson(storage, `${releasePrefix(space, segment, d.release)}_platform/redirects.json`);
    for (const r of list ?? []) {
      const k = redirectKey(r.from);
      const value = { to: r.to, status: r.status ?? 301 };
      if (!table[k]) {
        table[k] = value;
        source[k] = key;
      } else if (table[k].to !== value.to && !(segment === 'latest' && !source[k].endsWith('/latest'))) {
        conflicts.push({ key: k, kept: { ...table[k], from: source[k] }, dropped: { ...value, from: key } });
      }
    }
  }
  return { table: Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b))), conflicts };
}

// Brings Workers KV in line with the compiled table, writing only what changed.
// The previous table is kept in the bucket, so no KV listing is needed.
export async function syncRedirects(storage, kv, { dryRun = false } = {}) {
  const { table, conflicts } = await compileRedirectTable(storage);
  const previous = (await readJson(storage, TABLE_KEY)) ?? {};
  const puts = Object.entries(table).filter(([k, v]) => JSON.stringify(previous[k]) !== JSON.stringify(v)).map(([key, v]) => ({ key, value: JSON.stringify(v) }));
  const deletes = Object.keys(previous).filter((k) => !(k in table));
  if (!dryRun) {
    if (puts.length) await kv.putMany(puts);
    if (deletes.length) await kv.deleteMany(deletes);
    await putJson(storage, TABLE_KEY, table);
  }
  return { size: Object.keys(table).length, puts: puts.length, deletes: deletes.length, conflicts };
}

// Step 7 (promotion): copies a release folder between buckets byte for byte,
// so production serves exactly what staging tested. release.json goes last.
export async function copyRelease(from, to, { space, segment, release, concurrency = 16 }) {
  const prefix = releasePrefix(space, segment, release);
  const marker = `${prefix}_platform/release.json`;
  if (!(await from.get(marker))) throw new Error(`${from.name} has no complete release ${space}/${segment}/${release}`);
  if (await to.get(marker)) return { skipped: true };
  const keys = (await from.list(prefix)).filter((k) => k !== marker);
  await pool(keys, concurrency, async (key) => {
    const obj = await from.get(key);
    await to.put(key, obj.body, { contentType: obj.contentType });
  });
  const m = await from.get(marker);
  await to.put(marker, m.body, { contentType: 'application/json' });
  return { skipped: false, files: keys.length };
}

// PR previews live in their own bucket (docs-previews), so the preview-only
// credential cannot touch staging releases. A preview path is mutable: each
// push replaces it. The bucket's lifecycle rule expires old previews.
export async function publishPreview(storage, dir, { space, pr, edition, concurrency = 16 }) {
  if (!/^\d+$/.test(String(pr))) throw new Error(`Invalid PR number "${pr}"`);
  const prefix = `${checkId('Doc space', space)}/pr-${pr}/${checkId('Edition', edition)}/`;
  const files = filesUnder(dir);
  await pool(files, concurrency, (rel) => storage.put(prefix + rel, fs.readFileSync(path.join(dir, rel)), { contentType: contentTypeFor(rel) }));
  const stale = (await storage.list(prefix)).filter((k) => !files.includes(k.slice(prefix.length)));
  await storage.delete(stale);
  return { prefix, files: files.length, removed: stale.length, path: `/_preview/${prefix}` };
}
