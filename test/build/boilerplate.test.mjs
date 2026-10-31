// Composing from the published manifest end to end: preview and check of a
// new Doc space with only its own Content repo checkout (the preview build
// included), and compose --pr naming each issue's file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { writeRepoRoot } from '../../lib/content-repo.mjs';
import { localRepo } from '../../lib/published.mjs';
import { cacheDir as docsCache } from '../../lib/cache-dir.mjs';
import { docs, git, noCheckouts, read, release, releaseCli, root, tmp, withComing, writePublished, publishedOf } from '../helpers/content-repo-clis.mjs';

test('preview and check compose from the published manifest and the repo alone; compose --pr shows each issue on its file', { timeout: 900_000 }, () => {
  const dir = tmp('from-published');
  const repoDir = path.join(dir, 'docs-api-platform');
  fs.mkdirSync(repoDir);
  git(repoDir, 'init', '-q', '-b', 'main');
  for (const d of ['api-platform', 'api-manager', 'api-gateway', 'ai-gateway', 'ai-workspace', 'api-portal']) {
    fs.cpSync(path.join(root, 'fixtures', 'content-repos', 'docs-api-platform', d), path.join(repoDir, d), { recursive: true });
  }
  writeRepoRoot(repoDir, { repo: 'wso2/docs-api-platform' });
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'main');
  git(repoDir, 'checkout', '-q', '-b', 'add-mcp-hub');
  const init = docs(repoDir, 'init', 'mcp-hub', '--title', 'MCP Hub', '--cloud', '--self-hosted', '1.0.0');
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /Home section: api-platform/);
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'Start MCP Hub');
  assert.deepEqual(localRepo(path.join(repoDir, 'mcp-hub')), { checkout: fs.realpathSync(repoDir), path: '', repo: 'wso2/docs-api-platform' });

  // Before the section lists it: check blocks on home-not-listing, in the Doc space manifest check.
  const early = writePublished(dir, publishedOf());
  let r = docs(repoDir, 'check', 'mcp-hub', '--no-build', '--no-lint', '--published', early, '--format', 'json');
  assert.equal(r.status, 1, r.stderr);
  let report = JSON.parse(r.stdout);
  const manifestCheck = report.checks.find((c) => c.id === 'manifest');
  assert.equal(manifestCheck.status, 'fail');
  assert.deepEqual(manifestCheck.findings.map((x) => [x.file, x.message.split(':')[0]]), [['docspace.yaml', 'home-not-listing']]);
  assert.match(manifestCheck.note, /composed with .*manifest\.json with wso2\/docs-api-platform's Doc space manifests/);
  r = release(dir, 'compose', '--pr', '--published', early, '--repo-dir', repoDir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error \[home-not-listing\] mcp-hub's home section is api-platform/);
  assert.match(r.stdout, /this change touches wso2\/docs-api-platform:mcp-hub\/docspace\.yaml$/m, 'only the new file: the rest is as on main');
  // In Actions the error sits on the file, with its owners.
  const actions = spawnSync(process.execPath, [releaseCli, 'compose', '--pr', '--published', early, '--repo-dir', repoDir, '--annotate', 'content/'], { cwd: dir, encoding: 'utf8', env: { ...noCheckouts(), GITHUB_ACTIONS: 'true' } });
  assert.match(actions.stdout, /^::error file=content\/mcp-hub\/docspace\.yaml,title=Compose home-not-listing::.*owners: api-platform-docs/m);

  // The section's change merged first (the entry waits, hidden): now both pass.
  const published = writePublished(dir, withComing('mcp-hub'));
  r = release(dir, 'compose', '--pr', '--published', published, '--repo-dir', repoDir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /compose: passes against the published manifest/);
  r = docs(repoDir, 'check', 'mcp-hub', '--published', published, '--format', 'json', '--build-out', path.join(dir, 'build'));
  report = JSON.parse(r.stdout);
  assert.equal(report.result, 'pass', JSON.stringify(report.checks.filter((c) => c.status === 'fail'), null, 2) + r.stderr);
  assert.equal(report.checks.find((c) => c.id === 'manifest').status, 'pass');
  assert.equal(report.checks.find((c) => c.id === 'preview-build').status, 'pass', 'the template builds as Cloud');
  assert.equal(report.checks.find((c) => c.id === 'data-files').status, 'pass');
  const composed = JSON.parse(read(docsCache('composed', 'mcp-hub.json')));
  assert.deepEqual(composed.sections['api-platform'].menu.map((m) => m.docSpace), ['api-platform', 'api-manager', 'api-gateway', 'ai-gateway', 'ai-workspace', 'api-portal', 'mcp-hub'], 'the menu the build drew');
  assert.deepEqual(composed.docSpaces['mcp-hub'].editions.map((e) => `${e.id}@${e.branch}`), ['cloud@main', '1.0.0@mcp-hub/release/1.0.0']);
  const home = read(dir, 'build', 'index.html');
  assert.match(home, /class="[^"]*overview/i, 'the overview home');
  assert.ok(fs.existsSync(path.join(dir, 'build', 'reference', 'catalog', 'index.html')));

  // A broken change to a Doc space manifest of this repo blocks with its own file named.
  const ds = path.join(repoDir, 'api-manager', 'docspace.yaml');
  fs.writeFileSync(ds, `${read(ds)}latest: 9.9.9\n`);
  r = release(dir, 'compose', '--pr', '--published', published, '--repo-dir', repoDir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error \[latest\] api-manager: latest is "9\.9\.9"/);
  assert.match(r.stdout, /1 blocking error in this change \(owners: api-platform-docs\)/);
  // Without a reachable published manifest, the message says what to set.
  r = docs(repoDir, 'check', 'mcp-hub', '--no-build', '--published', path.join(dir, 'missing.json'));
  assert.equal(r.status, 1);
});
