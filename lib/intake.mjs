// Intake (Releases and deployments, Intake): the Platform polls the releases
// of the Content repos the composed manifest lists, keeps the ones that
// count, verifies each bundle once before any content code runs, and records
// it in releases/<slug>.yaml, the intake record. A merged record change
// starts the release (release.yml); a recorded release deleted on GitHub is a
// withdrawal, which leaves the record. .github/workflows/intake.yml runs it
// (`wso2-release intake`); GitHub's REST API is reached with an injected
// fetch and `gh attestation verify` through an injected exec, so the tests
// use fixtures.
//
// A release counts when its tag matches the Doc space's prefix and grammar;
// it is published (not a draft), not a prerelease, and immutable; it has
// exactly one asset, named <slug>-<tag without its prefix>.docs.zip; it is
// newer than the Edition's newest recorded release; and the composed manifest
// lets that tag release (planRelease: its Edition listed, not legacy, not
// pinned elsewhere, not a Cloud part's own Cloud). Older or equal ones are
// ignored. Of several new ones for one Edition, only the newest is taken.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { UNVERSIONED } from './edition.mjs';
import { docSpaceDir } from './manifest.mjs';
import { editionFromTag, parseTag, planRelease, releaseIdFor } from './release.mjs';
import { validate } from './schemas.mjs';
import { UNPACK_LIMITS, unpackZip } from './zip.mjs';
import { loadContentRepo } from './content.mjs';
import { loadContext } from './check/content.mjs';
import { checkContentSafety } from './check/safety.mjs';

export const RECORD_DIR = 'releases';
export const KEEP_ENTRIES = 5;
// The reusable workflow whose attestations intake accepts, at the moving
// major tag the Content repos call it at.
export const SIGNER_PATH = '.github/workflows/docs-bundle.yml';
export const SIGNER_REF = 'refs/tags/v1';
export const ISSUE_LABEL = 'bundle-intake';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const lower = (s) => String(s ?? '').toLowerCase();

export const bundleAssetName = (slug, tag) => `${slug}-${releaseIdFor(tag)}.docs.zip`;

// Two Docs release tags of one Edition: -1, 0 or 1. Cloud tags by date, then
// their number; version tags by version, then their docs number.
export function compareTags(a, b) {
  const key = (tag) => {
    const t = parseTag(tag);
    const n = Number(/(\d+)$/.exec(t.release)[1]);
    const version = t.cloud ? /cloud-(\d{4}\.\d{2}\.\d{2})\./.exec(t.release)[1] : t.version;
    return [...version.split('.').map(Number), n];
  };
  const x = key(a);
  const y = key(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// --- The intake record ------------------------------------------------------

export const recordFile = (dir, slug) => path.join(dir, `${slug}.yaml`);
export const emptyRecord = (docSpace, repo) => ({ schemaVersion: 1, docSpace, repo, editions: {} });

export function readRecord(file) {
  if (!fs.existsSync(file)) return null;
  const data = yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.CORE_SCHEMA }) ?? {};
  const editions = {};
  for (const [id, list] of Object.entries(data.editions ?? {})) editions[String(id)] = list;
  return { ...data, editions };
}

export const validateRecord = (record) => validate('intake-record', record);

export const newestEntry = (record, edition) => record?.editions?.[edition]?.[0] ?? null;

// Editions in a fixed order (Cloud and next first, then versions newest
// first), so a record only changes where an entry does.
function sortEditions(editions) {
  const rank = (id) => (id === 'cloud' ? 0 : id === 'next' ? 1 : 2);
  const ids = Object.keys(editions).sort((a, b) => rank(a) - rank(b) || compareVersions(b, a));
  return Object.fromEntries(ids.map((id) => [id, editions[id]]));
}
function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return a.localeCompare(b);
}

export function addEntry(record, edition, entry, keep = KEEP_ENTRIES) {
  const list = [entry, ...(record.editions[edition] ?? []).filter((e) => e.tag !== entry.tag)].slice(0, keep);
  return { ...record, editions: sortEditions({ ...record.editions, [edition]: list }) };
}

