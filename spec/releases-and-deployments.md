# Releases and deployments

Last checked against code: 2026-10-27

How a Docs release becomes live Docs deployments, how releases are stored, rolled back and rebuilt, and how the Platform itself is released. Branch and tag names are in [repo-structure.md](repo-structure.md#tags).

## Docs releases

- **A Docs release is a git tag in a Content repo, independent of the product's own release.** A version's docs may be released many times; Cloud releases continuously from the main line. [F-map] [F08]
- **A Docs release carries a Docs bundle, and the Platform builds from the bundle, never the tagged git tree.** Content repos still hold no tooling: the Platform's own reusable workflow makes the bundle. See [Docs bundles](#docs-bundles). [F08] [B-map] [B03]
- **An Edition's source is its Content repo, Doc space directory and branch; the pipeline takes the branch's newest Docs release tag**, so a re-release needs no manifest change. [N02]

## Docs bundles

- **One bundle per Docs release tag: one Doc space, one Edition**, attached as `<slug>-<tag without its prefix>.docs.zip` (such as `identity-server-7.3.0-docs.2.docs.zip`) to a GitHub Release named after the tag. The release is never marked latest or prerelease and is immutable once published. The slug comes from `docspace.yaml`, since a repo with one Doc space has tags without a prefix. [B03]
- **It is made where the tag is made.** Release triggers are unchanged: a merge to `main` makes a Cloud tag, "Release docs" makes a version tag, or a person pushes a tag. In the same `docs.yml` run, the `release` and `release-tag` jobs call the Platform's reusable `docs-bundle.yml` with the tag, in place of dispatching `release.yml`. [B03]
- **`docs-bundle.yml` lives in the Platform repo and runs at `v1`**, the same moving tag as `PLATFORM_REF`. It checks out the Platform at `v1` and runs `wso2-docs bundle`, so one tag moves the workflow and its code together. Intake accepts only attestations signed by that file at `refs/tags/v1`. The call grants `contents: write`, `id-token: write` and `attestations: write`. [B03]
- **What a bundle holds**: the Doc space directory as it is in the repo (`docspace.yaml`, `editions.yaml`, `redirects.yaml`, `docs/`, `partials/`, `assets/`), with Edition markers not applied, since the build applies them. A Self-hosted Edition's bundle leaves out `assets/cloud/`. A generated `bundle.json` records the repo, the directory's path in the repo, the tag, the Edition, the source commit, the Platform version that checked it, and the files on `main` at that moment for "Edit this page", so the build reads nothing from git. [B03]
- **A family Cloud's bundle** holds the family directory and every Cloud part's directory that names it with `cloud.in`, as siblings the way they sit in the repo; `bundle.json` lists the parts. [B03]
- **Checks**: before packing, the publish run checks the tagged commit with `wso2-docs check --no-lint` (the blocking checks and the strict build), plus the bundle checks: nothing outside the packed directories, no symlinks, at most 1 GiB and 30,000 files (a warning above 500 MB), and the executable-content rule (strict until decided). Pull requests run `wso2-docs bundle --dry-run` inside `preview / checks`. [B03]
- **The zip is deterministic**: sorted entries, fixed timestamps and permissions, no extra metadata, so the same commit gives the same digest. It is attested with build provenance, and its sha256 is in the release notes. [B03]
- **Onboarding**: `wso2-docs init --root-files` writes the bundle-calling `docs.yml`, and immutable releases are turned on. Branch rules stay as `.github/branch-ruleset.json`. Repos owned by a person (the forks) get no tag ruleset, because Actions cannot bypass one there; attestation and intake's checks take its place. [B03]

## Intake

- **Intake polls; nothing is dispatched to the Platform.** `.github/workflows/intake.yml` in the Platform repo runs at `7,37 * * * *` and by hand (optionally one repo and Doc space), and reads the releases of the Content repos `navigation/navigation.yaml` lists. [B05]
- **The intake record is one file per Doc space, `releases/<slug>.yaml`**: for each Edition, the accepted bundles newest first (tag, asset, sha256, source commit, accepted at), the last 5 kept. [B05]
- **A release counts** when its tag matches the Doc space's prefix and grammar (`<version>-docs.<n>`, `cloud-<YYYY.MM.DD>.<n>`); it is published, not a prerelease, and immutable; it has exactly one asset with the bundle's name; it is newer than the Edition's newest recorded release; and its Edition is in the composed manifest. Older or equal releases are ignored, and of several new ones for one Edition only the newest is taken. An Edition the manifest does not list, or a pinned one, gets an issue and no PR. There is no product GA check: the owner who runs "Release docs" is the gate. [B05]
- **Intake composes the manifest itself** from the Content repos' main lines, as a release's plan does, since pins are not in the published manifest. The Platform's own repo is not polled: its Doc space builds from the Platform. [B10]
- **Verified once, before any content code runs**: downloaded into an empty folder; its sha256 equals GitHub's digest; `gh attestation verify` with the signer's exact certificate identity `https://github.com/<platform repo>/.github/workflows/docs-bundle.yml@refs/tags/v1` and `--deny-self-hosted-runners`, then the answer read again: a GitHub-hosted runner, the release's repo, and source ref `main` (a Cloud release, and a version released by "Release docs", which runs from `main`; found by the fork proof, 2026-10-27) or the tag itself (a tag pushed by hand); unpacked safely (no absolute paths, no `..`, no symlinks or other non-regular files, a local header that names its entry, no overlapping entries, at most 1 GiB and 30,000 files, at most 100 times the zip's size in all and no entry over 1 MiB that inflates more than 1,000 times, each file created new inside the folder); `bundle.json` matches the repo, tag, Edition and directory, and the bundle holds nothing beside its Doc space's directory and its Cloud parts'; then `content-safety` on the unpacked files. Every later fetch checks only the sha256 in the record, so old bundles stay valid when `v1` moves. A fork names the Platform copy that signs its bundles in `DOCS_BUNDLE_SIGNER_REPO` (default the repo running intake). [B05] [B10]
- **One PR per Doc space, on `intake/<slug>`, updated in place.** It auto-merges when it changes only that file's release entries and CI passes: CI's `intake-record` job, a required check on `main`, passes an `intake/<slug>` branch only when it changes nothing but `releases/<slug>.yaml`, adds or removes entries without editing any, keeps them newest first and the record valid. Any other change under `releases/` needs the Doc space's owners. It is opened with a GitHub App token (`DOCS_INTAKE_APP_ID`, `DOCS_INTAKE_APP_KEY`) minted in a job that runs only git and gh, since a `GITHUB_TOKEN` PR starts no checks. While the PR is open, intake reads its record in place of `main`'s, so what it holds is not verified again. [B05] [B10]
- **A merged record change starts the release.** A push to `main` that changes `releases/*.yaml` runs `release.yml` with tag scope for each Edition's new newest entry: the build downloads the asset, checks its sha256 against the record, unpacks it into an empty folder and builds with the Edition and `main` file list from `bundle.json`; a build from an unpacked bundle reads the repo path, the files on `main` and the source commit from `bundle.json`, never from git. Rebuild scopes (`docspace`, `all`, `landing`) stay dispatches and build each deployed tag from its recorded bundle; a deployed tag the record does not hold is not rebuilt, with a notice. `release.yml`'s `repo`/`tag` inputs serve only the Platform's own Doc space (Contribute); a Content repo's tag is never dispatched. [B05] [B10]
- **A withdrawn release rolls back.** When a recorded release is deleted on GitHub, intake auto-merges a PR that removes its entry and opens an issue; when the entry was its Edition's newest, the merge flips the deployment back (`flip --backwards`) to the release folder built from the previous entry, or rebuilds from the previous bundle (release id `<release>.r<run id>`) when that folder was collected. With no earlier entry the deployment stays as it is, and the issue says to roll back by hand. [B05] [B10]
- **The job that builds bundle content holds no storage, search or edge credential.** It runs in no environment: the plan job hands it what it reads from staging (the composed manifest, the deployment state, the route lists, the latest page lists), and it hands its build as an artifact to a publish job per deployment, which uploads it to its own new release folder and runs no content code. The flip, search indexing and the App token each run in separate jobs that run no content code, so a bad bundle can reach only a folder nothing points to yet. The one credential the build job may see is the read-only `CONTENT_READ_TOKEN`, in its download step only, while Content repos are private. [B04] [B10]
- **Failures** open one issue per Doc space and tag on the Platform repo, labelled `bundle-intake` and mentioning the Doc space's owners. Later polls of the same tag add nothing; intake stops retrying that tag until a newer tag or a manual run, which tries it again without a second issue. [B05]

