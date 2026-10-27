// The Ctrl/⌘K pop-up (Theme and shared chrome: search look). Loaded lazily on
// first open, so InstantSearch and the Typesense adapter stay out of every
// page's initial bundle.
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { scopesFor } from '../../../../lib/search/scopes.mjs';
import SearchPanel from './SearchPanel';

export default function SearchModal({ setup, onClose }) {
  const { ctx, manifest, env } = setup;
  const dialog = useRef(null);
  const { scopes, default: initialScope } = scopesFor(ctx, manifest);
  useEffect(() => {
    const opener = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="wso2-search-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wso2-search-modal__dialog" role="dialog" aria-modal="true" aria-label="Search" ref={dialog}>
        {env
          ? <SearchPanel ctx={ctx} manifest={manifest} env={env} scopes={scopes} initialScope={initialScope} onNavigate={(t) => { if (t.sameDeployment) onClose(); }} />
          : <p className="wso2-search-panel__hint">Search isn’t available on this host. It works on docs.wso2.com, on staging, and in <code>wso2-docs preview --search</code>.</p>}
      </div>
    </div>,
    document.body,
  );
}
