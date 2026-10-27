#!/usr/bin/env node
// Done-criteria checks for one migrated Edition, run after a build:
//   node migration/verify.mjs coverage --repo <content repo> --build <out> --source <mkdocs dir> --legacy-base <url> [--sitemap <file>]
//        [--scope <folder,…>] [--exclude <folder,…>] [--also <other redirects.yaml,…>]
//        [--mount <part>/] (a Cloud part checked in its platform's Cloud tree build)
//        (an MkDocs build that keeps every version as folders: the Doc space's folders only)
//   node migration/verify.mjs parity   --repo <content repo> --build <out> --source <mkdocs dir> --legacy-base <url> [--sample 50] [--cache <dir>]
//        [--marked <n>] (the n pages with most Edition markers) [--include <legacy path,…>] [--mount <part>/]
// --source is the MkDocs project folder (the one with mkdocs.yml).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { coverage, parity } from './lib/verify.mjs';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: 'string' }, build: { type: 'string' }, source: { type: 'string' }, 'legacy-base': { type: 'string' },
    sitemap: { type: 'string' }, sample: { type: 'string' }, cache: { type: 'string' }, threshold: { type: 'string' },
    json: { type: 'string' }, include: { type: 'string' }, marked: { type: 'string' },
    scope: { type: 'string' }, exclude: { type: 'string' }, also: { type: 'string' }, mount: { type: 'string' },
  },
});
const [command] = positionals;
const common = { repoDir: path.resolve(o.repo), buildDir: path.resolve(o.build), sourceRoot: path.resolve(o.source), legacyBase: o['legacy-base'] };

if (command === 'coverage') {
  const list = (x) => (x ? x.split(',').map((y) => y.trim()).filter(Boolean) : []);
  const r = coverage({
    ...common, sitemapXml: o.sitemap ? fs.readFileSync(o.sitemap, 'utf8') : null,
    scope: list(o.scope), exclude: list(o.exclude), also: list(o.also).map((f) => path.resolve(f)), mount: o.mount ?? '',
  });
  for (const [name, v] of Object.entries(r)) {
    console.log(`${name}: ${v.live}/${v.total} reach a live page (${v.toHome} of them the Edition home); ${v.external.length} leave WSO2 Docs as before;${v.otherDocSpace ? ` ${v.otherDocSpace.length} mapped by another Doc space;` : ''} unmapped ${v.unmapped.length}; dead target ${v.dead.length}`);
    for (const u of [...v.unmapped, ...v.dead].slice(0, 15)) console.log(`  ${u}`);
  }
  if (o.json) fs.writeFileSync(o.json, JSON.stringify(r, null, 2));
  process.exitCode = Object.values(r).some((v) => v.unmapped.length || v.dead.length) ? 1 : 0;
} else if (command === 'parity') {
  const threshold = Number(o.threshold ?? 0.95);
  const r = await parity({
    ...common, sample: Number(o.sample ?? 50), cacheDir: path.resolve(o.cache ?? '.parity-cache'), threshold,
    include: o.include ? o.include.split(',').map((x) => x.trim()).filter(Boolean) : [], marked: Number(o.marked ?? 0), mount: o.mount ?? '',
  });
  const below = r.filter((x) => !x.ok);
  const avg = (k) => (r.reduce((s, x) => s + x[k], 0) / r.length).toFixed(3);
  console.log(`Parity on ${r.length} pages: mean F1 ${avg('f1')}, recall ${avg('recall')}, precision ${avg('precision')}; ${below.length} below ${threshold}`);
  for (const x of below.sort((a, b) => a.f1 - b.f1)) {
    console.log(`  ${x.f1.toFixed(3)} ${x.from} → ${x.to}${x.why ? ` [${x.why}]` : ''}${x.fetched ? '' : ' (legacy fetch failed)'}`);
    console.log(`     missing: ${x.missing.map(([w, n]) => `${w}×${n}`).join(' ')}`);
    console.log(`     extra:   ${x.extra.map(([w, n]) => `${w}×${n}`).join(' ')}`);
  }
  if (o.json) fs.writeFileSync(o.json, JSON.stringify(r, null, 2));
} else {
  console.error('Usage: verify.mjs coverage|parity --repo <dir> --build <dir> --source <dir> --legacy-base <url>');
  process.exitCode = 2;
}
