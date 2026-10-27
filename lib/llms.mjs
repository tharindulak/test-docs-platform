// llms.txt files (https://llmstxt.org) at every level (AI/LLM-friendly docs,
// decision 3):
//   <space>/<edition>/llms.txt       every page, grouped by the sidebar, `.md` links
//   <space>/<edition>/llms-full.txt  every page's Markdown in sidebar order
//   docs.wso2.com/llms.txt           index from the manifest (release step)
// Plain string building only, so the release CLI can use it without the build.
import { editionName as editionLabel, newestSuffix } from './switching.mjs';

const PRODUCTION_SITE = 'https://docs.wso2.com';
const line = (e) => {
  const title = e.title.replace(/[[\]]/g, '');
  const about = e.description ? `: ${e.description.replace(/\s+/g, ' ').trim()}` : '';
  return `${'  '.repeat(e.indent ?? 0)}- ${e.url ? `[${title}](${e.url})` : title}${about}`;
};

// { title, summary, details[], sections: [{ heading, entries: [{ title, url, description, indent }] }] }
export function llmsTxt({ title, summary, details = [], sections }) {
  const out = [`# ${title}`, '', `> ${summary.replace(/\s+/g, ' ').trim()}`, ''];
  for (const d of details) out.push(d, '');
  for (const s of sections) {
    if (!s.entries.length) continue;
    out.push(`## ${s.heading}`, '', ...s.entries.map(line), '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

// pages: [{ url, markdown }] in sidebar order; each markdown is a twin without front matter.
export function llmsFullTxt({ title, summary, pages }) {
  const parts = [`# ${title}`, '', `> ${summary.replace(/\s+/g, ' ').trim()}`, ''];
  for (const p of pages) parts.push('---', '', `Source: ${p.url}`, '', p.markdown.trim(), '');
  return `${parts.join('\n').trimEnd()}\n`;
}

// The root index, from the merged manifest (policy + state): every Doc space
// with a deployment, linking to its /cloud/ and /latest/ llms.txt (or the one
// file of an unversioned space). Other live Editions are listed as optional;
// end-of-life Editions are left out (their own files stay), and so are legacy
// Doc spaces and Editions.
export function rootLlmsTxt(manifest, siteUrl = PRODUCTION_SITE) {
  const sections = [];
  const optional = [];
  for (const [slug, space] of Object.entries(manifest.docSpaces ?? {})) {
    // Legacy Doc spaces and Editions (not on WSO2 Docs yet) have no files here.
    if (space.status === 'legacy') continue;
    const deployed = space.deployments ?? {};
    // A Cloud part's Cloud is in its platform's tree, with its own llms.txt there.
    const platform = space.cloud?.in && !space.editions?.some((e) => e.id === 'cloud') ? space.cloud.in : null;
    const partCloud = platform && manifest.docSpaces?.[platform]?.deployments?.cloud
      ? { title: space.editionNames?.cloud ?? `${space.displayName} Cloud`, url: `${siteUrl}/${platform}/cloud/${slug}/llms.txt`, description: `Cloud docs, part of ${manifest.docSpaces[platform].displayName}` }
      : null;
    if (!Object.keys(deployed).length && !partCloud) continue;
    const status = (id) => space.editions?.find((e) => e.id === id)?.status ?? 'live';
    const entries = [];
    if (space.model === 'unversioned') {
      if (deployed._) entries.push({ title: space.displayName, url: `${siteUrl}/${slug}/llms.txt`, description: `${space.displayName} documentation` });
    } else {
      if (partCloud) entries.push(partCloud);
      if (deployed.cloud && status('cloud') !== 'end-of-life') {
        entries.push({ title: editionLabel(space, 'cloud'), url: `${siteUrl}/${slug}/cloud/llms.txt`, description: 'Cloud docs, released continuously' });
      }
      if (deployed.latest && status(deployed.latest.edition) !== 'end-of-life') {
        entries.push({ title: `${editionLabel(space, deployed.latest.edition)}${newestSuffix(space)}`, url: `${siteUrl}/${slug}/latest/llms.txt`, description: 'The newest self-hosted release, at a URL that moves to each new release' });
      }
      for (const [segment, d] of Object.entries(deployed)) {
        if (segment === 'latest' || segment === 'cloud' || segment === '_' || ['end-of-life', 'legacy'].includes(status(d.edition))) continue;
        optional.push({ title: editionLabel(space, segment), url: `${siteUrl}/${slug}/${segment}/llms.txt`, description: segment === deployed.latest?.edition ? 'pinned copy of the newest release' : null });
      }
    }
    if (entries.length) sections.push({ heading: space.displayName, entries });
  }
  optional.sort((a, b) => a.url.localeCompare(b.url, 'en', { numeric: true }));
  return llmsTxt({
    title: 'WSO2 Docs',
    summary: 'Documentation for WSO2 products. Each Doc space links to the llms.txt of its Cloud docs and of its latest self-hosted release. Every page there has a Markdown twin: the page URL with .md instead of the trailing slash.',
    details: ['Prefer /cloud/ for WSO2 Cloud products and /latest/ for self-hosted products unless the user names a version.'],
    sections: [...sections, { heading: 'Optional', entries: optional }],
  });
}
