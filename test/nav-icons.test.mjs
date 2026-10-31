// Sidebar icons (Extension points): the allow-list and its SVG, the
// `nav-icons` check on a git copy of the stub Content repo, the build plugin
// that checks the names and hands the used icons to the sidebar, the family
// Cloud tree keeping a part's icons. The rendered sidebar and the twins are
// in test/build/build.test.mjs; the converter's mapping in
// test/migration-is.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_ICON_SOURCES, navIcon, navIconNames, navIconProblem } from '../lib/nav-icons.mjs';
import navIcons, { iconsIn } from '../plugins/nav-icons.mjs';
import { foreignItems } from '../lib/cloud-tree.mjs';
import { loadStandards } from '../lib/standards.mjs';
import { PAGE, check, findings, read, reset, status, write } from './helpers/check-repo.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the allow-list: every 16px Octicon, the Font Awesome and WSO2 icons copied into icons/, each fitted into 16px', () => {
  const names = navIconNames();
  assert.ok(names.includes('octicons/rocket-16') && names.includes('octicons/home-16'));
  assert.ok(!names.some((n) => /^octicons\/.*-(12|24|48)$/.test(n)), 'only the 16px Octicons');
  assert.deepEqual(names.filter((n) => !n.startsWith('octicons/')), [
    'fontawesome/brands/angular', 'fontawesome/brands/js', 'fontawesome/brands/node-js', 'fontawesome/brands/react', 'fontawesome/brands/vuejs',
    'fontawesome/solid/user-shield',
    'wso2/dotnet', 'wso2/expressjs', 'wso2/mcp', 'wso2/nextjs', 'wso2/nuxt', 'wso2/spring-boot',
  ]);
  for (const n of names) assert.ok(NAV_ICON_SOURCES.some((s) => n.startsWith(s.prefix)), n);
  assert.deepEqual(navIcon('octicons/rocket-16'), { ...navIcon('octicons/rocket-16'), viewBox: '0 0 16 16', width: 16, height: 16 });
  const vue = navIcon('fontawesome/brands/vuejs');
  assert.deepEqual([vue.viewBox, vue.width, vue.height], ['0 0 448 512', 14, 16], 'a narrow glyph is 14×16');
  assert.match(vue.body, /^<!--! Font Awesome Free 6\.3\.0 by @fontawesome/, 'Font Awesome\'s attribution stays in the icon');
  const ex = navIcon('wso2/expressjs');
  assert.deepEqual([ex.width, ex.height], [16, 9.28], 'a wide logo is 16 wide');
  const mcp = navIcon('wso2/mcp');
  assert.doesNotMatch(mcp.body, /<title>|Copyright|<!--/, 'the licence header and title are not inlined');
  assert.match(mcp.body, /^<path /);
  assert.equal(navIcon('nope'), null);
  assert.equal(navIcon(undefined), null);
});

test('an unknown name is named, with a close allowed name when there is one', () => {
  assert.equal(navIconProblem('fontawesome/brands/react'), null);
  assert.equal(navIconProblem('octicons/rocket'), '"octicons/rocket" is not a sidebar icon; did you mean "octicons/rocket-16"?');
  assert.equal(navIconProblem('assets/libs/custom-icons/nextjs.svg'), '"assets/libs/custom-icons/nextjs.svg" is not a sidebar icon; did you mean "wso2/nextjs"?');
  assert.equal(navIconProblem('octicons/no-such-icon-16'), '"octicons/no-such-icon-16" is not a sidebar icon');
  assert.match(navIconProblem(3), /must be a name such as "octicons\/rocket-16" \(got 3\)/);
});

