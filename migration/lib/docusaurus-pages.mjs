// Rewrites one Docusaurus page (or partial) for the Platform (Integrator on
// the proof, Q74 and Q75). The page is already MDX, so it is parsed as
// Docusaurus parses it and changed in place by source position: what is not
// rewritten stays byte for byte.
//
//   - <ThemedImage sources={{ light: useBaseUrl('/img/a.png'), dark: … }}>
//     becomes the Platform's <ThemedImage light="…" dark="…" alt="…">, the
//     images copied next to the pages; the @theme/ThemedImage and
//     @docusaurus/useBaseUrl imports go.
//   - The site's own components: PatternImplementationTabs → <Tabs>,
//     CloudDocsLink and EipReferenceLink → links, PrereqCard → an admonition,
//     Prerequisites and Steps unwrapped, QuickstartHeader → two bold lines,
//     PatternImage → an image, TabAwareToc and PaletteIcon dropped,
//     GuidesCatalog and ArtifactPicker → <DocCardList />, and Palette cards,
//     chips and grids (also written as <div class="palette-…">) → headings,
//     text and link lists. Each counts in the run report.
//   - A ```mermaid block stays code (the Platform renders no diagrams),
//     counted and listed as a fallback.
//   - Links and images resolve through the context: other pages to their new
//     .mdx files, pages outside the Doc space to the legacy site.
//   - The H1 moves to front matter (`title`); `:::type Title` becomes
//     `:::type[Title]`, with types the Platform lacks mapped.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkComment from '@slorber/remark-comment';
import { toString } from 'mdast-util-to-string';
import { admonitionTitleToDirectiveLabel } from '@docusaurus/utils';

const parser = unified().use(remarkParse).use(remarkMdx).use(remarkDirective).use(remarkGfm).use(remarkComment);
const ADMONITIONS = ['secondary', 'info', 'success', 'danger', 'note', 'tip', 'warning', 'important', 'caution'];
const isJsx = (n) => n?.type === 'mdxJsxFlowElement' || n?.type === 'mdxJsxTextElement';
const classOf = (n) => String(attrValue(n, 'class') ?? attrValue(n, 'className') ?? '');
const PALETTE = new Set(['PaletteGrid', 'PaletteCard', 'PaletteChip']);
// Imports that go: the components they bring are rewritten or dropped.
const DROPPED_IMPORTS = /^(?:@theme\/ThemedImage|@docusaurus\/useBaseUrl|@site\/)/;
// Imports a rewrite may need, and the ones an inlined partial moves to its page.
const FROM = { Tabs: '@theme/Tabs', TabItem: '@theme/TabItem', DocCardList: '@theme/DocCardList' };

function attr(node, name) {
  return node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === name);
}
// A string attribute's value, or a string literal written as an expression.
function attrValue(node, name) {
  const a = attr(node, name);
  if (!a) return undefined;
  if (a.value === null || a.value === undefined) return true;
  if (typeof a.value === 'string') return a.value;
  const e = a.value.data?.estree?.body?.[0]?.expression;
  if (e?.type === 'Literal') return e.value;
  if (e?.type === 'TemplateLiteral' && !e.expressions.length) return e.quasis.map((q) => q.value.cooked).join('');
  return undefined;
}
// light/dark from sources={{ light: useBaseUrl('/img/a.png'), dark: '…' }}.
function themedSources(node) {
  const e = attr(node, 'sources')?.value?.data?.estree?.body?.[0]?.expression;
  const out = {};
  for (const p of e?.type === 'ObjectExpression' ? e.properties : []) {
    const key = p.key?.name ?? p.key?.value;
    let v = p.value;
    if (v?.type === 'CallExpression' && v.callee.name === 'useBaseUrl') v = v.arguments[0];
    if (v?.type === 'MemberExpression' && v.object.type === 'CallExpression' && v.object.callee.name === 'require') v = v.object.arguments[0];
    if (v?.type === 'Literal' && typeof v.value === 'string') out[key] = v.value;
  }
  return out;
}

