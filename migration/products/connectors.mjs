// Converter config for Connectors (wso2/docs-integrator, branch
// wso2-connectors: a Docusaurus 3 site under en/ whose docs plugin reads
// docs/connectors/ → directory connectors/, main only). An unversioned Doc
// space with the catalog layout (Product placement): its one Edition, `_`,
// is built from main. Connector versions (Twilio's 4.0.x beside 5.0.x) are
// pages of the connector, not Editions.
// - The sidebar spreads connectorVersionedDocs() (code) into each versioned
//   connector's items to hide its older pages: the spreads are left out
//   (sidebarSpreads), so those pages are unlisted, as they were hidden.
// - The Connector Catalog page draws <ConnectorCatalog> from
//   src/data/connectors.ts: it becomes the catalog layout over
//   connectors.yaml, written from that module's literals (catalogs).
// - Links into Integrator and the Cloud docs go to the legacy site.
import integrator from './integrator.mjs';

const LEGACY = 'https://wso2.com/integration-platform/docs/';

export default {
  slug: 'connectors',
  source: 'docusaurus',
  sourceRepo: 'wso2/docs-integrator',
  sourceRoot: 'en',
  docsPath: 'docs/connectors',
  sidebar: 'mainSidebar',
  sidebarSpreads: 'drop',
  // The site's one version (docs/) is the Doc space's one Edition.
  sourceVersion: () => 'next',
  legacyBase: () => `${LEGACY}connectors/`,
  legacySites: { connectors: `${LEGACY}connectors/`, integrator: `${LEGACY}integrator/`, saas: `${LEGACY}saas/` },
  excluded: [],
  // The Overview page is the Edition home. The Connector Catalog (where the
  // legacy /connectors/catalog lands) is reference/catalog/, its data file
  // beside it: only index files may sit directly under docs/ (the sidebar
  // skeleton), as in the Platform's boilerplate catalog.

  catalogs: {
    ConnectorCatalog: {
      module: 'src/data/connectors.ts',
      items: 'CONNECTORS',
      categories: 'CATEGORIES',
      file: 'connectors.yaml',
      // link: the connector's overview, below catalog/; icon: a logo on
      // Ballerina Central (another host).
      item: (c) => ({
        name: String(c.name),
        description: String(c.description ?? ''),
        doc: c.link ? `catalog/${String(c.link).replace(/^\/+|\/+$/g, '')}` : null,
        category: c.category ? String(c.category) : null,
        tags: c.vendor ? [String(c.vendor)] : [],
        logo: c.icon ?? null,
      }),
    },
  },

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // connectors/docspace.yaml.
  docspace: {
    schemaVersion: 1,
    slug: 'connectors',
    displayName: 'Connectors',
    model: 'unversioned',
    home: 'integration-platform',
    owners: { team: 'integration-platform-docs' },
    repo: 'wso2/docs-integrator',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-integrator' },
  },
  // editions.yaml: an unversioned Doc space builds as Cloud (`_`), so only
  // the cloud: block is read; the pages use no {edition.*} variables.
  editions: {
    cloud: { displayName: 'Connectors', productName: 'WSO2 Integrator' },
  },

  // The legacy sidebar's top level re-filed into the sidebar skeleton; each
  // connector keeps its own folder below reference/catalog/.
  topLevel: {
    'Connector Catalog': { folder: 'reference/catalog' },
    Overview: { page: 'index' },
    'Using Connectors': { page: 'guides/using-connectors' },
    'Build a Connector': { folder: 'guides/build-your-own' },
    'Publish Connector': { page: 'guides/publish-connector' },
    Reference: { folder: 'reference' },
  },
  skeleton: [
    { folder: 'guides', label: 'Guides' },
    { folder: 'concepts', label: 'Concepts' },
    { folder: 'reference', label: 'Reference' },
  ],
  types: {
    guides: 'how-to',
    concepts: 'concept',
    reference: 'reference',
  },
  typeOverrides: { index: 'reference' },

  admonitions: integrator.admonitions,
  properNouns: [
    ...integrator.properNouns, 'Ballerina Central', 'OAuth', 'OAuth 2.0', 'API', 'APIs', 'SDK', 'REST', 'SOAP', 'SAP', 'IBM', 'Oracle',
    'MongoDB', 'MySQL', 'PostgreSQL', 'Redis', 'Snowflake', 'Slack', 'Twilio', 'Stripe', 'Shopify', 'HubSpot', 'GitHub', 'Jira',
  ],
};
