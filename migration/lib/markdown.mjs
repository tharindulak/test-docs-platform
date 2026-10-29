// Converts one Python-Markdown (MkDocs Material) page body into MDX for
// Docusaurus. Block structure is read by indentation, the way
// Python-Markdown nests admonitions, collapsibles and tabs; each container's
// content is converted recursively and written back at the same indentation,
// so list items keep their content. See the conversion table in Migration
// approach from MkDocs (decision 9).
import { convertInline } from './inline.mjs';
import { htmlToMdx, renderAdmonition, fencedCode } from './html.mjs';
import { BLOCK_TAGS, VOID_TAGS, quoteAttr } from './mdx.mjs';
import { mkdocsSlug, mkdocsUnique, DocusaurusSlugger, fileSlug } from './slug.mjs';
import { SENTINEL_LINE, SENTINEL_ANY, filterLines } from './variants.mjs';

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const ADMON = /^(\s*)(!!!|\?\?\?\+?)\s*([A-Za-z][\w-]*(?: +[\w-]+)*)?(?:\s+"(.*)")?\s*$/;
const TAB = /^(\s*)===([!+]?)\s+"(.*)"\s*$/;
const INCLUDE = /^(\s*(?:(?:[-*+]|\d+\.)\s+)?)\{!\s*(.+?)\s*!\}\s*$/;
const HEADING = /^(\s*)(#{1,6})(?:\s+(.*?))?\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+|$)/;
const REFDEF = /^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+["'(](.*)["')])?\s*$/;
const HTML_START = /^\s*<([A-Za-z][A-Za-z0-9]*)(?=[\s>/]|$)/;

const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
// Python-Markdown tables ignore pipes inside code spans; GFM needs them escaped.
const escapeCodePipes = (row) => row.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, f, c) => `${f}${c.replace(/(?<!\\)\|/g, '\\|')}${f}`);
const indentOf = (l) => /^ */.exec(l.replace(/\t/g, '    '))[0].length;
const isBlank = (l) => !l.trim();
const dedent = (l, n) => l.replace(/\t/g, '    ').replace(new RegExp(`^ {0,${n}}`), '');
const prefix = (lines, ind) => lines.map((l) => (l === '' ? '' : `${ind}${l}`));

// Plain heading text as both MkDocs and Docusaurus see it.
export function headingPlainText(md) {
  return md
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__|\*|_)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!<>])/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .trim();
}

export function parseFenceInfo(info, languages, known) {
  let s = info.trim();
  let lang = '';
  const meta = [];
  if (s.startsWith('{')) s = s.replace(/^\{|\}$/g, '').trim();
  const first = /^\.?([^\s=]+)(?=\s|$)/.exec(s);
  if (first) {
    lang = first[1].replace(/^\./, '');
    s = s.slice(first[0].length);
  }
  const attrs = {};
  for (const m of s.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g)) attrs[m[1]] = m[2] ?? m[3] ?? m[4];
  if (attrs.title) meta.push(`title=${JSON.stringify(attrs.title)}`);
  if (attrs.hl_lines) meta.push(`{${attrs.hl_lines.trim().split(/[\s,]+/).join(',')}}`);
  if (attrs.linenums) meta.push('showLineNumbers');
  let unknown = false;
  if (lang) {
    const lower = lang.toLowerCase();
    lang = languages[lower] ?? lower;
    if (known && !known.has(lang)) unknown = true;
  }
  return { lang: lang || 'text', meta: meta.join(' '), unknown, original: first?.[1] ?? '' };
}

// Collects the lines of a container (admonition, tab, details) opened at
// marker indent m: following lines that are blank or indented further.
function collectContainer(lines, start, m) {
  let j = start;
  let end = start;
  while (j < lines.length) {
    if (isBlank(lines[j])) { j++; continue; }
    if (indentOf(lines[j]) > m) { j++; end = j; continue; }
    break;
  }
  const body = lines.slice(start, end);
  const min = Math.min(...body.filter((l) => !isBlank(l)).map(indentOf));
  return { end, body: Number.isFinite(min) ? body.map((l) => (isBlank(l) ? '' : dedent(l, min))) : [] };
}

// Raw HTML block: until the first element closes (Python-Markdown's rule),
// or the first blank line when it never does.
function collectHtml(lines, start, root) {
  if (VOID_TAGS.has(root.toLowerCase())) return { end: start + 1, closed: true };
  let depth = 0;
  const re = new RegExp(`<!--[\\s\\S]*?-->|<(/?)(${root})(?=[\\s>/])[^>]*?(/?)>`, 'gi');
  for (let j = start; j < lines.length; j++) {
    for (const m of lines[j].matchAll(re)) {
      if (m[0].startsWith('<!--')) continue;
      if (m[1]) depth--;
      else if (!m[3]) depth++;
    }
    if (depth <= 0) return { end: j + 1, closed: true };
  }
  let j = start + 1;
  while (j < lines.length && !isBlank(lines[j])) j++;
  return { end: j, closed: false };
}

