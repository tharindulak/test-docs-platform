// Finds API reference pages in a Content repo: pages with
// `layout: api-reference`, their folder routes, tag pages and the
// "Back to Reference" target. Shared by the remark step, the build plugin
// and the CLI.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { listDocFiles } from './content.mjs';

export const isApiPage = (fm) => fm?.layout === 'api-reference';

const posix = (p) => p.split(path.sep).join('/');
const frontMatter = (file) => matter(fs.readFileSync(file, 'utf8')).data;

// Route of the page's folder, relative to the Edition's base URL, e.g. "reference/apis/applications/".
export function apiFolder(docsDir, file) {
  const rel = posix(path.relative(docsDir, path.dirname(file)));
  return rel ? `${rel}/` : '';
}

// File name for a tag page. Docusaurus treats index, readme and a file named
// like its folder as the folder's index, so those names get a suffix.
export function tagPageName(dir, slugged) {
  const reserved = new Set(['index', 'readme', path.basename(dir).toLowerCase()]);
  return reserved.has(slugged) ? `${slugged}-operations` : slugged;
}

// Tag pages next to an API index: tag name -> page slug (file name without extension).
export function tagPages(dir) {
  const out = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!/\.mdx?$/.test(name) || name.startsWith('_') || /^index\.mdx?$/.test(name)) continue;
    const fm = frontMatter(path.join(dir, name));
    if (!isApiPage(fm) || fm.tag === undefined) continue;
    const base = name.replace(/\.mdx?$/, '');
    if (tagPageName(dir, base.toLowerCase()) !== base.toLowerCase()) {
      throw new Error(`${path.join(dir, name)}: a tag page can't be named like its folder (Docusaurus would make it the folder's index); rename it to ${tagPageName(dir, base.toLowerCase())}${path.extname(name)}`);
    }
    if (out.has(String(fm.tag))) throw new Error(`${dir}: two pages set tag: ${fm.tag}`);
    out.set(String(fm.tag), base);
  }
  return out;
}

// Front matter of the API folder's index page ({} if there is none).
export function indexFrontMatter(dir) {
  const index = ['index.mdx', 'index.md'].map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
  return index ? frontMatter(index) : {};
}

// The nearest ancestor folder with an index page, preferring one named
// "reference": the API page's "Back to Reference" link.
export function backLink(docsDir, file) {
  let dir = path.dirname(path.dirname(file));
  let fallback = null;
  while (dir.startsWith(docsDir)) {
    const index = ['index.mdx', 'index.md'].map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
    if (index) {
      const rel = posix(path.relative(docsDir, dir));
      const hit = { route: rel ? `${rel}/` : '', label: `Back to ${frontMatter(index).title ?? 'Reference'}` };
      if (path.basename(dir) === 'reference') return hit;
      fallback ??= hit;
    }
    if (dir === docsDir) break;
    dir = path.dirname(dir);
  }
  return fallback ?? { route: '', label: 'Back to Home' };
}

// Every API index page (no `tag:`) with its spec reference.
export function findApiPages(docsDir) {
  const pages = [];
  for (const file of listDocFiles(docsDir)) {
    const rel = posix(path.relative(docsDir, file));
    if (rel.split('/').some((seg) => seg.startsWith('_'))) continue;
    const fm = frontMatter(file);
    if (!isApiPage(fm) || fm.tag !== undefined) continue;
    pages.push({ file, rel, dir: path.dirname(file), folder: apiFolder(docsDir, file), spec: fm.spec, frontMatter: fm });
  }
  return pages;
}
