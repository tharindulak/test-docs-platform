// The Docs section menu (Assembling one Docs section menu from separately
// deployed Doc spaces): the section's title, then its entries in the section
// manifest's order, drawn in the browser from the published manifest over the
// snapshot baked into this build. The Doc space serving the page is open, with
// this deployment's own tree (the Docusaurus sidebar, a family Cloud tree's
// part groups included); every other Doc space is one collapsed line with its
// name and, when set to `version-in: menu`, its version dropdown on the same
// line, aligned right. Link entries open their site (↗). The section is the
// one the reader came through this session, else the Doc space's home section
// (lib/switching.mjs menu, sectionFor). A Doc space in no section (Contribute,
// Unlisted ones) keeps its plain sidebar.
import React from 'react';
import clsx from 'clsx';
import { menu } from '../../../../lib/switching.mjs';
import { useManifest, useNavView, useSection, writeSection } from './runtime';
import useDisclosure from './useDisclosure';
import useSwitch from './useSwitch';

const short = (title) => String(title ?? '').replace(/\s+Documentation$/, '');

function Entry({ e, sectionId, sw, Items, itemsProps }) {
  const d = useDisclosure();
  const dd = e.dropdown;
  let tree = null;
  if (e.open) {
    // A borrowed component in a section that does not list its platform shows its part alone.
    const items = e.onlyPart ? itemsProps.items.filter((i) => i.customProps?.cloudPart === e.onlyPart) : itemsProps.items;
    tree = <ul className="menu__list wso2-entry__tree"><Items {...itemsProps} items={items} /></ul>;
  }
  const choose = async (ev, item) => {
    const r = await sw.pick(ev, e.slug, item, 'menu', sectionId);
    if (r === 'noop') d.close(true);
  };
  return (
    <li className={clsx('menu__list-item', 'wso2-entry', e.active && 'wso2-entry--active', e.open && 'wso2-entry--open')} ref={d.root}
      data-docspace={e.slug} onPointerEnter={e.focus ? sw.ensure : undefined}>
      <div className="wso2-entry__head">
        <a className="menu__link wso2-entry__name" href={e.href} onClick={() => writeSection(e.slug, sectionId)}>{e.name}</a>
        {dd && (
          <button className="wso2-entry__version" aria-label={`${e.name} version, ${dd.label}`} {...d.buttonProps}
            onClick={() => { if (e.focus) sw.ensure(); d.setOpen((o) => !o); }}>
            <span>{dd.label}</span><span className="wso2-caret" aria-hidden="true" />
          </button>
        )}
      </div>
      {e.borrowed && e.homeTitle && <span className="wso2-entry__tag">from {short(e.homeTitle)}</span>}
      {dd && (
        <ul className="wso2-entry__versions" aria-label={`${e.name} versions`} {...d.panelProps}>
          {dd.items.map((i) => (
            <li key={i.id}>
              <a className={clsx('wso2-entry__version-link', i.current && 'is-current')} href={i.href} aria-current={i.current ? 'true' : undefined}
                {...(i.external ? { target: '_blank', rel: 'noopener' } : {})} onClick={(ev) => choose(ev, i)}>
                {i.label}{i.external && <span className="wso2-sr-only"> (old site, opens in a new tab)</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {tree}
    </li>
  );
}

export default function SectionMenu({ Items, ...itemsProps }) {
  const manifest = useManifest();
  const view = useNavView();
  const sectionId = useSection(manifest, view);
  const sw = useSwitch(manifest, view);
  const m = view && sectionId ? menu(manifest, view, sectionId) : null;
  if (!m) return <Items {...itemsProps} />;
  return (
    <>
      <li className="wso2-section__title" data-section={m.id}>{m.title}</li>
      {m.entries.map((e) => (e.kind === 'link' ? (
        <li className="menu__list-item wso2-entry wso2-entry--link" key={`link:${e.href}`}>
          <a className="menu__link wso2-entry__name" href={e.href}>
            {e.label}<span className="wso2-external" aria-hidden="true"> ↗</span><span className="wso2-sr-only"> (external site)</span>
          </a>
        </li>
      ) : <Entry key={e.slug} e={e} sectionId={m.id} sw={sw} Items={Items} itemsProps={itemsProps} />))}
    </>
  );
}
