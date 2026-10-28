// GitHub Actions workflows and the Edge Worker's wrangler config cannot run
// here, so they are checked for shape: YAML parses, the release sequence is in
// order, production stays off, PR builds hold no secrets, and wrangler can
// bundle the Worker for both environments. actionlint runs too when ACTIONLINT
// points at its binary (CI installs it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const platformDir = path.join(root, '.github', 'workflows');
const templateDir = path.join(root, 'templates', 'content-repo', '.github', 'workflows');
const files = [
  ...fs.readdirSync(platformDir).map((f) => path.join(platformDir, f)),
  ...fs.readdirSync(templateDir).map((f) => path.join(templateDir, f)),
];
const load = (file) => yaml.load(fs.readFileSync(file, 'utf8'));
const wf = (name) => load(path.join(platformDir, name));

test('every workflow parses and has triggers and jobs', () => {
  assert.ok(files.length >= 9, files.join(', '));
  for (const file of files) {
    const w = load(file);
    assert.ok(w.name, `${file}: name`);
    assert.ok(w.on, `${file}: on`);
    assert.ok(Object.keys(w.jobs ?? {}).length, `${file}: jobs`);
    assert.ok(w.permissions, `${file}: explicit permissions`);
  }
});

test('release.yml: starts from the intake records or a rebuild dispatch, one matrix job per deployment, the release sequence, production off', () => {
  const w = wf('release.yml');
  assert.deepEqual(w.on.push, { branches: ['main'], paths: ['releases/*.yaml'] }, 'a merged intake record change starts the release');
  assert.deepEqual(Object.keys(w.on.workflow_dispatch.inputs), ['repo', 'tag', 'scope', 'space']);
  assert.equal(w.on.release, undefined, 'a Platform release dispatches the rebuild (platform-release.yml)');
  assert.deepEqual(Object.keys(w.jobs), ['plan', 'build-latest', 'build', 'publish', 'finalize-staging', 'promote']);
  for (const job of ['build-latest', 'build']) {
    assert.equal(w.jobs[job].uses, './.github/workflows/build-deployment.yml');
    assert.match(w.jobs[job].strategy.matrix, /fromJSON\(needs\.plan\.outputs\.(latest|others)\)/);
    assert.deepEqual(Object.keys(w.jobs[job].secrets), ['CONTENT_READ_TOKEN'], 'build jobs get no storage or search credential');
    assert.equal(w.jobs[job].with.asset, '${{ matrix.asset }}');
  }
  assert.ok(w.jobs.build.needs.includes('build-latest'), 'latest twins build first');
  const plan = w.jobs.plan.steps.find((s) => s.id === 'plan').run;
  assert.match(plan, /--content "\$RUNNER_TEMP\/content"/, 'a Platform release reads each Content repo\'s pinned major from its main line');
  assert.match(plan, /plan --scope records --base "\$BEFORE" --records releases/, 'a push plans from the intake records');
  assert.match(plan, /--records releases\)/, 'rebuilds build from recorded bundles');
  assert.match(plan, /Scope tag releases only this repo's own Doc space/, 'Content repos release through intake, not a dispatch');
  const steps = (job) => w.jobs[job].steps.map((s) => s.name ?? s.uses ?? s.run);
  assert.match(w.jobs.publish.strategy.matrix, /fromJSON\(needs\.plan\.outputs\.all\)/);
  assert.equal(w.jobs.publish.environment, 'staging');
  assert.ok(steps('publish').includes('Upload the release folder to staging (step 3)'));
  assert.ok(w.jobs['finalize-staging'].needs.includes('publish'));
  const fin = steps('finalize-staging');
  const order = ['Flip the staging pointer (step 4)', 'Staging redirect table', 'Staging crawl gate (step 5)', 'Keep the last 5 releases', 'Summary (step 10)'];
  assert.deepEqual(fin.filter((s) => order.includes(s)), order);
  assert.match(w.jobs['finalize-staging'].steps.find((s) => s.name === 'Flip the staging pointer (step 4)').run, /--deploy "\$FLIP_BACK" --backwards/, 'a withdrawal flips back');
  assert.equal(w.jobs['finalize-staging'].concurrency, undefined, 'state writers queue on the state lock, not a concurrency group');
  assert.match(w.jobs.promote.if, /vars\.DOCS_PRODUCTION_ENABLED == 'true'/);
  assert.match(w.jobs.promote.if, /crawl-passed == 'true'/);
  assert.equal(w.jobs.promote.environment, 'production');
  assert.deepEqual(steps('promote').filter((s) => /step [79]/.test(s)).length, 3);

  // The job that runs bundle content holds no storage, search or edge credential.
  const b = load(path.join(platformDir, 'build-deployment.yml'));
  const text = fs.readFileSync(path.join(platformDir, 'build-deployment.yml'), 'utf8');
  assert.equal(b.jobs.build.environment, undefined, 'no environment, so no environment secrets');
  assert.doesNotMatch(text, /R2_|CLOUDFLARE_|TYPESENSE_ADMIN|secrets: inherit/);
  assert.deepEqual(Object.keys(b.on.workflow_call.secrets), ['CONTENT_READ_TOKEN']);
  const bs = b.jobs.build.steps.map((s) => s.name ?? s.uses);
  const fetchStep = b.jobs.build.steps.find((s) => s.id === 'bundle');
  assert.match(fetchStep.run, /fetch-bundle --repo "\$REPO" --tag "\$TAG" --asset "\$ASSET" --sha256 "\$SHA256"/);
  assert.match(fetchStep.run, /--out "\$GITHUB_WORKSPACE\/bundle"/, 'inside the Platform checkout: Docusaurus fails to render pages from outside it');
  assert.equal(fetchStep.env.CONTENT_READ_TOKEN, '${{ secrets.CONTENT_READ_TOKEN }}', 'the read token reaches the download step alone');
  assert.ok(b.jobs.build.steps.filter((s) => s.env?.CONTENT_READ_TOKEN).length === 1);
  assert.ok(bs.indexOf(fetchStep.name) < bs.indexOf('Build (step 1)'));
  assert.ok(bs.indexOf('Build (step 1)') < bs.indexOf('Blocking checks (step 2)'));
  assert.ok(bs.indexOf('Blocking checks (step 2)') < bs.indexOf('Hand the build to the publish job'));
  assert.match(b.jobs.build.steps.find((s) => s.name === 'Build (step 1)').run, /--main-files "\$MAIN_FILES"/, '"Edit this page" from bundle.json');
  const buildRun = b.jobs.build.steps.find((s) => s.name === 'Build (step 1)').run;
  assert.match(buildRun, /--env production/, 'release builds are production builds (README: Release builds add --env production)');
  const cache = b.jobs.build.steps.find((s) => s.name === 'Docusaurus caches for this deployment').with;
  for (const k of [cache.key, cache['restore-keys']]) assert.match(k, /\$\{\{ github\.sha \}\}/, 'a Platform change never restores another Platform commit\'s webpack cache');
});

