// chrome.json, page links (edit / report an issue / feedback) and analytics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { activeAnnouncement, copyrightText, mergeChrome, validateChrome } from '../lib/chrome.mjs';
import { editLink, feedbackEvent, FEEDBACK_REASONS, issueLink } from '../lib/page-links.mjs';
import { analyticsHeadScript, EVENTS } from '../lib/analytics.mjs';
import { resolveDocsLink } from '../plugins/remark-docs-links.mjs';
import { loadPolicy, publicManifest } from '../lib/manifest.mjs';
import { mainBranchFiles, repoPathOf } from '../lib/content.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'chrome', 'chrome.json'), 'utf8'));

test('the Platform chrome.json source is valid', () => {
  assert.equal(validateChrome(source), source);
  assert.equal(source.feedback.endpoint, '/api/feedback');
  assert.deepEqual(source.header.links.map((l) => l.label), ['Support', 'wso2.com'], 'kept for deployments built before the wso2.com bar');
  const site = source.header.site;
  assert.equal(site.home.href, 'https://wso2.com/');
  assert.deepEqual(site.items.map((i) => [i.label, Boolean(i.groups)]), [['Agentic Enterprise', false], ['Products', true], ['Solutions', true], ['Company', true]]);
  assert.deepEqual(site.items[1].groups.map((g) => g.title), ['Agent Platform', 'API Platform', 'Integration Platform', 'Identity Platform', 'Engineering Platform'], 'wso2.com\'s families, in its order');
  assert.equal(site.contact.label, 'Contact');
  assert.ok(source.footer.legal.some((l) => l.label === 'Cookie policy'), 'CookiePro\'s consent links to the cookie policy');
});

test('chrome.json validation names the broken fields', () => {
  const bad = { ...source, header: { links: [{ label: 'x', href: 'http://insecure' }] }, announcement: { id: 'a' } };
  assert.throws(() => validateChrome(bad), /header\.links\[0\].*announcement needs an id and a text/);
  const badSite = { ...source, header: { links: [], site: { home: { label: 'WSO2', href: 'https://wso2.com/' }, items: [{ label: 'Products', groups: [{ links: [{ label: 'x', href: 'ftp://x' }] }] }] } } };
  assert.throws(() => validateChrome(badSite), /header\.site\.items\[0\]\.groups\[0\]\.title is required.*groups\[0\]\.links\[0\] needs a label/);
});

test('runtime chrome.json replaces the snapshot section by section', () => {
  const live = { header: { links: [{ label: 'Status', href: 'https://status.wso2.com/' }] }, footer: 'broken', announcement: { id: 'n1', text: 'New' } };
  const m = mergeChrome(source, live);
  assert.deepEqual(m.header.links, live.header.links);
  assert.equal(m.footer, source.footer, 'a malformed section keeps the baked-in copy');
  assert.equal(m.announcement.id, 'n1');
  assert.equal(mergeChrome(source, null), source);
  assert.deepEqual(m.header.site, source.header.site, 'a live copy older than the wso2.com bar keeps the baked-in bar');
  const site = { home: { label: 'WSO2', href: 'https://wso2.com/' }, items: [{ label: 'Contact', href: 'https://wso2.com/contact/' }] };
  assert.deepEqual(mergeChrome(source, { header: { links: [], site } }).header.site, site, 'a newer bar replaces it');
  assert.equal(mergeChrome(source, { header: { links: [], site: { items: 'broken' } } }).header, source.header, 'a malformed bar keeps the baked-in header');
});

test('announcements expire after their until date', () => {
  const c = { announcement: { id: 'a', text: 'Maintenance', until: '2026-10-31' } };
  assert.ok(activeAnnouncement(c, new Date('2026-10-31T12:00:00Z')));
  assert.equal(activeAnnouncement(c, new Date('2026-11-01T00:00:00Z')), null);
  assert.equal(activeAnnouncement(source), null);
  assert.equal(copyrightText('© {year} WSO2 LLC.', 2026), '© 2026 WSO2 LLC.');
});

