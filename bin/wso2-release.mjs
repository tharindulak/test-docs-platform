#!/usr/bin/env node
// The release pipeline's CLI, run by .github/workflows/release.yml (and by
// hand against a local folder). Storage is file:<dir> or s3://<bucket> (R2's
// S3 API, with R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_POLICY, loadPolicy } from '../lib/manifest.mjs';
import { runComposeCommand } from '../lib/compose-command.mjs';
import { COMPOSED_KEY, defaultContentDir } from '../lib/compose.mjs';
import { readPlatformPins } from '../lib/platform-pins.mjs';
import { platformDeploymentsFor, platformReleaseFor } from '../lib/platform-release.mjs';
import { LOCK_KEY, STATE_WRITERS, readLock, withStateLock } from '../lib/state-lock.mjs';
import {
  RECORD_DIR, bundlesFor, checkRecordChange, fetchBundle, planFromRecords, readRecord, recordChanges, runIntake,
} from '../lib/intake.mjs';
import { platformRepoOf } from '../lib/platform-pins.mjs';
import { bundleKey, collectBundles, handOverCopies, plannedBundles, storeBundles } from '../lib/bundle-store.mjs';
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
import {
  checkConsistency, ensureCollection, ensureSearchOnlyKey, exportSearchInputs, indexDeployment, indexReleases, isSearchOnlyParent, readBuild,
} from '../lib/search/indexing.mjs';
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
            the checkouts under --content (default WSO2_DOCS_CONTENT_REPOS). With --records <dir> (releases/),
            each deployment names its recorded bundle (asset, sha256); a deployed tag not in the record is skipped
  plan      --scope records --base <sha> [--records <dir>] --storage <s> [--rebuild-id <id>]
            what a push changing the intake records releases: each Edition's new newest entry (tag scope, from
            its bundle), and each withdrawn newest entry's way back (flipBack: its previous release folder, or a
            rebuild of the previous bundle when that folder was collected)
  intake    [--policy <f>] [--records <dir>] [--pending <dir>] [--out <dir>] [--issues <json>] [--retry]
            [--repo <owner/name> | --space <slug>] [--work <dir>] [--signer-repo <owner/name>] [--report <f>]
            poll the Content repos' releases, verify the ones that count, write the changed intake records to
            --out (default --records); --issues lists the open and closed bundle-intake issues ([{ title }]).
            GITHUB_TOKEN reads the releases; gh verifies attestations
  record-check --base <ref> --branch <name> [--head <ref>]
            the intake PR check: an intake/<slug> branch changes only releases/<slug>.yaml's release entries
  fetch-bundle --repo <owner/name> --tag <tag> --asset <name> --sha256 <hex> --out <empty dir> [--copy <zip>] [--github-output <f>]
            a build's bundle: the recorded asset, its sha256 checked against the record, unpacked safely; when
            GitHub fails, the stored copy the plan job handed over (--copy), checked against the record too
  store-bundles --storage <s> --plan <plan.json> [--work <dir>]
            copy each planned bundle not stored yet to _bundles/<sha256>.zip: fetched from GitHub, its sha256
            checked against the record; no bundle is unpacked. --plan is the plan's output (deployments or include)
  bundle-copies --storage <s> --plan <plan.json> --out <dir>
            for each planned bundle GitHub no longer serves, its stored copy (sha256 checked) as <out>/<sha256>.zip
  gc-bundles --storage <s> --records <dir> [--dry-run]
            delete the _bundles/<sha256>.zip copies no intake record in <dir> names (a missing <dir>: none)
  check     --dir <build> --space <slug> --segment <seg> --edition <id>
  publish   --storage <s> --dir <build> --space <slug> --segment <seg> --edition <id> --tag <tag> [--release <id>]
            [--source-repo <owner/name>] [--source-sha <sha>]
  flip      --storage <s> --env <name> --deploy <space>/<segment>=<release> [--deploy ...] [--chrome <file>] [--backwards]
            --backwards goes back to an earlier release (a withdrawal), as a rollback does
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
                                                            (an existing parent is reused; --new-key makes another;
                                                            with TYPESENSE_SEARCH_PARENT_KEY set, that value is the
                                                            parent, made once and never printed: the VM gate's)
  search-keys --env <name> [--collection <c>]                every key: id, value prefix, actions, collections, expiry
  search-key-delete --env <name> --id <id>                   delete one key (browser keys scoped from it stop working)
  search-index --env <name> --storage <s> --deploy <space>/<segment>=<release> [...]
                                                            upsert each deployment's records, then delete its stale ones
  search-index --env <name> --dir <build> --release <id>     the same from a local build
  search-check --env <name> --storage <s> [--fix] [--out <f>] weekly consistency check against every live deployment
  search-key  [--parent <search-only key>] [--expires <ISO date>]   scoped key for browsers (the parent from
                                                            --parent, else TYPESENSE_SEARCH_PARENT_KEY)
  search-export --storage <s> --out <dir> [--deploy <space>/<segment>=<release> ...] [--policy <f>]
                                                            what a search host's gate indexes from (hosting/vm/): the
                                                            state, the composed manifest and each deployment's search
                                                            files, laid out as the bucket; no --deploy: every live one

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

// The intake records in a folder, { <slug>: record }; and as a commit holds
// them (none when the commit or the folder is missing: a first record).
const readRecords = (dir) => Object.fromEntries((fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  .filter((f) => f.endsWith('.yaml')).map((f) => [f.slice(0, -'.yaml'.length), readRecord(path.join(dir, f))]));
const gitShow = (ref, file) => {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null;
  }
};
function recordsAt(ref, dir) {
  if (!ref || /^0+$/.test(ref)) return {};
  let names = [];
  try {
    names = execFileSync('git', ['ls-tree', '--name-only', `${ref}:${dir}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter((f) => f.endsWith('.yaml'));
  } catch {
    return {};
  }
  const scratch = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'records-'));
  try {
    for (const f of names) fs.writeFileSync(path.join(scratch, f), gitShow(ref, `${dir}/${f}`) ?? '');
    return readRecords(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
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
      records: { type: 'string' }, pending: { type: 'string' }, issues: { type: 'string' }, retry: { type: 'boolean' },
      work: { type: 'string' }, 'signer-repo': { type: 'string' }, report: { type: 'string' }, branch: { type: 'string' },
      asset: { type: 'string' }, sha256: { type: 'string' }, backwards: { type: 'boolean' },
      plan: { type: 'string' }, copy: { type: 'string' },
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
    if (o.storage && !['check', 'composed', 'search-key', 'search-setup', 'search-keys', 'search-key-delete', 'search-export'].includes(command)) {
      const obj = await openStorage(o.storage).get(COMPOSED_KEY);
      if (obj) return { policy: JSON.parse(new TextDecoder().decode(obj.body)), from: `${o.storage} ${COMPOSED_KEY}` };
      console.warn(`warning: ${o.storage} has no ${COMPOSED_KEY} yet (run compose --storage first); composing from the local checkouts`);
    }
    return { policy: loadPolicy(DEFAULT_POLICY), from: 'local compose' };
  };
  const needsPolicy = ['plan', 'flip', 'rollback', 'retire', 'manifest', 'policy-diff', 'search-index', 'search-check', 'intake'].includes(command);
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
      const notice = (title, m) => console.error(`${process.env.GITHUB_ACTIONS ? `::notice title=${title}::` : 'plan: '}${m}`);
      let list;
      let flipBack = [];
      let extra = {};
      if (scope === 'records') {
        // A push to main that changed releases/*.yaml (intake's merged PR).
        need(o, 'base');
        const dir = path.resolve(o.records ?? RECORD_DIR);
        const s = storage();
        const exists = async (space, segment, release) => Boolean(await s.get(`${releasePrefix(space, segment, release)}_platform/release.json`));
        const changes = recordChanges(recordsAt(o.base, path.relative(process.cwd(), dir) || RECORD_DIR), readRecords(dir));
        for (const w of changes.withdrawals) {
          notice('Withdrawn', `${w.slug} ${w.tag} was withdrawn: ${w.back ? `Edition ${w.edition} goes back to ${w.back.tag}` : `no earlier recorded release of Edition ${w.edition}; the deployment stays as it is`}`);
        }
        ({ deployments: list, flipBack } = await planFromRecords(policy, changes, { rebuildId: o['rebuild-id'], exists }));
      } else {
        if (scope === 'tag') need(o, 'repo', 'tag');
        const state = scope === 'tag' ? undefined : await readState(storage());
        // A Platform release (scope all) rebuilds the deployments whose Content
        // repo pins its major: this Platform's own, unless --major names another.
        const major = scope === 'all' ? Number(o.major ?? PLATFORM_VERSION.split('.')[0]) : undefined;
        const pins = scope === 'all' ? readPlatformPins(policy, o.content ? path.resolve(o.content) : defaultContentDir()) : undefined;
        const skipped = [];
        list = planRelease(policy, { repo: o.repo, tag: o.tag, scope, space: o.space, state, rebuildId: o['rebuild-id'], major, pins, onSkip: (x) => skipped.push(x) });
        for (const x of skipped) {
          const why = x.pin === null ? `${x.repo}'s docs.yml pins no Platform major (PLATFORM_REF: v<n>)` : `${x.repo} pins v${x.pin}`;
          notice('Not rebuilt', `${x.deployment} is not rebuilt by a v${major} Platform release: ${why}`);
        }
        // Builds use a recorded bundle; the Platform's own Doc space and the
        // Landing deployment build from the Platform checkout.
        if (o.records) {
          list = bundlesFor(list, readRecords(path.resolve(o.records)), {
            platformRepo: platformRepoOf(policy), onSkip: (x) => notice('Not rebuilt', `${x.deployment} is not rebuilt: ${x.reason}`),
          });
        }
        if (scope === 'all') extra = { major, skipped };
      }
      const latest = list.filter((d) => d.asLatest);
      const others = list.filter((d) => !d.asLatest);
      const spec = (d) => `${d.space}/${d.segment}=${d.release}`;
      print({
        ...extra,
        deployments: list,
        latest: { include: latest }, others: { include: others },
        hasLatest: latest.length > 0, hasOthers: others.length > 0,
        flip: list.filter((d) => !d.backwards).map(spec).join(' '),
        flipBack: flipBack.map(spec).join(' '),
      });
      return 0;
    }
    case 'intake': {
      const records = path.resolve(o.records ?? RECORD_DIR);
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
      const r = await runIntake({
        policy, recordsDir: records, pendingDir: o.pending ? path.resolve(o.pending) : undefined, outDir: path.resolve(o.out ?? records),
        repo: o.repo, space: o.space, issues: o.issues ? JSON.parse(fs.readFileSync(o.issues, 'utf8')) : [], retry: Boolean(o.retry),
        workDir: path.resolve(o.work ?? path.join(process.env.RUNNER_TEMP ?? '.', 'intake-work')), token,
        signerRepo: o['signer-repo'] ?? process.env.GITHUB_REPOSITORY ?? platformRepoOf(policy), platformRepo: platformRepoOf(policy),
        log: (m) => console.log(m),
      });
      const report = { changes: r.changes.map(({ file, ...c }) => ({ ...c, file: path.relative(process.cwd(), file) })), issues: r.issues, errors: r.errors };
      if (o.report) fs.writeFileSync(o.report, `${JSON.stringify(report, null, 2)}\n`);
      for (const e of r.errors) console.log(process.env.GITHUB_ACTIONS ? `::warning title=Intake::${e}` : `warning: ${e}`);
      console.log(`Intake: ${r.changes.length} record${r.changes.length === 1 ? '' : 's'} changed, ${r.issues.length} new issue${r.issues.length === 1 ? '' : 's'}`);
      return 0;
    }
    case 'record-check': {
      need(o, 'base', 'branch');
      const head = o.head ?? 'HEAD';
      const files = execFileSync('git', ['diff', '--name-only', `${o.base}...${head}`], { encoding: 'utf8' }).split('\n').filter(Boolean);
      const problems = checkRecordChange({ branch: o.branch, files, base: (f) => gitShow(o.base, f), head: (f) => gitShow(head, f) });
      for (const p of problems) console.error(process.env.GITHUB_ACTIONS ? `::error title=Intake record::${p}` : `record-check: ${p}`);
      if (!problems.length) console.log(`record-check: ${files.filter((f) => f.startsWith(`${RECORD_DIR}/`)).length} intake record change(s) are fine for ${o.branch}`);
      return problems.length ? 1 : 0;
    }
    case 'fetch-bundle': {
      need(o, 'repo', 'tag', 'asset', 'sha256', 'out');
      const token = process.env.CONTENT_READ_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
      const r = await fetchBundle({ repo: o.repo, tag: o.tag, asset: o.asset, sha256: o.sha256, out: o.out, token, copy: o.copy });
      if (r.source === 'copy') {
        const m = `${o.asset}: ${r.githubError}; built from the Platform's stored copy`;
        console.log(process.env.GITHUB_ACTIONS ? `::warning title=Bundle copy::${m}` : `warning: ${m}`);
      }
      console.log(`${o.asset}: sha256 matches the record; unpacked ${r.bundle.docSpace} (Edition ${r.edition}) into ${r.dir}`);
      if (o['github-output']) {
        fs.appendFileSync(o['github-output'], `dir=${r.dir}\nedition=${r.edition}\nmain-files=${r.mainFiles ?? ''}\nsource-commit=${r.bundle.sourceCommit}\n`);
      }
      return 0;
    }
    case 'store-bundles':
    case 'bundle-copies': {
      need(o, 'storage', 'plan');
      const token = process.env.CONTENT_READ_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
      const p = JSON.parse(fs.readFileSync(o.plan, 'utf8'));
      const bundles = plannedBundles(p.deployments ?? p.include ?? []);
      const log = (m) => console.log(m);
      if (command === 'store-bundles') {
        const r = await storeBundles(storage(), bundles, { token, workDir: path.resolve(o.work ?? path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'bundle-store')), log });
        console.log(`Bundle store: ${r.stored.length} stored, ${r.present.length} already stored`);
        return 0;
      }
      need(o, 'out');
      const r = await handOverCopies(storage(), bundles, { token, out: path.resolve(o.out), log });
      for (const s of r.missing) {
        const m = `GitHub no longer serves the bundle ${s} and the Platform has no copy (${bundleKey(s)}): its build will fail`;
        console.log(process.env.GITHUB_ACTIONS ? `::warning title=Bundle copy::${m}` : `warning: ${m}`);
      }
      console.log(`Bundle copies: ${r.handed.length} handed to the builds`);
      return 0;
    }
    case 'gc-bundles': {
      need(o, 'records');
      const dir = path.resolve(o.records);
      if (!fs.existsSync(dir)) {
        console.log(`No intake records at ${o.records}: no bundle copy collected`);
        return 0;
      }
      const removed = await collectBundles(storage(), readRecords(dir), { dryRun: o['dry-run'] });
      console.log(removed.length ? `${o['dry-run'] ? 'Would remove' : 'Removed'}: ${removed.join(', ')}` : 'No bundle copy to collect');
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
      const { state, warnings } = await flip(storage(), { environment: o.env, policy, deployments, chrome, backwards: Boolean(o.backwards) });
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
      const fixed = process.env.TYPESENSE_SEARCH_PARENT_KEY || undefined;
      if (fixed && o['new-key']) throw new Error('--new-key makes a key of its own; unset TYPESENSE_SEARCH_PARENT_KEY (on the VM, change it in typesense.env)');
      const key = await ensureSearchOnlyKey(client, collection, fixed, { fresh: o['new-key'] });
      console.log(`${collection}: ${r.created ? 'created' : `exists${r.added.length ? `, added ${r.added.join(', ')}` : ''}`}; analytics rules in place`);
      // A parent given by value (the VM's typesense.env) is never printed.
      if (fixed) console.log(`${key.existed ? 'Reusing' : 'Made'} search-only parent key ${key.id} (${fixed.slice(0, 4)}…) from TYPESENSE_SEARCH_PARENT_KEY`);
      else if (key.existed) console.log(`Reusing search-only parent key ${key.id} (${key.value_prefix}…); its value was printed when it was made. Run with --new-key for another.`);
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
    case 'search-export': {
      need(o, 'out');
      const deployments = o.deploy?.flatMap((d) => d.split(/\s+/).filter(Boolean)).map(parseDeploy);
      const composed = o.policy ? fs.readFileSync(o.policy) : undefined;
      const r = await exportSearchInputs(storage(), path.resolve(o.out), { deployments, composed });
      console.log(`Wrote the search inputs of ${r.deployments.length ? r.deployments.join(' ') : 'no deployment'} to ${o.out}`);
      return 0;
    }
    case 'search-key': {
      o.parent ??= process.env.TYPESENSE_SEARCH_PARENT_KEY || undefined;
      if (!o.parent) throw new Error('--parent is required (or TYPESENSE_SEARCH_PARENT_KEY)');
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
