// `wso2-docs check`: the PR's blocking checks, then the warn-only lint on
// changed lines, against a Content repo working copy (Quality gates for Docs
// releases). Passing locally means passing on the PR. The report is the same
// for people (text) and CI (JSON); exit code 1 means a blocking failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNVERSIONED, editionFromId, inferEditionId } from '../edition.mjs';
import { DEFAULT_POLICY, loadPolicy } from '../manifest.mjs';
import { checkUrl, loadStandards, TEMPLATES_DIR } from '../standards.mjs';
import { DOC_EXT, editionRoutes, loadContext } from './content.mjs';
import { changedInCheckout, currentBranch, pathInCheckout, resolveBase } from './git.mjs';
import { parseBranch } from '../content-repo.mjs';
import { compileAll } from './mdx.mjs';
import { checkTwins, previewBuild } from './build.mjs';
import { runSpelling, runVale } from './lint.mjs';
import { checkDataFiles } from './data.mjs';
import { checkContentSafety } from './safety.mjs';
import { specFilesIn, validateFiles } from '../api-commands.mjs';
import {
  checkDocsLinks, checkFrontMatter, checkHouseStyle, checkImageAlt, checkImageSize, checkMarkerVersions, checkRedirects, checkSkeleton,
} from './source.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf8'));
export const STAGING_ROUTES = 'https://docs-staging.wso2.com';

// Route lists of other Docs deployments, for docs: links: a local folder laid
// out like the site (<space>/<segment>/_platform/pages.json, or pages.json
// directly there) or a host serving /<space>/<segment>/_platform/pages.json.
export function routeLoader(source) {
  const cache = new Map();
  return async (space, segment) => {
    const key = `${space}/${segment}`;
    if (cache.has(key)) return cache.get(key);
    const rel = segment === UNVERSIONED ? space : `${space}/${segment}`;
    let list = null;
    try {
      if (/^https?:\/\//.test(source)) {
        const res = await fetch(`${source.replace(/\/$/, '')}/${rel}/_platform/pages.json`, { signal: AbortSignal.timeout(10_000) });
        if (res.ok) list = await res.json();
      } else {
        for (const file of [path.join(source, rel, '_platform', 'pages.json'), path.join(source, rel, 'pages.json')]) {
          if (fs.existsSync(file)) {
            list = JSON.parse(fs.readFileSync(file, 'utf8'));
            break;
          }
        }
      }
    } catch {
      list = null;
    }
    cache.set(key, list);
    return list;
  };
}

// The build being checked answers for its own deployment: links into it
// (a family Cloud's links into its Cloud parts, a part's links to its own
// pages at /<platform>/cloud/<part>/) are checked against its pages.json, not
// against what staging serves now. Other deployments come from `routes`.
export function withOwnBuild(routes, buildDir) {
  let own = null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(buildDir, '_platform', 'edition.json'), 'utf8'));
    const pages = JSON.parse(fs.readFileSync(path.join(buildDir, '_platform', 'pages.json'), 'utf8'));
    const segs = String(meta.baseUrl ?? '').split('/').filter(Boolean);
    if (segs.length) {
      const unversioned = meta.edition === UNVERSIONED;
      const n = unversioned ? 1 : 2;
      const prefix = segs.slice(n).map((x) => `${x}/`).join('');
      own = { space: segs[0], segment: unversioned ? UNVERSIONED : segs[1], prefix, pages: pages.map((p) => ({ ...p, path: `${prefix}${p.path}` })) };
    }
  } catch {
    own = null;
  }
  if (!own) return routes;
  return async (space, segment) => {
    if (space !== own.space || segment !== own.segment) return routes(space, segment);
    if (!own.prefix) return own.pages;
    // A part built on its own: the rest of the platform's tree from `routes`.
    const rest = (await routes(space, segment)) ?? [];
    return [...own.pages, ...rest.filter((p) => !String(p.path).startsWith(own.prefix))];
  };
}

