// OpenAPI helpers for API reference pages: loading a page's spec, the
// blocking validation (structure, broken $refs, duplicate operation IDs), the
// warn-only description lint, and the pieces the renderer builds from
// (operations grouped by tag, anchors, schema types, samples, curl commands).
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
const PARAM_IN = new Set(['query', 'header', 'path', 'cookie']);
const PATH_ITEM_KEYS = new Set([...METHODS, 'parameters', 'summary', 'description', 'servers', '$ref']);
const UNTAGGED = 'Other';

const cache = new Map();

// Parsed spec, cached by path and modification time (tag pages share one spec).
export function loadSpec(file) {
  const { mtimeMs, size } = fs.statSync(file);
  const hit = cache.get(file);
  if (hit?.mtimeMs === mtimeMs && hit.size === size) return hit.spec;
  let spec;
  try {
    spec = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file}: not valid YAML: ${err.message.split('\n')[0]}`);
  }
  cache.set(file, { mtimeMs, size, spec });
  return spec;
}

// The spec file one Edition renders: `openapi.cloud.yaml` or
// `openapi.self-hosted.yaml` next to the named file wins when it exists, so a
// folder holds one spec per Edition only where the APIs differ.
export function resolveSpecFile(pageDir, specRef, editionKind) {
  const named = path.resolve(pageDir, specRef);
  const ext = path.extname(named);
  const perEdition = `${named.slice(0, -ext.length)}.${editionKind}${ext}`;
  if (fs.existsSync(perEdition)) return perEdition;
  if (fs.existsSync(named)) return named;
  throw new Error(`spec "${specRef}" not found (looked for ${path.basename(perEdition)} and ${path.basename(named)})`);
}

const unescapePointer = (s) => decodeURIComponent(s).replace(/~1/g, '/').replace(/~0/g, '~');

export function resolvePointer(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return undefined;
  const parts = ref.slice(1).split('/').filter((p, i) => i > 0 || p !== '');
  let cur = spec;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[unescapePointer(p)];
  }
  return cur;
}

// Follows $ref chains (local only); returns the target object or the input.
export function deref(spec, obj, seen = new Set()) {
  let cur = obj;
  while (cur && typeof cur === 'object' && typeof cur.$ref === 'string') {
    if (seen.has(cur.$ref)) return {};
    seen.add(cur.$ref);
    const next = resolvePointer(spec, cur.$ref);
    if (next === undefined) return {};
    cur = next;
  }
  return cur;
}

export const refName = (ref) => (typeof ref === 'string' ? unescapePointer(ref.split('/').pop()) : null);
export const schemaRefName = (ref) => (typeof ref === 'string' && ref.startsWith('#/components/schemas/') ? refName(ref) : null);

const idSafe = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
export const slug = (s) => idSafe(String(s).toLowerCase()) || 'x';
export const tagAnchor = (tag) => `tag-${slug(tag)}`;
export const schemaAnchor = (name) => `schema-${idSafe(name)}`;

function operationAnchor(method, p, op) {
  if (op.operationId) return `op-${idSafe(op.operationId)}`;
  return `op-${method}-${slug(p.replace(/[{}]/g, ''))}`;
}

// Every operation, in spec order, with its primary tag (its first tag): an
// operation with several tags is rendered once, under the first.
export function collectOperations(spec) {
  const ops = [];
  for (const [p, rawItem] of Object.entries(spec.paths ?? {})) {
    const item = deref(spec, rawItem) ?? {};
    for (const method of METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      const tags = Array.isArray(op.tags) && op.tags.length ? op.tags.map(String) : [UNTAGGED];
      const params = mergeParameters(spec, item.parameters, op.parameters);
      ops.push({
        method, path: p, op, pathItem: item, params, tags, tag: tags[0],
        summary: op.summary?.trim() || `${method.toUpperCase()} ${p}`,
        anchor: operationAnchor(method, p, op),
      });
    }
  }
  return ops;
}

function mergeParameters(spec, pathLevel = [], opLevel = []) {
  const byKey = new Map();
  for (const raw of [...(Array.isArray(pathLevel) ? pathLevel : []), ...(Array.isArray(opLevel) ? opLevel : [])]) {
    const prm = deref(spec, raw);
    if (!prm?.name) continue;
    byKey.set(`${prm.in}:${prm.name}`, prm);
  }
  return [...byKey.values()];
}

// Tags in display order: the spec's declared `tags` first, then any others in
// the order operations use them. Each carries its operations.
export function groupByTag(spec, ops = collectOperations(spec)) {
  const declared = new Map((spec.tags ?? []).filter((t) => t?.name).map((t) => [String(t.name), t]));
  const groups = new Map();
  for (const name of declared.keys()) groups.set(name, []);
  for (const op of ops) {
    if (!groups.has(op.tag)) groups.set(op.tag, []);
    groups.get(op.tag).push(op);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length)
    .map(([name, list]) => ({ name, description: declared.get(name)?.description ?? '', anchor: tagAnchor(name), ops: list }));
}

// For the Markdown twin and llms.txt: a compact list of operations.
export function operationList(spec) {
  return collectOperations(spec).map((o) => ({ method: o.method.toUpperCase(), path: o.path, summary: o.summary, tag: o.tag, anchor: o.anchor }));
}

// ---------------------------------------------------------------- validation

// Visits every $ref, skipping example values and x- extensions, which are
// data (a SCIM example may well have a "$ref" field).
function walkRefs(node, at, visit) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkRefs(v, `${at}/${i}`, visit));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') visit(v, at);
      else if (k === 'example' || k.startsWith('x-') || (k === 'value' && /\/examples\/[^/]+$/.test(at))) continue;
      else walkRefs(v, `${at}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, visit);
    }
  }
}

