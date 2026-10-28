// Converter rules for products built from several MkDocs trees with Jinja
// (docs-is → docs-identity-platform/identity-server/): includes, the condition and variable
// tables, Edition contexts and markers, spec fixes, plus one end-to-end run
// over a tiny two-tree project (fixtures/mkdocs-is-mini). The real corpus is
// never converted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { checkDataFile } from '../lib/data-files.mjs';
import { tokenize, parse, parseExpr, evalExpr, expandIncludes, JinjaTables, Undefined, printValue } from '../migration/lib/jinja.mjs';
import {
  Regions, adjacentAlternatives, cloudCounterpartsOf, renderStructured, renderFlat, makeScope, markerFor, markersToJsx, splitBlocks, filterLines, wrapVariants,
} from '../migration/lib/variants.mjs';
import { imageOrVariants } from '../migration/lib/mdx.mjs';
import { fixSpec } from '../migration/lib/specs.mjs';
import { readMkdocsConfig, redirectMaps } from '../migration/lib/mkdocs.mjs';
import { checkEditions } from '../migration/lib/pagecheck.mjs';
import { convertProduct } from '../migration/lib/run.mjs';
import { validateSpec } from '../lib/openapi.mjs';
import ip from '../migration/products/identity-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'mkdocs-is-mini', 'en');

test('a tag alone on its line takes the line with it; inline tags do not', () => {
  const toks = tokenize('a\n  {% if x %}\nb {% if y %}c{% endif %}\n{% endif %}\nd');
  const own = toks.filter((t) => t.t === 'tag').map((t) => [t.name, t.own, JSON.stringify(t.lead), JSON.stringify(t.trail)]);
  assert.deepEqual(own, [['if', true, '"  "', '"\\n"'], ['if', false, '""', '""'], ['endif', false, '""', '""'], ['endif', true, '""', '"\\n"']]);
  assert.equal(toks[0].v, 'a\n', 'the indentation before an own-line tag moves into the tag');
});

test('raw blocks and comments', () => {
  const nodes = parse(tokenize('{# note #}x{% raw %}{{ keep }}{% endraw %}y'));
  assert.deepEqual(nodes.map((n) => n.v), ['x{{ keep }}y']);
});