## The release pipeline

- **Every release builds centrally in the Platform repo.** A Content repo's `docs.yml` makes the tag and its bundle; the Platform finds it by [intake](#intake) and builds it when the intake record changes. No Content repo holds a token for the Platform. Storage, edge and search admin credentials live only in the Platform's `staging` and `production` environments. [F11] [N23] [B05]
- **One build job per Docs deployment**, with `baseUrl` `/<doc-space>/<segment>/`. [F11]
- **The sequence:**

  | Step | What happens |
  |---|---|
  | 1. Compose | Clone every Content repo's `main`, compose, store `_platform/composed.json` (a failed compose keeps the last good copy) |
  | 2. Plan | Plan the Docs deployments the record change (or rebuild) makes, from the stored copy and the intake records |
  | 3. Build | Fetch and unpack the recorded bundle (sha256 against the record), build the Doc space directory with the stored manifest and staging's deployment state (its menus list only deployed Doc spaces: see [build-and-quality-checks.md](build-and-quality-checks.md#the-build)), run the release's blocking checks; a separate publish job uploads the build to a new release folder. The `/latest/` twin builds first, because older versions take their canonicals from its page list. |
  | 4. Flip | One write of the deployment state points every planned deployment at its new folder; republish `manifest.json`, the sitemap index and the root `llms.txt` |
  | 5. Redirects | Write the redirect table to Workers KV |
  | 6. Crawl gate | Every page of each new deployment, and every link on it into WSO2 Docs, must answer 200 |
  | 7. Search | Upsert the new records, then delete stale ones |
  | 8. GC | Keep the last 5 releases of each deployment, plus the live one |
  | 9. Promote | Only when the crawl gate passed and production is on: copy the same folders to production, flip with staging's manifest copy, index, write redirects |

  [F11] [N17] [N23]
