// One converter run: MkDocs source trees in, one Doc space directory of a
// Content repo branch out (Repo structure for Platform, sections and Doc
// spaces): docs/, partials/, assets/ (with cloud/ and self-hosted/ for
// Edition-only files), redirects.yaml, docspace.yaml (the full Doc space
// manifest) and editions.yaml, plus a run report in .migration/ of
// everything that needs a person. sync.mjs writes the repo root.
//
// A product with one source tree (API Manager) converts one version per run.
// A product whose pages come from several trees (docs-is: the Identity
// Platform tree and an Identity Server version tree, both built from shared
// includes) renders every page in each Edition context of the branch and
// writes it once, with <Edition> markers where the contexts differ
// (variants.mjs); pages of one tree only get `editions:` front matter.
// Re-runnable: the output tree is regenerated from scratch every time.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { loadMkdocs, listMarkdown, loadLegacyRedirects, mkdocsUrl, redirectMaps, excludeDocs } from './mkdocs.mjs';
import { planLayout, docUrl } from './layout.mjs';
import { PageConverter, headingPlainText } from './markdown.mjs';
import { mkdocsSlug, fileSlug } from './slug.mjs';
import { pascalCase } from './mdx.mjs';
import { compileCheck } from './compile.mjs';
import { expandIncludes, tokenize, parse, evalExpr, printValue, truthyValue, JinjaTables, JinjaError } from './jinja.mjs';
import { Regions, makeScope, renderFlat, renderStructured, mergeTexts, markersToJsx, markerFor, markerAttrs, filterLines } from './variants.mjs';
import { checkEditions } from './pagecheck.mjs';
import { fixSpec } from './specs.mjs';
import { loadOverrides, SourceOverrides } from './overrides.mjs';
import { selectView, scopeRedirects, outsideLinks, siblingMaps, writeDiffReport } from './folders.mjs';
import { editionForBranch } from '../../lib/content-repo.mjs';
import { groupByTag, collectOperations, schemaAnchor } from '../../lib/openapi.mjs';
import { editionFromId } from '../../lib/edition.mjs';
import { productCards } from './overview.mjs';

const posix = path.posix;

// Prism languages the Platform site can highlight (prism-react-renderer's
// bundle plus the Platform's additionalLanguages).
export const KNOWN_LANGUAGES = new Set(`text plain markup html xml svg mathml regex clike javascript css yaml markdown
graphql sql typescript jsx tsx swift kotlin c objectivec reason rust go cpp python json bash shell java toml properties
docker ini http groovy powershell csharp nginx batch hcl rego log diff scala php ruby protobuf`.split(/\s+/));

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;
const SINGLE = 'main';
// Partials live next to docs/ (shared within the Doc space only).
const isPartialFile = (file) => file.startsWith('partials/');
// An asset link before the asset's final folder is known (see placeAssets):
// a plain relative URL, so Markdown, JSX strings and the Edition check treat
// it as the link it becomes.
const ASSET_TOKEN = /__wso2asset_(\d+)__/g;
// Front matter whose description is the legacy page's own (not generated).
const KEPT_DESCRIPTION = Symbol('kept description');

export class Report {
  constructor() {
    this.items = [];
  }

  add(kind, file, message, detail) {
    this.items.push(detail ? { kind, file, message, detail } : { kind, file, message });
  }

  // Outstanding items by kind; items the override list accepts are not outstanding.
  byKind() {
    const out = {};
    for (const i of this.items) if (!i.accepted) out[i.kind] = (out[i.kind] ?? 0) + 1;
    return out;
  }
}

function relLink(fromFile, toFile) {
  let r = posix.relative(posix.dirname(fromFile), toFile);
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
}

