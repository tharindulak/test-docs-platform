// Release pipeline logic against a local folder: planning from tags and the
// trigger table, immutable publishing, flips, rollback, garbage collection,
// the merged manifest, the sitemap index and the redirect table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPolicy, publicManifest } from '../lib/manifest.mjs';
import { menu, mergeManifest as mergeSwitching, productsMenu, sectionFor } from '../lib/switching.mjs';
import { cloudflareKv, fileKv } from '../lib/kv.mjs';
import { FsStorage } from '../lib/storage.mjs';
import { crawl } from '../lib/crawl.mjs';
import worker from '../worker/src/index.mjs';
import { route } from '../worker/src/routing.mjs';
import {
  bakedManifest, checkBuild, copyRelease, editionFromTag, flip, gc, mergeManifest, parseTag, planRelease, policyChanges, publishRelease,
  readState, redirectKey, releaseIdFor, retire, rollback, sitemapIndex, syncRedirects,
} from '../lib/release.mjs';
import { readPlatformPin, readPlatformPins } from '../lib/platform-pins.mjs';
import { platformDeploymentsFor, platformReleaseFor } from '../lib/platform-release.mjs';

const policy = loadPolicy();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-release-'));

// A minimal stand-in for a wso2-docs build of one deployment.
function fakeBuild(space, segment, edition, { redirects = [], marker = '' } = {}) {
  const dir = tmp();
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data));
  };
  write('index.html', `<h1>${space} ${segment}${marker}</h1>`);
  write('404.html', '<h1>404</h1>');
  write('sitemap.xml', '<urlset/>');
  write('assets/js/main.0123abcd.js', 'js');
  write('_platform/edition.json', { docSpace: space, edition, asLatest: segment === 'latest', baseUrl: `/${space}/${segment}/`, platformVersion: '0.1.0' });
  write('_platform/pages.json', [{ path: '' }]);
  write('_platform/redirects.json', redirects);
  return dir;
}

test('tags map to Editions, with an optional Doc space prefix and date versions', () => {
  assert.equal(editionFromTag('cloud-2026.10.21.3'), 'cloud');
  assert.equal(editionFromTag('cloud-2026.10.21.3', 'versions-only'), 'next');
  assert.equal(editionFromTag('7.3.0-docs.12'), '7.3.0');
  assert.equal(editionFromTag('identity-server/7.3.0-docs.12'), '7.3.0');
  assert.equal(editionFromTag('ai-gateway/2026.09.24-docs.1'), '2026.09.24');
  assert.equal(editionFromTag('api-platform/cloud-2026.10.21.1'), 'cloud');
  assert.deepEqual(parseTag('ai-gateway/2026.09.24-docs.3'), { prefix: 'ai-gateway', cloud: false, version: '2026.09.24', release: '2026.09.24-docs.3' });
  assert.equal(releaseIdFor('identity-server/7.3.0-docs.4'), '7.3.0-docs.4', 'release folders hold no slash');
  assert.equal(releaseIdFor('landing-1'), 'landing-1');
  assert.throws(() => editionFromTag('v7.3.0'), /not a Docs release tag/);
  assert.throws(() => editionFromTag('ai-gateway/2026.09-docs.1'), /not a Docs release tag/);
  assert.throws(() => editionFromTag('Bad/7.3.0-docs.1'), /not a Docs release tag/);
});

test('plan: prefixed tags pick the Doc space and its directory; latest is the newest release in manifest order', () => {
  const ids = (list) => list.map((d) => `${d.space}/${d.segment}=${d.release}`);
  assert.deepEqual(ids(planRelease(policy, { repo: 'wso2/docs-identity-platform', tag: 'identity-server/7.3.0-docs.4' })), ['identity-server/latest=7.3.0-docs.4', 'identity-server/7.3.0=7.3.0-docs.4']);
  assert.deepEqual(ids(planRelease(policy, { repo: 'wso2/docs-identity-platform', tag: 'identity-server/7.2.0-docs.2' })), ['identity-server/7.2.0=7.2.0-docs.2']);
  const plan = planRelease(policy, { repo: 'WSO2/docs-api-platform', tag: 'api-manager/4.7.0-docs.1' });
  assert.deepEqual(ids(plan), ['api-manager/latest=4.7.0-docs.1', 'api-manager/4.7.0=4.7.0-docs.1']);
  assert.deepEqual(plan.map((d) => [d.dir, d.tag]), [['api-manager', 'api-manager/4.7.0-docs.1'], ['api-manager', 'api-manager/4.7.0-docs.1']], 'the build reads only the Doc space directory, at the full tag');
  // AI Gateway: 1.2.0 comes first in its manifest, so it is latest, although 2026.09.24 sorts higher.
  assert.deepEqual(ids(planRelease(policy, { repo: 'wso2/docs-api-platform', tag: 'ai-gateway/1.2.0-docs.1' })), ['ai-gateway/latest=1.2.0-docs.1', 'ai-gateway/1.2.0=1.2.0-docs.1']);
  assert.deepEqual(ids(planRelease(policy, { repo: 'wso2/docs-api-platform', tag: 'ai-gateway/2026.09.24-docs.1' })), ['ai-gateway/2026.09.24=2026.09.24-docs.1']);
  // A family Cloud is one deployment: no /latest/ copy of Cloud.
  assert.deepEqual(ids(planRelease(policy, { repo: 'wso2/docs-api-platform', tag: 'api-platform/cloud-2026.10.21.1' })), ['api-platform/cloud=cloud-2026.10.21.1']);
  assert.deepEqual(ids(planRelease(policy, { repo: 'wso2/docs-identity-platform', tag: 'identity-platform/cloud-2026.10.21.2' })), ['identity-platform/cloud=cloud-2026.10.21.2']);
  // A repo with one Doc space keeps unprefixed tags.
  assert.deepEqual(ids(planRelease(policy, { repo: 'wso2/docs-sandbox', tag: '1.0.0-docs.1' })), ['sandbox/latest=1.0.0-docs.1', 'sandbox/1.0.0=1.0.0-docs.1']);

  assert.throws(() => planRelease(policy, { repo: 'wso2/docs-api-platform', tag: '4.7.0-docs.1' }), /holds several Doc spaces .*: its tags are <doc space>\/4\.7\.0-docs\.1/);
  assert.throws(() => planRelease(policy, { repo: 'wso2/docs-api-platform', tag: 'ai-gateway/cloud-2026.10.21.1' }), /Cloud part of api-platform; tag api-platform\/cloud-/);
  assert.throws(() => planRelease(policy, { repo: 'wso2/docs-identity-platform', tag: 'api-manager/4.7.0-docs.1' }), /not in wso2\/docs-identity-platform/);
  assert.throws(() => planRelease(policy, { repo: 'wso2/docs-sandbox', tag: 'sandbox/1.0.0-docs.1' }), /tags are unprefixed/);
  assert.throws(() => planRelease(policy, { repo: 'wso2/docs-identity-platform', tag: 'identity-server/7.0.0-docs.1' }), /legacy version/);
  assert.throws(() => planRelease(policy, { repo: 'wso2/docs-identity-platform', tag: 'identity-server/9.0.0-docs.1' }), /not in the manifest policy/);
  assert.throws(() => planRelease(policy, { repo: 'wso2/elsewhere', tag: '7.3.0-docs.1' }), /No Doc space/);

  // A Doc space rebuild (latest moved) or a Platform release rebuilds deployed tags under new release ids.
  const state = { deployments: {
    'identity-platform/cloud': { tag: 'identity-platform/cloud-2026.10.20.1' },
    'identity-server/7.3.0': { tag: 'identity-server/7.3.0-docs.4' },
    'identity-server/7.2.0': { tag: 'identity-server/7.2.0-docs.2' },
  } };
  assert.deepEqual(ids(planRelease(policy, { scope: 'docspace', space: 'identity-server', state, rebuildId: '991' })), [
    'identity-server/latest=7.3.0-docs.4.r991', 'identity-server/7.3.0=7.3.0-docs.4.r991', 'identity-server/7.2.0=7.2.0-docs.2.r991',
  ]);
  assert.equal(planRelease(policy, { scope: 'docspace', space: 'identity-server', state, rebuildId: '991' })[0].tag, 'identity-server/7.3.0-docs.4');
  const pins = { 'wso2/docs-identity-platform': 1 };
  assert.deepEqual(ids(planRelease(policy, { scope: 'all', state, rebuildId: '5', major: 1, pins })), [
    'identity-server/latest=7.3.0-docs.4.r5', 'identity-platform/cloud=cloud-2026.10.20.1.r5', 'identity-server/7.3.0=7.3.0-docs.4.r5', 'identity-server/7.2.0=7.2.0-docs.2.r5',
  ]);
});

