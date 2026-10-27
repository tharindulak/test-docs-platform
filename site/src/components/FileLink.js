// Links in page content. Docusaurus adds the site's trailing slash to every
// internal link, files included, so a Markdown link to a file the build emits
// (…/assets/files/spec-<hash>.yaml) became …/spec-<hash>.yaml/ and answered 404.
// Docusaurus marks those links data-noBrokenLinkCheck; pathname:// tells <Link>
// they aren't routes, so the URL is kept as is.
import React from 'react';
import MDXA from '@theme/MDXComponents/A';

export default function FileLink(props) {
  const { href } = props;
  if (props['data-noBrokenLinkCheck'] && typeof href === 'string' && href.startsWith('/')) {
    return <MDXA {...props} href={`pathname://${href}`} />;
  }
  return <MDXA {...props} />;
}
