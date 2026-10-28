# Edge and hosting

Last checked against code: 2026-10-27

What serves WSO2 Docs: the hosting target, the Edge Worker, storage, environments and caching.

## Hosting target

- **WSO2 Docs is built to be hosted on Cloudflare: one Worker over R2 storage**, with Workers KV for redirects and Workers Analytics Engine for feedback and 404 counts. Azure Blob with the same layout is the fallback. Cloudflare already fronts every WSO2 docs host. [F05] [F11] [F15]
- **Staging for the Pilot is served by this repo's Edge Worker over R2 on the user's Cloudflare account**, at `wso2-docs-site.tharinduj.workers.dev`, replacing wso2-docs-site there; its bucket is emptied only right before docs-platform's first deploy. Typesense runs on the 141 VM. See [VM search](#vm-search). [B06]
- **Hosting itself is out of scope**: the account, zone, routes, staging host, search host, `wso2` GitHub repos and analytics access are settled later. Until then hosting values are placeholders in the code and the guide, and nothing is deployed. [F15] [N-map] [N23]
- **The Pilot is delivered as an upload-ready bundle** with a dry-run deploy that never runs here (ticket [N22], open). [F15] [N22]

## Environments

| Environment | Host | Bucket | Notes |
|---|---|---|---|
| Staging | `wso2-docs-site.tharinduj.workers.dev` for the Pilot (interim `docs-staging.wso2.com` in the code) | `docs-staging` | `noindex` everywhere, `robots.txt` disallows all, MCP on, no analytics |
| Production | `docs.wso2.com` | `docs-prod` | Off for the Pilot (`DOCS_PRODUCTION_ENABLED`) |
| PR previews | on staging, `/_preview/<doc-space>/pr-<n>/<edition>/` | `docs-previews` | `noindex` |

[F11] [F15] [F19] [F25] [F32]

## The Edge Worker

- **The Edge Worker, deployed from the Platform repo, is the only edge configuration.** [F11]

| Concern | Behaviour |
|---|---|
| Routing | Path → release folder, from the merged manifest and deployment state |
| Short addresses | The 301 and 302 rules in [urls-and-redirects.md](urls-and-redirects.md#short-address-redirects-edge), including a retired version's 302 to its `legacyUrl` |
| Redirects | The compiled KV table, read only when a page is missing |
| Old Confluence paths | Today's 301s ([urls-and-redirects.md](urls-and-redirects.md#legacy-redirects)) |
| `X-Robots-Tag` | The rules in [indexing-and-seo.md](indexing-and-seo.md#noindex) |
| Runtime files | `manifest.json`, `chrome.json`, the sitemap index, the root `llms.txt`, `robots.txt` |
| Markdown twins | `<page>.md` |
| 404 | One per Doc space, counted in Analytics Engine |
| Feedback | `POST /api/feedback`, same-origin only, counted cookie-free |
| MCP | The read-only server at `/mcp` |

[F11] [F22] [F25] [F32] [F35] [N17]

## VM search

The 141 VM runs only search for staging; pages, redirects and state stay on Cloudflare. [B06]

| Concern | On the VM |
|---|---|
| Account and folders | User `docs-platform` (no sudo, `/bin/sh`, password locked); settings `/etc/docs-platform/`; uploads in `/srv/docs-platform/search/incoming/`; nothing of wso2-docs-site's touched (`/srv/docs`, user `deploy`, port 8108, its Caddy site blocks) |
| Search | Typesense in compose project `docs-platform-typesense` on `127.0.0.1:8109` (pinned multi-arch image, 4 GB limit); its admin key and search-only parent key made on the VM in `/etc/docs-platform/typesense.env` (root:docs-platform 640), never printed or copied off |
| Public search endpoints | One Caddy snippet, `/etc/caddy/docs-platform.caddy`, imported once from the Caddyfile: `https://141-148-145-173.sslip.io/_typesense/` proxies only `GET /collections/<c>/documents/search`, `POST /multi_search` and `GET /health`, with CORS for the staging origin; everything else answers 404. The browser's staging search URL and the Worker's `TYPESENSE_HOST` are this address |
| Keys | In a root-owned `/etc/ssh/authorized_keys/docs-platform` with an sshd `Match User` block: an upload key (`rrsync -wo -no-del`, into the incoming folder only) and a gate key (forced command `docs-platform-gate`). Private halves in the `staging` environment: `DOCS_SEARCH_UPLOAD_KEY`, `DOCS_SEARCH_GATE_KEY`, with `DOCS_SEARCH_HOST` and `DOCS_SEARCH_KNOWN_HOSTS` |
| Indexing | A job that runs no content code exports each new deployment's search files (`wso2-release search-export`: the state, the composed manifest, `edition.json`, `search-records.json`, `pages.json`, laid out as the bucket), uploads them, and runs the gate. The gate allows only `search-index <deployment...>`, `search-check [--fix]`, `search-key [--expires <date>]` and `status`, whole-string, one at a time under `flock`, and runs the Platform's own search commands against the uploaded files. `search-key` prints only the scoped key |
| Platform code | A Platform release under `/opt/docs-platform/<tag>` with `current` pointing at it, root-owned, and Node 22 from the official tarball, checksum-pinned; installed by `setup.sh apply --platform-ref <tag> --platform-repo <owner/name>` |
| Setup | `hosting/vm/setup.sh apply|check`, idempotent; `check` verifies the VM (Ubuntu 22.04+, arm64 or amd64, 4 GB memory free for Typesense, port 8109 free, Docker, Caddy, rrsync, root login off) before `apply` changes anything, then reports drift. `apply` backs up the Caddyfile and runs `caddy validate` before reloading |

[B06]

## Caching

| What | Cache |
|---|---|
| Pages and other files | `HTML_MAX_AGE`: 60 s on staging, 300 s on production |
| Content-hashed assets | A year |
| Runtime files (`manifest.json`, `chrome.json`, sitemap, `llms.txt`) | 60 s in browsers; the Worker's own manifest copy 30 s |
| Redirects | KV reads 60 s; a 301 in browsers an hour |

[F11] [N23]

## Running it locally

- **The local edge (`npm run edge:local`) runs the Worker in Miniflare with its own port and data folder**, with local R2 and KV and a local KV endpoint for `wso2-release redirects --kv local:<url>`. Every Platform process can be rehearsed on it. [F25] [N23]

[F05]: ../.scratch/wso2-doc-space/issues/05-hosting-and-routing.md
[F11]: ../.scratch/wso2-doc-space/issues/11-platform-build-pipeline.md
[F15]: ../.scratch/wso2-doc-space/issues/15-confirm-hosting-facts.md
[F19]: ../.scratch/wso2-doc-space/issues/19-seo-and-canonical-strategy.md
[F22]: ../.scratch/wso2-doc-space/issues/22-analytics-and-feedback.md
[F25]: ../.scratch/wso2-doc-space/issues/25-edge-and-staging-pipeline.md
[F32]: ../.scratch/wso2-doc-space/issues/32-llm-outputs.md
[F35]: ../.scratch/wso2-doc-space/issues/35-legacy-confluence-paths.md
[N-map]: ../.scratch/wso2-docs-navigation/map.md
[N17]: ../.scratch/wso2-docs-navigation/issues/17-release-pipeline.md
[N22]: ../.scratch/wso2-docs-navigation/issues/22-cloudflare-deploy-bundle.md
[N23]: ../.scratch/wso2-docs-navigation/issues/23-platform-team-guide.md
[B06]: ../.scratch/wso2-docs-bundles/issues/06-vm-hosting-spec.md
