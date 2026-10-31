# WSO2 Docs

The unified documentation experience for all WSO2 products, served at docs.wso2.com.

## Language

**WSO2 Docs**:
The single reader-facing documentation experience for all WSO2 products: one domain, one landing page, one global navigation and search, one look. Says nothing about how many builds or repos sit behind it.
_Avoid_: Doc site, portal, docs hub

**Product**:
Something WSO2 offers, as wso2.com lists it, whether delivered as Cloud, Self-hosted or both (e.g. Identity Server, API Manager), or a Product family's Cloud (e.g. Identity Platform Cloud). Each product's documentation is one Doc space, so wherever a reader or an agent picks a product, it is named by its Doc space's slug.
_Avoid_: Offering, SKU

**Doc space**:
One product's documentation within WSO2 Docs, or a Product family's Cloud documentation: its Editions (Cloud, if any, plus every Self-hosted version). The reader chooses an Edition from the version selector next to the product; a Docs section may also give a Doc space its own version dropdown in the menu.
_Avoid_: Product site, product docs

**Cloud docs**:
The unversioned Edition documenting what WSO2 delivers as SaaS. In a Product family it belongs to the family-level Doc space ("<Family> Cloud"), with each product's Cloud content as a Cloud part; the products' own Doc spaces hold only Self-hosted docs. It is the newest edition of the product and may describe features not yet released Self-hosted.
_Avoid_: SaaS docs, online docs

**Self-hosted docs**:
A versioned Edition of a Doc space, documenting one release of the product that the customer installs and runs themselves (e.g. Identity Server 7.3.0).
_Avoid_: Local docs, on-prem docs

**Edition**:
One choice in a Doc space's version dropdown: either its Cloud docs or one Self-hosted version. Each Edition is built as its own Docs deployment. Where a Doc space has Cloud, Cloud is its latest Edition: deployed on Cloud and not yet released as a download, and the Edition readers open first. Otherwise the newest Self-hosted version is. The newest Self-hosted version is also built as `latest`. A Cloud-only Doc space has no separate `latest`: its `latest` address leads to Cloud.
_Avoid_: Entry, variant, flavour, version (Cloud has none)

**Legacy version**:
A Self-hosted version whose docs have not moved to WSO2 Docs. It is listed in the version dropdown but opens on its old site; it is not an Edition and has no Docs deployment.
_Avoid_: Old edition, archived version

**Product family**:
One of the platforms that wso2.com groups its products under (e.g. API Platform, Identity Platform), named exactly as wso2.com names it. It groups the products menu and by default has one Docs section. The products menu also has two groups that are not Product families: Solutions and Other.
_Avoid_: Product line, suite, platform (Platform is the docs codebase)

**Unlisted Doc space**:
A Doc space hosted in WSO2 Docs but shown in no products menu or Docs section; readers reach it only from links, such as its product's console (e.g. Bijira, Devant while they retire).
_Avoid_: Hidden docs, orphan docs

**Docs section**:
Where a choice in the products menu takes the reader: one left menu over one or more Doc spaces (e.g. API Platform Documentation). By default each Product family has one; a product team may configure others. A Doc space may appear in more than one Docs section.
_Avoid_: Docs hub, portal, product site

**Doc space manifest**:
The file in which a Doc space's team describes its Doc space: its names, its Editions and where each one's source is, its Legacy versions, its latest Edition and its home Docs section.
_Avoid_: docspace config, product manifest

**Docs section manifest**:
The file in which a Docs section's team describes its section: its products menu entries and its menu, meaning which Doc spaces appear, in what order, and where each one's version is chosen.
_Avoid_: nav config, menu file

**Home Docs section**:
The one Docs section a Doc space belongs to. Other Docs sections may borrow the Doc space, but readers arriving from search see its home section's menu.
_Avoid_: primary section, owner section

**Cloud part**:
A component Doc space's Cloud content shown as one part of a family-level Doc space's Cloud tree (e.g. AI Gateway inside API Platform Cloud). The component's own Doc space keeps only its Self-hosted versions, and its "Cloud" choice opens the part.
_Avoid_: sub-space, module, child doc space

**Pilot**:
A working WSO2 Docs build with a few Doc spaces migrated, used to prove the platform spec before rolling out to every product.
_Avoid_: POC, MVP