export function removeEntry(record, tag) {
  const editions = {};
  for (const [id, list] of Object.entries(record.editions)) {
    const left = list.filter((e) => e.tag !== tag);
    if (left.length) editions[id] = left;
  }
  return { ...record, editions };
}

export function formatRecord(record) {
  const head = [
    `# The intake record of ${record.docSpace}: the Docs bundles intake accepted, per Edition, newest`,
    '# first, the last 5 kept (spec/releases-and-deployments.md, Intake). Written by intake.yml;',
    '# a change to anything but the release entries needs the Doc space\'s owners.',
  ];
  const body = yaml.dump({ schemaVersion: 1, docSpace: record.docSpace, repo: record.repo, editions: sortEditions(record.editions) }, { lineWidth: -1, noRefs: true, quotingType: '"' });
  return `${head.join('\n')}\n${body}`;
}

// --- GitHub ------------------------------------------------------------------

const headers = (token, accept = 'application/vnd.github+json') => ({
  Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'wso2-docs-intake', ...(token ? { Authorization: `Bearer ${token}` } : {}),
});
const nextLink = (link) => /<([^>]+)>;\s*rel="next"/.exec(link ?? '')?.[1] ?? null;

// Every release of a repo (drafts only show to a token that can push), all
// pages: a missing page would read as a withdrawal.
export async function listReleases(repo, { fetch = globalThis.fetch, token } = {}) {
  if (!REPO.test(String(repo))) throw new Error(`"${repo}" is not a repo (owner/name)`);
  const out = [];
  let url = `https://api.github.com/repos/${repo}/releases?per_page=100`;
  while (url) {
    const res = await fetch(url, { headers: headers(token) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} listing ${repo}'s releases`);
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error(`GitHub's list of ${repo}'s releases is not a list`);
    out.push(...page);
    url = nextLink(res.headers.get('link'));
  }
  return out;
}

// --- Which releases count ----------------------------------------------------

// The Doc spaces of a repo in the composed manifest: [[slug, space]].
const spacesOf = (policy, repo) => Object.entries(policy.docSpaces)
  .filter(([, s]) => s.status !== 'legacy' && lower(s.repo) === lower(repo));

// The Doc space a tag's prefix names in this repo, or its one unprefixed one.
function spaceOfTag(spaces, tag) {
  const { prefix } = parseTag(tag);
  if (prefix) return spaces.find(([slug, s]) => slug === prefix && (s.tagPrefix ?? '') === `${slug}/`) ?? null;
  const unprefixed = spaces.filter(([, s]) => !s.tagPrefix);
  return unprefixed.length === 1 ? unprefixed[0] : null;
}

export const editionOfTag = (space, tag) => (space.model === 'unversioned' ? UNVERSIONED : editionFromTag(tag, space.model));
export const failedKey = (slug, tag) => `${slug} ${tag}`;

// One repo's releases against the intake records ({ <slug>: record }):
//   candidates  [{ slug, edition, tag, release }]  to verify, newest per Edition
//   problems    [{ slug, tag, message }]           an issue each, no PR
//   withdrawals [{ slug, edition, tag, newest, back }] recorded, gone on GitHub;
//               `back` is the entry the Edition goes back to when it was the newest
// `failed` holds failedKey()s of tags an issue already reports: not tried again.
export function triage({ policy, repo, releases, records = {}, failed = new Set() }) {
  const spaces = spacesOf(policy, repo);
  const best = new Map();
  for (const release of releases) {
    if (release.draft) continue;
    const tag = release.tag_name;
    try {
      parseTag(tag);
    } catch {
      continue; // not a Docs release tag
    }
    const hit = spaceOfTag(spaces, tag);
    if (!hit) continue;
    const [slug, space] = hit;
    const edition = editionOfTag(space, tag);
    const newest = newestEntry(records[slug], edition);
    if (newest && compareTags(tag, newest.tag) <= 0) continue;
    const key = `${slug}\0${edition}`;
    if (!best.has(key) || compareTags(tag, best.get(key).tag) > 0) best.set(key, { slug, edition, tag, release });
  }
  const candidates = [];
  const problems = [];
  for (const c of best.values()) {
    if (failed.has(failedKey(c.slug, c.tag))) continue;
    const problem = releaseProblem(policy, repo, c);
    if (problem) problems.push({ slug: c.slug, tag: c.tag, message: problem });
    else candidates.push(c);
  }
  const published = new Set(releases.filter((r) => !r.draft).map((r) => r.tag_name));
  const withdrawals = [];
  for (const [slug] of spaces) {
    for (const [edition, list] of Object.entries(records[slug]?.editions ?? {})) {
      list.forEach((e, i) => {
        if (published.has(e.tag)) return;
        const back = i === 0 ? (list.slice(1).find((x) => published.has(x.tag))?.tag ?? null) : null;
        withdrawals.push({ slug, edition, tag: e.tag, newest: i === 0, back });
      });
    }
  }
  const byTag = (a, b) => a.slug.localeCompare(b.slug) || a.tag.localeCompare(b.tag);
  return { candidates: candidates.sort(byTag), problems: problems.sort(byTag), withdrawals };
}

// --- Verification ------------------------------------------------------------

// Downloads a release asset into `file` (created new), hashing as it goes;
// refuses more than `max` bytes. Returns the sha256.
export async function downloadAsset(asset, file, { fetch = globalThis.fetch, token, max = UNPACK_LIMITS.bytes } = {}) {
  const res = await fetch(asset.url, { headers: headers(token, 'application/octet-stream') });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${asset.name}`);
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'wx');
  let n = 0;
  try {
    for await (const chunk of res.body) {
      n += chunk.length;
      if (n > max) throw new Error(`${asset.name} is larger than ${max} bytes`);
      hash.update(chunk);
      fs.writeSync(fd, chunk);
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

// The attestation check: `gh attestation verify` with the signer's exact
// certificate identity (the reusable workflow at refs/tags/v1), no
// self-hosted runner, then the answer read again here: the source repo, and a
// source ref of main (a Cloud release, and a version "Release docs" made,
// which runs from main) or the tag itself (a tag pushed by hand).
export function verifyAttestation({ file, repo, tag, signerRepo, exec = execFileSync }) {
  const identity = `https://github.com/${signerRepo}/${SIGNER_PATH}@${SIGNER_REF}`;
  const args = ['attestation', 'verify', file, '--repo', repo, '--cert-identity', identity, '--deny-self-hosted-runners', '--format', 'json'];
  let out;
  try {
    out = exec('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    return `gh attestation verify refused it: ${String(err.stderr || err.message).trim().split('\n').slice(-3).join(' ')}`;
  }
  let results;
  try {
    results = JSON.parse(out);
  } catch {
    return 'gh attestation verify gave no JSON';
  }
  const refs = ['refs/heads/main', `refs/tags/${tag}`];
  const ok = (Array.isArray(results) ? results : []).some((r) => {
    const c = r?.verificationResult?.signature?.certificate ?? {};
    return c.subjectAlternativeName === identity && c.runnerEnvironment === 'github-hosted'
      && lower(c.sourceRepositoryURI) === lower(`https://github.com/${repo}`) && refs.includes(c.sourceRepositoryRef);
  });
  return ok ? null : `no attestation is signed by ${identity} on a GitHub-hosted runner for ${repo} at ${refs.join(' or ')}`;
}

// What the unpacked bundle's bundle.json and directories must say.
function checkUnpacked(dir, { policy, repo, slug, edition, tag }) {
  const problems = [];
  const file = path.join(dir, 'bundle.json');
  if (!fs.existsSync(file)) return ['The bundle has no bundle.json'];
  let b;
  try {
    b = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return ['bundle.json is not JSON'];
  }
  const expectedPath = docSpaceDir(policy.docSpaces[slug], slug);
  const differs = (what, got, want) => problems.push(`bundle.json names ${what} ${got ?? '(none)'}, not ${want}`);
  if (b.schema !== 1) differs('schema', b.schema, 1);
  if (lower(b.repo) !== lower(repo)) differs('repo', b.repo, repo);
  if (b.tag !== tag) differs('tag', b.tag, tag);
  if (b.edition !== edition) differs('Edition', b.edition, edition);
  if (b.docSpace !== slug) differs('Doc space', b.docSpace, slug);
  if ((b.path ?? '') !== expectedPath) differs('directory', b.path, expectedPath);
  if (!/^[0-9a-f]{40}$/.test(String(b.sourceCommit))) problems.push(`bundle.json's source commit ${b.sourceCommit} is not a commit id`);
  if (problems.length) return problems;
  // What a bundle may hold: bundle.json, its Doc space directory and, for a
  // family Cloud, its Cloud parts' directories beside it.
  const parts = Array.isArray(b.parts) ? b.parts : [];
  if (parts.length && edition !== 'cloud') problems.push('bundle.json lists Cloud parts, but only a Cloud bundle carries them');
  const dirs = [{ slug, dir: b.path || slug }, ...parts.map((p) => ({ slug: p.slug, dir: p.path || p.slug, part: true }))];
  for (const d of dirs) {
    if (!d.dir || !d.dir.split('/').every((s) => s && s !== '.' && s !== '..')) {
      problems.push(`bundle.json names an unsafe directory ${JSON.stringify(d.dir)}`);
      return problems;
    }
    const manifest = path.join(dir, ...d.dir.split('/'), 'docspace.yaml');
    if (!fs.existsSync(manifest)) {
      problems.push(`${d.dir}/docspace.yaml is missing from the bundle`);
      continue;
    }
    const ds = yaml.load(fs.readFileSync(manifest, 'utf8'), { schema: yaml.CORE_SCHEMA }) ?? {};
    if (ds.slug !== d.slug) problems.push(`${d.dir}/docspace.yaml has slug ${ds.slug}, not ${d.slug}`);
    if (d.part && ds.cloud?.in !== slug) problems.push(`Cloud part ${d.slug} does not name ${slug} with cloud.in`);
  }
  const allowed = dirs.map((d) => `${d.dir}/`);
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (fs.lstatSync(path.join(abs, name)).isDirectory()) walk(path.join(abs, name), r);
      else if (r !== 'bundle.json' && !allowed.some((a) => r.startsWith(a))) problems.push(`${r} is outside the bundle's Doc space directories (${allowed.join(', ')})`);
    }
  };
  walk(dir, '');
  return problems.length ? problems : { bundle: b, dirs };
}

