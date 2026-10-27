// `wso2-release compose`: the compose step as the pipeline runs it.
//
// On main (every manifest change on main, and before every release):
//   compose [--navigation <dir>] [--content <dir>] [--out <file>]
//           [--last-good <file> | --storage <s>] [--report <file>]
// composes the Deployment manifest and writes it to --out (and to the
// storage's _platform/composed.json). When it fails, the last good copy stays:
// --out gets the last good copy back, storage is left alone, and the owners of
// the files in error are named for alerting. Exit code 1.
//
// The base a Platform PR is checked against (compose-check.yml):
//   compose --as-base --out <file> [--navigation <dir>] [--content <dir>] [--platform-root <dir>]
// main's inputs composed and written even when main has errors (exit 0).
//
// On a PR:
//   compose --pr (--base <file> | --storage <s>) [--navigation <dir>] [--content <dir>]
//           [--repo <owner/name> --repo-dir <checkout>] [--report <file>]
// composes against the latest merged manifest with the PR's files in place:
// the Platform's navigation/ (a Platform PR, the default), Content repo
// checkouts under --content, or one Content repo checkout (a Content repo PR). Every issue names its files and owners; only
// errors in the files the PR changes block it.
//
// A Content repo's PR, with no secrets and no other checkout:
//   compose --pr --published <url|file> --repo-dir <checkout> [--repo <owner/name>] [--base-ref <ref>]
// composes against the published manifest.json (lib/published.mjs) instead,
// with this repo's Doc space manifests as the PR has them; the repo's own
// files on its main line (--base-ref, default main or origin/main) are what
// the PR changes them from.
import fs from 'node:fs';
import path from 'node:path';
import {
  COMPOSED_KEY, DEFAULT_NAVIGATION, PLATFORM_ROOT, compose, composeMain, composePr, defaultContentDir, errorsIn, formatIssues, readInputs, readPrInputs,
} from './compose.mjs';
import { openStorage } from './storage.mjs';
import { baseFromPublished, knownRepo, localRepo, readPublished } from './published.mjs';
import { mainRef, readRepoDocSpaces } from './compose.mjs';

const summary = (m) => {
  const spaces = Object.values(m.docSpaces);
  const notYet = spaces.filter((s) => !s.source).length;
  return `${spaces.length - notYet} Doc spaces, ${Object.keys(m.sections).length} Docs sections, ${notYet} products not on WSO2 Docs yet`;
};

async function readJsonKey(storage, key) {
  const obj = await storage.get(key);
  return obj ? JSON.parse(new TextDecoder().decode(obj.body)) : null;
}

