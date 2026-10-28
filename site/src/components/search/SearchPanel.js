// The search UI shared by the Ctrl/⌘K pop-up and the full results page: the
// query box, the search scope switch, filter chips, hits with Edition badges,
// and "See all results". All rules come from lib/search/scopes.mjs.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useHistory } from '@docusaurus/router';
import { Configure, Highlight, InstantSearch, Snippet, useHits, useInstantSearch, usePagination, useSearchBox } from 'react-instantsearch';
import {
  analyticsTag, buildFilter, chipOptions, editionLabel, hitTarget, readRemembered, scopeLabel, searchPageUrl, searchParameters,
} from '../../../../lib/search/scopes.mjs';
import { createSearchClient } from './client';
import { trackSearch } from './runtime';

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function QueryBox({ query, setQuery, onKeyDown, autoFocus }) {
  const { refine } = useSearchBox();
  useEffect(() => { refine(query); }, [query]);
  return (
    <div className="wso2-search-panel__box">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.39A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" /></svg>
      <input
        type="search" className="wso2-search-panel__input" placeholder="Search the docs" aria-label="Search the docs"
        value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
        autoFocus={autoFocus} autoComplete="off" spellCheck={false} enterKeyHint="search"
      />
    </div>
  );
}

function ScopeSwitch({ scopes, scope, setScope, ctx, manifest }) {
  if (scopes.length < 2) return null;
  return (
    <div className="wso2-search-panel__scopes" role="radiogroup" aria-label="Search scope">
      {scopes.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={s === scope} className="wso2-search-chip wso2-search-chip--scope" onClick={() => setScope(s)}>
          {scopeLabel(s, ctx, manifest)}
        </button>
      ))}
    </div>
  );
}

