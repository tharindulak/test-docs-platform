// Where the compiled redirect table goes: Workers KV, read by the Edge Worker.
// Every sink offers putMany([{ key, value }]) and deleteMany([key]).
//   binding     a KV binding (Miniflare's getKVNamespace() in tests)
//   cloudflare  the Cloudflare REST bulk API (CI; needs real IDs, pending infra)
//   file        a JSON file, for dry runs
//   local       the local edge's KV endpoint (worker/local.mjs), for rehearsals
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './storage.mjs';

export function bindingKv(binding) {
  return {
    putMany: (entries) => pool(entries, 8, ({ key, value }) => binding.put(key, value)),
    deleteMany: (keys) => pool(keys, 8, (key) => binding.delete(key)),
  };
}

export function fileKv(file) {
  const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  const write = (data) => {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  };
  return {
    async putMany(entries) {
      const data = read();
      for (const { key, value } of entries) data[key] = value;
      write(data);
    },
    async deleteMany(keys) {
      const data = read();
      for (const key of keys) delete data[key];
      write(data);
    },
  };
}

// https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/ (bulk write and bulk delete, 10,000 keys per call).
export function cloudflareKv({ accountId, namespaceId, apiToken, fetchImpl = fetch }) {
  if (!accountId || !namespaceId || !apiToken) throw new Error('Cloudflare KV needs CLOUDFLARE_ACCOUNT_ID, a namespace ID and CLOUDFLARE_API_TOKEN');
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const call = async (url, method, body) => {
    const res = await fetchImpl(url, { method, headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  };
  const chunks = (list) => Array.from({ length: Math.ceil(list.length / 10_000) }, (_, i) => list.slice(i * 10_000, (i + 1) * 10_000));
  return {
    async putMany(entries) {
      for (const c of chunks(entries)) await call(`${base}/bulk`, 'PUT', c);
    },
    async deleteMany(keys) {
      for (const c of chunks(keys)) await call(`${base}/bulk/delete`, 'POST', c);
    },
  };
}

// The local edge's KV endpoint (`npm run edge:local` prints its URL).
export function localKv(url, { fetchImpl = fetch } = {}) {
  const base = url.replace(/\/$/, '');
  const call = async (op, body) => {
    const res = await fetchImpl(`${base}/kv/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`local KV ${op}: ${res.status} ${await res.text()}`);
  };
  return {
    putMany: async (entries) => {
      for (let i = 0; i < entries.length; i += 1000) await call('put', entries.slice(i, i + 1000));
    },
    deleteMany: async (keys) => {
      for (let i = 0; i < keys.length; i += 1000) await call('delete', keys.slice(i, i + 1000));
    },
  };
}

// KV sink from a CLI spec: file:<path>, cloudflare:<namespace-id> or local:<url>.
export function openKv(spec, env = process.env) {
  if (spec.startsWith('file:')) return fileKv(spec.slice('file:'.length));
  if (spec.startsWith('local:')) return localKv(spec.slice('local:'.length));
  if (spec.startsWith('cloudflare:')) {
    return cloudflareKv({ accountId: env.CLOUDFLARE_ACCOUNT_ID, namespaceId: spec.slice('cloudflare:'.length), apiToken: env.CLOUDFLARE_API_TOKEN });
  }
  throw new Error(`Unknown KV "${spec}": use file:<path>, cloudflare:<namespace-id> or local:<url>`);
}
