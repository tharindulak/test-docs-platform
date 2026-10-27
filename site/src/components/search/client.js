// The InstantSearch client on the Typesense adapter. Only the lazily loaded
// pop-up and the search page import it, so it stays out of the main bundle.
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';

// A per-tab random id, so Typesense aggregates one reader's keystrokes into
// one popular query. No cookie, nothing personal, gone with the tab.
function sessionId() {
  try {
    let id = sessionStorage.getItem('wso2docs:search-session');
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('wso2docs:search-session', id);
    }
    return id;
  } catch {
    return undefined;
  }
}

const emptyResults = (requests) => ({
  results: requests.map((r) => ({ hits: [], nbHits: 0, nbPages: 0, page: 0, hitsPerPage: r.params?.hitsPerPage ?? 0, processingTimeMS: 0, exhaustiveNbHits: true, query: '', params: '' })),
});

// One adapter per parameter set (sort order differs by scope); the returned
// client sends each search through the current scope's adapter, so the
// InstantSearch state (query, page) survives a scope switch. Empty queries
// are answered locally.
export function createSearchClient(env, paramsFor) {
  const u = new URL(env.url);
  const userId = sessionId();
  const adapters = {};
  const adapterFor = (scope) => {
    adapters[scope] ??= new TypesenseInstantSearchAdapter({
      server: {
        apiKey: env.key,
        nodes: [{ host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)), protocol: u.protocol.replace(':', ''), path: u.pathname.replace(/\/$/, '') }],
        cacheSearchResultsForSeconds: 60,
        ...(userId ? { additionalHeaders: { 'X-TYPESENSE-USER-ID': userId } } : {}),
      },
      additionalSearchParameters: paramsFor(scope),
    });
    return adapters[scope];
  };
  let current = null;
  return {
    setScope(scope) {
      current = scope;
    },
    search(requests) {
      if (requests.every((r) => !r.params?.query)) return Promise.resolve(emptyResults(requests));
      return adapterFor(current).searchClient.search(requests);
    },
  };
}
