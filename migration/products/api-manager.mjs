// Converter config for API Manager (wso2/docs-apim → wso2/docs-api-platform,
// directory api-manager/, branches api-manager/release/<version>).
// Everything product-specific lives here; the rules in ../lib are shared by
// every MkDocs product.
import { fileURLToPath } from 'node:url';

export default {
  slug: 'api-manager',
  sourceRepo: 'wso2/docs-apim',
  sourceRoot: 'en', // mkdocs.yml lives here
  legacyBase: (version) => `https://apim.docs.wso2.com/en/${version}/`,
  // Legacy site_url versions that count as "this Edition" in absolute links.
  legacyHosts: ['apim.docs.wso2.com'],
  // Fixes to the legacy source and accepted legacy-broken links (lib/overrides.mjs).
  overrides: fileURLToPath(new URL('./api-manager.overrides.yaml', import.meta.url)),

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // api-manager/docspace.yaml on every branch.
  docspace: {
    schemaVersion: 1,
    slug: 'api-manager',
    displayName: 'API Manager',
    editionNames: { selfHosted: 'API Manager {version}' },
    home: 'api-platform',
    owners: { team: 'api-platform-docs' },
    repo: 'wso2/docs-api-platform',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    // During the Pilot, issues go to the legacy repo.
    issues: { repo: 'wso2/docs-apim' },
    // Prefixed, since docs-api-platform is shared: API Platform Cloud and AI
    // Gateway join it with "Convert API Platform Cloud and AI Gateway".
    editions: [{ id: '4.7.0', branch: 'api-manager/release/4.7.0' }, { id: '4.6.0', branch: 'api-manager/release/4.6.0' }],
    // Legacy versions (product placement): 4.5.0 to 3.0.0 stay on
    // apim.docs.wso2.com, 2.6.0 and older on Confluence (the spaces wso2/docs-apim's
    // versions.json names, at the archive address worker/src/confluence.mjs uses).
    legacyVersions: [
      ...['4.5.0', '4.4.0', '4.3.0', '4.2.0', '4.1.0', '4.0.0', '3.2.0', '3.1.0', '3.0.0'].map((id) => ({ id, url: `https://apim.docs.wso2.com/en/${id}/` })),
      ...[['2.6.0', 'AM260'], ['2.5.0', 'AM250'], ['2.2.0', 'AM220'], ['2.1.0', 'AM210'], ['2.0.0', 'AM200'], ['1.10.0', 'AM1100'], ['1.9.1', 'AM191'], ['1.9.0', 'AM190']]
        .map(([id, space]) => ({ id, url: `https://wso2docs.atlassian.net/wiki/spaces/${space}/overview` })),
    ],
  },
  editions: {
    'self-hosted': {
      displayName: 'API Manager {version}',
      productName: 'WSO2 API Manager',
    },
  },

  // Re-filing the old nav's top level into the sidebar skeleton (Migration
  // approach, decision 7). Everything below keeps its old structure.
  topLevel: {
    Home: { page: 'index' },
    'Get Started': { folder: 'get-started' },
    'Install & Setup': { folder: 'deploy-and-operate/install-and-setup' },
    Tutorials: { folder: 'get-started/tutorials' },
    'API Design & Manage': { folder: 'guides/api-design-manage' },
    'API Developer Portal': { folder: 'guides/api-developer-portal' },
    'API Security': { folder: 'guides/api-security' },
    'API Gateway': { folder: 'guides/api-gateway' },
    'AI Gateway': { folder: 'guides/ai-gateway' },
    'API Analytics & Monetization': { folder: 'guides/api-analytics-and-monetization' },
    Administration: { folder: 'deploy-and-operate/administer' },
    APIOps: { folder: 'guides/apiops' },
    Reference: { folder: 'reference' },
  },
  // Nav sections (by nav path) that go to a fixed folder.
  sectionFolders: {
    'Reference > Product REST APIs': 'reference/apis',
  },
  apiFolder: 'reference/apis',
  // Single pages that belong to another skeleton folder than their section.
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
  // Page type from the skeleton folder (Documentation standards, decision 5),
  // longest prefix wins, plus single-page overrides.
  types: {
    'get-started': 'quick-start',
    'get-started/tutorials': 'tutorial',
    guides: 'how-to',
    concepts: 'concept',
    reference: 'reference',
    'deploy-and-operate': 'how-to',
    'release-notes': 'release-notes',
  },
  typeOverrides: {
    index: 'concept',
    'get-started/overview': 'concept',
    'get-started/key-concepts': 'concept',
    'get-started/apim-architecture': 'concept',
    'get-started/deployment-options/deployment-platforms': 'concept',
    'get-started/deployment-options/deployment-patterns': 'concept',
  },

  // Files under docs/ that are not pages.
  fragments: ['includes/'],
  excluded: ['wip/', 'page-not-found.md'],
  // Legacy URLs with no page of their own that go to the Edition home.
  redirectToHome: ['page-not-found.md'],
  // Pages the converter does not convert, with what it puts there instead.
  placeholders: {
    'reference/config-catalog.md': {
      reason: 'generated HTML catalog (en/tools/config-catalog-generator); becomes a data-driven Platform component later',
    },
  },

  // Jinja variables (Migration approach, decision 3: a lookup table; an
  // unknown config variable fails the run).
  variables: {
    base_path: { remove: true },
    site_version: { edition: 'version' },
    product_name: { edition: 'productName' },
  },

  // Admonition types → Docusaurus's five (Documentation standards, decision 4).
  admonitions: {
    note: 'note', info: 'info', tip: 'tip', warning: 'warning', danger: 'danger',
    example: 'note', important: 'warning', abstract: 'info', summary: 'info', tldr: 'info',
    attention: 'warning', caution: 'warning', warn: 'warning', tips: 'tip', hint: 'tip',
    success: 'tip', check: 'tip', done: 'tip', question: 'info', help: 'info', faq: 'info',
    failure: 'danger', fail: 'danger', missing: 'danger', error: 'danger', bug: 'danger',
    quote: 'note', cite: 'note', todo: 'note', seealso: 'info',
    prerequisite: 'info', prerequisites: 'info', troubleshooting: 'note', limitation: 'warning',
    configurations: 'note', more: 'note', java: 'note',
  },
  // Code fence languages → Prism names.
  languages: {
    sh: 'bash', shell: 'bash', console: 'bash', zsh: 'bash', keytool: 'bash', curl: 'bash',
    js: 'javascript', yml: 'yaml', dockerfile: 'docker', conf: 'ini', bat: 'batch',
    code: 'text', string: 'text', format: 'text', example: 'text', url: 'text', log: 'text',
    plain: 'text', txt: 'text', none: 'text', jsp: 'markup', html: 'markup', xml: 'xml',
    '--query': 'text', failed: 'text',
  },

  // Words kept as they are when labels are put in sentence case.
  properNouns: [
    'API Manager', 'API-M', 'WSO2', 'Developer Portal', 'Dev Portal', 'API Publisher', 'Publisher', 'Admin Portal',
    'Key Manager', 'Traffic Manager', 'Control Plane', 'API Gateway', 'AI Gateway', 'Universal Gateway',
    'Kubernetes Gateway', 'Choreo Connect', 'Choreo', 'Micro Integrator', 'Identity Server', 'Streaming Integrator',
    'Kubernetes', 'Docker', 'Helm', 'Linux', 'Windows', 'Azure', 'Google', 'Amazon', 'Microsoft', 'Kafka', 'Solace',
    'Okta', 'Auth0', 'Keycloak', 'PingFederate', 'ForgeRock', 'Prometheus', 'Grafana', 'Jaeger', 'Zipkin',
    'OpenSearch', 'Elastic', 'Elasticsearch', 'Datadog', 'New Relic', 'Moesif', 'Splunk', 'Oracle', 'Redis',
    'Jenkins', 'Postman', 'Java', 'Python', 'Go', 'Lambda', 'Envoy', 'Istio', 'Swagger', 'Synapse', 'Ballerina',
    'HashiCorp Vault', 'Vault', 'Active Directory', 'Secure Vault', 'Open Policy Agent', 'Azure AD', 'Entra ID',
    'Hazelcast', 'Gemini', 'Mistral', 'Anthropic', 'Bedrock', 'Ollama', 'Apigee', 'Kong', 'Mule', 'Tomcat',
    'Marketplace Assistant', 'Consul', 'Thrift', 'Siddhi', 'Velocity',
  ],

  // API reference pages (template: templates/redoc.html) → reference/apis/<slug>/.
  // Area groups the APIs on the Reference landing page.
  apiAreas: {
    'publisher-v4': 'Management', 'devportal-v3': 'Management', 'admin-v4': 'Management',
    'gateway-v2': 'Runtime', 'service-catalog-v1': 'Management', 'governance-v1': 'Governance',
    'devops-v0': 'Operations',
  },
};
