// The products menu (Chrome: products menu, section menu and two version
// selectors): grouped as wso2.com groups its products, by family, then
// Solutions and Other, from the published manifest (lib/switching.mjs
// productsMenu). Each family lists its Cloud first, then its products, then
// the products not on WSO2 Docs yet (old site ↗) and its link entries (↗).
// The button names the product being read (inside a Cloud part, the
// component). Choosing a product opens its section, remembered for the session.
import React from 'react';
import clsx from 'clsx';
import { productLabel, productsMenu } from '../../../../lib/switching.mjs';
import { useManifest, useNavView, writeSection } from './runtime';
import useDisclosure from './useDisclosure';

function Entry({ e, className }) {
  return (
    <a className={className} href={e.href} aria-current={e.current ? 'true' : undefined} data-kind={e.kind}
      onClick={() => { if (e.section && e.docSpace) writeSection(e.docSpace, e.section); }}>
      <span className="wso2-menu__text">
        {e.label}
        {e.external && <><span className="wso2-external" aria-hidden="true"> ↗</span><span className="wso2-sr-only">{e.linksOut ? ' (external site)' : ' (not on WSO2 Docs yet: its old site)'}</span></>}
      </span>
      {e.kinds.length > 0 && <span className="wso2-hint">{e.kinds.join(' · ')}</span>}
    </a>
  );
}

export default function ProductSwitcher({ mobile }) {
  const manifest = useManifest();
  const view = useNavView();
  const d = useDisclosure();
  const groups = productsMenu(manifest, view);
  const label = productLabel(manifest, view);

  const panel = (linkClass) => groups.map((g) => (
    <div className="wso2-menu__group" role="group" aria-label={g.name} key={g.id}>
      <p className="wso2-menu__group-label" aria-hidden="true">{g.name}</p>
      <ul className="wso2-menu__list">
        {g.entries.map((e) => <li key={`${e.href}|${e.label}`}><Entry e={e} className={linkClass} /></li>)}
      </ul>
    </div>
  ));

  if (mobile) {
    return (
      <li className={clsx('menu__list-item', 'wso2-mobile-menu', !d.open && 'menu__list-item--collapsed')} ref={d.root}>
        <button className="menu__link menu__link--sublist menu__link--sublist-caret wso2-mobile-menu__button" {...d.buttonProps}>
          <span className="wso2-sr-only">Products: </span>{label}
        </button>
        <div className="wso2-mobile-menu__panel" {...d.panelProps}>{panel('menu__link wso2-mobile-menu__link')}</div>
      </li>
    );
  }
  return (
    <div className="navbar__item wso2-menu wso2-product-switcher" ref={d.root}>
      <button className="wso2-menu__button" aria-label={`${label}: switch product`} {...d.buttonProps}>
        <span className="wso2-menu__button-text">{label}</span><span className="wso2-caret" aria-hidden="true" />
      </button>
      <div className="wso2-menu__panel wso2-menu__panel--wide" {...d.panelProps}>
        <div className="wso2-menu__columns">{panel('wso2-menu__link')}</div>
        <a className="wso2-menu__footer-link" href="/">All of WSO2 Docs</a>
      </div>
    </div>
  );
}
