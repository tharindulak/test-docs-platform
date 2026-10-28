import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  editionFromId, inferEditionId, isSelfHostedAddition, markerFromFrontMatter, matches, newestReleaseOf, pageShows, shows, showMarkersFlag, validateMarker, validateVariants,
} from '../lib/edition.mjs';
import { docsLinkTarget, resolveDocsLink } from '../plugins/remark-docs-links.mjs';
import { loadPolicy } from '../lib/manifest.mjs';

const cloud = editionFromId('cloud');
const v720 = editionFromId('7.2.0');
const v730 = editionFromId('7.3.0');
const next = editionFromId('next');

test('only= markers', () => {
  assert.equal(matches(cloud, { only: 'cloud' }), true);
  assert.equal(matches(v730, { only: 'cloud' }), false);
  assert.equal(matches(v730, { only: 'self-hosted' }), true);
  assert.equal(matches(cloud, { only: 'self-hosted' }), false);
});

test('selfHostedFrom= markers', () => {
  assert.equal(matches(cloud, { selfHostedFrom: '7.4.0' }), true, 'Cloud is ahead of every release');
  assert.equal(matches(v730, { selfHostedFrom: '7.3.0' }), true);
  assert.equal(matches(v720, { selfHostedFrom: '7.3.0' }), false);
  assert.equal(matches(v730, { selfHostedFrom: 'next' }), false);
  assert.equal(matches(next, { selfHostedFrom: 'next' }), true, 'the main-branch preview shows what is coming');
  assert.equal(matches(cloud, { selfHostedFrom: 'next' }), true);
});

test('Cloud shows Self-hosted additions, not content in no release yet; Self-hosted Editions never show Cloud-only content', () => {
  const newest = '7.3.0';
  assert.equal(shows(cloud, { only: 'self-hosted' }, newest), true, 'a Self-hosted addition');
  assert.equal(isSelfHostedAddition(cloud, { only: 'self-hosted' }, newest), true);
  assert.equal(shows(cloud, { only: 'self-hosted', selfHostedFrom: '7.2.0' }, newest), true);
  assert.equal(shows(cloud, { only: 'self-hosted', selfHostedFrom: 'next' }, newest), false, 'selfHostedFrom next is in no release yet');
  assert.equal(shows(cloud, { only: 'self-hosted', selfHostedFrom: '7.4.0' }, newest), false, 'nor is a version after the newest release');
  assert.equal(shows(cloud, { selfHostedFrom: 'next' }, newest), true, 'shared content from next shows in Cloud as before');
  assert.equal(isSelfHostedAddition(cloud, { selfHostedFrom: '7.2.0' }, newest), false, 'shared content is no addition');
  assert.equal(shows(cloud, { only: 'self-hosted' }, null), false, 'a Doc space without Self-hosted Editions (a family Cloud)');
  assert.equal(shows(editionFromId('_'), { only: 'self-hosted' }, '1.0.0'), false, 'an unversioned Doc space');
  for (const e of [v730, v720, next]) {
    assert.equal(shows(e, { only: 'cloud' }, newest), false, `${e.id} never shows Cloud-only content`);
    assert.equal(shows(e, { only: 'self-hosted' }, newest), true);
    assert.equal(isSelfHostedAddition(e, { only: 'self-hosted' }, newest), false);
  }
  assert.equal(matches(cloud, { only: 'self-hosted' }), false, 'matches stays each Edition\'s own content (Edition variants, the converter)');
});

test('pages: Self-hosted-only pages show in Cloud unless they name a Cloud counterpart', () => {
  assert.equal(pageShows(cloud, { editions: 'self-hosted' }, '7.3.0'), true);
  assert.equal(pageShows(cloud, { editions: 'self-hosted', cloudCounterpart: 'guides/cloud-billing' }, '7.3.0'), false);
  assert.equal(pageShows(v730, { editions: 'self-hosted', cloudCounterpart: 'guides/cloud-billing' }, '7.3.0'), true);
  assert.equal(pageShows(cloud, { editions: 'self-hosted', selfHostedFrom: 'next' }, '7.3.0'), false);
  assert.equal(pageShows(cloud, { editions: 'self-hosted' }, null), false);
  assert.equal(pageShows(v730, { editions: 'cloud' }, '7.3.0'), false);
  assert.equal(pageShows(cloud, { title: 'x' }, '7.3.0'), true);
});

