// Runs the Edge Worker locally in Miniflare with local R2 (exposed through its
// S3-compatible API, so bin/wso2-release.mjs publishes to it exactly as CI
// publishes to R2), local KV and stub Analytics Engine datasets. Used by the
// end-to-end tests and by `npm run edge:local`:
//   npm run edge:local -- [--port 4180] [--data <dir>] [--env staging|production] [--admin-port <port+1>]
//     the Edge Worker with that environment's rules on 127.0.0.1:<port>, its
//     R2 and KV kept in <dir> (default .cache/edge). It writes <dir>/edge.env
//     with the R2_* variables, and serves a local KV endpoint on the admin
//     port, so the release CLI runs exactly as in CI:
//   source <dir>/edge.env
//   node bin/wso2-release.mjs publish --storage s3://docs-staging ...
//   node bin/wso2-release.mjs redirects --storage s3://docs-staging --kv local:http://127.0.0.1:<admin-port>
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LOCAL_CREDENTIALS = { accessKeyId: 'local-key', secretAccessKey: 'local-secret' };

// The vars of one environment in worker/wrangler.jsonc (comment lines stripped).
export function wranglerVars(env) {
  const src = fs.readFileSync(path.join(here, 'wrangler.jsonc'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const config = JSON.parse(src);
  return env ? config.env[env].vars : config.vars;
}

export function edgeOptions({ port, persist, vars }) {
  const srcDir = path.join(here, 'src');
  const modules = fs.readdirSync(srcDir).filter((f) => f.endsWith('.mjs'))
    .sort((a, b) => (a === 'index.mjs' ? -1 : b === 'index.mjs' ? 1 : a.localeCompare(b)))
    .map((f) => ({ type: 'ESModule', path: path.join(srcDir, f) }));
  return convertV4MiniflareOptions({
    modulesRoot: srcDir,
    modules,
    compatibilityDate: '2026-09-01',
    host: '127.0.0.1',
    port,
    ...(persist ? { resourcePersistencePath: persist } : {}),
    r2Buckets: {
      DOCS: { id: 'docs-staging', s3Credentials: LOCAL_CREDENTIALS },
      PREVIEWS: { id: 'docs-previews', s3Credentials: LOCAL_CREDENTIALS },
    },
    kvNamespaces: { REDIRECTS: 'redirects' },
    analyticsEngineDatasets: { FEEDBACK: { dataset: 'docs_feedback' }, NOT_FOUND: { dataset: 'docs_not_found' } },
    bindings: vars,
  });
}

export async function startLocalEdge({ port = 4180, persist, env = 'staging', vars = {} } = {}) {
  const options = (v) => edgeOptions({ port, persist, vars: { ...wranglerVars(env), MANIFEST_TTL_SECONDS: '0', ...v } });
  const mf = new Miniflare(options(vars));
  const origin = (await mf.ready).origin;
  return {
    mf,
    origin,
    s3: { R2_ENDPOINT: `${origin}/cdn-cgi/local/r2/s3`, R2_ACCESS_KEY_ID: LOCAL_CREDENTIALS.accessKeyId, R2_SECRET_ACCESS_KEY: LOCAL_CREDENTIALS.secretAccessKey },
    // Swap in another environment's vars on the same data (e.g. production rules).
    reconfigure: (nextEnv, v = {}) => mf.setOptions(edgeOptions({ port, persist, vars: { ...wranglerVars(nextEnv), MANIFEST_TTL_SECONDS: '0', ...v } })),
  };
}

// The local KV endpoint behind `--kv local:<url>` (lib/kv.mjs localKv): the
// Workers KV binding the local edge reads redirects from, on 127.0.0.1 only.
//   POST /kv/put     [{ key, value }]
//   POST /kv/delete  [key]
//   GET  /kv/<key>   the value, or 404
export function startKvEndpoint(edge, { port }) {
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const kv = await edge.mf.getKVNamespace('REDIRECTS');
      const url = new URL(req.url, 'http://local');
      if (req.method === 'GET' && url.pathname.startsWith('/kv/')) {
        const value = await kv.get(decodeURIComponent(url.pathname.slice('/kv/'.length)));
        return value === null ? send(404, { error: 'no such key' }) : send(200, { value });
      }
      if (req.method !== 'POST' || !['/kv/put', '/kv/delete'].includes(url.pathname)) return send(404, { error: 'POST /kv/put or /kv/delete, or GET /kv/<key>' });
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const list = JSON.parse(Buffer.concat(chunks).toString('utf8') || '[]');
      if (!Array.isArray(list)) return send(400, { error: 'expected a JSON list' });
      for (const item of list) await (url.pathname === '/kv/put' ? kv.put(item.key, item.value) : kv.delete(item));
      return send(200, { ok: true, count: list.length });
    } catch (err) {
      return send(500, { error: err.message });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: o } = parseArgs({ options: { port: { type: 'string' }, data: { type: 'string' }, env: { type: 'string' }, 'admin-port': { type: 'string' } } });
  const port = Number(o.port ?? process.env.PORT ?? 4180);
  const persist = path.resolve(o.data ?? path.join(here, '..', '.cache', 'edge'));
  const env = o.env ?? 'staging';
  if (!['staging', 'production'].includes(env)) throw new Error(`--env is staging or production, not "${env}"`);
  const edge = await startLocalEdge({ port, persist, env });
  const kv = await startKvEndpoint(edge, { port: Number(o['admin-port'] ?? port + 1) });
  fs.mkdirSync(persist, { recursive: true });
  const envFile = path.join(persist, 'edge.env');
  fs.writeFileSync(envFile, `${Object.entries(edge.s3).map(([k, v]) => `export ${k}=${v}`).join('\n')}\n`);
  console.log(`Edge Worker (${env} rules) at ${edge.origin}, data in ${persist} (pid ${process.pid})`);
  console.log(`Publish to it after: source ${envFile}`);
  for (const [k, v] of Object.entries(edge.s3)) console.log(`  export ${k}=${v}`);
  console.log(`Redirect table: node bin/wso2-release.mjs redirects --storage s3://docs-staging --kv local:${kv.url}`);
  const stop = async () => {
    await kv.close();
    await edge.mf.dispose();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
