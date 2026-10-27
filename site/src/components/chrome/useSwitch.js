// Choosing a version in the header selector or in a section menu dropdown
// (lib/switching.mjs choose): one version state for the Doc space being read,
// so both selectors lead to the same place. For the Doc space being read the
// reader stays on the same page (or a renamed one, or its home page with a
// notice); another Doc space's dropdown opens its home page at that version.
// The choice is remembered for that Doc space; a Legacy version is a plain
// link that opens its old site in a new tab.
import { choose, focus } from '../../../../lib/switching.mjs';
import { setSwitchNotice, useDeployments, writeRemembered, writeSection } from './runtime';
import { track } from './analytics';

const timeout = (ms, value) => new Promise((resolve) => { setTimeout(() => resolve(value), ms); });

export default function useSwitch(manifest, view) {
  const { deployments, ensure } = useDeployments(manifest, view);
  // Returns 'noop' when the reader chose the Edition already open.
  const pick = async (e, doc, item, via, sectionId = null) => {
    if (item.external) { track('editionSwitch', { from: view.edition, to: item.id, result: 'legacy', via }); return null; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return null; // a new tab: a plain link
    e.preventDefault();
    const own = focus(manifest, view).doc === doc;
    const loaded = own ? await Promise.race([ensure(), timeout(2500, deployments)]) : {};
    const r = choose(manifest, loaded, view, doc, item.id, { asLatest: view.asLatest });
    if (r.remember) writeRemembered(doc, r.remember);
    if (sectionId) writeSection(doc, sectionId);
    track('editionSwitch', { from: view.edition, to: item.id, result: r.kind, via });
    if (r.noop) return 'noop';
    if (r.notice) setSwitchNotice(r.url, r.notice);
    window.location.assign(r.kind === 'same' ? `${r.url}${view.hash ?? ''}` : r.url);
    return r.kind;
  };
  return { deployments, ensure, pick };
}
