// `wso2-docs bundle` (Releases and deployments, Docs bundles): one Docs
// release tag's Doc space directory, for one Edition, as a deterministic zip
// with a generated bundle.json, so the Platform builds from the zip and reads
// nothing from git. The directory is packed as it is in the repo
// (docspace.yaml, editions.yaml, redirects.yaml, docs/, partials/, assets/),
// Edition markers not applied: the build applies them. A Self-hosted bundle
// leaves out assets/cloud/; a family Cloud's bundle adds every Cloud part
// directory that names it with cloud.in, as siblings the way they sit in the
// repo. Before packing: nothing referenced outside the packed directories,
// no symlinks, the limits, and the content-safety check.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visit } from 'unist-util-visit';
import { UNVERSIONED, editionFromId, inferEditionId } from './edition.mjs';
import { loadContentRepo, mainBranchFiles } from './content.mjs';
import { docSpaceDirs } from './content-repo.mjs';
import { cloudPartOf } from './cloud-tree.mjs';
import { editionFromTag, parseTag, releaseIdFor } from './release.mjs';
import { loadContext } from './check/content.mjs';
import { checkContentSafety } from './check/safety.mjs';
import { writeZip } from './zip.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

export const LIMITS = { files: 30_000, bytes: 1024 ** 3, warnBytes: 500 * 1024 ** 2 };
// What a bundle carries of each Doc space directory; anything else there
// (editor files, notes) stays out.
export const PACKED = ['docspace.yaml', 'editions.yaml', 'redirects.yaml', 'docs', 'partials', 'assets'];

const tryGit = (dir, ...args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const toPosix = (p) => p.split(path.sep).join('/');
const MB = 1024 * 1024;
const size = (n) => (n >= MB ? `${(n / MB).toFixed(1)} MB` : `${n} bytes`);

// The Doc space a run bundles: `dir` itself when it holds a docspace.yaml,
// else the Doc space of that checkout the tag's prefix names (the tag given,
// else the one at HEAD), or its only one. Real paths, as git prints them.
function findDocSpace(dir, given) {
  const abs = fs.realpathSync(path.resolve(dir));
  if (fs.existsSync(path.join(abs, 'docspace.yaml'))) return abs;
  const dirs = docSpaceDirs(abs);
  const tag = given ?? (dirs.length > 1 ? tagAtHead(abs, null) : null);
  const prefix = tag ? parseTag(tag).prefix : null;
  const hit = prefix ? dirs.find((d) => (d.docspace.slug ?? d.dir) === prefix) : dirs.length === 1 ? dirs[0] : null;
  if (!hit) {
    if (prefix) throw new Error(`Tag ${tag} names Doc space "${prefix}", which has no directory with a docspace.yaml in ${abs}`);
    throw new Error(`${abs} holds ${dirs.length ? `several Doc spaces (${dirs.map((d) => d.dir).join(', ')})` : 'no Doc space'}: name its directory, or pass --tag`);
  }
  return path.join(abs, hit.dir);
}

// The Docs release tag at HEAD for this Doc space (any Doc space's when
// `slug` is null), when there is one.
function tagAtHead(root, slug) {
  const tags = (tryGit(root, 'tag', '--points-at', 'HEAD') ?? '').split('\n').filter(Boolean).filter((t) => {
    try {
      const p = parseTag(t).prefix;
      return slug === null || p === null || p === slug;
    } catch {
      return false;
    }
  });
  if (tags.length > 1) throw new Error(`HEAD has several Docs release tags${slug ? ` for ${slug}` : ''} (${tags.join(', ')}); pass --tag`);
  return tags[0] ?? null;
}

// One Doc space directory's files for the bundle, with the problems found:
// symlinks anywhere, and Self-hosted bundles leave out assets/cloud/.
function collect(space, { selfHosted }, problems) {
  const files = [];
  const walk = (abs, rel) => {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) {
      problems.push({ file: `${space.zipDir}/${rel}`, message: 'is a symbolic link: a bundle holds files only (copy the file, or link to it)' });
      return;
    }
    if (st.isDirectory()) {
      if (selfHosted && rel === 'assets/cloud') return;
      for (const name of fs.readdirSync(abs).sort()) walk(path.join(abs, name), `${rel}/${name}`);
      return;
    }
    if (st.isFile()) files.push({ name: `${space.zipDir}/${rel}`, file: abs, size: st.size });
  };
  for (const entry of PACKED) {
    const abs = path.join(space.root, entry);
    if (fs.lstatSync(abs, { throwIfNoEntry: false })) walk(abs, entry);
  }
  return files;
}

