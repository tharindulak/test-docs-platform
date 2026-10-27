// Checks that read the Content repo's source: front matter, folder skeleton,
// redirect coverage, marker versions, images, docs: links and house style.
// Each returns a list of findings { level, file, line, message, rule? }.
import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { visit } from 'unist-util-visit';
import { isExactVersion, markerFromFrontMatter, validateMarker } from '../edition.mjs';
import { docsLinkTarget } from '../../plugins/remark-docs-links.mjs';
import { IMAGE_EXT, editionRoutes, keyLine, lineOf, normalizeRoute } from './content.mjs';

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const f = (level, file, line, message, extra = {}) => ({ level, file, line, message, ...extra });

// --- front matter -------------------------------------------------------------

const TYPES = {
  string: (v) => typeof v === 'string' && v.trim() !== '',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  stringList: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
};

export function checkFrontMatter(ctx, S) {
  const out = [];
  const { keys } = S.frontMatter;
  for (const d of ctx.pages) {
    if (d.fmError) {
      out.push(f('error', d.file, 1, `Front matter is not valid YAML: ${d.fmError}`));
      continue;
    }
    const fm = d.fm;
    const at = (k) => keyLine(d.text, k);
    for (const k of Object.keys(fm)) {
      if (!keys[k]) out.push(f('error', d.file, at(k), `Unknown front-matter key "${k}". Known keys: ${Object.keys(keys).join(', ')}.`));
    }
    const folder = d.docRel.includes('/') ? d.docRel.split('/')[0] : null;
    for (const [k, spec] of Object.entries(keys)) {
      const v = fm[k];
      if (v === undefined || v === null) {
        if (spec.required && !(spec.defaultFromFolder && S.folderDefaults[folder])) {
          out.push(f('error', d.file, 1, `Missing required front-matter key "${k}": ${spec.help}`));
        }
        continue;
      }
      if (spec.discouraged) out.push(f('warning', d.file, at(k), `"${k}" is discouraged: ${spec.help}`));
      let ok = true;
      if (spec.type === 'pageType') ok = S.pageTypeIds.includes(v);
      else if (spec.type === 'enum') ok = spec.values.includes(v);
      else if (spec.type === 'editions') ok = (Array.isArray(v) ? v : [v]).every((e) => e === 'cloud' || e === 'self-hosted');
      else if (spec.type === 'version') ok = String(v) === 'next' || isExactVersion(v);
      else ok = TYPES[spec.type]?.(v) ?? true;
      if (!ok) {
        const want = { pageType: `one of ${S.pageTypeIds.join(', ')}`, enum: `one of ${spec.values?.join(', ')}`, editions: '"cloud" or "self-hosted"', version: 'an exact version such as 7.4.0, or "next"' }[spec.type] ?? `a ${spec.type}`;
        out.push(f('error', d.file, at(k), `Front-matter "${k}" must be ${want} (got ${JSON.stringify(v)}).`));
        continue;
      }
      if (spec.maxLength && v.length > spec.maxLength) {
        out.push(f('error', d.file, at(k), `"${k}" is ${v.length} characters; the limit is ${spec.maxLength}. Keep it to one sentence.`));
      }
      if (k === 'description' && /\n/.test(v.trim())) out.push(f('error', d.file, at(k), '"description" must be one sentence on one line.'));
    }
    const marker = markerFromFrontMatter(fm);
    if (marker) {
      try {
        validateMarker(marker, d.file);
      } catch (err) {
        out.push(f('error', d.file, at('editions'), err.message.replace(`${d.file}: `, '')));
      }
    }
  }
  return out;
}

// --- folder skeleton ------------------------------------------------------------

export function checkSkeleton(ctx, S) {
  const out = [];
  const allowed = new Set(S.skeleton.folders.map((x) => x.id));
  const docsDir = path.join(ctx.root, 'docs');
  if (!fs.existsSync(docsDir)) return [f('error', 'docs', 1, 'The Content repo has no docs/ folder.')];
  for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && !allowed.has(entry.name)) {
      out.push(f('error', `docs/${entry.name}`, 1, `Top-level folder "${entry.name}" is not in the sidebar skeleton (${[...allowed].join(', ')}). Move it under one of them.`));
    } else if (!entry.isDirectory() && !S.skeleton.topLevelFiles.includes(entry.name)) {
      out.push(f('error', `docs/${entry.name}`, 1, `Only ${S.skeleton.topLevelFiles.join(' or ')} may sit directly under docs/; move "${entry.name}" into a skeleton folder.`));
    }
  }
  return out;
}

// --- redirect coverage ------------------------------------------------------------

export function readMoves(repo) {
  const out = [];
  const moves = repo.redirects?.moves ?? [];
  if (!Array.isArray(moves)) return { moves: [], problems: ['"moves" in redirects.yaml must be a list'] };
  const problems = [];
  moves.forEach((m, i) => {
    if (typeof m?.from !== 'string' || typeof m?.to !== 'string') problems.push(`moves[${i}] needs "from" and "to" paths`);
    else out.push({ from: normalizeRoute(m.from), to: normalizeRoute(m.to) });
  });
  return { moves: out, problems };
}

