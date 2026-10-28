// Converter config for Integrator (wso2/docs-integrator, a Docusaurus 3 site
// under en/, branch wso2-integrator → directory integrator/, branches
// integrator/release/<version>). Integrator on the proof (ticket 19): docs/
// is the main line (`next`), versioned_docs/version-5.1.0 and 5.0.0 the
// releases; connectors/ and icp/ are other Doc spaces, left out, and links
// into them go to the legacy site.
const LEGACY = 'https://wso2.com/integration-platform/docs/';
// The legacy site serves its newest release at its root, Next at /next/ and
// older releases at /<version>/.
const NEWEST = '5.1.0';

export default {
  slug: 'integrator',
  source: 'docusaurus',
  sourceRepo: 'wso2/docs-integrator',
  sourceRoot: 'en', // docusaurus.config.ts lives here
  sidebar: 'mainSidebar',
  legacyBase: (edition) => `${LEGACY}integrator/${edition === NEWEST ? '' : `${edition}/`}`,
  // product://<site>/<path> links and the sites the theme's components link
  // to (CloudDocsLink and PrereqCard cloud: the WSO2 Cloud docs, "saas").
  legacySites: { integrator: `${LEGACY}integrator/`, saas: `${LEGACY}saas/`, connectors: `${LEGACY}connectors/` },
  // Other Doc spaces (Q72): Connectors and Integration Control Plane.
  excluded: ['connectors/', 'icp/'],
  // The first top-level category's link page is the Edition home.
  home: 'first-link',

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // integrator/docspace.yaml on every branch.
  docspace: {
    schemaVersion: 1,
    slug: 'integrator',
    displayName: 'Integrator',
    editionNames: { selfHosted: 'WSO2 Integrator {version}' },
    home: 'integration-platform',
    owners: { team: 'integration-platform-docs' },
    repo: 'wso2/docs-integrator',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-integrator' },
    editions: [{ id: '5.1.0', branch: 'integrator/release/5.1.0' }, { id: '5.0.0', branch: 'integrator/release/5.0.0' }],
  },
  editions: {
    'self-hosted': {
      displayName: 'WSO2 Integrator {version}',
      productName: 'WSO2 Integrator',
    },
  },

  // The legacy sidebar's top level (5.1.0 and Next, then 5.0.0) re-filed into
  // the sidebar skeleton; everything below keeps its structure.
  topLevel: {
    'Platform Overview': { folder: 'concepts/platform-overview' },
    'Get Started': { folder: 'get-started' },
    'Editor Tour': { folder: 'guides/editor' },
    'Develop and Test': { folder: 'guides/develop-and-test' },
    'Deploy and Run': { folder: 'deploy-and-operate/deploy-and-run' },
    Manage: { folder: 'deploy-and-operate/manage' },
    Observe: { folder: 'deploy-and-operate/observe' },
    Migrate: { folder: 'guides/migrate' },
    Guides: { folder: 'guides' },
    'Cloud Providers': { folder: 'deploy-and-operate/cloud-providers' },
    Reference: { folder: 'reference' },
    // 5.0.0
    Develop: { folder: 'guides/develop' },
    'AI Integrations': { folder: 'guides/ai-integrations' },
    Deploy: { folder: 'deploy-and-operate/deploy' },
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
    guides: 'how-to',
    'guides/tutorials': 'tutorial',
    concepts: 'concept',
    reference: 'reference',
    'deploy-and-operate': 'how-to',
    'release-notes': 'release-notes',
  },
  typeOverrides: {
    index: 'concept',
    'get-started/index': 'concept',
  },

  // Admonition types the Platform does not have (Documentation standards, decision 4).
  admonitions: { caution: 'warning', important: 'warning', secondary: 'note', success: 'tip' },

  properNouns: [
    'WSO2', 'WSO2 Integrator', 'Integrator', 'Integration Control Plane', 'ICP', 'WSO2 Cloud', 'Devant', 'Choreo', 'Ballerina',
    'Copilot', 'Visual Designer', 'Kubernetes', 'Docker', 'Helm', 'AWS', 'Azure', 'Google', 'GCP', 'Amazon', 'Microsoft',
    'Kafka', 'RabbitMQ', 'Salesforce', 'GraphQL', 'MuleSoft', 'TIBCO', 'Logic Apps', 'OpenTelemetry', 'Prometheus',
    'Grafana', 'Jaeger', 'Zipkin', 'Datadog', 'New Relic', 'Moesif', 'Elastic', 'OpenSearch', 'GraalVM', 'Java', 'Python',
    'VS Code', 'Visual Studio Code', 'MCP', 'AI', 'EDI', 'FHIR', 'HL7', 'OpenAPI', 'gRPC', 'JMS', 'FTP', 'SFTP',
  ],
};
