// After each Docs deployment build, writes the Platform's outputs to _platform/
// (page list, compiled redirects, search records, edition metadata), rewrites
// canonical URLs per the SEO rules, and writes a sitemap of the pages whose
// canonical is themselves.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';

const text = (el) => (el?.textContent ?? '').replace(/​/g, '').replace(/\s+/g, ' ').trim();

export function canonicalFor(rel, o) {
  const self = `${o.siteUrl}${o.baseUrl}${rel}`;
  const latest = (p) => `${o.siteUrl}/${o.docSpace}/latest/${p}`;
  if (o.asLatest || o.editionId === 'cloud' || !o.latestEditionId) return self;
  if (o.editionId === o.latestEditionId) return latest(rel);
  const moved = o.latestRedirects?.[rel] ?? rel;
  return o.latestPages?.has(moved) ? latest(moved) : self;
}

// Whose page a route is: a Cloud part's pages in a family Cloud tree (or a
// part built on its own) are the component's Cloud ("Identity Server Cloud"),
// the rest the deployment's own Doc space's.
export function recordOwner(rel, o) {
  if (o.cloudPartOf) return { docSpace: o.docSpace, lvl0: o.editionName ?? `${o.docSpaceName} Cloud`, cloudIn: o.cloudPartOf };
  const part = (o.parts ?? []).find((p) => rel.startsWith(p.path));
  if (part) return { docSpace: part.docSpace, lvl0: part.editionName, cloudIn: o.docSpace };
  return { docSpace: o.docSpace, lvl0: o.docSpaceName };
}

const CATALOG_ITEM = 'li.wso2-layout-catalog__item';

export function searchRecords(root, url, o, owner = { docSpace: o.docSpace, lvl0: o.docSpaceName }) {
  const title = text(root.querySelector('article h1')) || text(root.querySelector('title'));
  const records = [];
  const base = { docSpace: owner.docSpace, edition: o.editionId, kind: o.editionKind, ...(owner.cloudIn ? { cloudIn: owner.cloudIn } : {}) };
  let section = { lvl2: null, lvl3: null, anchor: '' };
  let buffer = [];
  const flush = () => {
    if (!buffer.length && section.lvl2 === null) return;
    records.push({
      url: `${url}${section.anchor ? `#${section.anchor}` : ''}`,
      hierarchy: { lvl0: owner.lvl0, lvl1: title, lvl2: section.lvl2, lvl3: section.lvl3 },
      content: buffer.join(' ').slice(0, 2000),
      ...base,
      type: 'page',
    });
    buffer = [];
  };
  // One record per catalog item (its anchor is #catalog-<id>), so a search
  // lands on one connector: its name, then its description, links, category
  // and tags. Its text is not repeated in the section's record.
  const item = (el) => {
    const name = text(el.querySelector('strong')) || text(el.querySelector('a'));
    const words = el.querySelectorAll('p').map(text).filter((t) => t && t !== name);
    const extra = [el.getAttribute('data-category-label'), el.getAttribute('data-tags')].filter(Boolean);
    records.push({
      url: `${url}#${el.id}`,
      hierarchy: { lvl0: owner.lvl0, lvl1: title, lvl2: section.lvl2 ?? name, lvl3: section.lvl2 ? name : null },
      content: [...words, ...extra].join(' ').slice(0, 2000),
      ...base,
      type: 'catalog-item',
    });
  };
  const body = root.querySelector('.theme-doc-markdown');
  if (!body) return records;
  for (const el of body.querySelectorAll('h2, h3, p, li, td, pre')) {
    if (el.closest('[data-wso2-chrome]')) continue; // Platform notices and feedback, not page content
    if (el.closest('[data-search-exclude]')) continue; // controls, such as a catalog's search box
    if (el.closest('nav')) continue; // page-level navigation, e.g. an API page's own nav
    const inItem = el.closest(CATALOG_ITEM);
    if (inItem) {
      if (inItem === el && el.id) item(el);
      continue;
    }
    if (el.tagName === 'H2' || el.tagName === 'H3') {
      flush();
      section = el.tagName === 'H2'
        ? { lvl2: text(el), lvl3: null, anchor: el.id }
        : { ...section, lvl3: text(el), anchor: el.id };
    } else if (!el.closest('li li')) {
      buffer.push(text(el));
    }
  }
  flush();
  return records;
}

