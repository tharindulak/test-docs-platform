#!/usr/bin/env node
// The release pipeline's CLI, run by .github/workflows/release.yml (and by
// hand against a local folder). Storage is file:<dir> or s3://<bucket> (R2's
// S3 API, with R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_POLICY, loadPolicy } from '../lib/manifest.mjs';
import { runComposeCommand } from '../lib/compose-command.mjs';
import { COMPOSED_KEY, defaultContentDir } from '../lib/compose.mjs';
import { readPlatformPins } from '../lib/platform-pins.mjs';
import { platformDeploymentsFor, platformReleaseFor } from '../lib/platform-release.mjs';
import { LOCK_KEY, STATE_WRITERS, readLock, withStateLock } from '../lib/state-lock.mjs';
import { execFileSync } from 'node:child_process';

// The version of this Platform checkout (package.json): its major is the one a
// Platform release rebuilds.
const PLATFORM_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
import { openStorage } from '../lib/storage.mjs';
import yaml from 'js-yaml';
import { openKv } from '../lib/kv.mjs';
import { crawl } from '../lib/crawl.mjs';
import {
  checkBuild, copyRelease, flip, gc, planRelease, policyChanges, publishPreview, publishRelease, publishRuntime,
  readState, releaseIdFor, releasePrefix, retire, rollback, syncRedirects,
} from '../lib/release.mjs';
import { COLLECTIONS } from '../lib/search/environments.mjs';
import { checkConsistency, ensureCollection, ensureSearchOnlyKey, indexDeployment, indexReleases, isSearchOnlyParent, readBuild } from '../lib/search/indexing.mjs';
import { scopedSearchKey, typesenseClient } from '../lib/search/typesense.mjs';

const USAGE = `Usage: wso2-release <command> [options]

  compose   [--navigation <dir>] [--content <dir>] [--out <file>] [--last-good <file> | --storage <s>] [--report <file>]
            compose the Deployment manifest from the team manifests; on failure keep the last good copy
  compose   --as-base --out <file> [--navigation <dir>] [--content <dir>] [--platform-root <dir>]
            main's inputs as the base of a Platform PR's check, written even when main has errors
  compose   --pr (--base <file> | --storage <s>) [--navigation <dir>] [--content <dir>] [--repo <owner/name> --repo-dir <dir>] [--report <file>]
            the PR check: compose against the latest merged manifest, blocking on this change's errors
  compose   --pr --published <url|file> --repo-dir <checkout> [--repo <owner/name>] [--base-ref <ref>] [--annotate <prefix>] [--report <file>]
            a Content repo's PR check: against the published manifest.json, no other checkout or secret
  composed  --storage <s> --out <file>                     the stored last good composed manifest, for builds
  plan      --repo <owner/name> --tag <tag> [--scope tag|docspace|all|landing] [--space <slug>] [--storage <s>] [--rebuild-id <id>]
            [--major <n>] [--content <dir>]
            tags are [<doc space>/]<version>-docs.<n> or [<doc space>/]cloud-<YYYY.MM.DD>.<n>; each deployment
            names its Doc space directory (dir) in the repo. Scope all (a Platform release) plans the deployments
            whose Content repo pins --major (default this Platform's major), read from each repo's docs.yml in
            the checkouts under --content (default WSO2_DOCS_CONTENT_REPOS)
  check     --dir <build> --space <slug> --segment <seg> --edition <id>
  publish   --storage <s> --dir <build> --space <slug> --segment <seg> --edition <id> --tag <tag> [--release <id>]
            [--source-repo <owner/name>] [--source-sha <sha>]
  flip      --storage <s> --env <name> --deploy <space>/<segment>=<release> [--deploy ...] [--chrome <file>]
  rollback  --storage <s> --env <name> --deployment <space>/<segment> [--to <release>]
  retire    --storage <s> --env <name> --deployment <space>/<segment>
            take down a deployment whose Edition the manifest no longer lists (removed, or a Legacy version now)
  manifest  --storage <s> --env <name> [--chrome <file>]      republish runtime files (policy changes)
  redirects --storage <s> --kv <file:path|cloudflare:namespace-id|local:url> [--dry-run]
  gc        --storage <s> [--keep 5] [--dry-run]
  latest-pages --storage <s> --space <slug> --out <file>     pages.json of the deployed latest twin
  route-lists --storage <s> --out <dir>                     every deployed pages.json, for docs: link checks
  crawl     --storage <s> --host <url> --deploy <space>/<segment>=<release> [...]   the staging crawl gate
  policy-diff --old <manifest.json>                        Doc spaces a manifest change must rebuild
  promote   --storage <staging> --to <production> --deploy <space>/<segment>=<release> [...]
  preview   --storage <s> --dir <build> --space <slug> --pr <n> --edition <id>
  status    --storage <s>
  state-lock --storage <s> [--break]                     who holds the state lock; --break removes a stuck one
            (flip, rollback, retire, manifest, redirects and gc wait their turn on it; a lock expires after 30 min)
  platform-changes --base <sha> [--head <sha>] [--github-output <file>]
            whether a push to the Platform's main releases Contribute and the Landing deployment
  platform-release --tag v<major>.<minor>.<patch>        a Platform release tag: its version, major tag and
            whether that tag moves (only to the newest release of the major); checks it against package.json

Search (Typesense at TYPESENSE_URL with TYPESENSE_ADMIN_KEY; --env picks the collection):
  search-setup --env <name> [--collection <c>] [--new-key]   collection, analytics rules, search-only parent key
                                                            (an existing parent is reused; --new-key makes another)
  search-keys --env <name> [--collection <c>]                every key: id, value prefix, actions, collections, expiry
  search-key-delete --env <name> --id <id>                   delete one key (browser keys scoped from it stop working)
  search-index --env <name> --storage <s> --deploy <space>/<segment>=<release> [...]
                                                            upsert each deployment's records, then delete its stale ones
  search-index --env <name> --dir <build> --release <id>     the same from a local build
  search-check --env <name> --storage <s> [--fix] [--out <f>] weekly consistency check against every live deployment
  search-key  --parent <search-only key> [--expires <ISO date>]   scoped key for browsers

Every other command takes --policy <file>: a composed manifest from compose --out. Without it, a command
with --storage reads the last good copy compose stored there (_platform/composed.json); otherwise it
composes navigation/ with the Doc space manifests in WSO2_DOCS_CONTENT_REPOS.`;

