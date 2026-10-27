// The per-Edition check of a page with Edition markers: parsed as MDX, the
// markers applied for one Edition, the readable words must be exactly those
// of the page converted for that Edition alone. A marker in the wrong place
// (content leaking into or out of an Edition, a heading under the wrong
// marker) changes the words, so this is what catches marker mistakes before
// any build.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import { escapeMarkdownHeadingIds, unwrapMdxCodeBlocks } from '@docusaurus/utils';
import { matches } from '../../lib/edition.mjs';
import { words } from './verify.mjs';

const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx).use(remarkDirective).use(remarkGfm);

export function parseMdx(text) {
  return parser.parse(escapeMarkdownHeadingIds(unwrapMdxCodeBlocks(text)));
}

const markerOf = (node) => Object.fromEntries((node.attributes ?? []).filter((a) => a.type === 'mdxJsxAttribute').map((a) => [a.name, a.value]));

// The words one Edition reads in a parsed page; {edition.*} values from `vars`.
export function editionWords(tree, edition, vars = () => undefined) {
  const out = [];
  const visit = (node) => {
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === 'Edition') {
      if (!matches(edition, markerOf(node))) return;
    }
    if (node.type === 'mdxjsEsm') return;
    if ((node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') && /^\s*\/\*/.test(node.value)) return; // a comment
    if (typeof node.value === 'string' && ['text', 'inlineCode', 'code', 'mdxTextExpression', 'mdxFlowExpression'].includes(node.type)) {
      out.push(node.value.replace(/^\s*edition\.(\w+)\s*$|\{edition\.(\w+)\}/g, (m, a, b) => vars(a ?? b) ?? m));
    }
    for (const c of node.children ?? []) visit(c);
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') out.push(' ');
  };
  visit(tree);
  return words(out.join(' '));
}

const forCheck = (mdx) => mdx.replace(/\u0004\d+\u0004/g, '#').replace(/[ \t]*\{#[^}\s]+\}[ \t]*$/gm, '');

// { ok, failures: [{ context, missing, extra }] }. `clean` maps each context
// id to the page converted for that context alone.
export function checkEditions(markedMdx, contexts, clean, valueOf = () => undefined) {
  let tree;
  try {
    tree = parseMdx(forCheck(markedMdx));
  } catch (err) {
    return { ok: false, failures: [{ context: '*', message: `does not parse: ${String(err.reason ?? err.message).split('\n')[0]}` }] };
  }
  const failures = [];
  for (const c of contexts) {
    if (!c.built || !clean.has(c.id)) continue;
    let want;
    try {
      want = editionWords(parseMdx(forCheck(clean.get(c.id))), c.edition, (n) => valueOf(c.id, n));
    } catch {
      continue; // the single-Edition text itself does not parse; the compile check reports it
    }
    const got = editionWords(tree, c.edition, (n) => valueOf(c.id, n));
    if (got.join(' ') !== want.join(' ')) {
      const firstDiff = got.findIndex((w, i) => w !== want[i]);
      const at = firstDiff < 0 ? Math.min(got.length, want.length) : firstDiff;
      failures.push({ context: c.id, at, got: got.slice(Math.max(0, at - 5), at + 8).join(' '), want: want.slice(Math.max(0, at - 5), at + 8).join(' '), lengths: [got.length, want.length] });
    }
  }
  return { ok: failures.length === 0, failures };
}
