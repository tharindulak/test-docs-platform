// The Platform's remark export step (AI/LLM-friendly docs, decisions 1, 7, 8):
// turns one page's MDX into its Markdown twin for one Edition.
//
//   1. parse the page as Docusaurus does (MDX, GFM, directives, comments,
//      `{#id}` headings);
//   2. run the same remark steps as the HTML build: Edition markers and
//      {edition.*} variables (plugins/remark-edition.mjs, never in show-markers
//      mode), Page layouts (plugins/remark-layouts.mjs: a catalog's items) and
//      docs: links (plugins/remark-docs-links.mjs);
//   3. inline imported partials, each resolved the same way;
//   4. put every component in its Markdown form (lib/markdown-forms.mjs):
//      admonitions become `> **Note:**`, tabs labelled sub-sections, <details>
//      is expanded; links point at other twins, images at the built files;
//   5. print Markdown. Anything left that Markdown can't hold fails here.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkComment from '@slorber/remark-comment';
import remarkStringify from 'remark-stringify';
import { toString } from 'mdast-util-to-string';
import { admonitionTitleToDirectiveLabel, escapeMarkdownHeadingIds, unwrapMdxCodeBlocks } from '@docusaurus/utils';
import remarkEdition from '../plugins/remark-edition.mjs';
import remarkDocsLinks from '../plugins/remark-docs-links.mjs';
import remarkLayouts from '../plugins/remark-layouts.mjs';
import { admonition, formFor } from './markdown-forms.mjs';

// Docusaurus's admonition keywords.
export const ADMONITIONS = ['note', 'tip', 'info', 'warning', 'danger', 'caution', 'important', 'success', 'secondary'];
const PROPS_EXPRESSION = /^\s*props\.([A-Za-z_]\w*)\s*$/;
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition', 'jsxFlow']);
const PHRASING_PARENTS = new Set(['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'linkReference', 'tableCell']);
const PHRASING = new Set(['text', 'emphasis', 'strong', 'delete', 'inlineCode', 'break', 'link', 'image', 'linkReference', 'imageReference', 'footnoteReference', 'html']);
const isJsx = (n) => n.type === 'mdxJsxFlowElement' || n.type === 'mdxJsxTextElement';

const parser = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkDirective).use(remarkComment);
const printer = unified().use(remarkGfm).use(remarkStringify, {
  bullet: '-', emphasis: '_', strong: '*', fence: '`', fences: true, listItemIndent: 'one', rule: '-', resourceLink: true,
});

// Parses MDX content (front matter already removed) the way Docusaurus does.
export function parseMdx(content) {
  const pre = admonitionTitleToDirectiveLabel(escapeMarkdownHeadingIds(unwrapMdxCodeBlocks(content)), ADMONITIONS);
  return parser.parse(pre);
}

export function printMarkdown(tree) {
  return printer.stringify(tree);
}

function attrValue(a) {
  if (!a) return undefined;
  if (a.value === null) return 'true';
  if (typeof a.value === 'string') return a.value;
  const m = /^\s*(['"`])([^]*)\1\s*$/.exec(a.value?.value ?? '');
  return m ? m[2] : undefined;
}
const attrOf = (node, name) => attrValue(node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === name));
const rawAttrOf = (node, name) => {
  const a = node.attributes?.find((x) => x.type === 'mdxJsxAttribute' && x.name === name);
  return a ? (typeof a.value === 'string' ? a.value : a.value?.value) : undefined;
};

const isComment = (n) => n.data?.estree && n.data.estree.body.length === 0;

function importsOf(node, file, siteDir) {
  const out = [];
  for (const stmt of node.data?.estree?.body ?? []) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const source = String(stmt.source.value);
    const local = stmt.specifiers.find((s) => s.type === 'ImportDefaultSpecifier')?.local.name;
    if (!local || !/\.mdx?$/.test(source)) continue;
    const resolved = source.startsWith('@site/') && siteDir ? path.join(siteDir, source.slice('@site/'.length)) : path.resolve(path.dirname(file), source);
    out.push([local, resolved]);
  }
  return out;
}

function phrasingOf(nodes) {
  const out = [];
  for (const n of nodes) {
    if (PHRASING.has(n.type)) out.push(n);
    else if (n.type === 'paragraph' || n.type === 'heading') {
      if (out.length) out.push({ type: 'text', value: ' ' });
      out.push(...n.children);
    } else if (n.type === 'code') out.push({ type: 'inlineCode', value: n.value });
    else if (n.children) out.push(...phrasingOf(n.children));
  }
  return out;
}

// Removes the whitespace left where a comment or marker stood.
function trimEnds(p) {
  const first = p.children[0];
  const last = p.children.at(-1);
  if (first?.type === 'text') first.value = first.value.replace(/^\s+/, '');
  if (last?.type === 'text') last.value = last.value.replace(/\s+$/, '');
  p.children = p.children.filter((c) => c.type !== 'text' || c.value !== '');
  return p;
}

function flowOf(nodes) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.some((n) => n.type !== 'text' || n.value.trim())) out.push(trimEnds({ type: 'paragraph', children: run }));
    run = [];
  };
  for (const n of nodes) {
    if (PHRASING.has(n.type)) run.push(n);
    else {
      flush();
      out.push(n);
    }
  }
  flush();
  return out;
}

