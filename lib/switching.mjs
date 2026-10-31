// The Platform chrome's navigation rules: the products menu, the Docs section
// menu, the version selector next to the product and the menu dropdowns,
// same-page mapping, the remembered-choice banner and the version notices.
// Ported from the version-switching prototype (wso2docs branch
// prototype/version-switching-two-selectors, its `logic` block), which the
// user confirmed in "Version switching with the header selector and menu
// dropdowns". Pure functions over the published Deployment manifest (no Node
// built-ins): the header and menu components, the Landing page and the tests
// share them.
//
// A view is the deployment serving the page plus the path in it:
//   { space, edition, path }
// where `edition` is the real Edition id ('cloud', '7.3.0'; never 'latest')
// and `path` is relative to the deployment's base: '' (home) or 'guides/mfa/'.
// In a family Cloud tree a Cloud part's pages are under '<part>/'.
// A focus is what the reader is reading: { doc, edition, rel, inPart? }, where
// a Cloud part's pages count as the component's Cloud.
// Deployments map `<space>@<edition>` (depKey) to { pages: Set | string[],
// redirects: { from: to } }, paths relative to that deployment
// (normaliseDeployment of its _platform/pages.json and redirects.json).

// ---- The manifest -------------------------------------------------------------

export function spaceOf(manifest, slug) {
  return manifest?.docSpaces?.[slug] ?? null;
}

const isLegacy = (e) => e?.status === 'legacy';
const isEol = (e) => e?.status === 'end-of-life' || e?.status === 'eol';
// The Doc space's own live Editions, in manifest order (never sorted: a date
// version such as 2026.09.24 keeps its place).
const ownEditions = (d) => (d?.editions ?? []).filter((e) => !isLegacy(e));
export const legacyVersions = (d) => (d?.editions ?? []).filter(isLegacy).map((e) => ({ id: e.id, url: e.legacyUrl }));

// The platform a component's Cloud lives in as a Cloud part (cloud.in), when
// the component has no Cloud Edition of its own. Until the platform's Cloud
// tree is deployed (`cloudPartPending`, which the published manifest and the
// menus built into a page set), the component has only its Self-hosted
// versions, so it opens on the newest release.
export const cloudIn = (d) => (d?.cloud?.in && !d.cloudPartPending && !ownEditions(d).some((e) => e.id === 'cloud') ? d.cloud.in : null);
export const partsOf = (d) => ownEditions(d).find((e) => e.id === 'cloud')?.parts ?? [];
export const hasCloud = (d) => ownEditions(d).some((e) => e.id === 'cloud') || Boolean(cloudIn(d));
const selfHosted = (d) => ownEditions(d).filter((e) => e.id !== 'cloud').map((e) => e.id);
// The newest release: the first Self-hosted Edition in manifest order (the
// manifest's `latest`, which compose sets the same way).
export function newestRelease(d) {
  const ids = selfHosted(d);
  return d?.latest && d.latest !== 'cloud' && ids.includes(d.latest) ? d.latest : ids[0] ?? null;
}
// Where a Doc space opens: Cloud where it has Cloud (its own, or its Cloud
// part), else its newest release.
export const latestOf = (d) => (hasCloud(d) ? 'cloud' : newestRelease(d) ?? ownEditions(d)[0]?.id ?? null);
// The Editions a version selector lists: Cloud first, then the Self-hosted
// versions in manifest order. Legacy versions are listed apart.
export const editionList = (d) => (hasCloud(d) ? ['cloud'] : []).concat(selfHosted(d));
const versioned = (d) => Boolean(d) && d.model !== 'unversioned' && d.model !== 'links-out' && d.status !== 'legacy' && editionList(d).length > 0;

// "Identity Platform Cloud", "AI Gateway Cloud", "Identity Server 7.3.0". Never says "latest".
export function editionName(space, id) {
  if (!space) return id;
  if (id === 'cloud') return space.editionNames?.cloud ?? `${space.displayName} Cloud`;
  const pattern = space.editionNames?.selfHosted ?? `${space.displayName} {version}`;
  return pattern.replaceAll('{version}', id);
}

