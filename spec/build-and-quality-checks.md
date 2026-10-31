# Build and quality checks

Last checked against code: 2026-10-27

How one Docs deployment is built, which checks run where, which block, and who can override them. The full list of checks with their fixes is generated from `standards/checks.yaml`.

## The build

- **One Docusaurus site (`site/`) builds every Docs deployment, one Edition per build**, with `baseUrl` `/<doc-space>/<segment>/`, the docs path pointing at the Doc space directory and the sidebar generated from folders. Strict builds throw on broken links and anchors. [F11] [F24]
- **The Edition filter runs before the TOC is built** (a `beforeDefaultRemarkPlugin`), and layouts are drawn before Docusaurus's own remark plugins. [F09] [F24] [N19]
- **Each build writes `_platform/`**: `edition.json`, `pages.json` (with anchors), `redirects.json`, `search-records.json`, `apis.json`, `markdown.json`, and its own sitemap (the classic preset's sitemap plugin is off). [F11] [F24] [F28] [F32]
- **The menus built into a page list only deployed Doc spaces, as the live menus do.** A build bakes in the manifest snapshot it server-renders its products menu, section menus and Landing page from. Given the environment's deployment state (`--deployed`: `_platform/state.json` or a published `manifest.json`), the snapshot hides every section and products-menu entry for a Doc space with no Docs deployment, as the flip's `manifest.json` does, counting the Doc spaces the build itself deploys (its own, its Cloud parts) as deployed. A release build reads staging's state, so the crawl gate passes while a merged Doc space waits for its first Docs release. `preview`, `check` and `build` composed with the published manifest read its deployments; with only `--manifest`, every Doc space in it is listed. [N23] [N25]
- **Builds on one machine share `site/.docusaurus`, so they run one at a time.** CI runs one job per deployment. [F24]
- **`site/package.json` has no `"type"`**: `"module"` breaks SSR and `"commonjs"` breaks imports. [F24]

## Where checks run

| Stage | What runs | Effect |
|---|---|---|
| Content repo pull request | `wso2-docs check` from the Platform's reusable workflow: the blocking checks, then warn-only lint on changed lines; plus the compose check | Required status "preview / checks", set by branch protection on `main` and release branches |
| Docs release build | `wso2-docs check --release`, the blocking subset | A failure deploys nothing; the previous release stays live |
| After deploy | The staging crawl gate | Blocks promotion to production |
| Platform pull request that changes the theme (`site/wso2-theme/`) | axe (pa11y-ci, WCAG 2 AA) on Sandbox Cloud pages with the theme: the home page, a guide with admonitions, a page with code blocks and a reference page, in light and dark at 1280 and 375 px | Any violation, or a page axe can't check, fails `ci.yml`, so the pull request doesn't merge |
| Nightly and weekly, on production | A full crawl incl. external links, axe on a sample nightly and the whole site weekly, the search consistency check | Report only, posted to Doc space owners |

[F17] [F31]

- **`wso2-docs check` locally runs the same checks as the pull request**, so passing locally means passing there. [F17] [F31]
- **External links are never checked on pull requests**, only nightly. [F17]
- **A theme change is checked for accessibility before it merges**, since it goes live without a rebuild. On a Platform pull request that changes `site/wso2-theme/`, `ci.yml` builds Sandbox Cloud and the Landing deployment, serves them together so pages load the theme from the host root as on the edge, and runs axe through `scripts/theme-axe.mjs` with the pa11y-ci version the nightly reports and the theme release use. It blocks on every violation, not only new ones: the Sandbox has none. The theme release's checks still run on every live deployment's sample page. [user decision 2026-10-28 (theme without rebuilding)]
- **The theme check fails, saying why, when it can't reach the Sandbox.** The Sandbox Content repo is private: on a pull request from a fork (whose run gets no secrets), or without `CONTENT_READ_TOKEN` or with one that can't read it, `ci.yml`'s `theme-axe` job checks out nothing and fails before the build with an error and a run summary that give the reason and say the theme change is not checked: a Platform team member must run the check from a branch in the Platform repo and open the pull request from it. [user decision 2026-10-28 (theme without rebuilding)]
- **Every axe run is one pa11y-ci, pinned exactly: 5.0.0**, in the nightly reports, the theme release's two runs and the Platform pull request's theme check (`PA11Y_CI` in `scripts/theme-axe.mjs`; a test holds the workflows to it). Its Puppeteer (25) downloads a current Chromium, which has `:has()`, so axe checks the page readers see: the theme uses `:has()`, and pa11y-ci 3.x ran Chromium 91, which hasn't. pa11y-ci 5 needs Node 22.13 or later. Its report is the same `--json` shape `wso2-release theme compare` and the summaries read. [user decision 2026-10-28 (theme without rebuilding)]

## Blocking and warn-only checks

| Blocks, never overridable | Blocks, owner-overridable (policy) | Warns only, changed lines |
|---|---|---|
| MDX compile, preview build (links, anchors, images), `docs:` links, Doc space manifest, release-branch scope, front matter, data files, Edition markers and variables, folder skeleton, image alt text, OpenAPI validation, Markdown twins | Redirect coverage, marker versions, image size (over 1 MB fails, over 300 KB warns) | Vale prose style, cspell spelling, headings and house style, OpenAPI description lint |

[F17] [F20] [F21] [F31] [N10] [N15] [N19]

- **An owner overrides a policy check with the `quality-override` label**, added by a CODEOWNER or maintainer, plus a "Quality override: <reason>" line in the pull request description. Build-breaking checks are never overridable. [F17] [F31]
- **Required front matter is `title`, `description` (one sentence, at most 160 characters) and `type`** (defaulted from the skeleton folder). Unknown keys fail; a new key is added to `standards/front-matter.yaml`. [F18] [F31]
- **A Content repo over 1 GB warns** and triggers an image clean-up review; it never blocks. [F17]

## Content safety

Bundles are untrusted input, and MDX is code: a page runs in the build and in readers' browsers. So content may carry no code of its own. [B04]

- **Imports only from the component catalogue.** A page may `import` only module ids listed in `standards/components.yaml` (such as `@theme/Tabs`, `@theme/TabItem`) and relative `.mdx` partials inside its Doc space. Every `export` is rejected. [B04]
- **Expressions are literals.** `{…}` holds only strings, numbers, booleans, arrays and objects of those, and `require("<relative path inside the Doc space>")`, optionally with `.default` (Docusaurus images need it; confirmed by the user 2026-10-27). Other function calls, arrow functions, template literals with expressions and member access are rejected. `{edition.*}` variables are replaced before compile and are not expressions. [B04]
- **No scripts and no active HTML.** A Doc space holds no `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs` or `.cjs` file. Pages hold no `<script>`, `on*=` attribute, `javascript:` URL or `dangerouslySetInnerHTML`; an `<iframe>` only from the hosts allow-listed in `standards/` (`youtube-nocookie.com` first); the converter writes YouTube embeds as `www.youtube-nocookie.com/embed/…` [B17], with no `srcdoc`, which would show its own HTML in place of the allow-listed page; no `<object>`, `<embed>` or `<frame>`, which would bypass the allow-list. [B04]
- **One blocking check, `content-safety`, runs three times**: in `wso2-docs check` (so pull requests show it), in `wso2-docs bundle`, and at intake on the unpacked bundle, reading files only, since intake cannot rely on a Content repo's own check. It is build-breaking, so the `quality-override` label never overrides it. [B04]
- **`<ThemedImage light dark alt>` is a catalogue component** (decided 2026-10-28 for Integrator's light and dark screenshots): pages show the image matching the reader's theme, and the Markdown twin shows the light one. `light` and `dark` are literal paths; relative ones are bundled at build, so a missing file fails the build. The theme's `sources={{…}}` form still works. [B19]
- **What content needs beyond this goes through an extension proposal**, which adds it to `standards/components.yaml` for every team; there are no per-repo exceptions. [B04]

## Lint

- **Lint is curated and runs on changed lines only.** Stock rule sets are far too noisy to block (129k alerts on one corpus). Rules are only ever added, never loosened. [F16] [F17]
- **Product-name rules (retired names outside "formerly …", wrong forms, wrong capitalisation) are error level but don't block until cutover** (`lint.blockingRules` is empty). Promoting a rule to blocking is announced in the Platform release notes at least two weeks ahead. [F18] [F31]
- **All checks, Vale styles, dictionaries and schemas ship from the Platform.** A repo may add words to its `words.txt` but can't turn rules off. [F17]
- **During the Pilot, migrated content must pass the blocking checks**, fixed in the converter; lint is report-only. At cutover the lint counts become the baseline and the changed-lines rule takes over. [F17]

## AI review

- **A non-blocking AI review (`pr-review.yml`, the "Check my changes" skill through the Claude Code GitHub Action) posts comments and suggested edits on Content repo pull requests.** It skips bot pull requests and never runs in a release build, because a release must give the same result every time. It is off until cutover (`DOCS_AI_REVIEW_ENABLED`). A weekly whole-Doc-space AI audit is not part of this effort. [F17] [F31]

[F09]: ../.scratch/wso2-doc-space/issues/09-shared-family-content.md
[F11]: ../.scratch/wso2-doc-space/issues/11-platform-build-pipeline.md
[F16]: ../.scratch/wso2-doc-space/issues/16-docs-quality-tooling.md
[F17]: ../.scratch/wso2-doc-space/issues/17-quality-gates.md
[F18]: ../.scratch/wso2-doc-space/issues/18-documentation-standards.md
[F20]: ../.scratch/wso2-doc-space/issues/20-api-reference-rendering.md
[F21]: ../.scratch/wso2-doc-space/issues/21-ai-llm-friendly-docs.md
[F24]: ../.scratch/wso2-doc-space/issues/24-scaffold-platform.md
[F28]: ../.scratch/wso2-doc-space/issues/28-api-reference-renderer.md
[F31]: ../.scratch/wso2-doc-space/issues/31-quality-checks-and-skills.md
[F32]: ../.scratch/wso2-doc-space/issues/32-llm-outputs.md
[N10]: ../.scratch/wso2-docs-navigation/issues/10-boilerplate.md
[N15]: ../.scratch/wso2-docs-navigation/issues/15-converter-and-repos.md
[N19]: ../.scratch/wso2-docs-navigation/issues/19-extensions.md
[N25]: ../.scratch/wso2-docs-navigation/issues/25-close-spec-code-gaps.md
[B04]: ../.scratch/wso2-docs-bundles/issues/04-executable-content-in-bundles.md
[B17]: ../.scratch/wso2-docs-bundles/issues/17-identity-server-on-the-proof.md
[B19]: ../.scratch/wso2-docs-bundles/issues/19-integrator-on-the-proof.md
