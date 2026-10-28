// The Markdown form of every MDX component a page can use (AI/LLM-friendly
// docs, decision 7). The twin exporter (lib/markdown-twin.mjs) turns each JSX
// element into the mdast nodes its form returns. A capitalised component with
// no form here fails the export, and test/markdown-forms.test.mjs fails
// Platform CI when site/src/theme/MDXComponents.js registers a component that
// is missing from COMPONENT_FORMS.
//
// A form is (node, h) => mdast nodes. h gives:
//   h.children(node)   the element's children, already in Markdown form
//   h.attr(node, name) a plain attribute value (string literals only)
//   h.rawAttr(node, n) an attribute's source, expressions included
//   h.convert(nodes)   other nodes in Markdown form
//   h.phrasing(nodes)  nodes flattened to inline content (table cells)
//   h.flowOf(nodes)    nodes with inline runs wrapped in paragraphs
//   h.text(node)       the element's text
//   h.flow             true for a block element, false for an inline one
//   h.atRoot           true when the element sits at the top of the page
//   h.depth            the depth of the heading the element sits under (1 if none)
//   h.ctx              the export context (links, sibling pages)

const text = (value) => ({ type: 'text', value });
const strong = (value) => ({ type: 'strong', children: [text(value)] });
const paragraph = (children) => ({ type: 'paragraph', children });
const unwrap = (node, h) => h.children(node);
const drop = () => [];

// `> **Note:** …`: the label goes in front of the first paragraph.
export function admonition(type, title, body) {
  const word = (type || 'note').replace(/^./, (c) => c.toUpperCase());
  const label = title ? `${word}: ${title}` : `${word}:`;
  const [first, ...rest] = body;
  if (first?.type === 'paragraph' && !title) {
    return [{ type: 'blockquote', children: [paragraph([strong(label), text(' '), ...first.children]), ...rest] }];
  }
  return [{ type: 'blockquote', children: [paragraph([strong(label)]), ...body] }];
}

// Tabs become labelled sub-sections: a heading one level below the section
// they sit in at the top of a page, a bold label elsewhere (lists, quotes).
function tabs(node, h) {
  const legacyLabels = new Map();
  const values = h.attr(node, 'values');
  if (values) {
    for (const m of values.matchAll(/\{[^}]*?value:\s*['"]([^'"]+)['"][^}]*?label:\s*['"]([^'"]+)['"][^}]*\}/g)) legacyLabels.set(m[1], m[2]);
  }
  const out = [];
  for (const item of node.children ?? []) {
    if ((item.type !== 'mdxJsxFlowElement' && item.type !== 'mdxJsxTextElement') || item.name !== 'TabItem') {
      out.push(...h.convert([item]));
      continue;
    }
    const value = h.attr(item, 'value');
    const label = h.attr(item, 'label') ?? legacyLabels.get(value) ?? value ?? 'Tab';
    out.push(h.atRoot
      ? { type: 'heading', depth: Math.min(h.depth + 1, 6), children: [text(label)], data: { generated: true } }
      : paragraph([strong(label)]));
    out.push(...h.children(item));
  }
  return out;
}

