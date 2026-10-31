// Converter config for Identity Server: wso2/docs-is (the Identity Platform
// tree en/asgardeo/ and the Identity Server version trees
// en/identity-server/<version>/, both built from the shared en/includes/)
// → wso2/docs-identity-platform, directory identity-server/. Its main line is
// the Cloud content with Edition markers: Identity Server's Cloud part of
// Identity Platform Cloud (identity-platform.mjs, the family-level Doc space
// in the same repo). Its release branches, identity-server/release/<version>,
// are copies of main resolved per version (Platform-by-platform walkthrough).
// Everything specific to docs-is lives here; the rules in ../lib are shared
// by every MkDocs product.
import { fileURLToPath } from 'node:url';
import apim from './api-manager.mjs';

const L = { literal: true };

// Version branches of the Content repo and the docs-is trees they come from.
// On main, Cloud is published and the self-hosted side is IS `next`; a
// virtual 7.3.0 context tells content that is new after 7.3.0 apart, so it
// gets selfHostedFrom="next" (Migration approach, decision 6).
const IS_LATEST = '7.3.0';

const cloudTree = {
  id: 'cloud',
  root: 'asgardeo',
  legacyBases: ['https://wso2.com/asgardeo/docs/', 'https://wso2.com/identity-platform/docs/'],
  features: 'asgardeo/features.json',
};
const isTree = (version) => ({
  id: version,
  root: `identity-server/${version}`,
  legacyBases: [`https://is.docs.wso2.com/en/${version}/`],
  // IS reads the Identity Platform feature flags but turns every one on.
  features: 'asgardeo/features.json',
  allFeaturesOn: true,
});

