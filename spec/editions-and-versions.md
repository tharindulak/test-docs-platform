# Editions and versions

Last checked against code: 2026-10-27

What an Edition is, which one is `latest`, how Editions are labelled and ordered, and how one Content repo serves Cloud and every Self-hosted version.

## Editions

- **An Edition is one choice in a Doc space's version dropdown**: its Cloud docs or one Self-hosted version. Each Edition is its own Docs deployment, built and deployed without rebuilding any other. Docusaurus's native multi-version builds are ruled out: they ran out of memory and hit bundler bugs on WSO2's own repos. [F01] [F-map]
- **Cloud is unversioned and is the latest Edition for readers**: listed first, opened first, and described as having the newest features, some not yet released Self-hosted. [N-map] [N04]
- **Cloud is always an Edition, never a menu entry.** Where a family Cloud holds a product's Cloud as a Cloud part, the product's "Cloud" choice opens the part. [N-map] [N12]
- **There is no `next` version.** No Edition called `next` is ever published. Content not yet in a release goes on the main line (Cloud) where the Doc space has Cloud. In a Doc space with Self-hosted versions only, `main` previews as `next`, which is a preview build only and never published. [N-map] [N06] [F07]
- **Versions are exact**: `1.0.0`, not `v1.0.0`; `5.1.0`, not `5.1`. Date versions such as `2026.09.24` are kept as they are. "WIP" and "(EOL)" are manifest status, never label text. [N06] [N16]
- **A version becomes an Edition only once it is converted.** Until then it is a Legacy version on its old site. [N12]

## Order and labels

- **Editions appear in the order the Doc space manifest gives, Cloud first. They are never sorted.** A numeric sort would put `2026.09.24` before `1.2.0`. [N04] [N18]
- **Labels:**

  | Label | When |
  |---|---|
  | Cloud | The Doc space's Cloud, or its Cloud part |
  | Cloud (`<brand>`) | Cloud, where the Doc space manifest sets `brand` |
  | `<version>` (newest release) | The newest Self-hosted version, in a Doc space that has Cloud |
  | `<version>` (latest) | The newest Self-hosted version, in a Doc space without Cloud |
  | Older versions (old site) | The heading over Legacy versions |

  These replace the first map's "(latest release)". The same labels and words apply in the chrome, search, Markdown twins, `llms.txt` and the MCP tool descriptions. [N04] [N18] [N20]
- **Edition names come from the Doc space manifest** (`editionNames`, such as "Identity Server {version}"). A Cloud part's Edition is named "<Component> Cloud", such as "AI Gateway Cloud". [N02] [N05]

## `latest`

- **`/latest/` is the newest release: the first Self-hosted Edition in manifest order.** The team may set `latest` to another Self-hosted Edition, never to `cloud` where there are Self-hosted Editions (compose blocks it). Self-hosted readers searching the web stay on release docs, Self-hosted-only pages keep one stable address, and legacy `/en/latest/` traffic lands on a release. [F19] [N05] [N17]
- **`/latest/` is never Cloud.** Cloud keeps `/cloud/`, which is already stable. A Cloud-only Doc space's `latest` is `cloud`; it is not built twice, and its `/latest/…` answers 302 to `/cloud/…`. An unversioned Doc space has no `latest`. [N05] [N17]
- **The Edition that feeds `latest` has two Docs deployments**: its own address and `/latest/`. Pinned version addresses never move. [F07] [N17]

## Legacy versions and end of life