// Problems for references that leave the packed directories, and the
// content-safety findings, for one Doc space.
function checkPages(space, packedRoots, problems) {
  const ctx = loadContext({ repo: space.repo, base: null });
  for (const f of checkContentSafety(ctx)) problems.push({ file: `${space.zipDir}/${f.file}`, line: f.line, message: `content-safety: ${f.message}` });
  for (const doc of ctx.docs) {
    const tree = ctx.ast(doc);
    if (!tree) continue; // content safety reports it
    const fileAbs = path.join(space.root, doc.file);
    for (const { ref, node } of referencesOf(tree)) {
      let clean = ref.split(/[?#]/)[0];
      try {
        clean = decodeURI(clean);
      } catch {
        // keep it as written
      }
      if (!clean) continue;
      const target = path.resolve(path.dirname(fileAbs), clean);
      if (packedRoots.some((r) => target === r || target.startsWith(`${r}${path.sep}`))) continue;
      problems.push({ file: `${space.zipDir}/${doc.file}`, line: node.position?.start?.line ?? 1, message: `refers to ${ref}, outside the packed directories (${packedRoots.map((r) => path.basename(r)).join(', ')}): a bundle holds only its Doc space directory` });
    }
  }
}

// Relative references in a page's tree: links, images and definitions, JSX
// src and href, import sources and require() paths. [{ ref, node }]
function referencesOf(tree) {
  const out = [];
  const add = (ref, node) => {
    if (typeof ref !== 'string' || !ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/') || ref.startsWith('#')) return;
    out.push({ ref, node });
  };
  const requires = (estree, node) => {
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) {
        n.forEach(walk);
        return;
      }
      if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'require' && n.arguments?.[0]?.type === 'Literal') add(n.arguments[0].value, node);
      for (const [k, v] of Object.entries(n)) if (k !== 'loc' && k !== 'range' && v && typeof v === 'object') walk(v);
    };
    walk(estree);
  };
  visit(tree, (node) => {
    switch (node.type) {
      case 'link':
      case 'image':
      case 'definition':
        add(node.url, node);
        break;
      case 'mdxjsEsm':
        for (const s of node.data?.estree?.body ?? []) if (s.type === 'ImportDeclaration') add(s.source.value, node);
        break;
      case 'mdxFlowExpression':
      case 'mdxTextExpression':
        requires(node.data?.estree, node);
        break;
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement':
        for (const a of node.attributes ?? []) {
          if (a.type !== 'mdxJsxAttribute') continue;
          if ((a.name === 'src' || a.name === 'href') && typeof a.value === 'string') add(a.value, node);
          else if (a.value && typeof a.value === 'object') requires(a.value.data?.estree, node);
        }
        break;
      default:
    }
  });
  return out;
}

function loadSpace(root, top) {
  const repo = loadContentRepo(root);
  const repoPath = toPosix(path.relative(top, root));
  return { root, repo, slug: repo.docspace.slug, path: repoPath, zipDir: repoPath || repo.docspace.slug };
}

