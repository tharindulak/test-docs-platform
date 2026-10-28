// Applies Edition markers and {edition.*} variables for one Edition build.
// Runs before Docusaurus's own remark plugins, so content stripped here never
// reaches the table of contents.
//
// Cloud also shows the Doc space's Self-hosted additions (Content per
// Edition): Self-hosted-only blocks and pages, labelled "Self-hosted" by
// <SelfHostedAddition>, read as the newest release reads them (its markers
// and its `self-hosted:` variables). <Variants> holds an Edition variant: one
// Cloud and one Self-hosted form, of which each Edition shows its own.
//
// Show-markers mode (local preview and PR previews) keeps every marked block
// and wraps it in <EditionMarker>, so writers can see and toggle each Edition.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  describeMarker, editionFromId, isSelfHostedAddition, markerFromFrontMatter, matches, pageShows, validateMarker, validateVariants,
} from '../lib/edition.mjs';
import { cloudLinkRewriter } from '../lib/cloud-links.mjs';

const VAR_EXPRESSION = /^\s*edition\.([A-Za-z_]\w*)\s*$/;
const VAR_IN_CODE = /\{edition\.([A-Za-z_]\w*)\}/g;

const attr = (name, value) => ({ type: 'mdxJsxAttribute', name, value });
const isJsx = (node) => node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';
const isBlank = (node) => node.type === 'text' && !node.value.trim();

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

// The <Edition> children of a <Variants>, checked for its shape.
function readVariants(node, where) {
  if (node.attributes?.length) throw new Error(`${where}: <Variants> takes no attributes`);
  const forms = (node.children ?? []).filter((c) => !isBlank(c));
  validateVariants(forms.map((c) => (isJsx(c) && c.name === 'Edition' ? readMarker(c, where) : null)), where);
  return forms.map((c) => ({ node: c, marker: readMarker(c, where) }));
}

// The "Self-hosted" label: a box around a block, a badge under a page title.
function label(additions, { page = false, inline = false, children = [] } = {}) {
  return {
    type: inline ? 'mdxJsxTextElement' : 'mdxJsxFlowElement',
    name: 'SelfHostedAddition',
    attributes: [
      ...(page ? [attr('page', 'true')] : []),
      ...(inline ? [attr('inline', 'true')] : []),
      attr('release', additions.name),
      attr('latest', additions.latest),
      ...(additions.base ? [attr('base', additions.base)] : []),
    ],
    children,
  };
}

