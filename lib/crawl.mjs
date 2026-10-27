// The staging crawl gate (Quality gates for Docs releases): after a flip, every
// page of each new deployment must answer 200 on the staging host, and every
// link on those pages to WSO2 Docs must resolve there, links into other Docs
// deployments included (onBrokenLinks cannot see those). Builds carry
// production URLs, so links to the production host are checked on staging.
// Links to old Confluence paths on docs.wso2.com are external: each passes when
// the Edge Worker answers it with the archive's 301 (worker/src/confluence.mjs),
// and the crawl never follows it off-site.
import { confluenceRedirect } from '../worker/src/confluence.mjs';
import { releasePrefix, baseUrlFor } from './release.mjs';
import { pool } from './storage.mjs';

const hrefs = (html) => [...html.matchAll(/<a\s[^>]*href="([^"#][^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

export async function crawl({ storage, host, productionHost = 'https://docs.wso2.com', deployments, concurrency = 8, fetchImpl = fetch }) {
  const origin = new URL(host).origin;
  const prod = new URL(productionHost).origin;
  const pages = [];
  for (const { space, segment, release } of deployments) {
    const obj = await storage.get(`${releasePrefix(space, segment, release)}_platform/pages.json`);
    if (!obj) throw new Error(`No pages.json for ${space}/${segment}/${release}`);
    for (const p of JSON.parse(new TextDecoder().decode(obj.body))) pages.push(`${origin}${baseUrlFor(space, segment)}${p.path}`);
  }
  const failures = [];
  const links = new Map();
  const archived = new Map();
  await pool(pages, concurrency, async (url) => {
    const res = await fetchImpl(url, { redirect: 'manual' });
    if (res.status !== 200) {
      failures.push({ url, status: res.status, kind: 'page' });
      return;
    }
    for (const href of hrefs(await res.text())) {
      let target = new URL(href, url);
      if (target.origin === prod) target = new URL(target.pathname + target.search, origin);
      if (target.origin !== origin) continue;
      target.hash = '';
      if (confluenceRedirect(target.pathname, target.search)) {
        if (!archived.has(target.href)) archived.set(target.href, url);
      } else if (!links.has(target.href)) links.set(target.href, url);
    }
  });
  await pool([...links.keys()], concurrency, async (url) => {
    const res = await fetchImpl(url, { redirect: 'follow' });
    await res.arrayBuffer();
    if (res.status !== 200) failures.push({ url, status: res.status, kind: 'link', from: links.get(url) });
  });
  await pool([...archived.keys()], concurrency, async (url) => {
    const u = new URL(url);
    const want = confluenceRedirect(u.pathname, u.search);
    const res = await fetchImpl(url, { redirect: 'manual' });
    await res.arrayBuffer();
    if (res.status !== 301 || res.headers.get('location') !== want) {
      failures.push({ url, status: res.status, kind: 'confluence', from: archived.get(url), expected: want, location: res.headers.get('location') });
    }
  });
  return { pages: pages.length, links: links.size, external: archived.size, failures: failures.sort((a, b) => a.url.localeCompare(b.url)) };
}
