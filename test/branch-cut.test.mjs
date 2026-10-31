// The Branch cut (lib/branch-cut.mjs, `wso2-docs branch-cut`): the version's
// branch is a plain copy of main, the markers it covers come off main as a
// commit on its own branch, and the branch cut report lists `next` content
// and every marker change. Runs against throwaway git repos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMarkers, formatReport, planBranchCut, removeCoveredMarkers, versionStatus } from '../lib/branch-cut.mjs';
import { editionFromId, matches } from '../lib/edition.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'wso2-docs.mjs');

const PAGE = `---
title: Sign in
selfHostedFrom: 1.1.0
---

Intro.

<Edition selfHostedFrom="1.0.0">

Shipped in 1.0.0.

</Edition>

Pick <Edition selfHostedFrom="1.1.0">passkeys</Edition><Edition only="cloud">a social login</Edition>.

<Edition only="self-hosted" selfHostedFrom="1.1.0">
Self-hosted from 1.1.0.
</Edition>

<Edition selfHostedFrom="1.2.0">

Later.

</Edition>

<Edition selfHostedFrom="next">

Coming.

</Edition>

\`\`\`mdx
<Edition selfHostedFrom="1.0.0">an example, not a marker</Edition>
\`\`\`
`;

test('versionStatus: ships, held or next for the version being cut', () => {
  assert.equal(versionStatus({ selfHostedFrom: '1.0.0' }, '1.1.0'), 'ships');
  assert.equal(versionStatus({ selfHostedFrom: '1.1.0' }, '1.1.0'), 'ships');
  assert.equal(versionStatus({ selfHostedFrom: '1.2.0' }, '1.1.0'), 'held');
  assert.equal(versionStatus({ selfHostedFrom: 'next' }, '1.1.0'), 'next');
  assert.equal(versionStatus({ only: 'cloud' }, '1.1.0'), null);
  assert.equal(versionStatus({ only: 'self-hosted' }, '1.1.0'), null);
  // Date versions compare as dates, after numbered releases.
  assert.equal(versionStatus({ selfHostedFrom: '2026.09.24' }, '2026.10.01'), 'ships');
  assert.equal(versionStatus({ selfHostedFrom: '2026.10.02' }, '2026.10.01'), 'held');
});

test('findMarkers: elements, inline elements and page front matter; never code', () => {
  const m = findMarkers(PAGE, 'p.mdx');
  assert.deepEqual(m.map((x) => [x.kind, x.line, x.marker]), [
    ['page', 3, { selfHostedFrom: '1.1.0' }],
    ['block', 8, { selfHostedFrom: '1.0.0' }],
    ['inline', 14, { selfHostedFrom: '1.1.0' }],
    ['inline', 14, { only: 'cloud' }],
    ['block', 16, { only: 'self-hosted', selfHostedFrom: '1.1.0' }],
    ['block', 20, { selfHostedFrom: '1.2.0' }],
    ['block', 26, { selfHostedFrom: 'next' }],
  ]);
  assert.throws(() => findMarkers('<Edition selfHostedFrom="v1">x</Edition>\n', 'bad.mdx'), /bad\.mdx:1: selfHostedFrom="v1"/);
});

test('removeCoveredMarkers: the markers the version covers come off main; the rest stay', () => {
  const r = removeCoveredMarkers(PAGE, '1.1.0', 'p.mdx');
  assert.equal(r.text, `---
title: Sign in
---

Intro.

Shipped in 1.0.0.

Pick passkeys<Edition only="cloud">a social login</Edition>.

<Edition only="self-hosted">
Self-hosted from 1.1.0.
</Edition>

<Edition selfHostedFrom="1.2.0">

Later.

</Edition>

<Edition selfHostedFrom="next">

Coming.

</Edition>

\`\`\`mdx
<Edition selfHostedFrom="1.0.0">an example, not a marker</Edition>
\`\`\`
`);
  assert.deepEqual(r.changes.map((c) => [c.line, c.was, c.now]), [
    [3, 'selfHostedFrom: 1.1.0', null],
    [8, '<Edition selfHostedFrom="1.0.0">', null],
    [14, '<Edition selfHostedFrom="1.1.0">', null],
    [16, '<Edition only="self-hosted" selfHostedFrom="1.1.0">', '<Edition only="self-hosted">'],
  ]);
  // Every Edition main still builds (Cloud, and any version after 1.1.0) reads the same.
  const shown = (text, id) => findMarkers(text).filter((x) => x.kind !== 'page' && !matches(editionFromId(id), x.marker)).length;
  for (const id of ['cloud', '1.2.0', '1.3.0']) assert.equal(shown(r.text, id), shown(PAGE, id), id);
  // Nothing is covered: the file is unchanged.
  assert.deepEqual(removeCoveredMarkers(PAGE, '0.9.0'), { text: PAGE, changes: [] });
});

