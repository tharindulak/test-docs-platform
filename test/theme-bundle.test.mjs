// The shared theme (lib/theme-bundle.mjs, site/wso2-theme/): one bundle per
// Platform major, served at a host-root address, so a style change reaches
// every live deployment without a rebuild. Its stylesheets may name only
// class names that stay the same across Docusaurus versions and builds:
// Infima's, Docusaurus's stable theme class names, Prism's token classes and
// the Platform's own wso2-*, never a CSS-module name such as .sidebar_njMd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_CSS, THEME_DIR, themeBase, themeCss, themeMajor, writeThemeBundle } from '../lib/theme-bundle.mjs';
import { themeHtmlTags } from '../plugins/theme.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-theme-'));
const cssFiles = () => fs.readdirSync(path.join(THEME_DIR, 'css')).filter((f) => f.endsWith('.css'));
const read = (f) => fs.readFileSync(path.join(THEME_DIR, 'css', f), 'utf8');

test('one theme per Platform major, at /_platform/theme/v<major>/', () => {
  assert.equal(THEME_DIR, path.join(root, 'site', 'wso2-theme'));
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(themeMajor(), Number(version.split('.')[0]));
  assert.equal(themeBase(), `/_platform/theme/v${themeMajor()}/`);
  assert.equal(themeBase(2), '/_platform/theme/v2/');
});

test('the bundle: one self-contained theme.css with fonts/ and img/, every url() under urlBase, the same bytes each time', async () => {
  const urlBase = '/_platform/theme/v1/r42/';
  const a = tmp();
  const b = tmp();
  const files = await writeThemeBundle(a, { urlBase });
  assert.deepEqual(await writeThemeBundle(b, { urlBase }), files);
  for (const f of files) assert.ok(fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))), `${f} is deterministic`);
  assert.deepEqual(files, [...files].sort());
  assert.ok(files.includes('theme.css'));
  for (const f of ['img/favicon.svg', 'img/favicon-32.png', 'img/apple-touch-icon.png', 'img/pulse-mark.svg', 'img/pulse-mark-white.svg', 'fonts/inter-latin-wght-normal.woff2', 'fonts/OFL.txt']) {
    assert.ok(files.includes(f), f);
  }
  const css = fs.readFileSync(path.join(a, 'theme.css'), 'utf8');
  const refs = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/g)].map((m) => m[1] ?? m[2] ?? m[3]).filter((u) => !u.startsWith('data:'));
  assert.ok(refs.length >= 7, 'the fonts');
  for (const u of refs) {
    assert.ok(u.startsWith(urlBase), `${u} starts with ${urlBase}`);
    assert.ok(files.includes(u.slice(urlBase.length)), `${u} is in the bundle`);
  }
  // Every stylesheet, in cascade order: fonts, variables, then the rules on them.
  let at = 0;
  for (const f of THEME_CSS) {
    const i = css.indexOf(`/* ---- ${f} ---- */`);
    assert.ok(i >= at, `${f} in order`);
    at = i;
  }
  assert.match(css, /@font-face \{[^}]*'Inter Variable'/);
  assert.match(css, /--wso2-code-keyword:/, 'the code colours');
  assert.doesNotMatch(css, /@import/, 'self-contained');
});

test('urlBase is a root-relative folder; a stylesheet names only ../fonts/ and ../img/ files', () => {
  for (const bad of [undefined, '', 'theme/', '/_platform/theme/v1', 'https://docs.wso2.com/x/']) assert.throws(() => themeCss({ urlBase: bad }), /urlBase/);
  assert.deepEqual(cssFiles().sort(), [...THEME_CSS].sort(), 'every stylesheet in site/wso2-theme/css/ is in THEME_CSS, in its cascade place');
  for (const f of THEME_CSS) {
    for (const m of read(f).matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/g)) {
      const u = m[1] ?? m[2] ?? m[3];
      if (!u.startsWith('data:')) assert.match(u, /^\.\.\/(fonts|img)\/[^/]+$/, `${f}: ${u}`);
    }
  }
});

