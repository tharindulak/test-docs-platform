// A Content repo in the layout of Repo structure for Platform, sections and
// Doc spaces: one <slug>/ directory per Doc space (docspace.yaml, editions.yaml,
// redirects.yaml, docs/, partials/, assets/), and at the root only shared
// files: README, CODEOWNERS, the one path-filtered workflow and the editor
// settings from templates/content-repo/.
//
// Branches: main holds every Doc space's main line (Cloud, or a Cloud part);
// <slug>/release/<version> is a copy of the whole repo whose build reads only
// <slug>/, and a check blocks changes to any other path there. A repo with
// one Doc space may keep unprefixed release/<version> branches. Tags are
// [<slug>/]<version>-docs.<n> and [<slug>/]cloud-<YYYY.MM.DD>.<n>.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'content-repo');
// Template files copied to every Content repo root, as they are.
// The one copy of the developer guide for product teams (Contribute), which
// every Content repo README links to instead of repeating it.
export const GUIDE_URL = 'https://docs.wso2.com/contribute/get-started/product-teams/';
// The template's Doc space skeleton (`wso2-docs init`, lib/init.mjs) is its
// __slug__/ directory; everything else in it is listed here.
export const TEMPLATE_FILES = [
  '.github/workflows/docs.yml', '.github/workflows/docs-preview-publish.yml', '.github/workflows/docs-sync.yml', '.github/branch-ruleset.json',
  '.vscode/extensions.json', '.vscode/settings.json',
];

