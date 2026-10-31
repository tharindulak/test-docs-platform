// Search rules as pure functions (no Typesense needed): record mapping, the
// three search scopes and their filters, the one-Edition rule, end-of-life
// handling, the /latest/ rewrite, full-page navigation, the search page URL,
// per-host endpoints, scoped keys, and indexing order (upsert, then delete
// stale) and the consistency check against an in-memory index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import Typesense from 'typesense';
import { loadPolicy, publicManifest } from '../lib/manifest.mjs';
import { FsStorage } from '../lib/storage.mjs';
import { flip, publishRelease } from '../lib/release.mjs';
import { MCP_STOPWORDS, MCP_STOPWORDS_ID, analyticsSetup, collectionSchema, editionFilter, editionRank, staleFilter, toSearchDocuments } from '../lib/search/schema.mjs';
import {
  buildFilter, chipOptions, contextFromView, deploymentContext, editionLabel, hitTarget, oneEdition, opensEdition, parseSearchPageUrl, readRemembered, rememberKey,
  scopeLabel, scopesFor, searchPageUrl, searchParameters,
} from '../lib/search/scopes.mjs';
import { focus, sectionFor } from '../lib/switching.mjs';
import { COLLECTIONS, pickEnvironment, searchConfigFromEnv } from '../lib/search/environments.mjs';
import { scopedSearchKey, withRetry } from '../lib/search/typesense.mjs';
import { checkConsistency, exportSearchInputs, indexDeployment, indexReleases } from '../lib/search/indexing.mjs';
import { COMPOSED_KEY } from '../lib/compose.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = loadPolicy();
// Production's view: no staging-only Doc spaces (the Sandbox).
const manifest = publicManifest(policy, { environment: 'production' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-search-'));

const meta = (edition, extra = {}) => ({ docSpace: 'identity-server', edition, kind: edition === 'cloud' ? 'cloud' : 'self-hosted', asLatest: false, baseUrl: `/identity-server/${edition}/`, ...extra });
const rec = (edition, page, anchor, lvl2, content) => ({
  url: `https://docs.wso2.com/identity-server/${edition}/${page}${anchor ? `#${anchor}` : ''}`,
  hierarchy: { lvl0: 'WSO2 Identity Platform', lvl1: 'Quick start', lvl2: lvl2 ?? null, lvl3: null },
  content, docSpace: 'identity-server', edition, kind: edition === 'cloud' ? 'cloud' : 'self-hosted',
});

test('records map to the collection schema', () => {
  const docs = toSearchDocuments([
    rec('7.3.0', 'get-started/quick-start/', '', null, 'Open the console.'),
    rec('7.3.0', 'get-started/quick-start/', 'register-an-application', 'Register an application', 'Register it.'),
    rec('7.3.0', 'get-started/quick-start/', 'register-an-application', 'Register an application', 'Twice.'),
  ], meta('7.3.0'), policy, { release: '7.3.0-docs.1' });
  assert.equal(docs.length, 2, 'records for the same URL merge');
  const [top, section] = docs;
  assert.deepEqual(
    { docSpace: top.docSpace, edition: top.edition, kind: top.kind, family: top.family, page: top.page, anchor: top.anchor, level: top.level, lvl1: top.lvl1, release: top.release },
    { docSpace: 'identity-server', edition: '7.3.0', kind: 'self-hosted', family: 'Identity Platform', page: 'get-started/quick-start/', anchor: '', level: 1, lvl1: 'Quick start', release: '7.3.0-docs.1' },
  );
  assert.equal(section.level, 2);
  assert.equal(section.content, 'Register it. Twice.');
  assert.equal(top.formerNames, undefined, 'a Doc space with no former names has none on its records');
  assert.match(top.id, /^[0-9a-f]{32}$/);
  assert.notEqual(top.id, section.id);
  const fields = new Set(collectionSchema('x').fields.map((f) => f.name));
  for (const d of docs) for (const k of Object.keys(d)) if (k !== 'id') assert.ok(fields.has(k), `schema has ${k}`);
  assert.equal(top.selfHosted, undefined);
  // A Self-hosted addition stays in Cloud's records, tagged for its badge.
  const [addition] = toSearchDocuments([{ ...rec('cloud', 'deploy-and-operate/install/', '', null, 'Install.'), selfHosted: true }], meta('cloud'), policy, { release: 'r' });
  assert.equal(addition.selfHosted, true);
  assert.ok(fields.has('selfHosted'));
});

test('/latest/ twins, legacy versions and unknown Doc spaces are never indexed', () => {
  assert.throws(() => toSearchDocuments([], meta('7.3.0', { asLatest: true, baseUrl: '/identity-server/latest/' }), policy, { release: 'r' }), /never indexed/);
  assert.throws(() => toSearchDocuments([], meta('7.0.0'), policy, { release: 'r' }), /legacy/);
  assert.throws(() => toSearchDocuments([], { ...meta('1.0.0'), docSpace: 'nope' }, policy, { release: 'r' }), /not in the manifest/);
  assert.throws(() => toSearchDocuments([], { ...meta('1.0.0'), docSpace: 'ballerina', baseUrl: '/ballerina/1.0.0/' }, policy, { release: 'r' }), /legacy/, 'a Doc space not on WSO2 Docs yet');
});

// A family Cloud tree's records: the family's own pages, and its Cloud part's.
const treeMeta = { docSpace: 'identity-platform', edition: 'cloud', kind: 'cloud', asLatest: false, baseUrl: '/identity-platform/cloud/', parts: [{ docSpace: 'identity-server', path: 'identity-server/', editionName: 'Identity Server Cloud' }] };
const treeRec = (page, anchor, lvl2, content, extra = {}) => ({
  url: `https://docs.wso2.com/identity-platform/cloud/${page}${anchor ? `#${anchor}` : ''}`,
  hierarchy: { lvl0: 'Identity Platform Cloud', lvl1: 'A page', lvl2: lvl2 ?? null, lvl3: null }, content, edition: 'cloud', kind: 'cloud', ...extra,
});

test('a Cloud part\'s pages are indexed as the component\'s Cloud; the family Cloud\'s own pages stay the family\'s', () => {
  const docs = toSearchDocuments([
    treeRec('', '', null, 'Welcome.'),
    treeRec('get-started/first-organization/', 'create', 'Create', 'Create an organization.'),
    treeRec('identity-server/guides/mfa/', 'choose-a-factor', 'Choose a factor', 'Pick TOTP.'),
    treeRec('identity-server/', '', null, 'Identity Server Cloud home.'),
  ], treeMeta, policy, { release: 'cloud-2026.10.26.1' });
  const pick = (d) => ({ docSpace: d.docSpace, edition: d.edition, page: d.page, lvl0: d.lvl0, docSpaceName: d.docSpaceName, family: d.family, cloudIn: d.cloudIn });
  assert.deepEqual(docs.map(pick), [
    { docSpace: 'identity-platform', edition: 'cloud', page: '', lvl0: 'Identity Platform Cloud', docSpaceName: 'Identity Platform Cloud', family: 'Identity Platform', cloudIn: undefined },
    { docSpace: 'identity-platform', edition: 'cloud', page: 'get-started/first-organization/', lvl0: 'Identity Platform Cloud', docSpaceName: 'Identity Platform Cloud', family: 'Identity Platform', cloudIn: undefined },
    { docSpace: 'identity-server', edition: 'cloud', page: 'guides/mfa/', lvl0: 'Identity Server Cloud', docSpaceName: 'Identity Server', family: 'Identity Platform', cloudIn: 'identity-platform' },
    { docSpace: 'identity-server', edition: 'cloud', page: '', lvl0: 'Identity Server Cloud', docSpaceName: 'Identity Server', family: 'Identity Platform', cloudIn: 'identity-platform' },
  ]);
  assert.equal(docs[2].url, 'https://docs.wso2.com/identity-platform/cloud/identity-server/guides/mfa/#choose-a-factor', 'the real address');
  // Former names stay searchable: the family Cloud's (Asgardeo) are on its own
  // records and on its Cloud parts', which are served in its tree.
  assert.deepEqual(docs.map((d) => d.formerNames), [['Asgardeo'], ['Asgardeo'], ['Asgardeo'], ['Asgardeo']]);
  assert.ok(searchParameters('all').query_by.split(',').includes('formerNames'), 'queries match former names');
  assert.equal(searchParameters('all').query_by.split(',').length, searchParameters('all').query_by_weights.split(',').length);
  assert.equal(new Set(docs.map((d) => d.id)).size, 4);
  // A part built on its own (its PR preview) sits at its address in the tree: the same records.
  const alone = toSearchDocuments([treeRec('identity-server/guides/mfa/', 'choose-a-factor', 'Choose a factor', 'Pick TOTP.')],
    { docSpace: 'identity-server', edition: 'cloud', kind: 'cloud', asLatest: false, baseUrl: '/identity-platform/cloud/identity-server/', cloudPartOf: 'identity-platform' }, policy, { release: 'pr-1' });
  assert.deepEqual(pick(alone[0]), pick(docs[2]));
  assert.equal(alone[0].id, docs[2].id);
  // Never /latest/, and never a part the policy does not know.
  assert.throws(() => toSearchDocuments([], { ...treeMeta, baseUrl: '/identity-platform/latest/' }, policy, { release: 'r' }), /never indexed/);
  assert.throws(() => toSearchDocuments([], { ...treeMeta, parts: [{ docSpace: 'nope', path: 'nope/' }] }, policy, { release: 'r' }), /Cloud part "nope"/);
});

test('catalog items are records of their own, typed catalog-item, at #catalog-<id>', async () => {
  const { parse } = await import('node-html-parser');
  const { recordOwner, searchRecords } = await import('../plugins/platform-outputs.mjs');
  const html = `<article><h1>Connectors</h1><div class="theme-doc-markdown"><p>Intro text.</p><h2 id="available">Available</h2>
    <div class="wso2-layout-catalog"><div class="wso2-layout-catalog__controls" data-search-exclude=""><label>Search by name</label></div>
    <ul class="wso2-layout-catalog__grid">
      <li class="wso2-layout-catalog__item" id="catalog-totp" data-category="auth" data-category-label="Authentication" data-tags="otp mfa"><div class="wso2-layout-catalog__logo"><p><img src="x.svg" alt=""></p></div><p><strong><a href="/x/">TOTP authenticator</a></strong></p><p>Time-based one-time passwords.</p><p><a href="https://github.com/x">Source code</a></p></li>
      <li class="wso2-layout-catalog__item" id="catalog-fido" data-category="auth"><p><strong><a href="/y/">FIDO2</a></strong></p><p>Passkeys.</p></li>
    </ul></div></div></article>`;
  const o = { docSpace: 'identity-platform', docSpaceName: 'Identity Platform Cloud', editionId: 'cloud', editionKind: 'cloud', parts: [{ docSpace: 'identity-server', path: 'identity-server/', editionName: 'Identity Server Cloud' }] };
  const owner = recordOwner('identity-server/reference/connectors/', o);
  assert.deepEqual(owner, { docSpace: 'identity-server', lvl0: 'Identity Server Cloud', cloudIn: 'identity-platform' });
  assert.deepEqual(recordOwner('get-started/', o), { docSpace: 'identity-platform', lvl0: 'Identity Platform Cloud' });
  const records = searchRecords(parse(html), 'https://docs.wso2.com/identity-platform/cloud/identity-server/reference/connectors/', o, owner);
  const items = records.filter((r) => r.type === 'catalog-item');
  assert.deepEqual(items.map((r) => [r.url.split('#')[1], r.hierarchy.lvl2, r.hierarchy.lvl3, r.content]), [
    ['catalog-totp', 'Available', 'TOTP authenticator', 'Time-based one-time passwords. Source code Authentication otp mfa'],
    ['catalog-fido', 'Available', 'FIDO2', 'Passkeys.'],
  ]);
  assert.ok(items.every((r) => r.docSpace === 'identity-server' && r.cloudIn === 'identity-platform' && r.hierarchy.lvl0 === 'Identity Server Cloud'));
  const section = records.find((r) => r.url.endsWith('#available'));
  assert.doesNotMatch(section.content, /TOTP|Passkeys|Search by name/, 'an item\'s text is its own record, the controls none');
  const docs = toSearchDocuments(records, treeMeta, policy, { release: 'r' });
  assert.deepEqual(docs.filter((d) => d.type === 'catalog-item').map((d) => [d.docSpace, d.page, d.anchor, d.level]), [
    ['identity-server', 'reference/connectors/', 'catalog-totp', 3], ['identity-server', 'reference/connectors/', 'catalog-fido', 3],
  ]);
  assert.ok(docs.filter((d) => d.type !== 'catalog-item').every((d) => d.type === 'page'));
});

test('newer Editions rank higher', () => {
  assert.ok(editionRank('cloud') > editionRank('next'));
  assert.ok(editionRank('next') > editionRank('7.10.0'));
  assert.ok(editionRank('7.10.0') > editionRank('7.3.0'));
  assert.ok(editionRank('7.3.0') > editionRank('7.2.9'));
  assert.equal(searchParameters('docspace').sort_by, '_text_match(buckets: 10):desc,editionRank:desc,level:asc');
  assert.equal(searchParameters('edition', { analyticsTag: 'identity-server/7.3.0' }).analytics_tag, 'identity-server/7.3.0');
});

const ctx720 = deploymentContext({ docSpace: 'identity-server', edition: '7.2.0' });
// Pages in a Docs section, as the chrome draws it (the home section here).
const sec720 = deploymentContext({ docSpace: 'identity-server', edition: '7.2.0', section: 'identity-platform' });
const ipCloud = deploymentContext({ docSpace: 'identity-platform', edition: 'cloud', section: 'identity-platform' });
// A page in Identity Server's Cloud part: the component's Cloud, served by the family's tree.
const isPart = contextFromView({ space: 'identity-platform', edition: 'cloud', path: 'identity-server/guides/mfa/' }, { doc: 'identity-server', edition: 'cloud', inPart: 'identity-platform' }, 'identity-platform');
const apim = deploymentContext({ docSpace: 'api-manager', edition: '4.6.0', section: 'api-platform' });
const ctxLatest = deploymentContext({ docSpace: 'identity-server', edition: '7.3.0', asLatest: true });
const ctx730 = deploymentContext({ docSpace: 'identity-server', edition: '7.3.0' });
const landing = deploymentContext({ landing: true });
const withStatus = (m, slug, id, status) => {
  const copy = structuredClone(m);
  copy.docSpaces[slug].editions.find((e) => e.id === id).status = status;
  return copy;
};

test('scopes: search follows the selected version (This Edition first, then the Docs section, All of WSO2 Docs and All Editions); only All of WSO2 Docs on the landing page', () => {
  assert.deepEqual(scopesFor(ctx720), { scopes: ['edition', 'docspace', 'all'], default: 'edition' }, 'without a manifest: the first Pilot\'s three');
  assert.deepEqual(scopesFor(sec720, manifest), { scopes: ['edition', 'section', 'all', 'docspace'], default: 'edition' });
  assert.deepEqual(scopesFor(landing, manifest), { scopes: ['all'], default: 'all' });
  assert.deepEqual(scopesFor(ipCloud, manifest), { scopes: ['edition', 'section', 'all'], default: 'edition' }, 'a Cloud-only family: one Edition, so no All Editions');
  assert.deepEqual(scopesFor(isPart, manifest), { scopes: ['edition', 'section', 'all', 'docspace'], default: 'edition' }, 'a Cloud part: its component\'s Editions');
  assert.equal(scopeLabel('section', sec720, manifest), 'Identity Platform docs');
  assert.equal(scopeLabel('section', apim, manifest), 'API Platform docs');
  assert.equal(scopeLabel('all', sec720, manifest), 'All of WSO2 Docs');
});

test('This Edition filters to the Edition being read, end of life included', () => {
  const eol = withStatus(manifest, 'identity-server', '7.2.0', 'end-of-life');
  assert.equal(buildFilter({ scope: 'edition', ctx: ctx720, manifest: eol }), '(docSpace:=`identity-server` && edition:=`7.2.0`)');
  assert.equal(buildFilter({ scope: 'edition', ctx: ctxLatest, manifest }), '(docSpace:=`identity-server` && edition:=`7.3.0`)', 'on /latest/ it is the Edition feeding latest');
  assert.equal(buildFilter({ scope: 'edition', ctx: isPart, manifest }), '(docSpace:=`identity-server` && edition:=`cloud`)', 'a Cloud part\'s page: the component\'s Cloud');
  assert.equal(buildFilter({ scope: 'edition', ctx: ipCloud, manifest }), '(docSpace:=`identity-platform` && edition:=`cloud`)', 'a family Cloud page: the family\'s own pages');
});

test('All Editions: live Editions only (no legacy, no end of life), the Cloud part first, narrowed by Edition chips', () => {
  assert.equal(buildFilter({ scope: 'docspace', ctx: ctx720, manifest }), '(docSpace:=`identity-server` && edition:=[`cloud`,`7.3.0`,`7.2.0`,`7.1.0`])');
  assert.equal(buildFilter({ scope: 'docspace', ctx: isPart, manifest }), '(docSpace:=`identity-server` && edition:=[`cloud`,`7.3.0`,`7.2.0`,`7.1.0`])');
  assert.equal(buildFilter({ scope: 'docspace', ctx: apim, manifest }), '(docSpace:=`api-manager` && edition:=[`4.7.0`,`4.6.0`,`4.5.0`])', 'no Cloud: no Cloud Edition');
  const eol = withStatus(manifest, 'identity-server', '7.2.0', 'end-of-life');
  assert.equal(buildFilter({ scope: 'docspace', ctx: ctx720, manifest: eol }), '(docSpace:=`identity-server` && edition:=[`cloud`,`7.3.0`,`7.1.0`])');
  assert.equal(buildFilter({ scope: 'docspace', ctx: ctx720, manifest, chips: { editions: ['7.2.0'] } }), '(docSpace:=`identity-server` && edition:=`7.2.0`)');
  assert.deepEqual(chipOptions('docspace', ctx720, eol).editions, ['cloud', '7.3.0', '7.1.0']);
});

const clause = (s, e) => (e === '_' ? `docSpace:=\`${s}\`` : `(docSpace:=\`${s}\` && edition:=\`${e}\`)`);
const or = (...c) => `(${c.join(' || ')})`;

test('This Docs section: every Doc space its menu lists, at the Edition being read, the others where their selector opens', () => {
  // Identity Server 7.2.0: itself at 7.2.0, Identity Platform Cloud (its selector opens Cloud).
  assert.equal(buildFilter({ scope: 'section', ctx: sec720, manifest }), or(clause('identity-server', '7.2.0'), clause('identity-platform', 'cloud')));
  // On the family Cloud: the family's pages and Identity Server's Cloud part (where its selector opens).
  assert.equal(buildFilter({ scope: 'section', ctx: ipCloud, manifest }), or(clause('identity-platform', 'cloud'), clause('identity-server', 'cloud')));
  // In the Cloud part: the component's Cloud and the family's.
  assert.equal(buildFilter({ scope: 'section', ctx: isPart, manifest }), or(clause('identity-server', 'cloud'), clause('identity-platform', 'cloud')));
  // API Manager 4.6.0: API Platform Cloud, its four Cloud parts, itself at 4.6.0.
  assert.equal(buildFilter({ scope: 'section', ctx: apim, manifest }), or(clause('api-manager', '4.6.0'), clause('api-platform', 'cloud'), clause('api-gateway', 'cloud'), clause('ai-gateway', 'cloud'), clause('ai-workspace', 'cloud'), clause('api-portal', 'cloud')));
  // The remembered Edition does not steer the section (the menu shows each Doc space's latest).
  assert.equal(buildFilter({ scope: 'section', ctx: apim, manifest, remembered: { 'ai-gateway': '2026.09.24' } }), buildFilter({ scope: 'section', ctx: apim, manifest }));
  // End of life: the Doc space being read falls back to where it opens (end of life is only under This Edition).
  const eol = withStatus(manifest, 'api-manager', '4.6.0', 'end-of-life');
  assert.match(buildFilter({ scope: 'section', ctx: apim, manifest: eol }), /docSpace:=`api-manager` && edition:=`4\.7\.0`/);
  // Doc space chips narrow it.
  assert.equal(buildFilter({ scope: 'section', ctx: apim, manifest, chips: { docSpaces: ['ai-gateway'] } }), or(clause('ai-gateway', 'cloud')));
  assert.deepEqual(chipOptions('section', apim, manifest).docSpaces.map((d) => d.id), ['api-manager', 'api-platform', 'api-gateway', 'ai-gateway', 'ai-workspace', 'api-portal']);
  // Where a Cloud part's platform has no Cloud deployed (the published manifest says), its component opens its newest release.
  const deployed = structuredClone(manifest);
  for (const [slug, segs] of Object.entries({ 'api-platform': [], 'api-manager': ['4.7.0', '4.6.0', 'latest'], 'ai-gateway': ['1.2.0', 'latest'] })) {
    deployed.docSpaces[slug].deployments = Object.fromEntries(segs.map((g) => [g, { edition: g === 'latest' ? deployed.docSpaces[slug].latest : g, release: 'r' }]));
  }
  assert.equal(opensEdition(deployed, 'ai-gateway'), '1.2.0');
  assert.equal(opensEdition(manifest, 'ai-gateway'), 'cloud', 'the baked snapshot has no deployments: Cloud');
});

test('the Docs section comes from the manifest: a section changed in the published manifest changes the scope without a rebuild', () => {
  const live = structuredClone(manifest);
  live.sections['identity-platform'].menu.push({ docSpace: 'api-manager', versionIn: 'menu' });
  assert.equal(buildFilter({ scope: 'section', ctx: ipCloud, manifest: live }), or(clause('identity-platform', 'cloud'), clause('identity-server', 'cloud'), clause('api-manager', '4.7.0')));
  // A borrowing section the reader came through this session (the chrome's sectionFor).
  live.sections['agent-platform'] = { title: 'Agent Platform Documentation', family: 'Agent Platform', menu: [{ docSpace: 'ai-gateway', versionIn: 'menu' }] };
  const view = { space: 'api-platform', edition: 'cloud', path: 'ai-gateway/guides/' };
  const borrowed = contextFromView(view, focus(live, view), sectionFor(live, view, { 'ai-gateway': 'agent-platform' }));
  assert.equal(borrowed.section, 'agent-platform');
  assert.equal(scopeLabel('section', borrowed, live), 'Agent Platform docs');
  assert.equal(buildFilter({ scope: 'section', ctx: borrowed, manifest: live }), or(clause('ai-gateway', 'cloud')));
  const home = contextFromView(view, focus(live, view), sectionFor(live, view, {}));
  assert.equal(home.section, 'api-platform', 'an arrival sees the home section');
  // A section the manifest no longer has: no section scope.
  delete live.sections['agent-platform'];
  assert.deepEqual(scopesFor(borrowed, live).scopes, ['edition', 'docspace', 'all']);
});

test('All of WSO2 Docs: the section as it is, widened by one Edition of every other Doc space (remembered, else where its selector opens)', () => {
  const others = [clause('ai-gateway', 'cloud'), clause('ai-workspace', 'cloud'), clause('api-gateway', 'cloud'), clause('api-manager', '4.7.0'), clause('api-platform', 'cloud'), clause('api-portal', 'cloud'), clause('contribute', '_')];
  const fromLanding = or(...others, clause('identity-platform', 'cloud'), clause('identity-server', 'cloud'));
  assert.equal(buildFilter({ scope: 'all', ctx: landing, manifest }), fromLanding, 'Cloud first, as the products menu opens them; Contribute (indexed) included');
  assert.equal(buildFilter({ scope: 'all', ctx: landing, manifest, remembered: { 'identity-server': '7.2.0', 'api-manager': 'latest' } }),
    or(...others, clause('identity-platform', 'cloud'), clause('identity-server', '7.2.0')));
  // From Identity Server 7.2.0: the section's two at their Editions, then the others.
  assert.equal(buildFilter({ scope: 'all', ctx: sec720, manifest }), or(clause('identity-server', '7.2.0'), clause('identity-platform', 'cloud'), ...others));
  // The remembered Edition never overrides the one being read.
  assert.equal(buildFilter({ scope: 'all', ctx: sec720, manifest, remembered: { 'identity-server': '7.3.0' } }), buildFilter({ scope: 'all', ctx: sec720, manifest }));
  // A remembered Edition that went end of life, or a legacy one, falls back to where the selector opens.
  const eol = withStatus(manifest, 'identity-server', '7.2.0', 'end-of-life');
  assert.equal(oneEdition(eol, 'identity-server', '7.2.0'), 'cloud');
  assert.equal(oneEdition(manifest, 'identity-server', '7.0.0'), 'cloud');
  assert.equal(oneEdition(manifest, 'api-manager', '4.6.0'), '4.6.0');
  assert.equal(oneEdition(manifest, 'api-manager', null), '4.7.0');
  // Chips narrow the Doc spaces; product family chips only on the landing page.
  assert.equal(buildFilter({ scope: 'all', ctx: landing, manifest, chips: { docSpaces: ['api-manager'] } }), or(clause('api-manager', '4.7.0')));
  assert.equal(buildFilter({ scope: 'all', ctx: landing, manifest, chips: { families: ['Identity Platform'] } }), or(clause('identity-platform', 'cloud'), clause('identity-server', 'cloud')));
  assert.deepEqual(chipOptions('all', landing, manifest).families, ['API Platform', 'Identity Platform']);
  assert.deepEqual(chipOptions('all', ctx720, manifest).families, [], 'no family filter on Doc space pages');
  assert.ok(!chipOptions('all', landing, manifest).docSpaces.some((d) => manifest.docSpaces[d.id].status === 'legacy'), 'legacy Doc spaces are not offered');
  assert.doesNotMatch(buildFilter({ scope: 'all', ctx: landing, manifest }), /ballerina/);
  assert.equal(buildFilter({ scope: 'all', ctx: landing, manifest, chips: { docSpaces: ['none'] } }), 'docSpace:=`__none__`');
});

test('Unlisted Doc spaces search only themselves and are in no other search; Contribute (indexed) is in All of WSO2 Docs', () => {
  const staging = publicManifest(policy, { environment: 'staging' });
  assert.equal(staging.docSpaces.sandbox.listed, false);
  const sandbox = deploymentContext({ docSpace: 'sandbox', edition: '1.0.0' });
  assert.deepEqual(scopesFor(sandbox, staging), { scopes: ['edition', 'docspace'], default: 'edition' });
  assert.equal(buildFilter({ scope: 'edition', ctx: sandbox, manifest: staging }), '(docSpace:=`sandbox` && edition:=`1.0.0`)');
  assert.equal(buildFilter({ scope: 'docspace', ctx: sandbox, manifest: staging }), '(docSpace:=`sandbox` && edition:=[`cloud`,`1.0.0`])');
  assert.equal(buildFilter({ scope: 'all', ctx: sandbox, manifest: staging }), 'docSpace:=`__none__`', 'never widened');
  for (const ctx of [landing, sec720, ipCloud, apim]) {
    for (const scope of ['section', 'all']) assert.doesNotMatch(buildFilter({ scope, ctx, manifest: staging, remembered: { sandbox: '1.0.0' } }), /sandbox/, `${scope} from ${ctx.docSpace ?? 'landing'}`);
  }
  assert.ok(!chipOptions('all', landing, staging).docSpaces.some((d) => d.id === 'sandbox'));
  // Bijira- or Devant-style: any listed: false Doc space without indexed: true.
  const bijira = structuredClone(manifest);
  bijira.docSpaces.bijira = { displayName: 'Bijira', model: 'cloud-only', status: 'live', latest: 'cloud', listed: false, editions: [{ id: 'cloud', status: 'live' }] };
  assert.doesNotMatch(buildFilter({ scope: 'all', ctx: landing, manifest: bijira }), /bijira/);
  assert.deepEqual(scopesFor(deploymentContext({ docSpace: 'bijira', edition: 'cloud' }), bijira).scopes, ['edition']);
  // Contribute: Unlisted but indexed, in no section, so This Edition first and All of WSO2 Docs one click away.
  assert.equal(manifest.docSpaces.contribute.indexed, true);
  const contribute = deploymentContext({ docSpace: 'contribute', edition: '_' });
  assert.deepEqual(scopesFor(contribute, manifest), { scopes: ['edition', 'all'], default: 'edition' });
  assert.match(buildFilter({ scope: 'all', ctx: landing, manifest }), /docSpace:=`contribute`/);
  assert.match(buildFilter({ scope: 'all', ctx: contribute, manifest }), /^\(docSpace:=`contribute` \|\| /, 'its own records first, then the rest');
  assert.doesNotMatch(buildFilter({ scope: 'section', ctx: sec720, manifest }), /contribute/, 'no section lists it');
});

test('the remembered Edition is read per Doc space from localStorage', () => {
  const store = new Map([[rememberKey('identity-server'), 'cloud']]);
  const storage = { getItem: (k) => store.get(k) ?? null };
  assert.deepEqual(readRemembered(storage, ['identity-server', 'api-manager']), { 'identity-server': 'cloud' });
  assert.deepEqual(readRemembered({ getItem: () => { throw new Error('blocked'); } }, ['identity-server']), {});
  assert.equal(rememberKey('api-manager'), 'wso2docs:edition:api-manager');
});

test('the /latest/ rewrite, Cloud parts in their platform\'s tree, and full-page navigation across deployments', () => {
  const hit = (edition, page = 'guides/mfa/', anchor = 'choose-a-factor', docSpace = 'identity-server', extra = {}) => ({ docSpace, edition, page, anchor, ...extra });
  assert.deepEqual(hitTarget(hit('7.3.0'), ctxLatest, manifest), { href: '/identity-server/latest/guides/mfa/#choose-a-factor', segment: 'latest', sameDeployment: true });
  assert.deepEqual(hitTarget(hit('7.3.0'), ctx720, manifest), { href: '/identity-server/latest/guides/mfa/#choose-a-factor', segment: 'latest', sameDeployment: false });
  assert.deepEqual(hitTarget(hit('7.3.0'), ctx730, manifest), { href: '/identity-server/7.3.0/guides/mfa/#choose-a-factor', segment: '7.3.0', sameDeployment: true }, 'a reader on the pinned twin stays on it');
  assert.deepEqual(hitTarget(hit('7.2.0', ''), ctx720, manifest), { href: '/identity-server/7.2.0/#choose-a-factor', segment: '7.2.0', sameDeployment: true });
  assert.deepEqual(hitTarget(hit('4.7.0', 'guides/', '', 'api-manager'), landing, manifest), { href: '/api-manager/latest/guides/', segment: 'latest', sameDeployment: false });
  // A Cloud part's hit opens in its platform's tree, in the same deployment for any page of that tree.
  const part = hit('cloud', 'guides/mfa/', 'choose-a-factor', 'identity-server', { cloudIn: 'identity-platform' });
  assert.deepEqual(hitTarget(part, ctx720, manifest), { href: '/identity-platform/cloud/identity-server/guides/mfa/#choose-a-factor', segment: 'cloud', sameDeployment: false });
  assert.equal(hitTarget(part, isPart, manifest).sameDeployment, true);
  assert.equal(hitTarget(part, ipCloud, manifest).sameDeployment, true, 'the family\'s pages and its parts are one deployment');
  assert.equal(hitTarget({ ...part, cloudIn: undefined }, ctx720, manifest).href, '/identity-platform/cloud/identity-server/guides/mfa/#choose-a-factor', 'cloud.in from the manifest when a record lacks it');
  // A family Cloud never moves to /latest/ (it has no latest copy).
  assert.deepEqual(hitTarget(hit('cloud', 'guides/', '', 'identity-platform'), isPart, manifest), { href: '/identity-platform/cloud/guides/', segment: 'cloud', sameDeployment: true });
  // When latest moves, only the manifest changes.
  const moved = structuredClone(manifest);
  moved.docSpaces['identity-server'].latest = '7.2.0';
  assert.equal(hitTarget(hit('7.3.0'), ctx720, moved).href, '/identity-server/7.3.0/guides/mfa/#choose-a-factor');
});

test('labels use the chrome\'s words: "(newest release)" with Cloud, "(latest)" without, Cloud named after its Doc space in wide scopes', () => {
  const hit = (docSpace, edition) => ({ docSpace, edition });
  assert.equal(editionLabel(hit('identity-server', '7.3.0'), manifest), '7.3.0 (newest release)');
  assert.equal(editionLabel(hit('identity-server', '7.2.0'), manifest), '7.2.0');
  assert.equal(editionLabel(hit('identity-server', 'cloud'), manifest), 'Cloud');
  assert.equal(editionLabel(hit('api-manager', '4.7.0'), manifest), '4.7.0 (latest)');
  assert.equal(editionLabel(hit('ai-gateway', '1.2.0'), manifest), '1.2.0 (newest release)');
  assert.equal(editionLabel(hit('ai-gateway', '2026.09.24'), manifest), '2026.09.24');
  assert.equal(editionLabel(hit('identity-server', 'cloud'), manifest, { withName: true }), 'Identity Server Cloud');
  assert.equal(editionLabel(hit('ai-gateway', 'cloud'), manifest, { withName: true }), 'AI Gateway Cloud');
  assert.equal(editionLabel(hit('identity-platform', 'cloud'), manifest, { withName: true }), 'Identity Platform Cloud');
  assert.equal(editionLabel(hit('identity-server', '7.3.0'), manifest, { withName: true }), 'Identity Server 7.3.0 (newest release)');
  assert.equal(editionLabel(hit('api-manager', '4.7.0'), manifest, { withName: true }), 'API Manager 4.7.0 (latest)');
  assert.equal(editionLabel(hit('contribute', '_'), manifest, { withName: true }), 'Contribute');
  for (const [slug, s] of Object.entries(manifest.docSpaces)) {
    for (const e of s.editions ?? []) for (const withName of [false, true]) assert.doesNotMatch(editionLabel(hit(slug, e.id), manifest, { withName }), /latest release/);
  }
  // The search UI says nothing about the "latest release" any more.
  const ui = ['SearchPanel.js', 'SearchModal.js', 'SearchPage.js', 'SearchBox.js'].map((f) => fs.readFileSync(path.join(root, 'site', 'src', 'components', 'search', f), 'utf8')).join('');
  assert.doesNotMatch(ui, /latest release/);
  assert.match(ui, /scopeLabel\(/);
});

test('"See all results" goes to the Landing search page, which reads its context back', () => {
  const u = searchPageUrl({ query: 'mfa setup', scope: 'edition', ctx: ctxLatest });
  assert.equal(u, '/search/?q=mfa+setup&scope=edition&space=identity-server&edition=7.3.0&from=latest');
  const p = parseSearchPageUrl(u.split('?')[1]);
  assert.deepEqual(p, { query: 'mfa setup', scope: 'edition', ctx: { ...ctxLatest, elsewhere: true }, offered: ['edition', 'docspace', 'all'] });
  assert.equal(hitTarget({ docSpace: 'identity-server', edition: '7.3.0', page: '', anchor: '' }, p.ctx, manifest).sameDeployment, false, 'the search page is on the Landing deployment');
  assert.equal(searchPageUrl({ query: 'x', scope: 'all', ctx: ctx720 }), '/search/?q=x&scope=all');
  assert.deepEqual(parseSearchPageUrl('q=x&scope=edition').scope, 'all', 'no Doc space: only All of WSO2 Docs');
  assert.deepEqual(parseSearchPageUrl('q=x&scope=docspace&space=api-manager').offered, ['docspace', 'all']);
  // From a page in a Docs section: the section scope and the reader's Edition travel with it.
  const sec = searchPageUrl({ query: 'mfa', scope: 'section', ctx: isPart });
  assert.equal(sec, '/search/?q=mfa&scope=section&section=identity-platform&space=identity-server&edition=cloud');
  const back = parseSearchPageUrl(sec.split('?')[1], manifest);
  assert.equal(back.scope, 'section');
  assert.deepEqual(back.offered, ['edition', 'section', 'all', 'docspace']);
  assert.equal(buildFilter({ scope: 'section', ctx: back.ctx, manifest }), buildFilter({ scope: 'section', ctx: isPart, manifest }));
  assert.equal(hitTarget({ docSpace: 'identity-server', edition: 'cloud', cloudIn: 'identity-platform', page: '', anchor: '' }, back.ctx, manifest).sameDeployment, false);
  assert.equal(searchPageUrl({ query: 'x', scope: 'all', ctx: sec720 }), '/search/?q=x&scope=all&section=identity-platform&space=identity-server&edition=7.2.0', 'All of WSO2 Docs keeps the section it widens');
  const sandbox = parseSearchPageUrl('q=x&scope=all&space=sandbox&edition=1.0.0', publicManifest(policy, { environment: 'staging' }));
  assert.deepEqual([sandbox.scope, sandbox.offered], ['edition', ['edition', 'docspace']], 'an Unlisted Doc space is never widened, also on the search page');
});

test('the browser picks the search endpoint by host; staging and production collections differ', () => {
  const cfg = searchConfigFromEnv({ WSO2_DOCS_SEARCH_KEY_STAGING: 'stg', WSO2_DOCS_SEARCH_KEY_PRODUCTION: 'prd' });
  assert.equal(pickEnvironment(cfg, 'docs-staging.wso2.com').collection, COLLECTIONS.staging);
  assert.deepEqual(pickEnvironment(cfg, 'wso2-docs-site.tharinduj.workers.dev'), { ...cfg.environments.staging, key: 'stg' }, 'the Pilot\'s staging host');
  assert.equal(pickEnvironment(cfg, 'docs.wso2.com').key, 'prd');
  assert.notEqual(COLLECTIONS.staging, COLLECTIONS.production);
  assert.equal(pickEnvironment(cfg, 'localhost'), null);
  assert.equal(pickEnvironment(searchConfigFromEnv({}), 'docs.wso2.com'), null, 'no key baked in: search shows as unavailable');
  const local = searchConfigFromEnv({ WSO2_DOCS_SEARCH_ENV: 'local', WSO2_DOCS_SEARCH_URL: 'http://localhost:18108' });
  assert.deepEqual(pickEnvironment(local, 'localhost'), { url: 'http://localhost:18108', collection: COLLECTIONS.local, siteHosts: [], key: 'local-preview-search' });
});

test('scoped search keys match the Typesense client library', () => {
  const ts = new Typesense.Client({ nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }], apiKey: 'x' });
  const params = { expires_at: 1900000000 };
  assert.equal(scopedSearchKey('RN23GFr1s6jQ9kgSNg2O7fYcAUXU7127', params), ts.keys().generateScopedSearchKey('RN23GFr1s6jQ9kgSNg2O7fYcAUXU7127', params));
});

test('analytics: popular and no-hit query rules, tagged per deployment', () => {
  const a = analyticsSetup('wso2docs-staging');
  assert.deepEqual(a.rules.map((r) => [r.type, r.params.destination_collection, r.params.meta_fields]), [
    ['popular_queries', 'wso2docs-staging_popular_queries', ['analytics_tag']],
    ['nohits_queries', 'wso2docs-staging_nohits_queries', ['analytics_tag']],
  ]);
});

// An in-memory stand-in for the Typesense calls the pipeline makes.
function fakeTypesense({ failImport = false } = {}) {
  const docs = new Map();
  const calls = [];
  const match = (filter) => {
    const clauses = filter.split(' && ').map((c) => {
      const [, f, op, v] = /^(\w+):(!?=)(.*)$/.exec(c);
      const values = (v.startsWith('[') ? v.slice(1, -1).split(',') : [v]).map((x) => x.replace(/^`|`$/g, ''));
      return { f, op, values };
    });
    return (d) => clauses.every(({ f, op, values }) => (op === '=' ? values.includes(d[f]) : !values.includes(d[f])));
  };
  return {
    docs, calls,
    getCollection: async (name) => ({ name, fields: collectionSchema(name).fields }),
    createCollection: async () => ({}),
    updateCollection: async () => ({}),
    upsertAnalyticsRule: async () => ({}),
    upsertStopwords: async () => ({}),
    async importDocuments(_c, list) {
      calls.push(['import', list.length]);
      if (failImport) throw new Error('1 of 2 documents failed to import');
      for (const d of list) docs.set(d.id, d);
      return { imported: list.length };
    },
    async deleteByFilter(_c, filter) {
      calls.push(['delete', filter]);
      const hit = [...docs.values()].filter(match(filter));
      hit.forEach((d) => docs.delete(d.id));
      return hit.length;
    },
    exportDocuments: async () => [...docs.values()],
  };
}

test('indexing upserts first, then deletes only that Edition\'s stale records', async () => {
  const ts = fakeTypesense();
  const r1 = [rec('7.2.0', 'a/', '', null, 'one'), rec('7.2.0', 'b/', '', null, 'two')];
  await indexDeployment(ts, { collection: 'c', records: r1, meta: meta('7.2.0'), policy, release: 'rel-1' });
  await indexDeployment(ts, { collection: 'c', records: [rec('cloud', 'a/', '', null, 'cloud')], meta: meta('cloud'), policy, release: 'cloud-1' });
  const r = await indexDeployment(ts, { collection: 'c', records: [rec('7.2.0', 'a/', '', null, 'one, updated')], meta: meta('7.2.0'), policy, release: 'rel-2' });
  assert.deepEqual(ts.calls.slice(-2), [['import', 1], ['delete', staleFilter('identity-server', '7.2.0', 'rel-2')]], 'never delete-first');
  assert.equal(r.deleted, 1);
  const left = [...ts.docs.values()].map((d) => `${d.edition}:${d.page}:${d.release}`).sort();
  assert.deepEqual(left, ['7.2.0:a/:rel-2', 'cloud:a/:cloud-1'], 'other Editions are untouched');

  const failing = fakeTypesense({ failImport: true });
  await assert.rejects(indexDeployment(failing, { collection: 'c', records: r1, meta: meta('7.2.0'), policy, release: 'rel-3' }), /failed to import/);
  assert.deepEqual(failing.calls.map((c) => c[0]), ['import'], 'no delete after a failed import');
  await assert.rejects(indexDeployment(ts, { collection: 'c', records: [], meta: meta('7.2.0'), policy, release: 'rel-4' }), /no search records/);
});

test('retries back off, then give up', async () => {
  let n = 0;
  assert.equal(await withRetry(async () => { n += 1; if (n < 3) throw new Error('flaky'); return 'ok'; }, { delayMs: 1 }), 'ok');
  await assert.rejects(withRetry(async () => { throw new Error('down'); }, { attempts: 2, delayMs: 1 }), /down/);
});

// A fake build with search records, published and flipped like a real release.
function fakeBuild(edition, segment, pages) {
  const dir = tmp();
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data));
  };
  const base = `/identity-server/${segment}/`;
  for (const f of ['index.html', '404.html', 'sitemap.xml']) write(f, '<html></html>');
  write('_platform/edition.json', { ...meta(edition), asLatest: segment === 'latest', baseUrl: base });
  write('_platform/pages.json', pages.map((p) => ({ path: p })));
  write('_platform/redirects.json', []);
  write('_platform/search-records.json', pages.map((p) => ({ ...rec(edition, p, '', null, `text of ${p}`), url: `https://docs.wso2.com${base}${p}` })));
  return dir;
}

