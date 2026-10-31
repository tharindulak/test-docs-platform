// The 141 VM's search kit (hosting/vm/, spec/edge-and-hosting.md VM search):
// setup.sh, the docs-platform-gate allow-list run against a temporary folder
// and a stand-in Typesense (it needs flock, so Linux), the Caddy snippet, the
// Typesense compose file, CI's upload-and-gate script, and the staging search
// host shared by the browser, the Edge Worker and the Caddy snippet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { loadPolicy } from '../lib/manifest.mjs';
import { flip, publishRelease } from '../lib/release.mjs';
import { FsStorage } from '../lib/storage.mjs';
import { COMPOSED_KEY } from '../lib/compose.mjs';
import { exportSearchInputs } from '../lib/search/indexing.mjs';
import { COLLECTIONS, SEARCH_ENVIRONMENTS } from '../lib/search/environments.mjs';
import { scopedSearchKey } from '../lib/search/typesense.mjs';
import { wranglerVars } from '../worker/local.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = path.join(root, 'hosting', 'vm');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-vm-search-'));
const which = (bin) => (process.env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, bin)).find((f) => fs.existsSync(f)) ?? null;
const scripts = ['setup.sh', 'docs-platform-gate', 'search-via-gate.sh'].map((f) => path.join(kit, f));
const STAGING_HOST = '141-148-145-173.sslip.io';

