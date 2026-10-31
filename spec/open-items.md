# Open items and known conflicts

Last checked against code: 2026-10-29

What the spec has not decided, and where the code on `main` contradicts a decided rule. Each item is closed by a decision from the user (then the rule goes into its topic file) or by a code fix (then the item is deleted). Until then, the rule in the topic file stands.

## Undecided

| Item | Where it would go | Source |
|---|---|---|
| **Content governance at scale**: owner roles, CODEOWNERS teams, response-time targets, the end-of-life policy (when and who), branch freeze, freshness signals, a weekly AI audit, upstreaming OpenAPI description edits. Deferred by the user; draft proposals in the ticket. | editions-and-versions, repo-structure | [F23] |
| **Owners**: every Doc space, Docs section and the docs standards owner are "to be named"; CODEOWNERS team names are placeholders. | navigation, authoring-and-preview | [F18] [N06] [N14] |
| **Hosting values**: the Cloudflare account, zone and routes, staging host, search hosts, KV ids, the `wso2` GitHub repos and analytics access. Production search hosting (a 3-node cluster or Typesense Cloud). | edge-and-hosting, search | [F12] [F15] [N23] |
| **The deploy bundle** is an open ticket. | edge-and-hosting | [N22] |
| **Private Platform repo**: while the Platform is private, PR preview workflows check it out without a token, and reusable-workflow access must be allowed; npm adds no provenance to `@wso2/docs` from a private repo. | releases-and-deployments | [N23] [N25] |
| **Stopping preview**: ending only the `wso2-docs preview` process leaves Docusaurus running (Ctrl+C is fine). | authoring-and-preview | [N23] |
| **Nightly reports' search step** is a placeholder (the weekly workflow does the check), and **where reports and the weekly digest are posted** is not decided. | build-and-quality-checks, chrome-and-version-switching | [F25] [F31] [N23] |
| **AI crawlers in production `robots.txt`**: allowed unless WSO2 has a policy against training use, to confirm with the owners. | indexing-and-seo | [F21] |
| **`docs:` links resolve to production URLs on every host**: built and on the first map's Decisions line, but the amendment in the URL ticket still says "pending user confirmation". | urls-and-redirects | [F07] [F25] |
| **Questions for the owning teams**: whether API Control Plane and Security Token Service get docs; which repo builds the Developer Platform site; what Integrator's `wso2-agent-builder` branch is for; AI Gateway's seven same-name Cloud/Self-hosted pairs and two unpaired quick starts in the diff report. | product-placement | [N12] [N16] |
| **Agent ID as a Cloud part**: the walkthrough lists Agent ID as a Cloud part of Identity Platform Cloud, but a Cloud part is a Doc space's main line and Agent ID has no Doc space (the mapping has it as a page). | product-placement, navigation | [N06] [N12] |
| **R2 conditional writes**: the state lock needs `If-None-Match`/`If-Match` on PUT; only Miniflare's emulation is tested. The deploy bundle's runbook checks it on the first real run, before any release (decided 2026-10-27). | edge-and-hosting, releases-and-deployments | [N22] [N25] |
| **Human items**: writer sign-off on samples, the three-writer walkthrough, the GitHub steps of onboarding (repo, App, secrets, rulesets), the Platform release's version bump and tag, the npm trusted publisher for `@wso2/docs` and the `npm` environment, extension-proposal review. | authoring-and-preview, releases-and-deployments | [N23] [N24] [F34] |
| **Pilot-time actions**: agree with the `identity-platform-cloud` team that the Identity Platform Doc spaces supersede their build. | chrome-and-version-switching | [F29] |
| **Docs bundles and VM hosting** (map [Docs bundles and VM hosting](../.scratch/wso2-docs-bundles/map.md), charted 2026-10-27): decided; staging is on Cloudflare and search on the 141 VM, decided without the VM's facts, which `setup.sh check` verifies before any change (see below). | releases-and-deployments, edge-and-hosting, search, repo-structure | [B-map] |
| **Redirects on Cloudflare's free plan** (deferred by the user, 2026-10-28): Workers KV allows about 1,000 writes a day, and Identity Server alone needs 2,278 (4,629 entries in all); the redirect step sends them as one bulk call, which the free plan refuses whole. Options: Workers Paid, a write cap per run (`--max-writes`) catching up over days, or one KV value or R2 file per table. Until decided, a release's flip succeeds but its redirects, crawl gate, search step and GC do not run; search is repaired with the consistency check. | edge-and-hosting, releases-and-deployments | [B17] |
| **An Edition listed before its first release**: the version selectors, menu dropdowns, notices and search scopes link to it, and it 404s, so every crawl gate fails until it is released, in the order `add-a-version.mdx` and `init --cloud --self-hosted` give. Undeployed Doc spaces are hidden (`lib/release.mjs` `hideUnpublished`); undeployed Editions are not (`lib/switching.mjs`, `lib/search/scopes.mjs`). Options: hide them the same way, have the crawl gate warn on them, or change the process order. | chrome-and-version-switching, navigation, build-and-quality-checks | [N24] |
| **Unlisted Doc spaces in AI outputs**: the root `llms.txt` and MCP `list_editions` list them (`lib/llms.mjs` `rootLlmsTxt`, `worker/src/mcp.mjs` `editionsOf`), as "every Doc space" in ai-and-llm-outputs says; navigation keeps them out of every menu and section. | ai-and-llm-outputs, navigation | [N24] |
| **"Try it" for Cloud API pages** once sign-in exists; **operation-level Edition markers** in specs. Deferred. | extension-points | [F20] |

## Code that contradicts the spec

Each is a bug against the rule named, unless the user changes the rule.

