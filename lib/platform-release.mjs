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
// Platform navigation plus its start paths (chrome/landing.yaml), so a change
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
