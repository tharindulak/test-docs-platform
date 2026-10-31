#!/usr/bin/env node
// The @wso2/docs CLI. Run from a Content repo checkout:
//   npx @wso2/docs preview [--edition <id>] [--only <folder>] [--exact] [--search]
//   npx @wso2/docs build   [--edition <id>] [--as-latest] [--show-markers] [--out <dir>] ...
//   npx @wso2/docs check   [--base <ref>] [--no-build] [--format json] ...
//   npx @wso2/docs new <type> --title "<title>" [--folder <path>]
//   npx @wso2/docs init <slug> [--repo <path>] [--title <name>] [--home <section>] [--cloud] [--self-hosted <version>]
//   npx @wso2/docs branch-cut <doc space> <version> [--repo <path>] [--dry-run] [--report <file>]
//   npx @wso2/docs bundle [content-dir] [--tag <tag>] [--dry-run] [--out <dir>]
//   wso2-docs build --landing [--out <dir>]   (the Landing deployment, from the Platform)
//   npx @wso2/docs api     validate | lint | split | sync
// npx keeps this package in its own cache, so the Content repo stays content-only.
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { UNVERSIONED, showMarkersFlag } from '../lib/edition.mjs';
import { loadContentRepo } from '../lib/content.mjs';
import { formatAnnotations, formatText, pickEdition, runCheck } from '../lib/check/index.mjs';
import { repoWords, writeValeConfig } from '../lib/check/lint.mjs';
import { scaffoldPage } from '../lib/scaffold.mjs';
import { DEFAULT_POLICY, loadPolicy } from '../lib/manifest.mjs';
import { COLLECTIONS, LOCAL } from '../lib/search/environments.mjs';
import { ensureCollection, ensureSearchOnlyKey, indexDeployment, readBuild } from '../lib/search/indexing.mjs';
import { typesenseClient } from '../lib/search/typesense.mjs';
import { runApiCommand } from '../lib/api-commands.mjs';
import { docSpaceDirs, planMainRelease, planPullRequest, planVersionRelease } from '../lib/content-repo.mjs';
import { DOCS_WORKFLOW, IMMUTABLE_RELEASES, initDocSpace, initReport, refreshRootFiles } from '../lib/init.mjs';
import { cacheDir } from '../lib/cache-dir.mjs';
import { branchCut, formatReport } from '../lib/branch-cut.mjs';
import { formatBundle, makeBundle } from '../lib/bundle.mjs';
import { formatIssues } from '../lib/compose.mjs';
import { composeWithPublished, localDocSpaces, localRepo, publishedSource, readPublished } from '../lib/published.mjs';

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(pkgRoot, 'site');
const require = createRequire(import.meta.url);
const docusaurusBin = path.join(path.dirname(require.resolve('@docusaurus/core/package.json')), 'bin', 'docusaurus.mjs');
const STAGING = 'https://docs-staging.wso2.com';
const STAGING_ROUTES_HELP = STAGING;
const DEFAULT_PUBLISHED_HELP = 'https://docs-staging.wso2.com/manifest.json';

