// Docusaurus hooks for `layout: api-reference` pages, so writers set only
// `layout` and `spec`: the page hides the Edition sidebar, TOC column, title
// and pagination (the layout draws its own), and tag pages of a split API stay
// out of the Edition sidebar, which lists the API once.
import { isApiPage } from './api-pages.mjs';

export function apiPageFrontMatter(fm) {
  if (!isApiPage(fm)) return fm;
  return {
    displayed_sidebar: null,
    hide_table_of_contents: true,
    hide_title: true,
    pagination_prev: null,
    pagination_next: null,
    ...fm,
  };
}

export async function apiSidebarItems({ defaultSidebarItemsGenerator, ...args }) {
  const items = await defaultSidebarItemsGenerator(args);
  const tagDocs = new Set(args.docs.filter((d) => isApiPage(d.frontMatter) && d.frontMatter.tag !== undefined).map((d) => d.id));
  if (!tagDocs.size) return items;
  const prune = (list) => list.flatMap((item) => {
    if (item.type === 'doc' && tagDocs.has(item.id)) return [];
    if (item.type !== 'category') return [item];
    const children = prune(item.items ?? []);
    // An API folder left with only its index becomes a plain link to it.
    if (!children.length && item.link?.type === 'doc') return [{ type: 'doc', id: item.link.id, ...(item.label ? { label: item.label } : {}) }];
    return [{ ...item, items: children }];
  });
  return prune(items);
}
