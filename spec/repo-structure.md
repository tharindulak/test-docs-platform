# Repo structure, branches and tags

Last checked against code: 2026-10-29

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
| `schemas/` | JSON Schemas for the three manifests, the data files and the intake record |
| `releases/` | The intake records, one per Doc space (`<slug>.yaml`): the Docs bundles intake accepted. Written by `intake.yml`; created by the first accepted bundle |
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
- **`docs/` folders are the menu tree**, with `_category_.yml` for labels and order and front-matter `sidebar_position`. There is no hand-kept sidebar file. The top level follows the skeleton (see [navigation.md](navigation.md#family-clouds-and-cloud-parts)), or, in a Doc space with audience groups, holds the groups, each following the skeleton (see [extension-points.md](extension-points.md#audience-groups)). [F08] [N07] [N11]
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

- **The converter reads MkDocs sources and, since 2026-10-28, Docusaurus sites** (`docs/`, `versioned_docs/`, versioned sidebars; first Integrator) into the same layout, checks and run report. [B19]
  - A `sidebars.ts` or `.js` is never run: its object literal is read when it holds only literals, else the sidebar falls back to the folders and `sidebar_position`, and the run report says which.
  - The sidebar's top level is re-filed into the skeleton (the product config's table), each category below becomes a folder with its link page as `index`, and sidebar order becomes `sidebar_position`. The first top-level category's link page is the Edition home, or, when no category links a page, its first page; a page in no sidebar is kept, `unlisted: true`.
  - Each version copies only the images its pages reference (Q76); links into Doc spaces left out, and paths with no page, go to the legacy site.
  - A partial that reads props (`{props.x}`) is inlined into each page that uses it, the props replaced by the call's literal values, since Platform partials take none. Two component shapes such a partial defines are applied without running code: a conditional wrapper (children shown when a prop is set, or not set) and a collapsible section (its content under a heading, or in `<details>`). Any other `export` is removed and listed.
  - A Mermaid diagram stays a fenced code block, since the Platform renders no diagrams; each is listed as a fallback.
  - A site version whose folder name differs from its Edition id (Agent Manager's `version-v1.0.0` is Edition 1.0.0) is mapped by the product config. A site with no `versioned_docs/` that its Doc space places as unversioned converts its `docs/` as the one Edition `_` (Accelerator for Healthcare, from `wso2/open-healthcare-docs`).
  - The product's override list applies to a Docusaurus source as to an MkDocs one, its paths under the site directory (`docs/a/b.md`). A Docusaurus 2 site's pages are MDX 1, where a bare `<WSO2_IS_HOME>` stayed text; MDX 3 reads it as an unclosed tag, so each is made code by an override patch.
- **An unversioned Doc space converts on `main` only, as its one Edition `_`** (first Platform Security, from `wso2/docs-security`). MkDocs variables are read with the delimiters the source's `markdownextradata` sets (`{{# … #}}` there), so a `{{ x }}` under other delimiters stays text; a home page its theme template drew takes its cards from the product config (`homeCards`, or `homeCards(edition)` where versions differ) when the config gives them, replacing any Markdown the template hard-coded (Updates, from `wso2/docs-updates@master`), else from `extra.home_page_cards`. A nav entry for a page that redirects home (`'': page-not-found.md`) is left out of the sidebar. A raw HTML block ends at its closing tag, as in Python-Markdown, so the next line starts a block of its own.
- **A converted versions-only Doc space alone in its repo gets unprefixed release branches**, `release/<version>` (first Accelerator for Financial Services, from `wso2/docs-open-banking`); the converter refuses them once `main` holds another Doc space.
- **Several MkDocs sites of one product convert as one Doc space, one audience group per site** (first Engineering Platform Cloud, from `wso2/docs-choreo-dev`'s developer and platform-engineer sites; decided 2026-10-29). Each site's pages go under its group folder, with the skeleton inside; the sites are not Edition contexts, so pages with the same path stay one per group. Each site's legacy URLs map from its own place under the legacy base (`/docs/` and `/docs/platform-engineer/`), and links by an older address of the same site (`wso2.com/choreo/docs/…`) resolve like legacy links. A source using `mkdocs-include-markdown-plugin` has its `{% include %}` files inlined, relative to the including page. In a single-tree product, a title, heading id or generated description holding an Edition variable reads the Edition's value, as the build renders it; the body keeps the variable.
- **The Pilot repos are generated by the converter in `migration/`.** Fixes go into the converter as rules or as override-patch entries, never as hand edits (the fork proof's fork-only edits aside: `repo:` fields naming the fork and the workflow files, decided 2026-10-28 [B17]), until a future cutover after a content freeze. Every converter commit records its source commit. The repos start with fresh history. [F14] [N07] [N15]
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
[B17]: ../.scratch/wso2-docs-bundles/issues/17-identity-server-on-the-proof.md
[B19]: ../.scratch/wso2-docs-bundles/issues/19-integrator-on-the-proof.md
