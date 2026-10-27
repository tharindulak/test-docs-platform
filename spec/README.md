# WSO2 Docs spec

Last checked against code: 2026-10-26

The normative spec for WSO2 Docs and the Platform that builds it. Each rule is written as it holds now, with a short reason and the ticket or tickets it came from.

## Authority

- **The spec is the authority.** The wayfinder tickets under `.scratch/` are history: they record how a rule was reached, not what holds now. Where a ticket and the spec differ, the spec wins.
- **Code that contradicts the spec is a bug**, unless the same change updates the spec. A change of behaviour or decision updates the spec file in the same commit.
- **A conflict is reported, never resolved silently.** Known conflicts and undecided items are in [Open items and known conflicts](open-items.md). A rule stays a rule while the code behind it is missing; the gap is listed there.
- **Words come from [`GLOSSARY.md`](../GLOSSARY.md).** A term the glossary doesn't define is not used as a domain term.

## Files

| File | What it decides |
|---|---|
| [navigation.md](navigation.md) | The products menu, Docs sections, Doc spaces, family Clouds and Cloud parts, borrowing, Unlisted and `indexed` |
| [editions-and-versions.md](editions-and-versions.md) | Cloud and Self-hosted Editions, `latest`, labels and order, Legacy versions, end of life, pins, Edition markers and variables |
| [urls-and-redirects.md](urls-and-redirects.md) | The address of every page, slugs, short-address redirects, `docs:` links, page moves and legacy redirects |
| [indexing-and-seo.md](indexing-and-seo.md) | Canonicals, titles, sitemaps, `noindex` and `robots.txt` |
| [manifests-and-compose.md](manifests-and-compose.md) | The three team manifests, the compose step, its checks and the published Deployment manifest |
| [repo-structure.md](repo-structure.md) | The Platform repo, Content repo layout, branches, tags, backports and converted repos |
| [releases-and-deployments.md](releases-and-deployments.md) | Docs releases, the release pipeline, storage and pointers, rollbacks, rebuilds and Platform releases |
| [chrome-and-version-switching.md](chrome-and-version-switching.md) | The Platform chrome, both version selectors, switching, notices, theme, page furniture, analytics and the Landing page |
| [search.md](search.md) | The search engine, records, indexing, Search scopes and keys |
| [extension-points.md](extension-points.md) | Components, Page layouts (overview, catalog, API reference), notices, link entries, generated content and proposals |
| [build-and-quality-checks.md](build-and-quality-checks.md) | The build, the checks and where each runs, overrides, lint and AI review |
| [edge-and-hosting.md](edge-and-hosting.md) | The Edge Worker, storage, environments, caching and the hosting target |
| [authoring-and-preview.md](authoring-and-preview.md) | The writer's two paths, preview, `init` and `new`, author skills, the Sandbox, documentation standards and Contribute |
| [ai-and-llm-outputs.md](ai-and-llm-outputs.md) | Markdown twins, `llms.txt`, the "Copy page" menu and the MCP server |
| [product-placement.md](product-placement.md) | Where every wso2.com product goes: group, Docs section, Doc spaces, Editions, repos |
| [open-items.md](open-items.md) | What is undecided, and where the code contradicts the spec |

The split follows the requested topics, with three changes: indexing and SEO has its own file because canonicals, sitemaps and `noindex` are one set of rules that the address rules only feed; AI and LLM outputs have their own file because they belong to no other topic; and open items are gathered in one file so each has a single place to be closed.

## Sources

Rules cite tickets by map and number:

- **F**: the first map, [WSO2 Docs on Docusaurus][F-map] (`.scratch/wso2-doc-space/`).
- **N**: the navigation map, [WSO2 Docs navigation, Doc spaces and team configuration][N-map] (`.scratch/wso2-docs-navigation/`). It supersedes parts of the first map; its Notes list which.

A later decision overrides an earlier one. Where a superseded rule is one a reader would expect, the file says so in one line.

The developer guide (`standards/contribute/docs/get-started/product-teams.mdx`) and the Platform team guide (`standards/contribute/docs/get-started/platform-team.mdx`) explain these rules to people and give the steps. Where a guide and the spec differ, the spec wins and the guide is fixed.

## Changing the spec

- Change the rule where it lives; keep each meaning in one file and link to it from others.
- Cite the ticket or decision behind the change. When a wayfinder ticket resolves, the spec changes in the same commit as the ticket's Answer and the map's Decisions line.
- Set the file's "Last checked against code" date when you check its rules against the code.
- A new file goes into the table above. `test/spec.test.mjs` fails when a `spec/*.md` file is missing from it, a relative link doesn't resolve, or a file lacks its "Last checked against code" line.

[F-map]: ../.scratch/wso2-doc-space/map.md
[N-map]: ../.scratch/wso2-docs-navigation/map.md
