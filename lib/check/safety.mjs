// The content-safety check (Build and quality checks, Content safety): a Doc
// space carries no code, since MDX runs in the build and in readers'
// browsers. It reads files only, from the MDX syntax tree the other checks
// use (lib/check/content.mjs), so `wso2-docs check`, `wso2-docs bundle` and
// intake (on an unpacked bundle) run the same rules:
//   - imports only from module ids in standards/components.yaml and relative
//     .mdx partials inside the Doc space; no export at all;
//   - `{…}` holds only literals (strings, numbers, booleans, null, arrays and
//     objects of those), `{edition.<name>}` variables (replaced before
//     compile) and `require("<relative path inside the Doc space>")`, with
//     `.default` on it for images;
//   - no .js, .jsx, .ts, .tsx, .mjs or .cjs file; no <script>, on*=
//     attribute, javascript: URL or dangerouslySetInnerHTML; an <iframe>
//     only with a literal https src on a host in standards/iframe-hosts.yaml,
//     and no srcdoc, <object>, <embed> or <frame>, which would bypass that.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { parse as parseHtml } from 'node-html-parser';
import { visit } from 'unist-util-visit';
import { STANDARDS_DIR } from '../standards.mjs';

export const SCRIPT_FILE = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i;
const PARTIAL = /\.mdx?$/;
// Attributes that start with "on" but are not event handlers: <Edition only=…>.
const NOT_HANDLERS = new Set(['only']);
const EMBEDS = new Set(['object', 'embed', 'frame', 'frameset', 'applet']);

let cached;
// The module ids pages may import (each component's `imports` in the
// catalogue) and the iframe hosts.
export function loadSafetyRules() {
  if (cached) return cached;
  const read = (name) => yaml.load(fs.readFileSync(path.join(STANDARDS_DIR, name), 'utf8'));
  const modules = new Set(read('components.yaml').components.flatMap((c) => c.imports ?? []));
  const iframeHosts = read('iframe-hosts.yaml').hosts.map((h) => String(h.host).toLowerCase());
  cached = { modules, iframeHosts };
  return cached;
}

const isJavascriptUrl = (url) => /^javascript:/i.test(String(url ?? '').replace(/[\s\0-\x1f]+/g, ''));
const describe = (n) => ({
  CallExpression: 'a function call', ArrowFunctionExpression: 'a function', FunctionExpression: 'a function',
  MemberExpression: 'member access', Identifier: `the variable ${n.name}`, TemplateLiteral: 'a template literal with an expression',
  JSXElement: 'a JSX element', JSXFragment: 'a JSX fragment', NewExpression: 'a constructor call',
}[n.type] ?? `a ${n.type}`);

// Findings for one Doc space. `ctx` is lib/check/content.mjs's loadContext.
export function checkContentSafety(ctx, rules = loadSafetyRules()) {
  const out = [];
  const add = (file, node, message) => out.push({ level: 'error', file, line: node?.position?.start?.line ?? 1, message });
  for (const file of ctx.files) {
    if (SCRIPT_FILE.test(file)) add(file, null, `${path.posix.basename(file)} is a script file: a Doc space holds no code (pages, partials, data and assets only)`);
  }
  for (const doc of ctx.docs) {
    const tree = ctx.ast(doc);
    if (!tree) {
      add(doc.file, null, 'The page does not parse as MDX, so it cannot be checked for code (the compile check has the error)');
      continue;
    }
    checkTree(tree, path.join(ctx.root, doc.file), ctx.root, rules, (node, message) => add(doc.file, node, message));
  }
  return out;
}