// Blocking checks. Returns a list of error strings ("<where>: <problem>");
// an empty list means the spec can be rendered.
export function validateSpec(spec) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['(root): not an OpenAPI document'];
  if (spec.swagger) return ['(root): Swagger 2.0 is not supported; convert the spec to OpenAPI 3'];
  if (typeof spec.openapi !== 'string' || !/^3\.[01]\.\d+$/.test(spec.openapi)) err('openapi', `must be "3.0.x" or "3.1.x", found ${JSON.stringify(spec.openapi)}`);
  if (!spec.info || typeof spec.info !== 'object') err('info', 'is required');
  else {
    if (typeof spec.info.title !== 'string' || !spec.info.title.trim()) err('info.title', 'is required');
    if (spec.info.version === undefined || spec.info.version === null || typeof spec.info.version === 'object') err('info.version', 'is required');
  }
  if (spec.servers !== undefined) {
    if (!Array.isArray(spec.servers)) err('servers', 'must be a list');
    else spec.servers.forEach((s, i) => { if (typeof s?.url !== 'string') err(`servers[${i}].url`, 'is required'); });
  }
  if (spec.paths === undefined && !spec.webhooks) err('paths', 'is required');
  if (spec.paths !== undefined && (typeof spec.paths !== 'object' || Array.isArray(spec.paths))) err('paths', 'must be a map');

  walkRefs(spec, '#', (ref, at) => {
    if (!ref.startsWith('#')) err(at, `external $ref "${ref}" is not supported; bundle the spec into one file`);
    else if (resolvePointer(spec, ref) === undefined) err(at, `broken $ref "${ref}"`);
  });

  const ids = new Map();
  for (const [p, rawItem] of Object.entries(spec.paths && typeof spec.paths === 'object' ? spec.paths : {})) {
    const where = `paths["${p}"]`;
    if (!p.startsWith('/')) err(where, 'path must start with "/"');
    const item = deref(spec, rawItem);
    if (!item || typeof item !== 'object') { err(where, 'must be a path item object'); continue; }
    for (const k of Object.keys(item)) if (!PATH_ITEM_KEYS.has(k) && !k.startsWith('x-')) err(where, `unknown key "${k}"`);
    const templated = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const pathLevel = checkParameters(spec, item.parameters, `${where}.parameters`, err);
    for (const method of METHODS) {
      const op = item[method];
      if (op === undefined) continue;
      const ow = `${where}.${method}`;
      if (!op || typeof op !== 'object') { err(ow, 'must be an operation object'); continue; }
      if (op.operationId !== undefined) {
        if (typeof op.operationId !== 'string' || !op.operationId) err(`${ow}.operationId`, 'must be a non-empty string');
        else if (ids.has(op.operationId)) err(`${ow}.operationId`, `duplicate operationId "${op.operationId}" (also ${ids.get(op.operationId)})`);
        else ids.set(op.operationId, ow);
      }
      if (op.tags !== undefined && (!Array.isArray(op.tags) || op.tags.some((t) => typeof t !== 'string'))) err(`${ow}.tags`, 'must be a list of strings');
      const opLevel = checkParameters(spec, op.parameters, `${ow}.parameters`, err);
      const pathParams = new Set([...pathLevel, ...opLevel].filter((x) => x.in === 'path').map((x) => x.name));
      for (const t of templated) if (!pathParams.has(t)) err(ow, `path parameter "{${t}}" is not declared`);
      for (const name of pathParams) if (!templated.includes(name)) err(ow, `path parameter "${name}" is not in the path`);
      if (op.requestBody !== undefined) {
        const body = deref(spec, op.requestBody);
        if (!body?.content || typeof body.content !== 'object') err(`${ow}.requestBody`, '"content" is required');
      }
      if (!op.responses || typeof op.responses !== 'object' || !Object.keys(op.responses).length) {
        if (spec.openapi?.startsWith('3.0')) err(`${ow}.responses`, 'at least one response is required');
      } else {
        for (const [code, raw] of Object.entries(op.responses)) {
          if (code.startsWith('x-')) continue;
          if (!/^([1-5](\d\d|XX)|default)$/.test(code)) err(`${ow}.responses`, `"${code}" is not a status code`);
          const r = deref(spec, raw);
          if (r && typeof r === 'object' && typeof r.description !== 'string') err(`${ow}.responses.${code}`, '"description" is required');
        }
      }
    }
  }
  return errors;
}