// Verifies one candidate release ({ slug, edition, tag, release }) in a new
// folder under `workDir`, every step before any content code runs:
// downloaded into an empty folder; its sha256 equals GitHub's digest; its
// attestation; unpacked safely; bundle.json matches; content safety on the
// unpacked files (read only). Returns { problems, entry, dir }: the intake
// record entry when nothing failed, else null.
export async function verifyBundle({ policy, repo, candidate, workDir, fetch, token, exec, signerRepo, now = new Date() }) {
  const { slug, edition, tag, release } = candidate;
  const asset = release.assets[0];
  const dir = fs.mkdtempSync(path.join(workDir, `${slug}-`));
  const fail = (...problems) => ({ problems, entry: null, dir });
  const download = path.join(dir, 'download');
  fs.mkdirSync(download);
  const zip = path.join(download, path.basename(asset.name));
  let sha256;
  try {
    sha256 = await downloadAsset(asset, zip, { fetch, token });
  } catch (err) {
    return fail(`Download failed: ${err.message}`);
  }
  const digest = /^sha256:([0-9a-f]{64})$/.exec(String(asset.digest ?? ''))?.[1];
  if (!digest) return fail(`GitHub records no sha256 digest for ${asset.name}`);
  if (digest !== sha256) return fail(`The downloaded asset's sha256 ${sha256} is not GitHub's digest ${digest}`);
  const attestation = verifyAttestation({ file: zip, repo, tag, signerRepo, exec });
  if (attestation) return fail(`The attestation does not verify: ${attestation}`);
  const unpacked = path.join(dir, 'unpacked');
  try {
    unpackZip(zip, unpacked);
  } catch (err) {
    return fail(`The bundle does not unpack safely: ${err.message}`);
  }
  const checked = checkUnpacked(unpacked, { policy, repo, slug, edition, tag });
  if (Array.isArray(checked)) return fail(...checked);
  const safety = [];
  for (const d of checked.dirs) {
    const ctx = loadContext({ repo: loadContentRepo(path.join(unpacked, ...d.dir.split('/'))), base: null });
    for (const f of checkContentSafety(ctx)) safety.push(`content-safety: ${d.dir}/${f.file}:${f.line} ${f.message}`);
  }
  if (safety.length) return fail(...safety);
  return {
    problems: [], dir,
    entry: { tag, asset: asset.name, sha256, sourceCommit: checked.bundle.sourceCommit, acceptedAt: now.toISOString() },
  };
}