// A dropdown item's text: "Cloud" (or "Cloud (<brand>)"), and the newest
// Self-hosted version marked "(newest release)" when the Doc space has Cloud,
// "(latest)" when it does not.
export function editionLabel(space, id) {
  if (id === 'cloud') return space?.brand ? `Cloud (${space.brand})` : 'Cloud';
  const newest = newestRelease(space);
  return editionName(space, id) + (id === newest ? newestSuffix(space) : '');
}
// The mark on the newest release, wherever an Edition is named (selectors,
// search, llms.txt, Markdown twins, overview cards).
export const newestSuffix = (space) => (hasCloud(space) ? ' (newest release)' : ' (latest)');
// The short form, for the button and the menu dropdowns: "Cloud", "7.3.0".
export const shortLabel = (space, id) => (id === 'cloud' ? editionLabel(space, 'cloud') : id);

// ---- Views and addresses ------------------------------------------------------

export function focus(manifest, view) {
  const d = spaceOf(manifest, view.space);
  if (view.edition === 'cloud') {
    const part = partsOf(d).find((p) => view.path.startsWith(`${p}/`));
    if (part) return { doc: part, edition: 'cloud', rel: view.path.slice(part.length + 1), inPart: view.space };
  }
  return { doc: view.space, edition: view.edition, rel: view.path };
}

// The view that serves a Doc space's Edition: a component's Cloud is its part
// in its platform's Cloud tree.
export function toView(manifest, doc, edition, rel = '') {
  const platform = edition === 'cloud' ? cloudIn(spaceOf(manifest, doc)) : null;
  if (platform) return { space: platform, edition: 'cloud', path: `${doc}/${rel}` };
  return { space: doc, edition, path: rel };
}

const unversioned = (manifest, slug) => spaceOf(manifest, slug)?.model === 'unversioned';
// The address of a view. `latest: true` gives the newest release's /latest/
// address (where a product opens), else the pinned Edition.
export function viewUrl(manifest, view, { latest = false } = {}) {
  if (unversioned(manifest, view.space)) return `/${view.space}/${view.path}`;
  const d = spaceOf(manifest, view.space);
  const seg = latest && view.edition !== 'cloud' && view.edition === newestRelease(d) ? 'latest' : view.edition;
  return `/${view.space}/${seg}/${view.path}`;
}
export const homeUrl = (manifest, doc, edition, o) => viewUrl(manifest, toView(manifest, doc, edition, ''), o);
// Where a products-menu or section-menu entry opens: its latest (Cloud first),
// or the Edition and page it names.
export function opensUrl(manifest, opens) {
  const d = spaceOf(manifest, opens.docSpace);
  if (!d) return null;
  if (d.status === 'legacy') return d.legacyUrl ?? null;
  if (unversioned(manifest, opens.docSpace)) return `/${opens.docSpace}/${opens.page ?? ''}`;
  const edition = opens.edition ?? latestOf(d);
  return viewUrl(manifest, toView(manifest, opens.docSpace, edition, opens.page ?? ''), { latest: !opens.edition });
}

export const depKey = (view) => `${view.space}@${view.edition}`;
// Where a view's deployment publishes its _platform files.
export const deploymentBase = (manifest, view) => (unversioned(manifest, view.space) ? `/${view.space}/` : `/${view.space}/${view.edition}/`);

// "Copy permanent link": the pinned Edition's address, also when reading /latest/.
export function permanentUrl(origin, manifest, view, hash = '') {
  return `${origin}${viewUrl(manifest, view)}${hash}`;
}

// ---- Same-page mapping ----------------------------------------------------------

const hasPage = (d, p) => (d.pages instanceof Set ? d.pages.has(p) : d.pages.includes(p));

// Where the page `from.path` is in the target view `to`: the same page, a
// renamed one (followed through either side's redirects: the target's own map
// for newer Editions, the source's map inverted for older ones), its
// counterpart (a Self-hosted-only page and the Cloud page it names in
// `cloudCounterpart`, either way), missing, or unknown (the target's page list
// is not loaded). Missing and unknown go to the target Doc space's home page.
// Each view carries `prefix`: the Cloud part's folder inside a Cloud tree
// ('ai-gateway/'), else ''.
export function mapPage(deployments, from, to) {
  const toPrefix = to.prefix ?? '';
  const fromPrefix = from.prefix ?? '';
  const home = { ...to, path: toPrefix };
  const t = deployments[depKey(to)];
  if (!t) return { kind: 'unknown', view: home };
  if (hasPage(t, to.path)) return { kind: 'same', view: to };
  const fwd = t.redirects?.[to.path];
  if (fwd !== undefined && hasPage(t, fwd)) return { kind: 'renamed', view: { ...to, path: fwd } };
  const s = deployments[depKey(from)];
  for (const [old, now] of Object.entries(s?.redirects ?? {})) {
    if (now !== from.path || !old.startsWith(fromPrefix)) continue;
    const there = toPrefix + old.slice(fromPrefix.length);
    if (hasPage(t, there)) return { kind: 'renamed', view: { ...to, path: there } };
  }
  // Counterparts are paths inside the Doc space, without a part's prefix.
  const rel = from.path.slice(fromPrefix.length);
  const mine = s?.counterparts?.[rel];
  if (mine !== undefined && hasPage(t, toPrefix + mine)) return { kind: 'counterpart', view: { ...to, path: toPrefix + mine } };
  const theirs = Object.entries(t.counterparts ?? {}).find(([page, cloud]) => cloud === rel && hasPage(t, toPrefix + page));
  if (theirs) return { kind: 'counterpart', view: { ...to, path: toPrefix + theirs[0] } };
  return { kind: 'missing', view: home };
}

