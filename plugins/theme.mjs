// The shared theme (lib/theme-bundle.mjs) on every page: the favicons, and
// the stylesheet at /_platform/theme/v<major>/theme.css, a host-root address
// outside the deployment's baseUrl, so the Edge Worker can serve the live
// theme to every deployment of the major without a rebuild. The build's own
// styles.<hash>.css keeps Infima, Docusaurus's component CSS and the CSS
// two Platform components import (search, page actions); the Platform's
// component stylesheets (chrome, API reference, layouts) are in the theme.
//
// Away from the edge a page shows the theme of the checkout it was built
// from: a build writes the bundle into its output at _platform/theme/v<major>/
// (found by a static server rooted at the deployment, or at the Landing
// build), and the dev server (preview) serves it at that host-root address and
// swaps it in place when a file in site/wso2-theme/ changes.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { THEME_DIR, themeBase, themeMajor, writeThemeBundle } from '../lib/theme-bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// The tags every page carries. The stylesheet opens <body>, after the build's
// stylesheets in <head>, so the theme's rules win over Infima's and
// Docusaurus's of the same specificity, as they did when they were bundled
// after them. The empty script after it holds the parser until the theme has
// loaded (a script waits for the stylesheets before it), so no browser paints
// the page unstyled.
export function themeHtmlTags(base) {
  return {
    headTags: [
      // The Identity Platform docs' pulse as the favicon, with PNGs for
      // browsers and home screens that take no SVG.
      { tagName: 'link', attributes: { rel: 'icon', type: 'image/svg+xml', href: `${base}img/favicon.svg` } },
      { tagName: 'link', attributes: { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${base}img/favicon-32.png` } },
      { tagName: 'link', attributes: { rel: 'apple-touch-icon', sizes: '180x180', href: `${base}img/apple-touch-icon.png` } },
    ],
    preBodyTags: [
      { tagName: 'link', attributes: { rel: 'stylesheet', href: `${base}theme.css`, 'data-wso2-theme': 'true' } },
      { tagName: 'script', innerHTML: '' },
    ],
  };
}

export default function theme(context) {
  const major = themeMajor();
  const base = themeBase(major);
  const dev = process.env.NODE_ENV === 'development';
  const devDir = path.join(context.generatedFilesDir, 'wso2-theme');
  const devBundle = path.join(devDir, `v${major}`);

  // The dev server's copy, and a module naming its version: the dev client
  // imports it, so webpack's hot reload tells the page when it changes.
  async function writeDevBundle() {
    fs.rmSync(devBundle, { recursive: true, force: true });
    const files = await writeThemeBundle(devBundle, { urlBase: base });
    const hash = createHash('sha256');
    for (const f of files) hash.update(f).update(fs.readFileSync(path.join(devBundle, f)));
    const version = `export default ${JSON.stringify(hash.digest('hex').slice(0, 12))};\n`;
    const file = path.join(devDir, 'version.js');
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== version) fs.writeFileSync(file, version);
  }

  return {
    name: 'wso2-theme',
    injectHtmlTags: () => themeHtmlTags(base),
    ...(dev ? {
      getPathsToWatch: () => [path.join(THEME_DIR, '**', '*')],
      async loadContent() { await writeDevBundle(); },
      getClientModules: () => [path.join(here, 'theme-dev-client.mjs')],
      configureWebpack(config, isServer) {
        if (isServer) return {};
        return { devServer: { static: [{ directory: devBundle, publicPath: base, watch: false }] } };
      },
    } : {}),
    async postBuild({ outDir }) {
      await writeThemeBundle(path.join(outDir, '_platform', 'theme', `v${major}`), { urlBase: base });
    },
  };
}
