// A git copy of the stub Content repo's Identity Server Doc space on a
// branch "change" off "main", with route lists of the deployments it links
// to, and runCheck() on it: shared by test/check.test.mjs and
// test/build/check.test.mjs. Each test file that imports it gets its own copy.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContentRepo } from '../../lib/content.mjs';
import { runCheck } from '../../lib/check/index.mjs';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixture = path.join(root, 'fixtures', 'stub-repo', 'identity-server');
export const cli = path.join(root, 'bin', 'wso2-docs.mjs');
export const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-docs-check-'));
export const repoDir = path.join(tmp, 'repo');
export const routesDir = path.join(tmp, 'routes');

export const git = (...args) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
fs.cpSync(fixture, repoDir, { recursive: true });
git('init', '-q', '-b', 'main');
git('add', '-A');
git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'base');
git('checkout', '-q', '-b', 'change');

// Route lists of the deployments the stub links to.
fs.mkdirSync(path.join(routesDir, 'api-manager', 'latest', '_platform'), { recursive: true });
fs.writeFileSync(path.join(routesDir, 'api-manager', 'latest', '_platform', 'pages.json'), JSON.stringify([
  { path: '', title: 'Home' }, { path: 'guides/', title: 'Guides', anchors: ['publish-an-api'] },
]));

// A real 1x1 PNG, so Docusaurus can read its size.
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
export const file = (rel) => path.join(repoDir, rel);
export const read = (rel) => fs.readFileSync(file(rel), 'utf8');
export const write = (rel, text) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), text);
};
export const append = (rel, text) => fs.appendFileSync(file(rel), text);
export const reset = () => {
  git('reset', '-q', '--hard', 'HEAD');
  git('clean', '-qfd');
};

export async function check(opts = {}) {
  return runCheck({ repo: loadContentRepo(repoDir), routes: routesDir, requireRoutes: true, build: false, lint: false, ...opts });
}
export const status = (report, id) => report.checks.find((c) => c.id === id).status;
export const findings = (report, id) => report.checks.find((c) => c.id === id).findings;

// The page, catalog page and catalog data file the cases change.
export const PAGE = 'docs/guides/mfa.mdx';
export const CATALOG_PAGE = 'docs/reference/connectors/index.mdx';
export const CATALOG = 'docs/reference/connectors/connectors.yaml';
