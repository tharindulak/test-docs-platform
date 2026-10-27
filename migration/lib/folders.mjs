// An MkDocs build that keeps every version as folders (wso2/docs-api-platform):
// one mkdocs.yml and one nav for the whole site, where each product's
// versions are nav sections over folders (ai-gateway/1.2.0/, ai-gateway/next/)
// and the Cloud docs are a section of their own (cloud/, with a sub-section
// per Cloud part). A Content repo branch reads a *view* of that site
// (Repo structure for Platform, sections and Doc spaces; Platform-by-platform
// walkthrough, rule 4):
//
// - `seed`: the nav section (a label path; [] for the whole nav) and folder
//   whose pages make up the branch. Its children become the top level that
//   the product's topLevel table re-files. `exclude` drops nav sections and
//   `excludeFolders` drops their files (the whole-site view of API Platform
//   Cloud leaves out every product's version folders); `splice` replaces a
//   section by its children (the Cloud entry's sections become top level).
// - `cloud` (a component's main line only): the component's Cloud
//   sub-section. A Cloud page whose name is also a seed page is the same page:
//   the seed's text is kept, its legacy URL maps to that page, and the pair
//   goes into the diff report for the team to decide by PR. Every other Cloud
//   page is added, marked Cloud only, where its nav section is (sections of
//   the same label merge).
// - `unlisted`: targets for pages that are in no nav (a version folder's
//   README.md is that version's landing page), by path inside the folder.
//
// Links that leave the view go to the Doc space that now holds the page
// (docs:<slug>/cloud/<page>/, from that directory's redirects.yaml on this
// branch) or else to the page on the legacy site, which stays up until its
// Doc space is converted.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { mkdocsUrl } from './mkdocs.mjs';
import { similarity, words } from './verify.mjs';

