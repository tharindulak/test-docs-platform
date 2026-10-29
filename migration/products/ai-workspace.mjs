// Converter config for AI Workspace: wso2/docs-api-platform (one MkDocs build
// that keeps every version as folders, en/docs/ai-workspace/<version>/, plus
// the Cloud sub-section en/docs/cloud/ai-workspace/) → wso2/docs-api-platform,
// directory ai-workspace/ (Platform-by-platform walkthrough, rule 4), the AI
// Gateway pattern (ai-gateway.mjs):
// - main is AI Workspace's Cloud part of API Platform Cloud (api-platform.mjs),
//   seeded from the next/ folder, plus the pages found only in the Cloud
//   sub-section, marked Cloud only. Cloud pages with the same name as a
//   main-line page go into a diff report (.migration/cloud-diff.md).
//   The Cloud entry's AI Workspace section also lists MCP Registry
//   (cloud/mcp-servers/, the folder of API Platform Cloud's MCP Servers
//   section): it stays in API Platform Cloud.
// - ai-workspace/release/<version> comes from that version's folder.
// The view of the site each branch reads is lib/folders.mjs.
import { fileURLToPath } from 'node:url';
import aig from './ai-gateway.mjs';

export default {
  ...aig,
  slug: 'ai-workspace',
  // Fixes to the legacy source and accepted legacy-broken links (lib/overrides.mjs).
  overrides: fileURLToPath(new URL('./ai-workspace.overrides.yaml', import.meta.url)),
  // The other Doc spaces of this Content repo whose pages links may land on.
  siblings: ['api-platform', 'ai-gateway', 'api-gateway', 'api-portal'],

  // The view of the site a branch reads (folders.mjs).
  view(edition) {
    const version = edition === 'cloud' ? 'next' : edition;
    return {
      seed: { nav: ['AI Workspace', version], folder: `ai-workspace/${version}` },
      cloud: edition === 'cloud' ? { nav: ['Cloud', 'AI Workspace'], folder: 'cloud/ai-workspace' } : null,
    };
  },

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // ai-workspace/docspace.yaml on every branch. One Edition, 1.0.0, as
  // product placement lists it.
  docspace: {
    schemaVersion: 1,
    slug: 'ai-workspace',
    displayName: 'AI Workspace',
    editionNames: { selfHosted: 'AI Workspace {version}' },
    home: 'api-platform',
    cloud: { in: 'api-platform' },
    owners: { team: 'api-platform-docs' },
    repo: 'wso2/docs-api-platform',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-api-platform' },
    editions: [{ id: '1.0.0' }],
  },
  editions: {
    cloud: { displayName: 'AI Workspace Cloud', productName: 'WSO2 AI Workspace' },
    'self-hosted': { displayName: 'AI Workspace {version}', productName: 'WSO2 AI Workspace' },
  },

  // A version's nav top level (and the Cloud sub-section's), re-filed into
  // the product skeleton. 1.0.0 spells "Manage gateway-deployed AI
  // artifacts" in lower case and has no Agent Proxies.
  topLevel: {
    Overview: { page: 'index' },
    'About this Release': { page: 'release-notes/about-this-release', ordered: true },
    'Getting Started': { page: 'get-started/getting-started', ordered: true },
    'Setting Up': { folder: 'deploy-and-operate/setup' },
    Deployment: { folder: 'deploy-and-operate/deployment' },
    'AI Gateways': { folder: 'guides/ai-gateways' },
    'LLM Providers': { folder: 'guides/llm-providers' },
    'LLM Provider Templates': { folder: 'guides/llm-provider-templates' },
    'App LLM Proxies': { folder: 'guides/llm-proxies' },
    'MCP Proxies': { folder: 'guides/mcp-proxies' },
    'Agent Proxies': { folder: 'guides/agent-proxies' },
    'Secrets Management': { page: 'guides/secrets-management', ordered: true },
    'Manage Gateway-deployed AI artifacts': { page: 'guides/sync-gateway-created-artifacts', ordered: true },
    'Manage gateway-deployed AI artifacts': { page: 'guides/sync-gateway-created-artifacts', ordered: true },
    'CI/CD': { folder: 'guides/ci-cd' },
    Policies: { folder: 'guides/policies' },
    Insights: { page: 'guides/insights', ordered: true },
    'GenAI Applications': { page: 'guides/genai-applications', ordered: true },
    'Configure Inbound Auth': { page: 'guides/configure-inbound-auth', ordered: true },
    'Invoke via SDKs': { page: 'guides/using-sdks', ordered: true },
    Troubleshooting: { page: 'guides/troubleshooting', ordered: true },
    References: { folder: 'reference' },
    // The Cloud sub-section (main line only).
    Quickstart: { page: 'get-started/quickstart', ordered: true },
  },
  // The Cloud sub-section's Policies pages sit in another folder, so on the
  // main line Custom Policies would take its folder's name
  // (policies/policies/): it keeps the release branches' path.
  sectionFolders: {
    'Policies > Custom Policies': 'guides/policies/custom-policies',
  },
};
