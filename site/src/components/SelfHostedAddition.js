// A Self-hosted addition shown in Cloud (Content per Edition): Self-hosted-only
// content with no Cloud counterpart, which plugins/remark-edition.mjs wraps
// here. A badge under a page's title, a marked box around a block, a label
// in front of a phrase; each says "Self-hosted" and links "See it in <newest
// release name>" to the same page under /latest/. The link is worked out
// from the route, so it also holds for blocks from partials.
import React from 'react';
import { useLocation } from '@docusaurus/router';

// /identity-platform/cloud/identity-server/guides/x/ under base
// /identity-platform/cloud/identity-server/ → /identity-server/latest/guides/x/.
export function latestHref(pathname, base, latest) {
  return base && pathname.startsWith(base) ? `${latest}${pathname.slice(base.length)}` : latest;
}

export default function SelfHostedAddition({ page, inline, release, latest, base, children }) {
  const { pathname } = useLocation();
  // A full page load: /latest/ is another Docs deployment.
  const link = <a className="wso2-self-hosted__link" href={latestHref(pathname, base, latest)} target="_self">See it in {release}</a>;
  const tag = <span className="wso2-self-hosted__tag">Self-hosted</span>;
  // The label itself is no search content (data-search-exclude).
  if (page === 'true') {
    return <p className="wso2-self-hosted wso2-self-hosted--page" data-self-hosted="page" data-search-exclude="">{tag} {link}</p>;
  }
  if (inline === 'true') {
    return <span className="wso2-self-hosted wso2-self-hosted--inline" data-self-hosted="phrase">{tag} {children}</span>;
  }
  return (
    <section className="wso2-self-hosted wso2-self-hosted--block" data-self-hosted="block" aria-label="Self-hosted only">
      <p className="wso2-self-hosted__label" data-search-exclude="">{tag} {link}</p>
      {children}
    </section>
  );
}