test('a Platform release rebuilds only the deployments whose Content repo pins its major', () => {
  const ids = (list) => list.map((d) => `${d.space}/${d.segment}=${d.release}`);
  const state = { deployments: {
    'identity-platform/cloud': { tag: 'identity-platform/cloud-2026.10.20.1' },
    'identity-server/7.3.0': { tag: 'identity-server/7.3.0-docs.4' },
    'sandbox/cloud': { tag: 'cloud-2026.10.21.1' },
    'api-platform/cloud': { tag: 'api-platform/cloud-2026.10.21.1' },
    'contribute/_': { tag: 'cloud-2026.10.26.1' },
  } };
  const pins = { 'wso2/docs-identity-platform': 1, 'wso2/docs-sandbox': 2, 'wso2/docs-api-platform': null };
  const skipped = [];
  const v1 = planRelease(policy, { scope: 'all', state, rebuildId: '7', major: 1, pins, onSkip: (s) => skipped.push(s) });
  // The Platform's own Doc space (Contribute) always runs the current Platform.
  assert.deepEqual(ids(v1), ['identity-server/latest=7.3.0-docs.4.r7', 'identity-platform/cloud=cloud-2026.10.20.1.r7', 'identity-server/7.3.0=7.3.0-docs.4.r7', 'contribute/_=cloud-2026.10.26.1.r7']);
  assert.deepEqual(skipped, [
    { deployment: 'api-platform/cloud', repo: 'wso2/docs-api-platform', pin: null },
    { deployment: 'sandbox/cloud', repo: 'wso2/docs-sandbox', pin: 2 },
  ]);
  assert.deepEqual(ids(planRelease(policy, { scope: 'all', state, rebuildId: '8', major: 2, pins })), ['sandbox/cloud=cloud-2026.10.21.1.r8', 'contribute/_=cloud-2026.10.26.1.r8']);
  assert.throws(() => planRelease(policy, { scope: 'all', state, rebuildId: '9', pins }), /scope "all" needs the Platform major/);
  assert.throws(() => planRelease(policy, { scope: 'all', state, rebuildId: '9', major: 1 }), /scope "all" needs each Content repo's pinned Platform major/);
  // A Doc space rebuild is not filtered: the Platform team asked for it.
  assert.equal(planRelease(policy, { scope: 'docspace', space: 'sandbox', state, rebuildId: '9' }).length, 1);
});

test('the pinned Platform major is read from a Content repo\'s docs.yml on its main line', () => {
  const repo = (files) => {
    const dir = tmp();
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    return dir;
  };
  const template = fs.readFileSync(new URL('../templates/content-repo/.github/workflows/docs.yml', import.meta.url), 'utf8');
  assert.equal(readPlatformPin(repo({ '.github/workflows/docs.yml': template })), 1, 'the template pins v1');
  assert.equal(readPlatformPin(repo({ '.github/workflows/docs.yml': template.replaceAll('v1', 'v2') })), 2);
  assert.equal(readPlatformPin(repo({ '.github/workflows/docs.yml': "env:\n  PLATFORM_REF: 'v3'\n" })), 3);
  // An older docs.yml without PLATFORM_REF: the reusable workflows' @v<n>.
  assert.equal(readPlatformPin(repo({ '.github/workflows/docs.yml': 'jobs:\n  p:\n    uses: wso2/docs-platform/.github/workflows/pr-preview.yml@v1\n' })), 1);
  assert.equal(readPlatformPin(repo({ '.github/workflows/docs.yml': 'env:\n  PLATFORM_REF: main\n' })), null, 'a branch is no major');
  assert.equal(readPlatformPin(repo({ 'README.md': 'x' })), null);
  assert.equal(readPlatformPin(path.join(tmp(), 'missing')), null);

  const content = tmp();
  fs.cpSync(repo({ '.github/workflows/docs.yml': template }), path.join(content, 'docs-identity-platform'), { recursive: true });
  const pins = readPlatformPins(policy, content);
  assert.equal(pins['wso2/docs-identity-platform'], 1);
  assert.equal(pins['wso2/docs-sandbox'], null, 'no checkout, no pin');
  assert.equal('wso2/docs-platform' in pins, false, 'the Platform repo pins nothing');
});

test('a pin holds an Edition on one Docs release: only the pinned tag may be released', () => {
  const p = structuredClone(policy);
  p.docSpaces['ai-gateway'].editions.find((e) => e.id === '1.2.0').pin = 'ai-gateway/1.2.0-docs.2';
  assert.throws(() => planRelease(p, { repo: 'wso2/docs-api-platform', tag: 'ai-gateway/1.2.0-docs.3' }), /pinned to ai-gateway\/1\.2\.0-docs\.2 in its docspace\.yaml; remove the pin to release ai-gateway\/1\.2\.0-docs\.3/);
  // The pinned tag itself releases (a rollback by rebuild), and other Editions are not held.
  assert.deepEqual(planRelease(p, { repo: 'wso2/docs-api-platform', tag: 'ai-gateway/1.2.0-docs.2' }).map((d) => `${d.space}/${d.segment}=${d.release}`), ['ai-gateway/latest=1.2.0-docs.2', 'ai-gateway/1.2.0=1.2.0-docs.2']);
  assert.equal(planRelease(p, { repo: 'wso2/docs-api-platform', tag: 'ai-gateway/2026.09.24-docs.4' }).length, 1);
  // A pinned Cloud holds the family's Cloud tree.
  p.docSpaces['api-platform'].editions.find((e) => e.id === 'cloud').pin = 'api-platform/cloud-2026.10.20.1';
  assert.throws(() => planRelease(p, { repo: 'wso2/docs-api-platform', tag: 'api-platform/cloud-2026.10.26.1' }), /Edition cloud of api-platform is pinned/);
});

test('policy changes: new Editions or a moved latest rebuild the Doc space, end of life only republishes', () => {
  const after = structuredClone(policy);
  after.docSpaces['identity-server'].editions.find((e) => e.id === '7.2.0').status = 'end-of-life';
  assert.deepEqual(policyChanges(policy, after), { rebuild: [], republish: true });
  after.docSpaces['api-manager'].editions.unshift({ id: '4.8.0' });
  after.docSpaces['api-manager'].latest = '4.8.0';
  assert.deepEqual(policyChanges(policy, after), { rebuild: ['api-manager'], republish: true });
  assert.deepEqual(policyChanges(policy, policy), { rebuild: [], republish: false });
});

test('a build is checked before upload', () => {
  const dir = fakeBuild('identity-server', '7.3.0', '7.3.0');
  assert.deepEqual(checkBuild(dir, { space: 'identity-server', segment: '7.3.0', edition: '7.3.0' }), []);
  const problems = checkBuild(dir, { space: 'identity-server', segment: 'latest', edition: '7.3.0' });
  assert.ok(problems.some((p) => /asLatest/.test(p)) && problems.some((p) => /baseUrl/.test(p)));
  fs.rmSync(path.join(dir, '404.html'));
  assert.deepEqual(checkBuild(dir, { space: 'identity-server', segment: '7.3.0', edition: '7.3.0' }), ['missing 404.html']);
  // A PR preview build (`build --show-markers`) is never released.
  const preview = fakeBuild('identity-server', '7.3.0', '7.3.0');
  const meta = JSON.parse(fs.readFileSync(path.join(preview, '_platform', 'edition.json'), 'utf8'));
  fs.writeFileSync(path.join(preview, '_platform', 'edition.json'), JSON.stringify({ ...meta, showMarkers: true }));
  assert.deepEqual(checkBuild(preview, { space: 'identity-server', segment: '7.3.0', edition: '7.3.0' }), ['_platform/edition.json: a preview build with Edition markers shown (--show-markers) is never released']);
});

test('publish is immutable; flip, rollback and the merged manifest', async () => {
  const s = new FsStorage(tmp());
  const at = (n) => new Date(Date.UTC(2026, 9, 21, 0, n));
  const r = await publishRelease(s, fakeBuild('identity-server', '7.3.0', '7.3.0'), { space: 'identity-server', segment: '7.3.0', edition: '7.3.0', tag: '7.3.0-docs.1', now: at(1) });
  assert.equal(r.files, 7);
  assert.equal((await publishRelease(s, fakeBuild('identity-server', '7.3.0', '7.3.0'), { space: 'identity-server', segment: '7.3.0', edition: '7.3.0', tag: '7.3.0-docs.1' })).skipped, true);
  await assert.rejects(publishRelease(s, fakeBuild('identity-server', '7.3.0', '7.3.0'), { space: 'identity-server', segment: '7.3.0', edition: '7.3.0', tag: '../x' }), /Invalid release/);

  // An interrupted upload (no release.json) can never go live.
  await s.put('_releases/identity-server/7.3.0/7.3.0-docs.9/index.html', 'half');
  await assert.rejects(flip(s, { environment: 'staging', policy, deployments: [{ space: 'identity-server', segment: '7.3.0', release: '7.3.0-docs.9' }] }), /missing or incomplete/);

  await publishRelease(s, fakeBuild('identity-server', 'latest', '7.3.0'), { space: 'identity-server', segment: 'latest', edition: '7.3.0', tag: '7.3.0-docs.1', now: at(1) });
  await flip(s, { environment: 'staging', policy, now: at(2), deployments: [
    { space: 'identity-server', segment: '7.3.0', release: '7.3.0-docs.1' }, { space: 'identity-server', segment: 'latest', release: '7.3.0-docs.1' },
  ] });
  await publishRelease(s, fakeBuild('identity-server', '7.3.0', '7.3.0'), { space: 'identity-server', segment: '7.3.0', edition: '7.3.0', tag: '7.3.0-docs.2', now: at(3) });
  await flip(s, { environment: 'staging', policy, now: at(4), deployments: [{ space: 'identity-server', segment: '7.3.0', release: '7.3.0-docs.2' }] });
  await assert.rejects(flip(s, { environment: 'production', policy, deployments: [] }), /holds staging state/);

  let state = await readState(s);
  assert.equal(state.deployments['identity-server/7.3.0'].release, '7.3.0-docs.2');
  assert.deepEqual(state.deployments['identity-server/7.3.0'].previous, ['7.3.0-docs.1']);
  const m = JSON.parse(new TextDecoder().decode((await s.get('manifest.json')).body));
  assert.equal(m.docSpaces['identity-server'].deployments['7.3.0'].tag, '7.3.0-docs.2');
  assert.equal(m.docSpaces['identity-server'].editions.find((e) => e.id === '7.2.0').tag, undefined, 'undeployed Editions stay listed, without a tag');

  await rollback(s, { environment: 'staging', policy, space: 'identity-server', segment: '7.3.0', now: at(5) });
  state = await readState(s);
  assert.equal(state.deployments['identity-server/7.3.0'].release, '7.3.0-docs.1');
  assert.deepEqual(state.deployments['identity-server/7.3.0'].previous, ['7.3.0-docs.2']);
  await assert.rejects(rollback(s, { environment: 'staging', policy, space: 'identity-server', segment: 'cloud' }), /not deployed/);

  // Promotion copies the identical bytes to the production bucket.
  const prod = new FsStorage(tmp());
  assert.equal((await copyRelease(s, prod, { space: 'identity-server', segment: '7.3.0', release: '7.3.0-docs.1' })).files, 7);
  assert.deepEqual((await prod.get('_releases/identity-server/7.3.0/7.3.0-docs.1/index.html')).body, (await s.get('_releases/identity-server/7.3.0/7.3.0-docs.1/index.html')).body);
});

test('retire takes down a deployment whose Edition the manifest dropped, and refuses a live one', async () => {
  const s = new FsStorage(tmp());
  for (const [segment, tag] of [['7.3.0', '7.3.0-docs.1'], ['7.2.0', '7.2.0-docs.1']]) {
    await publishRelease(s, fakeBuild('identity-server', segment, segment, { redirects: [{ from: `/identity-server/${segment}/old/`, to: `/identity-server/${segment}/` }] }), { space: 'identity-server', segment, edition: segment, tag });
  }
  await flip(s, { environment: 'staging', policy, deployments: [{ space: 'identity-server', segment: '7.3.0', release: '7.3.0-docs.1' }, { space: 'identity-server', segment: '7.2.0', release: '7.2.0-docs.1' }] });
  await assert.rejects(retire(s, { environment: 'staging', policy, space: 'identity-server', segment: '7.2.0' }), /still an Edition in the manifest \(7\.2\.0\)/);
  await assert.rejects(retire(s, { environment: 'staging', policy, space: 'identity-server', segment: '7.0.0' }), /not deployed/);

  // 7.2.0 moves to legacyVersions: until it is retired it still serves, with a warning, but leaves the sitemap index.
  const p = structuredClone(policy);
  const is = p.docSpaces['identity-server'];
  is.editions = is.editions.map((e) => (e.id === '7.2.0' ? { id: '7.2.0', status: 'legacy', legacyUrl: 'https://is.docs.wso2.com/en/7.2.0/' } : e));
  const before = mergeManifest(p, await readState(s));
  assert.ok(before.warnings.some((w) => /identity-server\/7\.2\.0 is deployed, but 7\.2\.0 is no longer an Edition of identity-server; take it down with wso2-release retire --deployment identity-server\/7\.2\.0/.test(w)), before.warnings.join('\n'));
  assert.doesNotMatch(sitemapIndex(before.manifest), /identity-server\/7\.2\.0/);

  const r = await retire(s, { environment: 'staging', policy: p, space: 'identity-server', segment: '7.2.0' });
  assert.equal(r.retired.release, '7.2.0-docs.1');
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(Object.keys((await readState(s)).deployments), ['identity-server/7.3.0']);
  const m = JSON.parse(new TextDecoder().decode((await s.get('manifest.json')).body));
  assert.deepEqual(Object.keys(m.docSpaces['identity-server'].deployments), ['7.3.0']);
  const kv = path.join(tmp(), 'kv.json');
  await syncRedirects(s, fileKv(kv));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(kv, 'utf8'))), ['/identity-server/7.3.0/old/'], 'its redirects leave the table');
  assert.ok(await s.get('_releases/identity-server/7.2.0/7.2.0-docs.1/_platform/release.json'), 'its release folder stays for gc');
});

