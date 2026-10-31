#!/usr/bin/env node
// axe on a Platform pull request that changes the theme (site/wso2-theme/):
// serves a Sandbox build with the Landing build at the host root, so pages
// find the theme at /_platform/theme/v<major>/ as they do on the edge, and
// runs pa11y-ci (axe, WCAG 2 AA) on a few Sandbox pages in light and dark at
// desktop width and 375 px. Any violation, or a page that can't be checked,
// fails. ci.yml runs it; it runs the same on your own computer.
//
//   node scripts/theme-axe.mjs --landing <dir> --sandbox <dir> [--base /sandbox/cloud/]
//        [--config-out <file>] [--screenshots <dir>] [--chrome <path>]
//
// --landing and --sandbox are build outputs (wso2-docs build --landing, and
// wso2-docs build <sandbox> --edition cloud). --chrome names a Chromium for
// pa11y-ci's Puppeteer instead of the one it downloads.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { themeBase } from '../lib/theme-bundle.mjs';

// The tool the nightly reports and the theme release run, at the same version.
// pa11y-ci 4 and later run Puppeteer's current Chromium: 3.x ran Chromium 91,
// which has no :has(), so axe saw a different page than readers (the theme
// uses :has()). 5.0.0 runs Puppeteer 25 (Chrome 156 on 2026-10-28) and
// needs Node 22.13 or later.
export const PA11Y_CI = 'pa11y-ci@5.0.0';

// The Sandbox Cloud pages: the home page, a guide with admonitions, a page
// with code blocks, and a reference page with tables.
export const THEME_AXE_PAGES = [
  { name: 'home', path: '' },
  { name: 'guide', path: 'guides/applications/delete-an-application/' },
  { name: 'code', path: 'get-started/build-a-sign-in-page/' },
  { name: 'reference', path: 'reference/error-codes/' },
];
export const THEME_AXE_MODES = ['light', 'dark'];
export const THEME_AXE_VIEWPORTS = [{ width: 1280, height: 800 }, { width: 375, height: 812 }];

// The pa11y-ci config: each page in each mode (Docusaurus's
// ?docusaurus-theme=) at each width. Each check has its own URL (the width
// rides along as a query parameter pages ignore), since pa11y-ci keys its
// report by URL.
export function themeAxeConfig({ origin, base = '/sandbox/cloud/', pages = THEME_AXE_PAGES, screenshots = null, chrome = null }) {
  if (!/^https?:\/\/[^/]+$/.test(origin ?? '')) throw new Error(`origin must be scheme and host, e.g. http://127.0.0.1:4500 (got ${origin})`);
  if (!/^\/(.*\/)?$/.test(base)) throw new Error(`base must start and end with "/" (got ${base})`);
  const urls = [];
  for (const p of pages) {
    for (const mode of THEME_AXE_MODES) {
      for (const v of THEME_AXE_VIEWPORTS) {
        urls.push({
          url: `${origin}${base}${p.path}?docusaurus-theme=${mode}&width=${v.width}`,
          viewport: { width: v.width, height: v.height },
          ...(screenshots ? { screenCapture: path.join(screenshots, `${p.name}-${mode}-${v.width}.png`) } : {}),
        });
      }
    }
  }
  return {
    defaults: {
      runners: ['axe'],
      standard: 'WCAG2AA',
      timeout: 60000,
      chromeLaunchConfig: { args: ['--no-sandbox'], ...(chrome ? { executablePath: chrome } : {}) },
    },
    urls,
  };
}

// What the builds lack for the check: a page that is not in the Sandbox
// build (the Sandbox changed: update THEME_AXE_PAGES), or the theme in the
// Landing build. Returns the problems, none when both are ready.
export function missingFiles({ landing, sandbox, pages = THEME_AXE_PAGES }) {
  const missing = [];
  const theme = path.join(landing, ...themeBase().split('/').filter(Boolean), 'theme.css');
  if (!fs.existsSync(theme)) missing.push(`the theme, ${theme}`);
  for (const p of pages) {
    const file = path.join(sandbox, p.path, 'index.html');
    if (!fs.existsSync(file)) missing.push(`the ${p.name} page, ${file}`);
  }
  return missing;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml',
};

// A static server for the two builds: the Sandbox under base, the Landing
// build everywhere else (its _platform/theme/ at the host root). Folders
// serve their index.html; anything else is a 404.
export function serveBuilds({ landing, sandbox, base = '/sandbox/cloud/' }) {
  return http.createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      p = '';
    }
    const [root, rel] = p.startsWith(base) ? [sandbox, p.slice(base.length)] : [landing, p.slice(1)];
    let file = path.resolve(root, rel);
    if (!p || (file !== path.resolve(root) && !file.startsWith(path.resolve(root) + path.sep))) {
      res.writeHead(400).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

async function main(argv) {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      landing: { type: 'string' }, sandbox: { type: 'string' }, base: { type: 'string' },
      'config-out': { type: 'string' }, screenshots: { type: 'string' }, chrome: { type: 'string' },
    },
  });
  if (!o.landing || !o.sandbox) {
    console.error('Usage: theme-axe.mjs --landing <dir> --sandbox <dir> [--base /sandbox/cloud/] [--config-out <file>] [--screenshots <dir>] [--chrome <path>]');
    return 2;
  }
  const base = o.base ?? '/sandbox/cloud/';
  const landing = path.resolve(o.landing);
  const sandbox = path.resolve(o.sandbox);
  const missing = missingFiles({ landing, sandbox });
  if (missing.length) {
    console.error(`theme-axe: the builds lack ${missing.join('; ')}`);
    return 1;
  }
  const server = serveBuilds({ landing, sandbox, base });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const screenshots = o.screenshots ? path.resolve(o.screenshots) : null;
    if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
    const config = themeAxeConfig({ origin, base, screenshots, chrome: o.chrome ?? null });
    const file = path.resolve(o['config-out'] ?? 'pa11y-theme.json');
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`axe on ${config.urls.length} checks (${THEME_AXE_PAGES.length} Sandbox pages, light and dark, ${THEME_AXE_VIEWPORTS.map((v) => v.width).join(' and ')} px) at ${origin}`);
    // Asynchronous, so this process keeps serving the pages pa11y-ci loads.
    const code = await new Promise((resolve) => {
      const child = spawn('npx', ['--yes', PA11Y_CI, '--config', file], { stdio: 'inherit' });
      child.on('error', (err) => {
        console.error(`theme-axe: ${err.message}`);
        resolve(1);
      });
      child.on('exit', (c, signal) => resolve(signal ? 1 : c));
    });
    console.log(code === 0 ? 'axe: no violations' : `axe: pa11y-ci exited ${code} (violations, or pages it could not check): the theme change fails`);
    return code === 0 ? 0 : 1;
  } finally {
    server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (err) => {
    console.error(`theme-axe: ${err.message}`);
    process.exitCode = 1;
  });
}
