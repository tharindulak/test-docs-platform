// Wrap: the breadcrumb starts with the Docs section the page is shown in (the
// one the reader came through this session, else the home section), then the
// deployment's home, then Docusaurus's own trail. Sections have no pages, so
// the section crumb is text.
import React from 'react';
import Home from '@theme-original/DocBreadcrumbs/Items/Home';
import { menu } from '../../../../../../lib/switching.mjs';
import { useManifest, useNavView, useSection } from '@site/src/components/chrome/runtime';

export default function HomeWrapper(props) {
  const manifest = useManifest();
  const view = useNavView();
  const sectionId = useSection(manifest, view);
  const m = view && sectionId ? menu(manifest, view, sectionId) : null;
  return (
    <>
      {m && <li className="breadcrumbs__item wso2-crumb-section"><span className="breadcrumbs__link">{m.name}</span></li>}
      <Home {...props} />
    </>
  );
}