test('the kit\'s scripts parse, are executable, and pass shellcheck when it is installed', () => {
  for (const f of scripts) {
    execFileSync('bash', ['-n', f]);
    assert.ok(fs.statSync(f).mode & 0o111, `${path.basename(f)} is executable`);
  }
  const shellcheck = which('shellcheck');
  if (!shellcheck) return;
  const r = spawnSync(shellcheck, scripts, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});

test('staging searches the 141 VM at https://<host>/_typesense: the browser, the Edge Worker and the Caddy snippet agree', () => {
  const url = `https://${STAGING_HOST}/_typesense`;
  assert.equal(SEARCH_ENVIRONMENTS.staging.url, url);
  const vars = wranglerVars('staging');
  assert.equal(vars.TYPESENSE_HOST, url, 'worker/wrangler.jsonc env.staging');
  assert.equal(vars.TYPESENSE_COLLECTION, COLLECTIONS.staging);
  assert.ok(!('TYPESENSE_SEARCH_KEY' in vars), 'the Worker\'s key is a secret, never a var');
  assert.ok(SEARCH_ENVIRONMENTS.staging.siteHosts.includes(vars.DOCS_HOST), 'pages on the staging host pick the staging index');
  const snippet = execFileSync('bash', [path.join(kit, 'setup.sh'), 'snippet', '--host', STAGING_HOST], { encoding: 'utf8' });
  assert.match(snippet, new RegExp(`^${STAGING_HOST.replaceAll('.', '\\.')}/_typesense/\\* \\{$`, 'm'), 'a path-scoped site address: other routes of the host stay as they are');
  assert.match(snippet, new RegExp(`Access-Control-Allow-Origin "https://${vars.DOCS_HOST.replaceAll('.', '\\.')}"`), 'CORS for the staging origin by default');
  const readme = fs.readFileSync(path.join(kit, 'README.md'), 'utf8');
  assert.match(readme, new RegExp(`--host ${STAGING_HOST.replaceAll('.', '\\.')}`));
});

test('the Caddy preflight allows every header the browser\'s search client sends, or the browser blocks every search', () => {
  // The Typesense adapter sends the key; client.js adds the analytics user id.
  const client = fs.readFileSync(path.join(root, 'site/src/components/search/client.js'), 'utf8');
  const sent = ['Content-Type', 'X-TYPESENSE-API-KEY', ...[...client.matchAll(/'(X-TYPESENSE-[A-Z-]+)'/g)].map((m) => m[1])];
  assert.ok(sent.includes('X-TYPESENSE-USER-ID'), 'the client sends the analytics user id');
  const snippet = execFileSync('bash', [path.join(kit, 'setup.sh'), 'snippet', '--host', 'search.example', '--cors-origin', 'https://site.example'], { encoding: 'utf8' });
  const allowed = (snippet.match(/Access-Control-Allow-Headers "([^"]*)"/)?.[1] ?? '').split(',').map((h) => h.trim().toLowerCase());
  for (const h of new Set(sent)) assert.ok(allowed.includes(h.toLowerCase()), `${h} is allowed by the preflight`);
});

test('the Caddy snippet publishes only Typesense\'s search endpoints, to loopback 8109', () => {
  const snippet = execFileSync('bash', [path.join(kit, 'setup.sh'), 'snippet', '--host', 'search.example', '--cors-origin', 'https://site.example'], { encoding: 'utf8' });
  const upstreams = [...snippet.matchAll(/reverse_proxy (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(upstreams, ['127.0.0.1:8109', '127.0.0.1:8109', '127.0.0.1:8109']);
  const handled = [...snippet.matchAll(/handle (@\w+)/g)].map((m) => m[1]);
  assert.deepEqual(handled, ['@preflight', '@search', '@multi', '@health']);
  assert.match(snippet, /@search \{\n\t\tmethod GET\n\t\tpath_regexp \^\/collections\/\[A-Za-z0-9_-\]\+\/documents\/search\$\n\t\}/);
  assert.match(snippet, /@multi \{\n\t\tmethod POST\n\t\tpath \/multi_search\n\t\}/);
  assert.match(snippet, /@health \{\n\t\tmethod GET\n\t\tpath \/health\n\t\}/);
  assert.match(snippet, /\thandle \{\n\t\trespond 404\n\t\}/, 'everything else (keys, import, export, collections) is refused');
  assert.match(snippet, /Access-Control-Allow-Origin "https:\/\/site\.example"/);
  for (const bad of [['--host', 'a b'], ['--host', 'x.example', '--cors-origin', 'http://x.example'], ['--host', 'x.example', '--cors-origin', '*']]) {
    assert.notEqual(spawnSync('bash', [path.join(kit, 'setup.sh'), 'snippet', ...bad]).status, 0, bad.join(' '));
  }
  // The real thing, when a caddy binary is given: the snippet imported next to another site block for the same host.
  if (!process.env.CADDY) return;
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'docs-platform.caddy'), snippet);
  fs.writeFileSync(path.join(dir, 'Caddyfile'), 'search.example {\n\trespond "the other site"\n}\nimport docs-platform.caddy\n');
  const r = spawnSync(process.env.CADDY, ['adapt', '--config', path.join(dir, 'Caddyfile')], { encoding: 'utf8', cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  const routes = JSON.parse(r.stdout).apps.http.servers.srv0.routes;
  assert.deepEqual(routes.map((x) => x.match[0].path ?? null), [['/_typesense/*'], null], 'the search route first, the other site untouched');
});

test('Typesense: its own compose project on loopback 8109, a pinned multi-arch image and a 4 GB limit', () => {
  const compose = yaml.load(fs.readFileSync(path.join(kit, 'typesense', 'compose.yaml'), 'utf8'));
  assert.equal(compose.name, 'docs-platform-typesense');
  const ts = compose.services.typesense;
  assert.match(ts.image, /^typesense\/typesense:30\.2@sha256:[0-9a-f]{64}$/);
  assert.equal(ts.mem_limit, '4g');
  assert.deepEqual(ts.ports, ['127.0.0.1:8109:8108']);
  assert.equal(ts.environment.TYPESENSE_ENABLE_CORS, 'false', 'CORS is Caddy\'s');
  assert.match(ts.environment.TYPESENSE_API_KEY, /^\$\{TYPESENSE_ADMIN_KEY:\?/);
  const local = yaml.load(fs.readFileSync(path.join(root, 'search', 'docker-compose.yml'), 'utf8'));
  assert.equal(ts.image.split('@')[0], local.services.typesense.image, 'the same Typesense as local preview');
});

test('setup.sh keeps apart from wso2-docs-site and pins what it installs', () => {
  const src = fs.readFileSync(path.join(kit, 'setup.sh'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const theirs of ['/srv/docs/', '/srv/docs ', '8108', '/etc/docs-site', 'docs-typesense']) assert.ok(!code.includes(theirs), `never touches ${theirs}`);
  assert.doesNotMatch(code, /useradd[^\n]*\bdeploy\b|usermod[^\n]*\bdeploy\b/);
  assert.match(src, /^NODE_VERSION=22\.\d+\.\d+$/m);
  assert.equal([...src.matchAll(/(arm64|x64)\)\s+echo ([0-9a-f]{64}) ;;/g)].length, 2, 'Node checksums pinned for arm64 and x64');
  assert.match(src, /KEYS_FILE=\/etc\/ssh\/authorized_keys\/docs-platform/);
  assert.match(src, /search-upload\) echo "\$RRSYNC -wo -no-del -munge \$INCOMING"/, 'the upload key writes only, deletes nothing');
  assert.match(src, /search-gate\)\s+echo "\$GATE"/);
  assert.match(src, /install -o root -g "\$USER_NAME" -m 640 "\$TMP\/ts\.env" "\$ETC\/typesense\.env"/);
  assert.match(src, /preflight \|\| die "the VM does not meet the requirements above; nothing was changed"/);
  assert.ok(src.indexOf('preflight || die') < src.indexOf('apt-get'), 'checks before any change');
  assert.match(src, /caddy validate --config "\$CADDYFILE" --adapter caddyfile/);
  assert.ok(src.indexOf('cp -a -- "$CADDYFILE" "$backup"') < src.indexOf('caddy validate --config "$CADDYFILE"'), 'backs the Caddyfile up first');
  const r = spawnSync('bash', [path.join(kit, 'setup.sh'), 'apply'], { encoding: 'utf8' });
  if (process.getuid?.() !== 0) assert.match(r.stderr, /run as root/);
  assert.notEqual(spawnSync('bash', [path.join(kit, 'setup.sh'), 'nope']).status, 0);
});

// A stand-in Typesense for the gate: collections, analytics rules, import,
// delete by filter, export, keys and health; it checks the admin key.
async function standInTypesense(admin) {
  const collections = new Map();
  const docs = new Map();
  const keys = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof data === 'string' ? data : JSON.stringify(data)); };
    const u = new URL(req.url, 'http://x');
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.pathname === '/health') return send(200, { ok: true });
    if (req.headers['x-typesense-api-key'] !== admin) return send(401, { message: 'Forbidden' });
    if (parts[0] === 'analytics') return send(200, {});
    if (parts[0] === 'keys' && req.method === 'GET') return send(200, { keys: keys.map(({ value, ...k }) => ({ ...k, value_prefix: value.slice(0, 4) })) });
    if (parts[0] === 'keys' && req.method === 'POST') { const k = { id: keys.length, ...JSON.parse(body) }; keys.push(k); return send(201, k); }
    if (parts[0] !== 'collections') return send(404, { message: 'no' });
    if (parts.length === 1 && req.method === 'POST') { const c = JSON.parse(body); collections.set(c.name, c); return send(201, c); }
    const c = parts[1];
    if (parts.length === 2 && req.method === 'GET') return collections.has(c) ? send(200, collections.get(c)) : send(404, { message: 'Not found.' });
    if (parts[3] === 'import') {
      const lines = body.split('\n').filter(Boolean).map((l) => JSON.parse(l));
      for (const d of lines) docs.set(d.id, d);
      return send(200, lines.map(() => JSON.stringify({ success: true })).join('\n'));
    }
    if (parts[3] === 'export') return send(200, [...docs.values()].map((d) => JSON.stringify(d)).join('\n'));
    if (parts.length === 3 && req.method === 'DELETE') return send(200, { num_deleted: 0 });
    return send(404, { message: `no ${req.method} ${u.pathname}` });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, docs, keys, close: () => new Promise((r) => server.close(r)) };
}