test('"Edit this page" goes to main first, otherwise to the version branch', () => {
  const repo = 'wso2/docs-identity-platform';
  const mainFiles = new Set(['docs/guides/mfa.mdx']);
  assert.deepEqual(editLink({ repo, editionId: 'cloud', docPath: 'guides/mfa.mdx', mainFiles: null }),
    { url: 'https://github.com/wso2/docs-identity-platform/edit/main/docs/guides/mfa.mdx', note: null });
  assert.deepEqual(editLink({ repo, editionId: '7.2.0', docPath: 'guides/mfa.mdx', mainFiles }),
    { url: 'https://github.com/wso2/docs-identity-platform/edit/main/docs/guides/mfa.mdx', note: 'Fixes apply to the newest docs first, then to older versions.' });
  assert.equal(editLink({ repo, editionId: '7.2.0', docPath: 'deploy-and-operate/install.mdx', mainFiles }).url,
    'https://github.com/wso2/docs-identity-platform/edit/release/7.2.0/docs/deploy-and-operate/install.mdx');
  assert.equal(editLink({ repo, editionId: '7.2.0', docPath: 'guides/mfa.mdx', mainFiles: null }).url,
    'https://github.com/wso2/docs-identity-platform/edit/release/7.2.0/docs/guides/mfa.mdx', 'unknown main: the branch file, which exists');
  assert.equal(editLink({ repo: undefined, editionId: 'cloud', docPath: 'x.mdx' }), null);
});

test('"Edit this page" in a Doc space directory: <dir>/docs/ on main, else the Edition\'s prefixed branch', () => {
  const repo = 'wso2/docs-identity-platform';
  const mainFiles = new Set(['identity-server/docs/guides/mfa.mdx']);
  assert.deepEqual(editLink({ repo, editionId: '7.2.0', docPath: 'guides/mfa.mdx', mainFiles, dir: 'identity-server', branch: 'identity-server/release/7.2.0' }),
    { url: 'https://github.com/wso2/docs-identity-platform/edit/main/identity-server/docs/guides/mfa.mdx', note: 'Fixes apply to the newest docs first, then to older versions.' });
  assert.equal(editLink({ repo, editionId: '7.2.0', docPath: 'deploy-and-operate/install.mdx', mainFiles, dir: 'identity-server', branch: 'identity-server/release/7.2.0' }).url,
    'https://github.com/wso2/docs-identity-platform/edit/identity-server/release/7.2.0/identity-server/docs/deploy-and-operate/install.mdx');
  assert.equal(editLink({ repo, editionId: '7.3.0', docPath: 'x.mdx', mainFiles: null, dir: 'identity-server' }).url,
    'https://github.com/wso2/docs-identity-platform/edit/identity-server/release/7.3.0/identity-server/docs/x.mdx', 'the default branch carries the directory prefix');
  // A Cloud part's page in a family Cloud tree is edited in the part's own directory on main.
  assert.equal(editLink({ repo, editionId: 'cloud', docPath: 'guides/mfa.mdx', mainFiles: null, dir: 'identity-server' }).url,
    'https://github.com/wso2/docs-identity-platform/edit/main/identity-server/docs/guides/mfa.mdx');
});

