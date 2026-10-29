// Converter config for API Gateway: wso2/docs-api-platform (one MkDocs build
// that keeps every version as folders, en/docs/api-gateway/<version>/, plus
// the Cloud sub-section en/docs/cloud/api-platform-gateway/) →
// wso2/docs-api-platform, directory api-gateway/ (Platform-by-platform
// walkthrough, rule 4), the AI Gateway pattern (ai-gateway.mjs):
// - main is API Gateway's Cloud part of API Platform Cloud (api-platform.mjs),
//   seeded from the next/ folder, plus the pages found only in the Cloud
//   sub-section, marked Cloud only. Cloud pages with the same name as a
//   main-line page go into a diff report (.migration/cloud-diff.md).
//   The Cloud entry's API Gateway section also lists Third-Party Gateways
//   (cloud/federation/), a feature of API Platform Cloud itself rather than
//   of the gateway: it stays in API Platform Cloud.
// - api-gateway/release/<version> comes from that version's folder.
// The view of the site each branch reads is lib/folders.mjs.
import { fileURLToPath } from 'node:url';
import aig from './ai-gateway.mjs';

export default {
  ...aig,
  slug: 'api-gateway',
  // Fixes to the legacy source and accepted legacy-broken links (lib/overrides.mjs).
  overrides: fileURLToPath(new URL('./api-gateway.overrides.yaml', import.meta.url)),
  // The other Doc spaces of this Content repo whose pages links may land on.
  siblings: ['api-platform', 'ai-gateway', 'ai-workspace', 'api-portal'],

  // The view of the site a branch reads (folders.mjs).
  view(edition) {
    const version = edition === 'cloud' ? 'next' : edition;
    return {
      seed: { nav: ['API Gateway', version], folder: `api-gateway/${version}` },
      cloud: edition === 'cloud' ? { nav: ['Cloud', 'API Gateway'], folder: 'cloud/api-platform-gateway' } : null,
    };
  },

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // api-gateway/docspace.yaml on every branch. Editions in manifest order,
  // newest first (product placement): 1.2.0 is the legacy site's default.
  docspace: {
    schemaVersion: 1,
    slug: 'api-gateway',
    displayName: 'API Gateway',
    editionNames: { selfHosted: 'API Gateway {version}' },
    home: 'api-platform',
    cloud: { in: 'api-platform' },
    owners: { team: 'api-platform-docs' },
    repo: 'wso2/docs-api-platform',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-api-platform' },
    editions: [{ id: '1.2.0' }, { id: '1.1.0' }, { id: '1.0.0' }],
  },
  editions: {
    cloud: { displayName: 'API Gateway Cloud', productName: 'WSO2 API Gateway' },
    'self-hosted': { displayName: 'API Gateway {version}', productName: 'WSO2 API Gateway' },
  },

  // A version's nav top level (and the Cloud sub-section's), re-filed into
  // the product skeleton. 1.1.0 and 1.0.0 have no Resiliency or About this
  // release; 1.0.0 has no Performance.
  topLevel: {
    Overview: { page: 'index' },
    'Quick Start Guide': { page: 'get-started/quick-start-guide', ordered: true },
    Setup: { folder: 'deploy-and-operate/setup' },
    Deployment: { folder: 'deploy-and-operate/deployment' },
    Resiliency: { folder: 'guides/resiliency' },
    Policies: { folder: 'guides/policies' },
    Observability: { folder: 'guides/observability' },
    Analytics: { folder: 'guides/analytics' },
    'Management API': { folder: 'reference/management-api' },
    Performance: { folder: 'reference/performance' },
    'About this release': { page: 'release-notes/about-this-release', ordered: true },
    // The Cloud sub-section (main line only).
    'Self-Hosted Gateway': { folder: 'guides/self-hosted-gateway' },
  },
};
