// End-to-end: builds the stub Content repo as several Editions and checks the
// built HTML. Builds run one after another because they share site/.docusaurus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { collectOperations } from '../../lib/openapi.mjs';
import { checkBuild } from '../../lib/release.mjs';
import { themeBase, themeMajor } from '../../lib/theme-bundle.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// A small Content repo in the Pilot's layout: identity-platform/ (the family
// Cloud) and identity-server/ (its Cloud part on main, plus 7.3.0 and 7.2.0).
const fixture = path.join(root, 'fixtures', 'stub-repo', 'identity-server');
const family = path.join(root, 'fixtures', 'stub-repo', 'identity-platform');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-docs-test-'));

// `in`: the Content directory to build (default the Identity Server stub);
// `at`: where its pages are inside the build ('identity-server/' for the
// Cloud part in the family Cloud tree), for html(), has() and pathOf().
function build(name, ...args) {
  const dir = path.join(out, name);
  const env = typeof args.at(-1) === 'object' ? args.pop() : {};
  const o = typeof args[0] === 'object' ? args.shift() : {};
  const content = args[0] === '--landing' ? [] : [o.in ?? fixture];
  const at = o.at ?? '';
  execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'build', ...content, '--out', dir, ...args], { stdio: 'pipe', env: { ...process.env, ...env } });
  return {
    dir,
    text: (f) => fs.readFileSync(path.join(dir, f), 'utf8'),
    assets: () => fs.readdirSync(path.join(dir, 'assets', 'js')).map((f) => fs.readFileSync(path.join(dir, 'assets', 'js', f), 'utf8')).join('\n'),
    html: (page) => fs.readFileSync(path.join(dir, at, page, 'index.html'), 'utf8'),
    has: (page) => fs.existsSync(path.join(dir, at, page, 'index.html')),
    pathOf: (f) => path.join(dir, at, f),
    root: (page) => fs.readFileSync(path.join(dir, page, 'index.html'), 'utf8'),
    json: (file) => JSON.parse(fs.readFileSync(path.join(dir, '_platform', file), 'utf8')),
    sitemap: () => [...fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]),
  };
}

const canonical = (html) => /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/.exec(html)[1];
const plain = (html) => html.replace(/<[^>]+>/g, '');
const title = (html) => /<title[^>]*>([^<]*)<\/title>/.exec(html)[1];
const between = (html, start, end) => { const i = html.indexOf(start); return i < 0 ? '' : html.slice(i, html.indexOf(end, i)); };
const navbar = (html) => between(html, '<nav aria-label="Main"', '</nav>');
const editionMenu = (html) => { const d = between(navbar(html), 'wso2-edition-dropdown', 'theme-layout-navbar-right'); return d.slice(d.indexOf('wso2-menu__panel')); };
const editionButton = (html) => /wso2-edition-dropdown.*?wso2-menu__button-text">([^<]*)</.exec(html)?.[1];
const count = (html, re) => (html.match(re) ?? []).length;

