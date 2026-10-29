// The chrome's navigation rules (lib/switching.mjs), through the seven
// walkthroughs of the version-switching prototype (wso2docs branch
// prototype/version-switching-two-selectors) on a slice of a merged
// Deployment manifest in the published shape, then the products menu, the
// section menu, the Landing page and the live-manifest rules on the Pilot's
// own manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAPPING_HINTS, arrivalBanner, choose, editionLabel, editionList, focus, headerSelector, homeUrl, isArrival, landingGroups,
  latestOf, mapPage, menu, mergeManifest, normaliseDeployment, opensUrl, permanentUrl, productLabel, productsMenu,
  rememberSection, sectionFor, spaceOf, toView, versionNotice, viewUrl,
} from '../lib/switching.mjs';
import { loadPolicy, publicManifest } from '../lib/manifest.mjs';

// ---- The prototype's slice, in the published manifest's shape ------------------

const legacy = (id, url) => ({ id, status: 'legacy', legacyUrl: url });
const live = (...ids) => ids.map((id) => ({ id, status: 'live' }));
const M = {
  families: ['Agent Platform', 'API Platform', 'Identity Platform'],
  docSpaces: {
    'identity-platform': { displayName: 'Identity Platform Cloud', family: 'Identity Platform', model: 'cloud-only', latest: 'cloud', home: 'identity-platform', editions: [{ id: 'cloud', status: 'live', parts: ['identity-server'] }] },
    'identity-server': {
      displayName: 'Identity Server', brand: 'Asgardeo', family: 'Identity Platform', model: 'versions-only', latest: '7.3.0', home: 'identity-platform', cloud: { in: 'identity-platform' },
      editionNames: { selfHosted: 'Identity Server {version}' }, editions: [...live('7.3.0', '7.2.0'), legacy('7.1.0', 'https://is.docs.wso2.com/en/7.1.0/')],
    },
    'api-platform': { displayName: 'API Platform Cloud', family: 'API Platform', model: 'cloud-only', latest: 'cloud', home: 'api-platform', editions: [{ id: 'cloud', status: 'live', parts: ['api-gateway', 'ai-gateway', 'ai-workspace'] }] },
    'api-manager': { displayName: 'API Manager', family: 'API Platform', model: 'versions-only', latest: '4.7.0', home: 'api-platform', editions: [...live('4.7.0', '4.6.0'), legacy('4.5.0', 'https://apim.docs.wso2.com/en/4.5.0/')] },
    'api-gateway': { displayName: 'API Gateway', family: 'API Platform', model: 'versions-only', latest: '1.2.0', home: 'api-platform', cloud: { in: 'api-platform' }, editions: live('1.2.0', '1.1.0') },
    'ai-gateway': { displayName: 'AI Gateway', family: 'API Platform', model: 'versions-only', latest: '1.2.0', home: 'api-platform', cloud: { in: 'api-platform' }, editions: live('1.2.0', '2026.09.24', '1.1.0') },
    'ai-workspace': { displayName: 'AI Workspace', family: 'API Platform', model: 'versions-only', latest: '0.9.0', home: 'api-platform', cloud: { in: 'api-platform' }, editions: live('0.9.0', '0.8.0') },
    'agent-manager': { displayName: 'Agent Manager', family: 'Agent Platform', model: 'cloud-plus-versions', latest: '1.0.0', home: 'agent-platform', editions: live('cloud', '1.0.0') },
    contribute: { displayName: 'Contribute', family: null, model: 'unversioned', latest: null, listed: false, home: null, editions: [] },
  },
  sections: {
    'identity-platform': {
      title: 'Identity Platform Documentation', family: 'Identity Platform',
      menu: [{ docSpace: 'identity-platform', versionIn: 'header' }, { docSpace: 'identity-server', versionIn: 'menu' }],
      products: [{ label: 'Identity Server', opens: { docSpace: 'identity-server' } }],
    },
    'api-platform': {
      title: 'API Platform Documentation', family: 'API Platform',
      menu: [{ docSpace: 'api-platform', versionIn: 'header' }, { docSpace: 'api-manager', versionIn: 'header' }, { docSpace: 'api-gateway', versionIn: 'menu' }, { docSpace: 'ai-gateway', versionIn: 'menu' }, { docSpace: 'ai-workspace', versionIn: 'menu' }],
      products: ['api-manager', 'api-gateway', 'ai-gateway', 'ai-workspace'].map((d) => ({ label: d, opens: { docSpace: d } })),
    },
    'agent-platform': {
      title: 'Agent Platform Documentation', family: 'Agent Platform',
      menu: [{ docSpace: 'agent-manager', versionIn: 'menu' }, { docSpace: 'ai-gateway', versionIn: 'menu' }],
      products: [{ label: 'Agent Manager', opens: { docSpace: 'agent-manager' } }, { label: 'AI Gateway', opens: { docSpace: 'ai-gateway' } }],
    },
  },
};
// Each deployment's page list and redirects, relative to its base (a family
// Cloud tree holds its parts under <part>/).
const dep = (pages, redirects = {}) => ({ pages: new Set(pages), redirects });
const D = {
  'identity-platform@cloud': dep(['', 'get-started/', 'identity-server/', 'identity-server/get-started/', 'identity-server/guides/mfa/', 'identity-server/guides/passkeys/'], { 'identity-server/guides/multi-factor/': 'identity-server/guides/mfa/' }),
  'identity-server@7.3.0': dep(['', 'get-started/', 'guides/mfa/', 'deploy/clustering/'], { 'guides/multi-factor/': 'guides/mfa/' }),
  'identity-server@7.2.0': dep(['', 'get-started/', 'guides/multi-factor/', 'deploy/clustering/']),
  'api-platform@cloud': dep(['', 'get-started/', 'api-gateway/', 'api-gateway/policies/', 'ai-gateway/', 'ai-gateway/guardrails/', 'ai-gateway/semantic-cache/', 'ai-workspace/', 'ai-workspace/prompts/']),
  'api-manager@4.7.0': dep(['', 'get-started/', 'deploy/']),
  'api-manager@4.6.0': dep(['', 'get-started/', 'deploy/']),
  'api-gateway@1.2.0': dep(['', 'policies/', 'deploy/']),
  'api-gateway@1.1.0': dep(['', 'policies/', 'deploy/']),
  'ai-gateway@1.2.0': dep(['', 'guardrails/', 'deploy/']),
  'ai-gateway@2026.09.24': dep(['', 'guardrails/', 'deploy/']),
  'ai-gateway@1.1.0': dep(['', 'deploy/']),
  'ai-workspace@0.9.0': dep(['', 'prompts/']),
  'ai-workspace@0.8.0': dep(['']),
};

