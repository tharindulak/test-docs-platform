// A link to another Docs deployment: a plain same-tab, full page load.
// Docusaurus's own Link would add this build's baseUrl or open a new tab.
import React from 'react';

export default function DocsLink({ href, children }) {
  return <a href={href} data-docs-link="">{children}</a>;
}
