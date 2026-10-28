// Where browsers search, per environment. Release builds are promoted byte for
// byte from staging to production, so every build carries both endpoints and
// the browser picks one by the host it is served from. Keys here are scoped
// search-only keys (public by design); the admin key never reaches a build.
export const COLLECTIONS = { production: 'wso2docs-production', staging: 'wso2docs-staging', local: 'wso2docs-local' };

// Local preview only (search/docker-compose.yml): never used on a real host.
export const LOCAL = { adminKey: 'local-preview-key', searchKey: 'local-preview-search', port: 8108 };

export const SEARCH_ENVIRONMENTS = {
  // PENDING INFRA (Confirm docs hosting facts): production search hosting
  // (3-node cluster or Typesense Cloud) is decided with infra.
  production: { url: 'https://search.docs.wso2.com', collection: COLLECTIONS.production, siteHosts: ['docs.wso2.com'] },
  // The Pilot's single container on the 141 VM (hosting/vm/): its Caddy publishes
  // only the search endpoints at /_typesense/, with CORS for the staging host.
  // worker/wrangler.jsonc env.staging TYPESENSE_HOST is the same URL.
  staging: { url: 'https://141-148-145-173.sslip.io/_typesense', collection: COLLECTIONS.staging, siteHosts: ['wso2-docs-site.tharinduj.workers.dev', 'docs-staging.wso2.com'] },
};

// Build time: the search block baked into customFields. Keys come from the
// WSO2_DOCS_SEARCH_KEY_<ENV> variables (scoped keys from `wso2-release search-key`).
export function searchConfigFromEnv(env = {}) {
  const environments = {};
  for (const [name, e] of Object.entries(SEARCH_ENVIRONMENTS)) {
    environments[name] = { url: env[`WSO2_DOCS_SEARCH_URL_${name.toUpperCase()}`] ?? e.url, collection: e.collection, siteHosts: e.siteHosts, key: env[`WSO2_DOCS_SEARCH_KEY_${name.toUpperCase()}`] ?? null };
  }
  if (env.WSO2_DOCS_SEARCH_ENV === 'local') {
    environments.local = { url: env.WSO2_DOCS_SEARCH_URL ?? `http://localhost:${LOCAL.port}`, collection: COLLECTIONS.local, siteHosts: [], key: LOCAL.searchKey };
  }
  return { force: env.WSO2_DOCS_SEARCH_ENV ?? null, environments };
}

// Browser: the environment for this host, or null (search is then shown as
// unavailable rather than querying the wrong index).
export function pickEnvironment(config, hostname) {
  if (!config?.environments) return null;
  const e = config.force ? config.environments[config.force] : Object.values(config.environments).find((x) => x.siteHosts?.includes(hostname));
  return e?.key && e.url ? e : null;
}