- **The bytes tested on staging are the bytes that ship**: builds emit production canonicals and `docs:` links, and promotion copies the same folders. [F11] [F25]
- **Promotion is automatic once the gates pass.** The owner approved by running Release docs; Cloud releases on merge. Production is off for the Pilot (`DOCS_PRODUCTION_ENABLED`). [F11] [F25]
- **A failed build or blocking check stops the run before the flip; the previous release stays live.** A failed crawl gate stops promotion. A failed search update retries and warns, and never blocks. [F11] [F17] [F30]
- **A family Cloud is one Docs deployment.** Its build reads each Cloud part's directory from the same bundle, so the tree is one commit. [N17] [B03]
- **The tag of the Edition that feeds `latest` makes two Docs deployments**, `/<doc-space>/<version>/` and `/<doc-space>/latest/`. Cloud is never built twice. [F07] [N17]
- **A release reads the manifest composed at its start.** A tag for an Edition only a newer manifest adds fails the plan until compose succeeds. [N17]

## Storage and pointers

- **Every build uploads to an immutable release folder, `_releases/<doc-space>/<segment>/<release>/`**, where the segment is the Edition, `latest`, or `_` for an unversioned Doc space, and the release id is the tag without its Doc space prefix. `_platform/release.json` is written last, with the full tag, source commit and Platform version; a folder without it is never flipped to. [F11] [F25] [N17] [N23]
- **Going live is a pointer change in `_platform/state.json`**, so readers never see a half-uploaded site. The state keeps each deployment's last 20 releases. Every write to it waits on the state lock (see [Rebuilds and triggers](#rebuilds-and-triggers)). [F11] [N23] [N25]
- **Staging and production have separate buckets** (`docs-staging`, `docs-prod`), and PR previews their own (`docs-previews`). [F11] [F25]

