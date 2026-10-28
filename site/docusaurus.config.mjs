// One Docusaurus config for every Docs deployment and for the Landing
// deployment. The CLI (bin/wso2-docs.mjs) passes the Content repo, Edition and
// URLs through WSO2_DOCS_* variables; WSO2_DOCS_LANDING=1 builds the Landing
// deployment at baseUrl / instead of a Doc space Edition.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { themes as prismThemes } from 'prism-react-renderer';
import { editionFromId, isSelfHostedAddition, markerFromFrontMatter } from '../lib/edition.mjs';
import {
  additionsFor, cloudCounterparts, editionVariables, excludedPages, loadContentRepo, mainBranchFiles, repoPathOf, showsCloudOnlyContent,
} from '../lib/content.mjs';
import { checkoutCommit, cloudPartOf, loadCloudParts, partEditionName, treeSidebars } from '../lib/cloud-tree.mjs';
import { DEFAULT_POLICY, docSpaceDir, loadPolicy } from '../lib/manifest.mjs';
import { bakedManifest } from '../lib/release.mjs';
import { validateChrome } from '../lib/chrome.mjs';
import { analyticsHeadScript } from '../lib/analytics.mjs';
import { editLink } from '../lib/page-links.mjs';
import remarkEdition from '../plugins/remark-edition.mjs';
import remarkDocsLinks from '../plugins/remark-docs-links.mjs';
import { searchConfigFromEnv } from '../lib/search/environments.mjs';
import remarkApiReference from '../plugins/remark-api-reference.mjs';
import remarkPageActions from '../plugins/remark-page-actions.mjs';
import remarkLayouts from '../plugins/remark-layouts.mjs';
import { layoutFrontMatter } from '../lib/layouts.mjs';
import { apiPageFrontMatter, apiSidebarItems } from '../lib/api-layout.mjs';
import siteSource from '../plugins/site-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const platformRoot = path.join(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(platformRoot, 'package.json'), 'utf8'));
const env = process.env;

const landing = env.WSO2_DOCS_LANDING === '1';
const policy = loadPolicy(env.WSO2_DOCS_MANIFEST ?? DEFAULT_POLICY);
const chromeFile = env.WSO2_DOCS_CHROME ?? path.join(platformRoot, 'chrome', 'chrome.json');
const chromeSnapshot = validateChrome(JSON.parse(fs.readFileSync(chromeFile, 'utf8')), chromeFile);
const siteUrl = (env.WSO2_DOCS_SITE_URL ?? 'https://docs.wso2.com').replace(/\/$/, '');
const linkHost = (env.WSO2_DOCS_LINK_HOST ?? siteUrl).replace(/\/$/, '');
const showMarkers = !landing && env.WSO2_DOCS_SHOW_MARKERS === '1';
const only = env.WSO2_DOCS_ONLY;
const strict = !only && !showMarkers;
// Release builds (promoted byte for byte from staging to production) get the
// GTM + CookiePro head script, which only runs on the production host.
// PR previews and local builds get none.
const production = env.WSO2_DOCS_ENV === 'production';
// Markers are shown only in preview builds (lib/edition.mjs showMarkersFlag).
if (showMarkers && production) throw new Error('WSO2_DOCS_SHOW_MARKERS=1 with WSO2_DOCS_ENV=production: a production build never shows Edition markers');

// --- Doc space Edition (not used by the Landing deployment) ---------------
const repo = landing ? null : loadContentRepo(env.WSO2_DOCS_CONTENT ?? '.');
const edition = landing ? null : editionFromId(env.WSO2_DOCS_EDITION);
const vars = landing ? null : editionVariables(repo, edition);
const slug = landing ? null : repo.docspace.slug;
const space = landing ? null : policy.docSpaces[slug];
const asLatest = !landing && env.WSO2_DOCS_AS_LATEST === '1';
// A family Cloud build mounts each Cloud part's main line from the same
// checkout at <base>/<part>/ (lib/cloud-tree.mjs). A part built on its own
// (its PR preview) sits at its address in the platform's tree.
const parts = landing ? [] : loadCloudParts(repo, edition.id);
const partOf = !landing && edition.id === 'cloud' ? cloudPartOf(repo.docspace) : null;
// Unversioned Doc spaces (Contribute) have no Edition segment.
const baseUrl = env.WSO2_DOCS_BASE_URL ?? (landing ? '/'
  : partOf ? `/${partOf}/cloud/${slug}/`
    : edition.unversioned ? `/${slug}/` : `/${slug}/${asLatest ? 'latest' : edition.id}/`);
