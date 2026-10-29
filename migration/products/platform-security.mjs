// Converter config for Platform Security (wso2/docs-security, MkDocs under
// en/, branch main → directory platform-security/, main only). An unversioned
// Doc space in the Other group (Product placement): the security processes,
// guidelines, advisories, CVE justifications, bulletins and reporting
// channels that apply across WSO2 products. It has one Edition, `_`, built
// from main; there are no release branches.
import { fileURLToPath } from 'node:url';
import apim from './api-manager.mjs';

const LEGACY = 'https://security.docs.wso2.com/en/latest/';

export default {
  slug: 'platform-security',
  sourceRepo: 'wso2/docs-security',
  sourceRoot: 'en', // mkdocs.yml lives here
  legacyBase: () => LEGACY,
  legacyHosts: ['security.docs.wso2.com'],
  // Fixes to the legacy source and accepted legacy-broken links (lib/overrides.mjs).
  overrides: fileURLToPath(new URL('./platform-security.overrides.yaml', import.meta.url)),
  redirectsPlugin: true, // the legacy redirects are mkdocs-redirects' redirect_maps

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // platform-security/docspace.yaml.
  docspace: {
    schemaVersion: 1,
    slug: 'platform-security',
    displayName: 'Platform Security',
    model: 'unversioned',
    // The Other group's Docs section (navigation.yaml: { id: other, in: other }),
    // named after its group as each family's section is.
    home: 'other',
    owners: { team: 'platform-security-docs' },
    repo: 'wso2/docs-security',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-security' },
  },
  // editions.yaml: an unversioned Doc space builds as Cloud (`_`), so only
  // the cloud: block is read; the pages use no {edition.*} variables.
  editions: {
    cloud: { displayName: 'Platform Security', productName: 'WSO2 Platform Security' },
  },

  // The legacy nav's top level re-filed into the sidebar skeleton. Every
  // section below keeps its structure and its source folder names.
  topLevel: {
    Home: { page: 'index' },
    'Security Processes': { folder: 'concepts/security-processes' },
    'Security Guidelines': { folder: 'guides/security-guidelines' },
    'Security Announcements': { folder: 'reference/security-announcements' },
    'Security Reporting': { folder: 'guides/security-reporting' },
  },
  sectionFolders: {},
  apiFolder: 'reference/apis',
  pageOverrides: {},
  skeleton: [
    { folder: 'guides', label: 'Guides' },
    { folder: 'concepts', label: 'Concepts' },
    { folder: 'reference', label: 'Reference' },
  ],
  types: {
    guides: 'how-to',
    concepts: 'concept',
    reference: 'reference',
  },
  typeOverrides: { index: 'concept' },

  // The legacy home page is drawn by its theme template (home-page.html) with
  // no Markdown of its own; these are its cards, as extra.home_page_cards
  // would give them (url: the nav path of the page each links).
  homeCards: [{
    section: [
      {
        title: 'Security processes',
        list_items: [
          { title: 'Secure software development', url: 'Security Processes|Secure Software Development Process' },
          { title: 'Vulnerability management', url: 'Security Processes|Vulnerability Management Process' },
          { title: 'Cloud security process', url: 'Security Processes|Cloud Security Process' },
          { title: 'SaaS incident notification', url: 'Security Processes|Security Incident Notification Process for SaaS' },
        ],
      },
      {
        title: 'Security guidelines',
        list_items: [
          { title: 'Secure coding guide', url: 'Security Guidelines|Secure Engineering Guidelines|Secure Coding Guidelines|Secure Coding Guide' },
          { title: 'OWASP Top 10 - 2025 prevention', url: 'Security Guidelines|Secure Engineering Guidelines|Secure Coding Guidelines|OWASP Top 10 - 2025 Prevention' },
          { title: 'Production deployment hardening', url: 'Security Guidelines|Security Guidelines for Production Deployment' },
        ],
      },
      {
        title: 'Security announcements',
        list_items: [
          { title: 'Security advisories', url: 'Security Announcements|WSO2 Security Advisories|' },
          { title: 'Third-party CVE analysis', url: 'Security Announcements|CVE Justifications|' },
          { title: 'Cloud security bulletins', url: 'Security Announcements|Cloud Security Bulletin|' },
          { title: 'Incident clarifications', url: 'Security Announcements|Incident Clarifications|' },
        ],
      },
      {
        title: 'Security reporting',
        list_items: [
          { title: 'Report security issues', url: 'Security Reporting|Report Security Issues' },
          { title: 'Vulnerability reporting guidelines', url: 'Security Reporting|Vulnerability Reporting Guidelines' },
          { title: 'Report abuse or malicious content', url: 'Security Reporting|Reporting Service Abuse or Malicious Content' },
          { title: 'Reward program', url: 'Security Reporting|Reward and Acknowledgement Program|Reward and Acknowledgement Program' },
          { title: 'Security Hall of Fame', url: 'Security Reporting|Reward and Acknowledgement Program|Security Hall of Fame' },
        ],
      },
    ],
  }],
  homeIntro: 'Security and compliance resources for WSO2 products and cloud services: secure engineering practices, deployment hardening, vulnerability management processes and public security advisories. Found a security issue? Report it privately through the WSO2 security reporting channel.',

  fragments: [],
  excluded: ['wip/', 'page-not-found.md'],
  redirectToHome: ['page-not-found.md'],
  placeholders: {},

  // mkdocs-markdownextradata with jinja_options {{# … #}}: {{#base_path#}}
  // is the only variable the pages use (lib/mkdocs.mjs reads the delimiters).
  variables: {
    base_path: { remove: true },
  },

  admonitions: apim.admonitions,
  languages: { ...apim.languages, tab: 'text', tsv: 'text', Javascript: 'javascript' },

  properNouns: [
    'WSO2', 'OWASP', 'CSRFGuard', 'FindSecurityBugs', 'ZAP', 'OWASP ZAP', 'Dependency Check', 'CVE', 'CVSS', 'SaaS', 'React',
    'API', 'HTTP', 'Hall of Fame', 'Identity Platform', 'API Platform', 'Choreo', 'Asgardeo', 'NPM', 'GitHub', 'Log4j', 'Log4j2',
    'Codecov', 'SolarWinds', 'SUNBURST', 'Axios', 'Shai-Hulud', 'UA-Parser-JS', 'Bluebird', 'Java', 'Go', 'H1', 'H2',
  ],
};