// --- One run -----------------------------------------------------------------

export const failedTitle = (slug, tag) => `Bundle intake: ${slug} ${tag}`;
export const withdrawnTitle = (slug, tag) => `Bundle withdrawn: ${slug} ${tag}`;
const FAILED = /^Bundle intake: (\S+) (\S+)$/;

const owners = (policy, slug) => {
  const team = policy.docSpaces[slug]?.owners?.team;
  return team ? `@wso2/${team}` : 'the Doc space\'s owners (none named)';
};

function failedBody(policy, { slug, repo, tag, problems }) {
  return [
    `Intake did not accept the Docs bundle of \`${tag}\` from ${repo} (Doc space \`${slug}\`):`,
    '',
    ...problems.slice(0, 30).map((p) => `- ${p}`),
    ...(problems.length > 30 ? [`- and ${problems.length - 30} more`] : []),
    '',
    'Intake does not try this tag again. Fix the cause and release a newer tag, or run Intake by hand (Actions, Intake, Run workflow) to try this one again.',
    '',
    `Owners: ${owners(policy, slug)}`,
  ].join('\n');
}

function withdrawnBody(policy, { slug, repo, edition, tag, newest, back }) {
  const what = !newest ? 'It was not the live release, so nothing live changes.'
    : back ? `When that change merges, Edition ${edition} goes back to \`${back}\`: its release folder, or a rebuild from its bundle if that folder was collected.`
      : `There is no earlier recorded release of Edition ${edition}, so the deployment stays as it is: roll it back by hand (rollback.yml), or release a fixed tag.`;
  return [
    `The release of \`${tag}\` was deleted on ${repo}, so intake removes it from \`releases/${slug}.yaml\` (an auto-merging pull request). ${what}`,
    '',
    `Owners: ${owners(policy, slug)}`,
  ].join('\n');
}

