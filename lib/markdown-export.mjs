// Exports one built Edition for AI tools (AI/LLM-friendly docs): the Markdown
// twin of every page, a joined `<folder>.md` for folders whose _category_.yml
// sets `customProps: { export: single }`, llms.txt and llms-full.txt, and
// _platform/markdown.json listing them. Runs after the HTML build
// (plugins/markdown-export.mjs) on the docs plugin's own page list and sidebar.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { apiPageInfo, apiTwinNodes } from './api-twin.mjs';
import { llmsFullTxt, llmsTxt } from './llms.mjs';
import {
  exportPageTree, fillVariables, frontMatterBlock, hasTitleHeading, printMarkdown, shiftHeadings,
} from './markdown-twin.mjs';
import { twinPath } from './twin-paths.mjs';
import { newestSuffix } from './switching.mjs';
import { isSelfHostedAddition, markerFromFrontMatter } from './edition.mjs';

const ROOT_INDEX = 'https://docs.wso2.com/llms.txt';
const posix = (p) => p.split(path.sep).join('/');
const heading = (depth, value) => ({ type: 'heading', depth, children: [{ type: 'text', value }] });

// Folders that export as one file: { 'guides' → { label, description } }.
export function singleExportFolders(docsDir) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
      const sub = path.join(dir, e.name);
      const meta = ['_category_.yml', '_category_.yaml', '_category_.json'].map((n) => path.join(sub, n)).find((f) => fs.existsSync(f));
      if (meta) {
        const data = yaml.load(fs.readFileSync(meta, 'utf8')) ?? {};
        if (data.export !== undefined) throw new Error(`${posix(path.relative(docsDir, meta))}: write export under customProps (customProps: { export: single }); Docusaurus rejects unknown keys`);
        if (data.customProps?.export === 'single') out.set(posix(path.relative(docsDir, sub)), { label: data.label ?? e.name, description: data.description ?? null });
        else if (data.customProps?.export !== undefined) throw new Error(`${posix(path.relative(docsDir, meta))}: customProps.export must be "single"`);
      }
      walk(sub);
    }
  };
  walk(docsDir);
  return out;
}

// Doc ids in sidebar order, and the sidebar as nested groups for llms.txt.
function sidebarOrder(sidebar = []) {
  const ids = [];
  const walk = (items) => {
    for (const it of items) {
      if (it.type === 'doc' || it.type === 'ref') ids.push(it.id);
      else if (it.type === 'category') {
        if (it.link?.type === 'doc') ids.push(it.link.id);
        walk(it.items ?? []);
      }
    }
  };
  walk(sidebar);
  return [...new Set(ids)];
}

