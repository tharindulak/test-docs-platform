// The Platform search box: a header button (or the landing page's hero box)
// that opens the search pop-up on click or Ctrl/⌘K. Self-contained: it also
// opens on the "wso2docs:search-open" window event that other chrome can send.
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useSearchSetup } from './runtime';
import './search.css';

const SearchModal = lazy(() => import('./SearchModal'));

export function openSearch(variant = 'header') {
  window.dispatchEvent(new CustomEvent('wso2docs:search-open', { detail: { variant } }));
}

export default function SearchBox({ variant = 'header', landing }) {
  const setup = useSearchSetup({ landing: landing ?? variant === 'hero' });
  const [open, setOpen] = useState(false);
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
    const onOpen = (e) => {
      if ((e.detail?.variant ?? 'header') === variant) setOpen(true);
    };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('wso2docs:search-open', onOpen);
    // Only the header box owns the shortcut, so a page with both opens one pop-up.
    if (variant === 'header') document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wso2docs:search-open', onOpen);
      document.removeEventListener('keydown', onKey);
    };
  }, [variant]);
  const label = setup.ctx.landing ? 'Search all of WSO2 Docs' : 'Search';
  return (
    <>
      <button type="button" className={`wso2-search wso2-search--${variant}`} data-wso2-search={variant} data-wso2-search-slot={variant}
        aria-label={label} aria-keyshortcuts="Control+K Meta+K" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg className="wso2-search__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.39A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" />
        </svg>
        <span className="wso2-search__label">{label}</span>
        <kbd className="wso2-search__keys">{mac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>
      {open && (
        <Suspense fallback={null}>
          <SearchModal setup={setup} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