// One intake run over the Content repos of the composed manifest (the
// Platform's own repo aside: its Doc space builds from the Platform), or
// one repo, or one Doc space. Records are read from `pendingDir` (an open
// intake PR's) else `recordsDir` (main's); changed ones are written to
// `outDir`. `issues` are the existing `bundle-intake` issues ([{ title }]):
// a tag one reports is not tried again unless `retry` (a manual run), and no
// issue is opened twice. Returns { changes: [{ slug, repo, file, added,
// removed }], issues: [{ slug, tag, title, body }], errors }.
export async function runIntake({
  policy, recordsDir, pendingDir, outDir = recordsDir, repo: onlyRepo, space: onlySpace, issues = [], retry = false,
  workDir, fetch, token, exec, signerRepo, platformRepo = 'wso2/docs-platform', now = new Date(), log = console.log,
}) {
  if (onlySpace && !policy.docSpaces[onlySpace]) throw new Error(`No Doc space "${onlySpace}" in the composed manifest`);
  const titles = new Set(issues.map((i) => i.title));
  const failed = new Set();
  if (!retry) for (const t of titles) { const m = FAILED.exec(t); if (m) failed.add(failedKey(m[1], m[2])); }
  const repos = [...new Set(Object.values(policy.docSpaces).filter((s) => s.status !== 'legacy' && s.repo).map((s) => s.repo))]
    .filter((r) => lower(r) !== lower(platformRepo))
    .filter((r) => !onlyRepo || lower(r) === lower(onlyRepo))
    .filter((r) => !onlySpace || lower(r) === lower(policy.docSpaces[onlySpace].repo));
  fs.mkdirSync(workDir, { recursive: true });
  const changes = [];
  const opened = [];
  const errors = [];
  const issue = (i) => {
    if (titles.has(i.title)) return;
    titles.add(i.title);
    opened.push(i);
  };
  for (const repo of repos) {
    let releases;
    try {
      releases = await listReleases(repo, { fetch, token });
    } catch (err) {
      errors.push(err.message);
      log(`warning: ${err.message}; ${repo} is skipped this time`);
      continue;
    }
    const slugs = spacesOf(policy, repo).map(([slug]) => slug).filter((s) => !onlySpace || s === onlySpace);
    const before = {};
    for (const slug of slugs) {
      before[slug] = (pendingDir && readRecord(recordFile(pendingDir, slug))) ?? readRecord(recordFile(recordsDir, slug));
    }
    const t = triage({ policy, repo, releases, records: before, failed });
    const after = { ...before };
    const added = {};
    const removed = {};
    for (const p of t.problems.filter((x) => slugs.includes(x.slug))) {
      log(`${p.slug} ${p.tag}: not counted: ${p.message}`);
      issue({ slug: p.slug, tag: p.tag, title: failedTitle(p.slug, p.tag), body: failedBody(policy, { slug: p.slug, repo, tag: p.tag, problems: [p.message] }) });
    }
    for (const c of t.candidates.filter((x) => slugs.includes(x.slug))) {
      log(`${c.slug} ${c.tag}: verifying ${c.release.assets[0].name}`);
      const r = await verifyBundle({ policy, repo, candidate: c, workDir, fetch, token, exec, signerRepo, now });
      fs.rmSync(r.dir, { recursive: true, force: true });
      if (!r.entry) {
        for (const p of r.problems) log(`${c.slug} ${c.tag}: ${p}`);
        issue({ slug: c.slug, tag: c.tag, title: failedTitle(c.slug, c.tag), body: failedBody(policy, { slug: c.slug, repo, tag: c.tag, problems: r.problems }) });
        continue;
      }
      log(`${c.slug} ${c.tag}: accepted (sha256 ${r.entry.sha256})`);
      after[c.slug] = addEntry(after[c.slug] ?? emptyRecord(c.slug, repo), c.edition, r.entry);
      (added[c.slug] ??= []).push({ edition: c.edition, tag: c.tag });
    }
    for (const w of t.withdrawals.filter((x) => slugs.includes(x.slug))) {
      log(`${w.slug} ${w.tag}: withdrawn (its release is gone)`);
      after[w.slug] = removeEntry(after[w.slug], w.tag);
      (removed[w.slug] ??= []).push({ edition: w.edition, tag: w.tag });
      issue({ slug: w.slug, tag: w.tag, title: withdrawnTitle(w.slug, w.tag), body: withdrawnBody(policy, { ...w, repo }) });
    }
    for (const slug of slugs) {
      if (!added[slug] && !removed[slug]) continue;
      const problems = validateRecord(after[slug]);
      if (problems.length) throw new Error(`The intake record of ${slug} would not validate: ${problems.join('; ')}`);
      fs.mkdirSync(outDir, { recursive: true });
      const file = recordFile(outDir, slug);
      fs.writeFileSync(file, formatRecord(after[slug]));
      changes.push({ slug, repo, file, added: added[slug] ?? [], removed: removed[slug] ?? [] });
    }
  }
  return { changes, issues: opened, errors };
}

