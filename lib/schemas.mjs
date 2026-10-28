// The Platform's published JSON Schemas (schemas/*.schema.json): the three
// manifests the compose step merges, and the data files a Doc space may
// commit (catalog, release notes, SDK list). Editors and PR checks use the
// same files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMAS_DIR = path.join(here, '..', 'schemas');

export const SCHEMA_FILES = {
  docspace: 'docspace.schema.json',
  section: 'section.schema.json',
  navigation: 'navigation.schema.json',
  catalog: 'catalog.schema.json',
  'release-notes': 'release-notes.schema.json',
  sdks: 'sdks.schema.json',
  'intake-record': 'intake-record.schema.json',
};

let ajv = null;
const compiled = {};

function validator(kind) {
  if (!SCHEMA_FILES[kind]) throw new Error(`No schema "${kind}" (one of ${Object.keys(SCHEMA_FILES).join(', ')})`);
  if (!compiled[kind]) {
    ajv ??= new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, SCHEMA_FILES[kind]), 'utf8'));
    compiled[kind] = ajv.compile(schema);
  }
  return compiled[kind];
}

// One readable line per problem.
function describe(e) {
  const at = e.instancePath ? e.instancePath.slice(1).replaceAll('/', '.') : '(top level)';
  if (e.keyword === 'additionalProperties') return `${at}: unknown field "${e.params.additionalProperty}"`;
  if (e.keyword === 'required') return `${at}: "${e.params.missingProperty}" is required`;
  if (e.keyword === 'enum') return `${at}: must be one of ${e.params.allowedValues.join(', ')}`;
  if (e.keyword === 'const') return `${at}: must be ${JSON.stringify(e.params.allowedValue)}`;
  return `${at}: ${e.message}`;
}

const HOME_OR_LISTED = '#/allOf/0/oneOf';

// A failed oneOf reports every branch's problems; keep only the branch that
// came closest (fewest problems), and drop wrapper errors (oneOf, anyOf, if)
// whenever something more specific inside them is reported.
function tidy(errors) {
  let list = errors;
  for (const w of errors.filter((e) => e.keyword === 'oneOf')) {
    const under = (e) => e.instancePath === w.instancePath || e.instancePath.startsWith(`${w.instancePath}/`);
    const inside = list.filter((e) => e.schemaPath.startsWith(`${w.schemaPath}/`) && under(e));
    if (!inside.length) continue;
    const branch = (e) => e.schemaPath.slice(w.schemaPath.length + 1).split('/')[0];
    const counts = {};
    for (const e of inside) counts[branch(e)] = (counts[branch(e)] ?? 0) + 1;
    const best = Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0];
    list = list.filter((e) => !inside.includes(e) || branch(e) === best);
  }
  const within = (s, e) => s !== e && s.schemaPath.startsWith(`${e.schemaPath}/`) && (s.instancePath === e.instancePath || s.instancePath.startsWith(`${e.instancePath}/`));
  return list.filter((e) => !['oneOf', 'anyOf', 'if', 'not', 'allOf'].includes(e.keyword) || !list.some((s) => within(s, e)));
}

// Validates parsed YAML or JSON against one schema; returns problem lines.
export function validate(kind, data) {
  const check = validator(kind);
  if (check(data)) return [];
  const errors = check.errors ?? [];
  const lines = [];
  if (kind === 'docspace' && errors.some((e) => e.schemaPath.startsWith(HOME_OR_LISTED))) {
    lines.push('(top level): give either a home Docs section ("home") or "listed: false" (an Unlisted Doc space)');
  }
  for (const e of tidy(errors.filter((x) => !(kind === 'docspace' && x.schemaPath.startsWith(HOME_OR_LISTED))))) lines.push(describe(e));
  return [...new Set(lines)];
}