const USAGE = `Usage: wso2-docs <command> [content-dir] [options]

Commands:
  preview   Live preview of one Edition with hot reload
  build     Build one Docs deployment
  api       OpenAPI specs: validate, lint, split into tag pages, sync (wso2-docs api help)
  check     Run the pull request's checks against this working copy
  new       Create a page from a page-type template
  init      Start a Doc space: a new Content repo, or one more Doc space in a repo
  branch-cut  Cut a new Self-hosted version's branch from main, remove the
            markers it covers from main (a commit for a pull request), and
            write the branch cut report
  bundle    Check and pack one Docs release tag's Doc space as its Docs bundle
  spaces    The Doc spaces an event touches in a Content repo (the workflow's path filter)

Common options:
  --edition <id>     cloud, next or a version (default: from the git branch)
  --manifest <file>  A composed Deployment manifest to use as it is
  --published <url|file>
                     The published manifest.json that preview, check and build
                     compose this repo's Doc space manifests into (default:
                     WSO2_DOCS_PUBLISHED_MANIFEST, else ${DEFAULT_PUBLISHED_HELP}).
                     Set WSO2_DOCS_CONTENT_REPOS to a folder of Content repo
                     checkouts to compose from those instead.

preview options:
  --only <folder>    Load only this docs/ folder, for speed on large Doc spaces
  --exact            Render exactly as published (no markers or dev toolbar)
  --search           Start local Typesense with Docker Compose and index this
                     Edition into it (one extra build; WSO2_DOCS_SEARCH_PORT, default 8108)
  --port <n>         Dev server port (default 3000)

build options:
  --as-latest        Build the <space>/latest/ twin
  --show-markers     A preview build with Edition markers shown and the Edition
                     toggle, as local preview has them (PR previews); refused
                     with --env production or --as-latest, and never released
  --landing          Build the Landing deployment (docs.wso2.com/) instead; no content-dir
  --env <name>       "production" for release builds: adds the GTM + CookiePro head
                     script, which runs only on the --site-url host (default: none)
  --main-files <f>   Content repo files on main, one per line (default: from git), so
                     "Edit this page" goes to main first
  --site-url <url>   Canonical host (default https://docs.wso2.com)
  --link-host <url>  Host for docs: links (default: --site-url)
  --base-url <path>  Override /<space>/<edition>/
  --latest-pages <f> pages.json of the latest Edition, for canonicals (its redirects.json beside it, if there, for page moves)
  --deployed <file>  The environment's deployment state (wso2-release status) or a
                     published manifest.json: the menus built into each page list
                     only deployed Doc spaces and this build's (default: the
                     published manifest preview, check and build composed with)
  --out <dir>        Output directory

check options (exit code 1 when a blocking check fails, else 0):
  --base <ref>       Compare with this branch or commit (default: where this
                     branch left main or its release branch)
  --no-build         Skip the preview build (and the Markdown twin checks)
  --no-lint          Skip the warn-only lint (Vale, cspell, headings)
  --lint-all         Lint every line of every page (nightly counts)
  --routes <dir|url> Route lists of other deployments for docs: links
                     (default: ${STAGING_ROUTES_HELP})
  --require-routes   Fail when a docs: link's route list can't be loaded
  --release          The release build's blocking subset (no policy checks or lint)
  --build-dir <dir>  Check this existing build instead of building
  --build-out <dir>  Keep the preview build here
  --format text|json Output (default text); --out <file> also writes JSON
  --annotate <pfx>   Also print GitHub annotations, paths prefixed with <pfx>
  --override <why>   Report policy-check failures as overridden, with the reason
  --vale-config      Write a Vale config for your editor, print its path, exit

spaces options (repo-dir: the Content repo checkout; JSON on stdout):
  --branch <name> --base <ref>   A pull request to <name>: the Doc spaces it
                     changes, with their Editions (on a <doc space>/release/<v>
                     branch, that Doc space; exit 1 when the PR changes
                     another directory)
  --push --base <before>         A push to main: the Cloud releases it makes
  --release <dir> --version <v>  "Release docs": the tag to make on the branch
  --github-output <file>         Also append spaces= and releases= to this file

new options:
  new <type> [content-dir] --title <text> [--description <text>]
             [--folder <path under docs/>] [--file <name>]
  Types: quick-start, tutorial, how-to, concept, reference, release-notes

init options (writes <slug>/ from the Platform's template, templates/content-repo/;
stops without writing if <slug>/ exists):
  init <slug> [--repo <path>]  The Content repo's root (default: here). With no
                     Doc space yet it also writes the root files (README, CODEOWNERS,
                     workflows, editor settings); else it adds the README row and
                     CODEOWNERS line and brings the template's root files up to date
  --title <name>     The Doc space's name (default: from the slug)
  --home <section>   Its home Docs section (default: the repo's other Doc spaces')
  --team <team>      owners.team (default: the repo's, else <slug>-docs)
  --github <owner/name>  The repo in docspace.yaml (default: the repo's, its origin
                     remote, else wso2/<folder name>)
  --cloud            A Cloud Edition (the default without --self-hosted)
  --self-hosted <v>  A Self-hosted Edition, such as 1.0.0 (add --cloud for both)
  init --root-files [--repo <path>]
                     No new Doc space: bring the Platform-managed root files (workflows,
                     branch ruleset, editor settings) up to date with this Platform's
                     template, and list what changed

bundle options (content-dir: a Doc space directory, or the Content repo root,
where the tag's prefix names the Doc space; exit 1 when a check fails):
  --tag <tag>        The Docs release tag (default: the one at HEAD); the Edition
                     and the asset name come from it
  --edition <id>     The Edition (default: from the tag, else from the git branch)
  --dry-run          Pack and check, write nothing (pull requests; no tag needed)
  --out <dir>        Write <slug>-<tag without its prefix>.docs.zip and bundle.json
                     here (default: ~/.cache/wso2-docs/bundles)
  --repo <owner/name>  The repo in bundle.json (default: GITHUB_REPOSITORY, else
                     docspace.yaml's repo)
  --commit <sha>     The source commit (default: HEAD)
  --main-files <f>   Content repo files on main, one per line (default: from git)
  --report <file>    Also write the report as JSON
  --github-output <file>  Append asset=, sha256=, bytes=, tag=, edition=, doc-space=
                     and source-commit= to this file
  --format json      Print the report as JSON

branch-cut options (git only: no push, and the checkout is left as it is):
  branch-cut <doc space> <version> [--repo <path>]
                     Make the version's branch from main ([<doc space>/]release/<version>,
                     as its builds read it), a plain copy whose markers stay; then commit,
                     on branch-cut/<doc space>/<version> from main, the removal of every
                     selfHostedFrom marker the version covers; print the branch cut report
  --branch <name>    The release branch exists already (made elsewhere; the bot's run):
                     only the commit on main and the report
  --from <ref>       Cut from this ref (default main)
  --dry-run          Only the report: no branch, no commit
  --report <file>    Also write the report (Markdown) to this file
  --format json      Print the report's data as JSON instead`;