## Rollback

- **A rollback flips a deployment's pointer back to an earlier release, with no build.** The Platform team runs `rollback.yml`, which also rewrites the redirect table and repairs search (`search-check --fix`). A pin then holds the Edition there ([editions-and-versions.md](editions-and-versions.md#pins)). [F11] [N23]

## Rebuilds and triggers

- **A rebuild builds deployments again from the tags they already run, under release id `<release>.r<run id>`.** Scopes: `tag` (the Edition and its latest twin), `docspace` (every deployed Edition of one Doc space), `all` (every deployed Edition whose Content repo pins the Platform's major, plus Contribute and the Landing deployment), `landing` (the Landing deployment, built afresh). [N23]

| Event | Rebuilds |
|---|---|
| A version tag's bundle, merged into the intake record | That Edition, plus its latest twin if it feeds `latest` |
| A Cloud tag's bundle, merged into the intake record | That Cloud (several new Cloud tags between polls: the newest only) |
| A withdrawn newest entry, merged out of the intake record | That Edition back to the previous entry's release, flipped or rebuilt |
| A Cloud tag of the Platform's own Doc space (Contribute) | That Cloud (one concurrency group; the newest wins, an in-progress build is cancelled) |
| A merged manifest change that adds an Edition or moves `latest` | Every deployed Edition of that Doc space (`docspace`), so canonicals and sitemaps match |
| End of life, a notice, a menu change | Nothing: runtime data |
| A change on the Platform's `main` that Contribute's build reads | Contribute (a new Cloud tag on the Platform repo) |
| A change to `navigation/` (or `chrome/landing.yaml`) on the Platform's `main` | The Landing deployment (`landing`), and Contribute |
| `chrome.json` change | Nothing: runtime data |
| A published Platform release | Every live deployment whose Content repo pins its major (`all`) |

[F11] [N17] [N23]

- **Every storage-state change goes through one queue, so no run cancels another: a lock in the environment's own bucket, `_platform/state.lock`.** Every command that writes the published state (`flip`, `rollback`, `retire`, `manifest`, `redirects` and `gc`, whichever workflow or person runs it) takes the lock with a conditional write (create only if absent), runs, and removes it; a writer that finds it held waits its turn, polling, for up to 45 minutes. A lock carries a 30-minute lease, so one left by a run that died is taken over (replace only if unchanged); `wso2-release state-lock [--break]` shows or removes it. [N23] [N25]
- **Why a lock in storage, not a GitHub concurrency group or a serialised writer workflow**: GitHub keeps one waiting run per concurrency group and cancels an older waiting one, so a third writer cancelled the waiting flip. A single state-writer workflow fed by dispatches has the same limit, and would need a retry loop that watches its runs and dispatches again. The lock lives where the state does: it serialises any number of writers per environment, hand-run commands included, needs no other credential or service, and survives a crashed run through its lease. It needs conditional writes on the bucket, which R2's S3 API offers (`If-None-Match`, `If-Match`). Waiting writers hold their runners while they wait. [N25]
- **A flip never moves a deployment back.** Since no writer is cancelled, an older run can reach its flip after a newer one; a flip to a release published before the live one leaves the deployment where it is, with a warning. Only a rollback goes back, or a release of the tag the Edition is pinned to (a pin names the release to hold). [N25]
- **Run-level groups only keep one release of the same thing at a time**: `release-records-<commit>` for each merged record change, `release-<repo>-<tag, space or scope>`, and `release-<repo>-cloud`, where the newest Cloud release wins. Their waiting runs may be replaced by a newer one; the state lock, not they, orders writes. [N23] [N25] [B10]

## PR previews

- **A PR preview builds in the pull request workflow without secrets** and uploads the build as an artifact, so fork pull requests are safe. A follow-up `workflow_run` job with a preview-only credential publishes it at `/_preview/<doc-space>/pr-<n>/<edition>/` on staging. A Cloud part's preview builds the part alone at its tree address. [F11] [F25] [N17]
- **The published preview shows Edition markers; the checks read a build without them.** The checks' strict build stays the one `wso2-docs check` makes; the preview is a second build with `--show-markers` (see [authoring-and-preview.md](authoring-and-preview.md#preview)). A release refuses a build made with markers shown. [F34] [N25]

## Platform releases

- **The Platform has one semver version** (`package.json`), recorded in every build's `_platform/edition.json` and in `release.json`. [N23]
- **Content repos pin the Platform's major, not a version**: `docs.yml` checks out and calls the Platform at `v1`, a **tag** that moves to each `1.x.y` release (a tag, as GitHub Actions refs go, and never also a branch, which would make `@v1` ambiguous). A patch or minor needs nothing from Content repos; a change they must follow is a new major with a new ref. Manifest and data-file fields are only ever added, so they never need a new major. [F11] [N23]
- **A Platform release is a `v<major>.<minor>.<patch>` tag on `main` (or, for a fix to an older major, on its `releases/v<major>` branch), at the commit whose `package.json` has that version.** Pushing it runs `platform-release.yml`, which checks the tag (it matches `package.json`, it is on one of those branches, CI passed on its commit), publishes `@wso2/docs` to npm, moves the major's tag (`v1`) to it, makes the GitHub release and dispatches the rebuild (`release.yml`, scope `all`, at the tag). The major's tag only moves forward: a patch to an older minor, tagged after a newer release, is published but moves no tag and rebuilds nothing. A re-run skips a version already on npm and a GitHub release that exists. [N23] [N25]
- **npm publishing uses trusted publishing (OIDC)**: no npm token is stored; npm trusts `platform-release.yml` in the `npm` environment of `wso2/docs-platform`, and adds provenance itself once the repo is public. The rebuild is dispatched rather than triggered by `release: published`, because a release made with the workflow token starts no workflow. [N25]
- **The `@wso2/docs` package carries only what its commands need at runtime**, by the `files` list in `package.json`: the `wso2-docs` and `wso2-reports` commands, `lib/` without the release pipeline's own modules, `plugins/`, the Docusaurus configuration and components (`site/`), `chrome/`, `navigation/`, `schemas/`, `templates/`, the standards sources the checks read, `search/docker-compose.yml` (`preview --search`) and the two `worker/src/` modules `lib/` imports. The Platform's working files stay in the repo: `spec/`, `.scratch/`, `test/`, `fixtures/`, `migration/`, `scripts/`, skills, the Contribute Doc space, `wso2-release` and the rest of `worker/`, which CI runs from a Platform checkout. `test/package-files.test.mjs` traces what the commands and the Docusaurus configuration import and read, fails when the list misses a file or carries one they don't use, and builds a Doc space from the packed package installed under `node_modules/`. Installed that way, Docusaurus doesn't compile the components in `site/src/`, so `plugins/site-source.mjs` compiles them there. [N25]
- **Publishing a Platform release rebuilds only the live Docs deployments whose Content repo pins its major** (`2` for `2.0.0`), from their deployed tags, with the same gates and no new Docs release. A deployment of a repo on another major, or of a repo whose pin can't be read, is left as it is and listed in the plan. [F11] [N23] [N25]
- **The pin is read where it is set: `PLATFORM_REF: v<n>` in the Content repo's `.github/workflows/docs.yml` on its main line** (else the one `@v<n>` its workflows call the Platform at), from the checkouts the release's compose step already makes. Nothing else records it, so a repo that moves to `v2` is rebuilt by the next `2.x.y` release without a Docs release of its own first. The Platform's own Doc spaces (Contribute) always build with the running Platform. The major is the running Platform's (`package.json`), which `wso2-release plan --scope all --major <n>` can override. [N25]
- **Content repos' root files are refreshed by a pull request made with `npx @wso2/docs init --root-files`.** [N23]
- **The Edge Worker is not part of a Platform release**: `edge.yml` deploys `worker/` when a change to it merges to `main`. [N23]
- **CI build caches are keyed by Platform commit**, because Docusaurus's webpack cache doesn't see changes to the Platform's own plugins. [N23]

## Build runners

- **Builds start on standard GitHub runners.** A deployment whose p90 build passes 20 minutes, or that runs out of memory, moves to larger runners, then to self-hosted runners; each move is a runner-label change. [F11]

## Landing and Contribute

- **The Landing deployment and Contribute are Platform-owned deployments, and release themselves** from `platform-deployments.yml`, path-filtered on the Platform's `main`. [F18] [N23] [N25]
- **Contribute releases when a change on the Platform's main line reaches anything its build reads**: `standards/`, `site/`, `plugins/`, `chrome/`, `lib/`, `bin/`, `schemas/`, `navigation/`, `package.json` or `package-lock.json` (`CONTRIBUTE_PATHS` in `lib/platform-release.mjs`). The workflow makes the next `cloud-<YYYY.MM.DD>.<n>` tag on the Platform repo and dispatches `release.yml` at it, which builds it from the Platform repo at that tag, with no bundle; the plan is `plan --repo wso2/docs-platform`. [N25] [B10]
- **The Landing deployment releases when the Platform navigation (`navigation/`) or its start paths (`chrome/landing.yaml`) change**: `release.yml` with scope `landing` builds it from the Platform alone (`wso2-docs build --landing`, no Content repo, no content checks) under release id `landing-<YYYY.MM.DD>.<run id>`, then flips, crawls and promotes it as any Docs deployment. [N25]
- **A Platform release rebuilds both**, since they always build with the running Platform. [N25]

[F-map]: ../.scratch/wso2-doc-space/map.md
[F07]: ../.scratch/wso2-doc-space/issues/07-url-scheme-and-redirects.md
[F08]: ../.scratch/wso2-doc-space/issues/08-content-repo-contract.md
[F11]: ../.scratch/wso2-doc-space/issues/11-platform-build-pipeline.md
[F17]: ../.scratch/wso2-doc-space/issues/17-quality-gates.md
[F18]: ../.scratch/wso2-doc-space/issues/18-documentation-standards.md
[F25]: ../.scratch/wso2-doc-space/issues/25-edge-and-staging-pipeline.md
[F30]: ../.scratch/wso2-doc-space/issues/30-search-pilot.md
[F34]: ../.scratch/wso2-doc-space/issues/34-writer-experience.md
[N02]: ../.scratch/wso2-docs-navigation/issues/02-manifest-model.md
[N17]: ../.scratch/wso2-docs-navigation/issues/17-release-pipeline.md
[N23]: ../.scratch/wso2-docs-navigation/issues/23-platform-team-guide.md
[N25]: ../.scratch/wso2-docs-navigation/issues/25-close-spec-code-gaps.md
[B-map]: ../.scratch/wso2-docs-bundles/map.md
[B03]: ../.scratch/wso2-docs-bundles/issues/03-reusable-bundle-workflow-spec.md
[B05]: ../.scratch/wso2-docs-bundles/issues/05-intake-spec.md
[B04]: ../.scratch/wso2-docs-bundles/issues/04-executable-content-in-bundles.md
[B10]: ../.scratch/wso2-docs-bundles/issues/10-build-intake-and-releases-from-bundles.md
