// Works out where every MkDocs page lands in the Content repo. Only the old
// nav's top level is re-filed into the sidebar skeleton (product config);
// below it each nav section becomes a folder, named after the source folder
// its pages share, so the folder-generated sidebar reproduces the old nav.
// Nav order becomes sidebar_position.
import path from 'node:path/posix';
import { fileSlug, sentenceCase } from './slug.mjs';
import { mkdocsUrl } from './mkdocs.mjs';

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '');

function commonDir(srcs) {
  if (!srcs.length) return null;
  const parts = srcs.map((s) => dirOf(s).split('/').filter(Boolean));
  const out = [];
  for (let i = 0; ; i++) {
    const seg = parts[0][i];
    if (seg === undefined || parts.some((p) => p[i] !== seg)) break;
    out.push(seg);
  }
  return out.join('/');
}

function pagesUnder(node) {
  if (node.kind === 'page') return [normalizeSrc(node.src)];
  if (node.kind !== 'section') return [];
  return node.children.flatMap(pagesUnder);
}

export const normalizeSrc = (src) => src.trim().replace(/^\.?\//, '');

// URL of a Content repo doc (path without extension), as Docusaurus routes it:
// index, readme and a doc named like its folder stand for the folder.
export function docUrl(target) {
  const dir = dirOf(target);
  const base = target.slice(target.lastIndexOf('/') + 1);
  if (/^(index|readme)$/i.test(base) || (dir && base === dir.slice(dir.lastIndexOf('/') + 1))) {
    return dir ? `${dir}/` : '';
  }
  return `${target}/`;
}

export function planLayout({ nav, files, config, isApiPage = () => false, apiSlug = (s) => baseOf(s), unlistedTargets = null }) {
  const fileSet = new Set(files);
  const pages = new Map(); // src → page
  const categories = new Map(); // folder → { label, position, navLabel }
  const issues = [];
  const counters = new Map();
  const names = new Map(); // folder → Set of names taken (pages and subfolders)
  const urls = new Map(); // url → src, to catch two pages on one route

  const nextPos = (folder) => {
    const n = (counters.get(folder) ?? 0) + 1;
    counters.set(folder, n);
    return n;
  };
  const taken = (folder) => {
    if (!names.has(folder)) names.set(folder, new Set());
    return names.get(folder);
  };
  const claim = (folder, wanted, fallback) => {
    const set = taken(folder);
    for (const name of [wanted, fallback]) {
      if (name && !set.has(name)) {
        set.add(name);
        return name;
      }
    }
    let i = 2;
    while (set.has(`${wanted}-${i}`)) i++;
    set.add(`${wanted}-${i}`);
    return `${wanted}-${i}`;
  };
  const label = (l) => (l ? sentenceCase(l, config.properNouns) : null);
  const ensureFolders = (folder) => {
    // Register every parent folder name so later pages don't collide with it.
    const segs = folder.split('/');
    for (let i = 1; i <= segs.length; i++) taken(segs.slice(0, i - 1).join('/')).add(segs[i - 1]);
  };

  const addPage = (src, target, { navLabel, position, inNav, kind = 'page', navPath = [] }) => {
    const url = docUrl(target);
    if (urls.has(url)) {
      issues.push({ kind: 'layout', src, message: `would share the route /${url} with ${urls.get(url)}; renamed` });
      target = `${target}-${baseOf(src)}`;
    }
    urls.set(docUrl(target), src);
    pages.set(src, {
      src, target, url: docUrl(target), oldUrl: mkdocsUrl(src),
      navLabel: navLabel ?? null, sidebarLabel: label(navLabel), position, inNav, kind, navPath,
    });
  };

  const placePage = (node, folder, position, navPath) => {
    const src = normalizeSrc(node.src);
    if (pages.has(src)) {
      issues.push({ kind: 'nav', src, message: `listed in the nav more than once; only the first entry (${pages.get(src).navPath.join(' > ')}) is kept` });
      return;
    }
    if (!fileSet.has(src)) {
      issues.push({ kind: 'nav', src, message: `nav entry "${node.label}" points to a missing file` });
      return;
    }
    if (config.pageOverrides?.[src]) {
      const target = config.pageOverrides[src];
      ensureFolders(dirOf(target));
      taken(dirOf(target)).add(baseOf(target));
      addPage(src, target, { navLabel: node.label, position: nextPos(dirOf(target)), inNav: true, navPath });
      return;
    }
    if (isApiPage(src)) {
      const slug = fileSlug(apiSlug(src));
      const folder = config.apiFolder ?? 'reference/apis';
      ensureFolders(folder);
      const name = claim(folder, slug);
      const pos = nextPos(folder);
      categories.set(`${folder}/${name}`, { label: label(node.label), position: pos, navLabel: node.label, api: true });
      addPage(src, `${folder}/${name}/index`, { navLabel: node.label, position: pos, inNav: true, kind: 'api', navPath });
      return;
    }
    const name = claim(folder, fileSlugKeep(baseOf(src)), fileSlugKeep(`${baseOf(dirOf(src))}-${baseOf(src)}`));
    addPage(src, folder ? `${folder}/${name}` : name, { navLabel: node.label, position, inNav: true, navPath });
  };

  const sectionSources = new Map(); // folder → source dir it stands for

  const placeSection = (section, folder, srcDir, navPath) => {
    for (const child of section.children) {
      const childPath = [...navPath, child.label ?? ''];
      if (child.kind === 'link') {
        issues.push({ kind: 'nav', message: `external nav link "${child.label}" → ${child.url} dropped (folder sidebars hold pages only)` });
        continue;
      }
      if (child.kind === 'page') {
        // A nav entry for a missing file is reported by placePage; only real files can be API pages.
        const src = normalizeSrc(child.src);
        placePage(child, folder, fileSet.has(src) && isApiPage(src) ? null : nextPos(folder), childPath);
        continue;
      }
      const srcs = pagesUnder(child).filter((s) => fileSet.has(s));
      if (!srcs.length) {
        issues.push({ kind: 'nav', message: `nav section "${childPath.join(' > ')}" has no pages; dropped` });
        continue;
      }
      // A section holding only API pages adds no folder: the APIs sit in the
      // API folder side by side.
      if (srcs.every((s) => isApiPage(s))) {
        placeSection(child, folder, srcDir, childPath);
        continue;
      }
      const override = config.sectionFolders?.[childPath.join(' > ')];
      const c = commonDir(srcs);
      const inside = srcDir === '' ? c !== '' : c.startsWith(`${srcDir}/`);
      let childFolder;
      if (override) {
        childFolder = override;
        ensureFolders(childFolder);
      } else {
        const wanted = inside ? baseOf(c) : fileSlug(child.label);
        childFolder = `${folder}/${claim(folder, wanted, fileSlug(child.label))}`;
      }
      // A section re-filed into a skeleton folder keeps the skeleton's label and place.
      if (!categories.get(childFolder)?.skeleton) categories.set(childFolder, { label: label(child.label), position: nextPos(folder), navLabel: child.label });
      sectionSources.set(childFolder, inside ? c : srcDir);
      placeSection(child, childFolder, inside ? c : srcDir, childPath);
    }
  };

  config.skeleton.forEach((s, i) => categories.set(s.folder, { label: s.label, position: s.position ?? i + 1, navLabel: null, skeleton: true }));

  for (const node of nav) {
    const top = config.topLevel[node.label];
    if (!top) throw new Error(`Top-level nav item "${node.label}" has no entry in the product's topLevel table`);
    if (node.kind === 'page') {
      const src = normalizeSrc(node.src);
      if (top.ordered) {
        // A top-level page filed into a skeleton folder, in nav order there.
        ensureFolders(dirOf(top.page));
        taken(dirOf(top.page)).add(baseOf(top.page));
        addPage(src, top.page, { navLabel: node.label, position: nextPos(dirOf(top.page)), inNav: true, navPath: [node.label] });
        continue;
      }
      addPage(src, top.page, { navLabel: node.label, position: 0, inNav: true, navPath: [node.label] });
      taken('').add(top.page);
      continue;
    }
    const srcs = pagesUnder(node).filter((s) => fileSet.has(s));
    const c = commonDir(srcs) ?? '';
    ensureFolders(top.folder);
    const parent = dirOf(top.folder);
    if (parent) {
      // A re-filed section inside a skeleton folder (guides/api-security).
      categories.set(top.folder, { label: label(node.label), position: nextPos(parent), navLabel: node.label });
    }
    if (top.folder) sectionSources.set(top.folder, c); // the root (Home) holds no unlisted pages
    placeSection(node, top.folder, c, [node.label]);
  }

  // Pages that are not in the nav: next to the section whose source folder
  // is the longest prefix of theirs, keeping the rest of their path.
  const isFragment = (src) => (config.fragments ?? []).some((f) => src.startsWith(f));
  const isExcluded = (src) => (config.excluded ?? []).some((f) => src === f || src.startsWith(f));
  const bySource = [...sectionSources.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const src of files) {
    if (pages.has(src) || isFragment(src) || isExcluded(src)) continue;
    if (unlistedTargets?.[src]) {
      const target = unlistedTargets[src];
      ensureFolders(dirOf(target));
      taken(dirOf(target)).add(baseOf(target));
      addPage(src, target, { navLabel: null, position: null, inNav: false, navPath: ['(not in nav)'] });
      continue;
    }
    if (isApiPage(src)) {
      placePage({ src, label: null }, '', null, ['(not in nav)']);
      pages.get(src).inNav = false;
      continue;
    }
    const dir = dirOf(src);
    const hit = bySource.find(([, d]) => d === '' || dir === d || dir.startsWith(`${d}/`));
    const folder = hit ? hit[0] : config.unlistedFolder ?? 'reference';
    let rest = hit && hit[1] ? dir.slice(hit[1].length).replace(/^\//, '') : dir;
    // A section that stands for the docs root: don't repeat its folder name (get-started/get-started/).
    if (hit && !hit[1] && (rest === baseOf(folder) || rest.startsWith(`${baseOf(folder)}/`))) rest = rest.slice(baseOf(folder).length).replace(/^\//, '');
    const targetDir = [folder, rest].filter(Boolean).join('/');
    ensureFolders(targetDir);
    const name = claim(targetDir, fileSlugKeep(baseOf(src)), fileSlugKeep(`${baseOf(dir)}-${baseOf(src)}`));
    addPage(src, `${targetDir}/${name}`, { navLabel: null, position: null, inNav: false, navPath: ['(not in nav)'] });
  }
  // Sentence case is only applied to labels; record which changed.
  return { pages, categories, issues };
}

// Keep a source file name when it is already a valid kebab-case slug, so
// URLs stay recognisable; otherwise slug it.
function fileSlugKeep(name) {
  return /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(name) && !/^\d+[-_.]/.test(name) ? name : fileSlug(name);
}