test('intake.yml: polls on a schedule or by hand, proposes with an App token in a job that runs no Platform code, reports once', () => {
  const w = wf('intake.yml');
  assert.deepEqual(w.on.schedule, [{ cron: '7,37 * * * *' }]);
  assert.deepEqual(Object.keys(w.on.workflow_dispatch.inputs), ['repo', 'space']);
  assert.deepEqual(w.permissions, {});
  assert.deepEqual(Object.keys(w.jobs), ['poll', 'propose', 'report']);
  const poll = w.jobs.poll;
  assert.ok(Object.values(poll.permissions).every((p) => p === 'read'), 'the job that unpacks bundles can write nothing');
  const run = poll.steps.find((s) => s.id === 'intake');
  assert.match(run.run, /intake --policy "\$RUNNER_TEMP\/composed\.json" --records releases --pending "\$RUNNER_TEMP\/pending"/);
  assert.match(run.run, /--issues "\$RUNNER_TEMP\/issues\.json"/);
  assert.equal(run.env.RETRY, "${{ github.event_name == 'workflow_dispatch' }}", 'only a run by hand tries a failed tag again');
  assert.doesNotMatch(JSON.stringify(poll), /DOCS_INTAKE_APP|R2_|CLOUDFLARE_|TYPESENSE/);
  const propose = w.jobs.propose;
  assert.deepEqual(propose.permissions, { contents: 'read' });
  assert.equal(propose.steps[0].uses, 'actions/create-github-app-token@v2', 'the token is minted first');
  assert.ok(!propose.steps.some((s) => /node |npm /.test(s.run ?? '') || s.uses?.startsWith('actions/setup-node')), 'no Platform or content code where the App token is');
  const push = propose.steps.at(-1).run;
  assert.match(push, /branch="intake\/\$SLUG"/);
  assert.match(push, /git push --force origin "\$branch"/);
  assert.match(push, /gh pr merge "\$branch" --auto --squash/);
  assert.equal(propose.steps.at(-1).env.GH_TOKEN, '${{ steps.app.outputs.token }}');
  assert.deepEqual(w.jobs.report.permissions, { issues: 'write' });
  assert.match(w.jobs.report.steps.at(-1).run, /--label bundle-intake/);
  // The record's required check, for auto-merge.
  const ci = wf('ci.yml');
  assert.match(ci.jobs['intake-record'].steps.at(-1).run, /record-check --base "origin\/\$BASE_REF" --branch "\$HEAD_REF"/);
});