function checkParameters(spec, list, where, err) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { err(where, 'must be a list'); return []; }
  const seen = new Set();
  const out = [];
  list.forEach((raw, i) => {
    const prm = deref(spec, raw);
    const w = `${where}[${i}]`;
    if (!prm || typeof prm !== 'object') return err(w, 'must be a parameter object');
    if (typeof prm.name !== 'string' || !prm.name) return err(w, '"name" is required');
    if (!PARAM_IN.has(prm.in)) return err(w, `"in" must be query, header, path or cookie (found ${JSON.stringify(prm.in)})`);
    if (prm.in === 'path' && prm.required !== true) err(w, `path parameter "${prm.name}" must have required: true`);
    const key = `${prm.in}:${prm.name}`;
    if (seen.has(key)) err(w, `duplicate parameter "${prm.name}" in ${prm.in}`);
    seen.add(key);
    out.push(prm);
  });
  return out;
}

// ---------------------------------------------------------------------- lint

// Words that keep their capital inside a sentence-case summary.
const PROPER = new Set(['API', 'APIs', 'WSO2', 'OAuth', 'OAuth2', 'GraphQL', 'AsyncAPI', 'OpenAPI', 'Swagger', 'SOAP', 'REST', 'WSDL', 'MCP',
  'JWT', 'SAML', 'OIDC', 'SCIM', 'SDK', 'SDKs', 'URL', 'URLs', 'ID', 'IDs', 'UUID', 'HTTP', 'HTTPS', 'JSON', 'YAML', 'XML', 'TOTP', 'OTP',
  'FIDO', 'FIDO2', 'Kubernetes', 'AWS', 'Azure', 'Google', 'Microsoft', 'Facebook', 'GitHub', 'Asgardeo', 'Choreo', 'Postman', 'Identity', 'Server']);

// Warn-only description lint: summaries present and in sentence case,
// descriptions present, no Redoc-style in-page links.
export function lintSpec(spec) {
  const warnings = [];
  const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
  for (const o of collectOperations(spec)) {
    const where = `${o.method.toUpperCase()} ${o.path}`;
    if (!o.op.summary?.trim()) warn(where, 'no summary');
    else {
      const words = o.op.summary.trim().split(/\s+/);
      const capped = words.slice(1).filter((w) => /^[A-Z][a-z]+[a-z']*$/.test(w.replace(/[^A-Za-z']/g, '')) && !PROPER.has(w.replace(/[^A-Za-z0-9]/g, '')));
      if (capped.length) warn(where, `summary is not in sentence case ("${o.op.summary.trim()}")`);
      if (/\.\s*$/.test(o.op.summary)) warn(where, 'summary ends with a period');
    }
    if (!o.op.description?.trim()) warn(where, 'no description');
    for (const prm of o.params) if (!prm.description?.trim()) warn(where, `parameter "${prm.name}" has no description`);
  }
  if (!Array.isArray(spec.tags) || !spec.tags.length) warn('tags', 'no tags are declared at the top level, so tag descriptions are missing');
  walkDescriptions(spec, (text, at) => {
    if (/\]\(#/.test(text)) warn(at, 'description links to an in-page anchor; such links are rendered as plain text');
  });
  return warnings;
}

function walkDescriptions(node, visit, at = '#') {
  if (Array.isArray(node)) node.forEach((v, i) => walkDescriptions(v, visit, `${at}/${i}`));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'description' && typeof v === 'string') visit(v, at);
      else walkDescriptions(v, visit, `${at}/${k}`);
    }
  }
}