// Every Doc space directory of a checkout: [{ dir, docspace }], by name.
export function docSpaceDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(root, e.name, 'docspace.yaml')))
    .map((e) => ({ dir: e.name, docspace: yaml.load(fs.readFileSync(path.join(root, e.name, 'docspace.yaml'), 'utf8'), { schema: yaml.CORE_SCHEMA }) ?? {} }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

// What a branch is: main, a Doc space's release branch, or an unprefixed
// release branch (a repo with one Doc space); null for any other branch.
export function parseBranch(branch) {
  const b = String(branch ?? '').replace(/^(refs\/heads\/|origin\/)/, '');
  if (b === 'main') return { main: true, space: null, version: null };
  const m = /^(?:([a-z0-9][a-z0-9-]*)\/)?release\/([^/]+)$/.exec(b);
  return m ? { main: false, space: m[1] ?? null, version: m[2] } : null;
}

// The Edition a Doc space's branch builds: its version on a release branch;
// on main, Cloud where the Doc space has a Cloud Edition or is a Cloud part
// (its main line is its part of the platform's Cloud tree), else `next`.
export function editionForBranch(docspace, branch) {
  const b = parseBranch(branch);
  if (!b) return null;
  if (!b.main) return b.version;
  const editions = (docspace.editions ?? []).map((e) => (typeof e === 'string' ? e : e.id));
  if (editions.includes('cloud') || docspace.cloud?.in || docspace.model === 'cloud-only' || docspace.model === 'cloud-plus-versions') return 'cloud';
  return docspace.model === 'unversioned' ? '_' : 'next';
}

const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);

// Paths a change on a release branch may not touch: anything outside the
// branch's own Doc space directory. A repo with one Doc space at its root
// (the old layout) has no such limit.
export function outsideReleaseDir(paths, branch, dirs) {
  const b = parseBranch(branch);
  if (!b || b.main) return [];
  const own = b.space ?? (dirs.length === 1 ? dirs[0].dir : null);
  if (!own) return [];
  return paths.filter((p) => !under(p, own));
}

// The Doc spaces a pull request checks, from the paths it changes (the
// path filter). On a release branch: that branch's Doc space, always. On
// main: every Doc space directory the change touches, each with the Edition
// its main line builds. Root files touch no Doc space.
export function planPullRequest({ dirs, branch, paths }) {
  const b = parseBranch(branch);
  if (!b) throw new Error(`No Doc space builds from branch ${branch}: pull requests go to main or a <doc space>/release/<version> branch`);
  const byDir = new Map(dirs.map((d) => [d.dir, d]));
  let chosen;
  if (!b.main) {
    const own = b.space ?? (dirs.length === 1 ? dirs[0].dir : null);
    if (!own || !byDir.has(own)) throw new Error(`Branch ${branch} names Doc space "${b.space}", which has no directory with a docspace.yaml`);
    chosen = [byDir.get(own)];
  } else chosen = dirs.filter((d) => paths.some((p) => under(p, d.dir)));
  return {
    spaces: chosen.map((d) => ({ dir: d.dir, slug: d.docspace.slug ?? d.dir, edition: editionForBranch(d.docspace, branch) })),
    outside: outsideReleaseDir(paths, branch, dirs),
  };
}

// The Cloud releases a push to main makes: each touched Doc space with a
// Cloud Edition, and for a touched Cloud part its platform (the platform's
// Cloud tree is built from its parts' main lines). Tags are prefixed with the
// Doc space where the repo holds several.
export function planMainRelease({ dirs, paths }) {
  const out = new Map();
  for (const d of dirs.filter((x) => paths.some((p) => under(p, x.dir)))) {
    const s = d.docspace;
    const editions = (s.editions ?? []).map((e) => (typeof e === 'string' ? e : e.id));
    const target = s.cloud?.in ?? (editions.includes('cloud') ? s.slug ?? d.dir : null);
    if (target && !out.has(target)) out.set(target, { slug: target, tagPrefix: prefixFor(dirs, target), ref: 'main', version: '' });
  }
  return [...out.values()];
}

// The prefix of one Doc space's release branches and tags in this repo:
// `<slug>/` where the repo holds several Doc spaces or the Doc space names
// prefixed branches (as compose works it out).
export function prefixFor(dirs, slug) {
  const d = dirs.find((x) => (x.docspace.slug ?? x.dir) === slug);
  const own = (d?.docspace.editions ?? []).some((e) => String(e?.branch ?? '').startsWith(`${slug}/`));
  return dirs.length > 1 || own ? `${slug}/` : '';
}

// The branch an Edition of a Doc space builds from.
export function releaseBranchFor(dirs, slug, version) {
  const d = dirs.find((x) => (x.docspace.slug ?? x.dir) === slug);
  const e = (d?.docspace.editions ?? []).find((x) => x?.id === version);
  return e?.branch ?? `${prefixFor(dirs, slug)}release/${version}`;
}

// The release a "Release docs" run makes: one Self-hosted Edition, tagged on
// its release branch. `space` may be left out in a repo with one Doc space.
export function planVersionRelease({ dirs, space, version }) {
  if (!/^\d+\.\d+\.\d+$|^\d{4}\.\d{2}\.\d{2}$/.test(String(version ?? ''))) throw new Error(`version must look like 7.3.0 (or a date version such as 2026.09.24), not "${version}"`);
  const d = space ? dirs.find((x) => x.dir === space || x.docspace.slug === space) : dirs.length === 1 ? dirs[0] : null;
  if (!d) throw new Error(space ? `No Doc space directory "${space}" with a docspace.yaml` : 'Name the Doc space: this repo holds several');
  const slug = d.docspace.slug ?? d.dir;
  if (!(d.docspace.editions ?? []).some((e) => e?.id === version)) throw new Error(`${slug} has no Edition ${version} in its docspace.yaml; add it on main first`);
  return [{ slug, tagPrefix: prefixFor(dirs, slug), ref: releaseBranchFor(dirs, slug, version), version }];
}

// The repo root's own files: the template's workflows, branch ruleset and
// editor settings, plus a README and a CODEOWNERS made from the Doc space
// manifests. The converter writes them for the repos it generates, and
// `wso2-docs init` for a new repo, so both kinds stay the same.
// `generated` (the sources, e.g. ['wso2/docs-is@<sha>']) marks a repo the
// converter writes during the Pilot.
export function writeRepoRoot(root, { repo, generated = null } = {}) {
  const dirs = docSpaceDirs(root);
  copyTemplateFiles(root);
  const name = repo ?? path.basename(root);
  const readme = [
    `# ${name.split('/').pop()}`,
    '',
    'A Content repo of WSO2 Docs (docs.wso2.com). It holds these Doc spaces, one directory each:',
    '',
    README_TABLE_HEAD,
    '|---|---|---|',
    ...dirs.map((d) => readmeRow(dirs, d)),
    '',
    ...(generated ? [
      `**Generated during the Pilot. Do not edit here.** Every branch is regenerated by the WSO2 Docs converter (\`migration/\` in \`wso2/docs-platform\`) from ${generated.map((g) => `\`${g}\``).join(', ')}; fixes go into the converter.`,
      '',
    ] : []),
    'Each Doc space directory holds `docspace.yaml` (the Doc space manifest), `editions.yaml` (per-Edition variables), `redirects.yaml` (page moves and legacy maps), `docs/` (pages; folders are the menu), `partials/` (snippets shared inside the Doc space) and `assets/` (with `cloud/` and `self-hosted/` for Edition-only files).',
    '',
    `\`main\` holds every Doc space's main line. A \`<doc space>/release/<version>\` branch is a copy of the whole repo, but it builds only \`<doc space>/\`, and the checks block changes to any other directory there. Docs releases are tagged \`<doc space>/<version>-docs.<n>\`.`,
    '',
    'The repo root holds only shared files: this README, `CODEOWNERS`, the one workflow (`.github/workflows/docs.yml`, path-filtered: it checks, composes and releases the Doc spaces a change touches), the optional sync workflow for generated content (`.github/workflows/docs-sync.yml`), the branch ruleset (`.github/branch-ruleset.json`) and the editor settings, all from `templates/content-repo/` in `wso2/docs-platform`.',
    '',
    `Start another Doc space here: \`npx @wso2/docs init <slug>\`. Preview one: \`npx @wso2/docs preview ${dirs[0]?.dir ?? '<doc space>'}\`.`,
    '',
    `How Doc spaces, their manifests, branches and Docs releases work: the developer guide for product teams, ${GUIDE_URL}.`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'README.md'), readme);
  const teams = [...new Set(dirs.map((d) => d.docspace.owners?.team).filter(Boolean))];
  const owners = [
    '# Each Doc space directory is owned by its team (owners.team in its docspace.yaml);',
    '# the shared root files come from the Platform template.',
    `* ${teams.map((t) => `@wso2/${t}`).join(' ') || '@wso2/docs-platform'}`,
    ...dirs.filter((d) => d.docspace.owners?.team).map(codeownersLine),
    '/.github/ @wso2/docs-platform',
    '/.vscode/ @wso2/docs-platform',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'CODEOWNERS'), owners);
  return { dirs: dirs.map((d) => d.dir) };
}

