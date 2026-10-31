// Sidebar icons (Extension points): the icon a sidebar entry names in its
// customProps (a page's `sidebar_custom_props`, a folder's `_category_.yml`),
// drawn as inline SVG before its label. plugins/nav-icons.mjs checks the names
// and hands over the SVG of the icons in use as global data, so nothing loads
// in the browser. The icon is decorative: the label stays the entry's text.
// Its look is the shared theme's (site/wso2-theme/css/nav-icons.css).
import React from 'react';
import useGlobalData from '@docusaurus/useGlobalData';

export function NavIcon({ icon }) {
  return (
    <span className="wso2-nav-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox={icon.viewBox} width={icon.width} height={icon.height} focusable="false"
        dangerouslySetInnerHTML={{ __html: icon.body }} />
    </span>
  );
}

export function useNavIcons() {
  return useGlobalData()['wso2-nav-icons']?.default?.icons ?? null;
}

// The entry with its icon before its label. Docusaurus draws the label inside
// the entry's link, and also uses it as text (the collapse button's
// accessible name, the list key), so the label becomes a list of the icon and
// the text that reads as the text alone.
export function withIcon(item, icons) {
  const icon = icons?.[item.customProps?.icon];
  if (!icon || typeof item.label !== 'string') return item;
  const text = item.label;
  const label = Object.assign([<NavIcon key="wso2-nav-icon" icon={icon} />, text], { toString: () => text });
  return { ...item, label };
}

// The same list when no entry has an icon, so memoised levels stay memoised.
export function withIcons(items, icons) {
  if (!icons || !items) return items;
  let changed = false;
  const out = items.map((item) => {
    const next = withIcon(item, icons);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? out : items;
}
