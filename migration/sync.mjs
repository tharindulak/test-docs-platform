#!/usr/bin/env node
// Regenerates one Doc space directory on one Content repo branch from one
// MkDocs source checkout, and commits the result with its provenance (what
// the nightly run does):
//   node migration/sync.mjs <product> --source <mkdocs checkout> --repo <content repo>
//        --branch <main | <slug>/release/<version>> [--edition <version|next|cloud>]
//        [--author "Name <email>"] [--trailer "Key: value"]... [--no-compile]
// The output goes to <repo>/<slug>/ (Repo structure for Platform, sections and
// Doc spaces). On main it also writes the repo root's shared files (README,
// CODEOWNERS, the path-filtered workflow and the editor settings, from
// templates/content-repo/). A release branch is a copy of the whole repo cut
// from main; there, only <slug>/ may change, and the run stops otherwise.
// A missing main starts fresh (an orphan branch), so a repo can be
// regenerated in the new layout next to its old branches.
// A product read from a Docusaurus site (products/integrator.mjs) takes
// --source <site>: main converts docs/ (`next`), a release branch the
// version's versioned_docs/ (convert.mjs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { convertProduct } from './lib/run.mjs';
import { convertFamily } from './lib/family.mjs';
import { convertDocusaurus, siteDirOf } from './lib/docusaurus-run.mjs';
import { docSpaceDirs, editionForBranch, outsideReleaseDir, parseBranch, writeRepoRoot } from '../lib/content-repo.mjs';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string' }, repo: { type: 'string' }, branch: { type: 'string' }, edition: { type: 'string' },
    author: { type: 'string' }, trailer: { type: 'string', multiple: true }, 'no-compile': { type: 'boolean' },
  },
});
const product = positionals[0];
if (!product || !o.source || !o.repo || !o.branch) {
  console.error('Usage: sync.mjs <product> --source <dir> --repo <dir> --branch <main|<slug>/release/<version>> [--edition <id>]');
  process.exit(2);
}
const { default: config } = await import(`./products/${product}.mjs`);
const slug = config.slug;
const b = parseBranch(o.branch);
// An unprefixed release/<version> is allowed in a repo with one Doc space
// (Repo structure); that is checked against main below.
if (!b || (!b.main && b.space !== null && b.space !== slug)) {
  throw new Error(`${slug} converts to main or ${slug}/release/<version>, not ${o.branch}`);
}
if (config.kind === 'family' && !b.main) throw new Error(`${slug} is a family-level Doc space: Cloud only, on main`);
const edition = o.edition ?? (b.main ? editionForBranch(config.docspace, 'main') : b.version);
if (!b.main && edition !== b.version) throw new Error(`${o.branch} builds ${b.version}, not ${edition}`);

const repo = path.resolve(o.repo);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOk = (...args) => { try { git(...args); return true; } catch { return false; } };

if (!fs.existsSync(path.join(repo, '.git'))) {
  fs.mkdirSync(repo, { recursive: true });
  git('init', '-q', '-b', 'main');
}
if (git('status', '--porcelain')) throw new Error(`${repo} has uncommitted changes; commit or stash them first`);
const hasCommits = gitOk('rev-parse', '--verify', 'HEAD');
if (!b.main && !b.space) {
  // The Doc spaces on main: an unprefixed release branch needs this one alone.
  const onMain = gitOk('rev-parse', '--verify', 'refs/heads/main')
    ? git('ls-tree', '-r', '--name-only', 'main').split('\n').map((f) => /^([^/]+)\/docspace\.yaml$/.exec(f)?.[1]).filter(Boolean)
    : [];
  const others = onMain.filter((d) => d !== slug);
  if (others.length) throw new Error(`${slug} converts to main or ${slug}/release/<version>, not ${o.branch}: an unprefixed release branch needs a repo with one Doc space, and main also holds ${others.join(', ')}`);
}
if (gitOk('rev-parse', '--verify', `refs/heads/${o.branch}`)) git('checkout', '-q', o.branch);
else if (b.main) {
  if (hasCommits) {
    // A fresh main line in the new layout; the old branches stay as they are.
    git('checkout', '-q', '--orphan', 'main');
    git('rm', '-rfq', '--ignore-unmatch', '.');
  }
} else if (gitOk('rev-parse', '--verify', 'refs/heads/main')) git('checkout', '-q', '-b', o.branch, 'main');
else throw new Error('Convert main first: release branches are cut from it');

const sourceDir = path.resolve(o.source);
const sha = execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceRef = `${config.sourceRepo}@${sha}`;
const compile = !o['no-compile'];
const log = (m) => console.log(m);
// A family-level Doc space with an `overview` writes only that overview
// (lib/family.mjs); one with pages of its own converts like a product.
const { summary } = config.source === 'docusaurus'
  ? await convertDocusaurus({ config, siteDir: siteDirOf(sourceDir, config), outDir: path.join(repo, slug), edition, sourceRef, compile, log })
  : config.kind === 'family' && config.overview
  ? await convertFamily({ config, sourceRoot: path.join(sourceDir, config.sourceRoot), repoDir: repo, sourceRef, compile, log })
  : await convertProduct({
    config, sourceRoot: path.join(sourceDir, config.sourceRoot), outDir: path.join(repo, slug), edition,
    legacyVersion: edition === 'next' || edition === 'cloud' ? null : edition, sourceRef, compile, log,
  });

if (b.main) {
  // The sources of every Doc space on main, from their run reports.
  const sources = docSpaceDirs(repo).map((d) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(repo, d.dir, '.migration', 'report.json'), 'utf8')).summary.source;
    } catch {
      return null;
    }
  }).filter(Boolean);
  writeRepoRoot(repo, { repo: config.docspace.repo, generated: [...new Set(sources)] });
}
git('add', '-A');
const changed = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
const outside = outsideReleaseDir(changed, o.branch, docSpaceDirs(repo));
if (outside.length) {
  git('reset', '-q');
  throw new Error(`${o.branch} builds only ${slug}/, but the run changed ${outside.slice(0, 5).join(', ')}${outside.length > 5 ? ', …' : ''}`);
}
if (!changed.length) {
  console.log(`${o.branch}: no changes`);
} else {
  const s = summary.stats;
  const msg = [
    // A family-level or unversioned Doc space has one Edition: no name for it.
    `Convert ${config.docspace.displayName}${config.kind === 'family' || edition === '_' ? '' : ` ${edition}`} from ${sourceRef}`,
    '',
    `converted from ${sourceRef} by the WSO2 Docs converter (migration/ in wso2/docs-platform) into ${slug}/.`,
    `${s.pages} pages (${summary.navPages} in the legacy nav), ${s.partials} partials, ${s.apiPages} API pages, ${s.images} images; MDX compile failures: ${summary.compileFailures}.`,
    `Outstanding items: ${Object.entries(summary.issues).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} (see ${slug}/.migration/report.md).`,
    `Override list: ${summary.overrides.patchesApplied} of ${summary.overrides.patches} patches applied, ${s.acceptedByOverrides} legacy-broken links and anchors accepted.`,
    ...(o.trailer?.length ? ['', ...o.trailer] : []),
  ].join('\n');
  const authorArgs = o.author ? ['-c', `user.name=${o.author.split('<')[0].trim()}`, '-c', `user.email=${o.author.split('<')[1].replace('>', '').trim()}`] : [];
  execFileSync('git', ['-C', repo, ...authorArgs, 'commit', '-q', '-m', msg]);
  console.log(`${o.branch}: committed ${git('rev-parse', '--short', 'HEAD')}`);
}
process.exitCode = summary.compileFailures ? 1 : 0;
