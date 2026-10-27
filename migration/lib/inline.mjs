// Inline conversion of one Python-Markdown paragraph (it may span lines) into
// MDX: links and images through the context's resolvers, inline HTML made
// JSX-valid, placeholders such as <API-M_HOME> and {org} wrapped in
// backticks, attr lists dropped or turned into image styles, autolinks and
// comments rewritten, and stray braces and angle brackets escaped.
import { HTML_TAGS, VOID_TAGS, escapeMdxText, imageOrVariants, jsxAttr, encodeLinkDest } from './mdx.mjs';

export const VAR_TOKEN = /\u0002([A-Za-z_]\w*)\u0002/g;

// Attributes of one HTML start tag.
export function parseAttrs(tag) {
  const attrs = {};
  const body = tag.replace(/^<[\w-]+/, '').replace(/\/?>$/, '');
  const re = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(body))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? null;
  return attrs;
}

// attr_list after an image or link: {: style="width:70%"} or {target=_blank}
const ATTR_LIST = /^\{:?\s*([^{}\n]*)\}/;

function parseAttrList(body) {
  const out = {};
  const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))|([#.][\w-]+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[5]) out[m[5][0] === '#' ? 'id' : 'class'] = m[5].slice(1);
    else out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
  }
  return out;
}

function findClosingBracket(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '`') {
      const run = /^`+/.exec(s.slice(j))[0];
      const close = s.indexOf(run, j + run.length);
      if (close > 0) { j = close + run.length - 1; continue; }
    }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

// Parses [text](dest "title") or ![alt](dest) at i (s[i] === '['). Reference
// links use the paragraph's definitions.
function parseLink(s, i, refs) {
  const close = findClosingBracket(s, i);
  if (close < 0) return null;
  const text = s.slice(i + 1, close);
  if (s[close + 1] === '(') {
    let j = close + 2;
    while (s[j] === ' ' || s[j] === '\n') j++;
    let dest;
    if (s[j] === '<') {
      const e = s.indexOf('>', j);
      if (e < 0) return null;
      dest = s.slice(j + 1, e);
      j = e + 1;
    } else {
      let depth = 0;
      const start = j;
      for (; j < s.length; j++) {
        const c = s[j];
        if (c === '\\') { j++; continue; }
        if (c === '(') depth++;
        else if (c === ')') { if (depth === 0) break; depth--; }
        else if (c === ' ' || c === '\n') break;
      }
      dest = s.slice(start, j);
    }
    while (s[j] === ' ' || s[j] === '\n') j++;
    let title;
    if (s[j] === '"' || s[j] === "'") {
      const q = s[j];
      const e = s.indexOf(q, j + 1);
      if (e < 0) return null;
      title = s.slice(j + 1, e);
      j = e + 1;
      while (s[j] === ' ') j++;
    }
    if (s[j] !== ')') return null;
    return { text, dest, title, end: j + 1 };
  }
  const refMatch = /^\[([^\]]*)\]/.exec(s.slice(close + 1));
  const key = (refMatch && refMatch[1] ? refMatch[1] : text).trim().toLowerCase();
  if (refs?.has(key)) {
    const def = refs.get(key);
    return { text, dest: def.url, title: def.title, end: close + 1 + (refMatch ? refMatch[0].length : 0) };
  }
  return null;
}

const PLACEHOLDER_ANGLE = /<[A-Za-z_$][^<>\n]{0,80}?>/;

// Plain text: wrap placeholder tokens in backticks, escape the rest.
function convertText(text, ctx) {
  if (!/[<>{}\u0002]/.test(text)) return text;
  // Multi-word angle placeholders (<environment name>) first.
  let s = text.replace(/<([A-Za-z_][\w.-]*(?: [\w.-]+)+)>/g, (m) => `\u0003${m}\u0003`);
  s = s.replace(/[^\s\u0003]+/g, (token) => {
    if (!/<[^<>]+>|\{[^{}]*\}/.test(token) || token.includes('\u0002')) return token;
    // A table cell's pipe next to the token (`**GET /users/{id}**|`) is not part of it.
    const lead = /^[(["'*_|]*/.exec(token)[0];
    const trail = /[)\]"'.,;:!?*_|]*$/.exec(token.slice(lead.length))[0];
    const core = token.slice(lead.length, token.length - trail.length);
    if (!core || core.includes('`')) return token;
    ctx.stats.placeholders++;
    return `${lead}\u0003${core}\u0003${trail}`;
  });
  // Escape what is left outside the protected placeholders.
  return s
    .split('\u0003')
    .map((part, idx) => (idx % 2 ? `\`${part}\`` : escapeMdxText(part).replace(VAR_TOKEN, '{edition.$1}')))
    .join('');
}

