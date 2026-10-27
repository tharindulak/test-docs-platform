// Partials next to docs/ (Repo structure for Platform, sections and Doc
// spaces): <doc space>/partials/ holds MDX snippets that the Doc space's own
// pages import; they are never pages and never shared across repos. The docs
// plugin compiles only files under docs/, so this plugin gives partials/ the
// same MDX loader and remark plugins (Edition markers, docs: links, API
// reference), compiled as partials. A link from a partial to a page
// (../docs/guides/x.mdx) resolves to that page's URL, as links between pages do.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { routeFor } from '../lib/routes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// The loader is CommonJS; required as Docusaurus's own plugins load it.
const { createMDXLoaderRule } = createRequire(import.meta.url)('@docusaurus/mdx-loader');

export function partialLinkResolver({ docsDir, baseUrl }) {
  return ({ linkPathname, sourceFilePath }) => {
    const target = path.resolve(path.dirname(sourceFilePath), decodeURIComponent(linkPathname));
    const rel = path.relative(docsDir, target);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(target)) return null;
    let fm = {};
    try {
      fm = matter(fs.readFileSync(target, 'utf8')).data;
    } catch { /* a page whose front matter does not parse fails its own build */ }
    return `${baseUrl}${routeFor(rel.split(path.sep).join('/'), fm)}`;
  };
}

export default async function partialsPlugin(context, { partialsDir, docsDir, baseUrl, beforeDefaultRemarkPlugins = [] }) {
  if (!partialsDir || !fs.existsSync(partialsDir)) return { name: 'wso2-partials' };
  const rule = await createMDXLoaderRule({
    include: [`${path.resolve(partialsDir)}${path.sep}`],
    options: {
      admonitions: true,
      remarkPlugins: [],
      rehypePlugins: [],
      recmaPlugins: [],
      beforeDefaultRehypePlugins: [],
      beforeDefaultRemarkPlugins,
      staticDirs: context.siteConfig.staticDirectories.map((d) => path.resolve(context.siteDir, d)),
      siteDir: context.siteDir,
      isMDXPartial: () => true,
      isMDXPartialFrontMatterWarningDisabled: true,
      markdownConfig: context.siteConfig.markdown,
      resolveMarkdownLink: partialLinkResolver({ docsDir, baseUrl }),
    },
  });
  // Builds of other Editions share the persistent webpack cache, and a
  // partial compiles differently per Edition: never cache it.
  rule.use.push({ loader: path.join(here, 'uncached-loader.cjs') });
  return {
    name: 'wso2-partials',
    configureWebpack: () => ({ module: { rules: [rule] } }),
    getPathsToWatch: () => [`${partialsDir}/**/*.{md,mdx}`],
  };
}
