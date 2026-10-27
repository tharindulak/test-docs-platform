// Fixes the OpenAPI specs a migrated API page copies, so they pass the
// Platform's blocking validation (lib/openapi.mjs validateSpec): Swagger 2.0
// converted to OpenAPI 3.0, Swagger-style #/definitions refs pointed at
// components, broken refs replaced by a described stub, duplicate operation
// ids made unique, a missing info.version filled, undeclared path parameters
// declared. A spec that needs no fix is kept byte for byte.
import yaml from 'js-yaml';
import { validateSpec, METHODS, resolvePointer } from '../../lib/openapi.mjs';

export function fixSpec(text) {
  const fixes = [];
  let spec;
  try {
    spec = yaml.load(text);
  } catch (err) {
    return { text, spec: null, fixes, problems: [`not valid YAML: ${err.message.split('\n')[0]}`], valid: false };
  }
  if (!validateSpec(spec).length) return { text, spec, fixes, problems: [], valid: true };
  if (spec?.swagger) {
    spec = swagger2ToOpenApi3(spec);
    fixes.push('converted from Swagger 2.0 to OpenAPI 3.0.3');
  }
  if (spec.info && (spec.info.version === undefined || spec.info.version === null)) {
    spec.info.version = '1.0.0';
    fixes.push('info.version was missing; set to 1.0.0');
  }
  // A parameter whose $ref points nowhere is dropped (a stub would not be a parameter).
  const broken = (x) => x && typeof x.$ref === 'string' && x.$ref.startsWith('#') && resolvePointer(spec, x.$ref) === undefined
    && !(/^#\/definitions\//.test(x.$ref) && resolvePointer(spec, x.$ref.replace('#/definitions/', '#/components/schemas/')) !== undefined);
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    for (const holder of [item, ...METHODS.map((m) => item?.[m])]) {
      if (!holder || !Array.isArray(holder.parameters)) continue;
      const keep = holder.parameters.filter((x) => !broken(x));
      if (keep.length !== holder.parameters.length) {
        fixes.push(`parameter $ref(s) under ${p} that point nowhere removed`);
        holder.parameters = keep;
      }
    }
  }
  // Refs: #/definitions/X → #/components/schemas/X; anything else broken → a stub.
  walk(spec, (obj) => {
    if (typeof obj.$ref !== 'string' || !obj.$ref.startsWith('#') || resolvePointer(spec, obj.$ref) !== undefined) return;
    const m = /^#\/definitions\/(.+)$/.exec(obj.$ref);
    if (m && resolvePointer(spec, `#/components/schemas/${m[1]}`) !== undefined) {
      fixes.push(`$ref ${obj.$ref} → #/components/schemas/${m[1]}`);
      obj.$ref = `#/components/schemas/${m[1]}`;
      return;
    }
    fixes.push(`broken $ref ${obj.$ref} replaced by a described empty schema`);
    const ref = obj.$ref;
    delete obj.$ref;
    obj.description = `${obj.description ? `${obj.description} ` : ''}(The source spec refers to ${ref}, which it does not define.)`;
  });
  const ids = new Set();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    if (!item || typeof item !== 'object') continue;
    const templated = [...p.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]);
    for (const method of METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      if (typeof op.operationId === 'string') {
        if (ids.has(op.operationId)) {
          let n = 2;
          while (ids.has(`${op.operationId}${n}`)) n++;
          fixes.push(`duplicate operationId ${op.operationId} (${method.toUpperCase()} ${p}) renamed to ${op.operationId}${n}`);
          op.operationId = `${op.operationId}${n}`;
        }
        ids.add(op.operationId);
      }
      // Swagger 2.0 body and formData parameters left in an OpenAPI 3 spec.
      const params = op.parameters ?? [];
      const body = params.find((x) => x?.in === 'body');
      const form = params.filter((x) => x?.in === 'formData');
      if (body || form.length) {
        op.parameters = params.filter((x) => x?.in !== 'body' && x?.in !== 'formData');
        if (!op.parameters.length) delete op.parameters;
        if (!op.requestBody) {
          if (body) op.requestBody = { ...(body.description ? { description: body.description } : {}), required: Boolean(body.required), content: { 'application/json': { schema: body.schema ?? {} } } };
          else {
            const props = Object.fromEntries(form.map((x) => [x.name, { type: x.type === 'file' ? 'string' : (x.type ?? 'string'), ...(x.type === 'file' ? { format: 'binary' } : {}), ...(x.description ? { description: x.description } : {}) }]));
            op.requestBody = { content: { 'multipart/form-data': { schema: { type: 'object', properties: props } } } };
          }
        }
        fixes.push(`${body ? 'body' : 'formData'} parameter of ${method.toUpperCase()} ${p} (Swagger 2.0 style) moved to requestBody`);
      }
      // Path parameters the path does not have.
      for (const list of [item, op]) {
        if (!Array.isArray(list.parameters)) continue;
        const keep = list.parameters.filter((x) => !(x && !x.$ref && x.in === 'path' && !templated.includes(x.name)));
        if (keep.length !== list.parameters.length) {
          fixes.push(`path parameter(s) of ${method.toUpperCase()} ${p} that are not in the path removed`);
          list.parameters = keep;
        }
      }
      const declared = new Set([...(item.parameters ?? []), ...(op.parameters ?? [])].map((x) => resolveParam(spec, x)).filter((x) => x?.in === 'path').map((x) => x.name));
      for (const t of templated) {
        if (declared.has(t)) continue;
        op.parameters = [...(op.parameters ?? []), { name: t, in: 'path', required: true, schema: { type: 'string' } }];
        fixes.push(`path parameter {${t}} of ${method.toUpperCase()} ${p} was not declared; declared as a string`);
      }
      for (const prm of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        if (prm && !prm.$ref && prm.in === 'path' && prm.required !== true) {
          prm.required = true;
          fixes.push(`path parameter ${prm.name} of ${method.toUpperCase()} ${p} marked required`);
        }
      }
      for (const [code, r] of Object.entries(op.responses ?? {})) {
        if (r && typeof r === 'object' && !r.$ref && typeof r.description !== 'string') {
          r.description = '';
          fixes.push(`response ${code} of ${method.toUpperCase()} ${p} had no description`);
        }
      }
    }
  }
  const problems = validateSpec(spec);
  // A rewritten spec keeps the source's leading comment (its licence header).
  const header = /^(?:[ \t]*#[^\n]*\n|[ \t]*\n)*/.exec(text)[0].replace(/\n\s*$/, '\n');
  const out = fixes.length ? `${header.trim() ? `${header}\n` : ''}${yaml.dump(spec, { lineWidth: -1, noRefs: true })}` : text;
  return { text: out, spec, fixes: dedupe(fixes), problems, valid: !problems.length };
}