// <!-- … --> outside code becomes {/* … */}: the Platform's checks read
// pages as plain MDX, where an HTML comment does not parse.
function htmlCommentsToMdx(text, ctx) {
  if (!text.includes('<!--')) return text;
  const code = [];
  const walk = (n) => {
    if ((n.type === 'code' || n.type === 'inlineCode') && n.position) code.push([n.position.start.offset, n.position.end.offset]);
    for (const c of n.children ?? []) walk(c);
  };
  walk(parser.parse(text.replace(/^(#{1,6}[ \t].*?)\{(#[\w-]+\}\s*)$/gm, (m, a, b) => `${a}${b}`)));
  return text.replace(/<!--([\s\S]*?)-->/g, (m, inner, at) => {
    if (code.some(([s, e]) => at >= s && at < e)) return m;
    ctx.count('HTML comment');
    return `{/*${inner.replace(/\*\//g, '* /')}*/}`;
  });
}

// A component a page or partial defines (`export const`), read without
// running it when it has one of two shapes Agent Manager's install partial
// uses (no code is run, and anything else stays an item):
//   - a conditional wrapper: ({p, children}) => (p ? <>{children}</> : null),
//     or the reverse: its children where the prop is set (or not set);
//   - a collapsible section: ({p}) => { const content = (<>…</>); if (p)
//     return (<><hN>Heading</hN>{content}</>); return (<details><summary>…
//     </summary>{content}</details>); }: its content under the heading or in
//     <details>, with <pre><code className="language-x">{`…`}</code></pre>
//     as a fenced code block and <p> as a paragraph.
export function knownComponent(src) {
  const kids = '<>\\{children\\}<\\/>';
  const w = new RegExp(`^export const (\\w+) = \\(\\{(\\w+), children\\}\\) => \\(\\2 \\? (${kids}|null) : (${kids}|null)\\);?\\s*$`).exec(src.trim());
  if (w && (w[3] === 'null') !== (w[4] === 'null')) return { kind: 'wrapper', name: w[1], prop: w[2], whenSet: w[4] === 'null' };
  const c = /^export const (\w+) = \(\{(\w+)\}\) => \{\s*const content = \(\s*<>([\s\S]*?)<\/>\s*\);\s*if \(\2\) \{\s*return \(<><h([1-6])>([^<]*)<\/h\4>\{content\}<\/>\);\s*\}\s*return \(<details><summary>([^<]*)<\/summary>\{content\}<\/details>\);\s*\};?\s*$/.exec(src.trim());
  if (!c) return null;
  const blocks = [];
  // The fragment's top-level elements, one block each.
  const re = /<pre><code className="language-([\w-]+)">\{`([\s\S]*?)`\}<\/code><\/pre>|<p>([\s\S]*?)<\/p>|(<(table|ul|ol|div)[\s>][\s\S]*?<\/\5>)/g;
  for (let m; (m = re.exec(c[3]));) {
    if (m[1]) blocks.push(`\`\`\`${m[1]}\n${m[2].replace(/\\([`$\\])/g, '$1')}\n\`\`\``);
    else if (m[3] !== undefined) blocks.push(m[3].replace(/<code>([^<]*)<\/code>/g, '`$1`').replace(/\s*\n\s*/g, ' ').trim());
    else {
      // Dedented by the opening tag's indent.
      const lead = m.index - (c[3].lastIndexOf('\n', m.index) + 1);
      const lines = m[4].split('\n');
      blocks.push([lines[0], ...lines.slice(1).map((l) => l.slice(Math.min(lead, /^ */.exec(l)[0].length)))].join('\n'));
    }
  }
  return { kind: 'collapsible', name: c[1], prop: c[2], level: Number(c[4]), heading: c[5].trim(), summary: c[6].trim(), content: blocks.join('\n\n') };
}

