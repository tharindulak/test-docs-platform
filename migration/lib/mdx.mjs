// Small MDX writers shared by the Markdown and HTML converters: escaping,
// JSX attributes, style objects and images.

// Lower-case HTML element names. A <name> in prose that is not one of these
// is a placeholder (<API-M_HOME>), not markup.
export const HTML_TAGS = new Set(`a abbr address area article aside audio b bdi bdo blockquote body br button canvas caption
center cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure font
footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark
menu meta meter nav noscript object ol optgroup option output p param picture pre progress q s samp script section
select small source span strike strong style sub summary sup table tbody td template textarea tfoot th thead time title tr
track tt u ul var video wbr`.split(/\s+/));

export const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

// Python-Markdown's block-level elements: a line starting with one of these
// opens a raw HTML block, where Markdown is not processed.
export const BLOCK_TAGS = new Set(`address article aside blockquote body canvas center colgroup dd details div dl dt fieldset
figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr html iframe legend li main map menu nav noscript ol output
p pre section script style summary table tbody td textarea tfoot th thead tr ul video`.split(/\s+/));

const ATTR_RENAMES = {
  class: 'className', for: 'htmlFor', colspan: 'colSpan', rowspan: 'rowSpan', tabindex: 'tabIndex',
  cellpadding: 'cellPadding', cellspacing: 'cellSpacing', valign: 'vAlign', frameborder: 'frameBorder',
  allowfullscreen: 'allowFullScreen', maxlength: 'maxLength', readonly: 'readOnly', srcset: 'srcSet',
  crossorigin: 'crossOrigin', autoplay: 'autoPlay', contenteditable: 'contentEditable', spellcheck: 'spellCheck',
  'accept-charset': 'acceptCharset', 'http-equiv': 'httpEquiv', datetime: 'dateTime', novalidate: 'noValidate',
  playsinline: 'playsInline', referrerpolicy: 'referrerPolicy', bgcolor: 'bgColor',
};

// Text for Markdown: escape what MDX would read as JSX or expressions.
export function escapeMdxText(s) {
  return s.replace(/[{}<]/g, (c) => `\\${c}`);
}

// Text that came from HTML, where Markdown was never processed: also escape
// Markdown syntax so it stays literal.
export function escapeHtmlText(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/[`*[\]{}<>|]/g, (c) => `\\${c}`)
    .replace(/(^|\s)_|_(?=\s|$)/g, (m) => m.replace('_', '\\_'))
    .replace(/&(?=#?\w+;)/g, '&amp;');
}

export function styleObject(css) {
  const entries = [];
  for (const decl of css.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim().replace(/\s*!important$/, '');
    if (!prop || !value) continue;
    const key = prop.startsWith('--') ? JSON.stringify(prop) : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    entries.push(`${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${JSON.stringify(value)}`);
  }
  return entries.length ? `{{${entries.join(', ')}}}` : null;
}

// One JSX attribute; returns null to drop it. `value` null means a boolean attribute.
export function jsxAttr(name, value, { dropClass = false } = {}) {
  const lower = name.toLowerCase();
  if (lower.startsWith('on')) return null; // event handlers never ran in MDX
  if (lower === 'class' && dropClass) return null;
  if (lower === 'style') {
    const obj = value ? styleObject(value) : null;
    return obj ? `style=${obj}` : null;
  }
  const jsxName = ATTR_RENAMES[lower] ?? (/^(data|aria)-/.test(lower) ? lower : name.includes('-') ? null : name);
  if (!jsxName) return null;
  if (value === null || value === undefined) return jsxName;
  return `${jsxName}=${quoteAttr(value)}`;
}

export function quoteAttr(value) {
  return /["\\\n{}]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;
}

// An image as Markdown when it has no size or style, otherwise as JSX.
// Local images go through require() so Docusaurus bundles them.
export function imageMdx({ src, alt = '', title, style, width, height, local }) {
  if (!style && !width && !height) {
    const t = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
    return `![${alt.replace(/([[\]\\])/g, '\\$1').replace(/[{}<]/g, (c) => `\\${c}`)}](${encodeLinkDest(src)}${t})`;
  }
  const attrs = [local ? `src={require(${JSON.stringify(src)}).default}` : `src=${quoteAttr(src)}`];
  if (alt) attrs.push(`alt=${quoteAttr(alt)}`);
  if (title) attrs.push(`title=${quoteAttr(title)}`);
  if (width) attrs.push(`width=${quoteAttr(String(width))}`);
  if (height) attrs.push(`height=${quoteAttr(String(height))}`);
  const st = style ? styleObject(style) : null;
  if (st) attrs.push(`style=${st}`);
  return `<img ${attrs.join(' ')} />`;
}

// An image that differs between Editions (each tree has its own screenshot
// at the same path): one image per Edition, each in an inline <Edition>. A
// Cloud and a Self-hosted image are an Edition variant (<Variants>), so Cloud
// shows only its own.
export function imageOrVariants(img, props) {
  if (!img.alternatives) return imageMdx({ ...props, ...(img.alt !== undefined ? { alt: img.alt } : {}), src: img.src, local: img.local });
  const out = img.alternatives.map((a) => {
    const one = a.src ? imageMdx({ ...props, ...(a.alt !== undefined ? { alt: a.alt } : {}), src: a.src, local: a.local }) : '';
    return a.attrs ? `<Edition ${a.attrs}>${one}</Edition>` : one;
  }).join('');
  const kinds = img.alternatives.map((a) => /only="([^"]+)"/.exec(a.attrs ?? '')?.[1] ?? null).sort().join(',');
  return img.alternatives.length === 2 && kinds === 'cloud,self-hosted' ? `<Variants>${out}</Variants>` : out;
}

export function encodeLinkDest(url) {
  // Spaces, angle brackets and unbalanced parentheses would end a Markdown
  // link destination.
  const u = url.replace(/ /g, '%20').replace(/</g, '%3C').replace(/>/g, '%3E');
  const open = (u.match(/\(/g) ?? []).length;
  const close = (u.match(/\)/g) ?? []).length;
  return open === close ? u : u.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export function pascalCase(s) {
  const p = s.replace(/^_+/, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[0-9]/.test(p) ? `P${p}` : p;
}
