// One page, several Edition contexts (Migration approach from MkDocs,
// decision 6): a Jinja page renders differently in Cloud and in each
// self-hosted version. This module renders it once per context and keeps
// what the contexts share, marking the rest as regions that become
// <Edition> markers:
//   - a block-level {% if %} (every tag alone on its line) whose branches
//     differ between contexts becomes one region per branch;
//   - any other difference (inline conditions, variables with different
//     values, different page sources) is found by comparing the rendered
//     blocks of each context, and only the blocks that differ become regions.
// Regions travel through the Markdown converter as sentinel lines
// (\u0006<id>\u0006 … \u0006/<id>\u0006); the converter tracks which contexts are
// active at every point, and `markersToJsx` turns them into <Edition> elements.
import { evalExpr, parse, printValue, tokenize, truthyValue, JinjaError } from './jinja.mjs';
import { matches } from '../../lib/edition.mjs';
import { BLOCK_TAGS, VOID_TAGS } from './mdx.mjs';

export const SENTINEL_LINE = /^([ \t>]*)\u0006(\/?)(\d+)\u0006[ \t]*$/;
export const SENTINEL_ANY = /\u0006\/?\d+\u0006/;

// Regions of one page: id → { set (context ids), parent id }.
export class Regions {
  constructor(contexts, pageSet) {
    this.contexts = contexts; // all contexts of the branch, in order
    this.byId = new Map(contexts.map((c) => [c.id, c]));
    this.list = [];
    this.pageSet = new Set(pageSet);
  }

  add(set, parent = null) {
    this.list.push({ set: new Set(set), parent });
    return this.list.length - 1;
  }

  get(id) {
    return this.list[id];
  }

  parentSet(id) {
    const p = this.list[id].parent;
    return p === null || p === undefined ? this.pageSet : this.list[p].set;
  }

  open(id, indent = '') {
    return `${indent}\u0006${id}\u0006`;
  }

  close(id, indent = '') {
    return `${indent}\u0006/${id}\u0006`;
  }
}

// The marker that shows a block in exactly the contexts of `set` among those
// of `parent`. Built contexts must match exactly; virtual ones (a version
// used only to tell `selfHostedFrom="next"` apart) should, if possible.
const CANDIDATES = [
  { only: 'cloud' },
  { only: 'self-hosted' },
  { selfHostedFrom: 'next' },
  { only: 'self-hosted', selfHostedFrom: 'next' },
];

export function markerFor(set, parent, contexts) {
  const inParent = contexts.filter((c) => parent.has(c.id));
  const want = (c) => set.has(c.id);
  const fits = (m, cs) => cs.every((c) => matches(c.edition, m) === want(c));
  const built = inParent.filter((c) => c.built);
  if (built.every(want) && inParent.every(want)) return { marker: null, show: true };
  if (!built.some(want)) return { marker: null, show: false };
  for (const m of CANDIDATES) if (fits(m, inParent)) return { marker: m, show: true };
  if (built.every(want)) return { marker: null, show: true };
  for (const m of CANDIDATES) if (fits(m, built)) return { marker: m, show: true };
  return null;
}

export const markerAttrs = (m) => [m.only ? `only="${m.only}"` : '', m.selfHostedFrom ? `selfHostedFrom="${m.selfHostedFrom}"` : ''].filter(Boolean).join(' ');

// ---- Rendering a template in several contexts ----------------------------------

// A context's state while rendering one page: its scope (globals plus sets).
export function makeScope(globals) {
  return new Map(Object.entries(globals));
}

// Renders `nodes` in one context to text, with Jinja's default whitespace:
// the newline after a tag belongs to what follows it, the indentation before
// it to what precedes it. `env.out(node, scope)` prints an output node,
// `env.value(expr, scope)` evaluates a set, `env.branch(ifNode, scope)` picks
// the branch a context takes (-1 for none).
export function renderFlat(nodes, scope, env) {
  let s = '';
  for (const node of nodes) {
    if (node.n === 'text') s += node.v;
    else if (node.n === 'out') s += env.out(node, scope);
    else if (node.n === 'set') { scope.set(node.name, env.value(node.expr, scope)); s += node.tag.lead + node.tag.trail; }
    else if (node.n === 'setblock') {
      scope.set(node.name, node.tag.trail + renderFlat(node.body, scope, env) + node.end.lead);
      s += node.tag.lead + node.end.trail;
    } else if (node.n === 'if') s += renderIfFlat(node, env.branch(node, scope), scope, env);
  }
  return s;
}

