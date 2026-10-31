# Extension points

Last checked against code: 2026-10-29

What a product team may add beyond plain pages, and through which sanctioned hook.

## The rule

- **Content repos stay code-free. Every extension is either data** (a manifest field, or a YAML or JSON data file in the Doc space) **or Platform code** (a component, layout or build step in the Platform, proposed by pull request and then open to every team). Teams never ship React code, Docusaurus plugins or CSS. This keeps one look, working Markdown twins and quality checks, and Platform-wide rebuilds. [N11]
- **There is no escape hatch**: no raw HTML widgets, iframes or per-team CSS. Until the Platform supports a need, a team links out. [N11]

| A team wants | Where it lives |
|---|---|
| A component in a page | The Platform's component catalogue |
| Cards linking to products or sections | `layout: overview` |
| A searchable grid | `layout: catalog`, with a `data:` file next to the page |
| An API reference | `layout: api-reference`, with `spec:` |
| Audience groups | `audienceGroups` in the Doc space manifest: top-level folders in `docs/`, each holding the skeleton (no role switch) |
| A banner for some Editions | `notices` in the Doc space manifest |
| A link out of WSO2 Docs | A link entry in the Docs section manifest |
| An older version on its old site | `legacyVersions` in the Doc space manifest |
| An icon before a sidebar entry | `sidebar_custom_props: { icon }` in a page's front matter, `customProps: { icon }` in a folder's `_category_.yml` |
| Content generated from a product repo | A data file, synced by a bot pull request |
| Anything else | An extension proposal |

[N11] [N19]

## Audience groups

- **A Doc space whose readers split into audiences declares them as `audienceGroups`** in its manifest, such as Engineering Platform Cloud's `developers` and `platform-engineers`. Each group is a top-level folder of `docs/`, labelled and ordered by its `_category_.yml` ("For developers", "For platform engineers"); the home page stays at `docs/index`. There is no role switch: both groups are in one sidebar. [N11]
- **With audience groups, only the groups sit at the top of `docs/`, and the skeleton applies one level down**, inside each group (`developers/guides/`, `platform-engineers/concepts/`). The blocking `skeleton` check enforces both levels, a page's default `type` comes from the skeleton folder inside its group, and `wso2-docs new` takes the group in `--folder`. A group is never a skeleton folder's name. Decided 2026-10-29 (user): the check that allowed only the skeleton at the top was the bug. [N11]

## Components

- **One Platform catalogue holds every component and layout**: `standards/components.yaml`, which generates Contribute's components page. [N11] [N19]
- **To join the catalogue, a component needs a generic name, a Markdown form, an accessibility check, a Contribute page and an owner.** A test fails when a registered MDX component or a layout is missing from the catalogue, and CI fails when a component has no Markdown form. [N11] [N19] [F21] [F32]

## Page layouts

- **A page's `type` is what kind of writing it is (one of the six Page types); its `layout` is how it is drawn.** The two are independent. [N11]
- **Layouts are a fixed Platform list: `default`, `overview`, `catalog`, `api-reference`.** The migration's `complete-guide`, `sdk` and `connector` are variants drawn as `default`. New layouts come through a proposal. [N11] [N19]
- **Layouts are drawn before Docusaurus's own remark plugins** (and in the twin pipeline), so the TOC, anchors, link checks, server rendering, search records and twins all see them. [N19]
- **`overview`**: every section of a page's own Markdown that holds only text and links becomes a card, keeping its heading and anchor. The page stays plain Markdown, and its twin is that Markdown. A product card is an H3 with its Cloud and Self-hosted links. [N19]
- **`catalog`**: the page's text, then a searchable, filterable grid of the items in its `data:` file, filtered to the Edition. Every item is in the server-rendered HTML; the controls are labelled and announced. [N19]

## Sidebar icons

- **A sidebar entry may show an icon before its label, set where Docusaurus sets an entry's props**: a page's front matter `sidebar_custom_props: { icon: <name> }`, or a folder's `_category_.yml` `customProps: { icon: <name> }`. An entry without one looks as it does without the feature. An icon shows at any level of the sidebar it is set on, and a Cloud part's entries keep theirs in the family Cloud tree. [User decision 2026-10-28]
- **Names come from the Platform's allow-list (`lib/nav-icons.mjs`), in the MkDocs Material form `wso2/docs-is` used**: `octicons/<name>-16`, every 16px Octicon of the pinned `@primer/octicons` 18.0.0 (MIT); `fontawesome/brands/<name>` for `react`, `vuejs`, `angular`, `js`, `node-js` and `fontawesome/solid/user-shield`, copied from Font Awesome Free 6.3.0 (CC BY 4.0) into `icons/fontawesome/`; and `wso2/<name>` for `nextjs`, `nuxt`, `dotnet`, `expressjs`, `spring-boot`, `mcp`, copied from `wso2/docs-is` (Apache-2.0) into `icons/wso2/`. Attribution is in `THIRD-PARTY-NOTICES.md`, which ships in the package with the icons. A new icon comes through an extension proposal. [User decision 2026-10-28]
- **An unknown name is rejected with a fix**: the blocking `nav-icons` check (in `standards/checks.yaml`) names the file and line and suggests a close name, and a strict build fails on it; a build that only warns on broken links (a preview) warns and draws the entry without its icon. [User decision 2026-10-28]
- **The build inlines the SVG; nothing loads in the browser.** `plugins/nav-icons.mjs` hands the SVG of the icons the sidebars use to the existing `DocSidebarItems` wrap as global data, so only used icons reach readers and no icon font loads. Each icon is fitted into 16px keeping its shape (a narrow Font Awesome glyph is 14×16), filled `--wso2-nav-icon-color: #848484` in light and dark mode, 8px before the label, and the entries under an entry with an icon are indented 20px more, as on the Identity Platform docs (`site/wso2-theme/css/nav-icons.css`, part of the shared theme, so its look changes without a rebuild; which icons exist and the SVG stay in each build). It does not change on hover or for the active entry; only the label does. It is decorative (`aria-hidden`), so an entry's accessible name stays its label, and Markdown twins and `llms.txt` leave it out. [User decision 2026-10-28] [user decision 2026-10-28 (theme without rebuilding)]
- **The converter carries `docs-is`'s `extra.nav_icons` over** for Identity Server and Identity Platform Cloud: an entry gets the icon its legacy template drew, matched on the nav title and level (a level, a list of levels, or any), never on a section's index page (Material folds it into the section), and never on an "Overview" page whose URL names connectors or organization management. A section with no folder of its own that stands for the docs root (Home) puts its icon on the root index page, and the family overview takes the legacy home's. A folder laid out from another tree's nav takes that nav's icon only for content the branch's own nav lacks. A legacy icon outside the allow-list (the Sift and Onfido logos) is reported and left out. [User decision 2026-10-28]

