// MDX compile through the Platform's own pipeline: the remark and rehype
// plugins come from site/docusaurus.config.mjs for each Edition, run by
// Docusaurus's MDX processor after its preprocessing. Every page and partial
// compiles in each Edition it renders in, so an unknown {edition.*} variable
// or a bad <Edition> marker fails here, with its file.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { editionFromId, markerFromFrontMatter, matches } from '../edition.mjs';
import { lineOf, preprocess } from './content.mjs';

const require = createRequire(import.meta.url);
const { DEFAULT_MARKDOWN_CONFIG } = require('@docusaurus/core/lib/server/configValidation.js');
const { createProcessorUncached } = require('@docusaurus/mdx-loader/lib/processor.js');
const siteDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const configUrl = pathToFileURL(path.join(siteDir, 'docusaurus.config.mjs')).href;

// The Editions one change is compiled for: the main line serves Cloud and the
// next self-hosted version; a release branch serves its version.
export function compileEditions(model, editionId) {
  if (model === 'unversioned') return ['_'];
  if (editionId !== 'cloud' && editionId !== 'next') return [editionId];
  const ids = [];
  if (model !== 'versions-only') ids.push('cloud');
  if (model !== 'cloud-only') ids.push('next');
  return ids;
}

async function platformProcessor(repo, editionId, manifest) {
  const saved = { ...process.env };
  Object.assign(process.env, { WSO2_DOCS_CONTENT: repo.root, WSO2_DOCS_EDITION: editionId, WSO2_DOCS_SHOW_MARKERS: '0' });
  if (manifest) process.env.WSO2_DOCS_MANIFEST = manifest;
  let config;
  try {
    config = (await import(`${configUrl}?check=${encodeURIComponent(`${repo.root}:${editionId}:${manifest ?? ''}`)}`)).default;
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  const docs = config.presets[0][1].docs;
  const markdownConfig = {
    ...DEFAULT_MARKDOWN_CONFIG,
    ...config.markdown,
    // Missing links and images are the preview build's findings.
    hooks: { onBrokenMarkdownLinks: 'ignore', onBrokenMarkdownImages: 'ignore' },
  };
  return createProcessorUncached({
    format: 'mdx',
    options: {
      admonitions: true,
      beforeDefaultRemarkPlugins: docs.beforeDefaultRemarkPlugins ?? [],
      remarkPlugins: docs.remarkPlugins ?? [],
      beforeDefaultRehypePlugins: docs.beforeDefaultRehypePlugins ?? [],
      rehypePlugins: docs.rehypePlugins ?? [],
      siteDir,
      staticDirs: [path.join(siteDir, 'static')],
      markdownConfig,
    },
  });
}

const VARIABLE = /unknown variable \{edition\.(\w+)\}/;
const MARKER = /<Edition>|only=|selfHostedFrom=|Edition marker/;

// Findings for the `compile` and `markers` checks.
export async function compileAll(ctx, { manifest, editionId }) {
  const findings = [];
  const ids = compileEditions(ctx.repo.docspace.model, editionId);
  const seen = new Set();
  // Platform plugins report build-time notes on the console; the check's
  // own findings say what matters, so keep its output clean.
  const quiet = { log: console.log, warn: console.warn, info: console.info };
  console.log = console.warn = console.info = () => {};
  try {
    for (const id of ids) await compileEdition(ctx, id, ids, manifest, findings, seen);
  } finally {
    Object.assign(console, quiet);
  }
  return { findings, editions: ids };
}

async function compileEdition(ctx, id, ids, manifest, findings, seen) {
  {
    const edition = editionFromId(id);
    const processor = await platformProcessor(ctx.repo, id, manifest);
    for (const d of ctx.docs) {
      const marker = d.fmError ? null : markerFromFrontMatter(d.fm);
      try {
        if (marker && !matches(edition, marker)) continue;
      } catch {
        continue; // the front-matter check reports an invalid marker
      }
      const filePath = path.join(ctx.root, d.file);
      try {
        await processor.process({ content: preprocess(d.text, filePath), filePath, frontMatter: d.fm, compilerName: 'server' });
      } catch (err) {
        const reason = String(err.reason ?? err.message).split('\n')[0].replace(/^[\w.-]+\.mdx?: /, '');
        // A data file's problems are the data-files check's findings (lib/check/data.mjs).
        if (/\bdata file\b/.test(reason)) continue;
        const v = VARIABLE.exec(reason);
        let line = err.line ?? err.place?.line ?? err.position?.start?.line ?? 1;
        const attr = /(only|selfHostedFrom)="([^"]*)"/.exec(reason);
        const needle = v ? `{edition.${v[1]}}` : attr?.[0];
        const at = needle ? d.text.indexOf(needle) : -1;
        if (at >= 0) line = lineOf(d.text, at);
        const check = v || MARKER.test(reason) ? 'markers' : 'compile';
        const key = `${check}|${d.file}|${line}|${reason}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ check, level: 'error', file: d.file, line, message: ids.length > 1 ? `${reason} (in ${id === 'next' ? 'self-hosted' : id})` : reason });
      }
    }
  }
}
