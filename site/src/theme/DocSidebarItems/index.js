// Safe swizzle (wrap): the top level of the docs sidebar, on desktop and in
// the phone menu alike, becomes the Docs section menu, with this deployment's
// own tree under its open entry (site/src/components/chrome/SectionMenu.js).
// Deeper levels (a category's items) render as Docusaurus draws them. At
// every level, an entry that names a sidebar icon gets it before its label
// (site/src/components/NavIcon).
import React, { useMemo } from 'react';
import DocSidebarItems from '@theme-original/DocSidebarItems';
import SectionMenu from '@site/src/components/chrome/SectionMenu';
import { useNavIcons, withIcons } from '@site/src/components/NavIcon';

export default function DocSidebarItemsWrapper(props) {
  const icons = useNavIcons();
  const items = useMemo(() => withIcons(props.items, icons), [props.items, icons]);
  if (props.level !== 1) return <DocSidebarItems {...props} items={items} />;
  return <SectionMenu Items={DocSidebarItems} {...props} items={items} />;
}
