// The Jinja subset docs-is uses, handled the way the legacy build handled it
// (Migration approach from MkDocs, decision 3): a lookup table, not a full
// Jinja evaluator.
//
// Stage 1 is mkdocs-include-markdown-plugin 6.0.0's `{% include "…" %}`: the
// file's text replaces the directive, every line prefixed with whatever stood
// before the directive on its line, nested includes resolved from the
// included file. Stage 2 is mkdocs-markdownextradata-plugin 0.2.5: the whole
// expanded page rendered by Jinja2 3.1 with DebugUndefined and the default
// whitespace rules. Only these tags exist: if/elif/else/endif, set (also as a
// block), raw, comments. Every condition must be in the product's condition
// table and every variable in its variable table; anything else fails the run.
import fs from 'node:fs';
import path from 'node:path';

export class JinjaError extends Error {}

// ---- Stage 1: includes -------------------------------------------------------

// include-markdown's directive: the "includer indent" is any run of spaces,
// word characters and punctuation before the tag on the same line.
const INCLUDE = /([ \t\f\v\w!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]*?)\{%\s*include\s+(?:"((?:[^"]|(?<=\\)")+)"|'((?:[^']|(?<=\\)')+)')(.*?)\s*%\}/gs;

// Expands every include in `text` (from `file`), recursively. Relative paths
// ('./', '../') resolve from the including file, others from `docsDir`.
// `onInclude(file)` sees every file pulled in. Front matter at the top of an
// included file is dropped (the legacy site printed it as text; see report).
// `read(file)` returns a file's text (the converter's reads apply the override list).
export function expandIncludes(text, file, docsDir, { onInclude = () => {}, onFrontMatter = () => {}, read = (f) => fs.readFileSync(f, 'utf8'), depth = 0 } = {}) {
  if (depth > 20) throw new JinjaError(`${file}: includes nested more than 20 deep`);
  return text.replace(INCLUDE, (m, indent, dq, sq, args) => {
    const name = dq ?? sq;
    if (args.trim()) throw new JinjaError(`${file}: include options "${args.trim()}" have no conversion rule`);
    const target = /^\.\.?\//.test(name) ? path.resolve(path.dirname(file), name) : path.resolve(docsDir, name.replace(/^\/+/, ''));
    if (!fs.existsSync(target)) throw new JinjaError(`${file}: include "${name}" not found`);
    onInclude(target);
    let inc = read(target);
    const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(inc);
    if (fm) {
      onFrontMatter(target, fm[0]);
      inc = inc.slice(fm[0].length);
    }
    inc = expandIncludes(inc, target, docsDir, { onInclude, onFrontMatter, read, depth: depth + 1 });
    const lines = inc.match(/[^\n]*\n|[^\n]+$/g) ?? [''];
    return lines.map((l) => indent + l).join('');
  });
}

// ---- Stage 2: template tokens -----------------------------------------------

// Tokens: { t: 'text', v } | { t: 'out', expr, src } | { t: 'tag', name, args, src, lead, trail, own }.
// For a tag alone on its line, `lead` is the whitespace before it and `trail`
// the newline after it; rendering the tag on its own leaves `lead + trail`,
// the blank line Jinja's default whitespace rules leave behind.
export function tokenize(src, where = 'template') {
  const out = [];
  let i = 0;
  let text = '';
  const pushText = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) { text += src.slice(i); break; }
    text += src.slice(i, open);
    const kind = src[open + 1];
    if (kind !== '{' && kind !== '%' && kind !== '#') { text += '{'; i = open + 1; continue; }
    if (kind === '#') {
      const end = src.indexOf('#}', open + 2);
      if (end < 0) throw new JinjaError(`${where}: unclosed {# comment`);
      i = end + 2;
      continue;
    }
    const close = kind === '{' ? '}}' : '%}';
    const end = findClose(src, open + 2, close);
    if (end < 0) throw new JinjaError(`${where}: unclosed ${kind === '{' ? '{{' : '{%'} at offset ${open}`);
    let inner = src.slice(open + 2, end);
    const trimL = inner.startsWith('-');
    const trimR = inner.endsWith('-');
    if (trimL) inner = inner.slice(1);
    if (trimR) inner = inner.slice(0, -1);
    if (trimL) text = text.replace(/\s+$/, '');
    const raw = src.slice(open, end + 2);
    let next = end + 2;
    if (kind === '{') {
      pushText();
      out.push({ t: 'out', expr: inner.trim(), src: raw });
    } else {
      const m = /^\s*([A-Za-z_]\w*)\s*([\s\S]*?)\s*$/.exec(inner);
      if (!m) throw new JinjaError(`${where}: empty tag ${raw}`);
      const [, name, args] = m;
      if (name === 'raw') {
        const endRaw = /\{%-?\s*endraw\s*-?%\}/g;
        endRaw.lastIndex = next;
        const er = endRaw.exec(src);
        if (!er) throw new JinjaError(`${where}: {% raw %} without {% endraw %}`);
        text += src.slice(next, er.index);
        i = er.index + er[0].length;
        continue;
      }
      // A tag alone on its line takes that line's indentation and newline.
      const lineStart = text.lastIndexOf('\n') + 1;
      const before = text.slice(lineStart);
      const after = /^[ \t]*(\r?\n|$)/.exec(src.slice(next));
      const own = /^[ \t]*$/.test(before) && (out.length > 0 || text.length > 0 || true) && Boolean(after);
      let lead = '';
      let trail = '';
      if (own && !trimL && !trimR) {
        lead = before;
        text = text.slice(0, lineStart);
        trail = after[0];
        next += after[0].length;
      }
      pushText();
      out.push({ t: 'tag', name, args, src: raw, lead, trail, own: own && !trimL && !trimR });
    }
    if (trimR) {
      const ws = /^\s*/.exec(src.slice(next))[0];
      next += ws.length;
    }
    i = next;
  }
  pushText();
  return out;
}