export function checkRedirects(ctx, edition) {
  const out = [];
  const { moves, problems } = readMoves(ctx.repo);
  problems.forEach((p) => out.push(f('error', 'redirects.yaml', 1, p)));
  const head = editionRoutes(ctx.docs, edition);
  for (const m of moves) {
    if (!head.has(m.to)) out.push(f('error', 'redirects.yaml', 1, `The move from "${m.from}" points at "${m.to}", which is not a page in ${edition.id}.`));
  }
  // Legacy maps serve every Edition built from this branch: the target must be a page in one of them.
  const anyEdition = new Set(ctx.pages.map((d) => d.route));
  for (const l of Array.isArray(ctx.repo.redirects?.legacy) ? ctx.repo.redirects.legacy : []) {
    if (typeof l?.to === 'string' && !anyEdition.has(normalizeRoute(l.to))) {
      out.push(f('error', 'redirects.yaml', 1, `The legacy redirect from "${l.from}" points at "${l.to}", which is not a page.`));
    }
  }
  const baseDocs = ctx.baseDocs();
  if (!baseDocs) return out;
  const before = editionRoutes(baseDocs, edition);
  const covered = new Set(moves.map((m) => m.from));
  const renamed = new Map(ctx.changes.filter((c) => c.status === 'R').map((c) => [c.from, c.path]));
  for (const [route, doc] of before) {
    if (head.has(route) || covered.has(route)) continue;
    const to = renamed.get(doc.file);
    const toRoute = to ? ctx.docs.find((x) => x.file === to)?.route : null;
    const trim = (r) => r.replace(/\/$/, '') || '/';
    const entry = `- from: ${trim(route)}  to: ${toRoute != null ? trim(toRoute) : '<the closest remaining page>'}`;
    out.push(f('error', to ?? doc.file, 1, `Page "${route}" (${doc.file}) is gone from ${edition.id} without a redirect${to ? `; it moved to ${to}` : ''}. Add "${entry}" under "moves:" in redirects.yaml.`, { policy: true }));
  }
  return out;
}

// --- marker versions --------------------------------------------------------------

const SELF_HOSTED_FROM = /selfHostedFrom\s*[=:]\s*["']?([\w.-]+)["']?/g;

export function checkMarkerVersions(ctx, policy, edition) {
  if (edition.kind !== 'cloud' && edition.id !== 'next') return { findings: [], note: 'applies to the main line only' };
  const latest = policy.docSpaces[ctx.repo.docspace.slug]?.latest;
  if (!latest || !semver.valid(latest)) return { findings: [], note: 'the Doc space has no released self-hosted version' };
  const out = [];
  for (const d of ctx.docs) {
    if (!ctx.isChanged(d.file)) continue;
    for (const m of d.text.matchAll(SELF_HOSTED_FROM)) {
      const v = m[1];
      const line = lineOf(d.text, m.index);
      if (v === 'next' || !semver.valid(v) || !ctx.onChangedLine(d.file, line)) continue;
      if (!semver.gt(v, latest)) {
        out.push(f('error', d.file, line, `selfHostedFrom="${v}" is not newer than the latest release (${latest}). Content already released needs no marker; use "next" for an unannounced release.`, { policy: true }));
      }
    }
  }
  return { findings: out, note: `latest release ${latest}` };
}

// --- images -------------------------------------------------------------------------

export function checkImageSize(ctx) {
  const out = [];
  let total = 0;
  for (const file of ctx.files) {
    const size = fs.statSync(path.join(ctx.root, file)).size;
    total += size;
    if (!IMAGE_EXT.test(file) || !ctx.isChanged(file)) continue;
    const kb = Math.round(size / KB);
    if (size > MB) out.push(f('error', file, 1, `Image is ${kb} KB; the limit is 1 MB. Crop it and save as PNG or WebP.`, { policy: true }));
    else if (size > 300 * KB) out.push(f('warning', file, 1, `Image is ${kb} KB; keep images under 300 KB where you can.`));
  }
  if (total > GB) out.push(f('warning', '.', 1, `The repository is ${(total / GB).toFixed(1)} GB (over 1 GB); review images for clean-up.`));
  return out;
}

const FILENAME_ALT = /^(image|img|screenshot|picture|figure|\S+\.(png|jpe?g|gif|webp|svg))$/i;

export function checkImageAlt(ctx) {
  const out = [];
  for (const d of ctx.docs) {
    if (!ctx.isChanged(d.file)) continue;
    const tree = ctx.ast(d);
    if (!tree) continue;
    const report = (alt, line, src) => {
      if (!ctx.onChangedLine(d.file, line)) return;
      if (!alt || !alt.trim()) out.push(f('error', d.file, line, `Image ${src ?? ''} has no alt text. Say what the image shows.`.replace('  ', ' ')));
      else if (FILENAME_ALT.test(alt.trim())) out.push(f('warning', d.file, line, `Alt text "${alt}" doesn't say what the image shows.`));
    };
    visit(tree, (node) => {
      if (node.type === 'image') report(node.alt, node.position?.start.line, node.url);
      if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === 'img') {
        const alt = node.attributes?.find((a) => a.name === 'alt');
        const src = node.attributes?.find((a) => a.name === 'src');
        report(typeof alt?.value === 'string' ? alt.value : alt ? 'expression' : '', node.position?.start.line, typeof src?.value === 'string' ? src.value : undefined);
      }
    });
  }
  return out;
}

