# Repo structure, branches and tags

Last checked against code: 2026-10-26

Which repos exist, what each holds, and how branches and tags name Docs releases.

## Repos

- **One Platform repo, `wso2/docs-platform`, holds everything but content**: Docusaurus, theme, plugins and config are owned centrally, and Content repos hold content only. Theme sync by copying files into product repos (docs-integrator's way) caused daily sync PRs and overwrote owned files. [F-map] [F01] [F11]
- **Content repos are `wso2/docs-<family or product>`** (`docs-api-platform`, `docs-identity-platform`, `docs-integrator`, `docs-agent-platform`, `docs-developer-platform`). A repo's name and its Doc space slugs are independent. Solutions and Other keep their current repos for now. [N07]
- **Each Doc space lives in exactly one Content repo, owned by one team. A repo may hold several Doc spaces.** [N02]
- **Frozen Unlisted copies live in their own archived repos**, `docs-bijira` and `docs-devant`, each with one Doc space and only `main`. [N07]
- **The Sandbox Content repo is `wso2/docs-sandbox`.** [F34]
- **No repo is created on GitHub without the user's approval**; the Pilot repos are local. [N10] [N-map]

## The Platform repo

| Path | Holds |
|---|---|
| `site/` | The one Docusaurus site, its theme wraps and components |
| `plugins/`, `lib/` | Remark plugins, build plugins, and the Platform's libraries (compose, release, switching, search, checks) |
| `bin/` | The CLIs: `wso2-docs` (authors), `wso2-release` (pipeline), `wso2-reports` |
| `worker/` | The Edge Worker |
| `navigation/` | The Platform navigation file and the Docs section manifests |
| `schemas/` | JSON Schemas for the three manifests and the data files |
| `standards/` | The documentation standards source, and the Contribute Doc space (`standards/contribute/`) |
| `templates/` | The Content repo boilerplate (`content-repo/`) and a sample section manifest |
| `skills/` | The author skills, packaged as a Claude Code plugin (`.claude-plugin/`) |
| `migration/` | The converter from MkDocs and Docusaurus sources |
| `.github/` | The Platform's workflows, the reusable workflows Content repos call, CODEOWNERS, the extension-proposal form |
| `spec/`, `GLOSSARY.md`, `.scratch/` | This spec, the glossary, and the wayfinder maps and tickets |

[F11] [N07] [N09] [N10]

## Content repo layout

```text
docs-api-platform/
├── README.md  CODEOWNERS            shared files only at the root
├── .github/workflows/docs.yml       one path-filtered workflow
├── .github/workflows/docs-preview-publish.yml
├── .github/workflows/docs-sync.yml  optional generated-content sync
├── .github/branch-ruleset.json
├── .vscode/                         editor settings and extension recommendations
└── <slug>/                          one directory per Doc space
    ├── docspace.yaml  editions.yaml  redirects.yaml
    ├── docs/                        folders are the menu tree
    ├── partials/                    shared inside this Doc space only
    └── assets/                      cloud/ and self-hosted/ for Edition-only files
```

- **Every Doc space has its own `<slug>/` directory, even in a repo with only one.** One layout everywhere. [N07]
- **`docs/` folders are the menu tree**, with `_category_.yml` for labels and order and front-matter `sidebar_position`. There is no hand-kept sidebar file. The top level follows the skeleton (see [navigation.md](navigation.md#family-clouds-and-cloud-parts)). [F08] [N07]
- **API specs sit next to their reference page** (`docs/reference/apis/<api>/openapi.yaml`). [F20] [N07]
- **Partials are shared within one Doc space only, never across Doc spaces or repos.** A cross-repo import would make one Doc space's build depend on another repo's release; other content is linked with `docs:` or copied. [F08] [N07]
- **Images are plain files in git, without LFS**; videos are embedded from a video host, never committed. [F08]
- **The root holds only shared files**: README, CODEOWNERS, the workflows, the branch ruleset and the editor settings. The workflows, ruleset and editor settings come from the Platform's `templates/content-repo/` and are Platform-managed. [N07] [N10] [F34]
- **A Content repo holds no site tooling and no code**: no React, plugins or CSS (see [extension-points.md](extension-points.md)). [F-map] [N11]
- **The README links the developer guide and never repeats it.** [N09]

## Branches

| Branch | Builds |
|---|---|
| `main` | Every Doc space's main line: Cloud for a Doc space with Cloud; its part of the platform's tree for a Cloud part; a `next` preview (never published) for a Doc space with Self-hosted versions only; the only Edition of an unversioned Doc space |
| `<slug>/release/<version>` | That Self-hosted version. A copy of the whole repo, but its build reads only `<slug>/`. |
| `release/<version>` | The same, allowed only in a repo with one Doc space |

- **A release branch is cut from `main` at the product's code freeze or release candidate**, previewed on staging, and gets its first public Docs release at GA. The cut is `wso2-docs branch-cut`, or creating the branch on GitHub, after which the `branch-cut` job of `docs.yml` opens the pull request that removes the covered markers from `main` (see [editions-and-versions.md](editions-and-versions.md#the-branch-cut)). [F08] [N25]
- **The blocking `release-scope` check refuses a change on a release branch outside its Doc space's directory.** [N07] [N15]
- **A branch accepts changes until its version reaches end of life**; it is then archived read-only and its last tag stays served. [F08]
- **The branch ruleset covers `main`, `release/*` and `*/release/*`.** [N15] [N10]

## Tags

| Tag | Made by |
|---|---|
| `[<slug>/]<version>-docs.<n>` | The **Release docs** run of the repo's `docs.yml`, on the version's branch |
| `[<slug>/]cloud-<YYYY.MM.DD>.<n>` | Every merge to `main` that touches the Doc space or one of its Cloud parts |

- **A repo with several Doc spaces must prefix tags and release branches with the Doc space slug**; a one-Doc-space repo may leave the prefix out. [N02] [N17]
- **`<n>` counts up from 1 per version or per day.** Each version tag gets a GitHub Release whose notes say what changed in the docs. [F08]
- **A Cloud part has no Cloud tag of its own: a change to it makes its platform's tag.** [N15] [N17]
- **Docs release tags come only from the workflow**; a tag ruleset blocks other tag pushes. [F08]

## Backports

- **Fixes go to `main` first and reach maintained release branches by a cherry-pick pull request.** A direct release-branch pull request is only for content that no longer exists on `main`. There is no backport bot: the first map's label bot was not built, and Contribute documents the cherry-pick. [F08] [N10]

## Converted repos

- **The Pilot repos are generated by the converter in `migration/`.** Fixes go into the converter as rules or as override-patch entries, never as hand edits, until a future cutover after a content freeze. Every converter commit records its source commit. The repos start with fresh history. [F14] [N07] [N15]
- **Porting product content is a separate effort.** Legacy-URL coverage, text parity and page counts belong to it; the converted Pilot repos are its starting point. [N-map] [N21]

[F-map]: ../.scratch/wso2-doc-space/map.md
[F01]: ../.scratch/wso2-doc-space/issues/01-docusaurus-precedent.md
[F08]: ../.scratch/wso2-doc-space/issues/08-content-repo-contract.md
[F11]: ../.scratch/wso2-doc-space/issues/11-platform-build-pipeline.md
[F14]: ../.scratch/wso2-doc-space/issues/14-migration-approach.md
[F20]: ../.scratch/wso2-doc-space/issues/20-api-reference-rendering.md
[F34]: ../.scratch/wso2-doc-space/issues/34-writer-experience.md
[N-map]: ../.scratch/wso2-docs-navigation/map.md
[N02]: ../.scratch/wso2-docs-navigation/issues/02-manifest-model.md
[N07]: ../.scratch/wso2-docs-navigation/issues/07-repo-structure.md
[N09]: ../.scratch/wso2-docs-navigation/issues/09-developer-guide.md
[N10]: ../.scratch/wso2-docs-navigation/issues/10-boilerplate.md
[N11]: ../.scratch/wso2-docs-navigation/issues/11-extension-points.md
[N15]: ../.scratch/wso2-docs-navigation/issues/15-converter-and-repos.md
[N17]: ../.scratch/wso2-docs-navigation/issues/17-release-pipeline.md
[N21]: ../.scratch/wso2-docs-navigation/issues/21-pilot-acceptance.md
[N25]: ../.scratch/wso2-docs-navigation/issues/25-close-spec-code-gaps.md