// The view of `doc`'s Edition `id` for the page `rel`, with its part prefix.
function targetView(manifest, doc, id, rel) {
  const v = toView(manifest, doc, id, rel);
  return { ...v, prefix: v.path.slice(0, v.path.length - rel.length) };
}
const sourceView = (view, f) => ({ ...view, prefix: view.path.slice(0, view.path.length - f.rel.length) });
const plainView = ({ space, edition, path }) => ({ space, edition, path });

// ---- The version selector next to the product -------------------------------

const GROUP_CLOUD = 'Cloud';
const GROUP_SELF = 'Self-hosted';
const GROUP_LEGACY = 'Older versions (old site)';

// Always shown for a versioned Doc space, for the Doc space being read: inside
// a Cloud part, the component's Editions. Items say where they lead once the
// deployments' page lists are known: "current", "same", "renamed", "missing"
// (its home page) or "unknown" (not loaded yet: its home page).
export function headerSelector(manifest, deployments, view, { asLatest = false } = {}) {
  const f = focus(manifest, view);
  const d = spaceOf(manifest, f.doc);
  if (!versioned(d)) return null;
  const ids = editionList(d);
  if (!ids.includes(f.edition)) ids.unshift(f.edition); // an Edition the manifest does not list (yet) still shows
  const from = sourceView(view, f);
  const items = ids.map((id) => {
    const base = {
      id, label: editionLabel(d, id), short: shortLabel(d, id), name: editionName(d, id),
      group: id === 'cloud' ? GROUP_CLOUD : GROUP_SELF, eol: isEol(ownEditions(d).find((e) => e.id === id)),
    };
    if (id === f.edition) return { ...base, current: true, mapping: 'current', href: viewUrl(manifest, view, { latest: asLatest }) };
    const r = mapPage(deployments, from, targetView(manifest, f.doc, id, f.rel));
    return { ...base, current: false, mapping: r.kind, href: viewUrl(manifest, plainView(r.view)) };
  });
  const legacy = legacyVersions(d).map((l) => ({
    id: l.id, label: `${editionName(d, l.id)} ↗`, short: `${l.id} ↗`, name: editionName(d, l.id), group: GROUP_LEGACY, current: false, mapping: 'old site', href: l.url, external: true,
  }));
  const all = [...items, ...legacy];
  const groups = [GROUP_CLOUD, GROUP_SELF, GROUP_LEGACY].map((g) => ({ label: g, items: all.filter((i) => i.group === g) })).filter((g) => g.items.length);
  const current = items.find((i) => i.current);
  return { doc: f.doc, product: d.displayName, value: f.edition, label: current.label, short: current.short, name: current.name, groups, items: all };
}

export const MAPPING_HINTS = { current: 'you are here', same: 'same page', renamed: 'renamed page', counterpart: 'matching page', missing: 'page not in it: home page', unknown: '', 'old site': 'old site ↗' };

// ---- Choosing a version ---------------------------------------------------------