test('removeCoveredMarkers: nested and indented blocks, a front matter block left empty, editions: kept', () => {
  const nested = 'A\n\n1. Step\n\n   <Edition selfHostedFrom="1.0.0">\n\n   Indented.\n\n   <Edition selfHostedFrom="0.9.0">\n\n   Inner.\n\n   </Edition>\n\n   </Edition>\n\nB\n';
  assert.equal(removeCoveredMarkers(nested, '1.0.0').text, 'A\n\n1. Step\n\n   Indented.\n\n   Inner.\n\nB\n');
  assert.equal(removeCoveredMarkers('---\nselfHostedFrom: "1.0.0"\n---\n\n# Hi\n', '1.0.0').text, '# Hi\n');
  const both = removeCoveredMarkers('---\ntitle: T\neditions: self-hosted\nselfHostedFrom: 1.0.0\n---\n\nBody.\n', '1.1.0');
  assert.equal(both.text, '---\ntitle: T\neditions: self-hosted\n---\n\nBody.\n');
  assert.equal(both.changes[0].now, 'editions: self-hosted (kept)');
});

test('removeCoveredMarkers reads pages as Docusaurus does: heading ids, mdx-code-block, legacy admonition titles', () => {
  const page = '## Set it up {#set-it-up}\n\n```mdx-code-block\n<Edition selfHostedFrom="1.0.0">\n\nIn a code block wrapper.\n\n</Edition>\n```\n\n:::note A title\n<Edition selfHostedFrom="1.0.0">\nIn a note.\n</Edition>\n:::\n';
  assert.equal(removeCoveredMarkers(page, '1.0.0').text, '## Set it up {#set-it-up}\n\n```mdx-code-block\nIn a code block wrapper.\n```\n\n:::note A title\nIn a note.\n:::\n');
  assert.throws(() => removeCoveredMarkers('Text {oops\n', '1.0.0', 'bad.mdx'), /^Error: bad\.mdx:1: /);
});

const dirsOf =(...spaces) => spaces.map(([dir, editions, extra = {}]) => ({ dir, docspace: { slug: dir, editions: editions.map((id) => (typeof id === 'string' ? { id } : id)), ...extra } }));

test('planBranchCut: the branch the Edition builds from, and what it refuses', () => {
  // Several Doc spaces: prefixed.
  const shared = dirsOf(['api-manager', ['4.5.0']], ['ai-gateway', ['cloud', '1.1.0']]);
  assert.equal(planBranchCut({ dirs: shared, space: 'ai-gateway', version: '1.2.0' }).branch, 'ai-gateway/release/1.2.0');
  assert.equal(planBranchCut({ dirs: shared, space: 'ai-gateway', version: '1.2.0' }).cleanup, 'branch-cut/ai-gateway/1.2.0');
  // One Doc space: its own convention (release/<version>, or prefixed where it names prefixed branches).
  assert.equal(planBranchCut({ dirs: dirsOf(['sandbox', ['cloud', '1.0.0']]), version: '1.1.0' }).branch, 'release/1.1.0');
  assert.equal(planBranchCut({ dirs: dirsOf(['sandbox', ['cloud', { id: '1.0.0', branch: 'sandbox/release/1.0.0' }]]), version: '1.1.0' }).branch, 'sandbox/release/1.1.0');
  // A Cloud-only Doc space may cut its first version; date versions are exact.
  assert.equal(planBranchCut({ dirs: dirsOf(['x', ['cloud']]), version: '2026.09.24' }).branch, 'release/2026.09.24');
  assert.throws(() => planBranchCut({ dirs: shared, space: 'ai-gateway', version: '1.2' }), /version must be exact/);
  assert.throws(() => planBranchCut({ dirs: shared, space: 'ai-gateway', version: '1.0.0' }), /newest release is 1\.1\.0, which is not older than 1\.0\.0/);
  // Manifest order, not a sort: AI Gateway's newest release is 1.2.0, though a date version follows it.
  assert.equal(planBranchCut({ dirs: dirsOf(['ai-gateway', ['1.2.0', '2026.09.24', '1.1.0']]), version: '1.3.0' }).branch, 'release/1.3.0');
  assert.throws(() => planBranchCut({ dirs: shared, version: '1.2.0' }), /Name the Doc space/);
  assert.throws(() => planBranchCut({ dirs: shared, space: 'nope', version: '1.2.0' }), /No Doc space directory "nope"/);
  assert.throws(() => planBranchCut({ dirs: dirsOf(['contribute', []]), version: '1.0.0' }), /unversioned/);
});

