# WSO2 Docs Platform

The single codebase behind WSO2 Docs (docs.wso2.com). It builds every Docs deployment, meaning one Edition of one Doc space, from a Content repo release. Content repos hold content only; everything else lives here.

## Spec

The normative spec for WSO2 Docs is in [`spec/`](spec/README.md): every decision from the wayfinder maps, written as current rules with their reasons and source tickets. It is the authority over tickets and code; a change to behaviour updates it in the same commit. Agents start from [`AGENTS.md`](AGENTS.md).

## Developer guide for product teams

How a product team places its docs in WSO2 Docs (the products menu, Docs sections, Doc spaces and Editions; the Doc space and Docs section manifests and the compose step; the Content repo layout, branches and Docs releases; starting a Doc space, previewing, releasing a version; extension points) is in the Contribute Doc space, at [docs.wso2.com/contribute/get-started/product-teams/](https://docs.wso2.com/contribute/get-started/product-teams/). Its source is `standards/contribute/docs/` (start at `get-started/product-teams.mdx`, then the `product-teams/` folders under `concepts/`, `guides/` and `reference/`). This README and every Content repo README link there and don't repeat it. Preview it with `node bin/wso2-docs.mjs preview standards/contribute`.

## Guide for running WSO2 Docs

How the Platform team runs WSO2 Docs (the navigation file and Docs sections, onboarding a team and its repository settings, the release pipeline end to end, rollbacks by pointer, end of life and Legacy versions, compose and the published manifest, Platform releases and caches, search operations, extensions, and running all of it locally) is the companion guide in the same Contribute Doc space, at [docs.wso2.com/contribute/get-started/platform-team/](https://docs.wso2.com/contribute/get-started/platform-team/). Its source is `standards/contribute/docs/get-started/platform-team.mdx` and the `platform-team/` folders under `concepts/`, `guides/` and `reference/`.

## Use it from a Content repo

```bash
npx @wso2/docs init agent-manager --home agent-platform   # start a Doc space from the template (a new repo, or one more Doc space)
npx @wso2/docs preview                  # live preview of the Edition for this branch
npx @wso2/docs preview --only guides    # just one folder, for speed
npx @wso2/docs preview --edition 7.3.0  # another Edition
npx @wso2/docs build --edition cloud    # what CI runs
npx @wso2/docs new how-to --title "Add a login flow"   # a page from its page-type template
npx @wso2/docs check                    # the PR's blocking checks, then warn-only lint on changed lines
npx @wso2/docs check --no-build --format json          # faster; machine-readable for CI
npx @wso2/docs api validate             # blocking OpenAPI checks for every API page's spec
npx @wso2/docs api lint                 # plus the warn-only description lint
npx @wso2/docs api split docs/reference/apis/publisher   # one page per tag, for APIs over the page budget
```

Release builds add `--env production` (GTM and CookiePro, which run only on the `--site-url` host, so the same bytes stay quiet on staging). `wso2-docs build --landing` builds the Landing deployment (`docs.wso2.com/`) from the Platform alone.

An API reference page is `docs/reference/apis/<api>/index.mdx` with `layout: api-reference`, `spec: ./openapi.yaml` and, optionally, `server: '{edition.apiBaseUrl}/api/...'`. Its body is the overview; the Platform renders the rest from the spec. Put `openapi.cloud.yaml` or `openapi.self-hosted.yaml` next to it where an Edition's API differs.

`check` exits 1 when a blocking check fails and 0 otherwise. It compares the working copy with the branch it left (`main` or a release branch, or `--base`), builds the Edition strictly, checks `docs:` links against other deployments' route lists (`--routes <dir|url>`, default staging) and runs Vale (when installed, or `WSO2_DOCS_VALE`), cspell and heading lint on changed lines only. `--override "<reason>"` (set by the `quality-override` label) passes the policy checks only. Each check is described, with its fix, at `docs.wso2.com/contribute/reference/checks/`.

Preview, check and build need no other checkout: they compose the repo's own Doc space manifests into the published `manifest.json` (staging's, or `--published <url|file>` / `WSO2_DOCS_PUBLISHED_MANIFEST`; a copy is cached for offline use), as `lib/published.mjs` does. `WSO2_DOCS_CONTENT_REPOS` composes from a folder of Content repo checkouts instead, for testing changes across repos.

A Content repo holds one directory per Doc space (`<slug>/`), so pass it: `npx @wso2/docs preview identity-server`. The Edition comes from the git branch: on `main` it is `cloud` (or `next` in Doc spaces with versions only and no Cloud part), and on `<slug>/release/<version>` (or `release/<version>` in a repo with one Doc space) it is that version. On a release branch `check` also blocks changes outside the Doc space's directory (`release-scope`). `npx @wso2/docs spaces --branch <base> --base <ref>` prints the Doc spaces a change touches, as the repo's one path-filtered workflow (`templates/content-repo/`) runs them. `npx @wso2/docs init --root-files` brings a repo's Platform-managed root files (workflows, branch ruleset, editor settings) up to date after a Platform release. `preview` shows Edition markers and adds a toolbar for switching Editions. Add `--exact` to see the page exactly as it will be published.

## What's here

| Path | What |
|---|---|
| `bin/wso2-docs.mjs` | The CLI |
| `site/` | The one Docusaurus site every Edition builds with |
| `lib/edition.mjs` | Edition and marker rules (`<Edition only>`, `selfHostedFrom`, front matter) |
| `plugins/remark-edition.mjs` | Applies markers and `{edition.*}` variables before the TOC is built |
| `plugins/remark-docs-links.mjs` | Resolves `docs:<space>/<edition\|latest>/<page>` links against the manifest |
| `plugins/remark-api-reference.mjs` | Renders `layout: api-reference` pages from their OpenAPI spec before the TOC is built |
| `plugins/api-reference.mjs` | Copies each API's spec into the build, enforces the API page budget, writes `_platform/apis.json` |
| `lib/openapi.mjs`, `lib/api-*.mjs` | OpenAPI validation and lint, samples and curl, tag pages, the `api` CLI commands |
| `.github/workflows/spec-sync.yml` | Reusable workflow: syncs a spec from a product repo and opens a PR |
| `scripts/measure-api-pages.mjs` | Measures built API pages (size, JS chunk, completeness) to re-check the budget |
| `plugins/markdown-export.mjs`, `lib/markdown-*.mjs` | The Markdown twin of every page (`<page>.md`), joined `export: single` guides, `llms.txt` and `llms-full.txt` |
| `lib/markdown-forms.mjs` | The Markdown form of every MDX component; a component without one fails the export and CI |
| `lib/twin-checks.mjs` | Markdown twin checks (no leftover JSX, links resolve), run by the build and the release check |
| `plugins/remark-page-actions.mjs`, `site/src/components/PageActions/` | The "Copy page" menu next to the title |
| `lib/layouts.mjs`, `plugins/remark-layouts.mjs`, `site/src/components/layouts/` | Page layouts (`layout:` front matter): `overview` draws a page's link sections as cards, `catalog` a searchable grid from its `data:` file; both are drawn before Docusaurus's own plugins, so links, anchors, search records and Markdown twins see them |
| `lib/data-files.mjs`, `lib/check/data.mjs` | Data files a Doc space commits (a catalog's `data:`, `release-notes.yaml`, `sdks.yaml`), validated against `schemas/` by the blocking `data-files` check and by the build |
| `standards/components.yaml` | The component catalogue: every MDX component and layout, with its Markdown form, accessibility and owner; it generates Contribute's `reference/components/` page |
| `.github/ISSUE_TEMPLATE/extension-proposal.yml` | The extension proposal form: how a team asks for a component, layout, data file, manifest field, menu-entry kind or build step |
| `plugins/platform-outputs.mjs` | Canonicals, sitemap, and `_platform/` outputs (pages, redirects, search records) |
| `lib/cloud-tree.mjs` | A family Cloud build: each Cloud part's main line from the same checkout, mounted at `/<platform>/cloud/<part>/` as its own docs instance, with one sidebar for the whole tree |
| `navigation/navigation.yaml` | Platform navigation file: family order, the Solutions and Other groups, environments, the Docs sections, the Content repos to read and the products not on WSO2 Docs yet (for the catalog) |
| `navigation/sections/<id>.yaml` | Docs section manifests (products-menu entries, menu order, `version-in`), each owned by its section's team through `.github/CODEOWNERS` |
| `schemas/` | JSON Schemas for the Doc space manifest, the Docs section manifest, the Platform navigation file and the data files (catalog, release notes, SDK list) |
| `lib/compose.mjs`, `lib/compose-command.mjs` | The compose step (`wso2-release compose`): validates and merges the team manifests into the Deployment manifest, keeps the last good copy when main breaks, and checks PRs against the latest merged manifest |
| Content repo checkouts | `wso2-release compose` reads each `contentRepos` main line's `<slug>/docspace.yaml`: `--content <dir>` or `WSO2_DOCS_CONTENT_REPOS` (one checkout per repo, named as the repo), else the directory the Platform checkout sits in. CI clones them with `scripts/clone-content-repos.mjs`. `wso2-docs preview`/`check`/`build` use them only when `WSO2_DOCS_CONTENT_REPOS` is set |
| `fixtures/content-repos/`, `fixtures/pilot-target/` | Test copies of the Pilot's Doc space manifests as the repos hold them (the suite's default world, `test/setup.mjs`), and the target layout |
| `chrome/chrome.json` | Runtime chrome content: header links, footer, announcement, feedback endpoint (schema in `lib/chrome.mjs`) |
| `chrome/landing.yaml` | Landing page hero and start paths |
| `lib/switching.mjs` | Edition dropdown, page mapping, remembered-Edition banner, not-latest and end-of-life notes, team notices (`teamNotices`, read from the published manifest at runtime only), section menus with link entries (`sectionMenu`), catalog |
| `lib/page-links.mjs`, `lib/analytics.mjs` | "Edit this page", "Report an issue", feedback events; GTM + CookiePro head script and the fixed `dataLayer` events |
| `lib/contrast.mjs` | WCAG contrast of theme token pairs (`test/contrast.test.mjs`) |
| `site/src/components/chrome/` | Platform chrome: header widgets, search slot, notices, feedback, footer, Landing |
| `scripts/build-tokens.mjs` | Generates `site/src/css/oxygen-tokens.css` from the pinned `@wso2/oxygen-ui` |
| `search/docker-compose.yml` | Local Typesense for `preview --search` (`docker-compose.staging.yml`: the Pilot's staging container) |
| `lib/search/` | Search: Typesense schema and record mapping, indexing (upsert, then delete stale), the consistency check, scoped keys, and the query-time scope rules |
| `site/src/components/search/` | The search box, its Ctrl/⌘K pop-up and the full results page (`SearchPage`, for the Landing deployment's `/search/`) |
| `fixtures/stub-repo/` | A small Content repo in the Pilot's layout, used by the tests: `identity-platform/` (a family Cloud) and `identity-server/` (its Cloud part on main, plus versions) |
| `standards/` | The documentation standards source: page types, skeleton, front-matter schema, terminology, admonitions, style rules, checks, templates, the cspell dictionary and the Contribute Doc space |
| `scripts/build-standards.mjs` | Generates the Vale package (`standards/vale/`), Contribute's reference pages and the skills' references from `standards/` (`npm run standards`) |
| `lib/check/` | `wso2-docs check`: git changes, MDX compile through the site's own plugins, source checks, preview build and Markdown twins, Vale and cspell |
| `lib/scaffold.mjs` | `wso2-docs new` |
| `skills/` | The author skills "Check my changes" and "Write a page" (`SKILL.md`), installable as the `wso2-docs` Claude Code plugin (`.claude-plugin/`) |
| `bin/wso2-reports.mjs`, `lib/digest.mjs`, `lib/reports.mjs` | Nightly report jobs and the weekly digest per Doc space |
| `bin/wso2-release.mjs` | The release pipeline's CLI: plan, check, publish, flip, rollback, crawl, redirects, GC, previews |
| `lib/release.mjs` | Release folders, deployment state, the merged `manifest.json`, sitemap index, redirect table |
| `lib/storage.mjs`, `lib/kv.mjs` | Storage backends (local folder, R2 binding, R2's S3 API) and Workers KV sinks |
| `lib/crawl.mjs` | The staging crawl gate |
| `worker/` | The Edge Worker, the only edge configuration, and its `wrangler.jsonc` (the old Confluence paths' 301 targets: `worker/src/confluence.mjs`) |
| `.github/workflows/` | `release.yml` (Release docs), PR preview build and publish, `manifests.yml` (compose on main, or by hand) and `compose-check.yml` (the manifest PR check), `rollback.yml` (Roll back docs, by pointer), Edge Worker deploy, CI |
| `templates/content-repo/` | The boilerplate. The Platform-managed files every Content repo root carries: the path-filtered `docs.yml` for one or several Doc spaces (checks, preview, the compose check against the published manifest, releases), the preview publish workflow, the optional `docs-sync.yml` (spec sync by bot PR), `.github/branch-ruleset.json` (the branch protection on `main`, `release/*` and `*/release/*` that requires "preview / checks") and `.vscode/` editor settings. And `__slug__/`, the Doc space skeleton `wso2-docs init` writes: a commented `docspace.yaml`, `editions.yaml`, `redirects.yaml`, a sample page of each Page type in the skeleton folders, an overview home, a catalog sample with its data file, `partials/` and `assets/{cloud,self-hosted}/` |
| `templates/section-manifest.yaml` | A sample Docs section manifest for `navigation/sections/`, with a borrowed Doc space and a link entry |
| `lib/init.mjs` | `wso2-docs init <slug>`: a new Content repo (root files through `writeRepoRoot`, as the converter writes them) or one more Doc space in a repo (README row, CODEOWNERS line, template files brought up to date) |
| `lib/published.mjs` | Composing from the published manifest: the team manifests rebuilt from `manifest.json`, with one Content repo's own Doc space manifests in their place (preview, check, build, and `compose --pr --published` on Content repo PRs) |
| `lib/content-repo.mjs` | The Content repo layout: Doc space directories, branches and their Editions, the workflow's path filter and release plan (`wso2-docs spaces`), the release-branch directory rule, the root files |
| `plugins/partials.mjs` | Compiles `<slug>/partials/` (next to `docs/`) with the pages' remark plugins |

| `migration/` | The MkDocs → Content repo converter, with one config per product in `migration/products/` |
| `fixtures/mkdocs-mini/` | A tiny MkDocs project the converter tests run on |

## Develop

```bash
npm install
npm test          # unit tests plus end-to-end builds of the stub Content repo
npm run tokens    # regenerate the Oxygen tokens after bumping @wso2/oxygen-ui
```

## Release path

A Docs release tag goes live in three moves, all in `release.yml`. Tags are `[<doc space>/]<version>-docs.<n>` (the version exact, `7.3.0`, or a date, `2026.09.24`) and `[<doc space>/]cloud-<YYYY.MM.DD>.<n>`; the prefix names the Doc space in a repo that holds several. The plan job first composes every Content repo's main line and stores the result as `_platform/composed.json` (the last good copy is kept when compose fails); the plan, the builds (`wso2-release composed`) and the flips read that stored copy.

1. **Build and upload.** One matrix job per Docs deployment (the latest twin first) builds the Doc space's own directory of the tagged checkout (`content/<slug>`), checks it and uploads to an immutable release folder, `_releases/<space>/<edition|latest>/<tag without its prefix>/`, in the `docs-staging` R2 bucket. `_platform/release.json` is written last (with the full tag); a folder without it never goes live. `latest` is the first Self-hosted Edition in the Doc space manifest's order (the newest release, never a numeric sort); Cloud is never built twice, so a Cloud-only Doc space has no latest copy. A family Cloud (`identity-platform`, `api-platform`) is one deployment: the build reads each Cloud part's main line (`identity-server/docs/`) from the same checkout and mounts it at `/<platform>/cloud/<part>/`, with the part's redirects mapped there (`lib/cloud-tree.mjs`).
2. **Flip.** One state write points each deployment at its new release, then `manifest.json` (policy plus state) and the sitemap index are republished and the redirect table is synced to Workers KV. Rollback is a flip back: `wso2-release rollback --deployment <space>/<segment>`, run by the **Roll back docs** workflow; a `pin` in the Doc space manifest then holds the Edition (other tags' plans are refused). `wso2-release retire` takes down a deployment whose Edition the manifest no longer lists.
3. **Gate and promote.** The staging crawl must pass before the same bytes are copied to `docs-prod`. Production is off for the Pilot (`DOCS_PRODUCTION_ENABLED`).

The last 5 releases of each deployment are kept. The sitemap index at `/sitemap.xml` lists every live deployment's `sitemap.xml` except those of Unlisted Doc spaces (`listed: false`, which the edge serves with `noindex`), plus the Landing deployment's `sitemap-landing.xml` (its own `sitemap.xml` sits under the index). A bare product address 302s to where the version selector opens: `/identity-server/` to `/identity-platform/cloud/identity-server/` (its Cloud part), `/api-manager/` to `/api-manager/latest/`; `/<part>/cloud/…` 302s into the platform's tree and a Cloud-only Doc space's `/latest/…` to its `/cloud/…`. `docs:<part>/cloud/<page>` links resolve to the platform's Cloud address, and Cloud part pages are their own canonical, titled `<page> | <Part> Cloud | WSO2 Docs`. The latest twin's redirect list also answers the legacy sites' `/en/latest/` URLs, so they follow `latest` when it moves. Run the whole path locally against the Edge Worker in Miniflare:

```bash
npm run edge:local -- --port 4180 --data .cache/edge   # Edge Worker with staging rules (--env production for production's), local R2 and KV
source .cache/edge/edge.env                            # the R2_* variables it wrote
node bin/wso2-release.mjs publish --storage s3://docs-staging --dir <build> --space <slug> --segment <edition> --edition <edition> --tag <tag>
node bin/wso2-release.mjs flip --storage s3://docs-staging --env staging --deploy <slug>/<edition>=<tag>
node bin/wso2-release.mjs redirects --storage s3://docs-staging --kv local:http://127.0.0.1:4181   # into the local edge's KV
```

`test/edge-e2e.test.mjs` does this for the stub Content repo. **Pending infra** (Confirm docs hosting facts with WSO2 infra): the Cloudflare account, the R2 buckets and their credentials, the KV namespace IDs in `worker/wrangler.jsonc`, the `docs-staging.wso2.com` route and the GitHub App that lets Content repos dispatch releases. Nothing has been deployed.

## Platform chrome

Code and look are baked into each build and server-rendered; content comes at runtime from `/manifest.json` and `/chrome.json`, with the copies baked in at build time as the fallback. Only safe swizzles are used: custom navbar item types (`NavbarItem/ComponentTypes`), `SearchBar`, `Footer` (ejected, all marked safe), and wraps of `MDXContent` (Edition notices before the page, feedback and page actions after it) and `NotFound` (404 event). The header and hero search slot, `site/src/components/chrome/SearchBox.js`, renders the Platform search component (see Search).

## Search

All Docs deployments of one environment share one Typesense collection (`wso2docs-staging`, `wso2docs-production`). In the release, after the crawl gate, `wso2-release search-index` upserts each new deployment's `_platform/search-records.json` and then deletes that Edition's records from older releases. `/latest/` twins and legacy versions are never indexed. A failure retries, then raises a warning, and never blocks the release. `.github/workflows/search-consistency.yml` compares the index with every live deployment each week and repairs drift.

The browser picks the endpoint by host and uses a scoped search-only key baked into the build (`SEARCH_KEY_STAGING` and `SEARCH_KEY_PRODUCTION` variables, made with `wso2-release search-setup` then `search-key`). Scopes, the one-Edition rule, end of life and the `/latest/` rewrite are worked out at query time from the deployment manifest (`lib/search/scopes.mjs`).

```bash
TYPESENSE_URL=… TYPESENSE_ADMIN_KEY=… node bin/wso2-release.mjs search-setup --env staging
WSO2_DOCS_SEARCH_PORT=18108 npx @wso2/docs preview --search   # local Typesense, loaded with this Edition
```

**Pending infra:** the `search-staging.docs.wso2.com` host and route, the production search hosting, and the `TYPESENSE_URL` and `TYPESENSE_ADMIN_KEY` settings.

## Migrate an MkDocs product

The converter writes the Content repo layout of Repo structure for Platform, sections and Doc spaces: each product's Doc space goes to `<repo>/<slug>/` (`docspace.yaml`, the full Doc space manifest; `editions.yaml`; `redirects.yaml`; `docs/`; `partials/`; `assets/`, with `cloud/` and `self-hosted/` for files only one kind of Edition uses), and the run report to `<repo>/<slug>/.migration/`. On `main`, `sync.mjs` also writes the repo root from `templates/content-repo/`: the path-filtered workflow, the editor settings, and a README and CODEOWNERS made from the Doc space manifests. Release branches are `<slug>/release/<version>`, cut from `main`; a run there that changes anything outside `<slug>/` stops.

```bash
# One Doc space into <repo>/<slug>/ (no commit), with the MDX compile check and a run report
node migration/convert.mjs api-manager --source <docs-apim checkout> --out <repo> --edition 4.7.0
# Regenerate and commit one Doc space on one branch, recording the source commit (the nightly job)
node migration/sync.mjs api-manager --source <docs-apim-master checkout> --repo <docs-api-platform> --branch main          # next
node migration/sync.mjs api-manager --source <docs-apim 4.7.0 checkout> --repo <docs-api-platform> --branch api-manager/release/4.7.0
# After a build: legacy URL coverage, and rendered-text parity against the live legacy site (--repo is the Doc space directory)
node migration/verify.mjs coverage --repo <repo>/api-manager --build <out> --source <checkout>/en --legacy-base https://apim.docs.wso2.com/en/4.7.0/ --sitemap <sitemap.xml>
node migration/verify.mjs parity --repo <repo>/api-manager --build <out> --source <checkout>/en --legacy-base https://apim.docs.wso2.com/en/4.7.0/ --sample 50
```

A missing `main` starts fresh (an orphan branch), so a repo can be regenerated in the new layout next to its old branches (the Pilot keeps them as `old/*`).

**Products with Jinja and several source trees** (`docs-is`: the Identity Platform tree `en/asgardeo/` and an Identity Server version tree, both built from `en/includes/`) are converted the same way, one branch per run: `main` (Cloud plus IS `next`: Identity Server's Cloud part), `identity-server/release/7.3.0`, `identity-server/release/7.2.0`. Each page is rendered in every Edition context of the branch (`products/identity-server.mjs`: `trees()` and `contexts()`), and written once:

- includes are expanded as `mkdocs-include-markdown-plugin` did; every `{% if %}` condition and every `{{ variable }}` must be in the product's tables (`conditions`, `variables`), or the run fails;
- a block-level `{% if %}` whose branches differ between Editions becomes `<Edition only=…>` / `selfHostedFrom="next"` markers; any other difference (inline conditions, values, screenshots, links) is marked block by block; a variable whose value is the Edition's becomes `{edition.*}`;
- every marked page is parsed back and its words compared, Edition by Edition, with the page rendered for that Edition alone (`lib/pagecheck.mjs`); a page that fails is merged block by block instead, and any remaining failure is reported;
- pages of one tree only get `editions: cloud | self-hosted` (or `selfHostedFrom: next` on main); OpenAPI specs that differ become `openapi.cloud.yaml` / `openapi.self-hosted.yaml`, and specs that fail validation are fixed (`lib/specs.mjs`: Swagger 2.0, `#/definitions` refs, duplicate operation ids, body parameters).

**Family-level Doc spaces** (Platform-by-platform walkthrough) are Cloud only, with each product's Cloud content as a Cloud part in the same repo. The converter writes only their family-level pages: `products/identity-platform.mjs` (`kind: family`, `lib/family.mjs`) builds Identity Platform Cloud's overview from the legacy home page's cards, with `docs:identity-server/cloud/<page>/` links into the part, so convert the part's main line first.

```bash
node migration/sync.mjs identity-server --source <docs-is checkout> --repo <docs-identity-platform> --branch main
node migration/sync.mjs identity-platform --source <docs-is checkout> --repo <docs-identity-platform> --branch main
node migration/sync.mjs identity-server --source <docs-is checkout> --repo <docs-identity-platform> --branch identity-server/release/7.3.0
node migration/verify.mjs parity --repo <repo>/identity-server --build <out> --source <checkout>/en/identity-server/7.3.0 --legacy-base https://is.docs.wso2.com/en/7.3.0/ --sample 40 --marked 15
```

**An MkDocs build that keeps every version as folders** (`wso2/docs-api-platform`: `ai-gateway/<version>/` folders, a `cloud/` entry with a sub-section per Cloud part, site-wide pages) is read as one *view* per branch (`lib/folders.mjs`, a product's `view(edition)`):
- `products/ai-gateway.mjs`: a release branch `ai-gateway/release/<version>` reads that version's folder (date versions such as `2026.09.24` are exact versions). The main line, AI Gateway's Cloud part, reads `next/` plus the Cloud sub-section: a Cloud page with the same name as a `next/` page keeps `next/`'s text and maps its legacy URL there, and the pair goes into `ai-gateway/.migration/cloud-diff.md` for the team. Every other Cloud page is added with `editions: cloud`.
- `products/api-gateway.mjs`: the same for API Gateway (`api-gateway/<version>/`; its Cloud sub-section is `cloud/api-platform-gateway/`, the Cloud entry's Self-Hosted Gateway; the entry's Third-Party Gateways, `cloud/federation/`, stays in API Platform Cloud).
- `products/ai-workspace.mjs` and `products/api-portal.mjs`: the same for AI Workspace (`ai-workspace/<version>/`; its Cloud sub-section is `cloud/ai-workspace/`; the section's MCP Registry, `cloud/mcp-servers/`, stays in API Platform Cloud) and API Portal & MCP Hub (`api-portal/<version>/`; its Cloud sub-section is `cloud/devportal/`, the Cloud entry's Developer Portal).
- `products/api-platform.mjs` (`kind: family` with pages of its own): API Platform Cloud, the whole site minus the version folders and the parts, with the Cloud entry's sections filed into the family skeleton; its overview lists the Cloud parts.
- Links that leave the view go to the sibling Doc space (`docs:<slug>/cloud/<page>/`, from its `redirects.yaml` on the branch), else to the legacy page. So convert the parts, then the family, then the parts once more.

```bash
for run in "ai-gateway main" "api-gateway main" "ai-workspace main" "api-portal main" "api-platform main" "ai-gateway main" "api-gateway main" "ai-workspace main" "api-portal main" \
  "ai-gateway ai-gateway/release/1.2.0" "api-gateway api-gateway/release/1.2.0" "ai-workspace ai-workspace/release/1.0.0" "api-portal api-portal/release/1.0.0"; do set -- $run
  node migration/sync.mjs $1 --source <docs-api-platform checkout> --repo <docs-api-platform> --branch $2; done
node migration/verify.mjs coverage --repo <repo>/ai-gateway --build <out> --source <checkout>/en --legacy-base https://wso2.com/api-platform/docs/ --scope ai-gateway/1.2.0 --also <repo>/api-platform/redirects.yaml
```

**An unversioned Doc space** (`model: unversioned` in its manifest, such as Platform Security from `wso2/docs-security`, `products/platform-security.mjs`, and Updates from `wso2/docs-updates`'s `master`, `products/updates.mjs`) has one Edition, `_`, built from `main`, and no release branches. Its Docs releases are Cloud-style tags, `cloud-<YYYY.MM.DD>.<n>`.

```bash
node migration/sync.mjs platform-security --source <docs-security checkout> --repo <docs-security> --branch main
node migration/sync.mjs updates --source <docs-updates checkout, master> --repo <docs-updates> --branch main
```

**A versions-only Doc space alone in its repo** (Accelerator for Financial Services from `wso2/docs-open-banking`, `products/financial-services.mjs`) cuts unprefixed release branches, `release/<version>`; `sync.mjs` refuses them once `main` holds another Doc space. The legacy site serves 4.0.0 (and `latest`) from `master` and 3.0.0 from the `3.0.0` branch, so `main` (`next`) and `release/4.0.0` both convert `master`. Its versions hard-code different home cards, so its `homeCards` is a function of the Edition.

```bash
node migration/sync.mjs financial-services --source <docs-open-banking checkout, master> --repo <docs-open-banking> --branch main          # next
node migration/sync.mjs financial-services --source <docs-open-banking checkout, master> --repo <docs-open-banking> --branch release/4.0.0
node migration/sync.mjs financial-services --source <docs-open-banking checkout, 3.0.0> --repo <docs-open-banking> --branch release/3.0.0
```

The converter is re-runnable: it regenerates the Doc space directory (and, on `main`, the root files), so fixes go into its rules or the product config, never into its output. Anything it cannot convert is listed in `.migration/report.md`, never dropped silently.

**Override-patch list.** Fixes to the legacy source live in `migration/products/<product>.overrides.yaml` (`lib/overrides.mjs`) and are applied on every run:

- `patches`: exact text replacements in a legacy file (path under the product's `sourceRoot`), each with a `why` and optionally `editions:`. Typos the converter would carry through, and links to pages or headings that moved without a legacy redirect.
- `accepted`: links and anchors that are broken on the legacy site too (page + href as written). The converter still drops the link and keeps its text, but the item leaves the outstanding count and is listed under "Accepted by the override list".
- An entry that matches nothing in a run it applies to is reported as an `override` item, so an upstream fix shows up as a stale entry.

```bash
# Propose entries from every branch's run report (patches first; re-run, then accept the rest)
node migration/overrides.mjs suggest api-manager --source <docs-apim checkout> --report <dir>/.migration/report.json [--report ...] --patches-only --write
node migration/overrides.mjs suggest api-manager --source <docs-apim checkout> --report ... --write
node migration/convert.mjs api-manager ... --no-overrides   # what the list fixes, for comparison
```

A proposed patch is either a page found by its file name (one page of that name in the tree) or a heading that kept every word of the old anchor. Relative links in shared includes are never patched, because they resolve differently from each page that includes them.

## For AI tools

Every build writes, next to the HTML:

- `<page>.md`, the page's Markdown twin (`…/guides/mfa/` → `…/guides/mfa.md`, the home page at `index.md`): the Edition's resolved content with markers applied, variables filled in, partials inlined, components in their Markdown form (`lib/markdown-forms.mjs`), links pointing at other twins, and front matter with the title, description, Edition and canonical URL. API pages hold their overview, the YAML link and a compact operation list.
- `<folder>.md` for a folder whose `_category_.yml` has `customProps: { export: single }` (Docusaurus rejects unknown top-level keys there), joining its pages in sidebar order.
- `llms.txt` (every page, grouped by the sidebar) and `llms-full.txt` (every page's Markdown).

The release step adds the root `docs.wso2.com/llms.txt` from the manifest. The Edge Worker serves `robots.txt` for the whole host (staging disallows everything; production allows AI crawlers, switchable with `AI_CRAWLERS`) and a read-only MCP server at `/mcp` (`list_editions`, `get_page`, `search_docs`; staging only, `MCP_ENABLED`). `search_docs` queries Typesense with `TYPESENSE_HOST`, `TYPESENSE_COLLECTION` and the secret `TYPESENSE_SEARCH_KEY`.

## Known limits

- Builds on one machine share `site/.docusaurus`, so run them one at a time. CI runs one job per deployment.
- Vale is a Go binary, not an npm package: `check` skips style lint when it isn't installed (CI installs it).
- Markdown twins exist only in builds, so the "Copy page" menu can't copy in `preview`.
- In preview, switching Editions with the toolbar doesn't update the table of contents. Use `--edition` to get a correct TOC.
- `{edition.*}` variables work in page content and code, and in the front-matter `title`, `sidebar_label`, `description` and an API page's `server:`; not in other front-matter keys.
- In preview, editing an API's `openapi.yaml` doesn't re-render its page until the page itself is saved, and the YAML download link only works in builds.
- The release workflows have been linted (actionlint with shellcheck) but never run on GitHub.
- `wso2-docs build standards/contribute` builds Contribute at `/contribute/`, but the release pipeline doesn't yet build it from a Platform tag.
- `preview --search` indexes the Edition once, at start. Edits made during the preview are not re-indexed.
- PR previews have no search.
