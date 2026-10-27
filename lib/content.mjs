// Reads a Content repo (docspace.yaml, editions.yaml, redirects.yaml, docs/)
// and works out what one Edition build needs from it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { modelOf } from './compose.mjs';
import { editionFromId, markerFromFrontMatter, matches, validateMarker } from './edition.mjs';

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
// of the build entirely, sidebar included.
export function excludedPages(repo, editionId) {
  const edition = editionFromId(editionId);
  const excluded = [];
  for (const file of listDocFiles(repo.docsDir)) {
    const rel = path.relative(repo.docsDir, file).split(path.sep).join('/');
    if (rel.split('/').some((seg) => seg.startsWith('_'))) continue;
    const { data } = matter(fs.readFileSync(file, 'utf8'));
    const marker = markerFromFrontMatter(data);
    if (!marker) continue;
    validateMarker(marker, rel);
    if (!matches(edition, marker)) excluded.push(rel);
  }
  return excluded;
}

// The Doc space's directory inside its git checkout ('' at the root), or
// null when it is not in a git checkout.
export function repoPathOf(root) {
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
// by `git ls-tree -r --name-only main`), else from git when the Content repo
// is a checkout with a main branch; null when unknown.
export function mainBranchFiles(repo, listFile) {
  const parse = (text) => new Set(text.split('\n').map((l) => l.trim()).filter(Boolean));
  if (listFile) return parse(fs.readFileSync(listFile, 'utf8'));
  const git = (...args) => execFileSync('git', ['-C', repo.root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  const dir = repoPathOf(repo.root);
  if (dir === null) return null;
  for (const ref of ['main', 'origin/main']) {
    // ls-tree paths are relative to the current directory: list from the top.
    try { return parse(git('ls-tree', '-r', '--full-tree', '--name-only', ref, '--', `${dir ? `${dir}/` : ''}docs`)); } catch { /* try the next ref */ }
  }
  return null;
}
