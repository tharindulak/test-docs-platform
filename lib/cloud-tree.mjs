// A family Cloud build (Platform-by-platform walkthrough; URLs, latest and
// canonicals): a family-level, Cloud-only Doc space's Cloud tree holds each
// product's Cloud as a Cloud part. The build reads every part's main line
// (<part>/docs/, with its own editions.yaml, partials/, assets/ and
// redirects.yaml) from the same Content repo checkout as the family's own
// directory, so the whole tree comes from one commit, and mounts it at
// /<platform>/cloud/<part>/. Each part is its own docs plugin instance, so its
// relative links, assets and Edition variables work as in its own directory;
// the sidebar is one tree with a group per part (treeSidebars below).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bundleOf, loadContentRepo } from './content.mjs';
import { routeFor } from './routes.mjs';

const editionsOf = (docspace) => (docspace.editions ?? []).map((e) => (typeof e === 'string' ? { id: e } : e));

// The parts a Doc space's Cloud Edition lists in its docspace.yaml.
export const cloudPartSlugs = (docspace) => editionsOf(docspace).find((e) => e.id === 'cloud')?.parts ?? [];

// "AI Gateway Cloud": the part's Cloud Edition name, for titles and twins.
export const partEditionName = (docspace) => docspace.editionNames?.cloud ?? `${docspace.displayName} Cloud`;

// The platform a Doc space's main line is a Cloud part of, when it has no
// Cloud Edition of its own; else null.
export function cloudPartOf(docspace) {
  if (!docspace.cloud?.in) return null;
  return editionsOf(docspace).some((e) => e.id === 'cloud') ? null : docspace.cloud.in;
}