// Class names a theme selector may use: Infima's, Docusaurus's stable
// ThemeClassNames, Prism's (prism-react-renderer's line and token classes),
// and the Platform's own wso2-*.
const INFIMA = path.join(root, 'node_modules', 'infima', 'dist', 'css', 'default', 'default.css');
const THEME_CLASS_NAMES = path.join(root, 'node_modules', '@docusaurus', 'theme-common', 'lib', 'utils', 'ThemeClassNames.js');
const PRISM = ['prism-code', 'token-line', 'token', 'comment', 'block-comment', 'prolog', 'doctype', 'cdata', 'shebang', 'tag', 'selector', 'char', 'builtin', 'inserted',
  'keyword', 'attr-name', 'atrule', 'class-name', 'property', 'number', 'function-name', 'constant', 'symbol', 'deleted', 'boolean', 'operator', 'entity', 'url',
  'variable', 'function', 'string', 'attr-value', 'punctuation', 'important', 'bold', 'italic', 'namespace'];

function stableClasses() {
  const names = new Set(PRISM);
  for (const m of fs.readFileSync(INFIMA, 'utf8').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(m[1]);
  for (const m of fs.readFileSync(THEME_CLASS_NAMES, 'utf8').matchAll(/'([a-z][a-z0-9-]*)'/g)) names.add(m[1]);
  return names;
}
const stable = (name, names) => names.has(name) || /^(theme|wso2)-/.test(name);

// Each rule's selector (not @-rule preludes, not declarations).
function selectors(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      const prelude = text.slice(start, i).trim();
      if (prelude && !prelude.startsWith('@')) out.push(prelude);
      depth++;
      start = i + 1;
    } else if (text[i] === '}') {
      depth--;
      start = i + 1;
    } else if (text[i] === ';') start = i + 1;
  }
  return out;
}

