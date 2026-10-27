// The compose step (Team manifests and how the final build merges them).
// It reads the three kinds of manifest:
//   - the Platform navigation file, navigation/navigation.yaml (Platform team);
//   - every Docs section manifest, navigation/sections/<id>.yaml (each
//     section's team, through CODEOWNERS);
//   - every Doc space manifest, <repo>/<path>/<slug>/docspace.yaml on each
//     Content repo's main line (each Doc space's team);
// validates them against schemas/, checks the rules between them, and merges
// them into the Deployment manifest. lib/manifest.mjs turns that into the
// published manifest.json; the pipeline adds the deployed tags.
//
// Blocking errors (codes): schema, duplicate, home-not-listing,
// lists-unlisted, removed-still-listed, unknown-edition, latest, version-in,
// cloud-part, link-internal, plus the file-level checks unknown-section,
// unknown-family, unknown-environment, branch-prefix, pin and missing-repo.
// Warnings: unknown-docspace (a section may list a Doc space that is coming:
// the entry waits, hidden, in the section's `pending` until the Doc space's
// manifest is on its main line), label-differs, borrowed-not-in-home-products,
// notice-ended. Notes: borrowed.
//
// On main a failed compose keeps the last good manifest and names the owners
// to alert (composeMain). A PR composes against the latest merged manifest and
// blocks only on errors that involve the files it changes (composePr).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { validate } from './schemas.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PLATFORM_ROOT = path.join(here, '..');
export const DEFAULT_NAVIGATION = path.join(PLATFORM_ROOT, 'navigation');
// WSO2 Docs' own hosts: a section's link entries point elsewhere.
const WSO2_DOCS_HOST = /^(docs|docs-staging)\.wso2\.com$/i;
// The Content repo checkouts compose reads, one directory per repo (named as
// the repo): --content or WSO2_DOCS_CONTENT_REPOS, else the directory the
// Platform checkout sits in (checkouts side by side). CI clones each
// contentRepos main line into one directory and passes it.
export const defaultContentDir = (env = process.env) => env.WSO2_DOCS_CONTENT_REPOS || path.dirname(PLATFORM_ROOT);
// Where the pipeline keeps the last good composed manifest, next to state.json.
export const COMPOSED_KEY = '_platform/composed.json';

const repoName = (repo) => repo.split('/').pop();
const lower = (s) => String(s ?? '').toLowerCase();

// Manifests are read with YAML's core schema: a date such as an unquoted
// `until: 2027-03-31` stays the plain text the schemas expect.
export const readManifestText = (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA });

function readYaml(file) {
  try {
    return { data: readManifestText(fs.readFileSync(file, 'utf8')) ?? null };
  } catch (err) {
    return { error: `cannot be read as YAML: ${err.message.split('\n')[0]}` };
  }
}

const subdirs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

// Every <checkout>/<path>/<slug>/docspace.yaml in one Content repo checkout:
// the working tree, or with `ref` (main) that commit's files, since only the
// main line's Doc space manifests count.
export function readRepoDocSpaces(checkout, { repo, path: sub = '' }, { ref = null } = {}) {
  if (ref) return readRepoDocSpacesAt(checkout, { repo, path: sub }, ref);
  const base = path.join(checkout, sub);
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const dir of subdirs(base)) {
    const file = path.join(base, dir, 'docspace.yaml');
    if (!fs.existsSync(file)) continue;
    out.push({ file: `${repo}:${sub ? `${sub}/` : ''}${dir}/docspace.yaml`, repo, dir, ...readYaml(file) });
  }
  return out;
}

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });

// The main line of a checkout that is its own git repo: `main`, else
// `origin/main`; null for a plain directory (a fixture) or a subfolder of
// another repo.
export function mainRef(checkout) {
  try {
    if (path.resolve(git(checkout, 'rev-parse', '--show-toplevel').trim()) !== path.resolve(checkout)) return null;
  } catch {
    return null;
  }
  for (const ref of ['refs/heads/main', 'refs/remotes/origin/main']) {
    try {
      git(checkout, 'rev-parse', '--verify', '--quiet', ref);
      return ref.replace(/^refs\/(heads|remotes)\//, '');
    } catch { /* try the next */ }
  }
  return null;
}

function readRepoDocSpacesAt(checkout, { repo, path: sub }, ref) {
  const prefix = sub ? `${sub.replace(/\/$/, '')}/` : '';
  const out = [];
  let dirs;
  try {
    dirs = git(checkout, 'ls-tree', '-d', '--name-only', `${ref}:${prefix}`).split('\n').filter(Boolean).sort();
  } catch {
    return [];
  }
  for (const dir of dirs) {
    let text;
    try {
      text = git(checkout, 'show', `${ref}:${prefix}${dir}/docspace.yaml`);
    } catch {
      continue;
    }
    let parsed;
    try {
      parsed = { data: readManifestText(text) ?? null };
    } catch (err) {
      parsed = { error: `cannot be read as YAML: ${err.message.split('\n')[0]}` };
    }
    out.push({ file: `${repo}:${prefix}${dir}/docspace.yaml`, repo, dir, ...parsed });
  }
  return out;
}

function readNavigation(navigationDir, platformRepo) {
  const navigation = { file: `${platformRepo}:navigation/navigation.yaml`, ...readYaml(path.join(navigationDir, 'navigation.yaml')) };
  const sections = {};
  const dir = path.join(navigationDir, 'sections');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
      const id = f.replace(/\.ya?ml$/, '');
      sections[id] = { file: `${platformRepo}:navigation/sections/${f}`, ...readYaml(path.join(dir, f)) };
    }
  }
  return { navigation, sections };
}

