import { FEEDBACK_REASONS } from './feedback-reasons.mjs';
// Pure routing rules of the Edge Worker: request path -> release folder key,
// trailing-slash and latest redirects, cache policy. No bindings here, so the
// rules are easy to test and match lib/release.mjs's bucket layout.

export const NO_EDITION = '_';
export const LANDING = '_landing';
// One list of reason ids, shared with the widget.
export const REASONS = FEEDBACK_REASONS.map((r) => r.id);

const hasExtension = (segment) => /\.[A-Za-z0-9]+$/.test(segment);
const key = (space, segment, release, rel) => `_releases/${space}/${segment}/${release}/${rel}`;

// Decoded path segments, or null for a malformed escape.
export function segmentsOf(pathname) {
  try {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

// The Markdown twin of a page is served at <page>.md (AI/LLM-friendly docs).
// The build writes each twin at that relative path (worker/src/twin-paths.mjs):
// `…/guides/mfa.md` beside `…/guides/mfa/index.html`, an Edition home's twin at
// `index.md`, a joined `export: single` guide at `<folder>.md` (its folder's own
// index page then at `<folder>/index.md`). So the key is the path itself.
export function markdownTwinPath(rel) {
  return rel;
}

const deployed = (manifest, slug, segment) => Boolean(manifest.docSpaces?.[slug]?.deployments?.[segment]);
const hasCloud = (space) => (space?.editions ?? []).some((e) => e.id === 'cloud' && e.status !== 'legacy');

// Where a bare product address goes (URLs, latest and canonicals): where the
// version selector opens. Cloud where the Doc space has Cloud: its own
// /<slug>/cloud/, or, for a component whose Cloud is a Cloud part, the part in
// its platform's tree, /<platform>/cloud/<slug>/. Otherwise (or while that
// Cloud is not deployed) the newest release at /<slug>/latest/.
export function opensAt(manifest, slug) {
  const space = manifest.docSpaces?.[slug];
  if (!space) return null;
  if (hasCloud(space) && deployed(manifest, slug, 'cloud')) return `/${slug}/cloud/`;
  const platform = space.cloud?.in;
  if (platform && !hasCloud(space) && deployed(manifest, platform, 'cloud')) return `/${platform}/cloud/${slug}/`;
  if (deployed(manifest, slug, 'latest')) return `/${slug}/latest/`;
  const first = Object.keys(space.deployments ?? {})[0];
  if (first) return `/${slug}/${first}/`;
  return `/${slug}/${hasCloud(space) ? 'cloud' : 'latest'}/`;
}

// One of:
//   { type: 'redirect', status, location }      trailing slash (301); bare product address,
//                                                a Cloud-only /latest/, a part's /cloud/ or a
//                                                Legacy version's address, to its legacyUrl (302)
//   { type: 'object', key, notFoundKey, space, segment, edition, release, eol }
//   { type: 'miss', space, segment, notFoundKey } no such deployment
//   { type: 'bad' }                                malformed path
export function route(manifest, pathname) {
  const segs = segmentsOf(pathname);
  if (!segs) return { type: 'bad' };
  const slashed = pathname.endsWith('/');
  if (!slashed && segs.length && !hasExtension(segs.at(-1))) return { type: 'redirect', status: 301, location: `${pathname}/` };

  const [first, ...rest] = segs;
  const space = first ? manifest.docSpaces?.[first] : undefined;
  let spaceSlug;
  let segment;
  let deployment;
  let relSegs;
  if (!space) {
    // Everything outside a Doc space belongs to the Landing deployment.
    spaceSlug = LANDING;
    segment = NO_EDITION;
    deployment = manifest.landing;
    relSegs = segs;
  } else if (space.model === 'unversioned') {
    spaceSlug = first;
    segment = NO_EDITION;
    deployment = space.deployments?.[NO_EDITION];
    relSegs = rest;
  } else {
    if (!rest.length) return { type: 'redirect', status: 302, location: opensAt(manifest, first) };
    spaceSlug = first;
    segment = rest[0];
    deployment = space.deployments?.[segment];
    relSegs = rest.slice(1);
    const tail = relSegs.map(encodeURIComponent).join('/') + (relSegs.length && slashed ? '/' : '');
    if (!deployment) {
      // A Cloud-only Doc space has no /latest/ copy: its latest is its Cloud.
      if (segment === 'latest' && space.latest === 'cloud' && space.deployments?.cloud) return { type: 'redirect', status: 302, location: `/${first}/cloud/${tail}` };
      // A component's Cloud lives in its platform's tree.
      const platform = space.cloud?.in;
      if (segment === 'cloud' && platform && !hasCloud(space) && deployed(manifest, platform, 'cloud')) {
        return { type: 'redirect', status: 302, location: `/${platform}/cloud/${first}/${tail}` };
      }
      // A Legacy version (one retired from WSO2 Docs, or never on it) lives on
      // its old site: every address under it goes to that Edition's home there.
      const legacy = space.editions?.find((e) => e.id === segment && e.status === 'legacy');
      if (legacy?.legacyUrl) return { type: 'redirect', status: 302, location: legacy.legacyUrl };
    }
  }

  const fallback = space ? (space.deployments?.latest ?? space.deployments?.[NO_EDITION] ?? Object.values(space.deployments ?? {})[0]) : manifest.landing;
  const fallbackSegment = space ? Object.entries(space.deployments ?? {}).find(([, d]) => d === fallback)?.[0] : NO_EDITION;
  const notFoundFor = (seg, d) => (d ? key(spaceSlug, seg, d.release, '404.html') : null);
  if (!deployment) return { type: 'miss', space: space ? first : null, segment: space ? segment : null, notFoundKey: notFoundFor(fallbackSegment, fallback) };

  let rel = relSegs.join('/');
  if (slashed) rel = rel ? `${rel}/index.html` : 'index.html';
  else if (rel.endsWith('.md')) rel = markdownTwinPath(rel);
  const edition = segment === 'latest' ? deployment.edition : segment;
  const eol = Boolean(space?.editions?.find((e) => e.id === edition)?.status === 'end-of-life');
  return {
    type: 'object',
    key: key(spaceSlug, segment, deployment.release, rel),
    notFoundKey: notFoundFor(segment, deployment),
    space: space ? first : null,
    segment: space ? segment : null,
    edition: space ? edition : null,
    release: deployment.release,
    eol,
    // An Unlisted Doc space (listed: false) is kept out of search engines,
    // unless it is an explicit exception (indexed: true, Contribute).
    unlisted: space?.listed === false && space?.indexed !== true,
  };
}

// Content-hashed build assets are cached forever; everything else (HTML,
// images, sitemaps, _platform/ files) keeps its URL across releases, so it is
// cached for a few minutes only.
export function cacheControl(key, maxAge = 300) {
  if (/\/assets\/(?:js|css|images|files|fonts)\/.+[.-][0-9a-f]{8,}\.[a-z0-9]+$/i.test(key)) return 'public, max-age=31536000, immutable';
  return `public, max-age=${maxAge}`;
}

// A feedback vote's page must be a page of a deployed Edition.
export function feedbackTarget(manifest, page) {
  if (typeof page !== 'string' || !page.startsWith('/') || page.length > 512) return null;
  const r = route(manifest, page.endsWith('/') ? page : `${page}/`);
  if (r.type !== 'object' || !r.space) return null;
  return { space: r.space, segment: r.segment, edition: r.edition };
}

// The shared theme (Releases and deployments: the shared theme). Every page
// links /_platform/theme/v<major>/theme.css (and its favicons and logo under
// img/): the live published theme of its Platform major, which the manifest's
// `theme` names. A published theme is an immutable folder,
// _releases/_theme/v<major>/<theme id>/, and the CSS fetches its fonts and
// images from it by id: /_platform/theme/v<major>/<theme id>/<file>.
// A theme id is <Platform version>.r<run id> (lib/shared-theme.mjs), so it
// never looks like a theme file or folder name.
export const THEME_PREFIX = '/_platform/theme/';
export const THEME_SPACE = '_theme';
export const THEME_ID = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.r[0-9A-Za-z-]+$/;
// The live theme keeps its address across publishes, so browsers keep it 5
// minutes and may use a stale copy while they fetch the new one; a file by
// theme id never changes.
export const THEME_LIVE_CACHE = 'public, max-age=300, stale-while-revalidate=86400';
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export const themeKey = (major, id, rel) => `_releases/${THEME_SPACE}/v${major}/${id}/${rel}`;

// /_platform/theme/v<major>/<rest> ->
//   { type: 'object', key, cache, major, release, pinned }   by id (pinned) or the live theme
//   { type: 'miss', major }                                    no live theme for that major, no file
//   { type: 'bad' }                                            malformed path
//   null                                                       not a theme path
export function themeRoute(manifest, pathname) {
  if (!pathname.startsWith(THEME_PREFIX)) return null;
  const segs = segmentsOf(pathname);
  if (!segs) return { type: 'bad' };
  const [, , majorSeg, ...rest] = segs;
  const major = /^v(\d+)$/.exec(majorSeg ?? '')?.[1];
  if (!major || !rest.length || pathname.endsWith('/') || rest.some((s) => s === '..' || s === '.' || s.includes('\\'))) return { type: 'miss', major: major ?? null };
  if (THEME_ID.test(rest[0])) {
    if (rest.length < 2) return { type: 'miss', major };
    return { type: 'object', key: themeKey(major, rest[0], rest.slice(1).join('/')), cache: IMMUTABLE_CACHE, major, release: rest[0], pinned: true };
  }
  const live = manifest?.theme?.[`v${major}`]?.release;
  if (!live) return { type: 'miss', major };
  return { type: 'object', key: themeKey(major, live, rest.join('/')), cache: THEME_LIVE_CACHE, major, release: live, pinned: false };
}
