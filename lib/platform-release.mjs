// A Platform release (Platform releases): a `v<major>.<minor>.<patch>` tag on
// the Platform's main line, the version in package.json. Its workflow
// (.github/workflows/platform-release.yml) publishes `@wso2/docs` to npm and
// moves the major's tag (`v1`, a tag and never a branch, as GitHub Actions
// refs go) to it, then rebuilds the Docs deployments pinned to that major.
// The major tag only moves forward: a patch to an older minor, tagged after a
// newer release, is published but leaves `v<major>` where it is.
import semver from 'semver';

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

// { version, major, majorTag, moveMajor } for `tag`, given package.json's
// version at the tag and every tag in the repo. Throws when the tag is not a
// release tag or does not match package.json.
export function platformReleaseFor(tag, packageVersion, tags = []) {
  if (!TAG.test(String(tag))) throw new Error(`"${tag}" is not a Platform release tag (v<major>.<minor>.<patch>, such as v1.4.0)`);
  const version = String(tag).slice(1);
  if (semver.valid(packageVersion) !== version) {
    throw new Error(`Tag ${tag} does not match package.json's version ${packageVersion}: set the version with npm version ${version} --no-git-tag-version, merge it, and tag that commit`);
  }
  const major = semver.major(version);
  const sameMajor = tags.filter((t) => TAG.test(t) && semver.major(t.slice(1)) === major).map((t) => t.slice(1));
  const newest = [...sameMajor, version].sort(semver.rcompare)[0];
  return { version, major, majorTag: `v${major}`, moveMajor: newest === version };
}

// The Platform's own deployments (Landing and Contribute): what a change on
// its main line releases (.github/workflows/platform-deployments.yml).
// Contribute is built by the Platform from standards/contribute/, so a change
// to anything its build reads releases it; the Landing deployment is the
// Platform navigation plus its own content (chrome/landing.yaml), so a change
// to either releases it. The workflow's
// path filter is the union of both lists (test/config.test.mjs).
export const CONTRIBUTE_PATHS = [
  'standards/', 'site/', 'plugins/', 'chrome/', 'lib/', 'bin/', 'schemas/', 'navigation/', 'package.json', 'package-lock.json',
];
export const LANDING_PATHS = ['navigation/', 'chrome/landing.yaml'];

const touches = (files, paths) => files.some((f) => paths.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)));

// { contribute, landing } for the files a push changed; null (no base to diff,
// such as a first push) releases both.
export function platformDeploymentsFor(files) {
  if (!files) return { contribute: true, landing: true };
  return { contribute: touches(files, CONTRIBUTE_PATHS), landing: touches(files, LANDING_PATHS) };
}

// A theme-only Platform release (Releases and deployments: Platform releases).
// The shared theme (site/wso2-theme/, lib/theme-bundle.mjs THEME_DIR) reaches
// every live page at the edge without a rebuild, so a release whose changes
// since the previous Platform release are all in the theme, or in files no
// build reads, publishes the theme and rebuilds nothing. Anything else
// rebuilds every live deployment of the major (scope all), as before.
export const THEME_PATH = 'site/wso2-theme/';
// Files no build reads: the spec, the tests, the wayfinder maps, root
// Markdown (GLOSSARY.md, README.md, AGENTS.md...).
export const UNBUILT_PATHS = ['spec/', 'test/', '.scratch/'];
// package.json and package-lock.json count when only their version changed
// (npm version x.y.z --no-git-tag-version changes both).
export const VERSION_FILES = ['package.json', 'package-lock.json'];

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

// The Platform release before `tag`: the highest release tag of a lower
// version, of any major. Null for the first release.
export function previousPlatformRelease(tag, tags = []) {
  const version = String(tag).replace(/^v/, '');
  const lower = tags.filter((t) => RELEASE_TAG.test(t) && semver.lt(t.slice(1), version)).sort((a, b) => semver.rcompare(a.slice(1), b.slice(1)));
  return lower[0] ?? null;
}

// Whether package.json or package-lock.json changed only in its version:
// package.json's `version`, the lock's `version` and `packages[""].version`.
export function onlyVersionChanged(before, after) {
  const strip = (text) => {
    const j = JSON.parse(text);
    delete j.version;
    if (j.packages?.['']) delete j.packages[''].version;
    return JSON.stringify(j);
  };
  try {
    return strip(before) === strip(after);
  } catch {
    return false;
  }
}

// { themeOnly, rebuild, outside } for the paths changed since the previous
// Platform release (git diff --no-renames, so a move counts both ends).
// `versionOnly(file)` says whether a VERSION_FILES file changed only in its
// version. No list (no previous release, or it isn't in this clone) rebuilds.
export function platformReleaseChanges(files, { versionOnly = () => false } = {}) {
  if (!files) return { themeOnly: false, rebuild: true, outside: null };
  const unbuilt = (f) => f.startsWith(THEME_PATH) || UNBUILT_PATHS.some((p) => f.startsWith(p)) || /^[^/]+\.md$/.test(f)
    || (VERSION_FILES.includes(f) && versionOnly(f));
  const outside = files.filter((f) => !unbuilt(f));
  return { themeOnly: outside.length === 0, rebuild: outside.length > 0, outside };
}