test('release step: latest twins are skipped, failures are reported (never thrown); the weekly check finds and repairs drift', async () => {
  const storage = new FsStorage(tmp());
  const deployments = [
    { space: 'identity-server', segment: 'latest', edition: '7.3.0', release: '7.3.0-docs.1', pages: ['', 'guides/mfa/'] },
    { space: 'identity-server', segment: '7.3.0', edition: '7.3.0', release: '7.3.0-docs.1', pages: ['', 'guides/mfa/'] },
    { space: 'identity-server', segment: '7.2.0', edition: '7.2.0', release: '7.2.0-docs.1', pages: ['', 'guides/mfa/', 'install/'] },
  ];
  for (const d of deployments) await publishRelease(storage, fakeBuild(d.edition, d.segment, d.pages), { ...d, tag: d.release });
  await flip(storage, { environment: 'staging', policy, deployments });

  const ts = fakeTypesense();
  const r = await indexReleases(ts, storage, { collection: 'c', policy, deployments, delayMs: 1 });
  assert.deepEqual(r.skipped, [{ deployment: 'identity-server/latest', reason: '/latest/ is never indexed' }]);
  assert.deepEqual(r.results.map((x) => [x.deployment, x.imported]), [['identity-server/7.3.0', 2], ['identity-server/7.2.0', 3]]);
  assert.ok(![...ts.docs.values()].some((d) => d.url.includes('/latest/')));

  const missing = await indexReleases(ts, storage, { collection: 'c', policy, deployments: [{ space: 'identity-server', segment: 'cloud', release: 'nope' }], attempts: 2, delayMs: 1 });
  assert.equal(missing.failures.length, 1);
  assert.match(missing.failures[0].error, /no _releases\/identity-server\/cloud\/nope/);

  const clean = await checkConsistency(ts, storage, { collection: 'c', policy });
  assert.equal(clean.ok, true, JSON.stringify(clean));
  // Drift: a page lost its records, a removed page lingers, and an Edition with no deployment.
  const docs = [...ts.docs.values()];
  ts.docs.delete(docs.find((d) => d.edition === '7.2.0' && d.page === 'install/').id);
  const ghost = { ...docs.find((d) => d.edition === '7.3.0'), id: 'ghost', page: 'old-page/' };
  ts.docs.set('ghost', ghost);
  ts.docs.set('orphan', { ...ghost, id: 'orphan', edition: '7.1.0', page: '' });
  const report = await checkConsistency(ts, storage, { collection: 'c', policy });
  assert.equal(report.ok, false);
  const by = Object.fromEntries(report.deployments.map((e) => [e.deployment, e]));
  assert.deepEqual(by['identity-server/7.2.0'].missing, ['install/']);
  assert.deepEqual(by['identity-server/7.3.0'].extra, ['old-page/']);
  assert.deepEqual(report.orphans, [{ docSpace: 'identity-server', edition: '7.1.0', records: 1 }]);
  const fixed = await checkConsistency(ts, storage, { collection: 'c', policy, fix: true });
  assert.equal(fixed.fixed.length, 3);
  assert.equal((await checkConsistency(ts, storage, { collection: 'c', policy })).ok, true);
});

