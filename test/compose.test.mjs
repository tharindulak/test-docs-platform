// The compose step (Manifests and the compose step): the schemas, every
// blocking error and warning from "Team manifests and how the final build
// merges them", the Cloud part checks, borrowing, Unlisted Doc spaces,
// `latest` and version-in defaults, the last-good rule on main and the PR
// check against the latest merged manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  COMPOSED_KEY, compose, composeMain, composeOrThrow, composePr, defaultContentDir, errorsIn, formatIssues, readInputs, readPrInputs,
} from '../lib/compose.mjs';
import { loadContentRepo } from '../lib/content.mjs';
import { loadPolicy, publicManifest } from '../lib/manifest.mjs';
import { planRelease } from '../lib/release.mjs';
import { SCHEMA_FILES, SCHEMAS_DIR, validate } from '../lib/schemas.mjs';
import { productsMenu } from '../lib/switching.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-compose-'));
const cli = path.join(root, 'bin', 'wso2-release.mjs');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });

// --- A small API Platform world, built in memory ---------------------------
const NAV = 'wso2/docs-platform:navigation/navigation.yaml';
const SEC = (id) => `wso2/docs-platform:navigation/sections/${id}.yaml`;
const DS = (slug, repo = 'wso2/docs-api-platform') => `${repo}:${slug}/docspace.yaml`;

function world() {
  return {
    nav: {
      schemaVersion: 1, owners: { team: 'docs-platform' }, platformRepo: 'wso2/docs-platform',
      families: [{ id: 'agent-platform', name: 'Agent Platform' }, { id: 'api-platform', name: 'API Platform' }],
      groups: [{ id: 'other', name: 'Other' }],
      environments: ['staging', 'production'],
      sections: [{ id: 'api-platform', in: 'api-platform' }],
      contentRepos: [{ repo: 'wso2/docs-api-platform' }],
    },
    sections: {
      'api-platform': {
        schemaVersion: 1, id: 'api-platform', title: 'API Platform Documentation', owners: { team: 'api-team' },
        products: [{ label: 'API Manager', opens: { docSpace: 'api-manager' } }, { label: 'AI Gateway', opens: { docSpace: 'ai-gateway' } }],
        menu: [{ docSpace: 'api-platform' }, { docSpace: 'api-manager' }, { docSpace: 'ai-gateway' }],
      },
    },
    spaces: [
      { schemaVersion: 1, slug: 'api-platform', displayName: 'API Platform Cloud', owners: { team: 'api-team' }, repo: 'wso2/docs-api-platform', home: 'api-platform', editions: [{ id: 'cloud', parts: ['ai-gateway'] }] },
      { schemaVersion: 1, slug: 'api-manager', displayName: 'API Manager', owners: { team: 'apim-team' }, repo: 'wso2/docs-api-platform', home: 'api-platform', editions: [{ id: '4.7.0' }, { id: '4.6.0' }], legacyVersions: [{ id: '4.5.0', url: 'https://apim.docs.wso2.com/en/4.5.0/' }] },
      { schemaVersion: 1, slug: 'ai-gateway', displayName: 'AI Gateway', owners: { team: 'gateway-team' }, repo: 'wso2/docs-api-platform', home: 'api-platform', cloud: { in: 'api-platform' }, editions: [{ id: '1.2.0' }, { id: '2026.09.24' }] },
    ],
  };
}

const inputsOf = (w) => ({
  navigation: { file: NAV, data: w.nav },
  sections: Object.fromEntries(Object.entries(w.sections).map(([id, data]) => [id, { file: SEC(id), data }])),
  docSpaces: w.spaces.map((d) => ({ file: DS(d.slug ?? 'x', d.repo), repo: d.repo, dir: d.slug, data: d })),
  missingRepos: w.missingRepos ?? [],
});
const composeWorld = (w, opts) => compose(inputsOf(w), opts);
const spaceIn = (w, slug) => w.spaces.find((s) => s.slug === slug);
const codes = (issues, level = 'error') => [...new Set(issues.filter((i) => i.level === level).map((i) => i.code))].sort();
const only = (issues, code) => issues.filter((i) => i.code === code);

function assertError(w, code, { files, owners, match, base } = {}) {
  const { issues } = composeWorld(w, { base });
  assert.deepEqual(codes(issues), [code], formatIssues(issues));
  const [i] = only(issues, code);
  if (match) assert.match(i.message, match);
  if (files) assert.deepEqual([...i.files].sort(), [...files].sort());
  if (owners) assert.deepEqual(i.owners, [...owners].sort());
  return i;
}

test('the small world composes cleanly', () => {
  const { manifest, issues } = composeWorld(world());
  assert.deepEqual(errorsIn(issues), []);
  assert.deepEqual(issues.filter((i) => i.level === 'warning'), []);
  assert.deepEqual(Object.keys(manifest.docSpaces), ['api-platform', 'api-manager', 'ai-gateway']);
  assert.deepEqual(manifest.families, ['Agent Platform', 'API Platform', 'Other']);
});

// --- Schemas -----------------------------------------------------------------
test('every schema compiles, is draft 2020-12 and pins schemaVersion 1', () => {
  assert.deepEqual(Object.keys(SCHEMA_FILES).sort(), ['catalog', 'docspace', 'intake-record', 'navigation', 'release-notes', 'sdks', 'section']);
  for (const [kind, file] of Object.entries(SCHEMA_FILES)) {
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', file);
    assert.deepEqual(schema.properties.schemaVersion, { const: 1 }, file);
    assert.ok(schema.required.includes('schemaVersion'), file);
    assert.ok(validate(kind, { schemaVersion: 2 }).some((p) => /schemaVersion: must be 1/.test(p)), file);
  }
});

test('data-file schemas: catalog, release notes and SDK list', () => {
  assert.deepEqual(validate('catalog', {
    schemaVersion: 1, categories: [{ id: 'crm', label: 'CRM' }],
    items: [{ id: 'salesforce', name: 'Salesforce', description: 'Connect to Salesforce.', href: 'connectors/salesforce/', category: 'crm', tags: ['saas'], logo: 'assets/logos/salesforce.svg', status: 'ga' }],
  }), []);
  assert.deepEqual(validate('catalog', { schemaVersion: 1, items: [{ id: 'x', name: 'X', description: 'x', href: 'x/', colour: 'red' }] }), ['items.0: unknown field "colour"']);
  assert.deepEqual(validate('release-notes', {
    schemaVersion: 1,
    releases: [{ version: '7.3.0', date: '2026-09-01', items: [{ type: 'new', title: 'Passkeys', links: ['docs:identity-server/7.3.0/guides/passkeys'] }] }, { version: 'cloud-2026.10.20', date: '2026-10-20', items: [] }],
  }), []);
  assert.deepEqual(validate('release-notes', { schemaVersion: 1, releases: [{ version: 'v7.3', date: '1 Sept', items: [{ type: 'feature', title: 'x' }] }] }).length, 3);
  assert.deepEqual(validate('sdks', {
    schemaVersion: 1, sdks: [{ id: 'react', name: 'React SDK', language: 'JavaScript', framework: 'React', package: { registry: 'npm', name: '@asgardeo/react' }, repo: 'https://github.com/asgardeo/javascript', docs: 'docs:identity-platform/cloud/get-started/connect-app/react', status: 'ga' }],
  }), []);
  assert.deepEqual(validate('sdks', { schemaVersion: 1, sdks: [{ id: 'react', name: 'React SDK', language: 'JavaScript', repo: 'github.com/x', package: { registry: 'bower', name: 'x' } }] }).length, 2);
});

