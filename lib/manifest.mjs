// The Deployment manifest: which Doc spaces and Editions exist, which feeds
// `latest`, their status, the Docs sections and the products menu. It is
// composed from the team manifests (lib/compose.mjs: navigation/,
// navigation/sections/ and each Doc space's docspace.yaml); the pipeline merges
// in the deployed-tag state (lib/release.mjs).
import fs from 'node:fs';
import { composeOrThrow, readManifestText } from './compose.mjs';

// No file: compose from the default inputs (navigation/ and the Content repos'
// Doc space manifests). A file is a composed manifest written by
// `wso2-release compose` (JSON), or the same shape as YAML.
export const DEFAULT_POLICY = undefined;

let composed = null;

export function loadPolicy(file = DEFAULT_POLICY) {
  if (!file) {
    composed ??= composeOrThrow();
    return structuredClone(composed);
  }
  const text = fs.readFileSync(file, 'utf8');
  const policy = /\.json$/i.test(file) ? JSON.parse(text) : readManifestText(text);
  if (!policy?.docSpaces) throw new Error(`${file}: "docSpaces" is required (a composed Deployment manifest, from wso2-release compose)`);
  return policy;
}

// The Doc space's directory in its Content repo checkout (<path>/<slug>/), from
// where compose read its manifest; the build reads only that directory.
export function docSpaceDir(space, slug) {
  const file = space.source?.file;
  const rel = file?.includes(':') ? file.slice(file.indexOf(':') + 1).replace(/\/?docspace\.yaml$/, '') : null;
  return rel ?? slug;
}

export function docSpace(policy, slug) {
  return policy.docSpaces[slug] ?? null;
}

export function findEdition(policy, slug, editionId) {
  const space = docSpace(policy, slug);
  return space?.editions?.find((e) => e.id === editionId) ?? null;
}

// What a published manifest.json looks like to the browser (snapshot baked
// into every build; the live copy is fetched at runtime). Fields are only ever
// added, so deployments built long ago keep reading it.
// A Doc space with `environments:` (the Sandbox: staging only) is left out of
// every other environment's manifest, and out of its section menus.
export function publicManifest(policy, { environment } = {}) {
  const docSpaces = {};
  for (const [slug, s] of Object.entries(policy.docSpaces)) {
    if (environment && Array.isArray(s.environments) && !s.environments.includes(environment)) continue;
    const optional = {
      formerNames: s.formerNames,
      editionNames: s.editionNames,
      repo: s.repo,
      editLinks: s.editLinks,
      issues: s.issues,
      legacyUrl: s.legacyUrl,
      // Added with the team manifests (Manifests and the compose step).
      brand: s.brand,
      listed: s.listed,
      // An Unlisted Doc space indexed anyway (Contribute: Chrome, products menu and section menu).
      indexed: s.indexed,
      home: s.home,
      sections: s.sections,
      cloud: s.cloud,
      notices: s.notices,
      // Added with Boilerplate to copy and start: preview, check and a Content
      // repo's compose check rebuild the team manifests from this file
      // (lib/published.mjs), and name the owners in what they report.
      owners: s.owners,
    };
    docSpaces[slug] = {
      displayName: s.displayName,
      family: s.family ?? null,
      model: s.model,
      status: s.status ?? 'live',
      latest: s.latest ?? null,
      editions: (s.editions ?? []).map((e) => ({
        id: e.id, status: e.status ?? 'live', ...(e.legacyUrl ? { legacyUrl: e.legacyUrl } : {}), ...(e.parts ? { parts: e.parts } : {}),
      })),
      ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined)),
    };
  }
  const here = (item) => item.docSpace === undefined || item.docSpace in docSpaces;
  const extra = {};
  if (policy.sections) {
    extra.sections = Object.fromEntries(Object.entries(policy.sections).map(([id, sec]) => [id, {
      ...sec, menu: sec.menu.filter(here), products: sec.products.filter((p) => p.opens.docSpace in docSpaces),
    }]));
  }
  if (policy.productsMenu) extra.productsMenu = policy.productsMenu.map((g) => ({ ...g, entries: g.entries.filter((p) => p.opens.docSpace in docSpaces) }));
  if (policy.environments) extra.environments = policy.environments;
  return { schemaVersion: 1, families: policy.families ?? [], docSpaces, ...extra };
}

// A composed section's menu and products-menu entries in the order of its
// section manifest, with the entries that wait (`pending`: a Doc space not
// composed or not published yet) back in their places. Each is
// { item, slug, pending }: a menu item ({ docSpace, versionIn } or a link
// entry { label, url }) or a products-menu entry ({ label, opens }).
export function sectionEntries(sec) {
  const merge = (list, waiting) => {
    const out = list.map((item) => ({ item, slug: item.docSpace ?? item.opens?.docSpace ?? null, pending: false }));
    for (const w of [...waiting].sort((a, b) => a.at - b.at)) out.splice(Math.min(w.at, out.length), 0, w);
    return out;
  };
  const pending = sec.pending ?? [];
  return {
    menu: merge(sec.menu ?? [], pending.filter((p) => p.docSpace).map((p) => ({ at: p.at, item: { docSpace: p.docSpace, ...(p.versionIn ? { versionIn: p.versionIn } : {}) }, slug: p.docSpace, pending: true }))),
    products: merge(sec.products ?? [], pending.filter((p) => p.product).map((p) => ({ at: p.at, item: p.product, slug: p.product.opens.docSpace, pending: true }))),
  };
}