// ------------------------------------------------------------ schema helpers

// Merges allOf parts into one object schema (properties and required).
export function flattenSchema(spec, schema, seen = new Set()) {
  const s = deref(spec, schema);
  if (!s || typeof s !== 'object') return {};
  if (!Array.isArray(s.allOf)) return s;
  const out = { ...s, properties: { ...(s.properties ?? {}) }, required: [...(s.required ?? [])] };
  delete out.allOf;
  for (const part of s.allOf) {
    const ref = part?.$ref;
    if (ref && seen.has(ref)) continue;
    const flat = flattenSchema(spec, part, new Set([...seen, ...(ref ? [ref] : [])]));
    Object.assign(out.properties, flat.properties ?? {});
    out.required.push(...(flat.required ?? []));
    for (const k of ['type', 'description', 'example']) if (out[k] === undefined && flat[k] !== undefined) out[k] = flat[k];
  }
  return out;
}

// A short type label and the schema names it links to, e.g. "array of API".
export function typeLabel(spec, schema) {
  if (!schema || typeof schema !== 'object') return { text: 'any', ref: null };
  const ref = schemaRefName(schema.$ref);
  if (ref) return { text: ref, ref };
  const s = deref(spec, schema);
  if (s.type === 'array') {
    const inner = typeLabel(spec, s.items);
    return { text: `array of ${inner.text}`, ref: inner.ref, prefix: 'array of ' };
  }
  for (const k of ['oneOf', 'anyOf']) {
    if (Array.isArray(s[k])) {
      const names = s[k].map((x) => typeLabel(spec, x).text);
      return { text: `${k === 'oneOf' ? 'one of' : 'any of'}: ${names.join(', ')}`, ref: null };
    }
  }
  if (s.allOf) {
    const refs = s.allOf.map((x) => schemaRefName(x?.$ref)).filter(Boolean);
    if (refs.length === 1) return { text: refs[0], ref: refs[0] };
    return { text: 'object', ref: null };
  }
  const type = Array.isArray(s.type) ? s.type.join(' | ') : s.type ?? (s.properties ? 'object' : 'any');
  return { text: s.format ? `${type} (${s.format})` : type, ref: null };
}

// Schema names a schema refers to, transitively (for the Schemas section of a tag page).
export function referencedSchemas(spec, roots) {
  const found = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') {
        const name = schemaRefName(v);
        if (name && !found.has(name)) {
          found.add(name);
          visit(spec.components?.schemas?.[name]);
        } else if (!name && !found.has(v)) {
          found.add(v);
          visit(resolvePointer(spec, v));
        }
      } else visit(v);
    }
  };
  visit(roots);
  return [...found].filter((n) => spec.components?.schemas?.[n] !== undefined);
}

// ------------------------------------------------------------------- samples

const FORMAT_SAMPLES = {
  'date-time': '2026-01-01T00:00:00Z', date: '2026-01-01', email: 'user@example.com', uri: 'https://example.com',
  url: 'https://example.com', uuid: '01234567-89ab-cdef-0123-456789abcdef', password: 'password', byte: 'U3dhZ2dlcg==',
  binary: '<binary>', hostname: 'example.com', ipv4: '192.0.2.1',
};

// A JSON example built from a schema: example, then default, then enum, then
// a typed placeholder. readOnly properties are left out of requests and
// writeOnly ones out of responses.
export function sampleFromSchema(spec, schema, { mode = 'response', depth = 0, seen = new Set() } = {}) {
  if (!schema || typeof schema !== 'object') return null;
  const ref = schema.$ref;
  if (ref) {
    if (seen.has(ref) || depth > 6) return {};
    return sampleFromSchema(spec, deref(spec, schema), { mode, depth, seen: new Set([...seen, ref]) });
  }
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.allOf) return sampleFromSchema(spec, flattenSchema(spec, schema), { mode, depth, seen });
  if (schema.oneOf?.length) return sampleFromSchema(spec, schema.oneOf[0], { mode, depth, seen });
  if (schema.anyOf?.length) return sampleFromSchema(spec, schema.anyOf[0], { mode, depth, seen });
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type ?? (schema.properties ? 'object' : undefined);
  switch (type) {
    case 'array': return depth > 5 ? [] : [sampleFromSchema(spec, schema.items, { mode, depth: depth + 1, seen })];
    case 'string': return FORMAT_SAMPLES[schema.format] ?? 'string';
    case 'integer': case 'number': return schema.minimum ?? 0;
    case 'boolean': return true;
    case 'object': {
      if (depth > 5) return {};
      const out = {};
      for (const [name, prop] of Object.entries(schema.properties ?? {})) {
        const p = deref(spec, prop);
        if ((mode === 'request' && p?.readOnly) || (mode === 'response' && p?.writeOnly)) continue;
        out[name] = sampleFromSchema(spec, prop, { mode, depth: depth + 1, seen });
      }
      if (!schema.properties && schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        out.property = sampleFromSchema(spec, schema.additionalProperties, { mode, depth: depth + 1, seen });
      }
      return out;
    }
    default: return null;
  }
}