export class PageConverter {
  // ctx: link(href), image(src), partial(path), report(kind, msg), config, stats …
  constructor(ctx) {
    this.ctx = ctx;
    // Edition contexts (one when the page has no variants). Region sentinels
    // (see variants.mjs) say which of them each line belongs to; heading ids
    // are worked out per context, as each Edition's build sees them.
    this.contextIds = ctx.contextIds ?? ['*'];
    this.regions = ctx.regions ?? null;
    this.stack = [];
    this.ids = new Map(this.contextIds.map((c) => [c, { mk: new Set(), doc: new DocusaurusSlugger() }]));
    this.mkdocsIds = this.ids.get(this.contextIds[0]).mk;
    this.headings = [];
    this.title = null;
    this.titleRemoved = false;
    this.titleVaries = false;
    ctx.activeSet = () => this.activeSet();
    ctx.regionId = () => (this.stack.length ? this.stack[this.stack.length - 1] : null);
  }

  activeSet() {
    if (!this.stack.length || !this.regions) return this.contextIds;
    const set = this.regions.get(this.stack[this.stack.length - 1]).set;
    return this.contextIds.filter((c) => set.has(c));
  }

  // A sentinel line: enter or leave a region.
  sentinel(m) {
    const id = Number(m[3]);
    if (!m[2]) this.stack.push(id);
    else {
      const at = this.stack.lastIndexOf(id);
      if (at >= 0) this.stack.splice(at, 1);
    }
  }

  // Lines of a block that must not be split (code, raw HTML) but hold region
  // sentinels: one copy per group of contexts that sees the same lines, each
  // in a region of its own. Returns null when the block has no sentinels.
  variantsOf(lines, convert, indStr) {
    if (!this.regions || !lines.some((l) => SENTINEL_ANY.test(l))) return null;
    const groups = new Map();
    for (const c of this.activeSet()) {
      const mine = filterLines(lines, this.regions, c);
      const key = mine.join('\n');
      if (!groups.has(key)) groups.set(key, { lines: mine, set: [] });
      groups.get(key).set.push(c);
    }
    const out = [];
    const parent = this.stack.length ? this.stack[this.stack.length - 1] : null;
    for (const g of groups.values()) {
      if (groups.size === 1) return convert(g.lines);
      const id = this.regions.add(g.set, parent);
      this.stack.push(id);
      out.push(this.regions.open(id, indStr), ...convert(g.lines), this.regions.close(id, indStr));
      this.stack.pop();
    }
    return out;
  }

