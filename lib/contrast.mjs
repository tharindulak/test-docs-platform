// WCAG 2.2 contrast for the theme's token pairs. Reads the custom properties
// of the theme CSS files per colour mode, resolves var() chains, composites
// translucent colours over the page background, and computes the ratio.
import fs from 'node:fs';

// Declarations of every rule whose selector applies in `mode`, in file order.
// Light: :root and [data-theme='light'] rules; dark: :root and
// [data-theme='dark'] rules. Later rules win, so the theme files must keep
// each dark block after the light block it overrides.
export function themeVariables(files, mode) {
  const vars = {};
  for (const file of files) {
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1].split(',').map((s) => s.trim());
      const applies = selectors.some((s) => {
        if (/^(html)?:root$/.test(s)) return true;
        const theme = /^(?:html|:root)?\[data-theme=['"]?(light|dark)['"]?\]$/.exec(s);
        return theme ? theme[1] === mode : false;
      });
      if (!applies) continue;
      for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) vars[d[1]] = d[2].trim();
    }
  }
  return vars;
}

export function resolveVar(vars, value, depth = 0) {
  if (depth > 20) throw new Error(`var() loop at ${value}`);
  return value.replace(/var\((--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name, fallback) => {
    if (name in vars) return resolveVar(vars, vars[name], depth + 1);
    if (fallback !== undefined) return resolveVar(vars, fallback.trim(), depth + 1);
    throw new Error(`undefined ${name}`);
  });
}

// #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() with commas or slash syntax.
export function parseColor(input) {
  const s = input.trim().toLowerCase();
  if (s === 'white') return [255, 255, 255, 1];
  if (s === 'black') return [0, 0, 0, 1];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  throw new Error(`Cannot parse colour "${input}"`);
}

export function composite([r, g, b, a], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

const channel = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export function contrastRatio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

// Ratio of token `fg` on token `bg` (each a custom property name), with
// translucent colours composited over `base` (the page background token).
export function tokenContrast(vars, fg, bg, base = '--wso2-bg') {
  const page = parseColor(resolveVar(vars, `var(${base})`));
  const back = composite(parseColor(resolveVar(vars, `var(${bg})`)), page);
  const front = composite(parseColor(resolveVar(vars, `var(${fg})`)), back);
  return contrastRatio(front, back);
}
