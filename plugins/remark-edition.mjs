// Applies Edition markers and {edition.*} variables for one Edition build.
// Runs before Docusaurus's own remark plugins, so content stripped here never
// reaches the table of contents.
//
// Show-markers mode (local preview and PR previews) keeps every marked block
// and wraps it in <EditionMarker>, so writers can see and toggle each Edition.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { describeMarker, markerFromFrontMatter, matches, validateMarker } from '../lib/edition.mjs';

const VAR_EXPRESSION = /^\s*edition\.([A-Za-z_]\w*)\s*$/;
const VAR_IN_CODE = /\{edition\.([A-Za-z_]\w*)\}/g;

const attr = (name, value) => ({ type: 'mdxJsxAttribute', name, value });

function readMarker(node, where) {
  const marker = {};
  for (const a of node.attributes ?? []) {
    if (a.type !== 'mdxJsxAttribute' || (a.value !== null && typeof a.value !== 'string')) {
      throw new Error(`${where}: <Edition> attributes must be plain strings`);
    }
    if (a.name !== 'only' && a.name !== 'selfHostedFrom') {
      throw new Error(`${where}: unknown <Edition> attribute "${a.name}"`);
    }
    marker[a.name] = a.value;
  }
  validateMarker(marker, where);
  return marker;
}

export default function remarkEdition({ edition, vars, showMarkers = false, substituteCode = true }) {
  return (tree, file) => {
    const where = file.path ? path.basename(file.path) : 'page';
    const lookup = (name) => {
      if (!(name in vars)) {
        throw new Error(`${where}: unknown variable {edition.${name}}; define it in editions.yaml`);
      }
      return String(vars[name]);
    };
    const substitute = (s) => s.replace(VAR_IN_CODE, (_, name) => lookup(name));

    const transform = (parent) => {
      if (!parent.children) return;
      const out = [];
      for (const node of parent.children) {
        const isJsx = node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';
        if (isJsx && node.name === 'Edition') {
          const marker = readMarker(node, where);
          transform(node);
          if (showMarkers) {
            node.name = 'EditionMarker';
            node.attributes = [
              attr('label', describeMarker(marker)),
              attr('active', String(matches(edition, marker))),
              attr('only', marker.only ?? ''),
              attr('selfHostedFrom', marker.selfHostedFrom ?? ''),
              attr('inline', String(node.type === 'mdxJsxTextElement')),
            ];
            out.push(node);
          } else if (matches(edition, marker)) {
            out.push(...node.children);
          }
          continue;
        }
        if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression') {
          const m = VAR_EXPRESSION.exec(node.value);
          if (m) {
            const text = { type: 'text', value: lookup(m[1]) };
            out.push(node.type === 'mdxTextExpression' ? text : { type: 'paragraph', children: [text] });
            continue;
          }
        }
        if (substituteCode && (node.type === 'code' || node.type === 'inlineCode')) node.value = substitute(node.value);
        transform(node);
        out.push(node);
      }
      // Join text split by substituted variables, so the HTML reads as one run.
      parent.children = out.reduce((acc, node) => {
        const prev = acc[acc.length - 1];
        if (prev?.type === 'text' && node.type === 'text') prev.value += node.value;
        else acc.push(node);
        return acc;
      }, []);
    };
    transform(tree);

    // In show-markers mode, pages limited to other editions are still built,
    // with a banner saying which editions they belong to.
    if (showMarkers && file.path && fs.existsSync(file.path)) {
      const marker = markerFromFrontMatter(matter(fs.readFileSync(file.path, 'utf8')).data);
      if (marker) {
        tree.children.unshift({
          type: 'mdxJsxFlowElement',
          name: 'EditionMarker',
          attributes: [
            attr('label', `This page: ${describeMarker(marker)}`),
            attr('active', String(matches(edition, marker))),
            attr('only', marker.only ?? ''),
            attr('selfHostedFrom', marker.selfHostedFrom ?? ''),
            attr('page', 'true'),
          ],
          children: [],
        });
      }
    }
  };
}
