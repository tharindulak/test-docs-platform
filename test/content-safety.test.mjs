// Content safety (Build and quality checks): content carries no code. Imports
// only from the component catalogue and relative partials inside the Doc
// space, no exports, literal-only expressions, no script files and no active
// HTML, iframes only from allow-listed hosts. One check reading files only,
// run by `wso2-docs check` and `wso2-docs bundle`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContentRepo } from '../lib/content.mjs';
import { loadContext } from '../lib/check/content.mjs';
import { checkContentSafety, loadSafetyRules } from '../lib/check/safety.mjs';
import { loadStandards } from '../lib/standards.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stub = path.join(root, 'fixtures', 'stub-repo');

function copyStub(name = 'identity-server') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-safety-'));
  fs.cpSync(stub, dir, { recursive: true });
  return path.join(dir, name);
}
const scan = (dir) => checkContentSafety(loadContext({ repo: loadContentRepo(dir), base: null }));
const page = (body) => `---\ntitle: Safety\ndescription: A page for the content safety check.\ntype: how-to\n---\n\n${body}\n`;

test('the stub Content repo and the Contribute Doc space pass', () => {
  for (const name of ['identity-server', 'identity-platform']) assert.deepEqual(scan(path.join(stub, name)), [], name);
  assert.deepEqual(scan(path.join(root, 'standards', 'contribute')), []);
});

test('the rules come from standards/: module ids in the component catalogue, iframe hosts in their own list', () => {
  const rules = loadSafetyRules();
  for (const id of ['@theme/Tabs', '@theme/TabItem', '@theme/Details', '@theme/Admonition', '@theme/CodeBlock']) assert.ok(rules.modules.has(id), id);
  assert.equal(rules.iframeHosts[0], 'youtube-nocookie.com');
  assert.ok(loadStandards().check('content-safety'), 'checks.yaml lists content-safety');
  const def = loadStandards().check('content-safety');
  assert.equal(def.blocking, true);
  assert.ok(!def.overridable, 'build-breaking: the quality-override label never overrides it');
  assert.equal(def.release, true);
});

// [what, page body, message pattern]; each bad body gives at least one finding.
const BAD = [
  ['an import from a module not in the catalogue', "import x from 'lodash';\n\nText.", /lodash.*not in the component catalogue/],
  ['an import of a site file', "import Thing from '@site/src/components/Thing';\n\nText.", /@site\/src\/components\/Thing/],
  ['a relative import of code', "import x from './helper.js';\n\nText.", /\.\/helper\.js/],
  ['a relative partial outside the Doc space', "import X from '../../../identity-platform/docs/index.mdx';\n\n<X />", /outside the Doc space/],
  ['a webpack loader import', "import x from '!!raw-loader!./_x.mdx';\n\nText.", /raw-loader/],
  ['an export', 'export const x = 1;\n\nText.', /export/],
  ['an export of a function', 'export function Box() { return null; }\n\nText.', /export/],
  ['a function call', 'Today is {new Date().getFullYear()}.', /expression/],
  ['an arrow function', '<Tabs groupId={() => "x"} />', /expression/],
  ['a template literal with an expression', 'Text {`a${b}`}.', /expression/],
  ['member access', 'Text {window.location}.', /expression/],
  ['a variable', 'Text {someVar}.', /expression/],
  ['a spread attribute', '<Tabs {...props} />', /spread/],
  ['an edition variable in an attribute', '<TabItem value={edition.productName} label="x">Text</TabItem>', /expression/],
  ['require of a module', 'Text {require("fs")}.', /require/],
  ['require outside the Doc space', '<img alt="x" src={require("../../../identity-platform/docs/index.mdx").default} />', /outside the Doc space/],
  ['a script element', '<script>{"alert(1)"}</script>', /<script>/],
  ['an on* attribute', '<div onClick="alert(1)">x</div>', /onClick/],
  ['dangerouslySetInnerHTML', '<div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />', /dangerouslySetInnerHTML/],
  ['a javascript: URL in JSX', '<a href="javascript:alert(1)">x</a>', /javascript:/],
  ['a javascript: URL in Markdown', '[x](javascript:alert(1))', /javascript:/],
  ['an iframe from another host', '<iframe src="https://example.com/embed" title="x" />', /example\.com/],
  ['an iframe without a literal src', '<iframe src={"https://www.youtube-nocookie.com/x"} title="x" />', /src/],
  ['an iframe over http', '<iframe src="http://www.youtube-nocookie.com/embed/x" title="x" />', /https/],
  // srcdoc wins over src, so an allow-listed src would not stop its HTML.
  ['an allow-listed iframe with srcdoc', '<iframe src="https://www.youtube-nocookie.com/embed/x" srcdoc="<script>alert(1)</script>" title="x" />', /srcdoc/],
  ['an object element', '<object data="https://example.com/x.swf" />', /<object>/],
  ['an embed element', '<embed src="https://example.com/x.svg" />', /<embed>/],
  ['raw HTML srcdoc in a CommonMark-style block', '<div>\n<iframe src="https://www.youtube-nocookie.com/embed/x" srcdoc="x"></iframe>\n</div>', /srcdoc/],
];

