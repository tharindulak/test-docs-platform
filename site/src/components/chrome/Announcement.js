// The site-wide announcement banner from chrome.json, above the header.
// Dismissing it hides that announcement id in this browser.
import React, { useEffect, useState } from 'react';
import { activeAnnouncement } from '../../../../lib/chrome.mjs';
import { readStore, useChrome, writeStore } from './runtime';

const KEY = 'wso2docs:announcement-dismissed';

export default function Announcement() {
  const a = activeAnnouncement(useChrome());
  const [dismissed, setDismissed] = useState(null);
  useEffect(() => { setDismissed(readStore('localStorage', KEY)); }, []);
  if (!a || dismissed === a.id) return null;
  return (
    <div className="wso2-announcement" role="region" aria-label="Announcement" data-wso2-chrome="">
      <p className="wso2-announcement__text">
        {a.text}{a.href && <>{' '}<a href={a.href}>{a.linkText ?? 'Learn more'}</a></>}
      </p>
      <button type="button" className="wso2-announcement__dismiss" aria-label="Dismiss announcement"
        onClick={() => { writeStore('localStorage', KEY, a.id); setDismissed(a.id); }}>×</button>
    </div>
  );
}
