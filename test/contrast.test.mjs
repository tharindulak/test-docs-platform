// WCAG 2.2 AA check of every token pair the theme uses for text (Theme and
// shared chrome), in light and dark mode. Body text needs 4.5:1; the large
// text and UI-component pairs need 3:1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, parseColor, themeVariables, tokenContrast } from '../lib/contrast.mjs';

const css = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site', 'src', 'css');
const files = ['oxygen-tokens.css', 'custom.css', 'chrome.css'].map((f) => path.join(css, f));

// [foreground, background, minimum ratio, where it is used]
const TEXT = 4.5;
const PAIRS = [
  ['--wso2-text', '--wso2-bg', TEXT, 'body text, header, menus, footer'],
  ['--wso2-text', '--wso2-hover', TEXT, 'hovered menu item'],
  ['--wso2-text', '--wso2-selected', TEXT, 'current menu item'],
  ['--wso2-text-muted', '--wso2-bg', TEXT, 'hints, group labels, "(newest release)", card text'],
  ['--wso2-text-muted', '--wso2-hover', TEXT, 'hint on a hovered item'],
  ['--wso2-text-muted', '--wso2-selected', TEXT, 'hint on the current item'],
  ['--wso2-link', '--wso2-bg', TEXT, 'links'],
  ['--wso2-link', '--wso2-hover', TEXT, 'hovered menu action'],
  ['--wso2-hint-ok', '--wso2-bg', TEXT, '"same page" hint'],
  ['--wso2-hint-ok', '--wso2-hover', TEXT, '"same page" hint, hovered'],
  ['--wso2-hint-missing', '--wso2-bg', TEXT, '"page not in this edition" hint'],
  ['--wso2-hint-missing', '--wso2-hover', TEXT, '"page not in this edition" hint, hovered'],
  ['--wso2-info-fg', '--wso2-info-bg', TEXT, 'announcement, switch notice, remembered-Edition banner'],
  ['--wso2-warning-fg', '--wso2-warning-bg', TEXT, 'not-latest notice'],
  ['--wso2-error-fg', '--wso2-error-bg', TEXT, 'end-of-life notice'],
  ['--wso2-on-accent', '--wso2-accent', TEXT, 'text on WSO2 orange'],
  ['--wso2-focus', '--wso2-bg', 3, 'focus ring (non-text contrast, 1.4.11)'],
  ['--ifm-font-color-base', '--ifm-background-color', TEXT, 'Infima body text'],
  ['--ifm-link-color', '--ifm-background-color', TEXT, 'Infima links'],
];

test('contrast maths matches WCAG reference values', () => {
  assert.equal(contrastRatio(parseColor('#000'), parseColor('#fff')).toFixed(0), '21');
  assert.equal(contrastRatio(parseColor('#767676'), parseColor('#ffffff')).toFixed(2), '4.54');
  assert.ok(contrastRatio(parseColor('#FF7300'), parseColor('#ffffff')) < 3, 'WSO2 orange is not a text colour on white');
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