// A throwaway Content repo with two Doc spaces.
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-branch-cut-test-'));
  const write = (f, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  };
  write('README.md', '# Docs\n');
  write('ai-gateway/docspace.yaml', 'schemaVersion: 1\nslug: ai-gateway\ndisplayName: AI Gateway\nrepo: wso2/docs-test\neditions:\n  - id: cloud\n  - id: 1.0.0\n');
  write('ai-gateway/docs/guides/sign-in.mdx', PAGE);
  write('ai-gateway/docs/guides/plain.mdx', '---\ntitle: Plain\n---\n\nNo markers.\n');
  write('ai-gateway/docs/guides/new.mdx', '---\ntitle: New\nselfHostedFrom: next\n---\n\nComing.\n');
  write('ai-gateway/partials/note.mdx', '<Edition selfHostedFrom="1.1.0">\nIn a partial.\n</Edition>\n');
  write('api-manager/docspace.yaml', 'schemaVersion: 1\nslug: api-manager\ndisplayName: API Manager\nrepo: wso2/docs-test\neditions:\n  - id: 4.5.0\n');
  write('api-manager/docs/index.mdx', '<Edition selfHostedFrom="1.0.0">\nOther Doc space.\n</Edition>\n');
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'Start');
  return { dir, git, env };
}

const run = (repo, ...args) => spawnSync(process.execPath, [cli, 'branch-cut', ...args, '--repo', repo.dir], { encoding: 'utf8', env: repo.env });

