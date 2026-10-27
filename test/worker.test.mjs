// Edge Worker rules against in-memory bindings: routing, headers, the
// redirect table, analytics counts and feedback validation. The same Worker
// runs in Miniflare in edge-e2e.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.mjs';
import { cacheControl, route } from '../worker/src/routing.mjs';
import { CONFLUENCE_TARGETS, confluenceRedirect } from '../worker/src/confluence.mjs';

function bucket(files, storedType = null) {
  const objects = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    objects,
    async get(key, opts) {
      if (!objects.has(key)) return null;
      const body = objects.get(key);
      const etag = `"${body.length}-${key.length}"`;
      const meta = {
        httpEtag: etag,
        writeHttpMetadata(h) {
          if (storedType) h.set('content-type', storedType);
        },
        json: async () => JSON.parse(body),
        text: async () => body,
      };
      const inm = opts?.onlyIf?.get?.('if-none-match');
      if (inm === etag) return meta;
      return { ...meta, body: new Response(body).body };
    },
  };
}

function dataset() {
  const points = [];
  return { points, writeDataPoint: (p) => points.push(p) };
}

const manifest = {
  docSpaces: {
    'identity-platform': {
      model: 'cloud-plus-versions', latest: '7.3.0',
      editions: [{ id: 'cloud', status: 'live' }, { id: '7.3.0', status: 'live' }, { id: '7.2.0', status: 'end-of-life' }],
      deployments: {
        cloud: { release: 'cloud-1', tag: 'cloud-1', edition: 'cloud' },
        '7.3.0': { release: 'r730', tag: 'r730', edition: '7.3.0' },
        latest: { release: 'r730', tag: 'r730', edition: '7.3.0' },
        '7.2.0': { release: 'r720', tag: 'r720', edition: '7.2.0' },
      },
    },
    contribute: { model: 'unversioned', editions: [], deployments: { _: { release: 'c1', tag: 'c1', edition: '_' } } },
  },
  landing: { release: 'l1', tag: 'l1', edition: '_' },
};

function env(vars = {}) {
  return {
    DOCS: bucket({
      'manifest.json': manifest,
      '_releases/identity-platform/7.3.0/r730/index.html': '<h1>7.3.0</h1>',
      '_releases/identity-platform/7.3.0/r730/404.html': '<h1>404 in 7.3.0</h1>',
      '_releases/identity-platform/latest/r730/404.html': '<h1>404 in latest</h1>',
      '_releases/identity-platform/latest/r730/guides/mfa/index.html': '<h1>latest mfa</h1>',
      '_releases/identity-platform/latest/r730/guides/mfa.md': '# MFA',
      '_releases/identity-platform/7.2.0/r720/index.html': '<h1>7.2.0</h1>',
      '_releases/identity-platform/7.3.0/r730/assets/js/main.0123abcd.js': 'js',
      '_releases/contribute/_/c1/style/index.html': '<h1>style</h1>',
      '_releases/_landing/_/l1/index.html': '<h1>WSO2 Docs</h1>',
      '_releases/_landing/_/l1/robots.txt': 'User-agent: *\nAllow: /\n',
    }),
    PREVIEWS: bucket({ 'identity-platform/pr-7/cloud/index.html': '<h1>preview</h1>' }),
    REDIRECTS: {
      table: {
        '/identity-platform/7.3.0/old/': JSON.stringify({ to: '/identity-platform/7.3.0/new/', status: 301 }),
        '/identity-platform/7.3.0/': JSON.stringify({ to: '/never/', status: 301 }),
        'is.docs.wso2.com/en/7.3.0/x/': JSON.stringify({ to: '/identity-platform/7.3.0/x/', status: 301 }),
        'is.docs.wso2.com/en/7.3.0/gone/': JSON.stringify({ to: 'https://wso2.com/choreo/docs/insights/#alerts', status: 301 }),
      },
      async get(key) {
        return this.table[key] ?? null;
      },
    },
    FEEDBACK: dataset(),
    NOT_FOUND: dataset(),
    ENVIRONMENT: 'production', NOINDEX_ALL: 'false', DOCS_HOST: 'docs.wso2.com', LEGACY_HOSTS: 'is.docs.wso2.com',
    MANIFEST_TTL_SECONDS: '0', HTML_MAX_AGE: '300',
    ...vars,
  };
}

