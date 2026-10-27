// Version notices in the page area, above the content, where every page
// layout and the phone width have room for them (the header holds only the
// two selectors): the team's notices from the published manifest, the notice
// after a switch (a renamed page, or a missing one: its home page), the
// remembered-Edition banner (an offer, never a redirect) and the version
// notice from the manifest (Version switching with the header selector and
// menu dropdowns): on an older release the newest release and Cloud, on Cloud
// that some features may not be in a release yet, end of life as before. The
// version notice is server-rendered from the snapshot, so it shows with no
// flash; team notices come only from the published manifest, at runtime.
import React, { useEffect, useState } from 'react';
import { useLocation } from '@docusaurus/router';
import { arrivalBanner, choose, focus, teamNotices, versionNotice } from '../../../../lib/switching.mjs';
import { readRemembered, readStore, takeSwitchNotice, useDeployments, useLiveManifest, useManifest, useNavView, writeRemembered, writeStore } from './runtime';
import { track } from './analytics';

const DISMISS_KEY = (slug) => `wso2docs:banner-dismissed:${slug}`;
const KIND = { cloud: 'info', older: 'warning', eol: 'eol' };

function Notice({ kind, children, onDismiss }) {
  return (
    <div className={`wso2-notice wso2-notice--${kind}`} role={kind === 'switch' ? 'status' : 'note'}>
      <div className="wso2-notice__body">{children}</div>
      {onDismiss && <button type="button" className="wso2-notice__dismiss" aria-label="Dismiss" onClick={onDismiss}>×</button>}
    </div>
  );
}

// Team notices for this page: the tree's own, then (on a Cloud part's page) the part's.
function useTeamNotices(view) {
  const live = useLiveManifest();
  if (!live || !view) return [];
  const f = focus(live, view);
  const own = teamNotices(live, view.space, view.edition);
  return f.doc === view.space ? own : [...own, ...teamNotices(live, f.doc, f.edition)];
}

export default function EditionNotices() {
  const manifest = useManifest();
  const view = useNavView();
  const { pathname } = useLocation();
  const { ensure } = useDeployments(manifest, view);
  const [switched, setSwitched] = useState(null);
  const [banner, setBanner] = useState(null);
  const [newestUrl, setNewestUrl] = useState(null);
  const f = view ? focus(manifest, view) : null;
  const note = view ? versionNotice(manifest, view) : null;

  useEffect(() => { setSwitched(takeSwitchNotice(pathname)); }, [pathname]);

  useEffect(() => {
    setBanner(null);
    if (!f) return undefined;
    const remembered = readRemembered(f.doc);
    if (!remembered || remembered === f.edition || readStore('sessionStorage', DISMISS_KEY(f.doc))) return undefined;
    let live = true;
    ensure().then((loaded) => { if (live) setBanner(arrivalBanner(manifest, loaded, view, remembered)); });
    return () => { live = false; };
  }, [f?.doc, f?.edition, pathname, manifest]);

  // On an older release, "the newest release" links to this page there where it exists.
  useEffect(() => {
    setNewestUrl(null);
    if (note?.kind !== 'older') return undefined;
    let live = true;
    ensure().then((loaded) => {
      const r = choose(manifest, loaded, view, f.doc, note.newest);
      if (live && (r.kind === 'same' || r.kind === 'renamed')) setNewestUrl(r.url.replace(`/${f.doc}/${note.newest}/`, `/${f.doc}/latest/`));
    });
    return () => { live = false; };
  }, [f?.doc, pathname, note?.kind, note?.newest, manifest]);

  const notices = useTeamNotices(view);
  if (!switched && !banner && !note && !notices.length) return null;
  return (
    <div className="wso2-notices" data-wso2-chrome="">
      {notices.map((n, i) => <Notice key={`team-${i}`} kind={n.level}>{n.text}</Notice>)}
      {switched && <Notice kind="switch" onDismiss={() => setSwitched(null)}>{switched}</Notice>}
      {banner && (
        <Notice kind="info" onDismiss={() => { writeStore('sessionStorage', DISMISS_KEY(f.doc), '1'); setBanner(null); }}>
          {banner.text}{' '}
          <a className="wso2-notice__action" href={banner.url} onClick={() => {
            writeRemembered(f.doc, banner.edition);
            track('editionSwitch', { from: f.edition, to: banner.edition, result: 'banner' });
          }}>{banner.action}</a>
        </Notice>
      )}
      {note && (
        <Notice kind={KIND[note.kind]}>
          <span data-wso2-version-notice={note.kind}>{note.text}</span>
          {note.url && (
            <>{' '}<a className="wso2-notice__action" href={newestUrl ?? note.url}>
              {newestUrl ? 'View this page in the newest release' : note.action}
            </a></>
          )}
        </Notice>
      )}
    </div>
  );
}
