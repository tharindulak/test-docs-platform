// The converter's Docusaurus-source mode (Integrator on the proof, Q73):
// one version of a Docusaurus site (docs/ for `next`, versioned_docs/ for a
// release) becomes a Doc space directory in the Platform layout: pages under
// docs/ (folders from the sidebar, docusaurus.mjs), partials under partials/,
// the images its pages reference under assets/ (Q76: only those),
// redirects.yaml from the legacy URLs, docspace.yaml and editions.yaml, and a
// run report in .migration/ like the MkDocs path's. Every page is compiled
// and checked for content safety.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { readVersion, planDocusaurus } from './docusaurus.mjs';
import { rewriteBody } from './docusaurus-pages.mjs';
import { compileCheck } from './compile.mjs';
import { generatedDescription, Report } from './run.mjs';
import { loadContentRepo } from '../../lib/content.mjs';
import { loadContext } from '../../lib/check/content.mjs';
import { checkContentSafety } from '../../lib/check/safety.mjs';

const posix = path.posix;
const IMAGE = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp)$/i;
// Front matter kept from the source; the rest belongs to the old theme
// (card_*, wide_layout, pagination_*, slug, id) or is set by the converter.
const KEEP_FRONT = ['keywords', 'hide_table_of_contents', 'toc_max_heading_level'];

const relLink = (fromFile, toFile) => {
  const r = posix.relative(posix.dirname(fromFile), toFile);
  return r.startsWith('.') ? r : `./${r}`;
};

// The Docusaurus site in a --source path: the site itself (where docs/ is),
// or a checkout holding it at the product's sourceRoot (en/).
export function siteDirOf(source, config) {
  const nested = path.join(source, config.sourceRoot ?? '');
  return !fs.existsSync(path.join(source, 'docs')) && fs.existsSync(path.join(nested, 'docs')) ? nested : source;
}

