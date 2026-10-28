// Unit tests for API reference pages: OpenAPI validation and lint, samples
// and curl, tag-page splitting, spec sync, the page budget, the layout hooks,
// badge contrast and the spec sync workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  collectOperations, curlExample, groupByTag, lintSpec, placeholder, resolveSpecFile, sampleFromSchema, serverUrl, validateSpec,
} from '../lib/openapi.mjs';
import { splitApi, syncSpec, runApiCommand } from '../lib/api-commands.mjs';
import { tagPageName, tagPages, backLink } from '../lib/api-pages.mjs';
import { apiPageFrontMatter, apiSidebarItems } from '../lib/api-layout.mjs';
import { checkBudget, DEFAULT_BUDGET_KB } from '../plugins/api-reference.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureApi = path.join(root, 'fixtures/stub-repo/identity-server/docs/reference/apis/notifications');
const load = (f) => yaml.load(fs.readFileSync(f, 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-api-unit-'));

const minimal = (paths, extra = {}) => ({ openapi: '3.0.3', info: { title: 'T', version: '1' }, paths, ...extra });
const ok = { responses: { 200: { description: 'OK' } } };

test('validation accepts the fixture specs', () => {
  assert.deepEqual(validateSpec(load(path.join(fixtureApi, 'openapi.yaml'))), []);
  assert.deepEqual(validateSpec(load(path.join(fixtureApi, 'openapi.cloud.yaml'))), []);
});

test('validation: structure', () => {
  assert.match(validateSpec({ swagger: '2.0' })[0], /Swagger 2\.0 is not supported/);
  assert.ok(validateSpec({ openapi: '3.0.0', paths: {} }).some((e) => /info: is required/.test(e)));
  assert.ok(validateSpec(minimal({ x: { get: ok } })).some((e) => /must start with "\/"/.test(e)));
  assert.ok(validateSpec(minimal({ '/a': { get: {} } })).some((e) => /at least one response/.test(e)));
  assert.ok(validateSpec(minimal({ '/a': { get: { responses: { 200: {} } } } })).some((e) => /"description" is required/.test(e)));
  assert.ok(validateSpec(minimal({ '/a': { get: { ...ok, parameters: [{ name: 'q', in: 'body' }] } } })).some((e) => /"in" must be/.test(e)));
});

test('validation: path parameters must match the template', () => {
  const errors = validateSpec(minimal({ '/a/{id}': { get: { ...ok, parameters: [{ name: 'other', in: 'path', required: true }] } } }));
  assert.ok(errors.some((e) => /"\{id\}" is not declared/.test(e)));
  assert.ok(errors.some((e) => /"other" is not in the path/.test(e)));
  assert.ok(validateSpec(minimal({ '/a/{id}': { get: { ...ok, parameters: [{ name: 'id', in: 'path' }] } } })).some((e) => /required: true/.test(e)));
  // Path-level parameters count.
  assert.deepEqual(validateSpec(minimal({ '/a/{id}': { parameters: [{ name: 'id', in: 'path', required: true }], get: ok } })), []);
});

test('validation: broken and external $refs, duplicate operation IDs', () => {
  const spec = minimal({
    '/a': { get: { ...ok, operationId: 'same' } },
    '/b': { get: { operationId: 'same', responses: { 200: { $ref: '#/components/responses/Missing' } } } },
    '/c': { get: { ...ok, parameters: [{ $ref: 'other.yaml#/p' }] } },
  });
  const errors = validateSpec(spec);
  assert.ok(errors.some((e) => /duplicate operationId "same"/.test(e)));
  assert.ok(errors.some((e) => /broken \$ref "#\/components\/responses\/Missing"/.test(e)));
  assert.ok(errors.some((e) => /external \$ref "other\.yaml#\/p"/.test(e)));
});

test('validation: $ref inside examples and x- extensions is data', () => {
  const spec = minimal({
    '/a': {
      get: {
        responses: {
          200: { description: 'OK', content: { 'application/json': { example: { roles: [{ $ref: 'https://localhost/Roles/1' }] } } } },
          'x-codeSamples': [{ lang: 'curl' }],
        },
      },
    },
  });
  assert.deepEqual(validateSpec(spec), []);
});

test('lint warns, never errors', () => {
  const warnings = lintSpec(minimal({ '/a': { get: { ...ok, summary: 'Get Details of an API', parameters: [{ name: 'q', in: 'query' }] } }, '/b': { post: ok } }));
  assert.ok(warnings.some((w) => /not in sentence case/.test(w)));
  assert.ok(warnings.some((w) => /POST \/b: no summary/.test(w)));
  assert.ok(warnings.some((w) => /parameter "q" has no description/.test(w)));
  assert.ok(!lintSpec(minimal({ '/a': { get: { ...ok, summary: 'Get the API keys of an OAuth app', description: 'd' } } }, { tags: [{ name: 'x' }] })).length);
});

test('operations: first tag, anchors from operation IDs, tag order', () => {
  const spec = load(path.join(fixtureApi, 'openapi.yaml'));
  const ops = collectOperations(spec);
  assert.deepEqual(ops.map((o) => o.anchor), ['op-listNotifications', 'op-sendNotification', 'op-delete-notifications-notificationid', 'op-listTemplates', 'op-uploadTemplateLogo']);
  assert.deepEqual(groupByTag(spec).map((g) => [g.name, g.ops.length]), [['Notifications', 3], ['Templates', 2]]);
  assert.equal(ops[2].params[0].name, 'notificationId', 'path-level parameters are merged in');
});

test('samples: readOnly left out of requests, examples and defaults used', () => {
  const spec = load(path.join(fixtureApi, 'openapi.yaml'));
  const schema = { $ref: '#/components/schemas/Notification' };
  const req = sampleFromSchema(spec, schema, { mode: 'request' });
  const res = sampleFromSchema(spec, schema, { mode: 'response' });
  assert.equal(req.id, undefined);
  assert.equal(res.id, '01234567-89ab-cdef-0123-456789abcdef');
  assert.equal(req.recipient, 'alex@example.com');
  assert.equal(req.template.locale, 'en-US');
  assert.equal(req.channel, 'email');
});

test('curl: placeholders per the style guide, auth, body and files', () => {
  const spec = load(path.join(fixtureApi, 'openapi.yaml'));
  const ops = collectOperations(spec);
  const base = serverUrl(spec);
  assert.equal(base, 'https://localhost:9443/api/notifications/v1', 'server variables use their defaults');
  assert.equal(placeholder('apiId'), '<API_ID>');
  assert.equal(placeholder('X-Request-ID'), '<X_REQUEST_ID>');
  const list = curlExample(spec, ops[0], base);
  assert.match(list, /^curl -k "https:\/\/localhost:9443\/api\/notifications\/v1\/notifications\?channel=<CHANNEL>"/);
  assert.match(list, /-H "Authorization: Bearer <ACCESS_TOKEN>"/);
  assert.match(list, /-H "X-Request-ID: <X_REQUEST_ID>"/);
  assert.doesNotMatch(list, /limit=/, 'optional query parameters are left out');
  const send = curlExample(spec, ops[1], 'https://api.asgardeo.io/t/<ORG_NAME>');
  assert.match(send, /^curl -X POST "https:\/\/api\.asgardeo\.io/);
  assert.doesNotMatch(send, / -k /, '-k only for localhost');
  assert.match(send, /-H "Content-Type: application\/json"/);
  assert.match(send, /-d '\{\n {2}"recipient": "alex@example\.com"/);
  assert.match(curlExample(spec, ops[2], base), /-X DELETE -k ".*\/notifications\/<NOTIFICATION_ID>"/);
  assert.match(curlExample(spec, ops[4], base), /-F "file=@<FILE_PATH>" \\\n {2}-F "altText=<ALT_TEXT>"/);
  const basic = minimal({ '/a': { get: ok } }, { security: [{ b: [] }], components: { securitySchemes: { b: { type: 'http', scheme: 'basic' } } } });
  assert.match(curlExample(basic, collectOperations(basic)[0], 'https://h'), /-u "<USERNAME>:<PASSWORD>"/);
});

test('one spec per Edition where they differ', () => {
  assert.equal(path.basename(resolveSpecFile(fixtureApi, './openapi.yaml', 'cloud')), 'openapi.cloud.yaml');
  assert.equal(path.basename(resolveSpecFile(fixtureApi, './openapi.yaml', 'self-hosted')), 'openapi.yaml');
  assert.throws(() => resolveSpecFile(fixtureApi, './missing.yaml', 'cloud'), /not found/);
});

test('tag pages: found, named safely, and split writes the missing ones', () => {
  assert.deepEqual([...tagPages(fixtureApi)].sort(), [['Notifications', 'notifications-operations'], ['Templates', 'templates']]);
  assert.equal(tagPageName('/x/notifications', 'notifications'), 'notifications-operations');
  assert.equal(tagPageName('/x/notifications', 'index'), 'index-operations');
  assert.equal(tagPageName('/x/notifications', 'templates'), 'templates');

  const dir = path.join(tmp(), 'notifications');
  fs.mkdirSync(dir);
  fs.copyFileSync(path.join(fixtureApi, 'openapi.yaml'), path.join(dir, 'openapi.yaml'));
  fs.writeFileSync(path.join(dir, 'index.mdx'), '---\ntitle: Notification API\nlayout: api-reference\nspec: ./openapi.yaml\n---\n');
  fs.writeFileSync(path.join(dir, 'templates.mdx'), '---\ntitle: T\nlayout: api-reference\ntag: Templates\n---\n');
  const created = splitApi(dir);
  assert.deepEqual(created.map((f) => path.basename(f)), ['notifications-operations.mdx']);
  const fm = yaml.load(/^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(created[0], 'utf8'))[1]);
  assert.deepEqual(fm, { title: 'Notifications: Notification API', description: 'Send notifications and list the ones already sent.', type: 'reference', layout: 'api-reference', tag: 'Notifications' });
  assert.deepEqual(splitApi(dir), [], 'running it again adds nothing');
});

test('Back to Reference finds the nearest Reference page', () => {
  const docs = path.join(root, 'fixtures/stub-repo/identity-server/docs');
  assert.deepEqual(backLink(docs, path.join(fixtureApi, 'index.mdx')), { route: 'reference/', label: 'Back to Reference' });
});

test('page budget', () => {
  assert.equal(DEFAULT_BUDGET_KB, 400);
  const over = checkBudget([{ route: 'reference/apis/big/', folder: 'reference/apis/big/', gzipBytes: 401 * 1024 }, { route: 'reference/apis/small/', folder: 'reference/apis/small/', gzipBytes: 10 }], 400);
  assert.equal(over.length, 1);
  assert.match(over[0], /reference\/apis\/big\/: 401 KB .* "npx @wso2\/docs api split docs\/reference\/apis\/big"/);
});

test('layout hooks: front matter and sidebar', async () => {
  assert.deepEqual(apiPageFrontMatter({ layout: 'api-reference', title: 'X' }), {
    displayed_sidebar: null, hide_table_of_contents: true, hide_title: true, pagination_prev: null, pagination_next: null, layout: 'api-reference', title: 'X',
  });
  assert.deepEqual(apiPageFrontMatter({ title: 'Y' }), { title: 'Y' });
  const items = await apiSidebarItems({
    docs: [{ id: 'api/index', frontMatter: { layout: 'api-reference' } }, { id: 'api/tag-a', frontMatter: { layout: 'api-reference', tag: 'A' } }, { id: 'other', frontMatter: {} }],
    defaultSidebarItemsGenerator: async () => [
      { type: 'doc', id: 'other' },
      { type: 'category', label: 'API', link: { type: 'doc', id: 'api/index' }, items: [{ type: 'doc', id: 'api/tag-a' }] },
    ],
  });
  assert.deepEqual(items, [{ type: 'doc', id: 'other' }, { type: 'doc', id: 'api/index', label: 'API' }]);
});

test('spec sync: unchanged, changed, invalid', () => {
  const dir = tmp();
  const from = path.join(dir, 'product.yaml');
  const to = path.join(dir, 'content', 'openapi.yaml');
  fs.copyFileSync(path.join(fixtureApi, 'openapi.yaml'), from);
  const first = syncSpec(from, to);
  assert.equal(first.changed, true);
  assert.equal(first.added.length, 5);
  assert.equal(syncSpec(from, to).changed, false);
  fs.copyFileSync(path.join(fixtureApi, 'openapi.cloud.yaml'), from);
  const second = syncSpec(from, to);
  assert.deepEqual(second.added, ['GET /notifications/usage']);
  assert.match(second.summary, /Operations added: 1 \(`GET \/notifications\/usage`\)/);
  fs.writeFileSync(from, 'openapi: 3.0.0\ninfo: {title: x, version: "1"}\npaths:\n  /a:\n    get:\n      responses:\n        "200": {$ref: "#/nope"}\n');
  const bad = syncSpec(from, to);
  assert.equal(bad.invalid, true);
  assert.match(fs.readFileSync(to, 'utf8'), /usage/, 'an invalid spec is never copied');
});

test('api validate exits non-zero on errors', () => {
  const dir = tmp();
  const file = path.join(dir, 'openapi.yaml');
  fs.writeFileSync(file, yaml.dump(minimal({ '/a': { get: { ...ok, operationId: 'x' } }, '/b': { get: { ...ok, operationId: 'x' } } })));
  const out = [];
  assert.equal(runApiCommand(['validate', file], (s) => out.push(s), (s) => out.push(s)), 1);
  assert.match(out.join('\n'), /duplicate operationId "x"/);
  assert.equal(runApiCommand(['validate', path.join(root, 'fixtures/stub-repo/identity-server')], () => {}, () => {}), 0);
});

// WCAG 2.2 AA for the method badges and the download button, in both themes.
function tokens() {
  const css = fs.readFileSync(path.join(root, 'site/src/css/oxygen-tokens.css'), 'utf8');
  const block = (re) => Object.fromEntries([...re.exec(css)[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  return { light: block(/:root, \[data-theme="light"\] \{([\s\S]*?)\n\}/), dark: block(/\[data-theme="dark"\] \{([\s\S]*?)\n\}/) };
}
function luminance(color) {
  const m = /^#([0-9a-f]{6})/i.exec(color);
  const rgb = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color).slice(1).map(Number);
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('method badges and the download button meet WCAG 2.2 AA in both themes', () => {
  const t = tokens();
  const css = fs.readFileSync(path.join(root, 'site/src/css/api-reference.css'), 'utf8');
  for (const [theme, re] of [['light', /:root, \[data-theme='light'\] \{([\s\S]*?)\}/], ['dark', /\[data-theme='dark'\] \{([\s\S]*?)\}/]]) {
    const vars = Object.fromEntries([...re.exec(css)[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const value = (v) => (v.startsWith('var(') ? t[theme][/var\((--[\w-]+)\)/.exec(v)[1]] : v);
    const bg = t[theme]['--oxygen-palette-background-default'];
    for (const m of ['get', 'post', 'put', 'delete', 'other']) {
      const fg = value(vars[`--wso2-api-${m}`]);
      assert.ok(contrast(fg, bg) >= 4.5, `${theme} ${m}: ${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}:1`);
    }
    const primary = t[theme][theme === 'light' ? '--oxygen-palette-primary-dark' : '--oxygen-palette-primary-light'];
    const on = vars['--wso2-api-on-primary'];
    assert.ok(contrast(on, primary) >= 4.5, `${theme} download button: ${on} on ${primary} is ${contrast(on, primary).toFixed(2)}:1`);
  }
});

test('spec sync workflow is a valid reusable workflow', () => {
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/spec-sync.yml'), 'utf8'));
  const call = wf.on.workflow_call;
  for (const k of ['product-repo', 'product-spec-path', 'content-spec-path']) assert.equal(call.inputs[k].required, true, k);
  assert.deepEqual(wf.permissions, { contents: 'write', 'pull-requests': 'write' });
  const text = fs.readFileSync(path.join(root, '.github/workflows/spec-sync.yml'), 'utf8');
  for (const [, name] of text.matchAll(/\$\{\{\s*inputs\.([\w-]+)/g)) assert.ok(call.inputs[name], `inputs.${name} is declared`);
  for (const [, name] of text.matchAll(/\$\{\{\s*secrets\.(\w+)/g)) assert.ok(call.secrets[name], `secrets.${name} is declared`);
  const steps = wf.jobs.sync.steps;
  assert.ok(steps.some((s) => /api sync --from "\$FROM" --to "\$TO"/.test(s.run ?? '')), 'runs the Platform sync command');
  assert.ok(steps.some((s) => s.if === "steps.sync.outputs.changed == 'true'" && /gh pr create/.test(s.run)), 'opens a PR only when the spec changed');
  for (const s of steps.filter((x) => x.uses)) assert.match(s.uses, /^actions\/(checkout|setup-node)@v\d+$/);
});

test('the remark step blocks invalid specs and incomplete splits, and anchors every operation', async () => {
  const { default: remarkApiReference } = await import('../plugins/remark-api-reference.mjs');
  const docs = path.join(tmp(), 'docs');
  const dir = path.join(docs, 'reference', 'apis', 'demo');
  fs.mkdirSync(dir, { recursive: true });
  const run = (fm, file = path.join(dir, 'index.mdx')) => {
    const tree = { type: 'root', children: [] };
    remarkApiReference({ docsDir: docs, edition: { id: 'cloud', kind: 'cloud' }, vars: { host: 'https://h' } })(tree, { path: file, data: { frontMatter: fm } });
    return tree;
  };
  const page = { layout: 'api-reference', spec: './openapi.yaml', server: '{edition.host}/v1' };
  fs.writeFileSync(path.join(dir, 'openapi.yaml'), yaml.dump(minimal({ '/a': { get: { ...ok, operationId: 'x' } }, '/b': { get: { ...ok, operationId: 'x' } } })));
  assert.throws(() => run(page), /OpenAPI validation failed \(1 error\):\n {2}paths\["\/b"\]\.get\.operationId: duplicate operationId "x"/);

  fs.writeFileSync(path.join(dir, 'openapi.yaml'), yaml.dump(minimal({ '/a': { get: { ...ok, operationId: 'one', tags: ['A'] } }, '/b': { get: { ...ok, operationId: 'two', tags: ['B'] } } })));
  const headings = [];
  const walk = (n) => { if (n.type === 'heading') headings.push(n.data.hProperties.id); (n.children ?? []).forEach(walk); };
  walk(run(page));
  assert.deepEqual(headings, ['api-title', 'tag-a', 'op-one', 'tag-b', 'op-two']);
  assert.throws(() => run({ ...page, server: '{edition.nope}' }), /unknown variable \{edition\.nope\}/);
  // A Self-hosted-only API page shown in Cloud: its server from the newest release's variables.
  const additions = { newestRelease: '7.3.0', vars: { host: 'https://localhost:9443' } };
  const served = (fm) => {
    const tree = { type: 'root', children: [] };
    remarkApiReference({ docsDir: docs, edition: { id: 'cloud', kind: 'cloud' }, vars: { host: 'https://h' }, additions })(tree, { path: path.join(dir, 'index.mdx'), data: { frontMatter: fm } });
    return JSON.stringify(tree);
  };
  assert.match(served({ ...page, editions: 'self-hosted' }), /https:\/\/localhost:9443\/v1/);
  assert.match(served(page), /https:\/\/h\/v1/);

  fs.writeFileSync(path.join(dir, 'index.mdx'), `---\n${yaml.dump(page)}---\n`);
  fs.writeFileSync(path.join(dir, 'a.mdx'), '---\nlayout: api-reference\ntag: A\n---\n');
  assert.throws(() => run(page), /split into tag pages, but these tags have none: B\. Run "npx @wso2\/docs api split docs\/reference\/apis\/demo"/);
  fs.writeFileSync(path.join(dir, 'b.mdx'), '---\nlayout: api-reference\ntag: B\n---\n');
  headings.length = 0;
  walk(run({ layout: 'api-reference', tag: 'B' }, path.join(dir, 'b.mdx')));
  assert.deepEqual(headings, ['api-title', 'tag-b', 'op-two'], 'a tag page renders its own tag only');
  assert.throws(() => run({ layout: 'api-reference', tag: 'Z' }, path.join(dir, 'a.mdx')), /tag "Z" is not used/);
});