// The paths an event changes: a pull request against its base (from where
// they meet), a push since `before` (everything when there is none).
function changedPaths(root, base, { push = false } = {}) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\n').filter(Boolean);
  if (!base || /^0+$/.test(base)) return git('ls-files');
  return push ? git('diff', '--name-only', base, 'HEAD') : git('diff', '--name-only', `${base}...HEAD`);
}

function spacesCommand(args) {
  const { values: o, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      branch: { type: 'string' }, base: { type: 'string' }, push: { type: 'boolean' },
      release: { type: 'string' }, version: { type: 'string' }, 'github-output': { type: 'string' },
    },
  });
  const root = path.resolve(positionals[0] ?? '.');
  const dirs = docSpaceDirs(root);
  let result;
  if (o.version !== undefined) result = { spaces: [], outside: [], releases: planVersionRelease({ dirs, space: o.release || null, version: o.version }) };
  else if (o.push) result = { spaces: [], outside: [], releases: planMainRelease({ dirs, paths: changedPaths(root, o.base, { push: true }) }) };
  else {
    if (!o.branch) throw new Error('spaces needs --branch (a pull request), --push or --version');
    result = { ...planPullRequest({ dirs, branch: o.branch, paths: changedPaths(root, o.base) }), releases: [] };
  }
  if (o['github-output']) fs.appendFileSync(o['github-output'], `spaces=${JSON.stringify(result.spaces)}\nreleases=${JSON.stringify(result.releases)}\n`);
  console.log(JSON.stringify(result, null, 2));
  for (const p of result.outside) console.log(`::error file=${p}::${o.branch} builds only its own Doc space directory; change ${p} on its own branch (shared root files on main)`);
  return result.outside.length ? 1 : 0;
}

function currentBranch(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}


