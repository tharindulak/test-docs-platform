// Edition logic shared by the remark plugins, the page filter and the CLI.
// An edition is { id, kind, version }: id is 'cloud', 'next' or an exact
// version such as '7.3.0'; kind is 'cloud' or 'self-hosted'.
import semver from 'semver';

// Unversioned Doc spaces (Contribute) have one Edition and no Edition
// segment in their URLs; it is written '_', like their release folders.
export const UNVERSIONED = '_';

// A date version (AI Gateway's 2026.09.24) is an exact version too. It is not
// valid semver (leading zeros), so comparisons read it as 2026.9.24, which
// sorts after every numbered release. Readers still see versions in manifest
// order; this only decides "from version X on" markers and search ranking.
export const DATE_VERSION = /^\d{4}\.\d{2}\.\d{2}$/;
export function versionSemver(v) {
  const s = String(v ?? '');
  if (semver.valid(s)) return semver.valid(s);
  if (DATE_VERSION.test(s)) return s.split('.').map((n) => String(Number(n))).join('.');
  return null;
}
export const isExactVersion = (v) => versionSemver(v) !== null;

export function editionFromId(id) {
  if (id === UNVERSIONED) return { id, kind: 'cloud', version: null, unversioned: true };
  if (id === 'cloud') return { id, kind: 'cloud', version: null };
  if (id === 'next') return { id, kind: 'self-hosted', version: null };
  if (!isExactVersion(id)) {
    throw new Error(`Unknown edition "${id}": use "cloud", "next" or an exact version such as 7.3.0 (or a date version such as 2026.09.24)`);
  }
  return { id, kind: 'self-hosted', version: id };
}

// main publishes Cloud, or the upcoming version for versions-only Doc spaces;
// release/<version> publishes that version (Content repo contract). In a repo
// with several Doc spaces the release branches are <slug>/release/<version>,
// and the main line of a Cloud part (`cloud: { in: <platform> }` in its
// manifest) is its Cloud (Repo structure for Platform, sections and Doc spaces).
export function inferEditionId(branch, model, docspace = null) {
  if (model === 'unversioned') return UNVERSIONED;
  if (branch === 'main') return model === 'versions-only' && !docspace?.cloud?.in ? 'next' : 'cloud';
  const m = /^(?:[a-z0-9][a-z0-9-]*\/)?release\/([^/]+)$/.exec(branch);
  if (m) return m[1];
  throw new Error(`Cannot infer the edition from branch "${branch}"; pass --edition`);
}

// A marker is { only?: 'cloud' | 'self-hosted', selfHostedFrom?: '<version>' | 'next' }.
export function validateMarker(marker, where) {
  const { only, selfHostedFrom } = marker;
  if (only !== undefined && only !== 'cloud' && only !== 'self-hosted') {
    throw new Error(`${where}: only="${only}" must be "cloud" or "self-hosted"`);
  }
  if (selfHostedFrom !== undefined && selfHostedFrom !== 'next' && !isExactVersion(selfHostedFrom)) {
    throw new Error(`${where}: selfHostedFrom="${selfHostedFrom}" must be "next" or an exact version`);
  }
  if (only === undefined && selfHostedFrom === undefined) {
    throw new Error(`${where}: an Edition marker needs only= or selfHostedFrom=`);
  }
  if (only === 'cloud' && selfHostedFrom !== undefined) {
    throw new Error(`${where}: only="cloud" cannot be combined with selfHostedFrom`);
  }
}

export function matches(edition, marker) {
  if (marker.only === 'cloud' && edition.kind !== 'cloud') return false;
  if (marker.only === 'self-hosted' && edition.kind !== 'self-hosted') return false;
  const from = marker.selfHostedFrom;
  if (from === undefined || edition.kind === 'cloud') return true;
  // The unreleased preview on main shows everything that is coming.
  if (edition.id === 'next') return true;
  if (from === 'next') return false;
  return semver.gte(versionSemver(edition.version), versionSemver(from));
}

export function describeMarker(marker) {
  if (marker.only === 'cloud') return 'Cloud only';
  if (marker.only === 'self-hosted' && !marker.selfHostedFrom) return 'Self-hosted only';
  return `Self-hosted from ${marker.selfHostedFrom}`;
}

// Page-level markers from front matter: `editions: cloud | self-hosted` and `selfHostedFrom`.
export function markerFromFrontMatter(fm) {
  const marker = {};
  if (fm.editions !== undefined) {
    const list = Array.isArray(fm.editions) ? fm.editions : [fm.editions];
    if (list.length !== 1) return null; // both editions means no limit
    marker.only = list[0];
  }
  if (fm.selfHostedFrom !== undefined) marker.selfHostedFrom = String(fm.selfHostedFrom);
  return Object.keys(marker).length ? marker : null;
}

// Show-markers mode: every <Edition> block kept and outlined, page limits
// listed, and the dev toolbar's Edition toggle. Local preview and PR preview
// builds only (`wso2-docs build --show-markers`); a release build (`--env
// production`), a latest twin and the Landing deployment never show them.
// Returns WSO2_DOCS_SHOW_MARKERS for the build, always set, so a variable
// left in the environment can't turn markers on.
export function showMarkersFlag({ showMarkers = false, env = null, asLatest = false, landing = false } = {}) {
  if (!showMarkers) return '0';
  if (env === 'production') throw new Error('--show-markers is for preview builds; a production build never shows Edition markers');
  if (asLatest) throw new Error('--show-markers is for preview builds, not the latest twin');
  if (landing) throw new Error('--show-markers needs a Doc space; the Landing deployment has no Edition markers');
  return '1';
}