// The compose step's inputs from local checkouts: the Platform's navigation/
// directory, plus one checkout per Content repo under `contentDir` (named as
// the repo). The Platform's own Doc spaces (Contribute) come from
// `platformRoot`.
export function readInputs({ navigationDir = DEFAULT_NAVIGATION, contentDir = defaultContentDir(), platformRoot = PLATFORM_ROOT } = {}) {
  const peek = readYaml(path.join(navigationDir, 'navigation.yaml')).data;
  const platformRepo = typeof peek?.platformRepo === 'string' ? peek.platformRepo : 'wso2/docs-platform';
  const { navigation, sections } = readNavigation(navigationDir, platformRepo);
  const docSpaces = [];
  const missingRepos = [];
  for (const entry of Array.isArray(peek?.contentRepos) ? peek.contentRepos : []) {
    if (typeof entry?.repo !== 'string') continue;
    const checkout = lower(entry.repo) === lower(platformRepo) ? platformRoot : path.join(contentDir, repoName(entry.repo));
    if (!fs.existsSync(checkout)) missingRepos.push(entry.repo);
    else if (checkout === platformRoot) docSpaces.push(...readRepoDocSpaces(checkout, entry));
    else docSpaces.push(...readRepoDocSpaces(checkout, entry, { ref: mainRef(checkout) }));
  }
  return { navigation, sections, docSpaces, missingRepos };
}

// Cloud, Self-hosted versions, both, or neither: what today's readers call the
// Doc space's model. A Cloud part does not count: the component's Cloud lives
// in its platform's tree.
export function modelOf(editions = []) {
  const ids = editions.filter((e) => e.status !== 'legacy').map((e) => e.id);
  const cloud = ids.includes('cloud');
  const versions = ids.some((id) => id !== 'cloud');
  if (!ids.length) return 'unversioned';
  if (cloud && versions) return 'cloud-plus-versions';
  return cloud ? 'cloud-only' : 'versions-only';
}

