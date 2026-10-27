// AI/LLM outputs end to end on the stub Content repo: builds Cloud and 7.3.0
// (one after another: they share site/.docusaurus), checks the Markdown twins,
// joined guides, API twins, llms.txt and llms-full.txt, then publishes both to
// the local Edge Worker (Miniflare, as in edge-e2e.test.mjs) and exercises the
// .md route, the root llms.txt, robots.txt and the MCP endpoint, with a fake
// Typesense server behind search_docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMarkdownTwins } from '../lib/twin-checks.mjs';
import { startLocalEdge } from '../worker/local.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// The stub repo in the Pilot's layout: Identity Server's main line is its
// Cloud part, built into Identity Platform Cloud's tree at identity-server/.
const fixture = path.join(root, 'fixtures', 'stub-repo', 'identity-server');
const family = path.join(root, 'fixtures', 'stub-repo', 'identity-platform');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-llm-'));
const EDGE_PORT = 4588;
const SEARCH_PORT = 4589;
const CLOUD = 'https://docs.wso2.com/identity-platform/cloud/identity-server';
const IS = 'https://docs.wso2.com/identity-server';

// `at`: where the checked pages are in the build (the Cloud part's folder).
function build(name, { in: dir0 = fixture, at = '' } = {}, ...args) {
  const dir = path.join(out, name);
  execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'build', dir0, '--out', dir, ...args], { stdio: 'pipe' });
  return {
    dir,
    part: path.join(dir, at),
    md: (rel) => fs.readFileSync(path.join(dir, at, rel), 'utf8'),
    has: (rel) => fs.existsSync(path.join(dir, at, rel)),
    rootMd: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    rootHas: (rel) => fs.existsSync(path.join(dir, rel)),
  };
}

