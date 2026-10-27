// The data-files check (Extension points for product teams, decision 7):
// every data file a page draws, and every data file known by its name, follows
// its Platform schema (lib/data-files.mjs), like the manifests do in compose.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_EXT, LAYOUT_DATA, checkDataFile, dataFileOf, namedKind } from '../data-files.mjs';
import { layoutOf } from '../layouts.mjs';
import { keyLine } from './content.mjs';

const f = (level, file, line, message) => ({ level, file, line, message });

// The line a problem's path points at: the line naming the item's id
// (`items.3 (sift): …`), else the n-th list entry of the list it names
// (`items.3.href: …`, counting `- ` lines that open an entry), else 1.
function lineFor(text, problem) {
  const lines = text.split('\n');
  const id = /^\S+ \(([a-z0-9._-]+)\)/.exec(problem)?.[1];
  if (id) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*(- )?"?id"?\\s*:\\s*["']?${id.replace(/\./g, '\\.')}["']?\\s*,?\\s*$`).test(l));
    if (i >= 0) return i + 1;
  }
  const m = /^(items|categories|sdks|releases)\.(\d+)/.exec(problem);
  if (m) {
    const start = lines.findIndex((l) => new RegExp(`^"?${m[1]}"?\\s*:`).test(l.trim()));
    if (start >= 0) {
      const indent = /^(\s*)-/.exec(lines.slice(start + 1).find((l) => /^\s*-/.test(l)) ?? '')?.[1] ?? '';
      let n = -1;
      for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].startsWith(`${indent}- `) || lines[i] === `${indent}-`) n++;
        if (n === Number(m[2])) return i + 1;
      }
    }
  }
  return 1;
}

export function checkDataFiles(ctx) {
  const out = [];
  const docsDir = path.join(ctx.root, 'docs');
  const rel = (abs) => path.relative(ctx.root, abs).split(path.sep).join('/');
  const checked = new Map(); // data file → kind
  for (const d of ctx.pages) {
    if (d.fmError) continue;
    const layout = layoutOf(d.fm);
    const kind = LAYOUT_DATA[layout];
    const file = dataFileOf(path.join(ctx.root, d.file), d.fm);
    if (!kind) {
      if (d.fm.data !== undefined) out.push(f('error', d.file, keyLine(d.text, 'data'), `"data" is read only by the ${Object.keys(LAYOUT_DATA).join(', ')} layout; this page's layout is ${layout}`));
      continue;
    }
    if (!file) {
      out.push(f('error', d.file, keyLine(d.text, 'layout'), `A ${layout} page names its data file in front matter, such as "data: ./connectors.yaml"`));
      continue;
    }
    if (!fs.existsSync(file)) {
      out.push(f('error', d.file, keyLine(d.text, 'data'), `The data file ${d.fm.data} does not exist`));
      continue;
    }
    if (!DATA_EXT.test(file)) {
      out.push(f('error', d.file, keyLine(d.text, 'data'), `The data file ${d.fm.data} must be YAML or JSON (.yaml, .yml or .json)`));
      continue;
    }
    if (checked.has(file) && checked.get(file) !== kind) {
      out.push(f('error', d.file, keyLine(d.text, 'data'), `${d.fm.data} is drawn by pages of different layouts (${checked.get(file)} and ${kind})`));
      continue;
    }
    checked.set(file, kind);
  }
  for (const p of ctx.files) {
    if (!p.startsWith('docs/')) continue;
    const kind = namedKind(p);
    const abs = path.join(ctx.root, p);
    if (kind && !checked.has(abs)) checked.set(abs, kind);
  }
  for (const [file, kind] of checked) {
    const { problems } = checkDataFile(kind, file, { docsDir });
    const text = fs.readFileSync(file, 'utf8');
    for (const p of problems) out.push(f('error', rel(file), lineFor(text, p), `${p} (schema: ${kind}, schemas/${kind}.schema.json in the Platform)`));
  }
  const files = [...checked].map(([file, kind]) => `${rel(file)} (${kind})`);
  return { findings: out, note: files.length ? files.join(', ') : 'no data files' };
}