test('search-export copies what the VM gate indexes and checks from, laid out as the bucket; the gate indexes the copy as it would the bucket', async () => {
  const storage = new FsStorage(tmp());
  const deployments = [
    { space: 'identity-server', segment: 'latest', edition: '7.3.0', release: '7.3.0-docs.1', pages: ['', 'guides/mfa/'] },
    { space: 'identity-server', segment: '7.3.0', edition: '7.3.0', release: '7.3.0-docs.1', pages: ['', 'guides/mfa/'] },
    { space: 'identity-server', segment: '7.2.0', edition: '7.2.0', release: '7.2.0-docs.1', pages: ['', 'install/'] },
  ];
  for (const d of deployments) await publishRelease(storage, fakeBuild(d.edition, d.segment, d.pages), { ...d, tag: d.release });
  await flip(storage, { environment: 'staging', policy, deployments });
  await storage.put(COMPOSED_KEY, JSON.stringify(policy));

  const out = tmp();
  const one = await exportSearchInputs(storage, out, { deployments: [deployments[0], deployments[1]] });
  assert.deepEqual(one.deployments, ['identity-server/7.3.0=7.3.0-docs.1'], '/latest/ is never indexed, so never copied');
  const files = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
  assert.deepEqual(files(out), [
    '_platform/composed.json', '_platform/state.json',
    '_releases/identity-server/7.3.0/7.3.0-docs.1/_platform/edition.json',
    '_releases/identity-server/7.3.0/7.3.0-docs.1/_platform/pages.json',
    '_releases/identity-server/7.3.0/7.3.0-docs.1/_platform/search-records.json',
  ].map((f) => f.split('/').join(path.sep)), 'only the three files search reads, never the pages');

  // No list: every live deployment, for the consistency check.
  const all = tmp();
  assert.deepEqual((await exportSearchInputs(storage, all)).deployments, ['identity-server/7.2.0=7.2.0-docs.1', 'identity-server/7.3.0=7.3.0-docs.1']);
  const copy = new FsStorage(all);
  const ts = fakeTypesense();
  const r = await indexReleases(ts, copy, { collection: 'c', policy, deployments: deployments.slice(1), delayMs: 1 });
  assert.deepEqual(r.failures, []);
  assert.equal((await checkConsistency(ts, copy, { collection: 'c', policy })).ok, true);
  await assert.rejects(exportSearchInputs(storage, tmp(), { deployments: [{ space: 'identity-server', segment: '7.1.0', release: 'nope' }] }), /no _releases\/identity-server\/7.1.0\/nope\/_platform\/edition.json/);
});

