// The WSO2 Docs theme as one bundle: site/wso2-theme/'s stylesheets joined
// into one theme.css, with its fonts/ and img/. Every page links it at a
// host-root address, /_platform/theme/v<major>/, so a theme change reaches
// every live Docs deployment of a Platform major without rebuilding it. The
// Edge Worker serves the live theme there; away from the edge, preview and
// build serve the checkout's own (plugins/theme.mjs). Style only: what the
// markup or JavaScript decides still needs a Platform release.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const THEME_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'wso2-theme');

// The stylesheets in cascade order: the fonts, the variables every other one
// reads, then the rules on them: the Platform's components first (chrome,
// API reference pages, page layouts), then the doc pages, the sidebar icons
// and the code colours, which win where they meet. A file in css/ that isn't
// listed here is an error, so none is silently left out.
export const THEME_CSS = ['fonts.css', 'theme.css', 'chrome.css', 'api-reference.css', 'layouts.css', 'custom.css', 'nav-icons.css', 'code.css'];

// The folders copied beside theme.css, which its url()s and the pages name.
const ASSET_DIRS = ['fonts', 'img'];

const PKG = path.join(THEME_DIR, '..', '..', 'package.json');

// The Platform major the theme belongs to: one theme per major.
export function themeMajor() {
  const { version } = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const major = /^(\d+)\./.exec(version)?.[1];
  if (major === undefined) throw new Error(`package.json version "${version}" has no major`);
  return Number(major);
}

// The host-root address of this major's theme, as pages link it.
export const themeBase = (major = themeMajor()) => `/_platform/theme/v${major}/`;

const filesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
  .filter((e) => e.isFile() && !e.name.startsWith('.'))
  .map((e) => e.name)
  .sort();

// A stylesheet's url()s point at ../fonts/ and ../img/ (beside css/ in the
// theme folder, so editors resolve them); in the bundle they start with
// urlBase. data: URIs stay as they are. Anything else is refused.
function rewriteUrls(css, file, urlBase) {
  return css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/g, (m, dq, sq, bare) => {
    const ref = dq ?? sq ?? bare;
    if (ref.startsWith('data:')) return m;
    const rel = /^\.\.\/((?:fonts|img)\/[^/]+)$/.exec(ref)?.[1];
    if (!rel) throw new Error(`site/wso2-theme/css/${file}: url(${ref}) must name ../fonts/<file> or ../img/<file>`);
    if (!fs.existsSync(path.join(THEME_DIR, rel))) throw new Error(`site/wso2-theme/css/${file}: url(${ref}) names a file that doesn't exist`);
    return `url('${urlBase}${rel}')`;
  });
}

// The bundle's theme.css, as a string.
export function themeCss({ urlBase }) {
  if (!/^\/.*\/$/.test(urlBase ?? '')) throw new Error(`urlBase must start and end with "/", e.g. ${themeBase()}`);
  const present = filesIn(path.join(THEME_DIR, 'css')).filter((f) => f.endsWith('.css'));
  const unlisted = present.filter((f) => !THEME_CSS.includes(f));
  if (unlisted.length) throw new Error(`site/wso2-theme/css/: ${unlisted.join(', ')} not in THEME_CSS (lib/theme-bundle.mjs)`);
  const parts = THEME_CSS.map((f) => {
    const css = fs.readFileSync(path.join(THEME_DIR, 'css', f), 'utf8').trim();
    return `/* ---- ${f} ---- */\n${rewriteUrls(css, f, urlBase)}\n`;
  });
  return `/* The WSO2 Docs theme (site/wso2-theme/ in the Platform repo). */\n\n${parts.join('\n')}`;
}

// Writes the bundle into dir: theme.css, fonts/ and img/. Returns the written
// paths, relative to dir and sorted. The same inputs write the same bytes.
export async function writeThemeBundle(dir, { urlBase } = {}) {
  const css = themeCss({ urlBase });
  const written = [];
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, 'theme.css'), css);
  written.push('theme.css');
  for (const sub of ASSET_DIRS) {
    const files = filesIn(path.join(THEME_DIR, sub));
    if (!files.length) continue;
    await fs.promises.mkdir(path.join(dir, sub), { recursive: true });
    for (const f of files) {
      await fs.promises.copyFile(path.join(THEME_DIR, sub, f), path.join(dir, sub, f));
      written.push(`${sub}/${f}`);
    }
  }
  return written.sort();
}
