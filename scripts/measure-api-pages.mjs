// Measures API reference pages built by the Platform, to set and re-check the
// page budget. Builds a throwaway Content repo holding the given specs (one
// API page each), then reports build time and memory, and per page: HTML size
// (raw, gzip, brotli), the size of the page's own JS chunk, and how much of the
// spec's text is in the server-rendered HTML.
//
//   node scripts/measure-api-pages.mjs publisher=path/to/publisher-v4.yaml devportal=path/to/devportal-v3.yaml
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { collectOperations, deref, loadSpec } from '../lib/openapi.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).map((a) => a.split('='));
if (!args.length || args.some((a) => a.length !== 2)) {
  console.error('usage: measure-api-pages.mjs <slug>=<spec.yaml> ...');
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-api-measure-'));
const repo = path.join(work, 'content');
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
write('docspace.yaml', 'slug: api-manager\ndisplayName: API Manager\nmodel: versions-only\n');
write('editions.yaml', 'self-hosted:\n  displayName: API Manager {version}\n  apiHost: https://localhost:9443\n');
write('docs/index.mdx', '---\ntitle: Home\ndescription: Home.\ntype: concept\n---\n\nHome.\n');
write('docs/reference/index.mdx', '---\ntitle: Reference\ndescription: Reference.\ntype: reference\n---\n\nReference.\n');
for (const [slug, spec] of args) {
  write(`docs/reference/apis/${slug}/index.mdx`, `---\ntitle: ${slug} API\ndescription: The ${slug} API.\ntype: reference\nlayout: api-reference\nspec: ./openapi.yaml\n---\n`);
  fs.copyFileSync(path.resolve(spec), path.join(repo, 'docs/reference/apis', slug, 'openapi.yaml'));
}

const out = path.join(work, 'build');
const cli = [path.join(root, 'bin', 'wso2-docs.mjs'), 'build', repo, '--edition', '4.7.0', '--out', out];
const env = { ...process.env, WSO2_DOCS_API_BUDGET_KB: '1000000' };
const timed = fs.existsSync('/usr/bin/time');
const started = Date.now();
const r = timed
  ? spawnSync('/usr/bin/time', ['-f', 'maxrss_kb=%M', process.execPath, ...cli], { env, encoding: 'utf8' })
  : spawnSync(process.execPath, cli, { env, encoding: 'utf8' });
const seconds = (Date.now() - started) / 1000;
if (r.status !== 0) {
  console.error(r.stdout, r.stderr);
  process.exit(1);
}
const maxRss = /maxrss_kb=(\d+)/.exec(r.stderr)?.[1];
console.log(`build: ${seconds.toFixed(1)} s wall, ${maxRss ? `${Math.round(maxRss / 1024)} MB max RSS (largest process)` : 'max RSS not measured'}`);

const jsFiles = fs.readdirSync(path.join(out, 'assets/js')).map((f) => path.join(out, 'assets/js', f));

// Text from the spec that must be in the HTML: per operation its summary,
// description and every parameter's name and description; per schema its
// name and each property's name and description.
const words = (s) => String(s).replace(/^\s*\d+\.\s+/gm, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').toLowerCase().match(/[a-z0-9]+/g) ?? [];

for (const [slug] of args) {
  const file = path.join(out, 'reference/apis', slug, 'index.html');
  const html = fs.readFileSync(file);
  const spec = loadSpec(path.join(repo, 'docs/reference/apis', slug, 'openapi.yaml'));
  const ops = collectOperations(spec);
  // The page's own chunk (loaded on demand): the script holding most of this spec's anchors.
  const score = (f) => { const js = fs.readFileSync(f, 'utf8'); return ops.filter((o) => js.includes(`"${o.anchor}"`)).length; };
  const chunk = jsFiles.map((f) => [f, score(f)]).sort((a, b) => b[1] - a[1])[0]?.[0];
  const chunkBytes = chunk ? fs.readFileSync(chunk) : Buffer.alloc(0);

  const text = ` ${words(html.toString().replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')).join(' ')} `;
  const has = (s, n = 8) => { const w = words(s ?? '').slice(0, n); return !w.length || text.includes(` ${w.join(' ')} `); };
  let complete = 0, params = 0, paramsFound = 0, props = 0, propsFound = 0, schemas = 0, anchors = 0;
  const htmlText = html.toString();
  for (const o of ops) {
    let ok = has(o.summary) && has(o.op.description);
    for (const p of o.params) { params++; if (has(p.name, 3) && has(p.description)) paramsFound++; else ok = false; }
    if (htmlText.includes(`id="${o.anchor}"`)) anchors++;
    if (ok) complete++;
  }
  const names = Object.keys(spec.components?.schemas ?? {});
  for (const name of names) {
    if (has(name, 3)) schemas++;
    for (const [pn, pv] of Object.entries(deref(spec, spec.components.schemas[name])?.properties ?? {})) { props++; if (has(pn, 3) && has(deref(spec, pv)?.description, 6)) propsFound++; }
  }
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(`${slug}: ${ops.length} operations
  HTML ${kb(html.length)} raw, ${kb(zlib.gzipSync(html).length)} gzip, ${kb(zlib.brotliCompressSync(html).length)} brotli
  page JS chunk ${kb(chunkBytes.length)} raw, ${kb(zlib.gzipSync(chunkBytes).length)} gzip
  in HTML: operations ${complete}/${ops.length} complete, anchors ${anchors}/${ops.length}, parameters ${paramsFound}/${params}, schemas ${schemas}/${names.length}, schema properties ${propsFound}/${props}`);
}
if (process.env.KEEP) console.log(`kept ${work}`); else fs.rmSync(work, { recursive: true, force: true });