function renderIfFlat(node, k, scope, env) {
  if (k < 0) return node.branches[0].tag.lead + node.end.trail;
  const b = node.branches[k];
  const next = node.branches[k + 1]?.tag ?? node.end;
  return node.branches[0].tag.lead + b.tag.trail + renderFlat(b.body, scope, env) + next.lead + node.end.trail;
}

const blockLevel = (node) => node.branches.every((b) => b.tag.own) && node.end.own;

// Renders `nodes` shared by the contexts in `ids` (each with its scope) into
// text with region sentinels.
export function renderStructured(nodes, ids, scopes, env, regions, parent = null) {
  const parts = [];
  let run = new Map(ids.map((id) => [id, '']));
  const flush = () => {
    parts.push(mergeTexts(ids, run, regions, parent));
    run = new Map(ids.map((id) => [id, '']));
  };
  const add = (id, s) => run.set(id, run.get(id) + s);
  const addAll = (s) => { for (const id of ids) add(id, s); };
  for (const node of nodes) {
    if (node.n === 'text') { addAll(node.v); continue; }
    if (node.n === 'out') { for (const id of ids) add(id, env.out(node, scopes.get(id))); continue; }
    if (node.n === 'set' || node.n === 'setblock') {
      for (const id of ids) add(id, renderFlat([node], scopes.get(id), env));
      continue;
    }
    const taken = new Map(ids.map((id) => [id, env.branch(node, scopes.get(id))]));
    const ks = new Set(taken.values());
    const structured = blockLevel(node) && !env.flatOnly;
    if (ks.size === 1 && [...ks][0] >= 0 && hasBlockIf(node.branches[[...ks][0]].body) && !env.flatOnly) {
      // The same branch everywhere, with block-level conditions of its own.
      const k = [...ks][0];
      const b = node.branches[k];
      const next = node.branches[k + 1]?.tag ?? node.end;
      addAll(node.branches[0].tag.lead + b.tag.trail);
      flush();
      parts.push(renderStructured(b.body, ids, scopes, env, regions, parent));
      addAll(next.lead + node.end.trail);
      continue;
    }
    if (ks.size === 1 || !structured) {
      // Same branch everywhere, or an inline condition: each context renders
      // its own text; blocks that differ are found when the run is flushed.
      for (const id of ids) add(id, renderIfFlat(node, taken.get(id), scopes.get(id), env));
      continue;
    }
    flush();
    node.branches.forEach((b, k) => {
      const sub = ids.filter((id) => taken.get(id) === k);
      if (!sub.length) return;
      const id = regions.add(sub, parent);
      const body = renderStructured(b.body, sub, scopes, env, regions, id);
      if (!body.trim()) return;
      const indent = firstIndent(body);
      parts.push(`${regions.open(id, indent)}\n${body.replace(/\n?$/, '\n')}${regions.close(id, indent)}\n`);
    });
  }
  flush();
  return parts.join('');
}

const hasBlockIf = (nodes) => nodes.some((n) => n.n === 'if' && (blockLevel(n) || n.branches.some((b) => hasBlockIf(b.body))));

function firstIndent(text) {
  const line = text.split('\n').find((l) => l.trim() && !SENTINEL_LINE.test(l));
  return line ? /^[ \t]*/.exec(line)[0] : '';
}

// ---- Merging texts that differ: aligned blocks -------------------------------------