function Chips({ options, chips, setChips, manifest, ctx }) {
  const groups = [
    ['families', 'Product family', options.families.map((f) => ({ id: f, label: f }))],
    ['docSpaces', 'Doc space', options.docSpaces],
    ['editions', 'Edition', options.editions.map((e) => ({ id: e, label: editionLabel({ docSpace: ctx.docSpace, edition: e }, manifest) }))],
  ].filter(([, , items]) => items.length > 1);
  if (!groups.length) return null;
  return (
    <div className="wso2-search-panel__filters">
      {groups.map(([key, label, items]) => (
        <div key={key} className="wso2-search-panel__chips" role="group" aria-label={label}>
          <span className="wso2-search-panel__chips-label">{label}</span>
          {items.map((it) => (
            <button key={it.id} type="button" aria-pressed={chips[key].includes(it.id)} className="wso2-search-chip"
              onClick={() => setChips({ ...chips, [key]: toggle(chips[key], it.id) })}>
              {it.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Hit({ hit, ctx, manifest, scope, active, onNavigate, linkRef }) {
  const history = useHistory();
  const t = hitTarget(hit, ctx, manifest);
  const title = hit.lvl3 ? 'lvl3' : hit.lvl2 ? 'lvl2' : 'lvl1';
  // A Cloud part's hits start with "<Component> Cloud" (lvl0), a family Cloud's with its name.
  const crumbs = [hit.lvl0 || hit.docSpaceName, title !== 'lvl1' ? hit.lvl1 : null, title === 'lvl3' ? hit.lvl2 : null].filter(Boolean).join(' › ');
  const onClick = (e) => {
    onNavigate?.(t);
    if (!t.sameDeployment || e.metaKey || e.ctrlKey || e.shiftKey) return; // full-page navigation
    e.preventDefault();
    history.push(t.href);
  };
  return (
    <li className="wso2-search-hit" data-active={active || undefined} role="option" aria-selected={active}>
      <a href={t.href} onClick={onClick} ref={linkRef} data-same-deployment={t.sameDeployment}>
        <span className="wso2-search-hit__crumbs">{crumbs}</span>
        <span className="wso2-search-hit__title">
          <Highlight attribute={title} hit={hit} />
          {scope !== 'edition' && <span className="wso2-search-hit__badge">{editionLabel(hit, manifest, { withName: scope !== 'docspace' })}</span>}
          {/* A Self-hosted addition in Cloud's records. */}
          {hit.selfHosted && hit.edition === 'cloud' && <span className="wso2-search-hit__badge">Self-hosted</span>}
        </span>
        {hit.content && <span className="wso2-search-hit__snippet"><Snippet attribute="content" hit={hit} /></span>}
      </a>
    </li>
  );
}

function Hits({ ctx, manifest, scope, query, onNavigate, cursor, setCount, links }) {
  const { items } = useHits();
  const { results, status } = useInstantSearch();
  useEffect(() => { setCount(items.length); }, [items.length]);
  // Analytics: one event once the reader pauses typing.
  useEffect(() => {
    if (!query) return undefined;
    const t = setTimeout(() => trackSearch({ query, scope, results: results?.nbHits ?? 0 }), 1200);
    return () => clearTimeout(t);
  }, [query, scope, results?.nbHits]);
  const label = scopeLabel(scope, ctx, manifest);
  if (!query) return <p className="wso2-search-panel__hint">Type to search {scope === 'all' ? 'all of WSO2 Docs' : scope === 'section' ? label : label.toLowerCase()}.</p>;
  if (status === 'error') return <p className="wso2-search-panel__hint">Search is unavailable right now. Try again in a moment.</p>;
  const wider = { section: '. Try All of WSO2 Docs.', edition: '. Try a wider scope.', docspace: '.', all: '.' }[scope] ?? '.';
  if (!items.length && status === 'idle') return <p className="wso2-search-panel__hint">No results for “{query}”{wider}</p>;
  return (
    <ul className="wso2-search-panel__hits" role="listbox" aria-label="Search results">
      {items.map((hit, i) => (
        <Hit key={hit.objectID} hit={hit} ctx={ctx} manifest={manifest} scope={scope} active={i === cursor} onNavigate={onNavigate}
          linkRef={(el) => { links.current[i] = el; }} />
      ))}
    </ul>
  );
}

function Pages() {
  const { pages, currentRefinement, nbPages, refine } = usePagination();
  if (nbPages < 2) return null;
  return (
    <nav className="wso2-search-panel__pages" aria-label="Result pages">
      {pages.map((p) => (
        <button key={p} type="button" className="wso2-search-chip" aria-current={p === currentRefinement ? 'page' : undefined} onClick={() => refine(p)}>{p + 1}</button>
      ))}
    </nav>
  );
}

export default function SearchPanel({ ctx, manifest, env, scopes, initialScope, initialQuery = '', hitsPerPage = 8, layout = 'modal', onNavigate, onChange }) {
  const [scope, setScope] = useState(initialScope ?? scopes[0]);
  const [query, setQuery] = useState(initialQuery);
  const [chips, setChips] = useState({ editions: [], docSpaces: [], families: [] });
  const [cursor, setCursor] = useState(-1);
  const [count, setCount] = useState(0);
  const links = useRef([]);
  const remembered = useMemo(() => readRemembered(typeof localStorage === 'undefined' ? null : localStorage, Object.keys(manifest.docSpaces ?? {})), [manifest]);
  const client = useMemo(() => createSearchClient(env, (s) => searchParameters(s, { analyticsTag: analyticsTag(ctx) })), [env]);
  client.setScope(scope);
  const filters = buildFilter({ scope, ctx, manifest, remembered, chips });
  const options = chipOptions(scope, ctx, manifest, remembered);
  useEffect(() => { setCursor(-1); }, [query, scope, filters]);
  useEffect(() => { onChange?.({ query, scope }); }, [query, scope]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(cursor + 1, count - 1) : Math.max(cursor - 1, -1);
      setCursor(next);
      links.current[next]?.scrollIntoView?.({ block: 'nearest' });
    } else if (e.key === 'Enter' && cursor >= 0) {
      e.preventDefault();
      links.current[cursor]?.click();
    }
  };

  return (
    <div className={`wso2-search-panel wso2-search-panel--${layout}`}>
      <InstantSearch searchClient={client} indexName={env.collection} future={{ preserveSharedStateOnUnmount: true }}>
        <Configure filters={filters} hitsPerPage={hitsPerPage} />
        <QueryBox query={query} setQuery={setQuery} onKeyDown={onKeyDown} autoFocus />
        <ScopeSwitch scopes={scopes} scope={scope} ctx={ctx} manifest={manifest} setScope={(s) => { setScope(s); setChips({ editions: [], docSpaces: [], families: [] }); }} />
        <Chips options={options} chips={chips} setChips={setChips} manifest={manifest} ctx={ctx} />
        <Hits ctx={ctx} manifest={manifest} scope={scope} query={query} onNavigate={onNavigate} cursor={cursor} setCount={setCount} links={links} />
        {layout === 'page' && <Pages />}
      </InstantSearch>
      {layout === 'modal' && (
        <footer className="wso2-search-panel__footer">
          <span className="wso2-search-panel__keys"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close</span>
          <a href={searchPageUrl({ query, scope, ctx })} className="wso2-search-panel__all">See all results</a>
        </footer>
      )}
    </div>
  );
}
