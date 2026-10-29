// Converter config for API Portal & MCP Hub: wso2/docs-api-platform (one
// MkDocs build that keeps every version as folders,
// en/docs/api-portal/<version>/, plus the Cloud sub-section
// en/docs/cloud/devportal/, the Cloud entry's Developer Portal) →
// wso2/docs-api-platform, directory api-portal/ (Platform-by-platform
// walkthrough, rule 4), the AI Gateway pattern (ai-gateway.mjs):
// - main is API Portal & MCP Hub's Cloud part of API Platform Cloud
//   (api-platform.mjs), seeded from the next/ folder, plus the pages found
//   only in the Cloud sub-section, marked Cloud only. Cloud pages with the
//   same name as a main-line page go into a diff report
//   (.migration/cloud-diff.md).
// - api-portal/release/<version> comes from that version's folder.
// The view of the site each branch reads is lib/folders.mjs.
import { fileURLToPath } from 'node:url';
import aig from './ai-gateway.mjs';

export default {
  ...aig,
  slug: 'api-portal',
  // Fixes to the legacy source and accepted legacy-broken links (lib/overrides.mjs).
  overrides: fileURLToPath(new URL('./api-portal.overrides.yaml', import.meta.url)),
  // The other Doc spaces of this Content repo whose pages links may land on.
  siblings: ['api-platform', 'ai-gateway', 'api-gateway', 'ai-workspace'],

  // The view of the site a branch reads (folders.mjs).
  view(edition) {
    const version = edition === 'cloud' ? 'next' : edition;
    return {
      seed: { nav: ['API Portal', version], folder: `api-portal/${version}` },
      cloud: edition === 'cloud' ? { nav: ['Cloud', 'Developer Portal'], folder: 'cloud/devportal' } : null,
    };
  },

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // api-portal/docspace.yaml on every branch. One Edition, 1.0.0, as
  // product placement lists it.
  docspace: {
    schemaVersion: 1,
    slug: 'api-portal',
    displayName: 'API Portal & MCP Hub',
    editionNames: { selfHosted: 'API Portal & MCP Hub {version}' },
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
    cloud: { displayName: 'API Portal & MCP Hub Cloud', productName: 'WSO2 API Portal & MCP Hub' },
    'self-hosted': { displayName: 'API Portal & MCP Hub {version}', productName: 'WSO2 API Portal & MCP Hub' },
  },

  // A version's nav top level (and the Cloud sub-section's), re-filed into
  // the product skeleton. The Cloud sub-section's API Workflows is a
  // section where the version's is a page: the page and the section's
  // folder get different paths.
  topLevel: {
    Overview: { page: 'index' },
    'About this Release': { page: 'release-notes/about-this-release', ordered: true },
    Concepts: { page: 'concepts/key-concepts', ordered: true },
    'Quick Start Guide': { page: 'get-started/quick-start-guide', ordered: true },
    'Getting Started': { page: 'get-started/getting-started', ordered: true },
    'Setting Up': { folder: 'deploy-and-operate/setup' },
    'Discover APIs': { folder: 'guides/discover-apis' },
    'Discover MCP Servers': { folder: 'guides/mcp-servers' },
    'API Workflows': { page: 'guides/api-workflows', ordered: true, folder: 'guides/consume-api-workflows' },
    'AI Agent Discovery': { page: 'guides/ai-agent-discovery', ordered: true },
    'MCP Registry API': { page: 'reference/mcp-registry-api', ordered: true },
    'Applications and Credentials': { folder: 'guides/consume-an-api' },
    'Admin Settings': { folder: 'guides/admin-settings' },
    Deployment: { folder: 'deploy-and-operate/deployment' },
    Tutorials: { folder: 'get-started/tutorials' },
    References: { folder: 'reference' },
    // The Cloud sub-section (main line only).
    'Theming Developer Portal': { folder: 'guides/theming' },
    'Consume an API': { folder: 'guides/consuming-services' },
    'Manage Applications': { folder: 'guides/manage-applications' },
    'Manage Subscriptions': { folder: 'guides/manage-subscriptions' },
    'SDK Generation': { folder: 'guides/sdk-generation' },
  },
  // The Cloud sub-section's Admin Settings pages sit in another folder, so
  // on the main line the groups whose pages share the section's folder would
  // take its name (admin-settings/admin-settings/): they keep the release
  // branches' paths.
  sectionFolders: {
    'Admin Settings > Organization': 'guides/admin-settings/organization',
    'Admin Settings > Content': 'guides/admin-settings/content',
    'Admin Settings > Integrations': 'guides/admin-settings/integrations',
    'Admin Settings > Appearance': 'guides/admin-settings/appearance',
  },
  properNouns: [...aig.properNouns, 'Developer Portal', 'Asgardeo', 'OpenShift'],
};