Reason for the section: user decision 2026-10-28 (theme from the WSO2 product docs sites).

## API reference

- **Each API is one page, `docs/reference/apis/<api-slug>/index.mdx`, with `layout: api-reference`** and front matter pointing at the spec. The MDX body is the hand-written overview (purpose, base URL per Edition, authentication), shown first. [F20]
- **Three panels, Redoc-style**: the API's own navigation (tags and operations, with "Back to Reference") replaces the Edition sidebar; operations in the middle; request and response samples on the right; a "Download OpenAPI (YAML)" button at the top. [F20] [F28]
- **Everything is in the server-rendered HTML**: every operation, parameter, body, response and schema (large schemas in `<details>`), each operation an anchored heading. Browser-only renderers are ruled out. The renderer is Platform components on a remark step; Redoc 3 failed the server-rendering spike. [F20] [F28]
- **Page budget: 400 KB of gzipped HTML per API page.** An API over budget splits into one page per tag (`wso2-docs api split`). [F28]
- **No "try it" console.** Each operation shows copy-ready requests with placeholders. Revisit for Cloud once sign-in exists. [F20]
- **Specs live in the Content repo next to their page**, versioned on each release branch; writers edit descriptions there. Where Cloud and Self-hosted differ, `openapi.cloud.yaml` and `openapi.self-hosted.yaml` override per Edition; server URLs come from `server:` with `{edition.*}`. Operation-level markers are deferred. [F20] [F28]
- **OpenAPI validation blocks a pull request; description lint only warns.** [F20]

## Notices

- **A team notice is declared in the Doc space manifest**: text, level (`info` or `warning`), the Editions it applies to, and an optional `until` date (inclusive, UTC). The chrome shows it at runtime from the published manifest only. Compose blocks a notice naming an unknown Edition and warns on an ended one. [N11] [N19]

## Link entries

- **A link out is a `{label, url}` entry in a Docs section manifest's menu, shown with ↗.** It may never point into WSO2 Docs (list the Doc space instead), and labels are unique in a section. The products menu and Landing page show a section's link entries too. [N11] [N19] [N18]

## Generated content and data files

- **Generate upstream, commit as data.** The product's CI generates files such as `openapi.yaml`, `connectors.yaml` or release-note data; a bot opens a pull request to the Content repo and writers review it. The build reads only committed files and never runs a team's code. [N11] [F20]
- **The Platform provides the sync workflows.** Today only OpenAPI has one (`spec-sync.yml`), called by each Content repo's optional `docs-sync.yml`. [N11] [N10]
- **Data files have Platform schemas** (catalog, release notes, SDK list) in `schemas/`, and the blocking `data-files` check validates them (unique ids, known categories, links and logos that exist). A catalog's data file is named by the page's `data:`; `release-notes.yaml` and `sdks.yaml` are found by name. No layout draws release notes or SDK lists yet. [N11] [N19] [N10]

## Platform growth

- **A team proposes an extension with the issue form `.github/ISSUE_TEMPLATE/extension-proposal.yml`, then a pull request; the Platform team reviews it.** Once merged, it ships in a Platform release, is documented in Contribute and is open to every team. Manifest and data-file fields are only ever added. [N11] [N19]

[F20]: ../.scratch/wso2-doc-space/issues/20-api-reference-rendering.md
[F21]: ../.scratch/wso2-doc-space/issues/21-ai-llm-friendly-docs.md
[F28]: ../.scratch/wso2-doc-space/issues/28-api-reference-renderer.md
[F32]: ../.scratch/wso2-doc-space/issues/32-llm-outputs.md
[N10]: ../.scratch/wso2-docs-navigation/issues/10-boilerplate.md
[N11]: ../.scratch/wso2-docs-navigation/issues/11-extension-points.md
[N18]: ../.scratch/wso2-docs-navigation/issues/18-chrome-navigation.md
[N19]: ../.scratch/wso2-docs-navigation/issues/19-extensions.md
