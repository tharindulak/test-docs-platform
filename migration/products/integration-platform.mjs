// Converter config for Integration Platform Cloud: the family-level Doc space
// in wso2/docs-integrator, directory integration-platform/ (Platform-by-
// platform walkthrough; second name WSO2 Cloud, formerly Devant). Cloud only;
// Integrator's main line (integrator.mjs, from the `saas` branch) is its Cloud
// part. It holds only the family overview (lib/family.mjs): the legacy site
// is Docusaurus and has no family home page to read cards from, so the
// overview is the intro and one product card per part, as Agent Platform
// Cloud's. Convert integrator's main line first.
//
// Product placement also names Connectors as a Cloud part, but Connectors is
// unversioned, and an unversioned Doc space's main line is its one Edition
// (lib/content-repo.mjs): it cannot also be a Cloud part. Until that is
// decided (spec/open-items.md), Connectors is its own unversioned Doc space.
export default {
  kind: 'family',
  slug: 'integration-platform',
  sourceRepo: 'wso2/docs-integrator',
  sourceRoot: 'en',
  overview: {
    // No `tree`: no legacy home page cards (a Docusaurus source).
    legacyBase: 'https://wso2.com/integration-platform/docs/saas/',
    description: 'Integration Platform Cloud: build, deploy and manage integrations, AI agents and APIs, delivered as a service by WSO2.',
    intro: 'Integration Platform Cloud is WSO2\'s integration platform as a service: build integrations, AI agents and APIs with WSO2 Integrator, then deploy, run and observe them in WSO2 Cloud. Each product\'s Cloud documentation is one part of it.',
  },
  // The Cloud parts, in the order the overview lists them; each must say
  // `cloud: { in: integration-platform }` in its own manifest.
  parts: [
    { docSpace: 'integrator', title: 'Integrator', description: 'build, test, deploy and observe integrations, AI agents and APIs in WSO2 Cloud.' },
  ],

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // integration-platform/docspace.yaml.
  docspace: {
    schemaVersion: 1,
    slug: 'integration-platform',
    displayName: 'Integration Platform Cloud',
    formerNames: ['Devant'],
    brand: 'WSO2 Cloud',
    editionNames: { cloud: 'Integration Platform Cloud' },
    home: 'integration-platform',
    owners: { team: 'integration-platform-docs' },
    repo: 'wso2/docs-integrator',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    issues: { repo: 'wso2/docs-integrator' },
    editions: [{ id: 'cloud', parts: ['integrator'] }],
  },
  // editions.yaml: the Cloud variables.
  editions: {
    cloud: { displayName: 'Integration Platform Cloud', productName: 'WSO2 Integration Platform' },
  },
};
