// Links inside Self-hosted additions shown in Cloud (Content per Edition):
// Cloud reads an addition as the newest release does, so its links may name
// something Cloud does not show: a page Cloud leaves out, or an anchor that
// only the page's Self-hosted form has (the Self-hosted form of a
// <Variants>). Such a link goes to the same page under /latest/, as a
// `docs:<slug>/latest/<route>#<anchor>` link that plugins/remark-docs-links.mjs
// then resolves, in the HTML and in the Markdown twin alike. Links Cloud
// resolves stay as they are, and so do links the newest release does not
// resolve either: those are broken, and the build reports them.
//
//   cloudLinkRewriter({ edition, vars, additions }) → (url, fromFile) => <docs: url> | null
//
// `additions` is lib/content.mjs additionsFor (newestRelease, vars, slug, docsDir).
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { createSlugger, parseMarkdownHeadingId } from '@docusaurus/utils';
import { toString } from 'mdast-util-to-string';
import { editionFromId, pageShows } from './edition.mjs';
import { routeFor } from './routes.mjs';
import { parseMdx } from './markdown-twin.mjs';
import remarkEdition from '../plugins/remark-edition.mjs';

const isJsx = (n) => n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement';
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// The ids a page's HTML has as one Edition renders it: its headings' ids as
// Docusaurus makes them (an explicit `{#id}`, else the slug of the heading's
// text, numbered when repeated), `id` attributes (<Anchor id>), and the ids of
// the partials it imports, each with its own numbering as Docusaurus compiles
// each partial on its own. `read` gives the Edition-filtered tree of a file.
export function anchorsOf(file, read, seen = new Set()) {
  const ids = new Set();
  if (seen.has(file) || !fs.existsSync(file)) return ids;
  seen.add(file);
  const tree = read(file, seen.size === 1);
  const slugs = createSlugger();
  const partials = [];
  const walk = (node) => {
    if (node.type === 'mdxjsEsm') {
      for (const m of node.value.matchAll(/from\s+['"](\.{1,2}\/[^'"]+\.mdx?)['"]/g)) partials.push(path.resolve(path.dirname(file), m[1]));
      return;
    }
    if (node.type === 'heading') {
      const text = toString(node.children.filter((c) => c.type !== 'html' && !isJsx(c)));
      ids.add(parseMarkdownHeadingId(text, 'classic').id ?? slugs.slug(text, { maintainCase: false }));
    }
    if (isJsx(node)) {
      const id = node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === 'id')?.value;
      if (typeof id === 'string') ids.add(id);
    }
    if (node.type === 'html') for (const m of node.value.matchAll(/\sid=["']([^"']+)["']/g)) ids.add(m[1]);
    for (const c of node.children ?? []) walk(c);
  };
  walk(tree);
  for (const p of partials) for (const id of anchorsOf(p, read, seen)) ids.add(id);
  return ids;
}

export function cloudLinkRewriter({ edition, vars, additions }) {
  if (!additions?.newestRelease || !additions.docsDir || !additions.slug) return () => null;
  const docsDir = path.resolve(additions.docsDir);
  const release = editionFromId(additions.newestRelease);
  const frontMatter = new Map();
  const fmOf = (file) => {
    if (!frontMatter.has(file)) frontMatter.set(file, matter(fs.readFileSync(file, 'utf8')).data);
    return frontMatter.get(file);
  };
  // The tree of a file as Cloud (with its additions) or the newest release
  // renders it. Links in it are left alone: no rewriting while reading.
  const reader = (opts) => (file, isPage) => {
    const { content, data } = matter(fs.readFileSync(file, 'utf8'));
    const tree = parseMdx(content);
    remarkEdition({ ...opts, showMarkers: false, substituteCode: false, cloudLinks: false })(tree, { path: file, data: { frontMatter: isPage ? data : {} } });
    return tree;
  };
  const readCloud = reader({ edition, vars, additions });
  const readRelease = reader({ edition: release, vars: additions.vars, additions: null });
  const cache = new Map();
  const ids = (file, which) => {
    const key = `${which}\0${file}\0${fs.statSync(file).mtimeMs}`;
    if (!cache.has(key)) cache.set(key, anchorsOf(file, which === 'cloud' ? readCloud : readRelease));
    return cache.get(key);
  };

  // The docs/ page a link names, the way Docusaurus resolves a Markdown
  // link: relative to the file it is in, else from docs/.
  const pageOf = (target, fromFile) => {
    for (const p of [path.resolve(path.dirname(fromFile), target), path.join(docsDir, target)]) {
      const rel = path.relative(docsDir, p);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      if (rel.split(path.sep).some((s) => s.startsWith('_'))) continue; // a partial is no page
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
    return null;
  };

  return (url, fromFile) => {
    if (typeof url !== 'string' || !fromFile || SCHEME.test(url) || url.startsWith('/')) return null;
    const i = url.indexOf('#');
    const target = decodeURIComponent(i < 0 ? url : url.slice(0, i));
    const hash = i < 0 ? '' : url.slice(i + 1);
    if (target === '' && !hash) return null;
    if (target !== '' && !/\.mdx?$/.test(target)) return null;
    // A same-page anchor names the page the link is in (not a partial).
    const file = target === '' ? pageOf(path.basename(fromFile), fromFile) : pageOf(target, fromFile);
    if (!file || (target === '' && path.resolve(file) !== path.resolve(fromFile))) return null;
    const fm = fmOf(file);
    const inCloud = pageShows(edition, fm, additions.newestRelease);
    if (inCloud && (!hash || ids(file, 'cloud').has(decodeURIComponent(hash)))) return null;
    if (!pageShows(release, fm) || (hash && !ids(file, 'release').has(decodeURIComponent(hash)))) return null;
    const route = routeFor(path.relative(docsDir, file).split(path.sep).join('/'), fm);
    return `docs:${additions.slug}/latest/${route}${hash ? `#${hash}` : ''}`;
  };
}