function toViewFromUrl(u) {
  const [, space, edition, ...rest] = u.split('/');
  return { space, edition, path: rest.join('/') };
}
// The prototype's reducer, on the library: what the chrome does per step.
function reader() {
  const s = { view: null, section: null, sections: {}, remembered: {}, notice: null, banner: null, opened: [] };
  const go = (view) => { s.view = view; s.section = sectionFor(M, view, s.sections); };
  return {
    s,
    url: () => viewUrl(M, s.view),
    openProduct(section, doc) {
      s.sections = rememberSection(s.sections, doc, section);
      go(toView(M, doc, latestOf(spaceOf(M, doc)), ''));
      s.notice = null;
    },
    openPage(path) { go({ ...s.view, path }); s.notice = null; },
    pick(doc, edition) {
      const r = choose(M, D, s.view, doc, edition);
      if (r.kind === 'legacy') { s.opened.push(r.url); return r; }
      if (r.remember) s.remembered[doc] = r.remember;
      if (!r.noop) go(r.view);
      s.notice = r.notice;
      return r;
    },
    arrive(space, edition, path) {
      s.sections = {}; // an arrival from search shows the home section
      go({ space, edition, path });
      s.notice = null;
      s.banner = arrivalBanner(M, D, s.view, s.remembered[focus(M, s.view).doc]);
    },
    acceptBanner() { const b = s.banner; s.banner = null; go(toViewFromUrl(b.url)); s.remembered[b.doc] = b.edition; },
    header: () => headerSelector(M, D, s.view),
    menu: () => menu(M, s.view, s.section),
    entry: (slug) => menu(M, s.view, s.section).entries.find((e) => e.slug === slug),
    notice: () => versionNotice(M, s.view),
  };
}
const ids = (sel) => sel.items.map((i) => i.id);

