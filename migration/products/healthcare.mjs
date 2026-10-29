// Converter config for Accelerator for Healthcare (wso2/open-healthcare-docs,
// a Docusaurus 2 site under en/, branch main → directory healthcare/, main
// only). An unversioned Doc space in the Solutions group (Product placement):
// the site has no versioned_docs/ and healthcare.docs.wso2.com serves one
// version under /docs/, so its docs/ ("next" in Docusaurus terms) is the one
// Edition, `_`, built from main; there are no release branches.
import { fileURLToPath } from 'node:url';

const LEGACY = 'https://healthcare.docs.wso2.com/docs/';

export default {
  slug: 'healthcare',
  source: 'docusaurus',
  sourceRepo: 'wso2/open-healthcare-docs',
  sourceRoot: 'en', // docusaurus.config.js lives here
  // sidebars.js and sidebars.ts hold the same sidebar; Docusaurus 2.4 reads
  // the .js one, and the converter finds the .ts first. Either gives this.
  sidebar: 'docsSidebar',
  // The one Edition, `_`, is the site's docs/ (Docusaurus's current version).
  sourceVersion: () => 'next',
  legacyBase: () => LEGACY,
  legacySites: { healthcare: LEGACY },
  // Fixes to the legacy source (lib/overrides.mjs), paths under en/.
  overrides: fileURLToPath(new URL('./healthcare.overrides.yaml', import.meta.url)),
  // old-content/ is excluded by the site's docs plugin (never served);
  // index.md is a stub that sends readers to the site root, which the Edition
  // home replaces; page-not-found.md is the old MkDocs 404 page.
  excluded: ['old-content/', 'index.md', 'page-not-found.md'],
  // The first top-level category's link page (Get Started:
  // get-started/architecture, "Accelerators") is the Edition home; the
  // legacy site root is a React landing page with no Markdown.
  home: 'first-link',
  // Pages in no sidebar land, unlisted, next to the section their source
  // folder belongs to, else here.
  unlistedFolder: 'reference',

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // healthcare/docspace.yaml.
  docspace: {
    schemaVersion: 1,
    slug: 'healthcare',
    displayName: 'Accelerator for Healthcare',
    model: 'unversioned',
    // The Solutions group's Docs section (navigation.yaml: { id: solutions,
    // in: solutions }), named after its group as each family's section is.
    home: 'solutions',
    owners: { team: 'healthcare-docs' },
    repo: 'wso2/open-healthcare-docs',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/open-healthcare-docs' },
  },
  // editions.yaml: an unversioned Doc space builds as Cloud (`_`), so only
  // the cloud: block is read; the pages use no {edition.*} variables.
  editions: {
    cloud: { displayName: 'Accelerator for Healthcare', productName: 'WSO2 Accelerator for Healthcare' },
  },

  // The legacy sidebar's top level re-filed into the sidebar skeleton;
  // everything below keeps its structure. deploy-and-operate is
  // Self-hosted only, so installation sits under get-started/.
  topLevel: {
    'Get Started': { folder: 'get-started' },
    'Install and Setup': { folder: 'get-started/install-and-setup' },
    'Working with FHIR': { folder: 'guides/fhir' },
    'Working with HL7': { folder: 'guides/hl7' },
    'Data Transformation': { folder: 'guides/data-transformation' },
    'EMR Connectivity': { folder: 'guides/emr-connectivity' },
    'Security & SMART on FHIR': { folder: 'guides/secure-health-apis' },
    'Advanced Topics': { folder: 'guides/advanced-topics' },
    'Compliance & Standards': { folder: 'concepts/compliance' },
    Performance: { folder: 'reference/performance' },
  },
  skeleton: [
    { folder: 'get-started', label: 'Get started' },
    { folder: 'guides', label: 'Guides' },
    { folder: 'concepts', label: 'Concepts' },
    { folder: 'reference', label: 'Reference' },
  ],
  types: {
    'get-started': 'quick-start',
    guides: 'how-to',
    concepts: 'concept',
    reference: 'reference',
  },
  typeOverrides: {
    index: 'concept',
    'get-started/install-and-setup/index': 'how-to',
  },

  // Admonition types the Platform does not have (Documentation standards, decision 4).
  admonitions: { caution: 'warning', important: 'warning', secondary: 'note', success: 'tip' },

  properNouns: [
    'WSO2', 'WSO2 Open Healthcare', 'Open Healthcare', 'Accelerator for Healthcare', 'FHIR', 'HL7', 'HL7v2', 'HL7 v2', 'SMART',
    'SMART on FHIR', 'CCDA', 'C-CDA', 'X12', 'CDS Hooks', 'IHE', 'EMR', 'EHR', 'Epic', 'Cerner', 'Athenahealth', 'Ballerina',
    'Micro Integrator', 'Integration Studio', 'API Manager', 'Identity Server', 'Choreo', 'Devant', 'HIPAA', 'CMS', 'ONC',
    'US Core', 'CARIN', 'Da Vinci', 'PDex', 'AI', 'API', 'APIs', 'REST', 'JSON', 'XML', 'OAuth', 'OpenID Connect', 'TCP', 'MLLP',
    'VS Code', 'Docker', 'Kubernetes',
  ],
};
