# Chrome and version switching

Last checked against code: 2026-10-27

The Platform chrome every Docs deployment shows alike: the header, both version selectors, switching, notices, the theme, page furniture, analytics and the Landing page. What the menus contain is in [navigation.md](navigation.md); Edition labels and order are in [editions-and-versions.md](editions-and-versions.md#order-and-labels).

## Header

- **One server-rendered header bar**: the WSO2 Docs logo (to the Landing page), the products button, the version selector, the search box (also Ctrl/⌘K), the links from `chrome.json`, and the colour-mode toggle. On phones the switchers and section menu move into the menu and search becomes an icon. [F13] [F29] [N18]
- **The version selector sits next to the products button and is always shown for a Doc space with Editions.** Its button shows the short Edition ("Cloud", "7.3.0"), with the full name as its accessible name. It opens on Cloud where the Doc space has Cloud, its own or a Cloud part, else on the newest release; a Cloud part counts once its platform's Cloud tree is deployed ([navigation](navigation.md)). [N-map] [N04] [N18] [N25]
- **Inside a Cloud part, the products button and version selector act for the component**, listing the component's Editions. [N04]

## Menu dropdowns

- **A section entry set to `version-in: menu` also has its own dropdown on its menu line, aligned right.** [N-map] [N04]
- **There is one version state per Doc space being read**, shared by the header selector and its menu dropdown: changing either changes both. [N04]
- **Another Doc space's dropdown shows where its selector opens. Choosing an Edition there opens that Doc space's home page at that Edition**, with no same-page mapping, and remembers the choice. [N04] [N03]
- **The menu never switches Editions on its own**, and the remembered choice never fills it. [N03] [N04]
- **Menu dropdowns are disclosure lists of links** that expand under their entry, so they work without JavaScript and in new tabs. [N18]

## Switching Editions

- **The reader stays on the same page in the chosen Edition.** The selector fetches each Edition's published page list and redirect map on first hover, focus or open, and labels each Edition "same page", "renamed page" or "page not in it". [F10] [N18]
- **A renamed page is followed through either side's redirects**, forward through the target's and backward through the source's, also between a Cloud tree and the component's own Doc space; the reader sees "This page has a different name in …". [F10] [N04] [N18]
- **A page the Edition lacks opens that Edition's home page**, with "This page isn't in <Edition>. You're on its home page instead." [F10] [N04]
- **"Copy permanent link" gives the pinned `/<edition>/` address.** Choosing the Edition already being read on `/latest/` does nothing. [F10]
- **Only an explicit choice is remembered**, per Doc space, in browser storage shared by the docs.wso2.com origin. Arriving from search or a link never changes it. On arrival, a banner offers the remembered Edition only where it has the page ("You usually read Identity Server 7.2.0. Open this page there?"); it never redirects. [F10] [N04]

## Notices

- **Notices sit in the page area, between the title and the page actions**, where every layout and the phone width have room. [N18] [N19]

  | Notice | Shown on | Text |
  |---|---|---|
  | Older release | A Self-hosted version that isn't the newest | "You're reading <Edition>. The newest release is <version>, and Cloud has the newest features." with a link to the page in the newest release; without Cloud, the second half is left out |
  | Cloud, page with Cloud-only content | A Cloud page in a Doc space that also has Self-hosted versions, when the page is Cloud-only or holds a Cloud-only block | "Cloud has the newest features. Some may not be in a release yet; the newest release is <Edition>." [B08] |
  | Cloud, shared page | Any other Cloud page in such a Doc space | "You're reading <Cloud Edition name>. The newest release is <Edition>." (decided 2026-10-27: the "newest features" claim only where the page shows it) [B08] |
  | End of life | An end-of-life Edition | "<Edition> has reached end of life. It is no longer updated." |
  | Team notice | The Editions a manifest notice names, until its date | The team's text, at `info` or `warning` |

  The newest release and a Cloud-only Doc space show no version notice. [N04] [N18] [N19]
- **Version notices are server-rendered from the baked snapshot; team notices come only from the published manifest at page load**, so a changed or ended notice never lingers in an old build. [N18] [N19]

## Runtime data and consistency

- **Chrome code and look are baked into each Docs deployment**: server-rendered, with no flash and no runtime dependency. [F13]
- **Chrome content is loaded at runtime with a baked-in fallback**: the Deployment manifest for menus, selectors and notices, and `chrome.json` (header links, footer links, the site-wide announcement). Both formats only gain fields. [F13] [F29]
- **A change to the chrome's look or behaviour reaches old deployments by rebuilding every live deployment** (a Platform release). [F13]

## Theme and accessibility

- **The theme is Oxygen tokens only**: a Platform build script generates colour, type, radius and dark-mode CSS variables from a pinned `@wso2/oxygen-ui`, keyed on Docusaurus's `[data-theme]`, with Infima variables mapped onto them. No MUI or Oxygen JavaScript ships to readers; Inter loads as a font file. Oxygen components stay out until the package tree-shakes. Oxygen UI is preferred, not required. [F03] [F13] [F-map]
- **The theme meets WCAG 2.2 AA.** WSO2 orange `#FF7300` is for accents, buttons with dark text and decoration only; links, text and focus rings use darker shades from the same ramp. A test checks every text token pair against AA and the focus ring against 3:1. [F13] [F24] [F29]
- **Light, dark and follow-system modes are supported, and Docusaurus is the only owner of the mode**; the choice is shared across WSO2 Docs through the origin. [F13]
- **Only safe swizzles.** Header widgets are custom navbar item types; the stock `Navbar` is never ejected. Today the Platform ejects `NavbarItem/ComponentTypes`, `SearchBar` and `Footer`, and wraps `MDXContent`, `NotFound`, `DocItem/Metadata`, `DocSidebarItems` and `DocBreadcrumbs/Items`. An unsafe swizzle needs a written reason and a test. The theme lives once, in the Platform. [F13] [F29] [N17] [N18]
- **Doc pages keep the stock Docusaurus layout**: sidebar left, table of contents right, breadcrumbs (starting with the Docs section). [F13] [N18]

## Page furniture

- **Every page ends with "Was this page helpful?" Yes / No**; No shows reason chips (inaccurate, missing information, hard to follow, example doesn't work, other) and a "Tell us more on GitHub" link. There is no free-text box, so WSO2 stores no personal data. Votes go to the Edge Worker's `POST /api/feedback`, counted cookie-free in Workers Analytics Engine; the payload contract is `lib/page-links.mjs`, and the Worker keeps its own copy of the reason ids. [F22] [F29] [F31]
- **"Edit this page" goes to the file on `main` when the page exists there**, else on the Edition's own branch, and to the spec YAML on API pages. Fixes go to `main` first. `editLinks: false` in the Doc space manifest hides it; the Pilot's generated repos set it. [F22] [N17]
- **"Report an issue" opens a prefilled GitHub issue** (page URL, Edition, selected text) in the Doc space's `issues` repo; during the Pilot that is the legacy repo. [F22]
- **The "Copy page" menu** sits after the title: see [ai-and-llm-outputs.md](ai-and-llm-outputs.md). [F21] [F32]

## Analytics

- **Page analytics are WSO2's GTM container (`GTM-PSTXMT`) behind the CookiePro consent banner**, CookiePro first so it can block tags until the reader consents. No other tracker is added; marketing owns what runs inside GTM. [F22]
- **Both load only on the production host**, from the same bytes, so staging and PR previews load none. [F22] [F29]
- **The Platform pushes a fixed set of `dataLayer` events**, each with Doc space, Edition and page type: `docs_page_view`, `docs_edition_switch`, `docs_search`, `docs_copy_page`, `docs_open_in_ai`, `docs_feedback`, `docs_404`. [F22] [F29]
- **A weekly digest per Doc space goes to its owners**: helpfulness and top No reasons, searches with no results, the most frequent 404s, new reported issues. Where it is posted is not decided: see [open-items.md](open-items.md#undecided). [F22] [F31]

## Landing page

- **The Landing deployment is Platform-owned and belongs to no Doc space.** It holds a search-first hero, start paths (`chrome/landing.yaml`), the products menu's groups with descriptions and Cloud / Self-hosted links, and the full search page at `/search/`. "What's new" and personalisation are out. [F13] [F29] [F30] [N18]

[F-map]: ../.scratch/wso2-doc-space/map.md
[F03]: ../.scratch/wso2-doc-space/issues/03-oxygen-ui-feasibility.md
[F10]: ../.scratch/wso2-doc-space/issues/10-version-switcher.md
[F13]: ../.scratch/wso2-doc-space/issues/13-theme-decision.md
[F21]: ../.scratch/wso2-doc-space/issues/21-ai-llm-friendly-docs.md
[F22]: ../.scratch/wso2-doc-space/issues/22-analytics-and-feedback.md
[F24]: ../.scratch/wso2-doc-space/issues/24-scaffold-platform.md
[F29]: ../.scratch/wso2-doc-space/issues/29-chrome-landing-switchers.md
[F30]: ../.scratch/wso2-doc-space/issues/30-search-pilot.md
[F31]: ../.scratch/wso2-doc-space/issues/31-quality-checks-and-skills.md
[F32]: ../.scratch/wso2-doc-space/issues/32-llm-outputs.md
[N-map]: ../.scratch/wso2-docs-navigation/map.md
[N03]: ../.scratch/wso2-docs-navigation/issues/03-shared-menu-assembly.md
[N04]: ../.scratch/wso2-docs-navigation/issues/04-version-switching-two-selectors.md
[N17]: ../.scratch/wso2-docs-navigation/issues/17-release-pipeline.md
[N18]: ../.scratch/wso2-docs-navigation/issues/18-chrome-navigation.md
[N19]: ../.scratch/wso2-docs-navigation/issues/19-extensions.md
[B08]: ../.scratch/wso2-docs-bundles/issues/08-cloud-edition-content.md