test('the newest release: the first Self-hosted Edition in manifest order, or latest', () => {
  assert.equal(newestReleaseOf({ editions: [{ id: '7.3.0' }, { id: '7.2.0' }] }), '7.3.0');
  assert.equal(newestReleaseOf({ editions: [{ id: 'cloud' }, { id: '1.2.0' }, { id: '2026.09.24' }] }), '1.2.0', 'never sorted');
  assert.equal(newestReleaseOf({ latest: '7.2.0', editions: [{ id: '7.3.0' }, { id: '7.2.0' }] }), '7.2.0');
  assert.equal(newestReleaseOf({ editions: [{ id: '7.1.0', status: 'legacy' }] }), null);
  assert.equal(newestReleaseOf({ editions: [{ id: 'cloud', parts: ['identity-server'] }] }), null, 'a family Cloud');
  assert.equal(newestReleaseOf({ model: 'unversioned' }), null);
});

test('<Variants> holds one Cloud and one Self-hosted form', () => {
  validateVariants([{ only: 'cloud' }, { only: 'self-hosted' }], 'x');
  validateVariants([{ only: 'self-hosted', selfHostedFrom: '7.3.0' }, { only: 'cloud' }], 'x');
  for (const bad of [[{ only: 'cloud' }], [{ only: 'cloud' }, { only: 'cloud' }], [{ only: 'cloud' }, { only: 'self-hosted' }, null], [{ only: 'cloud' }, { selfHostedFrom: '7.3.0' }], []]) {
    assert.throws(() => validateVariants(bad, 'x'), /exactly one <Edition only="cloud"> and one <Edition only="self-hosted">/);
  }
});

test('invalid markers are rejected', () => {
  assert.throws(() => validateMarker({ only: 'onprem' }, 'x'), /only="onprem"/);
  assert.throws(() => validateMarker({ selfHostedFrom: '7.3' }, 'x'), /exact version/);
  assert.throws(() => validateMarker({}, 'x'), /needs only= or selfHostedFrom=/);
  assert.throws(() => validateMarker({ only: 'cloud', selfHostedFrom: '7.4.0' }, 'x'), /cannot be combined/);
  assert.throws(() => editionFromId('7.3'), /Unknown edition/);
});

test('front matter markers', () => {
  assert.deepEqual(markerFromFrontMatter({ editions: 'cloud' }), { only: 'cloud' });
  assert.deepEqual(markerFromFrontMatter({ selfHostedFrom: '7.4.0' }), { selfHostedFrom: '7.4.0' });
  assert.equal(markerFromFrontMatter({ editions: ['cloud', 'self-hosted'] }), null);
  assert.equal(markerFromFrontMatter({ title: 'x' }), null);
});

test('edition from branch', () => {
  assert.equal(inferEditionId('main', 'cloud-plus-versions'), 'cloud');
  assert.equal(inferEditionId('main', 'versions-only'), 'next');
  assert.equal(inferEditionId('release/7.3.0', 'cloud-plus-versions'), '7.3.0');
  assert.throws(() => inferEditionId('feature/x', 'cloud-plus-versions'), /pass --edition/);
});

