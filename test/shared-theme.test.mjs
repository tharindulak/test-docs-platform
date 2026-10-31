// The shared theme without rebuilding: which Platform releases only publish
// the theme, its immutable storage, the pointer per Platform major, rollback
// and gc, the theme checks' pages, the note a rollback to a pre-theme release
// prints, and the Edge Worker's /_platform/theme/ route with its two caches.
// Bundles here are fixture folders: lib/theme-bundle.mjs writes the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPolicy } from '../lib/manifest.mjs';
import { FsStorage } from '../lib/storage.mjs';
import { flip, gc, publishPreview, publishRelease, readState, rollback } from '../lib/release.mjs';
import {
  baselineConfig, checkThemeBundle, compareA11y, flipTheme, listThemes, publishTheme, rollbackTheme, sharedThemeOf, themeCheckPages, themeIdFor, themeUrlBase,
} from '../lib/shared-theme.mjs';
import { spawnSync } from 'node:child_process';
import {
  THEME_PATH, onlyVersionChanged, platformReleaseChanges, previousPlatformRelease,
} from '../lib/platform-release.mjs';
import worker from '../worker/src/index.mjs';
import { IMMUTABLE_CACHE, THEME_LIVE_CACHE, themeRoute } from '../worker/src/routing.mjs';

const policy = loadPolicy();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-theme-'));
const at = (n) => new Date(Date.UTC(2026, 9, 28, 0, n));

// A bundle as lib/theme-bundle.mjs writes it for `id`: theme.css whose url()s
// name the bundle's own folder, plus fonts/ and img/.
function bundle(id, { major = 1, colour = '#b25000', urlBase = themeUrlBase(major, id) } = {}) {
  const dir = tmp();
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), data);
  };
  write('theme.css', `/* ${id} */\n@font-face { font-family: Inter; src: url("${urlBase}fonts/inter.woff2") format("woff2"); }\n`
    + `:root { --wso2-link: ${colour}; --wso2-logo: url(${urlBase}img/logo.svg); --x: url("data:image/svg+xml,%3Csvg/%3E"); }\n`);
  write('fonts/inter.woff2', `font ${id}`);
  write('img/logo.svg', `<svg>${id}</svg>`);
  write('img/favicon.ico', 'ico');
  return dir;
}

function fakeBuild(space, segment, edition, { themed = true, platformVersion = '1.4.0' } = {}) {
  const dir = tmp();
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data));
  };
  const head = themed ? '<link rel="stylesheet" href="/_platform/theme/v1/theme.css">' : '<link rel="stylesheet" href="/assets/css/styles.0123abcd.css">';
  write('index.html', `<html><head>${head}</head><body>${space}</body></html>`);
  write('404.html', `<html><head>${head}</head><body>404</body></html>`);
  write('sitemap.xml', '<urlset/>');
  write('_platform/edition.json', { docSpace: space, edition, asLatest: segment === 'latest', baseUrl: segment === '_' ? `/${space}/` : `/${space}/${segment}/`, platformVersion });
  write('_platform/pages.json', [{ path: '' }, { path: 'get-started/' }, { path: 'guides/mfa/' }]);
  write('_platform/redirects.json', []);
  return dir;
}

const text = async (s, key) => new TextDecoder().decode((await s.get(key)).body);