// Run in the site's own folder, as the check's build does: webpack keeps its
// persistent cache under the nearest package.json's node_modules/.cache, and a
// Content repo has none, so run from there it would write .cache/ into the
// repo. Every path passed is absolute.
function runDocusaurus(args, env) {
  const r = spawnSync(process.execPath, [docusaurusBin, ...args], {
    cwd: siteDir,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return r.status ?? 1;
}

// Docusaurus's build exits 0 when it gets SIGINT or SIGTERM, so a stopped
// build would pass for a finished one. _platform/edition.json is written in
// postBuild, after every page: no marker, no build.
function runBuild(siteDir, out, env) {
  const marker = path.join(out, '_platform', 'edition.json');
  fs.rmSync(marker, { force: true });
  const status = runDocusaurus(['build', siteDir, '--out-dir', out], env);
  if (status === 0 && !fs.existsSync(marker)) {
    console.error(`wso2-docs: the build stopped before it finished (no ${path.relative(process.cwd(), marker) || marker}).`);
    return 1;
  }
  return status;
}

async function check(repo, o, policy) {
  if (o['vale-config']) {
    const dir = cacheDir('vale', repo.docspace.slug);
    fs.mkdirSync(dir, { recursive: true });
    console.log(writeValeConfig(dir, repoWords(repo.root)));
    return 0;
  }
  const json = o.format === 'json';
  const report = await runCheck({
    repo,
    base: o.base,
    edition: o.edition,
    manifest: policy.file,
    compose: policy.issues ? { issues: policy.issues, file: policy.ownFile, from: policy.from } : { skipped: `composed from ${policy.from}` },
    routes: o.routes && !/^https?:/.test(o.routes) ? path.resolve(o.routes) : o.routes,
    requireRoutes: o['require-routes'],
    build: !o['no-build'],
    lint: !o['no-lint'],
    lintAll: o['lint-all'],
    release: o.release,
    buildDir: o['build-dir'] ? path.resolve(o['build-dir']) : undefined,
    buildOut: o['build-out'] ? path.resolve(o['build-out']) : undefined,
    baseUrl: o['base-url'],
    linkHost: o['link-host'],
    siteUrl: o['site-url'],
    override: o.override ?? process.env.WSO2_DOCS_QUALITY_OVERRIDE,
    verbose: o.verbose,
    log: json ? () => {} : (line) => process.stderr.write(`${line}\n`),
  });
  if (o.out) fs.writeFileSync(path.resolve(o.out), `${JSON.stringify(report, null, 2)}\n`);
  console.log(json ? JSON.stringify(report, null, 2) : formatText(report));
  if (o.annotate !== undefined) console.log(formatAnnotations(report, o.annotate));
  return report.result === 'fail' ? 1 : 0;
}

function newPage(positionals, o) {
  const [type, dir] = positionals;
  if (!type) throw new Error('Usage: wso2-docs new <type> --title "<title>" (types: quick-start, tutorial, how-to, concept, reference, release-notes)');
  const repo = loadContentRepo(dir ?? '.');
  const r = scaffoldPage(repo, { type, title: o.title, description: o.description, folder: o.folder, file: o.file });
  for (const f of r.created) console.log(`Created ${f}`);
  console.log(`\nNext: write the ${r.type.label.toLowerCase()} page (see https://docs.wso2.com/contribute/concepts/page-types/#${r.type.id}),\nthen run npx @wso2/docs preview and npx @wso2/docs check.`);
  return 0;
}

function initCommand(args) {
  const { values: o, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      repo: { type: 'string' }, title: { type: 'string' }, home: { type: 'string' }, team: { type: 'string' },
      github: { type: 'string' }, cloud: { type: 'boolean' }, 'self-hosted': { type: 'string' }, 'root-files': { type: 'boolean' },
    },
  });
  if (o['root-files']) {
    if (positionals.length) throw new Error('init --root-files takes no slug: it only refreshes the root files');
    const r = refreshRootFiles(o.repo ?? '.');
    console.log(r.changed.length ? `Updated from the Platform's template in ${r.root}: ${r.changed.join(', ')}.\nCommit them on a branch from main and open a pull request.` : `The root files in ${r.root} already match this Platform's template.`);
    if (r.changed.includes(DOCS_WORKFLOW)) console.log(IMMUTABLE_RELEASES);
    return 0;
  }
  if (positionals.length !== 1) throw new Error('Usage: wso2-docs init <slug> [--repo <path>] [--title <name>] [--home <section>] [--cloud] [--self-hosted <version>]');
  const r = initDocSpace({
    slug: positionals[0], root: o.repo ?? '.', title: o.title, home: o.home, team: o.team, repo: o.github,
    cloud: o.cloud, selfHosted: o['self-hosted'],
  });
  console.log(initReport(r));
  return 0;
}