// <details> is expanded: the summary becomes a bold line above the content.
function details(node, h, summaryAttr) {
  let summary = summaryAttr ?? null;
  const rest = [];
  for (const child of node.children ?? []) {
    const isSummary = (n) => (n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement') && n.name === 'summary';
    if (summary === null && isSummary(child)) {
      summary = h.text(child);
    } else if (summary === null && child.type === 'paragraph' && child.children.some(isSummary)) {
      const s = child.children.find(isSummary);
      summary = h.text(s);
      const others = child.children.filter((c) => c !== s && !(c.type === 'text' && !c.value.trim()));
      if (others.length) rest.push({ ...child, children: others });
    } else {
      rest.push(child);
    }
  }
  const body = h.convert(rest);
  return summary ? [paragraph([strong(summary)]), ...body] : body;
}

// Plain text of a CodeBlock's children: a template literal or plain text.
function codeValue(node) {
  const parts = [];
  for (const c of node.children ?? []) {
    if (c.type === 'mdxFlowExpression' || c.type === 'mdxTextExpression') {
      const m = /^\s*(['"`])([\s\S]*)\1\s*$/.exec(c.value);
      parts.push(m ? m[2] : c.value);
    } else if (c.type === 'text') parts.push(c.value);
    else if (c.children) parts.push(codeValue(c));
  }
  return parts.join('').replace(/^\n+|\n+$/g, '');
}

// Components a page can use: the Platform's own (site/src/theme/MDXComponents.js)
// and the Docusaurus theme components WSO2 content uses.
export const COMPONENT_FORMS = {
  // Platform components.
  DocsLink: (node, h) => {
    const href = h.attr(node, 'href');
    return [{ type: 'link', url: h.ctx.resolveLink(href), children: h.children(node) }];
  },
  // Show-markers mode only; twins are always exported for the real Edition.
  EditionMarker: (node, h) => (h.attr(node, 'active') === 'true' && h.attr(node, 'page') !== 'true' ? h.children(node) : []),
  // A Self-hosted addition shown in Cloud (plugins/remark-edition.mjs): a
  // `**Self-hosted only.**` line before the block, or under a page's title;
  // a phrase is labelled in front.
  SelfHostedAddition: (node, h) => {
    if (h.attr(node, 'page') === 'true') return [paragraph([strong('Self-hosted only.')])];
    if (!h.flow) return [strong('Self-hosted only:'), text(' '), ...h.children(node)];
    return [paragraph([strong('Self-hosted only.')]), ...h.children(node)];
  },
  // The "Copy page" menu itself.
  PageActions: drop,
  // A link target that isn't a heading (migrated <a name> anchors): nothing to show.
  Anchor: drop,
  // API reference layout (generated from the spec by the API reference remark
  // step, never written by hand): an API page's twin lists the operations from
  // the spec instead (lib/api-twin.mjs).
  ApiReference: drop, ApiNav: drop, ApiContent: drop, ApiHeader: drop, ApiTag: drop, ApiOperation: drop,
  ApiOperationMain: drop, ApiSamples: drop, ApiMethod: drop, ApiEndpoint: drop, ApiDetails: drop, ApiSchema: drop, ApiCode: drop,
  // Overview and catalog layouts (generated by the layout step, never written
  // by hand): an overview's cards are its sections as written; a catalog is a
  // list of its items, each with its name linked, its description and links.
  OverviewGrid: unwrap,
  OverviewCard: unwrap,
  Catalog: (node, h) => [{ type: 'list', ordered: false, spread: false, children: h.children(node).filter((c) => c.type === 'listItem') }],
  CatalogItem: (node, h) => {
    const status = h.attr(node, 'status');
    const [name, ...rest] = h.children(node).filter((c) => c.type === 'paragraph');
    const head = name ? paragraph([...name.children, ...(status ? [text(` (${status})`)] : []), ...(rest[0] ? [text(': '), ...rest[0].children] : [])]) : null;
    return [{ type: 'listItem', spread: false, children: [head, ...rest.slice(1)].filter(Boolean) }];
  },
  CatalogLogo: drop,

  // Docusaurus theme components.
  Tabs: tabs,
  TabItem: unwrap,
  Details: (node, h) => details(node, h, h.attr(node, 'summary')),
  Admonition: (node, h) => admonition(h.attr(node, 'type'), h.attr(node, 'title'), h.children(node)),
  CodeBlock: (node, h) => [{ type: 'code', lang: h.attr(node, 'language') ?? null, meta: h.attr(node, 'title') ? `title="${h.attr(node, 'title')}"` : null, value: codeValue(node) }],
  Mermaid: (node, h) => [{ type: 'code', lang: 'mermaid', meta: null, value: h.attr(node, 'value') ?? codeValue(node) }],
  DocCardList: (node, h) => {
    const items = h.ctx.siblingPages();
    if (!items.length) return [];
    return [{
      type: 'list', ordered: false, spread: false,
      children: items.map((p) => ({ type: 'listItem', spread: false, children: [paragraph([{ type: 'link', url: p.url, children: [text(p.title)] }, ...(p.description ? [text(`: ${p.description}`)] : [])])] })),
    }];
  },
  Head: drop,
  TOCInline: drop,
  // The light image: the Platform's <ThemedImage light dark alt>, or the
  // theme's sources={{ light: '…', dark: '…' }}.
  ThemedImage: (node, h) => {
    const sources = h.rawAttr(node, 'sources') ?? '';
    const from = (key) => h.attr(node, key) ?? new RegExp(`${key}:\\s*(?:useBaseUrl\\()?\\s*['"]([^'"]+)['"]`).exec(sources)?.[1];
    const light = from('light');
    if (!light) return [];
    const alt = h.attr(node, 'alt') ?? '';
    const url = h.ctx.resolveImage(light, alt);
    // The built page holds both images, light first: matching the dark one
    // too (the light one again when there is no dark one) keeps it from being
    // taken for a later image with the same alt text.
    h.ctx.resolveImage(from('dark') ?? light, alt);
    const img = url === null ? { type: 'emphasis', children: [text(`Image: ${alt}`)] } : { type: 'image', url, alt };
    return h.flow ? [paragraph([img])] : [img];
  },
};

// HTML elements written in MDX. Anything not listed keeps its content.
const heading = (depth) => (node, h) => [{ type: 'heading', depth, children: h.children(node) }];
const inlineCode = (node, h) => [{ type: 'inlineCode', value: h.text(node) }];
const listItems = (node, h) => h.children(node).filter((c) => c.type === 'listItem');
const media = (node, h) => {
  const src = h.attr(node, 'src') ?? h.text(node);
  if (!src) return [];
  const link = { type: 'link', url: h.ctx.resolveLink(src), children: [text(h.attr(node, 'title') ?? src)] };
  return h.flow ? [paragraph([link])] : [link];
};

function cellsOf(row, h) {
  return (row.children ?? [])
    .filter((c) => (c.type === 'mdxJsxFlowElement' || c.type === 'mdxJsxTextElement') && (c.name === 'td' || c.name === 'th'))
    .map((c) => ({ type: 'tableCell', children: h.phrasing(h.children(c)) }));
}

function rowsOf(node) {
  const rows = [];
  for (const c of node.children ?? []) {
    if (c.type !== 'mdxJsxFlowElement' && c.type !== 'mdxJsxTextElement') continue;
    if (c.name === 'tr') rows.push(c);
    else if (['thead', 'tbody', 'tfoot'].includes(c.name)) rows.push(...rowsOf(c));
  }
  return rows;
}

export const HTML_FORMS = {
  br: () => [{ type: 'break' }],
  hr: () => [{ type: 'thematicBreak' }],
  img: (node, h) => {
    const alt = h.attr(node, 'alt') ?? '';
    const url = h.ctx.resolveImage(h.attr(node, 'src') ?? '', alt);
    const img = url === null ? { type: 'emphasis', children: [text(`Image: ${alt}`)] } : { type: 'image', url, alt };
    return h.flow ? [paragraph([img])] : [img];
  },
  a: (node, h) => [{ type: 'link', url: h.ctx.resolveLink(h.attr(node, 'href') ?? ''), children: h.children(node) }],
  strong: (node, h) => [{ type: 'strong', children: h.children(node) }],
  b: (node, h) => [{ type: 'strong', children: h.children(node) }],
  em: (node, h) => [{ type: 'emphasis', children: h.children(node) }],
  i: (node, h) => [{ type: 'emphasis', children: h.children(node) }],
  del: (node, h) => [{ type: 'delete', children: h.children(node) }],
  s: (node, h) => [{ type: 'delete', children: h.children(node) }],
  code: inlineCode, kbd: inlineCode, samp: inlineCode, var: inlineCode, tt: inlineCode,
  pre: (node, h) => [{ type: 'code', lang: null, meta: null, value: h.text(node) }],
  p: (node, h) => (h.flow ? [paragraph(h.phrasing(h.children(node)))] : h.children(node)),
  blockquote: (node, h) => [{ type: 'blockquote', children: h.children(node) }],
  h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
  ul: (node, h) => [{ type: 'list', ordered: false, spread: false, children: listItems(node, h) }],
  ol: (node, h) => [{ type: 'list', ordered: true, start: 1, spread: false, children: listItems(node, h) }],
  li: (node, h) => [{ type: 'listItem', spread: false, children: h.flowOf(h.children(node)) }],
  details: (node, h) => details(node, h, null),
  summary: (node, h) => [h.flow ? paragraph([strong(h.text(node))]) : strong(h.text(node))],
  table: (node, h) => {
    const rows = rowsOf(node).map((r) => ({ type: 'tableRow', children: cellsOf(r, h) })).filter((r) => r.children.length);
    if (!rows.length) return [];
    const width = Math.max(...rows.map((r) => r.children.length));
    for (const r of rows) while (r.children.length < width) r.children.push({ type: 'tableCell', children: [] });
    return [{ type: 'table', align: new Array(width).fill(null), children: rows }];
  },
  iframe: media, video: media, audio: media,
  script: drop, style: drop,
};

export function formFor(name) {
  if (!name) return unwrap; // <>…</> fragments
  if (/^[a-z]/.test(name)) return HTML_FORMS[name] ?? unwrap;
  return Object.hasOwn(COMPONENT_FORMS, name) ? COMPONENT_FORMS[name] : null;
}
