// WCAG 2.2 AA check of the theme (site/wso2-theme/css/theme.css), in light
// and dark mode: every text pair the theme uses at 4.5:1, the focus ring at
// 3:1 (non-text contrast), links in running text at 3:1 from the text and
// marked by weight and a hover underline, and the code blocks' syntax colours
// (code.css).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, parseColor, themeVariables, tokenContrast } from '../lib/contrast.mjs';
import { THEME_CSS, THEME_DIR } from '../lib/theme-bundle.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = path.join(THEME_DIR, 'css');
const files = [path.join(css, 'theme.css')];
const COLOUR = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i;
const uncommented = (file) => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// [foreground, background, minimum ratio, where it is used]
const TEXT = 4.5;
const PAIRS = [
  ['--wso2-text', '--wso2-bg', TEXT, 'body text, headings, sidebar, contents column'],
  ['--wso2-text', '--wso2-surface', TEXT, 'dropdown menus'],
  ['--wso2-text', '--wso2-hover', TEXT, 'hovered sidebar row, menu row, button and chip'],
  ['--wso2-text', '--wso2-selected', TEXT, 'the current breadcrumb, pressed catalog chip'],
  ['--wso2-text-strong', '--wso2-bg', TEXT, 'top-level sidebar entries'],
  ['--wso2-text-muted', '--wso2-bg', TEXT, 'nested sidebar entries, breadcrumbs, contents column, footer links'],
  ['--wso2-text-muted', '--wso2-surface', TEXT, 'group labels and hints in dropdowns'],
  ['--wso2-text-muted', '--wso2-hover', TEXT, 'hints on a hovered menu row'],
  ['--wso2-text-muted', '--wso2-active-bg', TEXT, 'hints on the current menu row'],
  ['--wso2-text-muted', '--wso2-admonition-bg', TEXT, 'muted text in an admonition'],
  ['--wso2-link', '--wso2-bg', TEXT, 'links, the current contents entry, pagination'],
  ['--wso2-link', '--wso2-surface', TEXT, 'links in dropdowns'],
  ['--wso2-link', '--wso2-admonition-bg', TEXT, 'links in admonitions and details'],
  ['--wso2-link-hover', '--wso2-bg', TEXT, 'hovered link'],
  ['--wso2-active', '--wso2-active-bg', TEXT, 'the current page in the sidebar, the current menu row'],
  ['--wso2-text', '--wso2-admonition-bg', TEXT, 'admonition text'],
  ['--wso2-admonition-note', '--wso2-admonition-bg', TEXT, 'note label'],
  ['--wso2-admonition-tip', '--wso2-admonition-bg', TEXT, 'tip label'],
  ['--wso2-admonition-info', '--wso2-admonition-bg', TEXT, 'info label'],
  ['--wso2-admonition-warning', '--wso2-admonition-bg', TEXT, 'warning label'],
  ['--wso2-admonition-danger', '--wso2-admonition-bg', TEXT, 'danger label'],
  ['--wso2-code-inline-fg', '--wso2-code-inline-bg', TEXT, 'inline code'],
  ['--wso2-code-fg', '--wso2-code-bg', TEXT, 'code blocks'],
  ['--wso2-text', '--wso2-table-head-bg', TEXT, 'table head'],
  ['--wso2-hint-ok', '--wso2-surface', TEXT, '"same page" hint'],
  ['--wso2-hint-ok', '--wso2-hover', TEXT, '"same page" hint on a hovered row'],
  ['--wso2-hint-ok', '--wso2-selected', TEXT, '"Latest" badge'],
  ['--wso2-hint-missing', '--wso2-surface', TEXT, '"page not in this edition" hint'],
  ['--wso2-hint-missing', '--wso2-hover', TEXT, '"page not in this edition" hint on a hovered row'],
  ['--wso2-info-fg', '--wso2-info-bg', TEXT, 'announcement, Cloud and switch notices, remembered-Edition banner'],
  ['--wso2-warning-fg', '--wso2-warning-bg', TEXT, 'older-release notice'],
  ['--wso2-error-fg', '--wso2-error-bg', TEXT, 'end-of-life notice'],
  ['--wso2-on-accent', '--wso2-accent', TEXT, 'text on WSO2 orange'],
  ['--wso2-site-bar-text', '--wso2-site-bar-bg', TEXT, 'the wso2.com bar'],
  ['--wso2-link-hover', '--wso2-site-bar-bg', TEXT, 'a hovered wso2.com bar link'],
  ['--wso2-bar-text', '--wso2-bar-bg', TEXT, 'the docs bar, the Landing hero title'],
  ['--wso2-bar-text-muted', '--wso2-bar-bg', TEXT, 'the docs bar search field, the Landing hero text'],
  ['--wso2-bar-text-muted', '--wso2-bar-key-bg', TEXT, 'the Ctrl K keys on the docs bar'],
  ['--wso2-landing-text', '--wso2-landing-bg', TEXT, 'Landing popular links and columns'],
  ['--wso2-landing-text', '--wso2-landing-panel', TEXT, 'Landing catalogue links'],
  ['--wso2-landing-text-muted', '--wso2-landing-bg', TEXT, 'the "Popular:" label, the hero search placeholder'],
  ['--wso2-landing-text-muted', '--wso2-landing-panel', TEXT, 'the ↗ marks in the catalogue'],
  ['--wso2-landing-hover', '--wso2-landing-panel', TEXT, 'a hovered Landing link'],
  ['--wso2-api-on-primary', '--wso2-link', TEXT, 'the API download button'],
  ['--wso2-focus', '--wso2-bg', 3, 'focus ring (non-text contrast, 1.4.11)'],
  ['--wso2-focus', '--wso2-surface', 3, 'focus ring in dropdowns'],
  ['--wso2-bar-focus', '--wso2-bar-bg', 3, 'focus ring on the docs bar and the Landing page'],
  ['--ifm-font-color-base', '--ifm-background-color', TEXT, 'Infima body text'],
  ['--ifm-link-color', '--ifm-background-color', TEXT, 'Infima links'],
];