// options: { dir, tag, edition, dryRun, out, repo, commit, mainFiles, limits }
// Returns the report: { result, dryRun, asset, sha256, bytes, files,
// unpackedBytes, bundle (bundle.json), problems, warnings }. Nothing is
// written when a check fails; a dry run packs to a temporary file it removes.
export function makeBundle(o) {
  const limits = o.limits ?? LIMITS;
  let root = findDocSpace(o.dir ?? '.', o.tag);
  const top = fs.realpathSync(tryGit(root, 'rev-parse', '--show-toplevel') ?? path.dirname(root));
  let space = loadSpace(root, top);
  const tag = o.tag ?? tagAtHead(root, space.slug);
  if (!tag && !o.dryRun) throw new Error(`No Docs release tag at HEAD for ${space.slug}: pass --tag, or --dry-run to only check`);
  if (tag) {
    const { prefix } = parseTag(tag);
    if (prefix && prefix !== space.slug) throw new Error(`Tag ${tag} names Doc space "${prefix}", not ${space.slug}`);
  }
  const model = space.repo.docspace.model;
  let edition = o.edition ?? (model === 'unversioned' ? UNVERSIONED : tag ? editionFromTag(tag, model) : null);
  if (!edition) {
    const branch = tryGit(root, 'rev-parse', '--abbrev-ref', 'HEAD');
    if (!branch) throw new Error('Cannot tell the Edition without a tag or a git branch; pass --edition');
    edition = inferEditionId(branch, model, space.repo.docspace);
  }
  editionFromId(edition);
  // A Cloud part has no Cloud release of its own: its main line ships in
  // its family's Cloud bundle (a pull request's dry run checks that one).
  const family = edition === 'cloud' ? cloudPartOf(space.repo.docspace) : null;
  if (family) {
    if (tag) throw new Error(`${space.slug}'s Cloud is its Cloud part of ${family}: tag ${family}'s Cloud instead`);
    root = path.join(path.dirname(root), family);
    if (!fs.existsSync(path.join(root, 'docspace.yaml'))) throw new Error(`${space.slug} is a Cloud part of ${family}, but ${root} has no docspace.yaml`);
    space = loadSpace(root, top);
  }
  // A family Cloud: every sibling Doc space that names it with cloud.in.
  const parts = edition === 'cloud'
    ? docSpaceDirs(path.dirname(root)).filter((d) => d.docspace.cloud?.in === space.slug && path.join(path.dirname(root), d.dir) !== root)
      .map((d) => loadSpace(path.join(path.dirname(root), d.dir), top))
    : [];
  const selfHosted = editionFromId(edition).kind === 'self-hosted';

  const problems = [];
  const warnings = [];
  const spaces = [space, ...parts];
  const files = spaces.flatMap((s) => collect(s, { selfHosted }, problems));
  for (const s of spaces) checkPages(s, spaces.map((x) => x.root), problems);

  const commit = o.commit ?? tryGit(root, 'rev-parse', 'HEAD');
  if (!commit && !o.dryRun) throw new Error('Cannot tell the source commit: run in a git checkout, or pass --commit');
  if (tag && commit) {
    const tagged = tryGit(root, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`);
    if (tagged && tagged !== commit) problems.push({ file: null, message: `The checkout (${commit.slice(0, 8)}) is not at tag ${tag} (${tagged.slice(0, 8)})` });
  }
  const listed = o.mainFiles ? null : spaces.map((s) => mainBranchFiles(s.repo));
  const main = o.mainFiles
    ? [...mainBranchFiles(space.repo, o.mainFiles)]
    : listed.every((x) => x === null) ? null : listed.flatMap((x) => [...(x ?? [])]);
  if (!main) warnings.push('The files on main are unknown (no main branch in this checkout, and no --main-files): "Edit this page" links go to the release branch');
  const bundle = {
    schema: 1,
    repo: o.repo ?? process.env.GITHUB_REPOSITORY ?? space.repo.docspace.repo ?? null,
    path: space.path,
    docSpace: space.slug,
    tag: tag ?? null,
    edition,
    sourceCommit: commit,
    platformVersion: pkg.version,
    mainFiles: main ? [...new Set(main)].sort() : null,
    parts: parts.map((p) => ({ slug: p.slug, path: p.path })).sort((a, b) => a.slug.localeCompare(b.slug)),
  };
  const json = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`);
  const entries = [{ name: 'bundle.json', data: json, size: json.length }, ...files];
  const unpackedBytes = entries.reduce((n, e) => n + e.size, 0);
  if (entries.length > limits.files) problems.push({ file: null, message: `${entries.length} files, more than ${limits.files}: split the Doc space, or move large downloads out of it` });
  if (unpackedBytes > limits.bytes) problems.push({ file: null, message: `${size(unpackedBytes)} (${unpackedBytes} bytes, more than ${limits.bytes}): shrink images, or move large downloads out of the Doc space` });
  else if (unpackedBytes > limits.warnBytes) warnings.push(`${size(unpackedBytes)}: more than ${size(limits.warnBytes)}; the limit is ${size(limits.bytes)}`);

  const asset = `${space.slug}-${tag ? releaseIdFor(tag) : 'dry-run'}.docs.zip`;
  const report = {
    schema: 1, tool: 'wso2-docs bundle', result: problems.length ? 'fail' : 'pass', dryRun: Boolean(o.dryRun),
    asset, sha256: null, bytes: null, files: entries.length, unpackedBytes, bundle, problems, warnings,
  };
  if (problems.length) return report;
  // Pack: to --out, or (a dry run) to a temporary file that is removed.
  const scratch = o.dryRun ? fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-docs-bundle-')) : null;
  const out = scratch ?? path.resolve(o.out ?? path.join(os.homedir(), '.cache', 'wso2-docs', 'bundles'));
  try {
    fs.mkdirSync(out, { recursive: true });
    const z = writeZip(path.join(out, asset), entries.map(({ name, data, file }) => ({ name, data, file })));
    Object.assign(report, { sha256: z.sha256, bytes: z.bytes });
    if (!scratch) fs.writeFileSync(path.join(out, 'bundle.json'), json);
  } finally {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
  return report;
}

export function formatBundle(r) {
  const b = r.bundle;
  const lines = [
    `wso2-docs bundle: ${b.docSpace}, Edition ${b.edition}${b.parts.length ? ` with Cloud parts ${b.parts.map((p) => p.slug).join(', ')}` : ''}, ${b.tag ? `tag ${b.tag}` : 'no tag'}${r.dryRun ? ' (dry run: nothing written)' : ''}`,
    `  ${r.files} files, ${size(r.unpackedBytes)} unpacked${r.bytes !== null ? `; ${r.asset}: ${size(r.bytes)}, sha256 ${r.sha256}` : ''}`,
  ];
  for (const w of r.warnings) lines.push(`  warning  ${w}`);
  for (const p of r.problems) lines.push(`  error    ${p.file ? `${p.file}${p.line ? `:${p.line}` : ''}  ` : ''}${p.message}`);
  lines.push(`Result: ${r.result}${r.problems.length ? ` (${r.problems.length} problem${r.problems.length === 1 ? '' : 's'})` : ''}`);
  return lines.join('\n');
}
