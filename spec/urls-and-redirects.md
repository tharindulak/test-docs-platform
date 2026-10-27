# URLs and redirects

Last checked against code: 2026-10-27

Every page has one address. This file covers addresses, slugs, short-address redirects, links between Doc spaces, page moves and legacy redirects. Canonicals, sitemaps and `noindex` are in [indexing-and-seo.md](indexing-and-seo.md).

## Addresses

- **WSO2 Docs lives at `https://docs.wso2.com/`, with the Landing deployment at `/`.** A dedicated host needs no carve-out from wso2.com; `wso2.com/documentation` 301s there at cutover. [F07]
- **A page's address is `docs.wso2.com/<doc-space>/<edition>/<page>/`.** The Docs section and the family never appear in it, so a page has one address wherever it is listed: AI Gateway 1.2.0 is `/ai-gateway/1.2.0/…` under API Platform and under Agent Platform. [N05]

  | Page | Address |
  |---|---|
  | Self-hosted | `/<doc-space>/<version>/<page>/` |
  | Newest release (moves with each release) | `/<doc-space>/latest/<page>/` |
  | Cloud | `/<doc-space>/cloud/<page>/` |
  | Cloud part | `/<platform>/cloud/<part>/<page>/` |
  | Unversioned Doc space (Contribute, Updates, Platform Security) | `/<doc-space>/<page>/` |
- **The Edition segment is `cloud` or the exact version**, and is present even in a Cloud-only Doc space. [F07]
- **A component's own Doc space has no `/cloud/` address**: its Cloud is its part of the platform's tree. [N05]
- **Page paths come from the Content repo file path**: lower-case kebab case, `routeBasePath: '/'`, no `.html`. `trailingSlash: true` Platform-wide. A front-matter `slug` is discouraged. [F07]
- **Staging uses the same path layout on its own host**, so a build is tested at the exact `baseUrl` it ships with. [F07]

## Slugs

- **A Doc space slug is the full current product name in kebab case** (`identity-server`, `api-manager`, `ai-gateway`); a family Cloud's slug is the family's name. [F07] [N12]
- **Slugs may change freely until the Doc space is public.** No Pilot address has been published, so none needs a redirect. Once public, a slug is permanent and a rename becomes a redirect. [N05]

## Short-address redirects (edge)

| From | To | Status |
|---|---|---|
| A slashless page path | The same path with `/` | 301 |
| `/<doc-space>/` | Where the version selector opens: deployed Cloud, else the Cloud part in its platform's tree once that tree is deployed, else `/latest/` | 302 |
| `/<part>/cloud/<page>/` | `/<platform>/cloud/<part>/<page>/` | 302 |
| `/<cloud-only doc-space>/latest/<page>/` | `/<cloud-only doc-space>/cloud/<page>/` | 302 |
| `/<doc-space>/<legacy version>/…`, with no Docs deployment | That Legacy version's `legacyUrl` (its home on the old site), without the query | 302 |

Bare addresses are 302, never 301: a 301 would be cached indefinitely and block a landing page at `/<doc-space>/` later. Ranking is unaffected because only real pages are in sitemaps. [F07] [F19] [N05] [N17]

- **A retired version's WSO2 Docs addresses 302 to its `legacyUrl`.** Once a version moves to `legacyVersions` and `wso2-release retire` takes its Docs deployment down, the Edge Worker answers every address under `/<doc-space>/<version>/` with a 302 to that Legacy version's `legacyUrl`, rather than a 404; a Legacy version that was never on WSO2 Docs gets the same. It is a 302 because the version may come back to WSO2 Docs, and it is decided from the manifest, not the redirect table, because a retired deployment's redirects leave the table with it. While the deployment is still up, it serves; a page-level map to the old site is the porting effort's. [N23] [N25]

## Links between Doc spaces