test('search-setup with a parent key from the environment makes it once and never prints it; search-key scopes from it', async (t) => {
  const { execFile } = await import('node:child_process');
  const ts = await fakeTypesenseServer();
  t.after(ts.close);
  const parent = 'vmparent0123456789abcdef0123456789abcdef';
  const cli = (...args) => new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), ...args], {
      env: { ...process.env, TYPESENSE_URL: ts.url, TYPESENSE_ADMIN_KEY: 'admin', TYPESENSE_SEARCH_PARENT_KEY: parent }, encoding: 'utf8',
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
  for (let i = 0; i < 2; i += 1) {
    const r = await cli('search-setup', '--env', 'staging');
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!`${r.stdout}${r.stderr}`.includes(parent), 'the parent value is never printed');
    assert.match(r.stdout, /search-only parent key \d+ \(vmpa…\) from TYPESENSE_SEARCH_PARENT_KEY/);
  }
  assert.deepEqual(ts.keys.map((k) => k.value), [parent], 'made once, with the value the VM keeps');
  const key = await cli('search-key');
  assert.equal(key.code, 0, key.stderr);
  assert.equal(key.stdout.trim(), scopedSearchKey(parent, {}));
});

test('a family Cloud tree indexes and is checked per group: its own pages and each Cloud part; part pages filed under the family are drift', async () => {
  const storage = new FsStorage(tmp());
  const dir = tmp();
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data));
  };
  const pages = ['', 'get-started/', 'identity-server/', 'identity-server/guides/mfa/'];
  for (const f of ['index.html', '404.html', 'sitemap.xml']) write(f, '<html></html>');
  write('_platform/edition.json', treeMeta);
  write('_platform/pages.json', pages.map((p) => ({ path: p })));
  write('_platform/redirects.json', []);
  write('_platform/search-records.json', pages.map((p) => treeRec(p, '', null, `text of ${p}`)));
  const d = { space: 'identity-platform', segment: 'cloud', edition: 'cloud', release: 'cloud-2026.10.26.1' };
  await publishRelease(storage, dir, { ...d, tag: `identity-platform/${d.release}` });
  await flip(storage, { environment: 'staging', policy, deployments: [d] });
  const ts = fakeTypesense();
  // The old shape (ticket 17): part pages under the family Doc space, from an earlier release.
  ts.docs.set('old', { id: 'old', docSpace: 'identity-platform', edition: 'cloud', page: 'identity-server/guides/mfa/', release: 'cloud-2026.10.20.1', url: 'x' });
  const r = await indexReleases(ts, storage, { collection: 'c', policy, deployments: [d], delayMs: 1 });
  assert.deepEqual(r.results[0].groups, { 'identity-platform/cloud': { imported: 2, deleted: 1 }, 'identity-server/cloud': { imported: 2, deleted: 0 } }, 'the old part records go with the family\'s stale ones');
  assert.deepEqual(ts.calls.filter((c) => c[0] === 'delete').map((c) => c[1]), [staleFilter('identity-platform', 'cloud', d.release), staleFilter('identity-server', 'cloud', d.release)]);
  const clean = await checkConsistency(ts, storage, { collection: 'c', policy });
  assert.equal(clean.ok, true, JSON.stringify(clean));
  assert.deepEqual(clean.deployments.map((e) => [e.deployment, e.records]), [['identity-platform/cloud', 2], ['identity-platform/cloud (identity-server Cloud part)', 2]]);
  // Drift: a part page filed under the family with the live release, as an index from before this change would hold.
  ts.docs.set('misfiled', { id: 'misfiled', docSpace: 'identity-platform', edition: 'cloud', page: 'identity-server/guides/mfa/', release: d.release, url: 'x' });
  const drift = await checkConsistency(ts, storage, { collection: 'c', policy });
  assert.deepEqual(drift.deployments[0].extra, ['identity-server/guides/mfa/']);
  await checkConsistency(ts, storage, { collection: 'c', policy, fix: true });
  assert.equal((await checkConsistency(ts, storage, { collection: 'c', policy })).ok, true);
  assert.ok(![...ts.docs.values()].some((x) => x.docSpace === 'identity-platform' && x.page.startsWith('identity-server/')));
});