// Choosing Edition `id` of Doc space `doc`, in the header selector or a menu
// dropdown. For the Doc space being read it keeps the reader on the same page
// (or a renamed one), else its home page with a notice; for another Doc space
// it opens that Doc space's home page at that version, with no mapping. The
// choice is remembered for `doc`. A Legacy version opens its old site.
export function choose(manifest, deployments, view, doc, id, { asLatest = false } = {}) {
  const d = spaceOf(manifest, doc);
  const legacy = legacyVersions(d).find((l) => l.id === id);
  if (legacy) return { kind: 'legacy', url: legacy.url, external: true, remember: null, notice: null };
  const f = focus(manifest, view);
  const name = editionName(d, id);
  if (f.doc !== doc) {
    return { kind: 'other', url: homeUrl(manifest, doc, id), view: toView(manifest, doc, id, ''), remember: id, notice: null };
  }
  if (id === f.edition) return { kind: 'noop', noop: true, url: null, remember: asLatest ? 'latest' : id, notice: null };
  const r = mapPage(deployments, sourceView(view, f), targetView(manifest, doc, id, f.rel));
  const notice = {
    unknown: `We couldn't check whether this page is in ${name}, so you're on its home page.`,
    missing: `This page isn't in ${name}. You're on its home page instead.`,
    renamed: `This page has a different name in ${name}.`,
  }[r.kind] ?? null;
  const target = plainView(r.view);
  return { kind: r.kind, url: viewUrl(manifest, target), view: target, remember: id, notice };
}

// The banner when arriving (from search or a link) on another Edition than the
// one this browser chose last for the Doc space: an offer, only when that
// Edition has the page, and never a redirect.
export function arrivalBanner(manifest, deployments, view, remembered) {
  const f = focus(manifest, view);
  if (!remembered || remembered === 'latest' || remembered === f.edition) return null;
  const d = spaceOf(manifest, f.doc);
  if (!d || !editionList(d).includes(remembered)) return null;
  const r = mapPage(deployments, sourceView(view, f), targetView(manifest, f.doc, remembered, f.rel));
  if (r.kind !== 'same' && r.kind !== 'renamed' && r.kind !== 'counterpart') return null;
  return {
    doc: f.doc, edition: remembered, url: viewUrl(manifest, plainView(r.view)),
    text: `You usually read ${editionName(d, remembered)}. Open this page there?`, action: 'Open it there',
  };
}

// ---- Version notices ------------------------------------------------------------

// From the manifest, so an old build learns about a newer release without a
// rebuild. On an older release: the newest release, and a pointer to Cloud. On
// Cloud: that some features may not be in a release yet, only on a page that shows
// Cloud-only content (`cloudContent`, worked out by the build per page), else
// which Cloud is read and the newest release. On the newest release:
// nothing. End of life: as before.
export function versionNotice(manifest, view, { cloudContent = false } = {}) {
  const f = focus(manifest, view);
  const d = spaceOf(manifest, f.doc);
  if (!versioned(d)) return null;
  if (isEol(ownEditions(d).find((e) => e.id === f.edition))) {
    return { kind: 'eol', text: `${editionName(d, f.edition)} has reached end of life. It is no longer updated.` };
  }
  const newest = newestRelease(d);
  if (f.edition === 'cloud') {
    if (!newest) return null;
    // "Newest features" only where the page shows Cloud-only content (`cloudContent`, from the build).
    return cloudContent
      ? { kind: 'cloud', text: `Cloud has the newest features. Some may not be in a release yet; the newest release is ${d.displayName} ${newest}.` }
      : { kind: 'cloud', text: `You're reading ${editionName(d, 'cloud')}. The newest release is ${d.displayName} ${newest}.` };
  }
  if (!newest || f.edition === newest) return null;
  return {
    kind: 'older', newest,
    text: `You're reading ${d.displayName} ${f.edition}. The newest release is ${newest}${hasCloud(d) ? ', and Cloud has the newest features' : ''}.`,
    action: 'Go to the newest release', url: `/${f.doc}/latest/`,
  };
}

// ---- The Docs section menu --------------------------------------------------------

// A link entry's address is outside WSO2 Docs (a Doc space entry links inside).
export const isLinkEntry = (item) => typeof item?.url === 'string' && typeof item?.label === 'string' && item.docSpace === undefined;

// One Docs section's menu from the published manifest: Doc space entries
// ({ kind: 'docSpace', slug, name, href, versionIn }) and link entries
// ({ kind: 'link', label, href, external: true }, shown with ↗), in the
// section manifest's order. Doc spaces the manifest does not carry (not on
// WSO2 Docs in this environment) are left out.
export function sectionMenu(manifest, sectionId) {
  const sec = manifest?.sections?.[sectionId];
  if (!sec) return null;
  const entries = [];
  for (const item of sec.menu ?? []) {
    if (isLinkEntry(item)) {
      entries.push({ kind: 'link', label: item.label, href: item.url, external: true });
      continue;
    }
    const s = spaceOf(manifest, item.docSpace);
    if (!s) continue;
    entries.push({ kind: 'docSpace', slug: item.docSpace, name: s.displayName, href: `/${item.docSpace}/`, versionIn: item.versionIn ?? 'header' });
  }
  return { id: sectionId, title: sec.title, entries };
}

