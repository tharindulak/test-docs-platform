# Search

Last checked against code: 2026-10-27

On-site search across independently deployed Docs deployments: the engine, the records, indexing and Search scopes.

## Engine and hosting

- **The search engine is Typesense**; Algolia DocSearch v5 is the documented fallback (better out of the box, but its free-program eligibility is unclear and it adds a vendor). Build-time local search plugins are ruled out: they search only their own build. [F04] [F12]
- **The Pilot and local previews use one self-hosted Typesense container**, started through Docker Compose. Production hosting (a 3-node self-hosted cluster or Typesense Cloud) is decided with infra. [F12] [F30]
- **Staging and production have separate collections**, chosen by hostname so the same bytes work in both. [F12] [F30]

## Search box

- **The Platform owns its search component**, built on `react-instantsearch` and `typesense-instantsearch-adapter`. One component serves the header box, the Landing hero and the full results page (`/search/` on the Landing deployment). The stock Typesense Docusaurus theme is not used: it has no filters, no result rewriting and no runtime parameters without an unsafe swizzle. [F12] [F13] [F30]
- **The pop-up opens from the header box or Ctrl/⌘K**, with the scope switch at the top, Doc space and Edition filter chips, and an Edition badge on each result. Product family chips appear only in All of WSO2 Docs off a Doc space (the Landing page). "See all results" carries the scope, section and the reader's Edition to `/search/`. [F12] [F13] [N20]
- **There are no AI answers in search** (see [ai-and-llm-outputs.md](ai-and-llm-outputs.md)). [F21]

## Records and indexing

- **The pipeline builds each Docs deployment's records from its built pages**, so Edition markers are already applied. Records use the DocSearch shape (hierarchy levels, `url`, `content`) tagged with Doc space, Edition, Cloud or Self-hosted, Product family, and, for Cloud parts, `cloudIn`. Typesense's crawler is not used, because it replaces the whole collection. [F12] [F24] [N20]
- **Never indexed**: `/latest/` pages (only pinned Edition addresses are), Legacy versions, Doc spaces not on WSO2 Docs yet, chrome content, and catalog controls. [F12] [F29] [F30] [N20]
- **A Cloud part's pages are records of the component's Cloud** (`docSpace` the component, `edition: cloud`, `cloudIn` the platform, `lvl0` "<Component> Cloud"), at their real tree address. A family Cloud's own pages stay the family's. [N20]
- **Each catalog item is its own record** at `#catalog-<id>`, and leaves its section's record. [N20]
- **On release, a deployment upserts its new records, then deletes its stale ones**, per group (the family, then each part), never another deployment's, and never after a failed or empty import. Deleting first would leave a gap. [F12] [F30] [N20]
- **A weekly consistency check compares the index with every live deployment's page list**, per group, and the records' former names with the manifest's; `--fix` repairs drift. [F12] [N20]
- **A failed index update retries and alerts; it never blocks a release.** [F17] [F30]
- **`search-setup` brings a collection up to the schema**: it makes the collection, adds the fields a newer schema gained, and drops and re-adds a field whose type or facet changed, which Typesense rebuilds from the stored records with no re-indexing. Writes to the collection wait while it rebuilds. When the rebuild outlasts the request, the step follows it through Typesense's schema-change status for up to ten minutes, then checks the schema. `page` is a facet, so the MCP server's `search_docs` can group hits by page. The same step makes the analytics rules and the question stop-word set (how, do, I, what, the, …) that `search_docs` drops from its queries; the search box uses neither.
- **Only `search-setup` changes a collection's schema.** `search-index` makes a missing collection but leaves an existing one as it is, and warns when it lacks part of the schema; two indexing runs never change a schema at once.
- **Typesense analytics (popular queries, queries with no hits) are on, tagged per deployment.** The MCP server's searches are left out, so an agent's queries are never recorded. [F12]

## Search scopes

| Scope | Covers |
|---|---|
| This Docs section (one click away on any page in a section) | Every Doc space the section's menu lists: the Doc space being read at the Edition being read (in a Cloud part: the component's Cloud), each other one where its selector opens (Cloud first, else its newest release). A remembered Edition doesn't change it. |
| All of WSO2 Docs (one click away; the only scope on the Landing page) | It only widens: the section's Doc spaces at the same Editions, plus one Edition of every other searchable Doc space, the remembered one, else where its selector opens |
| This Edition (the default on any Doc space page) | What the Edition being read shows: in Cloud, its Self-hosted additions too, badged "Self-hosted"; in a version, never Cloud-only content. On a family Cloud page, the family's own pages only |
| All Editions | Every live Edition of the Doc space being read, Cloud first and newer ranked higher; not offered with one Edition |

[F12] [N20]

