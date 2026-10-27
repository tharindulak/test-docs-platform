// Where a page's Markdown twin lives (AI/LLM-friendly docs): the page URL with
// `.md` instead of the trailing slash, `…/guides/mfa/` → `…/guides/mfa.md`.
// An Edition's home page has its twin at `index.md`. Shared by the exporter,
// the twin checks, the "Copy page" menu and the Edge Worker's MCP endpoint, so
// it has no Node imports and lives with the Edge Worker (lib/twin-paths.mjs
// re-exports it).

// rel is a route relative to the Edition's base URL: '' or 'guides/mfa/'.
export function twinPath(rel) {
  const clean = rel.replace(/^\/+/, '');
  if (clean === '' || clean === '/') return 'index.md';
  return `${clean.replace(/\/+$/, '')}.md`;
}

// The inverse: 'index.md' → '', 'guides/mfa.md' → 'guides/mfa/', 'guides/index.md' → 'guides/'.
export function pageOfTwin(relMd) {
  const base = relMd.replace(/\.md$/, '');
  if (base === 'index') return '';
  return `${base.replace(/\/index$/, '')}/`;
}

// A full page path such as '/identity-platform/7.3.0/guides/mfa/' → its twin's path.
export function twinUrlPath(pagePath, baseUrl) {
  const p = pagePath.endsWith('/') ? pagePath : `${pagePath}/`;
  if (!p.startsWith(baseUrl)) return `${p.replace(/\/+$/, '')}.md`;
  return `${baseUrl}${twinPath(p.slice(baseUrl.length))}`;
}

// The prompt the "Open in Claude / ChatGPT" items start a chat with.
export function chatPrompt(twinUrl) {
  return `Read ${twinUrl} so I can ask you questions about it.`;
}

export function chatLinks(twinUrl) {
  const q = encodeURIComponent(chatPrompt(twinUrl));
  return {
    claude: `https://claude.ai/new?q=${q}`,
    chatgpt: `https://chatgpt.com/?q=${q}`,
  };
}
