// The documentation standards source (standards/): page types, skeleton,
// front-matter schema, terminology, admonitions, style rules and the check
// registry. Everything that teaches or enforces the standards reads it here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const STANDARDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'standards');
export const CONTRIBUTE_DIR = path.join(STANDARDS_DIR, 'contribute');
export const VALE_DIR = path.join(STANDARDS_DIR, 'vale');
export const TEMPLATES_DIR = path.join(STANDARDS_DIR, 'templates');

const read = (name) => yaml.load(fs.readFileSync(path.join(STANDARDS_DIR, name), 'utf8'));

let cached;
export function loadStandards() {
  if (cached) return cached;
  const { pageTypes, layouts, placeholderDescription } = read('page-types.yaml');
  const skeleton = read('skeleton.yaml');
  const frontMatter = read('front-matter.yaml');
  const admonitions = read('admonitions.yaml');
  const terminology = read('terminology.yaml');
  const styleRules = read('style-rules.yaml').rules;
  const { guideBase, checks, lint } = read('checks.yaml');
  const words = fs.readFileSync(path.join(STANDARDS_DIR, 'dictionaries', 'wso2.txt'), 'utf8')
    .split('\n').map((w) => w.trim()).filter((w) => w && !w.startsWith('#'));
  cached = {
    pageTypes, layouts, placeholderDescription, skeleton, frontMatter, admonitions, terminology, styleRules, checks, lint, words,
    guideBase,
    pageTypeIds: pageTypes.map((t) => t.id),
    folderDefaults: Object.fromEntries(skeleton.folders.map((f) => [f.id, f.defaultType])),
    check: (id) => checks.find((c) => c.id === id),
  };
  return cached;
}

// A link into the Contribute guide, e.g. guide('reference/checks/#redirects').
export function guideUrl(rel) {
  return `${loadStandards().guideBase}${rel}`;
}

export const checkUrl = (id) => guideUrl(`reference/checks/#${id}`);

export function template(type) {
  const file = path.join(TEMPLATES_DIR, `${type}.mdx`);
  if (!fs.existsSync(file)) throw new Error(`No template for page type "${type}"`);
  return fs.readFileSync(file, 'utf8');
}
