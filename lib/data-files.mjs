// Data files (Extension points for product teams, decisions 6 and 7): YAML or
// JSON files a Doc space commits next to its pages, generated upstream and
// synced by bot PR, that a Page layout draws. The build reads only committed
// files, and each kind has a Platform schema (schemas/<kind>.schema.json),
// checked by `wso2-docs check` (the data-files check) and by the build itself.
//
// A data file is found two ways:
//   - by reference: a page's `data:` front matter names it, and the page's
//     layout says which schema it follows (`layout: catalog` → catalog);
//   - by name: release-notes.yaml and sdks.yaml (or .yml, .json) anywhere in
//     docs/ follow their own schemas, whether or not a page draws them yet.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { validate } from './schemas.mjs';

// The layouts that read a data file, and the schema it follows.
export const LAYOUT_DATA = { catalog: 'catalog' };
// Data files known by their name.
export const NAMED_DATA = { 'release-notes': 'release-notes', sdks: 'sdks' };
export const DATA_EXT = /\.(ya?ml|json)$/i;

export function namedKind(file) {
  const base = path.basename(file).replace(DATA_EXT, '');
  return DATA_EXT.test(file) ? NAMED_DATA[base] ?? null : null;
}

// Parses one data file; throws with the file's name when it is not YAML or JSON.
export function readDataFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  try {
    // YAML's core schema: dates such as 2026-09-01 stay strings, as the schemas expect.
    return /\.json$/i.test(file) ? JSON.parse(text) : yaml.load(text, { schema: yaml.CORE_SCHEMA });
  } catch (err) {
    throw new Error(`${path.basename(file)} is not valid ${/\.json$/i.test(file) ? 'JSON' : 'YAML'}: ${String(err.reason ?? err.message).split('\n')[0]}`);
  }
}

// The data file a page's front matter names, as an absolute path, or null.
export function dataFileOf(pageFile, fm) {
  if (typeof fm?.data !== 'string' || !fm.data.trim()) return null;
  return path.resolve(path.dirname(pageFile), fm.data.trim());
}

// The page file a link names: the file itself, or <path>.mdx, <path>.md,
// <path>/index.mdx or <path>/index.md.
function pageFileAt(target) {
  if (/\.mdx?$/.test(target)) return fs.existsSync(target) ? target : null;
  const t = target.replace(/\/+$/, '');
  return [`${t}.mdx`, `${t}.md`, path.join(t, 'index.mdx'), path.join(t, 'index.md')].find((f) => fs.existsSync(f)) ?? null;
}

// Where a catalog href points: { kind: 'docs' | 'url' | 'site' | 'page', url, file?, hash? }.
// `./` and `../` are relative to the data file; a bare path is a page path in
// this Doc space (docs/<path>); `/…` is a site path; docs: and https?: stay.
export function resolveHref(href, { dataFile, docsDir }) {
  const h = String(href);
  if (h.startsWith('docs:')) return { kind: 'docs', url: h };
  if (/^https?:\/\//.test(h)) return { kind: 'url', url: h };
  if (h.startsWith('/')) return { kind: 'site', url: h };
  const [p, hash] = h.split('#');
  const target = h.startsWith('.') ? path.resolve(path.dirname(dataFile), p) : path.join(docsDir, p);
  return { kind: 'page', file: pageFileAt(target), hash: hash ?? null, url: h };
}

// A logo under the Doc space's assets/ (assets/…, relative to the directory
// holding docs/), or a site path.
export function resolveLogo(logo, { docsDir }) {
  if (logo.startsWith('/')) return { kind: 'site', url: logo };
  const file = path.join(path.dirname(docsDir), logo);
  return { kind: 'asset', file: fs.existsSync(file) ? file : null, url: logo };
}

// Problems beyond the schema, for one kind: unique ids, known categories,
// and (catalogs) links and logos that exist.
function semanticProblems(kind, data, ctx) {
  const out = [];
  if (kind === 'catalog') {
    const ids = new Set();
    const cats = new Set((data.categories ?? []).map((c) => c.id));
    for (const c of data.categories ?? []) {
      if (ids.has(`category:${c.id}`)) out.push(`categories: "${c.id}" is listed twice`);
      ids.add(`category:${c.id}`);
    }
    data.items.forEach((item, i) => {
      const at = `items.${i} (${item.id})`;
      if (ids.has(item.id)) out.push(`${at}: the id "${item.id}" is used twice`);
      ids.add(item.id);
      if (item.category && data.categories && !cats.has(item.category)) out.push(`${at}: category "${item.category}" is not in categories (${[...cats].join(', ')})`);
      if (ctx?.docsDir) {
        for (const [field, href] of [['href', item.href], ...(item.links ?? []).map((l, j) => [`links.${j}.url`, l.url])]) {
          const r = resolveHref(href, ctx);
          if (r.kind === 'page' && !r.file) out.push(`${at}: ${field} "${href}" is not a page in this Doc space`);
        }
        if (item.logo) {
          const l = resolveLogo(item.logo, ctx);
          if (l.kind === 'asset' && !l.file) out.push(`${at}: logo "${item.logo}" is not in this Doc space's assets/`);
        }
      }
    });
  } else if (kind === 'sdks') {
    const ids = new Set();
    data.sdks.forEach((s, i) => {
      if (ids.has(s.id)) out.push(`sdks.${i}: the id "${s.id}" is used twice`);
      ids.add(s.id);
    });
  } else if (kind === 'release-notes') {
    const seen = new Set();
    data.releases.forEach((r, i) => {
      if (seen.has(r.version)) out.push(`releases.${i}: version ${r.version} is listed twice`);
      seen.add(r.version);
    });
  }
  return out;
}

// Validates one data file against its kind's schema, then its own rules.
// Returns { data, problems: string[] }.
export function checkDataFile(kind, file, ctx = {}) {
  let data;
  try {
    data = readDataFile(file);
  } catch (err) {
    return { data: null, problems: [err.message] };
  }
  const problems = validate(kind, data ?? {});
  if (problems.length) return { data, problems };
  return { data, problems: semanticProblems(kind, data, { ...ctx, dataFile: file }) };
}

// Loads a data file for a build, or throws one error that lists its problems.
export function loadDataFile(kind, file, ctx = {}) {
  if (!fs.existsSync(file)) throw new Error(`data file ${path.basename(file)} not found (${file})`);
  const { data, problems } = checkDataFile(kind, file, ctx);
  if (problems.length) {
    throw new Error(`data file ${path.basename(file)} does not follow the ${kind} schema (schemas/${kind}.schema.json): ${problems.join('; ')}`);
  }
  return data;
}

// Whether a data item limited to `editions` (cloud, self-hosted or an Edition
// id) shows in this Edition.
export function shownIn(edition, editions) {
  if (!editions?.length) return true;
  return editions.some((e) => (e === 'cloud' && edition.kind === 'cloud') || (e === 'self-hosted' && edition.kind === 'self-hosted') || e === edition.id);
}
