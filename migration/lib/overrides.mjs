// The per-repo override-patch list (Migration approach from MkDocs, decision
// 1): fixes to the legacy source are data the converter applies on every run,
// never hand edits to its output. One YAML file per product
// (migration/products/<product>.overrides.yaml):
//
//   patches:            exact text replacements in legacy source files
//     - file: docs/a/b.md          path under the product's sourceRoot (en/)
//       find: '![[API overview]('  text that must occur in the file
//       replace: '[![API overview]('
//       why: image nested in another image's alt text
//       editions: [4.7.0, 4.6.0]   optional: only in these runs (--edition)
//   accepted:           broken links and anchors the legacy site has too,
//     - page: a/b.md              reviewed: the link is removed, its text kept,
//       href: ../c.md#gone        and the item no longer counts as outstanding
//       why: target removed from the legacy site
//       editions: [cloud]         optional, as above
//
// An entry that matches nothing in a run it applies to is stale: the run
// reports it (kind "override"), so a legacy fix upstream shows up as an item
// to clean the list, not as a silent no-op.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const KINDS = new Set(['broken-link', 'broken-anchor']);

export function loadOverrides(file) {
  if (!file || !fs.existsSync(file)) return { patches: [], accepted: [] };
  const data = yaml.load(fs.readFileSync(file, 'utf8')) ?? {};
  const problems = [];
  const patches = (data.patches ?? []).map((p, i) => {
    if (typeof p?.file !== 'string' || typeof p.find !== 'string' || typeof p.replace !== 'string' || !p.find) problems.push(`patches[${i}] needs file, find and replace`);
    if (!p?.why) problems.push(`patches[${i}] needs a "why"`);
    return { ...p, file: String(p?.file ?? '').replace(/^\.?\//, '') };
  });
  const accepted = (data.accepted ?? []).map((a, i) => {
    if (typeof a?.page !== 'string' || typeof a.href !== 'string') problems.push(`accepted[${i}] needs page and href`);
    if (!a?.why) problems.push(`accepted[${i}] needs a "why"`);
    return a;
  });
  if (problems.length) throw new Error(`${file}:\n  ${problems.join('\n  ')}`);
  return { patches, accepted, file };
}

const applies = (entry, edition) => !entry.editions || entry.editions.map(String).includes(String(edition));

export class SourceOverrides {
  constructor(list, { sourceRoot, edition }) {
    this.root = path.resolve(sourceRoot);
    this.file = list.file ?? null;
    this.patches = list.patches.filter((p) => applies(p, edition)).map((p) => ({ ...p, hits: 0 }));
    this.accepted = list.accepted.filter((a) => applies(a, edition)).map((a) => ({ ...a, hits: 0 }));
    this.byFile = new Map();
    for (const p of this.patches) {
      if (!this.byFile.has(p.file)) this.byFile.set(p.file, []);
      this.byFile.get(p.file).push(p);
    }
    this.cache = new Map();
  }

  // The text of a legacy source file with its patches applied.
  read(file) {
    const abs = path.resolve(file);
    if (this.cache.has(abs)) return this.cache.get(abs);
    let text = fs.readFileSync(abs, 'utf8');
    const rel = path.relative(this.root, abs).split(path.sep).join('/');
    for (const p of this.byFile.get(rel) ?? []) {
      const n = text.split(p.find).length - 1;
      if (!n) continue;
      p.hits += n;
      text = text.split(p.find).join(p.replace);
    }
    this.cache.set(abs, text);
    return text;
  }

  // Marks report items that an accepted entry covers; returns how many.
  accept(items) {
    let n = 0;
    for (const item of items) {
      if (!KINDS.has(item.kind) || !item.detail?.href) continue;
      const hit = this.accepted.find((a) => a.page === item.file && a.href === item.detail.href);
      if (!hit) continue;
      hit.hits++;
      item.accepted = hit.why;
      n++;
    }
    return n;
  }

  // Entries that matched nothing in this run.
  stale() {
    const out = [];
    for (const p of this.patches) if (!p.hits) out.push({ file: p.file, message: `override patch no longer applies (${JSON.stringify(p.find.slice(0, 80))} not found${fs.existsSync(path.join(this.root, p.file)) ? '' : '; the file is gone'}); remove it or limit it with editions:` });
    for (const a of this.accepted) if (!a.hits) out.push({ file: a.page, message: `accepted link ${a.href} is no longer broken or no longer there; remove the entry or limit it with editions:` });
    return out;
  }

  summary() {
    return {
      file: this.file ? path.basename(this.file) : null,
      patches: this.patches.length,
      patchesApplied: this.patches.filter((p) => p.hits).length,
      accepted: this.accepted.length,
    };
  }
}
