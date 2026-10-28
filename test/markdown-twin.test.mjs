// The Markdown export step without a build: components in their Markdown form,
// partials, markers and variables, the Markdown-form rule for every Platform
// component, the twin checks, llms.txt and robots.txt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editionFromId } from '../lib/edition.mjs';
import { loadPolicy } from '../lib/manifest.mjs';
import { COMPONENT_FORMS, formFor } from '../lib/markdown-forms.mjs';
import { exportPageTree, printMarkdown } from '../lib/markdown-twin.mjs';
import { imageMatcher, singleExportFolders } from '../lib/markdown-export.mjs';
import { leftovers, linksOf } from '../lib/twin-checks.mjs';
import { chatLinks, pageOfTwin, twinPath, twinUrlPath } from '../lib/twin-paths.mjs';
import { rootLlmsTxt } from '../lib/llms.mjs';
import { robotsTxt } from '../worker/src/robots.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = loadPolicy();

function twin(files, { page = 'page.mdx', edition = '7.3.0', vars = { productName: 'WSO2 Identity Server', consoleUrl: 'https://localhost:9443/console', version: '7.3.0' }, additions = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-twin-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  const ctx = {
    resolveLink: (url) => (url.startsWith('#') || /^https?:/.test(url) ? url : `https://docs.wso2.com/x/${url}`),
    resolveImage: (url) => `https://docs.wso2.com/x/assets/${path.basename(url)}`,
    siblingPages: () => [{ url: 'https://docs.wso2.com/x/a.md', title: 'A', description: 'About A' }],
  };
  const opts = { edition: editionFromId(edition), vars: { id: edition, ...vars }, policy, linkHost: 'https://docs.wso2.com', docsDir: dir, additions: additions && { ...additions, docsDir: dir } };
  return printMarkdown(exportPageTree(path.join(dir, page), opts, ctx));
}

test('components become Markdown: admonitions, tabs, details, tables, code', () => {
  const md = twin({
    'page.mdx': `import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

## Set up {#set-up}

:::tip
Keep the key safe. {/* a comment */}
:::

:::warning[Before you start]
Back up the database.
:::

<Tabs groupId="os">
<TabItem value="linux" label="Linux">

\`\`\`bash
sh start.sh
\`\`\`

</TabItem>
<TabItem value="windows" label="Windows">
Run start.bat.
</TabItem>
</Tabs>

<details>
<summary>Advanced options</summary>

Set the **pool size**.

</details>

<table><tr><th>Key</th><th>Value</th></tr><tr><td>a</td><td>1</td></tr></table>

Press <kbd>Ctrl</kbd>+<kbd>K</kbd>.<br/>Done.
`,
  });
  assert.equal(md, `## Set up

> **Tip:** Keep the key safe.

> **Warning: Before you start**
>
> Back up the database.

### Linux

\`\`\`bash
sh start.sh
\`\`\`

### Windows

Run start.bat.

**Advanced options**

Set the **pool size**.

| Key | Value |
| --- | ----- |
| a   | 1     |

Press \`Ctrl\`+\`K\`.\\
Done.
`);
});

test('partials are inlined with their own markers, variables and props', () => {
  const md = twin({
    'page.mdx': `import Note from './_partials/_note.mdx';

Intro for {edition.productName}.

<Note product="the console" />

<Edition only="cloud">
Cloud text.
</Edition>
`,
    '_partials/_note.mdx': `Open {props.product} first.

<Edition only="self-hosted">
Self-hosted partial text.
</Edition>
`,
  });
  assert.equal(md, 'Intro for WSO2 Identity Server.\n\nOpen the console first.\n\nSelf-hosted partial text.\n');
});

// Cloud of a Doc space whose newest release is 7.3.0 (lib/content.mjs additionsFor).
const additions = {
  newestRelease: '7.3.0', name: 'Identity Server 7.3.0', latest: '/identity-server/latest/', slug: 'identity-server',
  vars: { id: '7.3.0', version: '7.3.0', productName: 'WSO2 Identity Server', consoleUrl: 'https://localhost:9443/console' },
};
const cloudVars = { version: 'cloud', productName: 'WSO2 Identity Platform', consoleUrl: 'https://console.asgardeo.io' };

test('Cloud: Self-hosted additions are labelled and read as the newest release; Edition variants show Cloud\'s form', () => {
  const page = `Open {edition.productName}.

<Variants>
<Edition only="cloud">
Cloud form.
</Edition>
<Edition only="self-hosted">
Self-hosted form.
</Edition>
</Variants>

<Edition only="self-hosted">
Tune {edition.productName} {edition.version} at \`{edition.consoleUrl}\`.

<Edition only="cloud">
Never in an addition.
</Edition>
</Edition>

<Edition only="self-hosted" selfHostedFrom="next">
Not in a release yet.
</Edition>

Port <Edition only="self-hosted">9443</Edition>.
`;
  const md = twin({ 'page.mdx': page }, { edition: 'cloud', vars: cloudVars, additions });
  assert.equal(md, 'Open WSO2 Identity Platform.\n\nCloud form.\n\n**Self-hosted only.**\n\nTune WSO2 Identity Server 7.3.0 at `https://localhost:9443/console`.\n\nPort **Self-hosted only:** 9443.\n');
  // The same page in 7.3.0: its own form, no label.
  assert.equal(twin({ 'page.mdx': page }), 'Open WSO2 Identity Server.\n\nSelf-hosted form.\n\nTune WSO2 Identity Server 7.3.0 at `https://localhost:9443/console`.\n\nPort 9443.\n');
  // A family Cloud has no newest release: no additions.
  assert.equal(twin({ 'page.mdx': page }, { edition: 'cloud', vars: cloudVars }), 'Open WSO2 Identity Platform.\n\nCloud form.\n\nPort .\n');
});

test('Cloud: a link inside a Self-hosted addition that Cloud cannot resolve goes to the same page under /latest/', () => {
  // As Identity Server's fido-attestation links to reference/apis#oauth-based-authentication,
  // a heading only the Self-hosted form of a <Variants> has.
  const files = {
    'reference/apis/index.mdx': `---
title: APIs
---

<Variants>
<Edition only="cloud">
## Get an access token
</Edition>
<Edition only="self-hosted">
## OAuth-based authentication

### Access the API {#access-the-api_1}
</Edition>
</Variants>

## Best practices
`,
    'guides/licensing.mdx': '---\ntitle: Licensing\neditions: self-hosted\ncloudCounterpart: guides/billing\n---\n\nLicences.\n',
    'guides/billing.mdx': '---\ntitle: Billing\neditions: cloud\n---\n\nBilling.\n',
    'guides/coming.mdx': '---\ntitle: Coming\neditions: self-hosted\nselfHostedFrom: next\n---\n\nSoon.\n',
    'guides/fido.mdx': `---
title: FIDO
editions: self-hosted
---

[Token](../reference/apis/index.mdx#oauth-based-authentication), [explicit id](../reference/apis/index.mdx#access-the-api_1), [practices](../reference/apis/index.mdx#best-practices), [licensing](licensing.mdx), [billing](billing.mdx), [coming](coming.mdx), [typo](../reference/apis/index.mdx#no-such-heading).
`,
    'guides/shared.mdx': `---
title: Shared
---

[Token](../reference/apis/index.mdx#oauth-based-authentication).

<Edition only="self-hosted">
[Token](../reference/apis/index.mdx#oauth-based-authentication) in an addition.
</Edition>
`,
  };
  const latest = 'https://docs.wso2.com/identity-server/latest';
  const fido = twin(files, { page: 'guides/fido.mdx', edition: 'cloud', vars: cloudVars, additions });
  assert.equal(fido, `**Self-hosted only.**\n\n[Token](${latest}/reference/apis/#oauth-based-authentication), [explicit id](${latest}/reference/apis/#access-the-api_1), `
    + '[practices](https://docs.wso2.com/x/../reference/apis/index.mdx#best-practices), '
    + `[licensing](${latest}/guides/licensing/), [billing](https://docs.wso2.com/x/billing.mdx), `
    + '[coming](https://docs.wso2.com/x/coming.mdx), [typo](https://docs.wso2.com/x/../reference/apis/index.mdx#no-such-heading).\n',
  'links Cloud resolves stay; links the newest release cannot resolve either stay, for the build to report');
  // On a shared page only the addition block's link changes.
  assert.equal(twin(files, { page: 'guides/shared.mdx', edition: 'cloud', vars: cloudVars, additions }),
    `[Token](https://docs.wso2.com/x/../reference/apis/index.mdx#oauth-based-authentication).\n\n**Self-hosted only.**\n\n[Token](${latest}/reference/apis/#oauth-based-authentication) in an addition.\n`);
  // The newest release itself keeps every link.
  assert.match(twin(files, { page: 'guides/fido.mdx' }), /^\[Token\]\(https:\/\/docs\.wso2\.com\/x\/\.\.\/reference\/apis\/index\.mdx#oauth-based-authentication\)/);
});

test('Cloud: a Self-hosted-only page carries the line under its title', () => {
  const md = twin({ 'page.mdx': '---\ntitle: Install\neditions: self-hosted\n---\n\n# Install\n\nInstall {edition.productName}.\n' }, { edition: 'cloud', vars: cloudVars, additions });
  assert.equal(md, '# Install\n\n**Self-hosted only.**\n\nInstall WSO2 Identity Server.\n');
});

test('<Variants> must hold one Cloud and one Self-hosted form', () => {
  assert.throws(() => twin({ 'page.mdx': '<Variants>\n<Edition only="cloud">\nA\n</Edition>\n</Variants>\n' }), /exactly one <Edition only="cloud"> and one <Edition only="self-hosted">/);
  assert.throws(() => twin({ 'page.mdx': '<Variants>\n<Edition only="cloud">\nA\n</Edition>\n\nB\n\n<Edition only="self-hosted">\nC\n</Edition>\n</Variants>\n' }), /and nothing else/);
});

test('docs: links and DocCardList', () => {
  const md = twin({ 'page.mdx': 'See [API Manager](docs:api-manager/latest/guides/).\n\n<DocCardList />\n' });
  assert.match(md, /\[API Manager\]\(https:\/\/docs\.wso2\.com\/api-manager\/latest\/guides\/\)/, 'DocsLink keeps the resolved URL (the export context maps it to a twin)');
  assert.match(md, /- \[A\]\(https:\/\/docs\.wso2\.com\/x\/a\.md\): About A/);
});

test('<ThemedImage light dark alt> keeps the light image; the theme\'s sources form too', () => {
  const md = twin({ 'page.mdx': 'Before.\n\n<ThemedImage light="./img/flow.png" dark="./img/flow-dark.png" alt="The flow" />\n\nInline <ThemedImage light="../assets/icon.png" dark="../assets/icon-dark.png" alt="Icon" /> text.\n' });
  assert.match(md, /Before\.\n\n!\[The flow\]\(https:\/\/docs\.wso2\.com\/x\/assets\/flow\.png\)\n\nInline !\[Icon\]\(https:\/\/docs\.wso2\.com\/x\/assets\/icon\.png\) text\./);
  assert.doesNotMatch(md, /dark/);
  const legacy = twin({ 'page.mdx': "import ThemedImage from '@theme/ThemedImage';\n\n<ThemedImage sources={{ light: '/img/a.png', dark: '/img/a-dark.png' }} alt=\"A\" />\n" });
  assert.match(legacy, /!\[A\]\(https:\/\/docs\.wso2\.com\/x\/assets\/a\.png\)/);
  // The built page holds both images, light first: the dark one is matched
  // too, so a later image with the same alt text gets its own.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-twin-'));
  fs.writeFileSync(path.join(dir, 'page.mdx'), '<ThemedImage light="./a.png" dark="./a-dark.png" alt="Step" />\n\n<ThemedImage light="./b.png" dark="./b-dark.png" alt="Step" />\n');
  const html = '<article><img src="/x/assets/images/a-1.png" alt="Step" class="themedComponent--light"><img src="/x/assets/images/a-dark-2.png" alt="Step" class="themedComponent--dark">'
    + '<img src="/x/assets/images/b-3.png" alt="Step"><img src="/x/assets/images/b-dark-4.png" alt="Step"></article>';
  const ctx = { resolveLink: (u) => u, resolveImage: imageMatcher(html, 'https://docs.wso2.com'), siblingPages: () => [] };
  const out = printMarkdown(exportPageTree(path.join(dir, 'page.mdx'), { edition: editionFromId('7.3.0'), vars: { id: '7.3.0' }, policy, linkHost: 'https://docs.wso2.com', docsDir: dir }, ctx));
  assert.match(out, /!\[Step\]\(https:\/\/docs\.wso2\.com\/x\/assets\/images\/a-1\.png\)\n\n!\[Step\]\(https:\/\/docs\.wso2\.com\/x\/assets\/images\/b-3\.png\)/);
});

test('a component without a Markdown form fails the export', () => {
  assert.throws(() => twin({ 'page.mdx': 'Text.\n\n<FancyWidget kind="x" />\n' }), /<FancyWidget> has no Markdown form; declare one in lib\/markdown-forms\.mjs/);
  assert.throws(() => twin({ 'page.mdx': 'Total: {1 + 1}\n' }), /expression \{1 \+ 1\} has no Markdown form/);
  assert.equal(formFor('div') !== null, true, 'HTML elements keep their content');
});

// Platform CI: every component site/src/theme/MDXComponents.js registers
// (directly or through a spread component map) needs a Markdown form.
function registeredComponents() {
  const file = path.join(root, 'site', 'src', 'theme', 'MDXComponents.js');
  const keysOf = (src) => {
    const body = /export default\s*\{([^]*?)\};/.exec(src)?.[1] ?? '';
    return body.split(',').map((s) => s.replace(/\/\/.*$/gm, '').trim()).filter(Boolean);
  };
  const src = fs.readFileSync(file, 'utf8');
  const imports = new Map([...src.matchAll(/import\s+(\w+)\s+from\s+'([^']+)'/g)].map((m) => [m[1], m[2]]));
  const names = [];
  for (const key of keysOf(src)) {
    const spread = /^\.\.\.(\w+)$/.exec(key);
    if (!spread) {
      names.push(key.split(':')[0].trim());
      continue;
    }
    const from = imports.get(spread[1]);
    if (!from || from.startsWith('@theme-original/')) continue; // Docusaurus's own map
    const base = path.join(root, 'site', from.replace(/^@site\//, ''));
    const target = [`${base}.js`, path.join(base, 'index.js')].find((f) => fs.existsSync(f));
    assert.ok(target, `cannot read ${from}`);
    names.push(...keysOf(fs.readFileSync(target, 'utf8')).map((k) => k.split(':')[0].trim()));
  }
  return names;
}

test('every Platform MDX component declares its Markdown form', () => {
  const names = registeredComponents();
  assert.ok(names.includes('DocsLink') && names.includes('PageActions'), `found ${names.join(', ')}`);
  // Lowercase keys override an HTML element (a: FileLink); HTML elements have their own forms.
  const missing = names.filter((n) => (/^[a-z]/.test(n) ? formFor(n) === null : !Object.hasOwn(COMPONENT_FORMS, n)));
  assert.deepEqual(missing, [], `add a Markdown form to lib/markdown-forms.mjs for: ${missing.join(', ')}`);
});

test('twin paths and chat links', () => {
  assert.equal(twinPath(''), 'index.md');
  assert.equal(twinPath('guides/mfa/'), 'guides/mfa.md');
  assert.equal(pageOfTwin('guides/mfa.md'), 'guides/mfa/');
  assert.equal(pageOfTwin('index.md'), '');
  assert.equal(pageOfTwin('guides/index.md'), 'guides/');
  assert.equal(twinUrlPath('/identity-platform/7.3.0/guides/mfa/', '/identity-platform/7.3.0/'), '/identity-platform/7.3.0/guides/mfa.md');
  assert.equal(twinUrlPath('/identity-platform/7.3.0/', '/identity-platform/7.3.0/'), '/identity-platform/7.3.0/index.md');
  const links = chatLinks('https://docs.wso2.com/identity-platform/cloud/guides/mfa.md');
  assert.equal(links.claude, `https://claude.ai/new?q=${encodeURIComponent('Read https://docs.wso2.com/identity-platform/cloud/guides/mfa.md so I can ask you questions about it.')}`);
  assert.match(links.chatgpt, /^https:\/\/chatgpt\.com\/\?q=Read%20https%3A%2F%2Fdocs\.wso2\.com%2F.*mfa\.md/);
});

test('twin checks: leftover JSX outside code, links', () => {
  const md = '---\ntitle: X\n---\n\n# X\n\nUse `<Tabs>` here.\n\n```jsx\n<Tabs>\n```\n\n<Tabs>\n\n\\<IS_HOME> is fine. {edition.version}\n\n:::note\n\n[a](https://docs.wso2.com/x/a.md#b) ![i](./img.png)\n';
  const found = leftovers(md);
  assert.equal(found.length, 3, found.join('\n'));
  assert.match(found[0], /leftover JSX component on line 13: <Tabs>/);
  assert.match(found[1], /unfilled variable/);
  assert.match(found[2], /leftover admonition directive/);
  assert.deepEqual(linksOf(md), ['https://docs.wso2.com/x/a.md#b', './img.png']);
});

test('_category_.yml: export: single goes under customProps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-cat-'));
  fs.mkdirSync(path.join(dir, 'guides', 'complete'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'guides', '_category_.yml'), 'label: Guides\n');
  fs.writeFileSync(path.join(dir, 'guides', 'complete', '_category_.yml'), 'label: Complete guide\ncustomProps:\n  export: single\n');
  assert.deepEqual([...singleExportFolders(dir)], [['guides/complete', { label: 'Complete guide', description: null }]]);
  fs.writeFileSync(path.join(dir, 'guides', '_category_.yml'), 'label: Guides\nexport: single\n');
  assert.throws(() => singleExportFolders(dir), /write export under customProps/);
});

test('root llms.txt from the manifest: /cloud/ and /latest/, no end-of-life Editions', () => {
  const manifest = {
    docSpaces: {
      'identity-platform': {
        displayName: 'WSO2 Identity Platform', model: 'cloud-plus-versions', latest: '7.3.0',
        editions: [{ id: 'cloud' }, { id: '7.3.0' }, { id: '7.2.0' }, { id: '7.0.0', status: 'end-of-life' }],
        deployments: {
          cloud: { edition: 'cloud' }, latest: { edition: '7.3.0' }, '7.3.0': { edition: '7.3.0' }, '7.2.0': { edition: '7.2.0' }, '7.0.0': { edition: '7.0.0' },
        },
      },
      'api-manager': { displayName: 'API Manager', model: 'versions-only', latest: '4.7.0', editions: [{ id: '4.7.0' }], deployments: {} },
      'micro-integrator': { displayName: 'Micro Integrator', model: 'versions-only', latest: '4.4.0', editions: [{ id: '4.4.0' }], deployments: { latest: { edition: '4.4.0' }, '4.4.0': { edition: '4.4.0' } } },
      contribute: { displayName: 'Contribute', model: 'unversioned', editions: [], deployments: { _: { edition: '_' } } },
      'agent-manager': { displayName: 'WSO2 Agent Manager', model: 'cloud-plus-versions', status: 'legacy', legacyUrl: 'https://wso2.com/agent-platform/docs/', editions: [], deployments: { cloud: { edition: 'cloud' } } },
    },
  };
  const txt = rootLlmsTxt(manifest);
  assert.match(txt, /^# WSO2 Docs\n\n> /);
  assert.match(txt, /## WSO2 Identity Platform\n\n- \[WSO2 Identity Platform Cloud\]\(https:\/\/docs\.wso2\.com\/identity-platform\/cloud\/llms\.txt\)/);
  assert.match(txt, /- \[WSO2 Identity Platform 7\.3\.0 \(newest release\)\]\(https:\/\/docs\.wso2\.com\/identity-platform\/latest\/llms\.txt\)/, 'the chrome\'s wording: with Cloud, "(newest release)"');
  assert.match(txt, /- \[Micro Integrator 4\.4\.0 \(latest\)\]\(https:\/\/docs\.wso2\.com\/micro-integrator\/latest\/llms\.txt\)/, 'without Cloud, "(latest)"');
  assert.doesNotMatch(txt, /latest release/);
  assert.match(txt, /## Contribute\n\n- \[Contribute\]\(https:\/\/docs\.wso2\.com\/contribute\/llms\.txt\)/);
  assert.match(txt, /## Optional\n\n.*identity-platform\/7\.2\.0\/llms\.txt.*\n.*identity-platform\/7\.3\.0\/llms\.txt/);
  assert.doesNotMatch(txt, /7\.0\.0/, 'end-of-life Editions drop out of the root index');
  assert.doesNotMatch(txt, /API Manager/, 'a Doc space with nothing deployed is left out');
  assert.doesNotMatch(txt, /Agent Manager/, 'legacy Doc spaces are left out');
});

test('robots.txt: staging disallows all, production allows AI crawlers', () => {
  assert.equal(robotsTxt({ NOINDEX_ALL: 'true' }), 'User-agent: *\nDisallow: /\n');
  const prod = robotsTxt({ NOINDEX_ALL: 'false', DOCS_HOST: 'docs.wso2.com' });
  for (const ua of ['GPTBot', 'ClaudeBot', 'Google-Extended']) assert.match(prod, new RegExp(`^User-agent: ${ua}$`, 'm'));
  assert.match(prod, /User-agent: Amazonbot\nAllow: \//);
  assert.match(prod, /^Sitemap: https:\/\/docs\.wso2\.com\/sitemap\.xml$/m);
  assert.match(robotsTxt({ NOINDEX_ALL: 'false', AI_CRAWLERS: 'disallow' }), /User-agent: Amazonbot\nDisallow: \//);
});

test('images match the built <img> tags, inlined small images included', () => {
  const html = '<article><img src="/x/assets/images/flow-ab12.png" alt="Flow">'
    + '<img src="data:image/png;base64,AAA" alt=""><img src="/x/assets/images/big-cd34.png" alt="">'
    + '<img src="data:image/png;base64,BBB" alt=""></article>';
  const match = imageMatcher(html, 'https://docs.wso2.com');
  assert.equal(match('../img/flow.png', 'Flow'), 'https://docs.wso2.com/x/assets/images/flow-ab12.png');
  assert.equal(match('../img/small-token.png', ''), null, 'an inlined image with no alt text keeps nothing');
  assert.equal(match('../img/big.png', ''), 'https://docs.wso2.com/x/assets/images/big-cd34.png');
  assert.equal(match('../img/another-small.png', ''), null);
  assert.equal(match('../img/missing.png', ''), '../img/missing.png', 'no <img> left: unchanged, so the twin check reports it');
  // An apostrophe in the alt text: Docusaurus writes it as &#39; (and an
  // inlined SVG has no file name to match by).
  const apos = imageMatcher('<article><img alt="The day&amp;#39;s orders" src="data:image/svg+xml;base64,AAA"><img alt="It&#x27;s &quot;on&quot;" src="/x/assets/images/b-1.png"></article>', 'https://docs.wso2.com');
  assert.equal(apos("../img/architecture.svg", "The day's orders"), null);
  assert.equal(apos('../img/other.png', 'It\'s "on"'), 'https://docs.wso2.com/x/assets/images/b-1.png');
});
