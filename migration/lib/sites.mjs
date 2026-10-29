// Several MkDocs sites of one product as one Doc space, one audience group
// each (Extension points: audience groups; first Engineering Platform Cloud,
// whose developer and platform-engineer sites are two "perspectives" of one
// console). The product config's `sites` lists them:
//
//   sites: [{ root: 'developer-docs', folder: 'developers', label: 'For developers', legacyPath: '' },
//           { root: 'pe-docs', folder: 'platform-engineers', label: 'For platform engineers', legacyPath: 'platform-engineer/' }]
//
// The sites are not Edition contexts (the multi-tree mode merges same-path
// pages with <Edition> markers): each is a subtree. combineSites() writes one
// MkDocs project in a temporary directory whose docs/ links to each site's
// docs/ under its group folder, with one nav (Home, then one section per
// site, labelled with the group), the redirect maps prefixed, and an empty
// home page for the config's homeCards. The converter then reads it as one
// tree; siteResolver() maps between the combined source paths and each
// site's legacy URLs (legacyPath under the product's legacy base).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadMkdocs, mkdocsUrl, redirectMaps, excludeDocs } from './mkdocs.mjs';

const isUrl = (v) => /^[a-z]+:\/\//i.test(v);

// A site's nav with every page path under its group folder.
function prefixNav(items, folder) {
  return items.map((item) => {
    if (typeof item === 'string') return isUrl(item) ? item : `${folder}/${item.trim().replace(/^\.?\//, '')}`;
    const [label, value] = Object.entries(item)[0];
    if (Array.isArray(value)) return { [label]: prefixNav(value, folder) };
    return { [label]: isUrl(String(value)) ? value : `${folder}/${String(value).trim().replace(/^\.?\//, '')}` };
  });
}

export function combineSites(config, sourceRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wso2-docs-sites-${config.slug}-`));
  const docs = path.join(root, 'docs');
  fs.mkdirSync(docs);
  const nav = [{ Home: 'index.md' }];
  const redirects = {};
  const exclude = [];
  let first = null;
  for (const site of config.sites) {
    const mk = loadMkdocs(path.join(sourceRoot, site.root));
    first ??= mk;
    fs.symlinkSync(mk.docsDir, path.join(docs, site.folder), 'dir');
    nav.push({ [site.label]: prefixNav(mk.config.nav ?? [], site.folder) });
    for (const r of redirectMaps(mk.config)) redirects[`${site.folder}/${r.from.replace(/^\/+/, '')}`] = r.to;
    exclude.push(...excludeDocs(mk.config).map((e) => `${site.folder}/${e}`));
  }
  // The Doc space home: drawn from the config's homeCards (run.mjs).
  fs.writeFileSync(path.join(docs, 'index.md'), '---\ntemplate: sites-home\n---\n');
  const plugins = (first.config.plugins ?? []).map((p) => (p && typeof p === 'object' && p.redirects ? { redirects: { redirect_maps: redirects } } : p));
  const combined = {
    ...first.config,
    site_name: `${config.docspace.displayName} Documentation`,
    docs_dir: 'docs',
    nav,
    plugins,
    exclude_docs: exclude.join('\n'),
  };
  fs.writeFileSync(path.join(root, 'mkdocs.yml'), yaml.dump(combined, { lineWidth: -1 }));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function siteResolver(config) {
  const sites = config.sites;
  const ofSrc = (src) => sites.find((s) => src === s.folder || src.startsWith(`${s.folder}/`));
  // Legacy path prefixes, longest first; the site with legacyPath '' takes the rest.
  const prefixes = sites.flatMap((s) => [s.legacyPath ?? '', ...(s.legacyAliases ?? [])].filter(Boolean).map((p) => ({ p, s })))
    .sort((a, b) => b.p.length - a.p.length);
  const rootSite = sites.find((s) => !s.legacyPath);
  return {
    // The legacy URL path of a combined source page (under the legacy base);
    // null for the combined home, which had no legacy page of its own.
    legacyUrlOf(src) {
      const s = ofSrc(src);
      if (!s) return src === 'index.md' ? null : mkdocsUrl(src);
      return `${s.legacyPath ?? ''}${mkdocsUrl(src.slice(s.folder.length + 1))}`;
    },
    // A site path (a legacy URL path, or a combined source path) as a
    // combined source path. A path in no site's form belongs to the site at
    // the legacy base's root, or, given `fromSrc`, to that page's site (a
    // path relative to the page's own docs/).
    srcPath(p, fromSrc = null) {
      if (ofSrc(p)) return p;
      const hit = prefixes.find(({ p: pre }) => p === pre.replace(/\/$/, '') || p.startsWith(pre));
      if (hit) return `${hit.s.folder}/${p.slice(hit.p.length)}`.replace(/\/$/, '');
      const s = (fromSrc && ofSrc(fromSrc)) || rootSite;
      if (!s) return p;
      return p ? `${s.folder}/${p}` : s.folder;
    },
    // An asset's path without its group folder, so the sites share one copy
    // of the same file (copies differing in content are numbered).
    assetPath(p) {
      const s = ofSrc(p);
      return s ? p.slice(s.folder.length + 1) : p;
    },
  };
}
