// Renders `layout: api-reference` pages. Reads the spec named in front matter
// (`spec: ./openapi.yaml`) and generates the page as MDX nodes: the API's own
// navigation, an anchored heading per tag and operation, parameter and
// response tables, collapsed schemas, and curl and response samples. It runs
// before Docusaurus's own remark plugins, so the TOC, anchors, server
// rendering, search records and canonicals treat it as ordinary page content.
//
// A page with sibling pages that set `tag:` is split: the index keeps the
// overview and each tag page renders that tag's operations (see `api split`).
import path from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import {
  collectOperations, curlExample, deref, flattenSchema, groupByTag, lintSpec, loadSpec, mediaExample,
  referencedSchemas, resolveSpecFile, schemaAnchor, serverUrl, typeLabel, validateSpec,
} from '../lib/openapi.mjs';
import { apiFolder, backLink, indexFrontMatter, isApiPage, tagPages } from '../lib/api-pages.mjs';

const VAR = /\{edition\.([A-Za-z_]\w*)\}/g;
const reported = new Set();

// ------------------------------------------------------------ node builders

const attrs = (o) => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([name, value]) => ({ type: 'mdxJsxAttribute', name, value: value === true ? null : String(value) }));
const el = (name, a = {}, children = []) => ({ type: 'mdxJsxFlowElement', name, attributes: attrs(a), children });
const span = (name, a = {}, children = []) => ({ type: 'mdxJsxTextElement', name, attributes: attrs(a), children });
const text = (value) => ({ type: 'text', value: String(value) });
const strong = (...children) => ({ type: 'strong', children });
const code = (value) => ({ type: 'inlineCode', value: String(value) });
const para = (...children) => ({ type: 'paragraph', children });
const link = (url, children) => ({ type: 'link', url, children });
const heading = (depth, id, children) => ({ type: 'heading', depth, children, data: { hProperties: { id } } });
const codeBlock = (lang, value, title) => el('ApiCode', { lang, title, code: value });
const list = (items) => ({ type: 'list', ordered: false, spread: false, children: items.map((c) => ({ type: 'listItem', spread: false, children: Array.isArray(c) ? c : [c] })) });

function table(head, rows, className) {
  return el('table', { className }, [
    el('thead', {}, [el('tr', {}, head.map((h) => el('th', {}, [text(h)])))]),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((cell) => el('td', {}, cell))))),
  ]);
}

