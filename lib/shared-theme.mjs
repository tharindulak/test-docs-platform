// The shared theme at the edge (Releases and deployments: the shared theme).
// Colours, type, spacing, fonts, the logo and favicons and the code colours
// live in site/wso2-theme/; lib/theme-bundle.mjs writes them as one
// self-contained bundle (theme.css, fonts/, img/). Every page links the live
// theme of its Platform major at /_platform/theme/v<major>/theme.css, so a
// theme change reaches every live Docs deployment without rebuilding it.
//
// Stored like a Docs deployment, in the environment's bucket:
//   _releases/_theme/v<major>/<theme id>/...      one immutable folder per published theme
//   _releases/_theme/v<major>/<theme id>/_platform/release.json   written last: "complete"
//   _platform/state.json  theme.v<major>          { release, platformVersion, deployedAt, previous }
//   manifest.json         theme.v<major>.release   what the Edge Worker serves as live
// A theme id is <Platform version>.r<run id>, as a rebuild's release id is
// <release>.r<run id>. The bundle's url()s name its own folder by id
// (/_platform/theme/v<major>/<theme id>/fonts/...), which the edge caches a
// year; the live address is cached 5 minutes. Going live is a pointer move
// under the state lock, and so is a rollback; gc keeps the newest 20.
import fs from 'node:fs';
import path from 'node:path';
import {
  HISTORY, NO_EDITION, THEME_SPACE, baseUrlFor, planRelease, publishRuntime, putJson, readJson, readState, releasePrefix, STATE_KEY,
} from './release.mjs';
import { contentTypeFor, pool } from './storage.mjs';
import { THEME_ID, THEME_PREFIX } from '../worker/src/routing.mjs';

export { THEME_ID };
export const THEME_FILE = 'theme.css';