export default {
  ...apim,
  slug: 'identity-server',
  sourceRepo: 'wso2/docs-is',
  sourceRoot: 'en',
  jinja: true,
  legacyHosts: ['is.docs.wso2.com', 'wso2.com'],
  overrides: fileURLToPath(new URL('./identity-server.overrides.yaml', import.meta.url)),
  tabsGroupId: 'tabs',
  admonitions: { ...apim.admonitions, waening: 'warning', infox: 'info', connectors: 'note' },
  languages: {
    ...apim.languages, angular2html: 'markup', apache: 'text', 'c#': 'csharp', config: 'text', csv: 'text', env: 'bash',
    gradle: 'groovy', saml: 'xml', ts: 'typescript', vue: 'markup',
  },
  // API folders: organization APIs get their own names (the same API exists
  // for the root organization).
  apiSlug: (src) => {
    const base = src.slice(src.lastIndexOf('/') + 1).replace(/\.md$/, '');
    return src.startsWith('apis/organization-apis/') && !base.startsWith('org') ? `org-${base}` : base;
  },

  // The source trees of one Content repo branch and the Edition contexts
  // every page is rendered in. `built` contexts are the Editions the
  // branch's markers must be exact for (Cloud stays marked on version
  // branches, so they stay copies of main); a virtual context only decides
  // between "Self-hosted only" and "Self-hosted from next".
  trees(edition) {
    if (edition === 'cloud') return [cloudTree, { ...isTree('next'), legacyBases: ['https://is.docs.wso2.com/en/next/'] }];
    return [cloudTree, isTree(edition)];
  },
  contexts(edition) {
    const cloud = { id: 'cloud', tree: 'cloud', edition: { id: 'cloud', kind: 'cloud', version: null }, built: true };
    if (edition === 'cloud') {
      return [
        cloud,
        { id: 'next', tree: 'next', edition: { id: 'next', kind: 'self-hosted', version: null }, built: true },
        {
          id: IS_LATEST, tree: 'next', edition: { id: IS_LATEST, kind: 'self-hosted', version: IS_LATEST }, built: false,
          globals: { is_version: IS_LATEST }, pagesFrom: `identity-server/${IS_LATEST}`,
        },
      ];
    }
    return [cloud, { id: edition, tree: edition, edition: { id: edition, kind: 'self-hosted', version: edition }, built: true }];
  },
  // The tree whose files, folders and URLs the Content repo is laid out by
  // (on every branch, so branches stay copies of main), and the tree whose
  // nav gives sidebar order and labels and whose legacy URLs the branch's
  // redirect map covers.
  layoutTree: 'cloud',
  homeTree: (edition) => (edition === 'cloud' ? 'cloud' : edition),

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // identity-server/docspace.yaml on every branch.
  docspace: {
    schemaVersion: 1,
    slug: 'identity-server',
    displayName: 'Identity Server',
    editionNames: { selfHosted: 'Identity Server {version}' },
    home: 'identity-platform',
    cloud: { in: 'identity-platform' },
    owners: { team: 'identity-platform-docs' },
    repo: 'wso2/docs-identity-platform',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    // During the Pilot, issues go to the legacy repo.
    issues: { repo: 'wso2/docs-is' },
    editions: [{ id: '7.3.0' }, { id: '7.2.0', branch: 'identity-server/release/7.2.0' }, { id: '7.1.0', branch: 'identity-server/release/7.1.0' }],
    legacyVersions: [
      { id: '7.0.0', url: 'https://is.docs.wso2.com/en/7.0.0/' },
      { id: '6.1.0', url: 'https://is.docs.wso2.com/en/6.1.0/' },
      { id: '6.0.0', url: 'https://is.docs.wso2.com/en/6.0.0/' },
    ],
  },
  // editions.yaml. Every {edition.*} variable is defined in both blocks: the
  // Edition filter reads variables inside blocks it then drops.
  editions: {
    cloud: {
      displayName: 'Identity Platform Cloud',
      productName: 'WSO2 Identity Platform',
      productUrlFormat: 'https://api.asgardeo.io/t/{organization_name}',
      productUrlSample: 'https://api.asgardeo.io/t/bifrost',
      productUrl: 'https://api.asgardeo.io/t/{organization_name}',
      hostName: 'api.asgardeo.io',
      sdkBaseUrl: 'https://api.asgardeo.io/t/<your-organization-name>',
      consoleUrl: 'https://console.asgardeo.io/t/{organization_name}',
      apiBaseUrl: 'https://api.asgardeo.io/t/{organization_name}',
    },
    'self-hosted': {
      displayName: 'Identity Server {version}',
      productName: 'WSO2 Identity Server',
      productUrlFormat: 'https://localhost:9443',
      productUrlSample: 'https://localhost:9443',
      productUrl: 'https://localhost:9443',
      hostName: 'localhost:9443',
      sdkBaseUrl: 'https://localhost:9443',
      consoleUrl: 'https://localhost:9443/console',
      apiBaseUrl: 'https://localhost:9443',
    },
  },

  // The old navs' top level, re-filed into the sidebar skeleton. Both trees'
  // labels are listed; everything below keeps its old structure.
  topLevel: {
    Home: { folder: '' },
    'Get started': { folder: 'get-started' },
    Guides: { folder: 'guides' },
    Tutorials: { folder: 'get-started/tutorials' },
    Setup: { folder: 'deploy-and-operate' },
    SDKs: { folder: 'reference/sdks' },
    'SDK Documentation': { folder: 'reference/sdk-documentation' },
    'WSO2 Identity Platform MCP Server': { page: 'reference/sdks/identity-platform-mcp-server' },
    Connectors: { folder: 'guides/connectors' },
    APIs: { folder: 'reference/apis' },
    References: { folder: 'reference' },
    'Technology Guides': { folder: 'guides/technology-guides' },
    'Best Practice Guides': { folder: 'guides/best-practice-guides' },
  },
  sectionFolders: {},
  // Sidebar icons from base.yml's extra.nav_icons, as the theme's
  // en/theme/material/partials/nav-item.html draws them: by nav title and
  // level, but never on an "Overview" page of a connector or of organization
  // management. Its own SVGs in assets/libs/custom-icons/ are wso2/<name>.
  navIcons: {
    customIcons: 'assets/libs/custom-icons/',
    skip: ({ title, url }) => title === 'Overview' && (String(url).includes('connectors') || String(url).includes('organization-management')),
  },
  apiFolder: 'reference/apis',
  pageOverrides: {
    'get-started/about-this-release.md': 'release-notes/about-this-release',
  },
  types: {
    'get-started': 'quick-start',
    'get-started/tutorials': 'tutorial',
    guides: 'how-to',
    concepts: 'concept',
    reference: 'reference',
    'deploy-and-operate': 'how-to',
    'release-notes': 'release-notes',
  },
  typeOverrides: { index: 'concept' },

  fragments: ['fragments/', 'includes/'],
  excluded: ['page-not-found.md'],
  redirectToHome: ['page-not-found.md'],
  placeholders: {
    'references/configuration-catalog.md': {
      reason: 'generated from docs/_data/configuration_catalog.yaml by a theme template; becomes a data-driven Platform component later',
    },
  },
  // Page templates (front matter `template:`) → Platform page layouts
  // (Migration approach, decision 10). Folders holding complete-guide pages
  // are exported as one file each (AI/LLM-friendly docs, decision 5).
  layouts: {
    'templates/complete-guide.html': 'complete-guide',
    'templates/sdk.html': 'sdk',
    // The front-matter standard's layouts: complete-guide, sdk, connector.
    'templates/quick-start.html': null,
    'templates/connector.html': 'connector',
    // The connectors catalog: the catalog layout over connectors.yaml, written
    // from mkdocs.yml's extra.connectors (catalogs, below).
    'templates/connectors.html': 'catalog',
    'templates/integrations.html': null,
    'templates/sdks.html': null,
    'templates/tutorial.html': null,
    'templates/no-right-sidebar.html': { hide_table_of_contents: true },
    'templates/no-navbars.html': { hide_table_of_contents: true },
    'templates/home-page.html': null,
    'templates/config-catalog.html': null,
  },
  exportSingleLayout: 'complete-guide',
  // The legacy home template's welcome line, above its cards (the overview layout).
  homeIntro: 'Welcome to {edition.productName} documentation! Within these pages, you will learn how to build a seamless login experience for your applications using {edition.productName}.',
  // Theme templates that drew a grid from mkdocs.yml data become the catalog
  // layout over a data file next to the page (Extension points for product
  // teams: generated upstream, committed as data, checked by its schema).
  catalogs: {
    'templates/connectors.html': {
      from: 'connectors',
      file: 'connectors.yaml',
      intro: 'This page lists the available connectors for {edition.productName} {edition.version}.',
      // documentation_link: a folder under connectors/ (its overview page), or a URL.
      docSource: (link) => `connectors/${link.replace(/^\/+|\/+$/g, '')}/overview.md`,
      sourceLabel: 'Connector store',
    },
  },

  // The Jinja lookup table (Migration approach, decision 3). Every condition
  // in the shared content, exactly as written (whitespace aside); an unknown
  // one fails the run. Conditions are evaluated per Edition context: product
  // ones become Edition markers, version ones are resolved per branch.
  conditions: [
    '(is_version is defined and is_version > "7.1.0") or product_name == "WSO2 Identity Platform"',
    '(product_name == "WSO2 Identity Server" and is_version != "7.0.0") or product_name == "WSO2 Identity Platform"',
    '(product_name == "WSO2 Identity Server" and is_version <= "7.1.0" )',
    '(product_name == "WSO2 Identity Server" and is_version == "7.0.0")',
    '(product_name == "WSO2 Identity Server" and is_version > "7.1.0" )',
    '(product_name == "WSO2 Identity Server" and is_version > "7.1.0")',
    '(product_name == "WSO2 Identity Server" and is_version > "7.2.0" )',
    '(product_name == "WSO2 Identity Server" and is_version > "7.2.0") or product_name == "WSO2 Identity Platform"',
    '(product_name == "WSO2 Identity Server" and is_version > "7.3.0") or product_name == "WSO2 Identity Platform"',
    '(product_name == "WSO2 Identity Server")',
    'attribute_uniqueness_validation',
    'custom_header_min_version is defined',
    'default_roles',
    'immutable_claims_note',
    'is_version != "7.0.0"',
    'is_version != "7.1.0"',
    'is_version != "next" and product != "asgardeo"',
    'is_version <= "7.2.0"',
    'is_version == "7.0.0"',
    'is_version == "7.1.0"',
    'is_version == "7.1.0" or is_version == "7.2.0"',
    'is_version == "7.1.0" or is_version == "next"',
    'is_version == "7.1.0" or is_version == "next" or product_name == "WSO2 Identity Platform"',
    'is_version == "7.2.0"',
    'is_version == "7.3.0" or is_version == "next" or product == "asgardeo"',
    'is_version == "next" or product == "asgardeo"',
    'is_version == "next" or product_name == "WSO2 Identity Platform"',
    'is_version > "7.1.0"',
    'is_version > "7.2.0"',
    'is_version > "7.3.0"',
    'is_version >= "7.1.0"',
    'is_version >= "7.3.0"',
    'is_version in ["7.0.0", "7.1.0", "7.2.0"]',
    'is_version is defined',
    'is_version is defined and is_version == "7.1.0"',
    'is_version is defined and is_version == "7.2.0"',
    'is_version is defined and is_version >= "7.1.0"',
    'is_version not in ["7.0.0", "7.1.0", "7.2.0"]',
    'manageNotificationsInternallyPropertySupportedUpdateLevel',
    'multi_valued_attributes',
    'multiple_client_secrets_enabled',
    'not (product_name == "WSO2 Identity Server" and is_version <= "7.2.0")',
    'not is_version == "7.0.0"',
    'not is_version == "7.1.0"',
    'organization_search_content',
    'password_expiry_time',
    'product == "asgardeo"',
    'product=="is"',
    'product_name != "Asgardeo"',
    'product_name != "WSO2 Identity Platform"',
    'product_name != "WSO2 Identity Platform" and (product_name == "WSO2 Identity Server" and is_version > "7.1.0")',
    'product_name != "WSO2 Identity Platform" and server_version >= "7.0" and server_version < "7.3"',
    'product_name != "WSO2 Identity Server" or is_version != "7.2.0"',
    'product_name == "Asgardeo"',
    'product_name == "WSO2 Identity Platform"',
    'product_name == "WSO2 Identity Platform" and default_roles == true',
    'product_name == "WSO2 Identity Platform" or (is_version is defined and is_version >= "7.3.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version != "7.0.0" )',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version != "7.0.0" and is_version != "7.1.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version != "7.0.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version == "7.0.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version == "7.1.0" )',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version > "7.0.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version > "7.1")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version > "7.1.0" )',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version > "7.1.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version > "7.2.0" )',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version > "7.2.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version > "7.3.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version >= "7.1.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version >= "7.2.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version >= "7.4.0")',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version not in ["7.0.0", "7.1.0", "7.2.0", "7.3.0"])',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version not in ["7.0.0", "7.1.0", "7.2.0"])',
    'product_name == "WSO2 Identity Platform" or (product_name == "WSO2 Identity Server" and is_version not in ["7.0.0", "7.1.0"])',
    'product_name == "WSO2 Identity Platform" or is_version > "7.2.0"',
    'product_name == "WSO2 Identity Platform" or is_version >= "7.0.0"',
    'product_name == "WSO2 Identity Platform" or server_version >= "7.1"',
    'product_name == "WSO2 Identity Platform" or server_version >= "7.2"',
    'product_name == "WSO2 Identity Platform" or server_version >= "7.3"',
    'product_name == "WSO2 Identity Server "',
    'product_name == "WSO2 Identity Server"',
    'product_name == "WSO2 Identity Server" and "is_version" == "7.0.0"',
    'product_name == "WSO2 Identity Server" and (is_version == "7.0.0" or is_version == "7.1.0" or is_version == "7.2.0")',
    'product_name == "WSO2 Identity Server" and (is_version == "7.0.0" or is_version == "7.1.0")',
    'product_name == "WSO2 Identity Server" and hide_legacy_sync_config != "true"',
    'product_name == "WSO2 Identity Server" and is_version != "7.0.0"',
    'product_name == "WSO2 Identity Server" and is_version < "7.1.0"',
    'product_name == "WSO2 Identity Server" and is_version <= "7.1.0"',
    'product_name == "WSO2 Identity Server" and is_version == "7.0.0"',
    'product_name == "WSO2 Identity Server" and is_version == "7.1.0"',
    'product_name == "WSO2 Identity Server" and is_version == "7.2.0"',
    'product_name == "WSO2 Identity Server" and is_version == "7.3.0"',
    'product_name == "WSO2 Identity Server" and is_version > "7.1.0"',
    'product_name == "WSO2 Identity Server" and is_version > "7.2.0"',
    'product_name == "WSO2 Identity Server" and is_version > "7.3.0"',
    'product_name == "WSO2 Identity Server" and is_version >= "7.2.0"',
    'product_name == "WSO2 Identity Server" and is_version >= "7.3.0"',
    'product_name == "WSO2 Identity Server" and is_version in ["7.1.0", "7.2.0"]',
    'product_name == "WSO2 Identity Server" and is_version not in ["7.0.0", "7.1.0", "7.2.0", "7.3.0"]',
    'product_name == "WSO2 Identity Server" and is_version not in ["7.0.0", "7.1.0", "7.2.0"]',
    'product_name == "WSO2 Identity Server" or (product_name == "WSO2 Identity Platform" and sso_integrations_zoom_slack)',
    `product_name == 'WSO2 Identity Platform'`,
    `product_name == 'WSO2 Identity Platform' or is_version >= "7.2.0"`,
    `product_name == 'WSO2 Identity Platform' or is_version not in ["7.0.0", "7.1.0", "7.2.0"]`,
    'product_name=="WSO2 Identity Platform"',
    'server_version == "7.0"',
    'show_advanced_account_linking_content == "true"',
    'sift_fraud_detection and product_name == "WSO2 Identity Platform"',
  ],
  // Every name a page prints or reads. `edition` names become {edition.*}
  // where the page's value is the Edition's (editions.yaml); `literal` names
  // are resolved per context (and marked where the contexts differ);
  // base_path is removed by the link rules. An unknown name fails the run.
  variables: {
    base_path: { remove: true },
    product_name: { edition: 'productName' },
    product_url_format: { edition: 'productUrlFormat' },
    product_url_sample: { edition: 'productUrlSample' },
    product_url: { edition: 'productUrl' },
    host_name: { edition: 'hostName' },
    'content.sdkconfig.baseUrl': { edition: 'sdkBaseUrl' },
    is_version: { edition: 'version' },
    CACERTS_PASSWORD: L, CERT_ALIAS: L, CERT_NAME: L, KEYSTORE_PASSWORD: L, PATH_TO_CACERTS_KEYSTORE: L,
    PATH_TO_KEYSTORE: L, PEM_CERT_NAME: L, PEM_CERT_PATH: L, admin_login_note: L, admin_role_name: L,
    admin_user_details: L, api_authentication_path: L, api_base_path: L, api_example_base_path: L,
    api_oauth2_path: L, api_path: L, asgardeo_auth_script_warning: L, asgardeo_help: L, attribute_path: L,
    authn_path: L, backup_codes_api: L, baseUrl: L, base_url: L, base_url_example: L, base_url_sample: L,
    check_status_endpoint: L, configure_email_sender: L, configure_subject_identifier: L, console_app_path: L,
    console_host_name: L, console_hostname: L, console_path: L, console_url: L,
    'content.application_management_api_path': L, 'content.default_keystore_ext': L,
    'content.default_keystore_type': L, 'content.identity_apps_core_release_url': L,
    'content.oid4vci_reference_path': L, 'content.org_resources_created': L, 'content.org_resources_inherited': L,
    'content.org_resources_shared': L, country: L, custom_header_min_version: L, customize_email_settings: L,
    default_keystore_ext: L, default_userstore: L, disable_cross_browser_support: L, disable_jarm: L,
    email_template_note: L, email_templates_api_path: L, entityID: L, export_user_prof: L, givenName: L,
    grant_type_configs_note: L, host_name_example: L, host_url: L, hypr_login: L, immutable_claims_note: L,
    introspection: L, iss_path: L, issuer_name: L, keyName: L, lang: L, link_to_tutotials: L, locale: L,
    localhost_warning_note: L, localization_doc_path: L,
    manageNotificationsInternallyPropertySupportedUpdateLevel: L, manage_consent: L, multiple_client_secrets: L,
    my_account_host_path: L, my_account_link: L, my_account_org_link: L, my_account_url_note: L, myacc_doc_url: L,
    myaccount_path: L, no_of_supported_app_types: L, notification_templates_api_path: L, org_name: L,
    organization_name: L, organization_path_param: L, organization_search_content: L, par_endpoint: L,
    password_grant_show_auth_failure_reason_note: L, patch_me_path: L, path: L, powered_by_note: L, product: L,
    product_domain: L, push_mfa_doc_path: L, redoc_theme: L, resource_management_in_multiple_root_orgs: L,
    root_org_description_path: L, root_org_owner_characteristic: L, root_org_url: L,
    root_organization_creation_flow: L, root_organization_name: L, root_organization_path: L,
    root_organization_path_param: L, scim2_api_path: L, scim_list_user: L, scim_schema_for_wso2_custom_claims: L,
    scim_update_pass: L, scim_update_user_prof: L, server_url: L, server_version: L, session_control_scenario_id: L,
    support_platforms: L, technology: L, technology_quickstart: L, tenant_domain: L, token_endpoint: L,
    token_request: L, totp_api: L, user_details: L, user_store_domain: L, username: L, userstore_domain: L,
    userstore_name: L, wso2_is_console_access_note: L,
    // Feature flags (features.json) and names only conditions read.
    attribute_uniqueness_validation: L, default_roles: L, multi_valued_attributes: L, sift_fraud_detection: L,
    sso_integrations_zoom_slack: L, password_expiry_time: L, multiple_client_secrets: L,
    multiple_client_secrets_enabled: L, show_advanced_account_linking_content: L, hide_legacy_sync_config: L,
    jdk_version_message: L, base_url_format: L, email_sending_module: L, notification_tab_name: L, custom_schema_note: L,
  },

  properNouns: [
    ...apim.properNouns,
    'WSO2 Identity Platform', 'WSO2 Identity Server', 'Identity Platform', 'Identity Server', 'Asgardeo', 'Console',
    'My Account', 'OpenID Connect', 'OIDC', 'SAML', 'SCIM', 'React', 'Next.js', 'Angular', 'Vue', 'Nuxt', 'Express.js',
    'Spring Boot', 'Flutter', 'Android', 'iOS', 'JavaScript', 'Javascript', '.NET', 'Node.js', 'Apple', 'Facebook',
    'GitHub', 'LinkedIn', 'Hypr', 'HYPR', 'Duo', 'Onfido', 'Sift', 'Choreo', 'MATTR', 'Microsoft Entra', 'Entra',
    'FIDO', 'Passkey', 'TOTP', 'MCP', 'n8n', 'Kong', 'Claude', 'FHIR', 'Smart on FHIR', 'Moesif', 'Firebase',
  ],
  apiAreas: {},
  apiAreaByPath: [
    ['apis/organization-apis/', 'Organization'],
    ['apis/end-user-apis/', 'End user'],
    ['apis/system-apis/', 'System'],
    ['apis/', 'Management'],
  ],
};
