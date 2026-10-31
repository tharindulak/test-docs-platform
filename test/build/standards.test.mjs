// Contribute, the unversioned Doc space of the standards: it builds at
// /contribute/, every lint link lands on a heading, and it passes its own
// checks; the local docs-sandbox (WSO2_DOCS_SANDBOX) passes them too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { loadContentRepo } from '../../lib/content.mjs';
import { inferEditionId } from '../../lib/edition.mjs';
import { CONTRIBUTE_DIR, VALE_DIR, loadStandards } from '../../lib/standards.mjs';
import { runCheck, formatText } from '../../lib/check/index.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-docs-contribute-'));

test('Contribute builds as an unversioned space at /contribute/, and every lint link lands on a heading', { timeout: 600_000 }, () => {
  assert.equal(inferEditionId('any-branch', 'unversioned'), '_');
  execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'build', CONTRIBUTE_DIR, '--out', out], { stdio: 'pipe' });
  const meta = JSON.parse(fs.readFileSync(path.join(out, '_platform', 'edition.json'), 'utf8'));
  assert.equal(meta.baseUrl, '/contribute/');
  assert.equal(meta.edition, '_');
  const pages = JSON.parse(fs.readFileSync(path.join(out, '_platform', 'pages.json'), 'utf8'));
  for (const p of ['', 'get-started/start-here/', 'get-started/cheat-sheet/', 'reference/style-guide/', 'reference/checks/', 'concepts/page-types/', 'get-started/product-teams/', 'guides/product-teams/start-a-doc-space/', 'reference/product-teams/doc-space-manifest/', 'get-started/platform-team/', 'guides/platform-team/run-a-docs-release/', 'reference/platform-team/workflows/']) {
    assert.ok(pages.some((x) => x.path === p), `page ${p}`);
  }
  const html = fs.readFileSync(path.join(out, 'get-started', 'start-here', 'index.html'), 'utf8');
  assert.match(html, /<link[^>]*rel="canonical"[^>]*href="https:\/\/docs\.wso2\.com\/contribute\/get-started\/start-here\/"/);
  assert.match(fs.readFileSync(path.join(out, 'get-started', 'cheat-sheet', 'index.html'), 'utf8'), /\{edition\.productName\}/, '{edition.*} in code is shown as written');

  // Every link the checks and Vale rules print resolves to a page and anchor.
  const S = loadStandards();
  const links = [...S.checks.map((c) => `${S.guideBase}reference/checks/#${c.id}`)];
  for (const f of fs.readdirSync(path.join(VALE_DIR, 'WSO2'))) links.push(yaml.load(fs.readFileSync(path.join(VALE_DIR, 'WSO2', f), 'utf8')).link);
  for (const t of S.pageTypes) links.push(`${S.guideBase}concepts/page-types/#${t.id}`);
  for (const link of links) {
    const [p, anchor] = link.slice(S.guideBase.length).split('#');
    const page = pages.find((x) => x.path === p);
    assert.ok(page, `${link}: no page`);
    assert.ok(page.anchors.includes(anchor), `${link}: no anchor (has ${page.anchors.join(', ')})`);
  }
});

test('Contribute passes its own checks', { timeout: 120_000 }, async () => {
  const r = await runCheck({ repo: loadContentRepo(CONTRIBUTE_DIR), buildDir: out, lint: false, routes: path.join(out, '..') });
  assert.equal(r.result, 'pass', formatText(r));
});

// The local docs-sandbox Content repo (not part of this repo): set
// WSO2_DOCS_SANDBOX to its checkout to check both Editions of its sandbox/
// Doc space. npm test sets it to docs-sandbox beside the main Platform
// checkout, when there is one.
test('docs-sandbox passes the checks on main and release/1.0.0', { skip: !process.env.WSO2_DOCS_SANDBOX && 'set WSO2_DOCS_SANDBOX', timeout: 900_000 }, async () => {
  const dir = path.join(process.env.WSO2_DOCS_SANDBOX, 'sandbox');
  const routes = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-docs-routes-'));
  fs.mkdirSync(path.join(routes, 'contribute'));
  fs.copyFileSync(path.join(out, '_platform', 'pages.json'), path.join(routes, 'contribute', 'pages.json'));
  for (const edition of ['cloud', '1.0.0']) {
    const r = await runCheck({ repo: loadContentRepo(dir), edition, base: 'main', routes, requireRoutes: true });
    assert.equal(r.result, 'pass', formatText(r));
    assert.equal(r.checks.find((c) => c.id === 'preview-build').status, 'pass');
  }
});