const latestPagesFile = env.WSO2_DOCS_LATEST_PAGES;
const latestPages = latestPagesFile ? new Set(JSON.parse(fs.readFileSync(latestPagesFile, 'utf8')).map((p) => p.path)) : null;
const mainFiles = landing || edition.kind === 'cloud' ? null : mainBranchFiles(repo, env.WSO2_DOCS_MAIN_FILES);

// Cloud's Self-hosted additions (lib/content.mjs additionsFor): per docs
// instance, since each Cloud part has its own newest release.
const additionsOf = (r, instBase) => {
  const a = landing ? null : additionsFor(r, edition);
  return a ? { ...a, base: instBase } : null;
};
const remarkFor = (r, v, routeBase = '', additions = null) => [
  // Unversioned spaces have no Edition variables; Contribute shows {edition.*} in code as written.
  [remarkEdition, { edition, vars: v, showMarkers, substituteCode: !edition.unversioned, additions }],
  // Page layouts (overview cards, catalogs from data files), before docs: links resolve.
  [remarkLayouts, { edition, docsDir: r.docsDir }],
  [remarkDocsLinks, { policy, host: linkHost }],
  [remarkApiReference, { docsDir: r.docsDir, edition, vars: v, routeBase, additions }],
  remarkPageActions,
];
const additions = landing ? null : additionsOf(repo, baseUrl);
const remarkPlugins = landing ? [] : remarkFor(repo, vars, '', additions);

// The tree's docs instances: the Doc space's own (`default`), then one per
// Cloud part, each with its own content, variables and edit-link source.
const instances = landing ? [] : [
  {
    id: 'default', slug, repo, vars, docsDir: repo.docsDir, baseUrl, routeBase: '', space, remarkPlugins, additions,
    label: repo.docspace.displayName, editionName: partOf ? partEditionName(repo.docspace) : vars.displayName,
  },
  ...parts.map((p) => {
    const v = editionVariables(p.repo, edition);
    const a = additionsOf(p.repo, `${baseUrl}${p.routeBasePath}/`);
    return {
      id: p.pluginId, slug: p.slug, repo: p.repo, vars: v, docsDir: p.repo.docsDir, baseUrl: `${baseUrl}${p.routeBasePath}/`, routeBase: p.routeBasePath,
      space: policy.docSpaces[p.slug], remarkPlugins: remarkFor(p.repo, v, p.routeBasePath, a), additions: a, label: p.displayName, editionName: p.editionName,
    };
  }),
];
const instanceOf = (file) => instances.find((i) => file.startsWith(i.docsDir + path.sep)) ?? null;
// Where each Doc space's files are in its Content repo, for edit links.
const repoDirOf = (i) => (i.space?.source ? docSpaceDir(i.space, i.slug) : repoPathOf(i.repo.root) ?? '');

