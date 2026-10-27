// What @wso2/docs ships (package.json "files"): only what its commands need at
// runtime. Every file the bin entries and the Docusaurus site load, by import
// or by a path built from import.meta.url, must be in the packed list, and the
// Platform's own working files (spec, tickets, tests, fixtures, the converter)
// must not be. The packed list comes from npm itself (npm pack --dry-run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, publicManifest } from '../lib/manifest.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');

// Files and folders read by a name the tracer can't follow (a variable, or a
// directory constant imported from another module). Each line names its reader.
const READS = [
  // lib/standards.mjs loadStandards(): read(name) for each standards source.
  'standards/page-types.yaml', 'standards/skeleton.yaml', 'standards/front-matter.yaml', 'standards/admonitions.yaml',
  'standards/terminology.yaml', 'standards/style-rules.yaml', 'standards/checks.yaml',
  // lib/check/safety.mjs loadSafetyRules(): the component catalogue's module ids and the iframe hosts.
  'standards/components.yaml', 'standards/iframe-hosts.yaml',
  // lib/check/lint.mjs: VALE_DIR's style package and vocabulary.
  'standards/vale',
  // lib/check/index.mjs and lib/standards.mjs template(): TEMPLATES_DIR.
  'standards/templates',
  // lib/init.mjs: TEMPLATE_DIR (the Content repo's root files and the
  // __slug__ Doc space skeleton) and SECTION_TEMPLATE.
  'templates',
  // lib/schemas.mjs: SCHEMA_FILES in SCHEMAS_DIR.
  'schemas',
  // lib/compose.mjs DEFAULT_NAVIGATION, read by preview, build and check.
  'navigation',
  // site/docusaurus.config.mjs's static directory; Docusaurus reads the site's package.json.
  'site/static', 'site/package.json',
];

// Folders a shipped module names but no command reads.
const UNREAD = {
  'standards/contribute': 'CONTRIBUTE_DIR (lib/standards.mjs), read only by scripts/build-standards.mjs',
};

// What a published package never carries.
const NEVER = ['.scratch/', '.claude/', '.agents/', '.github/', 'spec/', 'test/', 'fixtures/', 'migration/', 'scripts/',
  'skills/', 'standards/contribute/', 'site/.docusaurus/', 'site/build/', 'worker/local.mjs', 'worker/wrangler.jsonc', 'node_modules/'];

const CODE = /\.(mjs|cjs|js|jsx)$/;
const SPECIFIER = /(?:^|[^\w.])(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]|(?:^|[^\w.])import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require(?:\.resolve)?\(\s*['"]([^'"]+)['"]\s*\)/gm;
const HERE = 'path\\.dirname\\(fileURLToPath\\(import\\.meta\\.url\\)\\)';
const SEGMENTS = "('[^']*'(?:\\s*,\\s*'[^']*')*)";
const segments = (s) => [...s.matchAll(/'([^']*)'/g)].map((m) => m[1]);

