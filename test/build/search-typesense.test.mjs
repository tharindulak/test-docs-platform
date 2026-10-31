// Search against a real Typesense (the version search/docker-compose.yml
// runs), in Docker. Builds the stub Content repo as Cloud, 7.3.0, its latest
// twin and 7.2.0 (one after another: they share site/.docusaurus), publishes
// and flips them in a local release bucket, then runs the release step's
// `search-index` and checks: latest is never indexed, each search scope
// through the InstantSearch adapter, the one-Edition rule, end of life, the
// /latest/ rewrite, former names, upsert-then-delete-stale, scoped search-only keys and their reuse, the
// weekly consistency check and analytics. Skips when Docker is unavailable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadPolicy, publicManifest } from '../../lib/manifest.mjs';
import { FsStorage } from '../../lib/storage.mjs';
import { buildFilter, contextFromView, deploymentContext, editionLabel, hitTarget, searchParameters } from '../../lib/search/scopes.mjs';
import { checkConsistency, ensureSearchOnlyKey, indexDeployment } from '../../lib/search/indexing.mjs';
import { scopedSearchKey, typesenseClient } from '../../lib/search/typesense.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = path.join(root, 'fixtures', 'stub-repo', 'identity-server');
// Identity Server's Cloud is its Cloud part, built into Identity Platform
// Cloud's tree: its records are Identity Server's Cloud (cloudIn
// identity-platform), the family's own pages Identity Platform Cloud's.
const family = path.join(root, 'fixtures', 'stub-repo', 'identity-platform');
const IMAGE = /image:\s*(\S+)/.exec(fs.readFileSync(path.join(root, 'search', 'docker-compose.yml'), 'utf8'))[1];
const ADMIN = 'integration-admin-key';
const COLLECTION = 'wso2docs-test';
// The adapter's lib/ is bundler-only ESM; Node loads its browser UMD build.
globalThis.self ??= globalThis;
const TypesenseInstantSearchAdapter = createRequire(import.meta.url)('typesense-instantsearch-adapter/dist/typesense-instantsearch-adapter.js');
const docker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

