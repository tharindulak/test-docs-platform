// Page layouts (Extension points for product teams, decision 2): how a page is
// drawn, chosen by its `layout` front matter independently of its Page type
// (`type`). The list is fixed by the Platform; a new layout comes by
// extension proposal and PR (.github/ISSUE_TEMPLATE/extension-proposal.yml).
// The front-matter standard (standards/front-matter.yaml) lists the same
// values, and the component catalogue (standards/components.yaml) documents
// each one.
//
// The migration's page templates (complete-guide, sdk, connector) are
// variants of the default layout: drawn as written, kept so the pages keep
// their template's meaning (and complete-guide's one-file export).
export const LAYOUTS = ['default', 'overview', 'catalog', 'api-reference'];
export const DEFAULT_VARIANTS = ['complete-guide', 'sdk', 'connector'];

export const layoutOf = (fm) => (typeof fm?.layout === 'string' ? fm.layout : 'default');

// Front-matter defaults a layout brings (the page's own keys win): overview
// and catalog pages are drawn full width, without the TOC column.
export function layoutFrontMatter(fm) {
  const layout = layoutOf(fm);
  if (layout === 'overview' || layout === 'catalog') return { hide_table_of_contents: true, ...fm };
  return fm;
}