// --- docs: links -----------------------------------------------------------------------

export function docsLinks(ctx) {
  const links = [];
  for (const d of ctx.docs) {
    const tree = ctx.ast(d);
    if (!tree) continue;
    visit(tree, 'link', (node) => {
      if (node.url.startsWith('docs:')) links.push({ file: d.file, line: node.position?.start.line ?? 1, url: node.url });
    });
  }
  return links;
}

// `routes` is a loader: (space, segment) => Promise<pages.json array | null>.
export async function checkDocsLinks(ctx, policy, routes, { requireRoutes = false } = {}) {
  const out = [];
  const notes = new Set();
  for (const link of docsLinks(ctx)) {
    let target;
    try {
      target = docsLinkTarget(link.url, policy);
    } catch (err) {
      out.push(f('error', link.file, link.line, err.message.replace(/^page: /, '')));
      continue;
    }
    // A Cloud part's page is checked in its platform's Cloud tree.
    const { space: slug, segment, hash } = target;
    const page = normalizeRoute(target.page);
    const list = await routes(slug, segment);
    const where = segment === '_' ? slug : `${slug}/${segment}`;
    if (!list) {
      notes.add(where);
      out.push(f(requireRoutes ? 'error' : 'warning', link.file, link.line, `Could not load the route list of ${where}, so ${link.url} is unverified.`));
      continue;
    }
    const hit = list.find((p) => normalizeRoute(p.path) === page);
    if (!hit) {
      out.push(f('error', link.file, link.line, `${link.url}: ${where} has no page "${page || '/'}" in its published route list.`));
    } else if (hash && Array.isArray(hit.anchors) && !hit.anchors.includes(hash)) {
      out.push(f('error', link.file, link.line, `${link.url}: the page has no anchor "#${hash}".`));
    }
  }
  return { findings: out, note: notes.size ? `no route list for ${[...notes].join(', ')}` : null };
}

// --- headings and house style (warn only, changed lines) ---------------------------------

const VAGUE_LINK = /^(click here|here|this page|this link|link|read more|more)$/i;
const PROMPT = /^\s*\$ /m;
const SHELL = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);

export function checkHouseStyle(ctx, S, templateComments, { all = false } = {}) {
  const out = [];
  const admonitions = new Set(S.admonitions.types.map((t) => t.id));
  const maxInARow = S.admonitions.limits.maxInARow;
  for (const d of ctx.docs) {
    if (!all && !ctx.isChanged(d.file)) continue;
    const tree = ctx.ast(d);
    if (!tree) continue;
    const on = (line) => all || ctx.onChangedLine(d.file, line);
    const add = (rule, line, message) => on(line) && out.push(f('warning', d.file, line, message, { rule }));
    if (!d.partial && d.fm?.description && S.placeholderDescription === d.fm.description) {
      add('template-text', keyLine(d.text, 'description'), 'The description is still the template text; write one sentence about this page.');
    }
    let prev = d.partial ? null : 1; // the title is the H1
    visit(tree, (node, index, parent) => {
      const line = node.position?.start.line ?? 1;
      if (node.type === 'heading') {
        if (prev !== null && node.depth > prev + 1) add('heading-order', line, `Heading level skips from H${prev} to H${node.depth}; use H${prev + 1}.`);
        prev = node.depth;
      } else if (node.type === 'code') {
        if (!node.lang) add('code-language', line, 'Add a language to the code fence, such as ```bash or ```text.');
        else if (SHELL.has(node.lang) && PROMPT.test(node.value)) add('code-prompt', line, 'Remove the "$ " prompt so the command can be copied and pasted.');
      } else if (node.type === 'containerDirective' && parent?.type !== 'containerDirective' && /^[a-z]+$/.test(node.name)) {
        if (!admonitions.has(node.name)) add('admonition-type', line, `":::${node.name}" is not one of the five admonition types (${[...admonitions].join(', ')}).`);
        const run = [];
        for (let i = index; i >= 0 && parent.children[i].type === 'containerDirective'; i--) run.push(i);
        if (run.length === maxInARow + 1) add('admonition-run', line, `More than ${maxInARow} admonitions in a row; move some of it into the main text.`);
      } else if (node.type === 'link') {
        const label = node.children.map((c) => c.value ?? '').join('').trim();
        if (VAGUE_LINK.test(label)) add('link-text', line, `Link text "${label}" doesn't say where the link goes.`);
      } else if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
        if (templateComments.has(node.value.trim())) add('template-text', line, 'Template guidance is still here; replace it with content or delete it.');
      }
    });
  }
  return out;
}

