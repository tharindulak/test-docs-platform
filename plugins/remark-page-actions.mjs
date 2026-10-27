// Puts the "Copy page" menu (site/src/components/PageActions) next to every
// doc page's title: an MDX element right after the page's # heading, or first
// when the title comes from front matter. CSS pins it beside the title. Not on
// partials, and not on API reference pages, whose layout draws its own header.
import path from 'node:path';

export default function remarkPageActions() {
  return (tree, file) => {
    if (file.path && path.normalize(file.path).split(path.sep).some((seg) => seg.startsWith('_'))) return;
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