// Steps 1 to 3: the page's (or partial's) tree for one Edition, with markers
// applied, docs: links resolved and partials inlined. Link, image and JSX
// nodes remember the file they were written in, for relative links.
export function resolvedTree(file, opts, props = {}, seen = []) {
  if (seen.includes(file)) throw new Error(`${path.basename(file)}: partials include each other (${[...seen, file].map((f) => path.basename(f)).join(' → ')})`);
  if (!fs.existsSync(file)) throw new Error(`${path.basename(seen.at(-1) ?? file)}: partial ${file} not found`);
  const { content, data } = matter(fs.readFileSync(file, 'utf8'));
  const tree = parseMdx(content);
  // The page's own front matter picks its layout; a partial has none.
  const vfile = { path: file, data: { frontMatter: seen.length ? {} : data } };
  remarkEdition({ edition: opts.edition, vars: opts.vars, showMarkers: false, substituteCode: !opts.edition.unversioned, additions: opts.additions ?? null })(tree, vfile);
  remarkLayouts({ edition: opts.edition, docsDir: opts.docsDir })(tree, vfile);
  remarkDocsLinks({ policy: opts.policy, host: opts.linkHost })(tree, vfile);

  const partials = new Map();
  tree.children = tree.children.filter((n) => {
    if (n.type !== 'mdxjsEsm') return true;
    for (const [local, target] of importsOf(n, file, opts.siteDir)) partials.set(local, target);
    return false;
  });

  const walk = (parent) => {
    parent.children = parent.children.flatMap((node) => {
      if (isJsx(node) && partials.has(node.name)) {
        const attrs = Object.fromEntries((node.attributes ?? []).filter((a) => a.type === 'mdxJsxAttribute').map((a) => [a.name, attrValue(a) ?? '']));
        const sub = resolvedTree(partials.get(node.name), opts, attrs, [...seen, file]);
        return node.type === 'mdxJsxTextElement' ? phrasingOf(sub.children) : sub.children;
      }
      if ((node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression') && PROPS_EXPRESSION.test(node.value)) {
        const value = String(props[PROPS_EXPRESSION.exec(node.value)[1]] ?? '');
        return node.type === 'mdxTextExpression' ? [{ type: 'text', value }] : [{ type: 'paragraph', children: [{ type: 'text', value }] }];
      }
      if (node.type === 'link' || node.type === 'image' || node.type === 'definition' || isJsx(node)) {
        node.data = { ...node.data, sourceFile: node.data?.sourceFile ?? file };
      }
      if (node.children) walk(node);
      return [node];
    });
  };
  walk(tree);
  return tree;
}

// Step 4. ctx: { resolveLink(url, sourceFile), resolveImage(url, alt, sourceFile), siblingPages() }.
export function toMarkdownForms(tree, ctx, where = 'page') {
  const state = { depth: 1 };
  const nodes = (list, parent) => list.flatMap((n) => convertNode(n, parent));
  const convert = (list, parent) => {
    const out = nodes(list, parent);
    if (FLOW_PARENTS.has(parent?.type)) return flowOf(out);
    if (PHRASING_PARENTS.has(parent?.type)) return phrasingOf(out);
    return out;
  };

  const helpers = (node, parent) => {
    const nodeCtx = {
      ...ctx,
      resolveLink: (url) => ctx.resolveLink(url, node.data?.sourceFile),
      resolveImage: (url, alt) => ctx.resolveImage(url, alt, node.data?.sourceFile),
    };
    return {
      ctx: nodeCtx,
      flow: node.type === 'mdxJsxFlowElement',
      atRoot: parent?.type === 'root',
      depth: state.depth,
      attr: attrOf,
      rawAttr: rawAttrOf,
      text: (n) => toString(n),
      children: (n) => convert(n.children ?? [], { type: n.type === 'mdxJsxFlowElement' ? 'jsxFlow' : 'jsxText' }),
      convert: (nodes) => convert(nodes, { type: node.type === 'mdxJsxFlowElement' ? 'jsxFlow' : 'jsxText' }),
      phrasing: phrasingOf,
      flowOf,
    };
  };

  function convertNode(node, parent) {
    switch (node.type) {
      case 'mdxjsEsm':
        return [];
      case 'mdxFlowExpression':
      case 'mdxTextExpression':
        if (isComment(node)) return [];
        throw new Error(`${where}: the expression {${node.value.trim()}} has no Markdown form; use plain text, an {edition.*} variable or a component`);
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement': {
        const form = formFor(node.name);
        if (!form) throw new Error(`${where}: <${node.name}> has no Markdown form; declare one in lib/markdown-forms.mjs (or import it as a partial)`);
        return form(node, helpers(node, parent));
      }
      case 'containerDirective': {
        const [first, ...rest] = node.children;
        const hasLabel = first?.data?.directiveLabel;
        const body = convert(hasLabel ? rest : node.children, { type: 'blockquote' });
        if (!ADMONITIONS.includes(node.name)) return body;
        return admonition(node.name, hasLabel ? toString(first) : null, body);
      }
      case 'leafDirective':
        return [{ type: 'paragraph', children: [{ type: 'text', value: `::${node.name}` }, ...convert(node.children, { type: 'paragraph' })] }];
      case 'textDirective':
        // Not a directive in WSO2 content: text like "Note:this" (Docusaurus prints it back too).
        return [{ type: 'text', value: `:${node.name}` }, ...(node.children.length ? [{ type: 'text', value: '[' }, ...convert(node.children, { type: 'paragraph' }), { type: 'text', value: ']' }] : [])];
      case 'heading': {
        const last = node.children.at(-1);
        if (last?.type === 'text') last.value = last.value.replace(/\s*\{#[^}]*\}\s*$/, '');
        if (!node.data?.generated) state.depth = node.depth;
        return [{ ...node, children: convert(node.children, node) }];
      }
      case 'link':
        return [{ ...node, url: ctx.resolveLink(node.url, node.data?.sourceFile), children: convert(node.children, node) }];
      case 'definition':
        return [{ ...node, url: ctx.resolveLink(node.url, node.data?.sourceFile) }];
      case 'image': {
        // null: the build inlined the image (a data: URI), so only its alt text is kept.
        const url = ctx.resolveImage(node.url, node.alt ?? '', node.data?.sourceFile);
        if (url === null) return node.alt ? [{ type: 'emphasis', children: [{ type: 'text', value: `Image: ${node.alt}` }] }] : [];
        return [{ ...node, url }];
      }
      case 'html':
        return /^<!--[^]*-->$/.test(node.value.trim()) ? [] : [node];
      case 'paragraph': {
        // An inline element can become a block (a one-line <table>): split the paragraph.
        const parts = nodes(node.children, { type: 'jsxText' });
        if (parts.every((n) => PHRASING.has(n.type))) return [trimEnds({ ...node, children: parts })];
        return flowOf(parts).map((n) => (n.type === 'paragraph' ? trimEnds(n) : n));
      }
      default:
        return node.children ? [{ ...node, children: convert(node.children, node) }] : [node];
    }
  }

  return { ...tree, children: convert(tree.children, tree) };
}

// Shifts every heading down by `by` levels (joined guides nest pages under a title).
export function shiftHeadings(tree, by) {
  const walk = (n) => {
    if (n.type === 'heading') n.depth = Math.min(n.depth + by, 6);
    n.children?.forEach(walk);
  };
  walk(tree);
  return tree;
}

export const hasTitleHeading = (tree) => tree.children.some((n) => n.type === 'heading' && n.depth === 1);

// The page's twin body (no front matter), as a tree in Markdown form.
export function exportPageTree(file, opts, ctx) {
  const where = path.relative(opts.docsDir ?? path.dirname(file), file) || path.basename(file);
  return toMarkdownForms(resolvedTree(file, opts), ctx, where);
}

export function frontMatterBlock(data) {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return `---\n${yaml.dump(clean, { lineWidth: -1, quotingType: '"' })}---\n`;
}

// {edition.*} in front matter titles and descriptions (the HTML build leaves them alone).
export function fillVariables(s, vars) {
  return typeof s === 'string' ? s.replace(/\{edition\.([A-Za-z_]\w*)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
