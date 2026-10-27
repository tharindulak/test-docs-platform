// Release pipeline for directories, Cloud parts and addresses: the family
// Cloud tree (its parts from the same checkout, one sidebar), docs: links
// checked against the build being checked, and releases that read the
// composed Deployment manifest compose stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudPartOf, cloudPartSlugs, drawTree, foreignItems, loadCloudParts, partEditionName } from '../lib/cloud-tree.mjs';
import { loadContentRepo } from '../lib/content.mjs';
import { withOwnBuild } from '../lib/check/index.mjs';
import { COMPOSED_KEY } from '../lib/compose.mjs';
import { compileRedirects } from '../plugins/platform-outputs.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stub = path.join(root, 'fixtures', 'stub-repo');
const release = path.join(root, 'bin', 'wso2-release.mjs');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `wso2-${name}-`));

test('a family Cloud build reads its Cloud parts beside it in the same checkout', () => {
  const family = loadContentRepo(path.join(stub, 'identity-platform'));
  assert.deepEqual(cloudPartSlugs(family.docspace), ['identity-server']);
  const [part] = loadCloudParts(family, 'cloud');
  assert.equal(part.slug, 'identity-server');
  assert.equal(part.repo.docsDir, path.join(stub, 'identity-server', 'docs'));
  assert.deepEqual([part.pluginId, part.routeBasePath, part.editionName], ['part-identity-server', 'identity-server', 'Identity Server Cloud']);
  assert.deepEqual(loadCloudParts(family, '7.3.0'), [], 'only the Cloud Edition has parts');
  assert.deepEqual(loadCloudParts(loadContentRepo(path.join(stub, 'identity-server')), 'cloud'), [], 'a part has none');
  assert.equal(cloudPartOf(loadContentRepo(path.join(stub, 'identity-server')).docspace), 'identity-platform');
  assert.equal(cloudPartOf(family.docspace), null);
  assert.equal(partEditionName({ displayName: 'AI Gateway' }), 'AI Gateway Cloud');
  assert.equal(partEditionName({ displayName: 'X', editionNames: { cloud: 'X SaaS' } }), 'X SaaS');

  // A part missing from the checkout, or one that does not point back, stops the build.
  const dir = tmp('cloud-tree');
  fs.cpSync(stub, dir, { recursive: true });
  const repo = () => loadContentRepo(path.join(dir, 'identity-platform'));
  fs.writeFileSync(path.join(dir, 'identity-server', 'docspace.yaml'), fs.readFileSync(path.join(dir, 'identity-server', 'docspace.yaml'), 'utf8').replace('  in: identity-platform', '  in: api-platform'));
  assert.throws(() => loadCloudParts(repo(), 'cloud'), /does not point back: its cloud\.in is api-platform/);
  fs.rmSync(path.join(dir, 'identity-server'), { recursive: true });
  assert.throws(() => loadCloudParts(repo(), 'cloud'), /lists Cloud part "identity-server", but .* has no docspace\.yaml: a family Cloud is built from one checkout/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('one sidebar for the tree: a group per Cloud part after Get started; other instances as links', () => {
  const siteDir = path.join(root, 'site');
  const famDocs = path.join(stub, 'identity-platform', 'docs');
  const partDocs = path.join(stub, 'identity-server', 'docs');
  const src = (docsDir, rel) => `@site/${path.relative(siteDir, path.join(docsDir, rel)).split(path.sep).join('/')}`;
  const family = {
    id: 'default', docsDir: famDocs, siteDir, baseUrl: '/identity-platform/cloud/', label: 'Identity Platform Cloud',
    items: [{ type: 'doc', id: 'index' }, { type: 'category', label: 'Get started', items: [{ type: 'doc', id: 'get-started/first-organization' }] }, { type: 'category', label: 'Guides', items: [{ type: 'doc', id: 'guides/x' }] }],
    docs: [
      { id: 'index', title: 'Identity Platform Cloud', frontMatter: { sidebar_label: 'Overview' }, source: src(famDocs, 'index.mdx') },
      { id: 'get-started/first-organization', title: 'First org', frontMatter: {}, source: src(famDocs, 'get-started/first-organization.mdx') },
      { id: 'guides/x', title: 'X', frontMatter: {}, source: src(famDocs, 'guides/x.mdx') },
    ],
  };
  const part = {
    id: 'part-identity-server', slug: 'identity-server', docsDir: partDocs, siteDir, baseUrl: '/identity-platform/cloud/identity-server/', label: 'Identity Server',
    items: [{ type: 'doc', id: 'index' }, { type: 'category', label: 'Guides', link: { type: 'doc', id: 'guides/index' }, items: [{ type: 'doc', id: 'guides/mfa' }] }],
    docs: [
      { id: 'index', title: 'Home', frontMatter: {}, source: src(partDocs, 'index.mdx') },
      { id: 'guides/index', title: 'Guides', frontMatter: {}, source: src(partDocs, 'guides/index.mdx') },
      { id: 'guides/mfa', title: 'MFA', frontMatter: { slug: 'multi-factor' }, source: src(partDocs, 'guides/mfa.mdx') },
    ],
  };
  // On a family page: its own docs, the part as links.
  const own = drawTree({ family, parts: [part], self: 'default' });
  assert.deepEqual(own.map((i) => i.label ?? i.id), ['index', 'Get started', 'Identity Server', 'Guides']);
  assert.deepEqual(own[2].items, [
    { type: 'link', label: 'Home', href: '/identity-platform/cloud/identity-server/' },
    { type: 'category', label: 'Guides', collapsed: true, items: [{ type: 'link', label: 'Guides', href: '/identity-platform/cloud/identity-server/guides/' }, { type: 'link', label: 'MFA', href: '/identity-platform/cloud/identity-server/guides/multi-factor/' }] },
  ]);
  assert.equal(own[2].collapsed, true);
  assert.deepEqual(own[2].customProps, { cloudPart: 'identity-server' });
  // On a part page: the family as links, the part's own group open with its home as the group's link.
  const inPart = drawTree({ family, parts: [part], self: 'part-identity-server' });
  assert.deepEqual(inPart[0], { type: 'link', label: 'Overview', href: '/identity-platform/cloud/' });
  assert.deepEqual(inPart[2].link, { type: 'doc', id: 'index' });
  assert.equal(inPart[2].collapsed, false);
  assert.deepEqual(inPart[2].items, [part.items[1]]);
  // No Get started in the family: the groups follow the leading pages.
  const noGs = drawTree({ family: { ...family, items: [family.items[0], family.items[2]] }, parts: [part], self: 'default' });
  assert.deepEqual(noGs.map((i) => i.label ?? i.id), ['index', 'Identity Server', 'Guides']);
  assert.deepEqual(foreignItems([{ type: 'doc', id: 'gone' }], family), [], 'an unknown doc is left out');
});

test('a Cloud part\'s redirects compile under its platform\'s Cloud address', () => {
  const redirects = { moves: [{ from: 'guides/old', to: 'guides/new' }], legacy: [{ from: 'https://wso2.com/asgardeo/docs/guides/', to: 'guides' }, { from: 'https://wso2.com/asgardeo/docs/', to: '' }, { from: 'https://x.example/a/', to: 'https://elsewhere.example/' }] };
  assert.deepEqual(compileRedirects(redirects, { baseUrl: '/identity-platform/cloud/identity-server/' }), [
    { from: '/identity-platform/cloud/identity-server/guides/old/', to: '/identity-platform/cloud/identity-server/guides/new/', status: 301 },
    { from: 'https://wso2.com/asgardeo/docs/guides/', to: '/identity-platform/cloud/identity-server/guides/', status: 301 },
    { from: 'https://wso2.com/asgardeo/docs/', to: '/identity-platform/cloud/identity-server/', status: 301 },
    { from: 'https://x.example/a/', to: 'https://elsewhere.example/', status: 301 },
  ]);
});

test('docs: links into the deployment being checked use its own build, also from a part built on its own', async () => {
  const dir = tmp('own-build');
  const write = (meta, pages) => {
    fs.mkdirSync(path.join(dir, '_platform'), { recursive: true });
    fs.writeFileSync(path.join(dir, '_platform', 'edition.json'), JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, '_platform', 'pages.json'), JSON.stringify(pages));
  };
  const staging = async (space, segment) => (space === 'api-platform' && segment === 'cloud' ? [{ path: 'guides/old/' }, { path: 'ai-gateway/stale/' }] : space === 'api-manager' ? [{ path: '' }] : null);
  write({ edition: 'cloud', baseUrl: '/api-platform/cloud/' }, [{ path: '' }, { path: 'ai-gateway/guardrails/' }]);
  let routes = withOwnBuild(staging, dir);
  assert.deepEqual((await routes('api-platform', 'cloud')).map((p) => p.path), ['', 'ai-gateway/guardrails/'], 'the family tree answers for itself');
  assert.deepEqual(await routes('api-manager', 'latest'), [{ path: '' }]);
  write({ edition: 'cloud', baseUrl: '/api-platform/cloud/ai-gateway/' }, [{ path: '' }, { path: 'guardrails/' }]);
  routes = withOwnBuild(staging, dir);
  assert.deepEqual((await routes('api-platform', 'cloud')).map((p) => p.path), ['ai-gateway/', 'ai-gateway/guardrails/', 'guides/old/'], 'a part built alone: its pages, plus the rest of the deployed tree');
  write({ edition: '_', baseUrl: '/contribute/' }, [{ path: 'style/' }]);
  assert.deepEqual(await withOwnBuild(staging, dir)('contribute', '_'), [{ path: 'style/' }]);
  assert.equal(withOwnBuild(staging, path.join(dir, 'nope')), staging, 'no build: the route lists only');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('releases read the composed manifest compose stored (the last good copy), and builds get it with composed', () => {
  const store = tmp('store');
  const run = (...args) => spawnSync(process.execPath, [release, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });
  // No stored copy yet: the release composes from the local checkouts, and says so.
  let r = run('plan', '--repo', 'wso2/docs-api-platform', '--tag', 'ai-gateway/1.2.0-docs.1', '--storage', `file:${store}`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /has no _platform\/composed\.json yet/);
  assert.equal(run('composed', '--storage', `file:${store}`, '--out', path.join(store, 'x.json')).status, 1);
  // compose --storage stores it; the plan then reads that copy, not the checkouts.
  r = run('compose', '--storage', `file:${store}`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const file = path.join(store, ...COMPOSED_KEY.split('/'));
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  stored.docSpaces['ai-gateway'].latest = '2026.09.24';
  fs.writeFileSync(file, JSON.stringify(stored));
  r = run('plan', '--repo', 'wso2/docs-api-platform', '--tag', 'ai-gateway/2026.09.24-docs.1', '--storage', `file:${store}`);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /composing from the local checkouts/);
  assert.equal(JSON.parse(r.stdout).flip, 'ai-gateway/latest=2026.09.24-docs.1 ai-gateway/2026.09.24=2026.09.24-docs.1', 'the stored copy decides latest');
  // --policy still wins.
  const local = path.join(store, 'local.json');
  execFileSync(process.execPath, [release, 'compose', '--out', local], { env: { ...process.env, GITHUB_ACTIONS: '' } });
  r = run('plan', '--repo', 'wso2/docs-api-platform', '--tag', 'ai-gateway/2026.09.24-docs.1', '--storage', `file:${store}`, '--policy', local);
  assert.equal(JSON.parse(r.stdout).flip, 'ai-gateway/2026.09.24=2026.09.24-docs.1');
  const out = path.join(store, 'for-build.json');
  assert.match(run('composed', '--storage', `file:${store}`, '--out', out).stdout, /Wrote .*for-build\.json from file:.* _platform\/composed\.json/);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).docSpaces['ai-gateway'].latest, '2026.09.24');
  fs.rmSync(store, { recursive: true, force: true });
});
