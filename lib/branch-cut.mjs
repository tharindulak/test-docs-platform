// The Branch cut (Editions and versions: content per Edition). A new
// Self-hosted version's release branch is made from main as a plain copy:
// its markers stay as they are, and every build of the version filters them.
// Then, on main, every `selfHostedFrom` marker the new version covers is
// removed (the bot's change, as a commit on its own branch for a pull
// request), so live markers stay limited to features in flight. The branch
// cut report lists what ships in the version, what is held for a later one,
// what is still `next`, and every marker change made on main.
//
// The commit is made with a temporary index (git plumbing), so the writer's
// checkout and working tree are never touched.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import semver from 'semver';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkComment from '@slorber/remark-comment';
import { visit } from 'unist-util-visit';
import { describeMarker, isExactVersion, validateMarker, versionSemver } from './edition.mjs';
import { modelOf } from './compose.mjs';
import { parseBranch, releaseBranchFor } from './content-repo.mjs';

const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx).use(remarkGfm).use(remarkDirective).use(remarkComment);
const DOC_EXT = /\.mdx?$/;

// --- Markers in one file --------------------------------------------------------

const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;

// Docusaurus reads `{#id}` heading ids and ```mdx-code-block fences before
// MDX does (@docusaurus/utils escapeMarkdownHeadingIds, unwrapMdxCodeBlocks).
// The same here, keeping every offset, so changes land on the source.
const blank = (s) => s.replace(/[^\r\n]/g, ' ');
function forParsing(text) {
  const fence = /(^|\r?\n)(\x20*(`{3,4})\x20*mdx-code-block)(\r?\n.*?\r?\n)(\x20*\3)(?=\r?\n|$)/gs;
  return text
    .replace(/(^|\n)#{1,6}(?!#).*/g, (line) => line.replace(/(?<!\\)\{#([^}]*)\}/, (m) => blank(m)))
    .replace(fence, (m, begin, open, ticks, children, close) => `${begin}${blank(open)}${children}${blank(close)}`);
}

// The end of an opening tag (just past its '>'), skipping quoted values.
function openingTagEnd(text, start) {
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i + 1;
  }
  throw new Error('unterminated <Edition> tag');
}

const tagFor = (marker) => `<Edition${marker.only ? ` only="${marker.only}"` : ''}${marker.selfHostedFrom ? ` selfHostedFrom="${marker.selfHostedFrom}"` : ''}>`;

// Every Edition marker in a page or partial: <Edition> elements (block or
// inline) and the page-level front matter `editions:` / `selfHostedFrom:`.
// Each comes with the source ranges a change to it would rewrite.
export function findMarkers(text, file = 'page') {
  const out = [];
  let tree;
  try {
    tree = parser.parse(forParsing(text));
  } catch (err) {
    throw new Error(`${file}${err.place?.line ? `:${err.place.line}` : ''}: ${err.reason ?? err.message}`);
  }
  visit(tree, (node) => {
    if (node.type === 'yaml') {
      const fm = yaml.load(node.value, { schema: yaml.CORE_SCHEMA }) ?? {};
      if (fm.selfHostedFrom === undefined && fm.editions === undefined) return;
      const marker = {};
      if (fm.editions !== undefined) {
        const list = Array.isArray(fm.editions) ? fm.editions : [fm.editions];
        if (list.length === 1) marker.only = String(list[0]);
      }
      if (fm.selfHostedFrom !== undefined) marker.selfHostedFrom = String(fm.selfHostedFrom);
      if (!Object.keys(marker).length) return;
      validateMarker(marker, `${file}: front matter`);
      const start = node.position.start.offset;
      const m = /^selfHostedFrom[ \t]*:.*(?:\r?\n|$)/m.exec(text.slice(start, node.position.end.offset));
      out.push({
        kind: 'page', file, line: m ? lineAt(text, start + m.index) : node.position.start.line, marker,
        ...(m ? { fmLine: { start: start + m.index, end: start + m.index + m[0].length, text: m[0].trim() } } : {}),
      });
      return;
    }
    if ((node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') || node.name !== 'Edition') return;
    const where = `${file}:${node.position.start.line}`;
    const marker = {};
    for (const a of node.attributes ?? []) {
      if (a.type !== 'mdxJsxAttribute' || (a.value !== null && typeof a.value !== 'string')) throw new Error(`${where}: <Edition> attributes must be plain strings`);
      if (a.name !== 'only' && a.name !== 'selfHostedFrom') throw new Error(`${where}: unknown <Edition> attribute "${a.name}"`);
      marker[a.name] = a.value;
    }
    validateMarker(marker, where);
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    const openEnd = openingTagEnd(text, start);
    const selfClosing = openEnd === end && /\/\s*>$/.test(text.slice(start, openEnd));
    const close = selfClosing ? null : /<\/\s*Edition\s*>$/.exec(text.slice(openEnd, end));
    if (!selfClosing && !close) throw new Error(`${where}: cannot find the </Edition> that closes this marker`);
    out.push({
      kind: node.type === 'mdxJsxFlowElement' ? 'block' : 'inline', file, line: node.position.start.line, marker,
      open: { start, end: openEnd, text: text.slice(start, openEnd) },
      close: selfClosing ? null : { start: openEnd + close.index, end },
    });
  });
  return out;
}

// --- What a version covers ---------------------------------------------------------

// Where a marker's content goes in version `version`, cut from main:
//   ships  - `selfHostedFrom` <= version: in the version (and in Cloud)
//   held   - `selfHostedFrom` newer than the version: in a later version
//   next   - `selfHostedFrom: next`: no release yet, so not in this version
//   null   - not a version marker (Cloud only, Self-hosted only)
export function versionStatus(marker, version) {
  const from = marker.selfHostedFrom;
  if (from === undefined || from === null || from === '') return null;
  if (from === 'next') return 'next';
  return semver.lte(versionSemver(from), versionSemver(version)) ? 'ships' : 'held';
}

// A whole line holding only [start, end) (plus indentation): that line and
// one blank line beside it (after an opening tag, before a closing one), so
// the content keeps the blank lines it had around the marker.
function lineRange(text, start, end, side) {
  const ls = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', end);
  const le = nl === -1 ? text.length : nl + 1;
  if (text.slice(ls, start).trim() !== '' || text.slice(end, le).trim() !== '') return { start, end };
  if (!side) return { start: ls, end: le };
  if (side === 'after') {
    const next = text.indexOf('\n', le);
    if (next !== -1 && text.slice(le, next).trim() === '') return { start: ls, end: next + 1 };
    return { start: ls, end: le };
  }
  if (ls > 0) {
    const ps = text.lastIndexOf('\n', ls - 2) + 1;
    if (text.slice(ps, ls - 1).trim() === '') return { start: ps, end: le };
  }
  return { start: ls, end: le };
}

// main after the cut of `version`: every marker the version covers comes
// off. `<Edition selfHostedFrom="X">` (X <= version) is unwrapped into plain
// shared content; with only="self-hosted" it keeps only that; a page's
// `selfHostedFrom: X` front matter line goes (its `editions:` stays). Every
// later version is cut from main too, so it is newer than X: the marker no
// longer limits anything. `next` and newer versions stay.
export function removeCoveredMarkers(text, version, file = 'page') {
  const edits = [];
  const changes = [];
  for (const m of findMarkers(text, file)) {
    if (versionStatus(m.marker, version) !== 'ships') continue;
    const was = describeMarker(m.marker);
    if (m.kind === 'page') {
      if (!m.fmLine) continue;
      edits.push({ start: m.fmLine.start, end: m.fmLine.end, text: '' });
      changes.push({ file, line: m.line, kind: m.kind, was: m.fmLine.text, now: m.marker.only ? `editions: ${m.marker.only} (kept)` : null, label: was });
      continue;
    }
    if (m.marker.only === 'self-hosted') {
      const tag = tagFor({ only: 'self-hosted' });
      edits.push({ start: m.open.start, end: m.open.end, text: m.close ? tag : tag.replace(/>$/, ' />') });
      changes.push({ file, line: m.line, kind: m.kind, was: m.open.text, now: tag, label: was });
      continue;
    }
    // An inline marker alone on its line (a block right after a line of
    // text reads as inline) goes with its line, but not the lines beside it.
    const side = (s) => (m.kind === 'inline' ? null : s);
    if (!m.close) edits.push({ start: m.open.start, end: m.open.end, text: '' });
    else {
      edits.push({ ...lineRange(text, m.open.start, m.open.end, side('after')), text: '' });
      edits.push({ ...lineRange(text, m.close.start, m.close.end, side('before')), text: '' });
    }
    changes.push({ file, line: m.line, kind: m.kind, was: m.open.text, now: null, label: was });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  let floor = Infinity;
  for (const e of edits) {
    if (e.end > floor) throw new Error(`${file}: overlapping marker changes`);
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  // A page whose front matter held only `selfHostedFrom` keeps an empty block.
  out = out.replace(/^---\r?\n---\r?\n(\r?\n)?/, '');
  if (changes.length) findMarkers(out, file); // still parses
  return { text: out, changes: changes.sort((a, b) => a.line - b.line) };
}

// --- The repo ------------------------------------------------------------------------

function gitIn(root, env = {}) {
  return (args, input) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, input, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const refExists = (git, ref) => {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

// The Doc space directories of a commit: [{ dir, docspace }], as docSpaceDirs reads a checkout.
function docSpaceDirsAt(git, ref) {
  const names = git(['ls-tree', '--name-only', ref]).split('\n').filter(Boolean);
  const out = [];
  for (const dir of names) {
    let text;
    try {
      text = git(['show', `${ref}:${dir}/docspace.yaml`]);
    } catch {
      continue;
    }
    out.push({ dir, docspace: yaml.load(text, { schema: yaml.CORE_SCHEMA }) ?? {} });
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}

// Every marker under <dir>/ at `ref` (pages and partials).
function markersAt(git, ref, dir) {
  let files;
  try {
    files = git(['grep', '-l', '-E', 'selfHostedFrom|<Edition', ref, '--', `${dir}/`]).split('\n').filter(Boolean).map((l) => l.slice(ref.length + 1));
  } catch {
    files = []; // git grep exits 1 when nothing matches
  }
  const out = [];
  for (const file of files.filter((f) => DOC_EXT.test(f))) {
    const text = git(['show', `${ref}:${file}`]);
    out.push({ file, text, markers: findMarkers(text, file) });
  }
  return out;
}

// The version branch this repo's builds and "Release docs" read for the
// Edition (lib/content-repo.mjs releaseBranchFor): <slug>/release/<version>
// in a repo with several Doc spaces or whose Doc space already names
// prefixed branches, else release/<version>.
export function planBranchCut({ dirs, space, version }) {
  if (!isExactVersion(version)) throw new Error(`version must be exact, such as 7.3.0 (or a date version such as 2026.09.24), not "${version}"`);
  const d = space ? dirs.find((x) => x.dir === space || x.docspace.slug === space) : dirs.length === 1 ? dirs[0] : null;
  if (!d) throw new Error(space ? `No Doc space directory "${space}" with a docspace.yaml on main` : 'Name the Doc space: this repo holds several');
  const slug = d.docspace.slug ?? d.dir;
  const editions = (d.docspace.editions ?? []).filter((e) => e && e.status !== 'legacy');
  const model = d.docspace.model ?? modelOf(editions);
  if (model === 'unversioned') throw new Error(`${slug} is unversioned: it has no Self-hosted versions to cut`);
  // The newest release is the first Self-hosted Edition in manifest order (never sorted).
  const newest = editions.find((e) => e.id !== 'cloud' && e.id !== version && isExactVersion(e.id));
  if (newest && semver.gte(versionSemver(newest.id), versionSemver(version))) {
    throw new Error(`${slug}'s newest release is ${newest.id}, which is not older than ${version}: a Branch cut makes a new version from main`);
  }
  return { dir: d.dir, slug, displayName: d.docspace.displayName ?? slug, branch: releaseBranchFor(dirs, slug, version), cleanup: `branch-cut/${slug}/${version}` };
}

// Write `files` ({ path: text }) on top of `base` as one commit, without a
// checkout: a temporary index, blobs, a tree and commit-tree.
function commitFiles(git, root, { base, files, message }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-branch-cut-'));
  try {
    const index = path.join(tmp, 'index');
    const g = gitIn(root, { GIT_INDEX_FILE: index });
    g(['read-tree', base]);
    for (const [file, text] of Object.entries(files)) {
      const mode = git(['ls-tree', base, '--', file]).split(/\s/)[0] || '100644';
      const blob = g(['hash-object', '-w', '--stdin'], text).trim();
      g(['update-index', '--cacheinfo', `${mode},${blob},${file}`]);
    }
    const tree = g(['write-tree']).trim();
    return g(['commit-tree', tree, '-p', base, '-F', '-'], message).trim();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// options: { root, space, version, from = 'main', branch (an existing
// release branch: the bot's run, after the branch was made elsewhere),
// dryRun }. Returns the report data; see formatReport.
export function branchCut({ root, space, version, from = 'main', branch: existing = null, dryRun = false }) {
  const git = gitIn(root);
  if (!refExists(git, from)) throw new Error(`No ${from} in ${root}`);
  const mainSha = git(['rev-parse', `${from}^{commit}`]).trim();
  const dirs = docSpaceDirsAt(git, mainSha);
  if (existing) {
    const b = parseBranch(existing);
    if (!b || b.main) throw new Error(`${existing} is not a release branch (<doc space>/release/<version> or release/<version>)`);
    space ??= b.space;
    version ??= b.version;
  }
  const plan = planBranchCut({ dirs, space, version });
  if (existing && existing.replace(/^(refs\/heads\/|origin\/)/, '') !== plan.branch) {
    throw new Error(`${existing} is not the branch ${plan.slug} ${version} builds from (${plan.branch})`);
  }
  const found = [...(existing ? [existing] : []), `refs/heads/${plan.branch}`, `refs/remotes/origin/${plan.branch}`].find((ref) => refExists(git, ref));
  if (existing && !found) throw new Error(`No branch ${existing} to report on`);
  if (!existing && found) throw new Error(`${plan.branch} already exists. To clean up ${from} after a Branch cut made elsewhere, pass --branch ${plan.branch}`);
  for (const ref of [`refs/heads/${plan.cleanup}`, `refs/remotes/origin/${plan.cleanup}`]) {
    if (refExists(git, ref)) throw new Error(`${plan.cleanup} already exists: this Branch cut's change to ${from} was made before`);
  }

  if (!existing && !dryRun) git(['branch', plan.branch, mainSha]);
  const branchSha = found ? git(['rev-parse', `${found}^{commit}`]).trim() : mainSha;

  // What the version ships: the branch's own markers, as its builds filter them.
  const onBranch = markersAt(git, branchSha, plan.dir).flatMap((f) => f.markers);
  const status = { ships: [], held: [], next: [] };
  let others = 0;
  for (const m of onBranch) {
    const s = versionStatus(m.marker, version);
    if (s) status[s].push({ file: m.file, line: m.line, kind: m.kind, label: describeMarker(m.marker) });
    else others++;
  }

  // main: the markers the version covers come off.
  const files = {};
  const changes = [];
  for (const f of markersAt(git, mainSha, plan.dir)) {
    const r = removeCoveredMarkers(f.text, version, f.file);
    if (!r.changes.length) continue;
    files[f.file] = r.text;
    changes.push(...r.changes);
  }
  let commit = null;
  if (changes.length && !dryRun) {
    const message = [
      `Remove the Edition markers ${version} covers from ${plan.slug}`,
      '',
      `After the Branch cut of ${plan.branch}: content marked "Self-hosted from" ${version} or an older version`,
      'is now in Cloud and in every version cut from main, so its marker no longer limits anything.',
      '',
      ...changes.map((c) => `- ${c.file}:${c.line}: ${c.label}${c.now ? ` -> ${c.now}` : ' (removed)'}`),
      '',
    ].join('\n');
    commit = commitFiles(git, root, { base: mainSha, files, message });
    git(['branch', plan.cleanup, commit]);
  }
  return {
    slug: plan.slug, displayName: plan.displayName, dir: plan.dir, version, from, dryRun,
    branch: { name: plan.branch, sha: branchSha, created: !existing && !dryRun },
    main: { sha: mainSha, branch: changes.length && !dryRun ? plan.cleanup : null, commit, changes },
    ships: status.ships, held: status.held, next: status.next, otherMarkers: others,
  };
}

// --- The branch cut report ----------------------------------------------------------

const where = (x) => `\`${x.file}\` line ${x.line}`;
const rows = (list, cols) => list.map((x) => `| ${cols(x).join(' | ')} |`).join('\n');

export function formatReport(r) {
  const v = r.version;
  const short = (sha) => sha.slice(0, 8);
  const out = [`# Branch cut report: ${r.displayName} ${v}`, ''];
  if (r.dryRun) out.push(`Dry run: nothing was created. This is what a Branch cut of ${v} from \`${r.from}\` (${short(r.main.sha)}) would do.`, '');
  else if (r.branch.created) out.push(`\`${r.branch.name}\` was cut from \`${r.from}\` at ${short(r.main.sha)}.`, '');
  else out.push(`\`${r.branch.name}\` is at ${short(r.branch.sha)}; \`${r.from}\` is at ${short(r.main.sha)}.`, '');
  out.push(`The branch is a plain copy of \`${r.from}\`: its Edition markers stay as they are, and every build of ${v} filters them.`, '');

  out.push(`## Still \`next\` (${r.next.length})`, '');
  if (r.next.length) {
    out.push(`This content is not in ${v}. It stays out of the version, which is safe; decide on each one.`, '',
      `- To ship it in ${v}: on \`${r.branch.name}\`, change \`next\` to \`${v}\`; on \`${r.from}\`, remove the marker.`,
      `- To hold it for a later version: leave it as \`next\`.`, '',
      '| Where | Marker |', '|---|---|', rows(r.next, (x) => [where(x), x.kind === 'page' ? 'This page: Self-hosted from next' : x.label]), '');
  } else out.push('No content is marked `next`.', '');

  out.push(`## Ships in ${v} (${r.ships.length})`, '');
  if (r.ships.length) out.push(`Marked for ${v} or an older version, so ${v} shows it.`, '', '| Where | Marker |', '|---|---|', rows(r.ships, (x) => [where(x), x.label]), '');
  else out.push(`No content is marked "Self-hosted from" ${v} or an older version.`, '');

  out.push(`## Held for a later version (${r.held.length})`, '');
  if (r.held.length) out.push(`Marked for a version newer than ${v}, so ${v} leaves it out.`, '', '| Where | Marker |', '|---|---|', rows(r.held, (x) => [where(x), x.label]), '');
  else out.push(`No content is marked for a version newer than ${v}.`, '');

  out.push(`## Marker changes on \`${r.from}\` (${r.main.changes.length})`, '');
  if (r.main.changes.length) {
    const intro = r.main.commit
      ? `Commit ${short(r.main.commit)} on \`${r.main.branch}\` removes the markers ${v} covers. Open a pull request from it to \`${r.from}\`.`
      : `The Branch cut removes the markers ${v} covers.`;
    out.push(intro, '', '| Where | Was | Now |', '|---|---|---|',
      rows(r.main.changes, (c) => [where(c), `\`${c.was}\``, c.now ? `\`${c.now}\`` : 'removed: plain shared content']), '');
  } else out.push(`No marker on \`${r.from}\` is covered by ${v}; nothing to change.`, '');

  out.push(`${r.otherMarkers} "Cloud only" and "Self-hosted only" markers are unchanged.`, '');
  return `${out.join('\n').trim()}\n`;
}