const lists = (manifest, sectionId, slug) => (manifest?.sections?.[sectionId]?.menu ?? []).some((e) => e.docSpace === slug);

// Which Docs section's menu to draw: the one the reader came through this
// session (`remembered`: { <doc space>: <section> }), when it lists the Doc
// space being read; else its home section. A Cloud part counts as its
// component. Null for a Doc space in no section (Contribute, Unlisted ones).
export function sectionFor(manifest, view, remembered = {}) {
  const f = focus(manifest, view);
  const slugs = [...new Set([f.doc, view.space])];
  for (const slug of slugs) {
    const sid = remembered?.[slug];
    if (sid && slugs.some((s) => lists(manifest, sid, s))) return sid;
  }
  for (const slug of slugs) {
    const home = spaceOf(manifest, slug)?.home;
    if (home && manifest?.sections?.[home]) return home;
  }
  return null;
}

// A menu dropdown: its Editions with short labels, each opening that Edition's
// home page (for the Doc space being read the component maps the same page).
function entryDropdown(manifest, slug, value) {
  const d = spaceOf(manifest, slug);
  const items = editionList(d).map((id) => ({ id, label: shortLabel(d, id), name: editionName(d, id), href: homeUrl(manifest, slug, id), current: id === value }))
    .concat(legacyVersions(d).map((l) => ({ id: l.id, label: `${l.id} ↗`, name: editionName(d, l.id), href: l.url, external: true, current: false })));
  return { value, label: shortLabel(d, value), name: editionName(d, value), items };
}

const shortTitle = (title) => String(title ?? '').replace(/\s+Documentation$/, '');

// The section menu as drawn while `view` is open. The Doc space serving the
// page is open (its tree is the deployment's own sidebar); every other entry
// is one collapsed line with its name and, if set to `version-in: menu`, its
// dropdown on the same line, which shows the Edition being read for the Doc
// space being read (in step with the header selector) and its latest for the
// others. Inside a Cloud part the component's entry is active, with its
// dropdown on Cloud; if the section does not list the platform (a borrowed
// component), the component's entry shows the part's tree alone (`onlyPart`).
export function menu(manifest, view, sectionId) {
  const base = sectionMenu(manifest, sectionId);
  if (!base) return null;
  const sec = manifest.sections[sectionId];
  const f = focus(manifest, view);
  const platformListed = base.entries.some((e) => e.kind === 'docSpace' && e.slug === view.space);
  const entries = base.entries.map((e) => {
    if (e.kind === 'link') return e;
    const d = spaceOf(manifest, e.slug);
    const isFocus = e.slug === f.doc;
    const open = e.slug === view.space || (isFocus && Boolean(f.inPart) && !platformListed);
    const value = isFocus ? f.edition : latestOf(d);
    const home = d?.home ?? null;
    return {
      ...e,
      href: isFocus ? homeUrl(manifest, e.slug, f.edition) : opensUrl(manifest, { docSpace: e.slug }),
      active: isFocus || e.slug === view.space,
      focus: isFocus,
      open,
      onlyPart: open && e.slug !== view.space ? f.doc : null,
      borrowed: Boolean(home) && home !== sectionId,
      homeTitle: home ? manifest.sections?.[home]?.title ?? null : null,
      dropdown: e.versionIn === 'menu' && versioned(d) ? entryDropdown(manifest, e.slug, value) : null,
    };
  });
  return { id: sectionId, title: base.title, name: sec.family ?? shortTitle(base.title), entries };
}

// ---- The products menu and the Landing page ---------------------------------------