test('wso2-docs branch-cut: the branch, the commit on main for a pull request, the report; the checkout untouched', () => {
  const repo = makeRepo();
  const main = repo.git('rev-parse', 'main');
  fs.writeFileSync(path.join(repo.dir, 'scratch.txt'), 'uncommitted work\n');
  const reportFile = path.join(repo.dir, '..', `${path.basename(repo.dir)}-report.md`);
  const r = run(repo, 'ai-gateway', '1.1.0', '--report', reportFile);
  assert.equal(r.status, 0, r.stderr);

  // The release branch: a plain copy of main, markers and all.
  assert.equal(repo.git('rev-parse', 'ai-gateway/release/1.1.0'), main);
  // main itself and the checkout are as they were.
  assert.equal(repo.git('rev-parse', 'main'), main);
  assert.equal(repo.git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(repo.git('status', '--porcelain'), '?? scratch.txt');
  assert.equal(fs.readFileSync(path.join(repo.dir, 'ai-gateway/docs/guides/sign-in.mdx'), 'utf8'), PAGE);

  // The bot's change: one commit on branch-cut/ai-gateway/1.1.0, from main,
  // touching only the files whose markers 1.1.0 covers in this Doc space.
  const cleanup = 'branch-cut/ai-gateway/1.1.0';
  assert.equal(repo.git('rev-parse', `${cleanup}^`), main);
  assert.deepEqual(repo.git('diff', '--name-only', main, cleanup).split('\n'), ['ai-gateway/docs/guides/sign-in.mdx', 'ai-gateway/partials/note.mdx']);
  assert.equal(repo.git('show', `${cleanup}:ai-gateway/docs/guides/sign-in.mdx`), removeCoveredMarkers(PAGE, '1.1.0').text.trim());
  assert.equal(repo.git('show', `${cleanup}:ai-gateway/partials/note.mdx`), 'In a partial.');
  assert.match(repo.git('log', '-1', '--format=%B', cleanup), /^Remove the Edition markers 1\.1\.0 covers from ai-gateway/);

  // The report: next content first, then what ships, what is held and every change on main.
  const report = fs.readFileSync(reportFile, 'utf8');
  assert.equal(report.trim(), r.stdout.trim());
  assert.match(report, /^# Branch cut report: AI Gateway 1\.1\.0/);
  assert.match(report, /`ai-gateway\/release\/1\.1\.0` was cut from `main`/);
  assert.match(report, /## Still `next` \(2\)[\s\S]*`ai-gateway\/docs\/guides\/new\.mdx` line 3 \| This page: Self-hosted from next/);
  assert.match(report, /## Ships in 1\.1\.0 \(5\)/);
  assert.match(report, /## Held for a later version \(1\)[\s\S]*sign-in\.mdx` line 20 \| Self-hosted from 1\.2\.0/);
  assert.match(report, /## Marker changes on `main` \(5\)[\s\S]*on `branch-cut\/ai-gateway\/1\.1\.0`/);
  assert.match(report, /`<Edition only="self-hosted" selfHostedFrom="1\.1\.0">` \| `<Edition only="self-hosted">`/);
  assert.doesNotMatch(report, /api-manager/, 'another Doc space is not touched');
  assert.match(r.stderr, /warning: ai-gateway\/docs\/guides\/new\.mdx:3 is still marked "next"/);
  assert.match(r.stderr, /git push -u origin ai-gateway\/release\/1\.1\.0/);

  // Run again: refused, nothing changed.
  const again = run(repo, 'ai-gateway', '1.1.0');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /ai-gateway\/release\/1\.1\.0 already exists/);
});

test('wso2-docs branch-cut --branch (the bot, after a cut made elsewhere) and --dry-run', () => {
  const repo = makeRepo();
  const dry = run(repo, 'ai-gateway', '1.1.0', '--dry-run', '--format', 'json');
  assert.equal(dry.status, 0, dry.stderr);
  const data = JSON.parse(dry.stdout);
  assert.equal(data.main.changes.length, 5);
  assert.equal(data.main.commit, null);
  assert.equal(repo.git('branch', '--list').split('\n').length, 1, 'a dry run makes no branch');
  assert.match(formatReport(data), /Dry run: nothing was created/);

  // Made in GitHub's UI, then main moved on: the report reads the branch,
  // the commit starts from main as it is now.
  repo.git('branch', 'ai-gateway/release/1.1.0', 'main');
  fs.writeFileSync(path.join(repo.dir, 'ai-gateway/docs/guides/later.mdx'), '<Edition selfHostedFrom="1.0.0">\nAdded after the cut.\n</Edition>\n');
  repo.git('add', '.');
  repo.git('commit', '-q', '-m', 'Later');
  const r = run(repo, '--branch', 'ai-gateway/release/1.1.0');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## Ships in 1\.1\.0 \(5\)/);
  assert.match(r.stdout, /## Marker changes on `main` \(6\)/);
  assert.equal(repo.git('rev-parse', 'branch-cut/ai-gateway/1.1.0^'), repo.git('rev-parse', 'main'));
  assert.equal(repo.git('show', 'branch-cut/ai-gateway/1.1.0:ai-gateway/docs/guides/later.mdx'), 'Added after the cut.');

  // The cleanup branch exists (pushed by the person who cut, before the
  // release branch): the bot's dry run still plans, so the workflow can read
  // the cleanup branch's name and find it; a real run is refused.
  const plan = run(repo, '--branch', 'ai-gateway/release/1.1.0', '--dry-run', '--format', 'json');
  assert.equal(plan.status, 0, plan.stderr);
  assert.deepEqual([JSON.parse(plan.stdout).slug, JSON.parse(plan.stdout).version], ['ai-gateway', '1.1.0']);
  const twice = run(repo, '--branch', 'ai-gateway/release/1.1.0');
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /branch-cut\/ai-gateway\/1\.1\.0 already exists/);

  const wrong = run(repo, '--branch', 'feature/x');
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /feature\/x is not a release branch/);
});
