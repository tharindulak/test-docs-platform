// Converter config for Engineering Platform Cloud (wso2/docs-choreo-dev,
// branch PE, MkDocs under en/ → directory engineering-platform/, main only),
// formerly Choreo, second name WSO2 Developer Platform: the Engineering
// Platform's family Cloud (Product placement), Cloud only, with no Cloud
// parts. The source is two MkDocs sites of one product, one per console
// perspective: en/developer-docs (the Development View, served at the legacy
// base) and en/pe-docs (the Platform Operations View, at platform-engineer/).
// They become the Doc space's two audience groups (Extension points),
// developers/ ("For developers") and platform-engineers/ ("For platform
// engineers"), each with the skeleton inside (lib/sites.mjs), under one
// overview home. The 26 page paths both sites have stay one page per group:
// 15 of them differ by audience.
import { fileURLToPath } from 'node:url';
import apim from './api-manager.mjs';

const LEGACY = 'https://wso2.com/engineering-platform/developer-platform/docs/';

// One site's top-level nav sections re-filed into the skeleton inside its
// group (sectionFolders keys are nav paths: group label > section label).
const filed = (label, folder, table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [`${label} > ${k}`, `${folder}/${v}`]));
const DEV = 'For developers';
const PE = 'For platform engineers';
const SKELETON = [
  { folder: 'get-started', label: 'Get started', type: 'quick-start' },
  { folder: 'guides', label: 'Guides', type: 'how-to' },
  { folder: 'concepts', label: 'Concepts', type: 'concept' },
  { folder: 'reference', label: 'Reference', type: 'reference' },
];
const GROUPS = [{ folder: 'developers', label: DEV }, { folder: 'platform-engineers', label: PE }];