test('blocking: a schema violation in any of the three manifests, with its file and owner', () => {
  let w = world();
  spaceIn(w, 'api-manager').editions[0].state = 'live';
  assertError(w, 'schema', { files: [DS('api-manager')], owners: ['apim-team'], match: /editions\.0: unknown field "state"/ });

  w = world();
  w.sections['api-platform'].menu[1]['version-in'] = 'sidebar';
  assertError(w, 'schema', { files: [SEC('api-platform')], owners: ['api-team'], match: /version-in: must be one of header, menu/ });

  w = world();
  delete w.nav.environments;
  assertError(w, 'schema', { files: [NAV], owners: ['docs-platform'], match: /"environments" is required/ });

  // A home section and listed: false, or neither.
  w = world();
  spaceIn(w, 'api-manager').listed = false;
  assertError(w, 'schema', { match: /either a home Docs section/ });
  w = world();
  delete spaceIn(w, 'api-manager').home;
  assertError(w, 'schema', { match: /either a home Docs section/ });

  // A file that is not YAML at all, and a slug that is not its directory.
  const i = inputsOf(world());
  i.docSpaces[1] = { ...i.docSpaces[1], data: undefined, error: 'cannot be read as YAML: bad indentation' };
  const r = compose(i);
  assert.deepEqual(codes(r.issues), ['schema'], formatIssues(r.issues));
  const j = inputsOf(world());
  j.docSpaces[1].dir = 'apim';
  assert.match(only(compose(j).issues, 'schema')[0].message, /slug is "api-manager", but its directory is apim\//);

  // A model that disagrees with the Editions.
  w = world();
  spaceIn(w, 'api-manager').model = 'cloud-plus-versions';
  assertError(w, 'schema', { match: /model is cloud-plus-versions, but its Editions make it versions-only/ });
});

test('warning: a section may list a Doc space that is coming; its entries wait, hidden, in `pending`', () => {
  // The section's change merges first (New Doc space chicken-and-egg).
  const w = world();
  w.sections['api-platform'].menu.splice(1, 0, { docSpace: 'api-portal', 'version-in': 'menu' });
  w.sections['api-platform'].products.push({ label: 'API Portal', opens: { docSpace: 'api-portal' } });
  const { manifest, issues } = composeWorld(w);
  assert.deepEqual(codes(issues), [], formatIssues(issues));
  const warned = only(issues, 'unknown-docspace');
  assert.equal(warned.length, 2, 'the menu and the products-menu entry');
  assert.equal(warned[0].level, 'warning');
  assert.deepEqual([warned[0].files, warned[0].owners], [[SEC('api-platform')], ['api-team']]);
  assert.match(warned[0].message, /lists "api-portal" \(menu item 2\), which is no Doc space yet; the entry stays hidden/);
  assert.match(warned[1].message, /products-menu entry "API Portal"/);
  const sec = manifest.sections['api-platform'];
  assert.deepEqual(sec.menu.map((m) => m.docSpace), ['api-platform', 'api-manager', 'ai-gateway'], 'readers see nothing new');
  assert.ok(!sec.products.some((p) => p.opens.docSpace === 'api-portal'));
  assert.deepEqual(sec.pending, [{ at: 1, docSpace: 'api-portal', versionIn: 'menu' }, { at: 2, product: { label: 'API Portal', opens: { docSpace: 'api-portal' } } }]);
  assert.ok(!('api-portal' in publicManifest(manifest).docSpaces));
  assert.deepEqual(publicManifest(manifest).sections['api-platform'].pending, sec.pending, 'published with the section, so compose from the published manifest still knows it');

  // Then the Doc space's own PR: it composes, passes home-not-listing and takes its place.
  w.spaces.push({ schemaVersion: 1, slug: 'api-portal', displayName: 'API Portal', owners: { team: 'portal-team' }, repo: 'wso2/docs-api-platform', home: 'api-platform', editions: [{ id: 'cloud' }, { id: '1.0.0' }] });
  const next = composeWorld(w);
  assert.deepEqual(codes(next.issues), [], formatIssues(next.issues));
  assert.deepEqual(next.manifest.sections['api-platform'].menu.map((m) => `${m.docSpace}:${m.versionIn}`), ['api-platform:header', 'api-portal:menu', 'api-manager:menu', 'ai-gateway:menu']);
  assert.equal(next.manifest.sections['api-platform'].pending, undefined);
});

test('blocking: a home section that does not list its Doc space', () => {
  const w = world();
  w.sections['api-platform'].menu = w.sections['api-platform'].menu.filter((m) => m.docSpace !== 'api-manager');
  w.sections['api-platform'].products = w.sections['api-platform'].products.filter((p) => p.opens.docSpace !== 'api-manager');
  assertError(w, 'home-not-listing', { files: [DS('api-manager'), SEC('api-platform')], owners: ['apim-team', 'api-team'], match: /home section is api-platform, but api-platform does not list it/ });
});

test('blocking: a section that lists an Unlisted Doc space', () => {
  let w = world();
  w.spaces.push({ schemaVersion: 1, slug: 'bijira', displayName: 'Bijira', owners: { team: 'api-team' }, repo: 'wso2/docs-api-platform', listed: false, editions: [{ id: 'cloud' }] });
  w.sections['api-platform'].menu.push({ docSpace: 'bijira' });
  assertError(w, 'lists-unlisted', { match: /lists bijira, an Unlisted Doc space/ });
  w = world();
  w.spaces.push({ schemaVersion: 1, slug: 'bijira', displayName: 'Bijira', owners: { team: 'api-team' }, repo: 'wso2/docs-api-platform', listed: false, editions: [{ id: 'cloud' }] });
  w.sections['api-platform'].products.push({ label: 'Bijira', opens: { docSpace: 'bijira' } });
  assertError(w, 'lists-unlisted', { match: /opens bijira, an Unlisted Doc space/ });
});

test('blocking: removing a Doc space or an Edition that a section still lists', () => {
  const base = composeWorld(world()).manifest;
  // The API Manager team deletes its Doc space; the section still lists it.
  let w = world();
  w.spaces = w.spaces.filter((s) => s.slug !== 'api-manager');
  const removed = composeWorld(w, { base }).issues.filter((i) => i.level === 'error');
  assert.deepEqual(codes(removed), ['removed-still-listed']);
  assert.equal(removed.length, 2, 'the menu and the products-menu entry');
  assert.deepEqual(removed[0].files, [DS('api-manager'), SEC('api-platform')]);
  assert.deepEqual(removed[0].owners, ['api-team', 'apim-team'], 'both owning teams');
  // Without the last good manifest the same thing is a slug that is coming (a warning).
  assert.deepEqual(codes(composeWorld(w).issues), []);
  assert.deepEqual(codes(composeWorld(w).issues, 'warning'), ['unknown-docspace']);

  // An Edition a products-menu entry opens.
  w = world();
  w.sections['api-platform'].products[0].opens.edition = '4.6.0';
  const base2 = composeWorld(w).manifest;
  spaceIn(w, 'api-manager').editions.pop();
  assertError(w, 'removed-still-listed', { base: base2, files: [DS('api-manager'), SEC('api-platform')], match: /Edition 4\.6\.0 of api-manager was removed/ });
});

test('an opens target may name an Edition, but only a real one', () => {
  let w = world();
  w.sections['api-platform'].products[0].opens.edition = '4.6.0';
  w.sections['api-platform'].products[1].opens.edition = 'cloud'; // AI Gateway's Cloud is its part
  assert.deepEqual(errorsIn(composeWorld(w).issues), []);
  w = world();
  w.sections['api-platform'].products[0].opens.edition = '4.5.0';
  assertError(w, 'unknown-edition', { match: /4\.5\.0 of api-manager, which is a Legacy version/ });
  w.sections['api-platform'].products[0].opens.edition = '9.9.9';
  assertError(w, 'unknown-edition', { match: /has no such Edition/ });
});

test('blocking: duplicate slugs', () => {
  let w = world();
  w.spaces.push({ ...structuredClone(spaceIn(w, 'ai-gateway')), repo: 'wso2/docs-agent-platform', owners: { team: 'agent-team' } });
  assertError(w, 'duplicate', { files: [DS('ai-gateway'), DS('ai-gateway', 'wso2/docs-agent-platform')], owners: ['agent-team', 'gateway-team'], match: /claimed by/ });
  w = world();
  w.nav.notYetOnWso2Docs = { 'api-manager': { displayName: 'WSO2 API Manager', in: 'api-platform', model: 'versions-only', legacyUrl: 'https://apim.docs.wso2.com/' } };
  assertError(w, 'duplicate', { files: [DS('api-manager'), NAV], match: /remove the entry/ });
  w = world();
  spaceIn(w, 'api-manager').editions.push({ id: '4.7.0' });
  assertError(w, 'duplicate', { match: /Edition 4\.7\.0 is listed twice/ });
  w = world();
  w.sections['api-platform'].menu.push({ docSpace: 'api-manager' });
  assertError(w, 'duplicate', { match: /lists api-manager twice/ });
});

test('blocking: latest naming no Edition', () => {
  const w = world();
  spaceIn(w, 'api-manager').latest = '4.8.0';
  assertError(w, 'latest', { files: [DS('api-manager')], owners: ['apim-team'], match: /latest is "4\.8\.0", which names no Edition/ });
  spaceIn(w, 'api-manager').latest = '4.5.0';
  assertError(w, 'latest', { match: /4\.5\.0 is a Legacy version/ });
});

test('blocking: latest is never Cloud where the Doc space has Self-hosted Editions', () => {
  const w = world();
  spaceIn(w, 'api-manager').editions.unshift({ id: 'cloud' });
  spaceIn(w, 'api-manager').latest = 'cloud';
  assertError(w, 'latest', { files: [DS('api-manager')], owners: ['apim-team'], match: /latest is "cloud", but \/latest\/ is never Cloud.*4\.7\.0/ });
  // A Cloud-only Doc space's latest is cloud, set or not.
  const ok = world();
  spaceIn(ok, 'api-platform').latest = 'cloud';
  const { manifest, issues } = composeWorld(ok);
  assert.deepEqual(errorsIn(issues), []);
  assert.equal(manifest.docSpaces['api-platform'].latest, 'cloud');
});

test('blocking: version-in: menu on a Doc space with fewer than two Editions', () => {
  const w = world();
  w.sections['api-platform'].menu[0]['version-in'] = 'menu'; // API Platform Cloud: Cloud only
  assertError(w, 'version-in', { files: [SEC('api-platform'), DS('api-platform')], match: /api-platform, which has 1 Edition; a menu dropdown needs two or more/ });
});

test('version-in defaults to menu for two or more Editions, a Cloud part counting as one', () => {
  const w = world();
  spaceIn(w, 'ai-gateway').editions = [{ id: '1.2.0' }];
  w.spaces.push({ schemaVersion: 1, slug: 'ai-workspace', displayName: 'AI Workspace', owners: { team: 'api-team' }, repo: 'wso2/docs-api-platform', home: 'api-platform', editions: [{ id: '1.0.0' }] });
  w.sections['api-platform'].menu.push({ docSpace: 'ai-workspace' });
  const { manifest, issues } = composeWorld(w);
  assert.deepEqual(errorsIn(issues), []);
  assert.deepEqual(manifest.sections['api-platform'].menu.map((m) => `${m.docSpace}:${m.versionIn}`), ['api-platform:header', 'api-manager:menu', 'ai-gateway:menu', 'ai-workspace:header']);
});

test('blocking: broken Cloud part links, checked from both sides', () => {
  let w = world();
  spaceIn(w, 'api-platform').editions[0].parts.push('api-gateway');
  assertError(w, 'cloud-part', { files: [DS('api-platform')], match: /lists Cloud part "api-gateway", which is no Doc space/ });

  w = world();
  delete spaceIn(w, 'ai-gateway').cloud;
  assertError(w, 'cloud-part', { files: [DS('api-platform'), DS('ai-gateway')], owners: ['api-team', 'gateway-team'], match: /ai-gateway does not point back \(its cloud\.in is not set\)/ });

  w = world();
  spaceIn(w, 'api-platform').editions[0].parts = [];
  delete spaceIn(w, 'api-platform').editions[0].parts;
  assertError(w, 'cloud-part', { files: [DS('ai-gateway'), DS('api-platform')], match: /api-platform's Cloud Edition does not list ai-gateway/ });

  w = world();
  spaceIn(w, 'ai-gateway').cloud.in = 'agent-platform';
  const r = composeWorld(w).issues;
  assert.deepEqual(codes(r), ['cloud-part']);
  assert.ok(r.some((i) => /does not point back \(its cloud\.in is agent-platform\)/.test(i.message)));
  assert.ok(r.some((i) => /cloud\.in is "agent-platform", which is no Doc space/.test(i.message)));

  // A part comes from the platform's own Content repo.
  w = world();
  spaceIn(w, 'ai-gateway').repo = 'wso2/docs-ai-gateway';
  w.nav.contentRepos.push({ repo: 'wso2/docs-ai-gateway' });
  assertError(w, 'cloud-part', { match: /Cloud part ai-gateway is in wso2\/docs-ai-gateway, not wso2\/docs-api-platform/ });

  // A part belongs to one platform only.
  w = world();
  w.nav.sections.push({ id: 'agent-platform', in: 'agent-platform' });
  w.sections['agent-platform'] = { schemaVersion: 1, id: 'agent-platform', title: 'Agent Platform Documentation', owners: { team: 'agent-team' }, menu: [{ docSpace: 'agent-platform' }] };
  w.spaces.push({ schemaVersion: 1, slug: 'agent-platform', displayName: 'Agent Platform Cloud', owners: { team: 'agent-team' }, repo: 'wso2/docs-api-platform', home: 'agent-platform', editions: [{ id: 'cloud', parts: ['ai-gateway'] }] });
  const two = composeWorld(w).issues;
  assert.deepEqual(codes(two), ['cloud-part']);
  assert.ok(two.some((i) => /ai-gateway is a Cloud part of api-platform and agent-platform; a part belongs to one platform only/.test(i.message)));

  // A component's Cloud is its part: it has no Cloud Edition of its own.
  w = world();
  spaceIn(w, 'ai-gateway').editions.unshift({ id: 'cloud' });
  assertError(w, 'cloud-part', { files: [DS('ai-gateway')], match: /has a Cloud Edition of its own/ });

  // Parts hang off the Cloud Edition only.
  w = world();
  spaceIn(w, 'api-manager').editions[0].parts = ['ai-gateway'];
  assert.ok(composeWorld(w).issues.some((i) => i.code === 'cloud-part' && /only the Cloud Edition has Cloud parts/.test(i.message)));
});

test('blocking: sections, families, environments, branches, pins and checkouts must line up', () => {
  let w = world();
  spaceIn(w, 'api-manager').home = 'api-management';
  assert.ok(composeWorld(w).issues.some((i) => i.code === 'unknown-section' && /home section "api-management" does not exist/.test(i.message)));

  w = world();
  w.sections['agent-platform'] = { schemaVersion: 1, id: 'agent-platform', title: 'Agent', owners: { team: 'agent-team' }, menu: [{ docSpace: 'ai-gateway' }] };
  assertError(w, 'unknown-section', { files: [SEC('agent-platform'), NAV], owners: ['agent-team', 'docs-platform'], match: /only the Platform team adds sections/ });

  w = world();
  w.nav.sections.push({ id: 'agent-platform', in: 'agent-platform' });
  assertError(w, 'unknown-section', { files: [NAV], match: /has no navigation\/sections\/agent-platform\.yaml/ });

  w = world();
  w.nav.sections[0].in = 'api-management';
  assertError(w, 'unknown-family', { files: [NAV] });

  w = world();
  spaceIn(w, 'api-manager').environments = ['qa'];
  assertError(w, 'unknown-environment', { files: [DS('api-manager')] });

  // Several Doc spaces in one repo: branches carry the Doc space's prefix.
  w = world();
  spaceIn(w, 'api-manager').editions[0].branch = 'release/4.7.0';
  assertError(w, 'branch-prefix', { files: [DS('api-manager')], match: /must start with "api-manager\/"/ });
  w = world();
  spaceIn(w, 'api-manager').editions[0].pin = '4.7.0-docs.3';
  assertError(w, 'pin', { match: /not one of its Docs release tags \(api-manager\/4\.7\.0-docs\.<n>\)/ });
  spaceIn(w, 'api-manager').editions[0].pin = 'api-manager/4.7.0-docs.3';
  assert.deepEqual(errorsIn(composeWorld(w).issues), []);
  assert.equal(composeWorld(w).manifest.docSpaces['api-manager'].editions[0].pin, 'api-manager/4.7.0-docs.3');

  w = world();
  w.missingRepos = ['wso2/docs-api-platform'];
  assert.ok(composeWorld(w).issues.some((i) => i.code === 'missing-repo' && i.files[0] === NAV));
});

test('warning: a products-menu label that differs from the Doc space name', () => {
  const w = world();
  w.sections['api-platform'].products[0].label = 'WSO2 API Manager'; // the WSO2 prefix is not a difference
  w.sections['api-platform'].products.push({ label: 'API Control Plane', opens: { docSpace: 'api-platform' } });
  w.sections['api-platform'].products.push({ label: 'Monetization', opens: { docSpace: 'api-platform', page: 'guides/monetization/' } });
  const { issues } = composeWorld(w);
  assert.deepEqual(errorsIn(issues), []);
  const warnings = issues.filter((i) => i.level === 'warning');
  assert.deepEqual(warnings.map((i) => i.code), ['label-differs'], 'a page target has its own label');
  assert.match(warnings[0].message, /"API Control Plane" differs from the Doc space's name, "API Platform Cloud"/);
  assert.deepEqual(warnings[0].owners, ['api-team']);
});

test('borrowing: any section may list a Doc space without asking; its team is told, and its home stays', () => {
  const w = world();
  w.nav.sections.push({ id: 'agent-platform', in: 'agent-platform' });
  w.sections['agent-platform'] = {
    schemaVersion: 1, id: 'agent-platform', title: 'Agent Platform Documentation', owners: { team: 'agent-team' },
    products: [{ label: 'AI Gateway', opens: { docSpace: 'ai-gateway' } }], menu: [{ docSpace: 'ai-gateway' }],
  };
  const { manifest, issues } = composeWorld(w);
  assert.deepEqual(errorsIn(issues), []);
  assert.deepEqual(issues.filter((i) => i.level === 'warning'), []);
  const [n] = only(issues, 'borrowed');
  assert.equal(n.level, 'note');
  assert.match(n.message, /ai-gateway \(home api-platform\) is borrowed by section agent-platform/);
  assert.deepEqual(n.owners, ['gateway-team'], "the report goes to the Doc space's team");
  const ai = manifest.docSpaces['ai-gateway'];
  assert.equal(ai.home, 'api-platform');
  assert.equal(ai.family, 'API Platform', 'the home section gives the family');
  assert.deepEqual(ai.sections, ['api-platform', 'agent-platform']);
  assert.deepEqual(manifest.productsMenu.find((g) => g.id === 'agent-platform').entries, [{ label: 'AI Gateway', opens: { docSpace: 'ai-gateway' }, section: 'agent-platform' }]);

  // Warning: borrowed, but its home section's products listing lacks it.
  w.sections['api-platform'].products = w.sections['api-platform'].products.filter((p) => p.opens.docSpace !== 'ai-gateway');
  const warned = composeWorld(w).issues.filter((i) => i.level === 'warning');
  assert.deepEqual(warned.map((i) => i.code), ['borrowed-not-in-home-products']);
  assert.deepEqual(warned[0].files, [SEC('api-platform'), DS('ai-gateway')]);
  assert.deepEqual(warned[0].owners, ['api-team', 'gateway-team']);
});

test('Unlisted Doc spaces: hosted, in no section, with no family', () => {
  const w = world();
  w.spaces.push({ schemaVersion: 1, slug: 'bijira', displayName: 'Bijira', owners: { team: 'api-team' }, repo: 'wso2/docs-api-platform', listed: false, editions: [{ id: 'cloud' }], notices: [{ text: 'Bijira is now API Platform Cloud.', level: 'warning', until: '2027-06-30' }] });
  const { manifest, issues } = composeWorld(w);
  assert.deepEqual(errorsIn(issues), []);
  const b = manifest.docSpaces.bijira;
  assert.equal(b.listed, false);
  assert.equal(b.home, null);
  assert.equal(b.family, null);
  assert.deepEqual(b.sections, []);
  assert.equal(b.latest, 'cloud');
  const pub = publicManifest(manifest, { environment: 'production' });
  assert.deepEqual(pub.docSpaces.bijira.notices, [{ text: 'Bijira is now API Platform Cloud.', level: 'warning', until: '2027-06-30' }]);
  assert.ok(!productsMenu(pub).flatMap((g) => g.entries).some((e) => e.docSpace === 'bijira'), 'not in the products menu');
});

test('latest defaults to the newest release (the first Self-hosted Edition), or Cloud when Cloud is all there is', () => {
  const w = world();
  w.spaces.push(
    { schemaVersion: 1, slug: 'identity-server', displayName: 'Identity Server', owners: { team: 't' }, repo: 'wso2/docs-api-platform', listed: false, editions: [{ id: 'cloud' }, { id: '7.3.0' }, { id: '7.2.0' }] },
    { schemaVersion: 1, slug: 'contribute', displayName: 'Contribute', owners: { team: 't' }, repo: 'wso2/docs-api-platform', listed: false },
    { schemaVersion: 1, slug: 'pinned', displayName: 'Pinned', owners: { team: 't' }, repo: 'wso2/docs-api-platform', listed: false, latest: '1.1.0', editions: [{ id: '2.0.0' }, { id: '1.1.0' }] },
  );
  const { manifest, issues } = composeWorld(w);
  assert.deepEqual(errorsIn(issues), []);
  const latest = (s) => manifest.docSpaces[s].latest;
  assert.equal(latest('identity-server'), '7.3.0', '/latest/ stays the newest release; Cloud keeps /cloud/');
  assert.equal(latest('api-platform'), 'cloud', 'a Cloud-only Doc space');
  assert.equal(latest('ai-gateway'), '1.2.0', 'manifest order, never sorted (2026.09.24 is listed second)');
  assert.equal(latest('api-manager'), '4.7.0');
  assert.equal(latest('contribute'), null, 'unversioned');
  assert.equal(latest('pinned'), '1.1.0', 'the team may override it');
  assert.deepEqual(manifest.docSpaces['ai-gateway'].editions.map((e) => e.id), ['1.2.0', '2026.09.24']);
  const models = Object.fromEntries(Object.entries(manifest.docSpaces).map(([s, d]) => [s, d.model]));
  assert.deepEqual(models, {
    'api-platform': 'cloud-only', 'api-manager': 'versions-only', 'ai-gateway': 'versions-only',
    'identity-server': 'cloud-plus-versions', contribute: 'unversioned', pinned: 'versions-only',
  });
});

// --- The last-good rule on main ----------------------------------------------
test('main: a failed compose keeps the last good manifest and alerts both owning teams', () => {
  const good = composeMain(inputsOf(world()), { now: new Date('2026-10-26T10:00:00Z') });
  assert.equal(good.ok, true);
  assert.equal(good.manifest.composedAt, '2026-10-26T10:00:00.000Z');
  // Two PRs that each passed alone: AI Gateway moves home, API Platform drops it from its menu.
  const w = world();
  w.sections['api-platform'].menu = w.sections['api-platform'].menu.filter((m) => m.docSpace !== 'ai-gateway');
  w.sections['api-platform'].products = w.sections['api-platform'].products.filter((p) => p.opens.docSpace !== 'ai-gateway');
  const bad = composeMain(inputsOf(w), { lastGood: good.manifest });
  assert.equal(bad.ok, false);
  assert.equal(bad.keptLastGood, true);
  assert.equal(bad.manifest, good.manifest, 'the last good copy stays published');
  assert.deepEqual(bad.alert, ['api-team', 'gateway-team']);
  const none = composeMain(inputsOf(w));
  assert.equal(none.ok, false);
  assert.equal(none.keptLastGood, false);
  assert.equal(none.manifest, null);
});

function writeTree(dir, w) {
  fs.mkdirSync(path.join(dir, 'navigation', 'sections'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'navigation', 'navigation.yaml'), yaml.dump(w.nav));
  for (const [id, s] of Object.entries(w.sections)) fs.writeFileSync(path.join(dir, 'navigation', 'sections', `${id}.yaml`), yaml.dump(s));
  for (const s of w.spaces) {
    const d = path.join(dir, 'content', s.repo.split('/')[1], s.slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'docspace.yaml'), yaml.dump(s));
  }
}

test('main, through the CLI: --out and the storage keep the last good copy when compose fails', () => {
  const dir = tmp();
  const w = world();
  writeTree(dir, w);
  const out = path.join(dir, 'manifest.json');
  const store = path.join(dir, 'bucket');
  const args = ['compose', '--navigation', path.join(dir, 'navigation'), '--content', path.join(dir, 'content'), '--platform-root', dir, '--out', out];
  let r = run(...args, '--storage', `file:${store}`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 Doc spaces, 1 Docs sections/);
  const good = fs.readFileSync(out, 'utf8');
  assert.equal(fs.readFileSync(path.join(store, COMPOSED_KEY), 'utf8'), good);

  // Main breaks: a section manifest sets version-in: menu for a Doc space with one Edition.
  w.sections['api-platform'].menu[0]['version-in'] = 'menu';
  writeTree(dir, w);
  const report = path.join(dir, 'report.json');
  r = run(...args, '--storage', `file:${store}`, '--report', report);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error \[version-in\] section api-platform sets version-in: menu for api-platform/);
  assert.match(r.stdout, /in wso2\/docs-platform:navigation\/sections\/api-platform\.yaml, wso2\/docs-api-platform:api-platform\/docspace\.yaml \(owners: api-team\)/);
  assert.match(r.stdout, /keeping the last good manifest \(composed \d{4}-/);
  assert.match(r.stdout, /alert api-team/);
  assert.equal(fs.readFileSync(out, 'utf8'), good, '--out holds the last good copy');
  assert.equal(fs.readFileSync(path.join(store, COMPOSED_KEY), 'utf8'), good, 'storage is left alone');
  const rep = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(rep.ok, false);
  assert.equal(rep.keptLastGood, true);
  assert.deepEqual(rep.alert, ['api-team']);

  // The release CLI reads the composed file (--policy).
  const pub = publicManifest(loadPolicy(out), { environment: 'production' });
  assert.deepEqual([pub.docSpaces['api-manager'].latest, pub.docSpaces['ai-gateway'].latest], ['4.7.0', '1.2.0']);
});

// --- The PR check -------------------------------------------------------------
test('PR: a Platform PR composes against the latest merged manifest and is blocked by its own errors', () => {
  const base = composeMain(inputsOf(world())).manifest;
  const w = world();
  w.sections['api-platform'].products.push({ label: 'API Manager', opens: { docSpace: 'api-manager', edition: '9.9.9' } });
  const local = { navigation: { file: NAV, data: w.nav }, sections: { 'api-platform': { file: SEC('api-platform'), data: w.sections['api-platform'] } }, repos: [], docSpaces: [] };
  const r = composePr(base, local);
  assert.equal(r.ok, false);
  assert.deepEqual([...r.changed], [SEC('api-platform')]);
  assert.deepEqual(r.blocking.map((i) => `${i.code} ${i.files.join(',')} ${i.owners.join(',')}`), [`unknown-edition ${SEC('api-platform')} api-team`]);
  // Listing a Doc space that is coming passes, with a warning.
  const coming = world();
  coming.sections['api-platform'].menu.push({ docSpace: 'ai-workspace' });
  const c = composePr(base, { navigation: { file: NAV, data: coming.nav }, sections: { 'api-platform': { file: SEC('api-platform'), data: coming.sections['api-platform'] } } });
  assert.equal(c.ok, true);
  assert.deepEqual(codes(c.issues, 'warning'), ['unknown-docspace']);
  // No change at all passes.
  assert.equal(composePr(base, { navigation: { file: NAV, data: world().nav }, sections: { 'api-platform': { file: SEC('api-platform'), data: world().sections['api-platform'] } } }).ok, true);
});

test('PR: a Content repo PR that removes a Doc space still listed is blocked, naming both teams', () => {
  const base = composeMain(inputsOf(world())).manifest;
  const keep = world().spaces.filter((s) => s.slug !== 'ai-gateway');
  const local = { repos: ['wso2/docs-api-platform'], docSpaces: keep.map((d) => ({ file: DS(d.slug), repo: d.repo, dir: d.slug, data: d })) };
  // ai-gateway is also a Cloud part of api-platform, so the PR breaks that too.
  const r = composePr(base, local);
  assert.equal(r.ok, false);
  assert.deepEqual([...r.changed], [DS('ai-gateway')]);
  assert.deepEqual(codes(r.blocking), ['cloud-part', 'removed-still-listed']);
  const removed = r.blocking.find((i) => i.code === 'removed-still-listed');
  assert.deepEqual(removed.files, [DS('ai-gateway'), SEC('api-platform')]);
  assert.deepEqual(removed.owners, ['api-team', 'gateway-team']);
});

test('PR: errors in files the PR does not touch are reported but do not block it', () => {
  // The latest merged manifest already carries a problem in api-manager's file
  // (main broke after two PRs that each passed alone).
  const w = world();
  spaceIn(w, 'api-manager').latest = '4.8.0';
  const base = compose(inputsOf(w)).manifest;
  const other = world();
  other.sections['api-platform'].title = 'API Platform docs';
  const r = composePr(base, { navigation: { file: NAV, data: other.nav }, sections: { 'api-platform': { file: SEC('api-platform'), data: other.sections['api-platform'] } } });
  assert.equal(r.ok, true);
  assert.deepEqual(codes(r.issues), ['latest']);
  assert.match(formatIssues(r.issues, { changed: r.changed }), /\(not caused by this change\)/);
});

test('PR, through the CLI: --base and a Content repo checkout', () => {
  const dir = tmp();
  writeTree(dir, world());
  const base = path.join(dir, 'base.json');
  assert.equal(run('compose', '--navigation', path.join(dir, 'navigation'), '--content', path.join(dir, 'content'), '--platform-root', dir, '--out', base).status, 0);
  // The PR's checkout of docs-api-platform sets a latest that names no Edition.
  const pr = path.join(dir, 'pr');
  fs.cpSync(path.join(dir, 'content', 'docs-api-platform'), pr, { recursive: true });
  const f = path.join(pr, 'api-manager', 'docspace.yaml');
  const m = yaml.load(fs.readFileSync(f, 'utf8'));
  m.latest = '4.6.1';
  fs.writeFileSync(f, yaml.dump(m));
  const r = run('compose', '--pr', '--base', base, '--repo', 'wso2/docs-api-platform', '--repo-dir', pr);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /error \[latest\] api-manager: latest is "4\.6\.1"/);
  assert.match(r.stdout, /in wso2\/docs-api-platform:api-manager\/docspace\.yaml \(owners: apim-team\)/);
  assert.match(r.stdout, /this change touches wso2\/docs-api-platform:api-manager\/docspace\.yaml/);
  assert.match(r.stdout, /1 blocking error in this change \(owners: apim-team\)/);
  // A Platform PR from this checkout with nothing changed passes.
  const ok = run('compose', '--pr', '--base', base, '--navigation', path.join(dir, 'navigation'), '--platform-root', dir);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  // A Platform PR that also carries Content repo checkouts.
  const both = run('compose', '--pr', '--base', base, '--navigation', path.join(dir, 'navigation'), '--platform-root', dir, '--content', path.join(dir, 'content'));
  assert.equal(both.status, 0, both.stdout + both.stderr);
  fs.writeFileSync(path.join(dir, 'content', 'docs-api-platform', 'api-manager', 'docspace.yaml'), yaml.dump(m));
  const broken = run('compose', '--pr', '--base', base, '--navigation', path.join(dir, 'navigation'), '--platform-root', dir, '--content', path.join(dir, 'content'));
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /error \[latest\]/);
  assert.throws(() => readPrInputs(JSON.parse(fs.readFileSync(base, 'utf8')), { repo: 'wso2/docs-elsewhere', repoDir: pr }), /not in navigation\.yaml's contentRepos/);
});

test('compose --as-base: a Platform PR is checked even while main has errors, which it lists as not caused by the PR', () => {
  const dir = tmp();
  const w = world();
  spaceIn(w, 'api-manager').latest = '4.8.0';
  writeTree(dir, w);
  const base = path.join(dir, 'base.json');
  const args = ['--navigation', path.join(dir, 'navigation'), '--content', path.join(dir, 'content'), '--platform-root', dir, '--out', base];
  // Without it there is no base at all (no last good copy in a PR's runner).
  const plain = run('compose', ...args);
  assert.equal(plain.status, 1);
  assert.ok(!fs.existsSync(base));
  const r = run('compose', '--as-base', ...args);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /wrote the base .*base\.json \(3 Doc spaces.*; main has 1 error, which the PR check lists as not caused by the PR/);
  // A section change on top passes, and the error on main is listed, not blocking.
  w.sections['api-platform'].title = 'API Platform docs';
  writeTree(dir, w);
  const pr = run('compose', '--pr', '--base', base, '--navigation', path.join(dir, 'navigation'), '--platform-root', dir);
  assert.equal(pr.status, 0, pr.stdout + pr.stderr);
  assert.match(pr.stdout, /error \[latest\] api-manager: latest is "4\.8\.0"[\s\S]*\(not caused by this change\)/);
  assert.match(pr.stdout, /1 error not caused by this change \(already on main\)/);
  assert.equal(run('compose', '--as-base', '--navigation', path.join(dir, 'navigation')).status, 1, '--out is required');
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github', 'workflows', 'compose-check.yml'), 'utf8'));
  assert.match(wf.jobs.compose.steps.find((s) => s.name === 'Compose the latest merged manifest (main)').run, /compose --as-base /);
});

// --- The Platform's own manifests ----------------------------------------------
test('the suite\'s default world (fixtures/content-repos/, the Pilot\'s Doc space manifests) composes, keeping every field readers use', () => {
  const { manifest, issues } = compose(readInputs());
  assert.deepEqual(errorsIn(issues), [], formatIssues(issues));
  assert.deepEqual(issues.filter((i) => i.level === 'warning').map((i) => i.message), [
    'section identity-platform\'s products-menu label "Security Token Service" differs from the Doc space\'s name, "Identity Platform Cloud"',
  ]);
  assert.deepEqual(manifest.families, ['Agent Platform', 'API Platform', 'Integration Platform', 'Identity Platform', 'Engineering Platform', 'Solutions', 'Other']);
  const pub = publicManifest(manifest);
  const is = pub.docSpaces['identity-server'];
  // Every field the chrome, switching, search and release code read today.
  for (const k of ['displayName', 'family', 'model', 'status', 'latest', 'editions', 'editionNames', 'repo', 'editLinks', 'issues', 'cloud', 'listed']) assert.ok(k in is, k);
  assert.deepEqual({ model: is.model, latest: is.latest, family: is.family, cloud: is.cloud }, { model: 'versions-only', latest: '7.3.0', family: 'Identity Platform', cloud: { in: 'identity-platform' } });
  assert.deepEqual(is.editions.map((e) => `${e.id}:${e.status}`), ['7.3.0:live', '7.2.0:live', '7.1.0:legacy', '7.0.0:legacy', '6.1.0:legacy', '6.0.0:legacy']);
  assert.deepEqual(pub.docSpaces['identity-platform'].editions, [{ id: 'cloud', status: 'live', parts: ['identity-server'] }]);
  assert.equal(pub.docSpaces['identity-platform'].latest, 'cloud');
  // The release pipeline's inputs stay in the composed file: prefixed tags and branches, and where each Doc space is.
  assert.deepEqual(['identity-server', 'api-manager', 'ai-gateway', 'api-platform', 'identity-platform', 'sandbox'].map((x) => manifest.docSpaces[x].tagPrefix), ['identity-server/', 'api-manager/', 'ai-gateway/', 'api-platform/', 'identity-platform/', '']);
  assert.equal(manifest.docSpaces['ai-gateway'].editions.find((e) => e.id === '2026.09.24').branch, 'ai-gateway/release/2026.09.24');
  assert.equal(manifest.docSpaces['ai-gateway'].latest, '1.2.0', 'the first Self-hosted Edition in manifest order, not the highest version');
  assert.equal(manifest.docSpaces['ai-gateway'].source.file, 'wso2/docs-api-platform:ai-gateway/docspace.yaml');
  assert.ok(!fs.existsSync(path.join(root, 'manifest', 'policy.yaml')), 'manifest/policy.yaml is gone');
  assert.ok(!fs.existsSync(path.join(root, 'fixtures', 'release-pipeline-content')), 'the old-shape test world is gone');
});

test('the Pilot in the target layout (fixtures/pilot-target) composes: the one shape, Cloud parts and prefixed branches', () => {
  const nav = path.join(tmp(), 'navigation');
  fs.cpSync(path.join(root, 'navigation'), nav, { recursive: true });
  // Since ticket 16, API Platform Cloud and AI Gateway are on WSO2 Docs.
  const data = yaml.load(fs.readFileSync(path.join(nav, 'navigation.yaml'), 'utf8'));
  assert.ok(!data.notYetOnWso2Docs['api-platform'] && !data.notYetOnWso2Docs['ai-gateway'] && !data.notYetOnWso2Docs['api-gateway']);
  assert.ok(!data.contentRepos.some((r) => r.repo === 'wso2/docs-api-manager'), 'API Manager has joined docs-api-platform');
  const { manifest, issues } = compose(readInputs({ navigationDir: nav, contentDir: path.join(root, 'fixtures', 'pilot-target') }));
  assert.deepEqual(errorsIn(issues), [], formatIssues(issues));
  assert.deepEqual(issues.filter((i) => i.level === 'warning').map((i) => i.code), ['label-differs']);
  const d = manifest.docSpaces;
  assert.deepEqual(Object.keys(d).slice(0, 8), ['api-platform', 'api-manager', 'api-gateway', 'ai-gateway', 'identity-platform', 'identity-server', 'sandbox', 'contribute']);
  assert.deepEqual([d['identity-platform'].model, d['identity-platform'].latest, d['identity-platform'].editions[0].parts], ['cloud-only', 'cloud', ['identity-server']]);
  assert.deepEqual([d['identity-server'].model, d['identity-server'].latest, d['identity-server'].cloud], ['versions-only', '7.3.0', { in: 'identity-platform' }]);
  assert.deepEqual(d['identity-server'].editions.filter((e) => e.status !== 'legacy').map((e) => e.branch), ['identity-server/release/7.3.0', 'identity-server/release/7.2.0']);
  assert.equal(d['identity-server'].tagPrefix, 'identity-server/');
  assert.equal(d['identity-platform'].editions[0].branch, 'main');
  assert.equal(d['api-manager'].repo, 'wso2/docs-api-platform');
  assert.deepEqual(d['api-manager'].editions.slice(0, 2).map((e) => e.branch), ['api-manager/release/4.7.0', 'api-manager/release/4.6.0']);
  // Manifest order, never sorted: 1.2.0 (the newest release) before the date version.
  assert.deepEqual(d['ai-gateway'].editions.map((e) => `${e.id}:${e.status}`), ['1.2.0:live', '2026.09.24:live', '1.1.0:legacy', '1.0.0:legacy']);
  assert.equal(d['ai-gateway'].latest, '1.2.0');
  assert.deepEqual(d['ai-gateway'].editions.slice(0, 2).map((e) => e.branch), ['ai-gateway/release/1.2.0', 'ai-gateway/release/2026.09.24']);
  assert.deepEqual([d['api-platform'].model, d['api-platform'].editions[0].parts], ['cloud-only', ['ai-gateway', 'api-gateway']]);
  assert.deepEqual([d['api-gateway'].model, d['api-gateway'].latest, d['api-gateway'].cloud], ['versions-only', '1.2.0', { in: 'api-platform' }]);
  assert.deepEqual(manifest.sections['api-platform'].menu.map((m) => `${m.docSpace}:${m.versionIn}`), ['api-platform:header', 'api-manager:menu', 'api-gateway:menu', 'ai-gateway:menu']);
  assert.equal(d.sandbox.tagPrefix, '', 'a repo with one Doc space keeps unprefixed branches');
  assert.deepEqual(manifest.sections['identity-platform'].menu.map((m) => `${m.docSpace}:${m.versionIn}`), ['identity-platform:header', 'identity-server:menu']);
});

test('every section manifest has a CODEOWNERS entry naming its team', () => {
  const owners = fs.readFileSync(path.join(root, '.github', 'CODEOWNERS'), 'utf8');
  const files = fs.readdirSync(path.join(root, 'navigation', 'sections'));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const { owners: { team } } = yaml.load(fs.readFileSync(path.join(root, 'navigation', 'sections', f), 'utf8'));
    assert.match(owners, new RegExp(`^/navigation/sections/${f.replace('.', '\\.')}\\s+@wso2/${team}$`, 'm'), f);
  }
  assert.match(owners, /^\/navigation\/navigation\.yaml\s+@wso2\/docs-platform$/m);
  assert.ok(!fs.existsSync(path.join(root, 'manifest', 'policy.yaml')), 'manifest/policy.yaml is gone');
});

test('a Doc space manifest in the new layout builds without a model: its Editions give it', () => {
  const dir = tmp();
  fs.cpSync(path.join(root, 'fixtures', 'pilot-target', 'docs-identity-platform', 'identity-server'), dir, { recursive: true });
  assert.equal(loadContentRepo(dir).docspace.model, 'versions-only');
  assert.equal(loadContentRepo(path.join(root, 'fixtures', 'stub-repo', 'identity-server')).docspace.model, 'versions-only');
  assert.equal(loadContentRepo(path.join(root, 'fixtures', 'stub-repo', 'identity-platform')).docspace.model, 'cloud-only');
});

test('a repo\'s tags never go to a Doc space that is not on WSO2 Docs yet', () => {
  const dir = tmp();
  fs.cpSync(path.join(root, 'fixtures', 'content-repos'), dir, { recursive: true });
  const file = path.join(dir, 'docs-api-platform', 'ai-gateway', 'docspace.yaml');
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}status: legacy\nlegacyUrl: https://wso2.com/api-platform/docs/\n`);
  const policy = composeOrThrow({ contentDir: dir });
  assert.equal(policy.docSpaces['ai-gateway'].status, 'legacy');
  assert.throws(() => planRelease(policy, { repo: 'wso2/docs-api-platform', tag: 'ai-gateway/1.2.0-docs.1' }), /names Doc space "ai-gateway", which is not in wso2\/docs-api-platform/);
  assert.deepEqual(planRelease(policy, { repo: 'wso2/docs-api-platform', tag: 'api-manager/4.7.0-docs.1' }).map((d) => `${d.space}/${d.segment}`), ['api-manager/latest', 'api-manager/4.7.0']);
});