// Spec descriptions are CommonMark. Raw HTML becomes text (a line break for
// <br>), in-page and relative links become their text, and headings become
// bold paragraphs, so no description reaches the TOC or breaks link checks.
const INLINE_TAGS = /^<\/?(b|strong|i|em|code|p|span|ul|ol|li|div|u|sup|sub)\b[^>]*>$/i;
function markdown(value) {
  if (!value || typeof value !== 'string' || !value.trim()) return [];
  const tree = fromMarkdown(value, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const fix = (node) => {
    if (!node.children) return node;
    node.children = node.children.flatMap((c) => {
      if (c.type === 'html') {
        if (/^<br\s*\/?>$/i.test(c.value.trim())) return [{ type: 'break' }];
        if (INLINE_TAGS.test(c.value.trim())) return [];
        return [text(c.value)];
      }
      if (c.type === 'heading') return [fix(para(strong(...c.children)))];
      if (c.type === 'link' && !/^(https?:|mailto:)/.test(c.url)) return fix({ type: 'emphasis', children: c.children }).children;
      if (c.type === 'image' && !/^https?:/.test(c.url)) return [text(c.alt ?? '')];
      if (c.type === 'definition' || c.type === 'footnoteDefinition') return [];
      return [fix(c)];
    });
    return node;
  };
  return fix(tree).children.map((c) => (c.type === 'html' ? para(c) : c));
}

// ------------------------------------------------------------------- pieces

function typeCell(spec, schema, schemaHref) {
  const t = typeLabel(spec, schema);
  if (!t.ref) return [code(t.text)];
  return [...(t.prefix ? [text(t.prefix)] : []), link(schemaHref(t.ref), [code(t.ref)])];
}

function describe(spec, schemaOrParam) {
  const s = deref(spec, schemaOrParam.schema ?? schemaOrParam) ?? {};
  const out = markdown(schemaOrParam.description ?? s.description);
  const facts = [];
  const values = s.enum ?? deref(spec, s.items)?.enum;
  if (Array.isArray(values) && values.length) facts.push(text('Allowed values: '), ...values.flatMap((v, i) => [...(i ? [text(', ')] : []), code(v)]));
  const def = schemaOrParam.default ?? s.default;
  if (def !== undefined && typeof def !== 'object') facts.push(...(facts.length ? [text('. ')] : []), text('Default: '), code(def));
  if (schemaOrParam.deprecated || s.deprecated) facts.push(...(facts.length ? [text('. ')] : []), strong(text('Deprecated')));
  if (facts.length) out.push(para(...facts));
  return out;
}

// Property rows for an object schema, with nested inline objects flattened
// to dotted names (two levels); named schemas link to their own section.
function propertyRows(spec, schema, schemaHref, prefix = '', depth = 0) {
  const s = flattenSchema(spec, schema);
  const required = new Set(s.required ?? []);
  const rows = [];
  for (const [name, prop] of Object.entries(s.properties ?? {})) {
    const p = deref(spec, prop) ?? {};
    rows.push([[code(`${prefix}${name}`)], typeCell(spec, prop, schemaHref), [text(required.has(name) ? 'Yes' : '')], describe(spec, { ...p, description: prop.description ?? p.description })]);
    const inline = !prop.$ref && (p.properties || p.allOf) && depth < 1;
    if (inline) rows.push(...propertyRows(spec, p, schemaHref, `${prefix}${name}.`, depth + 1));
  }
  return rows;
}

function propertiesBlock(spec, schema, schemaHref, summary, open) {
  const rows = propertyRows(spec, schema, schemaHref);
  if (!rows.length) return [];
  return [el('ApiDetails', { summary: summary ?? `${rows.length} ${rows.length === 1 ? 'property' : 'properties'}`, open: open || undefined }, [
    table(['Name', 'Type', 'Required', 'Description'], rows, 'wso2-api-table'),
  ])];
}

function schemaBlock(spec, schema, schemaHref) {
  if (!schema) return [];
  const t = typeLabel(spec, schema);
  const body = [para(text('Schema: '), ...typeCell(spec, schema, schemaHref))];
  const target = t.ref ? deref(spec, schema) : deref(spec, schema)?.type === 'array' ? deref(spec, deref(spec, schema).items) : deref(spec, schema);
  return [...body, ...propertiesBlock(spec, target, schemaHref)];
}

function operationNodes(spec, o, ctx) {
  const { schemaHref, base } = ctx;
  const op = o.op;
  const main = [
    heading(3, o.anchor, [text(o.summary)]),
    el('ApiEndpoint', { method: o.method, path: o.path, deprecated: op.deprecated || undefined }),
    ...markdown(op.description),
  ];
  const scopes = (op.security ?? spec.security ?? []).flatMap((r) => Object.values(r ?? {}).flat());
  if (scopes.length) main.push(para(strong(text('Scopes:')), text(' '), ...[...new Set(scopes)].flatMap((sc, i) => [...(i ? [text(', ')] : []), code(sc)])));

  if (o.params.length) {
    main.push(para(strong(text('Parameters'))));
    main.push(table(['Name', 'In', 'Type', 'Required', 'Description'], o.params.map((prm) => [
      [code(prm.name)], [text(prm.in)], typeCell(spec, prm.schema ?? deref(spec, prm.content && Object.values(prm.content)[0])?.schema, schemaHref),
      [text(prm.required ? 'Yes' : '')], describe(spec, prm),
    ]), 'wso2-api-table'));
  }

  const body = deref(spec, op.requestBody);
  if (body?.content) {
    main.push(para(strong(text('Request body')), text(body.required ? ' (required)' : ''), text(': '), ...Object.keys(body.content).flatMap((t, i) => [...(i ? [text(', ')] : []), code(t)])));
    main.push(...markdown(body.description));
    main.push(...schemaBlock(spec, Object.values(body.content)[0]?.schema, schemaHref));
  }

  const responses = Object.entries(op.responses ?? {}).filter(([status]) => !status.startsWith('x-'));
  if (responses.length) {
    main.push(para(strong(text('Responses'))));
    main.push(table(['Code', 'Description', 'Schema'], responses.map(([status, raw]) => {
      const r = deref(spec, raw) ?? {};
      const media = r.content && Object.values(r.content)[0];
      return [[code(status)], markdown(r.description), media?.schema ? typeCell(spec, media.schema, schemaHref) : []];
    }), 'wso2-api-table'));
  }

  const samples = [codeBlock('bash', curlExample(spec, o, base), 'Request')];
  const ok = responses.find(([status]) => /^2/.test(status));
  if (ok) {
    const r = deref(spec, ok[1]) ?? {};
    const [type, media] = Object.entries(r.content ?? {}).find(([t]) => /json/.test(t)) ?? [];
    const ex = media ? mediaExample(spec, media, 'response') : undefined;
    if (ex !== undefined && ex !== null) samples.push(codeBlock('json', JSON.stringify(ex, null, 2), `Response ${ok[0]} (${type})`));
  }
  for (const s of op['x-codeSamples'] ?? op['x-code-samples'] ?? []) {
    // Hand-written curl samples are replaced by the generated, placeholder-safe one.
    if (!s?.source || /^(curl|shell|bash|sh)$/i.test(s.lang ?? '')) continue;
    samples.push(codeBlock(String(s.lang).toLowerCase(), String(s.source).trimEnd(), s.label ?? s.lang));
  }

  return el('ApiOperation', { id: undefined, method: o.method }, [
    el('ApiOperationMain', {}, main),
    el('ApiSamples', {}, samples),
  ]);
}

function securityNodes(spec) {
  const schemes = Object.entries(spec.components?.securitySchemes ?? {});
  if (!schemes.length) return [];
  const out = [heading(2, 'security-schemes', [text('Security schemes')])];
  for (const [name, raw] of schemes) {
    const s = deref(spec, raw) ?? {};
    const kind = s.type === 'http' ? `HTTP ${s.scheme ?? ''}`.trim() : s.type === 'apiKey' ? `API key in ${s.in} "${s.name}"` : s.type;
    out.push(para(code(name), text(`: ${kind}`)), ...markdown(s.description));
    for (const [flowName, flow] of Object.entries(s.flows ?? {})) {
      const facts = [text(`${flowName} flow`)];
      if (flow.tokenUrl) facts.push(text(', token URL '), code(flow.tokenUrl));
      if (flow.authorizationUrl) facts.push(text(', authorization URL '), code(flow.authorizationUrl));
      out.push(para(...facts));
      const scopes = Object.entries(flow.scopes ?? {});
      if (scopes.length) {
        out.push(el('ApiDetails', { summary: `${scopes.length} scopes` }, [
          table(['Scope', 'Description'], scopes.map(([sc, d]) => [[code(sc)], [text(d)]]), 'wso2-api-table'),
        ]));
      }
    }
  }
  return out;
}

function schemaSection(spec, names, schemaHref) {
  if (!names.length) return [];
  const out = [heading(2, 'schemas', [text('Schemas')])];
  for (const name of names) {
    const s = deref(spec, spec.components.schemas[name]) ?? {};
    const flat = flattenSchema(spec, s);
    out.push(el('ApiSchema', {}, [
      heading(3, schemaAnchor(name), [text(name)]),
      para(text('Type: '), ...typeCell(spec, { ...s, $ref: undefined }, schemaHref)),
      ...markdown(flat.description),
      ...propertiesBlock(spec, s, schemaHref),
    ]));
  }
  return out;
}

// The API's own navigation: tags and their operations, across tag pages when split.
function navNodes(groups, hrefFor, current) {
  return el('ApiNav', {}, [list(groups.map((g) => [
    para(link(hrefFor(g, null), [text(g.name)])),
    ...(current === null || current === g.name
      ? [list(g.ops.map((o) => para(link(hrefFor(g, o), [span('ApiMethod', { method: o.method }), text(` ${o.summary}`)]))))]
      : []),
  ]))]);
}

// ----------------------------------------------------------------- plugin

// `routeBase`: the docs instance's route under the site base ('' or, for a
// Cloud part in its platform's tree, the part's slug).
export default function remarkApiReference({ docsDir, edition, vars = {}, routeBase = '' }) {
  const R = routeBase ? `${routeBase.replace(/\/$/, '')}/` : '';
  return (tree, file) => {
    let fm = file.data?.frontMatter ?? {};
    if (!file.path || !isApiPage(fm)) return;
    // Tag pages inherit the index page's spec and server.
    if (fm.tag !== undefined) fm = { ...indexFrontMatter(path.dirname(file.path)), ...fm };
    const where = path.relative(docsDir, file.path);
    if (!fm.spec) throw new Error(`${where}: layout: api-reference needs "spec:" (for example spec: ./openapi.yaml)`);

    let specFile;
    try {
      specFile = resolveSpecFile(path.dirname(file.path), String(fm.spec), edition.kind);
    } catch (err) {
      throw new Error(`${where}: ${err.message}`);
    }
    const spec = loadSpec(specFile);
    const specRel = path.relative(docsDir, specFile);
    const errors = validateSpec(spec);
    if (errors.length) {
      throw new Error(`${specRel}: OpenAPI validation failed (${errors.length} error${errors.length > 1 ? 's' : ''}):\n  ${errors.slice(0, 25).join('\n  ')}${errors.length > 25 ? `\n  … and ${errors.length - 25} more` : ''}`);
    }
    if (!reported.has(specFile)) {
      reported.add(specFile);
      const warnings = lintSpec(spec);
      if (warnings.length) console.warn(`[api-reference] ${specRel}: ${warnings.length} description lint warnings (warn only; run "wso2-docs api lint" for the list)`);
    }

    const substitute = (s) => String(s).replace(VAR, (_, name) => {
      if (!(name in vars)) throw new Error(`${where}: unknown variable {edition.${name}} in "server"; define it in editions.yaml`);
      return String(vars[name]);
    });
    const base = serverUrl(spec, fm.server ? substitute(fm.server) : null);
    const folder = apiFolder(docsDir, file.path);
    const groups = groupByTag(spec, collectOperations(spec));
    const pages = tagPages(path.dirname(file.path));
    const split = pages.size > 0;
    const currentTag = fm.tag !== undefined ? String(fm.tag) : null;

    if (split) {
      const missing = groups.filter((g) => !pages.has(g.name)).map((g) => g.name);
      if (missing.length) {
        throw new Error(`${where}: this API is split into tag pages, but these tags have none: ${missing.join(', ')}. Run "npx @wso2/docs api split docs/${path.relative(docsDir, path.dirname(file.path))}" to add them.`);
      }
    }
    if (currentTag !== null && !groups.some((g) => g.name === currentTag)) {
      throw new Error(`${where}: tag "${currentTag}" is not used by any operation in ${specRel}`);
    }

    // Page-relative anchors when the target is on this page, otherwise the tag page's route.
    const onThisPage = (tagName) => !split || tagName === currentTag;
    const pageRoute = (tagName) => (split ? `/${R}${folder}${pages.get(tagName)}/` : `/${R}${folder}`);
    const hrefFor = (g, o) => {
      const anchor = o ? o.anchor : g.anchor;
      return onThisPage(g.name) ? `#${anchor}` : `${pageRoute(g.name)}#${anchor}`;
    };
    const schemaHref = (name) => `#${schemaAnchor(name)}`;

    const shown = currentTag !== null ? groups.filter((g) => g.name === currentTag) : split ? [] : groups;
    const ctx = { schemaHref, base };
    const content = [];
    for (const g of shown) {
      content.push(el('ApiTag', {}, [
        heading(2, g.anchor, [text(g.name)]),
        ...markdown(g.description),
        ...g.ops.map((o) => operationNodes(spec, o, ctx)),
      ]));
    }
    if (split && currentTag === null) {
      content.push(heading(2, 'operations', [text('Operations')]));
      content.push(table(['Tag', 'Operations', 'Description'], groups.map((g) => [
        [link(pageRoute(g.name), [text(g.name)])], [text(g.ops.length)], markdown(g.description).slice(0, 1),
      ]), 'wso2-api-table'));
    }
    const schemaNames = currentTag !== null
      ? referencedSchemas(spec, shown.flatMap((g) => g.ops.map((o) => ({ p: o.params, b: o.op.requestBody, r: o.op.responses }))))
      : split ? [] : Object.keys(spec.components?.schemas ?? {});

    // The writer's MDX body is the overview; the spec's info.description stands in when it is empty.
    const esm = tree.children.filter((n) => n.type === 'mdxjsEsm');
    const body = tree.children.filter((n) => n.type !== 'mdxjsEsm');
    const hasBody = body.some((n) => !(n.type === 'paragraph' && !n.children.length));
    const overview = hasBody ? body : currentTag === null ? markdown(spec.info?.description) : [];
    const back = backLink(docsDir, file.path);

    tree.children = [
      ...esm,
      el('ApiReference', {
        title: spec.info?.title, version: spec.info?.version, server: base,
        specHref: `/${R}${folder}openapi.yaml`, backHref: `/${R}${back.route}`, backLabel: back.label,
      }, [
        navNodes(groups, hrefFor, currentTag ?? (split ? '' : null)),
        el('ApiContent', {}, [
          heading(1, 'api-title', [text(fm.title ?? spec.info?.title ?? 'API reference')]),
          el('ApiHeader', { version: spec.info?.version, server: base, specHref: `/${R}${folder}openapi.yaml` }),
          ...overview,
          ...(currentTag === null ? securityNodes(spec) : []),
          ...content,
          ...schemaSection(spec, schemaNames, schemaHref),
        ]),
      ]),
    ];
  };
}
