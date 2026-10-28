// The Content repo as the checks see it: pages and partials with their front
// matter, routes and (lazily) their MDX syntax tree, plus what changed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import matter from 'gray-matter';
import { createProcessor } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkDirective from 'remark-directive';
import { markerFromFrontMatter, pageShows } from '../edition.mjs';
import { baseFile, baseFiles, changedFiles, changedLines } from './git.mjs';
import { routeFor } from '../routes.mjs';

export { routeFor };

const require = createRequire(import.meta.url);
const { DEFAULT_MARKDOWN_CONFIG } = require('@docusaurus/core/lib/server/configValidation.js');
const preprocessContent = require('@docusaurus/mdx-loader/lib/preprocessor.js').default;

export const DOC_EXT = /\.mdx?$/;
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const parser = createProcessor({ format: 'mdx', remarkPlugins: [remarkGfm, remarkFrontmatter, remarkDirective] });

// Docusaurus's own preprocessing (heading IDs, admonition titles), which keeps
// line numbers.
export function preprocess(text, filePath) {
  return preprocessContent({ fileContent: text, filePath, markdownConfig: DEFAULT_MARKDOWN_CONFIG, admonitions: true });
}

export function parseMdx(text, filePath) {
  return parser.parse(preprocess(text, filePath));
}

// Docusaurus's URL for a doc file (relative to docs/), as pages.json writes
// it: no leading slash, a trailing slash, '' for the root (routeFor, in
// ../routes.mjs).
export const normalizeRoute = (p) => {
  const r = String(p ?? '').split('#')[0].replace(/^\/+|\/+$/g, '');
  return r ? `${r}/` : '';
};

const isPartial = (docRel) => docRel.split('/').some((s) => s.startsWith('_'));

// Pages and partials under docs/, and partials under partials/ (next to
// docs/, shared inside the Doc space).
const inPartials = (file) => file.startsWith('partials/');

function readDoc(root, file, text) {
  const docRel = inPartials(file) ? file : file.slice('docs/'.length);
  let fm = {};
  let fmError = null;
  try {
    fm = matter(text).data;
  } catch (err) {
    fmError = err.reason ?? err.message;
  }
  const partial = inPartials(file) || isPartial(docRel);
  return { file, docRel, text, fm, fmError, partial, route: partial ? null : routeFor(docRel, fm) };
}

function walk(dir, skip = () => false) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, skip));
    else out.push(p);
  }
  return out;
}

export function repoFiles(root) {
  const skip = (name) => ['.git', 'node_modules', 'build', '.docusaurus', '.cache'].includes(name);
  return walk(root, skip).map((f) => path.relative(root, f).split(path.sep).join('/'));
}

// Everything the checks share. `base` is { ref, label } or null.
export function loadContext({ repo, base }) {
  const root = repo.root;
  const files = repoFiles(root);
  const docs = files.filter((f) => (f.startsWith('docs/') || inPartials(f)) && DOC_EXT.test(f))
    .map((f) => readDoc(root, f, fs.readFileSync(path.join(root, f), 'utf8')));
  const changes = base ? changedFiles(root, base.ref) : files.map((f) => ({ path: f, status: 'A' }));
  const changed = new Map(changes.filter((c) => c.status !== 'D').map((c) => [c.path, c]));
  const lineCache = new Map();
  const astCache = new Map();
  const ctx = {
    root, repo, base, files, docs, changes, changed,
    pages: docs.filter((d) => !d.partial),
    partials: docs.filter((d) => d.partial),
    isChanged: (file) => changed.has(file),
    changedLines(file) {
      if (!lineCache.has(file)) lineCache.set(file, changed.has(file) ? changedLines(root, base?.ref, file) : new Set());
      return lineCache.get(file);
    },
    onChangedLine(file, line) {
      const lines = ctx.changedLines(file);
      return lines === 'all' || lines.has(line);
    },
    ast(doc) {
      if (!astCache.has(doc.file)) {
        let tree = null;
        try {
          tree = parseMdx(doc.text, path.join(root, doc.file));
        } catch {
          tree = null; // the compile check reports it
        }
        astCache.set(doc.file, tree);
      }
      return astCache.get(doc.file);
    },
    // The base's pages, for redirect coverage and marker diffs.
    baseDocs() {
      if (!base) return null;
      return baseFiles(root, base.ref, 'docs').filter((f) => DOC_EXT.test(f))
        .map((f) => readDoc(root, f, baseFile(root, base.ref, f) ?? ''));
    },
    baseText: (file) => baseFile(root, base?.ref, file),
  };
  return ctx;
}

// Routes of the pages one Edition builds. `newestRelease`: the Doc space's
// (lib/edition.mjs newestReleaseOf), for Cloud's Self-hosted additions.
export function editionRoutes(docs, edition, newestRelease = null) {
  const routes = new Map();
  for (const d of docs) {
    if (d.partial) continue;
    const marker = d.fmError ? null : markerFromFrontMatter(d.fm);
    try {
      if (marker && !pageShows(edition, d.fm, newestRelease)) continue;
    } catch {
      // an invalid marker is the front-matter check's finding
    }
    routes.set(d.route, d);
  }
  return routes;
}

// Line of a front-matter key (1-based), or 1.
export function keyLine(text, key) {
  const lines = text.split('\n');
  for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
    if (lines[i].startsWith(`${key}:`)) return i + 1;
  }
  return 1;
}

export function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}
