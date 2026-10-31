# Chrome and version switching

Last checked against code: 2026-10-29

The Platform chrome every Docs deployment shows alike: the header, both version selectors, switching, notices, the theme, page furniture, analytics and the Landing page. What the menus contain is in [navigation.md](navigation.md); Edition labels and order are in [editions-and-versions.md](editions-and-versions.md#order-and-labels).

## Header

- **Two bars, both server-rendered.** On top, the **wso2.com bar**: WSO2's logo (to wso2.com), wso2.com's top-level links and menus (Agentic Enterprise, Products, Solutions, Company) and Contact, from `chrome.json`; it scrolls away. Under it, the **docs bar**, brand navy and sticky: "Docs" (to the Landing page), the products button, the version selector, the search box (also Ctrl/⌘K) and the colour-mode toggle. [user decision 2026-10-29 (theme from the WSO2 Docs designs)] [F13] [F29] [N18]
- **The wso2.com bar's menus are `<details>` disclosures of links**, so they work without JavaScript; opening one closes the others, and Escape or a click outside closes them. Their links mirror the wso2.com header and change in `chrome.json` with no rebuild. There is no account link: WSO2 Docs has no sign-in. [user decision 2026-10-29 (theme from the WSO2 Docs designs)]
- **On phones** the wso2.com bar folds into one Menu disclosure; the docs bar keeps the products button and version selector, compact, search becomes an icon, and "Docs" and the colour-mode toggle move into the menu. [user decision 2026-10-29 (theme from the WSO2 Docs designs)] [F13] [N18]
- **The version selector sits next to the products button and is always shown for a Doc space with Editions.** Its button shows the short Edition ("Cloud", with a cloud icon, or "7.3.0"), with the full name as its accessible name; in its list the newest release has a "Latest" badge, read as "(newest release)". It opens on Cloud where the Doc space has Cloud, its own or a Cloud part, else on the newest release; a Cloud part counts once its platform's Cloud tree is deployed ([navigation](navigation.md)). [N-map] [N04] [N18] [N25]
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

- **Chrome code is baked into each Docs deployment; its look is the shared theme.** The header, menus, selectors and notices are server-rendered from the build. Their look is the theme ([below](#theme-and-accessibility)), which every page links at the host root and loads before it draws, so there is no flash. [F13] [user decision 2026-10-28 (theme without rebuilding)]
- **Chrome content is loaded at runtime with a baked-in fallback**: the Deployment manifest for menus, selectors and notices, and `chrome.json` (the wso2.com bar, footer links, the site-wide announcement; `header.links` stays for deployments built before the wso2.com bar). Both formats only gain fields. [F13] [F29]
- **A theme change reaches every live Docs deployment of the Platform major without a rebuild**, in production too: the edge serves the live theme at the address every page links, so building every deployment again is not needed for it. A change to the chrome's markup or behaviour (its React components, the header layout, which sidebar icons exist, the Docusaurus version, plugins) still reaches old deployments by rebuilding every live deployment (a Platform release, scope `all`). This reverses, for style, the earlier rule that any change to the chrome's look needed that rebuild. How the live theme is published and served is in [releases-and-deployments.md](releases-and-deployments.md) and [edge-and-hosting.md](edge-and-hosting.md). [F13] [user decision 2026-10-28 (theme without rebuilding)]

## Theme and accessibility

- **The theme is the WSO2 Docs designs' look** (the Landing and Doc space pages of 2026-10) and their WSO2 brand tokens: navy `#17223A` text, WSO2 orange accents, Inter for text and Inter Tight for headings, 6-12px radii, a two-bar header, a 300px sidebar of rounded rows with the current page in an orange wash, a 272px contents column beside a line, grey admonition cards with an uppercase label, and wso2.com's footer. Sizes are the designs' px on a 16px root, written in rem so text follows the reader's browser setting. Parts the designs don't show (admonition types, code blocks, tables, cards, API pages, dark mode) are derived from the same tokens. One theme serves every Doc space, the Landing page and Contribute. It replaces the theme from the WSO2 product docs sites. [user decision 2026-10-29 (theme from the WSO2 Docs designs)]
- **The theme is one folder, `site/wso2-theme/`, and style only**: colours, type, spacing, transitions, fonts, the logo and favicon images, and the code colours. `css/` holds `theme.css`, the one hand-written file with every colour, type, radius, shadow and spacing variable, keyed on Docusaurus's `[data-theme]`, with Infima's variables mapped onto them, and the stylesheets that read only these: the Platform's components (`chrome.css` for the header, menus, notices, page end, footer and Landing; `api-reference.css`; `layouts.css` for overview and catalog pages), `custom.css` for doc pages, `nav-icons.css`, `code.css` and `fonts.css`. The Platform's component stylesheets are in the theme, so a change to them skips the rebuild too. `fonts/` and `img/` hold the font files, the logo and the favicons. What markup or JavaScript decides is not the theme. No theme JavaScript ships to readers. It replaces the earlier theme generated from Oxygen UI tokens. [user decision 2026-10-28 (theme from the WSO2 product docs sites)] [user decision 2026-10-29 (theme from the WSO2 Docs designs)] [user decision 2026-10-28 (theme without rebuilding)] [F03] [F13]
- **One theme per Platform major, linked by every page at a host-root address**: the stylesheet at `/_platform/theme/v<major>/theme.css` (the major of the Platform's `package.json` version), and the favicons and the logo's images (the wso2.com bar and the footer) at `/_platform/theme/v<major>/img/`, never under the deployment's baseUrl. `lib/theme-bundle.mjs` writes the bundle: one self-contained `theme.css` (the stylesheets in cascade order, with `@font-face` for Inter and Inter Tight) beside `fonts/` and `img/`, every `url()` in it naming a file of the bundle by its address. It is served as written, without Docusaurus's PostCSS (autoprefixer, `postcss-preset-env`), so it writes its own vendor prefixes. The stylesheet opens `<body>`, after the build's own stylesheet, so the theme wins over Infima and Docusaurus as it did when it was bundled after them, and a script after it holds the page until it has loaded. Infima, Docusaurus's component CSS and the two stylesheets Platform components import (the search pop-up's `search.css` and the page actions' CSS module) stay in each build's `styles.<hash>.css`; the build lists no `customCss`. Builds carry no fallback copy for the edge. [user decision 2026-10-28 (theme without rebuilding)]
- **Away from the edge, a page shows the theme of the checkout it was built from.** A build writes the bundle into its output at `_platform/theme/v<major>/`, where a static server rooted at the deployment, or at the Landing build with the deployments under it, finds it; `preview` (`--exact` too) serves it at that host-root address and swaps it in when a file in `site/wso2-theme/` changes. On the edge, the live theme wins. [user decision 2026-10-28 (theme without rebuilding)]
- **The theme names only stable class names**: Infima's (`menu__*`, `navbar__*`, `table-of-contents__*` and the rest), Docusaurus's stable theme class names (`theme-*`, `docs-doc-page`, `main-wrapper`), Prism's (`token`, its token types, `token-line`) and the Platform's own `wso2-*`, and otherwise reaches an element by structure (the doc page's `main`, the `div` around its `article`, an admonition's first and second `div`). It never names one of Docusaurus's CSS-module classes (`.sidebar_njMd`, `[class*='docItemContainer']`), which change with Docusaurus's version, since one theme serves deployments built at different times. `test/theme-bundle.test.mjs` refuses them. [user decision 2026-10-28 (theme without rebuilding)]
- **Code colours are CSS, not HTML.** The code highlighter gives the page no colour; `code.css` colours Prism's token classes with `theme.css`'s `--wso2-code-*` variables (prism-react-renderer's Oceanic Next, each at least 4.5:1 on the code background), and a token of several types takes its last type's colour, as the highlighter did. [user decision 2026-10-28 (theme without rebuilding)]
- **An Infima variable Docusaurus computes with is one value.** Docusaurus halves, negates and combines `--ifm-pre-padding` for the code blocks' copy and wrap buttons, title, highlighted lines and line numbers, so the theme sets it to one length, `--wso2-code-padding` (1rem, the code's side padding); the smaller padding above and below the code, `--wso2-code-padding-block` (0.875rem), is set apart on `pre` and on the code block's `pre > code`. Those features then render as Docusaurus intends: a title with 1rem at its sides, highlighted lines across the block's full width, line numbers in their own padded column. The buttons sit at half the padding above the code from the top, beside the first line, instead of Docusaurus's half of 1rem. `test/theme-bundle.test.mjs` refuses two values in a variable Docusaurus computes with. [user decision 2026-10-28 (theme without rebuilding)]
- **The fonts are Inter for text and Inter Tight for headings**, loaded as font files from the theme (`site/wso2-theme/fonts/`): each the variable font's normal style, copied from `@fontsource-variable/inter` 5.2.8 and `@fontsource-variable/inter-tight` 5.3.0, SIL Open Font License 1.1, attributed in `THIRD-PARTY-NOTICES.md`. [user decision 2026-10-28 (theme without rebuilding)] [user decision 2026-10-29 (theme from the WSO2 Docs designs)]
- **The theme meets WCAG 2.2 AA.** In light mode WSO2 orange `#ff7300` (2.7:1 on white) is for accents only: chevrons, borders, bars. Links use `#d43100` (4.9:1), the current page `#c42c00` on its orange wash. Dark mode is the brand navy (`#111a2e`, text `#f2f4f7`, links `#ee5a28`); the docs bar and the Landing page are navy in both modes. Links in running text are not underlined at rest: they are semibold and at least 3:1 from the text around them, and underlined on hover and focus, so colour is never the only cue. A test checks every text pair against AA, the focus ring against 3:1, links against the text, and the code blocks' syntax colours. [F13] [F24] [F29] [user decision 2026-10-29 (theme from the WSO2 Docs designs)]
- **Navigation moves little, and not at all for readers who ask for less motion.** Sections open and close at once (Docusaurus's height animation is cut to 1ms in CSS, which keeps the event it finishes on); chevrons turn 0° to 90° over 0.2s; the phone menu slides in over 0.25s over a fading overlay. Under `prefers-reduced-motion: reduce` every animation and transition stops. [user decision 2026-10-28 (theme from the WSO2 product docs sites)]
- **Light, dark and follow-system modes are supported, and Docusaurus is the only owner of the mode**; the choice is shared across WSO2 Docs through the origin. [F13]
- **Only safe swizzles.** Header widgets are custom navbar item types; the stock `Navbar` is never ejected or wrapped, so the wso2.com bar is rendered by the `Root` wrapper, above it. Today the Platform ejects `NavbarItem/ComponentTypes`, `SearchBar` and `Footer`, and wraps `MDXContent`, `NotFound`, `DocItem/Metadata`, `DocSidebarItems` and `DocBreadcrumbs/Items`. An unsafe swizzle needs a written reason and a test. The theme lives once, in the Platform. [F13] [F29] [N17] [N18]
- **Doc pages keep the stock Docusaurus layout**: sidebar left, table of contents right, breadcrumbs (starting with the Docs section). [F13] [N18]

## Page furniture

- **Every page ends with "Was this page helpful?" Yes / No**; No shows reason chips (inaccurate, missing information, hard to follow, example doesn't work, other) and a "Tell us more on GitHub" link. There is no free-text box, so WSO2 stores no personal data. Votes go to the Edge Worker's `POST /api/feedback`, counted cookie-free in Workers Analytics Engine; the payload contract is `lib/page-links.mjs`, and the Worker keeps its own copy of the reason ids. [F22] [F29] [F31]
- **"Edit this page" goes to the file on `main` when the page exists there**, else on the Edition's own branch, and to the spec YAML on API pages. Fixes go to `main` first. `editLinks: false` in the Doc space manifest hides it; the Pilot's generated repos set it. [F22] [N17]
- **"Report an issue" opens a prefilled GitHub issue** (page URL, Edition, selected text) in the Doc space's `issues` repo; during the Pilot that is the legacy repo. [F22]
- **No Edition chip under the breadcrumb and no "Last updated" line**: the version selector and notices already name the Edition, and every last update would be a bot's. [user decision 2026-10-29 (theme from the WSO2 Docs designs)]
- **The footer is wso2.com's**: WSO2's logo, columns of links (Products, Resources, Support, Discover) and the copyright and legal links (WSO2 Legal, Privacy policy, Cookie policy, which CookiePro's consent links to), all from `chrome.json`. [user decision 2026-10-29 (theme from the WSO2 Docs designs)]
- **The "Copy page" menu** sits after the title: see [ai-and-llm-outputs.md](ai-and-llm-outputs.md). [F21] [F32]

## Analytics

- **Page analytics are WSO2's GTM container (`GTM-PSTXMT`) behind the CookiePro consent banner**, CookiePro first so it can block tags until the reader consents. No other tracker is added; marketing owns what runs inside GTM. [F22]
- **Both load only on the production host**, from the same bytes, so staging and PR previews load none. [F22] [F29]
- **The Platform pushes a fixed set of `dataLayer` events**, each with Doc space, Edition and page type: `docs_page_view`, `docs_edition_switch`, `docs_search`, `docs_copy_page`, `docs_open_in_ai`, `docs_feedback`, `docs_404`. [F22] [F29]
- **A weekly digest per Doc space goes to its owners**: helpfulness and top No reasons, searches with no results, the most frequent 404s, new reported issues. Where it is posted is not decided: see [open-items.md](open-items.md#undecided). [F22] [F31]

## Landing page

- **The Landing deployment is Platform-owned and belongs to no Doc space.** Its home page is navy in both modes, with the wso2.com bar but no docs bar: a search-first hero ("WSO2 Documentation") with 4-6 popular links under the search box, one catalogue of the products menu's groups with one link per entry, then Learn and Community columns. The hero, popular links and columns are in `chrome/landing.yaml`; a column lists only entries with a real URL. The full search page at `/search/` keeps the docs bar. "What's new", personalisation and the designs' "WSO2 Developer" band (until a WSO2 Developer site exists) are out. [F13] [F29] [F30] [N18] [user decision 2026-10-29 (theme from the WSO2 Docs designs)]

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