// The groups of the published products menu (compose's `productsMenu`: the
// families in wso2.com's order, then Solutions and Other), or, for an older
// manifest, the same worked out from `families` and the sections' families.
function menuGroups(manifest) {
  if (Array.isArray(manifest?.productsMenu) && manifest.productsMenu.length) return manifest.productsMenu;
  const sections = Object.entries(manifest?.sections ?? {});
  return (manifest?.families ?? []).map((name) => ({
    id: name, name, kind: 'family',
    sections: sections.filter(([, s]) => s.family === name).map(([id]) => id),
    entries: sections.filter(([, s]) => s.family === name).flatMap(([id, s]) => (s.products ?? []).map((p) => ({ ...p, section: id }))),
  }));
}
const isFamilyCloud = (d) => versioned(d) && editionList(d).length === 1 && editionList(d)[0] === 'cloud' && !cloudIn(d);

// The products menu (and the Landing page, which draws the same list): one
// group per family, then Solutions and Other, each with the family's Cloud
// first (the family-level Cloud Doc space its section lists), then its
// products as its section manifests label and order them, then the products
// not on WSO2 Docs yet (their old site ↗), then the sections' link entries
// (↗). A product opens its latest: Cloud where it has Cloud, so a component
// opens its part in its platform's Cloud tree. Choosing one opens its section,
// which the chrome remembers for the session. Doc spaces in no section
// (Contribute, Unlisted ones) are never in it. With `view`, the entry being
// read is `current`.
export function productsMenu(manifest, view = null) {
  const f = view ? focus(manifest, view) : null;
  let marked = false;
  const groups = menuGroups(manifest).map((g) => {
    const entries = [];
    const seen = new Set();
    const add = (e) => {
      const key = `${e.href}|${e.label}`;
      if (!e.href || seen.has(key)) return;
      seen.add(key);
      entries.push({ external: false, linksOut: false, ...e });
    };
    const sections = (g.sections ?? []).filter((sid) => manifest.sections?.[sid]);
    for (const sid of sections) {
      for (const item of manifest.sections[sid].menu ?? []) {
        const d = isLinkEntry(item) ? null : spaceOf(manifest, item.docSpace);
        if (isFamilyCloud(d)) add({ kind: 'cloud', label: d.displayName, docSpace: item.docSpace, section: sid, page: null, href: homeUrl(manifest, item.docSpace, 'cloud') });
      }
    }
    for (const p of g.entries ?? []) {
      const d = spaceOf(manifest, p.opens?.docSpace);
      if (!d) continue;
      add({ kind: p.opens.page ? 'page' : 'product', label: p.label, docSpace: p.opens.docSpace, section: p.section ?? null, page: p.opens.page ?? null, href: opensUrl(manifest, p.opens), external: d.status === 'legacy' });
    }
    for (const [slug, d] of Object.entries(manifest.docSpaces ?? {})) {
      if (d.status === 'legacy' && d.family === g.name && d.legacyUrl && d.listed !== false) {
        add({ kind: 'legacy', label: d.displayName, docSpace: slug, section: null, page: null, href: d.legacyUrl, external: true, linksOut: d.model === 'links-out' });
      }
    }
    for (const sid of sections) {
      for (const item of manifest.sections[sid].menu ?? []) {
        if (isLinkEntry(item)) add({ kind: 'link', label: item.label, docSpace: null, section: sid, page: null, href: item.url, external: true, linksOut: true });
      }
    }
    for (const e of entries) {
      const d = e.kind === 'cloud' || e.kind === 'product' ? spaceOf(manifest, e.docSpace) : null;
      e.kinds = d ? [...(hasCloud(d) ? ['Cloud'] : []), ...(newestRelease(d) ? ['Self-hosted'] : [])] : [];
      e.current = Boolean(!marked && f && e.docSpace === f.doc && !e.external && (!e.page || e.page === f.rel));
      if (e.current) marked = true;
    }
    return { id: g.id, name: g.name, kind: g.kind ?? 'family', description: g.description ?? null, entries };
  });
  return groups.filter((g) => g.entries.length);
}

// What the products button shows: the product being read (inside a Cloud
// part, the component), or "Products" where no Doc space is open.
export function productLabel(manifest, view) {
  if (!view?.space) return 'Products';
  return spaceOf(manifest, focus(manifest, view).doc)?.displayName ?? 'Products';
}

// The Landing page: the products menu's groups, in the same order, with the
// same entries, each one link to where the products menu opens it (Cloud
// first). Nothing is current there, and the groups' descriptions are not shown.
export function landingGroups(manifest) {
  return productsMenu(manifest).map(({ description, ...g }) => ({
    ...g,
    entries: g.entries.map(({ current, ...e }) => e),
  }));
}

// ---- Runtime data -----------------------------------------------------------------

