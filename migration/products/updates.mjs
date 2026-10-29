// Converter config for Updates (wso2/docs-updates, MkDocs under en/, branch
// master → directory updates/, main only). An unversioned Doc space in the
// Other group (Product placement): WSO2 Updates 2.0, the Update Tool, hotfixes,
// the Updates portal and the WSO2 private registry, across WSO2 products. It
// has one Edition, `_`, built from master, the branch the legacy site
// (updates.docs.wso2.com/en/latest/, one version, 2.0.0) serves; the source's
// 2.0.0 branch is an older working branch merged into master, not a version.
import { fileURLToPath } from 'node:url';
import apim from './api-manager.mjs';

const LEGACY = 'https://updates.docs.wso2.com/en/latest/';

export default {
  slug: 'updates',
  sourceRepo: 'wso2/docs-updates',
  sourceRoot: 'en', // mkdocs.yml lives here
  legacyBase: () => LEGACY,
  legacyHosts: ['updates.docs.wso2.com'],
  // Fixes to the legacy source and accepted legacy-broken links (lib/overrides.mjs).
  overrides: fileURLToPath(new URL('./updates.overrides.yaml', import.meta.url)),
  redirectsPlugin: false, // mkdocs.yml has no plugins (no redirect_maps)

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // updates/docspace.yaml.
  docspace: {
    schemaVersion: 1,
    slug: 'updates',
    displayName: 'Updates',
    model: 'unversioned',
    // The Other group's Docs section (navigation.yaml: { id: other, in: other }).
    home: 'other',
    owners: { team: 'updates-docs' },
    repo: 'wso2/docs-updates',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-updates' },
  },
  // editions.yaml: an unversioned Doc space builds as Cloud (`_`), so only
  // the cloud: block is read; the pages use no {edition.*} variables.
  editions: {
    cloud: { displayName: 'Updates', productName: 'WSO2 Updates' },
  },

  // The legacy nav has one top-level section, Updates, holding everything;
  // it is filed into guides/, and its parts re-filed into the skeleton:
  // Get Started to get-started/, the reference pages to reference/.
  topLevel: {
    Home: { page: 'index' },
    Updates: { folder: 'guides' },
  },
  sectionFolders: {
    'Updates > Get Started': 'get-started',
  },
  apiFolder: 'reference/apis',
  pageOverrides: {
    'updates/update-tool-setup-usage-guide.md': 'reference/update-tool-setup-usage-guide',
    'updates/faq.md': 'reference/faq',
    'updates/wum-decommission.md': 'reference/wum-decommission',
    'updates/reference.md': 'reference/reference',
  },
  skeleton: [
    { folder: 'get-started', label: 'Get started' },
    { folder: 'guides', label: 'Guides' },
    { folder: 'reference', label: 'Reference' },
  ],
  types: {
    'get-started': 'quick-start',
    guides: 'how-to',
    reference: 'reference',
  },
  typeOverrides: { index: 'concept' },

  // The legacy home page (template home-page.html) is eleven inline-SVG cards
  // hard-coded in index.md; these are those cards, grouped, each linking the
  // page its card linked (url: the nav path of that page).
  homeCards: [{
    section: [
      {
        title: 'Get started',
        list_items: [
          { title: 'Overview', url: 'Updates|Get Started|Overview' },
          { title: 'Update Tool', url: 'Updates|How to Update|Using the Update Tool' },
          { title: 'Update commands', url: 'Updates|How to Update|Useful Update Commands' },
        ],
      },
      {
        title: 'Apply updates',
        list_items: [
          { title: 'Resolve conflicts', url: 'Updates|How to Update|Resolving Conflicts' },
          { title: 'Continuous update', url: 'Updates|How to Update|Continuous Update|Simple Setup' },
          { title: 'Hotfixes', url: 'Updates|Hotfixes' },
          { title: 'Updates portal', url: 'Updates|Updates Portal' },
        ],
      },
      {
        title: 'Registry',
        list_items: [
          { title: 'WSO2 container registry', url: 'Updates|Registry|Registry User Guide|Overview' },
          { title: 'Registry token management', url: 'Updates|Registry|Registry Token Management|Overview' },
        ],
      },
      {
        title: 'Help',
        list_items: [
          { title: 'Best practices', url: 'Updates|Best Practices' },
          { title: 'Troubleshooting', url: 'Updates|Troubleshooting Guide' },
          { title: 'FAQ', url: 'Updates|Frequently Asked Questions' },
        ],
      },
    ],
  }],
  // The legacy home page's own paragraph, shortened.
  homeIntro: 'WSO2 constantly improves its products, backports fixes to older affected versions, and delivers these improvements as updates through the WSO2 Update process to subscribed users.',

  fragments: [],
  excluded: ['page-not-found.md'],
  redirectToHome: ['page-not-found.md'],
  placeholders: {},
  variables: {},

  admonitions: apim.admonitions,
  languages: { ...apim.languages },

  properNouns: [
    'WSO2', 'WSO2 Updates', 'Updates 2.0', 'Update Tool', 'Updates Portal', 'WUM', 'In-place', 'Docker', 'Dockerfile', 'Harbor',
    'CLI', 'FAQ', 'API', 'Kubernetes', 'Helm', 'Cosign', 'Linux', 'MacOS', 'Windows',  ],
};