test('the compose command runs from the Platform checkout with its defaults', () => {
  const out = path.join(tmp(), 'manifest.json');
  const stdout = execFileSync(process.execPath, [cli, 'compose', '--out', out], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });
  assert.match(stdout, /8 Doc spaces, 2 Docs sections, 19 products not on WSO2 Docs yet/);
  // Without --content or WSO2_DOCS_CONTENT_REPOS: the checkouts next to the Platform's.
  const env = { ...process.env, GITHUB_ACTIONS: '' };
  delete env.WSO2_DOCS_CONTENT_REPOS;
  assert.equal(defaultContentDir(env), path.dirname(root));
  const dir = tmp();
  for (const repo of ['docs-identity-platform', 'docs-api-platform', 'docs-sandbox']) fs.cpSync(path.join(root, 'fixtures', 'content-repos', repo), path.join(dir, repo), { recursive: true });
  const real = execFileSync(process.execPath, [cli, 'compose', '--content', dir, '--out', path.join(dir, 'm.json')], { encoding: 'utf8', env });
  assert.match(real, /8 Doc spaces, 2 Docs sections, 19 products not on WSO2 Docs yet/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'm.json'), 'utf8')).docSpaces['identity-platform'].model, 'cloud-only');
  const missing = spawnSync(process.execPath, [cli, 'compose', '--content', tmp(), '--out', path.join(dir, 'x.json')], { encoding: 'utf8', env });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /missing-repo.*no checkout of wso2\/docs-identity-platform/);
  const m = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(m.composedAt && m.sources.navigation.file === NAV);
});

