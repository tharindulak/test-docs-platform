// Safe swizzle (wrap): the top level of the docs sidebar, on desktop and in
// the phone menu alike, becomes the Docs section menu, with this deployment's
// own tree under its open entry (site/src/components/chrome/SectionMenu.js).
// Deeper levels (a category's items) render as Docusaurus draws them.
import React from 'react';
import DocSidebarItems from '@theme-original/DocSidebarItems';
import SectionMenu from '@site/src/components/chrome/SectionMenu';

export default function DocSidebarItemsWrapper(props) {
  if (props.level !== 1) return <DocSidebarItems {...props} />;
  return <SectionMenu Items={DocSidebarItems} {...props} />;
}
