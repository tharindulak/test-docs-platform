// Converter config for Agent Manager (wso2/docs-agent-platform, a Docusaurus 3
// site at the repo root, branch main → directory agent-manager/, branches
// agent-manager/release/<version>). One docs plugin, three versions:
// versioned_docs/version-cloud (the hand-kept Cloud docs, "Agent Manager
// Cloud", served at /agent-platform/docs/cloud/), version-v1.0.0 (the newest
// release) and docs/ (Next: unreleased and noindex, left out).
// - main is Agent Manager's Cloud part of Agent Platform Cloud
//   (agent-platform.mjs), converted from version-cloud as the source keeps it.
// - agent-manager/release/<version> comes from version-v<version>.
const LEGACY = 'https://wso2.com/agent-platform/docs/';
// The site's version folders and URL segments carry a "v" (v1.0.0); the
// Platform's Edition ids do not.
const sourceVersion = (edition) => (['cloud', 'next'].includes(edition) ? edition : `v${edition}`);

export default {
  slug: 'agent-manager',
  source: 'docusaurus',
  sourceRepo: 'wso2/docs-agent-platform',
  sourceRoot: '', // docusaurus.config.ts is at the repo root
  sidebar: 'docsSidebar',
  sourceVersion,
  // Every version keeps its path (lastVersion has path: <version>, cloud: cloud).
  legacyBase: (edition) => `${LEGACY}${sourceVersion(edition)}/`,
  legacySites: { 'agent-manager': LEGACY },
  excluded: [],
  // No top-level category links a page: the first category's first page
  // (get-started/what-is-amp, where the legacy /cloud/ and /<version>/ land)
  // is the Edition home.
  home: 'first-doc',

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // agent-manager/docspace.yaml on every branch.
  docspace: {
    schemaVersion: 1,
    slug: 'agent-manager',
    displayName: 'Agent Manager',
    editionNames: { selfHosted: 'Agent Manager {version}' },
    home: 'agent-platform',
    cloud: { in: 'agent-platform' },
    owners: { team: 'agent-platform-docs' },
    repo: 'wso2/docs-agent-platform',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-agent-platform' },
    editions: [{ id: '1.0.0', branch: 'agent-manager/release/1.0.0' }],
  },
  editions: {
    cloud: { displayName: 'Agent Manager Cloud', productName: 'WSO2 Agent Manager' },
    'self-hosted': { displayName: 'Agent Manager {version}', productName: 'WSO2 Agent Manager' },
  },

  // The legacy sidebar's top level (Cloud and v1.0.0) re-filed into the
  // sidebar skeleton; everything below keeps its structure.
  topLevel: {
    'Get Started': { folder: 'get-started' },
    Concepts: { folder: 'concepts' },
    Guides: { folder: 'guides' },
    Tutorials: { folder: 'guides/tutorials' },
    References: { folder: 'reference' },
    // GitHub Discussions and Issues for the product (v1.0.0).
    Contributing: { page: 'reference/contributing' },
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
  },

  // Admonition types the Platform does not have (Documentation standards, decision 4).
  admonitions: { caution: 'warning', important: 'warning', secondary: 'note', success: 'tip' },

  properNouns: [
    'WSO2', 'WSO2 Agent Manager', 'Agent Manager', 'Agent Platform', 'AMP', 'AgentID', 'Agent ID', 'MCP', 'A2A', 'LLM', 'LLMs',
    'AI', 'API', 'APIs', 'CLI', 'CORS', 'JWT', 'OpenChoreo', 'OpenTelemetry', 'Kubernetes', 'Helm', 'Docker', 'K3d', 'VM',
    'gVisor', 'Kata', 'Ballerina', 'Thunder', 'GitHub', 'OpenAI', 'Python', 'IAM',
  ],
};
