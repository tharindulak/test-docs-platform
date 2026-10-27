// Page layouts (Extension points for product teams, decision 2): a page's
// `layout` front matter says how it is drawn, from the Platform's fixed list
// (lib/layouts.mjs). This step draws the overview and catalog layouts as MDX
// nodes before Docusaurus's own remark plugins, so the TOC, anchors, link and
// image checks, server rendering, search records and Markdown twins treat
// them as page content. `api-reference` has its own step
// (remark-api-reference.mjs); `default` and the migration's variants are
// drawn as written.
//
// overview: every H2 or H3 section that holds only text and links (no deeper
//   headings, tables, code, images or components), with at least one list or
//   a paragraph that is only a link, is drawn as a card; cards in a row share
//   one grid. Text after a card's last links stays prose after the card (a
//   label for the next row). Everything else stays prose. The page is plain
//   Markdown, and its twin is that Markdown.
// catalog: the page's text, then a searchable grid of the items in the data
//   file its `data:` names (schemas/catalog.schema.json), for this Edition.
import path from 'node:path';
import { dataFileOf, loadDataFile, resolveHref, resolveLogo, shownIn } from '../lib/data-files.mjs';
import { layoutOf } from '../lib/layouts.mjs';

const attrs = (o) => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
  .map(([name, value]) => ({ type: 'mdxJsxAttribute', name, value: value === true ? null : String(value) }));
const el = (name, a = {}, children = []) => ({ type: 'mdxJsxFlowElement', name, attributes: attrs(a), children });
const text = (value) => ({ type: 'text', value: String(value) });
const para = (...children) => ({ type: 'paragraph', children });

// ------------------------------------------------------------------ overview

const CARD_NODES = new Set(['paragraph', 'list', 'thematicBreak']);
const NOT_IN_CARDS = new Set(['image', 'imageReference', 'code', 'table', 'html', 'heading', 'mdxJsxFlowElement', 'mdxJsxTextElement', 'mdxFlowExpression', 'containerDirective', 'leafDirective']);
const deepOk = (n) => !NOT_IN_CARDS.has(n.type) && (n.children ?? []).every(deepOk);

const textOnly = (nodes) => nodes.every((n) => CARD_NODES.has(n.type) && (n.children ?? []).every(deepOk));
// A paragraph that is one link ("Explore AWS resources →"), as cards end.
const isLinkLine = (n) => n.type === 'paragraph' && n.children.filter((c) => c.type !== 'text' || c.value.trim()).length === 1
  && ['link', 'linkReference'].includes(n.children.find((c) => c.type !== 'text' || c.value.trim()).type);

// Splits a section body into the card and the prose after it, or null when
// it is no card: only text and links, up to its last list or link line.
export function cardSplit(nodes) {
  let last = -1;
  nodes.forEach((n, i) => { if (n.type === 'list' || isLinkLine(n)) last = i; });
  if (last < 0 || !textOnly(nodes)) return null;
  return { card: nodes.slice(0, last + 1), after: nodes.slice(last + 1) };
}
export const isCardBody = (nodes) => cardSplit(nodes) !== null;

// Splits nodes into [preamble, sections] at headings of `depth`; a section is
// { heading, body }, the body running to the next heading of that depth or
// shallower.
function sectionsAt(nodes, depth) {
  const preamble = [];
  const sections = [];
  for (const n of nodes) {
    if (n.type === 'heading' && n.depth <= depth) sections.push({ heading: n, body: [] });
    else if (sections.length) sections.at(-1).body.push(n);
    else preamble.push(n);
  }
  return [preamble, sections];
}

// Cards in a row, at one heading level, share one grid.
function withGrids(items) {
  const out = [];
  let grid = null;
  for (const item of items) {
    if (item.card) {
      if (!grid) out.push(grid = el('OverviewGrid', {}, []));
      grid.children.push(item.card);
    } else if (item.nodes.length) {
      out.push(...item.nodes);
      grid = null;
    }
  }
  return out;
}

// A section as a card, then the prose after its links (empty items are skipped).
const asCard = (heading, split) => [
  { card: el('OverviewCard', { level: heading.depth }, [heading, ...split.card]) },
  ...(split.after.length ? [{ nodes: split.after }] : []),
];

