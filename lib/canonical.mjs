// A page's canonical URL (SEO and canonical strategy, spec/indexing-and-seo.md):
// /latest/ and Cloud pages are their own; the version that feeds latest points
// at the same page under /latest/; an older version points at the /latest/
// page when latest still has it (after a page move: latestRedirects), else at
// itself. The build writes it into each page (plugins/platform-outputs.mjs),
// and the page keeps the served value after hydration
// (site/src/theme/DocItem/Metadata).
// `selfHosted`: a Self-hosted-only page shown in Cloud (a Self-hosted
// addition), whose canonical is the same page under its Doc space's /latest/
// (in a family Cloud tree, the Cloud part's Doc space).
export function canonicalFor(rel, o, { selfHosted = false } = {}) {
  if (selfHosted && o.editionId === 'cloud') {
    const part = o.cloudPartOf ? null : (o.parts ?? []).find((p) => rel.startsWith(p.path));
    return `${o.siteUrl}/${part ? part.docSpace : o.docSpace}/latest/${part ? rel.slice(part.path.length) : rel}`;
  }
  const self = `${o.siteUrl}${o.baseUrl}${rel}`;
  const latest = (p) => `${o.siteUrl}/${o.docSpace}/latest/${p}`;
  if (o.asLatest || o.editionId === 'cloud' || !o.latestEditionId) return self;
  if (o.editionId === o.latestEditionId) return latest(rel);
  const moved = o.latestRedirects?.[rel] ?? rel;
  return o.latestPages?.has(moved) ? latest(moved) : self;
}