const call = (e, path, init) => worker.fetch(new Request(`https://docs.wso2.com${path}`, init), e);

test('routing table', () => {
  assert.deepEqual(route(manifest, '/identity-platform/7.3.0/guides'), { type: 'redirect', status: 301, location: '/identity-platform/7.3.0/guides/' });
  assert.deepEqual(route(manifest, '/identity-platform/'), { type: 'redirect', status: 302, location: '/identity-platform/cloud/' }, 'a Doc space with Cloud opens on Cloud');
  assert.equal(route(manifest, '/identity-platform/latest/guides/mfa/').key, '_releases/identity-platform/latest/r730/guides/mfa/index.html');
  assert.equal(route(manifest, '/identity-platform/latest/guides/mfa/').edition, '7.3.0');
  assert.equal(route(manifest, '/identity-platform/latest/guides/mfa.md').key, '_releases/identity-platform/latest/r730/guides/mfa.md');
  assert.equal(route(manifest, '/identity-platform/7.2.0/').eol, true);
  assert.equal(route(manifest, '/contribute/style/').key, '_releases/contribute/_/c1/style/index.html');
  assert.equal(route(manifest, '/').key, '_releases/_landing/_/l1/index.html');
  assert.equal(route(manifest, '/identity-platform/9.9.9/').type, 'miss');
  assert.equal(route(manifest, '/identity-platform/9.9.9/').notFoundKey, '_releases/identity-platform/latest/r730/404.html');
  assert.equal(route(manifest, '/identity-platform/%E0%A4%A/').type, 'bad');
});

// The Pilot's shape: family Clouds with Cloud parts, products with releases
// only, and an Unlisted Doc space.
const pilot = {
  docSpaces: {
    'identity-platform': {
      model: 'cloud-only', latest: 'cloud', listed: true, editions: [{ id: 'cloud', status: 'live', parts: ['identity-server'] }],
      deployments: { cloud: { release: 'c7', tag: 'identity-platform/cloud-2026.10.26.1', edition: 'cloud' } },
    },
    'identity-server': {
      model: 'versions-only', latest: '7.3.0', listed: true, cloud: { in: 'identity-platform' },
      editions: [{ id: '7.3.0', status: 'live' }, { id: '7.2.0', status: 'live' }],
      deployments: { '7.3.0': { release: 'r1', edition: '7.3.0' }, latest: { release: 'r1', edition: '7.3.0' }, '7.2.0': { release: 'r2', edition: '7.2.0' } },
    },
    'ai-gateway': {
      model: 'versions-only', latest: '1.2.0', listed: true, cloud: { in: 'api-platform' },
      editions: [{ id: '1.2.0', status: 'live' }, { id: '2026.09.24', status: 'live' }],
      deployments: { '1.2.0': { release: 'a1', edition: '1.2.0' }, latest: { release: 'a1', edition: '1.2.0' } },
    },
    'api-platform': { model: 'cloud-only', latest: 'cloud', listed: true, editions: [{ id: 'cloud', status: 'live', parts: ['ai-gateway'] }], deployments: {} },
    'api-manager': {
      model: 'versions-only', latest: '4.7.0', listed: true, editions: [{ id: '4.7.0', status: 'live' }],
      deployments: { '4.7.0': { release: 'm1', edition: '4.7.0' }, latest: { release: 'm1', edition: '4.7.0' } },
    },
    sandbox: {
      model: 'cloud-plus-versions', latest: '1.0.0', listed: false, editions: [{ id: 'cloud', status: 'live' }, { id: '1.0.0', status: 'live' }],
      deployments: { '1.0.0': { release: 's1', edition: '1.0.0' } },
    },
  },
  landing: null,
};