test('unknown tags, conditions and variables fail the run', () => {
  assert.throws(() => parse(tokenize('{% for x in y %}{% endfor %}')), /has no conversion rule/);
  const tables = new JinjaTables({ conditions: ['product == "is"'], variables: { product: { literal: true } } });
  assert.ok(tables.condition('product  ==  "is"', 'p'), 'whitespace does not matter');
  assert.throws(() => tables.condition('product == "x"', 'p'), /not in the product's condition table/);
  assert.throws(() => tables.output('mystery_var', 'p'), /not in the product's variable table/);
  assert.ok(tables.output("'{{tenant domain}}'", 'p'), 'a string literal needs no rule');
});

test('Jinja expressions as Jinja2 evaluates them (DebugUndefined)', () => {
  const scope = makeScope({ product_name: 'WSO2 Identity Server', is_version: '7.3.0', content: { a: 'x' } });
  const ev = (e) => evalExpr(parseExpr(e), scope, e);
  assert.equal(ev('product_name == "WSO2 Identity Server" and is_version > "7.2.0"'), true);
  assert.equal(ev('is_version not in ["7.0.0", "7.1.0"]'), true);
  assert.equal(ev('missing is defined'), false);
  assert.equal(ev('missing == "x"'), false, 'an undefined value equals nothing');
  assert.throws(() => ev('missing > "7.2.0"'), /undefined/, 'Jinja fails on ordering an undefined value');
  assert.equal(ev("'a' if product_name == 'WSO2 Identity Server' else 'b'"), 'a');
  assert.equal(printValue(ev('missing')), '{{ missing }}', 'DebugUndefined prints itself back');
  assert.equal(printValue(ev('content.b')), "{{ no such element: dict object['b'] }}");
  assert.ok(ev('missing') instanceof Undefined);
});

test('includes: the includer indent prefixes every line, nested paths resolve from the included file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-inc-'));
  fs.mkdirSync(path.join(dir, 'docs', 'a'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'inc'));
  fs.writeFileSync(path.join(dir, 'inc', 'one.md'), '---\ntemplate: x\n---\nline1\nline2\n{% include "./two.md" %}\n');
  fs.writeFileSync(path.join(dir, 'inc', 'two.md'), 'nested\n');
  const fm = [];
  const out = expandIncludes('    {% include "../../inc/one.md" %}\nafter', path.join(dir, 'docs', 'a', 'page.md'), path.join(dir, 'docs'), { onFrontMatter: (f) => fm.push(f) });
  assert.equal(out, '    line1\n    line2\n    nested\n    \n\nafter', 'as the plugin does, the blank line after a nested include is prefixed too');
  assert.equal(fm.length, 1, 'front matter of an included file is dropped and reported');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('INHERIT merges mappings and replaces lists; redirect_maps are read', () => {
  const c = readMkdocsConfig(path.join(fixture, 'identity-server', '7.3.0', 'mkdocs.yml'));
  assert.equal(c.theme.name, 'material');
  assert.equal(c.extra.redoc_theme, 'light', 'parent extra kept');
  assert.equal(c.extra.is_version, '7.3.0');
  assert.deepEqual(redirectMaps(c), [{ from: 'setup/install.md', to: 'deploy/install.md' }]);
  const a = readMkdocsConfig(path.join(fixture, 'asgardeo', 'mkdocs.yml'));
  assert.equal(a.extra.product_toggle.target_url, 'https://is.docs.wso2.com/en/latest/', '!ENV takes its default');
});

const releaseContexts = ip.contexts('7.3.0');
const mainContexts = ip.contexts('cloud');

test('markers: product conditions → only=, versions after the latest release → selfHostedFrom="next"', () => {
  const all = new Set(['cloud', '7.3.0']);
  assert.deepEqual(markerFor(new Set(['cloud']), all, releaseContexts), { marker: { only: 'cloud' }, show: true });
  assert.deepEqual(markerFor(new Set(['7.3.0']), all, releaseContexts), { marker: { only: 'self-hosted' }, show: true });
  assert.deepEqual(markerFor(all, all, releaseContexts), { marker: null, show: true });
  const main = new Set(['cloud', 'next', '7.3.0']);
  assert.deepEqual(markerFor(new Set(['cloud', 'next']), main, mainContexts).marker, { selfHostedFrom: 'next' });
  assert.deepEqual(markerFor(new Set(['next']), main, mainContexts).marker, { only: 'self-hosted', selfHostedFrom: 'next' });
  assert.equal(markerFor(new Set(['7.3.0']), main, mainContexts).show, false, 'content only 7.3.0 had is not on main');
});

function render(src, contexts, globalsById) {
  const tables = new JinjaTables({ conditions: ip.conditions, variables: ip.variables });
  const env = {
    out: (node, scope) => printValue(evalExpr(tables.output(node.expr, 't'), scope)),
    value: (expr, scope) => evalExpr(tables.output(expr, 't'), scope),
    branch: (node, scope) => node.branches.findIndex((b) => b.cond === null || evalExpr(tables.condition(b.cond, 't'), scope) === true),
  };
  const ids = contexts.map((c) => c.id);
  const regions = new Regions(contexts, ids);
  const scopes = new Map(ids.map((id) => [id, makeScope(globalsById[id])]));
  const text = renderStructured(parse(tokenize(src)), ids, scopes, env, regions);
  return { text, regions, env, ids };
}

test('a block-level condition becomes one region per branch; an inline one, per-Edition blocks', () => {
  const g = { cloud: { product_name: 'WSO2 Identity Platform' }, '7.3.0': { product_name: 'WSO2 Identity Server', is_version: '7.3.0' } };
  const src = 'Intro.\n\n{% if product_name == "WSO2 Identity Platform" %}\n## Cloud only\n\nText.\n{% else %}\n## Server only\n{% endif %}\n\nShared {% if product_name == "WSO2 Identity Server" %}server{% endif %} word.\n\nEnd.\n';
  const { text, regions } = render(src, releaseContexts, g);
  const jsx = markersToJsx(text, regions);
  // Adjacent Cloud and Self-hosted forms are an Edition variant: each Edition shows only its own.
  assert.match(jsx, /Intro\.\n\n<Variants>\n\n<Edition only="cloud">\n\n## Cloud only\n\nText\.\n\n<\/Edition>\n\n<Edition only="self-hosted">\n\n## Server only\n\n<\/Edition>\n\n<\/Variants>/);
  assert.match(jsx, /<Variants>\n\n<Edition only="cloud">\n\nShared  word\.\n\n<\/Edition>\n\n<Edition only="self-hosted">\n\nShared server word\.\n\n<\/Edition>\n\n<\/Variants>\n\nEnd\./);
  assert.equal(adjacentAlternatives(jsx), 0);
  assert.deepEqual(filterLines(text.split('\n'), regions, 'cloud').filter((l) => l.startsWith('#')), ['## Cloud only'], 'headings stay with their Edition');
});

test('Edition variants: adjacent Cloud and Self-hosted forms at one level, never a Self-hosted addition alone', () => {
  const md = (s) => s.join('\n');
  // In a list item, after an addition, and a third form left alone.
  const text = md([
    '1. Step.', '', '    <Edition only="self-hosted">', '', '    Server step.', '', '    </Edition>', '',
    '<Edition only="self-hosted">', '', 'Addition.', '', '</Edition>', '',
    'Shared.', '',
    '<Edition only="self-hosted" selfHostedFrom="next">', '', 'Next form.', '', '</Edition>', '',
    '<Edition only="cloud">', '', 'Cloud form.', '', '</Edition>', '',
    '<Edition only="self-hosted">', '', 'Third.', '', '</Edition>', '',
    '> <Edition only="cloud">', '>', '> Quoted cloud.', '>', '> </Edition>', '>', '> <Edition only="self-hosted">', '>', '> Quoted server.', '>', '> </Edition>',
  ]);
  assert.equal(adjacentAlternatives(text), 3, 'next/cloud, cloud/self-hosted and the quoted pair');
  const out = wrapVariants(text);
  assert.equal(out.count, 2);
  // A Cloud form pairs with the plain Self-hosted form next to it before one from a version.
  assert.match(out.mdx, /<Edition only="self-hosted" selfHostedFrom="next">\n\nNext form\.\n\n<\/Edition>\n\n<Variants>\n\n<Edition only="cloud">\n\nCloud form\.\n\n<\/Edition>\n\n<Edition only="self-hosted">\n\nThird\.\n\n<\/Edition>\n\n<\/Variants>/);
  assert.match(out.mdx, /> <Variants>\n>\n> <Edition only="cloud">[^]*> <\/Edition>\n>\n> <\/Variants>$/);
  assert.match(out.mdx, /^1\. Step\.\n\n {4}<Edition only="self-hosted">/, 'a lone form is a Self-hosted addition');
  assert.equal(adjacentAlternatives(out.mdx), 0, 'the next form stays Self-hosted only, next to the variant');
  // Inline image alternatives become an inline variant.
  assert.equal(imageOrVariants({ alternatives: [{ attrs: 'only="cloud"', src: 'a.png' }, { attrs: 'only="self-hosted"', src: 'b.png' }] }, { alt: 'x' }),
    '<Variants><Edition only="cloud">![x](a.png)</Edition><Edition only="self-hosted">![x](b.png)</Edition></Variants>');
  assert.equal(imageOrVariants({ alternatives: [{ attrs: 'only="self-hosted"', src: 'b.png' }, { attrs: null, src: 'c.png' }] }, { alt: 'x' }),
    '<Edition only="self-hosted">![x](b.png)</Edition>![x](c.png)', 'not a Cloud and Self-hosted pair: as before');
});

test('cloudCounterpart: a Self-hosted-only page and a Cloud-only page in the same navigation slot', () => {
  const page = (target, kind, navPath, inNav = true) => ({ target, url: `${target}/`, kind: 'page', marker: kind, navPath, inNav });
  const pages = [
    page('guides/mfa-server', 'self-hosted', ['Guides', 'MFA']),
    page('guides/mfa-cloud', 'cloud', ['Guides', 'MFA']),
    page('deploy/install', 'self-hosted', ['Deploy', 'Install']),
    page('guides/a', 'self-hosted', ['Guides', 'Two']),
    page('guides/b', 'cloud', ['Guides', 'Two']),
    page('guides/c', 'cloud', ['Guides', 'Two']),
    page('guides/hidden', 'self-hosted', ['(not in nav)'], false),
    page('guides/hidden-cloud', 'cloud', ['(not in nav)'], false),
  ];
  const r = cloudCounterpartsOf(pages);
  assert.deepEqual([...r.counterparts], [['guides/mfa-server', 'guides/mfa-cloud']]);
  assert.deepEqual(r.ambiguous, [{ slot: 'Guides > Two', selfHosted: ['guides/a'], cloud: ['guides/b', 'guides/c'] }]);
  // The same label in another slot is only reported as possible.
  const moved = cloudCounterpartsOf([page('deploy/logs', 'self-hosted', ['Deploy', 'Logs']), page('guides/logs', 'cloud', ['Guides', 'Logs'])]);
  assert.equal(moved.counterparts.size, 0);
  assert.deepEqual(moved.possible, [{ selfHosted: ['deploy/logs'], cloud: ['guides/logs'] }]);
});

test('blocks keep containers and code fences whole', () => {
  assert.deepEqual(splitBlocks('a\n\n!!! note\n    one\n\n    two\n\n```\nx\n\ny\n```\n\nb'), ['a', '!!! note\n    one\n\n    two', '```\nx\n\ny\n```', 'b']);
});

test('the per-Edition check catches content in the wrong Edition', () => {
  const contexts = releaseContexts;
  const clean = new Map([['cloud', 'A cloud page.\n'], ['7.3.0', 'A server page.\n']]);
  assert.ok(checkEditions('A <Edition only="cloud">cloud</Edition><Edition only="self-hosted">server</Edition> page.\n', contexts, clean).ok);
  const bad = checkEditions('A <Edition only="self-hosted">cloud</Edition><Edition only="cloud">server</Edition> page.\n', contexts, clean);
  assert.equal(bad.ok, false);
  assert.equal(bad.failures.length, 2);
});

test('spec fixes: Swagger 2.0, #/definitions refs, duplicate operation ids, body parameters', () => {
  const s = fs.readFileSync(path.join(fixture, 'identity-server', '7.3.0', 'docs', 'apis', 'restapis', 'users.yaml'), 'utf8');
  const r = fixSpec(s);
  assert.equal(r.valid, true, r.problems.join('; '));
  assert.equal(r.spec.openapi, '3.0.3');
  assert.equal(r.spec.servers[0].url, 'https://localhost:9443/api/users');
  assert.ok(r.spec.paths['/users'].post.requestBody);
  assert.equal(r.spec.paths['/users'].post.operationId, 'listUsers2');
  assert.deepEqual(validateSpec(yaml.load(r.text)), []);
  const oas3 = 'openapi: 3.0.3\ninfo: {title: T}\npaths:\n  /a:\n    post:\n      parameters:\n        - {in: body, name: b, schema: {$ref: "#/definitions/X"}}\n        - {$ref: "#/components/parameters/Gone"}\n      responses: {"200": {description: ok}}\ncomponents:\n  schemas:\n    X: {type: object}\n';
  const f = fixSpec(oas3);
  assert.equal(f.valid, true, f.problems.join('; '));
  assert.equal(f.spec.info.version, '1.0.0');
  assert.equal(f.spec.paths['/a'].post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/X');
  const same = 'openapi: 3.0.3\ninfo: {title: T, version: "1"}\npaths: {}\n';
  assert.equal(fixSpec(same).text, same, 'a valid spec is kept byte for byte');
});

test('end to end: two trees and shared includes become one Content repo branch', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-migration-is-'));
  const { summary, report } = await convertProduct({
    config: { ...ip, overrides: null }, sourceRoot: fixture, outDir: out, edition: '7.3.0', legacyVersion: '7.3.0', sourceRef: 'wso2/docs-is@test',
  });
  const read = (p) => fs.readFileSync(path.join(out, p), 'utf8');
  assert.equal(summary.compileFailures, 0, JSON.stringify(report.items.filter((i) => i.kind === 'compile')));
  assert.equal(summary.stats.editionCheckFailures, 0, JSON.stringify(report.items.filter((i) => i.kind === 'edition-check')));

  const mfa = read('docs/guides/mfa.mdx');
  assert.match(mfa, /^title: Add MFA$/m);
  assert.doesNotMatch(mfa, /^editions:/m, 'a page in both trees is shared');
  assert.match(mfa, /This guide adds MFA in \{edition\.productName\}\./, 'the Edition variable where the value is the Edition\'s');
  assert.match(mfa, /<Edition only="cloud">\n\n## Cloud prerequisites\n\nSign in to the Console at `https:\/\/console\.asgardeo\.io`\.\n\n<\/Edition>/);
  assert.match(mfa, /<Edition only="self-hosted">\n\n## Server prerequisites/);
  assert.match(mfa, /<Edition only="self-hosted">\n\n```bash\ncurl https:\/\/localhost:9443\/api\/mfa\n```/, 'a condition inside a code block gives one block per Edition');
  assert.match(mfa, /^description: This guide adds MFA in WSO2 Identity Server\./m, 'descriptions read as the branch\'s Edition');
  // An inline version condition: the list differs, so it is written once per Edition.
  assert.match(mfa, /<Edition only="self-hosted">\n\n1\. Open the prerequisites or the \[install guide\]\(\.\.\/deploy-and-operate\/install\.mdx\)\.\n2\. Enable MFA with passkeys\.\n\n {4}!\[MFA screen\]\(\.\.\/\.\.\/assets\/self-hosted\/img\/mfa\.png\)/,
    'version resolved for the branch; the anchor only Cloud has and the page only 7.3.0 has are links only there; each tree\'s own screenshot');
  assert.match(mfa, /<Edition only="cloud">\n\n1\. Open the \[prerequisites\]\(#cloud-prerequisites\) or the install guide\.\n2\. Enable MFA\.\n\n {4}!\[MFA screen\]\(\.\.\/\.\.\/assets\/cloud\/img\/mfa\.png\)/,
    'a file only Cloud pages use goes to assets/cloud/');
  assert.ok(fs.existsSync(path.join(out, 'assets/cloud/img/mfa.png')) && fs.existsSync(path.join(out, 'assets/self-hosted/img/mfa.png')));
  assert.ok(!fs.existsSync(path.join(out, 'assets/img/mfa.png')), 'an Edition-only file is not also in assets/');
  // Adjacent Cloud and Self-hosted alternatives are Edition variants, so Cloud shows its own form only.
  assert.match(mfa, /<Variants>\n\n<Edition only="cloud">\n\n## Cloud prerequisites[^]*?<\/Edition>\n\n<Edition only="self-hosted">\n\n## Server prerequisites[^]*?<\/Edition>\n\n<\/Variants>/);
  assert.ok(summary.stats.variants >= 1);
  assert.equal(summary.stats.adjacentAlternatives, 0);

  const billing = read('docs/guides/billing.mdx');
  assert.match(billing, /^editions: cloud$/m);
  assert.match(billing, /Billing exists in \{edition\.productName\} only/);
  const install = read('docs/deploy-and-operate/install.mdx');
  assert.match(install, /^editions: self-hosted$/m);
  assert.match(install, /\\\{\\\{ no such element: dict object\['default_keystore_type'\] \\\}\\\}/, 'an undefined value prints back, as DebugUndefined did');
  assert.ok(!fs.existsSync(path.join(out, 'docs/guides/beta.mdx')), 'a page whose feature flag is off is left out');

  // A theme template's grid from mkdocs.yml data: the catalog layout over a data file next to the page.
  const connectors = read('docs/guides/connectors/index.mdx');
  assert.match(connectors, /^layout: catalog$/m);
  assert.match(connectors, /^data: \.\/connectors\.yaml$/m);
  assert.match(connectors, /^description: This page lists the available connectors for WSO2 Identity Server 7\.3\.0\.( {2}# generated .*)?$/m);
  assert.match(connectors, /\n\nThis page lists the available connectors for \{edition\.productName\} \{edition\.version\}\.\n$/);
  const data = yaml.load(read('docs/guides/connectors/connectors.yaml'));
  assert.deepEqual(data, {
    schemaVersion: 1,
    categories: [{ id: 'fraud-detection', label: 'Fraud detection' }, { id: 'authentication', label: 'Authentication' }],
    items: [
      { id: 'sift', name: 'Sift', description: 'Helps prevent fraudulent logins to WSO2 Identity Server.', href: './sift/overview.mdx', links: [{ label: 'Connector store', url: 'https://store.wso2.com/connector/identity-fraud-detection-sift' }], category: 'fraud-detection', logo: 'assets/self-hosted/img/logo/sift-logo.svg' },
      { id: 'duo-security', name: 'Duo Security', description: 'Provides two-factor authentication.', href: 'https://github.com/wso2-extensions/identity-outbound-auth-duo/blob/master/docs/README.md', links: [{ label: 'Connector store', url: 'https://store.wso2.com/connector/identity-outbound-auth-duo' }], category: 'authentication' },
    ],
  });
  assert.ok(fs.existsSync(path.join(out, 'assets/self-hosted/img/logo/sift-logo.svg')), 'the logo is an asset of the Doc space');
  assert.deepEqual(checkDataFile('catalog', path.join(out, 'docs/guides/connectors/connectors.yaml'), { docsDir: path.join(out, 'docs') }).problems, [], 'it follows the catalog schema');
  assert.ok(report.items.some((i) => i.kind === 'catalog' && /Duo Security"'s icon assets\/img\/logo\/duo-logo\.png is missing/.test(i.message)));
  assert.equal(summary.stats.catalogItems, 2);
  // The home page's cards: the overview layout.
  assert.match(read('docs/index.mdx'), /^layout: overview$/m);

  const api = read('docs/reference/apis/users/index.mdx');
  assert.match(api, /^layout: api-reference$/m);
  assert.ok(fs.existsSync(path.join(out, 'docs/reference/apis/users/openapi.cloud.yaml')));
  assert.match(read('docs/reference/apis/users/openapi.self-hosted.yaml'), /^openapi: 3\.0\.3$/m, 'Swagger 2.0 converted');

  const redirects = new Map(yaml.load(read('redirects.yaml')).legacy.map((l) => [l.from, l.to]));
  assert.equal(redirects.get('https://is.docs.wso2.com/en/7.3.0/guides/mfa/'), 'guides/mfa');
  assert.equal(redirects.get('https://is.docs.wso2.com/en/7.3.0/setup/install/'), 'deploy-and-operate/install', 'redirect_maps flattened');
  assert.equal(redirects.get('https://wso2.com/asgardeo/docs/guides/billing/'), undefined, 'a version branch maps only its own legacy site');
  const editions = yaml.load(read('editions.yaml'));
  assert.equal(editions.cloud.apiBaseUrl, 'https://api.asgardeo.io/t/{organization_name}');
  // The full Doc space manifest, the same on every branch.
  const docspace = yaml.load(read('docspace.yaml'));
  assert.deepEqual(docspace, ip.docspace);
  assert.equal(docspace.cloud.in, 'identity-platform', 'its main line is a Cloud part of Identity Platform Cloud');
  assert.match(read('docspace.yaml'), /^# Generated by the WSO2 Docs converter from wso2\/docs-is@test/m);
  fs.rmSync(out, { recursive: true, force: true });
});

test('end to end on main: Cloud plus next, with the IS 7.3.0 tree telling new content apart', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-migration-is-'));
  const next = path.join(fixture, 'identity-server', 'next');
  fs.cpSync(path.join(fixture, 'identity-server', '7.3.0'), next, { recursive: true });
  try {
    fs.writeFileSync(path.join(next, 'mkdocs.yml'), fs.readFileSync(path.join(next, 'mkdocs.yml'), 'utf8').replace('is_version: 7.3.0', 'is_version: next').replace('/en/7.3.0', '/en/next'));
    fs.writeFileSync(path.join(next, 'docs', 'guides', 'mfa.md'), `${fs.readFileSync(path.join(next, 'docs', 'guides', 'mfa.md'), 'utf8')}`);
    const { summary } = await convertProduct({ config: { ...ip, overrides: null }, sourceRoot: fixture, outDir: out, edition: 'cloud', legacyVersion: null, sourceRef: 'wso2/docs-is@test' });
    assert.equal(summary.compileFailures, 0);
    const redirects = new Map(yaml.load(fs.readFileSync(path.join(out, 'redirects.yaml'), 'utf8')).legacy.map((l) => [l.from, l.to]));
    assert.equal(redirects.get('https://wso2.com/asgardeo/docs/guides/billing/'), 'guides/billing');
    assert.equal(redirects.get('https://wso2.com/identity-platform/docs/guides/old-mfa/'), 'guides/mfa');
  } finally {
    fs.rmSync(next, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