export function overview(children) {
  const [preamble, h2s] = sectionsAt(children, 2);
  const items = [{ nodes: preamble }];
  let cards = 0;
  for (const s of h2s) {
    const split = s.heading.depth === 2 ? cardSplit(s.body) : null;
    if (split) {
      items.push(...asCard(s.heading, split));
      cards++;
      continue;
    }
    // A prose H2 keeps its heading and text; its card-shaped H3s form a grid.
    const [lead, h3s] = sectionsAt(s.body, 3);
    const inner = [{ nodes: lead }];
    for (const t of h3s) {
      const sub = t.heading.depth === 3 ? cardSplit(t.body) : null;
      if (sub) {
        inner.push(...asCard(t.heading, sub));
        cards++;
      } else inner.push({ nodes: [t.heading, ...t.body] });
    }
    items.push({ nodes: [s.heading, ...withGrids(inner)] });
  }
  return { children: withGrids(items), cards };
}

// ------------------------------------------------------------------- catalog

// A link node for a catalog href: docs: links are left to the docs: links
// step, and page paths become file links relative to the page, so Docusaurus
// resolves them (and fails the build when they break).
function hrefNode(href, ctx, children) {
  const r = resolveHref(href, ctx);
  if (r.kind !== 'page') return { type: 'link', url: r.url, children };
  if (!r.file) throw new Error(`${ctx.where}: data file ${path.basename(ctx.dataFile)}: "${href}" is not a page in this Doc space`);
  let rel = path.relative(path.dirname(ctx.pageFile), r.file).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return { type: 'link', url: `${rel}${r.hash ? `#${r.hash}` : ''}`, children };
}

function logoNode(logo, ctx) {
  const l = resolveLogo(logo, ctx);
  if (l.kind === 'site') return { type: 'image', url: l.url, alt: '' };
  if (!l.file) throw new Error(`${ctx.where}: data file ${path.basename(ctx.dataFile)}: logo "${logo}" is not in this Doc space's assets/`);
  let rel = path.relative(path.dirname(ctx.pageFile), l.file).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  // The name next to it says what it is: the logo is decorative (alt="").
  return { type: 'image', url: rel, alt: '' };
}

// The catalog's MDX: <Catalog> with one <CatalogItem> per item shown in this
// Edition. Each item holds its logo, its name (a link to its page), its
// description and its other links, as Markdown nodes.
export function catalogNodes(data, ctx) {
  const items = data.items.filter((i) => shownIn(ctx.edition, i.editions));
  const labels = Object.fromEntries((data.categories ?? []).map((c) => [c.id, c.label]));
  const label = (id) => labels[id] ?? id.replace(/[-_.]/g, ' ').replace(/^./, (c) => c.toUpperCase());
  // Filter chips: the listed categories in order, else each one items use.
  const used = [...new Set(items.map((i) => i.category).filter(Boolean))];
  const chips = data.categories ? data.categories.filter((c) => used.includes(c.id)) : used.map((id) => ({ id, label: label(id) }));
  const children = items.map((i) => el('CatalogItem', {
    id: i.id, name: i.name, category: i.category, categoryLabel: i.category ? label(i.category) : undefined,
    tags: i.tags?.length ? i.tags.join('|') : undefined, status: i.status && i.status !== 'ga' ? i.status : undefined,
  }, [
    ...(i.logo ? [el('CatalogLogo', {}, [para(logoNode(i.logo, ctx))])] : []),
    para({ type: 'strong', children: [hrefNode(i.href, ctx, [text(i.name)])] }),
    para(text(i.description)),
    ...(i.links?.length ? [para(...i.links.flatMap((l, n) => [...(n ? [text(' · ')] : []), hrefNode(l.url, ctx, [text(l.label)])]))] : []),
  ]));
  return el('Catalog', { categories: chips.length ? JSON.stringify(chips) : undefined, count: items.length }, children);
}

// ------------------------------------------------------------------- plugin

export default function remarkLayouts({ edition, docsDir }) {
  return (tree, file) => {
    const fm = file.data?.frontMatter ?? {};
    if (!file.path) return;
    const layout = layoutOf(fm);
    const where = docsDir ? path.relative(docsDir, file.path) : path.basename(file.path);
    if (layout === 'overview') {
      tree.children = overview(tree.children).children;
    } else if (layout === 'catalog') {
      const dataFile = dataFileOf(file.path, fm);
      if (!dataFile) throw new Error(`${where}: a catalog page names its data file in front matter, such as "data: ./connectors.yaml"`);
      const ctx = { edition, docsDir, dataFile, pageFile: file.path, where };
      let data;
      try {
        data = loadDataFile('catalog', dataFile, ctx);
      } catch (err) {
        throw new Error(`${where}: ${err.message}`);
      }
      tree.children.push(catalogNodes(data, ctx));
    }
  };
}
