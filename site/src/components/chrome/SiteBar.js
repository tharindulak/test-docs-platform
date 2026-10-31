// The wso2.com bar, above the docs bar on every page (Root renders it, so it
// scrolls away while the docs bar sticks): WSO2's logo to wso2.com, wso2.com's
// top-level links and menus, and its contact link, from chrome.json
// header.site. Menus are <details> disclosures of links, so they work without
// JavaScript; with it, opening one closes the others, and Escape or a click
// outside closes them. On phones the links fold into one Menu disclosure.
// The logo's images are the shared theme's, at its host-root address
// (plugins/theme.mjs), so a new logo needs no rebuild.
import React, { useEffect, useRef } from 'react';
import { useChrome, usePlatform } from './runtime';

function Chevron() {
  return (
    <svg className="wso2-site-bar__chevron" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true" focusable="false">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Menu({ item }) {
  return (
    <details className="wso2-site-bar__menu">
      <summary className="wso2-site-bar__item">{item.label}<Chevron /></summary>
      <div className="wso2-site-bar__panel">
        {item.groups.map((g) => (
          <div className="wso2-site-bar__group" key={g.title}>
            <p className="wso2-site-bar__group-title">{g.href ? <a href={g.href}>{g.title}</a> : g.title}</p>
            <ul>{g.links.map((l) => <li key={l.href + l.label}><a href={l.href}>{l.label}</a></li>)}</ul>
          </div>
        ))}
      </div>
    </details>
  );
}

function Items({ items }) {
  return items.map((item) => (
    <li key={item.label}>
      {item.groups ? <Menu item={item} /> : <a className="wso2-site-bar__item" href={item.href}>{item.label}</a>}
    </li>
  ));
}

// One open <details> at a time; Escape and a click outside close them.
function useDetailsGroup(root) {
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const all = () => [...el.querySelectorAll('details[open]')];
    const onToggle = (e) => {
      if (!e.target.open) return;
      for (const d of all()) if (d !== e.target && !d.contains(e.target)) d.open = false;
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const open = all().at(-1);
      if (open) { open.open = false; open.querySelector('summary')?.focus(); }
    };
    const onPointer = (e) => { if (!el.contains(e.target)) for (const d of all()) d.open = false; };
    el.addEventListener('toggle', onToggle, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      el.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [root]);
}

export default function SiteBar() {
  const site = useChrome().header?.site;
  const root = useRef(null);
  const { themeBase } = usePlatform();
  const mark = `${themeBase}img/pulse-mark.svg`;
  const markDark = `${themeBase}img/pulse-mark-white.svg`;
  useDetailsGroup(root);
  if (!site) return null;
  const items = site.items ?? [];
  return (
    <header className="wso2-site-bar" ref={root} data-wso2-chrome="">
      <a className="wso2-site-bar__logo" href={site.home.href}>
        <img className="wso2-site-bar__mark wso2-site-bar__mark--light" src={mark} alt="" width="22" height="22" />
        <img className="wso2-site-bar__mark wso2-site-bar__mark--dark" src={markDark} alt="" width="22" height="22" />
        <span>{site.home.label}</span>
      </a>
      <nav className="wso2-site-bar__nav" aria-label="wso2.com">
        <ul className="wso2-site-bar__list"><Items items={items} /></ul>
      </nav>
      {site.contact && <a className="wso2-site-bar__contact" href={site.contact.href}>{site.contact.label}</a>}
      <details className="wso2-site-bar__phone">
        <summary className="wso2-site-bar__item">Menu<Chevron /></summary>
        <nav className="wso2-site-bar__phone-panel" aria-label="wso2.com">
          <ul className="wso2-site-bar__phone-list">
            <Items items={items} />
            {site.contact && <li><a className="wso2-site-bar__item" href={site.contact.href}>{site.contact.label}</a></li>}
          </ul>
        </nav>
      </details>
    </header>
  );
}