test('the weekly check repairs records whose former names differ from the manifest\'s', async () => {
  const storage = new FsStorage(tmp());
  const dir = tmp();
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data));
  };
  const pages = ['', 'identity-server/guides/mfa/'];
  for (const f of ['index.html', '404.html', 'sitemap.xml']) write(f, '<html></html>');
  write('_platform/edition.json', treeMeta);
  write('_platform/pages.json', pages.map((p) => ({ path: p })));
  write('_platform/redirects.json', []);
  write('_platform/search-records.json', pages.map((p) => treeRec(p, '', null, `text of ${p}`)));
  const d = { space: 'identity-platform', segment: 'cloud', edition: 'cloud', release: 'cloud-2026.10.27.1' };
  await publishRelease(storage, dir, { ...d, tag: `identity-platform/${d.release}` });
  await flip(storage, { environment: 'staging', policy, deployments: [d] });
  const ts = fakeTypesense();
  await indexReleases(ts, storage, { collection: 'c', policy, deployments: [d], delayMs: 1 });
  assert.equal((await checkConsistency(ts, storage, { collection: 'c', policy })).ok, true);
  // Records indexed before the manifest named Asgardeo (or before records carried former names).
  for (const doc of ts.docs.values()) delete doc.formerNames;
  const drift = await checkConsistency(ts, storage, { collection: 'c', policy });
  assert.equal(drift.ok, false);
  assert.deepEqual(drift.deployments.map((e) => e.formerNames), [{ expected: ['Asgardeo'], indexed: [] }, { expected: ['Asgardeo'], indexed: [] }]);
  await checkConsistency(ts, storage, { collection: 'c', policy, fix: true });
  assert.equal((await checkConsistency(ts, storage, { collection: 'c', policy })).ok, true);
  assert.ok([...ts.docs.values()].every((x) => x.formerNames?.[0] === 'Asgardeo'));
});

