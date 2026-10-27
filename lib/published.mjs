// Composing from the published manifest (Boilerplate to copy and start).
//
// `preview`, `check` and `build` from a Content repo, and the Content repo's
// own compose check on a pull request, need the Deployment manifest with this
// repo's Doc space manifests in it, but no checkout of any other Content repo
// or of the Platform's navigation/. They start from the published
// manifest.json (any environment's: staging by default) and rebuild from it
// the team manifests it was composed from, as compose inputs; then this
// repo's own docspace.yaml files take their place and the real compose step
// runs (lib/compose.mjs), with every rule it has.
//
// The rebuilt inputs carry what the published file says: names, Editions
// and their order, Legacy versions, `latest`, home and listing, Cloud parts,
// notices, owners, the sections' menus (with entries that wait for a coming
// Doc space) and the products menu. What it doesn't say (release branches,
// pins, environments of other Doc spaces) only ever matters for this repo's
// own Doc spaces, which come from their files.
//
// WSO2_DOCS_CONTENT_REPOS (or --content) still composes from checkouts
// instead, for testing a change across several repos.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composePr, errorsIn, mainRef, readRepoDocSpaces } from './compose.mjs';
import { sectionEntries } from './manifest.mjs';
import { parseBranch } from './content-repo.mjs';

// The published manifest preview and check start from, unless told otherwise
// (--published or WSO2_DOCS_PUBLISHED_MANIFEST: a URL or a file).
export const DEFAULT_PUBLISHED = 'https://docs-staging.wso2.com/manifest.json';
export const publishedSource = (explicit, env = process.env) => explicit || env.WSO2_DOCS_PUBLISHED_MANIFEST || DEFAULT_PUBLISHED;

const PLATFORM_REPO = 'wso2/docs-platform';
const stubFile = (repo, slug) => `${repo}:${slug}/docspace.yaml`;
const lower = (s) => String(s ?? '').toLowerCase();

// The compose inputs a published manifest was made from, as far as it says.
export function sourcesFromPublished(published) {
  if (!published?.docSpaces || !published.sections) throw new Error('Not a published manifest.json: it needs "docSpaces" and "sections"');
  const groups = published.productsMenu ?? [];
  const groupOf = (familyName) => groups.find((g) => g.name === familyName)?.id ?? null;
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  const platformRepo = Object.values(published.docSpaces).find((s) => s.listed === false && s.indexed === true && s.repo)?.repo ?? PLATFORM_REPO;

  const notYetOnWso2Docs = {};
  const docSpaces = [];
  for (const [slug, s] of Object.entries(published.docSpaces)) {
    if (!s.repo) {
      // A product not on WSO2 Docs yet: an entry in the Platform navigation file.
      const at = groupOf(s.family);
      if (at) notYetOnWso2Docs[slug] = { displayName: s.displayName, in: at, model: s.model, ...pick(s, ['formerNames', 'legacyUrl']) };
      continue;
    }
    const editions = (s.editions ?? []).filter((e) => e.status !== 'legacy')
      .map((e) => ({ id: e.id, ...(e.status && e.status !== 'live' ? { status: e.status } : {}), ...(e.parts ? { parts: [...e.parts] } : {}) }));
    const legacyVersions = (s.editions ?? []).filter((e) => e.status === 'legacy' && e.legacyUrl).map((e) => ({ id: e.id, url: e.legacyUrl }));
    const data = {
      schemaVersion: 1, slug, displayName: s.displayName,
      ...pick(s, ['formerNames', 'brand', 'editionNames']),
      ...(editions.length ? { editions } : {}),
      ...(legacyVersions.length ? { legacyVersions } : {}),
      ...(s.latest && editions.some((e) => e.id === s.latest) ? { latest: s.latest } : {}),
      ...(s.listed === false ? { listed: false, ...(s.indexed ? { indexed: true } : {}) } : { home: s.home }),
      ...pick(s, ['cloud', 'notices', 'editLinks', 'issues']),
      owners: s.owners?.team ? { team: s.owners.team } : { team: 'unknown' },
      repo: s.repo,
      ...(s.status === 'legacy' ? { status: 'legacy', legacyUrl: s.legacyUrl } : {}),
    };
    docSpaces.push({ file: stubFile(s.repo, slug), repo: s.repo, dir: slug, data });
  }

  // Sections in the products menu's order (the navigation file's).
  const sectionIds = groups.flatMap((g) => g.sections ?? []);
  for (const id of Object.keys(published.sections)) if (!sectionIds.includes(id)) sectionIds.push(id);
  const sections = {};
  for (const id of sectionIds) {
    const sec = published.sections[id];
    const { menu, products } = sectionEntries(sec);
    sections[id] = {
      file: `${platformRepo}:navigation/sections/${id}.yaml`,
      data: {
        schemaVersion: 1, id, title: sec.title, owners: sec.owners?.team ? { team: sec.owners.team } : { team: 'unknown' },
        products: products.map((e) => ({ label: e.item.label, opens: { ...e.item.opens } })),
        // A section's own version-in choice is kept (a default is worked out again).
        menu: menu.map(({ item, pending }) => (item.docSpace === undefined ? { label: item.label, url: item.url }
          : { docSpace: item.docSpace, ...(item.versionIn && (pending || item.versionInSet) ? { 'version-in': item.versionIn } : {}) })),
      },
    };
  }
  const repos = [...new Set(docSpaces.map((d) => d.repo))];
  const navigation = {
    file: `${platformRepo}:navigation/navigation.yaml`,
    data: {
      schemaVersion: 1,
      owners: { team: 'docs-platform' },
      platformRepo,
      families: groups.filter((g) => g.kind !== 'group').map((g) => pick(g, ['id', 'name', 'description'])),
      groups: groups.filter((g) => g.kind === 'group').map((g) => pick(g, ['id', 'name', 'description'])),
      environments: published.environments?.length ? [...published.environments] : [...new Set(['staging', 'production', published.environment].filter(Boolean))],
      sections: sectionIds.map((id) => ({ id, in: published.sections[id].in })),
      contentRepos: (repos.length ? repos : [platformRepo]).map((repo) => ({ repo })),
      ...(Object.keys(notYetOnWso2Docs).length ? { notYetOnWso2Docs } : {}),
    },
  };
  return { navigation, sections, docSpaces };
}