test('Cloud (the part in its family Cloud tree) and 7.3.0 build from the same tree with markers filtered', { timeout: 600_000 }, async (t) => {
  const c = build('cloud', { in: family, at: 'identity-server/' }, '--edition', 'cloud', '--env', 'production');
  const s = build('730', '--edition', '7.3.0');

  await t.test('section and inline markers', () => {
    const cq = c.html('get-started/quick-start');
    const sq = s.html('get-started/quick-start');
    for (const m of ['MARKER-CLOUD-ONLY', 'MARKER-FROM-730', 'MARKER-FROM-740', 'MARKER-FROM-NEXT', 'your organization URL']) assert.match(cq, new RegExp(m));
    // Edition variants: each Edition, Cloud included, shows only its own form.
    for (const m of ['MARKER-SELF-HOSTED-ONLY', 'port 9443', 'MARKER-SELF-HOSTED-NEXT']) assert.doesNotMatch(cq, new RegExp(m));
    for (const m of ['MARKER-SELF-HOSTED-ONLY', 'MARKER-FROM-730', 'port 9443', 'MARKER-SELF-HOSTED-ADDITION']) assert.match(sq, new RegExp(m));
    for (const m of ['MARKER-CLOUD-ONLY', 'MARKER-FROM-740', 'MARKER-FROM-NEXT', 'MARKER-SELF-HOSTED-NEXT', 'your organization URL', 'data-self-hosted']) assert.doesNotMatch(sq, new RegExp(m));
  });

  await t.test('Cloud shows Self-hosted additions, labelled, with the newest release\'s variables', () => {
    const cq = c.html('get-started/quick-start');
    const box = between(cq, 'data-self-hosted="block"', '</section>');
    assert.match(box, /MARKER-SELF-HOSTED-ADDITION/);
    assert.match(box, /Self-hosted<\/span>/, 'labelled in text');
    assert.match(box, /<a [^>]*href="\/identity-server\/latest\/get-started\/quick-start\/"[^>]*>See it in <!-- -->Identity Server 7\.3\.0<\/a>/);
    assert.match(plain(box), /Raise the heap of WSO2 Identity Server 7\.3\.0 at https:\/\/localhost:9443\/console/, 'self-hosted: variables, {edition.version} the newest release');
    assert.match(cq, /id="tune-the-server"/, 'its heading is in the TOC');
    // A Self-hosted-only page without a Cloud counterpart: in Cloud, badged, its canonical under /latest/.
    const install = c.html('deploy-and-operate/install');
    assert.match(install, /data-self-hosted="page"/);
    assert.match(plain(install), /Then open https:\/\/localhost:9443\/console for WSO2 Identity Server 7\.3\.0\./);
    assert.equal(canonical(install), 'https://docs.wso2.com/identity-server/latest/deploy-and-operate/install/');
    assert.ok(!c.sitemap().includes('https://docs.wso2.com/identity-platform/cloud/identity-server/deploy-and-operate/install/'));
    const records = c.json('search-records.json');
    assert.ok(records.filter((r) => r.url.includes('/deploy-and-operate/install/')).every((r) => r.selfHosted === true && r.edition === 'cloud'), 'in Cloud\'s records, tagged');
    assert.ok(records.some((r) => r.url.endsWith('quick-start/#tune-the-server') && r.selfHosted === true));
    assert.ok(!records.some((r) => r.url.endsWith('quick-start/#register-an-application') && r.selfHosted));
    // A Self-hosted-only page with a Cloud counterpart stays out of Cloud; 7.3.0 names it in pages.json.
    assert.ok(!c.has('guides/server-licensing') && s.has('guides/server-licensing'));
    assert.equal(s.json('pages.json').find((p) => p.path === 'guides/server-licensing/').cloudCounterpart, 'guides/cloud-billing/');
    // Twins and llms.txt: the `**Self-hosted only.**` line.
    assert.match(c.text('identity-server/get-started/quick-start.md'), /\*\*Self-hosted only\.\*\*\n\n## Tune the server/);
    assert.match(c.text('identity-server/deploy-and-operate/install.md'), /canonical: https:\/\/docs\.wso2\.com\/identity-server\/latest\/deploy-and-operate\/install\/\n[^]*# Install\n\n\*\*Self-hosted only\.\*\*\n/);
    assert.match(c.text('identity-server/llms.txt'), /\[Install\]\([^)]*install\.md\): \*\*Self-hosted only\.\*\* Install the server on a Linux host\./);
    assert.doesNotMatch(s.text('get-started/quick-start.md'), /Self-hosted only/);
  });

  await t.test('a link inside a Self-hosted addition that Cloud cannot resolve goes to the same page under /latest/', () => {
    // An anchor only the Self-hosted form of a <Variants> has, and a page Cloud leaves out (it names a Cloud counterpart).
    const install = c.html('deploy-and-operate/install');
    assert.match(install, /<a href="https:\/\/docs\.wso2\.com\/identity-server\/latest\/get-started\/quick-start\/#start-the-server" data-docs-link="">start the server<\/a>/);
    assert.match(install, /<a href="https:\/\/docs\.wso2\.com\/identity-server\/latest\/guides\/server-licensing\/" data-docs-link="">licensing terms<\/a>/);
    assert.match(install, /href="\/identity-platform\/cloud\/identity-server\/get-started\/quick-start\/#register-an-application">register an application/, 'a link Cloud resolves stays');
    assert.match(between(c.html('get-started/quick-start'), 'data-self-hosted="block"', '</section>'), /href="https:\/\/docs\.wso2\.com\/identity-server\/latest\/get-started\/quick-start\/#start-the-server"/, 'in an addition block, a same-page anchor');
    assert.match(c.text('identity-server/deploy-and-operate/install.md'), /\[start the server\]\(https:\/\/docs\.wso2\.com\/identity-server\/latest\/get-started\/quick-start\.md#start-the-server\)/);
    // The release keeps its own links.
    assert.match(s.html('deploy-and-operate/install'), /href="\/identity-server\/7\.3\.0\/get-started\/quick-start\/#start-the-server">start the server/);
    assert.match(s.html('get-started/quick-start'), /href="#start-the-server"[^>]*>start the server/);
  });

  await t.test('hidden headings never reach the table of contents', () => {
    const sq = s.html('get-started/quick-start');
    assert.doesNotMatch(sq, /agent-identities|Agent identities/);
    assert.doesNotMatch(sq, /create-your-organization/);
    assert.match(c.html('get-started/quick-start'), /href="#create-your-organization"/);
  });

  await t.test('markers inside partials', () => {
    assert.match(between(c.html('guides/mfa'), 'data-self-hosted="block"', '</section>'), /MARKER-PARTIAL-SELF-HOSTED/, 'a Self-hosted addition in a partial');
    assert.match(s.html('guides/mfa'), /MARKER-PARTIAL-SELF-HOSTED/);
  });

  await t.test('partials/ next to docs/: compiled with the same plugins, links to pages resolved', () => {
    assert.match(c.html('guides/mfa'), /MARKER-DOCSPACE-PARTIAL-CLOUD/);
    assert.doesNotMatch(c.html('guides/mfa'), /MARKER-DOCSPACE-PARTIAL-SELF-HOSTED/);
    assert.match(s.html('guides/mfa'), /MARKER-DOCSPACE-PARTIAL-SELF-HOSTED/);
    assert.doesNotMatch(s.html('guides/mfa'), /MARKER-DOCSPACE-PARTIAL-CLOUD/);
    assert.match(s.html('guides/mfa'), /href="\/identity-server\/7\.3\.0\/get-started\/quick-start\/"/);
    assert.ok(!c.has('partials/sign-in-options') && !s.has('sign-in-options'), 'a partial is never a page');
  });

  await t.test('<ThemedImage light dark alt>: both images bundled, one per theme; the twin keeps the light one', () => {
    const imgs = [...s.html('guides/mfa').matchAll(/<img [^>]*alt="Second-factor options in each theme"[^>]*>/g)].map((m) => m[0]);
    assert.equal(imgs.length, 2);
    assert.match(imgs[0], /src="\/identity-server\/7\.3\.0\/assets\/images\/mfa-options-light-[0-9a-f]+\.png"/);
    assert.match(imgs[0], /themedComponent--light/);
    assert.match(imgs[1], /src="\/identity-server\/7\.3\.0\/assets\/images\/mfa-options-dark-[0-9a-f]+\.png"/);
    assert.match(imgs[1], /themedComponent--dark/);
    assert.match(s.text('guides/mfa.md'), /!\[Second-factor options in each theme\]\(https:\/\/docs\.wso2\.com\/identity-server\/7\.3\.0\/assets\/images\/mfa-options-light-[0-9a-f]+\.png\)/);
    assert.doesNotMatch(s.text('guides/mfa.md'), /mfa-options-dark|ThemedImage/);
  });

  await t.test('page-level markers drop pages', () => {
    assert.ok(c.has('guides/cloud-billing') && !s.has('guides/cloud-billing'));
    assert.ok(c.has('guides/agent-identities') && !s.has('guides/agent-identities'));
    assert.ok(c.has('deploy-and-operate/install') && s.has('deploy-and-operate/install'), 'a Self-hosted-only page shows in Cloud');
  });

  await t.test('edition variables, in prose and code', () => {
    assert.match(c.html(''), /<h1>WSO2 Identity Platform documentation<\/h1>/);
    assert.match(s.html(''), /<h1>WSO2 Identity Server documentation<\/h1>/);
    assert.match(plain(s.html('get-started/quick-start')), /open https:\/\/localhost:9443\/console/);
    assert.doesNotMatch(s.html('get-started/quick-start'), /edition\./);
  });

  await t.test('docs: links are same-tab links to the target host', () => {
    const a = /<a [^>]*href="https:\/\/docs\.wso2\.com\/api-manager\/latest\/guides\/"[^>]*>/.exec(c.html(''));
    assert.ok(a, 'resolved link present');
    assert.doesNotMatch(a[0], /target=/);
  });

  await t.test('titles name the Edition', () => {
    assert.equal(title(c.html('get-started/quick-start')), 'Quick start | Identity Server Cloud | WSO2 Docs', 'a Cloud part\'s page names the part\'s Cloud Edition');
    assert.equal(title(c.root('get-started/first-organization')), 'Create your first organization | Identity Platform Cloud | WSO2 Docs');
    assert.equal(title(s.html('get-started/quick-start')), 'Quick start | Identity Server 7.3.0 | WSO2 Docs');
  });

  await t.test('the family Cloud tree: the Cloud part mounted at /identity-platform/cloud/identity-server/, one sidebar, one commit', () => {
    const meta = c.json('edition.json');
    assert.equal(meta.baseUrl, '/identity-platform/cloud/');
    assert.deepEqual(meta.parts, [{ docSpace: 'identity-server', path: 'identity-server/', editionName: 'Identity Server Cloud' }]);
    assert.match(meta.source.commit, /^[0-9a-f]{40}$/, 'the parts come from the same checkout, at one commit');
    assert.match(c.root(''), /MARKER-FAMILY-HOME/);
    const pages = c.json('pages.json').map((p) => p.path);
    assert.ok(pages.includes('') && pages.includes('get-started/first-organization/') && pages.includes('identity-server/guides/mfa/'));
    // docs:identity-server/cloud/… links resolve to the platform's Cloud address.
    assert.match(c.root(''), /href="https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/guides\/mfa\/"/);
    assert.match(c.root('get-started/first-organization'), /href="https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/get-started\/quick-start\/"/);
    // One tree: the family's pages, then a group per Cloud part after Get started, on every page of the tree.
    const sidebar = (html) => [...between(html, 'theme-doc-sidebar-menu', '</nav>').matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    for (const html of [c.root(''), c.html('guides/mfa')]) {
      const links = sidebar(html);
      assert.equal(links[0], '/identity-platform/cloud/', 'the overview first');
      assert.ok(links.indexOf('/identity-platform/cloud/get-started/first-organization/') < links.findIndex((l) => l.startsWith('/identity-platform/cloud/identity-server/')), 'the part group after Get started');
    }
    assert.ok(sidebar(c.html('guides/mfa')).includes('/identity-platform/cloud/identity-server/guides/mfa/'), 'the part\'s own group is open on its pages');
    // The part's page moves and legacy maps follow it under the platform's Cloud address.
    const redirects = c.json('redirects.json');
    assert.deepEqual(redirects.find((r) => r.from.endsWith('/guides/multi-factor-auth/')), { from: '/identity-platform/cloud/identity-server/guides/multi-factor-auth/', to: '/identity-platform/cloud/identity-server/guides/mfa/', status: 301 });
    assert.deepEqual(redirects.find((r) => r.from === '/identity-platform/cloud/welcome/'), { from: '/identity-platform/cloud/welcome/', to: '/identity-platform/cloud/', status: 301 });
    assert.ok(redirects.some((r) => r.from === 'https://is.docs.wso2.com/en/7.3.0/guides/authentication/mfa/' && r.to === '/identity-platform/cloud/identity-server/guides/mfa/'));
    // Markdown twins: the part's home twin follows the tree's rule, and the tree's llms.txt links the part's.
    const twins = c.json('markdown.json').files.map((f) => f.path);
    assert.ok(twins.includes('identity-server.md') && twins.includes('identity-server/guides/mfa.md') && twins.includes('index.md'));
    assert.match(c.text('llms.txt'), /## Cloud parts\n\n- \[Identity Server Cloud \(its own page index\)\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/llms\.txt\)/);
    assert.match(c.text('identity-server/llms.txt'), /# Identity Server: Identity Server Cloud/);
    assert.match(c.text('identity-server/guides/mfa.md'), /editionName: Identity Server Cloud/);
    assert.deepEqual(checkBuild(c.dir, { space: 'identity-platform', segment: 'cloud', edition: 'cloud' }), [], 'publishable as one deployment');
  });

  await t.test('sidebar icons: inline SVG before the label of the entries that name one, nowhere else, and never in twins', () => {
    const side = (html) => between(html, 'theme-doc-sidebar-menu', '</nav>');
    const entry = (html, label) => [...side(html).matchAll(/<a [^>]*class="[^"]*menu__link[^"]*"[^>]*>(.*?)<\/a>/g)].map((m) => m[1]).find((a) => plain(a).trim() === label);
    const mfa = c.html('guides/mfa');
    const iconOf = (a) => /^<span class="[^"]*"><span class="wso2-nav-icon" aria-hidden="true"><svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="([^"]+)" width="([^"]+)" height="([^"]+)" focusable="false">(?:<!--![^>]*-->)?<path /.exec(a ?? '')?.slice(1);
    assert.deepEqual(iconOf(entry(mfa, 'Add multi-factor authentication')), ['0 0 16 16', '16', '16'], 'a page\'s sidebar_custom_props icon, server-rendered before its label');
    const getStarted = [...side(mfa).matchAll(/<a [^>]*class="[^"]*menu__link[^"]*"[^>]*>(.*?)<\/a>/g)].map((m) => m[1]).filter((a) => plain(a).trim() === 'Get started');
    assert.deepEqual(getStarted.map(iconOf), [undefined, ['0 0 16 16', '16', '16']], 'the part\'s folder names one in _category_.yml, the family\'s does not');
    assert.ok(entry(mfa, 'Agent identities') && !entry(mfa, 'Agent identities').includes('<svg'), 'an entry without an icon has none');
    assert.equal(count(side(c.root('')), /wso2-nav-icon/g), 0, 'no icon where no visible entry names one');
    assert.deepEqual(iconOf(entry(s.html('deploy-and-operate/install'), 'Install')), ['0 0 448 512', '14', '16'], 'a narrow Font Awesome glyph is 14×16');
    assert.equal(count(mfa, /wso2-nav-icon"/g), 2, 'only in the sidebar');
    // Only the icons in use ship, with the build.
    assert.match(c.assets(), /octicons\/shield-lock-16/);
    assert.doesNotMatch(c.assets(), /octicons\/zap-16/);
    for (const f of ['identity-server/guides/mfa.md', 'identity-server/llms.txt', 'identity-server/llms-full.txt', 'llms.txt', 'llms-full.txt', 'get-started/first-organization.md']) {
      assert.doesNotMatch(c.text(f), /octicons|fontawesome|wso2-nav-icon|<svg|sidebar_custom_props/, `${f} leaves the icons out`);
    }
    assert.match(c.text('identity-server/guides/mfa.md'), /^title: Add multi-factor authentication$/m);
    assert.doesNotMatch(s.text('deploy-and-operate/install.md'), /fontawesome|<svg/);
  });

  await t.test('canonicals and sitemaps', () => {
    assert.equal(canonical(c.html('guides/mfa')), 'https://docs.wso2.com/identity-platform/cloud/identity-server/guides/mfa/');
    // A Markdown link to a file keeps its URL: no trailing slash, and the file is there.
    const file = /href="(\/identity-platform\/cloud\/assets\/files\/sample-policy-[0-9a-f]+\.json)"/.exec(c.html('guides/mfa'));
    assert.ok(file, 'file link without a trailing slash');
    assert.ok(fs.existsSync(path.join(c.dir, file[1].replace('/identity-platform/cloud/', ''))), 'the tree\'s files are under its base');
    assert.equal(canonical(s.html('guides/mfa')), 'https://docs.wso2.com/identity-server/latest/guides/mfa/', 'the pinned twin of latest points at /latest/');
    assert.equal(c.sitemap().length, 13, 'the family\'s 2 pages and the part\'s 11: Cloud pages are their own canonical');
    assert.equal(s.sitemap().length, 0, 'the pinned twin of latest lists nothing');
  });

  await t.test('_platform outputs', () => {
    assert.deepEqual(s.json('pages.json').map((p) => p.path), [
      '', 'deploy-and-operate/install/', 'get-started/quick-start/', 'guides/mfa/', 'guides/server-licensing/', 'reference/', 'reference/apis/applications/',
      'reference/apis/notifications/', 'reference/apis/notifications/notifications-operations/', 'reference/apis/notifications/templates/', 'reference/connectors/',
    ]);
    assert.deepEqual(s.json('redirects.json')[0], { from: '/identity-server/7.3.0/guides/multi-factor-auth/', to: '/identity-server/7.3.0/guides/mfa/', status: 301 });
    const records = s.json('search-records.json');
    assert.ok(records.some((r) => r.url.endsWith('#register-an-application') && r.edition === '7.3.0'));
    assert.ok(!records.some((r) => /MARKER-CLOUD-ONLY/.test(r.content)));
  });

  await t.test('API reference: every operation, parameter and schema in the HTML', () => {
    const spec = yaml.load(fs.readFileSync(path.join(fixture, 'docs/reference/apis/applications/openapi.yaml'), 'utf8'));
    for (const [b, kind] of [[c, 'cloud'], [s, 'self-hosted']]) {
      const html = b.html('reference/apis/applications');
      for (const o of collectOperations(spec)) {
        assert.match(html, new RegExp(`<h3[^>]*id="${o.anchor}"`), `${kind}: ${o.method} ${o.path} has an anchored heading`);
        for (const p of o.params) assert.ok(html.includes(`<code>${p.name}</code>`), `${kind}: parameter ${p.name}`);
      }
      for (const name of Object.keys(spec.components.schemas)) assert.match(html, new RegExp(`id="schema-${name}"`));
      assert.doesNotMatch(html, /try it/i, 'no "try it" console');
      assert.doesNotMatch(html, /theme-doc-sidebar-container/, 'no Edition sidebar on API pages');
      assert.match(html, /<nav class="wso2-api__nav"[^>]*>.*Back to Reference/s);
      assert.match(html, new RegExp(`href="/${kind === 'cloud' ? 'identity-platform/cloud/identity-server' : 'identity-server/7.3.0'}/reference/apis/applications/openapi.yaml"[^>]*>Download OpenAPI \\(YAML\\)`));
      assert.ok(fs.existsSync(b.pathOf('reference/apis/applications/openapi.yaml')), 'spec copied to the build');
    }
    assert.match(c.html('reference/apis/applications'), /Base URL: <code>https:\/\/api\.asgardeo\.io\/t\/&lt;ORG_NAME&gt;\/api\/server\/v1<\/code>/);
    assert.match(s.html('reference/apis/applications'), /Base URL: <code>https:\/\/localhost:9443\/t\/&lt;TENANT_DOMAIN&gt;\/api\/server\/v1<\/code>/);
    assert.match(c.html('reference/apis/applications'), /MARKER-API-CLOUD-ONLY/, 'Edition markers work in the overview');
    assert.doesNotMatch(s.html('reference/apis/applications'), /MARKER-API-CLOUD-ONLY/);
    assert.match(plain(s.html('reference/apis/applications')), /curl -k &quot;https:\/\/localhost:9443\/t\/&lt;TENANT_DOMAIN&gt;\/api\/server\/v1\/applications&quot; \\\n {2}-H &quot;Authorization: Bearer &lt;ACCESS_TOKEN&gt;&quot;/);
    assert.equal(title(c.html('reference/apis/applications')), 'Application management API | Identity Server Cloud | WSO2 Docs');
  });

  await t.test('API reference: tag pages and one spec per Edition', () => {
    const cloudOps = c.html('reference/apis/notifications/notifications-operations');
    assert.match(cloudOps, /id="op-listNotifications"/);
    assert.match(cloudOps, /MARKER-CLOUD-ONLY-OPERATION/, 'Cloud renders openapi.cloud.yaml');
    assert.doesNotMatch(s.html('reference/apis/notifications/notifications-operations'), /MARKER-CLOUD-ONLY-OPERATION/);
    assert.match(fs.readFileSync(c.pathOf('reference/apis/notifications/openapi.yaml'), 'utf8'), /getNotificationUsage/);
    assert.doesNotMatch(fs.readFileSync(s.pathOf('reference/apis/notifications/openapi.yaml'), 'utf8'), /getNotificationUsage/);
    for (const m of ['MARKER-PARAM-CHANNEL', 'MARKER-PARAM-LIMIT', 'MARKER-PARAM-NOTIFICATION-ID', 'MARKER-SCHEMA-NOTIFICATION', 'MARKER-PROP-RECIPIENT', 'MARKER-PROP-NESTED']) assert.match(cloudOps, new RegExp(m));
    assert.match(cloudOps, /href="\/identity-platform\/cloud\/identity-server\/reference\/apis\/notifications\/templates\/#tag-templates"/, 'the API nav spans the tag pages');
    assert.match(c.html('reference/apis/notifications/templates'), /id="op-uploadTemplateLogo"/);
    const index = c.html('reference/apis/notifications');
    assert.doesNotMatch(index, /<h3[^>]*id="op-/, 'the split index holds the overview only');
    assert.match(index, /href="\/identity-platform\/cloud\/identity-server\/reference\/apis\/notifications\/notifications-operations\/"/);
    const reference = c.html('reference');
    assert.match(reference, /theme-doc-sidebar-container/);
    assert.match(reference, /Notification API/);
    assert.doesNotMatch(reference, /Templates: Notification API/, 'tag pages stay out of the Edition sidebar');
  });

  await t.test('API reference: search records and _platform/apis.json', () => {
    const records = c.json('search-records.json');
    const op = records.find((r) => r.url.endsWith('/reference/apis/notifications/notifications-operations/#op-listNotifications'));
    assert.ok(op, 'a record per operation anchor');
    assert.equal(op.hierarchy.lvl3, 'List notifications');
    assert.match(op.content, /MARKER-PARAM-CHANNEL/);
    assert.ok(records.some((r) => r.url.endsWith('/reference/apis/applications/#op-getAllApplications')));
    assert.ok(!records.some((r) => /Back to Reference/.test(r.content)), 'the API nav is not indexed');
    const apis = c.json('apis.json');
    assert.equal(apis.budgetKb, 400);
    assert.deepEqual(apis.apis.map((a) => [a.path, a.spec]), [
      ['identity-server/reference/apis/applications/', 'identity-server/reference/apis/applications/openapi.yaml'],
      ['identity-server/reference/apis/notifications/', 'identity-server/reference/apis/notifications/openapi.yaml'],
    ]);
    assert.ok(apis.apis[1].operations.some((o) => o.anchor === 'op-getNotificationUsage'));
  });

  await t.test('latest twin and an older version', () => {
    const l = build('latest', '--edition', '7.3.0', '--as-latest');
    assert.equal(canonical(l.html('guides/mfa')), 'https://docs.wso2.com/identity-server/latest/guides/mfa/');
    assert.equal(l.sitemap().length, 11);
    // The legacy site's /en/latest/ URLs follow the latest twin; the pinned build keeps only /en/7.3.0/.
    const legacyLatest = 'https://is.docs.wso2.com/en/latest/guides/authentication/mfa/';
    assert.deepEqual(l.json('redirects.json').find((r) => r.from === legacyLatest), { from: legacyLatest, to: '/identity-server/latest/guides/mfa/', status: 301 });
    assert.ok(l.json('redirects.json').some((r) => r.from === 'https://is.docs.wso2.com/en/7.3.0/guides/authentication/mfa/'));
    assert.ok(!s.json('redirects.json').some((r) => r.from.includes('/en/latest/')), 'only the latest twin answers /en/latest/');

    // Pretend latest no longer has guides/mfa: 7.2.0 then keeps its own canonical.
    const pages = l.json('pages.json').filter((p) => p.path !== 'guides/mfa/');
    const pagesFile = path.join(out, 'latest-pages.json');
    fs.writeFileSync(pagesFile, JSON.stringify(pages));
    const mainFiles = path.join(out, 'main-files.txt');
    fs.writeFileSync(mainFiles, 'identity-server/docs/index.mdx\nidentity-server/docs/guides/mfa.mdx\n');
    const o = build('720', '--edition', '7.2.0', '--latest-pages', pagesFile, '--main-files', mainFiles);
    assert.doesNotMatch(o.html('get-started/quick-start'), /MARKER-FROM-730/);
    assert.equal(canonical(o.html('get-started/quick-start')), 'https://docs.wso2.com/identity-server/latest/get-started/quick-start/');
    assert.equal(canonical(o.html('guides/mfa')), 'https://docs.wso2.com/identity-server/7.2.0/guides/mfa/');
    assert.deepEqual(o.sitemap(), ['https://docs.wso2.com/identity-server/7.2.0/guides/mfa/']);
  });

  await t.test('header: the wso2.com bar, then one server-rendered docs bar with "Docs", switchers and the search slot', () => {
    const page = s.html('guides/mfa');
    const bar = between(page, '<header class="wso2-site-bar"', '</header>');
    assert.ok(bar && page.indexOf('class="wso2-site-bar"') < page.indexOf('<nav aria-label="Main"'), 'the wso2.com bar, server-rendered above the docs bar');
    assert.match(bar, /<a class="wso2-site-bar__logo" href="https:\/\/wso2\.com\/">.*\/img\/pulse-mark\.svg.*\/img\/pulse-mark-white\.svg.*<span>WSO2<\/span><\/a>/, 'the logo goes to wso2.com');
    assert.match(bar, /href="https:\/\/wso2\.com\/agentic-enterprise\/">Agentic Enterprise<.*<details class="wso2-site-bar__menu"><summary class="wso2-site-bar__item">Products.*href="https:\/\/wso2\.com\/agent-platform\/">Agent Platform<.*<summary class="wso2-site-bar__item">Solutions.*<summary class="wso2-site-bar__item">Company/, 'wso2.com\'s links, and menus as <details> disclosures');
    assert.match(bar, /class="wso2-site-bar__contact" href="https:\/\/wso2\.com\/contact\/">Contact</);
    const h = navbar(page);
    assert.match(h, /<a class="navbar__brand wso2-brand" href="\/" aria-label="WSO2 Docs home"><span class="wso2-brand__text">Docs<\/span><\/a>/, '"Docs" links to the Landing deployment');
    assert.match(h, /wso2-product-switcher.*wso2-menu__button-text">Identity Server</);
    // The products menu: the family's Cloud first, then its products, each opening its latest (Cloud first).
    assert.match(h, /aria-label="Identity Platform".*href="\/identity-platform\/cloud\/" data-kind="cloud">.*Identity Platform Cloud.*href="\/identity-platform\/cloud\/identity-server\/" aria-current="true" data-kind="product">.*Identity Server/);
    assert.match(h, /href="https:\/\/wso2\.com\/engineering-platform\/developer-platform\/docs\/"/, 'Doc spaces not migrated yet open their old site');
    assert.match(h, /data-wso2-search-slot="header".*Ctrl K/);
    assert.doesNotMatch(h, /wso2-site-links|https:\/\/wso2\.com\/support\//, 'header.links is for deployments built before the wso2.com bar');
    assert.ok(h.indexOf('data-wso2-search-slot') < h.indexOf('colorModeToggle'), 'search | mode toggle');
  });

  // Chrome: products menu, section menu and two version selectors. The header
  // acts for the Doc space being read: on a Cloud part's page, the component.
  await t.test('version selector next to the product: Cloud first, manifest order, "(newest release)" once, legacy entries', () => {
    assert.equal(editionButton(s.html('')), '7.3.0', 'the short Edition, next to the products button that names the product');
    assert.match(navbar(s.html('')), /aria-label="Identity Server version, Identity Server 7\.3\.0 \(newest release\)"/);
    const menu = editionMenu(s.html(''));
    assert.match(menu, /aria-label="Cloud".*href="\/identity-platform\/cloud\/identity-server\/" data-edition="cloud">.*aria-label="Self-hosted".*Identity Server 7\.3\.0<span class="wso2-latest"><span class="wso2-sr-only"> \(newest release\)<\/span><span aria-hidden="true">Latest<\/span><\/span>.*Identity Server 7\.2\.0.*Identity Server 7\.1\.0.*aria-label="Older versions \(old site\)".*Identity Server 7\.0\.0/);
    assert.equal(count(menu, /newest release/g), 1);
    assert.equal(count(menu, />Latest</g), 1, 'one "Latest" badge');
    assert.match(menu, /href="https:\/\/is\.docs\.wso2\.com\/en\/7\.0\.0\/" data-edition="7\.0\.0" target="_blank" rel="noopener">.*?old site, opens in a new tab/);
    assert.match(menu, /Copy permanent link/);
    // A Cloud part's pages: the products button and the selector act for the component.
    assert.equal(editionButton(c.html('')), 'Cloud');
    assert.match(navbar(c.html('guides/mfa')), /wso2-product-switcher.*wso2-menu__button-text">Identity Server<.*aria-label="Identity Server version, Cloud"/);
    assert.match(editionMenu(c.html('guides/mfa')), /href="\/identity-platform\/cloud\/identity-server\/guides\/mfa\/" data-edition="cloud" aria-current="page"/);
    // The family Cloud's own pages: its one Edition, still shown.
    assert.match(navbar(c.root('')), /wso2-menu__button-text">Identity Platform Cloud<.*aria-label="Identity Platform Cloud version, Cloud"/);
    assert.equal(count(editionMenu(c.root('')), /data-edition=/g), 1);
  });

  await t.test('Docs section menu: the section title, the open Doc space with this tree, the others one line with their dropdown', () => {
    const menu = (html) => between(html, 'theme-doc-sidebar-menu', '</nav>');
    const part = menu(c.html('guides/mfa'));
    assert.match(part, /^theme-doc-sidebar-menu menu__list"><li class="wso2-section__title" data-section="identity-platform">Identity Platform Documentation<\/li>/);
    assert.match(part, /<li class="menu__list-item wso2-entry wso2-entry--active wso2-entry--open" data-docspace="identity-platform"><div class="wso2-entry__head"><a class="menu__link wso2-entry__name" href="\/identity-platform\/cloud\/">Identity Platform Cloud<\/a><\/div><ul class="menu__list wso2-entry__tree">/, 'the family Cloud entry is open, with the tree');
    const is = between(part, 'data-docspace="identity-server"', '</ul>');
    assert.match(is, /href="\/identity-platform\/cloud\/identity-server\/">Identity Server<\/a><button class="wso2-entry__version" aria-label="Identity Server version, Cloud"/, 'in its part, the component\'s entry is one line with its dropdown on Cloud');
    assert.match(is, /aria-current="true">Cloud<\/a><\/li><li><a class="wso2-entry__version-link" href="\/identity-server\/7\.3\.0\/">7\.3\.0<\/a><\/li><li><a class="wso2-entry__version-link" href="\/identity-server\/7\.2\.0\/">7\.2\.0/);
    const own = menu(s.html('guides/mfa'));
    assert.match(own, /data-docspace="identity-platform"><div class="wso2-entry__head"><a class="menu__link wso2-entry__name" href="\/identity-platform\/cloud\/">Identity Platform Cloud<\/a><\/div><\/li>/, 'other Doc spaces are collapsed to one line');
    assert.match(own, /wso2-entry--active wso2-entry--open" data-docspace="identity-server">.*aria-label="Identity Server version, 7\.3\.0".*<ul class="menu__list wso2-entry__tree">.*href="\/identity-server\/7\.3\.0\/guides\/mfa\/"/s, 'the open Doc space carries its own tree, its dropdown in step with the header');
    // The breadcrumb starts with the section.
    assert.match(between(c.html('guides/mfa'), 'theme-doc-breadcrumbs', '</nav>'), /<li class="breadcrumbs__item wso2-crumb-section"><span class="breadcrumbs__link">Identity Platform<\/span><\/li><li class="breadcrumbs__item"><a aria-label="Home page"/);
  });

  await t.test('version notices are server-rendered from the manifest snapshot: Cloud names the newest release, the newest release none', () => {
    // "Newest features" only on a page with Cloud-only content: guides/mfa's partial holds a variant's Cloud form.
    assert.match(between(c.html('guides/mfa'), 'wso2-notices', '</article>'), /wso2-notice--info.*Cloud has the newest features\. Some may not be in a release yet; the newest release is Identity Server 7\.3\.0\./);
    assert.match(between(c.html('guides/cloud-billing'), 'wso2-notices', '</article>'), /Cloud has the newest features/, 'a Cloud-only page');
    for (const page of ['deploy-and-operate/install', 'reference']) {
      const notice = between(c.html(page), 'wso2-notices', '</article>');
      assert.match(notice, /wso2-notice--info.*You&#x27;re reading Identity Server Cloud\. The newest release is Identity Server 7\.3\.0\./, page);
      assert.doesNotMatch(notice, /newest features/, page);
    }
    assert.doesNotMatch(c.root(''), /wso2-notices/, 'a Cloud-only Doc space has no release to name');
    assert.doesNotMatch(s.html('guides/mfa'), /wso2-notices/, 'the pinned twin of latest is the newest release');
  });

  await t.test('team notices come from the published manifest at runtime: none baked into the page', () => {
    // The only notice in the HTML is the version notice (from the snapshot); a team notice never is.
    for (const html of [c.root(''), c.html('guides/mfa'), s.html('guides/mfa')]) assert.doesNotMatch(html, /wso2-notice--(info|warning)" role="note"><div class="wso2-notice__body">(?!<span data-wso2-version-notice)/);
    assert.match(s.assets(), /notices/, 'the chrome code that reads them is in the bundle');
  });

  await t.test('overview layout: the family home\'s link sections are cards, the rest prose', () => {
    const home = between(c.root(''), 'theme-doc-markdown', 'wso2-page-end');
    assert.match(home, /MARKER-FAMILY-HOME/);
    assert.equal(count(home, /class="wso2-overview-grid"/g), 2, 'the product cards under Products, then the Get started card: a row per heading level');
    assert.match(home, /<h2[^>]*id="products"[^>]*>Products.*<div class="wso2-overview-grid"><section class="wso2-overview-card wso2-overview-card--h3"><h3[^>]*id="identity-server"[^>]*>Identity Server.*MARKER-OVERVIEW-PRODUCT.*<a href="https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/"[^>]*>Identity Server Cloud<\/a>.*<\/section><\/div>\s*<div class="wso2-overview-grid"><section class="wso2-overview-card wso2-overview-card--h2"><h2[^>]*id="get-started"[^>]*>Get started.*href="\/identity-platform\/cloud\/get-started\/first-organization\/">Create your first organization/s);
    assert.match(home, /<\/section><\/div>\s*<h2[^>]*id="about-these-docs"[^>]*>About these docs.*<p>[^<]*MARKER-OVERVIEW-PROSE<\/p>/s, 'a section without links stays prose');
    assert.doesNotMatch(c.root(''), /theme-doc-toc-desktop/, 'no TOC column');
    const twin = c.text('index.md');
    assert.match(twin, /## Products \{#products\}\n\n### Identity Server \{#identity-server\}\n\nSign-in, MFA and user management\. MARKER-OVERVIEW-PRODUCT\n\n- \[Identity Server Cloud\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\.md\)/, 'the twin is the Markdown as written');
    assert.doesNotMatch(twin, /Overview(Grid|Card)/);
    const records = c.json('search-records.json');
    assert.ok(records.some((r) => /\/identity-platform\/cloud\/#get-started$/.test(r.url)), 'a card\'s heading is a search record');
  });

  await t.test('catalog layout: the data file\'s items for each Edition, server-rendered, searchable and filterable', () => {
    const cat = (b) => between(b.html('reference/connectors'), 'class="wso2-layout-catalog"', 'wso2-page-end');
    const cc = cat(c);
    const sc = cat(s);
    assert.match(c.html('reference/connectors'), /<p>The connectors available for WSO2 Identity Platform\. MARKER-CATALOG-INTRO<\/p>\s*<div class="wso2-layout-catalog">/, 'the page\'s text, then the grid');
    assert.deepEqual([...cc.matchAll(/id="catalog-([a-z-]+)"/g)].map((m) => m[1]), ['totp', 'billing-alerts', 'api-publishing']);
    assert.deepEqual([...sc.matchAll(/id="catalog-([a-z-]+)"/g)].map((m) => m[1]), ['totp', 'fraud-signals', 'api-publishing'], 'items limited to Editions');
    assert.match(cc, /href="\/identity-platform\/cloud\/identity-server\/guides\/mfa\/">TOTP authenticator<\/a>/, 'a page path, resolved in the Cloud part');
    assert.match(sc, /href="\/identity-server\/7\.3\.0\/guides\/mfa\/">TOTP authenticator<\/a>/);
    assert.match(cc, /href="\/identity-platform\/cloud\/identity-server\/guides\/cloud-billing\/">Billing alerts/, 'a path relative to the data file');
    assert.match(cc, /<a href="https:\/\/docs\.wso2\.com\/api-manager\/latest\/guides\/" data-docs-link="">API publishing<\/a>/, 'a docs: link');
    assert.match(cc, /href="https:\/\/github\.com\/wso2-extensions\/identity-outbound-auth-totp"[^>]*>Source code<\/a>/);
    assert.match(sc, /<span class="wso2-layout-catalog__badge wso2-layout-catalog__badge--beta">Beta<\/span>/);
    // Accessibility: a labelled search box, filter chips as pressed buttons in a labelled group, an announced count, decorative logos.
    assert.match(cc, /<label class="wso2-layout-catalog__search" for="([^"]+)"><span class="wso2-sr-only">Search by name<\/span><input id="\1" type="search"/);
    assert.match(cc, /role="group" aria-label="Filter by category"><button type="button" class="wso2-layout-catalog__chip" aria-pressed="false">Authentication<\/button><button[^>]*aria-pressed="false">Fraud detection<\/button><\/div>/);
    assert.match(cc, /<p class="wso2-layout-catalog__status" role="status"><\/p>/);
    assert.match(cc, /<div class="wso2-layout-catalog__logo" aria-hidden="true"><p><img[^>]*src="[^"]+"/);
    assert.doesNotMatch(cc, /<img(?![^>]*src=)/);
    assert.doesNotMatch(cc, /\shidden=""/, 'every item is shown until the reader filters');
    // The twin lists the items; search records hold their text but not the controls.
    const twin = c.text('identity-server/reference/connectors.md');
    assert.match(twin, /- \*\*\[TOTP authenticator\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/guides\/mfa\.md\)\*\*: Time-based one-time passwords as a second factor\. MARKER-CATALOG-TOTP\n\n {2}\[Source code\]\(https:\/\/github\.com\/wso2-extensions\/identity-outbound-auth-totp\)/);
    assert.match(s.text('reference/connectors.md'), /\*\*\[Fraud signals\]\(https:\/\/store\.wso2\.com\/connector\/fraud-signals\)\*\* \(beta\): Scores each sign-in attempt\./);
    assert.doesNotMatch(twin, /MARKER-CATALOG-SELF-HOSTED|Catalog|<img/);
    const records = c.json('search-records.json').filter((r) => r.url.includes('/reference/connectors/'));
    assert.ok(records.some((r) => /MARKER-CATALOG-TOTP/.test(r.content)), 'catalog items are searchable');
    assert.ok(!records.some((r) => /Search by name|Filter by category/.test(r.content)), 'the controls are not indexed');
    // Search records for Cloud parts and family Clouds: one record per item, as the component's Cloud.
    const items = records.filter((r) => r.type === 'catalog-item');
    assert.deepEqual(items.map((r) => r.url.split('#')[1]), ['catalog-totp', 'catalog-billing-alerts', 'catalog-api-publishing']);
    assert.ok(items.every((r) => r.docSpace === 'identity-server' && r.cloudIn === 'identity-platform' && r.hierarchy.lvl0 === 'Identity Server Cloud'));
    assert.equal(items[0].hierarchy.lvl2 ?? items[0].hierarchy.lvl3, 'TOTP authenticator');
    assert.match(items[0].content, /MARKER-CATALOG-TOTP/);
    assert.deepEqual(s.json('search-records.json').filter((r) => r.type === 'catalog-item').map((r) => r.url.split('#')[1]), ['catalog-totp', 'catalog-fraud-signals', 'catalog-api-publishing'], 'per Edition');
    const tree = c.json('search-records.json');
    assert.ok(tree.filter((r) => r.url.includes('/identity-platform/cloud/identity-server/')).every((r) => r.docSpace === 'identity-server' && r.hierarchy.lvl0 === 'Identity Server Cloud'));
    assert.ok(tree.filter((r) => !r.url.includes('/identity-platform/cloud/identity-server/')).every((r) => r.docSpace === 'identity-platform' && !r.cloudIn && r.hierarchy.lvl0 === 'Identity Platform Cloud'));
  });

  await t.test('page end: feedback widget and report link; edit link hidden by the manifest flag', () => {
    const page = s.html('guides/mfa');
    assert.match(page, /Was this page helpful\?.*<button type="button" class="wso2-button">Yes<\/button><button type="button" class="wso2-button">No<\/button>/);
    const report = /<a href="([^"]*)"[^>]*data-wso2-report="">Report an issue<\/a>/.exec(page);
    assert.ok(report, 'Report an issue link');
    const url = new URL(report[1].replaceAll('&amp;', '&'));
    assert.equal(url.pathname, '/wso2/docs-is/issues/new', 'the legacy repo during the Pilot');
    assert.match(url.searchParams.get('body'), /\*\*Edition:\*\* Identity Server 7\.3\.0/);
    assert.doesNotMatch(page, /Edit this page/);
    assert.ok(!s.json('search-records.json').some((r) => /helpful|Report an issue/.test(r.content)), 'chrome is not indexed');
  });

  // The shared theme (lib/theme-bundle.mjs): linked at its host-root address,
  // never under the deployment's baseUrl, with a copy in the output for a
  // static server; the build's own CSS keeps Infima and Docusaurus's.
  await t.test('theme: the shared theme at /_platform/theme/v<major>/, code colours in CSS, not in the HTML', () => {
    const base = themeBase();
    assert.equal(base, `/_platform/theme/v${themeMajor()}/`);
    for (const [build, page] of [[s, 'get-started/quick-start'], [c, 'get-started/quick-start']]) {
      const html = build.html(page);
      const head = between(html, '<head', '</head>');
      assert.match(head, new RegExp(`<link rel="icon" type="image/svg\\+xml" href="${base}img/favicon\\.svg">`));
      assert.match(head, new RegExp(`<link rel="apple-touch-icon" sizes="180x180" href="${base}img/apple-touch-icon\\.png">`));
      assert.match(head, /<link rel="stylesheet" href="\/[^"]*\/assets\/css\/styles\.[0-9a-f]+\.css">/, 'the build\'s own CSS, under its baseUrl');
      assert.doesNotMatch(head, /theme\.css/);
      assert.match(between(html, '<body', '<div id="__docusaurus"'), new RegExp(`<link rel="stylesheet" href="${base}theme\\.css" data-wso2-theme="true">\\s*<script></script>`), 'after the build\'s CSS, before the page');
      const code = between(html, 'class="language-', '</pre>');
      assert.match(code, /<span class="token /, 'a highlighted code block');
      assert.doesNotMatch(between(html, '<div id="__docusaurus"', '</html>'), /<(span|div|pre)[^>]*\bclass="(token|prism-code)[^"]*"[^>]*style=/, 'no inline token, line or block colours');
      assert.ok(fs.existsSync(path.join(build.dir, `_platform/theme/v${themeMajor()}/theme.css`)), 'the bundle in the output, for a static server');
      assert.ok(fs.existsSync(path.join(build.dir, `_platform/theme/v${themeMajor()}/fonts/inter-latin-wght-normal.woff2`)));
      assert.ok(!fs.existsSync(path.join(build.dir, 'img', 'favicon.svg')), 'no copy under the deployment');
    }
    const css = fs.readdirSync(path.join(s.dir, 'assets', 'css')).map((f) => fs.readFileSync(path.join(s.dir, 'assets', 'css', f), 'utf8')).join('\n');
    assert.match(css, /--ifm-color-primary:/, 'Infima stays in the build');
    assert.doesNotMatch(css, /--wso2-link:|Inter Variable|wso2-nav-icon\{|\.token\.keyword/, 'the theme is not');
    assert.doesNotMatch(css, /\.wso2-(brand|menu__panel|footer|api-method|overview-grid)\b/, 'nor the Platform\'s component stylesheets: they are in the theme');
    const bundle = fs.readFileSync(path.join(s.dir, `_platform/theme/v${themeMajor()}/theme.css`), 'utf8');
    for (const f of ['chrome.css', 'api-reference.css', 'layouts.css']) assert.ok(bundle.includes(`/* ---- ${f} ---- */`), `${f} in the theme`);
  });

  await t.test('footer from chrome.json', () => {
    const f = between(s.html(''), '<footer class="wso2-footer"', '</footer>');
    assert.match(f, /<a href="https:\/\/wso2\.com\/" class="wso2-footer__logo">/);
    assert.match(f, /aria-label="Resources".*href="\/contribute\/">Contribute to the docs<\/a>/);
    assert.match(f, /© \d{4} WSO2 LLC</);
    assert.match(f, /href="https:\/\/wso2\.com\/privacy-policy">Privacy policy.*href="https:\/\/wso2\.com\/cookie-policy\/">Cookie policy/);
  });

  await t.test('GTM and CookiePro only in production builds, guarded to the production host', () => {
    const head = between(c.html(''), '<head', '</head>');
    const script = /<script data-wso2-analytics="true">([\s\S]*?)<\/script>/.exec(head)?.[1];
    assert.ok(script, 'production build has the analytics head script');
    assert.match(script, /\["docs\.wso2\.com"\]\.indexOf\(\w+\.location\.hostname\)<0/, 'guarded (Docusaurus minifies the script)');
    assert.ok(script.indexOf('cookiepro.com') < script.indexOf('googletagmanager.com'), 'CookiePro before GTM');
    assert.doesNotMatch(s.html(''), /googletagmanager|cookiepro|data-wso2-analytics/, 'none in other builds');
  });

  await t.test('runtime data: manifest and chrome.json snapshots baked in, fetched root-relative', () => {
    const js = s.assets();
    assert.match(js, /"?manifestUrl"?:"\/manifest\.json"/);
    assert.match(js, /"?chromeUrl"?:"\/chrome\.json"/);
    assert.match(js, /"?schemaVersion"?:1,"?families"?:\["Agent Platform"/);
    assert.match(js, /"?feedback"?:\{"?endpoint"?:"\/api\/feedback"\}/);
  });
});

test('older Edition: not-latest notice and edit links to main first', { timeout: 600_000 }, () => {
  const mainFiles = path.join(out, 'main-files.txt');
  const o = { html: (p) => fs.readFileSync(path.join(out, '720', p, 'index.html'), 'utf8'), assets: () => fs.readdirSync(path.join(out, '720', 'assets', 'js')).map((f) => fs.readFileSync(path.join(out, '720', 'assets', 'js', f), 'utf8')).join('\n') };
  assert.ok(fs.existsSync(mainFiles));
  const notice = between(o.html('guides/mfa'), '<div class="wso2-notices"', '</article>');
  assert.match(notice, /wso2-notice--warning.*You&#x27;re reading Identity Server 7\.2\.0\. The newest release is 7\.3\.0, and Cloud has the newest features\./);
  assert.match(notice, /href="\/identity-server\/latest\/">Go to the newest release/);
  assert.equal(editionButton(o.html('')), '7.2.0');
  const js = o.assets();
  assert.match(js, /edit\/main\/identity-server\/docs\/guides\/mfa\.mdx/, 'on main: edit there, in the Doc space directory');
  assert.match(js, /Fixes apply to the newest docs first/);
  assert.match(js, /edit\/identity-server\/release\/7\.2\.0\/identity-server\/docs\/get-started\/quick-start\.mdx/, 'not on main: the file on the Edition\'s prefixed branch');
});

test('Landing deployment at baseUrl /', { timeout: 600_000 }, () => {
  const l = build('landing', '--landing');
  const home = l.html('');
  assert.equal(title(home), 'WSO2 Docs');
  assert.match(home, /<h1 class="wso2-hero__title">WSO2 Documentation<\/h1>.*data-wso2-search-slot="hero"/, 'search-first hero');
  const popular = between(home, 'class="wso2-popular"', '</nav>');
  const n = count(popular, /<li><a href="\//g);
  assert.ok(n >= 4 && n <= 6, `${n} popular links`);
  const catalog = between(home, 'aria-labelledby="catalog"', 'wso2-landing__columns');
  assert.deepEqual([...catalog.matchAll(/wso2-family__title"[^>]*>([^<]*)</g)].map((m) => m[1]),
    ['Agent Platform', 'API Platform', 'Integration Platform', 'Identity Platform', 'Engineering Platform', 'Solutions', 'Other']);
  // The same list as the products menu, each entry one link to where the menu opens it.
  const ip = between(catalog, 'data-group="identity-platform"', '</section>');
  assert.match(ip, /<h3 class="wso2-family__title" id="family-identity-platform">Identity Platform<\/h3><ul>/, 'no group description');
  assert.deepEqual([...ip.matchAll(/<a href="([^"]+)">([^<]+)</g)].map((m) => [m[2], m[1]]), [
    ['Identity Platform Cloud', '/identity-platform/cloud/'], ['Identity Server', '/identity-platform/cloud/identity-server/'], ['Security Token Service', '/identity-platform/cloud/'],
  ]);
  assert.doesNotMatch(catalog, /wso2-kind|>Self-hosted</, 'no Edition links: the Doc space\'s version selector chooses');
  assert.match(between(catalog, 'data-docspace="api-manager"', '</li>'), /<a href="\/api-manager\/latest\/">API Manager</);
  assert.doesNotMatch(catalog, /data-docspace="contribute"/, 'Contribute is indexed, but never in the products menu');
  assert.match(between(home, 'wso2-landing__columns', '</main>'), /id="column-0">Learn<.*id="column-1">Community</);
  assert.match(home, /<header class="wso2-site-bar"/, 'the wso2.com bar; chrome.css hides the docs bar on this page');
  const h = navbar(home);
  assert.match(h, /wso2-menu__button-text">Products</);
  assert.doesNotMatch(h, /wso2-edition-dropdown/);
  assert.deepEqual(JSON.parse(l.text('chrome.json')), JSON.parse(fs.readFileSync(path.join(root, 'chrome', 'chrome.json'), 'utf8')));
  // Publishable like every deployment: what wso2-release check and publish need, and no search records.
  assert.deepEqual(checkBuild(l.dir, { space: '_landing', segment: '_', edition: '_' }), []);
  // /sitemap.xml is the bucket's sitemap index, so the home page is listed through sitemap-landing.xml.
  assert.match(l.text('sitemap-landing.xml'), /<url><loc>https:\/\/docs\.wso2\.com\/<\/loc><\/url>/);
  assert.deepEqual(JSON.parse(l.text('_platform/pages.json')).map((p) => p.path), ['', 'search/']);
  assert.ok(!fs.existsSync(path.join(l.dir, '_platform', 'search-records.json')), 'nothing of the Landing deployment is indexed');
  // The shared theme, linked at the host root; the bundle in the output for a static server rooted here.
  assert.match(home, new RegExp(`<link rel="stylesheet" href="${themeBase()}theme\\.css" data-wso2-theme="true">`));
  assert.ok(fs.existsSync(path.join(l.dir, `_platform/theme/v${themeMajor()}/theme.css`)));
});

test('an API page over the page budget fails the build', { timeout: 600_000 }, () => {
  assert.throws(
    () => build('over-budget', '--edition', 'cloud', { WSO2_DOCS_API_BUDGET_KB: '1', WSO2_DOCS_ONLY: 'reference' }),
    (err) => /reference\/apis\/applications\/: \d+ KB compressed HTML is over the 1 KB API page budget\. Split it into tag pages with "npx @wso2\/docs api split docs\/reference\/apis\/applications"/.test(String(err.stderr)),
  );
});

test('a build stopped part way fails, though Docusaurus exits 0 on SIGTERM', { timeout: 600_000 }, async () => {
  const { spawn, execFileSync: run } = await import('node:child_process');
  const dir = path.join(out, 'stopped');
  const child = spawn(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'build', fixture, '--edition', 'cloud', '--out', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  await new Promise((resolve, reject) => {
    const onData = (d) => {
      log += d;
      if (/Compiling Client/.test(log)) resolve();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData); // Docusaurus logs its progress to stderr
    child.on('exit', () => reject(new Error(`the build ended before it could be stopped:\n${log}`)));
  });
  // Stop only the Docusaurus process, as a cancelled job or a timeout would.
  const docusaurus = run('pgrep', ['-P', String(child.pid)], { encoding: 'utf8' }).trim().split('\n')[0];
  process.kill(Number(docusaurus), 'SIGTERM');
  assert.equal(await exited, 1);
  assert.ok(!fs.existsSync(path.join(dir, '_platform', 'edition.json')));
});
