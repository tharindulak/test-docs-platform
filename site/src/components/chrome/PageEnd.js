// The end of every doc page: "Was this page helpful?" (Yes / No, then reason
// chips; no free text), "Edit this page" (hidden while the manifest's
// editLinks is false) and "Report an issue" (a prefilled GitHub issue).
// Votes go to chrome.json's feedback.endpoint, which the Edge Worker counts
// without cookies, and to the dataLayer.
import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from '@docusaurus/router';
import { editionName, focus, realEdition, spaceOf } from '../../../../lib/switching.mjs';
import { FEEDBACK_REASONS, feedbackEvent, issueLink } from '../../../../lib/page-links.mjs';
import { useChrome, useManifest, useNavView, usePlatform, useView } from './runtime';
import { track, trackPageView } from './analytics';

function post(endpoint, body) {
  try {
    fetch(endpoint, { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .catch(() => {});
  } catch { /* never block the reader */ }
}

// The last text the reader selected inside the article, for the issue body.
function useSelection() {
  const last = useRef('');
  useEffect(() => {
    const onChange = () => {
      const sel = document.getSelection();
      const text = sel?.toString().trim();
      if (text && sel.anchorNode && document.querySelector('article')?.contains(sel.anchorNode)) last.current = text;
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);
  return last;
}

export default function PageEnd({ doc }) {
  const p = usePlatform();
  const manifest = useManifest();
  const chrome = useChrome();
  const view = useView();
  const { pathname } = useLocation();
  const selection = useSelection();
  const [vote, setVote] = useState(null);
  const [reason, setReason] = useState(null);
  const space = spaceOf(manifest, p.docSpace);
  const real = space ? realEdition(space, view) : p.edition;
  // The Edition the page belongs to: a Cloud part's page is the component's Cloud.
  const nav = useNavView();
  const f = nav ? focus(manifest, nav) : null;
  const owner = f ? spaceOf(manifest, f.doc) : null;
  const name = owner ? editionName(owner, f.edition) : space ? editionName(space, real) : p.editionName;
  const fm = doc.frontMatter ?? {};

  useEffect(() => { setVote(null); setReason(null); trackPageView(fm.type ?? 'unknown'); }, [pathname]);

  const issueHref = (withSelection, why) => issueLink({
    issues: owner?.issues ?? space?.issues,
    pageUrl: typeof window === 'undefined' ? `${p.siteUrl}${pathname}` : window.location.href.split('#')[0],
    pageTitle: doc.metadata?.title ?? fm.title ?? '',
    editionName: name,
    selection: withSelection ? selection.current : '',
    reason: why,
  });
  const send = (kind, v, r) => {
    post(chrome.feedback?.endpoint ?? '/api/feedback', feedbackEvent({ kind, docSpace: p.docSpace, edition: real, asLatest: p.asLatest, page: pathname, vote: v, reason: r }));
    track('feedback', { vote: v, ...(r ? { reason: r } : {}), pageType: fm.type ?? 'unknown' });
  };
  const onVote = (v) => { setVote(v); send('vote', v); };
  const onReason = (r) => { setReason(r); send('reason', 'no', r); };
  const reasonLabel = FEEDBACK_REASONS.find((r) => r.id === reason)?.label;
  const refreshIssueHref = (why) => (e) => { e.currentTarget.href = issueHref(true, why) ?? e.currentTarget.href; };
  const issue = issueHref(false);
  const showEdit = space?.editLinks !== false && fm.wso2_edit_url;

  return (
    <div className="wso2-page-end" data-wso2-chrome="">
      <section className="wso2-feedback" aria-label="Page feedback">
        <p className="wso2-feedback__question" id="wso2-feedback-q">Was this page helpful?</p>
        {vote === null && (
          <div className="wso2-feedback__buttons" role="group" aria-labelledby="wso2-feedback-q">
            <button type="button" className="wso2-button" onClick={() => onVote('yes')}>Yes</button>
            <button type="button" className="wso2-button" onClick={() => onVote('no')}>No</button>
          </div>
        )}
        {vote === 'yes' && <p className="wso2-feedback__thanks" role="status">Thanks for letting us know.</p>}
        {vote === 'no' && !reason && (
          <div className="wso2-feedback__reasons" role="group" aria-label="What was the problem?">
            <p className="wso2-feedback__prompt" role="status">Sorry about that. What was the problem?</p>
            <div className="wso2-chips">
              {FEEDBACK_REASONS.map((r) => (
                <button type="button" className="wso2-chip" key={r.id} onClick={() => onReason(r.id)}>{r.label}</button>
              ))}
            </div>
          </div>
        )}
        {vote === 'no' && reason && (
          <p className="wso2-feedback__thanks" role="status">
            Thanks, that helps us improve this page.{' '}
            {issue && <a href={issue} target="_blank" rel="noopener noreferrer" onClick={refreshIssueHref(reasonLabel)}>Tell us more on GitHub</a>}
          </p>
        )}
      </section>
      <div className="wso2-page-actions">
        {showEdit && (
          <span className="wso2-page-actions__item">
            <a href={fm.wso2_edit_url} target="_blank" rel="noopener noreferrer" data-wso2-edit="">Edit this page</a>
            {fm.wso2_edit_note && <span className="wso2-muted"> · {fm.wso2_edit_note}</span>}
          </span>
        )}
        {issue && (
          <span className="wso2-page-actions__item">
            <a href={issue} target="_blank" rel="noopener noreferrer" data-wso2-report="" onClick={refreshIssueHref()}>Report an issue</a>
          </span>
        )}
      </div>
    </div>
  );
}