export function generatedDescription(body, title) {
  for (const raw of body.split('\n\n')) {
    const block = raw.trim();
    if (!block || /^(#|import |<|:::|```|~~~|\||[-*+] |\d+\. |>|\{\/\*|!\[)/.test(block)) continue;
    // Code spans keep their text (placeholders such as <API-M_HOME> included).
    const codes = [];
    const protectedBlock = block.replace(/\n/g, ' ').replace(/(`+)(.+?)\1/g, (_, f, c) => `\u0005${codes.push(c.trim()) - 1}\u0005`);
    let text = headingPlainText(protectedBlock).replace(/\\([^\w\s])/g, '$1').replace(/\u0005(\d+)\u0005/g, (_, n) => codes[n]).replace(/\s+/g, ' ').trim();
    text = text.replace(/\{edition\.(\w+)\}/g, '').trim();
    if (text.length < 20) continue;
    const sentence = /^(.{19,159}?[.!?])(\s|$)/.exec(text);
    if (sentence) return sentence[1];
    if (text.length <= 160) return text;
    return `${text.slice(0, 157).replace(/\s+\S*$/, '')}…`;
  }
  return title ? `${title}.` : '';
}

// ---- Source trees --------------------------------------------------------------

function loadTree(t, config, sourceRoot, overrides) {
  const root = path.resolve(sourceRoot, t.root ?? '.');
  const mk = loadMkdocs(root);
  const docsDir = mk.docsDir;
  const files = listMarkdown(docsDir);
  // An MkDocs build with every version as folders: this branch reads one
  // view of the site (folders.mjs).
  const view = t.view ? selectView({ nav: mk.nav, files, view: t.view }) : null;
  // features.json: flags reach templates as config keys; pages of flags that
  // are off are left out (as the legacy hooks do).
  const flags = {};
  const flaggedOff = new Set();
  if (t.features) {
    const features = JSON.parse(fs.readFileSync(path.resolve(sourceRoot, t.features), 'utf8'));
    for (const [name, f] of Object.entries(features)) {
      flags[name] = t.allFeaturesOn ? true : Boolean(f.enabled);
      if (!flags[name]) for (const p of f.page ?? []) flaggedOff.add(p);
    }
  }
  const excluded = new Set(excludeDocs(mk.config));
  const pageFiles = (view ? view.pageFiles : files).filter((f) => !flaggedOff.has(f) && !excluded.has(f));
  const allRedirects = config.jinja || config.redirectsPlugin ? redirectMaps(mk.config) : loadLegacyRedirects(root);
  // A view's map covers the redirects from or to its pages, plus each Cloud
  // page kept as its main-line page of the same name.
  const legacyRedirects = view ? [...scopeRedirects(allRedirects, view.inScope), ...view.aliases] : allRedirects;
  const basePath = String(mk.config.extra?.base_path ?? (t.legacyBases?.[0] ? new URL(t.legacyBases[0]).pathname : '')).replace(/\/$/, '');
  return {
    ...t, root, mk, docsDir, files, pageFiles, flags, flaggedOff, excluded,
    frontOf: new Map(), legacyRedirects,
    // Source text with the override list's patches applied.
    read: (file) => (overrides ? overrides.read(file) : fs.readFileSync(file, 'utf8')),
    redirectMap: new Map([...allRedirects, ...(view?.aliases ?? [])].map((r) => [r.from.replace(/\.md$/, ''), r.to])),
    basePath,
    globals: { ...mk.config, ...(mk.config.extra ?? {}), ...flags },
    nav: pruneNav(view ? view.nav : mk.nav, flaggedOff),
    view,
  };
}

function pruneNav(nodes, off) {
  const out = [];
  for (const n of nodes) {
    if (n.kind === 'page' && off.has(n.src.trim().replace(/^\.?\//, ''))) continue;
    if (n.kind === 'section') {
      const children = pruneNav(n.children, off);
      if (!children.length) continue;
      out.push({ ...n, children });
    } else out.push(n);
  }
  return out;
}

const frontMatter = (tree, src) => {
  if (!tree.frontOf.has(src)) tree.frontOf.set(src, matter(tree.read(path.join(tree.docsDir, src))));
  return tree.frontOf.get(src);
};

export async function convertProduct({ config, sourceRoot, outDir, edition, legacyVersion, sourceRef, compile = true, useOverrides = true, log = () => {} }) {
  const report = new Report();
  const overrides = new SourceOverrides(useOverrides ? loadOverrides(config.overrides) : { patches: [], accepted: [] }, { sourceRoot, edition });
  const multi = Boolean(config.trees);
  const treeSpecs = multi ? config.trees(edition) : [{ id: SINGLE, root: '.', legacyBases: null, view: config.view?.(edition) ?? null }];
  const trees = new Map();
  for (const t of treeSpecs) trees.set(t.id, loadTree(t, config, sourceRoot, overrides));
  if (!multi) {
    const t = trees.get(SINGLE);
    t.legacyBases = [config.legacyBase(legacyVersion ?? t.mk.config.extra?.site_version ?? edition)];
    t.basePath = new URL(t.legacyBases[0]).pathname.replace(/\/$/, '');
    if (t.view) {
      // Links that leave the view: the other Doc spaces of this branch, else the legacy site.
      const repoDir = path.dirname(outDir);
      const siblings = siblingMaps(repoDir, path.basename(outDir), config.siblings ?? [], (ds) => editionForBranch(ds, 'main'));
      t.outside = outsideLinks({ files: t.files, redirectMap: t.redirectMap, legacyBase: t.legacyBases[0], siblings });
    }
  }
  const contexts = multi ? config.contexts(edition) : [{ id: SINGLE, tree: SINGLE, edition: editionFromId(edition), built: true }];
  const ctxById = new Map(contexts.map((c) => [c.id, c]));
  const allCtxIds = contexts.map((c) => c.id);
  const layoutTreeId = multi ? config.layoutTree : SINGLE;
  const homeTreeId = multi ? config.homeTree(edition) : SINGLE;
  const homeTree = trees.get(homeTreeId);
  const tables = config.jinja ? new JinjaTables({ conditions: config.conditions, variables: config.variables }) : null;

  // ---- Layout, per tree, then merged into one tree of Content repo pages -------
  const isApiSrc = (tree, src) => /redoc/.test(String(frontMatter(tree, src).data?.template ?? ''));
  const layouts = new Map();
  for (const [id, tree] of trees) {
    const l = planLayout({ nav: tree.nav, files: tree.pageFiles, config, isApiPage: (s) => isApiSrc(tree, s), ...(config.apiSlug ? { apiSlug: config.apiSlug } : {}), unlistedTargets: tree.view?.unlistedTargets });
    for (const issue of l.issues) report.add(issue.kind, issue.src ? (multi ? `${id}:${issue.src}` : issue.src) : null, issue.message);
    layouts.set(id, l);
  }
  // A merged page: one Content repo page, with its source page in each tree.
  // The same file path in two trees is the same page; its place comes from
  // the layout tree, so every branch has the same files.
  const pages = new Map(); // target → page
  const pageOf = new Map(); // `${tree}\0${src}` → page
  const byUrl = new Map();
  const treeOrder = [layoutTreeId, ...[...trees.keys()].filter((id) => id !== layoutTreeId)];
  for (const id of treeOrder) {
    for (const lp of [...layouts.get(id).pages.values()].sort((a, b) => a.src.localeCompare(b.src))) {
      let page = null;
      for (const other of treeOrder) {
        if (other === id) break;
        const hit = pageOf.get(`${other}\0${lp.src}`);
        if (hit && hit.kind === lp.kind) { page = hit; break; }
      }
      if (!page && multi) {
        // Another tree's page at the same place (same nav slot and name) is
        // the same page under an older file name.
        const same = pages.get(lp.target);
        if (same && same.kind === lp.kind && !same.srcs.has(id)) {
          page = same;
          report.add('merged', `${id}:${lp.src}`, `same place as ${[...same.srcs].map(([t, x]) => `${t}:${x.src}`).join(', ')}; merged into one page`);
        }
      }
      if (!page) {
        let target = lp.target;
        for (let n = 2; byUrl.has(docUrl(target)); n++) target = `${lp.target}-${n}`;
        if (target !== lp.target) report.add('layout', `${id}:${lp.src}`, `would share the route /${docUrl(lp.target)} with another tree's page; renamed to ${target}`);
        page = { target, url: docUrl(target), kind: lp.kind, srcs: new Map(), file: `docs/${target}.mdx` };
        pages.set(target, page);
        byUrl.set(page.url, page);
      }
      page.srcs.set(id, lp);
      pageOf.set(`${id}\0${lp.src}`, page);
    }
  }
  for (const page of pages.values()) {
    const lp = page.srcs.get(homeTreeId) ?? page.srcs.get(layoutTreeId) ?? [...page.srcs.values()][0];
    Object.assign(page, { src: lp.src, navLabel: lp.navLabel, sidebarLabel: lp.sidebarLabel, position: lp.position, inNav: lp.inNav, oldUrl: lp.oldUrl });
    page.ctxIds = contexts.filter((c) => {
      if (!page.srcs.has(c.tree)) return false;
      if (c.pagesFrom) return fs.existsSync(path.resolve(sourceRoot, c.pagesFrom, trees.get(c.tree).mk.config.docs_dir ?? 'docs', page.srcs.get(c.tree).src));
      return true;
    }).map((c) => c.id);
  }
  const existsIn = (page, ctxId) => page.ctxIds.includes(ctxId);

  // Regenerate the tree.
  for (const p of ['docs', 'partials', 'assets', '.migration', 'README.md']) fs.rmSync(path.join(outDir, p), { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'docs'), { recursive: true });

  const stats = {
    pages: 0, partials: 0, apiPages: 0, placeholders: 0, images: 0, attachments: 0, missingImages: 0,
    links: 0, externalLinks: 0, legacyHostLinks: 0, otherVersionLinks: 0, crossProductLinks: 0,
    linksViaRedirect: 0, droppedLinks: 0, droppedAnchors: 0, placeholdersWrapped: 0,
    admonitions: 0, details: 0, tabSets: 0, codeBlocks: 0, indentedCode: 0, htmlBlocks: 0, explicitIds: 0,
    basePathInCode: 0, basePathInText: 0, unknownElements: 0, unknownLanguages: new Set(),
    generatedDescriptions: 0, sidebarLabels: 0, relativeFallback: 0, unlisted: 0, placeholders_: 0,
    sharedPages: 0, cloudOnlyPages: 0, selfHostedOnlyPages: 0, markedPages: 0, markers: 0, flatMerged: 0,
    editionCheckFailures: 0, imageVariants: 0, linkVariants: 0, includesExpanded: 0, includeFrontMatter: 0,
    flaggedOffPages: 0, specsFixed: 0, titlesVarying: 0,
  };
  Object.defineProperty(stats, 'placeholders', { get: () => stats.placeholdersWrapped, set: (v) => { stats.placeholdersWrapped = v; } });
  for (const t of trees.values()) if (t.id === homeTreeId || !multi) stats.flaggedOffPages += t.flaggedOff.size;

  // ---- Source-path resolution (per tree) ----------------------------------------
  const findSource = (tree, sitePath, depth = 0) => {
    let p = decodeURIComponent(sitePath).replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/index\.html$/, '').replace(/\.html$/, '');
    p = posix.normalize(p || '.');
    if (p === '.') p = '';
    if (p.startsWith('../')) return null;
    const candidates = p.endsWith('.md') ? [p] : [`${p}.md`, p ? `${p}/index.md` : 'index.md'];
    for (const c of candidates) if (pageOf.has(`${tree.id}\0${c}`)) return { page: pageOf.get(`${tree.id}\0${c}`), viaRedirect: depth > 0 };
    for (const c of candidates) if (tree.files.includes(c) && (config.fragments ?? []).some((f) => c.startsWith(f))) return { fragment: c };
    if (p && !(tree.view && /\.md$/i.test(p)) && fs.existsSync(path.join(tree.docsDir, p)) && fs.statSync(path.join(tree.docsDir, p)).isFile()) return { asset: p };
    const key = p.replace(/\.md$/, '').replace(/\/index$/, '');
    if (depth < 6) {
      for (const k of [key, `${key}/index`]) {
        if (tree.redirectMap.has(k)) {
          const to = tree.redirectMap.get(k).replace('{{SITE_URL}}', '').replace(/^\/+/, '');
          const hit = findSource(tree, to, depth + 1);
          if (hit) return { ...hit, viaRedirect: true };
        }
      }
    }
    return null;
  };

  // A broken link's details for the report and the override list: the href as
  // written and, per context, the one page of that tree with the missing
  // path's file name (a page that moved without a redirect), if there is one.
  const byBase = new Map();
  const baseName = (p) => posix.basename(String(p).replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.md$/, '').replace(/\/index$/, ''));
  const candidatesFor = (treeId, site) => {
    if (!byBase.size) {
      for (const [key, page] of pageOf) {
        const [tid, src] = key.split('\0');
        const k = `${tid}\0${baseName(src)}`;
        if (!byBase.has(k)) byBase.set(k, []);
        byBase.get(k).push(page);
      }
    }
    // Only distinctive file names (two words or more): "overview" says nothing.
    const b = baseName(site);
    return /\w-\w/.test(b) ? byBase.get(`${treeId}\0${b}`) ?? [] : [];
  };
  const linkDetail = (href, per) => {
    const suggest = {};
    for (const [c, v] of per) {
      if (v.drop !== 'missing' || !v.site) continue;
      const hits = candidatesFor(v.tree, v.site);
      if (hits.length === 1) suggest[c] = { page: hits[0].target, oldUrl: hits[0].srcs.get(v.tree).oldUrl };
    }
    return Object.keys(suggest).length ? { href, suggest } : { href };
  };

  // ---- Assets ------------------------------------------------------------------
  // One copy per distinct file. Where the branch's Editions are of both kinds,
  // a file only Cloud pages use goes to assets/cloud/ and one only Self-hosted
  // pages use to assets/self-hosted/; files both use stay in assets/. The
  // folder is known once every page is converted, so pages carry a token
  // until they are written (placeAssets).
  const copied = new Map(); // `${tree}\0${path}` → asset record, or a spec's repo path
  const assets = []; // { base, hash, src, kinds, path }
  const byBaseHash = new Map(); // `${base}\0${hash}` → asset record
  const hashOf = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  const kindOfCtx = (c) => ctxById.get(c)?.edition.kind ?? 'self-hosted';
  const copyAsset = (tree, assetPath, ctxId) => {
    const key = `${tree.id}\0${assetPath}`;
    let a = copied.get(key);
    if (typeof a === 'string') return a;
    if (!a) {
      const srcFile = path.join(tree.docsDir, assetPath);
      const hash = hashOf(srcFile);
      const base = assetPath.startsWith('assets/') ? assetPath : `assets/${assetPath}`;
      a = byBaseHash.get(`${base}\0${hash}`);
      if (!a) {
        a = { id: assets.length, base, hash, src: srcFile, kinds: new Set(), path: null };
        assets.push(a);
        byBaseHash.set(`${base}\0${hash}`, a);
        if (IMAGE_EXT.test(assetPath)) stats.images++;
        else stats.attachments++;
      }
      copied.set(key, a);
    }
    a.kinds.add(kindOfCtx(ctxId));
    return a;
  };
  // A link from `file` to an asset: a token, or a spec's relative path.
  const assetHref = (file, tree, assetPath, ctxId) => {
    const a = copyAsset(tree, assetPath, ctxId);
    return typeof a === 'string' ? relLink(file, a) : `__wso2asset_${a.id}__`;
  };
  const kindsBuilt = new Set(contexts.map((c) => c.edition.kind));
  const placeAssets = () => {
    const taken = new Map(); // repo path → hash
    for (const a of assets) {
      const kind = kindsBuilt.size > 1 && a.kinds.size === 1 ? [...a.kinds][0] : null;
      const want = kind ? a.base.replace(/^assets\//, `assets/${kind}/`) : a.base;
      let repoPath = want;
      for (let n = 2; taken.has(repoPath) && taken.get(repoPath) !== a.hash; n++) repoPath = want.replace(/(\.\w+)?$/, `-${n}$1`);
      a.path = repoPath;
      if (taken.has(repoPath)) continue;
      taken.set(repoPath, a.hash);
      const dest = path.join(outDir, repoPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(a.src, dest);
      if (kind === 'cloud') stats.cloudOnlyAssets = (stats.cloudOnlyAssets ?? 0) + 1;
      if (kind === 'self-hosted') stats.selfHostedOnlyAssets = (stats.selfHostedOnlyAssets ?? 0) + 1;
    }
  };

  // ---- Links (two passes: anchors are checked once every page is known) --
  const linkRecords = [];
  const apiFiles = new Set();
  const apiTitles = new Map(); // API folder → page title
  const anchorsByFile = new Map(); // repo file → Map context id → Set of ids
  const partialsByFile = new Map(); // repo file → Set of partial repo files
  const titleIds = new Map(); // repo file → id of the H1 that moved to front matter

  // A link's site path in one tree: {{base_path}}, this Edition's legacy URLs,
  // root-relative and relative links.
  const sitePathFor = (rawHref, tree, src, oldUrl) => {
    // Browsers read a backslash in a URL path as a slash; so did the legacy site.
    const href = /^[a-z][a-z0-9+.-]*:/i.test(rawHref) ? rawHref : rawHref.replace(/\\/g, '/');
    if (href.includes('{{base_path}}')) return { site: href.slice(href.indexOf('{{base_path}}') + '{{base_path}}'.length) };
    const abs = /^https?:\/\/([^/]+)(\/[^?#]*)?([?#].*)?$/i.exec(href);
    if (abs) {
      const base = (tree.legacyBases ?? []).find((b) => href.toLowerCase().startsWith(b.toLowerCase()) || `${href}/`.toLowerCase() === b.toLowerCase());
      if (base) {
        stats.legacyHostLinks++;
        return { site: `/${href.slice(base.length)}` };
      }
      if (config.legacyHosts.includes(abs[1].toLowerCase()) && (!multi || /^\/(en|asgardeo|identity-platform)\//.test(abs[2] ?? ''))) {
        stats.otherVersionLinks++;
        return { external: true };
      }
      if (/docs\.wso2\.com|wso2\.com\/(identity|asgardeo)/i.test(abs[1] + (abs[2] ?? ''))) stats.crossProductLinks++;
      return { external: true };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return { external: true };
    if (href.startsWith('/')) {
      if (tree.basePath && (href === tree.basePath || href.startsWith(`${tree.basePath}/`))) return { site: href.slice(tree.basePath.length) || '/' };
      return { site: href };
    }
    // Relative: Markdown files resolve from the file's folder, URLs from the page URL.
    const [p, frag = ''] = href.split(/(?=[?#])/);
    const base = /\.md$/i.test(p) ? posix.dirname(src) : oldUrl.replace(/\/$/, '');
    return { site: `/${posix.normalize(posix.join(base || '.', p))}${frag}` };
  };

  // An {edition.*} value in one context.
  const editionValue = (ctxId, name) => {
    const c = ctxById.get(ctxId);
    if (!c) return undefined;
    if (name === 'version') return c.edition.version ?? c.edition.id;
    return config.editions?.[c.edition.kind]?.[name];
  };
  const tokenText = (s, ctxId) => s.replace(/\u0002([A-Za-z_]\w*)\u0002/g, (m, n) => editionValue(ctxId, n) ?? m);

  // Marker attributes for a part of the active contexts (inline variants).
  const attrsFor = (set, active) => {
    const r = markerFor(new Set(set), new Set(active), contexts);
    if (!r || !r.show) return null;
    return { attrs: r.marker ? markerAttrs(r.marker) : null };
  };

  const makeCtx = (cur) => {
    // cur: { page, label, file, imports, ctxIds, regions, reports }
    const say = (kind, message, detail) => cur.reports.push([kind, message, detail]);
    const srcIn = (c) => cur.page?.srcs.get(ctxById.get(c).tree) ?? null;
    const treeOf = (c) => trees.get(ctxById.get(c).tree);
    const ctx = {
      config, stats, knownLanguages: KNOWN_LANGUAGES, contextIds: cur.ctxIds, regions: cur.regions,
      get legacyBase() { return treeOf((ctx.activeSet?.() ?? cur.ctxIds)[0] ?? cur.ctxIds[0]).legacyBases[0]; },
      tokenText: multi ? tokenText : null,
      report: (kind, message) => say(kind, message),
      language: (l) => config.languages[l.toLowerCase()] ?? l.toLowerCase(),
      admonitionType: (raw) => {
        const t = config.admonitions[raw.toLowerCase()];
        if (!t) {
          say('admonition', `unknown admonition type "${raw}" mapped to note`);
          return 'note';
        }
        return t;
      },
      useTabs: () => {
        cur.imports.set('Tabs', '@theme/Tabs');
        cur.imports.set('TabItem', '@theme/TabItem');
      },
      useAnchor: () => cur.imports.set('Anchor', null),
      link: (href) => {
        stats.links++;
        if (!href || href === '#') return { drop: true };
        const active = ctx.activeSet();
        if (href.startsWith('#')) {
          const per = new Map(active.map((c) => [c, { to: cur.file, anchor: href.slice(1) }]));
          const n = linkRecords.push({ from: cur.file, set: active, per, src: cur.label, href }) - 1;
          return { href: `\u0004${n}\u0004` };
        }
        const per = new Map();
        for (const c of active) {
          const h = tokenText(href, c);
          const lp = srcIn(c);
          const tree = treeOf(c);
          const sp = sitePathFor(h, tree, lp?.src ?? cur.label, lp?.oldUrl ?? cur.oldUrl ?? '');
          if (sp.external) {
            // A URL with a placeholder in it (https://<host>:9443/) is an example, not a link.
            // So is a link with a scheme browsers don't open (ldap://10.100.1.100:389).
            let ok = !/[<>{}]/.test(h) && (!/^[a-z][a-z0-9+.-]*:/i.test(h) || /^(https?|mailto|tel):/i.test(h));
            if (ok && /^[a-z]+:\/\//i.test(h)) {
              try { new URL(h); } catch { ok = false; }
            }
            per.set(c, ok ? { external: h } : { drop: 'placeholder' });
            continue;
          }
          const [pathPart, anchor = ''] = sp.site.split('#');
          let hit = findSource(tree, pathPart.split('?')[0], 0);
          if (!hit && /^\.\.\//.test(h)) {
            // Includes were pasted into pages at different depths; their
            // ../../ paths only work from some of them. Try from the docs root.
            hit = findSource(tree, h.replace(/^(\.\.\/)+/, '').split(/[?#]/)[0], 0);
            if (hit) stats.relativeFallback++;
          }
          if (!hit && tree.outside) {
            const out = tree.outside(pathPart.split('?')[0], anchor);
            if (out) {
              if (out.legacy) stats.legacySiteLinks = (stats.legacySiteLinks ?? 0) + 1;
              else stats.otherDocSpaceLinks = (stats.otherDocSpaceLinks ?? 0) + 1;
              per.set(c, { external: out.href ?? out });
              continue;
            }
          }
          if (!hit) { per.set(c, { drop: 'missing', site: pathPart.split('?')[0], tree: tree.id }); continue; }
          if (hit.fragment) { per.set(c, { drop: `include ${hit.fragment}` }); continue; }
          if (hit.viaRedirect) stats.linksViaRedirect++;
          if (hit.asset) { per.set(c, { asset: assetHref(cur.file, tree, hit.asset, c) }); continue; }
          per.set(c, { to: `docs/${hit.page.target}.mdx`, anchor });
        }
        const vals = [...per.values()];
        if (vals.every((v) => v.drop)) {
          if (vals.some((v) => v.drop === 'placeholder')) say('placeholder-link', `link to the example URL ${href} removed, text kept`);
          else {
            stats.droppedLinks++;
            const why = vals.find((v) => v.drop !== 'missing')?.drop;
            say('broken-link', why ? `link to the ${why}; link removed` : `link to ${href} has no target in this version; link removed, text kept`, linkDetail(href, per));
          }
          return { drop: true };
        }
        if (vals.every((v) => v.external && v.external === vals[0].external)) {
          stats.externalLinks++;
          return { href: vals[0].external };
        }
        if (vals.every((v) => v.asset && v.asset === vals[0].asset)) return { href: vals[0].asset };
        if (multi && vals.some((v) => v.drop === 'missing')) say('broken-link', `link to ${href} has no target in ${active.filter((c) => per.get(c).drop).join(', ')}; link removed there, text kept`, linkDetail(href, per));
        const n = linkRecords.push({ from: cur.file, set: active, per, src: cur.label, href }) - 1;
        return { href: `\u0004${n}\u0004` };
      },
      image: (src, alt = '') => {
        if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return { src, local: false };
        const active = ctx.activeSet();
        const altIn = (c) => tokenText(alt, c);
        const groups = new Map(); // repo-relative src ('' = missing) → contexts
        let external = null;
        for (const c of active) {
          const tree = treeOf(c);
          const lp = srcIn(c);
          const sp = sitePathFor(tokenText(src.trim(), c), tree, lp?.src ?? cur.label, lp?.oldUrl ?? cur.oldUrl ?? '');
          if (sp.external) { external = src; continue; }
          let p = decodeURIComponent(sp.site.split(/[?#]/)[0]).replace(/^\/+/, '').replace(/["']+$/, '');
          const isFile = (q) => q && fs.existsSync(path.join(tree.docsDir, q)) && fs.statSync(path.join(tree.docsDir, q)).isFile();
          if (!isFile(p) && /^\.\.\//.test(src)) {
            const q = decodeURIComponent(src.replace(/^(\.\.\/)+/, '').split(/[?#]/)[0]);
            if (isFile(q)) { p = q; stats.relativeFallback++; }
          }
          if (!isFile(p) && tree.view && lp && !/^[/a-z]+:|^\//i.test(src)) {
            // MkDocs resolves a Markdown image from the page's file, not its URL.
            const q = posix.normalize(posix.join(posix.dirname(lp.src), decodeURIComponent(src.trim().split(/[?#]/)[0])));
            if (isFile(q)) { p = q; stats.relativeFallback++; }
          }
          // An image differs per Edition by file or by alt text (an Edition variable in it).
          const key = `${isFile(p) ? assetHref(cur.file, tree, p, c) : ''}\0${altIn(c)}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(c);
        }
        if (external) return { src: external, local: false, alt: altIn(active[0]) };
        if (groups.size === 1) {
          const [key] = groups.keys();
          const [file, a] = key.split('\0');
          return file ? { src: file, local: true, alt: a } : null;
        }
        stats.imageVariants++;
        const alternatives = [];
        for (const [key, set] of groups) {
          const a = attrsFor(set, active);
          if (!a) continue;
          const [file, altText] = key.split('\0');
          if (!file) {
            stats.missingImages++;
            say('missing-image', `image ${src} does not exist in ${set.join(', ')}; removed there`);
          }
          alternatives.push({ attrs: a.attrs, src: file || null, local: true, alt: altText });
        }
        return { alternatives };
      },
      missingImage: (alt, src) => {
        stats.missingImages++;
        say('missing-image', `image ${src} does not exist in the source; removed${alt ? ` (alt: "${alt}")` : ''}`);
        return '';
      },
      partial: (incPath) => includePartial(incPath, cur),
      // Quick-start pages carry their card metadata in an inline script.
      script: (text) => {
        if (/\bconst\s+meta\s*=/.test(text)) { cur.meta = text.replace(/^\s*const\s+meta\s*=\s*/, '').replace(/;?\s*$/, ''); return true; }
        return false;
      },
    };
    return ctx;
  };

  // ---- Partials ({!includes/x.md!}, API Manager) --------------------------------
  const partials = new Map(); // include path → { name, file }
  const commitReports = (cur) => {
    const seen = new Set();
    for (const [k, m, detail] of cur.reports) {
      if (seen.has(`${k}\0${m}`)) continue;
      seen.add(`${k}\0${m}`);
      report.add(k, cur.label, m, detail);
    }
    cur.reports = [];
  };
  const includePartial = (incPath, includer) => {
    const tree = homeTree;
    const src = incPath.replace(/^\.?\//, '');
    if (!tree.files.includes(src)) {
      includer.reports.push(['include', `include ${incPath} not found; removed`]);
      return null;
    }
    let p = partials.get(src);
    if (!p) {
      const rel = src.replace(/^includes\//, '').replace(/\.md$/, '');
      const file = `partials/${posix.dirname(rel) === '.' ? '' : `${posix.dirname(rel)}/`}${posix.basename(rel)}.mdx`;
      p = { name: pascalCase(posix.basename(rel)), file, firstIncluder: partials.get(includer.label)?.firstIncluder ?? includer.label };
      partials.set(src, p);
      // markdown_include pasted the text into the page, so relative links in
      // it resolve against the (first) including page's URL.
      const cur = { page: includer.page, label: src, oldUrl: includer.oldUrl, file, imports: new Map(), ctxIds: includer.ctxIds, regions: null, reports: [] };
      const body = convertBody(preprocess(frontMatter(tree, src).content, cur), cur);
      commitReports(cur);
      writeMdx(file, null, cur.imports, body.text);
      anchorsByFile.set(file, body.anchors);
      stats.partials++;
    }
    if (!partialsByFile.has(includer.file)) partialsByFile.set(includer.file, new Set());
    partialsByFile.get(includer.file).add(p.file);
    let name = p.name;
    if ([...includer.imports.entries()].some(([n, f]) => n === name && f !== p.file)) name = `${name}${includer.imports.size}`;
    includer.imports.set(name, p.file);
    return name;
  };

  // ---- Page bodies: variables (single-tree products) ------------------------------
  const varPattern = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;
  const jinjaTag = /\{%-?\s*(if|elif|else|endif|for|endfor|set|include|macro|endmacro|block|endblock|extends|import)\b/;
  const extraKeys = new Set(Object.keys(homeTree.mk.config.extra ?? {}));
  // md_in_html: a <div markdown="1"> line only wraps Markdown (a styling
  // hook, such as cards); the wrapper and its closing </div> go, and the
  // Markdown inside converts like any other. Other <div>s nest as HTML.
  const unwrapMarkdownDivs = (text) => {
    const stack = [];
    return text.split('\n').map((line) => {
      if (/^\s*<div\b[^>]*\smarkdown(?:=["']?(?:1|block)["']?)?[\s>/][^>]*>\s*$|^\s*<div\b[^>]*\smarkdown(?:=["']?(?:1|block)["']?)?>\s*$/i.test(line)) {
        stack.push('md');
        stats.mdInHtmlBlocks = (stats.mdInHtmlBlocks ?? 0) + 1;
        return '';
      }
      if (/^\s*<div\b/i.test(line) && !/<\/div>\s*$/i.test(line)) stack.push('html');
      else if (/^\s*<\/div>\s*$/i.test(line) && stack.length) return stack.pop() === 'md' ? '' : line;
      return line;
    }).join('\n');
  };
  const preprocess = (raw, cur) => {
    let text = config.mdInHtml ? unwrapMarkdownDivs(raw) : raw;
    // An inline icon the page marks decorative (aria-hidden) carries no text.
    if (config.dropDecorativeSvg) {
      text = text.replace(/<svg\b[^>]*\baria-hidden=["']true["'][^>]*>[\s\S]*?<\/svg>/gi, () => {
        stats.decorativeSvgsDropped = (stats.decorativeSvgsDropped ?? 0) + 1;
        return '';
      });
    }
    // A line of legacy tab buttons (role="tab") was a switcher the legacy
    // theme's script drove; without it the buttons are inert, so they go.
    if (config.dropTabButtons) {
      text = text.replace(/^[ \t]*(?:<button\b[^>]*\brole=["']tab["'][^>]*>[^<]*<\/button>[ \t]*)+$/gim, () => {
        stats.tabButtonLinesDropped = (stats.tabButtonLinesDropped ?? 0) + 1;
        return '';
      });
    }
    // {% raw %} regions keep their braces; everything else resolves variables.
    const parts = text.split(/(\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\})/);
    return parts.map((part, k) => {
      if (k % 2) return part.replace(/^\{%-?\s*raw\s*-?%\}|\{%-?\s*endraw\s*-?%\}$/g, '');
      const tag = jinjaTag.exec(part);
      if (tag) throw new Error(`${cur.label}: Jinja tag {% ${tag[1]} %} has no conversion rule`);
      return part.replace(varPattern, (m, name) => {
        const rule = config.variables[name];
        if (rule?.remove) return m; // {{base_path}} is resolved by the link rules
        if (rule?.edition) return `\u0002${rule.edition}\u0002`;
        if (extraKeys.has(name.split('.')[0])) throw new Error(`${cur.label}: variable {{${name}}} has no conversion rule`);
        return m; // not a config variable: MkDocs left it as written
      });
    }).join('');
  };

  // ---- Page bodies: Jinja in every Edition context (docs-is) ------------------
  let jinjaReports = null;
  const evalOrReport = (ast, scope, src) => {
    try {
      return evalExpr(ast, scope, src);
    } catch (err) {
      if (!(err instanceof JinjaError)) throw err;
      jinjaReports?.push(['jinja', `${scope.get('__ctx').id}: ${err.message}; taken as false`]);
      return false;
    }
  };
  const jinjaEnv = (where) => ({
    out(node, scope) {
      const ast = tables.output(node.expr, where);
      const c = scope.get('__ctx');
      if (ast.k === 'name') {
        const rule = tables.rule(ast.v.join('.'));
        if (rule?.remove) return '{{base_path}}';
        let v;
        try {
          v = evalExpr(ast, scope, node.src);
        } catch (err) {
          if (!(err instanceof JinjaError)) throw err;
          jinjaReports?.push(['jinja', `${c.id}: ${err.message}; printed as written`]);
          return node.src;
        }
        const ev = rule?.edition ? editionValue(c.id, rule.edition) : undefined;
        if (ev !== undefined && printValue(v) === String(ev)) return `\u0002${rule.edition}\u0002`;
        return printValue(v);
      }
      return printValue(evalOrReport(ast, scope, node.src));
    },
    value(expr, scope) {
      return evalOrReport(tables.output(expr, where), scope, expr);
    },
    branch(node, scope) {
      for (let k = 0; k < node.branches.length; k++) {
        const b = node.branches[k];
        if (b.cond === null) return k;
        if (truthyValue(evalOrReport(tables.condition(b.cond, where), scope, b.cond))) return k;
      }
      return -1;
    },
  });

  // The page's template in each context: the tree's source page with its
  // includes expanded; leading {% set %}s (the stub's own) run per context,
  // so stubs of one include in two trees share the body.
  const templatesFor = (page, cur) => {
    const out = new Map();
    for (const c of page.ctxIds) {
      const ctx = ctxById.get(c);
      const tree = trees.get(ctx.tree);
      const src = page.srcs.get(ctx.tree).src;
      const file = path.join(tree.docsDir, src);
      const expanded = expandIncludes(frontMatter(tree, src).content, file, tree.docsDir, {
        read: tree.read,
        onInclude: () => { stats.includesExpanded++; },
        onFrontMatter: (f) => {
          stats.includeFrontMatter++;
          cur.reports.push(['include-front-matter', `${path.relative(sourceRoot, f)} starts with front matter, which the legacy site printed as text; dropped`]);
        },
      });
      const nodes = parse(tokenize(expanded, `${ctx.tree}:${src}`), `${ctx.tree}:${src}`);
      let k = 0;
      while (k < nodes.length && (nodes[k].n === 'set' || nodes[k].n === 'setblock' || (nodes[k].n === 'text' && !nodes[k].v.trim()))) k++;
      const sig = JSON.stringify(nodes.slice(k), (key, v) => (key === 'tag' || key === 'end' ? { name: v.name, args: v.args, own: v.own, lead: v.lead, trail: v.trail } : v));
      out.set(c, { prologue: nodes.slice(0, k), body: nodes.slice(k), sig });
    }
    return out;
  };
  const scopeFor = (c, prologue, env) => {
    const ctx = ctxById.get(c);
    const scope = makeScope({ ...trees.get(ctx.tree).globals, ...(ctx.globals ?? {}) });
    scope.set('__ctx', ctx);
    renderFlat(prologue, scope, env);
    return scope;
  };

  const renderJinja = (page, cur, flatOnly) => {
    const env = { ...jinjaEnv(page.src), flatOnly };
    const tpl = templatesFor(page, cur);
    const ids = page.ctxIds;
    const scopes = new Map(ids.map((c) => [c, scopeFor(c, tpl.get(c).prologue, env)]));
    const sameBody = new Set(ids.map((c) => tpl.get(c).sig)).size === 1;
    if (sameBody && !flatOnly) return renderStructured(tpl.get(ids[0]).body, ids, scopes, env, cur.regions);
    const per = new Map(ids.map((c) => [c, renderFlat(tpl.get(c).body, scopes.get(c), env)]));
    return mergeTexts(ids, per, cur.regions);
  };

  const convertBody = (content, cur) => {
    const ctx = makeCtx(cur);
    ctx.isPartial = isPartialFile(cur.file);
    const conv = new PageConverter(ctx);
    const text = conv.convert(content);
    const titleId = conv.headings.find((h) => h.title)?.id;
    if (titleId) titleIds.set(cur.file, titleId);
    // Anchors per context: headings shown there, plus <Anchor> and {#id} targets.
    const anchors = new Map();
    const lines = text.split('\n');
    for (const c of cur.ctxIds) {
      const set = new Set();
      for (const h of conv.headings) if (!h.title && h.ids?.has(c)) set.add(h.ids.get(c));
      const mine = cur.regions ? filterLines(lines, cur.regions, c).join('\n') : text;
      for (const m of mine.matchAll(/<Anchor id="([^"]+)" \/>/g)) set.add(m[1]);
      for (const m of mine.matchAll(/\{#([^}\s]+)\}$/gm)) set.add(m[1]);
      anchors.set(c, set);
    }
    return { text, anchors, title: conv.title, titleRemoved: conv.titleRemoved, titleVaries: conv.titleVaries, titleTemplate: conv.titleTemplate };
  };

  // A page in every context: rendered with markers, then checked per Edition
  // against the page rendered for that Edition alone; if the markers don't
  // hold, rendered again with block-level variants only.
  const convertPageBody = (page, cur) => {
    if (!config.jinja) return convertBody(preprocess(frontMatter(homeTree, page.src).content, cur), cur);
    let attempt;
    for (const flatOnly of [false, true]) {
      cur.regions = new Regions(contexts, page.ctxIds);
      cur.reports = [];
      jinjaReports = cur.reports;
      cur.imports = new Map();
      const marked = renderJinja(page, cur, flatOnly);
      const body = convertBody(marked, cur);
      const jsx = markersToJsx(body.text, cur.regions);
      attempt = { body, jsx, reports: cur.reports, imports: cur.imports, regions: cur.regions, flatOnly };
      if (page.ctxIds.length < 2 || !cur.regions.list.length) break;
      if (jsx === null) { attempt.check = { ok: false, failures: [{ context: '*', message: 'markers do not nest' }] }; continue; }
      // Each Edition alone, for the check.
      const clean = new Map();
      const env = { ...jinjaEnv(page.src), flatOnly: true };
      const tpl = templatesFor(page, { reports: [] });
      for (const c of page.ctxIds) {
        if (!ctxById.get(c).built) continue;
        const scope = scopeFor(c, tpl.get(c).prologue, env);
        const quiet = new PageConverter(quietCtx(config, trees.get(ctxById.get(c).tree).legacyBases[0]));
        const text = quiet.convert(renderFlat(tpl.get(c).body, scope, env));
        // A title that moved to front matter still counts as the page's words.
        clean.set(c, quiet.titleRemoved ? `# ${quiet.title}\n\n${text}` : text);
      }
      const title = body.titleRemoved ? `# ${body.title}\n\n` : '';
      attempt.check = checkEditions(`${title}${jsx}`, contexts.filter((c) => page.ctxIds.includes(c.id)), clean, editionValue);
      if (attempt.check.ok) break;
    }
    jinjaReports = null;
    cur.reports = attempt.reports;
    cur.imports = attempt.imports;
    cur.regions = attempt.regions;
    if (attempt.flatOnly) stats.flatMerged++;
    if (attempt.check && !attempt.check.ok) {
      stats.editionCheckFailures++;
      for (const f of attempt.check.failures) cur.reports.push(['edition-check', f.message ?? `${f.context}: the marked page reads "…${f.got}…" where the ${f.context} page alone reads "…${f.want}…" (${f.lengths[0]} vs ${f.lengths[1]} words)`]);
    }
    attempt.body.text = attempt.jsx ?? attempt.body.text;
    return attempt.body;
  };

  const pendingWrites = [];
  const writeMdx = (file, front, imports, body) => {
    pendingWrites.push({ file, front, imports, body });
  };
  // Data files (schemas/ in the Platform), written with the pages; logos are
  // assets, so their place is known only once every page is converted.
  const pendingData = [];
  const ASSET_PATH_TOKEN = /__wso2assetpath_(\d+)__/g;
  function writeCatalog(page, tree, cfg) {
    const extra = tree.mk.config.extra ?? {};
    const product = String(extra.product_name ?? '');
    const dataFile = posix.join(posix.dirname(page.file), cfg.file);
    const label = (id) => id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
    const categories = [];
    const items = [];
    const ids = new Set();
    for (const c of extra[cfg.from] ?? []) {
      let id = fileSlug(String(c.name));
      for (let n = 2; ids.has(id); n++) id = `${fileSlug(String(c.name))}-${n}`;
      ids.add(id);
      const doc = String(c.documentation_link ?? '').trim();
      let href = null;
      if (/^https?:\/\//.test(doc)) href = doc;
      else if (doc) {
        const target = pageOf.get(`${tree.id}\0${cfg.docSource(doc)}`);
        if (target) href = relLink(dataFile, target.file);
        else report.add('catalog', page.src, `${cfg.from}: "${c.name}" documents ${doc}, which is no page; linked to its store page instead`);
      }
      const links = c.source_link ? [{ label: cfg.sourceLabel, url: String(c.source_link) }] : [];
      if (!href && links.length) href = links.shift().url;
      if (!href) {
        report.add('catalog', page.src, `${cfg.from}: "${c.name}" has no documentation or store link; left out`);
        continue;
      }
      const item = { id, name: String(c.name), description: String(c.description ?? c.name).replace(/\{\{\s*product_name\s*\}\}/g, product).trim(), href };
      if (links.length) item.links = links;
      if (c.category) {
        item.category = fileSlug(String(c.category));
        if (!categories.some((x) => x.id === item.category)) categories.push({ id: item.category, label: label(String(c.category)) });
      }
      if (c.icon) {
        const icon = String(c.icon).replace(/^\/+/, '');
        if (fs.existsSync(path.join(tree.docsDir, icon))) item.logo = `__wso2assetpath_${copyAsset(tree, icon, page.ctxIds[0]).id}__`;
        else report.add('catalog', page.src, `${cfg.from}: "${c.name}"'s icon ${icon} is missing; drawn without a logo`);
      }
      items.push(item);
    }
    stats.catalogItems = (stats.catalogItems ?? 0) + items.length;
    const head = `# Catalog data file (schemas/catalog.schema.json in wso2/docs-platform), drawn by\n# ${posix.basename(page.file)} (layout: catalog). Generated by the WSO2 Docs converter from\n# mkdocs.yml extra.${cfg.from} in ${config.sourceRepo}; until it is generated upstream,\n# change it in migration/products/ of wso2/docs-platform, not here.\n`;
    pendingData.push({ file: dataFile, text: `${head}${yaml.dump({ schemaVersion: 1, ...(categories.length ? { categories } : {}), items }, { lineWidth: -1 })}` });
  }

  const typeFor = (target) => {
    if (config.typeOverrides?.[target]) return config.typeOverrides[target];
    const hit = Object.keys(config.types).filter((k) => target === k || target.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0];
    return hit ? config.types[hit] : 'reference';
  };

  const exportFolders = new Set();
  for (const page of [...pages.values()].sort((a, b) => a.src.localeCompare(b.src))) {
    const file = page.file;
    const cur = { page, label: page.src, oldUrl: page.oldUrl, file, imports: new Map(), ctxIds: page.ctxIds, regions: null, reports: [] };
    const fmTreeId = page.srcs.has(homeTreeId) ? homeTreeId : [...page.srcs.keys()][0];
    const fmTree = trees.get(fmTreeId);
    const fm = frontMatter(fmTree, page.srcs.get(fmTreeId).src);
    const front = {};
    let bodyText;
    let title;
    let titleVaries = false;

    if (page.kind === 'api') {
      const r = convertApiPage(page, cur);
      commitReports(cur);
      if (!r) continue;
      ({ bodyText, title } = r);
      Object.assign(front, r.front);
    } else if (config.placeholders?.[page.src]) {
      title = page.navLabel ?? headingPlainText(fm.content.match(/^#\s+(.*)$/m)?.[1] ?? page.src);
      const legacyUrl = `${fmTree.legacyBases[0]}${page.oldUrl}`;
      bodyText = `:::info[Not migrated yet]\nThis page is generated from the product's configuration model and has not moved to WSO2 Docs yet. Use the [${title} on the legacy site](${legacyUrl}).\n:::\n`;
      report.add('placeholder', page.src, `${config.placeholders[page.src].reason}; a placeholder links to ${legacyUrl}`);
      stats.placeholders_++;
    } else {
      const body = convertPageBody(page, cur);
      commitReports(cur);
      bodyText = body.text;
      title = body.title ?? page.navLabel ?? posix.basename(page.target);
      titleVaries = body.titleVaries;
      if (titleVaries) title = body.titleTemplate ?? title;
      anchorsByFile.set(file, body.anchors);
    }
    if (fm.data.title && typeof fm.data.title === 'string') { title = fm.data.title; titleVaries = false; }
    // A page a theme template drew from mkdocs.yml data (extra.connectors):
    // the catalog layout over a data file written next to it (Extension points).
    const catalogCfg = fm.data.template && page.kind !== 'api' ? config.catalogs?.[String(fm.data.template).trim()] : null;
    if (catalogCfg) {
      if (!bodyText.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim()) bodyText = `${catalogCfg.intro}\n`;
      writeCatalog(page, fmTree, catalogCfg);
    }
    if (page.target === 'index' && !bodyText.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<\/?Edition[^>]*>/g, '').trim()) {
      bodyText = `${config.homeIntro ? `${config.homeIntro}\n\n` : ''}${homePageBody(homeTree.mk, pageOf, homeTreeId, file)}`;
      // The cards' sections, drawn as cards by the overview layout.
      front.layout = 'overview';
      stats.overviewPages = (stats.overviewPages ?? 0) + 1;
      title = homeTree.mk.config.site_name?.replace(/ Documentation$/, '') ?? title;
      titleVaries = false;
    }
    if (page.target === 'index' && config.parts?.length) {
      // A family-level Doc space's overview lists its Cloud parts; links into
      // a part are docs:<part>/cloud/ links (URLs, `latest` and canonicals).
      bodyText = `${bodyText.replace(/\n+$/, '')}\n\n${productCards(config.parts, path.dirname(outDir)).join('\n').replace(/\n+$/, '')}\n`;
      stats.cloudParts = config.parts.length;
    }
    if (titleVaries) {
      // The title differs per Edition: front matter keeps the Edition
      // variable (filled per build) and the H1 stays in the body.
      stats.titlesVarying++;
      front.title = title;
    } else front.title = multi ? tokenText(title, page.ctxIds[0]) : title;
    // Edition variables read as this branch's own Edition (or the page's first).
    const descCtx = page.ctxIds.find((c) => ctxById.get(c).tree === homeTreeId) ?? page.ctxIds[0];
    // (The front-matter standard's limit is 160 characters; a longer one is generated.)
    if (config.keepDescriptions && typeof fm.data.description === 'string' && fm.data.description.trim() && fm.data.description.trim().replace(/\s+/g, ' ').length <= 160) {
      // The legacy page's own description (front matter the team wrote).
      front.description = fm.data.description.trim().replace(/\s+/g, ' ');
      front[KEPT_DESCRIPTION] = true;
      stats.keptDescriptions = (stats.keptDescriptions ?? 0) + 1;
    } else {
      front.description = generatedDescription(multi ? bodyText.replace(/\{edition\.(\w+)\}/g, (m, n) => editionValue(descCtx, n) ?? m) : bodyText, title);
      stats.generatedDescriptions++;
    }
    // The page type: an explicit override, else the legacy page's own
    // content type where the product maps it, else its skeleton folder's.
    const fmType = config.typeFromFrontMatter ? config.typeFromFrontMatter.map[String(fm.data[config.typeFromFrontMatter.key] ?? '').trim()] : undefined;
    front.type = config.typeOverrides?.[page.target] ?? fmType ?? typeFor(page.target);
    // Page templates → Platform layouts; the layouts' own front matter keys stay.
    const tpl = fm.data.template ? String(fm.data.template).trim() : null;
    if (tpl && config.layouts && page.kind !== 'api') {
      const layout = config.layouts[tpl];
      if (layout === undefined) report.add('layout', page.src, `page template ${tpl} has no layout mapping`);
      else if (layout && typeof layout === 'object') Object.assign(front, layout);
      else if (layout) front.layout = layout;
      if (layout && layout === config.exportSingleLayout) exportFolders.add(posix.dirname(page.target));
    }
    if (catalogCfg) {
      front.layout = 'catalog';
      front.data = `./${catalogCfg.file}`;
    }
    // Pages the product config draws with a Platform layout (a target, or a folder ending in /).
    const pageLayout = page.kind === 'api' ? null : Object.entries(config.pageLayouts ?? {}).find(([k]) => (k.endsWith('/') ? page.target.startsWith(k) : page.target === k))?.[1];
    if (pageLayout) {
      front.layout = pageLayout;
      stats.overviewPages = (stats.overviewPages ?? 0) + (pageLayout === 'overview' ? 1 : 0);
    }
    if (config.layouts && page.kind !== 'api') {
      // Template metadata the front-matter standard has no key for yet (the
      // layouts that would show it are not built): counted, not written.
      if (['heading', 'read_time', 'heading_meta'].some((k) => fm.data[k] !== undefined) || cur.meta) stats.templateMetaDropped = (stats.templateMetaDropped ?? 0) + 1;
    }
    if (page.sidebarLabel && page.sidebarLabel !== front.title) {
      front.sidebar_label = page.sidebarLabel;
      stats.sidebarLabels++;
    }
    if (page.position !== null && page.position !== undefined) front.sidebar_position = page.position;
    if (!page.inNav) {
      front.unlisted = true;
      stats.unlisted++;
      report.add('not-in-nav', page.src, 'not in the legacy nav; published unlisted (no sidebar entry, as before)');
    }
    // A component's main line: a page found only in its Cloud sub-section (folders.mjs).
    if (!multi && homeTree.view?.cloudOnly.has(page.src)) {
      front.editions = 'cloud';
      stats.cloudOnlyPages++;
    }
    // Page-level Edition markers (Marking Cloud-only and Self-hosted-only content, decision 3).
    if (multi) {
      const r = markerFor(new Set(page.ctxIds), new Set(allCtxIds), contexts);
      if (!r || !r.show) {
        report.add('edition-page', page.src, `page exists in ${page.ctxIds.join(', ') || 'no context'} only, which no Edition of this branch shows; left out`);
        continue;
      }
      if (r.marker?.only) front.editions = r.marker.only;
      if (r.marker?.selfHostedFrom) front.selfHostedFrom = r.marker.selfHostedFrom;
      if (r.marker?.only === 'cloud') stats.cloudOnlyPages++;
      else if (r.marker?.only === 'self-hosted') stats.selfHostedOnlyPages++;
      else stats.sharedPages++;
      if (/<Edition /.test(bodyText)) {
        stats.markedPages++;
        stats.markers += (bodyText.match(/<Edition /g) ?? []).length;
      }
    }
    page.written = true;
    writeMdx(file, front, cur.imports, bodyText);
    stats.pages++;
  }

  function convertApiPage(page, cur) {
    // Each tree's spec: one file where they are the same, one per Edition kind where not.
    const specs = new Map(); // tree id → { src, text }
    let title = page.navLabel;
    for (const [treeId, lp] of page.srcs) {
      const tree = trees.get(treeId);
      const m = /<redoc\s[^>]*?spec-url=(?:'([^']+)'|"([^"]+)"|([^\s>]+))/.exec(frontMatter(tree, lp.src).content);
      if (m) m[1] = m[1] ?? m[2] ?? m[3];
      if (!m) { cur.reports.push(['api', `${multi ? `${treeId}: ` : ''}Redoc page without spec-url; skipped`]); continue; }
      const url = m[1].replace(/\{\{\s*base_path\s*\}\}/, '');
      const specSrc = (url.startsWith('/') ? url : posix.normalize(posix.join(lp.oldUrl, url))).replace(/^\/+/, '');
      if (!fs.existsSync(path.join(tree.docsDir, specSrc))) { cur.reports.push(['api', `${multi ? `${treeId}: ` : ''}spec ${specSrc} not found; skipped`]); continue; }
      specs.set(treeId, { src: specSrc, text: tree.read(path.join(tree.docsDir, specSrc)) });
      title ??= lp.navLabel;
    }
    const folder = posix.dirname(`docs/${page.target}`);
    if (!specs.size) {
      // The legacy page's spec is missing (Redoc showed an error there): a
      // page that says so, so the legacy URL still lands somewhere.
      cur.reports.push(['api', 'no spec for this API in any tree; written as a page without a reference']);
      anchorsByFile.set(cur.file, new Map(page.ctxIds.map((c) => [c, new Set()])));
      return {
        title: title ?? posix.basename(folder),
        bodyText: ':::info[Reference not available]\nThe OpenAPI definition of this API is not available yet.\n:::\n',
        front: {},
      };
    }
    fs.mkdirSync(path.join(outDir, folder), { recursive: true });
    const distinct = new Set([...specs.values()].map((s) => s.text));
    const kindOf = (treeId) => contexts.find((c) => c.tree === treeId)?.edition.kind ?? 'self-hosted';
    let spec = null;
    let valid = true;
    const specOf = new Map();
    const writeSpec = (name, s) => {
      const fixed = fixSpec(s.text);
      for (const f of fixed.fixes) cur.reports.push(['api-spec', `${name}: ${f}`]);
      if (fixed.fixes.length) stats.specsFixed++;
      for (const f of fixed.problems) cur.reports.push(['api-spec', `${name}: ${f} (not fixed)`]);
      fs.writeFileSync(path.join(outDir, folder, name), fixed.text);
      spec ??= fixed.spec;
      if (!fixed.valid) valid = false;
      return fixed;
    };
    if (distinct.size === 1) {
      const fixed = writeSpec('openapi.yaml', [...specs.values()][0]);
      for (const tid of specs.keys()) specOf.set(tid, fixed.spec);
    } else {
      // One spec per Edition kind; openapi.yaml (the download where an Edition
      // has no file of its own) is the layout tree's.
      for (const [treeId, s] of specs) specOf.set(treeId, writeSpec(`openapi.${kindOf(treeId)}.yaml`, s).spec);
      const first = specs.get(layoutTreeId) ?? [...specs.values()][0];
      writeSpec('openapi.yaml', first);
      cur.reports.push(['api-spec', `the spec differs between ${[...specs.keys()].join(' and ')}; one file per Edition`]);
    }
    for (const [tid, s] of specs) copied.set(`${tid}\0${s.src}`, `${folder}/openapi.yaml`);
    spec ??= {};
    title ??= spec.info?.title ?? posix.basename(folder);
    const slug = posix.basename(folder);
    const area = config.apiAreas?.[slug] ?? config.apiAreaByPath?.find(([p]) => page.src.startsWith(p))?.[1] ?? null;
    if (!area) cur.reports.push(['api', `API ${slug} has no area in the product's apiAreas table`]);
    stats.apiPages++;
    const version = spec.info?.version ? ` (version ${spec.info.version})` : '';
    const lead = spec.info?.title ? `The ${spec.info.title}${version}.` : `${title}.`;
    let bodyText = `${lead}\n\n[Download the OpenAPI definition (YAML)](./openapi.yaml)\n`;
    const front = valid ? { layout: 'api-reference', spec: './openapi.yaml' } : {};
    if (area) front.keywords = [`${area} API`];
    if (!valid) {
      // The renderer refuses a spec that fails validation; the page links it instead.
      bodyText = `${lead}\n\n:::info[Reference not rendered yet]\nThis API's OpenAPI definition does not pass validation yet, so its operations are not listed here. [Download the OpenAPI definition (YAML)](./openapi.yaml).\n:::\n`;
      cur.reports.push(['api-spec', 'spec still fails validation after the fixes; the page links the YAML instead of rendering it']);
    }
    // Anchors the API page will have (tags, operations, schemas), per Edition.
    const anchors = new Map();
    for (const c of page.ctxIds) {
      const tid = ctxById.get(c).tree;
      const sp = specOf.get(tid) ?? spec;
      anchors.set(c, valid ? apiAnchors(sp) : new Set());
    }
    anchorsByFile.set(cur.file, anchors);
    apiFiles.add(cur.file);
    apiTitles.set(folder.replace(/^docs\//, ''), title);
    return { bodyText, title, front };
  }

  // ---- Pass 2: finalise links and check anchors -------------------------------
  const anchorsOf = (file, c) => {
    const set = new Set(anchorsByFile.get(file)?.get(c) ?? []);
    for (const p of partialsByFile.get(file) ?? []) for (const a of anchorsByFile.get(p)?.get(c) ?? []) set.add(a);
    return set;
  };
  const pageByFile = new Map([...pages.values()].map((p) => [p.file, p]));
  // Redoc's anchors (#tag/<Tag>, #tag/<Tag>/operation/<id>, #operation/<id>,
  // #schema/<Name>) → the API page's (tag-…, op-…, schema-…).
  const redocAnchor = (a, have) => {
    const op = /(?:^|\/)operation\/([^/]+)$/.exec(a);
    if (op && have.has(`op-${idSafe(op[1])}`)) return `op-${idSafe(op[1])}`;
    const tag = /^tag\/([^/]+)/.exec(a);
    if (tag && have.has(`tag-${apiSlugOf(tag[1])}`)) return `tag-${apiSlugOf(tag[1])}`;
    const sc = /^(?:schema|components\/schemas)\/([^/]+)$/.exec(a);
    if (sc && have.has(`schema-${idSafe(sc[1])}`)) return `schema-${idSafe(sc[1])}`;
    return null;
  };
  // The link one context gets: an href, or null (text only).
  const hrefIn = (r, c, say) => {
    const e = r.per.get(c);
    if (!e || e.drop) return null;
    if (e.external) return e.external;
    if (e.asset) return e.asset;
    const target = pageByFile.get(e.to);
    if (target && !isPartialFile(e.to)) {
      if (!target.written) return null;
      if (!existsIn(target, c)) {
        say(`link to ${e.to.replace(/^docs\//, '')}, which ${c} does not have; link removed there, text kept`, { context: c });
        return null;
      }
    }
    let anchor = e.anchor ? decodeURIComponent(e.anchor) : '';
    if (anchor) {
      // Partials render inside every page that includes them.
      const pageFiles = isPartialFile(r.from)
        ? [...partialsByFile.entries()].filter(([, ps]) => ps.has(r.from)).map(([f]) => f)
        : [r.from];
      const targetAnchors = e.to === r.from && isPartialFile(r.from)
        ? new Set(pageFiles.flatMap((f) => [...anchorsOf(f, c)]))
        : anchorsOf(e.to, c);
      if (!targetAnchors.has(anchor) && apiFiles.has(e.to)) anchor = redocAnchor(anchor, targetAnchors) ?? anchor;
      if (!targetAnchors.has(anchor) && titleIds.get(e.to) === anchor) anchor = ''; // the page title is the top of the page
      else if (!targetAnchors.has(anchor)) {
        const alt = [mkdocsSlug(anchor), anchor.toLowerCase(), mkdocsSlug(anchor.replace(/[-_]+/g, ' '))].find((a) => targetAnchors.has(a));
        if (alt) anchor = alt;
        else {
          stats.droppedAnchors++;
          say(`anchor #${e.anchor} does not exist on ${e.to === r.from ? 'this page' : e.to.replace(/^docs\//, '')}${multi ? ` in ${c}` : ''}; anchor removed`, {
            anchor: e.anchor, target: e.to, context: c, suggest: nearestAnchor(anchor, targetAnchors),
            ...(config.placeholders?.[pageByFile.get(e.to)?.src] ? { placeholder: true } : {}),
          });
          anchor = '';
        }
      }
    }
    if (e.to === r.from) return anchor ? `#${anchor}` : '#';
    return `${relLink(r.from, e.to)}${anchor ? `#${anchor}` : ''}`;
  };
  const resolveRecord = (n) => {
    const r = linkRecords[Number(n)];
    if (r.resolved) return r.resolved;
    const said = new Set();
    const say = (m, detail = {}) => {
      if (said.has(m)) return;
      said.add(m);
      report.add(m.startsWith('anchor') ? 'broken-anchor' : 'broken-link', r.src, m, { href: r.href, ...detail });
    };
    const groups = new Map();
    for (const c of r.set) {
      const h = hrefIn(r, c, say) ?? '';
      if (!groups.has(h)) groups.set(h, []);
      groups.get(h).push(c);
    }
    r.resolved = groups;
    return groups;
  };
  const LINK = /\[((?:\\.|[^[\]\\]|\[(?:\\.|[^[\]\\])*\])*)\]\(\u0004(\d+)\u0004((?: "(?:[^"\\]|\\.)*")?)\)/g;
  const finalizeLinks = (body) => {
    let out = body.replace(LINK, (m, text, n, title) => {
      const groups = resolveRecord(n);
      const r = linkRecords[Number(n)];
      if (groups.size === 1) {
        const [h] = groups.keys();
        return h ? `[${text}](${h}${title})` : text;
      }
      stats.linkVariants++;
      return [...groups].map(([h, set]) => {
        const a = attrsFor(set, r.set);
        if (!a) return '';
        const one = h && h !== '#' ? `[${text}](${h}${title})` : text;
        return a.attrs ? `<Edition ${a.attrs}>${one}</Edition>` : one;
      }).join('');
    });
    // Any other place a link token sits (no link syntax around it).
    out = out.replace(/\u0004(\d+)\u0004/g, (_, n) => [...resolveRecord(n).keys()].find(Boolean) ?? '#');
    // A same-page link whose anchor was removed: keep the text only.
    return out.replace(/\[([^\]]*)\]\(#\)/g, '$1');
  };

  placeAssets();
  const written = [];
  for (const w of pendingWrites) {
    let body = finalizeLinks(w.body).replace(ASSET_TOKEN, (_, n) => relLink(w.file, assets[Number(n)].path));
    // An Edition variable left where the build cannot fill it (a JSX
    // attribute): the value of the page's first Edition.
    if (body.includes('\u0002')) {
      const first = pageByFile.get(w.file)?.ctxIds[0] ?? allCtxIds[0];
      body = body.replace(/\u0002([A-Za-z_]\w*)\u0002/g, (m, n) => {
        stats.attributeVariables = (stats.attributeVariables ?? 0) + 1;
        return editionValue(first, n) ?? n;
      });
    }
    const importLines = [];
    for (const [name, from] of w.imports) {
      if (name === 'Anchor') continue; // a Platform MDX component, no import
      importLines.push(`import ${name} from '${/^(docs|partials)\//.test(from) ? relLink(w.file, from) : from}';`);
    }
    const fmText = w.front ? `---\n${dumpFront(w.front)}---\n\n` : '';
    const content = `${fmText}${importLines.length ? `${importLines.join('\n')}\n\n` : ''}${body.replace(/^\n+/, '')}`;
    const dest = path.join(outDir, w.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    written.push(dest);
  }

  for (const d of pendingData) {
    const dest = path.join(outDir, d.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, d.text.replace(ASSET_PATH_TOKEN, (_, n) => assets[Number(n)].path));
  }

  // ---- Sidebar categories ----------------------------------------------------
  const usedFolders = new Set();
  for (const w of pendingWrites) {
    if (isPartialFile(w.file)) continue;
    let d = posix.dirname(w.file.replace(/^docs\//, ''));
    while (d && d !== '.') { usedFolders.add(d); d = posix.dirname(d); }
  }
  const categories = new Map();
  for (const id of [homeTreeId, layoutTreeId, ...trees.keys()]) {
    for (const [folder, cat] of layouts.get(id).categories) if (!categories.has(folder)) categories.set(folder, cat);
  }
  for (const folder of exportFolders) {
    if (!categories.has(folder)) categories.set(folder, { label: posix.basename(folder).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()), position: null });
  }
  for (const [folder, cat] of categories) {
    if (!usedFolders.has(folder)) continue;
    const data = { label: cat.label ?? apiTitles.get(folder) ?? posix.basename(folder).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()) };
    if (cat.position !== null && cat.position !== undefined) data.position = cat.position;
    if (cat.api) data.collapsible = false;
    // Flattened guides (AI/LLM-friendly docs, decision 5): one <folder>.md.
    if (exportFolders.has(folder)) data.customProps = { export: 'single' };
    fs.writeFileSync(path.join(outDir, 'docs', folder, '_category_.yml'), yaml.dump(data));
  }
  stats.exportSingleFolders = [...exportFolders].filter((f) => usedFolders.has(f)).length;

  // ---- Redirects ---------------------------------------------------------------
  // The legacy URLs of this branch's home tree: every page, then the old
  // redirect maps flattened, include and fragment URLs, the 404 page.
  const legacy = [];
  // A view's main line (a Cloud part) also maps its legacy URLs: the Cloud
  // sub-section's and the hidden next/ folder's.
  const homeEdition = multi ? homeTreeId : legacyVersion ?? (homeTree.view ? edition : null);
  if (homeEdition) {
    const bases = homeTree.legacyBases;
    const homePages = [...pages.values()].filter((p) => p.written && p.srcs.has(homeTreeId));
    for (const page of homePages.sort((a, b) => a.srcs.get(homeTreeId).oldUrl.localeCompare(b.srcs.get(homeTreeId).oldUrl))) {
      for (const base of bases) legacy.push({ from: `${base}${page.srcs.get(homeTreeId).oldUrl}`, to: page.url.replace(/\/$/, '') });
    }
    let unresolved = 0;
    let external = 0;
    const thisVersion = !multi && legacyVersion ? new RegExp(`^https?://(?:${config.legacyHosts.map((h) => h.replace(/\./g, '\\.')).join('|')})/en/${legacyVersion.replace(/\./g, '\\.')}/`, 'i') : null;
    for (const r of homeTree.legacyRedirects) {
      const fromSrc = r.from.replace(/^\/+/, '');
      if (pageOf.has(`${homeTreeId}\0${fromSrc}`)) continue; // a real page now lives at the old path
      let t = r.to.replace('{{SITE_URL}}', '');
      if (thisVersion) t = t.replace(thisVersion, '/');
      for (const base of bases) if (t.startsWith(base)) t = `/${t.slice(base.length)}`;
      if (/^https?:\/\//i.test(t)) {
        // The legacy site sent these off-site (e.g. to the Developer Platform docs).
        for (const base of bases) legacy.push({ from: `${base}${mkdocsUrl(fromSrc)}`, to: t });
        external++;
        continue;
      }
      const target = t.split('#')[0].replace(/^\/+/, '');
      const hit = findSource(homeTree, target);
      let to = '';
      if (hit?.page?.written) to = hit.page.url.replace(/\/$/, '');
      else if (homeTree.outside && homeTree.outside(target)) {
        // A view: the target page is outside it. Another Doc space of this
        // repo maps the URL (its map keeps the redirects to its pages); a page
        // not converted yet keeps its legacy URL.
        const out = homeTree.outside(target);
        if (!out.legacy) {
          stats.legacyRedirectsElsewhere = (stats.legacyRedirectsElsewhere ?? 0) + 1;
          continue;
        }
        for (const base of bases) legacy.push({ from: `${base}${mkdocsUrl(fromSrc)}`, to: out.href });
        external++;
        continue;
      } else {
        // The target is gone in this version: the nearest ancestor page, else
        // the Edition home (URL scheme, decision 8).
        const segs = target.split('/').filter(Boolean);
        while (segs.length > 1) {
          segs.pop();
          const up = findSource(homeTree, segs.join('/'));
          if (up?.page?.written) { to = up.page.url.replace(/\/$/, ''); break; }
        }
        unresolved++;
        report.add('redirect', null, `legacy redirect ${r.from} → ${r.to} has no target page in ${homeEdition}; sent to ${to ? `/${to}/` : 'the Edition home'}`);
      }
      for (const base of bases) legacy.push({ from: `${base}${mkdocsUrl(fromSrc)}`, to });
    }
    stats.legacyRedirectsExternal = external;
    stats.legacyRedirectsUnresolved = unresolved;
    // MkDocs also built every include under docs/ as a page of its own; send
    // those URLs to the first page that includes them.
    for (const [src, p] of partials) {
      const page = pageOf.get(`${homeTreeId}\0${p.firstIncluder}`);
      if (page) for (const base of bases) legacy.push({ from: `${base}${mkdocsUrl(src)}`, to: page.url.replace(/\/$/, '') });
    }
    for (const src of config.redirectToHome ?? []) for (const base of bases) legacy.push({ from: `${base}${mkdocsUrl(src)}`, to: '' });
    for (const src of homeTree.files) {
      if ((config.fragments ?? []).some((f) => src.startsWith(f)) && !partials.has(src)) {
        for (const base of bases) legacy.push({ from: `${base}${mkdocsUrl(src)}`, to: '' });
        report.add('redirect', src, 'include that no page uses; its legacy URL goes to the Edition home');
      }
    }
  }
  const dedupLegacy = [...new Map(legacy.map((l) => [l.from, l])).values()];
  fs.writeFileSync(path.join(outDir, 'redirects.yaml'), `# Page moves (from → to, both page paths) and legacy URL maps.\n# Generated by the WSO2 Docs converter from ${sourceRef}; do not edit during the Pilot.\n${yaml.dump({ moves: [], legacy: dedupLegacy }, { lineWidth: -1 })}`);
  stats.legacyRedirects = dedupLegacy.length;
  stats.legacyRedirectsSource = homeTree.legacyRedirects.length;
  // A component's main line: the Cloud pages kept as main-line pages of the
  // same name, for the team to decide (folders.mjs).
  let cloudDiff = null;
  if (homeTree.view?.matches.length || homeTree.view?.cloudOnly.size) {
    const targetOf = (src) => pageOf.get(`${homeTreeId}\0${src}`)?.target ?? null;
    cloudDiff = { view: homeTree.view, targetOf };
  }

  // ---- The Doc space manifest and the Edition variables -------------------------
  // docspace.yaml is the full Doc space manifest (schemas/docspace.schema.json);
  // only the main line's copy counts, and every branch carries the same one.
  const generated = `# Generated by the WSO2 Docs converter from ${sourceRef}; during the Pilot,\n# change it in migration/products/ of wso2/docs-platform, not here.\n`;
  fs.writeFileSync(path.join(outDir, 'docspace.yaml'), `# Doc space manifest (schemas/docspace.schema.json in wso2/docs-platform).\n${generated}${yaml.dump(config.docspace, { lineWidth: -1 })}`);
  fs.writeFileSync(path.join(outDir, 'editions.yaml'), `# Per-Edition variables ({edition.*} in pages).\n${generated}${yaml.dump(config.editions, { lineWidth: -1 })}`);

  // ---- Compile check and report -----------------------------------------------------
  let failures = [];
  if (compile) {
    log(`Compiling ${written.length} MDX files…`);
    failures = await compileCheck(written);
    for (const f of failures) report.add('compile', posix.relative(outDir, f.file), `${f.line ? `line ${f.line}: ` : ''}${f.message}`);
  }
  // The override list: accepted legacy-broken links leave the outstanding
  // items; entries that matched nothing are reported.
  stats.acceptedByOverrides = overrides.accept(report.items);
  for (const st of overrides.stale()) report.add('override', st.file, st.message);
  stats.unknownLanguages = [...stats.unknownLanguages].sort();
  for (const lang of stats.unknownLanguages) report.add('code-language', null, `code language "${lang}" is not highlighted by the Platform's Prism set`);
  const navPagesIn = (treeId) => [...pages.values()].filter((p) => p.written && p.srcs.get(treeId)?.inNav).length;
  const summary = {
    source: sourceRef, edition, legacyBase: homeEdition ? homeTree.legacyBases[0] : null,
    navPages: navPagesIn(homeTreeId),
    ...(multi ? { navPagesByTree: Object.fromEntries([...trees.keys()].map((id) => [id, navPagesIn(id)])), contexts: allCtxIds } : {}),
    sourceFiles: [...trees.values()].reduce((n, t) => n + t.files.length, 0),
    stats, issues: report.byKind(), compileFailures: failures.length, overrides: overrides.summary(),
    ...(tables ? { jinja: { conditionsUsed: tables.used.conditions.size, conditionsInTable: tables.conditions.size, variablesUsed: tables.used.variables.size, variablesInTable: Object.keys(config.variables).length } } : {}),
  };
  fs.mkdirSync(path.join(outDir, '.migration'), { recursive: true });
  if (cloudDiff) {
    summary.cloudDiff = writeDiffReport({
      outDir, docsDir: homeTree.docsDir, legacyBase: homeTree.legacyBases[0], view: cloudDiff.view, pageTarget: cloudDiff.targetOf,
      sourceRef, displayName: config.docspace.displayName,
    });
  }
  fs.writeFileSync(path.join(outDir, '.migration', 'report.json'), `${JSON.stringify({ summary, items: report.items }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, '.migration', 'report.md'), reportMarkdown(summary, report));
  return { summary, report, failures, pages };
}

// The anchor on a page closest to a missing one, by words (a heading that was
// reworded or renumbered), or null when no single anchor is close enough.
const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'in', 'on', 'with', 'your', 'using', 'how']);
const anchorWords = (a) => new Set(String(a).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map((w) => (w.length > 3 ? w.replace(/(?:ies)$/, 'y').replace(/s$/, '') : w)));
export function nearestAnchor(anchor, anchors) {
  const want = anchorWords(anchor);
  if (!want.size) return null;
  const scored = [];
  for (const a of anchors) {
    if (/^_|^(?:op|tag|schema)-/.test(a)) continue;
    const have = anchorWords(a.replace(/_\d+$/, ''));
    let both = 0;
    for (const w of want) if (have.has(w)) both++;
    // Every word of the old anchor is still there (a heading that gained
    // words), or the two are nearly the same words.
    const score = both / (want.size + have.size - both);
    if (both === want.size || score >= 0.75) scored.push({ anchor: a, score });
  }
  scored.sort((x, y) => y.score - x.score);
  const [best, next] = scored;
  if (!best || (next && next.score === best.score)) return null;
  return { anchor: best.anchor, score: Math.round(best.score * 100) / 100 };
}

const idSafe = (x) => String(x).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const apiSlugOf = (x) => idSafe(String(x).toLowerCase()) || 'x';

function apiAnchors(spec) {
  const out = new Set();
  if (!spec || typeof spec !== 'object') return out;
  try {
    for (const g of groupByTag(spec)) out.add(g.anchor);
    for (const o of collectOperations(spec)) out.add(o.anchor);
    for (const name of Object.keys(spec.components?.schemas ?? {})) out.add(schemaAnchor(name));
  } catch { /* the renderer reports a spec it cannot read */ }
  return out;
}

// A context for converting one Edition's text alone (the per-page check):
// links and images are kept as written, nothing is reported.
function quietCtx(config, legacyBase) {
  return {
    config, legacyBase, knownLanguages: KNOWN_LANGUAGES, contextIds: ['*'], regions: null,
    stats: { unknownLanguages: new Set(), placeholders: 0, admonitions: 0, details: 0, tabSets: 0, codeBlocks: 0, htmlBlocks: 0, explicitIds: 0, indentedCode: 0, basePathInCode: 0, basePathInText: 0, unknownElements: 0 },
    report: () => {},
    language: (l) => config.languages[l.toLowerCase()] ?? l.toLowerCase(),
    admonitionType: (t) => config.admonitions[t.toLowerCase()] ?? 'note',
    useTabs: () => {}, useAnchor: () => {},
    link: () => ({ href: '#' }),
    image: () => ({ src: 'x.png', local: false }),
    missingImage: () => '',
    partial: () => null,
  };
}

function dumpFront(front) {
  const lines = yaml.dump(front, { lineWidth: -1 }).split('\n');
  return `${lines.map((l) => (l.startsWith('description:') && !front[KEPT_DESCRIPTION] ? `${l}  # generated from the first paragraph; a writer should improve it` : l)).join('\n').replace(/\n+$/, '')}\n`;
}

function homePageBody(mk, pageOf, treeId, file) {
  // The legacy home page is built from extra.home_page_cards in a template.
  const cards = mk.config.extra?.home_page_cards ?? [];
  const labelToSrc = new Map();
  const walk = (nodes, trail) => {
    for (const n of nodes) {
      if (n.kind === 'page') labelToSrc.set([...trail, n.label].join('|').toLowerCase(), n.src);
      if (n.kind === 'section') walk(n.children, [...trail, n.label]);
    }
  };
  walk(mk.nav, []);
  const out = [];
  for (const block of cards) {
    for (const section of block.section ?? []) {
      out.push(`## ${section.title}`, '');
      for (const item of section.list_items ?? []) {
        const src = labelToSrc.get(String(item.url).toLowerCase());
        const page = src && pageOf.get(`${treeId}\0${src.trim().replace(/^\.?\//, '')}`);
        if (page) out.push(`- [${item.title}](${relLink(file, `docs/${page.target}.mdx`)})`);
        else if (/^https?:\/\//.test(String(item.url))) out.push(`- [${item.title}](${item.url})`);
        else out.push(`- ${item.title}`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}

function reportMarkdown(summary, report) {
  const s = summary.stats;
  const rows = [
    ['Pages written', s.pages], ['Pages in the legacy nav', summary.navPages], ['Unlisted pages (not in the legacy nav)', s.unlisted],
    ...(summary.navPagesByTree ? [
      ['Pages shared by every Edition', s.sharedPages], ['Cloud-only pages (`editions: cloud`)', s.cloudOnlyPages], ['Self-hosted-only pages', s.selfHostedOnlyPages],
      ['Pages with Edition markers', s.markedPages], ['Edition markers', s.markers], ['Pages merged block by block (structured markers did not hold)', s.flatMerged],
      ['Pages failing the per-Edition check', s.editionCheckFailures], ['Pages whose title differs per Edition', s.titlesVarying],
      ['Images that differ per Edition', s.imageVariants], ['Links that differ per Edition', s.linkVariants],
      ['Includes expanded', s.includesExpanded], ['Pages left out by feature flags', s.flaggedOffPages], ['Folders exported as one file', s.exportSingleFolders],
      ['API specs fixed', s.specsFixed], ['Pages whose template metadata was not kept (heading, read_time, quick-start meta)', s.templateMetaDropped ?? 0],
      ['Edition variables in attributes written as literal values', s.attributeVariables ?? 0],
    ] : []),
    ['API reference pages', s.apiPages], ['Placeholder pages', s.placeholders_], ['Partials', s.partials],
    ['Images copied', s.images], ['Other files copied', s.attachments], ['Missing images removed', s.missingImages],
    ['Links', s.links], ['Links fixed through a legacy redirect', s.linksViaRedirect], ['Broken links removed (text kept)', s.droppedLinks],
    ['Broken anchors removed', s.droppedAnchors], ['Links to other legacy versions (kept)', s.otherVersionLinks], ['Links to other WSO2 docs (kept as legacy URLs)', s.crossProductLinks],
    ['Admonitions', s.admonitions], ['Collapsibles', s.details], ['Tab sets', s.tabSets], ['Code blocks', s.codeBlocks], ['Indented code blocks fenced', s.indentedCode],
    ['Raw HTML blocks converted', s.htmlBlocks], ['Explicit heading ids kept for old anchors', s.explicitIds], ['Placeholders wrapped in backticks', s.placeholdersWrapped],
    ['Generated descriptions to review', s.generatedDescriptions], ['sidebar_label set', s.sidebarLabels],
    ['Legacy redirect entries written', s.legacyRedirects ?? 0], ['Legacy MkDocs redirects (source)', s.legacyRedirectsSource ?? 0], ['Legacy redirects with no target page (sent to an ancestor or home)', s.legacyRedirectsUnresolved ?? 0], ['Legacy redirects to other sites', s.legacyRedirectsExternal ?? 0],
    ['MDX compile failures', summary.compileFailures],
    ['Override patches applied (override list)', `${summary.overrides?.patchesApplied ?? 0} of ${summary.overrides?.patches ?? 0}`],
    ['Legacy-broken links and anchors accepted (override list)', s.acceptedByOverrides ?? 0],
  ];
  const lines = [
    `# Migration report: ${summary.edition}`,
    '',
    `Converted from ${summary.source}. Generated by the WSO2 Docs converter; every item below needs a converter rule, an override or a writer.`,
    '',
    '| Measure | Count |', '|---|---|',
    ...rows.map((r) => `| ${r[0]} | ${r[1]} |`),
    '',
    '## Items by kind',
    '',
    '| Kind | Count |', '|---|---|',
    ...Object.entries(summary.issues).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    '',
  ];
  const open = report.items.filter((i) => !i.accepted);
  const kinds = [...new Set(open.map((i) => i.kind))];
  for (const k of kinds) {
    lines.push(`## ${k}`, '');
    for (const i of open.filter((x) => x.kind === k)) lines.push(`- ${i.file ? `\`${i.file}\`: ` : ''}${i.message.replace(/\n/g, ' ')}`);
    lines.push('');
  }
  const accepted = report.items.filter((i) => i.accepted);
  if (accepted.length) {
    lines.push('## Accepted by the override list', '', 'Broken on the legacy site too: the link is removed and its text kept. Not outstanding.', '');
    for (const i of accepted) lines.push(`- \`${i.file}\`: ${i.message.replace(/\n/g, ' ')} (${i.accepted})`);
    lines.push('');
  }
  return lines.join('\n');
}

export { docUrl, fileSlug };
