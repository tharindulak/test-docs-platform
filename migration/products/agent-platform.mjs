// Converter config for Agent Platform Cloud: the family-level Doc space in
// wso2/docs-agent-platform, directory agent-platform/ (Platform-by-platform
// walkthrough). Cloud only; Agent Manager's main line (agent-manager.mjs) is
// its Cloud part. It holds only the family overview (lib/family.mjs): the
// legacy site is Docusaurus and has no family home page to read cards from,
// so the overview is the intro and one product card per part. Convert
// agent-manager's main line first.
export default {
  kind: 'family',
  slug: 'agent-platform',
  sourceRepo: 'wso2/docs-agent-platform',
  sourceRoot: '',
  overview: {
    // No `tree`: no legacy home page cards (a Docusaurus source).
    legacyBase: 'https://wso2.com/agent-platform/docs/cloud/',
    description: 'Agent Platform Cloud: build, run, govern and observe AI agents, delivered as a service by WSO2.',
    intro: 'Agent Platform Cloud is WSO2\'s platform for building, running and governing AI agents, delivered as a service. Each product\'s Cloud documentation is one part of it.',
  },
  // The Cloud parts, in the order the overview lists them; each must say
  // `cloud: { in: agent-platform }` in its own manifest.
  parts: [
    { docSpace: 'agent-manager', title: 'Agent Manager', description: 'deploy, govern, observe and evaluate AI agents, with agent identity and access to LLMs and MCP tools.' },
  ],

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // agent-platform/docspace.yaml.
  docspace: {
    schemaVersion: 1,
    slug: 'agent-platform',
    displayName: 'Agent Platform Cloud',
    editionNames: { cloud: 'Agent Platform Cloud' },
    home: 'agent-platform',
    owners: { team: 'agent-platform-docs' },
    repo: 'wso2/docs-agent-platform',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-agent-platform' },
    editions: [{ id: 'cloud', parts: ['agent-manager'] }],
  },
  // editions.yaml: the Cloud variables.
  editions: {
    cloud: { displayName: 'Agent Platform Cloud', productName: 'WSO2 Agent Platform' },
  },
};