// The example for one media type: its own example(s) first, then the schema.
export function mediaExample(spec, media, mode) {
  if (!media) return undefined;
  if (media.example !== undefined) return media.example;
  const first = media.examples && Object.values(media.examples)[0];
  if (first) {
    const ex = deref(spec, first);
    if (ex?.value !== undefined) return ex.value;
  }
  if (media.schema) return sampleFromSchema(spec, media.schema, { mode });
  return undefined;
}

// ---------------------------------------------------------------------- curl

// Style-guide placeholder: <API_ID> for apiId, <ACCESS_TOKEN>, ...
export const placeholder = (name) => `<${String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()}>`;

// Base URL for curl: the page's `server` (with Edition variables already
// filled in) or the spec's first server, whose variables use their defaults
// and otherwise become placeholders.
export function serverUrl(spec, override) {
  if (override) return String(override).replace(/\/$/, '');
  const s = spec.servers?.[0];
  if (!s?.url) return '<BASE_URL>';
  return s.url.replace(/\{([^}]+)\}/g, (_, v) => s.variables?.[v]?.default ?? placeholder(v)).replace(/\/$/, '');
}

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function authArgs(spec, op) {
  const requirements = op.security ?? spec.security ?? [];
  const first = requirements.find((r) => r && Object.keys(r).length);
  if (!first) return [];
  const scheme = deref(spec, spec.components?.securitySchemes?.[Object.keys(first)[0]]);
  if (!scheme) return [];
  if (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'basic') return ['-u "<USERNAME>:<PASSWORD>"'];
  if (scheme.type === 'apiKey') {
    if (scheme.in === 'header') return [`-H "${scheme.name}: <API_KEY>"`];
    return [];
  }
  return ['-H "Authorization: Bearer <ACCESS_TOKEN>"'];
}

// A copy-ready curl command with placeholders for every value the reader must supply.
export function curlExample(spec, o, base) {
  let p = o.path.replace(/\{([^}]+)\}/g, (_, n) => placeholder(n));
  const query = o.params.filter((x) => x.in === 'query' && x.required).map((x) => `${encodeURIComponent(x.name)}=${placeholder(x.name)}`);
  if (query.length) p += `?${query.join('&')}`;
  const target = `${base}${p}`;
  const lines = [`curl${o.method === 'get' ? '' : ` -X ${o.method.toUpperCase()}`}${/\/\/(localhost|127\.0\.0\.1)[:/]/.test(base) ? ' -k' : ''} "${target}"`];
  lines.push(...authArgs(spec, o.op));
  for (const h of o.params.filter((x) => x.in === 'header' && x.required)) lines.push(`-H "${h.name}: ${placeholder(h.name)}"`);
  const body = deref(spec, o.op.requestBody);
  const content = body?.content ?? {};
  const type = Object.keys(content)[0];
  if (type) {
    const media = content[type];
    if (/json/.test(type)) {
      lines.push(`-H "Content-Type: ${type}"`);
      const ex = mediaExample(spec, media, 'request');
      lines.push(`-d ${shellQuote(JSON.stringify(ex ?? {}, null, 2))}`);
    } else if (type === 'multipart/form-data' || type === 'application/x-www-form-urlencoded') {
      const schema = flattenSchema(spec, media.schema);
      const flag = type === 'multipart/form-data' ? '-F' : '--data-urlencode';
      for (const [name, prop] of Object.entries(schema.properties ?? {})) {
        const pr = deref(spec, prop);
        const isFile = pr?.format === 'binary' || pr?.format === 'base64' || pr?.type === 'file';
        lines.push(`${flag} "${name}=${isFile && flag === '-F' ? '@' : ''}${isFile ? '<FILE_PATH>' : placeholder(name)}"`);
      }
    } else {
      lines.push(`-H "Content-Type: ${type}"`, '--data-binary "@<FILE_PATH>"');
    }
  }
  return lines.join(' \\\n  ');
}