function codeSpan(run, content, ctx) {
  let c = content;
  if (c.includes('{{base_path}}')) {
    ctx.stats.basePathInCode++;
    c = c.replaceAll('{{base_path}}', ctx.legacyBase.replace(/\/$/, ''));
  }
  c = c.replace(VAR_TOKEN, '{edition.$1}');
  return `${run}${c}${run}`;
}

function convertImage(alt, dest, title, attrs, ctx) {
  const altText = alt.replace(/\\([[\]])/g, '$1');
  const img = ctx.image(dest, altText);
  if (!img) return ctx.missingImage(altText, dest);
  return imageOrVariants(img, {
    alt: altText, title,
    style: attrs.style, width: attrs.width, height: attrs.height,
  });
}

function linkOut(text, href, title, ctx) {
  const r = ctx.link(href);
  if (r.drop) return text;
  const t = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
  return `[${text}](${encodeLinkDest(r.href)}${t})`;
}

export function convertInline(s, ctx, refs = ctx.refs) {
  let out = '';
  let text = '';
  const flush = () => {
    out += convertText(text, ctx);
    text = '';
  };
  const raw = (v) => {
    flush();
    out += v;
  };
  const tagBalance = new Map();
  const openClose = (name) => {
    if (!tagBalance.has(name)) {
      const opens = (s.match(new RegExp(`<${name}(?=[\\s>/])`, 'gi')) ?? []).length;
      const closes = (s.match(new RegExp(`</${name}\\s*>`, 'gi')) ?? []).length;
      tagBalance.set(name, opens === closes);
    }
    return tagBalance.get(name);
  };

  for (let i = 0; i < s.length;) {
    const c = s[i];
    const rest = s.slice(i);
    if (c === '\\' && i + 1 < s.length) {
      raw(s.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (c === '`') {
      const run = /^`+/.exec(rest)[0];
      // The closing run must be exactly as long.
      let e = -1;
      const re = /`+/g;
      re.lastIndex = i + run.length;
      for (let m; (m = re.exec(s));) {
        if (m[0].length === run.length) { e = m.index; break; }
      }
      if (e > 0) {
        raw(codeSpan(run, s.slice(i + run.length, e), ctx));
        i = e + run.length;
        continue;
      }
      raw(run.replace(/`/g, '\\`'));
      i += run.length;
      continue;
    }
    if (c === '!' && s[i + 1] === '[') {
      const l = parseLink(s, i + 1, refs);
      if (l) {
        let end = l.end;
        let attrs = {};
        const al = ATTR_LIST.exec(s.slice(end));
        if (al) { attrs = parseAttrList(al[1]); end += al[0].length; }
        raw(convertImage(l.text, l.dest, l.title, attrs, ctx));
        i = end;
        continue;
      }
    }
    if (c === '[') {
      const l = parseLink(s, i, refs);
      if (l) {
        let end = l.end;
        const al = ATTR_LIST.exec(s.slice(end));
        if (al) end += al[0].length; // {: target="_blank"} on links is dropped
        // [![img](a.png)](a.png): the lightbox link around an image goes
        // (image zoom replaces glightbox).
        const inner = /^\s*!\[[^\]]*\]\(([^)\s]+)[^)]*\)(\{:?[^}]*\})?\s*$/.exec(l.text);
        if (inner && (inner[1] === l.dest || /\.(png|jpe?g|gif|svg|webp)$/i.test(l.dest.split(/[?#]/)[0]))) {
          raw(convertInline(l.text, ctx, refs));
        } else {
          raw(linkOut(convertInline(l.text, ctx, refs), l.dest, l.title, ctx));
        }
        i = end;
        continue;
      }
    }
    if (c === '{') {
      if (rest.startsWith('{{base_path}}')) {
        ctx.stats.basePathInText++;
        text += ctx.legacyBase.replace(/\/$/, '');
        i += '{{base_path}}'.length;
        continue;
      }
      const al = /^\{:\s*[^{}\n]*\}/.exec(rest);
      if (al) {
        ctx.report('attr-list', `attr list ${al[0]} dropped`);
        i += al[0].length;
        continue;
      }
    }
    if (c === '<') {
      const comment = /^<!--([\s\S]*?)-->/.exec(rest);
      if (comment) {
        raw(`{/*${comment[1].replace(/\*\//g, '* /')}*/}`);
        i += comment[0].length;
        continue;
      }
      const auto = /^<((?:https?|ftp):\/\/[^\s<>]+|mailto:[^\s<>]+)>/i.exec(rest);
      if (auto) {
        raw(linkOut(auto[1].replace(/[_*[\]]/g, '\\$&'), auto[1], null, ctx));
        i += auto[0].length;
        continue;
      }
      const email = /^<([\w.+-]+@[\w-]+\.[\w.-]+)>/.exec(rest);
      if (email) {
        raw(`[${email[1]}](mailto:${email[1]})`);
        i += email[0].length;
        continue;
      }
      // VuePress <Badge text=… />: an unknown element that rendered as nothing.
      const badge = /^<Badge\b(?:[^<>"']|"[^"]*"|'[^']*')*\/?>(?:<\/Badge>)?/.exec(rest);
      if (badge) {
        flush();
        i += badge[0].length;
        continue;
      }
      const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^<>"']|"[^"]*"|'[^']*')*)>/.exec(rest);
      if (tag && HTML_TAGS.has(tag[2].toLowerCase()) && tag[2] === tag[2].toLowerCase()) {
        const name = tag[2].toLowerCase();
        const closing = tag[1] === '/';
        const attrs = parseAttrs(tag[0]);
        const r = convertInlineTag({ name, closing, attrs, s, i, tag: tag[0], balanced: VOID_TAGS.has(name) || openClose(name) }, ctx, refs);
        if (r) {
          raw(r.out);
          i = r.end;
          continue;
        }
      }
    }
    text += c;
    i += 1;
  }
  flush();
  return out;
}

function convertInlineTag({ name, closing, attrs, s, i, tag, balanced }, ctx, refs) {
  const end = i + tag.length;
  if (name === 'br') return { out: '<br />', end };
  if (['html', 'body', 'head', 'p', 'div', 'font', 'center', 'span'].includes(name) && !(name === 'span' && attrs.id)) {
    return { out: '', end }; // wrappers that carry only MkDocs styling
  }
  if (name === 'img' && !closing) {
    if (!attrs.src) return { out: '', end };
    return { out: convertImage(attrs.alt ?? '', attrs.src, attrs.title, { style: attrs.style, width: attrs.width, height: attrs.height }, ctx), end };
  }
  if (name === 'a' && !closing) {
    const closeIdx = s.toLowerCase().indexOf('</a>', end);
    const anchorId = attrs.id ?? attrs.name;
    if (anchorId) {
      ctx.useAnchor();
      return { out: `<Anchor id=${JSON.stringify(anchorId)} />`, end };
    }
    if (attrs.href && closeIdx >= 0) {
      const inner = s.slice(end, closeIdx);
      return { out: linkOut(convertInline(inner.trim(), ctx, refs), attrs.href.trim(), attrs.title, ctx), end: closeIdx + 4 };
    }
    return { out: '', end };
  }
  if (name === 'a' && closing) return { out: '', end };
  if (name === 'code' && !closing) {
    const closeIdx = s.toLowerCase().indexOf('</code>', end);
    if (closeIdx >= 0) {
      const inner = s.slice(end, closeIdx);
      if (!/<(?!\/?(?:b|i|em|strong)\b)[a-z]/i.test(inner)) {
        const textOnly = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\n/g, ' ');
        const fence = textOnly.includes('`') ? '``' : '`';
        const pad = textOnly.startsWith('`') || textOnly.endsWith('`') ? ' ' : '';
        return { out: codeSpan(fence, `${pad}${textOnly}${pad}`, ctx), end: closeIdx + 7 };
      }
    }
  }
  if (['script', 'style'].includes(name) && !closing) {
    const closeIdx = s.toLowerCase().indexOf(`</${name}>`, end);
    if (name === 'script' && closeIdx >= 0 && ctx.script?.(s.slice(end, closeIdx))) return { out: '', end: closeIdx + name.length + 3 };
    ctx.report('html', `inline <${name}> removed`);
    return { out: '', end: closeIdx >= 0 ? closeIdx + name.length + 3 : end };
  }
  if (!balanced) {
    ctx.report('html', `unbalanced inline <${closing ? '/' : ''}${name}> removed`);
    return { out: '', end };
  }
  if (closing) return { out: `</${name}>`, end };
  for (const k of Object.keys(attrs)) if (/^on/.test(k)) ctx.report('html', `<${name} ${k}=…> script handler removed`);
  const jsx = Object.entries(attrs).map(([k, v]) => jsxAttr(k, v, { dropClass: true })).filter(Boolean);
  const selfClose = VOID_TAGS.has(name) ? ' /' : '';
  return { out: `<${name}${jsx.length ? ` ${jsx.join(' ')}` : ''}${selfClose}>`, end };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', rarr: '→', larr: '←' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