function branchCutCommand(args) {
  const { values: o, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      repo: { type: 'string' }, branch: { type: 'string' }, from: { type: 'string' }, 'dry-run': { type: 'boolean' },
      report: { type: 'string' }, format: { type: 'string' },
    },
  });
  if (o.branch ? positionals.length > 2 : positionals.length !== 2) {
    throw new Error('Usage: wso2-docs branch-cut <doc space> <version> [--repo <path>] [--dry-run] [--report <file>] (or --branch <release branch>)');
  }
  const [space, version] = positionals;
  const r = branchCut({ root: path.resolve(o.repo ?? '.'), space, version, from: o.from ?? 'main', branch: o.branch ?? null, dryRun: o['dry-run'] });
  const report = formatReport(r);
  if (o.report) fs.writeFileSync(path.resolve(o.report), report);
  console.log(o.format === 'json' ? JSON.stringify(r, null, 2) : report);
  for (const x of r.next) console.error(`warning: ${x.file}:${x.line} is still marked "next", so it is not in ${r.version}; decide on it from the branch cut report`);
  if (!r.dryRun && o.format !== 'json') {
    // The change to main first: the bot that a new release branch starts
    // then finds it and leaves it alone.
    const steps = [
      ...(r.main.branch ? [`git push -u origin ${r.main.branch}   # then open a pull request to ${r.from}`] : []),
      ...(r.branch.created ? [`git push -u origin ${r.branch.name}`] : []),
    ];
    if (steps.length) console.error(`Next:\n${steps.map((s) => `  ${s}`).join('\n')}`);
  }
  return 0;
}

function bundleCommand(args) {
  const { values: o, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      tag: { type: 'string' }, edition: { type: 'string' }, 'dry-run': { type: 'boolean' }, out: { type: 'string' },
      repo: { type: 'string' }, commit: { type: 'string' }, 'main-files': { type: 'string' }, report: { type: 'string' },
      'github-output': { type: 'string' }, format: { type: 'string' },
    },
  });
  if (positionals.length > 1) throw new Error('Usage: wso2-docs bundle [content-dir] [--tag <tag>] [--dry-run] [--out <dir>]');
  const r = makeBundle({
    dir: positionals[0] ?? '.', tag: o.tag, edition: o.edition, dryRun: o['dry-run'], out: o.out, repo: o.repo, commit: o.commit,
    mainFiles: o['main-files'] ? path.resolve(o['main-files']) : undefined,
  });
  if (o.report) fs.writeFileSync(path.resolve(o.report), `${JSON.stringify(r, null, 2)}\n`);
  if (o['github-output'] && r.result === 'pass') {
    const out = { asset: r.asset, sha256: r.sha256, bytes: r.bytes, tag: r.bundle.tag ?? '', edition: r.bundle.edition, 'doc-space': r.bundle.docSpace, 'source-commit': r.bundle.sourceCommit ?? '' };
    fs.appendFileSync(o['github-output'], Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(''));
  }
  console.log(o.format === 'json' ? JSON.stringify(r, null, 2) : formatBundle(r));
  return r.result === 'fail' ? 1 : 0;
}

// The Deployment manifest preview, check and build use. --manifest (or
// WSO2_DOCS_MANIFEST): that file as it is. WSO2_DOCS_CONTENT_REPOS: composed
// from that folder of Content repo checkouts (lib/manifest.mjs's default).
// --published, or neither of those: the published manifest.json with this repo's own Doc space manifests
// composed in (lib/published.mjs), written to a file the build reads; its
// issues in this repo's files come back for the caller to report.
async function resolvePolicy(repo, o, { log = (m) => console.error(m) } = {}) {
  if (o.manifest) return { file: path.resolve(o.manifest), from: o.manifest, issues: null };
  if (!o.published && process.env.WSO2_DOCS_MANIFEST) return { file: path.resolve(process.env.WSO2_DOCS_MANIFEST), from: process.env.WSO2_DOCS_MANIFEST, issues: null };
  if (!o.published && process.env.WSO2_DOCS_CONTENT_REPOS) return { file: undefined, from: `the Content repo checkouts in ${process.env.WSO2_DOCS_CONTENT_REPOS}`, issues: null };
  const source = publishedSource(o.published);
  const published = await readPublished(source, { log });
  const here = localRepo(repo.root);
  const docSpaces = localDocSpaces(here, { branch: currentBranch(repo.root) });
  const r = composeWithPublished(published, { repo: here.repo, docSpaces });
  const slug = repo.docspace.slug;
  if (!r.manifest?.docSpaces?.[slug]) {
    throw new Error(`${slug} does not compose with ${source}:\n${formatIssues(r.errors.length ? r.errors : r.issues)}`);
  }
  const dir = cacheDir('composed');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.json`);
  fs.writeFileSync(file, `${JSON.stringify(r.manifest, null, 2)}\n`);
  const deployed = path.join(dir, `${slug}.published.json`);
  fs.writeFileSync(deployed, `${JSON.stringify(published)}\n`);
  return { file, deployed, from: `${source} with ${here.repo}'s Doc space manifests`, issues: r.issues, ownFile: docSpaces.find((d) => d.dir === path.basename(repo.root))?.file ?? null, url: /^https?:/.test(source) ? source : null };
}

