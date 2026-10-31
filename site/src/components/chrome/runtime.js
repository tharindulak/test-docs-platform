// Runtime data for the Platform chrome: the deployment manifest and chrome.json
// are server-rendered from the snapshots baked into the build, then replaced
// by the published copies once fetched (HTTP-cached for minutes by the edge).
// Also loads other deployments' page lists and redirect maps for the version
// selectors, and keeps the reader's navigation view and session section.
import { useCallback, useEffect, useRef, useState } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useLocation } from '@docusaurus/router';
import {
  SECTION_KEY, depKey, deploymentBase, editionList, focus, isArrival, mergeManifest, normaliseDeployment, rememberKey, rememberSection, sectionFor, spaceOf, toView,
} from '../../../../lib/switching.mjs';
import { mergeChrome } from '../../../../lib/chrome.mjs';

const cache = new Map();
export function fetchJson(url) {
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) {
    cache.set(url, fetch(url, { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return cache.get(url);
}

export function usePlatform() {
  const { siteConfig } = useDocusaurusContext();
  return { ...siteConfig.customFields, baseUrl: siteConfig.baseUrl };
}

function useRuntime(url, snapshot, merge) {
  const [value, setValue] = useState(snapshot);
  useEffect(() => {
    let live = true;
    fetchJson(url).then((data) => { if (live && data) setValue(merge(snapshot, data)); });
    return () => { live = false; };
  }, [url]);
  return value;
}

export function useManifest() {
  const p = usePlatform();
  return useRuntime(p.manifestUrl, p.manifestSnapshot, mergeManifest);
}

// The published manifest only, never the baked-in snapshot: null until it is
// fetched (and when it cannot be). Team notices read it, so a notice shows,
// changes or ends with the manifest, and no build ever carries a stale one.
export function useLiveManifest() {
  const p = usePlatform();
  const [value, setValue] = useState(null);
  useEffect(() => {
    let live = true;
    fetchJson(p.manifestUrl).then((data) => { if (live && data?.docSpaces) setValue(data); });
    return () => { live = false; };
  }, [p.manifestUrl]);
  return value;
}

export function useChrome() {
  const p = usePlatform();
  return useRuntime(p.chromeUrl, p.chromeSnapshot, mergeChrome);
}

// The reader's view: { edition: 'latest' | <id>, path relative to baseUrl }.
export function useView() {
  const p = usePlatform();
  const { pathname, hash } = useLocation();
  let rel = pathname.startsWith(p.baseUrl) ? pathname.slice(p.baseUrl.length) : '';
  if (rel && !rel.endsWith('/')) rel += '/';
  return { edition: p.asLatest ? 'latest' : p.edition, path: rel, hash };
}

// One deployment's _platform/pages.json + redirects.json, normalised.
export function loadDeployment(baseUrl) {
  return Promise.all([fetchJson(`${baseUrl}_platform/pages.json`), fetchJson(`${baseUrl}_platform/redirects.json`)])
    .then(([pages, redirects]) => (Array.isArray(pages) ? normaliseDeployment(pages, redirects ?? [], baseUrl) : null));
}

const storage = (kind) => {
  try { return typeof window === 'undefined' ? null : window[kind]; } catch { return null; }
};
export function readStore(kind, key) {
  try { return storage(kind)?.getItem(key) ?? null; } catch { return null; }
}
export function writeStore(kind, key, value) {
  try { if (value === null) storage(kind)?.removeItem(key); else storage(kind)?.setItem(key, value); } catch { /* private mode */ }
}

// Remembered Edition per Doc space: set only by an explicit dropdown choice.
export const readRemembered = (slug) => readStore('localStorage', rememberKey(slug));
export const writeRemembered = (slug, edition) => writeStore('localStorage', rememberKey(slug), edition);

// A notice to show on the page a switch lands on (another deployment).
const NOTICE_KEY = 'wso2docs:switch-notice';
export function setSwitchNotice(url, text) {
  writeStore('sessionStorage', NOTICE_KEY, text ? JSON.stringify({ url, text }) : null);
}
export function takeSwitchNotice(pathname) {
  const raw = readStore('sessionStorage', NOTICE_KEY);
  if (!raw) return null;
  writeStore('sessionStorage', NOTICE_KEY, null);
  try {
    const n = JSON.parse(raw);
    return n.url === pathname ? n.text : null;
  } catch { return null; }
}

// ---- The navigation view (Chrome: products menu, section menu and two version selectors)

// The view lib/switching.mjs reads: the deployment serving the page
// ({ space, edition, path }, the real Edition, never 'latest'), plus
// `asLatest` for the /latest/ twin. A Cloud part built on its own (its PR
// preview, at its address in its platform's tree) reads as that tree.
export function useNavView() {
  const p = usePlatform();
  const { pathname, hash } = useLocation();
  if (p.landing || !p.docSpace) return null;
  let rel = pathname.startsWith(p.baseUrl) ? pathname.slice(p.baseUrl.length) : '';
  if (rel && !rel.endsWith('/')) rel += '/';
  if (p.cloudPartOf) return { space: p.cloudPartOf, edition: 'cloud', path: `${p.docSpace}/${rel}`, asLatest: false, hash, base: p.baseUrl.slice(0, -(p.docSpace.length + 1)) };
  return { space: p.docSpace, edition: p.edition, path: rel, asLatest: Boolean(p.asLatest), hash, base: p.baseUrl };
}

// The Doc space and Edition the page belongs to (a Cloud part's page is the
// component's Cloud), also where the docs plugin is the only clue.
export function useFocus(manifest) {
  const view = useNavView();
  return view ? focus(manifest, view) : null;
}

// Every live Edition's page list for the Doc space being read, loaded once
// per page view on first use (hovering, focusing or opening a selector):
// { deployments, ensure }. The deployment serving the page is read from its
// own base (/latest/ for the latest twin).
export function useDeployments(manifest, view) {
  const [deployments, setDeployments] = useState({});
  const pending = useRef(null);
  const f = view ? focus(manifest, view) : null;
  const d = f ? spaceOf(manifest, f.doc) : null;
  const ids = d ? editionList(d) : [];
  // Loaded once per set of Editions: the live manifest can list an Edition the
  // baked snapshot lacks (a release newer than this build), so a load started
  // from the snapshot is not reused once the live copy arrives.
  const key = [view?.base, f?.doc, ...ids].join(',');
  const ensure = useCallback(() => {
    if (!view) return Promise.resolve({});
    if (pending.current?.key !== key) {
      pending.current = {
        key,
        promise: Promise.all([
          loadDeployment(view.base).then((x) => [depKey(view), x]),
          ...ids.map((id) => toView(manifest, f.doc, id, '')).filter((v) => depKey(v) !== depKey(view))
            .map((v) => loadDeployment(deploymentBase(manifest, v)).then((x) => [depKey(v), x])),
        ]).then((entries) => {
          const loaded = Object.fromEntries(entries.filter(([, x]) => x));
          if (pending.current?.key === key) setDeployments(loaded);
          return loaded;
        }),
      };
    }
    return pending.current.promise;
  }, [view?.space, view?.edition, key]);
  return { deployments, ensure };
}

// The Docs section the reader came through, per Doc space, for the browser
// session. An arrival from another host (search, a bookmark) forgets it, so
// such a reader sees the home section; moving between deployments on this
// host keeps it.
let arrivalHandled = false;
export function readSections() {
  try { return JSON.parse(readStore('sessionStorage', SECTION_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
export function writeSection(doc, sectionId) {
  writeStore('sessionStorage', SECTION_KEY, JSON.stringify(rememberSection(readSections(), doc, sectionId)));
}
export function useSection(manifest, view) {
  const [remembered, setRemembered] = useState({});
  useEffect(() => {
    if (!view) return;
    let r = readSections();
    if (!arrivalHandled) {
      arrivalHandled = true;
      if (isArrival(document.referrer, window.location.origin)) {
        const f = focus(manifest, view);
        r = Object.fromEntries(Object.entries(r).filter(([slug]) => slug !== f.doc && slug !== view.space));
        writeStore('sessionStorage', SECTION_KEY, JSON.stringify(r));
      }
    }
    setRemembered(r);
  }, [view?.space, view?.edition]);
  return view ? sectionFor(manifest, view, remembered) : null;
}