const posix = path.posix;
const norm = (src) => String(src).trim().replace(/^\.?\//, '');
const under = (src, folder) => !folder || src === folder || src.startsWith(`${folder.replace(/\/$/, '')}/`);
const sameLabel = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// The nav section at a label path ([] is the whole nav).
export function navSection(nav, labels) {
  let nodes = nav;
  for (const l of labels) {
    const hit = nodes.find((n) => n.kind === 'section' && sameLabel(n.label, l));
    if (!hit) throw new Error(`The nav has no section ${labels.join(' > ')} (missing "${l}")`);
    nodes = hit.children;
  }
  return nodes;
}

// A copy of a nav level without the excluded sections (absolute label paths)
// and with spliced sections replaced by their children.
function pruneNav(nodes, trail, { exclude = [], splice = [], keepPage = () => true }) {
  const out = [];
  const is = (list, p) => list.some((x) => x.length === p.length && x.every((l, i) => sameLabel(l, p[i])));
  for (const n of nodes) {
    const p = [...trail, n.label];
    if (n.kind === 'section') {
      if (is(exclude, p)) continue;
      const children = pruneNav(n.children, p, { exclude, splice, keepPage });
      if (is(splice, p)) out.push(...children);
      else if (children.length) out.push({ ...n, children });
    } else if (n.kind === 'page') {
      if (keepPage(norm(n.src))) out.push(n);
    } else out.push(n);
  }
  return out;
}

// Cloud nav merged into the seed nav: same-label sections merge, the rest is
// appended at its level.
function mergeNav(seed, extra) {
  const out = seed.map((n) => (n.kind === 'section' ? { ...n, children: [...n.children] } : n));
  for (const n of extra) {
    const same = n.kind === 'section' && out.find((m) => m.kind === 'section' && sameLabel(m.label, n.label));
    if (same) same.children = mergeNav(same.children, n.children);
    else out.push(n);
  }
  return out;
}

const NOT_A_NAME = /^(index|readme)$/i;
const baseName = (src) => posix.basename(src).replace(/\.md$/i, '');

// Pairs each Cloud page with the seed page of the same name: the same path
// inside its folder, else the one seed page with the same file name (index
// and README are no names). Each seed page pairs at most once; a file name
// shared by several pages on either side pairs nothing (reported as possible
// counterparts).
export function matchPages(seedRels, cloudRels) {
  const seedSet = new Set(seedRels);
  const taken = new Set();
  const matches = [];
  const rest = [];
  for (const c of cloudRels) {
    if (seedSet.has(c) && !taken.has(c)) {
      matches.push({ cloud: c, seed: c, how: 'same path' });
      taken.add(c);
    } else rest.push(c);
  }
  const byBase = (rels) => rels.reduce((m, r) => (NOT_A_NAME.test(baseName(r)) ? m : m.set(baseName(r), [...(m.get(baseName(r)) ?? []), r])), new Map());
  const seedByBase = byBase(seedRels.filter((r) => !taken.has(r)));
  const cloudByBase = byBase(rest);
  const unmatched = [];
  const ambiguous = [];
  for (const c of rest) {
    const b = baseName(c);
    const candidates = NOT_A_NAME.test(b) ? [] : seedByBase.get(b) ?? [];
    if (candidates.length === 1 && cloudByBase.get(b).length === 1) {
      matches.push({ cloud: c, seed: candidates[0], how: 'same file name' });
      taken.add(candidates[0]);
    } else {
      unmatched.push(c);
      if (candidates.length) ambiguous.push({ cloud: c, candidates });
    }
  }
  return { matches, unmatched, ambiguous };
}

// The view of one branch: its nav, its page files, the Cloud-only pages,
// aliases (a matched Cloud page's legacy path → the seed page) and the
// pairs for the diff report.
export function selectView({ nav, files, view }) {
  const seed = view.seed;
  const excluded = (src) => (seed.excludeFolders ?? []).some((f) => under(src, f));
  const inSeed = (src) => under(src, seed.folder) && !excluded(src);
  const seedFiles = files.filter(inSeed);
  let seedNav = pruneNav(navSection(nav, seed.nav ?? []), seed.nav ?? [], { exclude: seed.exclude, splice: seed.splice, keepPage: inSeed });
  const out = { cloudOnly: new Set(), aliases: [], matches: [], ambiguous: [], unlistedTargets: {} };
  const rel = (folder, src) => (folder ? src.slice(folder.replace(/\/$/, '').length + 1) : src);
  for (const [r, target] of Object.entries(seed.unlisted ?? {})) out.unlistedTargets[seed.folder ? `${seed.folder}/${r}` : r] = target;
  let pageFiles = seedFiles;
  if (view.cloud) {
    const c = view.cloud;
    const cloudFiles = files.filter((f) => under(f, c.folder));
    const m = matchPages(seedFiles.map((f) => rel(seed.folder, f)), cloudFiles.map((f) => rel(c.folder, f)));
    const full = (folder, r) => (folder ? `${folder}/${r}` : r);
    for (const x of m.matches) {
      const pair = { cloud: full(c.folder, x.cloud), seed: full(seed.folder, x.seed), how: x.how };
      out.matches.push(pair);
      out.aliases.push({ from: pair.cloud, to: pair.seed });
    }
    out.ambiguous = m.ambiguous.map((a) => ({ cloud: full(c.folder, a.cloud), candidates: a.candidates.map((x) => full(seed.folder, x)) }));
    for (const r of m.unmatched) out.cloudOnly.add(full(c.folder, r));
    for (const [r, target] of Object.entries(c.unlisted ?? {})) out.unlistedTargets[full(c.folder, r)] = target;
    const cloudNav = pruneNav(navSection(nav, c.nav), c.nav, { keepPage: (s) => out.cloudOnly.has(s) });
    seedNav = mergeNav(seedNav, cloudNav);
    pageFiles = [...seedFiles, ...out.cloudOnly].sort();
  }
  const folders = [seed.folder, view.cloud?.folder].filter((f) => f !== undefined && f !== null);
  out.inScope = (src) => {
    const s = norm(src);
    return (inSeed(s) || (view.cloud && under(s, view.cloud.folder)));
  };
  out.folders = folders;
  out.nav = seedNav;
  out.pageFiles = pageFiles;
  return out;
}

// The legacy redirects this branch's map covers: those from a path in the
// view, or to one.
export function scopeRedirects(redirects, inScope) {
  return redirects.filter((r) => {
    const to = String(r.to).replace('{{SITE_URL}}', '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
    return inScope(r.from.replace(/^\/+/, '')) || (!/^https?:/.test(r.to) && inScope(to.split('#')[0]));
  });
}

// Where a link that leaves the view goes. `siblings` are the other Doc space
// directories of this Content repo branch: [{ slug, edition, map: Map(legacy
// URL → page path) }].
export function outsideLinks({ files, redirectMap, legacyBase, siblings = [] }) {
  const fileSet = new Set(files);
  const find = (p, depth = 0) => {
    const key = p.replace(/\.md$/i, '').replace(/\/(index|README)$/i, '').replace(/^(index|README)$/i, '');
    const candidates = /\.md$/i.test(p) ? [p] : [`${p}.md`, p ? `${p}/index.md` : 'index.md', p ? `${p}/README.md` : 'README.md'];
    for (const c of candidates) if (fileSet.has(c)) return c;
    if (depth < 6) {
      for (const k of [key, `${key}/index`]) {
        const to = redirectMap.get(k);
        if (to && !/^https?:/.test(to)) return find(to.replace('{{SITE_URL}}', '').replace(/^\/+/, '').replace(/\/+$/, '').replace(/#.*$/, ''), depth + 1);
      }
    }
    return null;
  };
  return (site, anchor = '') => {
    let p = decodeURIComponent(site).replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/index\.html$/, '').replace(/\.html$/, '');
    p = posix.normalize(p || '.');
    if (p === '.') p = '';
    if (p.startsWith('../')) return null;
    const src = find(p);
    if (!src) return null;
    const legacy = `${legacyBase}${mkdocsUrl(src)}`;
    const hash = anchor ? `#${anchor}` : '';
    for (const s of siblings) {
      if (s.map.has(legacy)) {
        const to = s.map.get(legacy);
        if (/^https?:/.test(to)) return `${to}${hash}`;
        return { href: `docs:${s.slug}/${s.edition}/${to ? `${to.replace(/\/$/, '')}/` : ''}${hash}`, docSpace: s.slug };
      }
    }
    return { href: `${legacy}${hash}`, legacy: true };
  };
}

// The other Doc space directories of the repo (siblings of outDir), with the
// legacy maps their redirects.yaml hold on the repo's main line: a link goes
// to the sibling's Cloud pages as they are now, not to the copy a release
// branch was cut with. Outside a git checkout (convert.mjs --out <dir>), the
// files as they are.
export function siblingMaps(repoDir, ownDir, slugs, editionOf) {
  const out = [];
  const onMain = (rel) => {
    try {
      return execFileSync('git', ['-C', repoDir, 'show', `main:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch {
      return null;
    }
  };
  const read = (rel) => onMain(rel) ?? (fs.existsSync(path.join(repoDir, rel)) ? fs.readFileSync(path.join(repoDir, rel), 'utf8') : null);
  for (const slug of slugs) {
    if (slug === ownDir) continue;
    const file = read(`${slug}/redirects.yaml`);
    const ds = read(`${slug}/docspace.yaml`);
    if (!file || !ds) continue;
    const data = yaml.load(file) ?? {};
    const docspace = yaml.load(ds) ?? {};
    out.push({ slug, edition: editionOf(docspace), map: new Map((data.legacy ?? []).map((l) => [l.from, l.to])) });
  }
  return out;
}

// ---- The diff report: Cloud pages kept as their seed (main-line) page --------

const bodyOf = (file) => matter(fs.readFileSync(file, 'utf8')).content.replace(/^\s+/, '');

function unifiedDiff(a, b, labelA, labelB) {
  // Scratch files inside the run report's folder (regenerated every run).
  fs.mkdirSync(a.dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(a.dir, '.diff-'));
  try {
    const fa = path.join(tmp, 'a.md');
    const fb = path.join(tmp, 'b.md');
    fs.writeFileSync(fa, a.text);
    fs.writeFileSync(fb, b.text);
    try {
      execFileSync('git', ['diff', '--no-index', '--no-color', '-U2', fa, fb], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
      return '';
    } catch (err) {
      if (err.status !== 1) throw err;
      return String(err.stdout).split('\n').slice(4).join('\n')
        .replace(/^/, `--- ${labelA}\n+++ ${labelB}\n`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Writes <outDir>/.migration/cloud-diff.{md,json}: each Cloud page that has a
// main-line page of the same name, whether the two differ, and how.
export function writeDiffReport({ outDir, docsDir, legacyBase, view, pageTarget, sourceRef, displayName }) {
  const rows = [];
  for (const m of view.matches) {
    const cloud = bodyOf(path.join(docsDir, m.cloud));
    const seed = bodyOf(path.join(docsDir, m.seed));
    const s = similarity(words(seed), words(cloud));
    const diff = cloud === seed ? '' : unifiedDiff({ dir: path.join(outDir, '.migration'), text: seed }, { text: cloud }, `main line: ${m.seed}`, `Cloud: ${m.cloud}`);
    const lines = diff.split('\n');
    rows.push({
      cloud: m.cloud, seed: m.seed, how: m.how, page: pageTarget(m.seed),
      cloudUrl: `${legacyBase}${mkdocsUrl(m.cloud)}`, seedUrl: `${legacyBase}${mkdocsUrl(m.seed)}`,
      identical: !diff, f1: Number(s.f1.toFixed(3)),
      added: lines.filter((l) => /^\+(?!\+\+ )/.test(l)).length, removed: lines.filter((l) => /^-(?!-- )/.test(l)).length,
      diff,
    });
  }
  const differ = rows.filter((r) => !r.identical);
  const summary = {
    source: sourceRef, matched: rows.length, identical: rows.length - differ.length, differ: differ.length,
    cloudOnly: view.cloudOnly.size, possibleCounterparts: view.ambiguous.length,
  };
  const dir = path.join(outDir, '.migration');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cloud-diff.json'), `${JSON.stringify({ summary, pages: rows.map(({ diff, ...r }) => r), cloudOnly: [...view.cloudOnly], possibleCounterparts: view.ambiguous }, null, 2)}\n`);
  const md = [
    `# ${displayName}: Cloud pages against the main line`, '',
    `The main line is seeded from the newest Self-hosted line; pages found only in the Cloud sub-section are added and marked Cloud only (Platform-by-platform walkthrough, rule 4). A Cloud page with the same name as a main-line page is **not** added: the main line keeps its own text, and the Cloud page's legacy URL maps to it. This report lists those pairs so the team can decide each one by PR. Converted from \`${sourceRef}\`.`, '',
    `- Pairs: ${rows.length} (${summary.identical} identical, **${differ.length} differ**)`,
    `- Cloud-only pages added: ${view.cloudOnly.size}`,
    `- Cloud-only pages whose file name several pages share (possible counterparts, not paired): ${view.ambiguous.length}`, '',
    '| Cloud page (legacy) | Main-line page | Paired by | Word F1 | Lines +/− | |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| [${r.cloud}](${r.cloudUrl}) | \`docs/${r.page}.mdx\` (from ${r.seed}) | ${r.how} | ${r.f1.toFixed(3)} | ${r.identical ? '0' : `+${r.added} / −${r.removed}`} | ${r.identical ? 'identical' : '**differs**'} |`),
    '',
    ...(view.ambiguous.length ? ['## Possible counterparts (not paired)', '', ...view.ambiguous.map((a) => `- \`${a.cloud}\` (added as Cloud only); same file name as ${a.candidates.map((x) => `\`${x}\``).join(', ')}`), ''] : []),
    ...(differ.length ? ['## Differences', '', 'Each diff reads from the main-line text (`-`) to the Cloud text (`+`), front matter left out.', ''] : []),
    ...differ.flatMap((r) => [`### ${r.cloud}`, '', `Main-line page \`docs/${r.page}.mdx\`; word F1 ${r.f1.toFixed(3)}.`, '', '<details><summary>Diff</summary>', '', '```diff', r.diff.replace(/\n+$/, ''), '```', '', '</details>', '']),
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'cloud-diff.md'), md);
  return summary;
}
