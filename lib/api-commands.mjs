// `wso2-docs api ...`: validate and lint OpenAPI specs, split an API page
// into tag pages, and sync a spec from a product repo. Each returns data and
// an exit code so the CLI, the reusable workflows and the tests share them.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { findApiPages, tagPageName, tagPages } from './api-pages.mjs';
import { groupByTag, lintSpec, loadSpec, slug, validateSpec } from './openapi.mjs';

const SPEC_FILE = /^openapi(\.[a-z-]+)?\.ya?ml$/;

// Every spec an API page can render: each page's named spec and its per-Edition variants.
export function specFilesIn(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [path.resolve(target)];
  const docsDir = fs.existsSync(path.join(target, 'docs')) ? path.join(target, 'docs') : target;
  const files = new Set();
  for (const page of findApiPages(docsDir)) {
    for (const name of fs.readdirSync(page.dir)) if (SPEC_FILE.test(name)) files.add(path.join(page.dir, name));
  }
  return [...files].sort();
}

export function validateFiles(files, { lint = false } = {}) {
  const results = files.map((file) => {
    let spec;
    try {
      spec = loadSpec(file);
    } catch (err) {
      return { file, errors: [err.message], warnings: [] };
    }
    const errors = validateSpec(spec);
    return { file, errors, warnings: lint && !errors.length ? lintSpec(spec) : [] };
  });
  return { results, ok: results.every((r) => !r.errors.length) };
}

// Writes one page per tag next to the API's index page (front matter only;
// writers may add an intro). Existing tag pages are kept.
export function splitApi(folder) {
  const dir = path.resolve(folder);
  const index = ['index.mdx', 'index.md'].map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
  if (!index) throw new Error(`${folder}: no index.mdx`);
  const fm = yaml.load(/^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(index, 'utf8'))?.[1] ?? '') ?? {};
  if (fm.layout !== 'api-reference' || !fm.spec) throw new Error(`${index}: not an API page (needs layout: api-reference and spec:)`);
  const spec = loadSpec(path.resolve(dir, fm.spec));
  const existing = tagPages(dir);
  const created = [];
  const apiTitle = fm.title ?? spec.info?.title ?? 'API';
  for (const g of groupByTag(spec)) {
    if (existing.has(g.name)) continue;
    const file = path.join(dir, `${tagPageName(dir, slug(g.name))}.mdx`);
    if (fs.existsSync(file)) throw new Error(`${file} exists but is not the page for tag "${g.name}"`);
    const firstSentence = (g.description || '').replace(/\s+/g, ' ').trim().split(/(?<=\.)\s/)[0];
    const description = (firstSentence && firstSentence.length <= 160 ? firstSentence : `Operations for ${g.name} in the ${apiTitle}.`).slice(0, 160);
    fs.writeFileSync(file, `---\n${yaml.dump({ title: `${g.name}: ${apiTitle}`, description, type: 'reference', layout: 'api-reference', tag: g.name }, { lineWidth: 200 })}---\n`);
    created.push(file);
  }
  return created;
}

// Spec sync: compares the product repo's copy with the Content repo's and,
// when they differ and the new one validates, copies it over. The workflow
// then opens a PR with the returned summary as its body.
export function syncSpec(from, to) {
  const next = fs.readFileSync(from, 'utf8');
  const current = fs.existsSync(to) ? fs.readFileSync(to, 'utf8') : null;
  if (current === next) return { changed: false, summary: `${path.basename(to)} is up to date.` };
  const spec = yaml.load(next);
  const errors = validateSpec(spec);
  if (errors.length) return { changed: false, invalid: true, errors, summary: `The product repo's spec fails OpenAPI validation:\n${errors.map((e) => `- ${e}`).join('\n')}` };
  const ops = (s) => new Set(s ? groupByTag(s).flatMap((g) => g.ops.map((o) => `${o.method.toUpperCase()} ${o.path}`)) : []);
  const before = ops(current ? yaml.load(current) : null);
  const after = ops(spec);
  const added = [...after].filter((o) => !before.has(o));
  const removed = [...before].filter((o) => !after.has(o));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, next);
  const lines = [
    `Updates \`${to}\` from the product repo's copy.`,
    '',
    `- Operations added: ${added.length}${added.length ? ` (${added.slice(0, 20).map((o) => `\`${o}\``).join(', ')}${added.length > 20 ? ', …' : ''})` : ''}`,
    `- Operations removed: ${removed.length}${removed.length ? ` (${removed.slice(0, 20).map((o) => `\`${o}\``).join(', ')}${removed.length > 20 ? ', …' : ''})` : ''}`,
    '',
    'Writers edit descriptions in this copy, so review the diff for overwritten wording before merging.',
  ];
  return { changed: true, added, removed, summary: lines.join('\n') };
}

const USAGE = `Usage: wso2-docs api <command>

  validate [path...]       Blocking OpenAPI checks: structure, broken $refs, duplicate operation IDs.
                           A path is a spec file or a Content repo (default: .)
  lint [path...]           validate, plus the warn-only description lint
  split <api-folder>       Add one page per tag next to the API's index.mdx (APIs over the page budget)
  sync --from <f> --to <f> Copy a product repo's spec over the Content repo's copy if it changed`;

export function runApiCommand(argv, log = console.log, logErr = console.error) {
  const [sub, ...rest] = argv;
  if (sub === 'validate' || sub === 'lint') {
    const targets = rest.length ? rest : ['.'];
    const files = targets.flatMap((t) => specFilesIn(t));
    if (!files.length) {
      logErr('No API specs found (pages with layout: api-reference).');
      return 1;
    }
    const { results, ok } = validateFiles(files, { lint: sub === 'lint' });
    for (const r of results) {
      const rel = path.relative(process.cwd(), r.file);
      if (r.errors.length) logErr(`✗ ${rel}: ${r.errors.length} error(s)\n  ${r.errors.join('\n  ')}`);
      else log(`✓ ${rel}${sub === 'lint' ? `: ${r.warnings.length} warning(s)` : ''}`);
      for (const w of r.warnings) log(`  warning: ${w}`);
    }
    return ok ? 0 : 1;
  }
  if (sub === 'split') {
    if (!rest[0]) { logErr(USAGE); return 2; }
    const created = splitApi(rest[0]);
    log(created.length ? created.map((f) => `created ${path.relative(process.cwd(), f)}`).join('\n') : 'Every tag already has a page.');
    return 0;
  }
  if (sub === 'sync') {
    const at = (flag) => rest[rest.indexOf(flag) + 1];
    if (!rest.includes('--from') || !rest.includes('--to')) { logErr(USAGE); return 2; }
    const r = syncSpec(at('--from'), at('--to'));
    if (rest.includes('--summary')) fs.writeFileSync(at('--summary'), `${r.summary}\n`);
    (r.invalid ? logErr : log)(r.summary);
    return r.invalid ? 1 : 0;
  }
  log(USAGE);
  return sub ? 2 : 0;
}