// "Edit this page" is worked out per file at build time (main first, see
// lib/page-links.mjs) and reaches the page through its front matter.
// `layout: api-reference` pages bring their own navigation and title;
// overview and catalog pages are drawn without the TOC column (lib/layouts.mjs).
async function parseFrontMatter(params) {
  const result = await params.defaultParseFrontMatter(params);
  if (landing) return result;
  result.frontMatter = layoutFrontMatter(apiPageFrontMatter(result.frontMatter));
  const inst = instanceOf(params.filePath);
  // A Self-hosted-only page shown in Cloud takes the newest release's variables.
  const a = inst?.additions;
  const marker = a ? markerFromFrontMatter(result.frontMatter) : null;
  const v = marker && isSelfHostedAddition(edition, marker, a.newestRelease) ? a.vars : inst?.vars ?? vars;
  // {edition.*} in a title, sidebar label or description (a page whose title
  // names the product), filled per Edition as in the page body.
  for (const key of ['title', 'sidebar_label', 'description']) {
    const x = result.frontMatter[key];
    if (typeof x === 'string' && x.includes('{edition.')) result.frontMatter[key] = x.replace(/\{edition\.([A-Za-z_]\w*)\}/g, (m, n) => (n in v ? String(v[n]) : m));
  }
  if (inst) {
    const docPath = path.relative(inst.docsDir, params.filePath).split(path.sep).join('/');
    if (docPath.split('/').some((seg) => seg.startsWith('_'))) return result; // partials are not pages
    const branch = inst.space?.editions?.find((e) => e.id === edition.id)?.branch;
    const link = editLink({ repo: inst.space?.repo, editionId: edition.id, docPath, mainFiles: inst.id === 'default' ? mainFiles : null, dir: repoDirOf(inst), branch });
    if (link) {
      result.frontMatter.wso2_edit_url = link.url;
      if (link.note) result.frontMatter.wso2_edit_note = link.note;
    }
    // The Cloud notice claims the newest features only on a page with Cloud-only content.
    if (inst.additions && showsCloudOnlyContent(params.filePath)) result.frontMatter.wso2_cloud_content = true;
  }
  return result;
}

// With Cloud parts, every instance draws the same one tree (lib/cloud-tree.mjs).
const sidebarFor = (inst) => (!parts.length ? apiSidebarItems : treeSidebars({
  tree: baseUrl,
  self: inst.id,
  siteDir: here,
  family: { id: 'default', docsDir: repo.docsDir, baseUrl, label: repo.docspace.displayName },
  parts: instances.slice(1).map((i) => ({ id: i.id, slug: i.slug, docsDir: i.docsDir, baseUrl: i.baseUrl, label: i.label })),
  inner: apiSidebarItems,
}));
const docsOptions = (inst) => ({
  path: inst.docsDir,
  routeBasePath: inst.routeBase || '/',
  // Folder path = URL path (Content repo contract): no number-prefix stripping.
  numberPrefixParser: false,
  sidebarPath: path.join(here, 'sidebars.mjs'),
  sidebarItemsGenerator: sidebarFor(inst),
  exclude: ['**/_*.{js,jsx,ts,tsx,md,mdx}', '**/_*/**', ...(showMarkers ? [] : excludedPages(inst.repo, edition.id))],
  ...(only && inst.id === 'default' ? { include: [`${only.replace(/\/$/, '')}/**/*.{md,mdx}`, 'index.{md,mdx}'] } : {}),
  beforeDefaultRemarkPlugins: inst.remarkPlugins,
});