// A relative path inside the Doc space: `./` or `../`, no loader syntax.
function inside(spec, fileAbs, root) {
  if (typeof spec !== 'string' || !/^\.\.?\//.test(spec) || /[!?#]/.test(spec)) return false;
  const rel = path.relative(root, path.resolve(path.dirname(fileAbs), spec));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function checkTree(tree, fileAbs, root, rules, report) {
  // Why an estree expression is not allowed, or null when it is.
  const requireProblem = (n) => {
    const arg = n.arguments[0];
    if (n.arguments.length !== 1 || arg.type !== 'Literal' || typeof arg.value !== 'string') return 'require() takes one string: a relative path inside the Doc space';
    if (!/^\.\.?\//.test(arg.value) || /[!?#]/.test(arg.value)) return `require(${JSON.stringify(arg.value)}) is not a relative path inside the Doc space`;
    if (!inside(arg.value, fileAbs, root)) return `require(${JSON.stringify(arg.value)}) points outside the Doc space`;
    return null;
  };
  const isRequire = (n) => n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require';
  const literal = (n) => {
    switch (n.type) {
      case 'Literal':
        return n.regex || n.bigint !== undefined ? `${n.raw} is not a plain literal` : null;
      case 'TemplateLiteral':
        return n.expressions.length ? 'a template literal with an expression' : null;
      case 'UnaryExpression':
        return (n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number' ? null : `the ${n.operator} operator`;
      case 'ArrayExpression':
        for (const e of n.elements) {
          if (!e) continue;
          if (e.type === 'SpreadElement') return 'a spread (...)';
          const p = literal(e);
          if (p) return p;
        }
        return null;
      case 'ObjectExpression':
        for (const p of n.properties) {
          if (p.type !== 'Property') return 'a spread (...)';
          if (p.computed || p.method || p.shorthand || p.kind !== 'init') return 'an object property that is not a plain key and value';
          const q = literal(p.value);
          if (q) return q;
        }
        return null;
      case 'CallExpression':
        return isRequire(n) ? requireProblem(n) : 'a function call';
      case 'MemberExpression':
        // .default on an allowed require() call: an image's URL, as Docusaurus gives it.
        if (isRequire(n.object) && !n.computed && n.property.type === 'Identifier' && n.property.name === 'default') return requireProblem(n.object);
        return 'member access';
      default:
        return describe(n);
    }
  };
  const expressionProblem = (program, { variable }) => {
    const body = program?.body ?? [];
    if (!body.length) return null; // a comment
    if (body.length !== 1 || body[0].type !== 'ExpressionStatement') return 'a statement';
    const e = body[0].expression;
    // {edition.<name>} in text: replaced by the Edition's variable before compile.
    if (variable && e.type === 'MemberExpression' && !e.computed && e.object.type === 'Identifier' && e.object.name === 'edition' && e.property.type === 'Identifier') return null;
    return literal(e);
  };
  const ONLY = 'content may hold only literals, {edition.<name>} variables in text and require() of a file inside the Doc space';

  const element = (node, name, attrs) => {
    const tag = String(name ?? '').toLowerCase();
    if (tag === 'script') report(node, '<script> is not accepted: content carries no code');
    // Embeds other than an allow-listed <iframe> would bypass its host rule.
    if (EMBEDS.has(tag)) report(node, `<${tag}> is not accepted: embed a page with an <iframe> from a host in standards/iframe-hosts.yaml`);
    let src;
    for (const a of attrs) {
      if (a.spread) {
        report(a.node, 'A spread attribute ({...}) is not accepted: write each attribute as a literal');
        continue;
      }
      if (/^on./i.test(a.name) && !NOT_HANDLERS.has(a.name)) report(a.node, `${a.name}= is an event handler: content carries no code`);
      else if (String(a.name).toLowerCase() === 'srcdoc') report(a.node, 'srcdoc= is not accepted: it holds HTML of its own, and wins over an allow-listed src');
      else if (a.name === 'dangerouslySetInnerHTML') report(a.node, 'dangerouslySetInnerHTML is not accepted: write the content as Markdown');
      else if (a.expression !== undefined) {
        const p = expressionProblem(a.expression, { variable: false });
        if (p) report(a.node, `The expression in ${a.name}={…} is not a literal (${p}): ${ONLY}`);
      } else if (typeof a.value === 'string' && isJavascriptUrl(a.value)) report(a.node, `${a.name}="javascript:…" is not accepted: a javascript: URL runs code`);
      if (a.name === 'src') src = a;
    }
    if (tag !== 'iframe') return;
    if (!src || typeof src.value !== 'string') {
      report(node, '<iframe> needs a literal src="https://…" on an allow-listed host (standards/iframe-hosts.yaml)');
      return;
    }
    let url;
    try {
      url = new URL(src.value);
    } catch {
      report(node, `<iframe src="${src.value}"> is not an absolute https URL`);
      return;
    }
    if (url.protocol !== 'https:') report(node, `<iframe src="${src.value}"> must use https`);
    const host = url.hostname.toLowerCase();
    if (!rules.iframeHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      report(node, `<iframe> from ${host}: only hosts in standards/iframe-hosts.yaml (${rules.iframeHosts.join(', ')}) may be embedded`);
    }
  };

  visit(tree, (node) => {
    switch (node.type) {
      case 'mdxjsEsm':
        for (const s of node.data?.estree?.body ?? []) {
          if (s.type !== 'ImportDeclaration') {
            report(node, `${/^Export/.test(s.type) ? '`export`' : 'A statement'} is not accepted: content carries no code (Platform components need no import)`);
            continue;
          }
          const id = s.source.value;
          if (rules.modules.has(id)) continue;
          if (/^\.\.?\//.test(id) && !/[!?#]/.test(id)) {
            if (!PARTIAL.test(id)) report(node, `import from "${id}": a relative import must be an .mdx partial`);
            else if (!inside(id, fileAbs, root)) report(node, `import from "${id}" points outside the Doc space`);
            continue;
          }
          report(node, `import from "${id}": not in the component catalogue (standards/components.yaml)`);
        }
        break;
      case 'mdxFlowExpression':
      case 'mdxTextExpression': {
        const p = expressionProblem(node.data?.estree, { variable: true });
        if (p) report(node, `The expression {${node.value.trim()}} is not a literal (${p}): ${ONLY}`);
        break;
      }
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement':
        element(node, node.name, (node.attributes ?? []).map((a) => (a.type === 'mdxJsxExpressionAttribute'
          ? { spread: true, node: a.position ? a : node }
          : {
            name: a.name, node: a.position ? a : node,
            ...(a.value && typeof a.value === 'object' ? { expression: a.value.data?.estree } : { value: a.value }),
          })));
        break;
      case 'link':
      case 'image':
      case 'definition':
        if (isJavascriptUrl(node.url)) report(node, `A javascript: URL (${node.url}) is not accepted: it runs code`);
        break;
      case 'html':
        // Raw HTML (a CommonMark page): the same element rules.
        for (const el of parseHtml(node.value).querySelectorAll('*')) {
          element(node, el.rawTagName, Object.entries(el.attributes).map(([name, value]) => ({ name, value, node })));
        }
        break;
      default:
    }
  });
}
