// Converter config for AI Gateway: wso2/docs-api-platform (one MkDocs build
// that keeps every version as folders, en/docs/ai-gateway/<version>/, plus
// the Cloud sub-section en/docs/cloud/ai-gateway/) → wso2/docs-api-platform,
// directory ai-gateway/ (Platform-by-platform walkthrough, rule 4):
// - main is AI Gateway's Cloud part of API Platform Cloud (api-platform.mjs),
//   seeded from the next/ folder, plus the pages found only in the Cloud
//   sub-section, marked Cloud only. Cloud pages with the same name as a
//   main-line page go into a diff report (.migration/cloud-diff.md).
// - ai-gateway/release/<version> comes from that version's folder.
// The view of the site each branch reads is lib/folders.mjs.
import { fileURLToPath } from 'node:url';
import apim from './api-manager.mjs';

const LEGACY = 'https://wso2.com/api-platform/docs/';

export default {
  ...apim,
  slug: 'ai-gateway',
  sourceRepo: 'wso2/docs-api-platform',
  sourceRoot: 'en',
  legacyBase: () => LEGACY,
  legacyHosts: ['wso2.com'],
  // Fixes to the legacy source and accepted legacy-broken links (lib/overrides.mjs).
  overrides: fileURLToPath(new URL('./ai-gateway.overrides.yaml', import.meta.url)),
  redirectsPlugin: true, // the legacy redirects are mkdocs-redirects' redirect_maps
  keepDescriptions: true,
  mdInHtml: true, // mkdocs.yml loads md_in_html: <div markdown="1"> wraps Markdown
  dropDecorativeSvg: true, // inline icons marked aria-hidden (guide cards)
  dropTabButtons: true, // the guides overview's "By use case / By service provider" switcher, inert without the legacy script
  // The legacy front matter's content_type → Page type.
  typeFromFrontMatter: {
    key: 'content_type',
    map: {
      'how-to': 'how-to', reference: 'reference', concept: 'concept', overview: 'concept', quickstart: 'quick-start',
      tutorial: 'tutorial', troubleshooting: 'how-to', 'release-notes': 'release-notes',
    },
  },
  // The other Doc spaces of this Content repo whose pages links may land on.
  siblings: ['api-platform', 'ai-workspace', 'api-portal'],

  // The view of the site a branch reads (folders.mjs).
  view(edition) {
    const version = edition === 'cloud' ? 'next' : edition;
    return {
      seed: {
        nav: ['AI Gateway', version],
        folder: `ai-gateway/${version}`,
        // A version folder's README.md is the version's landing page.
        unlisted: { 'README.md': 'concepts/key-concepts' },
      },
      cloud: edition === 'cloud'
        ? { nav: ['Cloud', 'AI Gateway'], folder: 'cloud/ai-gateway', unlisted: { 'gateway-controller-api.md': 'reference/gateway-controller-api' } }
        : null,
    };
  },

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // ai-gateway/docspace.yaml on every branch. Editions in manifest order:
  // 1.2.0 is the newest release (the legacy site's default, "Latest LTS");
  // 2026.09.24 is the date-versioned STS line, listed after it, never sorted.
  docspace: {
    schemaVersion: 1,
    slug: 'ai-gateway',
    displayName: 'AI Gateway',
    editionNames: { selfHosted: 'AI Gateway {version}' },
    home: 'api-platform',
    cloud: { in: 'api-platform' },
    owners: { team: 'api-platform-docs' },
    repo: 'wso2/docs-api-platform',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-api-platform' },
    editions: [{ id: '1.2.0' }, { id: '2026.09.24' }, { id: '1.1.0', branch: 'ai-gateway/release/1.1.0' }],
    legacyVersions: [
      { id: '1.0.0', url: `${LEGACY}ai-gateway/1.0.0/` },
    ],
  },
  editions: {
    cloud: { displayName: 'AI Gateway Cloud', productName: 'WSO2 AI Gateway' },
    'self-hosted': { displayName: 'AI Gateway {version}', productName: 'WSO2 AI Gateway' },
  },

  // A version's nav top level (and the Cloud sub-section's), re-filed into
  // the product skeleton. "CLI and Extensibility" and "Guides" list
  // site-wide pages (tools/, guides/), which live in API Platform Cloud.
  topLevel: {
    Overview: { page: 'index' },
    'Quick Start Guide': { page: 'get-started/quick-start-guide', ordered: true },
    'How It Works': { page: 'concepts/how-it-works', ordered: true },
    'Authenticate Clients': { page: 'guides/authenticate-clients', ordered: true },
    'Authenticate Backends': { page: 'guides/authenticate-backends', ordered: true },
    Guardrails: { folder: 'guides/guardrails' },
    'Token Based Rate Limiting': { page: 'guides/token-based-rate-limiting', ordered: true },
    'Cost Control and Budgets': { page: 'guides/cost-control-and-budgets', ordered: true },
    'Semantic Caching': { page: 'guides/semantic-caching', ordered: true },
    Routing: { folder: 'guides/routing' },
    'Prompt Management': { page: 'guides/prompt-management', ordered: true },
    'MCP Governance': { page: 'guides/mcp-governance', ordered: true },
    'Agent Governance': { folder: 'guides/agent-governance' },
    'Transform Requests and Responses': { page: 'guides/transform-requests-and-responses', ordered: true },
    'Timeouts and Resilience': { page: 'guides/timeouts-and-resilience', ordered: true },
    'Stream Responses': { page: 'guides/streaming-responses', ordered: true },
    'Logging and Tracing': { folder: 'guides/logging-and-tracing' },
    Analytics: { folder: 'guides/analytics' },
    'AI Workspace': { folder: 'guides/ai-workspace' },
    'Gateway Artifacts': { folder: 'guides/gateway-artifacts' },
    'Setup and Deployment': { folder: 'deploy-and-operate' },
    Reference: { folder: 'reference' },
    // 1.1.0's nav: its proxies, then the later folders under older labels
    // (its Observability uses the Cloud sub-section's entry below).
    'LLM Proxy': { folder: 'guides/llm-proxy' },
    'MCP Proxy': { folder: 'guides/mcp-proxy' },
    'Real-Time AI Streaming': { page: 'guides/streaming-responses', ordered: true },
    Deployment: { folder: 'deploy-and-operate' },
    Performance: { folder: 'deploy-and-operate/performance' },
    'About this release': { page: 'release-notes/about-this-release', ordered: true },
    // The Cloud sub-section (main line only).
    LLM: { folder: 'guides/llm' },
    MCP: { folder: 'guides/mcp' },
    Observability: { folder: 'guides/observability' },
  },
  sectionFolders: {},
  apiFolder: 'reference/apis',
  pageOverrides: {},
  types: {
    'get-started': 'quick-start',
    guides: 'how-to',
    concepts: 'concept',
    reference: 'reference',
    'deploy-and-operate': 'how-to',
    'release-notes': 'release-notes',
  },
  typeOverrides: { index: 'concept' },
  fragments: [],
  excluded: [],
  redirectToHome: [],
  placeholders: {},
  variables: {},
  properNouns: [
    ...apim.properNouns, 'AI Workspace', 'API Platform', 'MCP Hub', 'API Portal', 'OpenAI', 'Azure OpenAI', 'Azure AI Foundry',
    'AWS Bedrock', 'MistralAI', 'Claude Code', 'Gemini CLI', 'GitHub Copilot', 'OpenTelemetry', 'Moesif', 'A2A',
  ],
};