// `additions` (lib/content.mjs additionsFor, plus the docs instance's base
// URL) is set for a Cloud build whose Doc space has a newest release. Inside
// an addition, a link Cloud cannot resolve goes to the same page under
// /latest/ (lib/cloud-links.mjs); `cloudLinks: false` leaves links alone.
export default function remarkEdition({ edition, vars, showMarkers = false, substituteCode = true, additions = null, cloudLinks = true }) {
  const newest = additions?.newestRelease ?? null;
  const rewriteLink = cloudLinks && !showMarkers ? cloudLinkRewriter({ edition, vars, additions }) : () => null;
  // How the newest release reads a Self-hosted addition shown in Cloud.
  const release = newest ? editionFromId(newest) : null;
  return (tree, file) => {
    const where = file.path ? path.basename(file.path) : 'page';
    const lookupIn = (v) => (name) => {
      if (!(name in v)) {
        throw new Error(`${where}: unknown variable {edition.${name}}; define it in editions.yaml`);
      }
      return String(v[name]);
    };
    const own = { edition, lookup: lookupIn(vars), addition: false };
    const inAddition = additions ? { edition: release, lookup: lookupIn(additions.vars), addition: true } : null;

    const transform = (parent, ctx) => {
      if (!parent.children) return;
      const substitute = (s) => s.replace(VAR_IN_CODE, (_, name) => ctx.lookup(name));
      const out = [];
      for (const node of parent.children) {
        if (isJsx(node) && node.name === 'Variants') {
          const forms = readVariants(node, where);
          if (showMarkers) {
            for (const { node: form, marker } of forms) {
              transform(form, ctx);
              out.push(markerNode(form, marker, matches(ctx.edition, marker), { variant: true }));
            }
          } else {
            // Each Edition, Cloud included, shows only its own form.
            for (const { node: form, marker } of forms) {
              if (!matches(ctx.edition, marker)) continue;
              transform(form, ctx);
              out.push(...form.children);
            }
          }
          continue;
        }
        if (isJsx(node) && node.name === 'Edition') {
          const marker = readMarker(node, where);
          const addition = !ctx.addition && isSelfHostedAddition(ctx.edition, marker, newest);
          transform(node, addition ? inAddition : ctx);
          if (showMarkers) {
            out.push(markerNode(node, marker, addition || matches(ctx.edition, marker), { newest: ctx.addition ? null : newest }));
          } else if (addition) {
            out.push(label(additions, { inline: node.type === 'mdxJsxTextElement', children: node.children }));
          } else if (matches(ctx.edition, marker)) {
            out.push(...node.children);
          }
          continue;
        }
        if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression') {
          const m = VAR_EXPRESSION.exec(node.value);
          if (m) {
            const text = { type: 'text', value: ctx.lookup(m[1]) };
            out.push(node.type === 'mdxTextExpression' ? text : { type: 'paragraph', children: [text] });
            continue;
          }
        }
        if (substituteCode && (node.type === 'code' || node.type === 'inlineCode')) node.value = substitute(node.value);
        if (ctx.addition && node.type === 'link') node.url = rewriteLink(node.url, file.path) ?? node.url;
        transform(node, ctx);
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

    // A Self-hosted-only page shown in Cloud is read as the newest release
    // reads it, with its badge under the title.
    const fm = file.data?.frontMatter ?? (file.path && fs.existsSync(file.path) ? matter(fs.readFileSync(file.path, 'utf8')).data : {});
    const pageMarker = markerFromFrontMatter(fm);
    const additionPage = Boolean(pageMarker && !showMarkers && isSelfHostedAddition(edition, pageMarker, newest) && pageShows(edition, fm, newest));
    transform(tree, additionPage ? inAddition : own);
    if (additionPage) {
      const h1 = tree.children.findIndex((n) => n.type === 'heading' && n.depth === 1);
      tree.children.splice(h1 === 0 ? 1 : 0, 0, label(additions, { page: true }));
    }

    // In show-markers mode, pages limited to other editions are still built,
    // with a banner saying which editions they belong to.
    if (showMarkers && pageMarker) {
      tree.children.unshift({
        type: 'mdxJsxFlowElement',
        name: 'EditionMarker',
        attributes: [
          attr('label', `This page: ${describeMarker(pageMarker)}`),
          attr('active', String(pageShows(edition, fm, newest))),
          attr('only', pageMarker.only ?? ''),
          attr('selfHostedFrom', pageMarker.selfHostedFrom ?? ''),
          attr('page', 'true'),
        ],
        children: [],
      });
    }
  };
}

// A marked block in show-markers mode: outlined and labelled, with what the
// dev toolbar's Edition toggle needs (a variant's form is shown in its own
// Edition only; other blocks also in Cloud when they are a Self-hosted
// addition of the newest release).
function markerNode(node, marker, active, { variant = false, newest = null } = {}) {
  node.attributes = [
    attr('label', describeMarker(marker) + (variant ? ' (Edition variant)' : '')),
    attr('active', String(active)),
    attr('only', marker.only ?? ''),
    attr('selfHostedFrom', marker.selfHostedFrom ?? ''),
    attr('inline', String(node.type === 'mdxJsxTextElement')),
    ...(variant ? [attr('variant', 'true')] : []),
    ...(newest ? [attr('newestRelease', newest)] : []),
  ];
  node.name = 'EditionMarker';
  return node;
}
