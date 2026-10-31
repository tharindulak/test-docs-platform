// axe on a Platform pull request that changes the theme (scripts/theme-axe.mjs,
// the theme-axe job in ci.yml): Sandbox pages with the theme at the host
// root, light and dark, 1280 and 375 px; any violation fails.
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { themeBase } from '../lib/theme-bundle.mjs';
import { PA11Y_CI, THEME_AXE_PAGES, missingFiles, serveBuilds, themeAxeConfig } from '../scripts/theme-axe.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the pa11y-ci config: each Sandbox page in light and dark at 1280 and 375 px, one address per check, axe at WCAG 2 AA', () => {
  assert.deepEqual(THEME_AXE_PAGES.map((p) => p.name), ['home', 'guide', 'code', 'reference']);
  const config = themeAxeConfig({ origin: 'http://127.0.0.1:4500', screenshots: '/tmp/shots' });
  assert.deepEqual(config.defaults, { runners: ['axe'], standard: 'WCAG2AA', timeout: 60000, chromeLaunchConfig: { args: ['--no-sandbox'] } });
  assert.equal(config.urls.length, THEME_AXE_PAGES.length * 2 * 2);
  assert.equal(new Set(config.urls.map((u) => u.url)).size, config.urls.length, 'pa11y-ci keys its report by URL');
  assert.deepEqual(config.urls.slice(0, 4), [
    { url: 'http://127.0.0.1:4500/sandbox/cloud/?docusaurus-theme=light&width=1280', viewport: { width: 1280, height: 800 }, screenCapture: '/tmp/shots/home-light-1280.png' },
    { url: 'http://127.0.0.1:4500/sandbox/cloud/?docusaurus-theme=light&width=375', viewport: { width: 375, height: 812 }, screenCapture: '/tmp/shots/home-light-375.png' },
    { url: 'http://127.0.0.1:4500/sandbox/cloud/?docusaurus-theme=dark&width=1280', viewport: { width: 1280, height: 800 }, screenCapture: '/tmp/shots/home-dark-1280.png' },
    { url: 'http://127.0.0.1:4500/sandbox/cloud/?docusaurus-theme=dark&width=375', viewport: { width: 375, height: 812 }, screenCapture: '/tmp/shots/home-dark-375.png' },
  ]);
  assert.ok(config.urls.some((u) => u.url === 'http://127.0.0.1:4500/sandbox/cloud/reference/error-codes/?docusaurus-theme=dark&width=375'));
  const plain = themeAxeConfig({ origin: 'http://localhost:1', base: '/', chrome: '/opt/chrome' });
  assert.ok(plain.urls.every((u) => !('screenCapture' in u)), 'screenshots only when asked');
  assert.equal(plain.urls[0].url, 'http://localhost:1/?docusaurus-theme=light&width=1280');
  assert.deepEqual(plain.defaults.chromeLaunchConfig, { args: ['--no-sandbox'], executablePath: '/opt/chrome' });
  for (const origin of [undefined, 'http://127.0.0.1:4500/', '127.0.0.1:4500']) assert.throws(() => themeAxeConfig({ origin }), /origin/);
  assert.throws(() => themeAxeConfig({ origin: 'http://x', base: '/sandbox/cloud' }), /base/);
});

function builds() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-axe-'));
  const landing = path.join(dir, 'landing');
  const sandbox = path.join(dir, 'sandbox');
  const write = (f, s) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, s);
  };
  write(path.join(landing, 'index.html'), 'landing');
  write(path.join(landing, ...themeBase().split('/').filter(Boolean), 'theme.css'), 'body{}');
  for (const p of THEME_AXE_PAGES) write(path.join(sandbox, p.path, 'index.html'), `sandbox ${p.name}`);
  return { dir, landing, sandbox };
}

test('the check refuses builds without the pages or the theme', () => {
  const b = builds();
  assert.deepEqual(missingFiles(b), []);
  fs.rmSync(path.join(b.sandbox, 'reference'), { recursive: true });
  fs.rmSync(path.join(b.landing, '_platform'), { recursive: true });
  const missing = missingFiles(b);
  assert.equal(missing.length, 2);
  assert.match(missing[0], /^the theme, .*theme\.css$/);
  assert.match(missing[1], /^the reference page, .*error-codes/);
});

test('one server: the Sandbox under its baseUrl, the Landing build (and the theme) at the host root', async () => {
  const b = builds();
  const server = serveBuilds(b);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const at = (p) => fetch(`http://127.0.0.1:${server.address().port}${p}`);
  try {
    assert.equal(await (await at('/sandbox/cloud/?docusaurus-theme=dark&width=375')).text(), 'sandbox home');
    assert.equal(await (await at('/sandbox/cloud/reference/error-codes/')).text(), 'sandbox reference');
    assert.equal(await (await at('/')).text(), 'landing');
    const css = await at(`${themeBase()}theme.css`);
    assert.equal(css.status, 200);
    assert.equal(css.headers.get('content-type'), 'text/css');
    assert.equal((await at('/sandbox/cloud/nope/')).status, 404);
    assert.equal((await at('/sandbox/cloud/..%2F..%2Flanding%2Findex.html')).status, 400, 'nothing outside the builds');
  } finally {
    server.close();
  }
});