test('mainBranchFiles lists repo paths of a Doc space in a subdirectory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-main-files-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'identity-server', 'docs', 'guides'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'identity-platform', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'identity-server', 'docs', 'guides', 'mfa.mdx'), '# x\n');
  fs.writeFileSync(path.join(dir, 'identity-platform', 'docs', 'index.mdx'), '# y\n');
  git('add', '.');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'x');
  assert.deepEqual([...mainBranchFiles({ root: path.join(dir, 'identity-server') })], ['identity-server/docs/guides/mfa.mdx']);
  assert.equal(repoPathOf(path.join(dir, 'identity-server')), 'identity-server');
  assert.equal(repoPathOf(os.tmpdir()), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('"Report an issue" prefills the page URL, the Edition and selected text', () => {
  const url = new URL(issueLink({
    issues: { repo: 'wso2/docs-is', template: 'docs-issue.md' }, pageUrl: 'https://docs.wso2.com/identity-platform/7.3.0/guides/mfa/',
    pageTitle: 'Add MFA', editionName: 'Identity Server 7.3.0', selection: 'line one\nline two', reason: 'Inaccurate',
  }));
  assert.equal(url.origin + url.pathname, 'https://github.com/wso2/docs-is/issues/new');
  assert.equal(url.searchParams.get('title'), 'Docs: Add MFA');
  assert.equal(url.searchParams.get('template'), 'docs-issue.md');
  const body = url.searchParams.get('body');
  for (const s of ['**Page:** https://docs.wso2.com/identity-platform/7.3.0/guides/mfa/', '**Edition:** Identity Server 7.3.0', '**Feedback:** Inaccurate', '> line one\n> line two']) {
    assert.ok(body.includes(s), s);
  }
  assert.equal(issueLink({ issues: undefined }), null);
});

test('feedback events: a vote, then an optional reason, with no free text', () => {
  assert.deepEqual(FEEDBACK_REASONS.map((r) => r.label), ['Inaccurate', 'Missing information', 'Hard to follow', "Example doesn't work", 'Other']);
  assert.deepEqual(feedbackEvent({ kind: 'vote', docSpace: 'identity-platform', edition: '7.3.0', asLatest: true, page: '/identity-platform/latest/', vote: 'yes' }),
    { v: 1, kind: 'vote', docSpace: 'identity-platform', edition: '7.3.0', latest: true, page: '/identity-platform/latest/', vote: 'yes' });
  assert.equal(feedbackEvent({ kind: 'reason', vote: 'no', reason: 'other' }).reason, 'other');
});

test('fixed dataLayer event names', () => {
  assert.deepEqual(Object.values(EVENTS), ['docs_page_view', 'docs_edition_switch', 'docs_search', 'docs_copy_page', 'docs_open_in_ai', 'docs_feedback', 'docs_404']);
});

// Runs the head script against a fake document and lists the scripts it adds.
function runHeadScript(hostname) {
  const added = [];
  const el = () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const window = { location: { hostname } };
  const document = { createElement: el, head: { appendChild: (s) => added.push(s) } };
  vm.runInNewContext(analyticsHeadScript({ hosts: ['docs.wso2.com'] }), { window, document });
  return { added, window };
}

test('GTM and CookiePro load only on the production host, CookiePro first', () => {
  const prod = runHeadScript('docs.wso2.com');
  assert.deepEqual(prod.added.map((s) => s.src), [
    'https://cookie-cdn.cookiepro.com/scripttemplates/otSDKStub.js',
    'https://www.googletagmanager.com/gtm.js?id=GTM-PSTXMT',
  ]);
  assert.ok(prod.added.every((s) => s.async === false), 'non-async, so they run in order');
  assert.equal(prod.added[0].attrs['data-domain-script'], '486163bc-a8c5-40d8-b185-c707cc718a23');
  assert.equal(typeof prod.window.OptanonWrapper, 'function');
  for (const host of ['docs-staging.wso2.com', 'localhost']) assert.deepEqual(runHeadScript(host).added, [], host);
});

test('docs: links to a Doc space that is not on WSO2 Docs yet fail', () => {
  const policy = loadPolicy();
  policy.docSpaces['api-platform'].status = 'legacy';
  assert.throws(() => resolveDocsLink('docs:api-platform/latest/x', policy, 'https://docs.wso2.com'), /not on WSO2 Docs yet/);
  assert.throws(() => resolveDocsLink('docs:ai-gateway/cloud/x', policy, 'https://docs.wso2.com'), /Cloud part of "api-platform", which is not on WSO2 Docs yet/);
});

test('the published manifest carries what the chrome needs', () => {
  const m = publicManifest(loadPolicy());
  assert.equal(m.schemaVersion, 1);
  const ip = m.docSpaces['identity-platform'];
  assert.equal(ip.editLinks, false, 'hidden during the Pilot');
  assert.deepEqual(ip.issues, { repo: 'wso2/docs-is' });
  assert.deepEqual(ip.editionNames, { cloud: 'Identity Platform Cloud' });
  assert.deepEqual(m.docSpaces['identity-server'].editionNames, { selfHosted: 'Identity Server {version}' });
  assert.deepEqual(m.docSpaces['identity-server'].cloud, { in: 'identity-platform' });
  assert.equal(m.docSpaces['api-platform'].status, 'live');
  assert.equal(m.docSpaces.sandbox.listed, false, 'Unlisted: the edge sends noindex');
});