function templateComments() {
  const set = new Set();
  for (const f of fs.readdirSync(TEMPLATES_DIR)) {
    for (const m of fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8').matchAll(/\{(\/\*[^]*?\*\/)\}/g)) set.add(m[1].trim());
  }
  return set;
}

function pickEdition(repo, explicit, base) {
  if (repo.docspace.model === 'unversioned') return UNVERSIONED;
  if (explicit) return explicit;
  for (const branch of [base?.label, currentBranch(repo.root)]) {
    if (!branch) continue;
    try {
      return inferEditionId(branch, repo.docspace.model, repo.docspace);
    } catch {
      // try the next one
    }
  }
  throw new Error('Cannot tell which Edition this branch builds; pass --edition (cloud, next or a version)');
}

// A Doc space's release branch, <slug>/release/<version>, is a copy of the
// whole Content repo that builds only <slug>/: a change there may not touch
// any other path (Repo structure for Platform, sections and Doc spaces).
export function checkReleaseScope(repo, base) {
  const branch = base?.label ?? currentBranch(repo.root);
  const b = parseBranch(branch);
  const own = pathInCheckout(repo.root);
  // An unprefixed release/<version> belongs to the repo's one Doc space; in
  // the old layout (the Doc space at the root) there is nothing else to keep out.
  const space = b?.space ?? (b && !b.main ? own : '');
  if (!b || b.main || !space) return { findings: [], note: 'not a Doc space\'s release branch' };
  const findings = [];
  if (own !== space) {
    findings.push({ level: 'error', file: null, line: 1, message: `${branch} is ${space}'s release branch, but this is ${own || 'the repo root'}; check ${space}/ there` });
  }
  if (base) {
    for (const p of changedInCheckout(repo.root, base.ref)) {
      if (p === space || p.startsWith(`${space}/`)) continue;
      findings.push({ level: 'error', file: `../${p}`, line: 1, message: `${p} is outside ${space}/: ${branch} builds only ${space}/, so change other directories on their own branches (shared root files on main)` });
    }
  }
  return { findings, note: `${branch}: only ${space}/ may change` };
}

// The compose step's issues that involve this Doc space's own docspace.yaml,
// as compose reported them (errors block; warnings show).
function checkManifest({ issues, file, from }) {
  const mine = issues.filter((i) => i.level !== 'note' && (!file || i.files.includes(file)));
  const others = (i) => i.files.filter((f) => f !== file);
  const findings = mine.map((i) => ({
    level: i.level === 'error' ? 'error' : 'warning', file: 'docspace.yaml', line: 1,
    message: `${i.code}: ${i.message}${others(i).length ? ` (with ${others(i).join(', ')}; owners: ${i.owners.join(', ')})` : ''}`,
  }));
  return { findings, note: `composed with ${from}` };
}

// options: { repo, base, edition, manifest, compose, routes, requireRoutes, build, buildDir,
//            buildOut, baseUrl, linkHost, lint, lintAll, release, override, verbose, log }
// compose: { issues, file, from } when the manifest was composed here (with
// the published manifest), so the Doc space manifest check can report on
// this Doc space's docspace.yaml; { skipped: <why> } otherwise.
export async function runCheck(o) {
  const S = loadStandards();
  const log = o.log ?? (() => {});
  const { repo } = o;
  const policy = loadPolicy(o.manifest ?? DEFAULT_POLICY);
  const release = Boolean(o.release);
  const base = release ? null : resolveBase(repo.root, o.base);
  const editionId = pickEdition(repo, o.edition, base);
  const edition = editionFromId(editionId);
  const ctx = loadContext({ repo, base });
  const checks = [];
  const run = async (id, fn) => {
    const def = S.check(id);
    const entry = { id, title: def.title, blocking: def.blocking, overridable: Boolean(def.overridable), link: checkUrl(id), findings: [], note: null };
    checks.push(entry);
    try {
      const r = await fn();
      if (r?.skipped) entry.skipped = r.skipped;
      else {
        entry.findings = Array.isArray(r) ? r : r.findings;
        entry.note = Array.isArray(r) ? null : r.note ?? null;
      }
    } catch (err) {
      entry.findings = [{ level: 'error', file: null, line: 1, message: `The check could not run: ${err.message}` }];
    }
  };
  const skip = (id, why) => run(id, () => ({ skipped: why }));

  const changedDocs = ctx.docs.filter((d) => ctx.isChanged(d.file)).map((d) => d.file);
  log(`Checking ${repo.docspace.slug} as ${editionId === UNVERSIONED ? 'its only Edition' : editionId}${base ? ` against ${base.label} (${base.ref.slice(0, 8)})` : ''}`);

  // Blocking checks.
  const compiled = await compileAll(ctx, { manifest: o.manifest, editionId });
  await run('compile', () => ({ findings: compiled.findings.filter((x) => x.check === 'compile'), note: `${ctx.docs.length} files in ${compiled.editions.join(', ')}` }));
  await run('openapi', () => {
    const files = specFilesIn(repo.root);
    const { results } = validateFiles(files, { lint: true });
    const rel = (file) => path.relative(repo.root, file).split(path.sep).join('/');
    const findings = results.flatMap((r) => [
      ...r.errors.map((e) => ({ level: 'error', file: rel(r.file), line: 1, message: e })),
      ...(ctx.isChanged(rel(r.file)) ? r.warnings.map((w) => ({ level: 'warning', file: rel(r.file), line: 1, message: w })) : []),
    ]);
    return { findings, note: `${files.length} specs` };
  });
  let buildDir = o.buildDir ?? null;
  if (buildDir) await skip('preview-build', `using the existing build in ${buildDir}`);
  else if (o.build === false) await skip('preview-build', '--no-build');
  else {
    const out = o.buildOut ?? fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-docs-check-'));
    log(`Building the preview of ${editionId} (strict links, anchors and images)…`);
    await run('preview-build', () => {
      const r = previewBuild(ctx, { editionId, out, baseUrl: o.baseUrl, linkHost: o.linkHost, manifest: o.manifest, verbose: o.verbose, routes: editionRoutes(ctx.docs, edition) });
      if (r.ok) buildDir = out;
      return r;
    });
  }
  if (release) await skip('manifest', 'checked by compose before the release');
  else if (!o.compose || o.compose.skipped) await skip('manifest', o.compose?.skipped ?? 'no compose result');
  else await run('manifest', () => checkManifest(o.compose));
  await run('docs-links', () => checkDocsLinks(ctx, policy, buildDir ? withOwnBuild(routeLoader(o.routes ?? STAGING_ROUTES), buildDir) : routeLoader(o.routes ?? STAGING_ROUTES), { requireRoutes: o.requireRoutes }));
  if (release) await skip('release-scope', 'checked on the pull request');
  else await run('release-scope', () => checkReleaseScope(repo, base));
  if (release) await skip('redirects', 'checked on the pull request');
  else await run('redirects', () => (base ? checkRedirects(ctx, edition) : { findings: checkRedirects(ctx, edition), note: 'no git base: only redirects.yaml itself is checked' }));
  await run('front-matter', () => checkFrontMatter(ctx, S));
  await run('data-files', () => checkDataFiles(ctx));
  await run('content-safety', () => checkContentSafety(ctx));
  await run('markers', () => compiled.findings.filter((x) => x.check === 'markers'));
  if (release) await skip('marker-versions', 'checked on the pull request');
  else await run('marker-versions', () => checkMarkerVersions(ctx, policy, edition));
  await run('skeleton', () => checkSkeleton(ctx, S));
  if (release) {
    await skip('image-size', 'checked on the pull request');
    await skip('image-alt', 'checked on the pull request');
  } else {
    await run('image-size', () => checkImageSize(ctx));
    await run('image-alt', () => checkImageAlt(ctx));
  }
  if (buildDir) await run('twins', () => checkTwins(buildDir, { siteUrl: o.siteUrl }));
  else await skip('twins', 'needs the preview build');

  // Warn-only lint on changed lines.
  const lintFiles = (o.lintAll ? ctx.docs.map((d) => d.file) : changedDocs).filter((f) => DOC_EXT.test(f));
  if (release || o.lint === false) {
    for (const id of ['vale', 'spelling', 'headings']) await skip(id, release ? 'not part of a release build' : '--no-lint');
  } else {
    await run('vale', () => runVale(ctx, lintFiles, { all: o.lintAll, blockingRules: S.lint.blockingRules }));
    await run('spelling', () => runSpelling(ctx, S, lintFiles, { all: o.lintAll }));
    await run('headings', () => checkHouseStyle(ctx, S, templateComments(), { all: o.lintAll }));
  }

  // Blocking means: an error in a blocking check, or a promoted lint rule.
  const override = o.override ? String(o.override) : null;
  let blocking = 0;
  let overridden = 0;
  let warnings = 0;
  for (const c of checks) {
    for (const x of c.findings) {
      x.link ??= c.link;
      x.blocking = (c.blocking && x.level === 'error') || Boolean(x.promoted);
      if (x.blocking && c.overridable && override) {
        x.blocking = false;
        x.overridden = true;
      }
      if (x.blocking) blocking++;
      else if (x.overridden) overridden++;
      else warnings++;
    }
    c.status = c.skipped ? 'skipped'
      : c.findings.some((x) => x.blocking) ? 'fail'
        : c.findings.some((x) => x.overridden) ? 'overridden'
          : c.findings.length ? 'warn' : 'pass';
  }
  return {
    schema: 1,
    tool: 'wso2-docs check',
    platformVersion: pkg.version,
    docSpace: repo.docspace.slug,
    edition: editionId,
    base: base ? { ref: base.ref, label: base.label } : null,
    mode: release ? 'release' : 'pr',
    changedFiles: ctx.changes.length,
    override: override ? { reason: override } : null,
    result: blocking ? 'fail' : 'pass',
    summary: { blocking, overridden, warnings },
    checks,
  };
}

const ICON = { pass: '✔', fail: '✖', warn: '⚠', skipped: '–', overridden: '◇' };
const where = (x) => (x.file ? `${x.file}${x.line ? `:${x.line}` : ''}${x.column ? `:${x.column}` : ''}` : '');

export function formatText(report, { maxPerCheck = 30 } = {}) {
  const lines = [];
  const editionLabel = report.edition === UNVERSIONED ? 'its only Edition' : `Edition ${report.edition}`;
  lines.push(`wso2-docs check: ${report.docSpace}, ${editionLabel}, ${report.base ? `compared with ${report.base.label} (${report.base.ref.slice(0, 8)})` : 'all files (no git base)'}`);
  lines.push('');
  for (const c of report.checks) {
    const kind = c.blocking ? (c.overridable ? 'blocks; owner can override' : 'blocks') : 'warns';
    const counts = c.findings.length ? `: ${c.findings.length} finding${c.findings.length === 1 ? '' : 's'}` : '';
    const note = c.skipped ? ` (skipped: ${c.skipped})` : c.note ? ` (${c.note})` : '';
    lines.push(`${ICON[c.status]} ${c.title} [${kind}]${counts}${note}`);
    for (const x of c.findings.slice(0, maxPerCheck)) {
      const tag = x.blocking ? 'error' : x.overridden ? 'overridden' : x.level;
      lines.push(`    ${tag.padEnd(10)} ${where(x)}${where(x) ? '  ' : ''}${x.message}${x.rule && c.id === 'vale' ? ` [${x.rule}]` : ''}`);
    }
    if (c.findings.length > maxPerCheck) lines.push(`    … and ${c.findings.length - maxPerCheck} more (use --format json for all)`);
    if (c.status === 'fail') lines.push(`    How to fix: ${c.link}`);
  }
  lines.push('');
  const s = report.summary;
  lines.push(`Result: ${report.result} (${s.blocking} blocking, ${s.overridden} overridden, ${s.warnings} warnings and suggestions)`);
  if (report.override) lines.push(`Override reason: ${report.override.reason}`);
  return lines.join('\n');
}

// GitHub workflow commands, so findings show on the PR's changed lines.
export function formatAnnotations(report, prefix = '') {
  const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const out = [];
  for (const c of report.checks) {
    for (const x of c.findings) {
      const cmd = x.blocking ? 'error' : x.level === 'info' ? 'notice' : 'warning';
      const loc = x.file ? `file=${prefix}${x.file},line=${x.line ?? 1},` : '';
      out.push(`::${cmd} ${loc}title=${esc(c.title).replace(/,/g, '%2C')}::${esc(`${x.message} (${x.link})`)}`);
    }
  }
  return out.join('\n');
}
