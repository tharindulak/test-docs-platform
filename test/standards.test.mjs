// The standards source and what it generates: the Vale package, the
// Contribute Doc space (an unversioned build at /contribute/), lint links into
// the guide, the author skills, the Content repo templates, the PR and report
// workflows and the weekly digest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { loadContentRepo } from '../lib/content.mjs';
import { inferEditionId } from '../lib/edition.mjs';
import { loadPolicy, publicManifest } from '../lib/manifest.mjs';
import { CONTRIBUTE_DIR, VALE_DIR, loadStandards } from '../lib/standards.mjs';
import { runCheck, formatText } from '../lib/check/index.mjs';
import { collectDigest, renderDigest } from '../lib/digest.mjs';
import { lintCounts, liveSpaces, sampleUrls } from '../lib/reports.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-docs-contribute-'));
const wf = (name) => yaml.load(fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8'));
const tpl = (rel) => fs.readFileSync(path.join(root, 'templates', 'content-repo', rel), 'utf8');

test('generated standards outputs are up to date', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-standards.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('the Vale package comes from the terminology file, product names at error level', () => {
  const S = loadStandards();
  const rule = (name) => yaml.load(fs.readFileSync(path.join(VALE_DIR, 'WSO2', `${name}.yml`), 'utf8'));
  const products = rule('ProductNames');
  assert.equal(products.level, 'error');
  assert.equal(products.swap['\\bIS\\b'], 'WSO2 Identity Server|Identity Server');
  assert.equal(rule('RetiredNames').level, 'error');
  assert.ok(rule('RetiredNames').tokens.includes('(?<!formerly )\\bAsgardeo\\b'));
  assert.equal(rule('PreferredTerms').swap['\\blog in\\b'], 'sign in');
  assert.deepEqual(S.lint.blockingRules, [], 'nothing blocks before cutover');
  for (const f of fs.readdirSync(path.join(VALE_DIR, 'WSO2'))) assert.match(rule(f.replace('.yml', '')).link, /^https:\/\/docs\.wso2\.com\/contribute\//, f);
});

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

test('the author skills are SKILL.md files with their generated references', () => {
  for (const name of ['check-my-changes', 'write-a-page']) {
    const { data, content } = matter(fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8'));
    assert.equal(data.name, name);
    assert.ok(data.description.length > 40 && data.description.length < 300);
    for (const ref of content.matchAll(/`(references\/[^`<]+)`/g)) assert.ok(fs.existsSync(path.join(root, 'skills', name, ref[1])), ref[1]);
    assert.match(fs.readFileSync(path.join(root, 'skills', name, 'references', 'standards.md'), 'utf8'), /## Terminology[^]*WSO2 Identity Server/);
  }
  assert.match(fs.readFileSync(path.join(root, 'skills', 'check-my-changes', 'SKILL.md'), 'utf8'), /npx @wso2\/docs check/);
  for (const t of loadStandards().pageTypeIds) assert.ok(fs.existsSync(path.join(root, 'skills', 'write-a-page', 'references', 'templates', `${t}.mdx`)));
  const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(plugin.skills, './skills/');
});

test('Content repo templates: editor extensions, branch protection and the PR checks', () => {
  const ext = JSON.parse(tpl('.vscode/extensions.json').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(ext.recommendations, ['unifiedjs.vscode-mdx', 'chrischinchilla.vale-vscode', 'streetsidesoftware.code-spell-checker', 'redhat.vscode-yaml']);
  const settings = JSON.parse(tpl('.vscode/settings.json').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(settings['yaml.schemas'], { 'https://docs.wso2.com/schemas/docspace.schema.json': ['*/docspace.yaml'] }, 'every Doc space directory\'s manifest');
  assert.equal(settings['files.associations']['*.mdx'], 'mdx');
  const ruleset = JSON.parse(tpl('.github/branch-ruleset.json'));
  assert.deepEqual(ruleset.conditions.ref_name.include, ['refs/heads/main', 'refs/heads/release/*', 'refs/heads/*/release/*']);
  const checks = ruleset.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks.map((c) => c.context);
  const docs = yaml.load(tpl('.github/workflows/docs.yml'));
  const pr = wf('pr-preview.yml');
  assert.deepEqual(checks, [docs.jobs.checks.name], 'the required check sums up the PR checks of every touched Doc space');
  assert.equal(pr.jobs.build.name, 'checks');
  assert.ok(pr.on.workflow_call.inputs['doc-space'] && pr.on.workflow_call.inputs.edition);
  const steps = pr.jobs.build.steps;
  assert.match(steps.find((s) => s.name === 'Blocking checks, preview build and lint').run, /wso2-docs\.mjs "\$\{args\[@\]\}"/);
  assert.match(fs.readFileSync(path.join(root, '.github', 'workflows', 'pr-preview.yml'), 'utf8'), /args=\(check "\$DIR" --edition/);
  assert.match(steps.find((s) => s.name === 'Work out the Edition and the preview path').run, /editionForBranch/);
  assert.equal(steps.find((s) => s.uses === 'actions/upload-artifact@v4').with.name, 'docs-preview-${{ steps.what.outputs.space }}', 'one artifact per Doc space');
  const publish = wf('pr-preview-publish.yml').jobs.publish.steps;
  assert.equal(publish.find((s) => s.uses === 'actions/download-artifact@v4').with.pattern, 'docs-preview-*');
  assert.ok(steps.find((s) => s.name === 'Quality override').if.includes("'quality-override'"));
  assert.equal(steps.at(-1).if, "steps.check.outcome == 'failure' || steps.bundle.outcome == 'failure'", 'the preview uploads before the job fails');
  // The Docs bundle dry run (Docs bundles): in the same required check, no tag, nothing written.
  assert.match(steps.find((s) => s.id === 'bundle').run, /wso2-docs\.mjs bundle "\$DIR" --edition "\$EDITION" --dry-run/);
  assert.match(docs.jobs.review.if, /vars\.DOCS_AI_REVIEW_ENABLED == 'true'/, 'AI review is off until cutover');
  // The compose check on a PR to main, against the published manifest: no secrets, no other checkout.
  assert.equal(docs.jobs.compose.if, "github.event_name == 'pull_request' && github.base_ref == 'main'");
  assert.match(docs.jobs.compose.steps.at(-1).run, /wso2-release\.mjs compose --pr --published "\$PUBLISHED" --repo-dir content/);
  assert.deepEqual([...new Set(JSON.stringify(docs.jobs.compose).match(/secrets\.[A-Z_]+/g) ?? [])], ['secrets.DOCS_PLATFORM_READ_TOKEN'], 'no release secret in the PR check');
  assert.deepEqual(docs.jobs.checks.needs, ['plan', 'preview', 'compose'], 'the required status sums up the compose check too');
  const sync = yaml.load(tpl('.github/workflows/docs-sync.yml'));
  assert.deepEqual(Object.keys(sync.on), ['workflow_dispatch'], 'optional: by hand until a team schedules it');
  assert.equal(sync.jobs['by-hand'].uses, 'wso2/docs-platform/.github/workflows/spec-sync.yml@v1');
  assert.match(fs.readFileSync(path.join(root, '.github', 'workflows', 'spec-sync.yml'), 'utf8'), /content-spec-path: api-manager\/docs\/reference\/apis\/publisher\/openapi\.yaml\n#\s+base-branch: api-manager\/release\/4\.7\.0/, "spec-sync's example follows the <slug>/ layout");
  const build = fs.readFileSync(path.join(root, '.github', 'workflows', 'build-deployment.yml'), 'utf8');
  assert.match(build, /wso2-docs\.mjs check "\$SRC" --release --edition "\$EDITION" --manifest "\$RUNNER_TEMP\/inputs\/composed\.json" --build-dir build --routes "\$RUNNER_TEMP\/inputs\/routes"/);
  assert.match(build, /args=\(build "\$SRC" --edition "\$EDITION"/, 'the build reads the Doc space directory');
  assert.match(build, /elif \[ -n "\$BUNDLE_DIR" \]; then dir="\$BUNDLE_DIR"/, 'from the unpacked bundle');
  assert.match(build, /else dir="content\/\$DIR"/, 'or, for the Platform\'s own Doc space, its directory at the tag');
  for (const name of ['nightly-reports.yml', 'weekly-digest.yml']) assert.ok(wf(name).on.schedule, name);
  assert.deepEqual(Object.keys(wf('nightly-reports.yml').jobs), ['plan', 'crawl', 'accessibility', 'search-consistency', 'lint-counts']);
});

test('the Sandbox Doc space is staging only', () => {
  const policy = loadPolicy();
  assert.ok(policy.docSpaces.sandbox);
  assert.ok(!publicManifest(policy, { environment: 'production' }).docSpaces.sandbox);
  assert.ok(publicManifest(policy, { environment: 'staging' }).docSpaces.sandbox);
  assert.ok(!liveSpaces(policy).some((s) => s.space === 'sandbox'));
  assert.ok(!liveSpaces(policy).some((s) => policy.docSpaces[s.space].status === 'legacy'));
});

test('weekly digest: every source, and "not available" without credentials', async () => {
  const empty = await collectDigest({ space: 'identity-platform', repo: 'wso2/docs-is', env: {}, now: Date.parse('2026-10-21') });
  for (const k of ['helpfulness', 'notFound', 'noResults', 'issues']) assert.ok(empty.data[k].unavailable, k);
  assert.match(renderDigest(empty), /_Not available: needs CLOUDFLARE_ACCOUNT_ID/);

  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, body: init.body });
    const json = (data) => ({ ok: true, json: async () => data });
    if (url.includes('analytics_engine') && init.body.includes('docs_feedback')) {
      return json({ data: [{ page: '/identity-platform/cloud/guides/mfa/', vote: 'no', reason: 'missing information', votes: '3' }, { page: '/identity-platform/cloud/guides/mfa/', vote: 'yes', reason: '', votes: '1' }] });
    }
    if (url.includes('analytics_engine')) return json({ data: [{ path: '/identity-platform/cloud/old/', referer: 'example.com', hits: '7' }] });
    if (url.includes('typesense')) return json({ hits: [{ document: { q: 'passkey', count: 5 } }] });
    return json({ items: [{ number: 12, title: 'Step 3 fails', html_url: 'https://github.com/wso2/docs-is/issues/12', body: 'Page: https://docs.wso2.com/identity-platform/cloud/guides/mfa/' }] });
  };
  const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 't', TYPESENSE_HOST: 'https://typesense.example', TYPESENSE_API_KEY: 'k', GITHUB_TOKEN: 'g' };
  const d = await collectDigest({ space: 'identity-platform', repo: 'wso2/docs-is', env, fetchImpl: fakeFetch, now: Date.parse('2026-10-21') });
  const md = renderDigest(d, { displayName: 'WSO2 Identity Platform' });
  assert.match(md, /\| \/identity-platform\/cloud\/guides\/mfa\/ \| 1 \| 3 \| 25% \| missing information \|/);
  assert.match(md, /\| passkey \| 5 \|/);
  assert.match(md, /\| \/identity-platform\/cloud\/old\/ \| 7 \| example\.com \|/);
  assert.match(md, /\[#12 Step 3 fails\]/);
  assert.ok(calls.some((c) => /index1 = 'identity-platform'/.test(c.body ?? '')), 'queries are scoped to the Doc space');
});

test('report helpers: lint counts and a stable accessibility sample', () => {
  const report = { docSpace: 'x', edition: 'cloud', summary: { blocking: 0 }, checks: [{ id: 'vale', findings: [1, 2] }, { id: 'spelling', findings: [1] }, { id: 'headings', skipped: 'no' , findings: [] }] };
  assert.match(lintCounts([report]), /\| x \| cloud \| 2 \| 1 \| skipped \| 0 \|/);
  const urls = Array.from({ length: 100 }, (_, i) => `u${i}`);
  assert.deepEqual(sampleUrls(urls, 5, '2026-10-21'), sampleUrls(urls, 5, '2026-10-21'));
  assert.equal(new Set(sampleUrls(urls, 5, 'a')).size, 5);
  assert.equal(sampleUrls(urls, 0, 'a').length, 100);
});

// The local docs-sandbox Content repo (not part of this repo): set
// WSO2_DOCS_SANDBOX to its path to check both of its Editions.
test('docs-sandbox passes the checks on main and release/1.0.0', { skip: !process.env.WSO2_DOCS_SANDBOX && 'set WSO2_DOCS_SANDBOX', timeout: 900_000 }, async () => {
  const dir = process.env.WSO2_DOCS_SANDBOX;
  const routes = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-docs-routes-'));
  fs.mkdirSync(path.join(routes, 'contribute'));
  fs.copyFileSync(path.join(out, '_platform', 'pages.json'), path.join(routes, 'contribute', 'pages.json'));
  for (const edition of ['cloud', '1.0.0']) {
    const r = await runCheck({ repo: loadContentRepo(dir), edition, base: 'main', routes, requireRoutes: true });
    assert.equal(r.result, 'pass', formatText(r));
    assert.equal(r.checks.find((c) => c.id === 'preview-build').status, 'pass');
  }
});