const majorKey = (major) => {
  const n = Number(major);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid Platform major "${major}"`);
  return `v${n}`;
};
const checkThemeId = (id) => {
  if (!THEME_ID.test(String(id ?? ''))) throw new Error(`Invalid theme id "${id}": it is <Platform version>.r<run id>, such as 1.4.0.r123456`);
  return String(id);
};

// <Platform version>.r<run id>: the workflow run id in Actions; by hand, any
// letters, digits and dashes (a UTC timestamp by default).
export const themeIdFor = (version, runId) => checkThemeId(`${version}.r${runId}`);
export const themePrefix = (major, id) => releasePrefix(THEME_SPACE, majorKey(major), checkThemeId(id));
// The address the bundle's url()s start with: its own folder, by id.
export const themeUrlBase = (major, id) => `${THEME_PREFIX}${majorKey(major)}/${checkThemeId(id)}/`;
// The address every page links.
export const liveThemeUrl = (major) => `${THEME_PREFIX}${majorKey(major)}/${THEME_FILE}`;

function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

// A prepared bundle is publishable under `id` when it has theme.css and every
// url() in it is a data: URL or a file of this bundle, by this id's address
// (so a bundle written for another id, or one reaching off-site, is refused).
export function checkThemeBundle(dir, { major, release }) {
  const problems = [];
  const css = path.join(dir, THEME_FILE);
  if (!fs.existsSync(css)) return [`missing ${THEME_FILE}`];
  const base = themeUrlBase(major, release);
  const text = fs.readFileSync(css, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const url = m[2].trim();
    if (url.startsWith('data:') || url.startsWith('#')) continue;
    if (!url.startsWith(base)) {
      problems.push(`${THEME_FILE}: url(${url}) is outside ${base}; write the bundle with urlBase ${base}`);
      continue;
    }
    const rel = url.slice(base.length).replace(/[?#].*$/, '');
    if (!fs.existsSync(path.join(dir, decodeURIComponent(rel)))) problems.push(`${THEME_FILE}: url(${url}) names ${rel}, which the bundle lacks`);
  }
  return [...new Set(problems)];
}

// Uploads a prepared bundle to its immutable folder; release.json last, so a
// folder without it is never flipped to. Publishing a complete id again is a
// no-op (re-runs).
export async function publishTheme(storage, dir, { major, release, platformVersion = null, source = {}, concurrency = 16, now = new Date() }) {
  const problems = checkThemeBundle(dir, { major, release });
  if (problems.length) throw new Error(`Theme bundle in ${dir} is not publishable:\n  ${problems.join('\n  ')}`);
  const prefix = themePrefix(major, release);
  const marker = `${prefix}_platform/release.json`;
  if (await storage.get(marker)) return { prefix, skipped: true };
  const files = filesUnder(dir).filter((f) => !f.startsWith('_platform/'));
  let bytes = 0;
  await pool(files, concurrency, async (rel) => {
    const body = fs.readFileSync(path.join(dir, rel));
    bytes += body.length;
    await storage.put(prefix + rel, body, { contentType: contentTypeFor(rel) });
  });
  const info = { kind: 'theme', major: Number(major), release, publishedAt: now.toISOString(), files: files.length, bytes, platformVersion, source };
  await putJson(storage, marker, info);
  return { prefix, skipped: false, ...info };
}

// Going live: one state write points the major's theme at the published
// folder, then the runtime files are republished (manifest.json names it for
// the edge). As with a Docs deployment, a flip never moves the theme to one
// published before the live one, since writers are never cancelled; only a
// rollback (backwards) goes back. Run it under the state lock.
export async function flipTheme(storage, { environment, policy, major, release, now = new Date(), backwards = false }) {
  const state = await readState(storage);
  if (state.environment && environment && state.environment !== environment) {
    throw new Error(`Storage ${storage.name} holds ${state.environment} state, not ${environment}`);
  }
  const key = majorKey(major);
  const info = await readJson(storage, `${themePrefix(major, release)}_platform/release.json`);
  if (!info) throw new Error(`Theme ${key}/${release} is missing or incomplete; publish it first`);
  const prev = state.theme?.[key];
  const warnings = [];
  if (!backwards && prev && prev.release !== release) {
    const live = await readJson(storage, `${themePrefix(major, prev.release)}_platform/release.json`);
    if (live?.publishedAt && info.publishedAt && live.publishedAt > info.publishedAt) {
      return { state, warnings: [`theme ${key} stays on ${prev.release}, published after ${release}; roll back to go back`], kept: true, from: prev.release };
    }
  }
  const previous = prev ? [prev.release, ...(prev.previous ?? [])] : [];
  state.theme = {
    ...(state.theme ?? {}),
    [key]: {
      release, platformVersion: info.platformVersion ?? null, deployedAt: now.toISOString(),
      previous: [...new Set(previous.filter((r) => r !== release))].slice(0, HISTORY),
    },
  };
  state.environment = environment ?? state.environment;
  state.updatedAt = now.toISOString();
  await putJson(storage, STATE_KEY, state);
  const { warnings: runtime } = await publishRuntime(storage, { policy, state, environment: state.environment, now });
  return { state, warnings: [...warnings, ...runtime], kept: false, from: prev?.release ?? null };
}

// A rollback moves the pointer back to the previous (or a named) published theme.
export async function rollbackTheme(storage, { environment, policy, major, to, now }) {
  const state = await readState(storage);
  const cur = state.theme?.[majorKey(major)];
  if (!cur) throw new Error(`No theme is live for ${majorKey(major)}`);
  const target = to ?? cur.previous?.[0];
  if (!target) throw new Error(`Theme ${majorKey(major)} has no earlier theme to roll back to`);
  return flipTheme(storage, { environment, policy, major, release: target, now, backwards: true });
}

// Every published theme, newest first, per major: { major, release, live,
// previous (in the pointer's history), publishedAt, platformVersion, source }.
export async function listThemes(storage, { major } = {}) {
  const state = await readState(storage);
  const majors = major === undefined ? await storage.listFolders(`_releases/${THEME_SPACE}/`) : [majorKey(major)];
  const out = [];
  for (const key of majors.sort()) {
    const pointer = state.theme?.[key];
    const rows = [];
    for (const release of await storage.listFolders(`_releases/${THEME_SPACE}/${key}/`)) {
      const info = await readJson(storage, `${releasePrefix(THEME_SPACE, key, release)}_platform/release.json`);
      rows.push({
        major: key, release, live: pointer?.release === release, previous: Boolean(pointer?.previous?.includes(release)),
        complete: Boolean(info), publishedAt: info?.publishedAt ?? null, platformVersion: info?.platformVersion ?? null, source: info?.source ?? null,
      });
    }
    rows.sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));
    out.push(...rows);
  }
  return out;
}

// Whether a Docs deployment's release links the shared theme: one built
// before the switch carries its own look in its pages, so a rollback to it
// shows that old look and theme changes never reach it. Read from its home
// page (or its 404 page), with the Platform version from its release.json.
export async function sharedThemeOf(storage, { space, segment, release }) {
  const prefix = releasePrefix(space, segment, release);
  const info = await readJson(storage, `${prefix}_platform/release.json`);
  for (const page of ['index.html', '404.html']) {
    const obj = await storage.get(prefix + page);
    if (obj) return { shared: new TextDecoder().decode(obj.body).includes(THEME_PREFIX), platformVersion: info?.platformVersion ?? null, page };
  }
  return { shared: null, platformVersion: info?.platformVersion ?? null, page: null };
}

export const CHECK_VIEWPORTS = [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 375, height: 812 }];
export const CHECK_MODES = ['light', 'dark'];

// The theme checks' pages: one sample page of every live Docs deployment of
// `major` (the deployments a Platform release of that major rebuilds: their
// Content repo pins it, plus Contribute and the Landing deployment), in light
// and dark (Docusaurus's ?docusaurus-theme=), at desktop width and 375 px.
// The sample is the deployment's first page below its home page in
// pages.json, else its home page. Each check has its own URL (the width rides
// along as a query parameter pages ignore), since pa11y-ci keys its report
// by URL. Returns a pa11y-ci config (axe, WCAG 2 AA: its color-contrast rule
// is the rendered contrast check) with a screenshot per page, the live theme
// of the major (the baseline the new theme is compared with, or null), plus
// the deployments and those left out.
export async function themeCheckPages(storage, { policy, major, pins, host, screenshots = 'screenshots', state }) {
  const live = state ?? (await readState(storage));
  const skipped = [];
  const planned = planRelease(policy, { scope: 'all', state: live, rebuildId: 'check', major: Number(major), pins, onSkip: (s) => skipped.push(s) });
  const seen = new Set();
  const origin = new URL(host).origin;
  const deployments = [];
  const urls = [];
  for (const d of planned) {
    const key = `${d.space}/${d.segment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const release = live.deployments[key]?.release;
    if (!release) continue;
    const pages = (await readJson(storage, `${releasePrefix(d.space, d.segment, release)}_platform/pages.json`)) ?? [];
    const sample = pages.map((p) => p.path).find((p) => p) ?? '';
    const page = `${origin}${baseUrlFor(d.space, d.segment)}${sample}`;
    deployments.push({ deployment: key, release, page });
    const name = `${d.space}-${d.segment === NO_EDITION ? 'root' : d.segment}`.replace(/[^A-Za-z0-9._-]/g, '-');
    for (const mode of CHECK_MODES) {
      for (const v of CHECK_VIEWPORTS) {
        urls.push({
          url: `${page}${page.includes('?') ? '&' : '?'}docusaurus-theme=${mode}&width=${v.width}`,
          viewport: { width: v.width, height: v.height },
          screenCapture: `${screenshots}/${name}-${mode}-${v.width}.png`,
        });
      }
    }
  }
  const config = {
    defaults: { runners: ['axe'], standard: 'WCAG2AA', timeout: 60000, chromeLaunchConfig: { args: ['--no-sandbox'] } },
    urls,
  };
  const liveTheme = live.theme?.[majorKey(major)]?.release ?? null;
  return { config, deployments, skipped, live: liveTheme };
}

