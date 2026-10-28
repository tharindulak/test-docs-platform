// Only rendered in show-markers mode (local preview, PR previews): outlines a
// marked block, labels it, and lets the dev toolbar toggle editions.
import React from 'react';

// A form of an Edition variant (`variant`) shows in its own Edition only;
// another Self-hosted-only block also in Cloud, as a Self-hosted addition of
// `newestRelease`.
export default function EditionMarker({ label, active, only, selfHostedFrom, page, inline, variant, newestRelease, children }) {
  const data = {
    'data-edition-marker': '',
    'data-only': only || undefined,
    'data-self-hosted-from': selfHostedFrom || undefined,
    'data-variant': variant || undefined,
    'data-newest-release': newestRelease || undefined,
    'data-active': active,
  };
  if (page === 'true') {
    return <div className="wso2-edition-marker wso2-edition-marker--page" {...data}>{label}</div>;
  }
  const Tag = inline === 'true' ? 'span' : 'div';
  return (
    <Tag className={`wso2-edition-marker${inline === 'true' ? ' wso2-edition-marker--inline' : ''}`} {...data}>
      <span className="wso2-edition-marker__label">{label}</span>
      {children}
    </Tag>
  );
}
