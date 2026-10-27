// `wso2-docs init <slug>`: start a Doc space from the Platform's template
// (templates/content-repo/, Boilerplate to copy and start).
//
// In a folder with no Doc space yet (a new Content repo), it writes the
// template's __slug__/ skeleton as <slug>/ plus the repo root files, with the
// converter's own root writer (writeRepoRoot), so new and converted repos are
// the same. In a repo that already holds Doc spaces it writes <slug>/, brings
// the template's root files up to date, and adds the new directory's README
// row and CODEOWNERS line; run again, it changes nothing there. It stops,
// writing nothing, if <slug>/ already exists.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATE_DIR, addDocSpaceToRoot, copyTemplateFiles, docSpaceDirs, writeRepoRoot } from './content-repo.mjs';

export const SKELETON_DIR = path.join(TEMPLATE_DIR, '__slug__');
export const SECTION_TEMPLATE = path.join(TEMPLATE_DIR, '..', 'section-manifest.yaml');
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VERSION = /^(\d+\.\d+\.\d+|\d{4}\.\d{2}\.\d{2})$/;

const titleOf = (slug) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function listFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out;
}

function gitRemoteRepo(root) {
  try {
    const url = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = /github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/.exec(url);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// options: { slug, root, title, home, team, repo (owner/name), cloud, selfHosted }
//   cloud:      true for a Cloud Edition (the default when no version is given)
//   selfHosted: a version (1.0.0 or 2026.09.24), the first Self-hosted Edition
export function initDocSpace(o) {
  const { slug } = o;
  if (!SLUG.test(slug ?? '')) throw new Error(`The slug must be lowercase words joined by hyphens, such as api-portal (got "${slug ?? ''}")`);
  if (o.selfHosted !== undefined && !VERSION.test(o.selfHosted)) throw new Error(`--self-hosted takes an exact version such as 1.0.0, or a date version such as 2026.09.24 (got "${o.selfHosted}")`);
  const root = path.resolve(o.root ?? '.');
  const dest = path.join(root, slug);
  if (fs.existsSync(dest)) throw new Error(`${slug}/ already exists in ${root}; nothing was written. Pick another slug, or edit that Doc space.`);
  const existing = docSpaceDirs(root);
  const repo = o.repo ?? existing.find((d) => d.docspace.repo)?.docspace.repo ?? gitRemoteRepo(root) ?? `wso2/${path.basename(root)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error(`--github must be <owner>/<name>, such as wso2/docs-agent-platform (got "${repo}")`);
  const home = o.home ?? existing.find((d) => d.docspace.home)?.docspace.home;
  if (!home) throw new Error('Name the home Docs section: --home <section>, such as --home api-platform (agreed with the Platform team)');
  if (!SLUG.test(home)) throw new Error(`--home must be a Docs section id, such as api-platform (got "${home}")`);
  const title = o.title?.trim() || titleOf(slug);
  const team = o.team ?? existing.find((d) => d.docspace.owners?.team)?.docspace.owners.team ?? `${slug}-docs`;
  const cloud = o.cloud ?? o.selfHosted === undefined;
  const editions = [...(cloud ? ['cloud'] : []), ...(o.selfHosted ? [o.selfHosted] : [])];
  const editionNames = [
    `  ${cloud ? '' : '# '}cloud: ${title} Cloud`,
    `  selfHosted: ${title} {version}`,
  ];
  const fill = (text) => text
    .replaceAll('__EDITION_NAMES__', editionNames.join('\n'))
    .replaceAll('__EDITIONS__', editions.map((id) => `  - id: ${id}`).join('\n'))
    .replaceAll('__SLUG__', slug).replaceAll('__TITLE__', title)
    .replaceAll('__TEAM__', team).replaceAll('__REPO__', repo).replaceAll('__HOME__', home);

  const created = [];
  for (const rel of listFiles(SKELETON_DIR)) {
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const from = path.join(SKELETON_DIR, rel);
    if (/\.(ya?ml|mdx?)$/.test(rel)) fs.writeFileSync(to, fill(fs.readFileSync(from, 'utf8')));
    else fs.copyFileSync(from, to);
    created.push(`${slug}/${rel}`);
  }
  let root_;
  if (existing.length) root_ = { kind: 'existing', ...addDocSpaceToRoot(root, slug) };
  else {
    writeRepoRoot(root, { repo });
    root_ = { kind: 'new', changed: ['README.md', 'CODEOWNERS', ...listFiles(TEMPLATE_DIR).filter((f) => !f.startsWith('__slug__/'))] };
  }
  // A repo that held one Doc space with unprefixed release branches needs them
  // prefixed now that it holds several.
  const rename = existing.length === 1 ? unprefixedReleaseBranches(root).map((b) => ({ from: b, to: `${existing[0].dir}/${b}` })) : [];
  return { root, slug, title, repo, home, team, editions, created, rootFiles: root_, rename };
}

// `wso2-docs init --root-files`: a Content repo's Platform-managed root files
// (the workflows, the branch ruleset, the editor settings) brought up to date
// with this Platform version's template, as after a Platform release that
// changes templates/content-repo/. README, CODEOWNERS and the Doc space
// directories are left alone. Returns the files it changed.
export function refreshRootFiles(rootDir) {
  const root = path.resolve(rootDir ?? '.');
  if (!docSpaceDirs(root).length) throw new Error(`${root} holds no Doc space directory (<slug>/docspace.yaml); start one with wso2-docs init <slug>`);
  return { root, changed: copyTemplateFiles(root) };
}

function unprefixedReleaseBranches(root) {
  try {
    return execFileSync('git', ['-C', root, 'branch', '--list', 'release/*', '--format=%(refname:short)'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Each Docs release publishes its Docs bundle as a GitHub Release (Releases
// and deployments, Docs bundles), which must not change once published.
export const DOCS_WORKFLOW = '.github/workflows/docs.yml';
export const IMMUTABLE_RELEASES = 'Docs releases publish their Docs bundles as GitHub Releases: turn on immutable releases for this repo (Settings > General > Releases), if it is not on yet.';

// What init prints when it is done.
export function initReport(r) {
  const lines = [];
  lines.push(`Started ${r.title} (${r.slug}/) in ${r.root}: ${r.created.length} files from the template${r.rootFiles.kind === 'new' ? ', plus the repo root files' : ''}.`);
  if (r.rootFiles.kind === 'existing') lines.push(r.rootFiles.changed.length ? `Updated at the repo root: ${r.rootFiles.changed.join(', ')}.` : 'The repo root files were already up to date.');
  lines.push(`Editions: ${r.editions.join(', ')}. Home section: ${r.home}. Team: ${r.team}. Repo: ${r.repo}.`);
  if (r.rename.length) {
    lines.push('', 'This repo now holds several Doc spaces, so release branches carry the Doc space\'s prefix. Rename the old ones:');
    for (const b of r.rename) lines.push(`  git branch -m ${b.from} ${b.to}`);
  }
  lines.push(
    '',
    'Next:',
    `  1. Fill in ${r.slug}/docspace.yaml (every field has a comment), and replace the sample pages.`,
    `  2. Preview and check it: npx @wso2/docs preview ${r.slug} and npx @wso2/docs check ${r.slug}.`,
    `  3. Ask the ${r.home} section's team to list it, in navigation/sections/${r.home}.yaml in wso2/docs-platform:`,
    '       products:',
    `         - label: ${r.title}`,
    `           opens: { docSpace: ${r.slug} }`,
    '       menu:',
    `         - docSpace: ${r.slug}`,
    '     That change merges first: the entry stays hidden until the Doc space is published.',
    '     A new section starts from templates/section-manifest.yaml in the Platform.',
    `  4. Open your pull request. Guide: https://docs.wso2.com/contribute/guides/product-teams/start-a-doc-space/`,
  );
  if (r.rootFiles.changed.includes(DOCS_WORKFLOW)) lines.push('', IMMUTABLE_RELEASES);
  return lines.join('\n');
}

