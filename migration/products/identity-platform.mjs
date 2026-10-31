// Converter config for Identity Platform Cloud: the family-level Doc space in
// wso2/docs-identity-platform, directory identity-platform/ (Platform-by-
// platform walkthrough). Cloud only; Identity Server's main line
// (identity-server.mjs) is its Cloud part. It holds only family-level pages:
// the overview, built from the legacy Identity Platform home page in
// wso2/docs-is (lib/family.mjs). Convert identity-server's main line first.
import is from './identity-server.mjs';

export default {
  kind: 'family',
  slug: 'identity-platform',
  sourceRepo: 'wso2/docs-is',
  sourceRoot: 'en',
  overview: {
    // The MkDocs tree whose home page cards become the overview.
    tree: 'asgardeo',
    legacyBase: 'https://wso2.com/asgardeo/docs/',
    description: 'Identity Platform Cloud: sign-in, access and user management for your apps, delivered as a service by WSO2.',
    intro: 'Identity Platform Cloud is WSO2\'s identity and access management as a service. Each product\'s Cloud documentation is one part of it.',
  },
  // The Cloud parts, in the order the overview lists them; each must say
  // `cloud: { in: identity-platform }` in its own manifest.
  parts: [
    { docSpace: 'identity-server', title: 'Identity Server', description: 'single sign-on, multi-factor authentication, API authorization and user management for your apps.' },
  ],

  // The Doc space manifest (schemas/docspace.schema.json), written to
  // identity-platform/docspace.yaml.
  docspace: {
    schemaVersion: 1,
    slug: 'identity-platform',
    displayName: 'Identity Platform Cloud',
    formerNames: ['Asgardeo'],
    editionNames: { cloud: 'Identity Platform Cloud' },
    home: 'identity-platform',
    owners: { team: 'identity-platform-docs' },
    repo: 'wso2/docs-identity-platform',
    // Hidden during the Pilot: the Pilot repos are generated.
    editLinks: false,
    // During the Pilot, issues go to the legacy repo.
    issues: { repo: 'wso2/docs-is' },
    editions: [{ id: 'cloud', parts: ['identity-server'] }],
  },
  // editions.yaml: the Cloud variables, as its part uses them.
  editions: { cloud: is.editions.cloud },
  // The overview's sidebar icon: that of the legacy home, read as for its part.
  navIcons: is.navIcons,
};