  convert(source) {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    this.ctx.refs = this.collectRefs(lines);
    const out = this.blocks(lines.filter((l, i) => !this.refLines.has(i)), 0, true);
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '\n');
  }

  collectRefs(lines) {
    const refs = new Map();
    this.refLines = new Set();
    let fence = null;
    lines.forEach((l, i) => {
      const f = FENCE.exec(l);
      if (f && !f[3].includes('`')) {
        if (!fence) fence = f[2][0];
        else if (f[2][0] === fence && !f[3].trim()) fence = null;
        return;
      }
      if (fence) return;
      const m = REFDEF.exec(l);
      if (m && !/^\^/.test(m[1])) {
        refs.set(m[1].trim().toLowerCase(), { url: m[2], title: m[3] });
        this.refLines.add(i);
      }
    });
    return refs;
  }

  // Converts a run of lines at one container level.
  blocks(lines, depth, top = false) {
    const out = [];
    let inList = false;
    let prevBlank = true;
    let para = [];
    const flushPara = () => {
      if (!para.length) return;
      const ind = /^ */.exec(para[0])[0];
      let rows = para;
      if (para.length > 1 && TABLE_DELIM.test(para[1])) rows = para.map(escapeCodePipes);
      // A line of only colons was stray text on the legacy site; in MDX it
      // would open a directive (and in a Markdown twin it still does): dropped.
      if (rows.some((l) => /^\s*:{3,}\s*$/.test(l))) this.ctx.report('text', 'a line of only colons (":::") dropped');
      rows = rows.filter((l, k) => k === 0 || !/^\s*:{3,}\s*$/.test(l));
      if (/^\s*:{3,}\s*$/.test(rows[0])) rows = rows.slice(1);
      if (!rows.length) { para = []; return; }
      const text = rows.map((l, k) => (k === 0 ? l.slice(ind.length) : l)).map((l) => l.replace(/^(\s*)(:{3,})/, '$1\\$2')).join('\n');
      const converted = convertInline(text, this.ctx);
      out.push(...converted.split('\n').map((l, k) => (k === 0 ? `${ind}${l}` : l)));
      para = [];
    };

    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (isBlank(line)) {
        flushPara();
        out.push('');
        prevBlank = true;
        i++;
        continue;
      }
      const ind = indentOf(line);
      const indStr = ' '.repeat(ind);
      const trimmed = line.trim();

      // Region sentinel: stands where a Jinja tag line was (a blank line).
      const sm = SENTINEL_LINE.exec(line);
      if (sm) {
        flushPara();
        this.sentinel(sm);
        out.push(line);
        prevBlank = true;
        i++;
        continue;
      }

      // Fenced code
      const f = FENCE.exec(line);
      if (f && !f[3].includes('`')) {
        flushPara();
        const fenceChar = f[2][0];
        let j = i + 1;
        while (j < lines.length) {
          const t = lines[j].trim();
          if (t.startsWith(f[2].slice(0, 3)) && new RegExp(`^${fenceChar === '`' ? '`' : '~'}{${f[2].length},}$`).test(t)) break;
          j++;
        }
        if (j >= lines.length) {
          // superfences treats a fence that never closes as plain text.
          this.ctx.report('code', `code fence "${trimmed.slice(0, 40)}" never closes; kept as text, as on the legacy site`);
          para.push(line.replace(/\t/g, '    ').replace(/`/g, '\\`'));
          prevBlank = false;
          i++;
          continue;
        }
        const info = parseFenceInfo(f[3], this.ctx.config.languages, this.ctx.knownLanguages);
        if (info.unknown) this.ctx.stats.unknownLanguages.add(info.lang);
        this.ctx.stats.codeBlocks++;
        const body = lines.slice(i + 1, j).map((l) => dedent(l, ind));
        const toCode = (ls) => prefix(fencedCode(this.codeText(ls.join('\n')), info.lang, info.meta), indStr);
        out.push(...(this.variantsOf(body, toCode, indStr) ?? toCode(body)));
        i = Math.min(j + 1, lines.length);
        prevBlank = false;
        continue;
      }

      // Admonitions and collapsibles
      const a = ADMON.exec(line);
      if (a && (a[3] || a[4] !== undefined)) {
        flushPara();
        const { end, body } = collectContainer(lines, i + 1, ind);
        const converted = this.blocks(body, depth + 1);
        const rawType = (a[3] ?? 'note').split(/\s+/)[0];
        if (a[2] === '!!!') {
          const type = this.ctx.admonitionType(rawType);
          const legacyTitle = a[4] !== undefined ? a[4] : rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
          const defaultTitle = type.charAt(0).toUpperCase() + type.slice(1);
          const title = legacyTitle && legacyTitle.toLowerCase() !== defaultTitle.toLowerCase() ? convertInline(legacyTitle, this.ctx) : '';
          out.push(...prefix(renderAdmonition(type, title, trimLines(converted)), indStr));
          this.ctx.stats.admonitions++;
        } else {
          const summary = a[4] ? convertInline(a[4], this.ctx) : rawType.charAt(0).toUpperCase() + rawType.slice(1);
          out.push(...prefix([`<details${a[2].endsWith('+') ? ' open' : ''}>`, `<summary>${summary}</summary>`, '', ...trimLines(converted), '', '</details>'], indStr));
          this.ctx.stats.details++;
        }
        i = end;
        prevBlank = false;
        continue;
      }

      // Content tabs: consecutive === markers at one indent form one set.
      const t = TAB.exec(line);
      if (t) {
        flushPara();
        const items = [];
        let j = i;
        while (j < lines.length) {
          const tm = TAB.exec(lines[j]);
          if (!tm || indentOf(lines[j]) !== ind || (items.length && tm[2] === '!')) break;
          const { end, body } = collectContainer(lines, j + 1, ind);
          items.push({ label: tm[3], selected: tm[2] === '+', body: this.blocks(body, depth + 1) });
          j = end;
          let k = j;
          while (k < lines.length && isBlank(lines[k])) k++;
          if (k < lines.length && TAB.exec(lines[k]) && indentOf(lines[k]) === ind && TAB.exec(lines[k])[2] !== '!') j = k;
          else break;
        }
        this.ctx.useTabs();
        this.ctx.stats.tabSets++;
        const values = new Set();
        const tabLines = [`<Tabs groupId=${quoteAttr(this.ctx.config.tabsGroupId ?? 'tabs')}>`];
        for (const item of items) {
          let value = fileSlug(item.label) || 'tab';
          for (let n = 2; values.has(value); n++) value = `${fileSlug(item.label) || 'tab'}-${n}`;
          values.add(value);
          tabLines.push(`<TabItem value=${quoteAttr(value)} label=${quoteAttr(item.label)}${item.selected ? ' default' : ''}>`, '', ...trimLines(item.body), '', '</TabItem>');
        }
        tabLines.push('</Tabs>');
        out.push(...prefix(tabLines, indStr));
        i = j;
        prevBlank = false;
        continue;
      }

      // {!includes/x.md!} → MDX partial
      const inc = INCLUDE.exec(line);
      if (inc) {
        flushPara();
        const name = this.ctx.partial(inc[2]);
        out.push(name ? `${inc[1]}<${name} />` : inc[1].trimEnd());
        if (LIST_ITEM.test(inc[1])) inList = true;
        i++;
        prevBlank = false;
        continue;
      }

      // HTML comment block → MDX comment
      if (trimmed.startsWith('<!--')) {
        flushPara();
        let j = i;
        while (j < lines.length && !lines[j].includes('-->')) j++;
        const body = lines.slice(i, j + 1).join('\n');
        const m = /^\s*<!--([\s\S]*?)-->([\s\S]*)$/.exec(body);
        if (m) {
          out.push(`${indStr}{/*${m[1].replace(/\*\//g, '* /')}*/}`);
          if (m[2].trim()) out.push(...this.blocks([`${indStr}${m[2].trim()}`], depth));
        }
        i = j + 1;
        prevBlank = false;
        continue;
      }

      // Raw HTML block
      const h = HTML_START.exec(line);
      if (h && BLOCK_TAGS.has(h[1].toLowerCase())) {
        flushPara();
        const { end, closed } = collectHtml(lines, i, h[1]);
        if (!closed) this.ctx.report('html', `<${h[1]}> block never closes; converted up to the next blank line`);
        const htmlLines = lines.slice(i, end).map((l) => dedent(l, ind));
        const toMdx = (ls) => prefix(htmlToMdx(ls.join('\n'), this.ctx), indStr);
        out.push(...(this.variantsOf(htmlLines, toMdx, indStr) ?? toMdx(htmlLines)));
        this.ctx.stats.htmlBlocks++;
        // Python-Markdown ends the block at its closing tag, so a next line
        // starts a block of its own; without a blank line MDX would join it
        // to this one's paragraph (or make a --- a setext heading).
        if (closed && !inList && end < lines.length && !isBlank(lines[end])) out.push('');
        i = end;
        prevBlank = false;
        continue;
      }

      // Blockquotes: their content is Markdown blocks too.
      if (/^\s{0,3}>/.test(line) || (inList && /^\s*>/.test(line))) {
        flushPara();
        let j = i;
        while (j < lines.length && !isBlank(lines[j]) && (j === i || /^\s*>/.test(lines[j]) || !ADMON.exec(lines[j]))) j++;
        const body = lines.slice(i, j).map((l) => l.replace(/^\s*> ?/, ''));
        out.push(...prefix(this.blocks(body, depth + 1).map((l) => (l ? `> ${l}` : '>')), indStr));
        i = j;
        prevBlank = false;
        continue;
      }

      // Headings
      const hd = HEADING.exec(line);
      if (hd && hd[3] !== undefined && (hd[1].length < 4 || inList)) {
        flushPara();
        out.push(...this.heading(hd, top && depth === 0));
        i++;
        if (ind === 0) inList = false;
        prevBlank = false;
        continue;
      }

      // Indented code (Python-Markdown), outside lists only
      // (Inside containers and includes, deeper indentation was content, not code.)
      if (top && depth === 0 && !this.ctx.isPartial && !inList && prevBlank && ind >= 4) {
        flushPara();
        let j = i;
        while (j < lines.length && (isBlank(lines[j]) || indentOf(lines[j]) >= 4)) j++;
        while (j > i && isBlank(lines[j - 1])) j--;
        const code = lines.slice(i, j).map((l) => dedent(l, 4)).join('\n');
        out.push(...fencedCode(this.codeText(code), 'text'));
        this.ctx.stats.indentedCode++;
        this.ctx.report('indented-code', `indented block "${lines[i].trim().slice(0, 50)}" became a code block (Python-Markdown read it as code too)`);
        i = j;
        prevBlank = false;
        continue;
      }

      // Paragraphs, list items, tables, quotes: inline conversion.
      const li = LIST_ITEM.exec(line);
      if (li) {
        flushPara();
        inList = true;
      } else if (ind === 0 && prevBlank && !trimmed.startsWith('|')) {
        inList = false;
      }
      para.push(line.replace(/\t/g, '    '));
      prevBlank = false;
      i++;
    }
    flushPara();
    return out;
  }

  codeText(code) {
    let c = code;
    if (c.includes('{{base_path}}')) {
      this.ctx.stats.basePathInCode++;
      c = c.replaceAll('{{base_path}}', this.ctx.legacyBase.replace(/\/$/, ''));
    }
    return c.replace(/\u0002([A-Za-z_]\w*)\u0002/g, '{edition.$1}');
  }

  heading(hd, mayBeTitle) {
    const [, ind, hashes] = hd;
    let text = hd[3].replace(/\s+#+\s*$/, '');
    let explicit = null;
    const attr = /\s*\{\s*:?\s*#([\w.:-]+)[^}]*\}\s*$/.exec(text);
    if (attr) {
      explicit = attr[1];
      text = text.slice(0, attr.index);
    }
    const level = hashes.length;
    const active = this.activeSet();
    // The heading's text in each context ({edition.*} values filled in).
    const plainFor = (c) => headingPlainText(this.ctx.tokenText ? this.ctx.tokenText(text, c) : text);
    const plains = new Map(active.map((c) => [c, plainFor(c)]));
    const converted = convertInline(text, this.ctx).trim();
    const allSame = new Set(plains.values()).size === 1;
    if (level === 1 && mayBeTitle && this.title === null && active.length === this.contextIds.length) {
      this.title = plains.get(active[0]);
      this.titleVaries = !allSame;
      // With Edition variables left in, for front matter that fills them per Edition.
      this.titleTemplate = headingPlainText(text).replace(/\u0002([A-Za-z_]\w*)\u0002/g, '{edition.$1}');
      // A plain-text H1 moves to front matter; Docusaurus renders it.
      if (allSame && converted === text.trim() && !/[\\`*_<[{\u0002]/.test(converted)) {
        this.titleRemoved = true;
        for (const c of active) this.ids.get(c).mk.add(mkdocsSlug(plains.get(c)));
        this.headings.push({ level, text: this.title, id: mkdocsSlug(this.title), ids: new Map(active.map((c) => [c, mkdocsSlug(this.title)])), title: true });
        return [];
      }
    }
    const mkIds = new Map();
    const docIds = new Map();
    for (const c of active) {
      const st = this.ids.get(c);
      const mk = explicit ?? mkdocsUnique(mkdocsSlug(plains.get(c)), st.mk);
      if (explicit) st.mk.add(explicit);
      mkIds.set(c, mk);
      docIds.set(c, st.doc.peek(plains.get(c)));
    }
    const mkSet = new Set(mkIds.values());
    const needsId = active.some((c) => mkIds.get(c) !== docIds.get(c));
    const ids = new Map(mkIds);
    let suffix = '';
    if (needsId && mkSet.size === 1) {
      const [mkId] = mkSet;
      suffix = ind ? ` {/* #${mkId} */}` : ` {#${mkId}}`;
      this.ctx.stats.explicitIds++;
    } else if (needsId) {
      // The legacy id differs per Edition and from Docusaurus's: one heading per Edition.
      this.ctx.report('heading', `heading "${plains.get(active[0])}" has a different id in each Edition; written once per Edition`);
      const out = [];
      const parent = this.stack.length ? this.stack[this.stack.length - 1] : null;
      const groups = new Map();
      for (const c of active) {
        const key = mkIds.get(c);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
      for (const [mkId, set] of groups) {
        const id = this.regions.add(set, parent);
        const lit = this.ctx.tokenText ? this.ctx.tokenText(text, set[0]) : text;
        out.push(this.regions.open(id, ind), `${ind}${hashes} ${convertInline(lit, this.ctx).trim()}${ind ? ` {/* #${mkId} */}` : ` {#${mkId}}`}`, this.regions.close(id, ind));
      }
      this.headings.push({ level, text: plains.get(active[0]), id: mkIds.get(active[0]), ids });
      return out;
    }
    for (const c of active) {
      if (!needsId) this.ids.get(c).doc.commit(plains.get(c));
    }
    this.headings.push({ level, text: plains.get(active[0]), id: mkIds.get(active[0]), ids });
    return [`${ind}${hashes} ${converted}${suffix}`];
  }
}

function trimLines(lines) {
  let s = 0;
  let e = lines.length;
  while (s < e && lines[s] === '') s++;
  while (e > s && lines[e - 1] === '') e--;
  return lines.slice(s, e);
}
