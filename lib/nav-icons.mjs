// Sidebar icons (Extension points): the allow-list of names a page's
// `sidebar_custom_props: { icon }` or a folder's `_category_.yml`
// `customProps: { icon }` may use, and the SVG each one draws. Names follow
// the MkDocs Material form wso2/docs-is used:
//   octicons/<name>-16          every 16px Octicon in the pinned @primer/octicons
//   fontawesome/brands/<name>   Font Awesome Free brand icons copied into icons/
//   fontawesome/solid/<name>    Font Awesome Free solid icons copied into icons/
//   wso2/<name>                 WSO2's own icons, copied from wso2/docs-is into icons/
// Licences and attribution: THIRD-PARTY-NOTICES.md. The build inlines the
// SVG of each icon a sidebar uses (plugins/nav-icons.mjs); nothing loads in
// the browser, and only used icons reach readers.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ICONS_DIR = path.join(here, '..', 'icons');
const require = createRequire(import.meta.url);

// The box every icon is fitted into, keeping its aspect ratio: a square glyph
// is 16×16, a narrow Font Awesome one 14×16, a wide logo 16 wide.
export const NAV_ICON_BOX = 16;

export const NAV_ICON_SOURCES = [
  { prefix: 'octicons/', title: 'Octicons', from: '@primer/octicons 18.0.0 (16px icons)', licence: 'MIT' },
  { prefix: 'fontawesome/', title: 'Font Awesome Free', from: '@fortawesome/fontawesome-free 6.3.0', licence: 'CC BY 4.0' },
  { prefix: 'wso2/', title: 'WSO2', from: 'wso2/docs-is custom icons', licence: 'Apache-2.0' },
];

// Comments go, except Font Awesome's `<!--! … -->` attribution; titles go
// (the icon is decorative), and so does the whitespace between tags.
function cleanBody(inner) {
  return inner
    .replace(/<!--(?!!)[^]*?-->/g, '')
    .replace(/<title>[^]*?<\/title>/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

function fit(w, h) {
  const r = (x) => Math.round(x * 100) / 100;
  return w >= h ? { width: NAV_ICON_BOX, height: r((NAV_ICON_BOX * h) / w) } : { width: r((NAV_ICON_BOX * w) / h), height: NAV_ICON_BOX };
}

function fromSvgFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const open = /<svg\b[^>]*>/.exec(text);
  if (!open) throw new Error(`${file}: no <svg> element`);
  const viewBox = /\bviewBox="([^"]+)"/.exec(open[0])?.[1];
  if (!viewBox) throw new Error(`${file}: the <svg> element has no viewBox`);
  const [, , w, h] = viewBox.trim().split(/[\s,]+/).map(Number);
  const inner = text.slice(open.index + open[0].length, text.lastIndexOf('</svg>'));
  return { viewBox, ...fit(w, h), body: cleanBody(inner) };
}

let cache = null;
function load() {
  if (cache) return cache;
  const icons = new Map();
  const octicons = require('@primer/octicons/build/data.json');
  for (const [name, o] of Object.entries(octicons)) {
    const h = o.heights?.['16'];
    if (!h) continue;
    icons.set(`octicons/${name}-16`, { viewBox: `0 0 ${h.width} 16`, ...fit(h.width, 16), body: cleanBody(h.path) });
  }
  for (const rel of fs.readdirSync(ICONS_DIR, { recursive: true }).map((f) => String(f).split(path.sep).join('/')).filter((f) => f.endsWith('.svg')).sort()) {
    icons.set(rel.replace(/\.svg$/, ''), fromSvgFile(path.join(ICONS_DIR, rel)));
  }
  cache = icons;
  return icons;
}

// Every allowed name, sorted.
export const navIconNames = () => [...load().keys()].sort();

// { viewBox, width, height, body } for an allowed name, else null.
export const navIcon = (name) => (typeof name === 'string' ? load().get(name) ?? null : null);

// Why a value can't be an icon name, or null when it is one. The message
// names a close allowed name when there is one.
export function navIconProblem(value) {
  if (typeof value !== 'string' || !value.trim()) return `the icon must be a name such as "octicons/rocket-16" (got ${JSON.stringify(value)})`;
  if (load().has(value)) return null;
  const names = navIconNames();
  const base = value.split('/').pop().replace(/\.svg$/, '').replace(/-(12|16|24|48)$/, '');
  const close = names.filter((n) => n.split('/').pop().replace(/-16$/, '') === base);
  return `"${value}" is not a sidebar icon${close.length ? `; did you mean ${close.map((n) => `"${n}"`).join(' or ')}?` : ''}`;
}