function gitTop(dir) {
  try {
    return path.resolve(execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return null;
  }
}

function gitHead(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// The Cloud parts of one family Cloud build: [{ slug, repo, pluginId,
// routeBasePath, editionName }]. Each part is the sibling directory
// <checkout>/<part>/ of the family's own; it must be there, name itself by
// its slug and point back with cloud.in.
export function loadCloudParts(repo, editionId) {
  if (editionId !== 'cloud') return [];
  const slugs = cloudPartSlugs(repo.docspace);
  if (!slugs.length) return [];
  const checkout = path.dirname(repo.root);
  // From an unpacked bundle, the parts are in the same bundle; from a
  // checkout, in the same checkout.
  const bundle = bundleOf(repo.root);
  const top = bundle ? null : gitTop(repo.root);
  return slugs.map((slug) => {
    const dir = path.join(checkout, slug);
    if (!fs.existsSync(path.join(dir, 'docspace.yaml'))) {
      throw new Error(`${repo.docspace.slug}'s Cloud Edition lists Cloud part "${slug}", but ${dir} has no docspace.yaml: a family Cloud is built from one checkout of its Content repo, with each part's directory beside its own`);
    }
    if (bundle && bundleOf(dir)?.top !== bundle.top) throw new Error(`Cloud part ${slug} (${dir}) is not in the same bundle as ${repo.root}`);
    if (top && gitTop(dir) !== top) throw new Error(`Cloud part ${slug} (${dir}) is not in the same checkout as ${repo.root}`);
    const part = loadContentRepo(dir);
    if (part.docspace.slug !== slug) throw new Error(`${dir}/docspace.yaml has slug "${part.docspace.slug}", not "${slug}"`);
    if (part.docspace.cloud?.in !== repo.docspace.slug) {
      throw new Error(`Cloud part ${slug} does not point back: its cloud.in is ${part.docspace.cloud?.in ?? 'not set'}, not ${repo.docspace.slug}`);
    }
    return { slug, repo: part, pluginId: `part-${slug}`, routeBasePath: slug, editionName: partEditionName(part.docspace), displayName: part.docspace.displayName };
  });
}

// Where the tree came from, for _platform/edition.json: the bundle's source
// commit, else the checkout's.
export const checkoutCommit = (repo) => bundleOf(repo.root)?.bundle.sourceCommit ?? gitHead(repo.root);

// --- One sidebar for the whole tree -------------------------------------------
// Docusaurus gives each docs plugin instance its own sidebar. Every instance of
// one tree reports its generated items here, waits for the others, and then
// draws the same tree: the family's items with a group per Cloud part after
// "Get started", its own items as docs and the other instances' as links.

const trees = new Map();

function treeOf(id, expected) {
  if (!trees.has(id)) {
    let settle;
    const ready = new Promise((resolve) => { settle = resolve; });
    trees.set(id, { expected: new Set(expected), entries: new Map(), ready, settle });
  }
  return trees.get(id);
}

const firstDocId = (item) => {
  if (item.type === 'doc' || item.type === 'ref') return item.id;
  if (item.type === 'category') {
    if (item.link?.type === 'doc') return item.link.id;
    for (const c of item.items ?? []) {
      const id = firstDocId(c);
      if (id) return id;
    }
  }
  return null;
};

// One instance's items as links, for the sidebar of another instance.
export function foreignItems(items, { docs, docsDir, siteDir, baseUrl }) {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const href = (id) => {
    const d = byId.get(id);
    if (!d) return null;
    const file = path.resolve(siteDir, String(d.source).replace(/^@site\//, ''));
    const rel = path.relative(docsDir, file).split(path.sep).join('/');
    return `${baseUrl}${routeFor(rel, d.frontMatter ?? {})}`;
  };
  const label = (id, own) => own ?? byId.get(id)?.frontMatter?.sidebar_label ?? byId.get(id)?.title ?? id;
  const convert = (item) => {
    if (item.type === 'doc' || item.type === 'ref') {
      const h = href(item.id);
      return h ? [{ type: 'link', label: label(item.id, item.label), href: h, ...(item.className ? { className: item.className } : {}) }] : [];
    }
    if (item.type === 'category') {
      const children = (item.items ?? []).flatMap(convert);
      const index = item.link?.type === 'doc' ? href(item.link.id) : null;
      const all = [...(index ? [{ type: 'link', label: label(item.link.id), href: index }] : []), ...children];
      if (!all.length) return [];
      const { link, items: _items, ...rest } = item;
      return [{ ...rest, collapsed: true, items: all }];
    }
    return [item];
  };
  return items.flatMap(convert);
}

// The tree drawn by every instance: `self` is the instance asking.
export function drawTree({ family, parts, self }) {
  const view = (entry) => (entry.id === self ? entry.items : foreignItems(entry.items, entry));
  const groups = parts.map((p) => {
    const items = view(p);
    const own = p.id === self;
    // The part's home (its index page) is the group's own link.
    const home = own ? p.items.find((i) => (i.type === 'doc' || i.type === 'ref') && /^(index|readme)$/i.test(String(i.id).split('/').pop())) : null;
    const rest = home ? items.filter((i) => i !== home) : items;
    return {
      type: 'category', label: p.label, collapsed: !own, collapsible: true,
      ...(home ? { link: { type: 'doc', id: home.id } } : {}),
      items: rest.length ? rest : items,
      customProps: { cloudPart: p.slug },
    };
  });
  const top = view(family);
  // After "Get started" (the family skeleton), else after the leading pages.
  const raw = family.items;
  const gs = raw.findIndex((i) => i.type === 'category' && /^get-started\//.test(firstDocId(i) ?? ''));
  const firstGroup = raw.findIndex((i) => i.type === 'category');
  const at = Math.min(top.length, gs !== -1 ? gs + 1 : firstGroup !== -1 ? firstGroup : raw.length);
  return [...top.slice(0, at), ...groups, ...top.slice(at)];
}

// A sidebarItemsGenerator for one instance of a tree. `inner` makes the
// instance's own items (lib/api-layout.mjs apiSidebarItems).
export function treeSidebars({ tree, self, family, parts, siteDir, inner }) {
  const ids = [family.id, ...parts.map((p) => p.id)];
  const meta = new Map([family, ...parts].map((x) => [x.id, x]));
  return async (args) => {
    const t = treeOf(tree, ids);
    const items = await inner(args);
    t.entries.set(self, { ...meta.get(self), id: self, items, docs: args.docs, siteDir });
    if ([...t.expected].every((id) => t.entries.has(id))) t.settle();
    await t.ready;
    const entry = (id) => t.entries.get(id);
    return drawTree({ family: entry(family.id), parts: parts.map((p) => entry(p.id)), self });
  };
}
