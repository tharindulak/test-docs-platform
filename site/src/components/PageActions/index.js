// The "Copy page" menu next to a doc page's title (AI/LLM-friendly docs,
// decision 2): Copy as Markdown, View as Markdown, Open in Claude, Open in
// ChatGPT. All four use the page's Markdown twin (<page>.md), which the Edge
// Worker serves from the build. Placed by plugins/remark-page-actions.mjs.
// Pushes the chrome's fixed dataLayer events docs_copy_page and docs_open_in_ai.
import React, { useEffect, useRef, useState } from 'react';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { chatLinks, twinUrlPath } from '../../../../lib/twin-paths.mjs';
import { track } from '../chrome/analytics';
import styles from './styles.module.css';

const COPIED_FOR_MS = 2500;

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand('copy')) throw new Error('copy failed');
  } finally {
    area.remove();
  }
}

export default function PageActions() {
  const { metadata } = useDoc();
  const { siteConfig } = useDocusaurusContext();
  const twin = twinUrlPath(metadata.permalink, siteConfig.baseUrl);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const root = useRef(null);
  const toggle = useRef(null);
  const items = useRef([]);
  const absolute = () => `${typeof window === 'undefined' ? siteConfig.url : window.location.origin}${twin}`;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    items.current[0]?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!status) return undefined;
    const t = setTimeout(() => setStatus(''), COPIED_FOR_MS);
    return () => clearTimeout(t);
  }, [status]);

  const copy = async () => {
    setOpen(false);
    track('copyPage', { page: metadata.permalink });
    try {
      const res = await fetch(twin, { headers: { accept: 'text/markdown' } });
      if (!res.ok) throw new Error(String(res.status));
      await copyText(await res.text());
      setStatus('Copied');
    } catch {
      setStatus('Couldn’t copy the page');
    }
  };

  const onMenuKey = (e) => {
    const list = items.current.filter(Boolean);
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      toggle.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const links = chatLinks(absolute());
  const item = (i) => ({ ref: (el) => { items.current[i] = el; }, role: 'menuitem', tabIndex: -1, className: styles.item });

  return (
    <div className={styles.root} ref={root} data-page-actions="">
      <div className={styles.group}>
        <button type="button" className={styles.main} onClick={copy}>
          {status || 'Copy page'}
        </button>
        <button
          type="button"
          ref={toggle}
          className={styles.toggle}
          aria-label="More page actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        </button>
      </div>
      <span className={styles.status} role="status" aria-live="polite">{status}</span>
      {open && (
        <div className={styles.menu} role="menu" aria-label="Page actions" onKeyDown={onMenuKey}>
          <button type="button" {...item(0)} onClick={copy}>
            <span className={styles.label}>Copy as Markdown</span>
            <span className={styles.hint}>For pasting into an AI tool</span>
          </button>
          <a {...item(1)} href={twin} target="_blank" rel="noopener" onClick={() => { setOpen(false); track('openInAi', { target: 'markdown', page: metadata.permalink }); }}>
            <span className={styles.label}>View as Markdown</span>
            <span className={styles.hint}>This page as plain text</span>
          </a>
          <a {...item(2)} href={links.claude} target="_blank" rel="noopener noreferrer" onClick={() => { setOpen(false); track('openInAi', { target: 'claude', page: metadata.permalink }); }}>
            <span className={styles.label}>Open in Claude</span>
            <span className={styles.hint}>Ask questions about this page</span>
          </a>
          <a {...item(3)} href={links.chatgpt} target="_blank" rel="noopener noreferrer" onClick={() => { setOpen(false); track('openInAi', { target: 'chatgpt', page: metadata.permalink }); }}>
            <span className={styles.label}>Open in ChatGPT</span>
            <span className={styles.hint}>Ask questions about this page</span>
          </a>
        </div>
      )}
    </div>
  );
}
