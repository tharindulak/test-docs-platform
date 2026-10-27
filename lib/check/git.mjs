// What changed in a Content repo working copy, relative to a base: the files,
// the lines, and the base's version of a file. Without git (or a base),
// everything counts as changed. Paths are relative to the Content repo root,
// which may be a subfolder of the checkout (Contribute lives in the Platform).
import { execFileSync } from 'node:child_process';

const git = (root, args, opts = {}) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const tryGit = (root, args) => {
  try {
    return git(root, args).trim();
  } catch {
    return null;
  }
};

export function isGitRepo(root) {
  return tryGit(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

// Where this change started. Explicit --base wins; in CI the PR's base
// branch; otherwise the main or release branch this branch is closest to. On
// main or a release branch itself, the base is HEAD (uncommitted changes).
export function resolveBase(root, explicit) {
  if (!isGitRepo(root)) return null;
  if (explicit) {
    const sha = tryGit(root, ['rev-parse', '--verify', `${explicit}^{commit}`]);
    if (!sha) throw new Error(`--base ${explicit}: no such branch or commit`);
    const mb = tryGit(root, ['merge-base', sha, 'HEAD']) ?? sha;
    return { ref: mb, label: explicit.replace(/^origin\//, '') };
  }
  if (process.env.GITHUB_BASE_REF) return resolveBase(root, `origin/${process.env.GITHUB_BASE_REF}`);
  const branch = tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  // main, release/<version>, or a Doc space's <slug>/release/<version>.
  const isLine = (b) => b === 'main' || /^(?:[a-z0-9][a-z0-9-]*\/)?release\/[^/]+$/.test(b ?? '');
  if (isLine(branch)) {
    return { ref: tryGit(root, ['rev-parse', 'HEAD']), label: branch };
  }
  const refs = (tryGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/origin/']) ?? '')
    .split('\n').filter((r) => isLine(r.replace(/^origin\//, '')));
  let best = null;
  for (const r of refs) {
    const mb = tryGit(root, ['merge-base', r, 'HEAD']);
    if (!mb) continue;
    const ahead = Number(tryGit(root, ['rev-list', '--count', `${mb}..HEAD`]));
    if (!best || ahead < best.ahead) best = { ref: mb, label: r.replace(/^origin\//, ''), ahead };
  }
  return best ? { ref: best.ref, label: best.label } : null;
}

// Changed files between base and the working tree, untracked files included.
// Each is { path, status: 'A'|'M'|'D'|'R', from? } with repo-relative paths.
export function changedFiles(root, base) {
  const out = [];
  const parts = git(root, ['diff', '--relative', '--name-status', '-M', '-z', base]).split('\0').filter(Boolean);
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (status.startsWith('R') || status.startsWith('C')) {
      const from = parts[i++];
      const to = parts[i++];
      out.push({ path: to, status: status[0] === 'R' ? 'R' : 'A', from });
    } else {
      out.push({ path: parts[i++], status: status[0] === 'D' ? 'D' : status[0] === 'A' ? 'A' : 'M' });
    }
  }
  for (const p of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    out.push({ path: p, status: 'A' });
  }
  return out;
}

// Line numbers added or changed in one file ('all' for a new file).
export function changedLines(root, base, file) {
  if (!base) return 'all';
  if (tryGit(root, ['cat-file', '-e', `${base}:./${file}`]) === null) return 'all';
  const diff = git(root, ['diff', '--relative', '-U0', '--no-color', '--no-ext-diff', base, '--', file]);
  const lines = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let n = start; n < start + count; n++) lines.add(n);
  }
  return lines;
}

export function baseFile(root, base, file) {
  if (!base) return null;
  try {
    return git(root, ['show', `${base}:./${file}`]);
  } catch {
    return null;
  }
}

export function baseFiles(root, base, dir) {
  if (!base) return [];
  return (tryGit(root, ['ls-tree', '-r', '--name-only', base, '--', dir]) ?? '').split('\n').filter(Boolean);
}

// Paths changed against base anywhere in the checkout (not only under the
// Content repo root), relative to the checkout's top: what the release-scope
// check reads, since a release branch may not change other directories.
export function changedInCheckout(root, base) {
  const top = tryGit(root, ['rev-parse', '--show-toplevel']);
  if (!top) return [];
  const names = (args) => (tryGit(top, args) ?? '').split('\n').filter(Boolean);
  return [...new Set([...names(['diff', '--name-only', base]), ...names(['ls-files', '--others', '--exclude-standard'])])];
}

// The Content repo root's path inside its checkout ('' at the top).
export function pathInCheckout(root) {
  return tryGit(root, ['rev-parse', '--show-prefix'])?.replace(/\/$/, '') ?? '';
}

export function currentBranch(root) {
  return tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
}