// --- Extension points: team notices and link entries --------------------------
test('notices: Editions they name must exist (a Cloud part\'s Cloud counts), and an ended one warns', () => {
  let w = world();
  spaceIn(w, 'ai-gateway').notices = [
    { text: 'Cloud part notice.', level: 'info', editions: ['cloud'] },
    { text: '2026.09.24 is a short-term release.', level: 'warning', editions: ['2026.09.24'], until: '2099-12-31' },
  ];
  let r = composeWorld(w, { now: new Date('2026-10-26T00:00:00Z') });
  assert.deepEqual(errorsIn(r.issues), [], formatIssues(r.issues));
  assert.deepEqual(r.manifest.docSpaces['ai-gateway'].notices.map((n) => n.level), ['info', 'warning']);
  assert.equal(publicManifest(r.manifest).docSpaces['ai-gateway'].notices.length, 2, 'published for the chrome to read at runtime');

  w = world();
  spaceIn(w, 'api-manager').notices = [{ text: 'Old release.', level: 'info', editions: ['4.5.0'] }];
  assertError(w, 'unknown-edition', { files: [DS('api-manager')], owners: ['apim-team'], match: /notice 1 applies to Edition 4\.5\.0, which is a Legacy version/ });
  w = world();
  spaceIn(w, 'api-manager').notices = [{ text: 'Cloud?', level: 'info', editions: ['cloud'] }];
  assertError(w, 'unknown-edition', { match: /notice 1 applies to Edition cloud, which it does not have/ });

  w = world();
  spaceIn(w, 'api-manager').notices = [{ text: 'Maintenance on 1 October.', level: 'warning', until: '2026-10-01' }];
  r = composeWorld(w, { now: new Date('2026-10-26T00:00:00Z') });
  assert.deepEqual(errorsIn(r.issues), []);
  assert.deepEqual(only(r.issues, 'notice-ended').map((i) => [i.level, i.message]), [['warning', 'api-manager: notice 1 ended on 2026-10-01 and is no longer shown; remove it']]);
  w = world();
  spaceIn(w, 'api-manager').notices = [{ text: 'x', level: 'danger' }];
  assertError(w, 'schema', { match: /notices\.0\.level: must be one of info, warning/ });
});