test('platform-release.yml: a v<major>.<minor>.<patch> tag publishes @wso2/docs with trusted publishing, moves the major tag and rebuilds that major', () => {
  const w = wf('platform-release.yml');
  assert.deepEqual(Object.keys(w.on), ['push']);
  assert.deepEqual(w.on.push, { tags: ['v[0-9]+.[0-9]+.[0-9]+'] }, 'release tags only: the moving v1 tag starts nothing');
  const job = w.jobs.release;
  assert.equal(job.environment, 'npm', 'the environment npm\'s trusted publisher names');
  assert.deepEqual(job.permissions, { contents: 'write', 'id-token': 'write', actions: 'write' });
  const text = fs.readFileSync(path.join(platformDir, 'platform-release.yml'), 'utf8');
  assert.doesNotMatch(text, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./, 'trusted publishing: no npm token');
  const steps = job.steps.map((s) => s.name ?? s.uses ?? s.run);
  const order = ['Check the tag (version, main line, CI)', 'Publish @wso2/docs to npm', 'Move the major tag', 'GitHub release', 'Rebuild the Docs deployments pinned to this major'];
  assert.deepEqual(steps.filter((s) => order.includes(s)), order);
  const step = (name) => job.steps.find((s) => s.name === name);
  assert.match(job.steps.find((s) => s.run?.startsWith('npm install -g npm@')).run, /npm@\^11\.5\.1/, 'trusted publishing needs npm 11.5.1');
  assert.equal(job.steps.find((s) => s.uses?.startsWith('actions/setup-node')).with['registry-url'], 'https://registry.npmjs.org');
  assert.match(step('Check the tag (version, main line, CI)').run, /platform-release --tag "\$TAG"/);
  assert.match(step('Check the tag (version, main line, CI)').run, /merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(step('Publish @wso2/docs to npm').run, /npm publish --access public/);
  // The major ref is a tag: force-moved as a tag, never pushed as a branch.
  const move = step('Move the major tag');
  assert.equal(move.if, "steps.check.outputs.move-major == 'true'");
  assert.match(move.run, /git tag -f "\$MAJOR_TAG" "\$GITHUB_SHA"/);
  assert.match(move.run, /git push -f origin "refs\/tags\/\$MAJOR_TAG"/);
  assert.doesNotMatch(text, /refs\/heads/);
  const rebuild = step('Rebuild the Docs deployments pinned to this major');
  assert.equal(rebuild.if, "steps.check.outputs.move-major == 'true'", 'an older patch never rebuilds over a newer release');
  assert.match(rebuild.run, /gh workflow run release\.yml --ref "\$TAG" -f scope=all/);
});

test('platform-deployments.yml: a change on main releases Contribute and, for navigation/, the Landing deployment', async () => {
  const { CONTRIBUTE_PATHS, LANDING_PATHS } = await import('../lib/platform-release.mjs');
  const w = wf('platform-deployments.yml');
  const glob = (p) => (p.endsWith('/') ? `${p}**` : p);
  assert.deepEqual([...w.on.push.paths].sort(), [...new Set([...CONTRIBUTE_PATHS, ...LANDING_PATHS].map(glob))].sort(), 'the path filter is the union of both lists');
  assert.deepEqual(w.on.push.branches, ['main']);
  assert.match(w.jobs.plan.steps.find((s) => s.id === 'changes').run, /platform-changes --base "\$BEFORE" --head "\$GITHUB_SHA" --github-output "\$GITHUB_OUTPUT"/);
  const contribute = w.jobs.contribute;
  assert.equal(contribute.if, "needs.plan.outputs.contribute == 'true'");
  assert.match(contribute.steps.find((s) => s.id === 'tag').run, /prefix="cloud-\$\(date -u \+%Y\.%m\.%d\)\."/, 'a Cloud tag, as docs.yml makes');
  assert.match(contribute.steps.at(-1).run, /gh workflow run release\.yml --ref "\$TAG" -f repo="\$GITHUB_REPOSITORY" -f tag="\$TAG"/);
  assert.equal(w.jobs.landing.if, "needs.plan.outputs.landing == 'true'");
  assert.match(w.jobs.landing.steps.at(-1).run, /gh workflow run release\.yml .*-f scope=landing/);

  const r = wf('release.yml');
  assert.deepEqual(r.on.workflow_dispatch.inputs.scope.options, ['tag', 'docspace', 'all', 'landing']);
  assert.match(r.concurrency.group, /inputs\.scope/, 'a Landing release has its own group, not the Platform rebuild\'s');
  const b = wf('build-deployment.yml').jobs.build;
  assert.equal(b.steps.find((s) => s.name === 'Check out the Platform\'s own Doc space at the tag').if, "inputs.space != '_landing' && inputs.asset == ''");
  assert.match(b.steps.find((s) => s.name === 'Build (step 1)').run, /\[ "\$LANDING" = "true" \] && args=\(build --landing --env production --manifest/);
  assert.match(b.steps.find((s) => s.name === 'Blocking checks (step 2)').run, /check --dir build --space "\$SPACE"[^\n]*\n\s*\[ "\$LANDING" = "true" \] && exit 0/);
});

test('Content repo templates call the Platform at one major tag', () => {
  const refs = new Set();
  for (const f of fs.readdirSync(templateDir)) {
    const text = fs.readFileSync(path.join(templateDir, f), 'utf8');
    for (const m of text.matchAll(/wso2\/docs-platform\/\.github\/workflows\/[\w.-]+@(\S+)/g)) refs.add(m[1]);
    for (const m of text.matchAll(/^\s*(?:platform-ref|PLATFORM_REF):\s*(\S+)/gm)) refs.add(m[1]);
    assert.doesNotMatch(text, /refs\/heads\/v\d/, f);
  }
  assert.deepEqual([...refs], ['v1'], 'one major, the v1 tag platform-release.yml moves');
});

test('manifests.yml composes on a push or by hand; production republishes what staging composed', () => {
  const w = wf('manifests.yml');
  assert.ok('workflow_dispatch' in w.on, 'the Platform team can compose now');
  const steps = w.jobs.staging.steps;
  const prev = steps.find((s) => s.name === 'Compose the previous commit, for the rebuild diff');
  const stored = steps.find((s) => s.name === 'The last good composed manifest, for the rebuild diff');
  assert.equal(prev.if, "github.event_name == 'push'");
  assert.equal(stored.if, "github.event_name != 'push'");
  assert.match(stored.run, /composed --storage s3:\/\/docs-staging --out "\$RUNNER_TEMP\/old\.json"/);
  const prod = w.jobs.production.steps.map((s) => s.run).filter(Boolean).join('\n');
  assert.doesNotMatch(prod, /\bcompose --storage s3:\/\/docs-prod/, 'production has no Content repo checkouts to compose from');
  assert.match(prod, /composed --storage s3:\/\/docs-staging --out composed\.json/);
  assert.match(prod, /manifest --storage s3:\/\/docs-prod --env production --policy composed\.json/);
});

test('rollback.yml points deployments back with no build, then the redirect table and the search index', () => {
  const w = wf('rollback.yml');
  assert.deepEqual(Object.keys(w.on.workflow_dispatch.inputs), ['deployments', 'to', 'environment']);
  assert.deepEqual(w.on.workflow_dispatch.inputs.environment.options, ['staging', 'production']);
  const job = w.jobs.rollback;
  assert.equal(job.concurrency, undefined, 'it waits its turn on the state lock with releases');
  const runs = job.steps.map((s) => s.run ?? '').join('\n');
  assert.match(runs, /rollback --storage "\$STORAGE" --env "\$ENV_NAME" --policy composed\.json --deployment "\$d"/);
  assert.match(runs, /--to "\$TO"/);
  assert.match(runs, /redirects --storage "\$STORAGE" --kv "cloudflare:/);
  assert.match(runs, /search-check --env "\$ENV_NAME" --storage "\$STORAGE" --policy composed\.json --fix/);
  assert.doesNotMatch(runs, /wso2-docs\.mjs build/, 'no build');
  assert.match(job.env.STORAGE, /docs-prod.*docs-staging/);
  assert.match(job.if, /vars\.DOCS_PRODUCTION_ENABLED == 'true'/, 'production stays off');
});

test('no workflow guards the published state with a concurrency group: it would cancel a waiting writer', () => {
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /group: docs-state-/, file);
  }
  // Every state-writing command in a workflow runs through wso2-release, which takes the state lock.
  const writers = /wso2-release\.mjs (flip|rollback|retire|manifest|redirects|gc)\b/;
  for (const name of ['release.yml', 'rollback.yml', 'manifests.yml']) assert.match(fs.readFileSync(path.join(platformDir, name), 'utf8'), writers, name);
});

test('PR previews: the build holds no secrets, the publish runs from workflow_run', () => {
  const build = fs.readFileSync(path.join(platformDir, 'pr-preview.yml'), 'utf8');
  assert.doesNotMatch(build, /secrets\./);
  assert.ok(load(path.join(platformDir, 'pr-preview.yml')).on.workflow_call);
  const publish = load(path.join(templateDir, 'docs-preview-publish.yml'));
  assert.deepEqual(publish.on.workflow_run, { workflows: ['Docs'], types: ['completed'] });
  assert.match(publish.jobs.publish.if, /workflow_run\.event == 'pull_request'/);
  assert.equal(publish.jobs.publish.uses, 'wso2/docs-platform/.github/workflows/pr-preview-publish.yml@v1');
});

test('Content repo template: path-filtered previews on PRs, tags then calls the Platform\'s bundle workflow, for several Doc spaces', () => {
  const w = load(path.join(templateDir, 'docs.yml'));
  assert.equal(w.name, 'Docs', 'docs-preview-publish.yml listens for this name');
  assert.deepEqual(w.on.pull_request.branches, ['main', 'release/**', '*/release/**'], 'prefixed release branches');
  assert.deepEqual(w.on.push.tags, ['*-docs.*', 'cloud-*', '*/*-docs.*', '*/cloud-*'], 'prefixed tags');
  assert.ok(w.on.workflow_dispatch.inputs['doc-space'] && w.on.workflow_dispatch.inputs.version.required);
  // The plan is the path filter: which Doc spaces this event touches.
  const plan = w.jobs.plan.steps.find((s) => s.id === 'plan').run;
  assert.match(plan, /node platform\/bin\/wso2-docs\.mjs spaces content "\$\{args\[@\]\}" --github-output "\$GITHUB_OUTPUT"/);
  assert.match(plan, /pull_request\) args=\(--branch "\$BASE_REF" --base "origin\/\$BASE_REF"\)/);
  assert.match(plan, /push\) args=\(--push --base "\$BEFORE"\)/);
  assert.deepEqual(Object.keys(w.jobs.plan.outputs), ['spaces', 'releases']);
  // One preview per touched Doc space; one required status sums them up.
  assert.equal(w.jobs.preview.uses, 'wso2/docs-platform/.github/workflows/pr-preview.yml@v1');
  assert.equal(w.jobs.preview.strategy.matrix.space, '${{ fromJSON(needs.plan.outputs.spaces) }}');
  assert.deepEqual(w.jobs.preview.with, { 'platform-ref': 'v1', 'doc-space': '${{ matrix.space.dir }}', edition: '${{ matrix.space.edition }}' });
  assert.equal(w.jobs.checks.name, 'preview / checks', 'the name branch protection requires');
  assert.deepEqual(w.jobs.checks.needs, ['plan', 'preview', 'compose'], 'the compose check of a PR to main counts too');
  assert.match(w.jobs.checks.if, /always\(\)/);
  // Each release: the next [<doc space>/] tag on its branch, then its Docs bundle.
  const tag = w.jobs.tag.steps.find((s) => s.id === 'tag');
  assert.equal(tag.env.RELEASES, '${{ needs.plan.outputs.releases }}');
  assert.match(tag.run, /prefix="\$TAG_PREFIX\$VERSION-docs\."/);
  assert.match(tag.run, /prefix="\$\{TAG_PREFIX\}cloud-/);
  assert.match(tag.run, /git tag "\$tag" "origin\/\$REF"/, 'a version release tags its release branch');
  assert.equal(w.jobs.release.strategy.matrix.tag, '${{ fromJSON(needs.tag.outputs.tags) }}');
  for (const [job, tagged] of [['release', '${{ matrix.tag }}'], ['release-tag', '${{ github.ref_name }}']]) {
    assert.equal(w.jobs[job].uses, 'wso2/docs-platform/.github/workflows/docs-bundle.yml@v1', job);
    assert.deepEqual(w.jobs[job].with, { tag: tagged }, job);
    assert.deepEqual(w.jobs[job].permissions, { contents: 'write', 'id-token': 'write', attestations: 'write' }, job);
  }
  // No Platform credential in the release path; the branch cut keeps the App key.
  const text = fs.readFileSync(path.join(templateDir, 'docs.yml'), 'utf8');
  assert.doesNotMatch(text, /gh workflow run release\.yml|create-github-app-token/);
  assert.deepEqual(Object.keys(w.jobs['branch-cut'].secrets), ['DOCS_PLATFORM_APP_KEY', 'DOCS_PLATFORM_READ_TOKEN']);
});

