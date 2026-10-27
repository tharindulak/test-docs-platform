// The MDX compile check: every converted page is compiled the way
// Docusaurus's MDX loader parses it (same preprocessing and syntax plugins),
// so a page that would break the build is reported by the converter.
import fs from 'node:fs';
import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkComment from '@slorber/remark-comment';
import { escapeMarkdownHeadingIds, unwrapMdxCodeBlocks } from '@docusaurus/utils';

export async function compileCheck(files) {
  const failures = [];
  for (const file of files) {
    const src = escapeMarkdownHeadingIds(unwrapMdxCodeBlocks(fs.readFileSync(file, 'utf8')));
    try {
      await compile({ value: src, path: file }, {
        remarkPlugins: [remarkFrontmatter, remarkDirective, remarkGfm, remarkComment],
        format: 'mdx',
      });
    } catch (err) {
      failures.push({ file, message: String(err.reason ?? err.message).split('\n')[0], line: err.line ?? err.place?.line ?? null });
    }
  }
  return failures;
}