const GOOD = [
  ['catalogue imports and relative partials', "import Tabs from '@theme/Tabs';\nimport TabItem from '@theme/TabItem';\nimport N from '../_partials/_mfa-note.mdx';\nimport S from '../../partials/sign-in-options.mdx';\n\n<N />\n\n<S />"],
  ['literals', '<Tabs values={[{ label: "A", value: "a" }, { label: "B", value: "b" }]} defaultValue="a" />\n\n<div style={{ width: "100%", top: 0, flex: -1 }}>x</div>\n\nText {"{braces}"} and {42} and {true} and {null} and {`plain`}.'],
  ['comments', 'Text {/* a comment */} here.\n\n{/* a flow comment */}'],
  ['edition variables in text', 'Use {edition.productName} here.'],
  ['an Edition variant (a catalogue component, no import)', '<Variants>\n<Edition only="cloud">\nOpen the Console.\n</Edition>\n<Edition only="self-hosted">\nOpen {edition.consoleUrl}.\n</Edition>\n</Variants>'],
  ['require of its own image', '<img alt="The console" src={require("../../assets/logos/totp.svg").default} />\n\n<img alt="Again" src={require("../../assets/logos/totp.svg")} />'],
  ['an allow-listed iframe', '<iframe src="https://www.youtube-nocookie.com/embed/abc" title="A video" />'],
  ['plain HTML and links', '<a href="https://wso2.com">WSO2</a> and [mail](mailto:docs@wso2.com) and <details><summary>More</summary>Text</details>'],
];

test('each kind of code in a page is a finding on its line; literals, catalogue imports and allow-listed iframes are not', () => {
  const dir = copyStub();
  const rel = 'docs/guides/safety.mdx';
  for (const [what, body, pattern] of BAD) {
    fs.writeFileSync(path.join(dir, rel), page(body));
    const f = scan(dir);
    assert.ok(f.length >= 1, `${what}: expected a finding`);
    assert.ok(f.every((x) => x.level === 'error' && x.file === rel), `${what}: ${JSON.stringify(f)}`);
    assert.ok(f.some((x) => pattern.test(x.message)), `${what}: ${f.map((x) => x.message).join(' | ')}`);
    assert.ok(f.every((x) => x.line >= 7), `${what}: the line is in the body: ${f.map((x) => x.line)}`);
  }
  for (const [what, body] of GOOD) {
    fs.writeFileSync(path.join(dir, rel), page(body));
    assert.deepEqual(scan(dir), [], what);
  }
});

test('script files anywhere in the Doc space are findings; a page that does not parse is one too', () => {
  const dir = copyStub();
  for (const f of ['assets/x.js', 'docs/guides/y.tsx', 'partials/z.mjs', 'w.cjs', 'docs/a.jsx', 'docs/b.ts']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  const files = scan(dir).map((x) => x.file).sort();
  assert.deepEqual(files, ['assets/x.js', 'docs/a.jsx', 'docs/b.ts', 'docs/guides/y.tsx', 'partials/z.mjs', 'w.cjs']);
  const clean = copyStub();
  fs.writeFileSync(path.join(clean, 'docs/guides/broken.mdx'), page('A bare <tag here.'));
  const f = scan(clean);
  assert.equal(f.length, 1);
  assert.match(f[0].message, /does not parse/);
});

test('partials under partials/ and docs/_partials are checked like pages', () => {
  const dir = copyStub();
  fs.appendFileSync(path.join(dir, 'partials/sign-in-options.mdx'), '\nexport const x = 1;\n');
  fs.appendFileSync(path.join(dir, 'docs/_partials/_mfa-note.mdx'), '\n<span onMouseOver="x()">y</span>\n');
  assert.deepEqual(scan(dir).map((x) => x.file).sort(), ['docs/_partials/_mfa-note.mdx', 'partials/sign-in-options.mdx']);
});
