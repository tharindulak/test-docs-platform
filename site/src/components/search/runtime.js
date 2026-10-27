// Runtime inputs of the search box: which page the search starts from (the
// Doc space and Edition being read, a Cloud part's page being its component's
// Cloud, the deployment serving it and the Docs section the chrome draws),
// the deployment manifest (the live copy, falling back to the snapshot baked
// into the build, from the chrome's runtime) and the search endpoint for this
// host. The section comes from the live manifest and the session's section,
// as the section menu's does, so a section that changes changes the search's
// Docs section scope with no rebuild.
import { useEffect, useState } from 'react';
import { contextFromView, deploymentContext } from '../../../../lib/search/scopes.mjs';
import { pickEnvironment } from '../../../../lib/search/environments.mjs';
import { focus } from '../../../../lib/switching.mjs';
import { useManifest, useNavView, usePlatform, useSection } from '../chrome/runtime';
import { track } from '../chrome/analytics';

export function useSearchSetup({ landing } = {}) {
  const f = usePlatform();
  const manifest = useManifest(); // the live copy, falling back to the snapshot
  const isLanding = Boolean(landing || f.landing);
  const view = useNavView();
  const section = useSection(manifest, isLanding ? null : view);
  const [env, setEnv] = useState(null);
  useEffect(() => { setEnv(pickEnvironment(f.search, window.location.hostname)); }, []);
  const ctx = isLanding || !view
    ? deploymentContext({ docSpace: f.docSpace, edition: f.edition, asLatest: f.asLatest, landing: isLanding })
    : contextFromView(view, focus(manifest, view), section);
  return { ctx, manifest, env };
}

// The Platform's docs_search dataLayer event (query, scope, results); the
// chrome adds Doc space, Edition and page type.
export function trackSearch({ query, scope, results }) {
  track('search', { query, scope, results });
}
