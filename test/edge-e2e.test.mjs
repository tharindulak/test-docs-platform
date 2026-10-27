// End to end, locally: builds the stub Content repo (the Pilot's layout:
// Identity Platform Cloud with Identity Server as its Cloud part, and Identity
// Server 7.3.0, its latest twin and 7.2.0; one after another: they share
// site/.docusaurus),
// publishes them with bin/wso2-release.mjs to a local R2 bucket through its
// S3-compatible API (Miniflare), compiles the redirects into local Workers KV,
// runs the Edge Worker in Miniflare and checks it over HTTP. Ends with a
// rollback by pointer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { bindingKv } from '../lib/kv.mjs';
import { syncRedirects } from '../lib/release.mjs';
import { S3Storage } from '../lib/storage.mjs';
import { LOCAL_CREDENTIALS as CREDS, startLocalEdge } from '../worker/local.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'fixtures', 'stub-repo', 'identity-server');
const family = path.join(root, 'fixtures', 'stub-repo', 'identity-platform');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-edge-e2e-'));
const PORT = 4187;
const REPO = 'wso2/docs-identity-platform';

function build(name, content, ...args) {
  const dir = path.join(out, name);
  execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'build', content, '--out', dir, ...args], { stdio: 'pipe' });
  return dir;
}

