// Root wrapper (documented pattern, not a swizzle). It renders the site-wide
// announcement from chrome.json above the header, sets the analytics context
// and tracks page views that no page tracked itself. In show-markers mode it
// adds the dev toolbar: an Edition toggle that hides marked blocks
// client-side, so a writer or reviewer can check every Edition from one preview.
import React, { useEffect, useState } from 'react';
import { useLocation } from '@docusaurus/router';
import { editionFromId, matches } from '../../../lib/edition.mjs';
import Announcement from '@site/src/components/chrome/Announcement';
import { useManifest, usePlatform } from '@site/src/components/chrome/runtime';
import { setAnalyticsContext, trackPageViewOnce } from '@site/src/components/chrome/analytics';

// The built Edition is always a choice: a staging-only Doc space (the
// Sandbox) is missing from the baked-in production snapshot.
function useEditions(docSpace, built) {
  const manifest = useManifest(); // runtime copy, falling back to the snapshot
  const ids = (manifest.docSpaces?.[docSpace]?.editions ?? []).filter((e) => e.status !== 'legacy').map((e) => e.id);
  return [...new Set([...ids, ...(built ? [built] : []), 'next'])];
}

function applyEdition(id) {
  const edition = editionFromId(id);
  for (const el of document.querySelectorAll('[data-edition-marker]')) {
    const marker = {};
    if (el.dataset.only) marker.only = el.dataset.only;
    if (el.dataset.selfHostedFrom) marker.selfHostedFrom = el.dataset.selfHostedFrom;
    el.dataset.active = String(matches(edition, marker));
  }
}

function DevToolbar({ built, ids }) {
  const [current, setCurrent] = useState(built);
  const location = useLocation();
  useEffect(() => applyEdition(current), [current, location.pathname]);
  return (
    <div className="wso2-dev-toolbar" role="region" aria-label="Preview tools">
      <span>Preview as</span>
      <select value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Edition">
        {ids.map((id) => <option key={id} value={id}>{id}{id === built ? ' (built)' : ''}</option>)}
      </select>
      <span className="wso2-dev-toolbar__hint">Markers shown · inactive blocks are faded</span>
    </div>
  );
}

export default function Root({ children }) {
  const f = usePlatform();
  const ids = useEditions(f.docSpace, f.edition);
  const { pathname } = useLocation();
  if (typeof window !== 'undefined') {
    // Set during render so pages' own effects (which run first) see it.
    setAnalyticsContext({ docSpace: f.docSpace ?? 'landing', edition: f.edition ?? null, latest: Boolean(f.asLatest) });
  }
  useEffect(() => { trackPageViewOnce('other'); }, [pathname]);
  return (
    <>
      <Announcement />
      {children}
      {f.showMarkers && <DevToolbar built={f.edition} ids={ids} />}
    </>
  );
}