// [{ selector, name }] for each class name a selector names, also by an
// attribute selector on class ([class*='docItemContainer'] names a module).
function classesIn(css) {
  const out = [];
  for (const selector of selectors(css)) {
    const bare = selector.replace(/\[[^\]]*\]/g, ' ');
    for (const m of bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.push({ selector, name: m[1] });
    for (const m of selector.matchAll(/\[\s*class\s*([*^$|~]?)=\s*(['"]?)([^'"\]]*)\2\s*\]/g)) {
      const value = m[3].trim();
      // A prefix match on wso2- or theme- names only stable classes.
      const name = m[1] === '*' || m[1] === '^' ? (/^(wso2|theme)-/.test(value) ? `${value}x` : value) : value;
      out.push({ selector, name, attr: true });
    }
  }
  return out;
}

test('the theme names only stable class names, never Docusaurus CSS-module names', () => {
  const names = stableClasses();
  assert.ok(names.has('menu__link') && names.has('navbar__brand') && names.has('table-of-contents__link'), 'Infima');
  assert.ok(names.has('theme-code-block') && names.has('docs-doc-page') && names.has('main-wrapper'), 'ThemeClassNames');
  const bad = [];
  for (const f of THEME_CSS) {
    for (const { selector, name } of classesIn(read(f))) if (!stable(name, names)) bad.push(`${f}: "${name}" in ${selector}`);
  }
  assert.deepEqual(bad, []);
  // The check itself catches what it is for.
  const caught = classesIn(".sidebar_njMd a { x: 1 }\n[class*='docItemContainer'] { x: 1 }\n.menu__link, .wso2-x, a:not([class*='wso2-']) { x: 1 }")
    .filter(({ name }) => !stable(name, names)).map(({ name }) => name);
  assert.deepEqual(caught, ['sidebar_njMd', 'docItemContainer']);
});

test('pages link the theme and favicons at the host-root address, the stylesheet after the build\'s', () => {
  const base = themeBase();
  const tags = themeHtmlTags(base);
  assert.deepEqual(tags.headTags.map((t) => t.attributes.href), [`${base}img/favicon.svg`, `${base}img/favicon-32.png`, `${base}img/apple-touch-icon.png`]);
  assert.deepEqual(tags.preBodyTags[0], { tagName: 'link', attributes: { rel: 'stylesheet', href: `${base}theme.css`, 'data-wso2-theme': 'true' } });
  assert.equal(tags.preBodyTags[1].tagName, 'script', 'holds the parser until the theme has loaded');
  assert.ok(!tags.headTags.some((t) => /stylesheet/.test(t.attributes.rel)), 'not in <head>, where Infima would come after it');
});

test('the theme, with the Platform\'s component stylesheets, is not in the build\'s bundle, and the code highlighter gives no colours', () => {
  const config = fs.readFileSync(path.join(root, 'site', 'docusaurus.config.mjs'), 'utf8');
  assert.match(config, /prism: \{ theme: \{ plain: \{\}, styles: \[\] \}, darkTheme: \{ plain: \{\}, styles: \[\] \}/);
  assert.doesNotMatch(config, /path\.join\(here, '(wso2-theme|src\/css)|customCss|fontsource/, 'no Platform stylesheet in the build\'s bundle');
  assert.ok(!fs.existsSync(path.join(root, 'site', 'src', 'css')), 'the Platform\'s component stylesheets are in the theme (site/wso2-theme/css/)');
  for (const f of fs.readdirSync(path.join(root, 'site', 'src'), { recursive: true }).filter((x) => /\.(js|mjs)$/.test(x))) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'site', 'src', f), 'utf8'), /import\s+['"][^'"]*(wso2-theme|nav-icons\.css)/, `${f} imports no theme stylesheet`);
  }
});

// The Infima variables Docusaurus's components compute with, from its CSS
// modules: inside a calc(), or beside other lengths in a box shorthand.
const DOCUSAURUS_CSS = path.join(root, 'node_modules', '@docusaurus', 'theme-classic', 'lib', 'theme');
function computedIfmVars() {
  const vars = new Set();
  for (const f of fs.readdirSync(DOCUSAURUS_CSS, { recursive: true }).filter((x) => x.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(DOCUSAURUS_CSS, f), 'utf8');
    for (const [, prop, value] of css.matchAll(/([\w-]+)\s*:\s*([^;{}]*var\(--ifm-[^;{}]*);/g)) {
      const inCalc = [...value.matchAll(/calc\(([^;]*)\)/g)].map((m) => m[1]).join(' ');
      const box = /^(padding|margin|inset)$/.test(prop) && !/^var\(--ifm-[\w-]+\)$/.test(value.trim());
      for (const [, name] of `${inCalc} ${box ? value : ''}`.matchAll(/var\((--ifm-[\w-]+)\)/g)) vars.add(name);
    }
  }
  return vars;
}

test('an Infima variable Docusaurus computes with is one value in the theme, so its calc()s stay valid', () => {
  const vars = computedIfmVars();
  assert.ok(vars.has('--ifm-pre-padding'), 'Docusaurus halves --ifm-pre-padding for the code block buttons');
  const css = read('theme.css');
  const decl = (name) => [...css.matchAll(new RegExp(`(?:^|[\\s;{])${name}:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim());
  // One value: no top-level space; a var() is followed to the theme's own variable.
  const single = (value, seen = new Set()) => {
    const v = /^var\((--[\w-]+)\)$/.exec(value);
    if (v) return seen.has(v[1]) ? false : decl(v[1]).every((x) => single(x, new Set([...seen, v[1]])));
    return !/\s/.test(value.replace(/\([^()]*\)/g, '()'));
  };
  const bad = [...vars].flatMap((name) => decl(name).filter((value) => !single(value)).map((value) => `${name}: ${value}`));
  assert.deepEqual(bad, []);
  assert.equal(single('0.65625rem 1rem'), false, 'the check catches two values');
});