// --- The intake PR's required check -----------------------------------------

const parseRecord = (text) => {
  const data = yaml.load(text, { schema: yaml.CORE_SCHEMA }) ?? {};
  if (data && typeof data === 'object' && data.editions && typeof data.editions === 'object') {
    data.editions = Object.fromEntries(Object.entries(data.editions).map(([k, v]) => [String(k), v]));
  }
  return data;
};

// Whether a pull request's change under releases/ is what auto-merge may
// take: on an intake branch (intake/<slug>) only releases/<slug>.yaml
// changes, and only its release entries (entries added or removed, none
// edited, newest first, the record valid). On any other branch each changed
// record must still be valid; the Doc space's owners review the rest.
// `files` are the changed paths; `base` and `head` read a path's text (null
// when absent). Returns problem lines.
export function checkRecordChange({ branch, files, base, head }) {
  const problems = [];
  const slug = /^intake\/([a-z0-9][a-z0-9-]*)$/.exec(branch ?? '')?.[1] ?? null;
  const own = slug ? `${RECORD_DIR}/${slug}.yaml` : null;
  if (slug) for (const f of files) if (f !== own) problems.push(`${f}: an intake pull request (${branch}) changes only ${own}`);
  for (const f of files.filter((x) => new RegExp(`^${RECORD_DIR}/[^/]+\\.yaml$`).test(x))) {
    const text = head(f);
    if (text === null) {
      if (slug) problems.push(`${f}: an intake pull request never removes a record`);
      continue;
    }
    let rec;
    try {
      rec = parseRecord(text);
    } catch (err) {
      problems.push(`${f}: not YAML (${err.reason ?? err.message})`);
      continue;
    }
    const invalid = validateRecord(rec);
    for (const p of invalid) problems.push(`${f}: ${p}`);
    if (invalid.length) continue;
    const name = path.posix.basename(f, '.yaml');
    if (rec.docSpace !== name) problems.push(`${f}: names Doc space ${rec.docSpace}, not ${name}`);
    for (const [id, list] of Object.entries(rec.editions)) {
      for (let i = 1; i < list.length; i++) {
        let ordered = false;
        try {
          ordered = compareTags(list[i - 1].tag, list[i].tag) > 0;
        } catch {
          ordered = false;
        }
        if (!ordered) problems.push(`${f}: Edition ${id}'s entries are not newest first (${list[i - 1].tag}, then ${list[i].tag})`);
      }
    }
    if (!slug) continue;
    const oldText = base(f);
    if (oldText === null) continue;
    let old;
    try {
      old = parseRecord(oldText);
    } catch {
      continue;
    }
    for (const key of ['schemaVersion', 'docSpace', 'repo']) {
      if (old[key] !== rec[key]) problems.push(`${f}: ${key} changed (${old[key]} to ${rec[key]}); only release entries may change here`);
    }
    const before = new Map(Object.values(old.editions ?? {}).flat().map((e) => [e.tag, e]));
    for (const e of Object.values(rec.editions).flat()) {
      const was = before.get(e.tag);
      if (was && JSON.stringify(was) !== JSON.stringify(e)) problems.push(`${f}: the entry of ${e.tag} changed; a recorded entry never changes`);
    }
  }
  return problems;
}