test('a Platform release only publishes the theme when every change since the last one is in the theme or unbuilt', () => {
  assert.equal(THEME_PATH, 'site/wso2-theme/');
  const only = (files, versionOnly) => platformReleaseChanges(files, { versionOnly }).rebuild;
  assert.equal(only(['site/wso2-theme/tokens.css', 'site/wso2-theme/img/logo.svg']), false);
  assert.equal(only(['site/wso2-theme/tokens.css', 'spec/releases-and-deployments.md', 'test/x.test.mjs', '.scratch/m/map.md', 'GLOSSARY.md', 'README.md', 'AGENTS.md']), false);
  assert.equal(only([]), false, 'nothing changed (a re-tag): publish the theme, rebuild nothing');
  assert.equal(only(['site/src/css/chrome.css']), true, 'other site/ files are built into pages');
  assert.equal(only(['site/wso2-theme/tokens.css', 'plugins/platform-outputs.mjs']), true);
  assert.equal(only(['standards/contribute/docs/index.mdx']), true, 'Markdown below the root is content');
  assert.equal(only(['worker/src/index.mjs']), true, 'the rule lists what no build reads; everything else rebuilds');
  assert.equal(only(['spec2/x.md', 'site/wso2-themes/x.css']), true, 'folder prefixes, not name prefixes');
  // package.json and its lock count only when nothing but the version changed.
  assert.equal(only(['package.json', 'package-lock.json', 'site/wso2-theme/a.css'], () => true), false);
  assert.equal(only(['package.json'], () => false), true);
  assert.equal(only(['package.json'], undefined), true, 'unknown: rebuild');
  assert.equal(platformReleaseChanges(null).rebuild, true, 'no previous release to diff: rebuild');
  assert.deepEqual(platformReleaseChanges(['site/wso2-theme/a.css', 'lib/x.mjs', 'bin/y.mjs']).outside, ['lib/x.mjs', 'bin/y.mjs']);

  const pkg = (version, extra = {}) => JSON.stringify({ name: '@wso2/docs', version, dependencies: { a: '1' }, ...extra }, null, 2);
  assert.equal(onlyVersionChanged(pkg('1.4.0'), pkg('1.5.0')), true);
  assert.equal(onlyVersionChanged(pkg('1.4.0'), pkg('1.5.0', { dependencies: { a: '2' } })), false);
  const lock = (version, dep = '1') => JSON.stringify({ name: '@wso2/docs', version, lockfileVersion: 3, packages: { '': { name: '@wso2/docs', version }, 'node_modules/a': { version: dep } } });
  assert.equal(onlyVersionChanged(lock('1.4.0'), lock('1.5.0')), true, 'npm version changes the lock\'s two version fields');
  assert.equal(onlyVersionChanged(lock('1.4.0'), lock('1.5.0', '2')), false);
  assert.equal(onlyVersionChanged('not json', pkg('1')), false);

  const tags = ['v1.3.0', 'v1.4.0', 'v1.4.1', 'v2.0.0', 'v1', 'cloud-2026.10.26.1'];
  assert.equal(previousPlatformRelease('v1.5.0', tags), 'v1.4.1');
  assert.equal(previousPlatformRelease('v1.4.1', tags), 'v1.4.0', 'a re-run diffs against the release before it');
  assert.equal(previousPlatformRelease('v2.1.0', tags), 'v2.0.0');
  assert.equal(previousPlatformRelease('v1.3.0', tags), null, 'the first release rebuilds');
});

test('the theme-only path is the folder lib/theme-bundle.mjs bundles', async (t) => {
  const file = new URL('../lib/theme-bundle.mjs', import.meta.url);
  if (!fs.existsSync(file)) return t.skip('lib/theme-bundle.mjs is not in this checkout');
  const { THEME_DIR } = await import(file);
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const rel = path.isAbsolute(THEME_DIR) ? path.relative(root, THEME_DIR) : THEME_DIR;
  assert.equal(`${rel.replace(/\/$/, '').split(path.sep).join('/')}/`, THEME_PATH);
});