function findClose(src, from, close) {
  let q = null;
  for (let j = from; j < src.length - 1; j++) {
    const c = src[j];
    if (q) {
      if (c === '\\') { j++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === close[0] && src[j + 1] === close[1]) return j;
  }
  return -1;
}

// Nodes: { n: 'text', v } | { n: 'out', expr, src } | { n: 'if', branches: [{ cond, src, tag, body }], end }
//        | { n: 'set', name, expr, tag } | { n: 'setblock', name, body, tag, end }
export function parse(tokens, where = 'template') {
  let pos = 0;
  const block = (stop) => {
    const nodes = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.t === 'text') { nodes.push({ n: 'text', v: tok.v }); pos++; continue; }
      if (tok.t === 'out') { nodes.push({ n: 'out', expr: tok.expr, src: tok.src }); pos++; continue; }
      if (stop.includes(tok.name)) return nodes;
      pos++;
      if (tok.name === 'if') {
        const branches = [{ cond: tok.args, tag: tok, body: block(['elif', 'else', 'endif']) }];
        for (;;) {
          const t = tokens[pos];
          if (!t) throw new JinjaError(`${where}: {% if ${tok.args} %} without {% endif %}`);
          pos++;
          if (t.name === 'endif') { nodes.push({ n: 'if', branches, end: t }); break; }
          branches.push({ cond: t.name === 'else' ? null : t.args, tag: t, body: block(['elif', 'else', 'endif']) });
        }
        continue;
      }
      if (tok.name === 'set') {
        const m = /^([A-Za-z_]\w*)\s*(?:=\s*([\s\S]*))?$/.exec(tok.args);
        if (!m) throw new JinjaError(`${where}: cannot read {% set ${tok.args} %}`);
        if (m[2] !== undefined) { nodes.push({ n: 'set', name: m[1], expr: m[2], tag: tok }); continue; }
        const body = block(['endset']);
        const end = tokens[pos++];
        if (!end) throw new JinjaError(`${where}: {% set ${m[1]} %} without {% endset %}`);
        nodes.push({ n: 'setblock', name: m[1], body, tag: tok, end });
        continue;
      }
      throw new JinjaError(`${where}: Jinja tag {% ${tok.name} %} has no conversion rule`);
    }
    if (stop.length) throw new JinjaError(`${where}: missing {% ${stop.join(' / ')} %}`);
    return nodes;
  };
  return block([]);
}

// ---- Expressions ---------------------------------------------------------------

export class Undefined {
  constructor(name, obj) {
    this.name = name;
    this.obj = obj;
  }

  // DebugUndefined prints itself back.
  toString() {
    if (this.obj === undefined) return `{{ ${this.name} }}`;
    return `{{ no such element: dict object['${this.name}'] }}`;
  }
}
const isUndef = (v) => v instanceof Undefined;

