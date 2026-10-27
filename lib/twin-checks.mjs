// Checks of a built Edition's Markdown twins (AI/LLM-friendly docs, decision 7;
// Quality gates for Docs releases): every page has a twin, no JSX, imports or
// MDX expressions are left over, and every link into this Edition resolves (a
// twin, a page or a file of the build, and its #anchor on the page). Links to
// other Docs deployments are left to the staging crawl gate.
//
//   checkMarkdownTwins(buildDir) → [{ file, message }]   (empty when clean)
//
// The build runs it after exporting (plugins/markdown-export.mjs), the release
// pipeline re-runs it (lib/release.mjs checkBuild), and `wso2-docs check` can call it.
import fs from 'node:fs';
import path from 'node:path';
import { pageOfTwin } from './twin-paths.mjs';

const PRODUCTION_SITE = 'https://docs.wso2.com';

// Fenced code and inline code don't count: they may show JSX on purpose.
// Fences count at any indentation and inside blockquotes (admonitions become
// quotes in a twin, and their code blocks with them).
export function proseOf(markdown) {
  const text = markdown.replace(/^---\n[^]*?\n---\n/, (m) => '\n'.repeat(m.split('\n').length - 1));
  const lines = text.split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^((?:[ \t]*>)*[ \t]*)(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (fence) {
      if (m && m[2][0] === fence.char && m[2].length >= fence.len && !m[3].trim()) fence = null;
      lines[i] = '';
      continue;
    }
    if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
      fence = { char: m[2][0], len: m[2].length };
      lines[i] = '';
    }
  }
  // A code span may continue on the next line (not across a blank line).
  return lines.join('\n')
    .replace(/(`+)(?!`)(?:[^\n`]|`(?!\1)|\n(?![ \t>]*\n))*?[^`\n]\1(?!`)/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(`+)[^`\n]\1/g, (m) => ' '.repeat(m.length));
}

const LEFTOVERS = [
  [/(?<!\\)<\/?[A-Z][\w.]*(?:\s[^<>]*)?\/?>/, 'leftover JSX component'],
  [/(?<!\\)<\/?(?:details|summary)\b[^>]*>/, 'leftover <details>/<summary>'],
  [/^\s*(?:import|export)\s+[\w{*]/m, 'leftover MDX import or export'],
  [/(?<!\\)\{\s*(?:edition|props)\.\w+\s*\}/, 'unfilled variable'],
  [/(?<!\\)\{\/\*/, 'leftover MDX comment'],
  [/^\s*:::\s*\w/m, 'leftover admonition directive'],
];

export function leftovers(markdown) {
  const prose = proseOf(markdown);
  const found = [];
  for (const [re, what] of LEFTOVERS) {
    const g = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
    for (const m of prose.matchAll(g)) {
      const lineNo = prose.slice(0, m.index).split('\n').length;
      found.push(`${what} on line ${lineNo}: ${m[0].trim().slice(0, 60)}`);
    }
  }
  return found;
}

export function linksOf(markdown) {
  const prose = proseOf(markdown);
  return [...prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1].replace(/\\([()])/g, '$1'));
}

const idsCache = new Map();
function idsOf(file) {
  if (!idsCache.has(file)) {
    const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    idsCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsCache.get(file);
}

export function checkMarkdownTwins(dir, { siteUrl = PRODUCTION_SITE } = {}) {
  idsCache.clear();
  const problems = [];
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(dir, '_platform', rel), 'utf8'));
  if (!fs.existsSync(path.join(dir, '_platform', 'markdown.json'))) return [{ file: '_platform/markdown.json', message: 'missing: this build has no Markdown twins' }];
  const meta = read('edition.json');
  const twins = read('markdown.json');
  const prefix = `${siteUrl.replace(/\/$/, '')}${meta.baseUrl}`;
  const twinFiles = new Set(twins.files.map((f) => f.path));

  if (fs.existsSync(path.join(dir, '_platform', 'pages.json'))) {
    const covered = new Set(twins.files.filter((f) => f.page !== undefined).map((f) => f.page));
    for (const p of read('pages.json')) {
      if (!covered.has(p.path)) problems.push({ file: `${p.path}index.html`, message: 'page has no Markdown twin' });
    }
  }

  const checkLink = (from, url, pageHtml) => {
    const [target, hash] = url.split('#');
    if (target === '') {
      if (hash && pageHtml && !idsOf(path.join(dir, pageHtml)).has(decodeURIComponent(hash))) problems.push({ file: from, message: `link to #${hash}: no such anchor on the page` });
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith(prefix)) {
      if (/^https?:/.test(target) || /^(mailto|tel):/.test(target)) return;
      problems.push({ file: from, message: `link ${url}: unexpected scheme` });
      return;
    }
    if (!target.startsWith(prefix)) {
      problems.push({ file: from, message: `link ${url}: twins use absolute URLs` });
      return;
    }
    const rel = decodeURIComponent(target.slice(prefix.length));
    let html = null;
    if (rel.endsWith('.md')) {
      if (!twinFiles.has(rel)) {
        problems.push({ file: from, message: `link ${url}: no such twin in this Edition` });
        return;
      }
      html = `${pageOfTwin(rel)}index.html`;
    } else if (rel === '' || rel.endsWith('/')) {
      html = `${rel}index.html`;
      if (!fs.existsSync(path.join(dir, html))) {
        problems.push({ file: from, message: `link ${url}: no such page in this Edition` });
        return;
      }
    } else if (!fs.existsSync(path.join(dir, rel))) {
      problems.push({ file: from, message: `link ${url}: no such file in this Edition` });
      return;
    }
    if (hash && html && fs.existsSync(path.join(dir, html)) && !idsOf(path.join(dir, html)).has(decodeURIComponent(hash))) {
      problems.push({ file: from, message: `link ${url}: no #${hash} on that page` });
    }
  };

  for (const f of twins.files) {
    const file = path.join(dir, f.path);
    if (!fs.existsSync(file)) {
      problems.push({ file: f.path, message: 'listed in _platform/markdown.json but missing' });
      continue;
    }
    const md = fs.readFileSync(file, 'utf8');
    for (const l of leftovers(md)) problems.push({ file: f.path, message: l });
    const pageHtml = f.page !== undefined ? `${f.page}index.html` : null;
    for (const url of linksOf(md)) checkLink(f.path, url, pageHtml);
  }
  for (const name of ['llms.txt', 'llms-full.txt']) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      problems.push({ file: name, message: 'missing' });
      continue;
    }
    const md = fs.readFileSync(file, 'utf8');
    if (name === 'llms-full.txt') for (const l of leftovers(md)) problems.push({ file: name, message: l });
    if (name === 'llms.txt') for (const url of linksOf(md)) checkLink(name, url, null);
  }
  return problems;
}

export const formatProblems = (problems) => problems.map((p) => `${p.file}: ${p.message}`).join('\n');