const dedupe = (list) => {
  const counts = new Map();
  for (const f of list) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts].map(([f, n]) => (n > 1 ? `${f} (×${n})` : f));
};

function resolveParam(spec, p) {
  return p?.$ref ? resolvePointer(spec, p.$ref) : p;
}

function walk(node, fn, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (!Array.isArray(node)) fn(node);
  for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, fn, seen);
}

// A plain Swagger 2.0 → OpenAPI 3.0 conversion: servers from host/basePath,
// definitions, parameters and responses to components, body and formData
// parameters to request bodies, response schemas to content.
export function swagger2ToOpenApi3(s) {
  const json = JSON.parse(JSON.stringify(s).replace(/"#\/definitions\//g, '"#/components/schemas/')
    .replace(/"#\/parameters\//g, '"#/components/parameters/').replace(/"#\/responses\//g, '"#/components/responses/'));
  const produces = json.produces ?? ['application/json'];
  const consumes = json.consumes ?? ['application/json'];
  const out = { openapi: '3.0.3', info: json.info ?? { title: 'API', version: '1.0.0' } };
  if (json.host || json.basePath) {
    const schemes = json.schemes?.length ? json.schemes : ['https'];
    out.servers = schemes.map((sc) => ({ url: `${sc}://${json.host ?? 'localhost'}${json.basePath ?? ''}` }));
  }
  if (json.tags) out.tags = json.tags;
  if (json.security) out.security = json.security;
  if (json.externalDocs) out.externalDocs = json.externalDocs;
  const schemaOf = (p) => {
    const { name, in: _in, required, description, schema, collectionFormat, ...rest } = p;
    return schema ?? rest;
  };
  const convResponse = (r, prod) => {
    if (!r || r.$ref) return r;
    const o = { description: r.description ?? '' };
    if (r.schema) o.content = Object.fromEntries(prod.map((m) => [m, { schema: r.schema }]));
    if (r.headers) o.headers = Object.fromEntries(Object.entries(r.headers).map(([k, h]) => [k, { description: h.description, schema: schemaOf(h) }]));
    return o;
  };
  const convParam = (p) => {
    if (!p || p.$ref) return p;
    const { name, in: where, required, description } = p;
    return { name, in: where, ...(required !== undefined ? { required } : {}), ...(description ? { description } : {}), schema: schemaOf(p) };
  };
  out.paths = {};
  for (const [path, item] of Object.entries(json.paths ?? {})) {
    const ni = {};
    for (const [k, v] of Object.entries(item ?? {})) {
      if (k === 'parameters') { ni.parameters = v.filter((p) => p.in !== 'body' && p.in !== 'formData').map(convParam); continue; }
      if (!METHODS.includes(k)) { ni[k] = v; continue; }
      const op = { ...v };
      const params = op.parameters ?? [];
      const body = params.find((p) => p.in === 'body');
      const form = params.filter((p) => p.in === 'formData');
      op.parameters = params.filter((p) => p.in !== 'body' && p.in !== 'formData').map(convParam);
      if (!op.parameters.length) delete op.parameters;
      const cons = op.consumes ?? consumes;
      if (body) op.requestBody = { ...(body.description ? { description: body.description } : {}), required: Boolean(body.required), content: Object.fromEntries(cons.map((m) => [m, { schema: body.schema ?? {} }])) };
      else if (form.length) {
        const props = Object.fromEntries(form.map((p) => [p.name, { ...schemaOf(p), ...(p.type === 'file' ? { type: 'string', format: 'binary' } : {}), ...(p.description ? { description: p.description } : {}) }]));
        const req = form.filter((p) => p.required).map((p) => p.name);
        const media = cons.includes('multipart/form-data') || form.some((p) => p.type === 'file') ? 'multipart/form-data' : 'application/x-www-form-urlencoded';
        op.requestBody = { content: { [media]: { schema: { type: 'object', properties: props, ...(req.length ? { required: req } : {}) } } } };
      }
      const prod = op.produces ?? produces;
      op.responses = Object.fromEntries(Object.entries(op.responses ?? { default: { description: '' } }).map(([c, r]) => [c, convResponse(r, prod)]));
      delete op.consumes;
      delete op.produces;
      delete op.schemes;
      ni[k] = op;
    }
    out.paths[path] = ni;
  }
  const components = {};
  if (json.definitions) components.schemas = json.definitions;
  if (json.parameters) components.parameters = Object.fromEntries(Object.entries(json.parameters).map(([k, p]) => [k, convParam(p)]));
  if (json.responses) components.responses = Object.fromEntries(Object.entries(json.responses).map(([k, r]) => [k, convResponse(r, produces)]));
  if (json.securityDefinitions) {
    components.securitySchemes = Object.fromEntries(Object.entries(json.securityDefinitions).map(([k, d]) => {
      if (d.type === 'basic') return [k, { type: 'http', scheme: 'basic', ...(d.description ? { description: d.description } : {}) }];
      if (d.type === 'apiKey') return [k, { type: 'apiKey', name: d.name, in: d.in }];
      if (d.type === 'oauth2') {
        const flow = { implicit: 'implicit', password: 'password', application: 'clientCredentials', accessCode: 'authorizationCode' }[d.flow] ?? 'clientCredentials';
        return [k, { type: 'oauth2', flows: { [flow]: { ...(d.authorizationUrl ? { authorizationUrl: d.authorizationUrl } : {}), ...(d.tokenUrl ? { tokenUrl: d.tokenUrl } : {}), scopes: d.scopes ?? {} } } }];
      }
      return [k, d];
    }));
  }
  if (Object.keys(components).length) out.components = components;
  return out;
}
