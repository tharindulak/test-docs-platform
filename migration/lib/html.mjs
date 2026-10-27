// Raw HTML blocks → MDX. The block is parsed the way a browser parses it
// (parse5), which is what readers of the legacy site saw. Admonition divs
// become :::admonitions, <pre> becomes a fenced code block, simple tables
// become Markdown tables, and everything else becomes JSX-valid elements.
// Python-Markdown never processed Markdown inside raw HTML, so text is
// escaped to stay literal.
import { parseFragment } from 'parse5';
import { escapeHtmlText, imageOrVariants, jsxAttr, quoteAttr, encodeLinkDest } from './mdx.mjs';
import { VAR_TOKEN } from './inline.mjs';

const PHRASING = new Set(`a abbr b bdi bdo br cite code data del dfn em font i img input ins kbd label mark q s samp small
span strike strong sub sup time tt u var wbr button select`.split(/\s+/));
const KEEP_INLINE = new Set('sup sub u mark del s ins small kbd abbr q samp var strike'.split(' '));
const UNWRAP = new Set('div section article main header footer center figure figcaption body html form fieldset nav aside hgroup span font label cite time data dfn bdi bdo tt'.split(' '));
const DROP = new Set('script style link meta title head noscript template'.split(' '));
const KNOWN_BLOCK = new Set('p h1 h2 h3 h4 h5 h6 ul ol li pre table thead tbody tfoot tr td th caption colgroup col blockquote hr br details summary dl dt dd iframe video audio object embed source picture legend option optgroup map area canvas'.split(' '));

const attrsOf = (n) => Object.fromEntries((n.attrs ?? []).map((a) => [a.name, a.value]));
const handlers = (n) => (n.attrs ?? []).filter((a) => /^on/i.test(a.name)).map((a) => a.name);
const classes = (n) => (attrsOf(n).class ?? '').split(/\s+/).filter(Boolean);
const elements = (n) => (n.childNodes ?? []).filter((c) => c.nodeName !== '#comment');
const textContent = (n) => (n.nodeName === '#text' ? n.value : (n.childNodes ?? []).map(textContent).join(''));
const isWhitespace = (n) => n.nodeName === '#text' && !n.value.trim();

export function renderAdmonition(type, title, bodyLines) {
  const deepest = Math.max(2, ...bodyLines.map((l) => (/^\s*(:{3,})/.exec(l)?.[1].length ?? 0)));
  const fence = ':'.repeat(deepest + 1);
  const label = title ? `[${title.replace(/([[\]])/g, '\\$1')}]` : '';
  return [`${fence}${type}${label}`, ...bodyLines, fence];
}

export function fencedCode(code, lang = '', meta = '') {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  return [`${fence}${lang}${meta ? ` ${meta}` : ''}`, ...code.replace(/\n+$/, '').split('\n'), fence];
}