- **Links within one Docs deployment are relative Markdown file links**, checked by the build. [F07]
- **Links to another Doc space are written `docs:<doc-space>/<edition|latest|cloud>/<page>`.** Hard-coded `https://docs.wso2.com/` links and `pathname://` are not used. [F07]
- **`docs:` links resolve to production URLs on every host**, so staging carries the same bytes as production; the staging crawl gate maps them onto staging. This replaced "resolve to the build's host". [F25] [F07]
- **`docs:<part>/cloud/<page>` resolves to the part's address in its platform's tree; `docs:<cloud-only>/latest/` resolves to `/cloud/`.** [N05] [N17]
- **`docs:` links render as same-tab full page loads** and are checked against the Deployment manifest and the target's published route list. A link to an unknown Doc space or Edition, or to a Legacy version, fails. [F07] [F17] [F24]

## Page moves

- **An author who moves or removes a page adds a `moves:` entry to the Doc space's `redirects.yaml` in the same pull request.** The redirect coverage check blocks a change that lacks one. [F07] [F17]
- **The main line carries the same redirects as the releases cut from it**, so version switching can follow a renamed page either way. [N04]
- **Every deployment's redirects compile into one table in Workers KV.** The table is read only when a page is missing, so a redirect never hides a live page. Page moves are 301s. [F11] [F25]

## Legacy redirects

- **Legacy URLs redirect page by page with 301s**, from old → new maps that the migration generates per Edition and keeps in the Content repo's `redirects.yaml`, never in edge code. Old MkDocs redirects are flattened in, so the oldest URLs arrive in one hop. [F07] [F14]
- **Legacy `/en/latest/…` maps to `/<doc-space>/latest/…`; pinned legacy versions map to their pinned new version; Asgardeo and `wso2.com/identity-platform/docs` URLs map to Cloud.** [F07] [F19] [N13]
- **A Cloud part's legacy maps compile under `/<platform>/cloud/<part>/`.** [N17]
- **An unmapped old page under a migrated Edition 301s to that Edition's home page.** Built by the porting and cutover effort, not by the Platform map (decided 2026-10-27). [F07] [N25]
- **Today's `wso2.com/<family>/docs/…` sites get page-by-page 301 maps to the new addresses**, generated by the migration and applied at cutover, which needs infra. [N05]
- **Turning legacy redirects on, and keeping them permanently, is part of production cutover**, which is out of scope. The scheme and the generated maps are in scope; unmigrated versions stay on their legacy host. [F07] [F19]
- **Old Confluence paths keep today's 301s, answered by the Edge Worker on the production host**: `/display/<SPACE>/…` to the Atlassian archive (or `/wiki/spaces` without a space), `/pages/viewpage.action?…` to `https://wso2.com/documentation` with the query kept, `/download/attachments/…` to `https://wso2.com/documentation`. The targets live in one place, `worker/src/confluence.mjs`. The crawl gate treats these paths as external, and content links to them are left as they are. [F35] [N13]

[F07]: ../.scratch/wso2-doc-space/issues/07-url-scheme-and-redirects.md
[F11]: ../.scratch/wso2-doc-space/issues/11-platform-build-pipeline.md
[F14]: ../.scratch/wso2-doc-space/issues/14-migration-approach.md
[F17]: ../.scratch/wso2-doc-space/issues/17-quality-gates.md
[F19]: ../.scratch/wso2-doc-space/issues/19-seo-and-canonical-strategy.md
[F24]: ../.scratch/wso2-doc-space/issues/24-scaffold-platform.md
[F25]: ../.scratch/wso2-doc-space/issues/25-edge-and-staging-pipeline.md
[F35]: ../.scratch/wso2-doc-space/issues/35-legacy-confluence-paths.md
[N04]: ../.scratch/wso2-docs-navigation/issues/04-version-switching-two-selectors.md
[N05]: ../.scratch/wso2-docs-navigation/issues/05-urls-and-latest.md
[N12]: ../.scratch/wso2-docs-navigation/issues/12-platform-walkthroughs.md
[N13]: ../.scratch/wso2-docs-navigation/issues/13-salvage-stopped-work.md
[N17]: ../.scratch/wso2-docs-navigation/issues/17-release-pipeline.md
[N23]: ../.scratch/wso2-docs-navigation/issues/23-platform-team-guide.md
[N25]: ../.scratch/wso2-docs-navigation/issues/25-close-spec-code-gaps.md