test('bare product addresses open where the version selector opens (302)', () => {
  const at = (p) => route(pilot, p);
  assert.deepEqual(at('/identity-server/'), { type: 'redirect', status: 302, location: '/identity-platform/cloud/identity-server/' }, 'a Cloud part opens in its platform\'s tree');
  assert.deepEqual(at('/identity-platform/'), { type: 'redirect', status: 302, location: '/identity-platform/cloud/' });
  assert.deepEqual(at('/api-manager/'), { type: 'redirect', status: 302, location: '/api-manager/latest/' }, 'no Cloud: the newest release');
  // API Platform Cloud is not deployed yet: AI Gateway opens on its newest release meanwhile.
  assert.deepEqual(at('/ai-gateway/'), { type: 'redirect', status: 302, location: '/ai-gateway/latest/' });
  assert.deepEqual(route({ ...pilot, docSpaces: { ...pilot.docSpaces, 'api-platform': { ...pilot.docSpaces['api-platform'], deployments: { cloud: { release: 'p1', edition: 'cloud' } } } } }, '/ai-gateway/'),
    { type: 'redirect', status: 302, location: '/api-platform/cloud/ai-gateway/' });
  // The Sandbox's Cloud is not deployed: its newest release.
  assert.deepEqual(at('/sandbox/'), { type: 'redirect', status: 302, location: '/sandbox/1.0.0/' });
});

test('a Cloud part has no /cloud/ of its own and a Cloud-only Doc space no /latest/ copy', () => {
  assert.deepEqual(route(pilot, '/identity-server/cloud/guides/mfa/'), { type: 'redirect', status: 302, location: '/identity-platform/cloud/identity-server/guides/mfa/' });
  assert.deepEqual(route(pilot, '/identity-server/cloud/'), { type: 'redirect', status: 302, location: '/identity-platform/cloud/identity-server/' });
  assert.deepEqual(route(pilot, '/identity-platform/latest/get-started/'), { type: 'redirect', status: 302, location: '/identity-platform/cloud/get-started/' });
  const part = route(pilot, '/identity-platform/cloud/identity-server/guides/mfa/');
  assert.equal(part.key, '_releases/identity-platform/cloud/c7/identity-server/guides/mfa/index.html', 'a part\'s pages are files of the family Cloud release');
  assert.equal(route(pilot, '/identity-server/latest/').key, '_releases/identity-server/latest/r1/index.html');
  assert.equal(route(pilot, '/ai-gateway/cloud/x/').type, 'miss', 'no redirect into a platform tree that is not deployed');
});

test('a Legacy version\'s WSO2 Docs addresses 302 to its legacyUrl once its deployment is gone', async () => {
  const m = structuredClone(pilot);
  const is = m.docSpaces['identity-server'];
  // 7.2.0 moved to legacyVersions and was retired; 7.1.0 was never on WSO2 Docs.
  is.editions = [{ id: '7.3.0', status: 'live' }, { id: '7.2.0', status: 'legacy', legacyUrl: 'https://is.docs.wso2.com/en/7.2.0/' }, { id: '7.1.0', status: 'legacy', legacyUrl: 'https://is.docs.wso2.com/en/7.1.0/' }];
  delete is.deployments['7.2.0'];
  const legacy = { type: 'redirect', status: 302, location: 'https://is.docs.wso2.com/en/7.2.0/' };
  assert.deepEqual(route(m, '/identity-server/7.2.0/'), legacy);
  assert.deepEqual(route(m, '/identity-server/7.2.0/guides/mfa/'), legacy, 'every page, to the old site\'s Edition home');
  assert.deepEqual(route(m, '/identity-server/7.2.0/guides/mfa.md'), legacy);
  assert.deepEqual(route(m, '/identity-server/7.1.0/get-started/'), { type: 'redirect', status: 302, location: 'https://is.docs.wso2.com/en/7.1.0/' });
  assert.deepEqual(route(m, '/identity-server/7.2.0/guides'), { type: 'redirect', status: 301, location: '/identity-server/7.2.0/guides/' }, 'the trailing slash first');
  // Still deployed (moved to legacyVersions, not retired yet): it keeps serving.
  m.docSpaces['identity-server'].deployments['7.2.0'] = { release: 'r2', edition: '7.2.0' };
  assert.equal(route(m, '/identity-server/7.2.0/').type, 'object');
  delete m.docSpaces['identity-server'].deployments['7.2.0'];
  // A live Edition not deployed yet, or one with no legacyUrl, stays a 404.
  assert.equal(route(m, '/identity-server/9.9.9/').type, 'miss');
  m.docSpaces['identity-server'].editions[2] = { id: '7.1.0', status: 'legacy' };
  assert.equal(route(m, '/identity-server/7.1.0/').type, 'miss');

  const env = { DOCS: bucket({ 'manifest.json': m }), REDIRECTS: { get: async () => null }, MANIFEST_TTL_SECONDS: '0' };
  const res = await worker.fetch(new Request('https://docs.wso2.com/identity-server/7.2.0/guides/mfa/?q=1'), env);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://is.docs.wso2.com/en/7.2.0/', 'the query stays behind: the old site has its own addresses');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('Unlisted Doc spaces get noindex from the edge, also in production', async () => {
  const e = { ...env(), DOCS: bucket({ 'manifest.json': pilot, '_releases/sandbox/1.0.0/s1/index.html': '<h1>sandbox</h1>', '_releases/api-manager/4.7.0/m1/index.html': '<h1>apim</h1>' }) };
  const r = await call(e, '/sandbox/1.0.0/');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.equal((await call(e, '/api-manager/4.7.0/')).headers.get('x-robots-tag'), null);
});

