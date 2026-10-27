// Reads an MkDocs project: mkdocs.yml (nav, extra variables), the legacy
// redirect list and the page files under docs/.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// mkdocs.yml uses Python tags (!!python/name:…); they only configure
// extensions, so they load as plain strings.
const pythonTag = new yaml.Type('tag:yaml.org,2002:python/name:', {
  kind: 'scalar', multi: true, construct: (data, type) => `${type}${data ?? ''}`,
});
// !ENV [NAME, default] reads an environment variable at build time; the
// converter takes the default, as an unconfigured legacy build would.
const envTag = new yaml.Type('!ENV', {
  kind: 'sequence', construct: (data) => (Array.isArray(data) ? data[data.length - 1] : data),
});
const envScalar = new yaml.Type('!ENV', { kind: 'scalar', construct: () => '' });
const SCHEMA = yaml.DEFAULT_SCHEMA.extend([pythonTag, envTag, envScalar]);

// MkDocs' INHERIT: the parent file (relative to the child) is loaded first and
// the child is merged over it; mappings merge recursively, everything else
// (lists included) is replaced, as MkDocs' mergedeep does.
export function readMkdocsConfig(file, seen = new Set()) {
  if (seen.has(file)) throw new Error(`${file}: INHERIT loop`);
  seen.add(file);
  // Duplicate keys (a repeated not_in_nav) keep the last value, as PyYAML does.
  const config = yaml.load(fs.readFileSync(file, 'utf8'), { schema: SCHEMA, json: true }) ?? {};
  if (!config.INHERIT) return config;
  const parent = readMkdocsConfig(path.resolve(path.dirname(file), config.INHERIT), seen);
  const { INHERIT, ...own } = config;
  return mergeConfig(parent, own);
}

export function mergeConfig(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = b && v && typeof b === 'object' && typeof v === 'object' && !Array.isArray(b) && !Array.isArray(v) ? mergeConfig(b, v) : v;
  }
  return out;
}

export function loadMkdocs(root) {
  const file = path.join(root, 'mkdocs.yml');
  const config = readMkdocsConfig(file);
  return { root, docsDir: path.join(root, config.docs_dir ?? 'docs'), config, nav: parseNav(config.nav ?? []) };
}

// The mkdocs-redirects plugin's redirect_maps (old page → new page or URL).
export function redirectMaps(config) {
  for (const p of config.plugins ?? []) {
    if (p && typeof p === 'object' && p.redirects) {
      return Object.entries(p.redirects.redirect_maps ?? {}).map(([from, to]) => ({ from: String(from).trim(), to: String(to).trim() }));
    }
  }
  return [];
}

// Pages listed in exclude_docs (gitignore-style lines; plain paths only).
export function excludeDocs(config) {
  return String(config.exclude_docs ?? '').split('\n').map((l) => l.trim().replace(/^\//, '')).filter((l) => l && !l.startsWith('#'));
}

// The nav as a tree: { kind: 'section', label, children } or
// { kind: 'page', label, src } or { kind: 'link', label, url }.
export function parseNav(items) {
  return items.map((item) => {
    if (typeof item === 'string') return { kind: 'page', label: null, src: item };
    const [label, value] = Object.entries(item)[0];
    if (Array.isArray(value)) return { kind: 'section', label, children: parseNav(value) };
    if (/^[a-z]+:\/\//i.test(value)) return { kind: 'link', label, url: value };
    return { kind: 'page', label, src: value };
  });
}

export function* walkNav(nodes, parents = []) {
  for (const [i, node] of nodes.entries()) {
    yield { node, parents, index: i };
    if (node.kind === 'section') yield* walkNav(node.children, [...parents, node]);
  }
}

// API Manager keeps its redirects in redirects.yml as one line per entry:
// 'old/page.md': '{{SITE_URL}}/new/page/'. hooks.py parses it line by line,
// and so do we, so the result matches what the legacy site serves.
export function loadLegacyRedirects(root, fileName = 'redirects.yml') {
  const file = path.join(root, fileName);
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || !line.includes(':')) continue;
    const parts = line.split("': '");
    if (parts.length !== 2) continue;
    out.push({ from: parts[0].trim().replace(/^'|'$/g, ''), to: parts[1].trim().replace(/^'|'$/g, '') });
  }
  return out;
}

export function listMarkdown(docsDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.push(path.relative(docsDir, p).split(path.sep).join('/'));
    }
  };
  walk(docsDir);
  return out.sort();
}

// MkDocs URL of a page file (use_directory_urls): a/b.md → a/b/, a/index.md → a/.
export function mkdocsUrl(src) {
  // MkDocs builds a folder's README.md as its index page.
  const noExt = src.replace(/\.md$/, '').replace(/(^|\/)README$/, '$1index');
  if (noExt === 'index' || noExt.endsWith('/index')) return noExt.replace(/(^|\/)index$/, '$1');
  return `${noExt}/`;
}