const readJsonFile = (file) => (file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

// GitHub annotations in Actions, plain lines elsewhere. `fileOf` gives the
// path in this checkout of an issue's file, so the annotation sits on it.
function emit(log, issues, { changed, actions, fileOf = () => null }) {
  if (!issues.length) return;
  if (actions) {
    for (const i of issues) {
      const kind = i.level === 'note' ? 'notice' : i.level;
      const file = i.files.map(fileOf).find(Boolean);
      log(`::${kind} ${file ? `file=${file},` : ''}title=Compose ${i.code}::${i.message} (in ${i.files.join(', ')}; owners: ${i.owners.join(', ') || 'none'})`);
    }
  } else log(formatIssues(issues, { changed }));
}

export async function runComposeCommand(o, { log = console.log, env = process.env } = {}) {
  const actions = Boolean(env.GITHUB_ACTIONS);
  const storage = o.storage ? openStorage(o.storage, env) : null;
  const navigationDir = o.navigation ? path.resolve(o.navigation) : DEFAULT_NAVIGATION;
  const report = (data) => o.report && writeJson(o.report, data);

  if (o.pr && o.published) {
    if (!o['repo-dir']) throw new Error('compose --pr --published composes one Content repo checkout: pass --repo-dir <checkout>');
    const published = await readPublished(o.published, { log });
    const here = localRepo(path.resolve(o['repo-dir']));
    const repo = o.repo ?? here.repo;
    const entry = { repo, path: here.path };
    const base = baseFromPublished(published);
    // What the PR changes this repo's manifests from: its main line.
    const ref = o['base-ref'] ?? mainRef(here.checkout);
    const lower = (x) => String(x).toLowerCase();
    if (ref) {
      base.sources.docSpaces = [
        ...base.sources.docSpaces.filter((d) => lower(d.repo) !== lower(repo)),
        ...readRepoDocSpaces(here.checkout, entry, { ref }),
      ];
    }
    if (!knownRepo(published, repo)) log(`compose: ${repo} has no Doc space on WSO2 Docs yet; its first release needs it in contentRepos in the Platform's navigation/navigation.yaml (the Platform team adds it)`);
    const local = { repos: [repo], docSpaces: readRepoDocSpaces(here.checkout, entry) };
    const r = composePr(base, local);
    const own = `${repo.toLowerCase()}:`;
    const fileOf = (f) => (f.toLowerCase().startsWith(own) ? `${o.annotate ?? ''}${f.slice(own.length)}` : null);
    // Only what involves this repo's files: other teams' warnings are theirs.
    const shown = r.issues.filter((i) => i.level === 'error' || i.files.some(fileOf));
    emit(log, shown, { changed: r.changed, actions, fileOf });
    log(`compose: this change touches ${r.changed.size ? [...r.changed].join(', ') : 'no manifest'}`);
    const others = errorsIn(r.issues).length - r.blocking.length;
    if (others) log(`compose: ${others} error${others === 1 ? '' : 's'} not caused by this change`);
    if (r.ok) log(`compose: passes against the published manifest (${o.published})`);
    else log(`compose: ${r.blocking.length} blocking error${r.blocking.length === 1 ? '' : 's'} in this change (owners: ${r.alert.join(', ')})`);
    report({ ok: r.ok, mode: 'pr', base: o.published, changed: [...r.changed], issues: r.issues, alert: r.alert });
    return r.ok ? 0 : 1;
  }

  if (o.pr) {
    const base = o.base ? readJsonFile(path.resolve(o.base)) : storage ? await readJsonKey(storage, COMPOSED_KEY) : null;
    if (!base) throw new Error('compose --pr needs the latest merged manifest: --base <file>, --storage <s> or --published <url|file>');
    const local = readPrInputs(base, {
      navigationDir: o.repo && !o.navigation ? null : navigationDir,
      platformRoot: o['platform-root'] ? path.resolve(o['platform-root']) : PLATFORM_ROOT,
      repo: o.repo,
      repoDir: o['repo-dir'] ? path.resolve(o['repo-dir']) : undefined,
      contentDir: o.content ? path.resolve(o.content) : undefined,
    });
    const r = composePr(base, local);
    emit(log, r.issues, { changed: r.changed, actions });
    log(`compose: this change touches ${r.changed.size ? [...r.changed].join(', ') : 'no manifest'}`);
    const others = errorsIn(r.issues).length - r.blocking.length;
    if (others) log(`compose: ${others} error${others === 1 ? '' : 's'} not caused by this change (already on main)`);
    if (r.ok) log(`compose: passes against the latest merged manifest${r.manifest ? ` (${summary(r.manifest)})` : ''}`);
    else log(`compose: ${r.blocking.length} blocking error${r.blocking.length === 1 ? '' : 's'} in this change (owners: ${r.alert.join(', ')})`);
    report({ ok: r.ok, mode: 'pr', changed: [...r.changed], issues: r.issues, alert: r.alert });
    return r.ok ? 0 : 1;
  }

  const inputs = readInputs({
    navigationDir,
    contentDir: o.content ? path.resolve(o.content) : defaultContentDir(env),
    platformRoot: o['platform-root'] ? path.resolve(o['platform-root']) : PLATFORM_ROOT,
  });
  // The base of a Platform PR's check (compose-check.yml): main's inputs as
  // they are, written even when main has errors, so the PR check lists those
  // as "not caused by this change" instead of failing before it starts.
  if (o['as-base']) {
    if (!o.out) throw new Error('compose --as-base writes the base for compose --pr: pass --out <file>');
    const { manifest, issues } = compose(inputs);
    if (!manifest) {
      emit(log, issues, { actions });
      log('compose: the Platform navigation file on main does not read, so there is no base to check a PR against');
      return 1;
    }
    writeJson(o.out, { ...manifest, composedAt: new Date().toISOString() });
    const n = errorsIn(issues).length;
    log(`compose: wrote the base ${o.out} (${summary(manifest)})${n ? `; main has ${n} error${n === 1 ? '' : 's'}, which the PR check lists as not caused by the PR` : ''}`);
    return 0;
  }
  const lastGood = o['last-good'] ? readJsonFile(path.resolve(o['last-good'])) : storage ? await readJsonKey(storage, COMPOSED_KEY) : readJsonFile(o.out && path.resolve(o.out));
  const r = composeMain(inputs, { lastGood });
  emit(log, r.issues, { actions });
  if (r.ok) {
    if (o.out) writeJson(o.out, r.manifest);
    if (storage) await storage.put(COMPOSED_KEY, `${JSON.stringify(r.manifest, null, 2)}\n`, { contentType: 'application/json' });
    log(`compose: ${summary(r.manifest)}${o.out ? `; wrote ${o.out}` : ''}${storage ? `; stored ${COMPOSED_KEY}` : ''}`);
  } else {
    const n = errorsIn(r.issues).length;
    if (r.keptLastGood) {
      if (o.out) writeJson(o.out, r.manifest);
      log(`compose: failed with ${n} blocking error${n === 1 ? '' : 's'}; keeping the last good manifest (composed ${r.manifest.composedAt ?? 'earlier'})`);
    } else log(`compose: failed with ${n} blocking error${n === 1 ? '' : 's'}, and there is no last good manifest to keep`);
    log(`compose: alert ${r.alert.join(', ')}`);
    if (actions) log(`::error title=Compose failed::Keeping the last good manifest. Alert: ${r.alert.join(', ')}`);
  }
  report({ ok: r.ok, mode: 'main', keptLastGood: r.keptLastGood, issues: r.issues, alert: r.alert });
  return r.ok ? 0 : 1;
}