- **Search follows the selected version.** The search box opens on This Edition; This Docs section and All of WSO2 Docs are one click away, and the Landing page searches All of WSO2 Docs. [B08]
- **The section is the one the menu shows**: the section the reader came through, else the home section, read from the live manifest, so a menu change changes the scope with no rebuild. [N20]
- **End-of-life Editions appear only under This Edition.** [F12] [N20]
- **Cross-product scopes show one Edition per Doc space**, so the same page doesn't appear once per Edition. [F12] [N20]
- **An Unlisted Doc space is searched only from inside itself** (This Edition, All Editions) and is in no other scope. A Doc space with `indexed: true` is also in All of WSO2 Docs. [N20]
- **Former names stay searchable** (Asgardeo, Bijira, Choreo, Devant). Each record carries its Doc space's `formerNames` from the manifest, and a Cloud part's records also carry their platform's (Asgardeo was the whole Identity Platform Cloud tree). Queries match them as a low-weight field, across fields, so "Asgardeo MFA" finds Identity Platform Cloud's MFA pages in every scope that covers them. A change of `formerNames` reaches the index at the Doc space's next indexing; until then the weekly consistency check reports it as drift and `--fix` repairs it. [N12] [N25]

## Hits and labels

- **A hit from the newest release opens under `/latest/`**, except for a reader on its pinned twin, who stays on pinned addresses. Cloud and Cloud part hits never move to `/latest/`. When `latest` moves, only the manifest changes. [F12] [F30] [N20]
- **Hits on another Docs deployment open with full-page navigation**, so the current base path is never prefixed. [F04] [F12]
- **Badges use the chrome's labels**: "Cloud" or "Cloud (<brand>)", "<version> (newest release)", "<version> (latest)" in All Editions; the Edition's full name in wider scopes. [N20]

## Keys

- **The Typesense admin key lives only where Typesense runs**: on the 141 VM for the Pilot's staging, made there and never copied off; indexing, the consistency check and the browser key go through the VM's gate ([edge-and-hosting.md](edge-and-hosting.md#vm-search)). CI holds only the gate's two deploy keys. Browsers get a scoped, search-only key baked into the build; the Edge Worker has its own search key as a secret, scoped from the same parent with an expiry and never the browser key, so either can change alone. A scoped key cannot be revoked by itself, only with its parent, which stops both. [F11] [F30] [N23]
- **`search-setup` makes a collection's search-only parent key once and reuses it on every later run** (the newest such key), so a run after a Platform release makes no new key. Its value is printed only when it is made; `--new-key` makes another for a key change. `search-keys` lists every key by id and value prefix, never its full value, and `search-key-delete` deletes one; browser keys scoped from a deleted parent stop working. [N23] [N25]

## MCP

- **The MCP server's `search_docs` follows the same rules** (Cloud parts as the component's Cloud, Unlisted left out unless indexed, one Edition per Doc space where its selector opens). [N20]
- **It has two scopes the search box doesn't**: Edition `cloud` with no Doc space covers the Cloud of every searchable Doc space, Cloud parts included; and a family Cloud's Cloud covers its Cloud parts, except an Unlisted one. Any other Edition needs a Doc space. A Doc space with no Edition ranks as All Editions does in the search box: newer Editions first.
- **It ranks for an agent's queries**: the search box's fields and weights, scored by the best matching field (`max_weight`), with the question stop-word set dropped from the query and hits grouped by page (per Doc space and Edition, three hits each), so a page appears once. A query made only of question words keeps them. Self-hosted additions in Cloud's records are left out unless the agent asks for them. The search box's ranking doesn't change.
- **The stop-word set holds no word that is also a name**: Typesense drops its words in any case, so "is" (IS, Identity Server), "it", "in" and "on" (single sign-on) stay out.
- **On a collection that `search-setup` hasn't brought up to the schema**, `search_docs` searches again without what it lacks: with no stop-word set or `page` not a facet, without the stop words and the grouping, asking for 20 hits for each page it should return (at most 250) and grouping them by page itself, so a page with many hits can leave it with fewer pages than asked for; with no `selfHosted` field, without that filter. The new ranking still waits for `search-setup` ([releases-and-deployments.md](releases-and-deployments.md#platform-releases)).

[F04]: ../.scratch/wso2-doc-space/issues/04-search-options.md
[F11]: ../.scratch/wso2-doc-space/issues/11-platform-build-pipeline.md
[F12]: ../.scratch/wso2-doc-space/issues/12-search-decision.md
[F13]: ../.scratch/wso2-doc-space/issues/13-theme-decision.md
[F17]: ../.scratch/wso2-doc-space/issues/17-quality-gates.md
[F21]: ../.scratch/wso2-doc-space/issues/21-ai-llm-friendly-docs.md
[F24]: ../.scratch/wso2-doc-space/issues/24-scaffold-platform.md
[F29]: ../.scratch/wso2-doc-space/issues/29-chrome-landing-switchers.md
[F30]: ../.scratch/wso2-doc-space/issues/30-search-pilot.md
[N12]: ../.scratch/wso2-docs-navigation/issues/12-platform-walkthroughs.md
[N20]: ../.scratch/wso2-docs-navigation/issues/20-search-for-new-navigation.md
[N23]: ../.scratch/wso2-docs-navigation/issues/23-platform-team-guide.md
[N25]: ../.scratch/wso2-docs-navigation/issues/25-close-spec-code-gaps.md
[B08]: ../.scratch/wso2-docs-bundles/issues/08-cloud-edition-content.md
[B06]: ../.scratch/wso2-docs-bundles/issues/06-vm-hosting-spec.md