test('a stub Edition goes from tag to the staging edge and rolls back by pointer', { timeout: 900_000 }, async (t) => {
  const dirs = {
    cloud: build('cloud', family, '--edition', 'cloud'),
    '7.3.0': build('730', fixture, '--edition', '7.3.0'),
    latest: build('latest', fixture, '--edition', '7.3.0', '--as-latest'),
  };
  dirs['7.2.0'] = build('720', fixture, '--edition', '7.2.0', '--latest-pages', path.join(dirs.latest, '_platform', 'pages.json'));

  const edge = await startLocalEdge({ port: PORT, persist: path.join(out, 'miniflare'), env: 'staging' });
  const { mf, origin } = edge;
  t.after(() => mf.dispose());
  const s3env = { ...process.env, ...edge.s3 };
  const release = (...args) => execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), ...args], { env: s3env, encoding: 'utf8' });
  const storage = new S3Storage({ endpoint: s3env.R2_ENDPOINT, bucket: 'docs-staging', ...CREDS });
  const get = (p, init) => fetch(`${origin}${p}`, { redirect: 'manual', ...init });
  const page = async (p) => {
    const r = await get(p);
    return { r, html: await r.text() };
  };

  await t.test('plan: a prefixed version tag that feeds latest builds the Edition and its latest twin from its directory', () => {
    const plan = JSON.parse(release('plan', '--repo', REPO, '--tag', 'identity-server/7.3.0-docs.1'));
    assert.deepEqual(plan.deployments.map((d) => `${d.dir}:${d.segment}:${d.asLatest}`), ['identity-server:latest:true', 'identity-server:7.3.0:false']);
    assert.equal(plan.flip, 'identity-server/latest=7.3.0-docs.1 identity-server/7.3.0=7.3.0-docs.1');
    const cloud = JSON.parse(release('plan', '--repo', REPO, '--tag', 'identity-platform/cloud-2026.10.21.1'));
    assert.deepEqual(cloud.deployments.map((d) => `${d.space}/${d.segment}`), ['identity-platform/cloud'], 'one family Cloud tree, no latest copy');
  });

  await t.test('publish to immutable release folders through the S3 API, then flip', async () => {
    const pub = (segment, edition, tag) => release('publish', '--storage', 's3://docs-staging', '--dir', dirs[segment], '--space', segment === 'cloud' ? 'identity-platform' : 'identity-server', '--segment', segment, '--edition', edition, '--tag', tag, '--source-repo', REPO);
    assert.match(pub('cloud', 'cloud', 'identity-platform/cloud-2026.10.21.1'), /Published \d+ files/);
    pub('7.3.0', '7.3.0', 'identity-server/7.3.0-docs.1');
    pub('latest', '7.3.0', 'identity-server/7.3.0-docs.1');
    pub('7.2.0', '7.2.0', 'identity-server/7.2.0-docs.1');
    assert.match(pub('7.2.0', '7.2.0', 'identity-server/7.2.0-docs.1'), /already complete/, 're-running a publish uploads nothing');
    const info = JSON.parse(new TextDecoder().decode((await storage.get('_releases/identity-server/latest/7.3.0-docs.1/_platform/release.json')).body));
    assert.equal(info.tag, 'identity-server/7.3.0-docs.1', 'the release folder drops the prefix; release.json keeps the tag');

    // Nothing is live before the flip.
    assert.equal((await get('/identity-server/7.3.0/')).status, 404);
    release('flip', '--storage', 's3://docs-staging', '--env', 'staging',
      '--deploy', 'identity-platform/cloud=cloud-2026.10.21.1',
      '--deploy', 'identity-server/latest=7.3.0-docs.1 identity-server/7.3.0=7.3.0-docs.1',
      '--deploy', 'identity-server/7.2.0=7.2.0-docs.1');
    const { size, conflicts } = await syncRedirects(storage, bindingKv(await mf.getKVNamespace('REDIRECTS')));
    assert.ok(size >= 6, `redirect table has ${size} entries`);
    // The stub's one redirects.yaml is shared by every Edition (the Cloud part's too), so its 7.3.0 legacy URL clashes.
    assert.ok(conflicts.some((c) => c.key === 'is.docs.wso2.com/en/7.3.0/guides/authentication/mfa/'));
  });

  await t.test('routing: each path is served from its release folder', async () => {
    const pinned = await page('/identity-server/7.3.0/guides/mfa/');
    assert.equal(pinned.r.status, 200);
    assert.equal(pinned.r.headers.get('x-docs-release'), 'identity-server/7.3.0/7.3.0-docs.1');
    assert.match(pinned.html, /<title[^>]*>[^<]*Identity Server 7\.3\.0 \| WSO2 Docs<\/title>/);
    const latest = await page('/identity-server/latest/guides/mfa/');
    assert.equal(latest.r.headers.get('x-docs-release'), 'identity-server/latest/7.3.0-docs.1');
    assert.match(latest.html, /<link[^>]*rel="canonical"[^>]*href="https:\/\/docs\.wso2\.com\/identity-server\/latest\/guides\/mfa\/"/);
    // The Cloud part, in its platform's Cloud tree: its own canonical, titled with the part's Cloud Edition.
    const cloud = await page('/identity-platform/cloud/identity-server/guides/cloud-billing/');
    assert.equal(cloud.r.status, 200);
    assert.equal(cloud.r.headers.get('x-docs-release'), 'identity-platform/cloud/cloud-2026.10.21.1');
    assert.match(cloud.html, /<title[^>]*>Billing \| Identity Server Cloud \| WSO2 Docs<\/title>/);
    assert.match(cloud.html, /<link[^>]*rel="canonical"[^>]*href="https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/guides\/cloud-billing\/"/);
    const home = await page('/identity-platform/cloud/');
    assert.match(home.html, /MARKER-FAMILY-HOME/);
    assert.match(home.html, /href="https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/guides\/mfa\/"/, 'docs:identity-server/cloud/ links resolve to the platform\'s Cloud address');
    assert.equal((await get('/identity-server/7.3.0/guides/cloud-billing/')).status, 404, 'Cloud-only page is not in 7.3.0');
    const older = await page('/identity-server/7.2.0/');
    assert.equal(older.r.status, 200);
    assert.match(older.r.headers.get('content-type'), /^text\/html/);
  });

  await t.test('trailing slash 301; bare product addresses 302 to where the version selector opens', async () => {
    let r = await get('/identity-server/7.3.0/guides/mfa?x=1');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/identity-server/7.3.0/guides/mfa/?x=1');
    const to = async (p) => {
      const x = await get(p);
      return `${x.status} ${x.headers.get('location')}`;
    };
    assert.equal(await to('/identity-server/'), '302 /identity-platform/cloud/identity-server/', 'a Cloud part opens in its platform\'s Cloud tree');
    assert.equal(await to('/identity-platform/'), '302 /identity-platform/cloud/');
    assert.equal(await to('/identity-platform'), '301 /identity-platform/');
    // The part has no /cloud/ of its own, and the Cloud-only family no /latest/ copy.
    assert.equal(await to('/identity-server/cloud/guides/mfa/?x=1'), '302 /identity-platform/cloud/identity-server/guides/mfa/?x=1');
    assert.equal(await to('/identity-platform/latest/get-started/first-organization/'), '302 /identity-platform/cloud/get-started/first-organization/');
  });

  await t.test('a page move from redirects.yaml, served from Workers KV, also for the Cloud part under its platform\'s address', async () => {
    const r = await get('/identity-server/7.3.0/guides/multi-factor-auth/');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/identity-server/7.3.0/guides/mfa/');
    assert.equal((await get('/identity-server/latest/guides/multi-factor-auth/')).headers.get('location'), '/identity-server/latest/guides/mfa/');
    assert.equal((await get('/identity-platform/cloud/identity-server/guides/multi-factor-auth/')).headers.get('location'), '/identity-platform/cloud/identity-server/guides/mfa/');
    assert.equal((await get('/identity-platform/cloud/welcome/')).headers.get('location'), '/identity-platform/cloud/', 'the family\'s own moves');
  });

  await t.test('staging host: noindex everywhere and robots.txt disallows all', async () => {
    for (const p of ['/identity-platform/cloud/', '/identity-server/latest/guides/mfa/', '/manifest.json']) {
      assert.equal((await get(p)).headers.get('x-robots-tag'), 'noindex', p);
    }
    assert.equal(await (await get('/robots.txt')).text(), 'User-agent: *\nDisallow: /\n');
  });

  await t.test('runtime files: manifest.json (policy + state) and the sitemap index', async () => {
    const r = await get('/manifest.json');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
    const m = await r.json();
    assert.equal(m.environment, 'staging');
    assert.equal(m.docSpaces['identity-server'].latest, '7.3.0');
    assert.deepEqual(m.docSpaces['identity-server'].deployments.latest, { release: '7.3.0-docs.1', tag: 'identity-server/7.3.0-docs.1', edition: '7.3.0' });
    assert.equal(m.docSpaces['identity-server'].editions.find((e) => e.id === '7.2.0').tag, 'identity-server/7.2.0-docs.1');
    assert.deepEqual(m.docSpaces['identity-platform'].editions, [{ id: 'cloud', status: 'live', parts: ['identity-server'], tag: 'identity-platform/cloud-2026.10.21.1' }]);
    const sitemap = await (await get('/sitemap.xml')).text();
    assert.equal([...sitemap.matchAll(/<loc>/g)].length, 4);
    assert.match(sitemap, /https:\/\/docs\.wso2\.com\/identity-server\/latest\/sitemap\.xml/);
    assert.match(sitemap, /https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/sitemap\.xml/);
    assert.match(await (await get('/identity-platform/cloud/sitemap.xml')).text(), /<loc>https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/identity-server\/guides\/mfa\/<\/loc>/, 'Cloud part pages are in the tree\'s sitemap');
  });

  await t.test('cache headers: HTML for minutes, hashed assets forever', async () => {
    const html = await page('/identity-server/7.3.0/');
    assert.equal(html.r.headers.get('cache-control'), 'public, max-age=60');
    const asset = /src="(\/identity-server\/7\.3\.0\/assets\/js\/main\.[0-9a-f]+\.js)"/.exec(html.html)[1];
    const a = await get(asset);
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(a.headers.get('content-type'), /javascript/);
    const etag = a.headers.get('etag');
    assert.equal((await get(asset, { headers: { 'if-none-match': etag } })).status, 304);
  });

  await t.test('404s are per Doc space and counted', async () => {
    const missing = await page('/identity-server/7.3.0/no-such-page/');
    assert.equal(missing.r.status, 404);
    assert.match(missing.html, /Page Not Found/i);
    assert.match(missing.html, /\/identity-server\/7\.3\.0\/assets\//, "the Edition's own 404 page");
    const noEdition = await page('/identity-server/9.9.9/');
    assert.equal(noEdition.r.status, 404);
    assert.match(noEdition.html, /\/identity-server\/latest\/assets\//, "an unknown Edition gets the Doc space's latest 404 page");
    assert.equal((await get('/no-such-space/')).status, 404);
  });

  await t.test('staging crawl gate: pages and links, across deployments, checked on the staging edge', async () => {
    const deploy = ['identity-platform/cloud=cloud-2026.10.21.1', 'identity-server/latest=7.3.0-docs.1', 'identity-server/7.3.0=7.3.0-docs.1', 'identity-server/7.2.0=7.2.0-docs.1'];
    const crawl = () => execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), 'crawl', '--storage', 's3://docs-staging', '--host', origin, ...deploy.flatMap((d) => ['--deploy', d])], { env: s3env, encoding: 'utf8', stdio: 'pipe' });
    // Every Edition's home page has a docs: link to API Manager, and the chrome
    // links to the Landing page, Contribute and, from the products menu, where
    // API Manager, API Platform Cloud, AI Gateway and Monetization open: none
    // is on staging yet.
    assert.throws(crawl, (e) => {
      assert.deepEqual(e.stderr.trim().split('\n').map((l) => l.replace(/ \(linked from .*\)$/, '')).sort(), [
        `crawl: 404 ${origin}/`, `crawl: 404 ${origin}/api-manager/latest/`, `crawl: 404 ${origin}/api-manager/latest/guides/`,
        `crawl: 404 ${origin}/api-platform/cloud/`, `crawl: 404 ${origin}/api-platform/cloud/ai-gateway/`, `crawl: 404 ${origin}/api-platform/cloud/guides/monetization/`,
        `crawl: 404 ${origin}/contribute/`,
      ]);
      assert.match(e.stdout, /Crawled \d+ pages and \d+ links .*: 7 failed/);
      return true;
    });
    // Deploy stand-ins for API Manager's latest twin, the Landing page and
    // Contribute, and the gate passes.
    const standIn = (name, docSpace, edition, baseUrl, pages) => {
      const dir = path.join(out, name);
      for (const [rel, body] of Object.entries({
        ...Object.fromEntries(pages.map((p) => [`${p}index.html`, `<h1>${name} ${p}</h1>`])), '404.html': '<h1>404</h1>', 'sitemap.xml': '<urlset/>',
        ...(docSpace === null ? { 'sitemap-landing.xml': '<urlset><url><loc>https://docs.wso2.com/</loc></url></urlset>' } : {}),
        '_platform/edition.json': JSON.stringify({ docSpace, edition, asLatest: baseUrl.endsWith('/latest/'), baseUrl }),
        '_platform/pages.json': JSON.stringify(pages.map((p) => ({ path: p }))), '_platform/redirects.json': '[]',
      })) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), body);
      }
      return dir;
    };
    release('publish', '--storage', 's3://docs-staging', '--dir', standIn('apim-latest', 'api-manager', '4.7.0', '/api-manager/latest/', ['', 'guides/']), '--space', 'api-manager', '--segment', 'latest', '--edition', '4.7.0', '--tag', 'api-manager/4.7.0-docs.1');
    release('publish', '--storage', 's3://docs-staging', '--dir', standIn('landing', null, null, '/', ['']), '--space', '_landing', '--segment', '_', '--edition', '_', '--tag', 'landing-1');
    release('publish', '--storage', 's3://docs-staging', '--dir', standIn('contribute', 'contribute', '_', '/contribute/', ['']), '--space', 'contribute', '--segment', '_', '--edition', '_', '--tag', 'contribute-1');
    // API Platform Cloud with its AI Gateway part: the products menu's API Platform Cloud, AI Gateway and Monetization open there.
    release('publish', '--storage', 's3://docs-staging', '--dir', standIn('apip-cloud', 'api-platform', 'cloud', '/api-platform/cloud/', ['', 'ai-gateway/', 'guides/monetization/']), '--space', 'api-platform', '--segment', 'cloud', '--edition', 'cloud', '--tag', 'api-platform/cloud-2026.10.21.1');
    release('flip', '--storage', 's3://docs-staging', '--env', 'staging', '--deploy', 'api-manager/latest=4.7.0-docs.1', '--deploy', '_landing/_=landing-1', '--deploy', 'contribute/_=contribute-1', '--deploy', 'api-platform/cloud=cloud-2026.10.21.1');
    assert.equal((await get('/ai-gateway/')).headers.get('location'), '/api-platform/cloud/ai-gateway/');
    assert.match(crawl(), /Crawled \d+ pages and \d+ links .*: 0 failed/);
    // The Landing page is in the sitemap index through its own sitemap.
    assert.match(await (await get('/sitemap.xml')).text(), /<loc>https:\/\/docs\.wso2\.com\/sitemap-landing\.xml<\/loc>/);
    const own = await get('/sitemap-landing.xml');
    assert.equal(own.status, 200);
    assert.match(await own.text(), /<loc>https:\/\/docs\.wso2\.com\/<\/loc>/);
  });

  await t.test('feedback endpoint', async () => {
    const post = (body, headers = {}) => get('/api/feedback', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
    const fb = (o) => ({ v: 1, kind: 'vote', docSpace: 'identity-server', edition: '7.3.0', latest: false, page: '/identity-server/7.3.0/guides/mfa/', ...o });
    let r = await post(fb({ kind: 'reason', vote: 'no', reason: 'hard-to-follow' }));
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal((await post(fb({ vote: 'yes' }))).status, 204);
    assert.equal((await post(fb({ kind: 'reason', vote: 'no', reason: 'free text' }))).status, 400);
    assert.equal((await post(fb({ kind: 'reason', vote: 'no', reason: 'example-does-not-work' }))).status, 204, "the widget's reason ids");
    assert.equal((await post(fb({ page: '/nowhere/', vote: 'yes' }))).status, 400);
    assert.equal((await post(fb({ page: '/identity-server/7.3.0/', vote: 'yes' }), { origin: 'https://evil.example' })).status, 403);
    assert.equal((await get('/api/feedback')).status, 405);
  });

  await t.test('PR previews are served from their own bucket', async () => {
    const previews = { ...s3env };
    execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), 'preview', '--storage', 's3://docs-previews', '--dir', dirs['7.2.0'], '--space', 'identity-server', '--pr', '12', '--edition', '7.2.0'], { env: previews });
    const r = await get('/_preview/identity-server/pr-12/7.2.0/');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex');
    assert.equal((await get('/_preview/identity-server/pr-13/7.2.0/')).status, 404);
  });

  await t.test('rollback by flipping the pointer back', async () => {
    // A second Docs release of 7.3.0: the same build with one visible change.
    const next = path.join(out, '730-docs2');
    fs.cpSync(dirs['7.3.0'], next, { recursive: true });
    const file = path.join(next, 'guides', 'mfa', 'index.html');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</article>', '<p>MARKER-RELEASE-2</p></article>'));
    release('publish', '--storage', 's3://docs-staging', '--dir', next, '--space', 'identity-server', '--segment', '7.3.0', '--edition', '7.3.0', '--tag', 'identity-server/7.3.0-docs.2');
    release('flip', '--storage', 's3://docs-staging', '--env', 'staging', '--deploy', 'identity-server/7.3.0=7.3.0-docs.2');
    let p = await page('/identity-server/7.3.0/guides/mfa/');
    assert.match(p.html, /MARKER-RELEASE-2/);
    assert.equal(p.r.headers.get('x-docs-release'), 'identity-server/7.3.0/7.3.0-docs.2');

    assert.match(release('rollback', '--storage', 's3://docs-staging', '--env', 'staging', '--deployment', 'identity-server/7.3.0'), /rolled back to 7\.3\.0-docs\.1/);
    p = await page('/identity-server/7.3.0/guides/mfa/');
    assert.doesNotMatch(p.html, /MARKER-RELEASE-2/);
    assert.equal(p.r.headers.get('x-docs-release'), 'identity-server/7.3.0/7.3.0-docs.1');
    const state = JSON.parse(release('status', '--storage', 's3://docs-staging'));
    assert.deepEqual(state.deployments['identity-server/7.3.0'].previous, ['7.3.0-docs.2']);
    assert.match(release('gc', '--storage', 's3://docs-staging', '--dry-run'), /Nothing to collect/);
  });

  await t.test('end of life is a manifest change: production edge adds noindex, follow', async () => {
    // The Doc space's team marks 7.2.0 end of life in its docspace.yaml; the
    // compose step publishes it.
    const content = path.join(out, 'content-eol');
    fs.cpSync(path.join(root, 'fixtures', 'content-repos'), content, { recursive: true });
    const file = path.join(content, 'docs-identity-platform', 'identity-server', 'docspace.yaml');
    const manifest = yaml.load(fs.readFileSync(file, 'utf8'));
    manifest.editions.find((e) => e.id === '7.2.0').status = 'end-of-life';
    fs.writeFileSync(file, yaml.dump(manifest));
    const eolPolicy = path.join(out, 'manifest-eol.json');
    assert.match(release('compose', '--content', content, '--out', eolPolicy), /wrote/);
    release('manifest', '--storage', 's3://docs-staging', '--env', 'staging', '--policy', eolPolicy);

    // A stand-in release of the Sandbox, an Unlisted Doc space (listed: false).
    const sandbox = path.join(out, 'sandbox-100');
    for (const [rel, body] of Object.entries({
      'index.html': '<h1>Sandbox</h1>', '404.html': '<h1>404</h1>', 'sitemap.xml': '<urlset/>',
      '_platform/edition.json': JSON.stringify({ docSpace: 'sandbox', edition: '1.0.0', asLatest: false, baseUrl: '/sandbox/1.0.0/' }),
      '_platform/pages.json': JSON.stringify([{ path: '' }]), '_platform/redirects.json': '[]',
    })) {
      fs.mkdirSync(path.dirname(path.join(sandbox, rel)), { recursive: true });
      fs.writeFileSync(path.join(sandbox, rel), body);
    }
    release('publish', '--storage', 's3://docs-staging', '--dir', sandbox, '--space', 'sandbox', '--segment', '1.0.0', '--edition', '1.0.0', '--tag', '1.0.0-docs.1');
    release('flip', '--storage', 's3://docs-staging', '--env', 'staging', '--policy', eolPolicy, '--deploy', 'sandbox/1.0.0=1.0.0-docs.1');

    // The same bucket behind the production configuration (no staging-wide noindex).
    await edge.reconfigure('production', { LEGACY_HOSTS: 'is.docs.wso2.com' });
    assert.equal((await get('/identity-server/7.2.0/guides/mfa/')).headers.get('x-robots-tag'), 'noindex, follow');
    assert.equal((await get('/identity-server/7.3.0/guides/mfa/')).headers.get('x-robots-tag'), null);
    assert.equal((await get('/identity-server/latest/')).headers.get('x-robots-tag'), null);
    assert.equal((await get('/identity-platform/cloud/identity-server/guides/mfa/')).headers.get('x-robots-tag'), null, 'a Cloud part\'s pages are indexed');
    assert.equal((await get('/identity-server/7.3.0/')).headers.get('cache-control'), 'public, max-age=300');
    // An Unlisted Doc space (the Sandbox, listed: false) is served with noindex and left out of the sitemap index.
    assert.equal((await get('/sandbox/1.0.0/')).headers.get('x-robots-tag'), 'noindex');
    const sitemap = await (await get('/sitemap.xml')).text();
    assert.doesNotMatch(sitemap, /7\.2\.0/, 'end-of-life Editions leave the sitemap index');
    assert.doesNotMatch(sitemap, /sandbox/, 'Unlisted Doc spaces stay out of the sitemap index');
    assert.match(await (await get('/robots.txt')).text(), /User-agent: ClaudeBot\n(?:User-agent: .+\n)*Allow: \//, 'production robots.txt (from the Edge Worker) allows AI crawlers');

    // Legacy host (cutover only): page-level 301 to docs.wso2.com.
    const legacy = await mf.dispatchFetch('https://is.docs.wso2.com/en/7.3.0/guides/authentication/mfa/', { redirect: 'manual' });
    assert.equal(legacy.status, 301);
    assert.match(legacy.headers.get('location'), /^https:\/\/docs\.wso2\.com\/identity-(?:server\/7\.[23]\.0|platform\/cloud\/identity-server)\/guides\/mfa\/$/);
    // The legacy site's /en/latest/ follows the latest twin.
    const latest = await mf.dispatchFetch('https://is.docs.wso2.com/en/latest/guides/authentication/mfa/', { redirect: 'manual' });
    assert.equal(latest.status, 301);
    assert.equal(latest.headers.get('location'), 'https://docs.wso2.com/identity-server/latest/guides/mfa/');
  });
});