**Markdown twin**:
The plain-Markdown version of one page in one Edition, served next to it for AI tools and for readers who want raw text.
_Avoid_: Markdown export, raw page, LLM copy

**Page type**:
The kind of writing a page is, which fixes its structure: Quick start, Tutorial, How-to, Concept, Reference or Release notes.
_Avoid_: Content type, doc type, template

**Page layout**:
How a page is drawn, chosen independently of its Page type: the default layout, an overview of cards, a catalog fed by data, or an API reference.
_Avoid_: Template, theme, page style

**Audience group**:
A top-level part of one Doc space's sidebar for one kind of reader (e.g. Engineering Platform Cloud's "For developers" and "For platform engineers"), declared in the Doc space manifest and holding the common skeleton below it. Readers see every group; there is no role switch.
_Avoid_: Perspective, view, persona, role

**Platform chrome**:
The parts every Docs deployment shows alike: header, product switcher, Edition dropdown, search box, version notices and footer, as distinct from a Doc space's own sidebar and pages.
_Avoid_: Shell, frame, global nav

**Search scope**:
How much of WSO2 Docs a reader's search covers: This Edition, All Editions of one Doc space, or All of WSO2 Docs. Cross-product search shows one Edition per Doc space.
_Avoid_: Search context, filter

## Publishing

**Content repo**:
A git repo holding the content of one or more Doc spaces, each in its own directory: Markdown/MDX, assets, sidebar and the Doc space manifest. Each Doc space lives in exactly one Content repo. No site tooling.
_Avoid_: Docs repo, product repo

**Platform**:
The single codebase that owns WSO2 Docs' site tooling (Docusaurus, theme, plugins, config) and builds every Docs deployment from Content repo releases.
_Avoid_: Shell, framework, docs engine

**Docs release**:
A tagged release in a Content repo for one Self-hosted version, independent of the product's own release; a version's docs may be released many times. Cloud docs release continuously from the main line instead. Each Edition in a Docs section's configuration points to its Docs release (or, for Cloud, the main line) as its source.
_Avoid_: Docs version, publish

**Docs bundle**:
The zip a Docs release carries: the source of one Doc space for one Edition, attached to the release's tag. The Platform builds a Docs deployment from it.
_Avoid_: Package, artifact, snapshot

**Intake record**:
The Platform's record of the Docs bundles it has accepted for one Doc space, per Edition, newest first. A Docs deployment is built only from a bundle in it.
_Avoid_: Lock, lock file, pins

**Platform release**:
A versioned release of the Platform. Shipping it rebuilds every live Docs deployment pinned to its major version, with no new Docs release needed, unless it changes only the Shared theme, which goes live without a rebuild.
_Avoid_: Theme release, site release

**Shared theme**:
The stylesheets, fonts and images every Docs deployment of one Platform major loads from the edge; changing it needs no rebuild.
_Avoid_: Theme release, skin, global stylesheet

**Deployment manifest**:
The published record of all of WSO2 Docs' navigation: the products menu, every Docs section's menu, and every Doc space's live Editions, Legacy versions, `latest` and end-of-life status. It is composed from the teams' Doc space manifests, Docs section manifests and the Platform's own navigation. Readers' menus and version selectors follow it, so changing it needs no rebuild.
_Avoid_: Registry, versions.json, catalog

**Docs deployment**:
One Edition of a Doc space built for one path and deployed on its own, without rebuilding any other. The Edition feeding `latest` has two Docs deployments.
_Avoid_: Site, instance

**Branch cut**:
Creating a Self-hosted version's branch in a Content repo as a copy of the main line (the Cloud docs) at that version's code freeze or release candidate, before its first Docs release at GA.
_Avoid_: Fork, snapshot, version freeze

**Edition marker**:
A label on a page, section or phrase that limits it to some Editions: Cloud only, Self-hosted only, or Self-hosted from a given version (or `next`, not yet committed to a release).
_Avoid_: Condition, flag, tag, conditional block

**Edition variant**:
One block of content written once for Cloud and once for Self-hosted, where each Edition shows only its own form.
_Avoid_: Alternative, pair, toggle

**Self-hosted addition**:
Self-hosted-only content with no Cloud counterpart. Cloud shows it, labelled Self-hosted.
_Avoid_: On-prem content, extra content

**Landing deployment**:
The Platform-owned deployment holding the WSO2 Docs landing page; it belongs to no Doc space.
_Avoid_: Home site, portal
