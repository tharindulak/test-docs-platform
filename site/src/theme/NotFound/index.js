// Safe swizzle (wrap): pushes the fixed 404 dataLayer event.
import React, { useEffect } from 'react';
import NotFound from '@theme-original/NotFound';
import { track, trackPageView } from '@site/src/components/chrome/analytics';

export default function NotFoundWrapper(props) {
  useEffect(() => {
    trackPageView('not-found');
    track('notFound', { path: window.location.pathname, referrer: document.referrer });
  }, []);
  return <NotFound {...props} />;
}