test('release workflows run the search steps and never block on them', () => {
  const wf = (name) => yaml.load(fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8'));
  const release = wf('release.yml');
  const step = (job, name) => release.jobs[job].steps.find((s) => s.name === name);
  const names = release.jobs['finalize-staging'].steps.map((s) => s.name);
  const s6 = step('finalize-staging', 'Staging search index (step 6)');
  assert.ok(names.indexOf('Staging crawl gate (step 5)') < names.indexOf('Staging search index (step 6)'));
  assert.equal(s6['continue-on-error'], true);
  // New releases and, after a withdrawal, the deployments flipped back, through
  // the search host's gate (test/vm-search.test.mjs has the rest).
  assert.match(s6.run, /search-via-gate\.sh index --storage "\$STAGING_STORAGE" --deploy "\$FLIP \$FLIP_BACK"/);
  const s8 = step('promote', 'Production search index (step 8)');
  assert.equal(s8['continue-on-error'], true);
  assert.match(s8.run, /--storage "\$PRODUCTION_STORAGE"/);
  const weekly = wf('search-consistency.yml');
  assert.ok(weekly.on.schedule[0].cron);
  assert.deepEqual(weekly.jobs.check.strategy.matrix.include.map((m) => m.env), ['staging', 'production']);
  assert.match(weekly.jobs.check.steps.at(-1).if, /DOCS_PRODUCTION_ENABLED/);
  const build = wf('build-deployment.yml').jobs.build.steps.find((s) => s.name === 'Build (step 1)');
  assert.ok(build.env.WSO2_DOCS_SEARCH_KEY_STAGING.includes('vars.'), 'browser keys are public variables, not secrets');
});

test('Contribute (unversioned) stays indexed and the Landing deployment is skipped, not failed', async () => {
  const storage = new FsStorage(tmp());
  const unversioned = (docSpace, baseUrl, pages, records) => {
    const dir = tmp();
    const write = (rel, data) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data));
    };
    // A Landing build also writes sitemap-landing.xml (the bucket's /sitemap.xml is the index).
    for (const f of ['index.html', '404.html', 'sitemap.xml', ...(docSpace ? [] : ['sitemap-landing.xml'])]) write(f, '<html></html>');
    write('_platform/edition.json', { docSpace, edition: '_', kind: docSpace ? 'unversioned' : 'landing', asLatest: false, baseUrl });
    write('_platform/pages.json', pages.map((p) => ({ path: p })));
    write('_platform/redirects.json', []);
    if (records) write('_platform/search-records.json', records);
    return dir;
  };
  const contribute = { space: 'contribute', segment: '_', edition: '_', release: 'v1' };
  const landing = { space: '_landing', segment: '_', edition: '_', release: 'l1' };
  await publishRelease(storage, unversioned('contribute', '/contribute/', ['', 'start-here/'], ['', 'start-here/'].map((p) => ({
    url: `https://docs.wso2.com/contribute/${p}`, hierarchy: { lvl0: 'Contribute', lvl1: 'Start here' }, content: `text of ${p}`, docSpace: 'contribute', edition: '_', kind: 'unversioned',
  }))), { ...contribute, tag: 'v1' });
  await publishRelease(storage, unversioned(null, '/', ['', 'search/'], null), { ...landing, tag: 'l1' });
  await flip(storage, { environment: 'staging', policy, deployments: [contribute, landing] });

  const ts = fakeTypesense();
  const r = await indexReleases(ts, storage, { collection: 'c', policy, deployments: [contribute, landing], delayMs: 1 });
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.skipped, [{ deployment: '_landing/_', reason: 'the Landing deployment has no pages to index' }]);
  assert.deepEqual(r.results.map((x) => [x.deployment, x.imported]), [['contribute/_', 2]]);
  const report = await checkConsistency(ts, storage, { collection: 'c', policy });
  assert.deepEqual(report.orphans, [], 'Contribute records are not orphans (a --fix would delete them)');
  assert.equal(report.ok, true, JSON.stringify(report));
});