const TOKEN = /\s*(?:("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|(==|!=|>=|<=|[<>()[\],.]))/y;

function lexExpr(src) {
  const toks = [];
  TOKEN.lastIndex = 0;
  let m;
  while (TOKEN.lastIndex < src.length) {
    const at = TOKEN.lastIndex;
    if (!/\S/.test(src.slice(at))) break;
    m = TOKEN.exec(src);
    if (!m) throw new JinjaError(`cannot read the expression "${src}" at "${src.slice(at)}"`);
    if (m[1]) toks.push({ k: 'str', v: m[1].slice(1, -1).replace(/\\(.)/g, '$1') });
    else if (m[2]) toks.push({ k: 'num', v: Number(m[2]) });
    else if (m[3]) toks.push({ k: ['and', 'or', 'not', 'in', 'is', 'if', 'else', 'true', 'false', 'True', 'False', 'none', 'None'].includes(m[3]) ? m[3] : 'name', v: m[3] });
    else toks.push({ k: m[4] });
  }
  return toks;
}

// Expression AST: { k: 'str'|'num'|'bool'|'none', v } | { k: 'name', v: [path…] } | { k: 'list', items }
// | { k: 'not', a } | { k: 'and'|'or', a, b } | { k: 'cmp', op, a, b } | { k: 'test', a, test, neg } | { k: 'cond', a, test, b }
export function parseExpr(src) {
  const toks = lexExpr(src);
  let p = 0;
  const peek = (k) => toks[p]?.k === k;
  const take = (k) => {
    if (!peek(k)) throw new JinjaError(`expected "${k}" in "${src}"`);
    return toks[p++];
  };
  const primary = () => {
    const t = toks[p++];
    if (!t) throw new JinjaError(`unexpected end of "${src}"`);
    if (t.k === 'str' || t.k === 'num') return t;
    if (t.k === 'true' || t.k === 'True') return { k: 'bool', v: true };
    if (t.k === 'false' || t.k === 'False') return { k: 'bool', v: false };
    if (t.k === 'none' || t.k === 'None') return { k: 'none', v: null };
    if (t.k === '(') { const e = ternary(); take(')'); return e; }
    if (t.k === '[') {
      const items = [];
      while (!peek(']')) { items.push(ternary()); if (peek(',')) p++; }
      take(']');
      return { k: 'list', items };
    }
    if (t.k === 'name') {
      const parts = [t.v];
      while (peek('.')) { p++; parts.push(take('name').v); }
      return { k: 'name', v: parts };
    }
    throw new JinjaError(`unexpected "${t.v ?? t.k}" in "${src}"`);
  };
  const comparison = () => {
    let a = primary();
    for (;;) {
      const t = toks[p];
      if (t && ['==', '!=', '>', '<', '>=', '<='].includes(t.k)) { p++; a = { k: 'cmp', op: t.k, a, b: primary() }; continue; }
      if (t?.k === 'in') { p++; a = { k: 'cmp', op: 'in', a, b: primary() }; continue; }
      if (t?.k === 'not' && toks[p + 1]?.k === 'in') { p += 2; a = { k: 'cmp', op: 'not in', a, b: primary() }; continue; }
      if (t?.k === 'is') {
        p++;
        const neg = peek('not') ? (p++, true) : false;
        const test = take('name').v;
        if (test !== 'defined' && test !== 'undefined') throw new JinjaError(`test "is ${test}" has no rule in "${src}"`);
        a = { k: 'test', a, test, neg };
        continue;
      }
      return a;
    }
  };
  const not = () => (peek('not') ? (p++, { k: 'not', a: not() }) : comparison());
  const and = () => { let a = not(); while (peek('and')) { p++; a = { k: 'and', a, b: not() }; } return a; };
  const or = () => { let a = and(); while (peek('or')) { p++; a = { k: 'or', a, b: and() }; } return a; };
  const ternary = () => {
    const a = or();
    if (peek('if')) {
      p++;
      const test = or();
      take('else');
      return { k: 'cond', a, test, b: ternary() };
    }
    return a;
  };
  const e = ternary();
  if (p !== toks.length) throw new JinjaError(`unexpected "${toks[p].v ?? toks[p].k}" in "${src}"`);
  return e;
}

// Names an expression reads (dotted paths joined).
export function exprNames(ast, out = new Set()) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.k === 'name') out.add(ast.v.join('.'));
  for (const key of ['a', 'b', 'test']) if (ast[key] && typeof ast[key] === 'object') exprNames(ast[key], out);
  for (const it of ast.items ?? []) exprNames(it, out);
  return out;
}

const truthy = (v) => !(v === false || v === null || v === undefined || v === '' || v === 0 || isUndef(v) || (Array.isArray(v) && !v.length));

