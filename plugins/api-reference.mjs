// Build side of API reference pages: copies each API's spec for this Edition
// into the build as <api folder>/openapi.yaml (the "Download OpenAPI (YAML)"
// target), enforces the page budget on the built HTML, and lists the APIs in
// _platform/apis.json for llms.txt and the Markdown twins.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { findApiPages, tagPages } from '../lib/api-pages.mjs';
import { loadSpec, operationList, resolveSpecFile } from '../lib/openapi.mjs';

// Page budget: gzip-compressed HTML per API page. Measured on publisher-v4
// (260 operations, the largest Pilot spec): 115 KB gzip, 1.5 MB raw, plus a
// 122 KB gzip JS chunk. Raw HTML runs about 13x the gzip size, so 400 KB keeps a
// page near 5 MB raw, a third of the 15 MB Googlebot reads. Above it, an API
// splits into one page per tag.
export const DEFAULT_BUDGET_KB = 400;

export function checkBudget(pages, budgetKb) {
  return pages
    .filter((p) => p.gzipBytes > budgetKb * 1024)
    .map((p) => `${p.route}: ${Math.round(p.gzipBytes / 1024)} KB compressed HTML is over the ${budgetKb} KB API page budget. Split it into tag pages with "npx @wso2/docs api split docs/${p.folder.replace(/\/$/, '')}".`);
}

// `dirs`: every docs directory of the build with its path prefix in the
// output (a family Cloud's Cloud parts are at <part>/); default the one docsDir.
export default function apiReference(context, { docsDir, dirs = [{ docsDir, prefix: '' }], editionKind, budgetKb = DEFAULT_BUDGET_KB }) {
  return {
    name: 'wso2-api-reference',
    getPathsToWatch() {
      return dirs.map((d) => path.join(d.docsDir, '**/openapi*.{yaml,yml}'));
    },
    async postBuild({ outDir }) {
      const apis = [];
      const measured = [];
      for (const { docsDir: dir, prefix } of dirs) {
        for (const p of findApiPages(dir)) {
          const page = { ...p, folder: `${prefix}${p.folder}` };
          const html = path.join(outDir, page.folder, 'index.html');
          if (!fs.existsSync(html)) continue; // not in this Edition
          const specFile = resolveSpecFile(page.dir, String(page.spec), editionKind);
          fs.copyFileSync(specFile, path.join(outDir, page.folder, 'openapi.yaml'));
          const routes = [page.folder, ...[...tagPages(page.dir).values()].map((s) => `${page.folder}${s}/`)];
          for (const route of routes) {
            const file = path.join(outDir, route, 'index.html');
            if (fs.existsSync(file)) measured.push({ route, folder: page.folder, gzipBytes: zlib.gzipSync(fs.readFileSync(file)).length });
          }
          const spec = loadSpec(specFile);
          apis.push({
            path: page.folder, title: page.frontMatter.title ?? spec.info?.title, spec: `${page.folder}openapi.yaml`,
            version: spec.info?.version ?? null, operations: operationList(spec),
          });
        }
      }
      const over = checkBudget(measured, budgetKb);
      if (over.length) throw new Error(over.join('\n'));
      const dir = path.join(outDir, '_platform');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'apis.json'), `${JSON.stringify({ budgetKb, pages: measured, apis }, null, 2)}\n`);
    },
  };
}