const sameName = (a, b) => lower(a).replace(/^wso2\s+/, '').trim() === lower(b).replace(/^wso2\s+/, '').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compose(inputs, { base = null, now = new Date() } = {}) {
  const today = now.toISOString().slice(0, 10);
  const issues = [];
  const add = (level, code, message, files, owners) => issues.push({
    level, code, message, files: [...new Set(files.filter(Boolean))], owners: [...new Set(owners.filter(Boolean))].sort(),
  });
  const error = (...a) => add('error', ...a);
  const warning = (...a) => add('warning', ...a);
  const note = (...a) => add('note', ...a);

  // --- The Platform navigation file -----------------------------------------
  const navIn = inputs.navigation;
  const navFile = navIn.file;
  const platformOwner = navIn.data?.owners?.team ?? 'docs-platform';
  if (navIn.error) error('schema', navIn.error, [navFile], [platformOwner]);
  else for (const p of validate('navigation', navIn.data)) error('schema', p, [navFile], [platformOwner]);
  if (issues.length) return { manifest: null, issues };
  const nav = navIn.data;
  for (const repo of inputs.missingRepos ?? []) error('missing-repo', `no checkout of ${repo} to read its Doc space manifests from`, [navFile], [platformOwner]);

  const groups = new Map();
  for (const [kind, list] of [['family', nav.families], ['group', nav.groups]]) {
    for (const g of list) {
      if (groups.has(g.id)) error('duplicate', `family or group "${g.id}" is listed twice`, [navFile], [platformOwner]);
      else groups.set(g.id, { ...g, kind });
    }
  }
  const environments = new Set(nav.environments);
  const sectionIn = new Map();
  for (const s of nav.sections) {
    if (sectionIn.has(s.id)) error('duplicate', `section "${s.id}" is listed twice`, [navFile], [platformOwner]);
    else {
      if (!groups.has(s.in)) error('unknown-family', `section "${s.id}" is in "${s.in}", which is no family or group`, [navFile], [platformOwner]);
      sectionIn.set(s.id, s.in);
    }
  }

  // --- Docs section manifests -----------------------------------------------
  const sections = new Map();
  for (const [id, s] of Object.entries(inputs.sections ?? {})) {
    const owner = s.data?.owners?.team;
    if (s.error) {
      error('schema', s.error, [s.file], [owner, platformOwner]);
      continue;
    }
    const problems = validate('section', s.data);
    for (const p of problems) error('schema', p, [s.file], [owner]);
    if (problems.length) continue;
    if (s.data.id !== id) {
      error('schema', `id is "${s.data.id}", but the file is ${id}.yaml`, [s.file], [owner]);
      continue;
    }
    if (!sectionIn.has(id)) {
      error('unknown-section', `section "${id}" is not in navigation.yaml's sections; only the Platform team adds sections`, [s.file, navFile], [owner, platformOwner]);
      continue;
    }
    sections.set(id, { file: s.file, owner, data: s.data });
  }
  for (const id of sectionIn.keys()) {
    if (!inputs.sections?.[id]) error('unknown-section', `navigation.yaml lists section "${id}", which has no navigation/sections/${id}.yaml`, [navFile], [platformOwner]);
  }

  // --- Doc space manifests ----------------------------------------------------
  const broken = new Set(); // slugs whose own file is in error: no knock-on errors
  const candidates = [];
  for (const d of inputs.docSpaces ?? []) {
    const owner = d.data?.owners?.team;
    if (d.error) {
      error('schema', d.error, [d.file], [owner]);
      broken.add(d.dir);
      continue;
    }
    const problems = validate('docspace', d.data);
    for (const p of problems) error('schema', p, [d.file], [owner]);
    const slug = typeof d.data?.slug === 'string' ? d.data.slug : d.dir;
    if (problems.length) {
      broken.add(slug);
      continue;
    }
    if (slug !== d.dir) {
      error('schema', `slug is "${slug}", but its directory is ${d.dir}/ (one directory per Doc space, named by its slug)`, [d.file], [owner]);
      broken.add(slug);
      continue;
    }
    if (d.repo && lower(d.data.repo) !== lower(d.repo)) {
      error('schema', `repo is ${d.data.repo}, but the file is in ${d.repo}`, [d.file], [owner]);
      broken.add(slug);
      continue;
    }
    candidates.push({ ...d, slug, owner });
  }
  const spaces = new Map();
  const bySlug = Map.groupBy(candidates, (d) => d.slug);
  for (const [slug, list] of bySlug) {
    if (list.length > 1) {
      error('duplicate', `Doc space slug "${slug}" is claimed by ${list.map((d) => d.file).join(' and ')}`, list.map((d) => d.file), list.map((d) => d.owner));
      broken.add(slug);
    } else spaces.set(slug, list[0]);
  }
  const notYet = new Map();
  for (const [slug, e] of Object.entries(nav.notYetOnWso2Docs ?? {})) {
    if (!groups.has(e.in)) error('unknown-family', `notYetOnWso2Docs.${slug} is in "${e.in}", which is no family or group`, [navFile], [platformOwner]);
    if (spaces.has(slug)) {
      error('duplicate', `Doc space slug "${slug}" has a Doc space manifest and a notYetOnWso2Docs entry in navigation.yaml; remove the entry`, [spaces.get(slug).file, navFile], [spaces.get(slug).owner, platformOwner]);
    } else if (bySlug.has(slug) || broken.has(slug)) {
      // The Doc space's own file is in error; it still replaces the entry.
    } else notYet.set(slug, e);
  }

  // Branches and tags are prefixed with the Doc space where a repo builds several.
  const builtPerRepo = new Map();
  for (const d of spaces.values()) if (d.data.status !== 'legacy') builtPerRepo.set(lower(d.data.repo), (builtPerRepo.get(lower(d.data.repo)) ?? 0) + 1);

  const norm = new Map();
  for (const [slug, d] of spaces) {
    const m = d.data;
    const at = [d.file];
    const who = [d.owner];
    // A Doc space whose release branches carry its prefix (a shared repo
    // that builds one Doc space so far) has prefixed tags too.
    const prefixed = (builtPerRepo.get(lower(m.repo)) ?? 0) > 1 || (m.editions ?? []).some((e) => String(e.branch ?? '').startsWith(`${slug}/`));
    const prefix = prefixed ? `${slug}/` : '';
    const editions = [];
    const ids = new Set();
    for (const e of m.editions ?? []) {
      if (ids.has(e.id)) {
        error('duplicate', `${slug}: Edition ${e.id} is listed twice`, at, who);
        continue;
      }
      ids.add(e.id);
      const cloud = e.id === 'cloud';
      const branch = e.branch ?? (cloud ? 'main' : `${prefix}release/${e.id}`);
      if (prefixed && branch !== 'main' && !branch.startsWith(prefix)) {
        error('branch-prefix', `${slug}: Edition ${e.id}'s branch ${branch} must start with "${prefix}", since ${m.repo} holds several Doc spaces`, at, who);
      }
      if (e.pin) {
        const tag = cloud ? new RegExp(`^${escapeRe(prefix)}cloud-\\d{4}\\.\\d{2}\\.\\d{2}\\.\\d+$`) : new RegExp(`^${escapeRe(prefix)}${escapeRe(e.id)}-docs\\.\\d+$`);
        const example = cloud ? `${prefix}cloud-<YYYY.MM.DD>.<n>` : `${prefix}${e.id}-docs.<n>`;
        if (!tag.test(e.pin)) error('pin', `${slug}: Edition ${e.id} pins "${e.pin}", which is not one of its Docs release tags (${example})`, at, who);
      }
      if (e.parts && !cloud) error('cloud-part', `${slug}: only the Cloud Edition has Cloud parts, but ${e.id} lists ${e.parts.join(', ')}`, at, who);
      editions.push({ id: e.id, status: e.status ?? 'live', branch, ...(e.pin ? { pin: e.pin } : {}), ...(cloud && e.parts ? { parts: [...e.parts] } : {}) });
    }
    const legacy = [];
    for (const l of m.legacyVersions ?? []) {
      if (ids.has(l.id)) error('duplicate', `${slug}: ${l.id} is listed as an Edition and as a Legacy version, or twice`, at, who);
      else {
        ids.add(l.id);
        legacy.push({ id: l.id, status: 'legacy', legacyUrl: l.url });
      }
    }
    const model = modelOf(editions);
    if (m.model && m.model !== model) error('schema', `${slug}: model is ${m.model}, but its Editions make it ${model}`, at, who);
    // latest: the newest release (the first Self-hosted Edition in order), or
    // Cloud in a Cloud-only Doc space (URLs, latest and canonicals). The team
    // may name another Self-hosted Edition, never Cloud.
    let latest = model === 'unversioned' ? null : editions.find((e) => e.id !== 'cloud')?.id ?? 'cloud';
    if (m.latest !== undefined) {
      const selfHosted = editions.find((e) => e.id !== 'cloud');
      // /latest/ is never Cloud: Cloud keeps /cloud/. Only a Cloud-only Doc
      // space's latest is cloud (its /latest/ answers 302 to /cloud/).
      if (m.latest === 'cloud' && selfHosted) error('latest', `${slug}: latest is "cloud", but /latest/ is never Cloud where there are Self-hosted Editions; remove latest to use the newest release (${selfHosted.id}), or name another Self-hosted Edition`, at, who);
      else if (editions.some((e) => e.id === m.latest)) latest = m.latest;
      else error('latest', `${slug}: latest is "${m.latest}", which names no Edition${legacy.some((l) => l.id === m.latest) ? ` (${m.latest} is a Legacy version)` : ''}`, at, who);
    }
    for (const env of m.environments ?? []) {
      if (!environments.has(env)) error('unknown-environment', `${slug}: environment "${env}" is not one of ${[...environments].join(', ')}`, at, who);
    }
    // Team notices name Editions on WSO2 Docs (a Cloud part's Cloud counts),
    // and one past its last day is only warned about: the chrome stops showing it.
    const noticeEditions = new Set([...editions.map((e) => e.id), ...(m.cloud?.in ? ['cloud'] : [])]);
    (m.notices ?? []).forEach((n, i) => {
      for (const ed of n.editions ?? []) {
        if (!noticeEditions.has(ed)) error('unknown-edition', `${slug}: notice ${i + 1} applies to Edition ${ed}, which ${legacy.some((l) => l.id === ed) ? 'is a Legacy version, not an Edition' : 'it does not have'} (${[...noticeEditions].join(', ')})`, at, who);
      }
      if (n.until && n.until < today) warning('notice-ended', `${slug}: notice ${i + 1} ended on ${n.until} and is no longer shown; remove it`, at, who);
    });
    norm.set(slug, { ...d, m, editions: [...editions, ...legacy], model, latest, prefix });
  }

  // Editions a version dropdown offers: Cloud (its own or its Cloud part) plus
  // every Self-hosted Edition on WSO2 Docs.
  const choices = (n) => n.editions.filter((e) => e.status !== 'legacy').length + (n.m.cloud && !n.editions.some((e) => e.id === 'cloud') ? 1 : 0);

  // --- Sections against Doc spaces -------------------------------------------
  // A slug no Doc space manifest claims yet: a Doc space that is coming. The
  // section's change merges first; its entry waits in `pending`, hidden from
  // readers, until the Doc space's own manifest reaches its main line. Returns
  // true when the entry waits (false: removed, or its own file is in error).
  const missing = (slug, sec, where) => {
    if (broken.has(slug)) return false;
    const was = base?.docSpaces?.[slug];
    if (was?.source) {
      error('removed-still-listed', `Doc space "${slug}" was removed, but section ${sec.data.id} still lists it (${where})`, [was.source.file, sec.file], [was.owners?.team, sec.owner]);
      return false;
    }
    warning('unknown-docspace', `section ${sec.data.id} lists "${slug}" (${where}), which is no Doc space yet; the entry stays hidden until its Doc space manifest is on its repo's main line and the Doc space is published`, [sec.file], [sec.owner]);
    return true;
  };
  const listedBy = new Map();
  const composedSections = {};
  for (const [id, sec] of sections) {
    const menu = [];
    const pending = [];
    const seen = new Set();
    const linkLabels = new Set();
    sec.data.menu.forEach((item, i) => {
      if (item.docSpace === undefined) {
        // A link out (shown with ↗): a page on WSO2 Docs is a Doc space entry instead.
        if (WSO2_DOCS_HOST.test(new URL(item.url).hostname)) {
          error('link-internal', `section ${id}'s link "${item.label}" points into WSO2 Docs (${item.url}); list that Doc space as a menu entry, or link from a page`, [sec.file], [sec.owner]);
          return;
        }
        if (linkLabels.has(item.label)) {
          error('duplicate', `section ${id} has two links labelled "${item.label}" in its menu`, [sec.file], [sec.owner]);
          return;
        }
        linkLabels.add(item.label);
        menu.push({ label: item.label, url: item.url });
        return;
      }
      const slug = item.docSpace;
      if (seen.has(slug)) {
        error('duplicate', `section ${id} lists ${slug} twice in its menu`, [sec.file], [sec.owner]);
        return;
      }
      seen.add(slug);
      if (notYet.has(slug)) {
        menu.push({ docSpace: slug, versionIn: 'header' });
        return;
      }
      const n = norm.get(slug);
      if (!n) {
        if (missing(slug, sec, `menu item ${i + 1}`)) pending.push({ at: i, docSpace: slug, ...(item['version-in'] ? { versionIn: item['version-in'] } : {}) });
        return;
      }
      if (n.m.listed === false) {
        error('lists-unlisted', `section ${id} lists ${slug}, an Unlisted Doc space (listed: false), which no section may list`, [sec.file, n.file], [sec.owner, n.owner]);
        return;
      }
      const count = choices(n);
      if (item['version-in'] === 'menu' && count < 2) {
        error('version-in', `section ${id} sets version-in: menu for ${slug}, which has ${count} Edition${count === 1 ? '' : 's'}; a menu dropdown needs two or more`, [sec.file, n.file], [sec.owner, n.owner]);
      }
      // versionInSet: the section chose it (else the default from the Editions).
      menu.push({ docSpace: slug, versionIn: item['version-in'] ?? (count >= 2 ? 'menu' : 'header'), ...(item['version-in'] ? { versionInSet: true } : {}) });
      if (!listedBy.has(slug)) listedBy.set(slug, []);
      listedBy.get(slug).push(id);
    });
    const products = [];
    (sec.data.products ?? []).forEach((p, i) => {
      const slug = p.opens.docSpace;
      const where = `products-menu entry "${p.label}"`;
      if (notYet.has(slug)) {
        products.push({ label: p.label, opens: { ...p.opens } });
        return;
      }
      const n = norm.get(slug);
      if (!n) {
        if (missing(slug, sec, where)) pending.push({ at: i, product: { label: p.label, opens: { ...p.opens } } });
        return;
      }
      if (n.m.listed === false) {
        error('lists-unlisted', `section ${id}'s ${where} opens ${slug}, an Unlisted Doc space (listed: false)`, [sec.file, n.file], [sec.owner, n.owner]);
        return;
      }
      const ed = p.opens.edition;
      if (ed !== undefined && !(n.editions.some((e) => e.id === ed && e.status !== 'legacy') || (ed === 'cloud' && n.m.cloud))) {
        const was = base?.docSpaces?.[slug]?.editions?.some((e) => e.id === ed && e.status !== 'legacy');
        if (was) error('removed-still-listed', `Edition ${ed} of ${slug} was removed, but section ${id}'s ${where} still opens it`, [n.file, sec.file], [n.owner, sec.owner]);
        else error('unknown-edition', `section ${id}'s ${where} opens Edition ${ed} of ${slug}, which ${n.editions.some((e) => e.id === ed) ? 'is a Legacy version, not an Edition' : 'has no such Edition'}`, [sec.file], [sec.owner]);
        return;
      }
      if (p.opens.page === undefined && !sameName(p.label, n.m.displayName)) {
        warning('label-differs', `section ${id}'s products-menu label "${p.label}" differs from the Doc space's name, "${n.m.displayName}"`, [sec.file], [sec.owner]);
      }
      products.push({ label: p.label, opens: { ...p.opens } });
    });
    const group = groups.get(sectionIn.get(id));
    composedSections[id] = {
      title: sec.data.title, in: sectionIn.get(id), family: group?.name ?? null, menu, products, owners: sec.data.owners,
      // Entries for Doc spaces that are coming, with their place in the section manifest.
      ...(pending.length ? { pending } : {}),
    };
  }

  // --- Home sections and borrowing ------------------------------------------
  for (const [slug, n] of norm) {
    const home = n.m.home ?? null;
    const lists = listedBy.get(slug) ?? [];
    if (home) {
      const h = sections.get(home);
      if (!h) {
        if (!inputs.sections?.[home]) error('unknown-section', `${slug}'s home section "${home}" does not exist`, [n.file], [n.owner]);
      } else if (!lists.includes(home)) {
        error('home-not-listing', `${slug}'s home section is ${home}, but ${home} does not list it in its menu`, [n.file, h.file], [n.owner, h.owner]);
      }
    }
    const borrowers = lists.filter((s) => s !== home);
    for (const s of borrowers) note('borrowed', `${slug} (home ${home}) is borrowed by section ${s}`, [n.file, sections.get(s).file], [n.owner]);
    const h = home && sections.get(home);
    if (borrowers.length && h && !(h.data.products ?? []).some((p) => p.opens.docSpace === slug)) {
      warning('borrowed-not-in-home-products', `${slug} is borrowed by ${borrowers.join(', ')} but is missing from its home section ${home}'s products listing`, [h.file, n.file], [h.owner, n.owner]);
    }
  }

  // --- Cloud parts --------------------------------------------------------------
  const partOf = new Map();
  for (const [slug, n] of norm) {
    for (const part of n.editions.find((e) => e.id === 'cloud')?.parts ?? []) {
      if (!partOf.has(part)) partOf.set(part, []);
      partOf.get(part).push(slug);
      const p = norm.get(part);
      if (part === slug) {
        error('cloud-part', `${slug} lists itself as a Cloud part`, [n.file], [n.owner]);
        continue;
      }
      if (!p) {
        const was = base?.docSpaces?.[part]?.source ? base.docSpaces[part] : null;
        if (was) error('cloud-part', `${slug} lists Cloud part "${part}", which was removed`, [n.file, was.source.file], [n.owner, was.owners?.team]);
        else if (!broken.has(part)) error('cloud-part', `${slug} lists Cloud part "${part}", which is no Doc space`, [n.file], [n.owner]);
        continue;
      }
      if (p.m.cloud?.in !== slug) {
        error('cloud-part', `${slug} lists ${part} as a Cloud part, but ${part} does not point back (its cloud.in is ${p.m.cloud?.in ?? 'not set'})`, [n.file, p.file], [n.owner, p.owner]);
      }
      if (lower(p.m.repo) !== lower(n.m.repo)) {
        error('cloud-part', `Cloud part ${part} is in ${p.m.repo}, not ${n.m.repo}: parts come only from the platform's own Content repo`, [n.file, p.file], [n.owner, p.owner]);
      }
      if (p.editions.some((e) => e.id === 'cloud')) {
        error('cloud-part', `Cloud part ${part} has a Cloud Edition of its own; its Cloud is its part of ${slug}`, [p.file], [p.owner]);
      }
    }
  }
  for (const [part, platforms] of partOf) {
    if (platforms.length > 1) {
      error('cloud-part', `${part} is a Cloud part of ${platforms.join(' and ')}; a part belongs to one platform only`, platforms.map((s) => norm.get(s).file), platforms.map((s) => norm.get(s).owner));
    }
  }
  for (const [slug, n] of norm) {
    const target = n.m.cloud?.in;
    if (!target) continue;
    const t = norm.get(target);
    if (!t) {
      const was = base?.docSpaces?.[target]?.source ? base.docSpaces[target] : null;
      if (was) error('cloud-part', `${slug}'s cloud.in is "${target}", which was removed`, [n.file, was.source.file], [n.owner, was.owners?.team]);
      else if (!broken.has(target)) error('cloud-part', `${slug}'s cloud.in is "${target}", which is no Doc space`, [n.file], [n.owner]);
    } else if (!(partOf.get(slug) ?? []).includes(target)) {
      error('cloud-part', `${slug}'s cloud.in is ${target}, but ${target}'s Cloud Edition does not list ${slug} in its parts`, [n.file, t.file], [n.owner, t.owner]);
    }
  }

  // --- The composed Deployment manifest -------------------------------------
  // Doc spaces follow the sections' menus, then the rest, then the products
  // not on WSO2 Docs yet; readers group them by family in this order.
  const order = [];
  for (const s of nav.sections) for (const item of composedSections[s.id]?.menu ?? []) if (norm.get(item.docSpace)?.m.home === s.id && !order.includes(item.docSpace)) order.push(item.docSpace);
  for (const slug of norm.keys()) if (!order.includes(slug)) order.push(slug);
  const docSpaces = {};
  for (const slug of order) {
    const n = norm.get(slug);
    const m = n.m;
    const home = m.home ?? null;
    const optional = {
      formerNames: m.formerNames, editionNames: m.editionNames, brand: m.brand, repo: m.repo, editLinks: m.editLinks,
      issues: m.issues, legacyUrl: m.legacyUrl, environments: m.environments, cloud: m.cloud, notices: m.notices, indexed: m.indexed,
    };
    docSpaces[slug] = {
      displayName: m.displayName,
      family: home ? groups.get(sectionIn.get(home))?.name ?? null : null,
      model: n.model,
      status: m.status ?? 'live',
      latest: n.latest,
      editions: n.editions,
      ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
      listed: m.listed !== false,
      home,
      sections: [...(home && (listedBy.get(slug) ?? []).includes(home) ? [home] : []), ...(listedBy.get(slug) ?? []).filter((s) => s !== home)],
      tagPrefix: n.prefix,
      owners: m.owners,
      source: { file: n.file },
    };
  }
  for (const [slug, e] of notYet) {
    docSpaces[slug] = {
      displayName: e.displayName, family: groups.get(e.in)?.name ?? null, model: e.model, status: 'legacy', latest: null, editions: [],
      ...(e.formerNames ? { formerNames: e.formerNames } : {}), legacyUrl: e.legacyUrl,
      listed: true, home: null, sections: (listedBy.get(slug) ?? []), owners: { team: platformOwner },
    };
  }
  const productsMenu = [...groups.values()].map((g) => {
    const ids = nav.sections.filter((s) => s.in === g.id && composedSections[s.id]).map((s) => s.id);
    return { id: g.id, name: g.name, kind: g.kind, ...(g.description ? { description: g.description } : {}), sections: ids, entries: ids.flatMap((id) => composedSections[id].products.map((p) => ({ ...p, section: id }))) };
  });
  const manifest = {
    schemaVersion: 1,
    families: [...groups.values()].map((g) => g.name),
    docSpaces,
    sections: composedSections,
    productsMenu,
    environments: [...environments],
    // The inputs as read, so a PR can compose against this manifest.
    sources: { navigation: inputs.navigation, sections: inputs.sections, docSpaces: inputs.docSpaces },
  };
  return { manifest, issues };
}

