// Converter config for Accelerator for Financial Services (wso2/docs-open-banking,
// MkDocs under en/ → directory financial-services/; branches main and
// release/<version>, unprefixed since the repo holds one Doc space). A
// versions-only product in the Solutions group (Product placement): 4.0.0 and
// 3.0.0, older versions on Confluence.
//
// The legacy site's version list (the `versions` branch's versions.json)
// serves 4.0.0 and `latest` from `master` and 3.0.0 from the `3.0.0` branch;
// the `4.0.0` branch is an older working copy of master. So main's `next`
// preview and release/4.0.0 both convert `master`, release/3.0.0 converts
// `3.0.0`. Everything product-specific lives here; the rules in ../lib are
// shared by every MkDocs product.
import { fileURLToPath } from 'node:url';
import apim from './api-manager.mjs';

const LEGACY_HOST = 'ob.docs.wso2.com';

export default {
  slug: 'financial-services',
  sourceRepo: 'wso2/docs-open-banking',
  sourceRoot: 'en', // mkdocs.yml lives here
  // A version's own address (master, `next`, reads its site_version, 4.0.0).
  // master's links to /en/latest/ stay links to the legacy site, as API
  // Manager's do.
  legacyBase: (version) => `https://${LEGACY_HOST}/en/${version}/`,
  legacyHosts: [LEGACY_HOST],
  // Fixes to the legacy source and accepted legacy-broken links (lib/overrides.mjs).
  overrides: fileURLToPath(new URL('./financial-services.overrides.yaml', import.meta.url)),

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // financial-services/docspace.yaml on every branch.
  docspace: {
    schemaVersion: 1,
    slug: 'financial-services',
    displayName: 'Accelerator for Financial Services',
    editionNames: { selfHosted: 'Accelerator for Financial Services {version}' },
    // The Solutions group's Docs section, named after its group as Other's is.
    home: 'solutions',
    owners: { team: 'financial-services-docs' },
    // Solutions keeps its current repo for now (Repo structure).
    repo: 'wso2/docs-open-banking',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-open-banking' },
    // One Doc space in the repo: release branches are unprefixed.
    editions: [{ id: '4.0.0', branch: 'release/4.0.0' }, { id: '3.0.0', branch: 'release/3.0.0' }],
    // Legacy versions (Product placement: "older on Confluence"), as the
    // legacy site's versions.json lists them.
    legacyVersions: [['2.0.0', 'OB200'], ['1.5.0', 'OB150'], ['1.4.0', 'OB140'], ['1.3.0', 'OB130']]
      .map(([id, space]) => ({ id, url: `https://wso2docs.atlassian.net/wiki/spaces/${space}/` })),
  },
  editions: {
    'self-hosted': {
      displayName: 'Accelerator for Financial Services {version}',
      productName: 'WSO2 Open Banking Accelerator',
    },
  },

  // The legacy nav's top level (4.0.0 and 3.0.0) re-filed into the sidebar
  // skeleton. Everything below keeps its old structure.
  topLevel: {
    Home: { page: 'index' },
    'Get Started': { folder: 'get-started' },
    'Install and Setup': { folder: 'deploy-and-operate/install-and-setup' },
    'Tryout Flows': { folder: 'get-started/tryout-flows' },
    Learn: { folder: 'guides' },
    Develop: { folder: 'guides/develop' },
    Toolkits: { folder: 'guides/toolkits' },
    Conformance: { folder: 'guides/conformance' },
    References: { folder: 'reference' },
  },
  sectionFolders: {},
  apiFolder: 'reference/apis',
  pageOverrides: {
    'get-started/about-this-release.md': 'release-notes/about-this-release',
  },
  skeleton: [
    { folder: 'get-started', label: 'Get started' },
    { folder: 'guides', label: 'Guides' },
    { folder: 'concepts', label: 'Concepts' },
    { folder: 'reference', label: 'Reference' },
    { folder: 'deploy-and-operate', label: 'Deploy and operate' },
    { folder: 'release-notes', label: 'Release notes' },
  ],
  types: {
    'get-started': 'quick-start',
    'get-started/tryout-flows': 'tutorial',
    guides: 'how-to',
    concepts: 'concept',
    reference: 'reference',
    'deploy-and-operate': 'how-to',
    'release-notes': 'release-notes',
  },
  typeOverrides: {
    index: 'concept',
    'get-started/open-banking': 'concept',
    'get-started/open-banking-requirements': 'concept',
    'get-started/regulations-and-standards': 'concept',
    'get-started/wso2-open-banking-accelerator': 'concept',
  },

  // The legacy home page's cards are inline HTML with onclick handlers (no
  // links once converted), and they differ per version: 3.0.0 has Data
  // Publishing and Integration cards that 4.0.0 commented out, and the navs
  // differ. These are its cards (url: the nav path of the page each opens),
  // grouped as the overview layout draws them; the YouTube video goes.
  homeCards: (edition) => [{
    section: edition === '3.0.0' ? [
      { title: 'Get started', list_items: [{ title: 'Quick start guide', url: 'Get Started|Quick Start Guide|Get Started' }] },
      {
        title: 'Learn',
        list_items: [
          { title: 'Consent management', url: 'Learn|Consent Management|Introduction' },
          { title: 'Dynamic client registration', url: 'Learn|Dynamic Client Registration|Introduction' },
          { title: 'Secured API invocation', url: 'Learn|API Security|Introduction' },
          { title: 'Analytics and data publishing', url: 'Learn|Data Publishing|Introduction' },
          { title: 'Core banking integration', url: 'Learn|Integration' },
        ],
      },
      { title: 'Develop', list_items: [{ title: 'Develop toolkit', url: 'Develop|Toolkit Introduction' }] },
    ] : [
      {
        title: 'Get started',
        list_items: [
          { title: 'Quick start with Identity Server', url: 'Get Started|Quick Start Guide|Accelerator with WSO2 Identity server|Get Started' },
          { title: 'Quick start with Identity Server and API Manager', url: 'Get Started|Quick Start Guide|Accelerator with WSO2 Identity server and WSO2 API Manager|Get Started' },
          { title: 'Try out flows', url: 'Tryout Flows|Tryout WSO2 Open Banking Accelerator' },
        ],
      },
      {
        title: 'Learn',
        list_items: [
          { title: 'Consent management', url: 'Learn|Consent Management|Introduction' },
          { title: 'Dynamic client registration', url: 'Learn|Client Registration|Dynamic Client Registration|Introduction' },
          { title: 'Secured API invocation', url: 'Learn|API Security|Introduction' },
        ],
      },
      { title: 'Develop', list_items: [{ title: 'Develop toolkit', url: 'Develop|Toolkit|Introduction' }] },
    ],
  }],
  homeIntro: 'WSO2 Open Banking Accelerator is a collection of technologies that increases the speed and reduces the complexity of adopting open banking compliance. Instead of building a solution from scratch, you can use it to meet all legislative requirements with additional benefits beyond compliance. Get a head start with the quick start guide, or dive into the documentation to understand what it offers and how to extend it.',

  fragments: ['includes/'],
  excluded: ['wip/', 'page-not-found.md'],
  redirectToHome: ['page-not-found.md'],
  placeholders: {},

  // The pages use no MkDocs variables.
  variables: {},

  admonitions: { ...apim.admonitions, optional: 'note' },
  languages: { ...apim.languages, click: 'text', jwt: 'text', server: 'text' },

  // API reference pages (template: templates/redoc.html) → reference/apis/<slug>/.
  apiAreas: {
    'accelerator-extensions-api': 'Extensions', 'consent-rest-api': 'Internal', 'dcr-rest-api': 'Internal', 'application-info-api': 'Internal',
  },

  // Words kept as they are when labels are put in sentence case.
  properNouns: [
    'WSO2', 'Open Banking', 'Open Finance', 'Open Banking Accelerator', 'Accelerator', 'Identity Server', 'API Manager',
    'Key Manager', 'Financial Service Key Manager', 'Traffic Manager', 'Control Plane', 'Gateway', 'API', 'APIs', 'REST',
    'OpenAPI', 'Java', 'FAPI', 'CIBA', 'DCR', 'MTLS', 'JWE', 'JWS', 'JWT', 'UK', 'Berlin', 'CDS', 'KeyID', 'ID', 'Docker',
    'Hibernate', 'Consent Manager', 'App-to-App', 'Active-Active', 'Regulatory Aggregator',
  ],
};
