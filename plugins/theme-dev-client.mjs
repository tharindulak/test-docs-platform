// Preview only (plugins/theme.mjs): when a file in site/wso2-theme/ changes,
// the plugin rewrites the dev server's theme bundle and its version module,
// and webpack's hot reload brings the new version here. The page then loads
// the new theme.css beside the old one and drops the old one once it has
// loaded, so it never shows unstyled, and reloads the theme's images.
import version from '@generated/wso2-theme/version.js';

function refresh(v) {
  for (const link of document.querySelectorAll('link[data-wso2-theme]')) {
    const next = link.cloneNode();
    const url = new URL(link.href);
    url.searchParams.set('v', v);
    next.href = url.href;
    next.addEventListener('load', () => link.remove(), { once: true });
    link.after(next);
    const base = url.pathname.replace(/theme\.css$/, '');
    for (const img of document.querySelectorAll(`img[src^="${base}img/"]`)) {
      const src = new URL(img.src);
      src.searchParams.set('v', v);
      img.src = src.href;
    }
  }
}

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept('@generated/wso2-theme/version.js', () => refresh(version));
}