export const errorsIn = (issues) => issues.filter((i) => i.level === 'error');
export const ownersOf = (issues) => [...new Set(issues.flatMap((i) => i.owners))].sort();

// One line per issue: level, code, the files it belongs to and their owners.
export function formatIssues(issues, { changed } = {}) {
  const rank = { error: 0, warning: 1, note: 2 };
  return [...issues].sort((a, b) => rank[a.level] - rank[b.level]).map((i) => {
    const mark = changed && i.level === 'error' && !i.files.some((f) => changed.has(f)) ? ' (not caused by this change)' : '';
    return `${i.level} [${i.code}] ${i.message}\n    in ${i.files.join(', ')}${i.owners.length ? ` (owners: ${i.owners.join(', ')})` : ''}${mark}`;
  }).join('\n');
}

// Composing on main: a failure keeps the last good manifest published, and
// both (all) owning teams are alerted. Releases that need a new manifest wait.
export function composeMain(inputs, { lastGood = null, now = new Date() } = {}) {
  const { manifest, issues } = compose(inputs, { base: lastGood, now });
  const errors = errorsIn(issues);
  if (errors.length) return { ok: false, manifest: lastGood, keptLastGood: Boolean(lastGood), issues, alert: ownersOf(errors) };
  return { ok: true, manifest: { ...manifest, composedAt: now.toISOString() }, keptLastGood: false, issues, alert: [] };
}