// One Doc space's redirects.yaml against the base path its pages live at:
// the deployment's, or a Cloud part's /<platform>/cloud/<part>/ in a family
// Cloud tree (its page moves and legacy maps follow it there).
export function compileRedirects(redirects, o) {
  const out = [];
  const target = (to) => {
    if (/^https?:\/\//.test(to ?? '')) return to; // legacy redirects that leave WSO2 Docs
    const p = String(to ?? '').replace(/^\/|\/$/g, '');
    return p ? `${o.baseUrl}${p}/` : o.baseUrl;
  };
  for (const m of redirects.moves ?? []) {
    out.push({ from: target(m.from), to: target(m.to), status: 301 });
  }
  const legacy = redirects.legacy ?? [];
  for (const l of legacy) {
    out.push({ from: l.from, to: target(l.to), status: 301 });
  }
  // The legacy MkDocs sites also serve their newest version at /en/latest/.
  // The latest twin answers those URLs too, so they follow `latest` when the
  // policy moves it (the pinned Edition keeps its own /en/<version>/ URLs).
  if (o.asLatest && o.editionId) {
    const own = new Set(legacy.map((l) => l.from));
    for (const from of legacyLatestAliases(legacy.map((l) => l.from), o.editionId)) {
      if (own.has(from.alias)) continue;
      own.add(from.alias);
      out.push({ from: from.alias, to: target(legacy[from.index].to), status: 301 });
    }
  }
  return out;
}

// https://<host>/en/<version>/<page> → https://<host>/en/latest/<page>, for
// the legacy URLs of this Edition's version.
export function legacyLatestAliases(froms, version) {
  const prefix = new RegExp(`^(https?://[^/]+/en/)${version.replace(/\./g, '\\.')}/`);
  const out = [];
  froms.forEach((f, index) => {
    if (prefix.test(f)) out.push({ alias: f.replace(prefix, '$1latest/'), index });
  });
  return out;
}

export default function platformOutputs(context, o) {
  return {
    name: 'wso2-platform-outputs',
    async postBuild({ outDir, routesPaths }) {
      const pages = [];
      const allRecords = [];
      const selfCanonical = new Set();
      for (const route of routesPaths) {
        if (!route.startsWith(o.baseUrl)) continue;
        const rel = route.slice(o.baseUrl.length);
        if (rel.endsWith('.html') || rel.startsWith('search')) continue;
        const htmlFile = path.join(outDir, rel, 'index.html');
        if (!fs.existsSync(htmlFile)) continue;
        let html = fs.readFileSync(htmlFile, 'utf8');
        const url = `${o.siteUrl}${route}`;
        const canonical = canonicalFor(rel, o);
        html = html
          .replace(/(<link[^>]*rel="canonical"[^>]*href=")[^"]*(")/, `$1${canonical}$2`)
          .replace(/(<meta[^>]*property="og:url"[^>]*content=")[^"]*(")/, `$1${canonical}$2`);
        fs.writeFileSync(htmlFile, html);
        if (canonical === url) selfCanonical.add(url);
        const root = parse(html);
        // Anchors let other Doc spaces' `docs:` links be checked down to the heading.
        const anchors = [...new Set(root.querySelectorAll('.theme-doc-markdown [id]').map((el) => el.id).filter(Boolean))];
        pages.push({ path: rel, title: text(root.querySelector('article h1')) || text(root.querySelector('title')), canonical, anchors });
        allRecords.push(...searchRecords(root, url, o, recordOwner(rel, o)));
      }

      // The Platform writes the sitemap itself (the classic preset's sitemap
      // plugin is off): only pages whose canonical is themselves are listed.
      const urls = [...selfCanonical].sort().map((u) => `<url><loc>${u}</loc></url>`).join('');
      fs.writeFileSync(
        path.join(outDir, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`,
      );

      const dir = path.join(outDir, '_platform');
      fs.mkdirSync(dir, { recursive: true });
      const write = (name, data) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
      const parts = o.parts ?? [];
      write('edition.json', {
        docSpace: o.docSpace, edition: o.editionId, kind: o.editionKind, asLatest: o.asLatest,
        baseUrl: o.baseUrl, builtAt: new Date().toISOString(), platformVersion: o.platformVersion,
        // A family Cloud tree: its Cloud parts and the one commit they came from.
        ...(parts.length ? { parts: parts.map((p) => ({ docSpace: p.docSpace, path: p.path, editionName: p.editionName })), source: o.source ?? null } : {}),
        ...(o.cloudPartOf ? { cloudPartOf: o.cloudPartOf } : {}),
        // A preview build with markers shown (PR previews): never released (lib/release.mjs checkBuild).
        ...(o.showMarkers ? { showMarkers: true } : {}),
      });
      write('pages.json', pages.sort((a, b) => a.path.localeCompare(b.path)));
      write('redirects.json', [
        ...compileRedirects(o.redirects, o),
        ...parts.flatMap((p) => compileRedirects(p.redirects ?? {}, { ...o, baseUrl: p.baseUrl, asLatest: false })),
      ]);
      write('search-records.json', allRecords);
    },
  };
}
