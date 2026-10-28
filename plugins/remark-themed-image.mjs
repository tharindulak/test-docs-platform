// <ThemedImage light="./img/a.png" dark="./img/a-dark.png" alt="…" />: a
// page names its images by literal relative paths (content carries no code),
// and this step turns each one into require("…").default before compile, as
// Docusaurus does for Markdown images, so webpack bundles them and a missing
// file fails the build. Absolute URLs stay as written.
import { visit } from 'unist-util-visit';

const RELATIVE = /^\.\.?\//;

// The estree of require("<src>").default, which MDX compiles as written.
function requireDefault(src) {
  const call = { type: 'CallExpression', callee: { type: 'Identifier', name: 'require' }, arguments: [{ type: 'Literal', value: src, raw: JSON.stringify(src) }], optional: false };
  const expression = { type: 'MemberExpression', object: call, property: { type: 'Identifier', name: 'default' }, computed: false, optional: false };
  return {
    type: 'mdxJsxAttributeValueExpression',
    value: `require(${JSON.stringify(src)}).default`,
    data: { estree: { type: 'Program', sourceType: 'module', body: [{ type: 'ExpressionStatement', expression }] } },
  };
}

export default function remarkThemedImage() {
  return (tree) => {
    visit(tree, (node) => {
      if ((node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') || node.name !== 'ThemedImage') return;
      for (const a of node.attributes ?? []) {
        if (a.type === 'mdxJsxAttribute' && (a.name === 'light' || a.name === 'dark') && typeof a.value === 'string' && RELATIVE.test(a.value)) {
          a.value = requireDefault(a.value);
        }
      }
    });
  };
}
