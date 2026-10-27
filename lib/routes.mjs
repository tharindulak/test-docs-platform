// A docs/ file's route inside its Edition (folder path = URL path; the
// Content repo contract), light enough for build plugins to import.
const DOC_EXT = /\.mdx?$/;
// Docusaurus's number-prefix pattern (the Platform turns the parser off,
// but routes are worked out the same way as Docusaurus).
const NUMBER_PREFIX = /^\d+\s*[-_.]+\s*(?=[^-_.\s])/;

export function routeFor(docRel, fm = {}) {
  const parts = docRel.replace(DOC_EXT, '').split('/');
  const name = parts.pop().replace(NUMBER_PREFIX, '');
  const dirs = parts.map((p) => p.replace(NUMBER_PREFIX, ''));
  let route;
  if (typeof fm.slug === 'string') {
    route = fm.slug.startsWith('/') ? fm.slug : [...dirs, fm.slug].join('/');
  } else if (/^(index|readme)$/i.test(name) || name === dirs.at(-1)) {
    route = dirs.join('/');
  } else {
    route = [...dirs, name].join('/');
  }
  route = route.replace(/^\/+|\/+$/g, '');
  return route ? `${route}/` : '';
}