const frontMatter = (md) => Object.fromEntries([.../^---\n([^]*?)\n---\n/.exec(md)[1].matchAll(/^(\w+): "?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2]]));

test('Markdown twins, llms.txt and the MCP endpoint for the stub Content repo', { timeout: 900_000 }, async (t) => {
  const c = build('cloud', { in: family, at: 'identity-server/' }, '--edition', 'cloud');
  const s = build('730', {}, '--edition', '7.3.0');

  await t.test('a twin per page, at <page>.md, with front matter', () => {
    assert.ok(c.rootHas('identity-server.md') && c.rootHas('index.md'), 'the part\'s home twin follows the tree\'s rule; the family home has its own');
    for (const rel of ['get-started/quick-start.md', 'guides/mfa.md', 'guides/cloud-billing.md', 'reference.md', 'reference/apis/notifications.md']) assert.ok(c.has(rel), rel);
    assert.ok(!s.has('guides/cloud-billing.md') && s.has('deploy-and-operate/install.md'), 'page-level markers drop twins too');
    assert.deepEqual(frontMatter(c.md('guides/mfa.md')), {
      title: 'Add multi-factor authentication', description: 'Require a second factor when users sign in to your application.',
      docSpace: 'identity-server', edition: 'cloud', editionName: 'Identity Server Cloud',
      url: `${CLOUD}/guides/mfa/`, canonical: `${CLOUD}/guides/mfa/`, type: 'how-to',
    });
    assert.equal(frontMatter(s.md('guides/mfa.md')).canonical, `${IS}/latest/guides/mfa/`, 'the pinned twin of latest canonicalises to /latest/');
    assert.equal(frontMatter(s.md('guides/mfa.md')).editionName, 'Identity Server 7.3.0');
  });

  await t.test('markers, partials and variables are resolved per Edition', () => {
    const cq = c.md('get-started/quick-start.md');
    const sq = s.md('get-started/quick-start.md');
    for (const m of ['MARKER-CLOUD-ONLY', 'MARKER-FROM-740', 'MARKER-FROM-NEXT', 'your organization URL']) assert.match(cq, new RegExp(m));
    for (const m of ['MARKER-SELF-HOSTED-ONLY', 'port 9443']) assert.doesNotMatch(cq, new RegExp(m));
    for (const m of ['MARKER-SELF-HOSTED-ONLY', 'MARKER-FROM-730', 'port 9443', 'open https://localhost:9443/console']) assert.match(sq, new RegExp(m));
    for (const m of ['MARKER-CLOUD-ONLY', 'MARKER-FROM-740', 'MARKER-FROM-NEXT']) assert.doesNotMatch(sq, new RegExp(m));
    assert.doesNotMatch(sq, /## Agent identities|Edition|edition\./);
    assert.doesNotMatch(c.md('guides/mfa.md'), /MARKER-PARTIAL-SELF-HOSTED/);
    assert.match(s.md('guides/mfa.md'), /Enable the authenticator in `deployment\.toml` first\. MARKER-PARTIAL-SELF-HOSTED/, 'partials are inlined');
    assert.match(s.md('index.md'), /^# WSO2 Identity Server documentation$/m);
  });

  await t.test('components in their Markdown form, links to twins, built images', () => {
    const mfa = c.md('guides/mfa.md');
    assert.match(mfa, /^> \*\*Note:\*\* Users enroll their second factor the next time they sign in\. MARKER-ADMONITION$/m);
    assert.match(mfa, /^### TOTP\n\nScan the QR code with an authenticator app\. MARKER-TAB-TOTP\n\n### Email OTP\n\nEnter the code/m);
    assert.match(mfa, /^\*\*Why a second factor\?\*\*\n\nA stolen password alone can no longer sign in\. MARKER-DETAILS$/m);
    assert.match(mfa, /\[quick start\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/get-started\/quick-start\.md#register-an-application\)/);
    const img = /!\[Sign-in flow with a second factor\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/(assets\/images\/mfa-flow-[0-9a-f]+\.png)\)/.exec(mfa);
    assert.ok(img && c.rootHas(img[1]), 'the image points at the file the build emitted (one asset folder per tree)');
    assert.doesNotMatch(mfa, /<\/?[A-Za-z][^>]*>|^import /m, 'no JSX or imports left');
    assert.match(c.rootMd('identity-server.md'), /\[API Manager guides\]\(https:\/\/docs\.wso2\.com\/api-manager\/latest\/guides\.md\)/, 'docs: links point at the other twin');
  });

  await t.test('export: single folders join their pages in sidebar order', () => {
    const guide = c.md('guides.md');
    assert.match(guide, /^# Guides\n\nTask guides for the most common setups\.\n\n## Agent identities\n/m);
    const order = ['## Agent identities', '## Billing', '## Add multi-factor authentication', '### Choose a factor', '#### TOTP'].map((h) => guide.indexOf(`\n${h}\n`));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `headings in order, shifted one level: ${order}`);
    assert.doesNotMatch(s.md('guides.md'), /Billing|Agent identities/);
  });

  await t.test('API pages: overview, compact operation list and the YAML, per Edition', () => {
    const api = c.md('reference/apis/notifications.md');
    assert.match(api, /^Send notifications to users and list the ones already sent\.$/m, 'the overview');
    assert.match(api, /OpenAPI definition \(YAML\): \[reference\/apis\/notifications\/openapi\.yaml\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/reference\/apis\/notifications\/openapi\.yaml\)/);
    assert.match(api, /^- \[`GET \/notifications\/usage`\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/reference\/apis\/notifications\/notifications-operations\/#op-getNotificationUsage\): Get notification usage$/m, 'split APIs link to the tag page');
    assert.doesNotMatch(s.md('reference/apis/notifications.md'), /notifications\/usage/, 'the Cloud-only operation comes from openapi.cloud.yaml');
    assert.match(c.md('reference/apis/applications.md'), /^## Operations$/m);
    assert.ok(c.has('reference/apis/notifications/openapi.yaml'));
    assert.doesNotMatch(api, /Api[A-Z]\w*|<\w/, 'no API layout components');
  });

  await t.test('llms.txt and llms-full.txt per Edition', () => {
    const l = c.md('llms.txt');
    assert.match(l, /^# Identity Server: Identity Server Cloud\n\n> /, 'the part\'s own llms.txt');
    assert.match(c.rootMd('llms.txt'), /^# Identity Platform Cloud: Identity Platform Cloud\n/);
    assert.match(l, /## Get started\n\n- \[Quick start\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/get-started\/quick-start\.md\): Sign in to the console and register your first application\.\n/);
    assert.match(l, /## Guides\n\n- \[Guides: all pages in one file\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/guides\.md\)/);
    assert.match(l, /- \[Billing\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/guides\/cloud-billing\.md\)/);
    assert.match(l, /## OpenAPI definitions\n\n- \[Application management API \(OpenAPI YAML\)\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/reference\/apis\/applications\/openapi\.yaml\)/);
    assert.doesNotMatch(s.md('llms.txt'), /Billing/);
    assert.match(s.md('llms.txt'), /## Deploy and operate\n\n- \[Install\]/);
    const full = s.md('llms-full.txt');
    const at = (x) => full.indexOf(x);
    assert.ok(at('Source: https://docs.wso2.com/identity-server/7.3.0/get-started/quick-start/') < at('MARKER-PARTIAL-SELF-HOSTED'), 'sidebar order');
    assert.ok(at('MARKER-PARTIAL-SELF-HOSTED') < at('MARKER-PAGE-SELF-HOSTED'));
    assert.doesNotMatch(full, /^title: /m, 'pages without their front matter');
  });

  await t.test('the Markdown twin checks pass, and catch leftovers and broken links', () => {
    assert.deepEqual(checkMarkdownTwins(c.dir), [], 'the whole tree, the part\'s twins included');
    assert.deepEqual(checkMarkdownTwins(s.dir), []);
    const broken = path.join(out, 'broken');
    fs.cpSync(s.dir, broken, { recursive: true });
    fs.appendFileSync(path.join(broken, 'guides', 'mfa.md'), '\n<Tabs>\n\n[gone](https://docs.wso2.com/identity-server/7.3.0/guides/gone.md) [anchor](https://docs.wso2.com/identity-server/7.3.0/get-started/quick-start.md#nope)\n');
    assert.deepEqual(checkMarkdownTwins(broken).map((p) => `${p.file}: ${p.message.replace(/ on line \d+/, '')}`), [
      'guides/mfa.md: leftover JSX component: <Tabs>',
      'guides/mfa.md: link https://docs.wso2.com/identity-server/7.3.0/guides/gone.md: no such twin in this Edition',
      'guides/mfa.md: link https://docs.wso2.com/identity-server/7.3.0/get-started/quick-start.md#nope: no #nope on that page',
    ]);
  });

  await t.test('the Copy page menu sits right after the title (and its version notice), not on API pages', () => {
    const html = fs.readFileSync(path.join(c.part, 'guides', 'mfa', 'index.html'), 'utf8');
    assert.match(html, /<header><h1>Add multi-factor authentication<\/h1><\/header>(<div class="wso2-notices" data-wso2-chrome=""><div class="wso2-notice wso2-notice--info" role="note"><div class="wso2-notice__body"><span data-wso2-version-notice="cloud">[^<]*<\/span><\/div><\/div><\/div>)?\s*<div class="[^"]*" data-page-actions=""><div[^>]*><button type="button"[^>]*>Copy page<\/button><button[^>]*aria-haspopup="menu" aria-expanded="false"/);
    assert.doesNotMatch(fs.readFileSync(path.join(c.part, 'reference', 'apis', 'applications', 'index.html'), 'utf8'), /data-page-actions/);
  });

  // ---------- on the local edge -------------------------------------------
  const searches = [];
  const searchServer = http.createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${SEARCH_PORT}`);
    searches.push({ path: u.pathname, q: u.searchParams.get('q'), filter: u.searchParams.get('filter_by'), key: req.headers['x-typesense-api-key'] });
    const records = JSON.parse(fs.readFileSync(path.join(s.dir, '_platform', 'search-records.json'), 'utf8'));
    const hits = records.filter((r) => r.content.toLowerCase().includes(u.searchParams.get('q').toLowerCase())).slice(0, 3)
      .map((r) => ({ document: { url: r.url, docSpace: r.docSpace, edition: r.edition, content: r.content, 'hierarchy.lvl1': r.hierarchy.lvl1, 'hierarchy.lvl2': r.hierarchy.lvl2 } }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ hits }));
  });
  await new Promise((r) => searchServer.listen(SEARCH_PORT, '127.0.0.1', r));
  t.after(() => searchServer.close());

  const vars = { TYPESENSE_HOST: `http://127.0.0.1:${SEARCH_PORT}`, TYPESENSE_COLLECTION: 'wso2-docs', TYPESENSE_SEARCH_KEY: 'search-only-test-key' };
  const edge = await startLocalEdge({ port: EDGE_PORT, persist: path.join(out, 'miniflare'), env: 'staging', vars });
  t.after(() => edge.mf.dispose());
  const env = { ...process.env, ...edge.s3 };
  const release = (...args) => execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), ...args], { env, encoding: 'utf8' });
  const get = (p, init) => fetch(`${edge.origin}${p}`, { redirect: 'manual', ...init });

  await t.test('publish (the release check re-runs the twin checks) and flip', () => {
    assert.match(release('publish', '--storage', 's3://docs-staging', '--dir', c.dir, '--space', 'identity-platform', '--segment', 'cloud', '--edition', 'cloud', '--tag', 'cloud-2026.10.21.1'), /Published \d+ files/);
    release('publish', '--storage', 's3://docs-staging', '--dir', s.dir, '--space', 'identity-server', '--segment', '7.3.0', '--edition', '7.3.0', '--tag', 'identity-server/7.3.0-docs.1');
    release('flip', '--storage', 's3://docs-staging', '--env', 'staging', '--deploy', 'identity-platform/cloud=cloud-2026.10.21.1', '--deploy', 'identity-server/7.3.0=7.3.0-docs.1');
  });

  await t.test('the Edge Worker serves twins at <page>.md and the llms files', async () => {
    let r = await get('/identity-platform/cloud/identity-server/guides/mfa.md');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.equal(await r.text(), c.md('guides/mfa.md'));
    assert.equal(await (await get('/identity-server/7.3.0/index.md')).text(), s.md('index.md'));
    assert.equal(await (await get('/identity-platform/cloud/identity-server/guides.md')).text(), c.md('guides.md'));
    assert.equal(await (await get('/identity-platform/cloud/identity-server.md')).text(), c.rootMd('identity-server.md'), 'the part home\'s twin');
    r = await get('/identity-server/7.3.0/llms.txt');
    assert.match(r.headers.get('content-type'), /^text\/plain/);
    assert.equal(await r.text(), s.md('llms.txt'));
    const rootIndex = await (await get('/llms.txt')).text();
    assert.match(rootIndex, /## Identity Platform Cloud\n\n- \[Identity Platform Cloud\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/llms\.txt\)/);
    assert.match(rootIndex, /## Identity Server\n\n- \[Identity Server Cloud\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/llms\.txt\): Cloud docs, part of Identity Platform Cloud/, 'a Cloud part\'s llms.txt, in its platform\'s tree');
    assert.match(rootIndex, /## Optional\n\n- \[Identity Server 7\.3\.0\]\(https:\/\/docs\.wso2\.com\/identity-server\/7\.3\.0\/llms\.txt\)/);
    assert.doesNotMatch(rootIndex, /agent-manager|7\.1\.0/, 'legacy Doc spaces and Editions are not in the root index');
    assert.equal(await (await get('/robots.txt')).text(), 'User-agent: *\nDisallow: /\n', 'staging disallows every crawler');
  });

  const mcp = async (method, params, id = 1) => {
    const r = await get('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    assert.equal(r.status, 200);
    return (await r.json()).result;
  };

  await t.test('MCP over streamable HTTP: initialize, list_editions, get_page, search_docs', async () => {
    const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.serverInfo.name, 'wso2-docs');
    assert.equal((await get('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status, 202);
    assert.deepEqual((await mcp('tools/list')).tools.map((x) => x.name), ['list_editions', 'get_page', 'search_docs']);

    const editions = (await mcp('tools/call', { name: 'list_editions', arguments: { docSpace: 'identity-server' } })).structuredContent.docSpaces[0];
    assert.deepEqual(editions.editions.filter((e) => e.url).map((e) => e.id), ['7.3.0'], 'deployed Editions have URLs');
    assert.equal(editions.editions.find((e) => e.id === '7.3.0').llmsTxt, `${edge.origin}/identity-server/7.3.0/llms.txt`);

    const page = await mcp('tools/call', { name: 'get_page', arguments: { url: `${IS}/7.3.0/guides/mfa/` } });
    assert.equal(page.content[0].text, s.md('guides/mfa.md'));

    const found = await mcp('tools/call', { name: 'search_docs', arguments: { query: 'passkeys', docSpace: 'identity-server', edition: '7.3.0' } });
    assert.equal(searches.at(-1).filter, '(docSpace:=`identity-server` && edition:=[`7.3.0`])');
    assert.equal(searches.at(-1).key, 'search-only-test-key');
    const first = found.structuredContent.results[0];
    assert.ok(first, found.content[0].text);
    assert.match(first.url, new RegExp(`^${edge.origin}/identity-server/7\\.3\\.0/`));
    const twin = await mcp('tools/call', { name: 'get_page', arguments: { url: first.markdownUrl } });
    assert.ok(!twin.isError, `${first.markdownUrl} resolves through get_page`);
  });

  await t.test('production rules: no MCP, AI crawlers allowed, twins not indexed', async () => {
    await edge.reconfigure('production', vars);
    assert.equal((await get('/mcp', { method: 'POST', body: '{}' })).status, 404, 'staging only during the Pilot');
    assert.match(await (await get('/robots.txt')).text(), /User-agent: GPTBot\n(?:User-agent: .+\n)*Allow: \//);
    assert.equal((await get('/identity-platform/cloud/identity-server/guides/mfa.md')).headers.get('x-robots-tag'), 'noindex');
    assert.equal((await get('/identity-platform/cloud/identity-server/guides/mfa/')).headers.get('x-robots-tag'), null);
  });
});
