# Indexing and SEO

Last checked against code: 2026-10-27

What search engines and AI crawlers see: canonicals, titles, sitemaps, `noindex` and `robots.txt`. On-site search is in [search.md](search.md).

## Two indexable lines

- **Each Doc space with Cloud and versions has two indexable lines: Cloud at `/cloud/` and the newest release at `/latest/`.** A reader lands on the newest relevant page from a search engine and switches version from there. [F19] [N05]

## Canonicals

Computed at build time from the `latest` Edition's published page list and redirect map, so a new release needs no rebuild of older versions. The page keeps the canonical and `og:url` it was served with once it runs in the browser. [F19] [F11]

| Page in | Canonical |
|---|---|
| `/latest/` | itself |
| `/cloud/`, and every Cloud part page | itself |
| The pinned twin of `latest` (such as `/7.3.0/` while 7.3.0 feeds `latest`) | the same page under `/latest/` |
| An older version, where the page still exists in `latest` (following a page move) | the equivalent `/latest/` page |
| An older version, where the page is not in `latest` | itself |

- **Supported versions never get `noindex`.** Combined with a canonical, it sends mixed signals. [F19]
- **Staging builds emit production canonicals and sitemap URLs**, so staging checks exactly what production ships. [F19] [F11]

## Titles and meta

- **`<title>` is `<Page title> | <Edition name> | WSO2 Docs`**, such as "Configure MFA | Identity Server 7.3.0 | WSO2 Docs". On `/latest/` the Edition name is the version with no label, so titles don't change when a build moves to `/latest/`. A Cloud part's pages name the component's Cloud: "Guardrails | AI Gateway Cloud | WSO2 Docs". [F19] [N05] [N17]
- **The meta description and Open Graph tags come from the front-matter `description`.** Docusaurus's breadcrumb structured data stays on. [F19]

## Sitemaps

- **Each Docs deployment's `sitemap.xml` lists only its pages that are their own canonical**: `/latest/` and `/cloud/` list all their pages, the pinned twin of `latest` lists none, older versions list only pages unique to them. [F19]
- **The Platform publishes a sitemap index at `docs.wso2.com/sitemap.xml`, generated from the manifest.** It includes the Landing deployment (`sitemap-landing.xml`) and leaves out end-of-life Editions, Unlisted Doc spaces (except `indexed: true`) and deployments the manifest dropped. [F19] [N13] [N17] [N18] [N23]

## `noindex`

The edge sets `X-Robots-Tag`, driven by the manifest, so no rebuild is needed. [F19] [F11]

| What | Header |
|---|---|
| The whole staging host, PR previews included | `noindex` |
| An end-of-life Edition | `noindex, follow` |
| An Unlisted Doc space (not `indexed: true`) | `noindex` |
| Markdown twins, `llms.txt` and `llms-full.txt` in production | `noindex` |

[F19] [F32] [N17] [N18]

## `robots.txt`

- **The Edge Worker serves `robots.txt` for the whole host.** Staging disallows every crawler. Production allows AI crawlers (GPTBot, ClaudeBot, Google-Extended, …), switchable with the `AI_CRAWLERS` variable and no rebuild, unless WSO2 has a policy against training use (still to confirm with the owners: see [open-items.md](open-items.md#undecided)). The first map had `robots.txt` on the Landing deployment; serving it from the Worker covers the whole host. [F21] [F32]

## At cutover (out of scope, recorded)

Set up docs.wso2.com in Search Console, submit the sitemap index, file a Change of Address for each legacy host once all its migrated versions have moved, keep the legacy 301s permanently (reviewed at most yearly), and watch indexed-page counts, 404s and redirect hit rates for 90 days. [F19]

[F11]: ../.scratch/wso2-doc-space/issues/11-platform-build-pipeline.md
[F19]: ../.scratch/wso2-doc-space/issues/19-seo-and-canonical-strategy.md
[F21]: ../.scratch/wso2-doc-space/issues/21-ai-llm-friendly-docs.md
[F32]: ../.scratch/wso2-doc-space/issues/32-llm-outputs.md
[N05]: ../.scratch/wso2-docs-navigation/issues/05-urls-and-latest.md
[N13]: ../.scratch/wso2-docs-navigation/issues/13-salvage-stopped-work.md
[N17]: ../.scratch/wso2-docs-navigation/issues/17-release-pipeline.md
[N18]: ../.scratch/wso2-docs-navigation/issues/18-chrome-navigation.md
[N23]: ../.scratch/wso2-docs-navigation/issues/23-platform-team-guide.md
