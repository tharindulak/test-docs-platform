// Helpers for the report jobs (bin/wso2-reports.mjs).

// Live Doc spaces with a Content repo (no legacy or staging-only spaces).
export function liveSpaces(policy, environment = 'production') {
  return Object.entries(policy.docSpaces)
    .filter(([, s]) => s.status !== 'legacy' && (!s.environments || s.environments.includes(environment)))
    .map(([slug, s]) => ({
      space: slug, displayName: s.displayName, repo: s.repo ?? null, issuesRepo: s.issues?.repo ?? s.repo ?? null, model: s.model,
      segments: s.model === 'unversioned' ? ['_'] : [...(s.latest ? ['latest'] : []), ...(s.editions ?? []).filter((e) => e.status !== 'legacy').map((e) => e.id)],
    }));
}

export function lintCounts(reports) {
  const ids = ['vale', 'spelling', 'headings'];
  const rows = reports.map((r) => {
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    const n = (id) => (by[id]?.skipped ? 'skipped' : String(by[id]?.findings.length ?? 0));
    return `| ${r.docSpace} | ${r.edition} | ${ids.map(n).join(' | ')} | ${r.summary.blocking} |`;
  });
  return ['| Doc space | Edition | Vale | Spelling | Headings and house style | Blocking |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

// A fixed-size sample of a sitemap's URLs, changing daily (seeded), for the
// nightly axe run; the weekly run passes --sample 0 for every URL.
export function sampleUrls(urls, sample, seed) {
  if (!sample || sample >= urls.length) return urls;
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const start = h % urls.length;
  return Array.from({ length: sample }, (_, i) => urls[(start + i * Math.max(1, Math.floor(urls.length / sample))) % urls.length]);
}