export async function convertDocusaurus({ config, siteDir, outDir, edition, sourceRef, compile = true, log = () => {} }) {
  const report = new Report();
  const v = readVersion(siteDir, edition, { sidebar: config.sidebar });
  log(`Sidebar: ${v.sidebarHow}`);
  const plan = planDocusaurus({ tree: v.tree, docs: v.docs, config });
  for (const i of [...v.issues, ...plan.issues]) report.add(i.kind, i.src ?? null, i.message);
  const legacyBase = config.legacyBase(edition);
  const stats = {
    pages: 0, partials: 0, apiPages: 0, images: 0, imageBytes: 0, unlisted: 0, links: 0, legacyLinks: 0, droppedLinks: 0,
    missingImages: 0, generatedDescriptions: 0, sidebarLabels: 0, components: {}, paletteFallbacks: 0, acceptedByOverrides: 0,
    excludedPages: plan.excluded.length,
  };

  // The Doc space directory is regenerated from scratch.
  for (const d of ['docs', 'partials', 'assets', '.migration']) fs.rmSync(path.join(outDir, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'docs'), { recursive: true });

  const docsBySrc = new Map([...v.docs.values()].map((d) => [d.src, d]));
  const docsByUrl = new Map([...v.docs.values()].map((d) => [d.url, d]));
  const pageOf = (d) => (d ? plan.pages.get(d.id) : null);
  const excluded = (d) => plan.excluded.includes(d.id) || (config.excluded ?? []).some((f) => d.src.startsWith(f));
  const legacyUrl = (route, hash = '') => `${legacyBase}${route.replace(/^\/+/, '')}${hash}`;
  const assets = new Map(); // source file → asset path in the Doc space
  const partialFiles = new Map(); // source partial (docs-relative) → partials/ path

  // Where a link goes from a file (its source path in the version, its
  // output path in the Doc space); undefined keeps it, null unlinks it.
  const linkFrom = (fromSrc, outFile, page) => (url) => {
    if (!url || url.startsWith('#') || /^(mailto|tel):/i.test(url)) return undefined;
    stats.links++;
    const [pathPart, hash = ''] = url.split(/(?=#)/);
    const toPage = (d) => {
      if (!d) return null;
      if (excluded(d)) {
        stats.legacyLinks++;
        return legacyUrl(d.url, hash);
      }
      const p = pageOf(d);
      return p ? relLink(outFile, `docs/${p.target}.mdx`) + hash : null;
    };
    const product = /^product:\/\/([\w-]+)\/?(.*)$/.exec(pathPart);
    if (product) {
      if (product[1] !== config.slug) {
        stats.legacyLinks++;
        return `${config.legacySites[product[1]] ?? `${config.legacySites[config.slug].replace(/[^/]+\/$/, '')}${product[1]}/`}${product[2]}${hash}`;
      }
      return linkFrom(fromSrc, outFile, page)(`/${product[2]}${hash}`);
    }
    if (/^pathname:\/\//.test(pathPart)) {
      stats.legacyLinks++;
      return `${new URL(config.legacySites[config.slug]).origin}${pathPart.slice('pathname://'.length)}${hash}`;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(pathPart)) return undefined;
    // A path on the legacy host (/integration-platform/docs/<site>/…): this
    // product's own pages resolve, other sites stay there.
    const own = new URL(config.legacySites[config.slug]);
    const sites = own.pathname.replace(/[^/]+\/$/, '');
    if (pathPart.startsWith(sites)) {
      if (pathPart.startsWith(own.pathname)) return linkFrom(fromSrc, outFile, page)(`/${pathPart.slice(own.pathname.length)}${hash}`);
      stats.legacyLinks++;
      return `${own.origin}${pathPart}${hash}`;
    }
    let target;
    if (/\.mdx?$/.test(pathPart)) {
      // A file link, from the file (Docusaurus also tries the docs root).
      const rel = pathPart.startsWith('/') ? pathPart.slice(1) : posix.normalize(posix.join(posix.dirname(fromSrc), decodeURI(pathPart)));
      target = docsBySrc.get(rel) ?? docsBySrc.get(pathPart.replace(/^\/+/, ''));
      if (!target) {
        stats.droppedLinks++;
        report.add('link', fromSrc, `link to ${url}: no such page in ${edition}; the link was removed and its text kept`);
        return null;
      }
      return toPage(target);
    }
    if (IMAGE.test(pathPart) || /\.(zip|pdf|json|ya?ml|txt|bal|xml|csv)$/i.test(pathPart)) return undefined;
    // A URL path: absolute from the version's base, or relative to the page's URL.
    const route = pathPart.startsWith('/') ? pathPart : posix.join('/', page ? posix.dirname(`/${page.url}`) : '/', pathPart);
    const key = posix.normalize(route).replace(/^\/+|\/+$/g, '');
    target = docsByUrl.get(key);
    if (target) return toPage(target);
    stats.legacyLinks++;
    report.add('link', fromSrc, `link to ${url}: no page of ${edition} has that URL; it goes to the legacy site`);
    return legacyUrl(key, hash);
  };
  // An image: copied once into assets/ (static/ files keep their path below
  // static/, page-relative ones their path below docs/), linked relatively.
  const imageFrom = (fromSrc, outFile) => (url) => {
    const clean = decodeURI(url.split(/[?#]/)[0]);
    // @site/… is the site's own directory (src/assets/ and the like).
    const abs = clean.startsWith('@site/') ? path.join(siteDir, clean.slice(6))
      : clean.startsWith('/') ? path.join(siteDir, 'static', clean)
        : path.join(v.docsDir, posix.dirname(fromSrc), clean);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      stats.missingImages++;
      report.add('image', fromSrc, `image ${url} is missing; its alt text is kept`);
      return null;
    }
    if (!assets.has(abs)) {
      const rel = clean.startsWith('@site/') ? posix.join('site', clean.slice(6))
        : clean.startsWith('/') ? clean.replace(/^\/+/, '') : posix.join('pages', posix.normalize(posix.join(posix.dirname(fromSrc), clean)));
      assets.set(abs, `assets/${rel}`);
    }
    return relLink(outFile, assets.get(abs));
  };
  const components = stats.components;
  const pageCounts = new Map();

  const convert = (fromSrc, outFile, page) => {
    const text = fs.readFileSync(path.join(v.docsDir, fromSrc), 'utf8');
    const fm = matter(text);
    const counts = {};
    const { body, h1 } = rewriteBody(fm.content, {
      link: linkFrom(fromSrc, outFile, page),
      image: imageFrom(fromSrc, outFile),
      partial: (spec) => {
        const rel = posix.normalize(posix.join(posix.dirname(fromSrc), spec));
        if (!docsBySrc.has(rel) && fs.existsSync(path.join(v.docsDir, rel)) && /\.mdx?$/.test(rel)) {
          if (!partialFiles.has(rel)) partialFiles.set(rel, `partials/${posix.dirname(rel) === '.' ? '' : `${posix.dirname(rel)}/`}${posix.basename(rel).replace(/^_/, '').replace(/\.mdx?$/, '')}.mdx`);
          return relLink(outFile, partialFiles.get(rel));
        }
        report.add('import', fromSrc, `import of ${spec}: not a partial in this version; kept as written`);
        return null;
      },
      site: (name, p) => {
        stats.legacyLinks++;
        return `${config.legacySites[name]}${String(p).replace(/^\/+/, '')}`;
      },
      admonitions: config.admonitions,
      count: (kind, n = 1) => {
        if (!n) return;
        components[kind] = (components[kind] ?? 0) + n;
        counts[kind] = (counts[kind] ?? 0) + n;
      },
      item: (kind, message) => report.add(kind, fromSrc, message),
    });
    const palette = ['palette-grid', 'palette-card', 'palette-chip'].filter((k) => counts[k]);
    if (palette.length) {
      stats.paletteFallbacks += palette.reduce((n, k) => n + counts[k], 0);
      report.add('palette', fromSrc, `Palette ${palette.map((k) => `${k.replace('palette-', '')}s ${counts[k]}`).join(', ')} became plain Markdown (headings, text, link lists)`);
    }
    pageCounts.set(fromSrc, counts);
    return { fm: fm.data ?? {}, body, h1 };
  };

  const typeFor = (target) => {
    if (config.typeOverrides?.[target]) return config.typeOverrides[target];
    const hit = Object.keys(config.types).filter((k) => target === k || target.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0];
    return config.types[hit] ?? 'how-to';
  };
  const written = [];
  for (const page of [...plan.pages.values()].sort((a, b) => a.target.localeCompare(b.target))) {
    const d = v.docs.get(page.id);
    const outFile = `docs/${page.target}.mdx`;
    const { fm, body, h1 } = convert(d.src, outFile, d);
    const title = String(fm.title ?? h1 ?? d.title).trim();
    const front = { title };
    const desc = typeof fm.description === 'string' ? fm.description.trim().replace(/\s+/g, ' ') : '';
    if (desc && desc.length <= 160) front.description = desc;
    else {
      front.description = generatedDescription(body, title);
      stats.generatedDescriptions++;
      if (desc) report.add('description', d.src, `description longer than 160 characters (${desc.length}); one was generated from the first paragraph`);
    }
    front.type = typeFor(page.target);
    if (page.sidebarLabel && page.sidebarLabel !== title) {
      front.sidebar_label = page.sidebarLabel;
      stats.sidebarLabels++;
    }
    if (page.position !== null && page.position !== undefined) front.sidebar_position = page.position;
    if (!page.inSidebar) {
      front.unlisted = true;
      stats.unlisted++;
    }
    for (const k of KEEP_FRONT) if (fm[k] !== undefined) front[k] = fm[k];
    const dest = path.join(outDir, outFile);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `---\n${yaml.dump(front, { lineWidth: -1 })}---\n\n${body.replace(/\n*$/, '\n')}`);
    written.push(dest);
    stats.pages++;
  }
  // Partials the pages import (converted after the pages, which find them).
  for (let done = 0; done < partialFiles.size;) {
    const [src, out] = [...partialFiles.entries()][done++];
    const { body } = convert(src, out, null);
    const dest = path.join(outDir, out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body.replace(/\n*$/, '\n'));
    written.push(dest);
    stats.partials++;
  }
  for (const p of v.partials) if (!partialFiles.has(p)) report.add('partial', p, 'a partial no converted page imports; left out');

  // ---- Images (Q76: only the ones the pages reference) ----------------------------
  for (const [abs, rel] of assets) {
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
    stats.images++;
    stats.imageBytes += fs.statSync(abs).size;
  }

  // ---- Sidebar categories -------------------------------------------------------------
  const usedFolders = new Set();
  for (const p of plan.pages.values()) {
    for (let dir = posix.dirname(p.target); dir && dir !== '.'; dir = posix.dirname(dir)) usedFolders.add(dir);
  }
  for (const [folder, cat] of plan.categories) {
    if (!usedFolders.has(folder)) continue;
    const data = { label: cat.label };
    if (cat.position !== null && cat.position !== undefined) data.position = cat.position;
    fs.writeFileSync(path.join(outDir, 'docs', folder, '_category_.yml'), yaml.dump(data));
  }

  // ---- Redirects: every legacy URL of this version to its page ----------------------------
  const legacy = [...plan.pages.values()].map((p) => ({ from: legacyUrl(v.docs.get(p.id).url), to: p.url.replace(/\/$/, '') }))
    .sort((a, b) => a.from.localeCompare(b.from));
  const generated = `# Generated by the WSO2 Docs converter from ${sourceRef}; during the Pilot,\n# change it in migration/products/ of wso2/docs-platform, not here.\n`;
  fs.writeFileSync(path.join(outDir, 'redirects.yaml'), `# Page moves (from → to, both page paths) and legacy URL maps.\n# Generated by the WSO2 Docs converter from ${sourceRef}; do not edit during the Pilot.\n${yaml.dump({ moves: [], legacy }, { lineWidth: -1 })}`);
  stats.legacyRedirects = legacy.length;
  fs.writeFileSync(path.join(outDir, 'docspace.yaml'), `# Doc space manifest (schemas/docspace.schema.json in wso2/docs-platform).\n${generated}${yaml.dump(config.docspace, { lineWidth: -1 })}`);
  fs.writeFileSync(path.join(outDir, 'editions.yaml'), `# Per-Edition variables ({edition.*} in pages).\n${generated}${yaml.dump(config.editions, { lineWidth: -1 })}`);

  // ---- Checks: the MDX compile and content safety -------------------------------------------
  let failures = [];
  if (compile) {
    log(`Compiling ${written.length} MDX files…`);
    failures = await compileCheck(written);
    for (const f of failures) report.add('compile', posix.relative(outDir, f.file), `${f.line ? `line ${f.line}: ` : ''}${f.message}`);
  }
  const safety = checkContentSafety(loadContext({ repo: loadContentRepo(outDir), base: null }));
  for (const f of safety) report.add('content-safety', f.file, `line ${f.line}: ${f.message}`);

  const summary = {
    source: sourceRef, sourceKind: 'docusaurus', edition, legacyBase, sidebar: v.sidebarHow,
    navPages: [...plan.pages.values()].filter((p) => p.inSidebar).length,
    sourceFiles: v.docs.size + v.partials.length,
    stats, issues: report.byKind(), compileFailures: failures.length, contentSafetyFindings: safety.length,
    overrides: { patches: 0, patchesApplied: 0 },
  };
  fs.mkdirSync(path.join(outDir, '.migration'), { recursive: true });
  fs.writeFileSync(path.join(outDir, '.migration', 'report.json'), `${JSON.stringify({ summary, items: report.items }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, '.migration', 'report.md'), reportMarkdown(summary, report));
  return { summary, report, failures, plan };
}

function reportMarkdown(summary, report) {
  const s = summary.stats;
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  const rows = [
    ['Sidebar read from', summary.sidebar],
    ['Pages written', s.pages], ['Pages in the legacy sidebar', summary.navPages], ['Unlisted pages (not in the legacy sidebar)', s.unlisted],
    ['Pages left out (other Doc spaces)', s.excludedPages], ['Partials', s.partials],
    ['Images copied (only those referenced)', `${s.images} (${mb(s.imageBytes)})`], ['Missing images (alt text kept)', s.missingImages],
    ['Links', s.links], ['Links to the legacy site (other Doc spaces, unconverted pages)', s.legacyLinks], ['Broken links removed (text kept)', s.droppedLinks],
    ['Generated descriptions to review', s.generatedDescriptions], ['sidebar_label set', s.sidebarLabels],
    ['Palette cards, chips and grids made plain Markdown', s.paletteFallbacks],
    ['Legacy redirect entries written', s.legacyRedirects],
    ['MDX compile failures', summary.compileFailures], ['Content-safety findings', summary.contentSafetyFindings],
  ];
  const lines = [
    `# Migration report: ${summary.edition}`,
    '',
    `Converted from ${summary.source} (a Docusaurus site). Generated by the WSO2 Docs converter; every item below needs a converter rule or a writer.`,
    '',
    '| Measure | Count |', '|---|---|',
    ...rows.map((r) => `| ${r[0]} | ${r[1]} |`),
    '',
    '## Components rewritten',
    '',
    '| Component | Count |', '|---|---|',
    ...Object.entries(s.components).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`),
    '',
    '## Items by kind',
    '',
    '| Kind | Count |', '|---|---|',
    ...Object.entries(summary.issues).sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`),
    '',
  ];
  for (const k of [...new Set(report.items.map((i) => i.kind))]) {
    lines.push(`## ${k}`, '');
    for (const i of report.items.filter((x) => x.kind === k)) lines.push(`- ${i.file ? `\`${i.file}\`: ` : ''}${i.message.replace(/\n/g, ' ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