// Matches a page's Markdown images, in order, to the <img> tags its HTML build
// emitted: by alt text, then by file name (emitted names are <name>-<hash>).
// Small images are inlined as data: URIs and keep no name, so an image left
// unmatched takes the next unused inlined one with the same alt text. Returns
// the image URL, null for an inlined image (only its alt text is kept), or the
// URL unchanged when nothing matches (the twin check then reports it).
export function imageMatcher(html, siteUrl) {
  const article = /<article[^]*<\/article>/.exec(html)?.[0] ?? '';
  const imgs = [...article.matchAll(/<img\s[^>]*>/g)].map((m) => ({
    src: /\ssrc="([^"]*)"/.exec(m[0])?.[1] ?? '',
    alt: (/\salt="([^"]*)"/.exec(m[0])?.[1] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    used: false,
  }));
  return (url, alt) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url;
    const stem = path.parse(url.split(/[?#]/)[0]).name;
    const hit = imgs.find((i) => !i.used && alt && i.alt === alt)
      ?? imgs.find((i) => !i.used && path.basename(i.src).startsWith(stem))
      ?? imgs.find((i) => !i.used && i.src.startsWith('data:') && i.alt === (alt ?? ''));
    if (!hit) return url;
    hit.used = true;
    if (hit.src.startsWith('data:')) return null;
    return /^https?:/.test(hit.src) ? hit.src : `${siteUrl}${hit.src}`;
  };
}

export function exportEdition(o) {
  const {
    siteDir, outDir, docsDir, version, siteUrl, baseUrl, edition, vars, policy, linkHost, additions = null,
    docSpaceName, editionName, asLatest = false, canonical = (rel) => `${siteUrl}${baseUrl}${rel}`, cloudParts = [],
  } = o;
  const pageUrl = (rel) => `${siteUrl}${baseUrl}${rel}`;
  // The /latest/ twin names its Edition as the chrome does.
  const latestMark = newestSuffix(policy?.docSpaces?.[o.docSpace]);
  const singles = singleExportFolders(docsDir);
  // A Self-hosted-only page shown in Cloud: its newest release's variables,
  // and `**Self-hosted only.**` in front of its llms.txt entry.
  const isAddition = (d) => {
    const m = additions ? markerFromFrontMatter(d.frontMatter ?? {}) : null;
    return Boolean(m && isSelfHostedAddition(edition, m, additions.newestRelease));
  };
  const varsOf = (d) => (isAddition(d) ? additions.vars : vars);
  const docs = version.docs.map((d) => {
    const permalink = d.permalink.endsWith('/') ? d.permalink : `${d.permalink}/`;
    const file = path.resolve(siteDir, d.source.replace(/^@site\//, ''));
    return { ...d, file, rel: permalink.slice(baseUrl.length), dir: posix(path.relative(docsDir, path.dirname(file))) };
  });
  const bySource = new Map(docs.map((d) => [d.file, d]));
  const byRoute = new Map(docs.map((d) => [d.rel, d]));
  const sidebar = o.sidebar ?? version.sidebars?.[Object.keys(version.sidebars ?? {})[0]] ?? [];
  const order = sidebarOrder(sidebar);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const inSidebar = order.map((id) => byId.get(id)).filter(Boolean);
  const others = docs.filter((d) => !order.includes(d.id)).sort((a, b) => a.rel.localeCompare(b.rel));
  const ordered = [...inSidebar, ...others];

  // A joined guide takes <folder>.md; the folder's own index page moves to <folder>/index.md.
  const twinOf = (rel) => {
    const p = twinPath(rel);
    const folder = rel.replace(/\/$/, '');
    return singles.has(folder) && byRoute.has(rel) && p === `${folder}.md` ? `${folder}/index.md` : p;
  };
  const twinUrl = (rel) => pageUrl(twinOf(rel));

  // Links in another deployment: the same rule against that deployment's base path.
  const otherTwin = (pathname) => {
    const segs = pathname.split('/').filter(Boolean);
    const space = policy.docSpaces?.[segs[0]];
    if (!space || !pathname.endsWith('/')) return null;
    const baseSegs = space.model === 'unversioned' ? 1 : 2;
    if (segs.length < baseSegs) return null;
    return `/${segs.slice(0, baseSegs).join('/')}/${twinPath(segs.slice(baseSegs).join('/'))}`;
  };
  const docsOrigins = new Set([siteUrl, linkHost].filter(Boolean).map((u) => new URL(u).origin));

  // Linked files (a PDF, a JAR) are emitted by the HTML build under
  // assets/files/ with a content hash in the name.
  const filesOf = (doc) => {
    const htmlFile = path.join(outDir, doc.rel, 'index.html');
    const html = fs.existsSync(htmlFile) ? fs.readFileSync(htmlFile, 'utf8') : '';
    return [...html.matchAll(/\shref="([^"]*\/assets\/files\/[^"]+)"/g)].map((m) => m[1].replace(/\/$/, ''));
  };
  const linkResolver = (doc) => (url, sourceFile = doc.file) => {
    const file = !/^[a-z][a-z0-9+.-]*:/i.test(url ?? '') && /\.(?!mdx?$)[a-z0-9]+$/i.test((url ?? '').split(/[?#]/)[0]) ? path.parse(url.split(/[?#]/)[0]) : null;
    if (file) {
      const hit = filesOf(doc).find((h) => path.basename(h).startsWith(`${file.name}-`) && h.endsWith(file.ext));
      if (hit) return /^https?:/.test(hit) ? hit : `${siteUrl}${hit}`;
    }
    if (!url || url.startsWith('#') || /^(mailto|tel):/i.test(url)) return url;
    const hashAt = url.indexOf('#');
    const pathPart = hashAt === -1 ? url : url.slice(0, hashAt);
    const hash = hashAt === -1 ? '' : url.slice(hashAt);
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      const u = new URL(url);
      if (!docsOrigins.has(u.origin)) return url;
      if (u.pathname.startsWith(baseUrl) && byRoute.has(u.pathname.slice(baseUrl.length))) return `${twinUrl(u.pathname.slice(baseUrl.length))}${u.hash}`;
      const other = otherTwin(u.pathname);
      return other ? `${siteUrl}${other}${u.hash}` : url;
    }
    if (/\.mdx?$/i.test(pathPart)) {
      const target = bySource.get(path.resolve(path.dirname(sourceFile), decodeURI(pathPart)));
      return target ? `${twinUrl(target.rel)}${hash}` : url;
    }
    let abs = pathPart.startsWith('/') ? pathPart : new URL(pathPart || './', `https://x${baseUrl}${doc.rel}`).pathname;
    if (!abs.startsWith(baseUrl)) abs = `${baseUrl}${abs.replace(/^\//, '')}`;
    const rel = abs.slice(baseUrl.length);
    const route = rel === '' || rel.endsWith('/') ? rel : `${rel}/`;
    if (byRoute.has(route) && !/\.[a-z0-9]+$/i.test(rel)) return `${twinUrl(route)}${hash}`;
    return `${siteUrl}${abs}${hash}`;
  };

  // Images point at the files the HTML build emitted (content-hashed names).
  const imageResolver = (doc) => {
    const htmlFile = path.join(outDir, doc.rel, 'index.html');
    return imageMatcher(fs.existsSync(htmlFile) ? fs.readFileSync(htmlFile, 'utf8') : '', siteUrl);
  };

  const siblings = (doc) => () => {
    const dir = doc.dir;
    const parentOf = (d) => (d.dir.includes('/') ? d.dir.slice(0, d.dir.lastIndexOf('/')) : '');
    return ordered
      .filter((d) => d !== doc && !d.unlisted && (d.dir === dir || (d.dir !== '' && parentOf(d) === dir && /^index\.mdx?$/.test(path.basename(d.file)))))
      .map((d) => ({ url: twinUrl(d.rel), title: fillVariables(d.title, varsOf(d)), description: fillVariables(d.frontMatter.description ?? d.description, varsOf(d)) }));
  };

  const opts = { edition, vars, policy, linkHost, siteDir, docsDir, additions };
  const files = [];
  const apis = [];
  const bodies = new Map();
  const write = (rel, content, entry) => {
    const file = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    files.push({ path: rel, ...entry });
  };

  for (const doc of ordered) {
    const title = fillVariables(doc.title, varsOf(doc));
    const description = fillVariables(doc.frontMatter.description ?? doc.description, varsOf(doc));
    const tree = exportPageTree(doc.file, opts, { resolveLink: linkResolver(doc), resolveImage: imageResolver(doc), siblingPages: siblings(doc) });
    const api = apiPageInfo(doc.file, doc.frontMatter, { docsDir, editionKind: edition.kind });
    if (api) {
      // The YAML itself is copied into the build by plugins/api-reference.mjs.
      tree.children.push(...apiTwinNodes(api, { pageUrl, ownRoute: doc.rel }));
      if (api.tag === null) apis.push({ title, description, path: `${api.folderRoute}openapi.yaml` });
    }
    if (!hasTitleHeading(tree)) tree.children.unshift(heading(1, title));
    const body = printMarkdown(tree);
    bodies.set(doc, { tree, body });
    const fm = frontMatterBlock({
      title, description, docSpace: o.docSpace, edition: edition.id, editionName: asLatest ? `${editionName}${latestMark}` : editionName,
      url: pageUrl(doc.rel), canonical: canonical(doc.rel, { selfHosted: isAddition(doc) }), type: doc.frontMatter.type,
    });
    write(twinOf(doc.rel), `${fm}\n${body}`, { page: doc.rel, title, kind: api ? 'api' : 'page' });
  }

  // Joined guides: the folder's pages in sidebar order under the folder's label.
  const guides = new Map();
  for (const [folder, meta] of singles) {
    const pages = ordered.filter((d) => (d.dir === folder || d.dir.startsWith(`${folder}/`)) && !d.unlisted);
    if (!pages.length) continue;
    const label = fillVariables(meta.label, vars);
    const children = [heading(1, label)];
    if (meta.description) children.push({ type: 'paragraph', children: [{ type: 'text', value: meta.description }] });
    for (const d of pages) {
      const tree = structuredClone(bodies.get(d).tree);
      shiftHeadings(tree, 1);
      children.push(...tree.children);
    }
    const rel = `${folder}.md`;
    const indexDoc = byRoute.get(`${folder}/`);
    const fm = frontMatterBlock({
      title: label, description: meta.description, docSpace: o.docSpace, edition: edition.id,
      editionName: asLatest ? `${editionName}${latestMark}` : editionName,
      url: indexDoc ? pageUrl(indexDoc.rel) : undefined, pages: pages.map((d) => pageUrl(d.rel)),
    });
    write(rel, `${fm}\n${printMarkdown({ type: 'root', children })}`, { title: label, kind: 'guide' });
    guides.set(folder, { title: label, url: pageUrl(rel), description: meta.description });
  }

  // llms.txt: the sidebar skeleton, with `.md` links and front-matter descriptions.
  const entry = (d, indent = 0) => {
    const description = fillVariables(d.frontMatter.description ?? d.description, varsOf(d));
    const label = isAddition(d) ? `**Self-hosted only.**${description ? ` ${description}` : ''}` : description;
    return { title: fillVariables(d.title, varsOf(d)), url: twinUrl(d.rel), description: label, indent };
  };
  const folderOf = (cat) => {
    const ids = sidebarOrder([cat]);
    const dirs = ids.map((id) => byId.get(id)?.dir).filter((x) => x !== undefined);
    if (!dirs.length) return null;
    let common = dirs[0].split('/');
    for (const dir of dirs) {
      const s = dir.split('/');
      let i = 0;
      while (i < common.length && common[i] === s[i]) i++;
      common = common.slice(0, i);
    }
    return common.join('/');
  };
  const listed = new Set();
  const itemEntries = (items, indent) => items.flatMap((it) => {
    if (it.type === 'doc' || it.type === 'ref') {
      const d = byId.get(it.id);
      if (!d || d.unlisted || listed.has(d)) return [];
      listed.add(d);
      return [entry(d, indent)];
    }
    return it.type === 'category' ? categoryEntries(it, indent, false) : [];
  });
  // A top-level category is a section; a nested one is a line with its pages under it.
  const categoryEntries = (cat, indent, top) => {
    const out = [];
    const link = cat.link?.type === 'doc' ? byId.get(cat.link.id) : null;
    const guide = guides.get(folderOf(cat));
    const inner = top ? indent : indent + 1;
    if (link) listed.add(link);
    if (link) out.push(entry(link, indent));
    else if (!top) out.push({ title: cat.label, url: null, indent });
    if (guide) out.push({ title: `${guide.title}: all pages in one file`, url: guide.url, description: guide.description, indent: inner });
    out.push(...itemEntries(cat.items ?? [], inner));
    return out;
  };
  const sections = [{ heading: 'Overview', entries: [] }];
  for (const it of sidebar) {
    // A Cloud part's group in a family Cloud tree has its own llms.txt (Cloud parts, below).
    if (it.type === 'category' && it.customProps?.cloudPart && cloudParts.length) continue;
    if (it.type === 'category') sections.push({ heading: it.label, entries: categoryEntries(it, 0, true) });
    else sections[0].entries.push(...itemEntries([it], 0));
  }
  if (cloudParts.length) sections.push({ heading: 'Cloud parts', entries: cloudParts.map((p) => ({ title: `${p.title} (its own page index)`, url: p.url, indent: 0 })) });
  sections.push({ heading: 'Other pages', entries: others.filter((d) => !d.unlisted && !listed.has(d)).map((d) => entry(d)) });
  sections.push({ heading: 'OpenAPI definitions', entries: apis.map((a) => ({ title: `${a.title} (OpenAPI YAML)`, url: pageUrl(a.path), description: a.description })) });

  const shownName = asLatest ? `${editionName}${latestMark}` : editionName;
  const summary = `Documentation for ${shownName}, part of WSO2 Docs. Each link is a page's Markdown twin; ${pageUrl('llms-full.txt')} has every page in one file.`;
  write('llms.txt', llmsTxt({
    title: `${docSpaceName}: ${shownName}`,
    summary,
    details: [`Other products and Editions: ${ROOT_INDEX}`],
    sections,
  }), { kind: 'llms' });
  write('llms-full.txt', llmsFullTxt({
    title: `${docSpaceName}: ${shownName}`,
    summary: `Every page of ${shownName} in sidebar order. Page index: ${pageUrl('llms.txt')}`,
    pages: ordered.filter((d) => !d.unlisted).map((d) => ({ url: pageUrl(d.rel), markdown: bodies.get(d).body })),
  }), { kind: 'llms' });

  const manifest = { files: files.filter((f) => f.kind !== 'llms'), apis };
  fs.mkdirSync(path.join(outDir, '_platform'), { recursive: true });
  fs.writeFileSync(path.join(outDir, '_platform', 'markdown.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