const parseDeploy = (spec) => {
  const m = /^([^/=]+)\/([^/=]+)=(.+)$/.exec(spec);
  if (!m) throw new Error(`--deploy "${spec}" must look like <space>/<segment>=<release>`);
  return { space: m[1], segment: m[2], release: m[3] };
};
const need = (o, ...keys) => {
  for (const k of keys) if (o[k] === undefined) throw new Error(`--${k} is required`);
};
const print = (data) => console.log(JSON.stringify(data, null, 2));
const warn = (warnings) => warnings?.forEach((w) => console.warn(`warning: ${w}`));

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return 0;
  }
  if (command === 'compose') {
    const { values } = parseArgs({
      args: rest,
      options: {
        pr: { type: 'boolean' }, navigation: { type: 'string' }, content: { type: 'string' }, out: { type: 'string' },
        'last-good': { type: 'string' }, storage: { type: 'string' }, report: { type: 'string' }, base: { type: 'string' },
        repo: { type: 'string' }, 'repo-dir': { type: 'string' }, 'platform-root': { type: 'string' },
        published: { type: 'string' }, 'base-ref': { type: 'string' }, annotate: { type: 'string' }, 'as-base': { type: 'boolean' },
      },
    });
    return runComposeCommand(values);
  }
  const { values: o } = parseArgs({
    args: rest,
    options: {
      policy: { type: 'string' }, storage: { type: 'string' }, to: { type: 'string' }, kv: { type: 'string' },
      repo: { type: 'string' }, tag: { type: 'string' }, scope: { type: 'string' }, space: { type: 'string' },
      'rebuild-id': { type: 'string' }, dir: { type: 'string' }, segment: { type: 'string' }, edition: { type: 'string' },
      release: { type: 'string' }, 'source-repo': { type: 'string' }, 'source-sha': { type: 'string' },
      env: { type: 'string' }, deploy: { type: 'string', multiple: true }, deployment: { type: 'string' },
      chrome: { type: 'string' }, keep: { type: 'string' }, 'dry-run': { type: 'boolean' }, out: { type: 'string' },
      pr: { type: 'string' }, host: { type: 'string' }, old: { type: 'string' }, major: { type: 'string' }, content: { type: 'string' },
      base: { type: 'string' }, head: { type: 'string' }, 'github-output': { type: 'string' }, break: { type: 'boolean' },
      collection: { type: 'string' }, fix: { type: 'boolean' }, parent: { type: 'string' }, expires: { type: 'string' },
      'new-key': { type: 'boolean' }, id: { type: 'string' },
    },
  });
  const storage = () => {
    need(o, 'storage');
    return openStorage(o.storage);
  };
  // The Deployment manifest a release works from: --policy, else the last
  // good copy compose stored in --storage (_platform/composed.json), else
  // composed here from the local checkouts.
  const policyFrom = async () => {
    if (o.policy) return { policy: loadPolicy(path.resolve(o.policy)), from: o.policy };
    if (o.storage && !['check', 'composed', 'search-key', 'search-setup', 'search-keys', 'search-key-delete'].includes(command)) {
      const obj = await openStorage(o.storage).get(COMPOSED_KEY);
      if (obj) return { policy: JSON.parse(new TextDecoder().decode(obj.body)), from: `${o.storage} ${COMPOSED_KEY}` };
      console.warn(`warning: ${o.storage} has no ${COMPOSED_KEY} yet (run compose --storage first); composing from the local checkouts`);
    }
    return { policy: loadPolicy(DEFAULT_POLICY), from: 'local compose' };
  };
  const needsPolicy = ['plan', 'flip', 'rollback', 'retire', 'manifest', 'policy-diff', 'search-index', 'search-check'].includes(command);
  const { policy } = needsPolicy ? await policyFrom() : { policy: null };
  const chrome = o.chrome ? fs.readFileSync(o.chrome, 'utf8') : undefined;
  const search = () => {
    need(o, 'env');
    const collection = o.collection ?? COLLECTIONS[o.env];
    if (!collection) throw new Error(`No search collection for environment "${o.env}"; pass --collection`);
    return { client: typesenseClient({ url: process.env.TYPESENSE_URL, apiKey: process.env.TYPESENSE_ADMIN_KEY }), collection };
  };
  // A failed search update alerts (a GitHub annotation) but never blocks a release.
  const alert = (message) => console.log(process.env.GITHUB_ACTIONS ? `::warning title=Search index::${message}` : `warning: ${message}`);

  // Every command that writes the published state takes its turn on the
  // bucket's state lock (lib/state-lock.mjs), so no writer cancels or
  // overwrites another. A dry run writes nothing and takes no lock.
  if (STATE_WRITERS.has(command) && !o['dry-run']) {
    const notice = (m) => console.error(process.env.GITHUB_ACTIONS ? `::notice title=State lock::${m}` : `state lock: ${m}`);
    return withStateLock(storage(), () => run(), { command, log: notice });
  }
  return run();

  async function run() {
  switch (command) {
    case 'plan': {
      const scope = o.scope ?? 'tag';
      if (scope === 'tag') need(o, 'repo', 'tag');
      const state = scope === 'tag' ? undefined : await readState(storage());
      // A Platform release (scope all) rebuilds the deployments whose Content
      // repo pins its major: this Platform's own, unless --major names another.
      const major = scope === 'all' ? Number(o.major ?? PLATFORM_VERSION.split('.')[0]) : undefined;
      const pins = scope === 'all' ? readPlatformPins(policy, o.content ? path.resolve(o.content) : defaultContentDir()) : undefined;
      const skipped = [];
      const list = planRelease(policy, { repo: o.repo, tag: o.tag, scope, space: o.space, state, rebuildId: o['rebuild-id'], major, pins, onSkip: (s) => skipped.push(s) });
      for (const s of skipped) {
        const why = s.pin === null ? `${s.repo}'s docs.yml pins no Platform major (PLATFORM_REF: v<n>)` : `${s.repo} pins v${s.pin}`;
        console.error(`${process.env.GITHUB_ACTIONS ? '::notice title=Not rebuilt::' : 'plan: '}${s.deployment} is not rebuilt by a v${major} Platform release: ${why}`);
      }
      const latest = list.filter((d) => d.asLatest);
      const others = list.filter((d) => !d.asLatest);
      print({
        ...(scope === 'all' ? { major, skipped } : {}),
        deployments: list,
        latest: { include: latest }, others: { include: others },
        hasLatest: latest.length > 0, hasOthers: others.length > 0,
        flip: list.map((d) => `${d.space}/${d.segment}=${d.release}`).join(' '),
      });
      return 0;
    }
    case 'platform-release': {
      // platform-release.yml: is this tag a release, and does it move v<major>?
      need(o, 'tag');
      const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').filter(Boolean);
      print(platformReleaseFor(o.tag, PLATFORM_VERSION, tags));
      return 0;
    }
    case 'platform-changes': {
      // platform-deployments.yml: does this push release Contribute, the Landing deployment, or both?
      const base = o.base && !/^0+$/.test(o.base) ? o.base : null;
      let files = null;
      try {
        if (base) files = execFileSync('git', ['diff', '--name-only', base, o.head ?? 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
      } catch {
        files = null; // the base isn't in this clone: release both
      }
      const r = platformDeploymentsFor(files);
      print(r);
      if (o['github-output']) fs.appendFileSync(o['github-output'], `contribute=${r.contribute}\nlanding=${r.landing}\n`);
      return 0;
    }
    case 'check': {
      need(o, 'dir', 'space', 'segment', 'edition');
      const problems = checkBuild(path.resolve(o.dir), o);
      problems.forEach((p) => console.error(`check: ${p}`));
      if (!problems.length) console.log(`check: ${o.space}/${o.segment} build is publishable`);
      return problems.length ? 1 : 0;
    }
    case 'publish': {
      need(o, 'dir', 'space', 'segment', 'edition', 'tag');
      const r = await publishRelease(storage(), path.resolve(o.dir), {
        space: o.space, segment: o.segment, edition: o.edition, tag: o.tag, release: o.release ?? releaseIdFor(o.tag),
        source: { repo: o['source-repo'] ?? null, sha: o['source-sha'] ?? null },
      });
      console.log(r.skipped ? `${r.prefix} is already complete; nothing uploaded` : `Published ${r.files} files (${r.bytes} bytes) to ${r.prefix}`);
      return 0;
    }
    case 'flip': {
      need(o, 'env', 'deploy');
      const deployments = o.deploy.flatMap((d) => d.split(/\s+/).filter(Boolean)).map(parseDeploy);
      const { state, warnings } = await flip(storage(), { environment: o.env, policy, deployments, chrome });
      warn(warnings);
      for (const d of deployments) console.log(`${o.env}: ${d.space}/${d.segment} -> ${state.deployments[`${d.space}/${d.segment}`].release}`);
      return 0;
    }
    case 'rollback': {
      need(o, 'env', 'deployment');
      const [space, segment] = o.deployment.split('/');
      const { state, warnings } = await rollback(storage(), { environment: o.env, policy, space, segment, to: o.to });
      warn(warnings);
      console.log(`${o.env}: ${o.deployment} rolled back to ${state.deployments[o.deployment].release}`);
      return 0;
    }
    case 'retire': {
      need(o, 'env', 'deployment');
      const [space, segment] = o.deployment.split('/');
      const { retired, warnings } = await retire(storage(), { environment: o.env, policy, space, segment });
      warn(warnings);
      console.log(`${o.env}: ${o.deployment} retired (was ${retired.release}); sync the redirect table and run search-check --fix next`);
      return 0;
    }
    case 'manifest': {
      need(o, 'env');
      const s = storage();
      const { warnings } = await publishRuntime(s, { policy, state: await readState(s), environment: o.env, chrome });
      warn(warnings);
      console.log(`Republished manifest.json and sitemap.xml${chrome ? ' and chrome.json' : ''} to ${s.name}`);
      return 0;
    }
    case 'redirects': {
      need(o, 'kv');
      const r = await syncRedirects(storage(), openKv(o.kv), { dryRun: o['dry-run'] });
      for (const c of r.conflicts) console.warn(`warning: redirect ${c.key}: kept ${c.kept.to} (${c.kept.from}), dropped ${c.dropped.to} (${c.dropped.from})`);
      console.log(`Redirect table: ${r.size} entries, ${r.puts} written, ${r.deletes} deleted${o['dry-run'] ? ' (dry run)' : ''}`);
      return 0;
    }
    case 'gc': {
      const removed = await gc(storage(), { keep: Number(o.keep ?? 5), dryRun: o['dry-run'] });
      console.log(removed.length ? `${o['dry-run'] ? 'Would remove' : 'Removed'}: ${removed.join(', ')}` : 'Nothing to collect');
      return 0;
    }
    // <out>/<space>/<segment>/pages.json for `wso2-docs check --routes <out>`.
    case 'route-lists': {
      need(o, 'out');
      const s = storage();
      const { deployments } = await readState(s);
      for (const [key, d] of Object.entries(deployments)) {
        const [space, segment] = key.split('/');
        const obj = await s.get(`${releasePrefix(space, segment, d.release)}_platform/pages.json`);
        if (!obj) continue;
        const file = path.join(path.resolve(o.out), space, ...(segment === '_' ? [] : [segment]), 'pages.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, obj.body);
      }
      console.log(`Wrote the route lists of ${Object.keys(deployments).length} deployments to ${o.out}`);
      return 0;
    }
    case 'latest-pages': {
      need(o, 'space', 'out');
      const s = storage();
      const d = (await readState(s)).deployments[`${o.space}/latest`];
      const obj = d && (await s.get(`${releasePrefix(o.space, 'latest', d.release)}_platform/pages.json`));
      if (!obj) {
        console.log(`No deployed latest twin for ${o.space}; building without its page list`);
        return 0;
      }
      fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
      fs.writeFileSync(o.out, obj.body);
      console.log(`Wrote ${o.out} from ${o.space}/latest/${d.release}`);
      return 0;
    }
    case 'crawl': {
      need(o, 'host', 'deploy');
      const deployments = o.deploy.flatMap((d) => d.split(/\s+/).filter(Boolean)).map(parseDeploy);
      const r = await crawl({ storage: storage(), host: o.host, deployments });
      for (const f of r.failures) console.error(`crawl: ${f.status} ${f.url}${f.from ? ` (linked from ${f.from})` : ''}${f.kind === 'confluence' ? ` expected a 301 to ${f.expected}, got ${f.location ?? 'none'}` : ''}`);
      console.log(`Crawled ${r.pages} pages and ${r.links} links on ${o.host}${r.external ? ` (plus ${r.external} old Confluence links answered with the archive's 301)` : ''}: ${r.failures.length} failed`);
      return r.failures.length ? 1 : 0;
    }
    case 'policy-diff': {
      need(o, 'old');
      print(policyChanges(yaml.load(fs.readFileSync(o.old, 'utf8')) ?? {}, policy));
      return 0;
    }
    case 'promote': {
      need(o, 'to', 'deploy');
      const from = storage();
      const to = openStorage(o.to);
      for (const d of o.deploy.flatMap((x) => x.split(/\s+/).filter(Boolean)).map(parseDeploy)) {
        const r = await copyRelease(from, to, d);
        console.log(`${d.space}/${d.segment}/${d.release}: ${r.skipped ? 'already in' : `copied ${r.files} files to`} ${to.name}`);
      }
      return 0;
    }
    case 'preview': {
      need(o, 'dir', 'space', 'pr', 'edition');
      const r = await publishPreview(storage(), path.resolve(o.dir), { space: o.space, pr: o.pr, edition: o.edition });
      console.log(`Preview: ${r.path} (${r.files} files, ${r.removed} stale removed)`);
      return 0;
    }
    // The stored last good composed manifest, for builds (wso2-docs build --manifest).
    case 'composed': {
      need(o, 'out');
      const obj = await storage().get(COMPOSED_KEY);
      if (!obj) throw new Error(`${o.storage} has no ${COMPOSED_KEY}; run wso2-release compose --storage ${o.storage} first`);
      fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
      fs.writeFileSync(o.out, obj.body);
      console.log(`Wrote ${o.out} from ${o.storage} ${COMPOSED_KEY}`);
      return 0;
    }
    case 'status':
      print(await readState(storage()));
      return 0;
    case 'search-setup': {
      const { client, collection } = search();
      const r = await ensureCollection(client, collection);
      const key = await ensureSearchOnlyKey(client, collection, undefined, { fresh: o['new-key'] });
      console.log(`${collection}: ${r.created ? 'created' : `exists${r.added.length ? `, added ${r.added.join(', ')}` : ''}`}; analytics rules in place`);
      if (key.existed) console.log(`Reusing search-only parent key ${key.id} (${key.value_prefix}…); its value was printed when it was made. Run with --new-key for another.`);
      else console.log(`Search-only parent key ${key.id} (scope browser keys from it with search-key; printed only now): ${key.value}`);
      return 0;
    }
    case 'search-keys': {
      const { client, collection } = search();
      const keys = (await client.listKeys()).sort((a, b) => a.id - b.id);
      const never = (k) => !k.expires_at || k.expires_at > 32503680000; // after 3000-01-01: no expiry
      const rows = keys.map((k) => [String(k.id), `${k.value_prefix}…`, (k.actions ?? []).join(','), (k.collections ?? []).join(','),
        never(k) ? 'never' : new Date(k.expires_at * 1000).toISOString().slice(0, 10),
        isSearchOnlyParent(k, collection) ? `search-only parent for ${collection}` : (k.description ?? '')]);
      const head = ['id', 'prefix', 'actions', 'collections', 'expires', 'description'];
      const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
      for (const r of [head, ...rows]) console.log(r.map((c, i) => (i < r.length - 1 ? c.padEnd(width[i]) : c)).join('  ').trimEnd());
      return 0;
    }
    case 'search-key-delete': {
      need(o, 'id');
      const { client } = search();
      const key = (await client.listKeys()).find((k) => String(k.id) === o.id);
      if (!key || !(await client.deleteKey(o.id))) throw new Error(`No key ${o.id}; search-keys lists them`);
      console.log(`Deleted key ${key.id} (${key.value_prefix}…, ${(key.actions ?? []).join(',')} on ${(key.collections ?? []).join(',')}). Browser keys scoped from it stop working.`);
      return 0;
    }
    case 'search-index': {
      const { client, collection } = search();
      if (o.dir) {
        need(o, 'release');
        const { meta, records } = readBuild(path.resolve(o.dir));
        await ensureCollection(client, collection);
        const r = await indexDeployment(client, { collection, records, meta, policy, release: o.release });
        console.log(`search: ${r.docSpace}/${r.edition} upserted ${r.imported} records, deleted ${r.deleted} stale`);
        return 0;
      }
      need(o, 'deploy');
      const deployments = o.deploy.flatMap((d) => d.split(/\s+/).filter(Boolean)).map(parseDeploy);
      let r;
      try {
        r = await indexReleases(client, storage(), { collection, policy, deployments, log: console.log });
      } catch (err) {
        alert(`${collection} could not be updated: ${err.message}`);
        return 1;
      }
      for (const s of r.skipped) console.log(`search: ${s.deployment} skipped (${s.reason})`);
      // A family Cloud tree lists its groups: its own pages, then each Cloud part (the component's Cloud).
      const groups = (x) => (x.groups ? ` (${Object.entries(x.groups).map(([g, n]) => `${g} ${n.imported}`).join(', ')})` : '');
      for (const x of r.results) console.log(`search: ${x.deployment} upserted ${x.imported} records${groups(x)}, deleted ${x.deleted} stale`);
      for (const f of r.failures) alert(`${f.deployment} (${f.release}) was not indexed in ${collection}: ${f.error}`);
      return r.failures.length ? 1 : 0;
    }
    case 'search-check': {
      const { client, collection } = search();
      const report = await checkConsistency(client, storage(), { collection, policy, fix: o.fix });
      if (o.out) fs.writeFileSync(o.out, `${JSON.stringify(report, null, 2)}\n`);
      else print(report);
      if (!report.ok) alert(`${collection} has drifted from the live deployments${o.fix ? ' (repaired)' : ''}`);
      return report.ok || o.fix ? 0 : 1;
    }
    case 'search-key': {
      need(o, 'parent');
      const embedded = o.expires ? { expires_at: Math.floor(Date.parse(o.expires) / 1000) } : {};
      if (o.expires && !Number.isFinite(embedded.expires_at)) throw new Error(`--expires "${o.expires}" is not a date`);
      console.log(scopedSearchKey(o.parent, embedded));
      return 0;
    }
    case 'state-lock': {
      // Who holds the state lock; --break removes a stuck one (it also expires).
      const s = storage();
      const held = await readLock(s);
      if (held && o.break) {
        await s.delete([LOCK_KEY]);
        console.log(`Removed the state lock of ${held.owner} (${held.command ?? 'unknown'}, since ${held.acquiredAt})`);
      } else print(held ?? { free: true });
      return 0;
    }
    default:
      console.error(`Unknown command "${command}"\n\n${USAGE}`);
      return 2;
  }
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  console.error(`wso2-release: ${err.message}`);
  process.exitCode = 1;
}
