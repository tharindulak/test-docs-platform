// Puts the "Copy page" menu (site/src/components/PageActions) next to every
// doc page's title: an MDX element right after the page's # heading, or first
// when the title comes from front matter. CSS pins it beside the title. Not on
// partials, and not on API reference pages, whose layout draws its own header.
import path from 'node:path';

// A partial is a file outside the Doc space's docs/ (its partials/) or with a
// `_` segment inside docs/; only the path under docs/ counts, so a checkout
// under a directory such as _work/ keeps its menus.
export default function remarkPageActions({ docsDir } = {}) {
  return (tree, file) => {
    if (file.path) {
      const rel = docsDir ? path.relative(docsDir, file.path) : path.normalize(file.path);
      if ((docsDir && (rel.startsWith('..') || path.isAbsolute(rel))) || rel.split(path.sep).some((seg) => seg.startsWith('_'))) return;
    }
    const fm = file.data?.frontMatter ?? {};
    if (fm.layout === 'api-reference' || fm.hide_title) return;
    const node = { type: 'mdxJsxFlowElement', name: 'PageActions', attributes: [], children: [] };
    const h1 = tree.children.findIndex((n) => n.type === 'heading' && n.depth === 1);
    let at = h1 + 1;
    if (h1 === -1) {
      at = 0;
      while (tree.children[at]?.type === 'mdxjsEsm') at++;
    }
    tree.children.splice(at, 0, node);
  };
}
