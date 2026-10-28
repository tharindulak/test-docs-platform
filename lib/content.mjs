// Reads a Content repo (docspace.yaml, editions.yaml, redirects.yaml, docs/)
// and works out what one Edition build needs from it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { modelOf } from './compose.mjs';
import { editionFromId, markerFromFrontMatter, newestReleaseOf, pageShows, validateMarker } from './edition.mjs';
import { counterpartRoute, routeFor } from './routes.mjs';
import { editionName } from './switching.mjs';
import { parseMdx } from './markdown-twin.mjs';

function readYaml(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${file}`);
  }
  // Core schema: dates and the like stay plain text, as in the manifests.
  return yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.CORE_SCHEMA }) ?? fallback;
}

export function loadContentRepo(dir) {
  const root = path.resolve(dir);
  const docspace = readYaml(path.join(root, 'docspace.yaml'));
  // A Doc space manifest in the new layout leaves the model to its Editions.
  if (!docspace.model && (docspace.schemaVersion || docspace.editions)) docspace.model = modelOf(docspace.editions);
  for (const key of ['slug', 'displayName', 'model']) {
    if (!docspace[key]) throw new Error(`docspace.yaml: "${key}" is required`);
  }
  const editions = readYaml(path.join(root, 'editions.yaml'), {});
  const redirects = readYaml(path.join(root, 'redirects.yaml'), {});
  return { root, docsDir: path.join(root, 'docs'), partialsDir: path.join(root, 'partials'), docspace, editions, redirects };
}

// Variables for one edition: the cloud: or self-hosted: block of editions.yaml,
// plus the edition id and version, which the Platform injects.
export function editionVariables(repo, edition) {
  const block = repo.editions[edition.kind] ?? {};
  const version = edition.version ?? edition.id;
  const vars = {};
  for (const [k, v] of Object.entries(block)) {
    vars[k] = typeof v === 'string' ? v.replaceAll('{version}', version) : v;
  }
  vars.id = edition.id;
  vars.version = version;
  if (edition.unversioned) vars.displayName ??= repo.docspace.displayName;
  vars.displayName ??= edition.kind === 'cloud' ? `${repo.docspace.displayName} Cloud` : `${repo.docspace.displayName} ${version}`;
  return vars;
}

export function listDocFiles(docsDir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.mdx?$/.test(entry.name)) out.push(p);
    }
  };
  walk(docsDir);
  return out;
}

// Pages whose front matter limits them to other editions; they are left out
// of the build entirely, sidebar included. Cloud keeps Self-hosted-only pages
// (Self-hosted additions) unless they name a Cloud counterpart.
export function excludedPages(repo, editionId) {
  const edition = editionFromId(editionId);
  const newest = newestReleaseOf(repo.docspace);
  const excluded = [];
  for (const file of listDocFiles(repo.docsDir)) {
    const rel = path.relative(repo.docsDir, file).split(path.sep).join('/');
    if (rel.split('/').some((seg) => seg.startsWith('_'))) continue;
    const { data } = matter(fs.readFileSync(file, 'utf8'));
    const marker = markerFromFrontMatter(data);
    if (!marker) continue;
    validateMarker(marker, rel);
    if (!pageShows(edition, data, newest)) excluded.push(rel);
  }
  return excluded;
}

// What Cloud needs to show a Doc space's Self-hosted additions: its newest
// release, that release's name and `self-hosted:` variables (with
// {edition.version} the newest release), and where its pages are under
// /latest/. Null for a Self-hosted Edition, an unversioned Doc space and a
// Doc space without Self-hosted Editions (a family Cloud). Each Cloud part
// gets its own, from its own Doc space manifest.
export function additionsFor(repo, edition) {
  const newest = newestReleaseOf(repo.docspace);
  if (edition.kind !== 'cloud' || edition.unversioned || !newest) return null;
  const release = editionFromId(newest);
  return {
    newestRelease: newest,
    name: editionName(repo.docspace, newest),
    vars: editionVariables(repo, release),
    latest: `/${repo.docspace.slug}/latest/`,
  };
}

// Self-hosted-only pages that name their Cloud counterpart: { <route>:
// <counterpart route> }, routes as pages.json writes them. The version
// dropdown maps the two pages to each other.
export function cloudCounterparts(repo) {
  const out = {};
  for (const file of listDocFiles(repo.docsDir)) {
    const rel = path.relative(repo.docsDir, file).split(path.sep).join('/');
    if (rel.split('/').some((seg) => seg.startsWith('_'))) continue;
    const { data } = matter(fs.readFileSync(file, 'utf8'));
    if (typeof data.cloudCounterpart !== 'string') continue;
    out[routeFor(rel, data)] = counterpartRoute(data.cloudCounterpart);
  }
  return out;
}

// Whether Cloud shows Cloud-only content on a page (the Cloud notice's
// "newest features" claim, Chrome and version switching): the page is
// `editions: cloud`, or it or a partial it imports holds an <Edition
// only="cloud"> block outside Self-hosted-only content (the Cloud form of a
// <Variants> included). A Self-hosted-only page never does.
export function showsCloudOnlyContent(file, seen = new Set()) {
  if (seen.has(file) || !fs.existsSync(file)) return false;
  seen.add(file);
  const { data, content } = matter(fs.readFileSync(file, 'utf8'));
  const marker = seen.size === 1 ? markerFromFrontMatter(data) : null;
  if (marker?.only) return marker.only === 'cloud';
  let tree;
  try {
    tree = parseMdx(content);
  } catch {
    return false; // the compile check reports it
  }
  const attrOf = (node, name) => node.attributes?.find((a) => a.name === name)?.value;
  const partials = [];
  const walk = (node) => {
    if (node.type === 'mdxjsEsm') {
      for (const m of node.value.matchAll(/from\s+['"](\.{1,2}\/[^'"]+\.mdx?)['"]/g)) partials.push(path.resolve(path.dirname(file), m[1]));
      return false;
    }
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === 'Edition') {
      if (attrOf(node, 'only') === 'cloud') return true;
      if (attrOf(node, 'only') === 'self-hosted') return false;
    }
    return (node.children ?? []).some(walk);
  };
  return walk(tree) || partials.some((p) => showsCloudOnlyContent(p, seen));
}

// The bundle a Doc space directory was unpacked from, when it was (Releases
// and deployments, Docs bundles): the nearest bundle.json above it that names
// this directory as its Doc space's or one of its Cloud parts'. A release
// build reads the repo path, the files on main and the source commit from
// it, never from git: the unpacked folder has no git, or sits inside another
// checkout. { bundle, top (the unpacked folder), path (this directory's
// path in the repo) } or null.
// A build asks once per page, so the answer is kept per directory (an
// unpacked bundle never changes).
const bundles = new Map();
export function bundleOf(dir) {
  const root = path.resolve(dir);
  if (!bundles.has(root)) bundles.set(root, findBundle(root));
  return bundles.get(root);
}

function findBundle(root) {
  let at = path.dirname(root);
  for (let i = 0; i < 6; i++) {
    const file = path.join(at, 'bundle.json');
    if (fs.existsSync(file)) {
      let bundle = null;
      try {
        bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        bundle = null;
      }
      const dirs = bundle?.schema === 1 ? [{ slug: bundle.docSpace, path: bundle.path ?? '' }, ...(bundle.parts ?? [])] : [];
      const hit = dirs.find((d) => path.join(at, ...String(d.path || d.slug).split('/')) === root);
      if (hit) return { bundle, top: at, path: hit.path ?? '' };
    }
    const up = path.dirname(at);
    if (up === at) break;
    at = up;
  }
  return null;
}

// The Doc space's directory inside its git checkout ('' at the root), or
// null when it is not in a git checkout. From bundle.json in an unpacked
// bundle.
export function repoPathOf(root) {
  const b = bundleOf(root);
  if (b) return b.path;
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.relative(path.resolve(top), path.resolve(root)).split(path.sep).join('/');
  } catch {
    return null;
  }
}

// Files on the Content repo's main branch, for "Edit this page" (fixes go to
// main first): repo paths, so a Doc space in a subdirectory gives
// `<dir>/docs/...`. From a listing file (one repo path per line, as printed
// by `git ls-tree -r --name-only main`), else bundle.json's list in an
// unpacked bundle, else from git when the Content repo is a checkout with a
// main branch; null when unknown.
export function mainBranchFiles(repo, listFile) {
  const parse = (text) => new Set(text.split('\n').map((l) => l.trim()).filter(Boolean));
  if (listFile) return parse(fs.readFileSync(listFile, 'utf8'));
  const b = bundleOf(repo.root);
  if (b) return Array.isArray(b.bundle.mainFiles) ? new Set(b.bundle.mainFiles) : null;
  const git = (...args) => execFileSync('git', ['-C', repo.root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  const dir = repoPathOf(repo.root);
  if (dir === null) return null;
  for (const ref of ['main', 'origin/main']) {
    // ls-tree paths are relative to the current directory: list from the top.
    try { return parse(git('ls-tree', '-r', '--full-tree', '--name-only', ref, '--', `${dir ? `${dir}/` : ''}docs`)); } catch { /* try the next ref */ }
  }
  return null;
}
