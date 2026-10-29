// The converter path for an MkDocs build that keeps every version as folders
// (Convert API Platform Cloud and AI Gateway): wso2/docs-api-platform becomes
// api-platform/ (API Platform Cloud, family-level, Cloud only) and
// ai-gateway/ (main = its Cloud part, seeded from next/ plus the Cloud-only
// pages; ai-gateway/release/<version> from the version folders) in one
// Content repo. The mini fixture (fixtures/mkdocs-api-platform-mini) is
// converted with the real product configs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { matchPages, navSection, outsideLinks, scopeRedirects, selectView } from '../migration/lib/folders.mjs';
import { loadMkdocs, listMarkdown, mkdocsUrl } from '../migration/lib/mkdocs.mjs';
import { coverage, inScopeOf, parity } from '../migration/lib/verify.mjs';
import { DATE_VERSION, editionFromId, isExactVersion, matches, validateMarker, versionSemver } from '../lib/edition.mjs';
import { editionRank } from '../lib/search/schema.mjs';
import { compose, readInputs } from '../lib/compose.mjs';
import { planVersionRelease } from '../lib/content-repo.mjs';
import { validate } from '../lib/schemas.mjs';
import aig from '../migration/products/ai-gateway.mjs';
import platform from '../migration/products/api-platform.mjs';
import agw from '../migration/products/api-gateway.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const fixture = path.join(root, 'fixtures', 'mkdocs-api-platform-mini');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `wso2-${name}-`));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const LEGACY = 'https://wso2.com/api-platform/docs/';

test('Cloud pages pair with main-line pages of the same name: the same path, else one file name; index and README are no names', () => {
  const seed = ['overview.md', 'quick-start-guide.md', 'agent-governance/quick-start-guide.md', 'semantic-caching.md', 'analytics/index.md', 'reference/llm-templates.md'];
  const cloud = ['overview.md', 'llm/quick-start-guide.md', 'mcp/quick-start-guide.md', 'llm/semantic-caching.md', 'llm/index.md', 'analytics/index.md', 'llm/llm-templates.md', 'llm/guard.md'];
  const m = matchPages(seed, cloud);
  assert.deepEqual(m.matches, [
    { cloud: 'overview.md', seed: 'overview.md', how: 'same path' },
    { cloud: 'analytics/index.md', seed: 'analytics/index.md', how: 'same path' },
    { cloud: 'llm/semantic-caching.md', seed: 'semantic-caching.md', how: 'same file name' },
    { cloud: 'llm/llm-templates.md', seed: 'reference/llm-templates.md', how: 'same file name' },
  ]);
  assert.deepEqual(m.unmatched, ['llm/quick-start-guide.md', 'mcp/quick-start-guide.md', 'llm/index.md', 'llm/guard.md'], 'a file name several pages share pairs nothing; index is no name');
  assert.deepEqual(m.ambiguous.map((a) => a.cloud), ['llm/quick-start-guide.md', 'mcp/quick-start-guide.md']);
  assert.deepEqual(matchPages(['a.md'], ['x/a.md', 'y/a.md']).matches, [], 'two Cloud pages for one name: neither pairs');
});

