# Navigation model

Last checked against code: 2026-10-27

How readers find a product: the products menu, Docs sections, Doc spaces, family Clouds and Cloud parts. Where each product goes is in [product-placement.md](product-placement.md); how the menus are configured is in [manifests-and-compose.md](manifests-and-compose.md); how they are drawn is in [chrome-and-version-switching.md](chrome-and-version-switching.md).

## Products menu

- **The products menu must mirror the wso2.com header**: the Product families Agent Platform, API Platform, Integration Platform, Identity Platform and Engineering Platform, in wso2.com's order and with its names, then two groups that are not Product families, **Solutions** and **Other**, as wso2.com/documentation groups them. Readers already know wso2.com's names. [N-map] [N06] [N14]
- **Each group lists, in this order**: the family's Cloud; the products its Docs section manifest lists under `products`, with their labels and order; products not on WSO2 Docs yet, opening their old site (↗); the section's link entries (↗). [N12] [N18]
- **A products-menu label is written exactly as wso2.com writes it.** It is the one name a section may set; every other name comes from the Doc space manifest. [N02]
- **A products-menu entry opens a Doc space**, optionally at a named Edition or one page in it. It never opens a section page, because sections have none. [N02] [N03] [N06]
- **Choosing a product opens it where its version selector opens**: Cloud (its own, or its Cloud part in the platform's tree) where it has Cloud, else its newest release. Menus link that address directly, not the bare product address. [N04] [N18]
- **A Cloud part counts once its platform's Cloud tree is deployed.** Until then the component has only its Self-hosted versions: its products-menu entry, its section-menu line and its bare address open its newest release, and its version selector lists no Cloud. The live menus (the published manifest marks the component `cloudPartPending`, keeping its `cloud.in` for compose) and the menus built into a page with the environment's deployment state do the same; a Cloud build counts its own tree as deployed, and a local build without deployment state keeps the composed manifest's menus. The Edge Worker's bare-address 302 follows the same rule. Decided 2026-10-27. [N04] [N25]
- **The products button names the product being read.** Inside a Cloud part it names the component, not the platform. [N04] [N18]
- **The Landing page draws the same groups and entries in the same order**, adding only each group's description (from the Platform navigation file) and each entry's Cloud and Self-hosted links. One list keeps the two from drifting. [N18]
- **Former names (Asgardeo, Bijira, Choreo, Devant) are never the main name.** Where today's SaaS brand differs from the wso2.com name, it is kept as a second name or Cloud `brand` (WSO2 Cloud, WSO2 Developer Platform). [N12]

## Docs sections

- **Each Product family has one Docs section by default.** Only the Platform team adds Product families, groups and Docs sections; each section has one owning team, who keeps its manifest. [N02]
- **A Docs section has no pages of its own.** Its overview and get-started pages belong to the family-level Doc space, so every page has one owner and one Content repo. [N03]
- **Every Docs section has the same shape**: the family's Cloud first, then its products, then links out. Solutions and Other have no Cloud. [N12]
- **The menu shows the Doc space being read open, with its own page tree.** Every other Doc space is one collapsed line: its name, plus its version dropdown aligned right when the section sets `version-in: menu`. Trees never expand in place, so no other deployment's sidebar is fetched. [N03] [N18]
- **The menu is put together in the reader's browser.** Each Docs deployment bakes in its own tree and a manifest snapshot, so the server-rendered HTML always has a complete menu for search engines and readers without JavaScript; the live Deployment manifest then redraws only what differs. Like the live menus, the baked ones list only deployed Doc spaces ([build-and-quality-checks.md](build-and-quality-checks.md#the-build)). A menu change or a new version reaches old builds with no rebuild, and the Edge Worker stays out of page rendering. [N03]

## Borrowing and the reader's section

- **A Doc space has exactly one home Docs section, which must list it.** Any other section may borrow it without asking; compose tells the Doc space's team where it is borrowed. [N02]
- **The server-rendered page always shows the home section.** A reader arriving from search, a bookmark or another site therefore sees the home section. [N03]
- **A reader who came through another section keeps it for the browser session**, per Doc space: its menu, products button and breadcrumb. Choosing a product, a section menu entry or a Landing link sets it; moving between Docs deployments on WSO2 Docs keeps it; a page load from another host, or with no referrer, forgets it. The URL never changes. [N03] [N18]
- **A borrowed Cloud part in a section that doesn't list its platform shows the part alone**, tagged "from <home section>". [N18]

## Doc spaces

- **A Doc space is one product's documentation, or a Product family's Cloud documentation.** It lives in one directory of one Content repo and is owned by one team; a repo may hold several Doc spaces. [N02] [N07]
- **A Doc space may be family-level or product-level.** [N-map]

## Family Clouds and Cloud parts

- **Every Product family has one family-level, Cloud-only Doc space named "<Family> Cloud"**, whose slug is the family's name (`api-platform`, `identity-platform`). Cloud lives with the family and versions live with the products, following the SaaS / open source pairs wso2.com/documentation shows. [N12]
- **Each product's Cloud docs are a Cloud part of the family Cloud's tree.** The product's own Doc space holds only its Self-hosted versions; its "Cloud" choice opens its part. [N12] [N02]
- **A Cloud part is declared on both sides**: the platform's Cloud Edition lists it in `parts`, and the part sets `cloud: { in: <platform> }`. A part belongs to one platform, has no Cloud of its own, and lives in the platform's own Content repo, so the whole Cloud tree builds from one commit. Compose blocks any break in these. [N02] [N14] [N17]
- **A Cloud part's content is the component's main line.** [N07]
- **Inside a Cloud part, the header acts for the component**: the products button and version selector are the component's. [N04]
- **A family Cloud's skeleton** is Overview (an overview layout, one card per product) · Get started · one group per Cloud part · Guides · Concepts · Reference · Release notes. A product's skeleton is Get started · Guides · Concepts · Reference · Deploy & operate · Release notes. A Doc space with audience groups keeps its home at the top and applies the skeleton inside each group (see [extension-points.md](extension-points.md#audience-groups)). [N11] [N12]

## Unlisted Doc spaces

- **An Unlisted Doc space (`listed: false`) is in no products menu and no Docs section.** It has no home section, and no section may list it. Readers reach it only from links, such as its product's console. [N02] [N-map]
- **Unlisted pages carry `noindex`, stay out of the sitemap index, and are searched only from inside the Doc space.** [N05] [N17] [N20]
- **`indexed: true` (only with `listed: false`) is the one exception**: the Doc space is indexed, in the sitemap index and in All of WSO2 Docs search, but still in no menu. Contribute uses it. The exception is a manifest field, not a slug check. [N18]
- **Bijira and Devant are Unlisted, frozen copies** hosted for as long as their consoles link to them, each in its own archived repo. Retiring them is out of scope; it would be a later redirect decision. [N06] [N07] [N-map]
- **The Sandbox is Unlisted and staging-only** (`environments: [staging]`), never in the production manifest. [F34] [F31]

## Open items

Product teams still have to answer the questions in [open-items.md](open-items.md#undecided) (API Control Plane, Security Token Service, Agent ID, owners).

[F31]: ../.scratch/wso2-doc-space/issues/31-quality-checks-and-skills.md
[F34]: ../.scratch/wso2-doc-space/issues/34-writer-experience.md
[N-map]: ../.scratch/wso2-docs-navigation/map.md
[N02]: ../.scratch/wso2-docs-navigation/issues/02-manifest-model.md
[N03]: ../.scratch/wso2-docs-navigation/issues/03-shared-menu-assembly.md
[N04]: ../.scratch/wso2-docs-navigation/issues/04-version-switching-two-selectors.md
[N05]: ../.scratch/wso2-docs-navigation/issues/05-urls-and-latest.md
[N06]: ../.scratch/wso2-docs-navigation/issues/06-product-mapping.md
[N07]: ../.scratch/wso2-docs-navigation/issues/07-repo-structure.md
[N11]: ../.scratch/wso2-docs-navigation/issues/11-extension-points.md
[N12]: ../.scratch/wso2-docs-navigation/issues/12-platform-walkthroughs.md
[N14]: ../.scratch/wso2-docs-navigation/issues/14-manifests-and-compose.md
[N17]: ../.scratch/wso2-docs-navigation/issues/17-release-pipeline.md
[N18]: ../.scratch/wso2-docs-navigation/issues/18-chrome-navigation.md
[N20]: ../.scratch/wso2-docs-navigation/issues/20-search-for-new-navigation.md