// Runtime manifest over the baked-in snapshot: the live copy is newer, but a
// field it lacks (an older format) keeps the snapshot's value. Deployment
// state is the live copy's alone: a Cloud part the snapshot saw waiting is
// pending only while the live copy says so.
export function mergeManifest(snapshot, live) {
  if (!live?.docSpaces) return snapshot;
  const docSpaces = {};
  for (const [slug, s] of Object.entries(live.docSpaces)) {
    docSpaces[slug] = { ...(snapshot?.docSpaces?.[slug] ?? {}), ...s };
    if (!s.cloudPartPending) delete docSpaces[slug].cloudPartPending;
  }
  return { ...snapshot, ...live, families: live.families ?? snapshot?.families ?? [], docSpaces };
}

// One deployment's _platform files, made relative to its baseUrl. Legacy
// entries (absolute URLs from old hosts) are not page moves and are skipped.
// A Self-hosted Edition's pages that name a Cloud counterpart keep it.
export function normaliseDeployment(pagesJson, redirectsJson, baseUrl) {
  const strip = (p) => (p.startsWith(baseUrl) ? p.slice(baseUrl.length) : null);
  const redirects = {};
  for (const r of redirectsJson ?? []) {
    const from = strip(r.from);
    const to = strip(r.to);
    if (from !== null && to !== null) redirects[from] = to;
  }
  const counterparts = Object.fromEntries((pagesJson ?? []).filter((p) => typeof p.cloudCounterpart === 'string').map((p) => [p.path, p.cloudCounterpart]));
  return { pages: new Set((pagesJson ?? []).map((p) => p.path)), redirects, ...(Object.keys(counterparts).length ? { counterparts } : {}) };
}

// Remembered Edition per Doc space (localStorage, an explicit choice only) and
// the Docs section the reader came through per Doc space (sessionStorage).
export const rememberKey = (slug) => `wso2docs:edition:${slug}`;
export const SECTION_KEY = 'wso2docs:section';

// For callers holding a { edition: 'latest' | <id> } view: the Edition it reads.
export const realEdition = (space, view) => (view.edition === 'latest' ? space?.latest ?? 'latest' : view.edition);

// ---- Team notices and section link entries (Extension points for product teams)

// The date in UTC, as chrome.json announcements count it (`until` inclusive).
const today = (now) => (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString().slice(0, 10);

// The notices a Doc space's team declares in its manifest (`notices`: text,
// level, the Editions they apply to, an optional last day), for the Edition
// being read. They come from the published manifest at runtime, so adding,
// changing or ending one needs no rebuild. `edition` is the real Edition id
// (never 'latest'); a notice that names no Editions applies to every one.
export function teamNotices(manifest, slug, edition, now = new Date()) {
  const space = spaceOf(manifest, slug);
  if (!space?.notices?.length) return [];
  const day = today(now);
  return space.notices
    .filter((n) => n && typeof n.text === 'string' && n.text.trim())
    .filter((n) => !n.editions?.length || n.editions.includes(edition))
    .filter((n) => !n.until || day <= n.until)
    .map((n) => ({ text: n.text, level: n.level === 'warning' ? 'warning' : 'info', ...(n.until ? { until: n.until } : {}) }));
}

// The link entries of every Docs section, by family (the section's Product family).
export function sectionLinks(manifest) {
  const out = new Map();
  for (const sec of Object.values(manifest?.sections ?? {})) {
    const links = (sec.menu ?? []).filter(isLinkEntry);
    if (!links.length || !sec.family) continue;
    const list = out.get(sec.family) ?? [];
    for (const l of links) if (!list.some((x) => x.href === l.url)) list.push({ label: l.label, href: l.url });
    out.set(sec.family, list);
  }
  return out;
}

// ---- The session's Docs section ---------------------------------------------------

// A page load is an arrival (from search, a bookmark or another site) when the
// referrer is not this host: the reader then sees the home section, as
// readers arriving from search do. Moving between deployments on this host
// keeps the section the reader came through.
export function isArrival(referrer, origin) {
  if (!referrer) return true;
  try {
    return new URL(referrer).origin !== origin;
  } catch {
    return true;
  }
}

// The session's { <doc space>: <section> } after the reader chooses a product
// in the products menu or an entry in a section's menu.
export function rememberSection(remembered, doc, sectionId) {
  if (!doc || !sectionId) return remembered ?? {};
  return { ...(remembered ?? {}), [doc]: sectionId };
}
