// Header links from chrome.json (Support, wso2.com), right of the search box.
import React from 'react';
import { useChrome } from './runtime';

export default function SiteLinks({ mobile }) {
  const links = useChrome().header?.links ?? [];
  if (mobile) {
    return links.map((l) => <li className="menu__list-item" key={l.href}><a className="menu__link" href={l.href}>{l.label}</a></li>);
  }
  return (
    <div className="navbar__item wso2-site-links">
      {links.map((l) => <a className="navbar__link" href={l.href} key={l.href}>{l.label}</a>)}
    </div>
  );
}