function lookup(scope, parts) {
  let v = scope.has(parts[0]) ? scope.get(parts[0]) : new Undefined(parts[0]);
  for (const part of parts.slice(1)) {
    if (isUndef(v)) throw new JinjaError(`"${parts.join('.')}" reads an attribute of an undefined value (the legacy build fails here)`);
    if (v && typeof v === 'object' && part in v) v = v[part];
    else v = new Undefined(part, v);
  }
  return v;
}

// Python ordering for the values the conditions compare (strings, numbers).
function order(op, a, b, src) {
  if (isUndef(a) || isUndef(b)) throw new JinjaError(`"${src}" compares an undefined value (the legacy build fails here)`);
  if (typeof a !== typeof b) throw new JinjaError(`"${src}" compares a ${typeof a} with a ${typeof b}`);
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    default: return a <= b;
  }
}

const same = (a, b) => (isUndef(a) || isUndef(b) ? isUndef(a) && isUndef(b) : a === b);

export function evalExpr(ast, scope, src = '') {
  switch (ast.k) {
    case 'str': case 'num': case 'bool': case 'none': return ast.v;
    case 'name': return lookup(scope, ast.v);
    case 'list': return ast.items.map((x) => evalExpr(x, scope, src));
    case 'not': return !truthy(evalExpr(ast.a, scope, src));
    case 'and': { const a = evalExpr(ast.a, scope, src); return truthy(a) ? evalExpr(ast.b, scope, src) : a; }
    case 'or': { const a = evalExpr(ast.a, scope, src); return truthy(a) ? a : evalExpr(ast.b, scope, src); }
    case 'test': {
      const defined = !isUndef(evalExpr(ast.a, scope, src));
      const r = ast.test === 'defined' ? defined : !defined;
      return ast.neg ? !r : r;
    }
    case 'cond': return truthy(evalExpr(ast.test, scope, src)) ? evalExpr(ast.a, scope, src) : evalExpr(ast.b, scope, src);
    case 'cmp': {
      const a = evalExpr(ast.a, scope, src);
      const b = evalExpr(ast.b, scope, src);
      if (ast.op === '==') return same(a, b);
      if (ast.op === '!=') return !same(a, b);
      if (ast.op === 'in' || ast.op === 'not in') {
        let r;
        if (Array.isArray(b)) r = b.some((x) => same(x, a));
        else if (typeof b === 'string' && typeof a === 'string') r = b.includes(a);
        else throw new JinjaError(`"${src}" tests membership in a ${isUndef(b) ? 'undefined value' : typeof b}`);
        return ast.op === 'in' ? r : !r;
      }
      return order(ast.op, a, b, src);
    }
    default: throw new JinjaError(`no rule for expression node ${ast.k}`);
  }
}

// What `{{ value }}` prints (Python str()).
export function printValue(v) {
  if (isUndef(v)) return v.toString();
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v === null || v === undefined) return 'None';
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === 'string' ? `'${x}'` : printValue(x))).join(', ')}]`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export const normalizeCondition = (c) => c.replace(/\s+/g, ' ').trim();
export const truthyValue = truthy;

// The condition and variable tables (product config) as a checker: every
// condition string must be listed, every name an expression reads must have
// a variable rule. Parsed expressions are cached.
export class JinjaTables {
  constructor({ conditions, variables }) {
    this.conditions = new Set(conditions.map(normalizeCondition));
    this.variables = variables;
    this.parsed = new Map();
    this.used = { conditions: new Map(), variables: new Map() };
  }

  condition(src, where) {
    const key = normalizeCondition(src);
    if (!this.conditions.has(key)) throw new JinjaError(`${where}: condition {% if ${key} %} is not in the product's condition table`);
    this.used.conditions.set(key, (this.used.conditions.get(key) ?? 0) + 1);
    return this.expr(key, where);
  }

  expr(src, where) {
    if (!this.parsed.has(src)) {
      let ast;
      try { ast = parseExpr(src); } catch (err) { throw new JinjaError(`${where}: ${err.message}`); }
      this.parsed.set(src, ast);
    }
    return this.parsed.get(src);
  }

  // A {{ … }} output or a set's right-hand side: names must be known.
  output(src, where, localNames = new Set()) {
    const ast = this.expr(src, where);
    for (const name of exprNames(ast)) {
      const top = name.split('.')[0];
      if (localNames.has(top)) continue;
      if (!(name in this.variables) && !(top in this.variables)) throw new JinjaError(`${where}: variable {{ ${name} }} is not in the product's variable table`);
      this.used.variables.set(name, (this.used.variables.get(name) ?? 0) + 1);
    }
    return ast;
  }

  rule(name) {
    return this.variables[name] ?? this.variables[name.split('.')[0]] ?? null;
  }
}