| Rule | Code | Source |
|---|---|---|
| build-and-quality-checks: the Platform pull request's theme check blocks on every violation, and "the Sandbox has none". | With pa11y-ci 5.0.0 (axe 4.13, a current Chromium), the Sandbox Cloud home page at 375 px fails in light and dark: the next/previous link's label straddles the bottom of `<html>`, which Docusaurus sets to `height: 100%`, so axe can't tell its background ("needs review", `elmPartiallyObscuring`; the colour is 5.2:1), and pa11y reports needs-review results as errors (`levelCapWhenNeedsReview` defaults to `error`, as pa11y 6 did). `scripts/theme-axe.mjs` exits 1 on any theme pull request until the theme, the gate (`levelCapWhenNeedsReview: 'warning'`) or the Sandbox page changes. | user decision 2026-10-28 (theme without rebuilding) |
| releases-and-deployments: a merged manifest change that adds an Edition or moves `latest` rebuilds every deployed Edition of that Doc space. | Only `.github/workflows/manifests.yml` runs `policy-diff`, on Platform `main` or by hand; a Content repo merge triggers nothing. A version that stops feeding `latest` keeps its empty sitemap. Tied to the Edition item above, since `latest` moves when the version is listed. | [N24] |
| urls-and-redirects: the Confluence 301s are answered on the production host. | `worker/src/confluence.mjs` and `test/worker.test.mjs` answer them on every host. | [N24] |
| authoring-and-preview: a hot reload under 2 seconds. | The first edit after a preview starts takes 5.7 s (Identity Server, `--only get-started`); later edits 0.8 s. | [N24] |
| chrome-and-version-switching: the theme meets WCAG 2.2 AA. | At phone width, tables from an OpenAPI spec's descriptions are not keyboard-focusable (axe `scrollable-region-focusable`, 20 nodes on one API page); Markdown tables likely the same. | [N24] |
| [Staging on Cloudflare and VM search](edge-and-hosting.md#vm-search): the Pilot's staging is `wso2-docs-site.tharinduj.workers.dev` with search on the 141 VM | Built, applied and proven on the forks (2026-10-28). `release.yml` and `manifests.yml` on `map/docs-bundles` still name the interim `s3://docs-staging` and `docs-staging.wso2.com`; the proof repo sets the Pilot's values. Moving them to `wso2/docs-platform` is the cutover. | [B06] |
| "Release docs" releases the version an owner names, one run per version | The Content repo template's `docs.yml` tag job shares one concurrency group per repo (`cancel-in-progress: false`); GitHub keeps one pending run per group, so of several dispatches started together all but the latest pending one are cancelled (API Gateway 1.2.0, 2026-10-29). Re-running alone works. | [B20] |

[Close the spec's code gaps][N25] fixed every earlier row and built the six items the user decided on 2026-10-27. The 301 from an unmapped old page moved to the porting and cutover effort. [Platform and process acceptance][N24] added the rows above.

[F07]: ../.scratch/wso2-doc-space/issues/07-url-scheme-and-redirects.md
[F08]: ../.scratch/wso2-doc-space/issues/08-content-repo-contract.md
[F09]: ../.scratch/wso2-doc-space/issues/09-shared-family-content.md
[F12]: ../.scratch/wso2-doc-space/issues/12-search-decision.md
[F13]: ../.scratch/wso2-doc-space/issues/13-theme-decision.md
[F15]: ../.scratch/wso2-doc-space/issues/15-confirm-hosting-facts.md
[F18]: ../.scratch/wso2-doc-space/issues/18-documentation-standards.md
[F20]: ../.scratch/wso2-doc-space/issues/20-api-reference-rendering.md
[F21]: ../.scratch/wso2-doc-space/issues/21-ai-llm-friendly-docs.md
[F23]: ../.scratch/wso2-doc-space/issues/23-content-governance.md
[F25]: ../.scratch/wso2-doc-space/issues/25-edge-and-staging-pipeline.md
[F29]: ../.scratch/wso2-doc-space/issues/29-chrome-landing-switchers.md
[F31]: ../.scratch/wso2-doc-space/issues/31-quality-checks-and-skills.md
[F34]: ../.scratch/wso2-doc-space/issues/34-writer-experience.md
[N04]: ../.scratch/wso2-docs-navigation/issues/04-version-switching-two-selectors.md
[N06]: ../.scratch/wso2-docs-navigation/issues/06-product-mapping.md
[N12]: ../.scratch/wso2-docs-navigation/issues/12-platform-walkthroughs.md
[N14]: ../.scratch/wso2-docs-navigation/issues/14-manifests-and-compose.md
[N16]: ../.scratch/wso2-docs-navigation/issues/16-api-platform-conversion.md
[N22]: ../.scratch/wso2-docs-navigation/issues/22-cloudflare-deploy-bundle.md
[N23]: ../.scratch/wso2-docs-navigation/issues/23-platform-team-guide.md
[N24]: ../.scratch/wso2-docs-navigation/issues/24-platform-process-acceptance.md
[N25]: ../.scratch/wso2-docs-navigation/issues/25-close-spec-code-gaps.md
[B-map]: ../.scratch/wso2-docs-bundles/map.md
[B03]: ../.scratch/wso2-docs-bundles/issues/03-reusable-bundle-workflow-spec.md
[B06]: ../.scratch/wso2-docs-bundles/issues/06-vm-hosting-spec.md
[B17]: ../.scratch/wso2-docs-bundles/issues/17-identity-server-on-the-proof.md
[B19]: ../.scratch/wso2-docs-bundles/issues/19-integrator-on-the-proof.md
[B20]: ../.scratch/wso2-docs-bundles/issues/20-api-gateway-on-the-proof.md