const issueLines = (issues) => formatIssues(issues).split('\n').map((l) => `  ${l}`).join('\n');

// preview --search: local Typesense (search/docker-compose.yml), loaded with
// this Edition's records from one build of the previewed pages.
async function startLocalSearch(repo, env) {
  const port = process.env.WSO2_DOCS_SEARCH_PORT ?? String(LOCAL.port);
  const compose = path.join(pkgRoot, 'search', 'docker-compose.yml');
  const up = spawnSync('docker', ['compose', '-f', compose, 'up', '-d'], { stdio: 'inherit', env: { ...process.env, WSO2_DOCS_SEARCH_PORT: port } });
  if (up.status !== 0) {
    console.warn('Could not start local search (is Docker running?); continuing without it.');
    return {};
  }
  const url = `http://localhost:${port}`;
  const client = typesenseClient({ url, apiKey: LOCAL.adminKey });
  for (let i = 0; ; i += 1) {
    try {
      if ((await client.health()).ok) break;
    } catch {
      // not up yet
    }
    if (i > 60) {
      console.warn(`Local search at ${url} did not become healthy; continuing without it.`);
      return {};
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const out = cacheDir('search-build', repo.docspace.slug, env.WSO2_DOCS_EDITION);
  console.log('Building the Edition once for the search index…');
  const status = runDocusaurus(['build', siteDir, '--out-dir', out], { ...env, WSO2_DOCS_SHOW_MARKERS: '0' });
  if (status !== 0) {
    console.warn('The search build failed; previewing without search.');
    return {};
  }
  const { meta, records } = readBuild(out);
  await ensureCollection(client, COLLECTIONS.local);
  await ensureSearchOnlyKey(client, COLLECTIONS.local, LOCAL.searchKey);
  const policy = loadPolicy(env.WSO2_DOCS_MANIFEST ?? DEFAULT_POLICY);
  const r = await indexDeployment(client, { collection: COLLECTIONS.local, records, meta, policy, release: `preview-${Date.now()}` });
  console.log(`Local search: ${r.imported} records for ${r.docSpace} ${r.edition} at ${url}`);
  return { WSO2_DOCS_SEARCH_ENV: 'local', WSO2_DOCS_SEARCH_URL: url };
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return 0;
  }
  if (command === 'api') return runApiCommand(rest);
  if (command === 'spaces') return spacesCommand(rest);
  if (command === 'init') return initCommand(rest);
  if (command === 'branch-cut') return branchCutCommand(rest);
  if (command === 'bundle') return bundleCommand(rest);
  const { values: o, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      edition: { type: 'string' }, manifest: { type: 'string' },
      only: { type: 'string' }, exact: { type: 'boolean' }, search: { type: 'boolean' }, port: { type: 'string' },
      'as-latest': { type: 'boolean' }, 'site-url': { type: 'string' }, 'link-host': { type: 'string' },
      'base-url': { type: 'string' }, 'latest-pages': { type: 'string' }, out: { type: 'string' },
      base: { type: 'string' }, routes: { type: 'string' }, 'require-routes': { type: 'boolean' },
      'no-build': { type: 'boolean' }, 'no-lint': { type: 'boolean' }, 'lint-all': { type: 'boolean' },
      release: { type: 'boolean' }, 'build-dir': { type: 'string' }, 'build-out': { type: 'string' },
      format: { type: 'string' }, annotate: { type: 'string' }, override: { type: 'string' },
      'vale-config': { type: 'boolean' }, verbose: { type: 'boolean' },
      title: { type: 'string' }, description: { type: 'string' }, folder: { type: 'string' }, file: { type: 'string' },
      landing: { type: 'boolean' }, env: { type: 'string' }, 'main-files': { type: 'string' }, 'show-markers': { type: 'boolean' },
      published: { type: 'string' }, deployed: { type: 'string' },
    },
  });
  if (o.env && !['production', 'preview'].includes(o.env)) throw new Error(`--env must be "production" or "preview"`);
  const urls = {
    ...(o['site-url'] ? { WSO2_DOCS_SITE_URL: o['site-url'] } : {}),
    ...(o.env ? { WSO2_DOCS_ENV: o.env } : {}),
    ...(o.manifest ? { WSO2_DOCS_MANIFEST: path.resolve(o.manifest) } : {}),
    ...(o.deployed ? { WSO2_DOCS_DEPLOYED: path.resolve(o.deployed) } : {}),
  };
  if (command === 'build' && o.landing) {
    showMarkersFlag({ showMarkers: o['show-markers'], landing: true });
    const out = path.resolve(o.out ?? cacheDir('build', '_landing'));
    console.log(`Building the Landing deployment → ${out}`);
    return runBuild(siteDir, out, { ...urls, WSO2_DOCS_LANDING: '1' });
  }
  if (command === 'new') return newPage(positionals, o);
  if (!['build', 'preview', 'check'].includes(command)) {
    console.error(`Unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }
  const repo = loadContentRepo(positionals[0] ?? '.');
  const policy = o['vale-config'] ? { file: undefined, from: 'none', issues: null } : await resolvePolicy(repo, o);
  if (policy.issues?.length && command !== 'check') console.error(`Compose with ${policy.from}:\n${issueLines(policy.issues)}`);
  if (command === 'check') return check(repo, o, policy);
  const edition = pickEdition(repo, o.edition);
  const env = {
    WSO2_DOCS_CONTENT: repo.root,
    WSO2_DOCS_EDITION: edition,
    ...(policy.file ? { WSO2_DOCS_MANIFEST: policy.file } : {}),
    // Composed with the published manifest: its deployments are what the live menus show.
    ...(policy.deployed && !o.deployed ? { WSO2_DOCS_DEPLOYED: policy.deployed } : {}),
  };

  switch (command) {
    case 'build': {
      const asLatest = Boolean(o['as-latest']);
      const markers = showMarkersFlag({ showMarkers: o['show-markers'], env: o.env, asLatest });
      const out = path.resolve(o.out ?? cacheDir('build', repo.docspace.slug, asLatest ? 'latest' : edition));
      Object.assign(env, {
        WSO2_DOCS_AS_LATEST: asLatest ? '1' : '0',
        WSO2_DOCS_SHOW_MARKERS: markers,
        ...urls,
        ...(o['main-files'] ? { WSO2_DOCS_MAIN_FILES: path.resolve(o['main-files']) } : {}),
        ...(o['link-host'] ? { WSO2_DOCS_LINK_HOST: o['link-host'] } : {}),
        ...(o['base-url'] ? { WSO2_DOCS_BASE_URL: o['base-url'] } : {}),
        ...(o['latest-pages'] ? { WSO2_DOCS_LATEST_PAGES: path.resolve(o['latest-pages']) } : {}),
      });
      console.log(`Building ${repo.docspace.slug} ${asLatest ? `latest (${edition})` : edition}${markers === '1' ? ' with Edition markers shown' : ''} → ${out}`);
      return runBuild(siteDir, out, env);
    }
    case 'preview': {
      const port = o.port ?? '3000';
      // Composed from the published manifest: the menus and selectors draw the
      // manifest composed here, with this repo's change in it (the published
      // copy doesn't have it yet), and docs: links and chrome.json come from
      // the published manifest's host.
      const host = policy.url ? new URL(policy.url).origin : STAGING;
      Object.assign(env, {
        WSO2_DOCS_SITE_URL: `http://localhost:${port}`,
        WSO2_DOCS_LINK_HOST: host,
        WSO2_DOCS_MANIFEST_URL: policy.issues ? '' : `${STAGING}/manifest.json`,
        WSO2_DOCS_CHROME_URL: `${host}/chrome.json`,
        WSO2_DOCS_SHOW_MARKERS: o.exact ? '0' : '1',
        ...(o.only ? { WSO2_DOCS_ONLY: o.only } : {}),
      });
      if (o.search) Object.assign(env, await startLocalSearch(repo, { ...env, WSO2_DOCS_SHOW_MARKERS: '0' }));
      console.log(`Previewing ${repo.docspace.slug} as ${edition}${o.only ? `, only ${o.only}` : ''}`);
      return runDocusaurus(['start', siteDir, '--port', port, '--no-open'], env);
    }
    default:
      console.error(`Unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  console.error(`wso2-docs: ${err.message}`);
  process.exitCode = 1;
}