test('a view of the one MkDocs site: a version folder, the main line with its Cloud sub-section, or the site without the version folders', () => {
  const mk = loadMkdocs(path.join(fixture, 'en'));
  const files = listMarkdown(mk.docsDir);
  assert.throws(() => navSection(mk.nav, ['AI Gateway', '9.9.9']), /no section AI Gateway > 9\.9\.9/);
  // A release branch: the version's folder; a site-wide page its nav lists stays out.
  const rel = selectView({ nav: mk.nav, files, view: aig.view('2026.09.24') });
  assert.deepEqual(rel.pageFiles, ['ai-gateway/2026.09.24/overview.md', 'ai-gateway/2026.09.24/quick-start-guide.md']);
  assert.deepEqual(rel.nav.map((n) => n.label), ['Overview', 'Quick Start Guide']);
  // The main line: next/, plus the Cloud page no next/ page shares a name with.
  const main = selectView({ nav: mk.nav, files, view: aig.view('cloud') });
  assert.deepEqual([...main.cloudOnly], ['cloud/ai-gateway/llm/guard.md']);
  assert.deepEqual(main.aliases, [
    { from: 'cloud/ai-gateway/analytics/moesif.md', to: 'ai-gateway/next/analytics/moesif.md' },
    { from: 'cloud/ai-gateway/overview.md', to: 'ai-gateway/next/overview.md' },
  ]);
  assert.deepEqual(main.nav.map((n) => n.label), ['Overview', 'Setup and Deployment', 'Analytics', 'LLM'], 'Guides (site-wide pages) leaves; Cloud sections merge or append');
  assert.equal(main.nav.find((n) => n.label === 'Analytics').children.length, 1, 'the paired Cloud page is not added');
  assert.equal(main.unlistedTargets['ai-gateway/next/README.md'], 'concepts/key-concepts');
  assert.ok(main.inScope('cloud/ai-gateway/x.md') && main.inScope('ai-gateway/next/x.md') && !main.inScope('ai-gateway/2026.09.24/x.md'));
  // API Platform Cloud: the whole site but the version folders and the part; Cloud spliced.
  const fam = selectView({ nav: mk.nav, files, view: platform.view('cloud') });
  assert.deepEqual(fam.nav.map((n) => n.label), ['Overview', 'Get Started', 'Introduction', 'Third-Party Gateways', 'Monetization', 'Guides'], 'the API Gateway Cloud section that is not the part (cloud/federation/) stays, one level up');
  assert.ok(fam.pageFiles.every((f) => !/^(ai-gateway|api-gateway|cloud\/ai-gateway|cloud\/api-platform-gateway)\//.test(f)), fam.pageFiles.join(', '));
  assert.ok(fam.pageFiles.includes('cloud/federation/overview.md'));
  // API Gateway: a version folder; the main line is next/ plus the Cloud
  // sub-section's folder (cloud/api-platform-gateway/), not the other folder
  // its Cloud section lists.
  assert.deepEqual(selectView({ nav: mk.nav, files, view: agw.view('1.2.0') }).pageFiles, ['api-gateway/1.2.0/overview.md']);
  const gw = selectView({ nav: mk.nav, files, view: agw.view('cloud') });
  assert.deepEqual([...gw.cloudOnly], ['cloud/api-platform-gateway/getting-started.md']);
  assert.deepEqual(gw.aliases, [{ from: 'cloud/api-platform-gateway/writing-a-custom-policy.md', to: 'api-gateway/next/policies/writing-a-custom-policy.md' }]);
  assert.deepEqual(gw.nav.map((n) => n.label), ['Overview', 'Policies', 'Self-Hosted Gateway']);
  assert.ok(!gw.inScope('cloud/federation/overview.md'));
  assert.ok(fam.pageFiles.includes('guides/shared.md'));
  // Redirects: those from or to a page in the view.
  const redirects = [
    { from: 'ai-gateway/legacy-page.md', to: 'ai-gateway/2026.09.24/overview.md' },
    { from: 'cloud/ai-gateway/moved-guide.md', to: 'guides/shared.md' },
    { from: 'old/away.md', to: 'https://example.com/' },
  ];
  assert.deepEqual(scopeRedirects(redirects, rel.inScope).map((r) => r.from), ['ai-gateway/legacy-page.md']);
  assert.deepEqual(scopeRedirects(redirects, fam.inScope).map((r) => r.from), ['cloud/ai-gateway/moved-guide.md', 'old/away.md'], 'the site-wide view keeps the site\'s other old URLs');
});

test('a link that leaves the view goes to the Doc space that now holds the page, else to the legacy site', () => {
  const mk = loadMkdocs(path.join(fixture, 'en'));
  const files = listMarkdown(mk.docsDir);
  const siblings = [{ slug: 'api-platform', edition: 'cloud', map: new Map([[`${LEGACY}guides/shared/`, 'guides/shared'], [`${LEGACY}`, ''], [`${LEGACY}away/`, 'https://example.com/x']]) }];
  const out = outsideLinks({ files, redirectMap: new Map([['old/shared', 'guides/shared.md']]), legacyBase: LEGACY, siblings });
  assert.deepEqual(out('/guides/shared.md', 'step-2'), { href: 'docs:api-platform/cloud/guides/shared/#step-2', docSpace: 'api-platform' });
  assert.deepEqual(out('/old/shared'), { href: 'docs:api-platform/cloud/guides/shared/', docSpace: 'api-platform' }, 'through a legacy redirect');
  assert.deepEqual(out('/'), { href: 'docs:api-platform/cloud/', docSpace: 'api-platform' }, 'a sibling\'s home');
  assert.deepEqual(out('/ai-gateway/2026.09.24/quick-start-guide.md'), { href: `${LEGACY}ai-gateway/2026.09.24/quick-start-guide/`, legacy: true });
  assert.deepEqual(out('/ai-gateway/next/'), { href: `${LEGACY}ai-gateway/next/`, legacy: true }, 'a folder\'s README is its index');
  assert.equal(out('/nowhere.md'), null);
  assert.equal(mkdocsUrl('ai-gateway/next/README.md'), 'ai-gateway/next/');
});

test('date versions are exact versions: 2026.09.24 builds, marks and ranks, while readers keep manifest order', () => {
  assert.ok(DATE_VERSION.test('2026.09.24') && isExactVersion('2026.09.24') && !isExactVersion('2026.9'));
  assert.deepEqual(editionFromId('2026.09.24'), { id: '2026.09.24', kind: 'self-hosted', version: '2026.09.24' });
  assert.equal(versionSemver('2026.09.24'), '2026.9.24');
  assert.doesNotThrow(() => validateMarker({ selfHostedFrom: '2026.09.24' }, 'x'));
  assert.ok(matches(editionFromId('2026.09.24'), { selfHostedFrom: '1.2.0' }));
  assert.ok(!matches(editionFromId('1.2.0'), { selfHostedFrom: '2026.09.24' }));
  assert.ok(editionRank('2026.09.24') > editionRank('1.2.0'));
  assert.throws(() => editionFromId('26.9'), /Unknown edition/);
  // The Doc space manifest lists 1.2.0 first (the legacy site's default, "Latest LTS"): latest is 1.2.0.
  const nav = path.join(root, 'navigation');
  const { manifest, issues } = compose(readInputs({ navigationDir: nav, contentDir: path.join(root, 'fixtures', 'content-repos') }));
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
  const s = manifest.docSpaces['ai-gateway'];
  assert.deepEqual(s.editions.map((e) => e.id), ['1.2.0', '2026.09.24', '1.1.0', '1.0.0']);
  assert.equal(s.latest, '1.2.0');
  assert.deepEqual(s.editions.slice(0, 2).map((e) => e.branch), ['ai-gateway/release/1.2.0', 'ai-gateway/release/2026.09.24']);
  const dirs = [{ dir: 'ai-gateway', docspace: aig.docspace }, { dir: 'api-platform', docspace: platform.docspace }];
  assert.deepEqual(planVersionRelease({ dirs, space: 'ai-gateway', version: '2026.09.24' }), [{ slug: 'ai-gateway', tagPrefix: 'ai-gateway/', ref: 'ai-gateway/release/2026.09.24', version: '2026.09.24' }]);
});

test('the manifests the configs write are valid and point at each other (family Cloud and its parts)', () => {
  for (const c of [aig, agw, platform]) assert.deepEqual(validate('docspace', c.docspace), [], c.slug);
  assert.deepEqual(platform.docspace.editions, [{ id: 'cloud', parts: ['ai-gateway', 'api-gateway'] }]);
  assert.deepEqual(aig.docspace.cloud, { in: 'api-platform' });
  assert.deepEqual(agw.docspace.cloud, { in: 'api-platform' });
  assert.deepEqual(agw.docspace.editions.map((e) => e.id), ['1.2.0', '1.1.0', '1.0.0'], 'product placement: three Editions, newest first');
  assert.equal(platform.kind, 'family');
  assert.ok(!platform.overview, 'API Platform Cloud has pages of its own, not only an overview');
  assert.deepEqual(platform.parts.map((p) => p.docSpace), platform.docspace.editions[0].parts);
});

test('sync: API Platform Cloud and AI Gateway in one Content repo; main, a date-versioned release branch, the diff report and legacy coverage', async () => {
  const work = tmp('folders');
  const src = path.join(work, 'docs-api-platform-source');
  fs.cpSync(fixture, src, { recursive: true });
  git(src, 'init', '-q', '-b', 'main');
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', 'source');
  const repo = path.join(work, 'docs-api-platform');
  const sync = (...args) => spawnSync(process.execPath, [path.join(root, 'migration', 'sync.mjs'), ...args, '--source', src, '--repo', repo, '--no-compile', '--trailer', 'Co-Authored-By: Test <test@example.invalid>'], {
    encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  });
  // The part first, then the family (its overview links into the part), then
  // the part again (its links reach the family's pages), then a release branch.
  for (const [p, b] of [['ai-gateway', 'main'], ['api-gateway', 'main'], ['api-platform', 'main'], ['ai-gateway', 'main'], ['api-gateway', 'main'], ['ai-gateway', 'ai-gateway/release/2026.09.24'], ['api-gateway', 'api-gateway/release/1.2.0']]) {
    const r = sync(p, '--branch', b);
    assert.equal(r.status, 0, `${p} ${b}: ${r.stdout}${r.stderr}`);
  }
  assert.match(sync('api-platform', '--branch', 'api-platform/release/1.0.0').stderr, /family-level Doc space: Cloud only, on main/);
  const show = (ref, f) => git(repo, 'show', `${ref}:${f}`);
  const files = (ref) => git(repo, 'ls-tree', '-r', '--name-only', ref).split('\n');

  // AI Gateway's main line: next/ plus the Cloud-only page, marked.
  const main = files('main');
  for (const f of ['ai-gateway/docs/index.mdx', 'ai-gateway/docs/deploy-and-operate/install.mdx', 'ai-gateway/docs/guides/analytics/moesif.mdx', 'ai-gateway/docs/guides/llm/guard.mdx', 'ai-gateway/docs/concepts/key-concepts.mdx', 'ai-gateway/.migration/cloud-diff.md']) assert.ok(main.includes(f), f);
  assert.ok(!main.some((f) => /^ai-gateway\/docs\/.*shared/.test(f)), 'the site-wide guide lives in API Platform Cloud');
  assert.match(show('main', 'ai-gateway/docs/guides/llm/guard.mdx'), /^editions: cloud$/m);
  assert.doesNotMatch(show('main', 'ai-gateway/docs/deploy-and-operate/install.mdx'), /^editions:/m);
  assert.match(show('main', 'ai-gateway/docs/index.mdx'), /The AI Gateway overview of the next release\./, 'the main line keeps next/\'s text');
  const install = show('main', 'ai-gateway/docs/deploy-and-operate/install.mdx');
  assert.match(install, /\[API Platform Cloud\]\(docs:api-platform\/cloud\/get-started\/what-is-api-platform-cloud\/\)/);
  assert.match(install, /\[shared guide\]\(docs:api-platform\/cloud\/guides\/shared\/\)/);
  assert.match(install, /\[2026\.09\.24 quick start\]\(https:\/\/wso2\.com\/api-platform\/docs\/ai-gateway\/2026\.09\.24\/quick-start-guide\/\)/, 'another version opens on the legacy site');
  assert.match(install, /!\[Diagram\]\(\.\.\/\.\.\/assets\/img\/a\.png\)/);
  assert.match(show('main', 'ai-gateway/docs/guides/llm/guard.mdx'), /^type: how-to$/m, 'the page type comes from content_type');
  const map = new Map(yaml.load(show('main', 'ai-gateway/redirects.yaml')).legacy.map((l) => [l.from, l.to]));
  assert.equal(map.get(`${LEGACY}cloud/ai-gateway/overview/`), '', 'a paired Cloud page maps to its main-line page');
  assert.equal(map.get(`${LEGACY}cloud/ai-gateway/llm/guard/`), 'guides/llm/guard');
  assert.equal(map.get(`${LEGACY}cloud/ai-gateway/llm/old-guard/`), 'guides/llm/guard');
  assert.equal(map.get(`${LEGACY}ai-gateway/next/`), 'concepts/key-concepts', 'the folder\'s README');
  assert.equal(map.get(`${LEGACY}ai-gateway/next/setup-and-deployment/install/`), 'deploy-and-operate/install');
  assert.ok(!map.has(`${LEGACY}cloud/ai-gateway/moved-guide/`), 'a redirect to a page of another Doc space is that Doc space\'s');
  const diff = JSON.parse(show('main', 'ai-gateway/.migration/cloud-diff.json'));
  assert.deepEqual(diff.summary, { source: diff.summary.source, matched: 2, identical: 1, differ: 1, cloudOnly: 1, possibleCounterparts: 0 });
  assert.deepEqual(diff.pages.map((p) => [p.cloud, p.page, p.identical]), [['cloud/ai-gateway/analytics/moesif.md', 'guides/analytics/moesif', true], ['cloud/ai-gateway/overview.md', 'index', false]]);
  assert.match(show('main', 'ai-gateway/.migration/cloud-diff.md'), /```diff\n--- main line: ai-gateway\/next\/overview\.md\n\+\+\+ Cloud: cloud\/ai-gateway\/overview\.md[\s\S]*\+The Cloud text of the AI Gateway overview/);
  assert.deepEqual(yaml.load(show('main', 'ai-gateway/docspace.yaml')), aig.docspace);

  // API Platform Cloud: the skeleton, the products list, links into the part.
  for (const f of ['api-platform/docs/index.mdx', 'api-platform/docs/get-started/index.mdx', 'api-platform/docs/get-started/what-is-api-platform-cloud.mdx', 'api-platform/docs/guides/monetization/index.mdx', 'api-platform/docs/guides/shared.mdx']) assert.ok(main.includes(f), f);
  assert.ok(!main.some((f) => /^api-platform\/docs\/.*(ai-gateway|next)/.test(f)), 'no version folders and no part');
  const home = show('main', 'api-platform/docs/index.mdx');
  assert.match(home, /^description: The platform home, with its own description\.$/m, 'the legacy description is kept, not marked generated');
  assert.match(home, /^layout: overview$/m, 'the home is drawn as cards (pageLayouts)');
  assert.match(home, /## Products\n\n### AI Gateway\n\nGovern LLM, [^\n]+\n\n- \[AI Gateway Cloud\]\(docs:ai-gateway\/cloud\/\)\n- \[AI Gateway Self-hosted \(newest release\)\]\(docs:ai-gateway\/latest\/\)(\n|$)/);
  assert.match(home, /\[AI Gateway 2026\.09\.24\]\(https:\/\/wso2\.com\/api-platform\/docs\/ai-gateway\/2026\.09\.24\/overview\/\)/);
  const shared = show('main', 'api-platform/docs/guides/shared.mdx');
  assert.match(shared, /\[the guard\]\(docs:ai-gateway\/cloud\/guides\/llm\/guard\/\)/);
  assert.match(shared, /^## By use case$/m, 'a decorative inline icon goes');
  assert.doesNotMatch(shared, /<button|role="tab"/, 'a line of legacy tab buttons, inert without the legacy script, goes');
  assert.match(shared, /^Browse by use case or by provider\.$/m, 'the text around the tab buttons stays');
  assert.match(shared, /^- \[Get started\]\(\.\.\/get-started\/index\.mdx\)$/m, 'md_in_html: the Markdown inside <div markdown="1"> converts');
  assert.doesNotMatch(shared, /<div|markdown="1"|\\-/);
  const famMap = new Map(yaml.load(show('main', 'api-platform/redirects.yaml')).legacy.map((l) => [l.from, l.to]));
  assert.equal(famMap.get(`${LEGACY}cloud/ai-gateway/moved-guide/`), 'guides/shared');
  assert.equal(famMap.get(`${LEGACY}monetization/overview/`), 'guides/monetization');
  assert.equal(famMap.get(`${LEGACY}next/`), '', 'the unreleased home goes to the home');
  assert.deepEqual(yaml.load(show('main', 'api-platform/docspace.yaml')), platform.docspace);
  assert.match(show('main', 'README.md'), /\| `api-platform\/` \| API Platform Cloud \| Cloud on `main` \(Cloud parts: ai-gateway, api-gateway\) \|/);
  assert.match(home, /### API Gateway\n\n[^\n]+\n\n- \[API Gateway Cloud\]\(docs:api-gateway\/cloud\/\)\n- \[API Gateway Self-hosted \(newest release\)\]\(docs:api-gateway\/latest\/\)/);
  assert.match(show('main', 'api-platform/docs/guides/third-party-gateways/overview.mdx'), /\[self-hosted gateway\]\(docs:api-gateway\/cloud\/guides\/self-hosted-gateway\/getting-started\/\)/, 'a link into API Gateway\'s Cloud part');

  // API Gateway's main line: next/ plus its Cloud-only page; the federation page is not its.
  for (const f of ['api-gateway/docs/index.mdx', 'api-gateway/docs/guides/policies/writing-a-custom-policy.mdx', 'api-gateway/docs/guides/self-hosted-gateway/getting-started.mdx']) assert.ok(main.includes(f), f);
  assert.ok(!main.some((f) => /^api-gateway\/docs\/.*(federation|third-party)/.test(f)));
  const gs = show('main', 'api-gateway/docs/guides/self-hosted-gateway/getting-started.mdx');
  assert.match(gs, /^editions: cloud$/m);
  assert.match(gs, /\[federation\]\(docs:api-platform\/cloud\/guides\/third-party-gateways\/overview\/\)/);
  const gwMap = new Map(yaml.load(show('main', 'api-gateway/redirects.yaml')).legacy.map((l) => [l.from, l.to]));
  assert.equal(gwMap.get(`${LEGACY}cloud/api-platform-gateway/writing-a-custom-policy/`), 'guides/policies/writing-a-custom-policy', 'a paired Cloud page maps to its main-line page');
  assert.deepEqual(yaml.load(show('main', 'api-gateway/docspace.yaml')), agw.docspace);
  const gwRel = 'api-gateway/release/1.2.0';
  assert.ok(git(repo, 'diff', '--name-only', 'main', gwRel).split('\n').every((f) => f.startsWith('api-gateway/')));
  assert.deepEqual(files(gwRel).filter((f) => f.startsWith('api-gateway/docs/') && f.endsWith('.mdx')), ['api-gateway/docs/index.mdx']);
  assert.match(show('main', 'README.md'), /\| `ai-gateway\/` \| AI Gateway \| 1\.2\.0 on `ai-gateway\/release\/1\.2\.0`; 2026\.09\.24 on `ai-gateway\/release\/2026\.09\.24`; its Cloud part of api-platform on `main` \|/);

  // The date-versioned release branch: its folder only; only ai-gateway/ changed.
  const rel = 'ai-gateway/release/2026.09.24';
  const changed = git(repo, 'diff', '--name-only', 'main', rel).split('\n');
  assert.ok(changed.every((f) => f.startsWith('ai-gateway/')), changed.join(', '));
  const relDocs = files(rel).filter((f) => f.startsWith('ai-gateway/docs/') && f.endsWith('.mdx')).sort();
  assert.deepEqual(relDocs, ['ai-gateway/docs/get-started/quick-start-guide.mdx', 'ai-gateway/docs/index.mdx']);
  assert.ok(!files(rel).includes('ai-gateway/.migration/cloud-diff.md'), 'no Cloud sub-section on a release branch');
  const relMap = new Map(yaml.load(show(rel, 'ai-gateway/redirects.yaml')).legacy.map((l) => [l.from, l.to]));
  assert.equal(relMap.get(`${LEGACY}ai-gateway/legacy-page/`), '', 'an old unversioned URL redirected into this version');
  assert.match(git(repo, 'log', '-1', '--format=%s', rel), /^Convert AI Gateway 2026\.09\.24 from wso2\/docs-api-platform@[0-9a-f]{40}$/);

  // Legacy coverage, scoped to the Doc space's folders of the one site.
  git(repo, 'checkout', '-q', rel);
  const build = path.join(work, 'build');
  fs.mkdirSync(path.join(build, '_platform'), { recursive: true });
  fs.writeFileSync(path.join(build, '_platform', 'pages.json'), JSON.stringify([{ path: '' }, { path: 'get-started/quick-start-guide/' }]));
  const sitemapXml = `<urlset><url><loc>${LEGACY}ai-gateway/2026.09.24/overview/</loc></url><url><loc>${LEGACY}cloud/ai-gateway/overview/</loc></url></urlset>`;
  const cov = coverage({ repoDir: path.join(repo, 'ai-gateway'), buildDir: build, sourceRoot: path.join(src, 'en'), legacyBase: LEGACY, sitemapXml, scope: ['ai-gateway/2026.09.24'] });
  assert.deepEqual([cov.nav.total, cov.nav.live, cov.sitemap.total, cov.sitemap.live, cov.redirects.total, cov.redirects.live], [2, 2, 1, 1, 1, 1]);
  // The same Doc space mounted in another build (a Cloud part in its platform's Cloud tree, at ai-gateway/).
  const tree = path.join(work, 'tree');
  fs.mkdirSync(path.join(tree, '_platform'), { recursive: true });
  fs.writeFileSync(path.join(tree, '_platform', 'pages.json'), JSON.stringify([{ path: '' }, { path: 'ai-gateway/' }, { path: 'ai-gateway/get-started/quick-start-guide/' }, { path: 'get-started/quick-start-guide/x/' }]));
  const mounted = coverage({ repoDir: path.join(repo, 'ai-gateway'), buildDir: tree, sourceRoot: path.join(src, 'en'), legacyBase: LEGACY, sitemapXml, scope: ['ai-gateway/2026.09.24'], mount: 'ai-gateway/' });
  assert.deepEqual([mounted.nav.live, mounted.sitemap.live, mounted.redirects.live], [2, 1, 1]);
  assert.deepEqual(mounted.sitemap.urls, [`${LEGACY}ai-gateway/2026.09.24/overview/`], 'the URLs checked are listed, for a check through the edge');
  const unmounted = coverage({ repoDir: path.join(repo, 'ai-gateway'), buildDir: tree, sourceRoot: path.join(src, 'en'), legacyBase: LEGACY, sitemapXml, scope: ['ai-gateway/2026.09.24'] });
  assert.ok(unmounted.nav.dead.length > 0, 'without the mount the part\'s targets are not the tree\'s pages');
  // Parity reads the part's pages inside the tree build too.
  const cache = path.join(work, 'parity-cache');
  fs.mkdirSync(cache, { recursive: true });
  const legacyHome = `${LEGACY}ai-gateway/2026.09.24/overview/`;
  fs.writeFileSync(path.join(cache, `${encodeURIComponent(legacyHome)}.html`), '<html><body><article class="md-content__inner md-typeset"><h1>Overview</h1><p>Govern every model call through one gateway.</p></article></body></html>');
  fs.mkdirSync(path.join(tree, 'ai-gateway'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'ai-gateway', 'index.html'), '<html><body><article><h1>Overview</h1><p>Govern every model call through one gateway.</p></article></body></html>');
  const par = await parity({ repoDir: path.join(repo, 'ai-gateway'), buildDir: tree, sourceRoot: path.join(src, 'en'), legacyBase: LEGACY, sample: 50, cacheDir: cache, include: ['ai-gateway/2026.09.24/overview/'], mount: 'ai-gateway/' });
  const mountedHome = par.find((x) => x.from === legacyHome);
  assert.ok(mountedHome && mountedHome.f1 === 1, `the mounted page is compared: ${JSON.stringify(mountedHome && { to: mountedHome.to, f1: mountedHome.f1 })}`);
  assert.ok(inScopeOf(['cloud/ai-gateway'], ['cloud/ai-gateway/x'])('cloud/ai-gateway/a.md') && !inScopeOf(['cloud/ai-gateway'], ['cloud/ai-gateway/x'])('cloud/ai-gateway/x/a.md'));
  git(repo, 'checkout', '-q', 'main');
  const also = coverage({
    repoDir: path.join(repo, 'ai-gateway'), buildDir: build, sourceRoot: path.join(src, 'en'), legacyBase: LEGACY, sitemapXml: null,
    scope: ['ai-gateway/next', 'cloud/ai-gateway'], also: [path.join(repo, 'api-platform', 'redirects.yaml')],
  });
  assert.deepEqual(also.redirects.otherDocSpace, [`${LEGACY}cloud/ai-gateway/moved-guide/ → api-platform:guides/shared`]);
  fs.rmSync(work, { recursive: true, force: true });
});