test('walkthrough 1, Cloud first: same page, renamed page, missing page', () => {
  const r = reader();
  r.openProduct('identity-platform', 'identity-server');
  assert.equal(r.url(), '/identity-platform/cloud/identity-server/', 'Identity Server opens on Cloud, its part in Identity Platform Cloud');
  assert.equal(productLabel(M, r.s.view), 'Identity Server');
  const h = r.header();
  assert.equal(h.doc, 'identity-server');
  assert.deepEqual(h.groups.map((g) => [g.label, g.items.map((i) => i.label)]), [
    ['Cloud', ['Cloud (Asgardeo)']],
    ['Self-hosted', ['Identity Server 7.3.0 (newest release)', 'Identity Server 7.2.0']],
    ['Older versions (old site)', ['Identity Server 7.1.0 ↗']],
  ]);
  assert.equal(r.notice().text, 'You\'re reading Identity Server Cloud. The newest release is Identity Server 7.3.0.', 'a shared page makes no newest-features claim');
  assert.equal(versionNotice(M, r.s.view, { cloudContent: true }).text, 'Cloud has the newest features. Some may not be in a release yet; the newest release is Identity Server 7.3.0.', 'a page with Cloud-only content');
  r.openPage('identity-server/guides/mfa/');
  assert.deepEqual(r.header().items.map((i) => i.mapping), ['current', 'same', 'renamed', 'old site']);
  r.pick('identity-server', '7.3.0');
  assert.equal(r.url(), '/identity-server/7.3.0/guides/mfa/');
  assert.equal(r.s.notice, null);
  assert.equal(r.notice(), null, 'the newest release shows no notice');
  r.pick('identity-server', '7.2.0');
  assert.equal(r.url(), '/identity-server/7.2.0/guides/multi-factor/', 'renamed: the source\'s redirects inverted');
  assert.equal(r.s.notice, 'This page has a different name in Identity Server 7.2.0.');
  assert.equal(r.notice().text, "You're reading Identity Server 7.2.0. The newest release is 7.3.0, and Cloud has the newest features.");
  r.pick('identity-server', 'cloud');
  assert.equal(r.url(), '/identity-platform/cloud/identity-server/guides/mfa/', 'renamed: the tree\'s own redirects');
  r.openPage('identity-server/guides/passkeys/');
  assert.equal(r.header().items.find((i) => i.id === '7.3.0').mapping, 'missing');
  r.pick('identity-server', '7.3.0');
  assert.equal(r.url(), '/identity-server/7.3.0/');
  assert.equal(r.s.notice, "This page isn't in Identity Server 7.3.0. You're on its home page instead.");
});

test('walkthrough 2, header and menu in step: a component opens on its Cloud part, both selectors show one value', () => {
  const r = reader();
  r.openProduct('api-platform', 'api-gateway');
  assert.equal(r.url(), '/api-platform/cloud/api-gateway/');
  const inStep = (value) => {
    assert.equal(r.header().value, value, 'header');
    assert.equal(r.entry('api-gateway').dropdown.value, value, 'menu dropdown');
    assert.equal(r.entry('api-gateway').active, true);
  };
  inStep('cloud');
  assert.equal(r.entry('api-platform').open, true, 'the Cloud tree serving the page is open');
  assert.equal(r.entry('api-gateway').open, false, 'the component\'s entry stays one line');
  r.pick('api-gateway', '1.2.0');
  assert.equal(r.url(), '/api-gateway/1.2.0/');
  inStep('1.2.0');
  assert.equal(r.entry('api-gateway').open, true);
  assert.equal(r.entry('api-platform').open, false);
  r.openPage('policies/');
  r.pick('api-gateway', '1.1.0');
  assert.equal(r.url(), '/api-gateway/1.1.0/policies/');
  inStep('1.1.0');
  r.pick('api-gateway', 'cloud');
  assert.equal(r.url(), '/api-platform/cloud/api-gateway/policies/');
  inStep('cloud');
});

test('a component whose Cloud part is not deployed yet opens on its newest release, and its selector lists no Cloud', () => {
  const m = structuredClone(M);
  m.docSpaces['api-gateway'].cloudPartPending = true;
  const gw = m.docSpaces['api-gateway'];
  assert.equal(latestOf(gw), '1.2.0');
  assert.deepEqual(editionList(gw), ['1.2.0', '1.1.0']);
  assert.equal(opensUrl(m, { docSpace: 'api-gateway' }), '/api-gateway/latest/');
  assert.equal(editionLabel(gw, '1.2.0'), 'API Gateway 1.2.0 (latest)');
  const view = { space: 'api-gateway', edition: '1.2.0', path: '' };
  assert.deepEqual(headerSelector(m, {}, view).items.map((i) => i.id), ['1.2.0', '1.1.0']);
  // Once it is deployed, the Cloud part again.
  assert.equal(opensUrl(M, { docSpace: 'api-gateway' }), '/api-platform/cloud/api-gateway/');
});

test('walkthrough 3, another product\'s dropdown: opens its home page at that version, remembered', () => {
  const r = reader();
  r.openProduct('api-platform', 'api-gateway');
  r.pick('api-gateway', '1.2.0');
  r.openPage('policies/');
  assert.equal(r.entry('ai-workspace').dropdown.value, 'cloud', 'a non-open entry shows its latest');
  const c = r.pick('ai-workspace', '0.8.0');
  assert.equal(c.kind, 'other');
  assert.equal(r.url(), '/ai-workspace/0.8.0/', 'no same-page mapping');
  assert.equal(r.s.remembered['ai-workspace'], '0.8.0');
  assert.equal(r.s.notice, null);
});

