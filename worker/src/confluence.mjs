// Old Confluence paths on docs.wso2.com (Old Confluence paths on docs.wso2.com,
// ticket 35): once WSO2 Docs owns the host, the Edge Worker answers them with
// the same 301s Cloudflare sends today. Content links to them stay as they
// are, and the staging crawl gate counts them as external links that pass when
// the Worker answers with one of these redirects (lib/crawl.mjs).
//
// THE TARGETS: the one place to change them, when WSO2 infra confirms who owns
// these rules today (Confirm docs hosting facts with WSO2 infra, question 7).
export const CONFLUENCE_TARGETS = {
  // /display/<SPACE>/... → the space overview in the Confluence archive.
  space: 'https://wso2docs.atlassian.net/wiki/spaces/{space}/overview',
  // /display/ with no space.
  noSpace: 'https://wso2docs.atlassian.net/wiki/spaces',
  // /pages/viewpage.action?... → the documentation hub, query kept.
  viewpage: 'https://wso2.com/documentation',
  // /download/attachments/... → the documentation hub.
  attachments: 'https://wso2.com/documentation',
};

// The 301 target for an old Confluence path, or null for any other path.
export function confluenceRedirect(pathname, search = '', targets = CONFLUENCE_TARGETS) {
  const display = /^\/display(?:\/([^/]*))?(?:\/.*)?$/.exec(pathname);
  if (display) return display[1] ? targets.space.replace('{space}', display[1]) : targets.noSpace;
  if (pathname === '/pages/viewpage.action') return `${targets.viewpage}${search}`;
  if (/^\/download\/attachments(?:\/|$)/.test(pathname)) return targets.attachments;
  return null;
}
