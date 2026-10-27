# Product placement

Last checked against code: 2026-10-27

Where every product on wso2.com, and on wso2.com/documentation's Solutions and Other, goes in WSO2 Docs. Every product gets a place, even though only the Pilot moves now. The shape is in [navigation.md](navigation.md#family-clouds-and-cloud-parts). [N-map] [N06] [N12]

## The table

"In the Pilot" means converted and built in the Pilot; every other Doc space is planned and, until converted, listed with its old site. Owners are all to be named. Version-in "menu" is the default for two or more Editions.

| Group | Doc space (slug) | Kind | Editions, in order | Legacy versions | Version-in | Content repo | In the Pilot |
|---|---|---|---|---|---|---|---|
| Agent Platform | Agent Platform Cloud (`agent-platform`); Cloud part: Agent Manager | Family Cloud | Cloud | | header | `docs-agent-platform` | No |
| Agent Platform | Agent Manager (`agent-manager`) | Product | 1.0.0 (Cloud is its part) | | menu | `docs-agent-platform` | No |
| Agent Platform | AI Gateway, borrowed from API Platform | | | | menu | | No (borrowing is tested in code) |
| API Platform | API Platform Cloud (`api-platform`, formerly Bijira); Cloud parts: API Gateway, AI Gateway, AI Workspace, API Portal & MCP Hub | Family Cloud | Cloud | | header | `docs-api-platform` | Yes, with AI Gateway as its only part so far |
| API Platform | API Manager (`api-manager`) | Product | 4.7.0, 4.6.0 | 4.5.0 to 3.0.0 on `apim.docs.wso2.com`; 2.6.0 to 1.9.0 on Confluence (`wso2docs.atlassian.net`) | menu | `docs-api-platform` | Yes |
| API Platform | API Gateway (`api-gateway`) | Product | 1.2.0, 1.1.0, 1.0.0 (Cloud is its part) | | menu | `docs-api-platform` | No (Cloud pages wait in API Platform Cloud's `guides/api-gateway/`) |
| API Platform | AI Gateway (`ai-gateway`) | Product | 1.2.0, 2026.09.24 (Cloud is its part) | 1.1.0, 1.0.0 on the old site | menu | `docs-api-platform` | Yes |
| API Platform | API Portal & MCP Hub (`api-portal`) | Product | 1.0.0 (Cloud is its part) | | menu | `docs-api-platform` | No |
| API Platform | AI Workspace (`ai-workspace`) | Product | 1.0.0 (Cloud is its part) | | menu | `docs-api-platform` | No |
| Integration Platform | Integration Platform Cloud (`integration-platform`, second name WSO2 Cloud, formerly Devant); Cloud parts: Integrator, Connectors | Family Cloud | Cloud | | header | `docs-integrator` | No |
| Integration Platform | Integrator (`integrator`) | Product | 5.1.0, 5.0.0 (Cloud is its part) | | menu | `docs-integrator` | No |
| Integration Platform | Integration Control Plane (`integration-control-plane`) | Product | 2.1.0 | | header | `docs-integrator` | No |
| Integration Platform | Connectors (`connectors`) | Product, catalog layout | unversioned | | | `docs-integrator` | No |
| Identity Platform | Identity Platform Cloud (`identity-platform`, formerly Asgardeo); Cloud parts: Identity Server, Agent ID | Family Cloud | Cloud | | header | `docs-identity-platform` | Yes, with Identity Server as its only part |
| Identity Platform | Identity Server (`identity-server`) | Product | 7.3.0, 7.2.0 (Cloud is its part) | 7.1.0, 7.0.0, 6.1.0, 6.0.0 on the old site; 5.x stays unlisted | menu | `docs-identity-platform` | Yes |
| Engineering Platform | Engineering Platform Cloud (`engineering-platform`, second name WSO2 Developer Platform, formerly Choreo): two top-level groups, For developers and For platform engineers | Family Cloud | Cloud | | header | to be confirmed (probably `wso2/docs-choreo-dev`) | No |
| Solutions | Accelerator for Healthcare (`healthcare`) | Product | unversioned | | | `open-healthcare-docs` | No |
| Solutions | Accelerator for Financial Services (`financial-services`) | Product | 4.0.0, 3.0.0 | older on Confluence | menu | `docs-open-banking` | No |
| Other | Updates (`updates`) | Product | unversioned | | | `docs-updates` | No |
| Other | Platform Security (`platform-security`) | Product | unversioned | | | `docs-security` | No |
| Unlisted | Bijira (`bijira`), Devant (`devant`) | Frozen copies | Cloud | | | `docs-bijira`, `docs-devant` (archived) | No |
| — | Contribute (`contribute`) | Unlisted, `indexed: true` | unversioned | | | `docs-platform` (`standards/contribute/`) | Yes |
| — | Sandbox (`sandbox`) | Unlisted, staging only | Cloud, 1.0.0 | | | `docs-sandbox` | Yes |

[N06] [N12] [N08] [N16] [N18]

## Products-menu entries without a Doc space of their own

| Group | Entry | Opens |
|---|---|---|
| Agent Platform | Agent ID | Its part of Identity Platform Cloud |
| API Platform | API Control Plane, Monetization | Pages in API Platform Cloud |
| Identity Platform | Security Token Service | The Identity Platform Cloud home (no docs yet) |

[N06] [N12] [N14]

## Links out

| Section | Link |
|---|---|
| Integration Platform | Micro Integrator, Streaming Integrator, Ballerina Integrator and Enterprise Integrator (old sites); Ballerina (ballerina.io, linked, not absorbed) |
| Engineering Platform | OpenChoreo (openchoreo.dev) |

[N06] [N12] [F-map]

## Rules settled with the placement

- **API Manager and API Platform are separate Doc spaces in the API Platform Docs section**, sharing `docs-api-platform`. The first map left their merge open; the navigation map placed them. [N06] [N07]
- **APK has no place**: it is gone from wso2.com and no current docs were found. [N06]
- **The converted sources**: Identity Server and Identity Platform Cloud from `wso2/docs-is`, API Manager from `wso2/docs-apim`, API Platform Cloud and its products from `wso2/docs-api-platform` (one MkDocs build with every version as folders), Agent Manager, Integrator and Healthcare by a light Docusaurus import, the rest through the MkDocs converter. [N07] [N12] [N16]
- **Until its Doc space is published, every placed Doc space is listed in the Platform navigation file's `notYetOnWso2Docs`** under the slug above, in its group, opening its old site: a family Cloud as `cloud-only`, a product as `versions-only` (its Cloud is a Cloud part) or `unversioned`. Each link out above is listed there too, as `links-out`, and never gets a Doc space. In each group the family Cloud comes first, then the products, then the links out. Unlisted Doc spaces are not listed, and nothing outside this table is (Support and lifecycle has no place). `test/compose.test.mjs` keeps the file and this table equal. [N06] [N12] [N14] [N25]
- **A component's main line is seeded from its newest Self-hosted line** (the `next/` folder or "Next"), plus pages found only in the Cloud sources marked Cloud only; same-name pages that differ go into a diff report for the team. [N12] [N16]

## Open

The owning teams' questions (API Control Plane and Security Token Service docs, the Developer Platform repo, Integrator's `wso2-agent-builder` branch, owners) are in [open-items.md](open-items.md).

[F-map]: ../.scratch/wso2-doc-space/map.md
[N-map]: ../.scratch/wso2-docs-navigation/map.md
[N06]: ../.scratch/wso2-docs-navigation/issues/06-product-mapping.md
[N07]: ../.scratch/wso2-docs-navigation/issues/07-repo-structure.md
[N08]: ../.scratch/wso2-docs-navigation/issues/08-pilot-changes.md
[N12]: ../.scratch/wso2-docs-navigation/issues/12-platform-walkthroughs.md
[N14]: ../.scratch/wso2-docs-navigation/issues/14-manifests-and-compose.md
[N16]: ../.scratch/wso2-docs-navigation/issues/16-api-platform-conversion.md
[N18]: ../.scratch/wso2-docs-navigation/issues/18-chrome-navigation.md
[N25]: ../.scratch/wso2-docs-navigation/issues/25-close-spec-code-gaps.md