test('garbage collection keeps the newest five and the live release', async () => {
  const s = new FsStorage(tmp());
  const dir = fakeBuild('identity-platform', 'cloud', 'cloud');
  for (let n = 1; n <= 8; n++) {
    await publishRelease(s, dir, { space: 'identity-platform', segment: 'cloud', edition: 'cloud', tag: `cloud-2026.10.21.${n}`, now: new Date(Date.UTC(2026, 9, 21, 0, n)) });
  }
  await flip(s, { environment: 'staging', policy, deployments: [{ space: 'identity-platform', segment: 'cloud', release: 'cloud-2026.10.21.1' }] });
  await s.put('_releases/identity-platform/cloud/in-progress/index.html', 'x');
  assert.deepEqual(await gc(s, { dryRun: true }), ['identity-platform/cloud/cloud-2026.10.21.3', 'identity-platform/cloud/cloud-2026.10.21.2']);
  await gc(s);
  assert.deepEqual(await s.listFolders('_releases/identity-platform/cloud/'), [
    'cloud-2026.10.21.1', 'cloud-2026.10.21.4', 'cloud-2026.10.21.5', 'cloud-2026.10.21.6', 'cloud-2026.10.21.7', 'cloud-2026.10.21.8', 'in-progress',
  ]);
  assert.deepEqual(await s.list('_releases/identity-platform/cloud/cloud-2026.10.21.2/'), []);
});