test('contrast maths matches WCAG reference values', () => {
  assert.equal(contrastRatio(parseColor('#000'), parseColor('#fff')).toFixed(0), '21');
  assert.equal(contrastRatio(parseColor('#767676'), parseColor('#ffffff')).toFixed(2), '4.54');
  assert.ok(contrastRatio(parseColor('#FF7300'), parseColor('#ffffff')) < 3, 'WSO2 orange is not a text colour on white');
});

test('light mode keeps WSO2 orange to accents: links use #d43100, the current page #c42c00', () => {
  const vars = themeVariables(files, 'light');
  assert.equal(vars['--wso2-accent'], '#ff7300');
  assert.equal(vars['--wso2-link'], '#d43100');
  assert.equal(vars['--wso2-active'], '#c42c00');
  assert.equal(vars['--wso2-text'], '#17223a', 'the brand navy');
});

for (const mode of ['light', 'dark']) {
  test(`token pairs used for text meet WCAG 2.2 AA (${mode})`, () => {
    const vars = themeVariables(files, mode);
    const failures = [];
    for (const [fg, bg, min, where] of PAIRS) {
      const ratio = tokenContrast(vars, fg, bg);
      if (ratio < min) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}:1 < ${min}:1 (${where})`);
    }
    assert.deepEqual(failures, []);
  });
}

// Links in running text are not underlined at rest, as in the design: they
// are at least 3:1 from the text around them in both modes (light #d43100 on
// navy 3.2:1, dark #ee5a28 on #f2f4f7 3.1:1), semibold, and underlined on
// hover and focus (WCAG 2.2 1.4.1, technique G183), with a rule no
// [data-theme] limits.
test('links in running text: 3:1 from the text, semibold, underlined on hover and focus, in both modes', () => {
  for (const mode of ['light', 'dark']) {
    const ratio = tokenContrast(themeVariables(files, mode), '--wso2-link', '--wso2-text');
    assert.ok(ratio >= 3, `${mode}: links are ${ratio.toFixed(2)}:1 from the text`);
  }
  assert.ok(Number(themeVariables(files, 'light')['--wso2-link-weight']) >= 600, 'links are semibold');
  const custom = fs.readFileSync(path.join(css, 'custom.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rest = /([^{}]*\.markdown [^{}]*\ba[^{}]*)\{[^}]*font-weight: var\(--wso2-link-weight\)/.exec(custom);
  assert.ok(rest, 'custom.css sets the link weight on links in .markdown running text');
  assert.doesNotMatch(rest[1], /data-theme/, 'in both modes');
  for (const el of ['p', 'li', 'td', 'th']) assert.match(rest[1], new RegExp(`\\b${el}\\b`), `links in <${el}>`);
  const hover = /([^{}]*\.markdown [^{}]*\ba[^{}]*:hover[^{}]*:focus-visible[^{}]*)\{[^}]*text-decoration: underline/.exec(custom);
  assert.ok(hover, 'custom.css underlines them on hover and focus');
  assert.doesNotMatch(hover[1], /data-theme/);
});

// The code block is the same dark block in both modes; code.css colours its
// tokens with theme.css's --wso2-code-* variables only.
test('code blocks: every syntax colour meets AA on the code background, in both modes', () => {
  const code = uncommented(path.join(css, 'code.css'));
  const used = new Set([...code.matchAll(/(?<![\w-])color: var\((--wso2-code-[\w-]+)\)/g)].map((m) => m[1]));
  assert.ok(used.size > 8, [...used].join(', '));
  assert.doesNotMatch(code, COLOUR, 'code.css takes its colours from theme.css');
  assert.doesNotMatch(code, /(?<![\w-])color: (?!var\(--wso2-code-)/, 'every token colour is a --wso2-code-* variable');
  for (const mode of ['light', 'dark']) {
    const vars = themeVariables(files, mode);
    assert.equal(vars['--wso2-code-bg'], '#161618', `${mode}: the code background`);
    const failures = [...used].map((v) => [v, tokenContrast(vars, v, '--wso2-code-bg')]).filter(([, r]) => !(r >= TEXT)).map(([v, r]) => `${v}: ${r.toFixed(2)}:1`);
    assert.deepEqual(failures, [], mode);
  }
});

// Every stylesheet but theme.css, the theme's and the build's own
// (site/src/), takes its colours from theme.css's variables.
test('the other stylesheets read the theme: no Oxygen variables and no colour values outside theme.css', () => {
  const others = THEME_CSS.filter((f) => f !== 'theme.css').map((f) => path.join(css, f))
    .concat(fs.readdirSync(path.join(root, 'site', 'src'), { recursive: true }).filter((f) => f.endsWith('.css')).map((f) => path.join(root, 'site', 'src', f)));
  assert.ok(others.length >= 9, others.join(', '));
  for (const file of others) {
    const text = uncommented(file).replace(/url\("[^"]*"\)/g, '');
    assert.doesNotMatch(text, /--oxygen-/, `${path.basename(file)} has no Oxygen variables`);
    assert.doesNotMatch(text, COLOUR, `${path.relative(root, file)} takes its colours from theme.css`);
  }
});
