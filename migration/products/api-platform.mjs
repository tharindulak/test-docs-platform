// Converter config for API Platform Cloud: the family-level Doc space in
// wso2/docs-api-platform, directory api-platform/ (Platform-by-platform
// walkthrough), formerly Bijira. Cloud only, on main. It holds today's Cloud
// entry and the site-wide pages of wso2/docs-api-platform (one MkDocs build
// that keeps every version as folders), mapped onto the family skeleton:
// Overview · Get started · one group per Cloud part · Guides · Concepts ·
// Reference. AI Gateway is its Cloud part (ai-gateway.mjs, converted first:
// its main line holds the Cloud sub-section cloud/ai-gateway/). The other
// three Cloud parts (API Gateway, AI Workspace, API Portal & MCP Hub) are not
// Doc spaces yet, so their Cloud pages wait here, each as a group under
// Guides (the skeleton has no top-level folder for a part that is not a Doc
// space), until their Doc spaces are converted and become Cloud parts.
import { fileURLToPath } from 'node:url';
import aig from './ai-gateway.mjs';

const LEGACY = 'https://wso2.com/api-platform/docs/';

export default {
  ...aig,
  kind: 'family',
  slug: 'api-platform',
  overrides: fileURLToPath(new URL('./api-platform.overrides.yaml', import.meta.url)),
  siblings: ['ai-gateway'],
  // The Cloud parts, in the order the overview lists them; each must say
  // `cloud: { in: api-platform }` in its own manifest.
  parts: [
    { docSpace: 'ai-gateway', title: 'AI Gateway', description: 'govern LLM, MCP and agent traffic: guardrails, routing, rate limits and observability for AI.' },
  ],

  // The whole site but each product's version folders and the AI Gateway
  // part; the Cloud entry's sections become the top level.
  view: () => ({
    seed: {
      nav: [],
      folder: '',
      exclude: [['API Gateway'], ['AI Gateway'], ['API Portal'], ['AI Workspace'], ['Cloud', 'AI Gateway']],
      excludeFolders: ['api-gateway', 'ai-gateway', 'api-portal', 'ai-workspace', 'cloud/ai-gateway', 'next'],
      splice: [['Cloud']],
      // Pages in no nav whose folder several sections share.
      unlisted: { 'cloud/ai-workspace/insights.md': 'guides/ai-workspace/insights' },
    },
    cloud: null,
  }),
  // Pages drawn with a Platform layout: the home, and the guide indexes whose
  // cards <div markdown="1"> styled (Extension points: the overview layout).
  pageLayouts: { index: 'overview', 'guides/overview': 'overview', 'guides/service-providers/': 'overview' },
  // next/index.md is the unreleased copy of the home page (next is folded into Cloud).
  redirectToHome: ['next/index.md'],

  docspace: {
    schemaVersion: 1,
    slug: 'api-platform',
    displayName: 'API Platform Cloud',
    formerNames: ['Bijira'],
    editionNames: { cloud: 'API Platform Cloud' },
    home: 'api-platform',
    owners: { team: 'api-platform-docs' },
    repo: 'wso2/docs-api-platform',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-api-platform' },
    editions: [{ id: 'cloud', parts: ['ai-gateway'] }],
  },
  editions: {
    cloud: { displayName: 'API Platform Cloud', productName: 'WSO2 API Platform' },
  },

  // Today's top level (with the Cloud entry spliced in), re-filed into the
  // family skeleton (Platform-by-platform walkthrough, API Platform Cloud tree).
  topLevel: {
    Overview: { page: 'index' },
    'Get Started': { page: 'get-started/index', ordered: true },
    Introduction: { folder: 'get-started' },
    // The Cloud pages of the Cloud parts not converted yet.
    'API Gateway': { folder: 'guides/api-gateway' },
    'AI Workspace': { folder: 'guides/ai-workspace' },
    'Developer Portal': { folder: 'guides/api-portal' },
    // Guides.
    'Create API Proxy': { folder: 'guides/create-api-proxy' },
    'Develop API Proxy': { folder: 'guides/develop-api-proxy' },
    'Test API Proxy': { folder: 'guides/test-api-proxy' },
    'MCP Servers': { folder: 'guides/mcp-servers' },
    'API Governance': { folder: 'guides/api-governance' },
    'Event Gateway': { folder: 'guides/event-gateway' },
    'Monitor and Insights': { folder: 'guides/monitor-and-insights' },
    Administer: { folder: 'guides/administer' },
    Workflows: { folder: 'guides/workflows' },
    Tutorials: { folder: 'guides/tutorials' },
    Analytics: { folder: 'guides/analytics' },
    Monetization: { folder: 'guides/monetization' },
    'Policy Hub': { folder: 'guides/policy-hub' },
    Guides: { folder: 'guides' },
    // Concepts and Reference.
    'API Manager': { folder: 'concepts/api-manager' },
    'API Platform Samples': { folder: 'reference/samples' },
    Tools: { folder: 'reference/tools' },
    // Site-wide pages upstream added to the top level (2026-10-28).
    FAQ: { page: 'reference/faq' },
    Glossary: { page: 'reference/glossary' },
  },
  sectionFolders: {
    'Introduction > Quick Start Guide': 'get-started/quick-start-guide',
    'Introduction > Concepts': 'concepts',
  },
  pageOverrides: {
    'cloud/introduction/what-is-bijira.md': 'get-started/what-is-api-platform-cloud',
    // One-page sections are pages; Monetization's overview is its folder's
    // page (the products menu opens guides/monetization/).
    'monetization/overview.md': 'guides/monetization/index',
    'analytics/overview.md': 'guides/analytics',
    'policy-hub/overview.md': 'guides/policy-hub',
    'api-manager/overview.md': 'concepts/api-manager',
  },
  skeleton: [
    { folder: 'get-started', label: 'Get started' },
    { folder: 'guides', label: 'Guides' },
    { folder: 'concepts', label: 'Concepts' },
    { folder: 'reference', label: 'Reference' },
    { folder: 'release-notes', label: 'Release notes' },
  ],
  types: {
    'get-started': 'quick-start',
    guides: 'how-to',
    concepts: 'concept',
    reference: 'reference',
    'release-notes': 'release-notes',
  },
  typeOverrides: { index: 'concept' },
  legacyBase: () => LEGACY,
  properNouns: [...aig.properNouns, 'API Platform Cloud', 'Bijira', 'Event Gateway', 'Policy Hub', 'Arazzo', 'VS Code', 'Stripe', 'GitHub'],
};
