// The "Copy page" menu goes on doc pages only (plugins/remark-page-actions.mjs):
// not on partials, wherever the checkout lives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import remarkPageActions from '../plugins/remark-page-actions.mjs';

const run = (file, docsDir) => {
  const tree = { type: 'root', children: [{ type: 'heading', depth: 1, children: [] }, { type: 'paragraph', children: [] }] };
  remarkPageActions({ docsDir })(tree, { path: file, data: { frontMatter: {} } });
  return tree.children.some((n) => n.name === 'PageActions');
};

test('a page gets the menu, also in a checkout under a directory starting with "_"', () => {
  assert.equal(run('/w/_work/repo/identity-server/docs/guides/mfa.mdx', '/w/_work/repo/identity-server/docs'), true);
  assert.equal(run('/w/repo/identity-server/docs/guides/mfa.mdx', '/w/repo/identity-server/docs'), true);
});

test('partials get none: _-prefixed ones in docs/, and the Doc space\'s partials/ outside docs/', () => {
  assert.equal(run('/w/repo/identity-server/docs/_partials/_mfa-note.mdx', '/w/repo/identity-server/docs'), false);
  assert.equal(run('/w/repo/identity-server/partials/sign-in-options.mdx', '/w/repo/identity-server/docs'), false);
});