// The Landing deployment publishes the chrome.json source at the site root,
// plus the release outputs every published deployment carries (lib/release.mjs
// checkBuild): edition.json, pages.json (for the crawl gate), an empty
// redirect list and a sitemap of the home page (also as sitemap-landing.xml).
function landingOutputs() {
  return {
    name: 'wso2-landing-outputs',
    async postBuild({ outDir, routesPaths }) {
      fs.writeFileSync(path.join(outDir, 'chrome.json'), `${JSON.stringify(chromeSnapshot, null, 2)}\n`);
      const pages = [...new Set(routesPaths)]
        .map((r) => r.replace(/^\//, ''))
        .filter((rel) => !rel.endsWith('.html') && fs.existsSync(path.join(outDir, rel, 'index.html')))
        .sort()
        .map((rel) => ({ path: rel, title: rel === '' ? 'WSO2 Docs' : rel.replace(/\/$/, ''), canonical: `${siteUrl}/${rel}`, anchors: [] }));
      const dir = path.join(outDir, '_platform');
      fs.mkdirSync(dir, { recursive: true });
      const write = (name, data) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
      write('edition.json', { docSpace: null, edition: '_', kind: 'landing', asLatest: false, baseUrl: '/', builtAt: new Date().toISOString(), platformVersion: pkg.version });
      write('pages.json', pages);
      write('redirects.json', []);
      // The bucket's sitemap index is served at /sitemap.xml and shadows this
      // deployment's own sitemap there, so the index lists the home page's
      // sitemap under its own name (lib/release.mjs LANDING_SITEMAP).
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteUrl}/</loc></url></urlset>\n`;
      fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemap);
      fs.writeFileSync(path.join(outDir, 'sitemap-landing.xml'), sitemap);
    },
  };
}

const navbarItems = [
  { type: 'custom-wso2Brand', position: 'left' },
  { type: 'custom-wso2ProductSwitcher', position: 'left' },
  ...(landing ? [] : [{ type: 'custom-wso2EditionDropdown', position: 'left' }]),
  { type: 'search', position: 'right' },
  { type: 'custom-wso2SiteLinks', position: 'right' },
];

export default {
  title: landing ? 'WSO2 Docs' : `${instances[0].editionName} | WSO2 Docs`,
  tagline: landing ? 'Documentation for every WSO2 product' : repo.docspace.displayName,
  url: siteUrl,
  baseUrl,
  trailingSlash: true,
  onBrokenLinks: strict ? 'throw' : 'warn',
  onBrokenAnchors: strict ? 'throw' : 'warn',
  markdown: {
    parseFrontMatter,
    hooks: {
      onBrokenMarkdownLinks: strict ? 'throw' : 'warn',
      onBrokenMarkdownImages: strict ? 'throw' : 'warn',
    },
  },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  headTags: production
    ? [{ tagName: 'script', attributes: { 'data-wso2-analytics': 'true' }, innerHTML: analyticsHeadScript({ hosts: [new URL(siteUrl).hostname] }) }]
    : [],
  presets: [
    [
      'classic',
      {
        docs: landing ? false : docsOptions(instances[0]),
        blog: false,
        pages: landing ? { path: path.join(here, 'src', 'landing'), routeBasePath: '/' } : false,
        sitemap: false,
        theme: {
          customCss: [
            // Inter as a cached font file, not inlined in JS (Theme and shared chrome).
            createRequire(import.meta.url).resolve('@fontsource-variable/inter'),
            path.join(here, 'src/css/oxygen-tokens.css'),
            path.join(here, 'src/css/custom.css'),
            path.join(here, 'src/css/chrome.css'),
            path.join(here, 'src/css/api-reference.css'),
            path.join(here, 'src/css/layouts.css'),
          ],
        },
      },
    ],
  ],
  plugins: landing ? [siteSource, landingOutputs] : [
    // site/src/ compiled where the Platform is installed from npm (under node_modules/).
    siteSource,
    // Each Cloud part's main line as its own docs instance at <base>/<part>/.
    ...instances.slice(1).map((i) => ['@docusaurus/plugin-content-docs', { id: i.id, ...docsOptions(i) }]),
    // <doc space>/partials/: snippets the pages import, with the pages' remark plugins.
    ...instances.map((i) => [path.join(platformRoot, 'plugins', 'partials.mjs'), {
      id: `partials-${i.id}`, partialsDir: i.repo.partialsDir, docsDir: i.docsDir, baseUrl: i.baseUrl, beforeDefaultRemarkPlugins: i.remarkPlugins,
    }]),
    [
      path.join(platformRoot, 'plugins', 'api-reference.mjs'),
      {
        docsDir: repo.docsDir, dirs: instances.map((i) => ({ docsDir: i.docsDir, prefix: i.routeBase ? `${i.routeBase}/` : '' })), editionKind: edition.kind,
        ...(env.WSO2_DOCS_API_BUDGET_KB ? { budgetKb: Number(env.WSO2_DOCS_API_BUDGET_KB) } : {}),
      },
    ],
    [
      path.join(platformRoot, 'plugins', 'platform-outputs.mjs'),
      {
        siteUrl, baseUrl, asLatest, latestPages,
        docSpace: slug, docSpaceName: repo.docspace.displayName, editionName: instances[0].editionName,
        editionId: edition.id, editionKind: edition.kind,
        latestEditionId: space?.latest ?? null,
        showMarkers,
        redirects: repo.redirects,
        // Self-hosted-only pages and the Cloud pages they map to in the version dropdown.
        cloudCounterparts: edition.kind === 'cloud' ? {} : cloudCounterparts(repo),
        platformVersion: pkg.version,
        // The Cloud parts in this tree: their redirects map under <base>/<part>/.
        parts: instances.slice(1).map((i) => ({ docSpace: i.slug, path: `${i.routeBase}/`, baseUrl: i.baseUrl, editionName: i.editionName, redirects: i.repo.redirects })),
        ...(partOf ? { cloudPartOf: partOf } : {}),
        source: parts.length ? { commit: checkoutCommit(repo) } : undefined,
      },
    ],
    [
      // Markdown twins, llms.txt and llms-full.txt (AI/LLM-friendly docs).
      path.join(platformRoot, 'plugins', 'markdown-export.mjs'),
      {
        siteUrl, baseUrl, asLatest, latestPages, strict, edition, vars, policy, linkHost, additions,
        docsDir: repo.docsDir, docSpace: slug, docSpaceName: repo.docspace.displayName, editionName: instances[0].editionName,
        editionId: edition.id, latestEditionId: space?.latest ?? null, ...(partOf ? { cloudPartOf: partOf } : {}),
        parts: instances.slice(1).map((i) => ({
          pluginId: i.id, path: `${i.routeBase}/`, baseUrl: i.baseUrl, docsDir: i.docsDir, vars: i.vars, additions: i.additions, docSpace: i.slug, docSpaceName: i.label, editionName: i.editionName,
        })),
      },
    ],
  ],
  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: { items: navbarItems },
    prism: { theme: prismThemes.github, darkTheme: prismThemes.dracula, additionalLanguages: ['bash', 'java', 'toml', 'properties', 'json', 'docker', 'ini', 'http', 'groovy', 'powershell', 'csharp', 'nginx', 'batch', 'hcl', 'rego', 'log', 'diff', 'scala', 'php', 'ruby', 'protobuf'] },
  },
  customFields: {
    landing,
    docSpace: slug,
    docSpaceName: landing ? null : repo.docspace.displayName,
    edition: landing ? null : edition.id,
    editionName: landing ? null : instances[0].editionName,
    // Docs instances of this tree that are Cloud parts, by plugin id: their
    // pages are titled with the part's Cloud Edition (site/src/theme/DocItem/Metadata).
    cloudParts: Object.fromEntries(instances.filter((i) => i.id !== 'default' || partOf).map((i) => [i.id, { docSpace: i.slug, editionName: i.editionName }])),
    // A Cloud part built on its own (its PR preview) sits in its platform's
    // tree: the chrome reads it as that tree (site/src/components/chrome/runtime.js).
    cloudPartOf: partOf,
    asLatest,
    showMarkers,
    siteUrl,
    // Root-relative, so staging reads the staging copies; preview passes the
    // staging URLs explicitly.
    manifestUrl: env.WSO2_DOCS_MANIFEST_URL ?? '/manifest.json',
    // The baked-in fallback is production's view (no staging-only Doc spaces).
    // With the environment's deployment state (WSO2_DOCS_DEPLOYED), its menus
    // list only deployed Doc spaces, plus the ones this build deploys, as the
    // live manifest's do.
    manifestSnapshot: bakedManifest(policy, {
      environment: 'production',
      deployed: env.WSO2_DOCS_DEPLOYED ? JSON.parse(fs.readFileSync(env.WSO2_DOCS_DEPLOYED, 'utf8')) : null,
      building: landing ? [] : [slug, ...instances.map((i) => i.slug), partOf],
      edition: landing ? null : edition.id,
    }),
    // The search box (site/src/components/search): endpoints per environment
    // and which deployment this is (the /latest/ rewrite needs it).
    search: { ...searchConfigFromEnv(env), asLatest, baseUrl },
    chromeUrl: env.WSO2_DOCS_CHROME_URL ?? '/chrome.json',
    chromeSnapshot,
    landingContent: landing ? yaml.load(fs.readFileSync(path.join(platformRoot, 'chrome', 'landing.yaml'), 'utf8')) : null,
  },
};