const README_TABLE_HEAD = '| Directory | Doc space | Editions and branches |';
const codeownersLine = (d) => `/${d.dir}/ @wso2/${d.docspace.owners.team}`;

// The template's root files, copied as they are. Returns the ones that
// changed (new, or different from the template).
export function copyTemplateFiles(root) {
  const changed = [];
  for (const f of TEMPLATE_FILES) {
    const dest = path.join(root, f);
    const src = fs.readFileSync(path.join(TEMPLATE_DIR, f));
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, src);
    changed.push(f);
  }
  return changed;
}

// One Doc space's row in the README's table.
export function readmeRow(dirs, { dir, docspace: s }) {
  const editionsOf = (x) => (x.editions ?? []).map((e) => (typeof e === 'string' ? e : e.id));
  const ids = editionsOf(s);
  const parts = (s.editions ?? []).find((e) => e?.id === 'cloud')?.parts;
  const what = [
    ...ids.map((id) => (id === 'cloud' ? `Cloud on \`main\`${parts?.length ? ` (Cloud parts: ${parts.join(', ')})` : ''}` : `${id} on \`${releaseBranchFor(dirs, s.slug ?? dir, id)}\``)),
    ...(s.cloud?.in ? [`its Cloud part of ${s.cloud.in} on \`main\``] : []),
  ];
  return `| \`${dir}/\` | ${s.displayName ?? dir} | ${what.join('; ') || 'main line only'} |`;
}

// A Doc space added to a repo that already has some (`wso2-docs init` in an
// existing repo): the template's root files brought up to date, a row in the
// README's table and a CODEOWNERS line for the new directory. Each step is
// done once: run again, it changes nothing. Other lines are left as they are.
export function addDocSpaceToRoot(root, dir) {
  const dirs = docSpaceDirs(root);
  const d = dirs.find((x) => x.dir === dir);
  if (!d) throw new Error(`${dir}/ has no docspace.yaml`);
  const changed = copyTemplateFiles(root);
  const readmeFile = path.join(root, 'README.md');
  const row = readmeRow(dirs, d);
  const marker = `| \`${dir}/\` |`;
  if (!fs.existsSync(readmeFile)) {
    writeRepoRoot(root, { repo: d.docspace.repo });
    return { changed: [...changed, 'README.md', 'CODEOWNERS'] };
  }
  const readme = fs.readFileSync(readmeFile, 'utf8').split('\n');
  if (!readme.some((l) => l.startsWith(marker))) {
    const head = readme.findIndex((l) => l.trim() === README_TABLE_HEAD);
    if (head >= 0) {
      // Rows are by directory name, as writeRepoRoot writes them.
      let at = head + 2;
      while (at < readme.length && readme[at].startsWith('| `') && readme[at].localeCompare(row) < 0) at += 1;
      readme.splice(at, 0, row);
    } else readme.push('', README_TABLE_HEAD, '|---|---|---|', row, '');
    fs.writeFileSync(readmeFile, readme.join('\n'));
    changed.push('README.md');
  }
  const ownersFile = path.join(root, 'CODEOWNERS');
  const line = d.docspace.owners?.team ? codeownersLine(d) : null;
  const owners = fs.existsSync(ownersFile) ? fs.readFileSync(ownersFile, 'utf8').split('\n') : [];
  if (line && !owners.some((l) => l.trim().split(/\s+/)[0] === `/${dir}/`)) {
    // After the other Doc space directories, before the shared root files.
    const shared = owners.findIndex((l) => /^\/\.(github|vscode)\//.test(l));
    if (shared >= 0) owners.splice(shared, 0, line);
    else {
      if (owners.length && owners.at(-1) === '') owners.pop();
      owners.push(line, '');
    }
    fs.writeFileSync(ownersFile, owners.join('\n'));
    changed.push('CODEOWNERS');
  }
  return { changed };
}
