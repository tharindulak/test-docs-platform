// `wso2-docs new <type>`: a page from its page-type template, in the type's
// skeleton folder, with the front matter the schema requires.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadStandards, template } from './standards.mjs';

export function kebab(title) {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const quote = (s) => yaml.dump(s, { lineWidth: -1 }).trim();

export function scaffoldPage(repo, { type, title, description, folder, file }) {
  const S = loadStandards();
  const pageType = S.pageTypes.find((t) => t.id === type);
  if (!pageType) throw new Error(`Unknown page type "${type}". Use one of: ${S.pageTypeIds.join(', ')}`);
  if (!title?.trim()) throw new Error('A title is required: --title "Add multi-factor authentication"');
  const desc = description?.trim() || S.placeholderDescription;
  if (desc.length > S.frontMatter.keys.description.maxLength) {
    throw new Error(`The description is ${desc.length} characters; the limit is ${S.frontMatter.keys.description.maxLength}`);
  }
  const dir = (folder ?? pageType.folder).replace(/^\/+|\/+$/g, '');
  // With audience groups the skeleton is one level down: the folder names the group.
  const groups = repo.docspace?.audienceGroups ?? [];
  if (groups.length && !groups.includes(dir.split('/')[0])) {
    throw new Error(`This Doc space has audience groups: choose one with --folder <group>/${pageType.folder} (groups: ${groups.join(', ')})`);
  }
  const top = dir.split('/').slice(0, groups.length ? 2 : 1).join('/');
  const skeleton = S.skeleton.folders.find((f) => f.id === top.split('/').pop());
  if (!skeleton || top.split('/').length < (groups.length ? 2 : 1)) throw new Error(`"${dir}" is not under a skeleton folder (${S.skeleton.folders.map((f) => f.id).join(', ')})`);
  const name = (file ?? kebab(title)).replace(/\.mdx?$/, '');
  if (!name) throw new Error('Cannot make a file name from that title; pass --file');
  const rel = `docs/${dir}/${name}.mdx`;
  const abs = path.join(repo.root, rel);
  if (fs.existsSync(abs) || fs.existsSync(abs.replace(/\.mdx$/, '.md'))) throw new Error(`${rel} already exists`);

  const content = template(type)
    .replace('__TITLE__', quote(title.trim()))
    .replace('__DESCRIPTION__', quote(desc));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  // A new skeleton folder gets its sidebar label and position.
  const category = path.join(repo.root, 'docs', top, '_category_.yml');
  const created = [];
  if (!fs.existsSync(category)) {
    fs.writeFileSync(category, `label: ${skeleton.label}\nposition: ${skeleton.position}\n`);
    created.push(`docs/${top}/_category_.yml`);
  }
  fs.writeFileSync(abs, content);
  created.unshift(rel);
  return { file: rel, created, type: pageType };
}
