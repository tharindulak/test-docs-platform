// The Markdown twin of an API reference page (`layout: api-reference`, API
// reference rendering): the hand-written overview, a link to the OpenAPI YAML
// and a compact list of operations (method, path, summary, anchor link), never
// the full reference as prose (AI/LLM-friendly docs, decision 4).
//
// It reads only the page's front matter and the spec, with the API layout's
// own rules (lib/api-pages.mjs, lib/openapi.mjs): `spec:` on the API's index
// page, `openapi.<cloud|self-hosted>.yaml` overriding it for one Edition, tag
// pages (`tag:`) beside the index for split APIs, and the same anchors.
import path from 'node:path';
import { indexFrontMatter, isApiPage, tagPages } from './api-pages.mjs';
import { loadSpec, operationList, resolveSpecFile } from './openapi.mjs';

export { isApiPage };

// For one API page: { specFile, spec, folderRoute, tagPages, tag } or null.
export function apiPageInfo(file, fm, { docsDir, editionKind }) {
  if (!isApiPage(fm)) return null;
  const dir = path.dirname(file);
  const specRef = fm.spec ?? indexFrontMatter(dir).spec;
  if (!specRef) return null;
  const specFile = resolveSpecFile(dir, String(specRef), editionKind);
  const folder = path.relative(docsDir, dir).split(path.sep).join('/');
  const folderRoute = folder ? `${folder}/` : '';
  const pages = new Map([...tagPages(dir)].map(([tag, slug]) => [tag, `${folderRoute}${slug}/`]));
  return { specFile, spec: loadSpec(specFile), folderRoute, tagPages: pages, tag: fm.tag === undefined ? null : String(fm.tag) };
}

const text = (value) => ({ type: 'text', value });

// mdast nodes appended to the overview. pageUrl(route) gives a page's absolute URL.
export function apiTwinNodes(info, { pageUrl, ownRoute }) {
  const ops = operationList(info.spec).filter((o) => info.tag === null || o.tag === info.tag);
  const groups = new Map();
  for (const o of ops) (groups.get(o.tag) ?? groups.set(o.tag, []).get(o.tag)).push(o);
  // On a split API's index, each tag's operations live on that tag's page.
  const target = (tag) => (info.tag === null && info.tagPages.has(tag) ? info.tagPages.get(tag) : ownRoute);
  const yamlRoute = `${info.folderRoute}openapi.yaml`;
  const nodes = [
    { type: 'paragraph', children: [text('OpenAPI definition (YAML): '), { type: 'link', url: pageUrl(yamlRoute), children: [text(yamlRoute)] }] },
    { type: 'heading', depth: 2, children: [text('Operations')] },
  ];
  for (const [tag, list] of groups) {
    nodes.push({ type: 'heading', depth: 3, children: [text(tag)] });
    nodes.push({
      type: 'list', ordered: false, spread: false,
      children: list.map((o) => ({
        type: 'listItem', spread: false,
        children: [{ type: 'paragraph', children: [
          { type: 'link', url: `${pageUrl(target(tag))}#${o.anchor}`, children: [{ type: 'inlineCode', value: `${o.method} ${o.path}` }] },
          text(`: ${o.summary}`),
        ] }],
      })),
    });
  }
  return nodes;
}