export default {
  // The Engineering Platform's family Cloud: Cloud only, on main, with pages of its own.
  kind: 'family',
  slug: 'engineering-platform',
  sourceRepo: 'wso2/docs-choreo-dev',
  sourceRoot: 'en',
  legacyBase: () => LEGACY,
  // Pages still link to the site's older address, wso2.com/choreo/docs/
  // (developer pages at its root, platform-engineer pages under
  // platform-engineer/): read as the same legacy site.
  legacyLinkBases: ['https://wso2.com/choreo/docs/'],
  legacyHosts: [],
  overrides: fileURLToPath(new URL('./engineering-platform.overrides.yaml', import.meta.url)),
  redirectsPlugin: true, // mkdocs-redirects' redirect_maps, in both sites

  // The two sites, one audience group each (lib/sites.mjs). legacyPath: the
  // site's place under the legacy base; legacyAliases: the perspective
  // switcher's other address for it.
  sites: [
    {
      root: 'developer-docs', folder: 'developers', label: DEV, legacyPath: '', legacyAliases: ['developer/'],
      homeIntro: 'Build, deploy, secure and observe components on the WSO2 Developer Platform.',
      // The legacy home (template home-page-2.html) hard-codes its cards;
      // these are those cards, linking the pages they linked.
      homeCards: [{
        section: [
          {
            title: 'Get started',
            list_items: [
              { title: 'What is WSO2 Developer Platform?', url: 'developers/what-is-choreo.md' },
              { title: 'Deploy your first service', url: 'developers/quick-start-guides/deploy-your-first-service.md' },
              { title: 'Deploy your first static web application', url: 'developers/quick-start-guides/deploy-your-first-static-web-application.md' },
              { title: 'Deploy a web application that consumes a backend service', url: 'developers/quick-start-guides/deploy-a-web-application-that-consumes-a-backend-service.md' },
              { title: 'Concepts', url: 'developers/choreo-concepts/resource-hierarchy.md' },
            ],
          },
          {
            title: 'Tutorials and samples',
            list_items: [
              { title: 'Expose a service as a managed API', url: 'developers/tutorials/expose-a-service-as-a-managed-api.md' },
              { title: 'Secure an API with role-based access control', url: 'developers/tutorials/secure-an-api-with-role-based-access-control.md' },
              { title: 'Quick deploy a sample', url: 'developers/choreo-samples/quick-deploy-a-sample.md' },
              { title: 'Explore the demo organization', url: 'developers/choreo-samples/explore-the-demo-organization.md' },
            ],
          },
          {
            title: 'Develop components',
            list_items: [
              { title: 'Develop a service', url: 'developers/develop-components/develop-services/develop-a-service.md' },
              { title: 'Develop a web application', url: 'developers/develop-components/develop-web-applications/build-and-deploy-a-single-page-web-application.md' },
              { title: 'Develop an API proxy', url: 'developers/develop-components/develop-proxy/develop-an-api-proxy-from-scratch.md' },
              { title: 'Develop a scheduled task', url: 'developers/develop-components/develop-integrations/develop-a-scheduled-task.md' },
              { title: 'Develop a manual task', url: 'developers/develop-components/develop-integrations/develop-a-manual-task.md' },
              { title: 'Develop an event handler', url: 'developers/develop-components/develop-integrations/develop-an-event-handler.md' },
            ],
          },
          {
            title: 'Developer tools',
            list_items: [
              { title: 'VS Code extension', url: 'https://marketplace.visualstudio.com/items?itemName=WSO2.choreo' },
              { title: 'WSO2 Developer Platform CLI', url: 'developers/choreo-cli/choreo-cli-overview.md' },
            ],
          },
          {
            title: 'Use the platform',
            list_items: [
              { title: 'DevOps and CI/CD', url: 'developers/choreo-concepts/ci-cd.md' },
              { title: 'Testing', url: 'developers/testing/test-rest-endpoints-via-the-openapi-console.md' },
              { title: 'Consuming services', url: 'developers/consuming-services/manage-application.md' },
              { title: 'Monitoring and insights', url: 'developers/monitoring-and-insights/observability-overview.md' },
              { title: 'Administer', url: 'developers/administer/configure-a-custom-domain-for-your-organization.md' },
              { title: 'Databases and caches', url: 'developers/manage-databases-and-caches/choreo-managed-databases-and-caches.md' },
              { title: 'Message brokers', url: 'developers/manage-message-brokers/choreo-managed-message-brokers.md' },
            ],
          },
        ],
      }],
    },
    {
      root: 'pe-docs', folder: 'platform-engineers', label: PE, legacyPath: 'platform-engineer/',
      homeIntro: 'Set up and run the WSO2 Developer Platform for your organization: infrastructure, DevOps, Kubernetes operations, governance and insights.',
      // The legacy home (template pe-home-page.html) hard-codes its cards.
      homeCards: [{
        section: [
          {
            title: 'About the platform',
            list_items: [
              { title: 'What is WSO2 Developer Platform?', url: 'platform-engineers/what-is-choreo.md' },
              { title: 'Concepts', url: 'platform-engineers/choreo-concepts/resource-hierarchy.md' },
            ],
          },
          {
            title: 'Infrastructure',
            list_items: [
              { title: 'Manage data planes', url: 'platform-engineers/infrastructure/dataplanes/data-planes.md' },
              { title: 'Manage environments', url: 'platform-engineers/infrastructure/environments/manage-environments.md' },
              { title: 'Configure a custom domain', url: 'platform-engineers/infrastructure/domains/configure-a-custom-domain-for-your-organization.md' },
            ],
          },
          {
            title: 'Observability and insights',
            list_items: [
              { title: 'Delivery insights', url: 'platform-engineers/insights/delivery-insights/configure-delivery-insights.md' },
              { title: 'Configure alerts', url: 'platform-engineers/observability/alerts/configure-alerts.md' },
              { title: 'Cost analysis', url: 'platform-engineers/insights/cost-optimization.md' },
            ],
          },
          {
            title: 'DevOps',
            list_items: [
              { title: 'Automation pipelines', url: 'platform-engineers/devops/automation-pipelines/introduction.md' },
              { title: 'CI pipelines', url: 'platform-engineers/devops/ci-pipelines/configure-ci-pipeline.md' },
              { title: 'CD pipelines', url: 'platform-engineers/devops/cd-pipelines/manage-continuous-deployment-pipelines.md' },
              { title: 'Configuration groups', url: 'platform-engineers/devops/manage-configuration-groups.md' },
            ],
          },
          {
            title: 'Kubernetes operations',
            list_items: [
              { title: 'View runtime details', url: 'platform-engineers/k8s-operations/runtime/view-runtime-details.md' },
              { title: 'Configure container resources', url: 'platform-engineers/k8s-operations/containers/configure-container-resources-commands-and-arguments.md' },
              { title: 'Manage configurations and secrets', url: 'platform-engineers/k8s-operations/manage-configurations-and-secrets.md' },
              { title: 'Set up health checks', url: 'platform-engineers/k8s-operations/set-up-health-checks.md' },
              { title: 'Autoscale component replicas', url: 'platform-engineers/k8s-operations/scaling/autoscale-component-replicas.md' },
              { title: 'Autoscale components with scale-to-zero', url: 'platform-engineers/k8s-operations/scaling/autoscale-components-with-scale-to-zero.md' },
              { title: 'Configure storage', url: 'platform-engineers/k8s-operations/storage/configure-storage.md' },
            ],
          },
          {
            title: 'User management and governance',
            list_items: [
              { title: 'Manage members of an organization', url: 'platform-engineers/user-management/users/manage-members-of-an-organization.md' },
              { title: 'Control access', url: 'platform-engineers/choreo-concepts/access-control.md' },
              { title: 'Configure approvals', url: 'platform-engineers/governance/workflows/configure-approvals-for-choreo-workflows.md' },
              { title: 'Control egress traffic', url: 'platform-engineers/governance/egress-control/control-egress-traffic-for-your-organization.md' },
            ],
          },
          {
            title: 'Databases and services',
            list_items: [
              { title: 'Databases', url: 'platform-engineers/db-and-services/databases/choreo-managed-databases-and-caches.md' },
              { title: 'Message brokers', url: 'platform-engineers/db-and-services/message-brokers/choreo-managed-message-brokers.md' },
              { title: 'Third-party services', url: 'platform-engineers/db-and-services/external-services/integrate-and-manage-third-party-services.md' },
              { title: 'Gen AI services', url: 'platform-engineers/db-and-services/ai-gateway/integrate-and-manage-gen-ai-services.md' },
            ],
          },
        ],
      }],
    },
  ],

  docspace: {
    schemaVersion: 1,
    slug: 'engineering-platform',
    displayName: 'Engineering Platform Cloud',
    formerNames: ['Choreo'],
    brand: 'WSO2 Developer Platform',
    editionNames: { cloud: 'Engineering Platform Cloud' },
    home: 'engineering-platform',
    owners: { team: 'engineering-platform-docs' },
    repo: 'wso2/docs-choreo-dev',
    audienceGroups: GROUPS.map((g) => g.folder),
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-choreo-dev' },
    editions: [{ id: 'cloud' }],
  },
  // editions.yaml: the pages' {{ product_name }} and {{ cli_root_name }}.
  editions: {
    cloud: { displayName: 'Engineering Platform Cloud', productName: 'WSO2 Developer Platform', cliRootName: 'wdp' },
  },
  variables: {
    product_name: { edition: 'productName' },
    cli_root_name: { edition: 'cliRootName' },
  },

  // The combined nav (lib/sites.mjs): the home, then one section per site.
  topLevel: {
    Home: { page: 'index' },
    [DEV]: { folder: 'developers' },
    [PE]: { folder: 'platform-engineers' },
  },
  sectionFolders: {
    ...filed(DEV, 'developers', {
      Introduction: 'get-started',
      'Quick Start Guides': 'get-started/quick-start-guides',
      'WSO2 Developer Platform Samples': 'get-started/samples',
      Tutorials: 'guides/tutorials',
      'WSO2 Developer Platform Concepts': 'concepts',
      'Develop Components': 'guides/develop-components',
      'Integrate and Manage External Services': 'guides/integrate-and-manage-external-services',
      'WSO2 Developer Platform-Managed Databases and Caches': 'guides/manage-databases-and-caches',
      'WSO2 Developer Platform-Managed Message Brokers': 'guides/manage-message-brokers',
      'Authentication and Authorization': 'guides/authentication-and-authorization',
      'DevOps and CI/CD': 'guides/devops-and-ci-cd',
      Testing: 'guides/testing',
      'Consuming Services': 'guides/consuming-services',
      'API Management': 'guides/api-management',
      'Monitoring and Insights': 'guides/monitoring-and-insights',
      'WSO2 Developer Platform CLI': 'reference/cli',
      Administer: 'guides/administer',
      References: 'reference',
    }),
    ...filed(PE, 'platform-engineers', {
      Introduction: 'get-started',
      'WSO2 Developer Platform Concepts': 'concepts',
      Infrastructure: 'guides/infrastructure',
      'User Management': 'guides/user-management',
      DevOps: 'guides/devops',
      Governance: 'guides/governance',
      'DB & Services': 'guides/db-and-services',
      'K8s Operations': 'guides/k8s-operations',
      Insights: 'guides/insights',
      Observability: 'guides/observability',
      'API Management': 'guides/api-management',
      'WSO2 Developer Platform CLI': 'reference/cli',
      References: 'reference',
    }),
  },
  // Each site's home is its group's home.
  pageOverrides: {
    'developers/index.md': 'developers/index',
    'platform-engineers/index.md': 'platform-engineers/index',
  },
  // A page in no nav and outside the nav's folders goes into the skeleton.
  unlistedTargets: {
    'developers/resources/kubernetes-upgrade-notice.md': 'developers/reference/kubernetes-upgrade-notice',
  },
  apiFolder: 'developers/reference/apis',
  unlistedFolder: 'developers/reference',
  // The groups, then the skeleton inside each (positions within the parent).
  skeleton: GROUPS.flatMap((g, gi) => [
    { folder: g.folder, label: g.label, position: gi + 1 },
    ...SKELETON.map((s, i) => ({ folder: `${g.folder}/${s.folder}`, label: s.label, position: i + 1 })),
  ]),
  types: Object.fromEntries(GROUPS.flatMap((g) => SKELETON.map((s) => [`${g.folder}/${s.folder}`, s.type]))),
  typeOverrides: { index: 'concept', 'developers/index': 'concept', 'platform-engineers/index': 'concept' },

  // The Doc space home: the two groups, with each one's main entry points.
  homeIntro: 'WSO2 Developer Platform, formerly Choreo, is an AI-native internal developer platform for building, deploying and running cloud-native applications. Choose your role.',
  homeCards: [{
    section: [
      {
        title: DEV,
        list_items: [
          { title: 'Developer documentation home', url: 'developers/index.md' },
          { title: 'Deploy your first service', url: 'developers/quick-start-guides/deploy-your-first-service.md' },
          { title: 'Develop components', url: 'developers/develop-components/develop-services/develop-a-service.md' },
          { title: 'DevOps and CI/CD', url: 'developers/choreo-concepts/ci-cd.md' },
        ],
      },
      {
        title: PE,
        list_items: [
          { title: 'Platform engineer documentation home', url: 'platform-engineers/index.md' },
          { title: 'Manage data planes', url: 'platform-engineers/infrastructure/dataplanes/data-planes.md' },
          { title: 'Automation pipelines', url: 'platform-engineers/devops/automation-pipelines/introduction.md' },
          { title: 'Kubernetes operations', url: 'platform-engineers/k8s-operations/runtime/view-runtime-details.md' },
        ],
      },
    ],
  }],

  fragments: [],
  excluded: ['developers/page-not-found.md', 'platform-engineers/page-not-found.md', 'platform-engineers/overview.md'],
  redirectToHome: ['developers/page-not-found.md', 'platform-engineers/page-not-found.md'],
  placeholders: {},

  admonitions: { ...apim.admonitions, notes: 'note' },
  languages: { ...apim.languages, h: 'text', SQL: 'sql', proto: 'protobuf', csv: 'text', ballerina: 'text' },

  properNouns: [
    ...apim.properNouns, 'WSO2 Developer Platform', 'Developer Platform', 'Engineering Platform', 'Asgardeo', 'GitHub', 'GitLab',
    'Bitbucket', 'Azure DevOps', 'PostgreSQL', 'MySQL', 'Kafka', 'GraphQL', 'WebSocket', 'OpenAPI', 'cURL', 'VS Code', 'CLI',
    'CI/CD', 'CI', 'CD', 'DORA', 'MCP', 'VPN', 'VPNs', 'IdP', 'API', 'APIs', 'OAuth2', 'TLS', 'DB', 'K8s', 'Gen AI', 'AI', 'Moesif',
    'Micro Integrator', 'Buildpacks', 'Test Runner', 'API Chat', 'Marketplace',
  ],
};