// The same checks without screenshots: the baseline run, with the live theme.
export const baselineConfig = (config) => ({ ...config, urls: config.urls.map(({ screenCapture, ...u }) => u) });

// One page's axe violations from a pa11y-ci --json report: url -> issues, or
// null when the page could not be checked (pa11y-ci records the error, which
// has no rule code).
function reportPages(report) {
  const pages = new Map();
  for (const [url, issues] of Object.entries(report?.results ?? {})) {
    const list = Array.isArray(issues) ? issues : [];
    if (list.some((i) => !i?.code)) {
      pages.set(url, null);
      continue;
    }
    pages.set(url, list.filter((i) => (i.type ?? 'error') === 'error'));
  }
  return pages;
}
const issueKey = (i) => `${i.code}\n${i.selector ?? ''}`;

// The theme's axe gate: only what the new theme introduces blocks. For each
// page (sample page x mode x width), a violation counts as introduced when
// the run with the new theme has it (same rule, same element) and the run
// with the live theme hasn't. Without a baseline (the major's first theme),
// every violation is introduced. A page the new run couldn't check blocks; a
// page the baseline couldn't check has no baseline, so all its violations
// count. Returns the counts of both runs and the introduced violations.
export function compareA11y(baseline, current) {
  if (!current?.results) throw new Error('The new theme\'s axe report has no results: pa11y-ci did not run');
  const before = baseline ? reportPages(baseline) : new Map();
  const after = reportPages(current);
  const introduced = [];
  const unchecked = [];
  let fixed = 0;
  for (const [url, issues] of after) {
    if (issues === null) {
      unchecked.push(url);
      continue;
    }
    const old = before.get(url);
    const known = new Set((old ?? []).map(issueKey));
    for (const i of issues) if (!known.has(issueKey(i))) introduced.push({ url, code: i.code, selector: i.selector ?? null, message: i.message ?? '' });
    const now = new Set(issues.map(issueKey));
    fixed += (old ?? []).filter((i) => !now.has(issueKey(i))).length;
  }
  const count = (pages) => [...pages.values()].reduce((n, list) => n + (list?.length ?? 0), 0);
  return {
    pass: introduced.length === 0 && unchecked.length === 0,
    baseline: Boolean(baseline),
    pages: after.size,
    old: baseline ? count(before) : null,
    new: count(after),
    introduced,
    fixed,
    unchecked,
  };
}
