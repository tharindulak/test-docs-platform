// The weekly digest per Doc space (Analytics and feedback, item 5), sent to
// its owners: helpfulness by page with the top No reasons and the most
// frequent 404s (Workers Analytics Engine, written by the Edge Worker),
// searches with no results (Typesense analytics), and pages with new reported
// issues (GitHub). Each source needs a credential; without one it reports
// "not available" and the digest still renders. Tests pass `fixtures`.

const DAY = 24 * 60 * 60 * 1000;

// Analytics Engine SQL API. The Edge Worker writes
//   feedback:  index1 = space; blobs = space, segment, edition, page, yes|no, reason, environment
//   not found: index1 = space; blobs = space, segment, path, referer host, environment
async function analyticsSql(env, sql, fetchImpl) {
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    body: sql,
  });
  if (!res.ok) throw new Error(`Analytics Engine: HTTP ${res.status}`);
  return (await res.json()).data ?? [];
}

const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

export const SOURCES = {
  async helpfulness({ space, days, env, fetchImpl, environment }) {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) return { unavailable: 'needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Analytics read)' };
    const rows = await analyticsSql(env, `SELECT blob4 AS page, blob5 AS vote, blob6 AS reason, SUM(_sample_interval) AS votes
      FROM ${env.FEEDBACK_DATASET ?? 'docs_feedback'}
      WHERE index1 = ${sqlString(space)} AND blob7 = ${sqlString(environment)} AND timestamp > NOW() - INTERVAL '${Number(days)}' DAY
      GROUP BY page, vote, reason`, fetchImpl);
    return { rows: rows.map((r) => ({ page: r.page, vote: r.vote, reason: r.reason || null, votes: Number(r.votes) })) };
  },
  async notFound({ space, days, env, fetchImpl, environment }) {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) return { unavailable: 'needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Analytics read)' };
    const rows = await analyticsSql(env, `SELECT blob3 AS path, blob4 AS referer, SUM(_sample_interval) AS hits
      FROM ${env.NOT_FOUND_DATASET ?? 'docs_not_found'}
      WHERE index1 = ${sqlString(space)} AND blob5 = ${sqlString(environment)} AND timestamp > NOW() - INTERVAL '${Number(days)}' DAY
      GROUP BY path, referer ORDER BY hits DESC LIMIT 50`, fetchImpl);
    return { rows: rows.map((r) => ({ path: r.path, referer: r.referer || null, hits: Number(r.hits) })) };
  },
  // ASSUMPTION (Search on staging decides the names): a Typesense analytics
  // rule collects no-hit queries into TYPESENSE_NO_HITS_COLLECTION with
  // fields q, count and docSpace.
  async noResults({ space, env, fetchImpl }) {
    if (!env.TYPESENSE_HOST || !env.TYPESENSE_API_KEY) return { unavailable: 'needs TYPESENSE_HOST and TYPESENSE_API_KEY (search-only analytics key)' };
    const collection = env.TYPESENSE_NO_HITS_COLLECTION ?? 'docs_no_hits_queries';
    const url = `${env.TYPESENSE_HOST.replace(/\/$/, '')}/collections/${collection}/documents/search?q=*&filter_by=${encodeURIComponent(`docSpace:=${space}`)}&sort_by=count:desc&per_page=25`;
    const res = await fetchImpl(url, { headers: { 'X-TYPESENSE-API-KEY': env.TYPESENSE_API_KEY } });
    if (!res.ok) throw new Error(`Typesense: HTTP ${res.status}`);
    return { rows: ((await res.json()).hits ?? []).map((h) => ({ query: h.document.q, count: Number(h.document.count) })) };
  },
  // "Report an issue" opens a prefilled issue whose body has a "Page: <url>" line.
  async issues({ repo, days, env, fetchImpl, now }) {
    if (!repo) return { unavailable: 'the Doc space has no Content repo in the manifest policy' };
    if (!env.GITHUB_TOKEN) return { unavailable: 'needs GITHUB_TOKEN' };
    const since = new Date(now - days * DAY).toISOString().slice(0, 10);
    const q = encodeURIComponent(`repo:${repo} is:issue created:>=${since}`);
    const res = await fetchImpl(`https://api.github.com/search/issues?q=${q}&per_page=100`, { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
    return {
      rows: ((await res.json()).items ?? []).map((i) => ({
        number: i.number, title: i.title, url: i.html_url, page: /^\s*Page:\s*(\S+)/im.exec(i.body ?? '')?.[1] ?? null,
      })),
    };
  },
};

export async function collectDigest({ space, repo, days = 7, env = process.env, fetchImpl = fetch, fixtures = null, environment = 'production', now = Date.now() }) {
  const data = {};
  for (const [name, source] of Object.entries(SOURCES)) {
    try {
      data[name] = fixtures ? (fixtures[name] ?? { unavailable: 'no fixture' }) : await source({ space, repo, days, env, fetchImpl, environment, now });
    } catch (err) {
      data[name] = { unavailable: err.message };
    }
  }
  return { space, repo, days, environment, from: new Date(now - days * DAY).toISOString().slice(0, 10), to: new Date(now).toISOString().slice(0, 10), data };
}

const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n') : '_Nothing this week._');
const section = (d, render) => (d.unavailable ? `_Not available: ${d.unavailable}._` : render(d.rows));

export function renderDigest(digest, { displayName = digest.space } = {}) {
  const { data } = digest;
  const helpful = section(data.helpfulness, (rows) => {
    const pages = new Map();
    for (const r of rows) {
      const p = pages.get(r.page) ?? { yes: 0, no: 0, reasons: new Map() };
      p[r.vote === 'yes' ? 'yes' : 'no'] += r.votes;
      if (r.vote !== 'yes' && r.reason) p.reasons.set(r.reason, (p.reasons.get(r.reason) ?? 0) + r.votes);
      pages.set(r.page, p);
    }
    const list = [...pages].map(([page, p]) => ({ page, ...p, total: p.yes + p.no }))
      .sort((a, b) => b.no - a.no || b.total - a.total).slice(0, 15);
    const reasons = new Map();
    for (const p of pages.values()) for (const [r, n] of p.reasons) reasons.set(r, (reasons.get(r) ?? 0) + n);
    return `${table(['Page', 'Yes', 'No', 'Helpful', 'Top No reason'], list.map((p) => [p.page, p.yes, p.no, `${Math.round((100 * p.yes) / (p.total || 1))}%`, [...p.reasons].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '']))}

Top No reasons: ${[...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([r, n]) => `${r} (${n})`).join(', ') || 'none'}.`;
  });
  return `# Weekly docs digest: ${displayName}

${digest.from} to ${digest.to} (${digest.environment})

## Was this page helpful?

${helpful}

## Searches with no results

${section(data.noResults, (rows) => table(['Query', 'Searches'], rows.slice(0, 20).map((r) => [r.query, r.count])))}

## Most frequent 404s

${section(data.notFound, (rows) => table(['Path', 'Hits', 'Linked from'], rows.slice(0, 20).map((r) => [r.path, r.hits, r.referer ?? ''])))}

## New reported issues

${section(data.issues, (rows) => table(['Issue', 'Page'], rows.map((r) => [`[#${r.number} ${r.title.replace(/\|/g, '\\|')}](${r.url})`, r.page ?? ''])))}
`;
}
