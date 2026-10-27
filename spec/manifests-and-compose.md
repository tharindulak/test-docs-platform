# Manifests and compose

Last checked against code: 2026-10-27

Configuration is by composition: each team keeps its own manifest, and the Platform's compose step merges them into the published Deployment manifest. Nothing else about navigation is kept centrally. [N02]

## The three manifests

| Manifest | File | Kept by | Holds |
|---|---|---|---|
| Doc space manifest | `<slug>/docspace.yaml` on the Content repo's `main` | The Doc space's team | Names (`displayName`, `formerNames`, `brand`, `editionNames`), Editions in display order with optional `branch`, `pin` and `status`, Cloud `parts` or `cloud.in`, `legacyVersions`, `latest`, `home` or `listed: false` (plus `indexed`), `notices`, owners, `repo`, `issues`, `editLinks`, `environments` |
| Docs section manifest | `navigation/sections/<id>.yaml` in the Platform | The section's team, through `.github/CODEOWNERS` | `title`, `products` (a `label` and an `opens` target: Doc space, optional Edition or page), `menu` (Doc space entries with `version-in`, or link entries `{label, url}`) |
| Platform navigation file | `navigation/navigation.yaml` in the Platform | The Platform team | Families and groups in order with descriptions, environments, the list of sections, the Content repos to read, products not on WSO2 Docs yet (`notYetOnWso2Docs`) |

[N02] [N14] [N18]

- **Only `main`'s copy of `docspace.yaml` counts**; copies on release branches are ignored. [N02]
- **Per-Edition variables stay in `editions.yaml`**, beside the manifest. [N02]
- **A section sets only where a Doc space appears and how its version is chosen.** Names always come from the Doc space manifest, except the products-menu `label`. [N02]
- **`version-in` defaults to `menu` for a Doc space with two or more Editions** (a Cloud part counts as one) and `header` otherwise; teams may choose `header`. `version-in: menu` with fewer than two Editions blocks. [N12] [N14]
- **`chrome.json` and the Landing configuration stay Platform-owned.** [N02]

## Format

- **All three are YAML with `schemaVersion: 1`, validated against JSON Schemas in `schemas/`**, published for editors and PR checks. **Fields are only ever added**, so deployments built long ago keep reading the published manifest. [N02] [N14]
- **Manifests and data files are read with YAML's core schema**, so an unquoted date such as `until: 2027-03-31` stays text. [N10]

## Compose

- **Compose (`wso2-release compose`) reads the navigation file, every section manifest and every Doc space manifest on each Content repo's `main`, validates them and merges them into the Deployment manifest.** The stored copy, `_platform/composed.json`, keeps the inputs, owners, branches and pins; the published `manifest.json` carries what readers' pages need. [N02] [N14]
- **The release pipeline adds each Edition's deployed release per environment. No team writes deployment state.** [N02] [N17]
- **Compose runs** on every Platform pull request that changes `navigation/`, `schemas/` or Contribute's manifest (against the latest merged manifest, with `--as-base` so `main`'s own errors show as "not caused by this change"); on every Content repo pull request to `main` (`compose --pr --published`, against the published `manifest.json`, with no secrets and no other checkout); on every manifest change merged to the Platform's `main` and on demand; and before every Docs release, after reading every Content repo's `main`. [N02] [N10] [N17] [N23]
- **Every issue is reported in the pull request that causes it, naming its files and owning teams.** Only errors in files the pull request changes block it. [N02] [N14]
- **When composing on `main` fails anyway** (two pull requests that each pass alone), the last good manifest stays published, both owning teams are alerted, and releases that need the new manifest wait. [N02] [N14]

## Checks

| Kind | Rule |
|---|---|
| Blocking | `schema` (incl. unparseable YAML, slug ≠ directory, repo mismatch), `duplicate` (slugs incl. `notYetOnWso2Docs`, Editions, menu entries, link labels), `home-not-listing`, `lists-unlisted`, `removed-still-listed`, `unknown-edition` (an `opens` or notice Edition), `latest` (naming no Edition, or `cloud` in a Doc space with Self-hosted Editions), `version-in`, `cloud-part` (both sides, same repo, one platform, no own Cloud, parts only on Cloud), `unknown-section`, `unknown-family`, `unknown-environment`, `branch-prefix`, `pin` (must be one of the Edition's tags), `missing-repo`, `link-internal` (a link entry into WSO2 Docs) |
| Warning | `unknown-docspace` (a section lists a Doc space not there yet), `label-differs` (a leading "WSO2 " is ignored), `borrowed-not-in-home-products`, `notice-ended` |
| Note | `borrowed`, addressed to the Doc space's team |

[N02] [N14] [N10] [N19]

## A new Doc space

- **A section may list a Doc space that doesn't exist yet; compose warns and keeps the entry `pending`.** The published manifest hides every section entry whose Doc space has no Docs deployment yet, so a reader never gets a menu line that leads nowhere. [N10]
- **The order of merges is**: the home section lists the Doc space (passes with the warning); the Doc space's pull request then passes `home-not-listing`; its first Docs release makes the entry appear. [N10] [N23]

## At runtime

- **Every Docs deployment bakes in a snapshot of the Deployment manifest and fetches the live `manifest.json` in the browser** with a short cache. A new version, end of life, a menu change or a notice reaches old builds with no rebuild. If the live copy is unreachable, the snapshot is used; an old deployment may then call itself the newest, which is accepted as rare and harmless. [F10] [N03]
- **`preview`, `check` and `build` compose from the published manifest plus the local repo's own manifests** by default, so a writer needs no other checkout; `WSO2_DOCS_CONTENT_REPOS` composes from local checkouts instead. [N10]

[F10]: ../.scratch/wso2-doc-space/issues/10-version-switcher.md
[N02]: ../.scratch/wso2-docs-navigation/issues/02-manifest-model.md
[N03]: ../.scratch/wso2-docs-navigation/issues/03-shared-menu-assembly.md
[N10]: ../.scratch/wso2-docs-navigation/issues/10-boilerplate.md
[N12]: ../.scratch/wso2-docs-navigation/issues/12-platform-walkthroughs.md
[N14]: ../.scratch/wso2-docs-navigation/issues/14-manifests-and-compose.md
[N17]: ../.scratch/wso2-docs-navigation/issues/17-release-pipeline.md
[N18]: ../.scratch/wso2-docs-navigation/issues/18-chrome-navigation.md
[N19]: ../.scratch/wso2-docs-navigation/issues/19-extensions.md
[N23]: ../.scratch/wso2-docs-navigation/issues/23-platform-team-guide.md