test('Contribute (Edition "_", a token separator in the index) is searched by Doc space alone', () => {
  const ctx = deploymentContext({ docSpace: 'contribute', edition: '_', asLatest: false });
  assert.equal(buildFilter({ scope: 'edition', ctx, manifest }), '(docSpace:=`contribute`)');
  assert.equal(buildFilter({ scope: 'docspace', ctx, manifest }), '(docSpace:=`contribute`)');
  assert.equal(editionFilter('contribute', '_'), 'docSpace:=`contribute`');
  assert.equal(staleFilter('contribute', '_', 'v2'), 'docSpace:=`contribute` && release:!=`v2`', 'stale Contribute records can be deleted');
  assert.equal(editionFilter('identity-server', '7.3.0'), 'docSpace:=`identity-server` && edition:=`7.3.0`');
  const hit = { docSpace: 'contribute', edition: '_', page: 'reference/checks/', anchor: 'vale' };
  assert.deepEqual(hitTarget(hit, ctx, manifest), { href: '/contribute/reference/checks/#vale', segment: '_', sameDeployment: true });
  assert.equal(hitTarget(hit, deploymentContext({ landing: true }), manifest).href, '/contribute/reference/checks/#vale');
});

// A stand-in Typesense over HTTP: collections (with PATCH), analytics rules,
// stop-word sets and the keys API (GET/POST /keys, DELETE /keys/<id>),
// enough for search-setup.
async function fakeTypesenseServer() {
  const http = await import('node:http');
  const collections = new Map();
  const patches = [];
  const stopwords = new Map();
  const keys = [];
  let nextId = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    const u = new URL(req.url, 'http://x');
    const [, a, b] = u.pathname.split('/');
    if (req.headers['x-typesense-api-key'] !== 'admin') return send(401, { message: 'Forbidden' });
    if (a === 'collections' && req.method === 'GET') return collections.has(b) ? send(200, collections.get(b)) : send(404, { message: 'Not found.' });
    if (a === 'collections' && req.method === 'POST') { const c = JSON.parse(body); collections.set(c.name, c); return send(201, c); }
    if (a === 'collections' && req.method === 'PATCH') {
      const { fields } = JSON.parse(body);
      patches.push({ collection: b, fields });
      const c = collections.get(b);
      for (const f of fields) {
        c.fields = c.fields.filter((x) => x.name !== f.name);
        if (!f.drop) c.fields.push(f);
      }
      return send(200, { fields });
    }
    if (a === 'stopwords' && req.method === 'PUT') { stopwords.set(b, JSON.parse(body)); return send(200, { id: b, ...JSON.parse(body) }); }
    if (a === 'analytics') return send(200, {});
    if (a === 'keys' && req.method === 'GET') return send(200, { keys: keys.map(({ value, ...k }) => ({ ...k, value_prefix: value.slice(0, 4) })) });
    if (a === 'keys' && req.method === 'POST') {
      const spec = JSON.parse(body);
      if (spec.value && keys.some((k) => k.value === spec.value)) return send(409, { message: 'API key generation conflict.' });
      const k = { id: nextId++, expires_at: 64723363199, ...spec, value: spec.value ?? `k${nextId}${'x'.repeat(30)}` };
      keys.push(k);
      return send(201, k);
    }
    if (a === 'keys' && req.method === 'DELETE') {
      const at = keys.findIndex((k) => String(k.id) === b);
      if (at < 0) return send(404, { message: 'Not found.' });
      keys.splice(at, 1);
      return send(200, { id: Number(b) });
    }
    return send(404, { message: `no ${req.method} ${u.pathname}` });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, collections, patches, stopwords, keys, close: () => new Promise((r) => server.close(r)) };
}