test('a published theme is an immutable folder by theme id; its url()s must name that folder', async () => {
  assert.equal(themeIdFor('1.4.0', '123456'), '1.4.0.r123456', 'as a rebuild\'s <release>.r<run id>');
  assert.throws(() => themeIdFor('1.4.0', '../x'), /Invalid theme id/);
  assert.equal(themeUrlBase(1, '1.4.0.r1'), '/_platform/theme/v1/1.4.0.r1/');

  const s = new FsStorage(tmp());
  const id = '1.4.0.r1';
  assert.deepEqual(checkThemeBundle(bundle(id), { major: 1, release: id }), []);
  assert.match(checkThemeBundle(bundle('1.4.0.r9'), { major: 1, release: id }).join('\n'), /outside \/_platform\/theme\/v1\/1\.4\.0\.r1\/; write the bundle with urlBase/);
  assert.match(checkThemeBundle(bundle(id, { urlBase: 'https://fonts.example.com/' }), { major: 1, release: id }).join('\n'), /outside/);
  const missing = bundle(id);
  fs.rmSync(path.join(missing, 'fonts'), { recursive: true });
  assert.match(checkThemeBundle(missing, { major: 1, release: id }).join('\n'), /names fonts\/inter\.woff2, which the bundle lacks/);
  assert.deepEqual(checkThemeBundle(tmp(), { major: 1, release: id }), ['missing theme.css']);

  const r = await publishTheme(s, bundle(id), { major: 1, release: id, platformVersion: '1.4.0', source: { sha: 'abc' }, now: at(1) });
  assert.equal(r.prefix, '_releases/_theme/v1/1.4.0.r1/');
  assert.equal(r.files, 4);
  assert.match(await text(s, '_releases/_theme/v1/1.4.0.r1/theme.css'), /url\("\/_platform\/theme\/v1\/1\.4\.0\.r1\/fonts\/inter\.woff2"\)/);
  const marker = JSON.parse(await text(s, '_releases/_theme/v1/1.4.0.r1/_platform/release.json'));
  assert.deepEqual({ ...marker, bytes: 0 }, { kind: 'theme', major: 1, release: id, publishedAt: at(1).toISOString(), files: 4, bytes: 0, platformVersion: '1.4.0', source: { sha: 'abc' } });
  assert.equal((await publishTheme(s, bundle(id, { colour: '#000' }), { major: 1, release: id })).skipped, true, 'a complete folder never changes');
  assert.doesNotMatch(await text(s, '_releases/_theme/v1/1.4.0.r1/theme.css'), /#000/);
});

test('a Docs release uploads no copy of the theme: the edge serves the published one at the host root', async () => {
  const s = new FsStorage(tmp());
  const dir = fakeBuild('sandbox', 'cloud', 'cloud');
  // As plugins/theme.mjs writes it into every build, for previews away from the edge.
  fs.cpSync(bundle('1.4.0.r1', { urlBase: '/_platform/theme/v1/' }), path.join(dir, '_platform/theme/v1'), { recursive: true });
  const r = await publishRelease(s, dir, { space: 'sandbox', segment: 'cloud', edition: 'cloud', tag: 'cloud-2026.10.28.1' });
  const keys = await s.list(r.prefix);
  assert.deepEqual(keys.filter((k) => k.includes('/theme')), [], 'no _platform/theme/ in the release folder');
  assert.ok(keys.includes(`${r.prefix}_platform/edition.json`), 'the rest of _platform/ is uploaded');
  assert.equal(r.files, keys.length - 1, 'release.json counts only what was uploaded');
});

test('a PR preview uploads no copy of the theme either: its pages load staging\'s live one', async () => {
  const s = new FsStorage(tmp());
  const dir = fakeBuild('sandbox', 'cloud', 'cloud');
  fs.cpSync(bundle('1.4.0.r1', { urlBase: '/_platform/theme/v1/' }), path.join(dir, '_platform/theme/v1'), { recursive: true });
  const r = await publishPreview(s, dir, { space: 'sandbox', pr: 12, edition: 'cloud' });
  const keys = await s.list(r.prefix);
  assert.deepEqual(keys.filter((k) => k.includes('/theme')), [], 'no _platform/theme/ in the preview');
  assert.ok(keys.includes(`${r.prefix}_platform/edition.json`), 'the rest of _platform/ is uploaded');
  assert.equal(r.files, keys.length);
});

test('going live is the pointer per major in state.json, named in manifest.json; rollback moves it back', async () => {
  const s = new FsStorage(tmp());
  await publishTheme(s, bundle('1.4.0.r1'), { major: 1, release: '1.4.0.r1', platformVersion: '1.4.0', now: at(1) });
  await publishTheme(s, bundle('1.5.0.r2'), { major: 1, release: '1.5.0.r2', platformVersion: '1.5.0', now: at(2) });
  await s.put('_releases/_theme/v1/1.5.0.r3/theme.css', 'half');
  await assert.rejects(flipTheme(s, { environment: 'staging', policy, major: 1, release: '1.5.0.r3' }), /Theme v1\/1\.5\.0\.r3 is missing or incomplete/);

  // A Docs deployment flips as before; the theme pointer sits beside the deployments.
  await publishRelease(s, fakeBuild('sandbox', 'cloud', 'cloud'), { space: 'sandbox', segment: 'cloud', edition: 'cloud', tag: 'cloud-2026.10.28.1', now: at(0) });
  await flip(s, { environment: 'staging', policy, deployments: [{ space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.28.1' }], now: at(0) });

  let r = await flipTheme(s, { environment: 'staging', policy, major: 1, release: '1.4.0.r1', now: at(3) });
  assert.equal(r.from, null);
  r = await flipTheme(s, { environment: 'staging', policy, major: 1, release: '1.5.0.r2', now: at(4) });
  assert.equal(r.from, '1.4.0.r1');
  let state = await readState(s);
  assert.deepEqual(state.theme, { v1: { release: '1.5.0.r2', platformVersion: '1.5.0', deployedAt: at(4).toISOString(), previous: ['1.4.0.r1'] } });
  assert.equal(state.deployments['sandbox/cloud'].release, 'cloud-2026.10.28.1', 'deployments are untouched');
  let manifest = JSON.parse(await text(s, 'manifest.json'));
  assert.deepEqual(manifest.theme, { v1: { release: '1.5.0.r2' } });
  await assert.rejects(flipTheme(s, { environment: 'production', policy, major: 1, release: '1.4.0.r1' }), /holds staging state/);

  // A Docs flip republishes the manifest and keeps the theme in it.
  await flip(s, { environment: 'staging', policy, deployments: [{ space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.28.1' }], now: at(5) });
  assert.deepEqual(JSON.parse(await text(s, 'manifest.json')).theme, { v1: { release: '1.5.0.r2' } });

  // An older run reaching its flip late never moves the theme back.
  r = await flipTheme(s, { environment: 'staging', policy, major: 1, release: '1.4.0.r1', now: at(6) });
  assert.equal(r.kept, true);
  assert.match(r.warnings[0], /theme v1 stays on 1\.5\.0\.r2, published after 1\.4\.0\.r1; roll back to go back/);
  assert.equal((await readState(s)).theme.v1.release, '1.5.0.r2');

  r = await rollbackTheme(s, { environment: 'staging', policy, major: 1, now: at(7) });
  assert.equal(r.from, '1.5.0.r2');
  state = await readState(s);
  assert.equal(state.theme.v1.release, '1.4.0.r1');
  assert.deepEqual(state.theme.v1.previous, ['1.5.0.r2']);
  manifest = JSON.parse(await text(s, 'manifest.json'));
  assert.deepEqual(manifest.theme, { v1: { release: '1.4.0.r1' } });
  await rollbackTheme(s, { environment: 'staging', policy, major: 1, to: '1.5.0.r2', now: at(8) });
  assert.equal((await readState(s)).theme.v1.release, '1.5.0.r2', 'a named theme');
  await assert.rejects(rollbackTheme(s, { environment: 'staging', policy, major: 2 }), /No theme is live for v2/);

  // Another major keeps its own theme.
  await publishTheme(s, bundle('2.0.0.r9', { major: 2 }), { major: 2, release: '2.0.0.r9', now: at(9) });
  await flipTheme(s, { environment: 'staging', policy, major: 2, release: '2.0.0.r9', now: at(9) });
  assert.deepEqual(JSON.parse(await text(s, 'manifest.json')).theme, { v1: { release: '1.5.0.r2' }, v2: { release: '2.0.0.r9' } });

  const list = await listThemes(s);
  assert.deepEqual(list.map((t) => [t.major, t.release, t.live, t.previous, t.complete]), [
    ['v1', '1.5.0.r2', true, false, true], ['v1', '1.4.0.r1', false, true, true], ['v1', '1.5.0.r3', false, false, false], ['v2', '2.0.0.r9', true, false, true],
  ]);
  assert.deepEqual((await listThemes(s, { major: 2 })).map((t) => t.release), ['2.0.0.r9']);
});

test('gc keeps the newest 20 themes of each major and the live one, apart from the Docs releases\' 5', async () => {
  const s = new FsStorage(tmp());
  for (let n = 1; n <= 23; n++) await publishTheme(s, bundle(`1.4.0.r${n}`), { major: 1, release: `1.4.0.r${n}`, now: at(n) });
  await flipTheme(s, { environment: 'staging', policy, major: 1, release: '1.4.0.r1', now: at(30) });
  await s.put('_releases/_theme/v1/1.4.0.r99/theme.css', 'uploading');
  for (let n = 1; n <= 6; n++) {
    await publishRelease(s, fakeBuild('sandbox', 'cloud', 'cloud'), { space: 'sandbox', segment: 'cloud', edition: 'cloud', tag: `cloud-2026.10.28.${n}`, now: at(n) });
  }
  const removed = await gc(s, { dryRun: true });
  assert.deepEqual(removed.filter((r) => r.startsWith('_theme/')), ['_theme/v1/1.4.0.r3', '_theme/v1/1.4.0.r2'], 'the newest 20 (r4 to r23), the live r1 and the upload in progress stay');
  assert.deepEqual(removed.filter((r) => r.startsWith('sandbox/')), ['sandbox/cloud/cloud-2026.10.28.1']);
  assert.deepEqual(await gc(s, { only: '_theme' }), ['_theme/v1/1.4.0.r3', '_theme/v1/1.4.0.r2']);
  assert.equal((await s.listFolders('_releases/sandbox/cloud/')).length, 6, 'only: the theme folders');
  assert.equal((await s.listFolders('_releases/_theme/v1/')).length, 22);
});

test('a rollback to a release built before the shared theme is detected, for its note', async () => {
  const s = new FsStorage(tmp());
  await publishRelease(s, fakeBuild('sandbox', 'cloud', 'cloud', { themed: false, platformVersion: '1.3.0' }), { space: 'sandbox', segment: 'cloud', edition: 'cloud', tag: 'cloud-2026.10.20.1', now: at(1) });
  await publishRelease(s, fakeBuild('sandbox', 'cloud', 'cloud'), { space: 'sandbox', segment: 'cloud', edition: 'cloud', tag: 'cloud-2026.10.28.1', now: at(2) });
  assert.deepEqual(await sharedThemeOf(s, { space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.20.1' }), { shared: false, platformVersion: '1.3.0', page: 'index.html' });
  assert.equal((await sharedThemeOf(s, { space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.28.1' })).shared, true);
  assert.equal((await sharedThemeOf(s, { space: 'sandbox', segment: 'cloud', release: 'gone' })).shared, null);
  await flip(s, { environment: 'staging', policy, deployments: [{ space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.20.1' }] });
  await flip(s, { environment: 'staging', policy, deployments: [{ space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.28.1' }] });
  const { state } = await rollback(s, { environment: 'staging', policy, space: 'sandbox', segment: 'cloud' });
  assert.equal((await sharedThemeOf(s, { space: 'sandbox', segment: 'cloud', release: state.deployments['sandbox/cloud'].release })).shared, false);
});

test('the theme checks: one sample page of every live deployment of the major, light and dark, desktop and 375 px', async () => {
  const s = new FsStorage(tmp());
  const deploy = async (space, segment, edition, tag) => {
    await publishRelease(s, fakeBuild(space, segment, edition), { space, segment, edition, tag });
    return { space, segment, release: tag.replace(/^[a-z-]+\//, '') };
  };
  const repoOf = (slug) => policy.docSpaces[slug].repo.toLowerCase();
  const list = [await deploy('sandbox', 'cloud', 'cloud', 'cloud-2026.10.28.1'), await deploy('contribute', '_', '_', 'cloud-2026.10.28.2')];
  const other = Object.keys(policy.docSpaces).find((slug) => policy.docSpaces[slug].repo && repoOf(slug) !== repoOf('sandbox') && repoOf(slug) !== repoOf('contribute')
    && policy.docSpaces[slug].editions?.some((e) => e.id === 'cloud' && e.status !== 'legacy'));
  if (other) list.push(await deploy(other, 'cloud', 'cloud', 'cloud-2026.10.28.3'));
  await flip(s, { environment: 'staging', policy, deployments: list });
  const pins = { [repoOf('sandbox')]: 1, ...(other ? { [repoOf(other)]: 2 } : {}) };
  const r = await themeCheckPages(s, { policy, major: 1, pins, host: 'https://docs-staging.wso2.com/', screenshots: 'shots' });
  assert.deepEqual(r.deployments.map((d) => d.deployment).sort(), ['contribute/_', 'sandbox/cloud'], 'the Platform\'s own deployments always count');
  if (other) assert.deepEqual(r.skipped.map((x) => x.deployment), [`${other}/cloud`], 'a repo on another major keeps that major\'s theme');
  assert.equal(r.deployments.find((d) => d.deployment === 'sandbox/cloud').page, 'https://docs-staging.wso2.com/sandbox/cloud/get-started/', 'the first page below the home page');
  const sandbox = r.config.urls.filter((u) => u.url.includes('/sandbox/'));
  assert.deepEqual(sandbox.map((u) => [u.url.split('?')[1], u.viewport.width, u.screenCapture]), [
    ['docusaurus-theme=light&width=1280', 1280, 'shots/sandbox-cloud-light-1280.png'], ['docusaurus-theme=light&width=375', 375, 'shots/sandbox-cloud-light-375.png'],
    ['docusaurus-theme=dark&width=1280', 1280, 'shots/sandbox-cloud-dark-1280.png'], ['docusaurus-theme=dark&width=375', 375, 'shots/sandbox-cloud-dark-375.png'],
  ]);
  assert.equal(new Set(r.config.urls.map((u) => u.url)).size, r.config.urls.length, 'pa11y-ci keys its report by URL: one URL per check');
  assert.equal(r.live, null, 'no live theme yet: nothing to compare with');
  const baseline = baselineConfig(r.config);
  assert.deepEqual(baseline.urls.map((u) => u.url), r.config.urls.map((u) => u.url), 'the baseline checks the same pages');
  assert.ok(baseline.urls.every((u) => !('screenCapture' in u) && u.viewport), 'screenshots of the new theme only');
  await publishTheme(s, bundle('1.4.0.r1'), { major: 1, release: '1.4.0.r1' });
  await flipTheme(s, { environment: 'staging', policy, major: 1, release: '1.4.0.r1' });
  assert.equal((await themeCheckPages(s, { policy, major: 1, pins, host: 'https://docs-staging.wso2.com/' })).live, '1.4.0.r1');
  assert.ok(r.config.urls.some((u) => u.screenCapture === 'shots/contribute-root-dark-375.png'));
  assert.deepEqual(r.config.defaults.runners, ['axe']);
  assert.equal(r.config.defaults.standard, 'WCAG2AA');
});

// The Edge Worker over the same folder: an R2 binding's get() on FsStorage.
function r2(storage) {
  return {
    async get(key, opts) {
      const obj = await storage.get(key);
      if (!obj) return null;
      const meta = { httpEtag: obj.etag, writeHttpMetadata() {}, json: async () => JSON.parse(new TextDecoder().decode(obj.body)), text: async () => new TextDecoder().decode(obj.body) };
      if (opts?.onlyIf?.get?.('if-none-match') === obj.etag) return meta;
      return { ...meta, body: new Response(obj.body).body };
    },
  };
}
const points = () => {
  const list = [];
  return { list, writeDataPoint: (p) => list.push(p) };
};
const edge = (s) => ({ DOCS: r2(s), NOT_FOUND: points(), FEEDBACK: points(), ENVIRONMENT: 'staging', NOINDEX_ALL: 'true', MANIFEST_TTL_SECONDS: '0', HTML_MAX_AGE: '60' });
const get = (e, p, headers = {}) => worker.fetch(new Request(`https://docs-staging.wso2.com${p}`, { headers }), e);

test('theme route: the live theme for 5 minutes, a file by theme id for a year', () => {
  const m = { theme: { v1: { release: '1.5.0.r2' } } };
  assert.deepEqual(themeRoute(m, '/_platform/theme/v1/theme.css'), { type: 'object', key: '_releases/_theme/v1/1.5.0.r2/theme.css', cache: THEME_LIVE_CACHE, major: '1', release: '1.5.0.r2', pinned: false });
  assert.deepEqual(themeRoute(m, '/_platform/theme/v1/img/favicon.ico').key, '_releases/_theme/v1/1.5.0.r2/img/favicon.ico');
  assert.deepEqual(themeRoute(m, '/_platform/theme/v1/1.4.0.r1/fonts/inter.woff2'), { type: 'object', key: '_releases/_theme/v1/1.4.0.r1/fonts/inter.woff2', cache: IMMUTABLE_CACHE, major: '1', release: '1.4.0.r1', pinned: true });
  assert.equal(THEME_LIVE_CACHE, 'public, max-age=300, stale-while-revalidate=86400');
  assert.equal(IMMUTABLE_CACHE, 'public, max-age=31536000, immutable');
  assert.deepEqual(themeRoute(m, '/_platform/theme/v2/theme.css'), { type: 'miss', major: '2' }, 'no live theme for that major');
  assert.equal(themeRoute(m, '/_platform/theme/v1/').type, 'miss');
  assert.equal(themeRoute(m, '/_platform/theme/v1/1.4.0.r1').type, 'miss');
  assert.equal(themeRoute(m, '/_platform/theme/latest/theme.css').type, 'miss');
  assert.equal(themeRoute(m, '/_platform/theme/v1/%2e%2e/%2e%2e/state.json').type, 'miss');
  assert.equal(themeRoute(m, '/_platform/theme/v1/%E0%A4%A').type, 'bad');
  assert.equal(themeRoute(m, '/_platform/edition.json'), null);
  assert.equal(themeRoute({}, '/_platform/theme/v1/theme.css').type, 'miss');
});

test('the edge serves a published theme without touching any page, and a rollback reaches it', async () => {
  const s = new FsStorage(tmp());
  await publishTheme(s, bundle('1.4.0.r1', { colour: '#111111' }), { major: 1, release: '1.4.0.r1', now: at(1) });
  await publishTheme(s, bundle('1.5.0.r2', { colour: '#222222' }), { major: 1, release: '1.5.0.r2', now: at(2) });
  await publishRelease(s, fakeBuild('sandbox', 'cloud', 'cloud'), { space: 'sandbox', segment: 'cloud', edition: 'cloud', tag: 'cloud-2026.10.28.1' });
  await flip(s, { environment: 'staging', policy, deployments: [{ space: 'sandbox', segment: 'cloud', release: 'cloud-2026.10.28.1' }] });
  const e = edge(s);

  let res = await get(e, '/_platform/theme/v1/theme.css');
  assert.equal(res.status, 404, 'nothing live yet: the build carries no fallback copy');
  assert.equal(e.NOT_FOUND.list.at(-1).blobs[0], '_theme', 'a missing theme is counted');

  await flipTheme(s, { environment: 'staging', policy, major: 1, release: '1.4.0.r1', now: at(3) });
  res = await get(e, '/_platform/theme/v1/theme.css');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), THEME_LIVE_CACHE);
  assert.equal(res.headers.get('x-docs-theme'), 'v1/1.4.0.r1');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(await res.text(), /#111111/);

  res = await get(e, '/_platform/theme/v1/1.4.0.r1/fonts/inter.woff2');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'font/woff2');
  assert.equal(res.headers.get('cache-control'), IMMUTABLE_CACHE);
  assert.equal(await res.text(), 'font 1.4.0.r1');
  assert.equal((await get(e, '/_platform/theme/v1/1.5.0.r2/theme.css')).status, 200, 'a published theme by id, live or not');
  assert.equal((await get(e, '/_platform/theme/v1/9.9.9.r9/theme.css')).status, 404, 'an unknown id never falls back to the live theme');
  assert.equal((await get(e, '/_platform/theme/v1/img/logo.svg')).headers.get('content-type'), 'image/svg+xml');

  const etag = (await get(e, '/_platform/theme/v1/theme.css')).headers.get('etag');
  assert.equal((await get(e, '/_platform/theme/v1/theme.css', { 'if-none-match': etag })).status, 304);

  await flipTheme(s, { environment: 'staging', policy, major: 1, release: '1.5.0.r2', now: at(4) });
  res = await get(e, '/_platform/theme/v1/theme.css');
  assert.match(await res.text(), /#222222/);
  assert.notEqual(res.headers.get('etag'), etag, 'the live address revalidates to the new theme');
  await rollbackTheme(s, { environment: 'staging', policy, major: 1, now: at(5) });
  assert.match(await (await get(e, '/_platform/theme/v1/theme.css')).text(), /#111111/);

  // Pages are served as they were built: the Worker never rewrites them.
  const page = await get(e, '/sandbox/cloud/');
  assert.equal(await page.text(), '<html><head><link rel="stylesheet" href="/_platform/theme/v1/theme.css"></head><body>sandbox</body></html>');
  assert.equal((await get(e, '/_platform/theme/v1/theme.css', {})).status, 200);
  assert.equal((await worker.fetch(new Request('https://docs-staging.wso2.com/_platform/theme/v1/theme.css', { method: 'POST' }), e)).status, 405);
});

// pa11y-ci --json reports: { total, passes, errors, results: { <url>: [issue] } }.
const issue = (code, selector, extra = {}) => ({ code, type: 'error', selector, message: `${code} on ${selector}`, runner: 'axe', ...extra });
const report = (results) => ({ total: Object.keys(results).length, passes: 0, errors: 0, results });

test('the axe gate blocks only on what the new theme introduces, per page, mode and width', () => {
  const A = 'https://s/sandbox/cloud/x/?docusaurus-theme=light&width=1280';
  const B = 'https://s/sandbox/cloud/x/?docusaurus-theme=dark&width=375';
  const live = report({ [A]: [issue('color-contrast', '.footer a'), issue('region', 'main')], [B]: [issue('color-contrast', '.toc a')] });
  // The same violations with the new theme: nothing introduced.
  let r = compareA11y(live, report({ [A]: [issue('region', 'main'), issue('color-contrast', '.footer a')], [B]: [issue('color-contrast', '.toc a')] }));
  assert.deepEqual({ pass: r.pass, old: r.old, new: r.new, introduced: r.introduced.length, fixed: r.fixed }, { pass: true, old: 3, new: 3, introduced: 0, fixed: 0 });
  // A new element failing contrast, in dark mode on a phone only, blocks; one the theme fixed counts as fixed.
  r = compareA11y(live, report({ [A]: [issue('color-contrast', '.footer a'), issue('region', 'main')], [B]: [issue('color-contrast', '.navbar a')] }));
  assert.equal(r.pass, false);
  assert.deepEqual(r.introduced.map((i) => [i.url, i.code, i.selector]), [[B, 'color-contrast', '.navbar a']]);
  assert.equal(r.fixed, 1);
  // The same rule on the same element elsewhere doesn't excuse it: per page, mode and width.
  r = compareA11y(report({ [A]: [issue('color-contrast', '.toc a')] }), report({ [A]: [], [B]: [issue('color-contrast', '.toc a')] }));
  assert.deepEqual(r.introduced.map((i) => i.url), [B]);
  // A violation pa11y reports only as a warning or notice never blocks.
  assert.equal(compareA11y(report({ [A]: [] }), report({ [A]: [issue('x', 'p', { type: 'warning' })] })).pass, true);
});

test('the axe gate: the first theme of a major blocks on every violation; a page not checked blocks', () => {
  const A = 'https://s/a/?docusaurus-theme=light&width=1280';
  const B = 'https://s/b/?docusaurus-theme=light&width=1280';
  let r = compareA11y(null, report({ [A]: [issue('color-contrast', 'a')], [B]: [] }));
  assert.deepEqual({ pass: r.pass, baseline: r.baseline, old: r.old, new: r.new, introduced: r.introduced.length }, { pass: false, baseline: false, old: null, new: 1, introduced: 1 });
  assert.equal(compareA11y(null, report({ [A]: [], [B]: [] })).pass, true);
  // pa11y-ci records a page it couldn't load as an error with no rule code.
  r = compareA11y(report({ [A]: [] }), report({ [A]: [{ message: 'net::ERR_CONNECTION_REFUSED' }] }));
  assert.deepEqual({ pass: r.pass, unchecked: r.unchecked }, { pass: false, unchecked: [A] });
  // A page the baseline couldn't load has no baseline: its violations all count.
  r = compareA11y(report({ [A]: [{ message: 'timeout' }] }), report({ [A]: [issue('color-contrast', 'a')] }));
  assert.equal(r.introduced.length, 1);
  assert.throws(() => compareA11y(null, {}), /no results: pa11y-ci did not run/);
});

test('wso2-release theme: upload only, then move the pointer; compare exits 1 on introduced violations', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin', 'wso2-release.mjs'), ...args], { encoding: 'utf8' });
  const store = tmp();
  const out = path.join(tmp(), 'out.txt');
  let r = cli('theme', 'publish', '--storage', `file:${store}`, '--env', 'staging', '--dir', bundle('1.4.0.r5'), '--release', '1.4.0.r5', '--major', '1', '--upload-only', '--github-output', out);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(out, 'utf8'), 'release=1.4.0.r5\nmajor=1\n');
  assert.ok(fs.existsSync(path.join(store, '_releases/_theme/v1/1.4.0.r5/_platform/release.json')));
  assert.ok(!fs.existsSync(path.join(store, '_platform/state.json')), 'the pointer has not moved');
  r = cli('theme', 'publish', '--storage', `file:${store}`, '--env', 'staging', '--release', '1.4.0.r5', '--major', '1');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already complete; nothing uploaded\n.*staging: theme v1 -> 1\.4\.0\.r5/s, 'no bundle is written again');

  const dir = tmp();
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  write('live.json', report({ u: [issue('region', 'main')] }));
  write('same.json', report({ u: [issue('region', 'main')] }));
  write('worse.json', report({ u: [issue('region', 'main'), issue('color-contrast', '.navbar a')] }));
  const summary = path.join(dir, 'summary.md');
  r = cli('theme', 'compare', '--old', path.join(dir, 'live.json'), '--new', path.join(dir, 'same.json'), '--summary', summary);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 violations with the new theme, 1 with the live theme/);
  r = cli('theme', 'compare', '--old', path.join(dir, 'live.json'), '--new', path.join(dir, 'worse.json'), '--summary', summary);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Introduced by the new theme: \*\*1\*\*/);
  assert.match(fs.readFileSync(summary, 'utf8'), /- `color-contrast` at `\.navbar a` on u/);
  r = cli('theme', 'compare', '--new', path.join(dir, 'same.json'));
  assert.equal(r.status, 1, 'no live theme: every violation blocks');
  assert.match(r.stdout, /no live theme to compare with: every violation blocks/);
});