test('search on a real Typesense', { skip: !docker && 'Docker is not available', timeout: 1_200_000 }, async (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-search-it-'));
  const build = (name, ...args) => {
    const dir = path.join(out, name);
    const content = args[0] === '--family' ? (args.shift(), family) : fixture;
    execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'build', content, '--out', dir, ...args], { stdio: 'pipe' });
    return dir;
  };
  const dirs = { cloud: build('cloud', '--family', '--edition', 'cloud'), '7.3.0': build('730', '--edition', '7.3.0'), latest: build('latest', '--edition', '7.3.0', '--as-latest') };
  dirs['7.2.0'] = build('720', '--edition', '7.2.0', '--latest-pages', path.join(dirs.latest, '_platform', 'pages.json'));
  dirs.landing = path.join(out, 'landing');
  execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-docs.mjs'), 'build', '--landing', '--out', dirs.landing], { stdio: 'pipe' });

  const port = await freePort();
  const name = `wso2-docs-search-test-${process.pid}`;
  execFileSync('docker', ['run', '-d', '--rm', '--name', name, '-p', `127.0.0.1:${port}:8108`, IMAGE,
    '--data-dir', '/tmp', `--api-key=${ADMIN}`, '--enable-cors', '--enable-search-analytics=true', '--analytics-dir', '/tmp/analytics', '--analytics-flush-interval', '1'], { stdio: 'pipe' });
  t.after(() => spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' }));
  const url = `http://127.0.0.1:${port}`;
  const client = typesenseClient({ url, apiKey: ADMIN });
  for (let i = 0; ; i += 1) {
    try {
      if ((await client.health()).ok) break;
    } catch { /* starting */ }
    if (i > 120) throw new Error('Typesense did not become healthy');
    await new Promise((r) => setTimeout(r, 500));
  }

  const policy = loadPolicy();
  const manifest = publicManifest(policy, { environment: 'production' });
  const storageDir = path.join(out, 'bucket');
  const storage = new FsStorage(storageDir);
  const release = (...args) => execFileSync(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), ...args], {
    encoding: 'utf8', env: { ...process.env, TYPESENSE_URL: url, TYPESENSE_ADMIN_KEY: ADMIN },
  });
  const pub = (segment, edition, tag) => release('publish', '--storage', `file:${storageDir}`, '--dir', dirs[segment], '--space', segment === 'cloud' ? 'identity-platform' : 'identity-server', '--segment', segment, '--edition', edition, '--tag', tag);
  pub('cloud', 'cloud', 'identity-platform/cloud-2026.10.21.1');
  pub('7.3.0', '7.3.0', 'identity-server/7.3.0-docs.1');
  pub('latest', '7.3.0', 'identity-server/7.3.0-docs.1');
  pub('7.2.0', '7.2.0', 'identity-server/7.2.0-docs.1');
  const FLIP = 'identity-platform/cloud=cloud-2026.10.21.1 identity-server/latest=7.3.0-docs.1 identity-server/7.3.0=7.3.0-docs.1 identity-server/7.2.0=7.2.0-docs.1';
  release('flip', '--storage', `file:${storageDir}`, '--env', 'staging', '--deploy', FLIP);

  const all = async () => client.exportDocuments(COLLECTION, {});
  const count = (docs, edition) => docs.filter((d) => d.edition === edition).length;
  const records = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '_platform', 'search-records.json'), 'utf8'));

  await t.test('the release step indexes every deployment but the latest twin', async () => {
    const log = release('search-index', '--env', 'staging', '--collection', COLLECTION, '--storage', `file:${storageDir}`, '--deploy', FLIP);
    assert.match(log, /identity-server\/latest skipped \(\/latest\/ is never indexed\)/);
    const docs = await all();
    for (const e of ['cloud', '7.3.0', '7.2.0']) assert.equal(count(docs, e), records(dirs[e]).length, `${e} records`);
    const cloud = docs.filter((d) => d.edition === 'cloud');
    const part = cloud.filter((d) => d.docSpace === 'identity-server');
    assert.ok(part.length > 0 && part.length < cloud.length, 'the tree holds the family\'s pages and the part\'s');
    assert.ok(part.every((d) => d.cloudIn === 'identity-platform' && d.lvl0 === 'Identity Server Cloud' && d.url.includes('/identity-platform/cloud/identity-server/') && !d.page.startsWith('identity-server/')));
    assert.ok(cloud.filter((d) => d.docSpace === 'identity-platform').every((d) => !d.cloudIn && !d.page.startsWith('identity-server/')));
    assert.ok(docs.some((d) => d.type === 'catalog-item' && d.docSpace === 'identity-server' && d.edition === 'cloud' && d.anchor === 'catalog-totp'), 'a catalog item record');
    assert.equal(docs.length, records(dirs.cloud).length + records(dirs['7.3.0']).length + records(dirs['7.2.0']).length);
    assert.ok(!docs.some((d) => d.url.includes('/latest/')), 'no /latest/ URLs');
  });

  await t.test('every page server-renders the header search box; no admin key is baked in', () => {
    const html = fs.readFileSync(path.join(dirs['7.2.0'], 'guides', 'mfa', 'index.html'), 'utf8');
    assert.match(html, /data-wso2-search="header"/);
    assert.match(fs.readFileSync(path.join(dirs.landing, 'index.html'), 'utf8'), /data-wso2-search="hero"/, 'the Landing hero box');
    assert.match(fs.readFileSync(path.join(dirs.landing, 'search', 'index.html'), 'utf8'), /Search WSO2 Docs/, 'the full results page at /search/');
    const bundle = fs.readdirSync(path.join(dirs['7.2.0'], 'assets', 'js')).map((f) => fs.readFileSync(path.join(dirs['7.2.0'], 'assets', 'js', f), 'utf8')).join('');
    assert.doesNotMatch(bundle, /local-preview-key|integration-admin-key/);
  });

  // Searches the way the browser does: the InstantSearch adapter, with the
  // scope's parameters and filter, through a scoped search-only key.
  const made = await ensureSearchOnlyKey(client, COLLECTION);
  const parent = made.value;
  // Setup run again reuses the parent key: no second key, and only its prefix is known.
  const reused = await ensureSearchOnlyKey(client, COLLECTION);
  assert.deepEqual([reused.existed, reused.id, reused.value_prefix, reused.value], [true, made.id, parent.slice(0, 4), undefined]);
  assert.equal((await client.listKeys()).length, 1);
  const browserKey = scopedSearchKey(parent, { expires_at: Math.floor(Date.now() / 1000) + 3600 });
  const search = async (query, scope, ctx, { m = manifest, remembered = {}, chips } = {}) => {
    const adapter = new TypesenseInstantSearchAdapter({
      server: { apiKey: browserKey, nodes: [{ host: '127.0.0.1', port, protocol: 'http' }], cacheSearchResultsForSeconds: 0 },
      additionalSearchParameters: searchParameters(scope, { analyticsTag: ctx.landing ? 'landing' : `${ctx.docSpace}/${ctx.segment}` }),
    });
    const res = await adapter.searchClient.search([{ indexName: COLLECTION, params: { query, filters: buildFilter({ scope, ctx, manifest: m, remembered, chips }), hitsPerPage: 50 } }]);
    return res.results[0].hits;
  };
  const editions = (hits) => [...new Set(hits.map((h) => h.edition))];
  const ctx720 = deploymentContext({ docSpace: 'identity-server', edition: '7.2.0' });
  const ctxLatest = deploymentContext({ docSpace: 'identity-server', edition: '7.3.0', asLatest: true });
  const landing = deploymentContext({ landing: true });
  const ctxPart = contextFromView({ space: 'identity-platform', edition: 'cloud', path: 'identity-server/guides/mfa/' }, { doc: 'identity-server', edition: 'cloud', inPart: 'identity-platform' }, 'identity-platform');
  const sec720 = deploymentContext({ docSpace: 'identity-server', edition: '7.2.0', section: 'identity-platform' });
  const ipCloud = deploymentContext({ docSpace: 'identity-platform', edition: 'cloud', section: 'identity-platform' });
  const pairs = (hits) => [...new Set(hits.map((h) => `${h.docSpace}/${h.edition}`))].sort();

  await t.test('This Edition', async () => {
    assert.deepEqual(editions(await search('passkeys', 'edition', ctx720)), ['7.2.0']);
    const has730 = (hits) => hits.some((h) => /MARKER-FROM-730/.test(h.content));
    assert.ok(!has730(await search('MARKER-FROM-730', 'edition', ctx720)), '7.2.0 never had that section');
    assert.ok(has730(await search('MARKER-FROM-730', 'edition', ctxLatest)));
    assert.deepEqual(editions(await search('MARKER-FROM-730', 'edition', ctxLatest)), ['7.3.0']);
    assert.ok(!(await search('billing', 'edition', ctxLatest)).some((h) => h.page === 'guides/cloud-billing/'), 'Cloud-only page');
  });

  await t.test('All Editions: Edition badges, newer Editions ranked first', async () => {
    const hits = await search('multi-factor authentication', 'docspace', ctx720);
    assert.deepEqual(editions(hits), ['cloud', '7.3.0', '7.2.0'], 'the Cloud part is Identity Server\'s Cloud');
    assert.deepEqual(editions(await search('multi-factor authentication', 'docspace', ctxPart)), ['cloud', '7.3.0', '7.2.0'], 'the same from the Cloud part');
    assert.deepEqual(pairs(await search('multi-factor authentication', 'edition', ctxPart)), ['identity-server/cloud'], 'This Edition in the Cloud part');
    const eol = structuredClone(manifest);
    eol.docSpaces['identity-server'].editions.find((e) => e.id === '7.2.0').status = 'end-of-life';
    assert.deepEqual(editions(await search('multi-factor authentication', 'docspace', ctx720, { m: eol })), ['cloud', '7.3.0'], 'end of life only under This Edition');
    assert.deepEqual(editions(await search('multi-factor authentication', 'edition', ctx720, { m: eol })), ['7.2.0']);
    assert.deepEqual(editions(await search('server pack', 'docspace', ctx720)), ['7.3.0', '7.2.0'], 'a Self-hosted-only page');
  });

  await t.test('All of WSO2 Docs: one Edition per Doc space', async () => {
    const docSpaceEditions = (hits) => [...new Set(hits.map((h) => `${h.docSpace}/${h.edition}`))].sort();
    assert.deepEqual(docSpaceEditions(await search('multi-factor authentication', 'all', landing)), ['identity-platform/cloud', 'identity-server/cloud'], 'where the selector opens: Cloud, and the family Cloud');
    assert.deepEqual(docSpaceEditions(await search('multi-factor authentication', 'all', landing, { remembered: { 'identity-server': '7.2.0' } })), ['identity-platform/cloud', 'identity-server/7.2.0'], 'the remembered Edition');
    assert.deepEqual(docSpaceEditions(await search('multi-factor authentication', 'all', landing, { remembered: { 'identity-server': 'latest' } })), ['identity-platform/cloud', 'identity-server/cloud']);
    assert.deepEqual(docSpaceEditions(await search('multi-factor authentication', 'all', sec720)), ['identity-platform/cloud', 'identity-server/7.2.0'], 'widening keeps the Edition being read');
    assert.deepEqual(await search('multi-factor authentication', 'all', landing, { chips: { families: ['API Platform'] } }), []);
  });

  await t.test('former names stay searchable: Asgardeo finds Identity Platform Cloud and its Cloud part', async () => {
    const hits = await search('Asgardeo multi-factor authentication', 'docspace', ctx720);
    assert.deepEqual(editions(hits), ['cloud'], 'only the Cloud tree was called Asgardeo');
    assert.ok(hits.some((h) => h.page === 'guides/mfa/'));
    assert.deepEqual(pairs(await search('asgardeo', 'all', landing)), ['identity-platform/cloud', 'identity-server/cloud']);
  });

  await t.test('This Docs section: the section\'s Doc spaces at the reader\'s Edition, the others where they open', async () => {
    assert.deepEqual(pairs(await search('multi-factor authentication', 'section', sec720)), ['identity-platform/cloud', 'identity-server/7.2.0']);
    assert.deepEqual(pairs(await search('multi-factor authentication', 'section', ipCloud)), ['identity-platform/cloud', 'identity-server/cloud']);
    assert.deepEqual(pairs(await search('multi-factor authentication', 'section', ctxPart)), ['identity-platform/cloud', 'identity-server/cloud']);
    // The published manifest drops Identity Server from the section: the scope follows, no rebuild.
    const live = structuredClone(manifest);
    live.sections['identity-platform'].menu = live.sections['identity-platform'].menu.filter((e) => e.docSpace !== 'identity-server');
    assert.deepEqual(pairs(await search('multi-factor authentication', 'section', ipCloud, { m: live })), ['identity-platform/cloud']);
    const [part] = (await search('TOTP authenticator', 'section', ipCloud)).filter((h) => h.type === 'catalog-item');
    assert.equal(part.anchor, 'catalog-totp');
    assert.equal(hitTarget(part, ipCloud, manifest).href, '/identity-platform/cloud/identity-server/reference/connectors/#catalog-totp');
    assert.equal(hitTarget(part, ipCloud, manifest).sameDeployment, true, 'the tree is one deployment');
    assert.equal(editionLabel(part, manifest, { withName: true }), 'Identity Server Cloud');
    assert.ok(fs.readFileSync(path.join(dirs.cloud, 'identity-server', 'reference', 'connectors', 'index.html'), 'utf8').includes('id="catalog-totp"'));
  });

  await t.test('hits from the latest feeder open under /latest/, others across deployments in full', async () => {
    const [hit] = await search('Choose a factor', 'docspace', ctx720);
    assert.equal(hit.edition, 'cloud', 'newer Editions first: Cloud, the newest');
    assert.equal(hitTarget(hit, ctx720, manifest).href, '/identity-platform/cloud/identity-server/guides/mfa/#choose-a-factor', 'a Cloud part hit opens in the tree');
    const hits = await search('Choose a factor', 'docspace', ctx720);
    const h730 = hits.find((h) => h.edition === '7.3.0');
    const target = hitTarget(h730, ctx720, manifest);
    assert.equal(target.href, '/identity-server/latest/guides/mfa/#choose-a-factor');
    assert.equal(target.sameDeployment, false);
    assert.ok(fs.existsSync(path.join(dirs.latest, 'guides', 'mfa', 'index.html')), 'the rewritten page exists in the latest twin');
    assert.match(fs.readFileSync(path.join(dirs.latest, 'guides', 'mfa', 'index.html'), 'utf8'), /id="choose-a-factor"/);
    assert.equal(hitTarget(h730, ctxLatest, manifest).sameDeployment, true);
    assert.equal(hitTarget(hits.find((h) => h.edition === '7.2.0'), ctx720, manifest).href, '/identity-server/7.2.0/guides/mfa/#choose-a-factor');
  });

  await t.test('the scoped key searches only', async () => {
    const res = await fetch(`${url}/collections/${COLLECTION}/documents/import`, { method: 'POST', headers: { 'X-TYPESENSE-API-KEY': browserKey }, body: '{"id":"x"}' });
    assert.equal(res.status, 401);
    const expired = scopedSearchKey(parent, { expires_at: Math.floor(Date.now() / 1000) - 10 });
    const r2 = await fetch(`${url}/collections/${COLLECTION}/documents/search?q=mfa&query_by=content`, { headers: { 'X-TYPESENSE-API-KEY': expired } });
    assert.equal(r2.status, 401);
  });

  await t.test('re-indexing upserts first, then deletes only that Edition\'s stale records', async () => {
    const before = await all();
    const meta = JSON.parse(fs.readFileSync(path.join(dirs['7.2.0'], '_platform', 'edition.json'), 'utf8'));
    const next = records(dirs['7.2.0']).filter((r) => !r.url.includes('/deploy-and-operate/install/'))
      .map((r) => (r.url.endsWith('/guides/mfa/') ? { ...r, content: `${r.content} Now with security keys.` } : r));
    // Watch the index between the upsert and the delete: it must never be empty for 7.2.0.
    const seen = [];
    const spy = {
      ...client,
      async importDocuments(...args) {
        const r = await client.importDocuments(...args);
        seen.push(['import', count(await all(), '7.2.0')]);
        return r;
      },
      async deleteByFilter(...args) {
        seen.push(['delete', args[1]]);
        return client.deleteByFilter(...args);
      },
    };
    const r = await indexDeployment(spy, { collection: COLLECTION, records: next, meta, policy, release: '7.2.0-docs.2' });
    assert.equal(seen[0][0], 'import');
    assert.equal(seen[0][1], before.filter((d) => d.edition === '7.2.0').length, 'after the upsert every old page is still searchable');
    assert.equal(seen[1][1], 'docSpace:=`identity-server` && edition:=`7.2.0` && release:!=`7.2.0-docs.2`');
    assert.equal(r.deleted, 1, 'only the removed page');
    const after = await all();
    assert.ok(!after.some((d) => d.edition === '7.2.0' && d.page === 'deploy-and-operate/install/'));
    assert.ok(after.filter((d) => d.edition === '7.2.0').every((d) => d.release === '7.2.0-docs.2'));
    assert.deepEqual(editions(await search('security keys', 'edition', ctx720)), ['7.2.0']);
    for (const e of ['cloud', '7.3.0']) assert.equal(count(after, e), count(before, e), `${e} untouched`);
  });

  await t.test('the weekly check (search-check) exits non-zero on drift', () => {
    // The index now holds 7.2.0-docs.2, but 7.2.0-docs.1 is what is deployed.
    const file = path.join(out, 'report.json');
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), 'search-check', '--env', 'staging', '--collection', COLLECTION, '--storage', `file:${storageDir}`, '--out', file], {
      encoding: 'utf8', env: { ...process.env, TYPESENSE_URL: url, TYPESENSE_ADMIN_KEY: ADMIN },
    });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /has drifted/);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ok, false);
  });

  await t.test('consistency: report then fix', async () => {
    const drift = await checkConsistency(client, storage, { collection: COLLECTION, policy });
    assert.equal(drift.ok, false);
    const d720 = drift.deployments.find((e) => e.deployment === 'identity-server/7.2.0');
    assert.deepEqual(d720.missing, ['deploy-and-operate/install/']);
    assert.deepEqual(d720.otherReleases, ['7.2.0-docs.2']);
    const fixed = await checkConsistency(client, storage, { collection: COLLECTION, policy, fix: true });
    assert.equal(fixed.fixed.length, 1);
    assert.equal((await checkConsistency(client, storage, { collection: COLLECTION, policy })).ok, true);
  });

  await t.test('analytics: no-hit queries are recorded, tagged per deployment', async () => {
    await search('zebracornfish', 'edition', ctxLatest);
    let tags = [];
    for (let i = 0; i < 40 && !tags.length; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      await client.flushAnalytics();
      tags = (await client.exportDocuments(`${COLLECTION}_nohits_queries`, {})).filter((d) => d.q === 'zebracornfish').map((d) => d.analytics_tag);
    }
    assert.deepEqual(tags, ['identity-server/latest']);
  });
});