const quote = (s) => (/["{}\n]/.test(s) ? `{${JSON.stringify(s)}}` : `"${s}"`);
const escapeLinkText = (s) => s.replace(/([[\]\\])/g, '\\$1');

// The page with its body rewritten. `ctx`:
//   link(url) → new URL, or null to unlink (text kept)
//   image(url) → path relative to the output file, or null when missing
//   partial(spec) → new import specifier for a relative partial import
//   site(name, path) → a URL on another legacy site (saas, connectors)
//   count(kind, n), item(kind, message)
// Returns { body, h1 } (h1: the removed title heading's text, or null).
export function rewriteBody(input, ctx) {
  // `:::note Title` is `:::note[Title]` to Docusaurus (it rewrites code too).
  // Heading ids ({#id}) parse as expressions: hidden while parsing, kept in
  // the output.
  // HTML comments, which Docusaurus accepts in MDX, become MDX comments.
  const body = htmlCommentsToMdx(admonitionTitleToDirectiveLabel(input, ADMONITIONS), ctx)
    .replace(/^(#{1,6}[ \t].*?)\{(#[\w-]+\}\s*)$/gm, (m, a, b) => `${a}\uE000${b}`);
  const tree = parser.parse(body);
  const edits = [];
  // An edit replaces the edits inside its range: children already rewritten
  // that the replacement leaves out or has taken in through slice().
  const add = (start, end, text) => {
    for (let i = edits.length - 1; i >= 0; i--) {
      const x = edits[i];
      if (x.start >= start && x.end <= end && end > start) edits.splice(i, 1);
    }
    edits.push({ start, end, text });
  };
  const range = (n) => [n.position.start.offset, n.position.end.offset];
  // The source between two offsets with the edits inside it applied; those
  // edits are then consumed by the edit that replaces the whole range.
  const slice = (start, end, consume = true) => {
    const inner = edits.filter((e) => e.start >= start && e.end <= end).sort((a, b) => b.start - a.start);
    let s = body.slice(start, end);
    for (const e of inner) s = s.slice(0, e.start - start) + e.text + s.slice(e.end - start);
    if (consume) for (const e of inner) edits.splice(edits.indexOf(e), 1);
    return s;
  };
  const childrenText = (n) => (n.children?.length ? slice(n.children[0].position.start.offset, n.children.at(-1).position.end.offset) : '');
  const indentOf = (n) => ' '.repeat(n.position.start.column - 1);
  const block = (n, text) => text.split('\n').map((l, i) => (i && l ? indentOf(n) + l : l)).join('\n');
  // Removes the lines from start to end, and one blank line after them, when
  // nothing else is on them.
  const removeLines = (start, end) => {
    const lineStart = body.lastIndexOf('\n', start - 1) + 1;
    if (body.slice(lineStart, start).trim()) return add(start, end, '');
    let e = end;
    while (body[e] === ' ' || body[e] === '\t') e++;
    if (body[e] !== '\n' && e < body.length) return add(start, end, '');
    e++;
    const next = body.indexOf('\n', e);
    if (next >= 0 && !body.slice(e, next).trim()) e = next + 1;
    return add(lineStart, Math.min(e, body.length), '');
  };
  const removeBlock = (n) => removeLines(...range(n));
  const openTagEnd = (n) => {
    const last = n.attributes?.at(-1);
    const from = last?.position ? last.position.end.offset : n.position.start.offset + 1 + (n.name?.length ?? 0);
    return body.indexOf('>', from) + 1;
  };
  const closeTagStart = (n) => {
    const close = `</${n.name}>`;
    const end = n.position.end.offset;
    return body.slice(end - close.length, end) === close ? end - close.length : null;
  };
  // The heading level a block sits under, from the headings before it.
  const headings = [];
  const imports = { have: new Set(), need: new Set() };
  const defined = new Map(); // components the page defines, of a known shape
  const inlined = new Map(); // local name → a partial with props, inlined
  let h1 = null;

  const visit = (node, ancestors) => {
    if (node.type === 'heading') headings.push({ at: node.position.start.offset, depth: node.depth });
    for (const c of node.children ?? []) visit(c, [...ancestors, node]);
    leave(node, ancestors.at(-1), ancestors);
  };
  const depthAt = (n) => {
    let d = 1;
    for (const h of headings) if (h.at < n.position.start.offset) d = h.depth;
    return Math.min(d + 1, 6);
  };
  const link = (url) => {
    const out = ctx.link(url);
    return out === undefined ? url : out;
  };
  const linkMd = (text, url) => {
    const to = link(url);
    return to === null ? text : `[${text}](${to})`;
  };

  // Palette markup → plain Markdown (Q75).
  const hasClass = (n, c) => classOf(n).split(/\s+/).includes(c);
  const isPaletteCard = (n) => isJsx(n) && (n.name === 'PaletteCard' || (n.name === 'div' && hasClass(n, 'palette-card')));
  const isPaletteGrid = (n) => isJsx(n) && (n.name === 'PaletteGrid' || (n.name === 'div' && hasClass(n, 'palette-grid')));
  const isChipRow = (n) => isJsx(n) && n.name === 'div' && hasClass(n, 'palette-chip-row');
  const find = (n, pred, out = []) => {
    for (const c of n.children ?? []) {
      if (pred(c)) out.push(c);
      else find(c, pred, out);
    }
    return out;
  };
  const chipLine = (chip) => `- ${linkMd(childrenText(chip).trim(), attrValue(chip, 'href'))}`;
  const card = (n, depth) => {
    const title = find(n, (c) => isJsx(c) && /^h[1-6]$/.test(c.name))[0];
    const chips = find(n, (c) => isJsx(c) && c.name === 'PaletteChip');
    const href = attrValue(n, 'href');
    // A badge in the title (<span class="palette-card-badge">) reads "(…)".
    const titleText = title ? childrenText(title).replace(/<span class(?:Name)?="palette-card-badge">([^<]*)<\/span>/g, ' ($1)').replace(/\s+/g, ' ').trim() : null;
    const lines = [];
    if (titleText) lines.push(`${'#'.repeat(depth)} ${typeof href === 'string' ? linkMd(titleText, href) : titleText}`);
    else if (typeof href === 'string') lines.push(linkMd('Open', href));
    // The rest in order: the description, lists, chips; anything else as written.
    const inline = (c) => childrenText(c).replace(/\s*\n\s*/g, ' ').trim();
    const part = (c) => {
      if (c === title || (c.type === 'text' && !c.value.trim())) return [];
      if (isJsx(c) && c.name === 'PaletteIcon') return [];
      if (isJsx(c) && c.name === 'p') return [inline(c)];
      if (isJsx(c) && (c.name === 'ul' || c.name === 'ol')) {
        const items = (c.children ?? []).flatMap((x) => (x.type === 'paragraph' ? x.children : [x])).filter((x) => isJsx(x) && x.name === 'li');
        return [items.map((li, i) => `${c.name === 'ol' ? `${i + 1}.` : '-'} ${inline(li)}`).join('\n')];
      }
      if (isChipRow(c)) return [find(c, (x) => isJsx(x) && x.name === 'PaletteChip').map(chipLine).join('\n')];
      if (isJsx(c) && c.name === 'PaletteChip') return [chipLine(c)];
      if (c.type === 'paragraph' && c.children.some((x) => isJsx(x))) return c.children.flatMap(part);
      return [slice(...range(c)).trim()];
    };
    lines.push(...(n.children ?? []).flatMap(part));
    ctx.count('palette-card');
    ctx.count('palette-chip', chips.length);
    return lines.filter(Boolean).join('\n\n');
  };

  const leave = (node, parent, ancestors) => {
    // Palette markup inside a grid or card is rewritten with it.
    const inPalette = ancestors.some((a) => isPaletteGrid(a) || isPaletteCard(a));
    if (node.type === 'heading' && node.depth === 1 && h1 === null && parent?.type === 'root') {
      h1 = toString(node).replace(/\uE000#[\w-]+\}\s*$/, '').trim();
      removeBlock(node);
      return;
    }
    if (node.type === 'mdxjsEsm') {
      const kept = [];
      for (const s of node.data?.estree?.body ?? []) {
        if (s.type !== 'ImportDeclaration') {
          // A component of a shape the converter knows is applied where it is used.
          const known = s.type === 'ExportNamedDeclaration' ? knownComponent(body.slice(s.start, s.end)) : null;
          if (known) {
            defined.set(known.name, known);
            continue;
          }
          kept.push(null);
          ctx.item('code', `${s.type} in the page is not accepted (content carries no code); removed`);
          continue;
        }
        const spec = s.source.value;
        if (DROPPED_IMPORTS.test(spec)) continue;
        // A partial that takes props: inlined where it is used (Platform
        // partials take none).
        if (/^\.\.?\//.test(spec) && ctx.propsPartial?.(spec)) {
          for (const x of s.specifiers) inlined.set(x.local.name, spec);
          continue;
        }
        // Inlined into a page: its imports move to the page.
        if (ctx.inlined) {
          for (const x of s.specifiers) if (FROM[x.local.name]) imports.need.add(x.local.name);
          continue;
        }
        let from = spec;
        if (/^\.\.?\//.test(spec)) from = ctx.partial(spec) ?? spec;
        const names = s.specifiers.map((x) => x.local.name);
        names.forEach((x) => imports.have.add(x));
        const def = s.specifiers.find((x) => x.type === 'ImportDefaultSpecifier');
        const named = s.specifiers.filter((x) => x.type === 'ImportSpecifier').map((x) => (x.imported.name === x.local.name ? x.local.name : `${x.imported.name} as ${x.local.name}`));
        kept.push(`import ${[def?.local.name, named.length ? `{ ${named.join(', ')} }` : null].filter(Boolean).join(', ')} from '${from}';`);
      }
      const [s, e] = range(node);
      const text = kept.filter(Boolean).join('\n');
      if (text) add(s, e, text);
      else removeBlock(node);
      return;
    }
    if (node.type === 'link' || node.type === 'definition') {
      const to = link(node.url);
      const [s, e] = range(node);
      if (to === null) {
        add(s, e, node.type === 'link' ? childrenText(node) : '');
        return;
      }
      if (to === node.url) return;
      const src = body.slice(s, e);
      const at = src.lastIndexOf(node.url);
      if (at < 0) {
        ctx.item('link', `could not rewrite the link to ${node.url} in place`);
        return;
      }
      add(s + at, s + at + node.url.length, to);
      return;
    }
    if (node.type === 'image') {
      if (/^[a-z]+:/i.test(node.url)) return;
      const to = ctx.image(node.url);
      const [s, e] = range(node);
      if (to === null) {
        add(s, e, `*Image: ${node.alt ?? ''}*`);
        return;
      }
      const src = body.slice(s, e);
      const at = src.lastIndexOf(node.url);
      if (at >= 0) add(s + at, s + at + node.url.length, to);
      return;
    }
    if (node.type === 'code' && node.lang === 'mermaid') {
      // The Platform has no Mermaid theme: the diagram's source shows as code.
      ctx.count('mermaid (shown as code)');
      ctx.item('fallback', 'a Mermaid diagram is shown as its code: the Platform renders no Mermaid diagrams');
      return;
    }
    if (node.type === 'containerDirective') {
      // :::caution → :::warning (Documentation standards, decision 4: five types).
      const to = ctx.admonitions?.[node.name];
      const s = node.position.start.offset;
      const m = /^:{3,}/.exec(body.slice(s));
      if (to && m) {
        add(s + m[0].length, s + m[0].length + node.name.length, to);
        ctx.count(`admonition ${node.name}→${to}`);
      }
      return;
    }
    if (!isJsx(node)) return;

    const [s, e] = range(node);
    const name = node.name;
    if (inlined.has(name)) {
      const props = {};
      for (const a of node.attributes ?? []) if (a.type === 'mdxJsxAttribute') props[a.name] = attrValue(node, a.name);
      const r = ctx.inline(inlined.get(name), props);
      add(s, e, block(node, r.body.replace(/\n+$/, '')));
      for (const n of r.needs) imports.need.add(n);
      ctx.count('partial with props (inlined)');
      return;
    }
    const known = defined.get(name);
    if (known?.kind === 'wrapper') {
      // Children shown when the prop is set (or when it is not).
      const on = Boolean(attrValue(node, known.prop));
      const close = closeTagStart(node);
      if (on === known.whenSet) {
        removeLines(s, openTagEnd(node));
        if (close !== null) removeLines(close, e);
      } else removeBlock(node);
      ctx.count('conditional wrapper (applied)');
      return;
    }
    if (known?.kind === 'collapsible') {
      // Its content under a heading when the prop is set, else in <details>.
      add(s, e, block(node, attrValue(node, known.prop)
        ? `${'#'.repeat(known.level)} ${known.heading}\n\n${known.content}`
        : `<details>\n<summary>${known.summary}</summary>\n\n${known.content}\n\n</details>`));
      ctx.count('collapsible section (applied)');
      return;
    }
    if (name === 'ThemedImage') {
      const src = { ...themedSources(node), ...(attrValue(node, 'light') ? { light: attrValue(node, 'light') } : {}), ...(attrValue(node, 'dark') ? { dark: attrValue(node, 'dark') } : {}) };
      const alt = attrValue(node, 'alt') ?? '';
      const light = src.light ? ctx.image(src.light) : null;
      if (!light) {
        ctx.item('image', `ThemedImage "${alt}": its light image ${src.light ?? '(none)'} is missing; the alt text is kept`);
        add(s, e, `*Image: ${alt}*`);
        return;
      }
      const dark = src.dark ? ctx.image(src.dark) : null;
      if (src.dark && !dark) ctx.item('image', `ThemedImage "${alt}": its dark image ${src.dark} is missing; the light one shows in both themes`);
      const rest = (node.attributes ?? []).filter((a) => !['sources', 'light', 'dark', 'alt'].includes(a.name)).map((a) => body.slice(...range(a)));
      add(s, e, `<ThemedImage light=${quote(light)}${dark ? ` dark=${quote(dark)}` : ''} alt=${quote(String(alt))}${rest.length ? ` ${rest.join(' ')}` : ''} />`);
      ctx.count('ThemedImage');
      return;
    }
    if (name === 'PatternImplementationTabs') {
      const close = closeTagStart(node);
      add(s, openTagEnd(node), '<Tabs>');
      if (close !== null) add(close, e, '</Tabs>');
      imports.need.add('Tabs');
      ctx.count('PatternImplementationTabs');
      return;
    }
    if (name === 'Tabs' || name === 'TabItem') {
      imports.need.add(name);
      return;
    }
    if (name === 'CloudDocsLink') {
      add(s, e, `[${childrenText(node).trim()}](${ctx.site('saas', String(attrValue(node, 'to') ?? ''))})`);
      ctx.count('CloudDocsLink');
      return;
    }
    if (name === 'EipReferenceLink') {
      add(s, e, `[${escapeLinkText(String(attrValue(node, 'label') ?? 'Reference'))}](${attrValue(node, 'href')})`);
      ctx.count('EipReferenceLink');
      return;
    }
    if (name === 'PrereqCard') {
      const href = String(attrValue(node, 'href') ?? '');
      const title = String(attrValue(node, 'title') ?? 'Prerequisite');
      const to = attrValue(node, 'cloud') ? ctx.site('saas', href) : link(href);
      const text = childrenText(node).replace(/\s*\n\s*/g, ' ').trim();
      add(s, e, block(node, `:::info[${title}]\n\n${text}${to ? ` See [${escapeLinkText(title)}](${to}).` : ''}\n\n:::\n`));
      ctx.count('PrereqCard');
      return;
    }
    if (name === 'Prerequisites' || name === 'Steps') {
      const close = closeTagStart(node);
      removeLines(s, openTagEnd(node));
      if (close !== null) removeLines(close, e);
      ctx.count(name);
      return;
    }
    if (name === 'QuickstartHeader') {
      const build = attr(node, 'build')?.value;
      let what = typeof build === 'string' ? build : '';
      if (build && typeof build === 'object') what = build.value.trim().replace(/^<>\s*/, '').replace(/\s*<\/>$/, '');
      add(s, e, block(node, `**Time:** ${attrValue(node, 'time') ?? ''}\n\n**What you'll build:** ${what}`));
      ctx.count('QuickstartHeader');
      return;
    }
    if (name === 'PatternImage') {
      const src = String(attrValue(node, 'src') ?? '');
      const to = ctx.image(src);
      const alt = String(attrValue(node, 'alt') ?? '');
      add(s, e, to === null ? `*Image: ${alt}*` : `![${escapeLinkText(alt)}](${to})`);
      ctx.count('PatternImage');
      return;
    }
    if (name === 'TabAwareToc' || name === 'PaletteIcon') {
      if (node.type === 'mdxJsxFlowElement') removeBlock(node);
      else add(s, e, '');
      ctx.count(name);
      return;
    }
    if (name === 'GuidesCatalog' || name === 'ArtifactPicker') {
      add(s, e, '<DocCardList />');
      imports.need.add('DocCardList');
      ctx.count(name);
      ctx.item('component', `<${name} /> (an interactive catalogue) became <DocCardList />, the folder's pages`);
      return;
    }
    if (isPaletteGrid(node)) {
      const depth = depthAt(node);
      const cards = find(node, isPaletteCard);
      add(s, e, block(node, cards.map((c) => card(c, depth)).join('\n\n')));
      ctx.count('palette-grid');
      return;
    }
    if (isPaletteCard(node) && !inPalette) {
      add(s, e, block(node, card(node, depthAt(node))));
      return;
    }
    if (isChipRow(node) && !inPalette) {
      const chips = find(node, (c) => isJsx(c) && c.name === 'PaletteChip');
      add(s, e, block(node, chips.map(chipLine).join('\n')));
      ctx.count('palette-chip', chips.length);
      return;
    }
    if (name === 'PaletteChip') return; // in its card or row, else a link (below)
    if (name === 'a' && typeof attrValue(node, 'href') === 'string') {
      const a = attr(node, 'href');
      const to = link(a.value);
      if (to !== null && to !== a.value) add(...range(a), `href=${quote(to)}`);
      return;
    }
    if (name === 'img' && typeof attrValue(node, 'src') === 'string' && !/^[a-z]+:/i.test(attrValue(node, 'src'))) {
      const a = attr(node, 'src');
      const to = ctx.image(a.value);
      if (to === null) add(s, e, `*Image: ${attrValue(node, 'alt') ?? ''}*`);
      else add(...range(a), `src={require(${JSON.stringify(to)}).default}`);
    }
  };
  visit(tree, []);
  // A chip on its own (not in a card or a row): a link.
  const lone = (n, parent) => {
    for (const c of n.children ?? []) {
      if (isJsx(c) && c.name === 'PaletteChip' && !(isChipRow(n) || isPaletteCard(n)) && !edits.some((x) => x.start <= c.position.start.offset && x.end >= c.position.end.offset)) {
        add(...range(c), linkMd(childrenText(c).trim(), attrValue(c, 'href')));
        ctx.count('palette-chip');
      }
      lone(c, n);
    }
  };
  lone(tree, null);

  let out = slice(0, body.length, false);
  // Imports the rewrites need (Tabs for PatternImplementationTabs, DocCardList).
  // Inlined into a page: the page imports what the partial needs.
  if (ctx.inlined) return { body: out.replace(/^\n+/, '').replace(//g, '{'), h1, needs: [...imports.need] };
  const missing = [...imports.need].filter((n) => !imports.have.has(n));
  if (missing.length) out = `${missing.map((n) => `import ${n} from '${FROM[n]}';`).join('\n')}\n${/^import /.test(out.replace(/^\n+/, '')) ? '' : '\n'}${out.replace(/^\n+/, '')}`;
  return { body: out.replace(/^\n+/, '').replace(//g, '{'), h1 };
}