// A PR's inputs: the latest merged manifest's sources, with the PR's own files
// in their place. `local.navigation` (with `local.sections`) replaces the
// Platform navigation file and every section manifest; `local.repos` lists the
// repos whose Doc space manifests `local.docSpaces` replaces (all of them, so
// a removed Doc space counts as removed).
export function overlayInputs(sources, local = {}) {
  const repos = new Set((local.repos ?? []).map(lower));
  return {
    navigation: local.navigation ?? sources.navigation,
    sections: local.navigation ? local.sections ?? {} : sources.sections,
    docSpaces: [...(sources.docSpaces ?? []).filter((d) => !repos.has(lower(d.repo))), ...(local.docSpaces ?? [])],
    missingRepos: [],
  };
}

// The files a PR adds, removes or changes against the latest merged sources.
export function changedFiles(sources, inputs) {
  const key = (i) => JSON.stringify(i.error ?? i.data ?? null);
  const before = new Map([[sources.navigation.file, key(sources.navigation)], ...Object.values(sources.sections ?? {}).map((s) => [s.file, key(s)]), ...(sources.docSpaces ?? []).map((d) => [d.file, key(d)])]);
  const after = new Map([[inputs.navigation.file, key(inputs.navigation)], ...Object.values(inputs.sections ?? {}).map((s) => [s.file, key(s)]), ...(inputs.docSpaces ?? []).map((d) => [d.file, key(d)])]);
  const changed = new Set();
  for (const [f, v] of after) if (before.get(f) !== v) changed.add(f);
  for (const f of before.keys()) if (!after.has(f)) changed.add(f);
  return changed;
}