// The published manifest as the base a change composes against (what
// composePr takes): its Doc spaces name their rebuilt files, so removing one
// still counts as removing it.
export function baseFromPublished(published) {
  const sources = sourcesFromPublished(published);
  const docSpaces = {};
  for (const [slug, s] of Object.entries(published.docSpaces)) docSpaces[slug] = s.repo ? { ...s, source: { file: stubFile(s.repo, slug) } } : s;
  return { ...published, docSpaces, sources };
}

// Reads the published manifest from a URL or a file. A URL's copy is kept in
// ~/.cache/wso2-docs/published/, and used (with a warning) when the URL can't
// be reached.
export async function readPublished(source, { cacheDir = path.join(os.homedir(), '.cache', 'wso2-docs', 'published'), fetchImpl = globalThis.fetch, log = () => {}, timeoutMs = 15000 } = {}) {
  if (!/^https?:\/\//.test(source)) return JSON.parse(fs.readFileSync(path.resolve(source), 'utf8'));
  const cache = path.join(cacheDir, `${crypto.createHash('sha256').update(source).digest('hex').slice(0, 16)}.json`);
  try {
    const r = await fetchImpl(source, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!data?.docSpaces) throw new Error('not a published manifest');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cache, `${JSON.stringify(data)}\n`);
    return data;
  } catch (err) {
    if (fs.existsSync(cache)) {
      log(`warning: can't read ${source} (${err.message}); using the copy from ${new Date(fs.statSync(cache).mtimeMs).toISOString()}`);
      return JSON.parse(fs.readFileSync(cache, 'utf8'));
    }
    throw new Error(`Can't read the published manifest from ${source} (${err.message}). Point --published or WSO2_DOCS_PUBLISHED_MANIFEST at a reachable manifest.json, or set WSO2_DOCS_CONTENT_REPOS to compose from Content repo checkouts.`);
  }
}

// One Content repo checkout as compose reads it: the checkout's top, the
// directory that holds its Doc space directories, and the repo's name from
// its manifests. `dir` is a Doc space directory or the repo root.
export function localRepo(dir) {
  let at = fs.realpathSync(path.resolve(dir));
  if (fs.existsSync(path.join(at, 'docspace.yaml'))) at = path.dirname(at);
  const top = gitTop(at) ?? at;
  const sub = path.relative(top, at).split(path.sep).join('/');
  const found = readRepoDocSpaces(top, { repo: '?', path: sub });
  const repo = found.map((d) => d.data?.repo).find((r) => typeof r === 'string');
  if (!repo) throw new Error(`No Doc space manifest (<doc space>/docspace.yaml with a repo field) in ${at}`);
  return { checkout: top, path: sub, repo };
}

function gitTop(dir) {
  try {
    const out = fs.realpathSync(dir);
    let d = out;
    while (true) {
      if (fs.existsSync(path.join(d, '.git'))) return d;
      const up = path.dirname(d);
      if (up === d) return null;
      d = up;
    }
  } catch {
    return null;
  }
}

// This repo's Doc space manifests as they count: on main or a branch made
// from it, the working copy (the change being previewed); on a release
// branch, the main line's copy (only main's docspace.yaml counts), when the
// checkout has one.
export function localDocSpaces({ checkout, path: sub, repo }, { branch = null } = {}) {
  const b = parseBranch(branch);
  const ref = b && !b.main ? mainRef(checkout) : null;
  const entry = { repo, path: sub };
  return ref ? readRepoDocSpaces(checkout, entry, { ref }) : readRepoDocSpaces(checkout, entry);
}

// The Deployment manifest preview, check and build use from a Content repo:
// the published manifest with this repo's Doc space manifests composed in.
// `issues` are compose's issues that involve this repo's files; `errors` the
// blocking ones among them.
export function composeWithPublished(published, { repo, docSpaces }) {
  const base = baseFromPublished(published);
  const r = composePr(base, { repos: [repo], docSpaces });
  const own = new Set(docSpaces.map((d) => d.file));
  const issues = r.issues.filter((i) => i.files.some((f) => own.has(f)));
  return { manifest: r.manifest, issues, errors: errorsIn(issues), files: [...own] };
}

// Is a Content repo new to WSO2 Docs (no Doc space of it published yet)?
export const knownRepo = (published, repo) => Object.values(published.docSpaces).some((s) => lower(s.repo) === lower(repo));
