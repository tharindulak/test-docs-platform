// The packed @wso2/docs package, installed as npx installs it, starts a Doc
// space and builds it (test/package-files.test.mjs checks the packed list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, publicManifest } from '../../lib/manifest.mjs';
import { pack } from '../helpers/pack.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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
  // With webpack's persistent cache on, as a writer's build has it: the cache
  // goes into the package, never into the Content repo.
  delete env.DOCUSAURUS_NO_PERSISTENT_CACHE;
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
  assert.deepEqual(execFileSync('git', ['-C', repoDir, 'status', '--porcelain', '--ignored'], { encoding: 'utf8' }), '', 'the build leaves the Content repo as it was (no .cache/)');
});