test('ci.yml runs it on a pull request that changes site/wso2-theme/, with the same pa11y-ci as the reports', () => {
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
  const job = wf.jobs['theme-axe'];
  assert.equal(job.if, "github.event_name == 'pull_request'");
  const [checkout, changes, ...rest] = job.steps;
  assert.equal(checkout.with['fetch-depth'], 2);
  assert.match(changes.run, /git diff --quiet HEAD\^1 HEAD -- site\/wso2-theme\//);
  for (const s of rest) assert.match(s.if, /steps\.changes\.outputs\.theme == 'true'/, s.name ?? s.uses ?? s.run);
  const sandbox = rest.find((s) => s.with?.repository);
  assert.equal(sandbox.with.repository, 'wso2/docs-sandbox');
  const build = rest.find((s) => /wso2-docs\.mjs build/.test(s.run ?? ''));
  assert.match(build.run, /build --landing --out "\$RUNNER_TEMP\/landing"/);
  assert.match(build.run, /build _content\/docs-sandbox\/sandbox --edition cloud --out "\$RUNNER_TEMP\/sandbox"/);
  assert.match(build.env.WSO2_DOCS_CONTENT_REPOS, /fixtures\/content-repos$/);
  assert.ok(rest.some((s) => /node scripts\/theme-axe\.mjs --landing "\$RUNNER_TEMP\/landing" --sandbox "\$RUNNER_TEMP\/sandbox"/.test(s.run ?? '')));
  const nightly = fs.readFileSync(path.join(root, '.github/workflows/nightly-reports.yml'), 'utf8');
  assert.ok(nightly.includes(`npx --yes ${PA11Y_CI} `), 'the version the nightly reports run');
});

test('every axe run is the one pa11y-ci, a version whose Chromium has :has() (pa11y-ci 4 and later)', () => {
  const dir = path.join(root, '.github/workflows');
  const runs = fs.readdirSync(dir).flatMap((f) => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/pa11y-ci@[\w.-]+/g)].map((m) => `${f}: ${m[0]}`));
  assert.ok(runs.some((r) => r.startsWith('nightly-reports.yml')) && runs.filter((r) => r.startsWith('release.yml')).length === 2, runs.join('\n'));
  assert.deepEqual(runs.filter((r) => !r.endsWith(`: ${PA11Y_CI}`)), []);
  assert.match(PA11Y_CI, /^pa11y-ci@\d+\.\d+\.\d+$/, 'an exact version');
  assert.ok(Number(/@(\d+)\./.exec(PA11Y_CI)[1]) >= 4, 'pa11y-ci 3.x runs Chromium 91, which has no :has()');
});

test('without the private Sandbox (a fork, no token), the job fails saying why and who runs the check', () => {
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'));
  const steps = wf.jobs['theme-axe'].steps;
  const at = (pred) => steps.findIndex(pred);
  const checkout = at((s) => s.with?.repository === 'wso2/docs-sandbox');
  assert.equal(steps[checkout].id, 'sandbox');
  assert.equal(steps[checkout]['continue-on-error'], true, 'a failed checkout is not the raw error that ends the job');
  const stop = steps[checkout + 1];
  assert.match(stop.if, /steps\.sandbox\.outcome != 'success'/);
  assert.ok(checkout < at((s) => s.run === 'npm ci') && checkout < at((s) => /wso2-docs\.mjs build/.test(s.run ?? '')), 'before npm ci and the builds');
  // The step's script, as the runner runs it: fails with the reason and the way forward.
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-axe-'));
  const run = (env) => spawnSync('bash', ['-e', '-c', stop.run], {
    env: { PATH: process.env.PATH, REPO: 'wso2/docs-platform', GITHUB_STEP_SUMMARY: path.join(tmpdir, `summary-${Object.values(env).join('-')}.md`), ...env }, encoding: 'utf8',
  });
  const fork = run({ FORK: 'true', TOKEN: 'false' });
  assert.equal(fork.status, 1);
  assert.match(fork.stdout, /^::error title=theme-axe did not run::.*wso2\/docs-sandbox.*comes from a fork.*A Platform team member must run the check from a branch in wso2\/docs-platform/m);
  assert.match(fs.readFileSync(path.join(tmpdir, 'summary-true-false.md'), 'utf8'), /^### axe on the theme did not run\n\n.*comes from a fork/);
  assert.match(run({ FORK: 'false', TOKEN: 'false' }).stdout, /CONTENT_READ_TOKEN is not set for this run/);
  assert.match(run({ FORK: 'false', TOKEN: 'true' }).stdout, /CONTENT_READ_TOKEN can't read it/);
  fs.rmSync(tmpdir, { recursive: true, force: true });
});
