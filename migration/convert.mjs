#!/usr/bin/env node
// The MkDocs → Content repo converter (Migration approach from MkDocs).
//   node migration/convert.mjs <product> --source <mkdocs checkout> --out <content repo>
//        --edition <version|next|cloud> [--legacy-version <v>] [--no-compile] [--no-overrides]
// It regenerates the product's Doc space directory, <out>/<slug>/ (docs/,
// partials/, assets/, redirects.yaml, docspace.yaml, editions.yaml), and
// writes a run report to <out>/<slug>/.migration/. Nothing is committed:
// sync.mjs commits, and writes the repo root. --no-overrides leaves out the
// product's override list (to see what it fixes). A family-level Doc space
// (products/identity-platform.mjs) reads its Cloud parts from <out>, so
// convert those first. A Doc space read from an MkDocs build that keeps every
// version as folders (products/ai-gateway.mjs, api-platform.mjs) links to its
// sibling Doc spaces through their redirects.yaml in <out>, so convert each
// once more after the first pass.
// Exit code 1 when any page fails the MDX compile check.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { convertProduct } from './lib/run.mjs';
import { convertFamily } from './lib/family.mjs';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string' }, out: { type: 'string' }, edition: { type: 'string' },
    'legacy-version': { type: 'string' }, 'no-compile': { type: 'boolean' }, 'no-overrides': { type: 'boolean' },
  },
});
const product = positionals[0];
const { default: config } = product ? await import(`./products/${product}.mjs`) : { default: null };
if (!config || !o.source || !o.out || (!o.edition && config.kind !== 'family')) {
  console.error('Usage: convert.mjs <product> --source <dir> --out <content repo> --edition <id> [--legacy-version <v>] [--no-compile] [--no-overrides]');
  process.exit(2);
}
const sourceDir = path.resolve(o.source);
let sha = 'unknown';
try {
  sha = execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch { /* not a git checkout */ }
const sourceRef = `${config.sourceRepo}@${sha}`;
const edition = o.edition ?? 'cloud';
const legacyVersion = o['legacy-version'] ?? (['next', 'cloud'].includes(edition) ? null : edition);
const outDir = path.join(path.resolve(o.out), config.slug);

const t0 = Date.now();
// A family-level Doc space with an `overview` writes only that overview
// (lib/family.mjs); one with pages of its own converts like a product.
const { summary } = config.kind === 'family' && config.overview
  ? await convertFamily({ config, sourceRoot: path.join(sourceDir, config.sourceRoot), repoDir: path.resolve(o.out), sourceRef, compile: !o['no-compile'], log: (m) => console.log(m) })
  : await convertProduct({
    config,
    sourceRoot: path.join(sourceDir, config.sourceRoot),
    outDir,
    edition,
    legacyVersion,
    sourceRef,
    compile: !o['no-compile'],
    useOverrides: !o['no-overrides'],
    log: (m) => console.log(m),
  });
console.log(`Converted ${sourceRef} → ${outDir} as ${edition} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`Pages ${summary.stats.pages} (nav ${summary.navPages}), compile failures ${summary.compileFailures}`);
console.log('Items:', JSON.stringify(summary.issues));
process.exitCode = summary.compileFailures ? 1 : 0;
