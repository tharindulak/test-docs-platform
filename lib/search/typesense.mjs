// A small Typesense REST client for the pipeline (indexing, consistency check,
// setup), plus scoped search-only key generation for browsers. Uses fetch, so
// tests can pass a fake. The admin key is only ever held by the pipeline.
import crypto from 'node:crypto';

export class TypesenseError extends Error {
  constructor(status, message) {
    super(`Typesense ${status}: ${message}`);
    this.status = status;
  }
}

export function typesenseClient({ url, apiKey, fetch: doFetch = globalThis.fetch, timeoutMs = 60_000 }) {
  if (!url) throw new Error('Typesense URL is required (TYPESENSE_URL)');
  if (!apiKey) throw new Error('Typesense admin key is required (TYPESENSE_ADMIN_KEY)');
  const base = url.replace(/\/$/, '');

  async function request(method, path, { query, body, raw = false, ok = [] } = {}) {
    const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined))}` : '';
    const res = await doFetch(`${base}${path}${qs}`, {
      method,
      headers: { 'X-TYPESENSE-API-KEY': apiKey, ...(body !== undefined ? { 'Content-Type': raw ? 'text/plain' : 'application/json' } : {}) },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok && !ok.includes(res.status)) {
      let message = text;
      try {
        message = JSON.parse(text).message ?? text;
      } catch {
        // not JSON
      }
      throw new TypesenseError(res.status, message);
    }
    return { status: res.status, text, json: () => (text ? JSON.parse(text) : null) };
  }

  return {
    url: base,
    request,
    async health() {
      return (await request('GET', '/health')).json();
    },
    async getCollection(name) {
      const r = await request('GET', `/collections/${encodeURIComponent(name)}`, { ok: [404] });
      return r.status === 404 ? null : r.json();
    },
    async createCollection(schema) {
      return (await request('POST', '/collections', { body: schema })).json();
    },
    async updateCollection(name, patch) {
      return (await request('PATCH', `/collections/${encodeURIComponent(name)}`, { body: patch })).json();
    },
    async dropCollection(name) {
      await request('DELETE', `/collections/${encodeURIComponent(name)}`, { ok: [404] });
    },
    // Upserts documents in batches. Throws if any document failed, so the
    // caller never goes on to delete stale records after a partial import.
    async importDocuments(name, docs, { action = 'upsert', batchSize = 500 } = {}) {
      let imported = 0;
      const failures = [];
      for (let i = 0; i < docs.length; i += batchSize) {
        const chunk = docs.slice(i, i + batchSize);
        const r = await request('POST', `/collections/${encodeURIComponent(name)}/documents/import`, {
          query: { action, batch_size: String(batchSize) },
          body: chunk.map((d) => JSON.stringify(d)).join('\n'),
          raw: true,
        });
        r.text.split('\n').filter(Boolean).forEach((line, j) => {
          const result = JSON.parse(line);
          if (result.success) imported += 1;
          else failures.push({ id: chunk[j]?.id, error: result.error });
        });
      }
      if (failures.length) {
        const err = new Error(`${failures.length} of ${docs.length} documents failed to import (first: ${failures[0].id}: ${failures[0].error})`);
        err.failures = failures;
        throw err;
      }
      return { imported };
    },
    async deleteByFilter(name, filterBy) {
      const r = await request('DELETE', `/collections/${encodeURIComponent(name)}/documents`, { query: { filter_by: filterBy, batch_size: '500' } });
      return r.json().num_deleted ?? 0;
    },
    async exportDocuments(name, { filterBy, includeFields } = {}) {
      const r = await request('GET', `/collections/${encodeURIComponent(name)}/documents/export`, { query: { filter_by: filterBy, include_fields: includeFields } });
      return r.text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
    async search(name, params) {
      return (await request('GET', `/collections/${encodeURIComponent(name)}/documents/search`, { query: params })).json();
    },
    async createKey(spec) {
      const r = await request('POST', '/keys', { body: spec, ok: [409] });
      return r.status === 409 ? { ...spec, existed: true } : r.json();
    },
    // Every key but the bootstrap admin key, each with its value_prefix (the
    // full value is only ever returned when the key is made).
    async listKeys() {
      return (await request('GET', '/keys')).json().keys ?? [];
    },
    // → { id }, or null when there is no such key.
    async deleteKey(id) {
      const r = await request('DELETE', `/keys/${encodeURIComponent(id)}`, { ok: [404] });
      return r.status === 404 ? null : r.json();
    },
    async upsertAnalyticsRule(rule) {
      const { name, ...rest } = rule;
      return (await request('PUT', `/analytics/rules/${encodeURIComponent(name)}`, { body: rest })).json();
    },
    async flushAnalytics() {
      return (await request('POST', '/analytics/flush')).json();
    },
  };
}

// Typesense scoped API key: base64(HMAC-SHA256(parent, params) + parent[0..4] + params).
// The parent must be a search-only key; the embedded parameters cannot be
// overridden by the browser.
export function scopedSearchKey(searchOnlyKey, embedded = {}) {
  const params = JSON.stringify(embedded);
  const digest = crypto.createHmac('sha256', searchOnlyKey).update(params).digest('base64');
  return Buffer.from(`${digest}${searchOnlyKey.slice(0, 4)}${params}`).toString('base64');
}

// Retries with backoff; a failed search update alerts but never blocks a release.
export async function withRetry(fn, { attempts = 3, delayMs = 2000, onRetry = () => {} } = {}) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      if (i < attempts) {
        onRetry(err, i);
        await new Promise((r) => setTimeout(r, delayMs * 2 ** (i - 1)));
      }
    }
  }
  throw last;
}