test('manifest merge warns when the latest twin lags the policy; sitemap index skips end of life', () => {
  const p = structuredClone(policy);
  p.docSpaces['identity-server'].latest = '7.4.0';
  p.docSpaces['identity-server'].editions.find((e) => e.id === '7.2.0').status = 'end-of-life';
  const state = { environment: 'staging', deployments: {
    'identity-server/latest': { release: 'a', tag: '7.3.0-docs.1', edition: '7.3.0' },
    'identity-server/7.2.0': { release: 'b', tag: '7.2.0-docs.1', edition: '7.2.0' },
    'api-manager/4.7.0': { release: 'c', tag: '4.7.0-docs.1', edition: '4.7.0' },
    // Unlisted (listed: false): served, but left out of the sitemap index.
    'sandbox/1.0.0': { release: 'd', tag: '1.0.0-docs.1', edition: '1.0.0' },
    // Contribute is Unlisted too, but indexed as an explicit exception.
    'contribute/_': { release: 'e', tag: 'contribute-1', edition: '_' },
    '_landing/_': { release: 'l', tag: 'l', edition: '_' },
  } };
  const { manifest, warnings } = mergeManifest(p, state);
  assert.match(warnings[0], /latest is 7\.4\.0 but the deployed latest twin is 7\.3\.0/);
  assert.equal(manifest.landing.release, 'l');
  assert.equal(manifest.docSpaces.sandbox.listed, false);
  assert.deepEqual([manifest.docSpaces.contribute.listed, manifest.docSpaces.contribute.indexed], [false, true]);
  const xml = sitemapIndex(manifest);
  assert.deepEqual([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((x) => x[1]), [
    'https://docs.wso2.com/api-manager/4.7.0/sitemap.xml', 'https://docs.wso2.com/contribute/sitemap.xml', 'https://docs.wso2.com/identity-server/latest/sitemap.xml',
    'https://docs.wso2.com/sitemap-landing.xml',
  ]);
  assert.doesNotMatch(sitemapIndex({ ...manifest, landing: null }), /sitemap-landing/, 'no Landing deployment, no entry');
});

test('redirect table: compiled from every deployment, pinned wins for legacy URLs, synced as a diff', async () => {
  assert.equal(redirectKey('https://IS.docs.wso2.com/en/7.3.0/a/'), 'is.docs.wso2.com/en/7.3.0/a/');
  assert.equal(redirectKey('/identity-server/7.3.0/a/'), '/identity-server/7.3.0/a/');

  const s = new FsStorage(tmp());
  const legacy = 'https://is.docs.wso2.com/en/7.3.0/guides/authentication/mfa/';
  const builds = {
    '7.3.0': [{ from: '/identity-server/7.3.0/old/', to: '/identity-server/7.3.0/new/', status: 301 }, { from: legacy, to: '/identity-server/7.3.0/guides/mfa/', status: 301 }],
    latest: [{ from: '/identity-server/latest/old/', to: '/identity-server/latest/new/', status: 301 }, { from: legacy, to: '/identity-server/latest/guides/mfa/', status: 301 }],
  };
  for (const [segment, redirects] of Object.entries(builds)) {
    await publishRelease(s, fakeBuild('identity-server', segment, '7.3.0', { redirects }), { space: 'identity-server', segment, edition: '7.3.0', tag: '7.3.0-docs.1' });
  }
  await flip(s, { environment: 'staging', policy, deployments: Object.keys(builds).map((segment) => ({ space: 'identity-server', segment, release: '7.3.0-docs.1' })) });

  const kvFile = path.join(tmp(), 'kv.json');
  const first = await syncRedirects(s, fileKv(kvFile));
  assert.deepEqual(first, { size: 3, puts: 3, deletes: 0, conflicts: [] });
  const kv = JSON.parse(fs.readFileSync(kvFile, 'utf8'));
  assert.deepEqual(JSON.parse(kv['is.docs.wso2.com/en/7.3.0/guides/authentication/mfa/']), { to: '/identity-server/7.3.0/guides/mfa/', status: 301 });

  // A new 7.3.0 release drops a move: only the difference reaches KV.
  await publishRelease(s, fakeBuild('identity-server', '7.3.0', '7.3.0', { redirects: [builds['7.3.0'][1]] }), { space: 'identity-server', segment: '7.3.0', edition: '7.3.0', tag: '7.3.0-docs.2' });
  await flip(s, { environment: 'staging', policy, deployments: [{ space: 'identity-server', segment: '7.3.0', release: '7.3.0-docs.2' }] });
  assert.deepEqual(await syncRedirects(s, fileKv(kvFile)), { size: 2, puts: 0, deletes: 1, conflicts: [] });
  assert.equal(JSON.parse(fs.readFileSync(kvFile, 'utf8'))['/identity-server/7.3.0/old/'], undefined);
});

test('Cloudflare KV bulk API calls (not run against the cloud)', async () => {
  const calls = [];
  const kv = cloudflareKv({ accountId: 'acc', namespaceId: 'ns', apiToken: 'tok', fetchImpl: async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.authorization, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ success: true }));
  } });
  await kv.putMany([{ key: '/a/', value: '{"to":"/b/","status":301}' }]);
  await kv.deleteMany(['/c/']);
  assert.deepEqual(calls, [
    { url: 'https://api.cloudflare.com/client/v4/accounts/acc/storage/kv/namespaces/ns/bulk', method: 'PUT', auth: 'Bearer tok', body: [{ key: '/a/', value: '{"to":"/b/","status":301}' }] },
    { url: 'https://api.cloudflare.com/client/v4/accounts/acc/storage/kv/namespaces/ns/bulk/delete', method: 'POST', auth: 'Bearer tok', body: ['/c/'] },
  ]);
  assert.throws(() => cloudflareKv({ accountId: '', namespaceId: 'ns', apiToken: 't' }), /CLOUDFLARE_ACCOUNT_ID/);
});

