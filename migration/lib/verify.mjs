// Checks for the migration's done criteria that need the built Edition:
// legacy URL coverage (every old nav URL, sitemap URL and redirect reaches a
// live page through redirects.yaml) and rendered-text parity against the
// live legacy site on a sample of pages.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { execFileSync } from 'node:child_process';
import { parse as parseHtml } from 'node-html-parser';
import { loadMkdocs, loadLegacyRedirects, mkdocsUrl, walkNav, redirectMaps } from './mkdocs.mjs';

// node-html-parser keeps <pre> as raw text by default; code text is wanted.
// A space before every tag keeps table cells and list items apart in the text.
const parse = (html) => parseHtml(html.replace(/<(?!\/?(?:a|b|i|em|strong|code|span|kbd|sup|sub|u)\b)/gi, ' <'), { blockTextElements: { script: true, noscript: true, style: true } });

// curl, not fetch: the legacy host's CDN rejects Node's fetch client.
function fetchPage(url, userAgent) {
  try {
    return execFileSync('curl', ['-sfL', '--max-time', '30', '-A', userAgent, url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return '';
  }
}

const loadPages = (buildDir) => JSON.parse(fs.readFileSync(path.join(buildDir, '_platform', 'pages.json'), 'utf8'));
const loadLegacyMap = (repoDir) => {
  const r = yaml.load(fs.readFileSync(path.join(repoDir, 'redirects.yaml'), 'utf8')) ?? {};
  return new Map((r.legacy ?? []).map((l) => [l.from, l.to]));
};
const pagePath = (to) => (to ? `${to.replace(/^\/|\/$/g, '')}/` : '');

// A source path in the checked Doc space's part of an MkDocs build that keeps
// every version as folders: under one of `scope`, under none of `exclude`
// (both folder prefixes; no scope means the whole site).
export const inScopeOf = (scope = [], exclude = []) => {
  const under = (p, f) => !f || p === f || p.startsWith(`${f.replace(/\/$/, '')}/`);
  return (src) => {
    const p = String(src).replace(/^\/+/, '');
    return (!scope.length || scope.some((f) => under(p, f))) && !exclude.some((f) => under(p, f));
  };
};

// `also`: other Doc spaces' redirects.yaml files on this branch; an old
// redirect they map counts as covered there (a redirect from this Doc
// space's old folder to a page that now lives in another Doc space).
// `mount`: where the Doc space's pages are inside the build, for a Cloud part
// built into its platform's Cloud tree ('identity-server/' in the
// identity-platform Cloud build); its redirects.yaml targets are relative to it.
export function coverage({ repoDir, buildDir, sourceRoot, legacyBase, sitemapXml, scope = [], exclude = [], also = [], mount = '' }) {
  const prefix = mount ? `${mount.replace(/^\/+|\/+$/g, '')}/` : '';
  const live = new Set(loadPages(buildDir).map((p) => p.path).filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)));
  const map = loadLegacyMap(repoDir);
  const elsewhere = new Map();
  for (const file of also) {
    for (const l of yaml.load(fs.readFileSync(file, 'utf8'))?.legacy ?? []) elsewhere.set(l.from, `${path.basename(path.dirname(file))}:${l.to}`);
  }
  const inScope = inScopeOf(scope, exclude);
  const mk = loadMkdocs(sourceRoot);
  const sources = { nav: new Set(), sitemap: new Set(), redirects: new Set() };
  for (const { node } of walkNav(mk.nav)) {
    if (node.kind === 'page' && inScope(node.src.trim())) sources.nav.add(`${legacyBase}${mkdocsUrl(node.src.trim())}`);
  }
  if (sitemapXml) {
    for (const m of sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const u = new URL(m[1]);
      const basePath = new URL(legacyBase).pathname;
      const rel = u.pathname.startsWith(basePath) ? u.pathname.slice(basePath.length) : u.pathname.replace(/^\/en\/[^/]+\//, '');
      if (inScope(rel)) sources.sitemap.add(`${legacyBase}${rel}`);
    }
  }
  // Old redirects: API Manager's redirects.yml, or the redirects plugin's redirect_maps.
  const old = fs.existsSync(path.join(sourceRoot, 'redirects.yml')) ? loadLegacyRedirects(sourceRoot) : redirectMaps(mk.config);
  for (const r of old) {
    const to = String(r.to).replace('{{SITE_URL}}', '').replace(/^\/+/, '').split('#')[0];
    if (inScope(r.from) || (!/^https?:/.test(r.to) && inScope(to))) sources.redirects.add(`${legacyBase}${mkdocsUrl(r.from.replace(/^\/+/, ''))}`);
  }
  const result = {};
  for (const [name, urls] of Object.entries(sources)) {
    const unmapped = [];
    const dead = [];
    const external = [];
    const home = [];
    const other = [];
    for (const u of urls) {
      if (!map.has(u) && elsewhere.has(u)) other.push(`${u} → ${elsewhere.get(u)}`);
      else if (!map.has(u)) unmapped.push(u);
      else if (/^https?:\/\//.test(map.get(u))) external.push(`${u} → ${map.get(u)}`);
      else if (!live.has(pagePath(map.get(u)))) dead.push(`${u} → ${map.get(u)}`);
      else if (!map.get(u)) home.push(u);
    }
    // `urls`: every legacy URL checked, so the same sets can be requested through the edge.
    result[name] = { total: urls.size, live: urls.size - unmapped.length - dead.length - external.length - other.length, toHome: home.length, unmapped, dead, external, ...(also.length ? { otherDocSpace: other } : {}), urls: [...urls].sort() };
  }
  return result;
}

// ---- Rendered-text parity --------------------------------------------------

export function legacyText(html) {
  // node-html-parser loses its way in the full legacy page; parse only the
  // content: the theme's <article>, or (complete-guide and SDK templates)
  // the content column up to the page footer.
  let slice = null;
  const start = html.indexOf('<article class="md-content__inner');
  const end = html.lastIndexOf('</article>');
  if (start >= 0 && end > start) slice = html.slice(start, end + '</article>'.length);
  else {
    const at = html.indexOf('class="md-content__inner');
    if (at < 0) return '';
    const from = html.lastIndexOf('<div', at);
    const stops = ['<footer', 'class="md-footer', 'class="md-source-file'].map((x) => html.indexOf(x, at)).filter((x) => x > 0);
    slice = `<article>${html.slice(from, stops.length ? Math.min(...stops) : html.length)}</article>`;
  }
  const article = parse(slice).querySelector('article');
  if (!article) return '';
  for (const sel of ['.headerlink', '.md-source-file', '.md-content__button', 'script', 'style', 'button', '.md-clipboard', '.md-feedback', 'nav', '.md-annotation__index']) {
    for (const el of article.querySelectorAll(sel)) el.remove();
  }
  return article.structuredText ?? article.textContent;
}

export function newText(html) {
  const root = parse(html);
  const md = root.querySelector('article .theme-doc-markdown') ?? root.querySelector('article');
  if (!md) return '';
  for (const sel of ['.hash-link', 'button', 'script', 'style', 'svg', '.theme-doc-version-badge', '.wso2-page-end', '.wso2-feedback', '.wso2-page-actions', '.wso2-notices']) {
    for (const el of md.querySelectorAll(sel)) el.remove();
  }
  // Docusaurus renders the front-matter title outside .theme-doc-markdown
  // when the H1 moved to front matter.
  const header = root.querySelector('article header h1');
  return `${header && !md.querySelector('h1') ? `${header.textContent}\n` : ''}${md.structuredText ?? md.textContent}`;
}

export const words = (text) => text
  .normalize('NFKC').toLowerCase()
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .match(/[a-z0-9]+/g) ?? [];

// Multiset overlap of words: recall (legacy words found in the new page),
// precision (new words found in the legacy page) and their F1.
export function similarity(a, b) {
  const count = (ws) => ws.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  let common = 0;
  for (const [w, n] of ca) common += Math.min(n, cb.get(w) ?? 0);
  const recall = a.length ? common / a.length : 1;
  const precision = b.length ? common / b.length : 1;
  const f1 = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  const diff = (x, y) => [...x].map(([w, n]) => [w, n - (y.get(w) ?? 0)]).filter(([, d]) => d > 0).sort((p, q) => q[1] - p[1]).slice(0, 12);
  return { recall, precision, f1, missing: diff(ca, cb), extra: diff(cb, ca), legacyWords: a.length, newWords: b.length };
}

export function samplePages(pages, n) {
  const sorted = [...pages].sort((a, b) => a.from.localeCompare(b.from));
  if (sorted.length <= n) return sorted;
  const step = sorted.length / n;
  return Array.from({ length: n }, (_, i) => sorted[Math.floor(i * step)]);
}

// The sample: `include` (legacy page paths), then the pages with the most
// Edition markers (where a marker mistake would show), then pages spread
// evenly over the rest.
function markerCounts(repoDir, buildPaths) {
  const counts = new Map();
  for (const p of buildPaths) {
    for (const f of [`${p.replace(/\/$/, '')}.mdx`, `${p}index.mdx`]) {
      const file = path.join(repoDir, 'docs', f);
      if (fs.existsSync(file)) { counts.set(p, (fs.readFileSync(file, 'utf8').match(/<Edition /g) ?? []).length); break; }
    }
  }
  return counts;
}

// `mount`: as for coverage, a Cloud part's pages inside its platform's Cloud tree build.
export async function parity({ repoDir, buildDir, sourceRoot, legacyBase, sample = 50, cacheDir, delayMs = 1500, threshold = 0.95, userAgent = 'wso2-docs-migration-parity-check', include = [], marked = 0, mount = '' }) {
  const prefix = mount ? `${mount.replace(/^\/+|\/+$/g, '')}/` : '';
  const map = loadLegacyMap(repoDir);
  const mk = loadMkdocs(sourceRoot);
  const navUrls = new Set();
  for (const { node } of walkNav(mk.nav)) if (node.kind === 'page') navUrls.add(`${legacyBase}${mkdocsUrl(node.src.trim())}`);
  // API reference pages render client-side on the legacy site (Redoc), so
  // there is no legacy text to compare; they are checked by the renderer.
  const apiPages = new Set(loadPages(buildDir).filter((p) => p.path.startsWith(`${prefix}reference/apis/`)).map((p) => p.path.slice(prefix.length)));
  const candidates = [...navUrls].filter((u) => map.has(u) && !apiPages.has(pagePath(map.get(u)))).map((from) => ({ from, to: map.get(from) }));
  const chosen = new Map();
  for (const inc of include) {
    const hit = candidates.find((c) => c.from === `${legacyBase}${inc.replace(/^\/+/, '')}`);
    if (hit) chosen.set(hit.from, { ...hit, why: 'included' });
  }
  if (marked) {
    const counts = markerCounts(repoDir, candidates.map((c) => pagePath(c.to)));
    for (const c of [...candidates].sort((a, b) => (counts.get(pagePath(b.to)) ?? 0) - (counts.get(pagePath(a.to)) ?? 0)).slice(0, marked)) {
      if (!chosen.has(c.from) && (counts.get(pagePath(c.to)) ?? 0) > 0) chosen.set(c.from, { ...c, why: `${counts.get(pagePath(c.to))} markers` });
    }
  }
  for (const c of samplePages(candidates.filter((x) => !chosen.has(x.from)), Math.max(0, sample - chosen.size))) chosen.set(c.from, { ...c, why: 'sample' });
  const picked = [...chosen.values()];
  fs.mkdirSync(cacheDir, { recursive: true });
  const results = [];
  for (const p of picked) {
    const cacheFile = path.join(cacheDir, `${encodeURIComponent(p.from)}.html`);
    let html;
    if (fs.existsSync(cacheFile)) html = fs.readFileSync(cacheFile, 'utf8');
    else {
      html = fetchPage(p.from, userAgent);
      if (html) fs.writeFileSync(cacheFile, html);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    const builtFile = path.join(buildDir, prefix, pagePath(p.to), 'index.html');
    const built = fs.existsSync(builtFile) ? fs.readFileSync(builtFile, 'utf8') : '';
    const s = similarity(words(legacyText(html)), words(newText(built)));
    results.push({ ...p, ...s, ok: s.f1 >= threshold, fetched: Boolean(html) });
  }
  return results;
}
