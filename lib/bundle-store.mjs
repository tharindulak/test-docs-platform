// The bundle store (Releases and deployments, Storage and pointers): the
// Platform's own copy of every bundle an intake record names, in the staging
// bucket at _bundles/<sha256>.zip, so a rebuild never depends on a Content
// repo still being reachable. Nothing here unpacks or runs bundle content:
// bytes are fetched, hashed against the record and uploaded or handed on.
//   storeBundles     release.yml's store job, before any build: each planned
//                    bundle not stored yet, from GitHub, sha256 checked
//   handOverCopies   the plan job: the stored copy of each planned bundle
//                    GitHub no longer serves, for the build to fall back to
//   collectBundles   GC: the copies no intake record names
// The Edge Worker never serves _bundles/ (it reads only _releases/ and the
// runtime files), and production keeps no copy.
import fs from 'node:fs';
import path from 'node:path';
import { downloadRecordedAsset, releaseAsset, sha256File } from './intake.mjs';

export const BUNDLE_PREFIX = '_bundles/';
const SHA = /^[0-9a-f]{64}$/;
const COPY_KEY = /^_bundles\/([0-9a-f]{64})\.zip$/;

export function bundleKey(sha256) {
  if (!SHA.test(String(sha256))) throw new Error(`"${sha256}" is not a sha256`);
  return `${BUNDLE_PREFIX}${sha256}.zip`;
}

// The bundles a plan's deployments build from, one per sha256: [{ repo, tag,
// asset, sha256 }]. The Platform's own Doc space and the Landing deployment
// have no bundle.
export function plannedBundles(deployments) {
  const out = new Map();
  for (const d of deployments ?? []) {
    if (!d.asset) continue;
    bundleKey(d.sha256);
    if (!out.has(d.sha256)) out.set(d.sha256, { repo: d.repo, tag: d.tag, asset: d.asset, sha256: d.sha256 });
  }
  return [...out.values()];
}

// Every sha256 the intake records ({ <slug>: record }) name.
export function recordedSha256s(records) {
  const out = new Set();
  for (const record of Object.values(records)) {
    for (const entries of Object.values(record?.editions ?? {})) for (const e of entries ?? []) if (e?.sha256) out.add(e.sha256);
  }
  return out;
}

const storedSha256s = async (storage) => new Set((await storage.list(BUNDLE_PREFIX)).map((k) => COPY_KEY.exec(k)?.[1]).filter(Boolean));

// Copies each bundle not stored yet: fetched from GitHub into workDir, its
// sha256 checked against the record, uploaded, deleted locally. Any failure
// throws, which fails the job and so the release.
export async function storeBundles(storage, bundles, { fetch = globalThis.fetch, token, workDir, log = () => {} }) {
  const have = await storedSha256s(storage);
  const stored = [];
  const present = [];
  fs.mkdirSync(workDir, { recursive: true });
  for (const b of bundles) {
    if (have.has(b.sha256)) {
      present.push(b.sha256);
      log(`${b.asset}: ${bundleKey(b.sha256)} is stored already`);
      continue;
    }
    const file = path.join(workDir, `${b.sha256}.zip`);
    try {
      await downloadRecordedAsset({ ...b, file, fetch, token });
      await storage.put(bundleKey(b.sha256), fs.readFileSync(file), { contentType: 'application/zip' });
    } finally {
      fs.rmSync(file, { force: true });
    }
    stored.push(b.sha256);
    log(`${b.asset}: sha256 matches the record; stored as ${bundleKey(b.sha256)}`);
  }
  return { stored, present };
}

// For each bundle GitHub no longer serves, the stored copy, its sha256
// checked against the record, written to <out>/<sha256>.zip for the build.
// A bundle with neither is listed in `missing`: its build fails on its own
// fetch, as before.
export async function handOverCopies(storage, bundles, { fetch = globalThis.fetch, token, out, log = () => {} }) {
  const handed = [];
  const missing = [];
  for (const b of bundles) {
    try {
      await releaseAsset({ ...b, fetch, token });
      continue;
    } catch (err) {
      log(`${b.asset}: ${err.message}; looking for the stored copy`);
    }
    const obj = await storage.get(bundleKey(b.sha256));
    if (!obj) {
      missing.push(b.sha256);
      log(`${b.asset}: no stored copy (${bundleKey(b.sha256)})`);
      continue;
    }
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `${b.sha256}.zip`);
    fs.writeFileSync(file, obj.body);
    const got = sha256File(file);
    if (got !== b.sha256) {
      fs.rmSync(file);
      throw new Error(`The stored copy ${bundleKey(b.sha256)}'s sha256 ${got} is not the record's ${b.sha256}`);
    }
    handed.push(b.sha256);
    log(`${b.asset}: handing the stored copy to the build`);
  }
  return { handed, missing };
}

// Deletes the copies no record names. Only keys of the form
// _bundles/<sha256>.zip are considered; anything else is left alone.
export async function collectBundles(storage, records, { dryRun = false } = {}) {
  const named = recordedSha256s(records);
  const removed = (await storage.list(BUNDLE_PREFIX)).filter((k) => {
    const m = COPY_KEY.exec(k);
    return m && !named.has(m[1]);
  });
  if (!dryRun && removed.length) await storage.delete(removed);
  return removed;
}
