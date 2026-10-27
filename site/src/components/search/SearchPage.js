// The full results page, docs.wso2.com/search/?q=…&scope=… (Theme and shared
// chrome). It belongs on the Landing deployment, which mounts it at /search/;
// its context (scope, Doc space, Edition) comes from its own URL, since the
// reader arrives from another deployment.
import React from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { parseSearchPageUrl } from '../../../../lib/search/scopes.mjs';
import { useSearchSetup } from './runtime';
import SearchPanel from './SearchPanel';
import './search.css';

function Page() {
  const setup = useSearchSetup({ landing: true });
  // The scopes the reader's page offered, from the live manifest (its Docs section, Unlisted rules).
  const parsed = parseSearchPageUrl(window.location.search, setup.manifest);
  if (!setup.env) return <p className="wso2-search-panel__hint">Search isn’t available on this host.</p>;
  const sync = ({ query, scope }) => {
    const p = new URLSearchParams(window.location.search);
    if (query) p.set('q', query); else p.delete('q');
    p.set('scope', scope);
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
  };
  return (
    <SearchPanel ctx={parsed.ctx} manifest={setup.manifest} env={setup.env} scopes={parsed.offered} initialScope={parsed.scope}
      initialQuery={parsed.query} hitsPerPage={20} layout="page" onChange={sync} />
  );
}

export default function SearchPage() {
  return (
    <main className="container margin-vert--lg wso2-search-page">
      <h1>Search WSO2 Docs</h1>
      <BrowserOnly fallback={<p className="wso2-search-panel__hint">Loading search…</p>}>{() => <Page />}</BrowserOnly>
    </main>
  );
}
