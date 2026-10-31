# Authoring and preview

Last checked against code: 2026-10-27

How writers change content and see the result, the tools that help them, and the documentation standards they follow.

## Writing in GitHub

- **Authoring is Markdown/MDX in GitHub with pull request review.** There is no CMS or non-Git workflow. [F-map]
- **There are two paths into the same pull request and checks**: a quick edit in the GitHub web editor or github.dev, seen on the PR preview; or a local change with `npx @wso2/docs preview`. Local needs Node 22 LTS; Docker is needed only for local search. [F34]

## Preview

- **`preview` runs in a Content repo checkout, for one Doc space directory**, with the Platform and its build caches outside the repo so the repo stays content-only. It infers the Edition from the branch: `main` previews Cloud, a Cloud part previews at its tree address, a release branch previews its version, and a Doc space with Self-hosted versions only previews `main` as `next`. A writer's branch previews as the line it left (`main` or a release branch), as `check` compares with it. [F34] [F24] [N09] [N15]
- **Options**: `--edition` for another Edition, `--only <folder>` for speed (links outside it are external), `--search` for local Typesense, `--exact` to render exactly as published. Targets: a scoped cold start under 60 seconds, a hot reload under 2 seconds. [F34] [F24]
- **Two dev-only controls show every Edition**: an Edition toggle that re-renders the page as another Edition, and "Show markers", which outlines every `<Edition>` block and lists page-level limits. Pages limited to other Editions are built too, each with its limit at the top. Both are on in local preview (unless `--exact`) and on PR previews, and never in a published Docs deployment. The toggle lists the Doc space's Editions from the manifest, the built Edition and `next`. [F34] [F24] [N25]
- **A PR preview is built twice.** The checks run on the strict build `wso2-docs check` makes (broken links fail), and the published preview is a second build of the same Edition with `wso2-docs build --show-markers`, which renders as local preview does (broken links only warn, so a pull request whose checks fail still gets a preview). If the markers build fails, the checked build is published instead. [F34] [F11] [N25]
- **Markers are never shown in a release build.** `--show-markers` is refused with `--env production` and for a latest twin or the Landing deployment, the site config refuses markers with a production build, `build` always sets the show-markers variable itself (so one left in the environment can't turn them on), and a build made with markers records `showMarkers: true` in `_platform/edition.json`, which the release's build check refuses. [N25]
- **Preview composes from the published manifest plus the local repo's manifests**, so no other checkout is needed. [N10]

## Commands

- **`wso2-docs init <slug>` writes the boilerplate** from `templates/content-repo/`: a new Content repo, or one more Doc space in an existing one (with its README row and CODEOWNERS line). It refuses an existing slug and changes nothing on a second run. `init --root-files` refreshes a repo's root files after a Platform release. The boilerplate is generated, not a GitHub template repo, because a template repo can only start new repos. [N10] [N23]
- **`wso2-docs new <type>` creates a page from its Page type's template.** [F18] [F31]
- **`wso2-docs check` runs the pull request's checks** (see [build-and-quality-checks.md](build-and-quality-checks.md)). [F17]
- **`wso2-docs branch-cut <doc space> <version>` makes a Branch cut**: the version's branch, the removal of the markers it covers from `main` on a branch for a pull request, and the branch cut report (see [editions-and-versions.md](editions-and-versions.md#the-branch-cut)). [F09] [N25]

## Onboarding and the Sandbox

- **Contribute's "Start here" is the onboarding order**: choose quick edit or local; set up; create or edit a page; check; open a pull request and read the preview; after merge, backport if needed. Each step links deeper, and a cheat sheet lists the commands. [F34]
- **Writers try the flow in the Sandbox** (`wso2/docs-sandbox`): a few dozen pages across two Editions with real markers and partials, on staging only, reset monthly. [F34] [F31]
- **Content repos carry Platform-managed editor settings** (`.vscode/extensions.json` recommending the MDX, Vale and cspell extensions, and `settings.json` validating `docspace.yaml`). [F34] [N15]

## Author skills

- **Two author skills, "Check my changes" and "Write a page", live in the Platform's `skills/`**, packaged as a Claude Code plugin and never copied into Content repos. Skills are developer-local first. What they check comes from the standards. [F17] [F31] [N-map]
- **The AI-agent instruction files in today's legacy repos are retired, not copied.** [F18]

## Documentation standards

- **The Microsoft Writing Style Guide is the base.** The WSO2 Docs style guide records only deviations and WSO2 specifics. [F18]
- **Sentence case everywhere**: page titles, headings, sidebar and category labels. [F18]
- **House rules**: US English; second person, present tense, active voice; contractions allowed; **bold** for UI labels; `code` for code, paths, commands and placeholders (`<IS_HOME>`); descriptive link text; every code fence has a language and no `$` prompt; screenshots PNG or WebP, cropped, light theme, no personal data, with alt text saying what they show. [F18]
- **Five admonition types**: note (an aside), tip (a better way), info (background), warning (errors, security exposure or downtime), danger (irreversible or data loss); at most two in a row. [F18]
- **Every page has one Page type**, each with a template, and the skeleton folder sets the default:

  | Page type | Default folder |
  |---|---|
  | Quick start, Tutorial | Get started |
  | How-to | Guides, Deploy & operate |
  | Concept | Concepts |
  | Reference | Reference |
  | Release notes | Release notes |

  [F18]
- **Pages shared across Editions use `{edition.*}` variables, never hard-coded product names**, and markers rather than prose such as "In Cloud …". A marked page must read correctly in every Edition it appears in. [F18]
- **One terminology file in the Platform** lists product names, retired names, preferred and banned terms; it generates the Vale substitution rules and the skills' references. A retired name appears only as "(formerly Asgardeo)" and the like. [F18]
- **The standards live once, in `standards/`**, and `npm run standards` generates the Contribute pages, the Vale package, the page templates and the skill references; a test fails when any is stale. [F18] [F31]
- **A docs standards owner (a lead technical writer, to be named) and a representative from each product's doc team own the standards**, as CODEOWNERS; changes are pull requests to the Platform. [F18]

## Contribute

- **Contribute is an unversioned, Platform-wide Doc space at `/contribute/`**, Unlisted but `indexed: true`, with its source in `standards/contribute/`. It holds the contributor guide, the developer guide for product teams and the guide for running WSO2 Docs, each as one copy; the Platform README and every Content repo README link them and never repeat them. [F18] [N09] [N18] [N23]

[F-map]: ../.scratch/wso2-doc-space/map.md
[F17]: ../.scratch/wso2-doc-space/issues/17-quality-gates.md
[F18]: ../.scratch/wso2-doc-space/issues/18-documentation-standards.md
[F11]: ../.scratch/wso2-doc-space/issues/11-platform-build-pipeline.md
[F24]: ../.scratch/wso2-doc-space/issues/24-scaffold-platform.md
[F09]: ../.scratch/wso2-doc-space/issues/09-shared-family-content.md
[F31]: ../.scratch/wso2-doc-space/issues/31-quality-checks-and-skills.md
[F34]: ../.scratch/wso2-doc-space/issues/34-writer-experience.md
[N-map]: ../.scratch/wso2-docs-navigation/map.md
[N09]: ../.scratch/wso2-docs-navigation/issues/09-developer-guide.md
[N10]: ../.scratch/wso2-docs-navigation/issues/10-boilerplate.md
[N15]: ../.scratch/wso2-docs-navigation/issues/15-converter-and-repos.md
[N18]: ../.scratch/wso2-docs-navigation/issues/18-chrome-navigation.md
[N23]: ../.scratch/wso2-docs-navigation/issues/23-platform-team-guide.md
[N25]: ../.scratch/wso2-docs-navigation/issues/25-close-spec-code-gaps.md