test('docs-bundle.yml: called with a tag; checks, packs, attests and publishes with the Platform at v1, least privilege', () => {
  const w = wf('docs-bundle.yml');
  assert.deepEqual(Object.keys(w.on), ['workflow_call']);
  assert.equal(w.on.workflow_call.inputs.tag.required, true);
  assert.deepEqual(Object.keys(w.on.workflow_call.inputs), ['tag'], 'the caller chooses only the tag, never the Platform code');
  assert.deepEqual(w.permissions, {});
  assert.deepEqual(w.env, { PLATFORM_REPO: 'wso2/docs-platform', PLATFORM_REF: 'v1', WSO2_DOCS_PUBLISHED_MANIFEST: '${{ vars.DOCS_PUBLISHED_MANIFEST }}' }, 'the caller\'s published manifest, so a release can run before staging exists');
  const job = w.jobs.bundle;
  assert.deepEqual(job.permissions, { contents: 'write', 'id-token': 'write', attestations: 'write' });
  const steps = job.steps;
  const at = (pred) => steps.findIndex(pred);
  const content = steps[at((s) => s.name === 'Check out the Content repo at the tag')];
  assert.equal(content.with.ref, 'refs/tags/${{ inputs.tag }}');
  assert.equal(content.with['persist-credentials'], false);
  const platform = steps[at((s) => s.name === 'Check out the Platform at v1')];
  assert.equal(platform.with.repository, '${{ env.PLATFORM_REPO }}');
  assert.equal(platform.with.ref, '${{ env.PLATFORM_REF }}');
  const check = at((s) => /wso2-docs\.mjs check "content\/\$DIR" --release --no-lint --edition "\$EDITION"/.test(s.run ?? ''));
  const pack = at((s) => /wso2-docs\.mjs bundle content --tag "\$TAG"/.test(s.run ?? ''));
  const attest = at((s) => s.uses === 'actions/attest-build-provenance@v2');
  const publish = at((s) => /gh release create/.test(s.run ?? ''));
  assert.ok(at((s) => s.name === "Check the tag's name") === 0, 'the tag is checked before anything uses it');
  assert.ok(check > 0 && check < pack && pack < attest && attest < publish, `${check} ${pack} ${attest} ${publish}`);
  assert.equal(steps[attest].with['subject-path'], '${{ runner.temp }}/bundle/${{ steps.bundle.outputs.asset }}');
  const run = steps[publish].run;
  assert.match(run, /--latest=false/);
  assert.match(run, /--prerelease=false/);
  assert.match(run, /--verify-tag/);
  assert.match(run, /sha256/);
  assert.match(run, /Source commit/);
  // Inputs reach shell steps through env only.
  for (const s of steps) assert.doesNotMatch(s.run ?? '', /\$\{\{/, s.name ?? s.uses);
  // What it signs comes from fresh checkouts only: no restored cache.
  assert.ok(!steps.some((s) => s.uses?.startsWith('actions/cache') || s.with?.cache), 'no cache in the signing job');
});

test('docs-bundle.yml works out the Doc space and the Edition from the tag', () => {
  const step = wf('docs-bundle.yml').jobs.bundle.steps.find((s) => s.id === 'what');
  const script = /node --input-type=module -e "([^]*?)" "\$TAG"/.exec(step.run)[1];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wso2-bundle-wf-'));
  fs.cpSync(path.join(root, 'fixtures', 'stub-repo'), path.join(dir, 'content'), { recursive: true });
  fs.symlinkSync(root, path.join(dir, 'platform'));
  const what = (tag) => execFileSync(process.execPath, ['--input-type=module', '-e', script, tag], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(what('identity-server/7.3.0-docs.2'), 'identity-server 7.3.0');
  assert.equal(what('identity-platform/cloud-2026.10.27.1'), 'identity-platform cloud');
  assert.throws(() => what('api-manager/4.6.0-docs.1'));
});

test('PR previews show Edition markers, as local preview does; release builds never do', () => {
  const steps = wf('pr-preview.yml').jobs.build.steps;
  const check = steps.find((s) => s.id === 'check').run;
  assert.match(check, /--build-out checked\/site/, 'the checks read their own strict build');
  const preview = steps.find((s) => s.name === 'Preview build with Edition markers');
  assert.match(preview.run, /wso2-docs\.mjs build "\$DIR" --edition "\$EDITION" --base-url "\$BASE_URL"/);
  assert.match(preview.run, /--show-markers --out preview\/site/);
  assert.match(preview.run, /cp -R checked\/site preview\/site/, 'without it, the checked build is the preview');
  assert.ok(steps.indexOf(preview) > steps.findIndex((s) => s.id === 'check'));
  const upload = steps.find((s) => s.uses === 'actions/upload-artifact@v4');
  assert.equal(upload.with.path, 'preview');
  for (const name of ['build-deployment.yml', 'release.yml', 'rollback.yml']) {
    assert.doesNotMatch(fs.readFileSync(path.join(platformDir, name), 'utf8'), /show-markers|SHOW_MARKERS/, name);
  }
});

test('Branch cut: a created release branch starts the bot, which opens the pull request on main with the branch cut report', () => {
  const w = load(path.join(templateDir, 'docs.yml'));
  assert.ok('create' in w.on);
  assert.match(w.jobs.plan.if, /github\.event_name != 'create'/, 'the path filter does not run on a created branch');
  const job = w.jobs['branch-cut'];
  assert.equal(job.uses, 'wso2/docs-platform/.github/workflows/branch-cut.yml@v1');
  assert.match(job.if, /github\.event_name == 'create' && github\.ref_type == 'branch'/);
  assert.match(job.if, /startsWith\(github\.ref_name, 'release\/'\) \|\| contains\(github\.ref_name, '\/release\/'\)/);
  assert.equal(job.with.branch, '${{ github.ref_name }}');

  const bot = wf('branch-cut.yml');
  assert.ok(bot.on.workflow_call.inputs.branch.required);
  const steps = bot.jobs['main-markers'].steps;
  const cut = steps.find((s) => s.id === 'cut').run;
  assert.match(cut, /wso2-docs\.mjs branch-cut --branch "origin\/\$BRANCH" --repo content --report report\.md/);
  assert.match(cut, /ls-remote --exit-code --heads origin "\$cleanup"/, 'a writer who ran branch-cut locally already has the change');
  const pr = steps.at(-1);
  assert.equal(pr.if, "steps.cut.outputs.changes != '0'");
  assert.match(pr.run, /git -C content push origin "\$CLEANUP"/);
  assert.match(pr.run, /gh pr create --repo "\$GITHUB_REPOSITORY" --base main --head "\$CLEANUP"[\s\S]*--body-file report\.md/);
  assert.doesNotMatch(cut, /git[^\n]*push/, 'the release branch itself is never changed');
});

test('actionlint', { skip: !process.env.ACTIONLINT && 'set ACTIONLINT to the actionlint binary to run it' }, () => {
  execFileSync(process.env.ACTIONLINT, files, { cwd: root, stdio: 'pipe' });
});

test('wrangler bundles the Edge Worker for staging and production', { timeout: 120_000 }, () => {
  const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  for (const env of ['staging', 'production']) {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), `wso2-edge-${env}-`));
    const log = execFileSync(process.execPath, [wrangler, 'deploy', '--dry-run', '-c', 'worker/wrangler.jsonc', '--env', env, '--outdir', outdir], {
      cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    });
    for (const binding of ['env.DOCS', 'env.REDIRECTS', 'env.FEEDBACK', 'env.NOT_FOUND']) assert.match(log, new RegExp(binding.replace('.', '\\.')), `${env}: ${binding}`);
    assert.match(log, env === 'staging' ? /env\.NOINDEX_ALL \("true"\)/ : /env\.NOINDEX_ALL \("false"\)/);
    assert.doesNotMatch(log, /WARNING/);
    assert.ok(fs.existsSync(path.join(outdir, 'index.js')));
  }
});