const safeLineStart = (s) => s
  .replace(/^(\s*)([#>+=]|[-*](?=\s)|-{3,})/, '$1\\$2')
  .replace(/^(\s*\d+)([.)])(?=\s)/, '$1\\$2');

export function htmlToMdx(html, ctx) {
  const frag = parseFragment(html);
  return new HtmlWriter(ctx).blocks(frag.childNodes).join('\n\n').split('\n');
}

class HtmlWriter {
  constructor(ctx) {
    this.ctx = ctx;
  }

  text(s) {
    return escapeHtmlText(s).replace(VAR_TOKEN, '{edition.$1}');
  }

  blocks(nodes) {
    const out = [];
    let para = [];
    const flush = () => {
      const t = para.join('').replace(/[ \t\n\r]+/g, ' ').trim();
      if (t) out.push(safeLineStart(t));
      para = [];
    };
    for (const n of nodes ?? []) {
      if (n.nodeName === '#comment') continue;
      if (n.nodeName === '#text') { para.push(this.text(n.value)); continue; }
      const tag = n.tagName;
      if (PHRASING.has(tag) && !this.hasBlockChild(n)) { para.push(this.phrasing(n)); continue; }
      flush();
      out.push(...this.block(n));
    }
    flush();
    return out.filter((b) => b.trim() !== '');
  }

  hasBlockChild(n) {
    return elements(n).some((c) => c.tagName && !PHRASING.has(c.tagName) || (c.tagName && this.hasBlockChild(c)));
  }

  anchorFor(n) {
    const id = attrsOf(n).id ?? (n.tagName === 'a' ? attrsOf(n).name : undefined);
    if (!id) return '';
    this.ctx.useAnchor();
    return `<Anchor id=${JSON.stringify(id)} />`;
  }

  block(n) {
    const tag = n.tagName;
    const a = attrsOf(n);
    this.reportHandlers(n);
    if (tag === 'badge') return []; // VuePress <Badge>: rendered as nothing on the legacy site
    if (DROP.has(tag)) {
      if (tag === 'script' && this.ctx.script?.(textContent(n))) return [];
      if (tag === 'script' || tag === 'style' || textContent(n).trim()) this.ctx.report('html', `<${tag}> removed${textContent(n).trim() ? ` (text: "${textContent(n).trim().slice(0, 60)}")` : ''}`);
      return [];
    }
    if (tag === 'div' && classes(n).includes('admonition')) return [this.admonition(n)];
    if (/^h[1-6]$/.test(tag)) {
      const text = this.phrasingChildren(n).replace(/\s+/g, ' ').trim();
      return [`${'#'.repeat(Number(tag[1]))} ${text}${a.id ? ` {#${a.id}}` : ''}`];
    }
    if (tag === 'p') {
      const anchor = this.anchorFor(n);
      if (this.hasBlockChild(n)) return [anchor, ...this.blocks(n.childNodes)].filter(Boolean);
      const t = this.phrasingChildren(n).replace(/[ \t\n\r]+/g, ' ').trim();
      return [safeLineStart(`${anchor}${t}`)].filter((x) => x.trim());
    }
    if (tag === 'ul' || tag === 'ol') return [this.list(n)];
    if (tag === 'pre') {
      const code = n.childNodes.length === 1 && n.childNodes[0].tagName === 'code' ? n.childNodes[0] : n;
      const lang = [...classes(code), ...classes(n)].map((c) => /^(?:language|lang)-(.+)$/.exec(c)?.[1]).find(Boolean) ?? 'text';
      return [fencedCode(textContent(code).replace(/^\n/, '').replace(VAR_TOKEN, '{edition.$1}'), this.ctx.language(lang)).join('\n')];
    }
    if (tag === 'table') return [this.table(n)];
    if (tag === 'textarea') {
      // The legacy theme turned <textarea class="jsonTreeInput"> into a JSON tree;
      // a code block shows the same JSON.
      const code = textContent(n).replace(/^\n/, '');
      let lang = 'text';
      try { JSON.parse(code); lang = 'json'; } catch { /* not JSON */ }
      return [fencedCode(code, lang).join('\n')];
    }
    if (tag === 'blockquote') return [this.blocks(n.childNodes).join('\n\n').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')];
    if (tag === 'hr') return ['---'];
    if (tag === 'br') return [];
    if (tag === 'details') {
      const summary = elements(n).find((c) => c.tagName === 'summary');
      const rest = elements(n).filter((c) => c !== summary);
      return [[`<details${'open' in a ? ' open' : ''}>`, `<summary>${summary ? this.phrasingChildren(summary).trim() : 'Details'}</summary>`, '', ...this.blocks(rest).join('\n\n').split('\n'), '', '</details>'].join('\n')];
    }
    if (tag === 'dl' || tag === 'dt' || tag === 'dd' || tag === 'li' || tag === 'summary' || tag === 'caption') {
      return [this.jsxBlock(n)];
    }
    if (['iframe', 'video', 'audio', 'object', 'embed', 'source', 'canvas', 'map', 'area', 'picture'].includes(tag)) {
      return [this.mediaElement(n)];
    }
    if (UNWRAP.has(tag) || ['tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'colgroup', 'col', 'legend', 'option', 'optgroup'].includes(tag)) {
      const anchor = this.anchorFor(n);
      return [anchor, ...this.blocks(n.childNodes)].filter(Boolean);
    }
    if (PHRASING.has(tag)) {
      // A phrasing element wrapping blocks (<a><div>…</div></a>): keep the blocks.
      const anchor = this.anchorFor(n);
      return [anchor, ...this.blocks(n.childNodes)].filter(Boolean);
    }
    // Not HTML: legacy pages showed only the children (e.g. <hostname> in a table).
    this.ctx.stats.unknownElements++;
    this.ctx.report('html', `unknown element <${tag}> inside raw HTML kept as the text \`<${tag}>\``);
    return this.blocks([{ nodeName: '#text', value: `<${tag}>` }, ...(n.childNodes ?? [])]);
  }

  admonition(n) {
    const kids = elements(n);
    const titleNode = kids.find((c) => c.tagName === 'p' && classes(c).includes('admonition-title'));
    const rawType = classes(n).find((c) => c !== 'admonition') ?? 'note';
    const type = this.ctx.admonitionType(rawType);
    const title = titleNode ? this.phrasingChildren(titleNode).replace(/\s+/g, ' ').trim() : '';
    const body = this.blocks(kids.filter((c) => c !== titleNode)).join('\n\n').split('\n');
    const defaultTitle = type.charAt(0).toUpperCase() + type.slice(1);
    return renderAdmonition(type, title && title !== defaultTitle ? title : '', body).join('\n');
  }

  list(n) {
    const ordered = n.tagName === 'ol';
    let num = Number(attrsOf(n).start ?? 1);
    const items = [];
    let tight = true;
    for (const li of elements(n)) {
      if (li.nodeName === '#text') continue;
      const marker = ordered ? `${num++}. ` : '- ';
      const pad = ' '.repeat(marker.length);
      const body = li.tagName === 'li' ? this.blocks(li.childNodes) : this.blocks([li]);
      if (body.length > 1) tight = false;
      const lines = body.join('\n\n').split('\n');
      if (!lines.length || !lines[0]) lines[0] = '';
      items.push([`${marker}${lines[0]}`, ...lines.slice(1).map((l) => (l ? `${pad}${l}` : ''))].join('\n'));
    }
    return items.join(tight ? '\n' : '\n\n');
  }

  rows(table) {
    const rows = [];
    const visit = (n, inHead) => {
      for (const c of elements(n)) {
        if (c.tagName === 'tr') rows.push({ cells: elements(c).filter((x) => x.tagName === 'td' || x.tagName === 'th'), head: inHead, node: c });
        else if (['thead', 'tbody', 'tfoot'].includes(c.tagName)) visit(c, c.tagName === 'thead');
      }
    };
    visit(table, false);
    return rows;
  }

  table(n) {
    const rows = this.rows(n);
    const simple = rows.length > 0
      && elements(n).every((c) => ['thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'col', '#text'].includes(c.nodeName) || isWhitespace(c))
      && rows.every((r) => r.cells.every((c) => !attrsOf(c).colspan || attrsOf(c).colspan === '1')
        && r.cells.every((c) => !attrsOf(c).rowspan || attrsOf(c).rowspan === '1')
        && r.cells.every((c) => !this.hasBlockChild(c) || elements(c).filter((x) => x.tagName).every((x) => x.tagName === 'p' && !this.hasBlockChild(x)) && elements(c).filter((x) => x.tagName === 'p').length <= 1))
      && (rows[0].head || rows[0].cells.every((c) => c.tagName === 'th'))
      && rows.slice(1).every((r) => !r.cells.every((c) => c.tagName === 'th') || r.cells.length === 0);
    if (simple) {
      const width = Math.max(...rows.map((r) => r.cells.length));
      const cell = (c) => this.phrasingChildren(c).replace(/[ \t\n\r]+/g, ' ').trim().replace(/(?<!\\)\|/g, '\\|');
      const line = (cells) => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`;
      const out = [line(rows[0].cells.map(cell)), line(Array(width).fill('---'))];
      for (const r of rows.slice(1)) out.push(line(r.cells.map(cell)));
      return out.join('\n');
    }
    return this.jsxBlock(n);
  }

  // A block element kept as JSX, with Markdown inside it.
  jsxBlock(n, depth = 0) {
    const tag = n.tagName;
    const pad = '  '.repeat(depth);
    const attrs = Object.entries(attrsOf(n))
      .filter(([k]) => !(tag === 'col' && k === 'span' && attrsOf(n)[k] === '1'))
      .map(([k, v]) => jsxAttr(k, v, { dropClass: true })).filter(Boolean);
    const open = `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
    if (tag === 'col') return `${pad}${open} />`;
    const structural = ['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'dl'].includes(tag);
    if (structural) {
      const kids = elements(n).filter((c) => c.tagName).map((c) => (
        ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col', 'caption', 'dt', 'dd'].includes(c.tagName)
          ? this.jsxBlock(c, depth + 1)
          : `${'  '.repeat(depth + 1)}${this.blocks([c]).join(' ')}`));
      return [`${pad}${open}>`, ...kids, `${pad}</${tag}>`].join('\n');
    }
    if (!this.hasBlockChild(n)) {
      const t = this.phrasingChildren(n).replace(/[ \t\n\r]+/g, ' ').trim();
      return `${pad}${open}>${t}</${tag}>`;
    }
    const inner = this.blocks(n.childNodes).join('\n\n').split('\n').map((l) => (l ? `${pad}  ${l}` : ''));
    return [`${pad}${open}>`, '', ...inner, '', `${pad}</${tag}>`].join('\n');
  }

  mediaElement(n) {
    const a = attrsOf(n);
    const attrs = [];
    for (const [k, v] of Object.entries(a)) {
      if ((k === 'src' || k === 'poster' || k === 'data') && v && !/^[a-z]+:\/\//i.test(v)) {
        const found = this.ctx.image(v);
        const asset = found?.alternatives ? found.alternatives.find((x) => x.src) : found;
        if (asset?.local) { attrs.push(`${k}={require(${JSON.stringify(asset.src)}).default}`); continue; }
      }
      const j = jsxAttr(k, v, { dropClass: true });
      if (j) attrs.push(j);
    }
    const kids = elements(n).filter((c) => c.tagName === 'source').map((c) => this.mediaElement(c));
    const open = `<${n.tagName}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
    return kids.length ? [`${open}>`, ...kids, `</${n.tagName}>`].join('\n') : `${open} />`;
  }

  phrasingChildren(n) {
    return (n.childNodes ?? []).map((c) => this.phrasing(c)).join('');
  }

  reportHandlers(n) {
    for (const h of handlers(n)) this.ctx.report('html', `<${n.tagName} ${h}=…> script handler removed (MDX pages run no inline scripts)`);
  }

  phrasing(n) {
    if (n.nodeName === '#text') return this.text(n.value);
    if (n.nodeName === '#comment') return '';
    const tag = n.tagName;
    const a = attrsOf(n);
    this.reportHandlers(n);
    const inner = () => this.phrasingChildren(n);
    const wrap = (mark) => {
      const s = inner();
      const t = s.trim();
      if (!t) return s;
      const lead = s.slice(0, s.indexOf(t[0]));
      const trail = s.slice(s.lastIndexOf(t[t.length - 1]) + 1);
      return `${lead}${mark}${t}${mark}${trail}`;
    };
    switch (tag) {
      case 'br': return '<br />';
      case 'b': case 'strong': return wrap('**');
      case 'i': case 'em': return wrap('*');
      case 'code': case 'tt': {
        const t = textContent(n).replace(/[ \t\n\r]+/g, ' ');
        if (!t.trim()) return t;
        const fence = t.includes('`') ? '``' : '`';
        return `${fence}${t.startsWith('`') ? ' ' : ''}${t.replace(VAR_TOKEN, '{edition.$1}')}${t.endsWith('`') ? ' ' : ''}${fence}`;
      }
      case 'a': {
        const anchor = this.anchorFor(n);
        if (!a.href) return `${anchor}${inner()}`;
        const imgOnly = elements(n).filter((c) => c.tagName || c.value?.trim()).every((c) => c.tagName === 'img');
        if (imgOnly && /\.(png|jpe?g|gif|svg|webp)([?#].*)?$/i.test(a.href.trim())) return `${anchor}${inner()}`; // lightbox link
        const r = this.ctx.link(a.href.trim());
        const text = inner().replace(/[ \t\n\r]+/g, ' ').trim();
        if (r.drop || !text) return `${anchor}${text}`;
        return `${anchor}[${text}](${encodeLinkDest(r.href)})`;
      }
      case 'img': {
        if (!a.src) return '';
        const img = this.ctx.image(a.src, a.alt ?? '');
        if (!img) return this.ctx.missingImage(a.alt ?? '', a.src);
        return imageOrVariants(img, { alt: a.alt ?? '', title: a.title, style: a.style, width: a.width, height: a.height });
      }
      case 'input': case 'select': case 'button': {
        const attrs = Object.entries(a).map(([k, v]) => jsxAttr(k, v, { dropClass: true })).filter(Boolean);
        if (tag === 'input') return `<input ${attrs.join(' ')} readOnly />`.replace('  ', ' ');
        return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${this.text(textContent(n))}</${tag}>`;
      }
      default:
        if (KEEP_INLINE.has(tag)) {
          const s = inner();
          return s.trim() ? `<${tag}>${s}</${tag}>` : s;
        }
        if (PHRASING.has(tag) || UNWRAP.has(tag) || KNOWN_BLOCK.has(tag)) return `${this.anchorFor(n)}${inner()}`;
        if (DROP.has(tag) || tag === 'badge') return '';
        this.ctx.stats.unknownElements++;
        this.ctx.report('html', `unknown element <${tag}> inside raw HTML kept as the text \`<${tag}>\``);
        return `\`<${tag}>\`${inner()}`;
    }
  }
}

export { quoteAttr };