// --- Releases from the record ------------------------------------------------

// What a record change releases ({ <slug>: record } before and after a
// merge): each Edition's new newest entry (tag scope), and each withdrawn
// newest entry with the entry its Edition goes back to (null when none).
export function recordChanges(before, after) {
  const releases = [];
  const withdrawals = [];
  for (const slug of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const b = before[slug]?.editions ?? {};
    const a = after[slug]?.editions ?? {};
    const repo = after[slug]?.repo ?? before[slug]?.repo;
    for (const edition of [...new Set([...Object.keys(b), ...Object.keys(a)])]) {
      const was = b[edition] ?? [];
      const now = a[edition] ?? [];
      const isNew = now[0] && !was.some((e) => e.tag === now[0].tag);
      if (isNew) releases.push({ slug, repo, edition, tag: now[0].tag, entry: now[0] });
      else if (was[0] && !now.some((e) => e.tag === was[0].tag)) withdrawals.push({ slug, repo, edition, tag: was[0].tag, back: now[0] ?? null });
    }
  }
  return { releases, withdrawals };
}

const withBundle = (d, entry, extra = {}) => ({ ...d, asset: entry?.asset ?? '', sha256: entry?.sha256 ?? '', backwards: false, ...extra });

// The Docs deployments a record change builds, each with its bundle (asset,
// sha256), and the flips back a withdrawal needs: to the previous entry's
// release folders when `exists` finds them all complete, else a rebuild of
// that entry's bundle under <release>.r<rebuildId>, flipped back after.
export async function planFromRecords(policy, { releases, withdrawals }, { rebuildId, exists }) {
  const deployments = [];
  const flipBack = [];
  for (const r of releases) {
    for (const d of planRelease(policy, { repo: r.repo, tag: r.tag })) deployments.push(withBundle(d, r.entry));
  }
  for (const w of withdrawals) {
    if (!w.back) continue;
    const list = planRelease(policy, { repo: w.repo, tag: w.back.tag });
    const found = await Promise.all(list.map((d) => exists(d.space, d.segment, d.release)));
    if (found.every(Boolean)) {
      for (const d of list) flipBack.push({ space: d.space, segment: d.segment, release: d.release });
      continue;
    }
    if (!rebuildId) throw new Error('A rebuild of a withdrawn release\'s previous bundle needs a rebuild id');
    for (const d of list) {
      const release = `${d.release}.r${rebuildId}`;
      deployments.push(withBundle(d, w.back, { release, backwards: true }));
      flipBack.push({ space: d.space, segment: d.segment, release });
    }
  }
  const latestFirst = (a, b) => Number(b.asLatest) - Number(a.asLatest);
  return { deployments: deployments.sort(latestFirst), flipBack };
}