test('walkthrough 4, a Cloud part: the header acts for the component, versions in manifest order', () => {
  const r = reader();
  r.openProduct('api-platform', 'ai-gateway');
  assert.equal(r.url(), '/api-platform/cloud/ai-gateway/');
  assert.equal(productLabel(M, r.s.view), 'AI Gateway', 'not "API Platform Cloud"');
  assert.deepEqual(ids(r.header()), ['cloud', '1.2.0', '2026.09.24', '1.1.0'], 'manifest order: a date version is never sorted first');
  assert.equal(r.header().items[1].label, 'AI Gateway 1.2.0 (newest release)');
  assert.equal(r.entry('ai-gateway').dropdown.value, 'cloud');
  assert.equal(r.entry('api-platform').open, true, 'the platform entry is open, with the part inside');
  r.openPage('ai-gateway/guardrails/');
  r.pick('ai-gateway', '1.2.0');
  assert.equal(r.url(), '/ai-gateway/1.2.0/guardrails/', 'same page');
  r.pick('ai-gateway', '2026.09.24');
  assert.equal(r.url(), '/ai-gateway/2026.09.24/guardrails/');
  r.pick('ai-gateway', 'cloud');
  assert.equal(r.url(), '/api-platform/cloud/ai-gateway/guardrails/', 'and back into the tree');
  r.openPage('ai-gateway/semantic-cache/');
  r.pick('ai-gateway', '1.2.0');
  assert.equal(r.url(), '/ai-gateway/1.2.0/');
  assert.equal(r.s.notice, "This page isn't in AI Gateway 1.2.0. You're on its home page instead.");
  // Missing on the Cloud side lands on the part's home, not the tree's.
  r.openPage('deploy/');
  r.pick('ai-gateway', 'cloud');
  assert.equal(r.url(), '/api-platform/cloud/ai-gateway/');
});

test('walkthrough 5, borrowed by Agent Platform: the section stays while switching; arriving from search shows the home section', () => {
  const r = reader();
  r.openProduct('agent-platform', 'ai-gateway');
  assert.equal(r.s.section, 'agent-platform');
  assert.equal(r.menu().title, 'Agent Platform Documentation');
  const e = r.entry('ai-gateway');
  assert.equal(e.borrowed, true);
  assert.equal(e.homeTitle, 'API Platform Documentation');
  assert.equal(e.open, true, 'the platform is not listed here, so the component\'s entry shows its part');
  assert.equal(e.onlyPart, 'ai-gateway');
  r.openPage('ai-gateway/guardrails/');
  r.pick('ai-gateway', '1.2.0');
  assert.equal(r.url(), '/ai-gateway/1.2.0/guardrails/');
  assert.equal(r.s.section, 'agent-platform', 'kept for the session');
  assert.equal(r.entry('ai-gateway').onlyPart, null);
  r.arrive('ai-gateway', '1.2.0', 'guardrails/');
  assert.equal(r.s.section, 'api-platform');
});

test('walkthrough 6, remembered choice: a banner on arrival, never a redirect', () => {
  const r = reader();
  r.openProduct('identity-platform', 'identity-server');
  r.pick('identity-server', '7.2.0');
  assert.equal(r.s.remembered['identity-server'], '7.2.0');
  r.arrive('identity-platform', 'cloud', 'identity-server/guides/mfa/');
  assert.equal(r.url(), '/identity-platform/cloud/identity-server/guides/mfa/', 'stays where it arrived');
  assert.deepEqual(r.s.banner, { doc: 'identity-server', edition: '7.2.0', url: '/identity-server/7.2.0/guides/multi-factor/', text: 'You usually read Identity Server 7.2.0. Open this page there?', action: 'Open it there' });
  r.acceptBanner();
  assert.equal(r.url(), '/identity-server/7.2.0/guides/multi-factor/');
  // Only where the remembered Edition has the page.
  assert.equal(arrivalBanner(M, D, { space: 'identity-platform', edition: 'cloud', path: 'identity-server/guides/passkeys/' }, '7.2.0'), null);
  assert.equal(arrivalBanner(M, D, { space: 'identity-server', edition: '7.3.0', path: '' }, 'latest'), null);
  assert.equal(arrivalBanner(M, D, { space: 'identity-server', edition: '7.3.0', path: '' }, '7.1.0'), null, 'never a Legacy version');
});

test('walkthrough 7, older version: a Legacy version opens its old site and leaves the page', () => {
  const r = reader();
  r.openProduct('api-platform', 'api-manager');
  assert.equal(r.url(), '/api-manager/4.7.0/');
  assert.equal(opensUrl(M, { docSpace: 'api-manager' }), '/api-manager/latest/', 'the products menu opens /latest/');
  assert.deepEqual(r.header().groups.map((g) => g.label), ['Self-hosted', 'Older versions (old site)']);
  assert.equal(r.header().items[0].label, 'API Manager 4.7.0 (latest)', 'no Cloud: "(latest)"');
  const c = r.pick('api-manager', '4.5.0');
  assert.deepEqual(c, { kind: 'legacy', url: 'https://apim.docs.wso2.com/en/4.5.0/', external: true, remember: null, notice: null });
  assert.equal(r.url(), '/api-manager/4.7.0/');
  assert.deepEqual(r.s.opened, ['https://apim.docs.wso2.com/en/4.5.0/']);
});