- **A Legacy version is listed but not an Edition**: it has no Docs deployment, is not indexed by search, and opens its old site's version home in a new tab, leaving the page as it is. [F10] [F12] [N04]
- **End of life is a manifest status** (`status: end-of-life` on an Edition). It takes effect without a rebuild: the end-of-life notice, `noindex, follow` from the edge, removal from the sitemap index and the root `llms.txt`, and search only under This Edition. Its pages stay served. When a version reaches end of life, and who decides, is not yet decided (see [open-items.md](open-items.md#undecided)). [F10] [F19] [F21] [F12] [N23]
- **Sending a deployed version back to its old site** means moving it to `legacyVersions` and taking its Docs deployment down with `wso2-release retire`, which refuses a live or end-of-life Edition. Its addresses then 302 to its `legacyUrl` ([urls-and-redirects.md](urls-and-redirects.md#short-address-redirects-edge)). [N23] [N25]

## Pins

- **`pin: <tag>` holds an Edition on one Docs release**: every other tag of that Edition is refused until the pin is removed. Rolling back is a pointer flip by the Platform team ([releases-and-deployments.md](releases-and-deployments.md#rollback)), not a pin. The navigation map's "pin holds or rolls back" was narrowed to "holds" when the processes were checked against the code. [N02] [N23]

## Content per Edition

One Content repo branch is filtered at build time for each Edition it serves.

- **There are exactly three Edition markers**: Cloud only, Self-hosted only, and Self-hosted from a version or `next` (not yet committed to a release). Sections and phrases use the MDX component `<Edition only="cloud">`, `<Edition only="self-hosted">` or `<Edition selfHostedFrom="7.4.0">`; whole pages use front matter `editions: cloud | self-hosted` or `selfHostedFrom: <version | next>`. Directives (`:::cloud`) are rejected because they share syntax with admonitions. [F09]
- **A Self-hosted Edition shows shared and Self-hosted content, never Cloud-only content.** [F09] [B08]
- **Cloud shows shared and Cloud-only content, and Self-hosted additions too, labelled.** A Self-hosted addition is Self-hosted-only content with no Cloud counterpart. Cloud does not show Self-hosted content marked `selfHostedFrom: next` (in no release yet), nor Self-hosted-only content from a version after the newest release, which no release has either. `selfHostedFrom` content without `only` shows in Cloud as before. [B08]
- **An Edition variant is one block written once per kind of Edition**: `<Variants><Edition only="cloud">…</Edition><Edition only="self-hosted">…</Edition></Variants>`. Each Edition, Cloud included, shows only its own form. `<Variants>` holds exactly those two markers (the Self-hosted one may add `selfHostedFrom`) and nothing else, or the build fails. It groups markers; it is not a fourth marker. [B08]
- **A Self-hosted-only page with a Cloud counterpart names it** in front matter, `cloudCounterpart: <path>`. It stays out of Cloud, and the version dropdown maps the two pages to each other. The front-matter check fails a `cloudCounterpart` on a page that is not Self-hosted only, or naming a page Cloud does not show. Every other Self-hosted-only page shows in Cloud. [B08]
- **Self-hosted additions shown in Cloud are labelled "Self-hosted"**, with a link "See it in <newest release name>" to the same page under `/latest/`: a badge under a page's title, a marked box around a block, and a `**Self-hosted only.**` line before the content in the Markdown twin and `llms.txt`; a phrase gets a "Self-hosted" tag with no link (`**Self-hosted only:**` in the twin). Inside an addition, Cloud reads the content as the newest release does: its `{edition.*}` variables take the `self-hosted:` values, with `{edition.version}` the newest release, and nested markers apply as that release applies them, so a nested Cloud-only block is dropped (confirmed by the user 2026-10-28). A Self-hosted-only page shown in Cloud has its canonical on the same page under `/latest/`. [B08]
- **Each Cloud part follows these rules** with its own Doc space's newest release. A family-level Doc space has no Self-hosted Editions, so they do not apply to it. [B08]
- **Non-matching content is removed at build time, before the table of contents is computed**, so hidden headings never reach the TOC, search or twins. A page limited to other Editions is dropped with its sidebar item. [F09] [F24]
- **Markers survive Branch cuts.** A release branch is a plain copy of `main`, and nothing is resolved at cut time, so fixes copy cleanly between branches. [F09]
- **There are no version-range conditions.** Each version is its own branch. [F09]
- **`{edition.*}` variables come from the Doc space's `editions.yaml`**: its `cloud:` block for Cloud, its `self-hosted:` block for every version, with `{edition.version}` injected from the branch. They fill page content and code, the front-matter `title`, `sidebar_label` and `description`, and an API page's `server:`. An unknown variable fails the build. [F09] [F08] [F27] [F28]
- **A new or changed `selfHostedFrom` version must be newer than the latest release** (blocking, owner-overridable). Content still marked `next` at a Branch cut stays out of the new version and only warns. [F09] [F17]
- **After each Branch cut, a pull request on `main` removes the markers the new branch covers, and a branch cut report lists what ships, what is held and what is still `next`.** Together these keep live markers limited to features in flight. [F09] [F08]

### The Branch cut

- **`wso2-docs branch-cut <doc space> <version>` makes the Branch cut.** It makes the version's branch from `main`, commits the removal of the covered markers on `branch-cut/<slug>/<version>` from `main` for a pull request, and prints the branch cut report. It works in git only: nothing is pushed, and the checkout and working tree are left as they are (the commit is made through a temporary index). `--dry-run` prints the report and makes nothing. [F09] [F08] [N25]
- **The branch is the one the Edition builds from**: `<slug>/release/<version>` in a repo with several Doc spaces or whose Doc space names prefixed branches, else `release/<version>` (see [repo-structure.md](repo-structure.md#branches)). A one-Doc-space repo that keeps unprefixed branches gets an unprefixed one, because compose refuses a Doc space whose branches mix the two forms. [N02] [N25]
- **It refuses** a version that isn't exact, a version not newer than the newest release (the first Self-hosted Edition in manifest order), an existing branch, an unversioned Doc space, and a second run (an existing `branch-cut/<slug>/<version>`). A Cloud-only Doc space may cut its first version. [N25]
- **The markers a version covers are `selfHostedFrom` versions at or below it**, compared as the build compares them (a date version after every numbered one). Every later version is cut from `main`, so on `main` such a marker limits nothing:

  | On `main` before | After |
  |---|---|
  | `<Edition selfHostedFrom="X">…</Edition>` | Its content, unwrapped as plain shared content |
  | `<Edition only="self-hosted" selfHostedFrom="X">` | `<Edition only="self-hosted">` |
  | Front matter `selfHostedFrom: X` | The line removed; `editions:` stays |

  `next`, newer versions, Cloud only and Self-hosted only markers stay. Pages and partials under the Doc space's directory are read as Docusaurus reads them, never markers in code. [F09] [N25]
- **Nothing is resolved on the release branch, and `next` is never rewritten.** The cut branch is a plain copy, so its markers stay and every build of the version filters them; `next` content stays out of the version and only warns. The release owner decides on each `next` block from the report: to ship it, `next` becomes the version on the release branch and the marker comes off `main`. [F09] [F17] [N25]
- **The branch cut report** has four parts: still `next` (each with its file and line), ships in the version, held for a later version, and every marker change on `main` with what it was and what it became. It reads the release branch for the first three and `main` for the changes. [F09] [N25]
- **The bot is the `branch-cut` job of a Content repo's `docs.yml`**: creating a release branch (`[<slug>/]release/<version>`) calls the Platform's reusable `branch-cut.yml`, which runs `branch-cut --branch` on the existing branch, pushes `branch-cut/<slug>/<version>` and opens its pull request on `main` as a **draft**, with the report as the description and in the run summary. A writer who already pushed that branch from a local run is left alone, so a local run pushes it before the release branch. The release branch itself is never changed. It opens the draft with the workflow's own token (`contents: write`, `pull-requests: write`), so Content repos hold no token or App for the Platform; a pull request opened that way starts no checks, so an owner marks it **Ready for review**, which starts them (`docs.yml` listens for `ready_for_review`). That pull request needs an owner's review anyway. [F08] [N25] [B14]

[F-map]: ../.scratch/wso2-doc-space/map.md
[F01]: ../.scratch/wso2-doc-space/issues/01-docusaurus-precedent.md
[F07]: ../.scratch/wso2-doc-space/issues/07-url-scheme-and-redirects.md
[F08]: ../.scratch/wso2-doc-space/issues/08-content-repo-contract.md
[F09]: ../.scratch/wso2-doc-space/issues/09-shared-family-content.md
[F10]: ../.scratch/wso2-doc-space/issues/10-version-switcher.md
[F12]: ../.scratch/wso2-doc-space/issues/12-search-decision.md
[F17]: ../.scratch/wso2-doc-space/issues/17-quality-gates.md
[F19]: ../.scratch/wso2-doc-space/issues/19-seo-and-canonical-strategy.md
[F21]: ../.scratch/wso2-doc-space/issues/21-ai-llm-friendly-docs.md
[F24]: ../.scratch/wso2-doc-space/issues/24-scaffold-platform.md
[F27]: ../.scratch/wso2-doc-space/issues/27-convert-identity-platform.md
[F28]: ../.scratch/wso2-doc-space/issues/28-api-reference-renderer.md
[N-map]: ../.scratch/wso2-docs-navigation/map.md
[N02]: ../.scratch/wso2-docs-navigation/issues/02-manifest-model.md
[N04]: ../.scratch/wso2-docs-navigation/issues/04-version-switching-two-selectors.md
[N05]: ../.scratch/wso2-docs-navigation/issues/05-urls-and-latest.md
[N06]: ../.scratch/wso2-docs-navigation/issues/06-product-mapping.md
[N12]: ../.scratch/wso2-docs-navigation/issues/12-platform-walkthroughs.md
[N16]: ../.scratch/wso2-docs-navigation/issues/16-api-platform-conversion.md
[N17]: ../.scratch/wso2-docs-navigation/issues/17-release-pipeline.md
[N18]: ../.scratch/wso2-docs-navigation/issues/18-chrome-navigation.md
[N20]: ../.scratch/wso2-docs-navigation/issues/20-search-for-new-navigation.md
[N23]: ../.scratch/wso2-docs-navigation/issues/23-platform-team-guide.md
[N25]: ../.scratch/wso2-docs-navigation/issues/25-close-spec-code-gaps.md
[B08]: ../.scratch/wso2-docs-bundles/issues/08-cloud-edition-content.md
[B14]: ../.scratch/wso2-docs-bundles/issues/14-branch-cut-without-a-content-repo-token.md