test('the nav-icons check: known names pass, unknown ones fail with the file, the line and a fix', async () => {
  reset();
  let r = await check();
  assert.equal(status(r, 'nav-icons'), 'pass');
  assert.match(r.checks.find((c) => c.id === 'nav-icons').note, /^\d+ sidebar icons?$/);
  assert.equal(status(r, 'front-matter'), 'pass', 'sidebar_custom_props is a known front-matter key');
  const def = loadStandards().check('nav-icons');
  assert.ok(def.blocking && def.release, 'it blocks, and the release build runs it');
  assert.match(def.fix, /add-a-sidebar-icon\.mdx#allowed-names/);

  write(PAGE, read(PAGE).replace('icon: octicons/shield-lock-16', 'icon: octicons/shield-lock'));
  write('docs/get-started/_category_.yml', 'label: Get started\nposition: 1\ncustomProps:\n  icon: rocket\n');
  write('docs/guides/_category_.yml', `${read('docs/guides/_category_.yml')}icon: octicons/book-16\n`);
  r = await check();
  assert.equal(status(r, 'nav-icons'), 'fail');
  const [page, ...rest] = findings(r, 'nav-icons');
  assert.equal(page.file, PAGE);
  assert.equal(page.line, read(PAGE).split('\n').findIndex((l) => l.includes('icon: octicons/shield-lock')) + 1);
  assert.equal(page.message, 'Sidebar icon: "octicons/shield-lock" is not a sidebar icon; did you mean "octicons/shield-lock-16"? The allowed names are listed in the sidebar icons guide.');
  assert.match(page.link, /reference\/checks\/#nav-icons$/);
  const byFile = Object.fromEntries(rest.map((x) => [x.file, x]));
  assert.equal(byFile['docs/get-started/_category_.yml'].line, 4);
  assert.match(byFile['docs/get-started/_category_.yml'].message, /"rocket" is not a sidebar icon; did you mean "octicons\/rocket-16"\?/);
  assert.match(byFile['docs/guides/_category_.yml'].message, /under customProps/, 'a top-level icon key is caught too');

  write(PAGE, read(PAGE).replace(/sidebar_custom_props:\n {2}icon: \S+\n/, 'sidebar_custom_props: rocket\n'));
  r = await check();
  assert.match(findings(r, 'front-matter')[0].message, /"sidebar_custom_props" must be a mapping/);
  reset();
});

// Docusaurus's loaded docs content, as allContentLoaded sees it.
const content = (pageIcon, groupIcon) => ({
  'docusaurus-plugin-content-docs': {
    default: {
      loadedVersions: [{
        docs: [
          { id: 'guides/mfa', source: '@site/../docs/guides/mfa.mdx', frontMatter: { sidebar_custom_props: { icon: pageIcon } } },
          { id: 'guides/sso', source: '@site/../docs/guides/sso.mdx', frontMatter: {} },
        ],
        sidebars: {
          docs: [{ type: 'category', label: 'Guides', customProps: { icon: groupIcon, export: 'single' }, items: [{ type: 'doc', id: 'guides/mfa', customProps: { icon: pageIcon } }, { type: 'doc', id: 'guides/sso' }] }],
        },
      }],
    },
  },
});

test('the build: only the icons in use reach the sidebar, and an unknown name fails a strict build', async () => {
  assert.deepEqual(iconsIn(content('octicons/shield-lock-16', 'octicons/book-16')).map((x) => x.icon), ['octicons/shield-lock-16', 'octicons/book-16', 'octicons/shield-lock-16']);
  let data = null;
  const actions = { setGlobalData: (d) => { data = d; } };
  await navIcons({}, { strict: true }).allContentLoaded({ allContent: content('octicons/shield-lock-16', 'octicons/book-16'), actions });
  assert.deepEqual(Object.keys(data.icons).sort(), ['octicons/book-16', 'octicons/shield-lock-16'], 'only the icons in use');
  assert.deepEqual(data.icons['octicons/book-16'], navIcon('octicons/book-16'));

  await assert.rejects(
    () => navIcons({}, { strict: true }).allContentLoaded({ allContent: content('octicons/shield-lock', 'octicons/book-16'), actions }),
    (err) => /Unknown sidebar icons/.test(err.message) && /\.\.\/docs\/guides\/mfa\.mdx: "octicons\/shield-lock" is not a sidebar icon; did you mean "octicons\/shield-lock-16"\?/.test(err.message),
  );
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(m);
  try {
    await navIcons({}, { strict: false }).allContentLoaded({ allContent: content('octicons/shield-lock-16', 'wso2/nope'), actions });
  } finally {
    console.warn = warn;
  }
  assert.match(warned.join('\n'), /the sidebar entry "Guides": "wso2\/nope" is not a sidebar icon/);
  assert.deepEqual(Object.keys(data.icons), ['octicons/shield-lock-16'], 'a preview draws the entry without the unknown icon');
});

test('a family Cloud tree keeps the icons of another instance\'s entries', () => {
  const docs = [
    { id: 'guides/mfa', title: 'MFA', frontMatter: { sidebar_custom_props: { icon: 'octicons/shield-lock-16' } }, source: '@site/docs/guides/mfa.mdx' },
    { id: 'guides/sso', title: 'SSO', frontMatter: {}, source: '@site/docs/guides/sso.mdx' },
  ];
  const items = [{ type: 'category', label: 'Guides', customProps: { icon: 'octicons/book-16' }, items: [{ type: 'doc', id: 'guides/mfa' }, { type: 'doc', id: 'guides/sso' }] }];
  const [cat] = foreignItems(items, { docs, docsDir: '/s/docs', siteDir: '/s', baseUrl: '/x/' });
  assert.deepEqual(cat.customProps, { icon: 'octicons/book-16' });
  assert.deepEqual(cat.items.map((i) => [i.label, i.customProps]), [['MFA', { icon: 'octicons/shield-lock-16' }], ['SSO', undefined]]);
});

test('the sidebar icons guide lists every allowed name', () => {
  const guide = fs.readFileSync(path.join(root, 'standards', 'contribute', 'docs', 'guides', 'add-a-sidebar-icon.mdx'), 'utf8');
  for (const n of navIconNames()) assert.ok(guide.includes(`\`${n}\``), n);
  assert.match(guide, /\{#allowed-names\}/);
  assert.match(guide, /sidebar_custom_props:\n {5}icon: fontawesome\/brands\/react/);
  assert.match(guide, /customProps:\n {5}icon: octicons\/rocket-16/);
});
