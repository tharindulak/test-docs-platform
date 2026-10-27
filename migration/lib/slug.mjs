// Slugs and label casing for the MkDocs converter: MkDocs heading ids (so old
// anchors keep working), Docusaurus heading ids, file-name slugs and the
// sentence case the documentation standards ask for in sidebar labels.
import GithubSlugger from 'github-slugger';

// Python-Markdown's toc.slugify (the MkDocs default): NFKD, ASCII only, drop
// everything but word characters, spaces and hyphens, then collapse runs of
// hyphens and spaces into one hyphen.
export function mkdocsSlug(text) {
  const ascii = text.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  return ascii.replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[-\s]+/g, '-');
}

// Python-Markdown's toc.unique: duplicates get _1, _2, …
export function mkdocsUnique(id, seen) {
  let out = id;
  while (!out || seen.has(out)) {
    const m = /^(.*)_([0-9]+)$/.exec(out);
    out = m ? `${m[1]}_${Number(m[2]) + 1}` : `${out}_1`;
  }
  seen.add(out);
  return out;
}

// Docusaurus heading ids: github-slugger with its de-duplication, one per
// page. Headings with an explicit id don't touch the counter, so the
// converter can ask what an id would be before deciding to set one.
export class DocusaurusSlugger {
  constructor() {
    this.occurrences = new Map();
  }

  peek(text) {
    return this.commit(text, new Map(this.occurrences));
  }

  commit(text, occ = this.occurrences) {
    const base = GithubSlugger.slug(text);
    let slug = base;
    while (occ.has(slug)) {
      occ.set(base, occ.get(base) + 1);
      slug = `${base}-${occ.get(base)}`;
    }
    occ.set(slug, 0);
    return slug;
  }
}

// File and folder names: lower-case kebab case.
export function fileSlug(text) {
  return text
    .normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Sentence case for labels. Keeps words that are acronyms or mixed case
// (API, OAuth, GraphQL), words with digits, and the product's proper nouns.
export function sentenceCase(label, properNouns = []) {
  let out = label.trim();
  const keep = new Map();
  // Protect multi-word proper nouns first ("Developer Portal").
  [...properNouns].sort((a, b) => b.length - a.length).forEach((noun, i) => {
    const re = new RegExp(`(?<![\\w-])${noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g');
    out = out.replace(re, () => {
      const token = `\u0001${i}\u0001`;
      keep.set(token, noun);
      return token;
    });
  });
  let first = true;
  out = out.replace(/[^\s/]+/g, (word) => {
    const isFirst = first;
    first = false;
    if (word.includes('\u0001')) return word;
    const letters = word.replace(/[^A-Za-z]/g, '');
    const upper = (letters.match(/[A-Z]/g) ?? []).length;
    if (upper >= 2 || /\d/.test(word) || /^[a-z]+[A-Z]/.test(word)) return word;
    if (isFirst) return word.charAt(0).toUpperCase() + word.slice(1);
    return word.toLowerCase();
  });
  for (const [token, noun] of keep) out = out.replaceAll(token, noun);
  // A protected noun at the start still starts with a capital.
  return out.charAt(0).toUpperCase() + out.slice(1);
}