const flock = which('flock');
test('docs-platform-gate runs only its allow-listed verbs, under flock, from the uploaded search files', { skip: !flock && 'needs flock (util-linux), as on the VM' }, async (t) => {
  const admin = 'admin-key-on-the-vm';
  const parent = 'parentkey0123456789abcdef0123456789abcdef';
  const ts = await standInTypesense(admin);
  t.after(ts.close);
  const dir = tmp();
  const searchRoot = path.join(dir, 'search');
  const incoming = path.join(searchRoot, 'incoming');
  fs.mkdirSync(incoming, { recursive: true });
  fs.writeFileSync(path.join(dir, 'typesense.env'), `TYPESENSE_ADMIN_KEY=${admin}\nTYPESENSE_SEARCH_PARENT_KEY=${parent}\n`);
  const conf = path.join(dir, 'gate.conf');
  fs.writeFileSync(conf, [
    `SEARCH_ROOT=${searchRoot}`, `PLATFORM=${root}`, `NODE=${process.execPath}`, 'SEARCH_ENV=staging',
    `TYPESENSE_URL=${ts.url}`, `TYPESENSE_ENV=${path.join(dir, 'typesense.env')}`, 'STALE_MINUTES=30', '',
  ].join('\n'));
  // The gate runs with sshd's environment, not the test runner's.
  const env = { PATH: process.env.PATH, HOME: dir, WSO2_DOCS_CONTENT_REPOS: process.env.WSO2_DOCS_CONTENT_REPOS };
  // Asynchronous: the stand-in Typesense answers from this process.
  const gate = (cmd) => new Promise((resolve) => {
    execFile('bash', [path.join(kit, 'docs-platform-gate'), conf], { encoding: 'utf8', env: { ...env, SSH_ORIGINAL_COMMAND: cmd } },
      (err, stdout, stderr) => resolve({ status: err ? err.code : 0, stdout, stderr }));
  });

  for (const cmd of ['', 'status ', 'search-index', 'search-index a/b=c; id', 'search-index a/b=c && id', 'search-index ../x/y=z', 'search-index a/b=$(id)',
    'search-index a/b=c\nstatus', 'search-check --fix --out /tmp/x', 'search-key --expires tomorrow', 'search-key --parent x', 'search-setup', 'flip', 'status; id']) {
    const r = await gate(cmd);
    assert.equal(r.status, 65, `refused: ${JSON.stringify(cmd)} (${r.stderr})`);
  }
  assert.equal((await gate('search-index identity-server/7.3.0=7.3.0-docs.1')).status, 66, 'nothing uploaded yet');

  // What CI's search-export uploads, from a bucket with two live deployments.
  const policy = loadPolicy();
  const bucket = new FsStorage(tmp());
  const meta = (edition, segment) => ({ docSpace: 'identity-server', edition, kind: 'self-hosted', asLatest: segment === 'latest', baseUrl: `/identity-server/${segment}/` });
  const deployments = [
    { space: 'identity-server', segment: 'latest', edition: '7.3.0', release: '7.3.0-docs.1' },
    { space: 'identity-server', segment: '7.3.0', edition: '7.3.0', release: '7.3.0-docs.1' },
  ];
  for (const d of deployments) {
    const build = tmp();
    const write = (rel, data) => { fs.mkdirSync(path.dirname(path.join(build, rel)), { recursive: true }); fs.writeFileSync(path.join(build, rel), typeof data === 'string' ? data : JSON.stringify(data)); };
    for (const f of ['index.html', '404.html', 'sitemap.xml']) write(f, '<html></html>');
    write('_platform/edition.json', meta(d.edition, d.segment));
    write('_platform/pages.json', [{ path: '' }, { path: 'guides/mfa/' }]);
    write('_platform/redirects.json', []);
    write('_platform/search-records.json', ['', 'guides/mfa/'].map((p) => ({
      url: `https://docs.wso2.com/identity-server/${d.segment}/${p}`, hierarchy: { lvl0: 'WSO2 Identity Platform', lvl1: 'Quick start' }, content: `text of ${p}`,
      docSpace: 'identity-server', edition: d.edition, kind: 'self-hosted',
    })));
    await publishRelease(bucket, build, { ...d, tag: d.release });
  }
  await flip(bucket, { environment: 'staging', policy, deployments });
  await bucket.put(COMPOSED_KEY, JSON.stringify(policy));
  await exportSearchInputs(bucket, incoming, { deployments });

  const indexed = await gate('search-index identity-server/latest=7.3.0-docs.1 identity-server/7.3.0=7.3.0-docs.1');
  assert.equal(indexed.status, 0, indexed.stderr + indexed.stdout);
  assert.match(indexed.stdout, /search: identity-server\/latest skipped/);
  assert.match(indexed.stdout, /search: identity-server\/7\.3\.0 upserted 2 records/);
  assert.equal(ts.docs.size, 2);
  assert.equal((await gate('search-index identity-server/7.2.0=7.2.0-docs.1')).status, 66, 'no records uploaded for it');

  const check = await gate('search-check');
  assert.equal(check.status, 0, check.stderr);
  const report = JSON.parse(check.stdout);
  assert.equal(report.ok, true, check.stdout);
  assert.equal(report.collection, COLLECTIONS.staging);

  const key = await gate('search-key');
  assert.equal(key.status, 0, key.stderr);
  assert.equal(key.stdout, `${scopedSearchKey(parent, {})}\n`, 'only the scoped key on stdout');
  assert.ok(!`${key.stdout}${key.stderr}`.includes(parent) && !`${key.stdout}${key.stderr}`.includes(admin), 'neither key it holds is printed');
  assert.deepEqual(ts.keys.map((k) => [k.value, k.actions, k.collections]), [[parent, ['documents:search'], [COLLECTIONS.staging]]]);
  assert.equal((await gate('search-key')).status, 0);
  assert.equal(ts.keys.length, 1, 'the parent is made once');
  const expiring = await gate('search-key --expires 2027-10-28');
  assert.equal(expiring.stdout.trim(), scopedSearchKey(parent, { expires_at: Math.floor(Date.parse('2027-10-28') / 1000) }));

  const status = await gate('status');
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^typesense=ok$/m);
  assert.match(status.stdout, /^environment=staging$/m);

  // A link in the upload is refused; release folders no live deployment uses are pruned.
  const old = path.join(incoming, '_releases', 'identity-server', '7.3.0', '7.3.0-docs.0');
  fs.mkdirSync(old, { recursive: true });
  const hourAgo = new Date(Date.now() - 3_600_000);
  fs.utimesSync(old, hourAgo, hourAgo);
  const pruned = await gate('search-check');
  assert.match(pruned.stderr, /pruned=identity-server\/7\.3\.0\/7\.3\.0-docs\.0/);
  assert.ok(!fs.existsSync(old) && fs.existsSync(path.join(incoming, '_releases', 'identity-server', '7.3.0', '7.3.0-docs.1')));
  fs.symlinkSync('/etc', path.join(incoming, 'escape'));
  assert.equal((await gate('search-check')).status, 66);
});