test('search-setup reuses its search-only parent key; search-keys lists keys and search-key-delete deletes one', async (t) => {
  const { execFile } = await import('node:child_process');
  const ts = await fakeTypesenseServer();
  t.after(ts.close);
  const cli = (...args) => new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), ...args], { env: { ...process.env, TYPESENSE_URL: ts.url, TYPESENSE_ADMIN_KEY: 'admin' }, encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
  const first = await cli('search-setup', '--env', 'staging');
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /wso2docs-staging: created/);
  const made = /Search-only parent key[^:]*: (\S+)/.exec(first.stdout)?.[1];
  assert.ok(made, first.stdout);
  assert.equal(ts.keys.length, 1);
  // Run again (after a Platform release that adds fields): the same parent key, no new one.
  const again = await cli('search-setup', '--env', 'staging');
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /exists/);
  assert.match(again.stdout, new RegExp(`Reusing search-only parent key ${ts.keys[0].id} \\(${made.slice(0, 4)}…\\)`));
  assert.doesNotMatch(again.stdout, new RegExp(made), 'the value is printed only when the key is made');
  assert.equal(ts.keys.length, 1);
  // A key change asks for a new one explicitly.
  const fresh = await cli('search-setup', '--env', 'staging', '--new-key');
  assert.notEqual(/Search-only parent key[^:]*: (\S+)/.exec(fresh.stdout)?.[1], made);
  assert.equal(ts.keys.length, 2);
  // Another environment's collection gets its own parent.
  await cli('search-setup', '--env', 'production');
  assert.equal(ts.keys.length, 3);

  const list = await cli('search-keys', '--env', 'staging');
  assert.equal(list.code, 0, list.stderr);
  const lines = list.stdout.trim().split('\n');
  assert.equal(lines.length, 1 + 3, list.stdout);
  assert.match(lines[1], new RegExp(`^${ts.keys[0].id}\\s+${made.slice(0, 4)}…\\s+documents:search\\s+wso2docs-staging\\s+never\\s+search-only parent for wso2docs-staging`));
  assert.ok(!list.stdout.includes(made), 'never a full key value');

  const del = await cli('search-key-delete', '--env', 'staging', '--id', String(ts.keys[0].id));
  assert.equal(del.code, 0, del.stderr);
  assert.match(del.stdout, /Deleted key 0 \(.{4}…, documents:search on wso2docs-staging\)/);
  assert.equal(ts.keys.length, 2);
  const missing = await cli('search-key-delete', '--env', 'staging', '--id', '0');
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /No key 0/);
  assert.equal((await cli('search-key-delete', '--env', 'staging')).code, 1, '--id is required');
  // With the old parent gone, setup reuses the newer one.
  assert.match((await cli('search-setup', '--env', 'staging')).stdout, new RegExp(`Reusing search-only parent key ${ts.keys[0].id} `));
});

test('search-setup brings an older collection up to the schema and makes the MCP stop-word set', async (t) => {
  const { execFile } = await import('node:child_process');
  const ts = await fakeTypesenseServer();
  t.after(ts.close);
  const cli = (...args) => new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), ...args], { env: { ...process.env, TYPESENSE_URL: ts.url, TYPESENSE_ADMIN_KEY: 'admin' }, encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
  // A collection from before page was a facet and before selfHosted.
  const old = collectionSchema('wso2docs-staging');
  old.fields = old.fields.filter((f) => f.name !== 'selfHosted').map((f) => (f.name === 'page' ? { name: 'page', type: 'string', facet: false, optional: false } : f));
  ts.collections.set(old.name, old);
  const r = await cli('search-setup', '--env', 'staging');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /wso2docs-staging: exists, added selfHosted, re-added page; analytics rules and stop words in place/);
  assert.deepEqual(ts.patches, [{ collection: 'wso2docs-staging', fields: [
    { name: 'selfHosted', type: 'bool', optional: true },
    { name: 'page', drop: true },
    { name: 'page', type: 'string', facet: true, optional: false },
  ] }], 'one PATCH: new fields optional, a changed field dropped and re-added as it was required');
  assert.deepEqual(ts.stopwords.get(MCP_STOPWORDS_ID), { stopwords: MCP_STOPWORDS, locale: 'en' });
  assert.ok(MCP_STOPWORDS.includes('how') && !MCP_STOPWORDS.includes('mfa'));
  for (const name of ['is', 'it', 'in', 'on']) assert.ok(!MCP_STOPWORDS.includes(name), `"${name}" is also a name (IS, single sign-on)`);
  const again = await cli('search-setup', '--env', 'staging');
  assert.match(again.stdout, /wso2docs-staging: exists; analytics rules and stop words in place/);
  assert.equal(ts.patches.length, 1, 'an up-to-date collection is left as it is');
});

// A collection whose page field isn't a facet yet, and a client that records what changes it.
function staleCollection({ updateCollection, schemaChanges = async () => null } = {}) {
  const old = collectionSchema('c');
  old.fields = old.fields.map((f) => (f.name === 'page' ? { ...f, facet: false } : f));
  const state = { schema: old, updates: [] };
  const client = {
    getCollection: async (n) => (n === 'c' ? state.schema : {}),
    updateCollection: updateCollection ?? (async (n, patch) => { state.updates.push(patch); state.schema = collectionSchema('c'); }),
    schemaChanges,
    upsertAnalyticsRule: async () => ({}),
    upsertStopwords: async () => ({}),
  };
  return { state, client };
}

test('a schema change that outlasts its request is followed until Typesense finishes it', async () => {
  const { ensureCollection } = await import('../lib/search/indexing.mjs');
  const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  let polls = 0;
  const { state, client } = staleCollection({
    // Typesense goes on after the request gives up, and finishes after two polls.
    updateCollection: async () => { setTimeout(() => { state.schema = collectionSchema('c'); }, 0); throw timeout(); },
    schemaChanges: async () => (++polls < 3 ? [{ collection: 'c', validated_docs: 10, altered_docs: 5 }] : null),
  });
  assert.deepEqual((await ensureCollection(client, 'c', { pollMs: 1 })).changed, ['page']);
  assert.equal(polls, 3);

  const stuck = staleCollection({ updateCollection: async () => { throw timeout(); }, schemaChanges: async () => [{ collection: 'c' }] });
  await assert.rejects(ensureCollection(stuck.client, 'c', { waitMs: 5, pollMs: 1 }), /still running after/);
  const lost = staleCollection({ updateCollection: async () => { throw timeout(); } });
  await assert.rejects(ensureCollection(lost.client, 'c', { pollMs: 1 }), /did not finish \(page\)/, 'the schema is checked once Typesense is done');
  const refused = staleCollection({ updateCollection: async () => { throw new Error('Typesense 400: bad field'); } });
  await assert.rejects(ensureCollection(refused.client, 'c'), /bad field/, 'any other error is an error');
});

test('indexing never changes a schema: only search-setup does, and indexing warns', async () => {
  const { ensureCollection } = await import('../lib/search/indexing.mjs');
  const { state, client } = staleCollection();
  const log = [];
  const r = await indexReleases(client, new FsStorage(tmp()), { collection: 'c', policy, deployments: [], log: (m) => log.push(m) });
  assert.deepEqual([state.updates, r.failures], [[], []]);
  assert.deepEqual(log, ['search: c lacks page of the schema; run search-setup']);
  assert.deepEqual(await ensureCollection(client, 'c', { update: false }), { created: false, added: [], changed: [], behind: ['page'] });
  await ensureCollection(client, 'c');
  assert.equal(state.updates.length, 1);
  assert.deepEqual((await ensureCollection(client, 'c', { update: false })).behind, []);
});

test('the local preview\'s fixed search-only key is made once and then reused', async (t) => {
  const ts = await fakeTypesenseServer();
  t.after(ts.close);
  const { typesenseClient } = await import('../lib/search/typesense.mjs');
  const { ensureSearchOnlyKey } = await import('../lib/search/indexing.mjs');
  const client = typesenseClient({ url: ts.url, apiKey: 'admin' });
  const one = await ensureSearchOnlyKey(client, 'wso2docs-local', 'local-preview-search-key');
  assert.equal(one.value, 'local-preview-search-key');
  const two = await ensureSearchOnlyKey(client, 'wso2docs-local', 'local-preview-search-key');
  assert.deepEqual([two.existed, two.value, ts.keys.length], [true, 'local-preview-search-key', 1]);
  assert.deepEqual((await client.listKeys()).map((k) => k.value_prefix), ['loca']);
  assert.equal(await client.deleteKey(99), null, 'an unknown key');
});

test('a storage with no deployment state is an error for the consistency check, never "nothing is live"', async () => {
  // A wrong or empty bucket (no _platform/state.json) once read as "no live
  // deployment", and the repair then deleted every record in the index.
  const storage = new FsStorage(tmp());
  await assert.rejects(() => exportSearchInputs(storage, tmp()), /no deployment state/);
  const client = { exportDocuments: async () => [{ docSpace: 'x', edition: 'cloud', page: 'a', release: 'r' }], deleteDocuments: async () => assert.fail('nothing may be deleted') };
  await assert.rejects(() => checkConsistency(client, storage, { collection: 'c', policy: { docSpaces: {} }, fix: true }), /no live deployment/);
});
