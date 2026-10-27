#!/usr/bin/env node
// Proposes override-list entries (lib/overrides.mjs) for the broken links and
// anchors the converter carried over from the legacy site, from the run
// reports of every branch of one Content repo:
//   node migration/overrides.mjs suggest <product> --source <mkdocs checkout>
//        --report <.migration/report.json> [--report ...] [--patches-only] [--write]
// A link whose target the converter could place (a page that moved without a
// redirect, a heading that gained words) becomes a patch to the legacy
// source; every other one is accepted as broken on the legacy site too.
// Existing entries are kept; new ones are appended. Without --write it prints
// what it would add. Re-run the conversion afterwards: a patch that breaks the
// link in another Edition shows up as a new item there.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import { loadOverrides } from './lib/overrides.mjs';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: { source: { type: 'string' }, report: { type: 'string', multiple: true }, write: { type: 'boolean' }, 'patches-only': { type: 'boolean' } },
});
const [command, product] = positionals;
if (command !== 'suggest' || !product || !o.source || !o.report?.length) {
  console.error('Usage: overrides.mjs suggest <product> --source <mkdocs checkout> --report <report.json> [--report ...] [--write]');
  process.exit(2);
}
const { default: config } = await import(`./products/${product}.mjs`);
const sourceRoot = path.join(path.resolve(o.source), config.sourceRoot);
const existing = loadOverrides(config.overrides);

// Every Markdown file under the source root, read once.
const files = new Map();
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) files.set(path.relative(sourceRoot, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8'));
  }
};
walk(sourceRoot);

// Groups: one per (page, href as written), over every branch's report.
const groups = new Map();
const allEditions = new Set();
for (const file of o.report) {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const edition = String(r.summary.edition);
  allEditions.add(edition);
  for (const item of r.items) {
    if (!['broken-link', 'broken-anchor'].includes(item.kind) || !item.detail?.href || item.accepted) continue;
    const key = `${item.file}\0${item.detail.href}`;
    if (!groups.has(key)) groups.set(key, { page: item.file, href: item.detail.href, items: [], editions: new Set() });
    const g = groups.get(key);
    g.items.push(item);
    g.editions.add(edition);
  }
}

// The href that fixes every item of a group, or null.
function fixFor(g) {
  const [pathPart, ...rest] = g.href.split('#');
  const fragment = rest.length ? `#${rest.join('#')}` : '';
  const proposals = new Set();
  for (const item of g.items) {
    const d = item.detail;
    if (item.kind === 'broken-anchor') {
      if (!d.suggest?.anchor || !fragment) return null;
      proposals.add(`${pathPart}#${d.suggest.anchor}`);
    } else {
      // A page that moved: every context the link is missing in names the same old URL.
      const s = Object.values(d.suggest ?? {});
      if (!s.length || /^#/.test(g.href)) return null;
      const urls = new Set(s.map((x) => x.oldUrl));
      if (urls.size !== 1) return null;
      proposals.add(`{{base_path}}/${[...urls][0]}${fragment}`);
    }
  }
  return proposals.size === 1 ? [...proposals][0] : null;
}

// Where the href is written in the legacy source: the page's own file in any
// tree first, else every file that has it.
const forms = (href) => [`](${href})`, `](${href} "`, `href="${href}"`];
function sourcesFor(g) {
  const has = (text) => forms(g.href).some((f) => text.includes(f));
  const own = [...files.entries()].filter(([rel, text]) => (rel === `docs/${g.page}` || rel.endsWith(`/docs/${g.page}`)) && has(text)).map(([rel]) => rel);
  if (own.length) return own;
  // A relative link in an include resolves from each page that includes it,
  // so it can't be fixed once for all of them.
  if (!/^(\{\{\s*base_path\s*\}\}|\/|#)/.test(g.href)) return [];
  return [...files.entries()].filter(([, text]) => has(text)).map(([rel]) => rel);
}

const known = new Set([...existing.patches.map((p) => `${p.file}\0${p.find}`), ...existing.accepted.map((a) => `${a.page}\0${a.href}`)]);
const patches = [];
const accepted = [];
const scope = (eds) => (eds.size === allEditions.size ? {} : { editions: [...eds].sort() });
for (const g of [...groups.values()].sort((a, b) => a.page.localeCompare(b.page) || a.href.localeCompare(b.href))) {
  const to = fixFor(g);
  const where = to ? sourcesFor(g) : [];
  if (to && where.length) {
    const kind = g.items.some((i) => i.kind === 'broken-link') ? 'page moved without a legacy redirect' : 'heading reworded on the target page';
    for (const file of where) {
      for (const form of forms(g.href)) {
        if (!files.get(file).includes(form) || known.has(`${file}\0${form}`)) continue;
        known.add(`${file}\0${form}`);
        patches.push({ file, find: form, replace: form.replace(g.href, to), why: `broken link on the legacy site (${kind}); found by the converter` });
      }
    }
    continue;
  }
  // --patches-only: fix what can be fixed, re-run, then propose again (a
  // moved page's anchor can only be checked once the link reaches it).
  if (o['patches-only'] || known.has(`${g.page}\0${g.href}`)) continue;
  const anchorOnly = g.items.every((i) => i.kind === 'broken-anchor');
  const placeholder = g.items.every((i) => i.detail.placeholder);
  accepted.push({
    page: g.page, href: g.href, ...scope(g.editions),
    why: placeholder ? 'the target is a placeholder page until it is migrated; the link goes to the page without the anchor'
      : anchorOnly ? 'the anchor is not on the target page on the legacy site either' : 'the legacy site has no page there either',
  });
}

console.log(`${groups.size} broken link groups over ${allEditions.size} branches: ${patches.length} new patches, ${accepted.length} new accepted entries`);
if (!o.write) {
  console.log(yaml.dump({ patches: patches.slice(0, 20), accepted: accepted.slice(0, 20) }, { lineWidth: -1 }));
  process.exit(0);
}
const file = config.overrides;
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const data = yaml.load(text) ?? {};
data.patches = [...(data.patches ?? []), ...patches];
data.accepted = [...(data.accepted ?? []), ...accepted];
const header = text.split('\n').filter((l) => l.startsWith('#')).join('\n');
fs.writeFileSync(file, `${header ? `${header}\n` : ''}${yaml.dump(data, { lineWidth: -1 })}`);
console.log(`Wrote ${file}`);
