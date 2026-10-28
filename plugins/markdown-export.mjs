// After each Docs deployment build, writes what AI tools read (AI/LLM-friendly
// docs): the Markdown twin of every page at <page>.md, joined `export: single`
// guides, llms.txt and llms-full.txt (lib/markdown-export.mjs). Then checks the
// twins (lib/twin-checks.mjs); in a strict build a problem fails it.
import fs from 'node:fs';
import path from 'node:path';
import { exportEdition } from '../lib/markdown-export.mjs';
import { checkMarkdownTwins, formatProblems } from '../lib/twin-checks.mjs';
import { canonicalFor } from './platform-outputs.mjs';

// A family Cloud tree exports each Cloud part's instance into <part>/ with the
// part's own variables and names, and lists its twins in the tree's
// _platform/markdown.json; the tree's llms.txt links each part's llms.txt.
export default function markdownExport(context, o) {
  let content = {};
  return {
    name: 'wso2-markdown-export',
    async allContentLoaded({ allContent }) {
      content = allContent['docusaurus-plugin-content-docs'] ?? {};
    },
    async postBuild({ outDir }) {
      const version = content.default?.loadedVersions?.[0];
      if (!version) return;
      const parts = (o.parts ?? []).filter((p) => content[p.pluginId]?.loadedVersions?.[0]);
      const merged = [];
      for (const p of parts) {
        const partOut = path.join(outDir, p.path);
        // The part's own group of the tree's one sidebar is its sidebar here.
        const partVersion = content[p.pluginId].loadedVersions[0];
        const tree = partVersion.sidebars?.[Object.keys(partVersion.sidebars ?? {})[0]] ?? [];
        const group = tree.find((i) => i.type === 'category' && i.customProps?.cloudPart === p.docSpace);
        const sidebar = group ? [...(group.link?.type === 'doc' ? [{ type: 'doc', id: group.link.id }] : []), ...(group.items ?? [])] : undefined;
        const m = exportEdition({
          sidebar,
          ...o,
          siteDir: context.siteDir,
          outDir: partOut,
          version: partVersion,
          baseUrl: p.baseUrl, docsDir: p.docsDir, vars: p.vars, additions: p.additions ?? null, docSpace: p.docSpace, docSpaceName: p.docSpaceName, editionName: p.editionName,
          asLatest: false,
          canonical: (rel, c) => canonicalFor(`${p.path}${rel}`, o, c),
        });
        // The part's home twin follows the tree's rule (<page>/ -> <page>.md):
        // <part>.md, not <part>/index.md.
        const homeFrom = `${o.siteUrl}${p.baseUrl}index.md`;
        const homeTo = `${o.siteUrl}${o.baseUrl}${p.path.replace(/\/$/, '')}.md`;
        const files = m.files.map((f) => ({ ...f, path: f.path === 'index.md' ? `../${p.path.replace(/\/$/, '')}.md` : f.path }));
        for (const f of [...m.files.map((x) => x.path), 'llms.txt', 'llms-full.txt']) {
          const file = path.join(partOut, f);
          if (fs.existsSync(file)) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll(homeFrom, homeTo));
        }
        if (fs.existsSync(path.join(partOut, 'index.md'))) fs.renameSync(path.join(partOut, 'index.md'), path.join(outDir, `${p.path.replace(/\/$/, '')}.md`));
        merged.push(...files.map((f) => ({ ...f, path: f.path.startsWith('../') ? f.path.slice(3) : `${p.path}${f.path}`, ...(f.page !== undefined ? { page: `${p.path}${f.page}` } : {}) })));
        merged.apis = [...(merged.apis ?? []), ...m.apis.map((a) => ({ ...a, path: `${p.path}${a.path}` }))];
        fs.rmSync(path.join(partOut, '_platform'), { recursive: true, force: true });
      }
      const own = exportEdition({
        ...o,
        siteDir: context.siteDir,
        outDir,
        version,
        canonical: (rel, c) => canonicalFor(rel, o, c),
        cloudParts: parts.map((p) => ({ title: p.editionName, url: `${o.siteUrl}${p.baseUrl}llms.txt` })),
      });
      if (parts.length) {
        own.files.push(...merged);
        own.apis.push(...(merged.apis ?? []));
        fs.writeFileSync(path.join(outDir, '_platform', 'markdown.json'), `${JSON.stringify(own, null, 2)}\n`);
      }
      const problems = checkMarkdownTwins(outDir, { siteUrl: o.siteUrl });
      if (!problems.length) return;
      const message = `Markdown twins:\n${formatProblems(problems)}`;
      if (o.strict) throw new Error(message);
      console.warn(message);
    },
  };
}
