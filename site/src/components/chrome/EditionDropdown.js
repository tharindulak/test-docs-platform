// The version selector next to the product (Version switching with the header
// selector and menu dropdowns): always shown for a versioned Doc space, for
// the Doc space being read (inside a Cloud part, the component). Cloud first,
// then the Self-hosted versions in manifest order, the newest release with a
// "Latest" badge, then "Older versions (old site)". When opened it fetches each Edition's page
// list and says where each item leads ("same page", "renamed page", "page not
// in it: home page"). The button shows the short Edition ("Cloud", "7.3.0"),
// next to the products button that names the product, with a cloud icon on
// Cloud. It stays in the docs bar on phones.
import React, { useState } from 'react';
import clsx from 'clsx';
import { MAPPING_HINTS, headerSelector, permanentUrl } from '../../../../lib/switching.mjs';
import { useManifest, useNavView } from './runtime';
import useDisclosure from './useDisclosure';
import useSwitch from './useSwitch';

// "Identity Server 7.3.0" plus a "Latest" badge read as "(newest release)";
// an old-site item's version after its name, muted.
function Label({ item }) {
  const rest = item.label.startsWith(item.name) ? item.label.slice(item.name.length) : '';
  if (!rest) return item.label;
  if (rest.trim() !== '(newest release)') return <>{item.name}<span className="wso2-menu__muted">{rest}</span></>;
  return <>{item.name}<span className="wso2-latest"><span className="wso2-sr-only">{rest}</span><span aria-hidden="true">Latest</span></span></>;
}

function CloudIcon() {
  return (
    <svg className="wso2-menu__icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path d="M7 18a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 8.5a4.75 4.75 0 0 1-.25 9.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function Item({ item, onChoose, linkClass }) {
  const hint = MAPPING_HINTS[item.mapping];
  return (
    <a
      className={clsx(linkClass, item.current && 'is-current', item.external && 'is-legacy')}
      href={item.href}
      data-edition={item.id}
      aria-current={item.current ? 'page' : undefined}
      {...(item.external ? { target: '_blank', rel: 'noopener' } : {})}
      onClick={(e) => onChoose(e, item)}>
      <span className="wso2-menu__text">
        <Label item={item} />
        {item.eol && <span className="wso2-badge">end of life</span>}
        {item.external && <span className="wso2-sr-only"> (old site, opens in a new tab)</span>}
      </span>
      {hint && !item.external && <span className={`wso2-hint wso2-hint--${item.mapping}`}>{hint}</span>}
      {item.external && <span className="wso2-hint" aria-hidden="true">old site</span>}
    </a>
  );
}

export default function EditionDropdown({ mobile }) {
  const manifest = useManifest();
  const view = useNavView();
  const d = useDisclosure();
  const [copied, setCopied] = useState(false);
  const sw = useSwitch(manifest, view);
  const model = view ? headerSelector(manifest, sw.deployments, view, { asLatest: view.asLatest }) : null;
  if (!model || mobile) return null;

  const toggle = () => { sw.ensure(); d.setOpen((o) => !o); };
  const onChoose = async (e, item) => {
    const r = await sw.pick(e, model.doc, item, 'header');
    if (r === 'noop') d.close(true);
  };
  const copyLink = async () => {
    const url = permanentUrl(window.location.origin, manifest, view, window.location.hash);
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { window.prompt('Permanent link', url); }
    setTimeout(() => setCopied(false), 2000);
  };

  const groups = model.groups.map((g) => (
    <div className="wso2-menu__group" role="group" aria-label={g.label} key={g.label}>
      <p className="wso2-menu__group-label" aria-hidden="true">{g.label}</p>
      <ul className="wso2-menu__list">
        {g.items.map((item) => <li key={item.id}><Item item={item} onChoose={onChoose} linkClass="wso2-menu__link" /></li>)}
      </ul>
    </div>
  ));
  const copy = (
    <button type="button" className="wso2-menu__action" onClick={copyLink}>
      {copied ? 'Link copied' : 'Copy permanent link'}
    </button>
  );
  const name = `${model.product} version, ${model.label}`;

  return (
    <div className="navbar__item wso2-menu wso2-edition-dropdown" ref={d.root} onPointerEnter={sw.ensure} onFocus={sw.ensure}>
      <button className="wso2-menu__button" aria-label={name} {...d.buttonProps} onClick={toggle}>
        {model.short === 'Cloud' && <CloudIcon />}
        <span className="wso2-menu__button-text">{model.short}</span><span className="wso2-caret" aria-hidden="true" />
      </button>
      <div className="wso2-menu__panel" {...d.panelProps}>
        {groups}
        <div className="wso2-menu__footer" aria-live="polite">{copy}</div>
      </div>
    </div>
  );
}