test('CI\'s search-via-gate.sh stops with a warning, before any upload, when the environment has no VM secrets', () => {
  const r = spawnSync('bash', [path.join(kit, 'search-via-gate.sh'), 'index', '--storage', 'file:/nonexistent', '--deploy', 'a/b=c'], {
    encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^::warning title=Search index::DOCS_SEARCH_HOST is not set/m);
  assert.notEqual(spawnSync('bash', [path.join(kit, 'search-via-gate.sh'), 'flip', '--storage', 'x']).status, 0);
});

test('release workflows index and check staging through the VM gate; no Typesense admin key in CI', () => {
  const wf = (name) => yaml.load(fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8'));
  const text = ['release.yml', 'rollback.yml', 'search-consistency.yml'].map((f) => fs.readFileSync(path.join(root, '.github', 'workflows', f), 'utf8')).join('\n');
  assert.doesNotMatch(text, /TYPESENSE_ADMIN_KEY|TYPESENSE_URL/);
  const secrets = (step) => Object.fromEntries(Object.entries(step.env ?? {}).filter(([k]) => k.startsWith('DOCS_SEARCH_')));
  const expected = {
    DOCS_SEARCH_HOST: '${{ secrets.DOCS_SEARCH_HOST }}', DOCS_SEARCH_KNOWN_HOSTS: '${{ secrets.DOCS_SEARCH_KNOWN_HOSTS }}',
    DOCS_SEARCH_UPLOAD_KEY: '${{ secrets.DOCS_SEARCH_UPLOAD_KEY }}', DOCS_SEARCH_GATE_KEY: '${{ secrets.DOCS_SEARCH_GATE_KEY }}',
  };
  const release = wf('release.yml');
  const s6 = release.jobs['finalize-staging'].steps.find((s) => s.name === 'Staging search index (step 6)');
  assert.equal(release.jobs['finalize-staging'].environment, 'staging');
  assert.equal(s6['continue-on-error'], true);
  assert.deepEqual(secrets(s6), expected);
  assert.match(s6.run, /hosting\/vm\/search-via-gate\.sh index --storage "\$STAGING_STORAGE" --deploy "\$FLIP \$FLIP_BACK"/);
  const s8 = release.jobs.promote.steps.find((s) => s.name === 'Production search index (step 8)');
  assert.equal(s8['continue-on-error'], true);
  assert.deepEqual(secrets(s8), expected);
  assert.match(s8.run, /search-via-gate\.sh index --storage "\$PRODUCTION_STORAGE" --policy composed\.json --deploy "\$FLIP \$FLIP_BACK"/);
  const rollback = wf('rollback.yml').jobs;
  const rs = Object.values(rollback).flatMap((j) => j.steps).find((s) => s.name === 'Search index');
  assert.equal(rs['continue-on-error'], true);
  assert.match(rs.run, /search-via-gate\.sh check --storage "\$STORAGE" --policy composed\.json --fix --out search\.json/);
  const weekly = wf('search-consistency.yml').jobs.check;
  const ws = weekly.steps.at(-1);
  assert.deepEqual(secrets(ws), expected);
  assert.match(ws.run, /args=\(check --storage "\$STORAGE" --out report\.json\)/);
  assert.match(ws.run, /hosting\/vm\/search-via-gate\.sh "\$\{args\[@\]\}"/);
  // The build job runs content code: it never holds a search key.
  const build = wf('build-deployment.yml');
  assert.doesNotMatch(JSON.stringify(build), /DOCS_SEARCH_(UPLOAD|GATE)_KEY/);
});
