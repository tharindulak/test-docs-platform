// chrome.json: the Platform chrome's runtime content (the wso2.com bar,
// footer, site-wide announcement, feedback endpoint). The source is chrome/chrome.json
// in this repo; a snapshot is baked into every build and the published copy at
// docs.wso2.com/chrome.json is fetched at runtime, so a link change needs no
// rebuild. Only ever add fields: deployments built long ago read it.
//
// Schema (version 1):
//   schemaVersion  1
//   header.links   [{ label, href }]           the header's right-side links in
//                  deployments built before the wso2.com bar; kept for them
//   header.site    the wso2.com bar above the docs bar:
//                  home     { label, href }      the WSO2 logo
//                  items    [{ label, href } | { label, groups: [{ title, href?, links: [{ label, href }] }] }]
//                           top-level links and menus, in order
//                  contact  { label, href }?     right side
//   announcement   null | { id, text, href?, linkText?, until? (YYYY-MM-DD) }
//                  a new id shows the banner again to readers who dismissed one
//   footer.columns [{ title, links: [{ label, href }] }]
//   footer.legal   [{ label, href }]
//   footer.copyright  text; "{year}" is replaced
//   feedback.endpoint  where "Was this page helpful?" posts (the Edge Worker's
//                      POST /api/feedback; root-relative or absolute)
// A root-relative href ("/contribute/") is on the docs host; anything else is
// absolute. Links always load a full page (they can cross deployments).
// Pure (no Node built-ins): the browser imports it too.

const isLink = (l) => l && typeof l.label === 'string' && l.label && typeof l.href === 'string' && /^(\/|https:\/\/)/.test(l.href);

export function validateChrome(c, where = 'chrome.json') {
  const errors = [];
  const links = (list, at) => {
    if (!Array.isArray(list)) return errors.push(`${at} must be a list`);
    list.forEach((l, i) => { if (!isLink(l)) errors.push(`${at}[${i}] needs a label and an href starting with / or https://`); });
  };
  if (c?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  links(c?.header?.links, 'header.links');
  const site = c?.header?.site;
  if (site !== undefined) {
    if (!isLink(site?.home)) errors.push('header.site.home needs a label and an href starting with / or https://');
    if (!Array.isArray(site?.items)) errors.push('header.site.items must be a list');
    else site.items.forEach((item, i) => {
      if (!item?.groups) return void (isLink(item) || errors.push(`header.site.items[${i}] needs a label and an href starting with / or https://, or groups`));
      if (!item.label) errors.push(`header.site.items[${i}].label is required`);
      if (!Array.isArray(item.groups)) return void errors.push(`header.site.items[${i}].groups must be a list`);
      item.groups.forEach((g, j) => {
        const at = `header.site.items[${i}].groups[${j}]`;
        if (!g?.title) errors.push(`${at}.title is required`);
        if (g?.href !== undefined && !isLink({ label: 'x', href: g.href })) errors.push(`${at}.href must start with / or https://`);
        links(g?.links, `${at}.links`);
      });
    });
    if (site?.contact !== undefined && !isLink(site.contact)) errors.push('header.site.contact needs a label and an href starting with / or https://');
  }
  if (!Array.isArray(c?.footer?.columns)) errors.push('footer.columns must be a list');
  else c.footer.columns.forEach((col, i) => {
    if (!col.title) errors.push(`footer.columns[${i}].title is required`);
    links(col.links, `footer.columns[${i}].links`);
  });
  links(c?.footer?.legal ?? [], 'footer.legal');
  const a = c?.announcement;
  if (a !== null && a !== undefined) {
    if (!a.id || !a.text) errors.push('announcement needs an id and a text');
    if (a.href !== undefined && !isLink({ label: 'x', href: a.href })) errors.push('announcement.href must start with / or https://');
    if (a.until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(a.until)) errors.push('announcement.until must be YYYY-MM-DD');
  }
  if (typeof c?.feedback?.endpoint !== 'string' || !/^(\/|https:\/\/)/.test(c.feedback.endpoint)) {
    errors.push('feedback.endpoint must start with / or https://');
  }
  if (errors.length) throw new Error(`${where}: ${errors.join('; ')}`);
  return c;
}

const isSite = (s) => isLink(s?.home) && Array.isArray(s.items)
  && s.items.every((i) => isLink(i) || (i?.label && Array.isArray(i.groups) && i.groups.every((g) => g?.title && Array.isArray(g.links) && g.links.every(isLink))));

// The runtime copy over the baked-in snapshot, one section at a time, so a
// missing or malformed section never blanks the header or footer.
export function mergeChrome(snapshot, live) {
  if (!live || typeof live !== 'object') return snapshot;
  const ok = (v, test) => (test(v) ? v : undefined);
  return {
    ...snapshot,
    // Field by field: a live copy older than header.site keeps the snapshot's bar.
    header: ok(live.header, (h) => Array.isArray(h?.links) && h.links.every(isLink) && (h.site === undefined || isSite(h.site)))
      ? { ...snapshot.header, ...live.header }
      : snapshot.header,
    footer: ok(live.footer, (f) => Array.isArray(f?.columns)) ?? snapshot.footer,
    announcement: 'announcement' in live ? live.announcement : snapshot.announcement,
    feedback: ok(live.feedback, (f) => typeof f?.endpoint === 'string') ?? snapshot.feedback,
  };
}

// The announcement to show today, if any (the `until` date is inclusive).
export function activeAnnouncement(chrome, today = new Date()) {
  const a = chrome?.announcement;
  if (!a?.id || !a.text) return null;
  if (a.until && today.toISOString().slice(0, 10) > a.until) return null;
  return a;
}

export const copyrightText = (text, year = new Date().getFullYear()) => (text ?? '').replaceAll('{year}', String(year));
