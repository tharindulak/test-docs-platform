// The Platform's fixed dataLayer events (Analytics and feedback). GTM, when the
// production head script loaded it and the reader consented, picks them up;
// elsewhere they only land in window.dataLayer. Other Platform pieces call
// track('search', {...}), track('copyPage'), track('openInAi', {...}).
import { EVENTS } from '../../../../lib/analytics.mjs';

let context = {};
let lastPageView = null;

export function setAnalyticsContext(fields) {
  context = { ...context, ...fields };
}

export function track(name, data = {}) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: EVENTS[name] ?? name, ...context, ...data });
}

// Pages that know their page type track their own view; the Root wrapper
// tracks the rest (child effects run before the Root's in the same commit).
export function trackPageView(pageType) {
  lastPageView = window.location.pathname;
  track('pageView', { pageType, page: lastPageView });
}
export function trackPageViewOnce(pageType) {
  if (lastPageView !== window.location.pathname) trackPageView(pageType);
}