test('link entries: a label and an external URL, shown with ↗; never a WSO2 Docs page, never twice', () => {
  let w = world();
  w.sections['api-platform'].menu.push({ label: 'Ballerina', url: 'https://ballerina.io/' }, { label: 'Old API Manager docs', url: 'https://apim.docs.wso2.com/en/latest/' });
  const { manifest, issues } = composeWorld(w);
  assert.deepEqual(errorsIn(issues), [], formatIssues(issues));
  assert.deepEqual(manifest.sections['api-platform'].menu.slice(3), [{ label: 'Ballerina', url: 'https://ballerina.io/' }, { label: 'Old API Manager docs', url: 'https://apim.docs.wso2.com/en/latest/' }]);
  const published = publicManifest(manifest);
  assert.deepEqual(published.sections['api-platform'].menu.slice(3).map((m) => m.label), ['Ballerina', 'Old API Manager docs'], 'link entries are published with the section');

  w = world();
  w.sections['api-platform'].menu.push({ label: 'AI Gateway docs', url: 'https://docs.wso2.com/ai-gateway/latest/' });
  assertError(w, 'link-internal', { files: [SEC('api-platform')], owners: ['api-team'], match: /points into WSO2 Docs.*list that Doc space as a menu entry/ });
  w = world();
  w.sections['api-platform'].menu.push({ label: 'Ballerina', url: 'https://ballerina.io/' }, { label: 'Ballerina', url: 'https://central.ballerina.io/' });
  assertError(w, 'duplicate', { match: /two links labelled "Ballerina"/ });
  w = world();
  w.sections['api-platform'].menu.push({ label: 'Insecure', url: 'http//example.com' });
  assertError(w, 'schema', { files: [SEC('api-platform')] });
});

