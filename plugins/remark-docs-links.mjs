// Resolves `docs:<space>/<edition|latest>/<page>` links to the host this build
// deploys to, rendered as same-tab full page loads. Links to Doc spaces or
// Editions missing from the deployment manifest fail the build.
//
// A component's Cloud is its Cloud part of the platform's Cloud tree (URLs,
// latest and canonicals): `docs:ai-gateway/cloud/<page>` is the page at
// /api-platform/cloud/ai-gateway/<page>/. A Cloud-only Doc space has no
// /latest/ copy, so its `latest` is its /cloud/ address.
import path from 'node:path';
import { visit } from 'unist-util-visit';
import { docSpace, findEdition } from '../lib/manifest.mjs';

// The deployment a docs: link lands in and the page inside it:
// { space, segment, page, hash, url (from the site root, with trailing slash) }.
export function docsLinkTarget(url, policy, where = 'page') {
  const [pathPart, hash] = url.slice('docs:'.length).split('#');
  const [slug, ...rest] = pathPart.split('/').filter(Boolean);
  const space = slug && docSpace(policy, slug);
  if (!space) throw new Error(`${where}: ${url}: unknown Doc space "${slug}"`);
  if (space.status === 'legacy') throw new Error(`${where}: ${url}: Doc space "${slug}" is not on WSO2 Docs yet`);
  let target = { space: slug, segment: '_', rest };
  if (space.model !== 'unversioned') {
    const editionSeg = rest.shift();
    if (!editionSeg) throw new Error(`${where}: ${url}: missing edition (use an edition id or "latest")`);
    const ownCloud = (space.editions ?? []).some((e) => e.id === 'cloud');
    if (editionSeg === 'latest') {
      if (!space.latest) throw new Error(`${where}: ${url}: "${slug}" has no latest edition`);
      target = { space: slug, segment: space.latest === 'cloud' ? 'cloud' : 'latest', rest };
    } else if (editionSeg === 'cloud' && !ownCloud && space.cloud?.in) {
      const platform = docSpace(policy, space.cloud.in);
      if (!platform || platform.status === 'legacy') throw new Error(`${where}: ${url}: "${slug}" is a Cloud part of "${space.cloud.in}", which is not on WSO2 Docs yet`);
      target = { space: space.cloud.in, segment: 'cloud', rest: [slug, ...rest] };
    } else {
      const edition = findEdition(policy, slug, editionSeg);
      if (!edition) throw new Error(`${where}: ${url}: "${slug}" has no edition "${editionSeg}"`);
      if (edition.status === 'legacy') throw new Error(`${where}: ${url}: "${editionSeg}" is not on WSO2 Docs yet`);
      target = { space: slug, segment: editionSeg, rest };
    }
  }
  const page = target.rest.length ? `${target.rest.join('/')}/` : '';
  const segs = [target.space, target.segment === '_' ? null : target.segment].filter(Boolean);
  return { space: target.space, segment: target.segment, page, hash: hash ?? null, url: `/${segs.join('/')}/${page}` };
}

export function resolveDocsLink(url, policy, host, where = 'page') {
  const t = docsLinkTarget(url, policy, where);
  return `${host.replace(/\/$/, '')}${t.url}${t.hash ? `#${t.hash}` : ''}`;
}

export default function remarkDocsLinks({ policy, host }) {
  return (tree, file) => {
    const where = file.path ? path.basename(file.path) : 'page';
    visit(tree, 'link', (node, index, parent) => {
      if (!node.url.startsWith('docs:')) return;
      parent.children[index] = {
        type: 'mdxJsxTextElement',
        name: 'DocsLink',
        attributes: [{ type: 'mdxJsxAttribute', name: 'href', value: resolveDocsLink(node.url, policy, host, where) }],
        children: node.children,
      };
    });
  };
}
