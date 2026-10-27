// Object storage behind the release pipeline. Every backend offers the same
// small interface, so publish, flip, GC and redirect compilation never know
// where the bytes live:
//   get(key) -> { body: Uint8Array, contentType, etag } | null
//   put(key, body, { contentType, cacheControl })
//   putIf(key, body, { ifNoneMatch: '*' } | { ifMatch: etag }) -> written?
//                                  a conditional write, for the state lock
//   list(prefix) -> [key]          every key under prefix
//   listFolders(prefix) -> [name]  immediate child "folders" of prefix
//   delete(keys)
// Backends: a local folder (tests, dry runs), an R2 binding (Miniflare or a
// Worker), and the S3-compatible API that R2 exposes (CI). Azure Blob, the
// fallback in ticket 11, would be a fourth class with the same five methods.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.yaml': 'application/yaml', '.yml': 'application/yaml', '.pdf': 'application/pdf', '.map': 'application/json',
};

export function contentTypeFor(key) {
  return TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
}

const toBytes = (body) => (typeof body === 'string' ? new TextEncoder().encode(body) : body);
const etagOf = (body) => `"${crypto.createHash('md5').update(body).digest('hex')}"`;

// Runs fn over items with at most `limit` in flight.
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class FsStorage {
  constructor(root) {
    this.root = path.resolve(root);
    this.name = `file:${this.root}`;
  }

  #file(key) {
    const file = path.join(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Key escapes the storage root: ${key}`);
    return file;
  }

  async get(key) {
    const file = this.#file(key);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    const body = fs.readFileSync(file);
    return { body, contentType: contentTypeFor(key), etag: etagOf(body) };
  }

  // Create-if-absent is atomic across processes (a hard link fails if the
  // file exists); replace-if-unchanged compares then renames, which is atomic
  // only within one process. Enough for tests and local rehearsals.
  async putIf(key, body, { ifNoneMatch, ifMatch } = {}) {
    const file = this.#file(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, toBytes(body));
    try {
      if (ifNoneMatch === '*') {
        try {
          fs.linkSync(tmp, file);
          return true;
        } catch (err) {
          if (err.code === 'EEXIST') return false;
          throw err;
        }
      }
      if (!fs.existsSync(file) || etagOf(fs.readFileSync(file)) !== ifMatch) return false;
      fs.renameSync(tmp, file);
      return true;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  async put(key, body) {
    const file = this.#file(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write then rename, so a reader never sees half a file.
    fs.writeFileSync(`${file}.tmp`, toBytes(body));
    fs.renameSync(`${file}.tmp`, file);
  }

  async list(prefix) {
    const out = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(path.relative(this.root, p).split(path.sep).join('/'));
      }
    };
    walk(this.root);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }

  async listFolders(prefix) {
    const dir = path.join(this.root, prefix);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  }

  async delete(keys) {
    for (const key of keys) {
      const file = this.#file(key);
      fs.rmSync(file, { force: true });
      // Object stores have no empty folders; neither does this one.
      for (let dir = path.dirname(file); dir.startsWith(this.root + path.sep) && fs.existsSync(dir) && !fs.readdirSync(dir).length; dir = path.dirname(dir)) {
        fs.rmdirSync(dir);
      }
    }
  }
}

// An R2 bucket binding: Miniflare's getR2Bucket() in tests, or env.DOCS inside a Worker.
export class R2BindingStorage {
  constructor(bucket, name = 'r2-binding') {
    this.bucket = bucket;
    this.name = name;
  }

  async get(key) {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return { body: new Uint8Array(await obj.arrayBuffer()), contentType: obj.httpMetadata?.contentType ?? contentTypeFor(key), etag: obj.httpEtag };
  }

  async putIf(key, body, { ifNoneMatch, ifMatch, contentType } = {}) {
    const onlyIf = ifNoneMatch === '*' ? { etagDoesNotMatch: '*' } : { etagMatches: String(ifMatch).replace(/^"|"$/g, '') };
    const r = await this.bucket.put(key, toBytes(body), { onlyIf, httpMetadata: { contentType: contentType ?? contentTypeFor(key) } });
    return r !== null;
  }

  async put(key, body, { contentType, cacheControl } = {}) {
    await this.bucket.put(key, toBytes(body), {
      httpMetadata: { contentType: contentType ?? contentTypeFor(key), ...(cacheControl ? { cacheControl } : {}) },
    });
  }

  async #page(prefix, delimiter) {
    const keys = [];
    const folders = [];
    let cursor;
    do {
      const r = await this.bucket.list({ prefix, cursor, ...(delimiter ? { delimiter } : {}) });
      keys.push(...r.objects.map((o) => o.key));
      folders.push(...(r.delimitedPrefixes ?? []));
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return { keys, folders };
  }

  async list(prefix) {
    return (await this.#page(prefix)).keys.sort();
  }

  async listFolders(prefix) {
    const { folders } = await this.#page(prefix, '/');
    return folders.map((f) => f.slice(prefix.length).replace(/\/$/, '')).sort();
  }

  async delete(keys) {
    for (let i = 0; i < keys.length; i += 1000) await this.bucket.delete(keys.slice(i, i + 1000));
  }
}

const xmlText = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tagValues = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => xmlText(m[1]));
const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/');

// R2 through its S3-compatible API (path-style URLs, SigV4 via aws4fetch).
// Production endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com (pending infra, ticket 15).
// Locally, Miniflare serves the same API at <origin>/cdn-cgi/local/r2/s3.
export class S3Storage {
  constructor({ endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto', concurrency = 16 }) {
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('S3 storage needs an endpoint, a bucket, an access key ID and a secret access key');
    }
    this.base = `${endpoint.replace(/\/$/, '')}/${bucket}`;
    this.client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region });
    this.concurrency = concurrency;
    this.name = `s3:${this.base}`;
  }

  async #fetch(url, init = {}, okStatuses = [200]) {
    for (let attempt = 1; ; attempt++) {
      const res = await this.client.fetch(url, init);
      if (okStatuses.includes(res.status)) return res;
      const body = await res.text();
      if (res.status < 500 || attempt >= 3) throw new Error(`${init.method ?? 'GET'} ${url}: ${res.status} ${body.slice(0, 300)}`);
    }
  }

  async get(key) {
    const res = await this.#fetch(`${this.base}/${encodeKey(key)}`, {}, [200, 404]);
    if (res.status === 404) return null;
    return { body: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? contentTypeFor(key), etag: res.headers.get('etag') };
  }

  // R2's S3 API (like S3's) honours If-None-Match: * and If-Match on PUT:
  // 412 when the condition fails, 409 when another conditional write to the
  // key is in flight, 404 for If-Match on a missing key.
  async putIf(key, body, { ifNoneMatch, ifMatch, contentType } = {}) {
    const headers = { 'content-type': contentType ?? contentTypeFor(key), ...(ifNoneMatch ? { 'if-none-match': ifNoneMatch } : { 'if-match': ifMatch }) };
    const res = await this.#fetch(`${this.base}/${encodeKey(key)}`, { method: 'PUT', body: toBytes(body), headers }, [200, 404, 409, 412]);
    await res.arrayBuffer();
    return res.status === 200;
  }

  async put(key, body, { contentType, cacheControl } = {}) {
    const headers = { 'content-type': contentType ?? contentTypeFor(key), ...(cacheControl ? { 'cache-control': cacheControl } : {}) };
    await this.#fetch(`${this.base}/${encodeKey(key)}`, { method: 'PUT', body: toBytes(body), headers });
  }

  async #page(prefix, delimiter) {
    const keys = [];
    const folders = [];
    let token;
    do {
      const q = new URLSearchParams({ 'list-type': '2', prefix, ...(delimiter ? { delimiter } : {}), ...(token ? { 'continuation-token': token } : {}) });
      const xml = await (await this.#fetch(`${this.base}?${q}`)).text();
      keys.push(...tagValues(xml, 'Key'));
      for (const block of xml.match(/<CommonPrefixes>[\s\S]*?<\/CommonPrefixes>/g) ?? []) folders.push(...tagValues(block, 'Prefix'));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? tagValues(xml, 'NextContinuationToken')[0] : undefined;
    } while (token);
    return { keys, folders };
  }

  async list(prefix) {
    return (await this.#page(prefix)).keys.sort();
  }

  async listFolders(prefix) {
    const { folders } = await this.#page(prefix, '/');
    return folders.map((f) => f.slice(prefix.length).replace(/\/$/, '')).sort();
  }

  async delete(keys) {
    await pool(keys, this.concurrency, (key) => this.#fetch(`${this.base}/${encodeKey(key)}`, { method: 'DELETE' }, [200, 204, 404]));
  }
}

// Storage from a CLI spec:
//   file:<dir>      a local folder
//   s3://<bucket>   R2's S3 API; endpoint and keys from R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
export function openStorage(spec, env = process.env) {
  if (spec.startsWith('file:')) return new FsStorage(spec.slice('file:'.length));
  const m = /^s3:\/\/([^/]+)\/?$/.exec(spec);
  if (m) {
    return new S3Storage({
      endpoint: env.R2_ENDPOINT, bucket: m[1],
      accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    });
  }
  throw new Error(`Unknown storage "${spec}": use file:<dir> or s3://<bucket>`);
}