// The PR check: compose against the latest merged manifest. Every issue names
// its files and owners; the PR is blocked only by errors in files it changes.
export function composePr(base, local) {
  if (!base?.sources) throw new Error('The latest merged manifest has no "sources"; compose it on main first');
  const inputs = overlayInputs(base.sources, local);
  const changed = changedFiles(base.sources, inputs);
  const { manifest, issues } = compose(inputs, { base });
  const blocking = errorsIn(issues).filter((i) => i.files.some((f) => changed.has(f)));
  return { ok: blocking.length === 0, manifest, issues, changed, blocking, alert: ownersOf(blocking) };
}

// The local inputs of a PR, read from checkouts: the Platform's navigation/
// (a Platform PR), and/or one Content repo checkout (a Content repo PR), and/or
// a directory of Content repo checkouts (`contentDir`, named as the repos).
export function readPrInputs(base, { navigationDir, platformRoot = PLATFORM_ROOT, repo, repoDir, contentDir } = {}) {
  const local = { repos: [], docSpaces: [] };
  const navData = base.sources.navigation.data ?? {};
  const platformRepo = navData.platformRepo ?? 'wso2/docs-platform';
  if (navigationDir) {
    const { navigation, sections } = readNavigation(navigationDir, platformRepo);
    local.navigation = navigation;
    local.sections = sections;
    // The Platform's own Doc spaces are in the same PR.
    const nav = navigation.data ?? navData;
    for (const entry of (nav.contentRepos ?? []).filter((e) => lower(e.repo) === lower(platformRepo))) {
      local.repos.push(entry.repo);
      local.docSpaces.push(...readRepoDocSpaces(platformRoot, entry));
    }
  }
  if (contentDir) {
    const nav = local.navigation?.data ?? navData;
    for (const entry of (nav.contentRepos ?? []).filter((e) => lower(e.repo) !== lower(platformRepo))) {
      const checkout = path.join(contentDir, repoName(entry.repo));
      if (!fs.existsSync(checkout)) continue;
      local.repos.push(entry.repo);
      local.docSpaces.push(...readRepoDocSpaces(checkout, entry));
    }
  }
  if (repo) {
    if (!repoDir) throw new Error('--repo needs --repo-dir (the Content repo checkout)');
    const nav = local.navigation?.data ?? navData;
    const entry = (nav.contentRepos ?? []).find((e) => lower(e.repo) === lower(repo));
    if (!entry) throw new Error(`${repo} is not in navigation.yaml's contentRepos; the Platform team adds Content repos`);
    local.repos.push(entry.repo);
    local.docSpaces.push(...readRepoDocSpaces(repoDir, entry));
  }
  return local;
}

// The Deployment manifest from the default inputs, or an error naming every
// blocking problem. Readers (builds, the release CLI) use this.
export function composeOrThrow(options) {
  const { manifest, issues } = compose(readInputs(options));
  const errors = errorsIn(issues);
  if (errors.length) throw new Error(`The Deployment manifest does not compose (wso2-release compose):\n${formatIssues(errors)}`);
  return manifest;
}