function resolveFile(abs) {
  for (const p of [abs, `${abs}.js`, `${abs}.mjs`, `${abs}.jsx`, path.join(abs, 'index.js'), path.join(abs, 'index.mjs')]) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

// A package name from a bare specifier: '@scope/name/x' -> '@scope/name'.
const packageName = (s) => s.split('/').slice(0, s.startsWith('@') ? 2 : 1).join('/');

// Paths a file builds from its own location: const here = path.dirname(...),
// const X = path.join(here | X | path.dirname(...), '...'), new URL('../x', import.meta.url).
function pathRefs(file, text) {
  const dir = path.dirname(file);
  const known = new Map();
  for (const m of text.matchAll(new RegExp(`const\\s+(\\w+)\\s*=\\s*${HERE}\\s*;`, 'g'))) known.set(m[1], dir);
  const refs = [];
  for (const m of text.matchAll(new RegExp(`(?:const\\s+(\\w+)\\s*=\\s*)?path\\.join\\(\\s*(${HERE}|\\w+)\\s*,\\s*${SEGMENTS}\\s*\\)`, 'g'))) {
    const base = m[2].startsWith('path.dirname') ? dir : known.get(m[2]);
    if (!base) continue;
    const target = path.join(base, ...segments(m[3]));
    if (m[1]) known.set(m[1], target);
    refs.push(target);
  }
  for (const m of text.matchAll(/new URL\(\s*'([^']+)'\s*,\s*import\.meta\.url\s*\)/g)) refs.push(path.join(dir, m[1]));
  return refs;
}

// Everything the bin entries and the site load, followed transitively.
function trace() {
  const siteSrc = fs.readdirSync(path.join(root, 'site', 'src'), { recursive: true })
    .map((f) => path.join(root, 'site', 'src', f)).filter((f) => fs.statSync(f).isFile());
  const queue = [...Object.values(pkg.bin), 'site/docusaurus.config.mjs', 'site/sidebars.mjs'].map((f) => path.join(root, f)).concat(siteSrc);
  const files = new Set();
  const packages = new Map();
  const missing = [];
  while (queue.length) {
    const file = queue.shift();
    if (files.has(file)) continue;
    files.add(file);
    if (!CODE.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(SPECIFIER)) {
      const s = m[1] ?? m[2] ?? m[3] ?? m[4];
      let local = null;
      if (s.startsWith('.')) local = path.resolve(path.dirname(file), s);
      else if (s.startsWith('@site/')) local = path.join(root, 'site', s.slice('@site/'.length));
      else if (s.startsWith('@theme/') && resolveFile(path.join(root, 'site', 'src', 'theme', s.slice('@theme/'.length)))) {
        local = path.join(root, 'site', 'src', 'theme', s.slice('@theme/'.length));
      }
      if (local) {
        const found = resolveFile(local);
        if (found) queue.push(found);
        else missing.push(`${rel(file)}: ${s}`);
      } else if (!s.startsWith('node:') && !builtinModules.includes(s) && !/^@(theme|theme-original|theme-init|generated)\//.test(s)) {
        if (!packages.has(packageName(s))) packages.set(packageName(s), rel(file));
      }
    }
    for (const ref of pathRefs(file, text)) {
      if (!fs.existsSync(ref)) continue;
      if (fs.statSync(ref).isFile()) queue.push(ref);
      else if (ref !== root) files.add(ref);
    }
  }
  return { files: [...files].map(rel).sort(), packages, missing };
}

// The package as npm packs it: its file list and the tarball (never published).
let cachedPack;
function pack() {
  if (cachedPack) return cachedPack;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-pack-'));
  const r = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dir], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [info] = JSON.parse(r.stdout);
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  cachedPack = { files: new Set(info.files.map((f) => f.path)), tarball: path.join(dir, info.filename) };
  return cachedPack;
}
const packed = () => pack().files;
const covered = (p) => packed().has(p) || [...packed()].some((f) => f.startsWith(`${p}/`));

test('package.json lists the files the package ships', () => {
  assert.ok(Array.isArray(pkg.files) && pkg.files.length, 'package.json has a "files" list');
});

test('every file the commands and the site load is packed', () => {
  const { files, missing } = trace();
  assert.deepEqual(missing, [], 'every local import resolves');
  assert.ok(files.includes('lib/init.mjs') && files.includes('plugins/partials.mjs'), 'the tracer follows imports and plugin paths');
  assert.deepEqual(files.filter((f) => !covered(f) && !UNREAD[f]), [], 'traced but not packed');
});

test('the package carries nothing the commands don\'t load or read', () => {
  const { files } = trace();
  const loaded = new Set(files);
  const under = (f, p) => f === p || f.startsWith(`${p}/`);
  const extra = [...packed()].filter((f) => !loaded.has(f) && !READS.some((p) => under(f, p)) && !['package.json', 'README.md'].includes(f));
  assert.deepEqual(extra, []);
});

test('every file read by name is packed', () => {
  for (const p of READS) assert.ok(fs.existsSync(path.join(root, p)), `${p} exists`);
  assert.deepEqual(READS.filter((p) => !covered(p)), [], 'read but not packed');
});

test('the shipped code imports no devDependency', () => {
  const { packages } = trace();
  const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
  const outside = [...packages].filter(([name]) => dev.has(name)).map(([name, from]) => `${name} (${from})`);
  assert.deepEqual(outside, []);
});

test('the Platform\'s working files are not packed', () => {
  const leaked = [...packed()].filter((f) => NEVER.some((n) => f === n || f.startsWith(n)));
  assert.deepEqual(leaked, []);
});

// Installed as npx installs it: the package under node_modules/ (here
// .cache/packed/node_modules/@wso2/docs, so its dependencies resolve from the
// Platform's own node_modules/). init starts a Doc space and build builds it.
test('the packed package, installed under node_modules/, starts a Doc space and builds it', { timeout: 900_000 }, (t) => {
  const installed = path.join(root, '.cache', 'packed', 'node_modules', '@wso2', 'docs');
  fs.rmSync(installed, { recursive: true, force: true });
  t.after(() => fs.rmSync(path.join(root, '.cache', 'packed'), { recursive: true, force: true }));
  fs.mkdirSync(installed, { recursive: true });
  execFileSync('tar', ['-xzf', pack().tarball, '-C', installed, '--strip-components=1']);
  const cli = path.join(installed, 'bin', 'wso2-docs.mjs');
  const env = { ...process.env, GITHUB_ACTIONS: '' };
  delete env.WSO2_DOCS_CONTENT_REPOS;
  delete env.WSO2_DOCS_MANIFEST;
  const docs = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env });
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { stdio: 'ignore' });

  const help = docs(root, '--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage: wso2-docs <command>/);

  // A new Content repo: init writes the Doc space and the repo root files.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-packed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repoDir = path.join(dir, 'docs-mcp-hub');
  fs.mkdirSync(repoDir);
  git(repoDir, 'init', '-q', '-b', 'main');
  const init = docs(repoDir, 'init', 'mcp-hub', '--title', 'MCP Hub', '--home', 'api-platform', '--github', 'wso2/docs-mcp-hub', '--cloud');
  assert.equal(init.status, 0, init.stderr);
  for (const f of ['README.md', 'CODEOWNERS', '.github/workflows/docs.yml', 'mcp-hub/docspace.yaml', 'mcp-hub/docs/index.mdx']) {
    assert.ok(fs.existsSync(path.join(repoDir, f)), f);
  }
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'Start MCP Hub');

  // Its home section lists it (the section change merged first), as published.
  const policy = structuredClone(loadPolicy());
  policy.sections['api-platform'].pending = [{ at: 3, docSpace: 'mcp-hub' }];
  const published = path.join(dir, 'manifest.json');
  fs.writeFileSync(published, JSON.stringify({ schema: 1, environment: 'staging', ...publicManifest(policy, { environment: 'staging' }) }));
  const out = path.join(dir, 'build');
  const build = docs(repoDir, 'build', 'mcp-hub', '--published', published, '--out', out);
  assert.equal(build.status, 0, build.stdout.slice(-3000) + build.stderr.slice(-3000));
  assert.ok(fs.existsSync(path.join(out, 'index.html')), 'the home page');
  assert.ok(fs.existsSync(path.join(out, 'get-started', 'quick-start', 'index.html')), 'a template page');
});