// The products not on WSO2 Docs yet follow spec/product-placement.md: every
// placed Doc space outside the Pilot (Unlisted ones aside) has an entry under
// its slug, in its group, with the kind the placement gives; the links out are
// the placement's links out, and nothing else is listed.
test('notYetOnWso2Docs follows the product placement', () => {
  const nav = yaml.load(fs.readFileSync(path.join(root, 'navigation', 'navigation.yaml'), 'utf8'));
  const groupId = Object.fromEntries([...nav.families, ...nav.groups].map((g) => [g.name, g.id]));
  const placement = fs.readFileSync(path.join(root, 'spec', 'product-placement.md'), 'utf8');
  const table = placement.slice(placement.indexOf('## The table'), placement.indexOf('## Products-menu entries'));
  const expected = {};
  for (const line of table.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Group') && !l.startsWith('|---'))) {
    const [group, space, kind, editions, , , , pilot] = line.split('|').slice(1).map((c) => c.trim());
    const slug = /`([a-z0-9-]+)`/.exec(space)?.[1];
    if (!slug || !groupId[group] || pilot.startsWith('Yes')) continue;
    const model = kind === 'Family Cloud' ? 'cloud-only' : editions === 'unversioned' ? 'unversioned' : 'versions-only';
    expected[slug] = { in: groupId[group], model };
  }
  const listed = Object.fromEntries(Object.entries(nav.notYetOnWso2Docs).filter(([, e]) => e.model !== 'links-out').map(([slug, e]) => [slug, { in: e.in, model: e.model }]));
  assert.deepEqual(listed, expected);
  const linksOut = Object.values(nav.notYetOnWso2Docs).filter((e) => e.model === 'links-out').map((e) => [e.in, e.displayName]);
  assert.deepEqual(linksOut, [
    ['integration-platform', 'Micro Integrator'], ['integration-platform', 'Streaming Integrator'], ['integration-platform', 'Ballerina Integrator'],
    ['integration-platform', 'Enterprise Integrator'], ['integration-platform', 'Ballerina'], ['engineering-platform', 'OpenChoreo'],
  ]);
});