test('crawl gate: old Confluence links are external and pass on the archive 301, never followed off-site', async () => {
  const s = new FsStorage(tmp());
  const dir = fakeBuild('api-manager', '4.7.0', '4.7.0');
  await publishRelease(s, dir, { space: 'api-manager', segment: '4.7.0', edition: '4.7.0', tag: '4.7.0-docs.1' });
  const host = 'https://docs-staging.wso2.com';
  const seen = [];
  const env = { DOCS: { get: async () => null }, NOINDEX_ALL: 'true', DOCS_HOST: 'docs-staging.wso2.com' };
  const viaWorker = async (url, init) => {
    seen.push([url, init.redirect]);
    if (!url.startsWith(host)) throw new Error(`left the staging host: ${url}`);
    // The page as served: production URLs to the three Confluence path kinds, and a page link.
    if (new URL(url).pathname === '/api-manager/4.7.0/') {
      return new Response('<a href="https://docs.wso2.com/display/IS530/Using+Email">a</a><a href="https://docs.wso2.com/pages/viewpage.action?pageId=97564601">b</a>'
        + '<a href="/download/attachments/80713829/x.jar?version=2&amp;api=v2">c</a><a href="/api-manager/4.7.0/">self</a>');
    }
    return worker.fetch(new Request(url, { redirect: 'manual' }), env);
  };
  const deployments = [{ space: 'api-manager', segment: '4.7.0', release: '4.7.0-docs.1' }];
  const r = await crawl({ storage: s, host, deployments, fetchImpl: viaWorker });
  assert.deepEqual(r.failures, []);
  assert.equal(r.external, 3, 'three Confluence links on the page');
  assert.equal(r.links, 1);
  assert.ok(seen.filter(([u]) => /display|viewpage|attachments/.test(u)).every(([, mode]) => mode === 'manual'));
  // A Worker that does not answer them fails the gate.
  const plain = (url, init) => (new URL(url).pathname === '/api-manager/4.7.0/'
    ? viaWorker(url, init)
    : Promise.resolve(new Response('missing', { status: 404 })));
  const bad = await crawl({ storage: s, host, deployments, fetchImpl: plain });
  assert.equal(bad.failures.length, 3);
  assert.ok(bad.failures.every((f) => f.kind === 'confluence'));
  assert.ok(bad.failures.some((f) => f.expected === 'https://wso2docs.atlassian.net/wiki/spaces/IS530/overview'));
  assert.ok(bad.failures.some((f) => f.expected === 'https://wso2.com/documentation?pageId=97564601'));
});