test('docs: links resolve against the manifest', () => {
  const policy = loadPolicy();
  const host = 'https://docs-staging.wso2.com';
  assert.equal(resolveDocsLink('docs:api-manager/latest/guides/x', policy, host), `${host}/api-manager/latest/guides/x/`);
  assert.equal(resolveDocsLink('docs:identity-server/7.2.0/guides/mfa#totp', policy, host), `${host}/identity-server/7.2.0/guides/mfa/#totp`);
  assert.equal(resolveDocsLink('docs:contribute/style-guide', policy, host), `${host}/contribute/style-guide/`);
  // A Cloud part's Cloud is at its platform's Cloud address.
  assert.equal(resolveDocsLink('docs:ai-gateway/cloud/guardrails#pii', policy, host), `${host}/api-platform/cloud/ai-gateway/guardrails/#pii`);
  assert.equal(resolveDocsLink('docs:identity-server/cloud/', policy, host), `${host}/identity-platform/cloud/identity-server/`);
  assert.deepEqual(docsLinkTarget('docs:ai-gateway/cloud/guardrails', policy), { space: 'api-platform', segment: 'cloud', page: 'ai-gateway/guardrails/', hash: null, url: '/api-platform/cloud/ai-gateway/guardrails/' });
  // A Cloud-only Doc space has no /latest/ copy: its latest is its Cloud.
  assert.equal(resolveDocsLink('docs:api-platform/latest/guides/x', policy, host), `${host}/api-platform/cloud/guides/x/`);
  assert.equal(resolveDocsLink('docs:ai-gateway/latest/', policy, host), `${host}/ai-gateway/latest/`);
  assert.throws(() => resolveDocsLink('docs:nope/latest/x', policy, host), /unknown Doc space/);
  assert.throws(() => resolveDocsLink('docs:identity-server/9.9.9/x', policy, host), /no edition "9.9.9"/);
  assert.throws(() => resolveDocsLink('docs:identity-server/7.1.0/x', policy, host), /not on WSO2 Docs yet/);
  assert.throws(() => resolveDocsLink('docs:api-manager/cloud/x', policy, host), /no edition "cloud"/, 'no Cloud and no Cloud part');
});

const platformRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('show-markers builds: preview only, never a release build', () => {
  assert.equal(showMarkersFlag(), '0');
  assert.equal(showMarkersFlag({ showMarkers: false, env: 'production' }), '0');
  assert.equal(showMarkersFlag({ showMarkers: true }), '1');
  assert.equal(showMarkersFlag({ showMarkers: true, env: 'preview' }), '1');
  assert.throws(() => showMarkersFlag({ showMarkers: true, env: 'production' }), /production build never shows Edition markers/);
  assert.throws(() => showMarkersFlag({ showMarkers: true, asLatest: true }), /not the latest twin/);
  assert.throws(() => showMarkersFlag({ showMarkers: true, landing: true }), /Landing deployment/);

  // The CLI refuses it before building anything.
  const cli = path.join(platformRoot, 'bin', 'wso2-docs.mjs');
  const stub = path.join(platformRoot, 'fixtures', 'stub-repo', 'identity-server');
  for (const extra of [['--env', 'production'], ['--as-latest']]) {
    const r = spawnSync(process.execPath, [cli, 'build', stub, '--edition', '7.3.0', '--show-markers', ...extra, '--out', path.join(platformRoot, '.cache', 'never')], { encoding: 'utf8' });
    assert.equal(r.status, 1, extra.join(' '));
    assert.match(r.stderr, /--show-markers is for preview builds/);
  }
});

test('the site config: markers shown only when asked, and never with production', () => {
  // The config is evaluated at import, from WSO2_DOCS_* variables, as the CLI passes them.
  const fields = (env) => execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { default: c } = await import(${JSON.stringify(path.join(platformRoot, 'site', 'docusaurus.config.mjs'))});
    const outputs = c.plugins.find((p) => Array.isArray(p) && String(p[0]).endsWith('platform-outputs.mjs'))[1];
    console.log(JSON.stringify({ showMarkers: c.customFields.showMarkers, outputs: outputs.showMarkers, onBrokenLinks: c.onBrokenLinks }));
  `], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WSO2_DOCS_CONTENT: path.join(platformRoot, 'fixtures', 'stub-repo', 'identity-server'), WSO2_DOCS_EDITION: '7.3.0', ...env } });
  assert.deepEqual(JSON.parse(fields({ WSO2_DOCS_SHOW_MARKERS: '1' })), { showMarkers: true, outputs: true, onBrokenLinks: 'warn' });
  assert.deepEqual(JSON.parse(fields({ WSO2_DOCS_SHOW_MARKERS: '0' })), { showMarkers: false, outputs: false, onBrokenLinks: 'throw' });
  assert.throws(() => fields({ WSO2_DOCS_SHOW_MARKERS: '1', WSO2_DOCS_ENV: 'production' }), /production build never shows Edition markers/);
});