test('before the page lists load: items lead to home pages and the switch says it could not check', () => {
  const view = { space: 'identity-server', edition: '7.3.0', path: 'guides/mfa/' };
  const h = headerSelector(M, {}, view);
  assert.deepEqual(h.items.map((i) => [i.id, i.mapping, i.href]), [
    ['cloud', 'unknown', '/identity-platform/cloud/identity-server/'],
    ['7.3.0', 'current', '/identity-server/7.3.0/guides/mfa/'],
    ['7.2.0', 'unknown', '/identity-server/7.2.0/'],
    ['7.1.0', 'old site', 'https://is.docs.wso2.com/en/7.1.0/'],
  ]);
  assert.equal(headerSelector(M, {}, view, { asLatest: true }).items[1].href, '/identity-server/latest/guides/mfa/', 'the current item keeps /latest/');
  assert.match(choose(M, {}, view, 'identity-server', 'cloud').notice, /couldn't check/);
  assert.equal(choose(M, {}, view, 'identity-server', '7.3.0', { asLatest: true }).remember, 'latest', 'choosing the newest on /latest/ follows latest');
});

test('labels: Cloud with or without a brand, "(newest release)" or "(latest)", Editions the manifest lacks', () => {
  assert.equal(editionLabel(M.docSpaces['agent-manager'], 'cloud'), 'Cloud');
  assert.equal(editionLabel(M.docSpaces['agent-manager'], '1.0.0'), 'Agent Manager 1.0.0 (newest release)');
  assert.deepEqual(editionList(M.docSpaces['identity-server']), ['cloud', '7.3.0', '7.2.0'], 'a component lists its Cloud part first');
  assert.equal(headerSelector(M, {}, { space: 'api-manager', edition: 'next', path: '' }).items[0].current, true);
  assert.equal(headerSelector(M, {}, { space: 'contribute', edition: '_', path: '' }), null, 'unversioned: no selector');
  const one = headerSelector(M, {}, { space: 'api-platform', edition: 'cloud', path: '' });
  assert.deepEqual(ids(one), ['cloud'], 'a family Cloud\'s own pages: the selector is still shown, with Cloud');
  assert.equal(versionNotice(M, { space: 'api-platform', edition: 'cloud', path: '' }), null, 'a Cloud-only Doc space has no newest release to mention');
  const eol = { ...M, docSpaces: { ...M.docSpaces, 'api-manager': { ...M.docSpaces['api-manager'], editions: [...live('4.7.0'), { id: '4.6.0', status: 'end-of-life' }] } } };
  assert.deepEqual(versionNotice(eol, { space: 'api-manager', edition: '4.6.0', path: '' }), { kind: 'eol', text: 'API Manager 4.6.0 has reached end of life. It is no longer updated.' });
  assert.equal(headerSelector(eol, {}, { space: 'api-manager', edition: '4.7.0', path: '' }).items[1].eol, true);
});

test('mapPage follows redirects across a Cloud tree and the component\'s own Doc space', () => {
  const from = { space: 'identity-server', edition: '7.2.0', path: 'guides/multi-factor/', prefix: '' };
  const to = { space: 'identity-platform', edition: 'cloud', path: 'identity-server/guides/multi-factor/', prefix: 'identity-server/' };
  assert.deepEqual(mapPage(D, from, to), { kind: 'renamed', view: { ...to, path: 'identity-server/guides/mfa/' } });
  assert.equal(mapPage({}, from, to).kind, 'unknown');
  assert.equal(mapPage({}, from, to).view.path, 'identity-server/', 'unknown or missing: the part\'s home');
});

test('mapPage maps a Self-hosted-only page and the Cloud page it names (cloudCounterpart) to each other', () => {
  const pages = normaliseDeployment(
    [{ path: '' }, { path: 'guides/mfa/' }, { path: 'deploy/licensing/', cloudCounterpart: 'guides/billing/' }],
    [],
    '/identity-server/7.3.0/',
  );
  assert.deepEqual(pages.counterparts, { 'deploy/licensing/': 'guides/billing/' });
  const deps = { ...D, 'identity-server@7.3.0': pages, 'identity-platform@cloud': dep(['', 'identity-server/', 'identity-server/guides/billing/']) };
  const self = { space: 'identity-server', edition: '7.3.0', path: 'deploy/licensing/', prefix: '' };
  const cloud = { space: 'identity-platform', edition: 'cloud', path: 'identity-server/deploy/licensing/', prefix: 'identity-server/' };
  assert.deepEqual(mapPage(deps, self, cloud), { kind: 'counterpart', view: { ...cloud, path: 'identity-server/guides/billing/' } });
  const back = mapPage(deps, { ...cloud, path: 'identity-server/guides/billing/' }, { ...self, path: 'guides/billing/' });
  assert.deepEqual(back, { kind: 'counterpart', view: { ...self, path: 'deploy/licensing/' } });
  const chosen = choose(M, deps, { space: 'identity-platform', edition: 'cloud', path: 'identity-server/guides/billing/' }, 'identity-server', '7.3.0');
  assert.deepEqual([chosen.kind, chosen.url, chosen.notice], ['counterpart', '/identity-server/7.3.0/deploy/licensing/', null]);
  assert.equal(MAPPING_HINTS.counterpart, 'matching page');
});

test('section menu: home section, the session\'s section, other Doc spaces collapsed with their latest', () => {
  const view = { space: 'api-manager', edition: '4.6.0', path: 'deploy/' };
  assert.equal(sectionFor(M, view), 'api-platform');
  assert.equal(sectionFor(M, view, { 'api-manager': 'agent-platform' }), 'api-platform', 'a remembered section that does not list it is ignored');
  assert.equal(sectionFor(M, { space: 'contribute', edition: '_', path: '' }), null);
  const m = menu(M, view, 'api-platform');
  assert.equal(m.name, 'API Platform');
  assert.deepEqual(m.entries.map((e) => [e.slug, e.open, e.active, e.dropdown?.value ?? null, e.href]), [
    ['api-platform', false, false, null, '/api-platform/cloud/'],
    ['api-manager', true, true, null, '/api-manager/4.6.0/'],
    ['api-gateway', false, false, 'cloud', '/api-platform/cloud/api-gateway/'],
    ['ai-gateway', false, false, 'cloud', '/api-platform/cloud/ai-gateway/'],
    ['ai-workspace', false, false, 'cloud', '/api-platform/cloud/ai-workspace/'],
  ]);
  assert.deepEqual(m.entries[3].dropdown.items.map((i) => [i.label, i.href]), [
    ['Cloud', '/api-platform/cloud/ai-gateway/'], ['1.2.0', '/ai-gateway/1.2.0/'], ['2026.09.24', '/ai-gateway/2026.09.24/'], ['1.1.0', '/ai-gateway/1.1.0/'],
  ]);
});

test('_platform files normalise to paths relative to the deployment; permanent links are pinned', () => {
  const d = normaliseDeployment(
    [{ path: '' }, { path: 'guides/mfa/' }],
    [
      { from: '/identity-server/latest/guides/multi-factor-auth/', to: '/identity-server/latest/guides/mfa/', status: 301 },
      { from: 'https://is.docs.wso2.com/en/7.3.0/guides/authentication/mfa/', to: '/identity-server/latest/guides/mfa/', status: 301 },
    ],
    '/identity-server/latest/',
  );
  assert.deepEqual([...d.pages], ['', 'guides/mfa/']);
  assert.deepEqual(d.redirects, { 'guides/multi-factor-auth/': 'guides/mfa/' });
  assert.equal(permanentUrl('https://docs.wso2.com', M, { space: 'identity-server', edition: '7.3.0', path: 'guides/mfa/' }, '#totp'), 'https://docs.wso2.com/identity-server/7.3.0/guides/mfa/#totp');
  assert.equal(homeUrl(M, 'ai-gateway', 'cloud'), '/api-platform/cloud/ai-gateway/');
});

test('arrival: a referrer from another host (or none) shows the home section; moving on this host keeps it', () => {
  assert.equal(isArrival('', 'https://docs.wso2.com'), true);
  assert.equal(isArrival('https://www.google.com/', 'https://docs.wso2.com'), true);
  assert.equal(isArrival('https://docs.wso2.com/api-platform/cloud/', 'https://docs.wso2.com'), false);
  assert.equal(isArrival('not a url', 'https://docs.wso2.com'), true);
  assert.deepEqual(rememberSection({ a: 'x' }, 'ai-gateway', 'agent-platform'), { a: 'x', 'ai-gateway': 'agent-platform' });
});

// ---- The Pilot's own manifest ------------------------------------------------------

const pilot = () => publicManifest(loadPolicy(), { environment: 'production' });

test('products menu: the families, then Solutions and Other; each family\'s Cloud first, then its products, then old sites', () => {
  const g = productsMenu(pilot());
  assert.deepEqual(g.map((x) => x.name), ['Agent Platform', 'API Platform', 'Integration Platform', 'Identity Platform', 'Engineering Platform', 'Solutions', 'Other']);
  const api = g.find((x) => x.id === 'api-platform');
  assert.deepEqual(api.entries.map((e) => [e.kind, e.label, e.href]), [
    ['cloud', 'API Platform Cloud', '/api-platform/cloud/'],
    ['product', 'API Manager', '/api-manager/latest/'],
    ['product', 'API Gateway', '/api-platform/cloud/api-gateway/'],
    ['product', 'AI Gateway', '/api-platform/cloud/ai-gateway/'],
    ['page', 'Monetization', '/api-platform/cloud/guides/monetization/'],
    ['legacy', 'API Portal & MCP Hub', 'https://wso2.com/api-platform/docs/api-portal/1.0.0/'],
    ['legacy', 'AI Workspace', 'https://wso2.com/api-platform/docs/ai-workspace/1.0.0/'],
  ]);
  const ip = g.find((x) => x.id === 'identity-platform');
  assert.deepEqual(ip.entries.map((e) => [e.label, e.href, e.section]), [
    ['Identity Platform Cloud', '/identity-platform/cloud/', 'identity-platform'],
    ['Identity Server', '/identity-platform/cloud/identity-server/', 'identity-platform'],
    ['Security Token Service', '/identity-platform/cloud/', 'identity-platform'],
  ]);
  const agent = g.find((x) => x.id === 'agent-platform');
  assert.deepEqual(agent.entries.map((e) => [e.kind, e.label, e.href, e.external]), [
    ['legacy', 'Agent Platform Cloud', 'https://wso2.com/agent-platform/docs/cloud/', true],
    ['legacy', 'Agent Manager', 'https://wso2.com/agent-platform/docs/', true],
  ], 'the family Cloud first, then its product, each on its old site');
  // Integration Platform: its Cloud, its products, then the old Integrator sites and Ballerina as links out.
  const integration = g.find((x) => x.id === 'integration-platform');
  assert.deepEqual(integration.entries.map((e) => [e.label, e.linksOut]), [
    ['Integration Platform Cloud', false], ['Integrator', false], ['Integration Control Plane', false], ['Connectors', false],
    ['Micro Integrator', true], ['Streaming Integrator', true], ['Ballerina Integrator', true], ['Enterprise Integrator', true], ['Ballerina', true],
  ]);
  assert.deepEqual(g.find((x) => x.id === 'engineering-platform').entries.map((e) => [e.docSpace, e.linksOut]), [['engineering-platform', false], ['openchoreo', true]]);
  assert.deepEqual(g.find((x) => x.id === 'other').entries.map((e) => e.docSpace), ['updates', 'platform-security'], 'no Support and lifecycle entry');
  const all = g.flatMap((x) => x.entries);
  assert.ok(!all.some((e) => e.docSpace === 'contribute' || e.docSpace === 'sandbox'), 'Contribute and Unlisted Doc spaces are in no group');
  assert.equal(all.find((e) => e.docSpace === 'ballerina').linksOut, true);
  for (const x of g) assert.ok(x.description, `${x.name} has a short description`);
});

test('products menu: the button and the current entry follow the product being read', () => {
  const m = pilot();
  const current = (view) => productsMenu(m, view).flatMap((x) => x.entries).filter((e) => e.current).map((e) => e.label);
  const part = { space: 'api-platform', edition: 'cloud', path: 'ai-gateway/guides/guardrails/' };
  assert.equal(productLabel(m, part), 'AI Gateway');
  assert.deepEqual(current(part), ['AI Gateway']);
  assert.equal(productLabel(m, { space: 'api-platform', edition: 'cloud', path: 'get-started/' }), 'API Platform Cloud');
  assert.deepEqual(current({ space: 'identity-platform', edition: 'cloud', path: '' }), ['Identity Platform Cloud'], 'one current entry, though Security Token Service opens there too');
  assert.deepEqual(current({ space: 'identity-server', edition: '7.2.0', path: 'guides/' }), ['Identity Server']);
  assert.equal(productLabel(m, null), 'Products');
});

test('products menu keeps link entries (↗) and works from an older manifest without productsMenu', () => {
  const m = {
    families: ['Integration Platform'],
    docSpaces: { integrator: { displayName: 'Integrator', family: 'Integration Platform', model: 'versions-only', latest: '5.1.0', home: 'integration-platform', editions: live('5.1.0', '5.0.0') } },
    sections: {
      'integration-platform': {
        title: 'Integration Platform Documentation', family: 'Integration Platform',
        menu: [{ docSpace: 'integrator', versionIn: 'menu' }, { label: 'Ballerina', url: 'https://ballerina.io/' }],
        products: [{ label: 'Integrator', opens: { docSpace: 'integrator' } }],
      },
    },
  };
  const [group] = productsMenu(m);
  assert.deepEqual(group.entries.map((e) => [e.label, e.href, e.external]), [['Integrator', '/integrator/latest/', false], ['Ballerina', 'https://ballerina.io/', true]]);
});

test('Landing: the same groups in the same order, with each family\'s description and Cloud / Self-hosted links', () => {
  const m = pilot();
  const l = landingGroups(m);
  const p = productsMenu(m);
  assert.deepEqual(l.map((x) => x.name), p.map((x) => x.name), 'one list for both');
  l.forEach((x, i) => assert.deepEqual(x.entries.map((e) => e.label), p[i].entries.map((e) => e.label)));
  const e = Object.fromEntries(l.flatMap((x) => x.entries).map((x) => [x.label, x.editions]));
  assert.deepEqual(e['Identity Server'], [{ label: 'Cloud', href: '/identity-platform/cloud/identity-server/' }, { label: 'Self-hosted', href: '/identity-server/latest/' }]);
  assert.deepEqual(e['AI Gateway'], [{ label: 'Cloud', href: '/api-platform/cloud/ai-gateway/' }, { label: 'Self-hosted', href: '/ai-gateway/latest/' }]);
  assert.deepEqual(e['API Manager'], [{ label: 'Self-hosted', href: '/api-manager/latest/' }]);
  assert.deepEqual(e['Identity Platform Cloud'], [{ label: 'Cloud', href: '/identity-platform/cloud/' }]);
  assert.deepEqual(e.Monetization, []);
  assert.ok(l.find((x) => x.id === 'identity-platform').description);
});

test('section menu on the Pilot: the family Cloud first, products with 2+ Editions get a dropdown, in manifest order', () => {
  const m = pilot();
  const view = { space: 'api-platform', edition: 'cloud', path: 'ai-gateway/' };
  const sm = menu(m, view, sectionFor(m, view));
  assert.equal(sm.title, 'API Platform Documentation');
  assert.deepEqual(sm.entries.map((e) => [e.name, e.open, e.active, e.dropdown?.items.map((i) => i.label) ?? null]), [
    ['API Platform Cloud', true, true, null],
    ['API Manager', false, false, ['4.7.0', '4.6.0', ...['4.5.0', '4.4.0', '4.3.0', '4.2.0', '4.1.0', '4.0.0', '3.2.0', '3.1.0', '3.0.0', '2.6.0', '2.5.0', '2.2.0', '2.1.0', '2.0.0', '1.10.0', '1.9.1', '1.9.0'].map((v) => `${v} ↗`)]],
    ['API Gateway', false, false, ['Cloud', '1.2.0', '1.1.0', '1.0.0']],
    ['AI Gateway', false, true, ['Cloud', '1.2.0', '2026.09.24', '1.1.0 ↗', '1.0.0 ↗']],
  ]);
  assert.equal(sm.entries[3].dropdown.value, 'cloud');
  assert.equal(sm.entries[1].href, '/api-manager/latest/');
  const is = { space: 'identity-server', edition: '7.2.0', path: '' };
  assert.deepEqual(menu(m, is, sectionFor(m, is)).entries.map((e) => [e.slug, e.open, e.dropdown?.value ?? null]), [['identity-platform', false, null], ['identity-server', true, '7.2.0']]);
});

test('a section, Doc space or version added to the published manifest redraws the menus without a rebuild', () => {
  const snapshot = pilot();
  const next = structuredClone(snapshot);
  next.docSpaces['ai-gateway'].editions.unshift({ id: '1.3.0', status: 'live' });
  next.docSpaces['ai-gateway'].latest = '1.3.0';
  next.sections['agent-platform'] = { title: 'Agent Platform Documentation', in: 'agent-platform', family: 'Agent Platform', menu: [{ docSpace: 'ai-gateway', versionIn: 'menu' }], products: [{ label: 'AI Gateway', opens: { docSpace: 'ai-gateway' } }] };
  const agent = next.productsMenu.find((g) => g.id === 'agent-platform');
  agent.sections = ['agent-platform'];
  agent.entries = [{ label: 'AI Gateway', opens: { docSpace: 'ai-gateway' }, section: 'agent-platform' }];
  delete next.docSpaces['identity-platform'].formerNames; // an older format: the snapshot's value is kept
  const m = mergeManifest(snapshot, next);
  assert.deepEqual(m.docSpaces['identity-platform'].formerNames, ['Asgardeo']);
  const view = { space: 'ai-gateway', edition: '1.2.0', path: '' };
  assert.deepEqual(ids(headerSelector(m, {}, view)), ['cloud', '1.3.0', '1.2.0', '2026.09.24', '1.1.0', '1.0.0']);
  assert.match(versionNotice(m, view).text, /The newest release is 1\.3\.0/);
  assert.deepEqual(productsMenu(m).find((g) => g.id === 'agent-platform').entries.map((e) => [e.label, e.section]), [['AI Gateway', 'agent-platform'], ['Agent Platform Cloud', null], ['Agent Manager', null]]);
  assert.equal(menu(m, view, sectionFor(m, view, { 'ai-gateway': 'agent-platform' })).entries[0].borrowed, true);
  assert.equal(mergeManifest(snapshot, null), snapshot, 'manifest unreachable: the baked-in copy');
});