test('Contribute is Unlisted but indexed: an explicit exception to the noindex rule', async () => {
  const m = structuredClone(pilot);
  m.docSpaces.contribute = { model: 'unversioned', listed: false, indexed: true, editions: [], deployments: { _: { release: 'c1', edition: '_' } } };
  const e = { ...env(), DOCS: bucket({ 'manifest.json': m, '_releases/contribute/_/c1/index.html': '<h1>contribute</h1>', '_releases/sandbox/1.0.0/s1/index.html': '<h1>sandbox</h1>' }) };
  const r = await call(e, '/contribute/');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), null);
  assert.equal((await call(e, '/sandbox/1.0.0/')).headers.get('x-robots-tag'), 'noindex', 'other Unlisted Doc spaces keep noindex');
});

test('cache policy', () => {
  assert.equal(cacheControl('_releases/a/b/r/assets/js/main.0123abcd.js'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControl('_releases/a/b/r/assets/css/styles.6bd8795a.css'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControl('_releases/a/b/r/assets/fonts/inter-latin-wght-normal-4f2981d82860061bca3ecb967a2cd084.woff2'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControl('_releases/a/b/r/index.html'), 'public, max-age=300');
  assert.equal(cacheControl('_releases/a/b/r/img/logo.svg', 60), 'public, max-age=60');
});

test('pages, Markdown twins, unversioned spaces and the Landing deployment', async () => {
  const e = env();
  let r = await call(e, '/identity-platform/latest/guides/mfa/');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<h1>latest mfa</h1>');
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  r = await call(e, '/identity-platform/latest/guides/mfa.md');
  assert.equal(r.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal((await call(e, '/contribute/style/')).status, 200);
  assert.equal(await (await call(e, '/')).text(), '<h1>WSO2 Docs</h1>');
  const robots = await (await call(e, '/robots.txt')).text();
  assert.match(robots, /^User-agent: \*\nAllow: \/$/m, 'production robots.txt is the Edge Worker\'s and allows crawling');
  assert.match(robots, /User-agent: GPTBot\n(?:User-agent: .+\n)*Allow: \//, 'AI crawlers are allowed');
  r = await call(e, '/identity-platform/7.3.0/', { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(r.body, null);
  assert.equal((await call(e, '/identity-platform/7.3.0/', { method: 'DELETE' })).status, 405);
});

test('noindex: end-of-life Editions in production, everything on staging', async () => {
  const prod = env();
  assert.equal((await call(prod, '/identity-platform/7.2.0/')).headers.get('x-robots-tag'), 'noindex, follow');
  assert.equal((await call(prod, '/identity-platform/7.3.0/')).headers.get('x-robots-tag'), null);
  const staging = env({ NOINDEX_ALL: 'true', ENVIRONMENT: 'staging' });
  for (const p of ['/identity-platform/7.3.0/', '/identity-platform/7.2.0/', '/identity-platform/', '/nope/']) {
    assert.equal((await call(staging, p)).headers.get('x-robots-tag'), 'noindex', p);
  }
});

test('redirect table: consulted only on a miss, legacy hosts fall through to their origin', async () => {
  const e = env();
  let r = await call(e, '/identity-platform/7.3.0/old/?q=1');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/identity-platform/7.3.0/new/?q=1');
  assert.equal((await call(e, '/identity-platform/7.3.0/')).status, 200, 'a redirect never hides a live page');
  r = await worker.fetch(new Request('https://is.docs.wso2.com/en/7.3.0/x/'), e);
  assert.equal(r.headers.get('location'), 'https://docs.wso2.com/identity-platform/7.3.0/x/');
  r = await worker.fetch(new Request('https://is.docs.wso2.com/en/7.3.0/gone/'), e);
  assert.equal(r.headers.get('location'), 'https://wso2.com/choreo/docs/insights/#alerts', 'an old redirect that already left WSO2 Docs keeps its target');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (req) => new Response(`origin ${new URL(req.url).pathname}`);
  try {
    assert.equal(await (await worker.fetch(new Request('https://is.docs.wso2.com/en/7.1.0/y/'), e)).text(), 'origin /en/7.1.0/y/');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('404s use the Doc space page and are counted in Analytics Engine', async () => {
  const e = env({ ENVIRONMENT: 'staging' });
  let r = await call(e, '/identity-platform/7.3.0/missing/', { headers: { referer: 'https://www.google.com/search' } });
  assert.equal(r.status, 404);
  assert.equal(await r.text(), '<h1>404 in 7.3.0</h1>');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  r = await call(e, '/identity-platform/8.0.0/');
  assert.equal(await r.text(), '<h1>404 in latest</h1>');
  assert.deepEqual(e.NOT_FOUND.points[0], {
    indexes: ['identity-platform'],
    blobs: ['identity-platform', '7.3.0', '/identity-platform/7.3.0/missing/', 'www.google.com', 'staging'],
    doubles: [1],
  });
  assert.equal(e.NOT_FOUND.points.length, 2);
});

test('runtime files and conditional requests', async () => {
  const e = env();
  const r = await call(e, '/manifest.json');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
  assert.equal((await r.json()).landing.release, 'l1');
  const asset = await call(e, '/identity-platform/7.3.0/assets/js/main.0123abcd.js');
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await call(e, '/identity-platform/7.3.0/assets/js/main.0123abcd.js', { headers: { 'if-none-match': asset.headers.get('etag') } })).status, 304);
});

test('feedback: validated, counted, cookie-free', async () => {
  const e = env();
  const post = (body, headers = {}) => call(e, '/api/feedback', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'text/plain', ...headers } });
  // The widget's payload (lib/page-links.mjs feedbackEvent).
  const fb = (o) => ({ v: 1, kind: 'vote', docSpace: 'identity-platform', edition: '7.3.0', latest: true, page: '/identity-platform/latest/guides/mfa/', ...o });
  const ok = await post(fb({ kind: 'reason', vote: 'no', reason: 'example-does-not-work' }), { origin: 'https://docs.wso2.com' });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('set-cookie'), null);
  assert.deepEqual(e.FEEDBACK.points[0], {
    indexes: ['identity-platform'],
    blobs: ['identity-platform', 'latest', '7.3.0', '/identity-platform/latest/guides/mfa/', 'reason', 'no', 'example-does-not-work', 'production'],
    doubles: [1],
  });
  assert.equal((await post(fb({ kind: 'reason', vote: 'yes', reason: 'other' }))).status, 400, 'reasons only after No');
  assert.equal((await post(fb({ vote: 'no', reason: 'other' }))).status, 400, 'a vote carries no reason');
  assert.equal((await post(fb({ vote: true }))).status, 400);
  assert.equal((await post({ page: '/identity-platform/7.3.0/', helpful: true })).status, 400, 'the old shape is rejected');
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post(fb({ page: `/identity-platform/7.3.0/${'x'.repeat(3000)}/` }))).status, 413);
  assert.equal((await post(fb({ vote: 'yes' }), { origin: 'https://elsewhere.example' })).status, 403);
  assert.equal(e.FEEDBACK.points.length, 1);
});

test('PR previews: own bucket, always noindex, only where bound', async () => {
  const e = env();
  const r = await call(e, '/_preview/identity-platform/pr-7/cloud/');
  assert.equal(await r.text(), '<h1>preview</h1>');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.equal((await call(e, '/_preview/identity-platform/pr-7/cloud')).status, 301);
  assert.equal((await call(e, '/_preview/identity-platform/pr-8/cloud/')).status, 404);
  assert.equal((await call(env({ PREVIEWS: undefined }), '/_preview/identity-platform/pr-7/cloud/')).status, 404);
});

test('old Confluence paths: the 301s Cloudflare sends today, on every docs host', async () => {
  const e = env();
  const loc = async (p) => {
    const r = await call(e, p, { redirect: 'manual' });
    return [r.status, r.headers.get('location')];
  };
  assert.deepEqual(await loc('/display/ADMIN44x/Changing+a+Password'), [301, 'https://wso2docs.atlassian.net/wiki/spaces/ADMIN44x/overview']);
  assert.deepEqual(await loc('/display/IS511/apidocs/Configuration-management-apis/index.html'), [301, 'https://wso2docs.atlassian.net/wiki/spaces/IS511/overview']);
  assert.deepEqual(await loc('/display/AM260'), [301, 'https://wso2docs.atlassian.net/wiki/spaces/AM260/overview'], 'no trailing-slash hop first');
  assert.deepEqual(await loc('/display/'), [301, 'https://wso2docs.atlassian.net/wiki/spaces']);
  assert.deepEqual(await loc('/display'), [301, 'https://wso2docs.atlassian.net/wiki/spaces']);
  assert.deepEqual(await loc('/pages/viewpage.action?pageId=97564601'), [301, 'https://wso2.com/documentation?pageId=97564601'], 'the query is kept');
  assert.deepEqual(await loc('/download/attachments/80713829/env-resolver-1.0.0.jar?version=2&api=v2'), [301, 'https://wso2.com/documentation']);
  // Anything else is routed as before.
  assert.equal((await call(e, '/displayed/')).status, 404);
  assert.equal((await call(e, '/pages/other.action')).status, 404);
  assert.equal(confluenceRedirect('/identity-platform/7.3.0/display/x/'), null);
  // On the staging host too (the crawl gate checks them there), and the targets live in one table.
  const staging = await worker.fetch(new Request('https://docs-staging.wso2.com/display/EI650/Cache+Mediator'), env({ NOINDEX_ALL: 'true', DOCS_HOST: 'docs-staging.wso2.com' }));
  assert.equal(staging.headers.get('location'), CONFLUENCE_TARGETS.space.replace('{space}', 'EI650'));
  assert.equal(confluenceRedirect('/display/X/y', '', { ...CONFLUENCE_TARGETS, space: 'https://archive.example/{space}/' }), 'https://archive.example/X/');
});

test("content types: the Worker's table wins over what the upload tool stored", async () => {
  const e = env();
  e.DOCS = bucket({ 'manifest.json': manifest, '_releases/identity-platform/latest/r730/guides/mfa.md': '# MFA', '_releases/identity-platform/latest/r730/guides/mfa/index.html': '<h1>x</h1>', '_releases/identity-platform/latest/r730/data.bin': 'x' }, 'binary/octet-stream');
  assert.equal((await call(e, '/identity-platform/latest/guides/mfa.md')).headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal((await call(e, '/identity-platform/latest/guides/mfa/')).headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal((await call(e, '/identity-platform/latest/data.bin')).headers.get('content-type'), 'application/octet-stream', 'unknown types are not guessed further');
  e.DOCS = bucket({ 'manifest.json': manifest, '_releases/identity-platform/latest/r730/guides/mfa.md': '# MFA' }, 'text/plain');
  assert.equal((await call(e, '/identity-platform/latest/guides/mfa.md')).headers.get('content-type'), 'text/markdown; charset=utf-8');
});