test('a Platform release tag: matches package.json, and moves its major tag only forward', () => {
  assert.deepEqual(platformReleaseFor('v1.4.0', '1.4.0', ['v1.3.0', 'v1.3.1', 'v1', 'cloud-2026.10.26.1']), { version: '1.4.0', major: 1, majorTag: 'v1', moveMajor: true });
  assert.deepEqual(platformReleaseFor('v2.0.0', '2.0.0', ['v1.9.0']), { version: '2.0.0', major: 2, majorTag: 'v2', moveMajor: true }, 'a new major starts its own tag');
  // A patch to an older minor, tagged after 1.4.0, is published but leaves v1 on 1.4.0.
  assert.equal(platformReleaseFor('v1.3.2', '1.3.2', ['v1.3.1', 'v1.4.0', 'v2.0.0']).moveMajor, false);
  assert.equal(platformReleaseFor('v1.4.1', '1.4.1', ['v1.4.0', 'v2.0.0']).moveMajor, true, 'another major does not count');
  assert.equal(platformReleaseFor('v1.4.0', '1.4.0', ['v1.4.0']).moveMajor, true, 'a re-run moves it again');
  assert.throws(() => platformReleaseFor('v1.4.0', '1.3.0'), /does not match package\.json's version 1\.3\.0: set the version with npm version 1\.4\.0/);
  assert.throws(() => platformReleaseFor('v1', '1.0.0'), /not a Platform release tag/);
  assert.throws(() => platformReleaseFor('1.4.0', '1.4.0'), /not a Platform release tag/);
});

test('a change on the Platform\'s main line releases Contribute, and a navigation change the Landing deployment', () => {
  assert.deepEqual(platformDeploymentsFor(['standards/contribute/docs/index.mdx']), { contribute: true, landing: false });
  assert.deepEqual(platformDeploymentsFor(['plugins/platform-outputs.mjs', 'test/x.test.mjs']), { contribute: true, landing: false }, 'the Platform builds Contribute');
  assert.deepEqual(platformDeploymentsFor(['navigation/sections/identity-platform.yaml']), { contribute: true, landing: true }, 'menus are built into Contribute too');
  assert.deepEqual(platformDeploymentsFor(['worker/src/index.mjs', 'spec/README.md', '.scratch/x.md', 'test/a.mjs']), { contribute: false, landing: false });
  assert.deepEqual(platformDeploymentsFor(['package-lock.json']), { contribute: true, landing: false });
  assert.deepEqual(platformDeploymentsFor(['chrome/landing.yaml']), { contribute: true, landing: true }, 'the Landing page\'s own content');
  assert.deepEqual(platformDeploymentsFor(['chrome/chrome.json']), { contribute: true, landing: false });
  assert.deepEqual(platformDeploymentsFor(null), { contribute: true, landing: true }, 'no base to diff: release both');

  // Its own plan: Contribute from a Cloud tag on the Platform repo; the Landing deployment from the Platform alone.
  const ids = (list) => list.map((d) => `${d.space}/${d.segment}=${d.release}`);
  assert.deepEqual(ids(planRelease(policy, { repo: 'wso2/docs-platform', tag: 'cloud-2026.10.27.1' })), ['contribute/_=cloud-2026.10.27.1']);
  const landing = planRelease(policy, { scope: 'landing', rebuildId: '42', now: new Date('2026-10-27T10:00:00Z') });
  assert.deepEqual(landing, [{ repo: 'wso2/docs-platform', dir: '.', space: '_landing', edition: '_', segment: '_', asLatest: false, tag: 'landing-2026.10.27.42', release: 'landing-2026.10.27.42' }]);
  assert.throws(() => planRelease(policy, { scope: 'landing' }), /needs a rebuild id/);
  // A Platform release rebuilds the Landing deployment, as it does Contribute.
  const state = { deployments: { '_landing/_': { tag: 'landing-2026.10.26.1' } } };
  assert.deepEqual(ids(planRelease(policy, { scope: 'all', state, rebuildId: '7', major: 1, pins: {} })), ['_landing/_=landing-2026.10.26.1.r7']);
});

test('runs that finish out of order never move a deployment back: only a rollback goes to an older release', async () => {
  const s = new FsStorage(tmp());
  const at = (n) => new Date(Date.UTC(2026, 9, 27, 0, n));
  const pub = (tag, n) => publishRelease(s, fakeBuild('sandbox', 'cloud', 'cloud'), { space: 'sandbox', segment: 'cloud', edition: 'cloud', tag, now: at(n) });
  await pub('cloud-2026.10.27.1', 1);
  await pub('cloud-2026.10.27.2', 2);
  // The newer run flips first; the older one, which waited its turn, comes after.
  await flip(s, { environment: 'staging', policy, deployments: [{ space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.27.2' }], now: at(3) });
  const r = await flip(s, { environment: 'staging', policy, deployments: [{ space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.27.1' }], now: at(4) });
  assert.equal((await readState(s)).deployments['sandbox/cloud'].release, 'cloud-2026.10.27.2');
  assert.ok(r.warnings.some((w) => /sandbox\/cloud stays on cloud-2026\.10\.27\.2, published after cloud-2026\.10\.27\.1; roll back to go back/.test(w)), r.warnings.join('\n'));
  assert.deepEqual(r.kept, ['sandbox/cloud']);
  // Flipping the live release again, or a newer one, is fine; a rollback goes back on purpose.
  assert.deepEqual((await flip(s, { environment: 'staging', policy, deployments: [{ space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.27.2' }], now: at(5) })).kept, []);
  await rollback(s, { environment: 'staging', policy, space: 'sandbox', segment: 'cloud', to: 'cloud-2026.10.27.1', now: at(6) });
  assert.equal((await readState(s)).deployments['sandbox/cloud'].release, 'cloud-2026.10.27.1');
  // Releasing the tag an Edition is pinned to goes back too: a rollback by release.
  await flip(s, { environment: 'staging', policy, deployments: [{ space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.27.2' }], now: at(7) });
  const p = structuredClone(policy);
  p.docSpaces.sandbox.editions.find((e) => e.id === 'cloud').pin = 'cloud-2026.10.27.1';
  assert.deepEqual((await flip(s, { environment: 'staging', policy: p, deployments: [{ space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.27.1' }], now: at(8) })).kept, []);
  assert.equal((await readState(s)).deployments['sandbox/cloud'].release, 'cloud-2026.10.27.1');
});

// The staging crawl gate follows every link a page carries, its menus
// included. A Doc space whose manifest is merged but which has no Docs release
// yet is in the composed manifest; the live manifest hides it until it is
// deployed (hideUnpublished), and the menus built into a page must do the same.
test('crawl gate: menus built into a page list only deployed Doc spaces, while a merged Doc space waits for its first Docs release', async () => {
  const s = new FsStorage(tmp());
  // Identity Platform Cloud (with Identity Server's Cloud part) is live; Identity
  // Server 7.3.0 is being released for the first time. API Platform Cloud, API
  // Manager and AI Gateway are composed but have no Docs release yet.
  const live = [{ space: 'identity-platform', segment: 'cloud', edition: 'cloud', release: 'cloud-2026.10.27.1' }];
  for (const d of live) await publishRelease(s, fakeBuild(d.space, d.segment, d.edition), { ...d, tag: `${d.space}/${d.release}` });
  await flip(s, { environment: 'staging', policy, deployments: live });
  const before = await readState(s);
  const releasing = [{ space: 'identity-server', segment: '7.3.0', edition: '7.3.0', release: '7.3.0-docs.1' }];
  const view = { space: 'identity-server', edition: '7.3.0', path: '' };
  // The page as the build renders it: the products menu and the section menu, from the baked snapshot.
  const pageFrom = (snapshot) => {
    const hrefs = [...productsMenu(snapshot, view).flatMap((g) => g.entries), ...(menu(snapshot, view, sectionFor(snapshot, view))?.entries ?? [])]
      .filter((e) => !e.external && e.href).map((e) => e.href);
    return `<h1>Identity Server 7.3.0</h1>${hrefs.map((h) => `<a href="${h}">x</a>`).join('')}`;
  };
  let n = 0;
  const gate = async (snapshot) => {
    n += 1;
    const d = { ...releasing[0], release: `7.3.0-docs.${n}` };
    await publishRelease(s, fakeBuild('identity-server', '7.3.0', '7.3.0', { marker: pageFrom(snapshot) }), { ...d, tag: `identity-server/${d.release}` });
    await flip(s, { environment: 'staging', policy, deployments: [d] });
    const bases = Object.keys((await readState(s)).deployments).map((k) => `/${k}/`);
    const fetchImpl = async (url) => {
      const p = new URL(url).pathname;
      if (p === '/identity-server/7.3.0/') return new Response((await s.get(`_releases/identity-server/7.3.0/${d.release}/index.html`)).body);
      return new Response('', { status: bases.some((b) => p.startsWith(b)) ? 200 : 404 });
    };
    return crawl({ storage: s, host: 'https://docs-staging.wso2.com', deployments: [d], fetchImpl });
  };
  // Baked from the composed manifest alone, the menus link to Doc spaces with no deployment: the gate fails.
  const composedOnly = await gate(publicManifest(policy, { environment: 'production' }));
  assert.deepEqual([...new Set(composedOnly.failures.map((f) => new URL(f.url).pathname))].sort(), ['/api-manager/latest/', '/api-platform/cloud/', '/api-platform/cloud/ai-gateway/', '/api-platform/cloud/ai-workspace/', '/api-platform/cloud/api-gateway/', '/api-platform/cloud/api-portal/', '/api-platform/cloud/guides/monetization/']);
  // Baked with the deployment state the build read, and the Doc space it builds counted as deployed: the gate passes.
  const baked = bakedManifest(policy, { environment: 'production', deployed: before, building: ['identity-server'] });
  assert.deepEqual((await gate(baked)).failures, []);
  assert.ok(productsMenu(baked, view).flatMap((g) => g.entries).some((e) => e.label === 'Identity Server'), 'the Doc space being built is in its own menus');
  assert.ok(!JSON.stringify(baked.sections['api-platform'].menu).includes('api-manager'), 'API Manager waits in the section\'s pending');
  assert.deepEqual(baked.sections['api-platform'].pending.map((p) => p.docSpace ?? p.product.label), ['api-platform', 'api-manager', 'api-gateway', 'ai-gateway', 'ai-workspace', 'api-portal', 'API Manager', 'API Gateway', 'AI Gateway', 'AI Workspace', 'API Portal & MCP Hub', 'Monetization']);
  // With no deployment state (a local build), the menus are the composed manifest's.
  assert.deepEqual(bakedManifest(policy, { environment: 'production' }), publicManifest(policy, { environment: 'production' }));
  // A published manifest.json is deployment state too.
  const published = mergeManifest(policy, before).manifest;
  assert.deepEqual(bakedManifest(policy, { environment: 'production', deployed: published, building: ['identity-server'] }), baked);
});

// A component's Cloud is its Cloud part in the platform's tree. Until that
// tree is deployed, its products-menu entry, its section-menu line and its
// bare address open its latest Self-hosted version, in the live manifest, in
// the menus built into a page and at the edge alike.
test('a component whose Cloud part is not deployed opens its latest Self-hosted version', () => {
  const view = { space: 'identity-server', edition: '7.3.0', path: '' };
  const entry = (m) => productsMenu(m, view).flatMap((g) => g.entries).find((e) => e.label === 'Identity Server')?.href;
  // The section-menu line, as a reader elsewhere in the section sees it.
  const line = (m) => menu(m, { space: 'identity-platform', edition: 'cloud', path: '' }, 'identity-platform')?.entries.find((e) => e.slug === 'identity-server')?.href;
  const dep = (space, segment, edition = segment) => ({ [`${space}/${segment}`]: { release: `${segment}-r1`, tag: `${space}/${segment}-r1`, edition } });
  const selfHostedOnly = { schema: 1, environment: 'staging', deployments: { ...dep('identity-server', '7.3.0'), ...dep('identity-server', 'latest', '7.3.0') } };
  const withCloud = { ...selfHostedOnly, deployments: { ...selfHostedOnly.deployments, ...dep('identity-platform', 'cloud') } };

  // The live menu, from the published manifest.
  const live = mergeManifest(policy, selfHostedOnly, { environment: 'staging' }).manifest;
  assert.equal(entry(live), '/identity-server/latest/');
  assert.equal(line(live), '/identity-server/latest/');
  const liveCloud = mergeManifest(policy, withCloud, { environment: 'staging' }).manifest;
  assert.equal(entry(liveCloud), '/identity-platform/cloud/identity-server/', 'once the Cloud tree is deployed, its Cloud part');
  assert.equal(line(liveCloud), '/identity-platform/cloud/identity-server/');

  // The edge's bare address agrees with the menus.
  const bare = (m) => route(m, '/identity-server/').location;
  assert.equal(bare(live), '/identity-server/latest/');
  assert.equal(bare(liveCloud), '/identity-platform/cloud/identity-server/');

  // The menus built into a page: a Self-hosted build with that deployment state.
  const baked = bakedManifest(policy, { environment: 'production', deployed: selfHostedOnly, building: ['identity-server'], edition: '7.3.0' });
  assert.equal(entry(baked), '/identity-server/latest/');
  assert.equal(line(baked), '/identity-server/latest/');
  assert.equal(entry(bakedManifest(policy, { environment: 'production', deployed: withCloud, building: ['identity-server'], edition: '7.3.0' })), '/identity-platform/cloud/identity-server/');
  // The Cloud tree's own first build deploys the Cloud part: its menus open it there.
  const tree = bakedManifest(policy, { environment: 'production', deployed: selfHostedOnly, building: ['identity-platform', 'identity-server'], edition: 'cloud' });
  assert.equal(entry(tree), '/identity-platform/cloud/identity-server/');
  // A local build (no deployment state) keeps the composed manifest's menus.
  assert.equal(entry(bakedManifest(policy, { environment: 'production' })), '/identity-platform/cloud/identity-server/');
  // The published manifest keeps cloud.in, so compose from it still sees the Cloud part.
  assert.deepEqual(live.docSpaces['identity-server'].cloud, { in: 'identity-platform' });

  // A page built while the part waited (its snapshot marks it pending) follows
  // the live manifest once the tree is deployed: the browser merges the live
  // copy over the snapshot, so the published manifest says so explicitly.
  assert.equal(liveCloud.docSpaces['identity-server'].cloudPartPending, false);
  const oldPage = mergeSwitching(baked, JSON.parse(JSON.stringify(liveCloud)));
  assert.equal(entry(oldPage), '/identity-platform/cloud/identity-server/');
  assert.equal(line(oldPage), '/identity-platform/cloud/identity-server/');
  // Even from a published manifest that leaves the field out (absent is "not pending").
  const { cloudPartPending, ...lean } = liveCloud.docSpaces['identity-server'];
  assert.equal(cloudPartPending, false);
  const older = mergeSwitching(baked, { ...liveCloud, docSpaces: { ...liveCloud.docSpaces, 'identity-server': lean } });
  assert.equal(entry(older), '/identity-platform/cloud/identity-server/');
});

test('the build bakes that snapshot: the Docusaurus config reads WSO2_DOCS_DEPLOYED', async () => {
  const { execFileSync } = await import('node:child_process');
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const state = path.join(tmp(), 'state.json');
  fs.writeFileSync(state, JSON.stringify({ schema: 1, deployments: { 'identity-platform/cloud': { release: 'cloud-2026.10.27.1', tag: 'identity-platform/cloud-2026.10.27.1', edition: 'cloud' } } }));
  const snapshot = (extra) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    "const c = (await import('./site/docusaurus.config.mjs')).default; console.log(JSON.stringify(c.customFields.manifestSnapshot));"], {
    cwd: root, encoding: 'utf8', env: { ...process.env, WSO2_DOCS_CONTENT: path.join(root, 'fixtures', 'stub-repo', 'identity-server'), WSO2_DOCS_EDITION: '7.3.0', ...extra },
  }));
  const entries = (m) => m.productsMenu.flatMap((g) => g.entries.map((e) => e.label));
  const withState = snapshot({ WSO2_DOCS_DEPLOYED: state });
  assert.deepEqual(withState.sections['api-platform'].menu, [], 'API Platform\'s Doc spaces wait: none is deployed');
  assert.deepEqual(entries(withState), ['Identity Server', 'Security Token Service'], 'Identity Server is what this build deploys');
  assert.ok(entries(snapshot({})).includes('API Manager'), 'without deployment state, the composed manifest\'s menus');
  // Identity Platform Cloud deployed: the Cloud part is not pending.
  assert.equal(withState.docSpaces['identity-server'].cloudPartPending, false);
  // Identity Platform Cloud not deployed: this Self-hosted build's menus open Identity Server on its newest release.
  const noCloud = path.join(tmp(), 'state.json');
  fs.writeFileSync(noCloud, JSON.stringify({ schema: 1, deployments: { 'identity-server/7.2.0': { release: '7.2.0-docs.1', tag: 'identity-server/7.2.0-docs.1', edition: '7.2.0' } } }));
  const selfHostedOnly = snapshot({ WSO2_DOCS_DEPLOYED: noCloud });
  assert.equal(selfHostedOnly.docSpaces['identity-server'].cloudPartPending, true);
  assert.equal(productsMenu(selfHostedOnly).flatMap((g) => g.entries).find((e) => e.label === 'Identity Server').href, '/identity-server/latest/');
});

// An older version's canonical is the latest twin's page, following a page
// move: the build reads the latest twin's redirect map beside its page list.
test('older versions take canonicals from the latest twin\'s pages and redirects', async () => {
  const { execFileSync } = await import('node:child_process');
  const { canonicalFor } = await import('../plugins/platform-outputs.mjs');
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify([{ path: '' }, { path: 'guides/mfa/' }]));
  fs.writeFileSync(path.join(dir, 'redirects.json'), JSON.stringify([
    { from: '/identity-server/latest/guides/multi-factor-auth/', to: '/identity-server/latest/guides/mfa/', status: 301 },
    { from: 'https://is.docs.wso2.com/en/latest/guides/authentication/mfa/', to: '/identity-server/latest/guides/mfa/', status: 301 },
  ]));
  const options = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    "const c = (await import('./site/docusaurus.config.mjs')).default; const p = c.plugins.find((x) => Array.isArray(x) && String(x[0]).endsWith('platform-outputs.mjs'))[1]; console.log(JSON.stringify({ ...p, latestPages: [...p.latestPages] }));"], {
    cwd: root, encoding: 'utf8', env: { ...process.env, WSO2_DOCS_CONTENT: path.join(root, 'fixtures', 'stub-repo', 'identity-server'), WSO2_DOCS_EDITION: '7.2.0', WSO2_DOCS_LATEST_PAGES: path.join(dir, 'pages.json') },
  }));
  assert.deepEqual(options.latestRedirects, { 'guides/multi-factor-auth/': 'guides/mfa/' }, 'page moves only, relative to the latest twin');
  const o = { ...options, latestPages: new Set(options.latestPages) };
  assert.equal(canonicalFor('guides/multi-factor-auth/', o), 'https://docs.wso2.com/identity-server/latest/guides/mfa/');
  assert.equal(canonicalFor('', o), 'https://docs.wso2.com/identity-server/latest/');
  assert.equal(canonicalFor('guides/only-here/', o), 'https://docs.wso2.com/identity-server/7.2.0/guides/only-here/');
});