// Splits Markdown into blocks at blank lines, never inside a fenced code
// block or an open raw HTML block, and keeping a container (admonition, tab,
// list item) together with the indented blocks that follow it.
export function splitBlocks(text) {
  const lines = text.split('\n');
  const chunks = [];
  let cur = [];
  let fence = null;
  let html = null; // { tag, depth }
  const end = () => {
    while (cur.length && !cur[cur.length - 1].trim()) cur.pop();
    if (cur.length) chunks.push(cur);
    cur = [];
  };
  for (const line of lines) {
    if (fence) {
      cur.push(line);
      const t = line.trim();
      if (t.startsWith(fence) && /^(`{3,}|~{3,})\s*$/.test(t)) fence = null;
      continue;
    }
    if (html) {
      cur.push(line);
      html.depth += htmlDepth(line, html.tag);
      if (html.depth <= 0) html = null;
      continue;
    }
    if (!line.trim()) { end(); continue; }
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f && !line.slice(f.index + f[0].length).includes('`')) {
      cur.push(line);
      fence = f[1];
      continue;
    }
    const h = /^\s*<([A-Za-z][A-Za-z0-9]*)(?=[\s>/]|$)/.exec(line);
    if (h && BLOCK_TAGS.has(h[1].toLowerCase()) && !VOID_TAGS.has(h[1].toLowerCase())) {
      const d = htmlDepth(line, h[1]);
      cur.push(line);
      if (d > 0) html = { tag: h[1], depth: d };
      continue;
    }
    cur.push(line);
  }
  end();
  // A chunk keeps the more indented chunks after it (its container body).
  const indentOf = (l) => /^ */.exec(l.replace(/\t/g, '    '))[0].length;
  const blocks = [];
  for (const c of chunks) {
    const prev = blocks[blocks.length - 1];
    if (prev && indentOf(c[0]) > prev.indent) prev.lines.push('', ...c);
    else blocks.push({ indent: indentOf(c[0]), lines: [...c] });
  }
  return blocks.map((b) => b.lines.join('\n'));
}

function htmlDepth(line, tag) {
  let d = 0;
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*?(/?)>`, 'gi');
  for (const m of line.matchAll(re)) {
    if (m[1]) d--;
    else if (!m[2]) d++;
  }
  return d;
}

// Longest common subsequence of two string arrays, as index pairs.
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

// Aligns the block lists of several contexts: [{ text, set }] in reading order.
export function alignBlocks(ids, blocksById) {
  let merged = blocksById.get(ids[0]).map((text) => ({ text, set: new Set([ids[0]]) }));
  for (const id of ids.slice(1)) {
    const mine = blocksById.get(id);
    if (mine.length * merged.length > 4e6) {
      // Too big to align: keep them apart.
      merged = [...merged, ...mine.map((text) => ({ text, set: new Set([id]) }))];
      continue;
    }
    const pairs = lcs(merged.map((x) => x.text), mine);
    const out = [];
    let i = 0;
    let j = 0;
    for (const [pi, pj] of [...pairs, [merged.length, mine.length]]) {
      while (i < pi) out.push(merged[i++]);
      while (j < pj) out.push({ text: mine[j++], set: new Set([id]) });
      if (pi < merged.length) {
        merged[pi].set.add(id);
        out.push(merged[pi]);
        i = pi + 1;
        j = pj + 1;
      }
    }
    merged = out;
  }
  return merged;
}

// Text that differs between contexts: shared blocks as they are, the rest as
// regions (one per distinct block).
export function mergeTexts(ids, textById, regions, parent = null) {
  const vals = new Set(ids.map((id) => textById.get(id)));
  if (vals.size === 1) return [...vals][0];
  // Keep the run's outer whitespace so the text around stays separated.
  const lead = commonPrefixWs(ids.map((id) => textById.get(id)), true);
  const trail = commonPrefixWs(ids.map((id) => textById.get(id)), false);
  const blocks = new Map(ids.map((id) => [id, splitBlocks(textById.get(id))]));
  const aligned = alignBlocks(ids, blocks);
  const all = new Set(ids);
  const out = [];
  for (let k = 0; k < aligned.length; k++) {
    const b = aligned[k];
    if (b.set.size === all.size) { out.push(b.text); continue; }
    // Neighbouring blocks with the same contexts share one region.
    const group = [b.text];
    while (k + 1 < aligned.length && aligned[k + 1].set.size !== all.size && sameSet(aligned[k + 1].set, b.set)) group.push(aligned[++k].text);
    const id = regions.add(b.set, parent);
    const body = group.join('\n\n');
    const indent = /^[ \t]*/.exec(group[0])[0];
    out.push(`${regions.open(id, indent)}\n${body}\n${regions.close(id, indent)}`);
  }
  return `${lead}${out.join('\n\n')}${trail}`;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function commonPrefixWs(texts, front) {
  const ws = texts.map((t) => (front ? /^\s*/.exec(t)[0] : /\s*$/.exec(t)[0]));
  const nl = Math.min(...ws.map((w) => (w.match(/\n/g) ?? []).length));
  return nl ? '\n'.repeat(Math.min(nl, 2)) : '';
}

// ---- Sentinels → <Edition> --------------------------------------------------------

// Turns the sentinel lines in converted MDX into <Edition> elements (blank
// lines around, so Markdown inside them stays Markdown). A region shown in
// every built context needs no marker; one shown in none is dropped. Returns
// null when a region has no marker that fits (the caller falls back).
export function markersToJsx(mdx, regions) {
  const lines = mdx.split('\n');
  const out = [];
  const stack = [];
  let dropping = 0;
  for (const line of lines) {
    const m = SENTINEL_LINE.exec(line);
    if (!m) {
      if (!dropping) out.push(line);
      continue;
    }
    const [, prefix, closing, idStr] = m;
    const id = Number(idStr);
    const reg = regions.get(id);
    if (!closing) {
      const r = markerFor(reg.set, regions.parentSet(id), regions.contexts);
      if (!r) return null;
      stack.push({ id, r });
      if (!r.show) dropping++;
      else if (r.marker && !dropping) out.push(prefix.replace(/\s+$/, ''), `${prefix}<Edition ${markerAttrs(r.marker)}>`, prefix.replace(/\s+$/, ''));
    } else {
      const top = stack.pop();
      if (!top || top.id !== id) return null;
      if (!top.r.show) dropping--;
      else if (top.r.marker && !dropping) out.push(prefix.replace(/\s+$/, ''), `${prefix}</Edition>`, prefix.replace(/\s+$/, ''));
    }
  }
  if (stack.length) return null;
  return wrapVariants(out.join('\n').replace(/\n{3,}/g, '\n\n')).mdx;
}

// ---- Edition variants --------------------------------------------------------------

const OPEN_LINE = /^([ \t>]*)<(Edition|Variants)(?:\s([^>]*))?>[ \t]*$/;
const CLOSE_LINE = /^([ \t>]*)<\/(Edition|Variants)>[ \t]*$/;

// The block-level <Edition> and <Variants> elements of converted MDX (each tag
// alone on its line, as markersToJsx writes them): { start, end, prefix, name,
// only, plain, parent } in document order, `parent` the index of the
// enclosing element or -1.
function markerBlocks(lines) {
  const blocks = [];
  const stack = [];
  lines.forEach((line, i) => {
    const o = OPEN_LINE.exec(line);
    if (o) {
      const attrs = o[3] ?? '';
      const only = /only="([^"]+)"/.exec(attrs)?.[1] ?? null;
      blocks.push({ start: i, end: -1, prefix: o[1], name: o[2], only, plain: !/selfHostedFrom=/.test(attrs), parent: stack.at(-1) ?? -1 });
      stack.push(blocks.length - 1);
      return;
    }
    const c = CLOSE_LINE.exec(line);
    if (c && stack.length && blocks[stack.at(-1)].name === c[2]) blocks[stack.pop()].end = i;
  });
  return blocks.filter((b) => b.end >= 0);
}

// Adjacent sibling forms, one Cloud only and one Self-hosted only, outside any
// <Variants>: [index of the first, index of the second] into `blocks`.
function adjacentPairs(blocks, lines) {
  const inVariants = (b) => {
    for (let p = b.parent; p >= 0; p = blocks[p].parent) if (blocks[p].name === 'Variants') return true;
    return false;
  };
  const blank = (prefix) => (l) => l.trim() === '' || l.trim() === prefix.trim();
  const pairs = [];
  for (let k = 0; k < blocks.length; k++) {
    const a = blocks[k];
    if (a.name !== 'Edition' || inVariants(a)) continue;
    const next = blocks.findIndex((b, j) => j > k && b.parent === a.parent && b.start > a.end);
    const b = blocks[next];
    if (!b || b.name !== 'Edition' || b.prefix !== a.prefix || !lines.slice(a.end + 1, b.start).every(blank(a.prefix))) continue;
    if (new Set([a.only, b.only]).size === 2 && [a.only, b.only].every((x) => x === 'cloud' || x === 'self-hosted')) pairs.push([k, next]);
  }
  return pairs;
}

// Adjacent Cloud and Self-hosted alternatives not yet in <Variants>, which
// Cloud would show twice (the second as a Self-hosted addition).
export const adjacentAlternatives = (mdx) => {
  const lines = mdx.split('\n');
  return adjacentPairs(markerBlocks(lines), lines).length;
};

// Wraps each adjacent Cloud/Self-hosted pair in <Variants> (an Edition
// variant: each Edition shows only its own form), so Cloud shows its own form
// instead of both. A Cloud form pairs with the plain Self-hosted form next to
// it first (after it, then before it), else with one from a version; every
// form is in one pair at most. A lone Self-hosted form stays a Self-hosted
// addition. → { mdx, count }
export function wrapVariants(mdx) {
  const lines = mdx.split('\n');
  const blocks = markerBlocks(lines);
  const pairs = adjacentPairs(blocks, lines);
  const used = new Set();
  const chosen = [];
  const partner = (k, plain) => pairs.find(([x, y]) => (x === k || y === k) && !used.has(x === k ? y : x) && blocks[x === k ? y : x].plain === plain);
  for (let k = 0; k < blocks.length; k++) {
    if (blocks[k].only !== 'cloud' || used.has(k)) continue;
    const after = (p) => p && p[0] === k;
    const options = [pairs.find((p) => after(p) && !used.has(p[1]) && blocks[p[1]].plain), partner(k, true), partner(k, false)].filter(Boolean);
    const pick = options[0];
    if (!pick) continue;
    used.add(pick[0]);
    used.add(pick[1]);
    chosen.push(pick);
  }
  // From the end, so earlier line numbers stay valid.
  for (const [x, y] of chosen.sort((p, q) => q[0] - p[0])) {
    const first = blocks[Math.min(x, y)];
    const last = blocks[Math.max(x, y)];
    const gap = first.prefix.replace(/\s+$/, '');
    lines.splice(last.end + 1, 0, gap, `${first.prefix}</Variants>`);
    lines.splice(first.start, 0, `${first.prefix}<Variants>`, gap);
  }
  return { mdx: lines.join('\n').replace(/\n{3,}/g, '\n\n'), count: chosen.length };
}

// A Self-hosted-only page whose Cloud counterpart is the Cloud-only page in
// the same navigation slot (the same nav labels down to the page, in the two
// legacy trees). `pages`: { target, marker: 'cloud' | 'self-hosted' | null,
// navPath, inNav }. A slot with more than one page of either kind is
// reported, never guessed. → { counterparts: Map(self-hosted target → Cloud
// target), ambiguous: [{ slot, selfHosted, cloud }] }
export function cloudCounterpartsOf(pages) {
  const slots = new Map();
  for (const p of pages) {
    if (!p.inNav || (p.marker !== 'cloud' && p.marker !== 'self-hosted') || !p.navPath?.length) continue;
    const slot = p.navPath.join(' > ');
    if (!slots.has(slot)) slots.set(slot, { cloud: [], 'self-hosted': [] });
    slots.get(slot)[p.marker].push(p.target);
  }
  const counterparts = new Map();
  const ambiguous = [];
  for (const [slot, s] of slots) {
    if (!s.cloud.length || !s['self-hosted'].length) continue;
    if (s.cloud.length === 1 && s['self-hosted'].length === 1) counterparts.set(s['self-hosted'][0], s.cloud[0]);
    else ambiguous.push({ slot, selfHosted: s['self-hosted'], cloud: s.cloud });
  }
  // The same nav label in different slots: a possible counterpart, for a person to decide.
  const byLabel = new Map();
  for (const [slot, s] of slots) {
    const label = slot.split(' > ').at(-1).toLowerCase();
    if (!byLabel.has(label)) byLabel.set(label, { cloud: [], 'self-hosted': [], slots: new Set() });
    const l = byLabel.get(label);
    l.slots.add(slot);
    for (const k of ['cloud', 'self-hosted']) l[k].push(...s[k].filter((t) => !counterparts.has(t) && ![...counterparts.values()].includes(t)));
  }
  const possible = [...byLabel.values()].filter((l) => l.slots.size > 1 && l.cloud.length && l['self-hosted'].length).map((l) => ({ selfHosted: l['self-hosted'], cloud: l.cloud }));
  return { counterparts, ambiguous, possible };
}

// The lines one context sees: sentinel regions that don't include it removed.
export function filterLines(lines, regions, ctxId) {
  const out = [];
  const stack = [];
  for (const line of lines) {
    const m = SENTINEL_LINE.exec(line);
    if (m) {
      if (m[2]) stack.pop();
      else stack.push(regions.get(Number(m[3])).set.has(ctxId));
      continue;
    }
    if (stack.every(Boolean)) out.push(line);
  }
  return out;
}

export { JinjaError, parse, tokenize, evalExpr, truthyValue, printValue };