// Rebuilds (scopes docspace and all): each deployment's deployed tag, from
// its recorded bundle. The Platform's own Doc space and the Landing
// deployment build from the Platform checkout (no bundle); a tag the record
// does not hold goes to onSkip.
export function bundlesFor(deployments, records, { platformRepo, onSkip = () => {} }) {
  const out = [];
  for (const d of deployments) {
    if (lower(d.repo) === lower(platformRepo) || d.space === '_landing') {
      out.push(withBundle(d, null));
      continue;
    }
    const entry = Object.values(records[d.space]?.editions ?? {}).flat().find((e) => e.tag === d.tag);
    if (!entry) {
      onSkip({ deployment: `${d.space}/${d.segment}`, reason: `its deployed tag ${d.tag} is not in ${RECORD_DIR}/${d.space}.yaml, and a build uses only a recorded bundle` });
      continue;
    }
    out.push(withBundle(d, entry));
  }
  return out;
}

// A build's bundle: the recorded asset of a release, downloaded beside `out`,
// its sha256 checked against the record (every later fetch trusts the
// record, so old bundles stay valid when v1 moves), unpacked into the empty
// folder `out`. Returns { dir (the Doc space directory), edition, mainFiles
// (a file listing the repo's files on main, or null), bundle }.
export async function fetchBundle({ repo, tag, asset, sha256, out, fetch = globalThis.fetch, token }) {
  if (!REPO.test(String(repo))) throw new Error(`"${repo}" is not a repo (owner/name)`);
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the release of ${tag} in ${repo}`);
  const release = await res.json();
  const a = (release.assets ?? []).find((x) => x.name === asset);
  if (!a) throw new Error(`The release of ${tag} has no asset ${asset}`);
  const target = path.resolve(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const work = fs.mkdtempSync(path.join(path.dirname(target), '.bundle-download-'));
  const zip = path.join(work, path.basename(asset));
  const got = await downloadAsset(a, zip, { fetch, token });
  if (got !== sha256) throw new Error(`The asset's sha256 ${got} is not the record's ${sha256}`);
  unpackZip(zip, target);
  fs.rmSync(zip);
  const bundle = JSON.parse(fs.readFileSync(path.join(target, 'bundle.json'), 'utf8'));
  if (bundle.tag !== tag || lower(bundle.repo) !== lower(repo)) throw new Error(`bundle.json names ${bundle.repo} ${bundle.tag}, not ${repo} ${tag}`);
  let mainFiles = null;
  if (Array.isArray(bundle.mainFiles)) {
    mainFiles = path.join(work, 'main-files.txt');
    fs.writeFileSync(mainFiles, `${bundle.mainFiles.join('\n')}\n`);
  }
  return { dir: path.join(target, ...String(bundle.path || bundle.docSpace).split('/')), edition: bundle.edition, mainFiles, bundle };
}

function releaseProblem(policy, repo, { slug, tag, release }) {
  if (release.prerelease) return `The release of ${tag} is marked a prerelease; a Docs release never is`;
  if (release.immutable !== true) return `The release of ${tag} is not immutable: turn on immutable releases in ${repo}'s settings, then release again`;
  const asset = bundleAssetName(slug, tag);
  const assets = release.assets ?? [];
  if (assets.length !== 1 || assets[0].name !== asset) {
    return `The release of ${tag} must carry exactly one asset, ${asset} (it has ${assets.length ? assets.map((a) => a.name).join(', ') : 'none'})`;
  }
  try {
    planRelease(policy, { repo, tag });
  } catch (err) {
    return err.message.replace(/manifest policy/g, 'manifest');
  }
  return null;
}
