// Safe swizzle (wrap): a Cloud part's page is titled with the part's Cloud
// Edition, "Guardrails | AI Gateway Cloud | WSO2 Docs" (URLs, latest and
// canonicals), although it is built inside its platform's Cloud tree, whose
// own pages read "... | API Platform Cloud | WSO2 Docs". The later <title>
// wins in the head, on the server render and on client navigation alike.
//
// It also keeps the canonical the server sent. The post-build step
// (plugins/platform-outputs.mjs) sets each page's canonical and og:url per the
// SEO rules (a pinned twin or an older version points at /latest/); once React
// takes over the head, Docusaurus would put the page's own URL back, which is
// what a crawler that runs scripts would read. The served values are read once,
// before hydration, and kept for that page.
import React from 'react';
import Metadata from '@theme-original/DocItem/Metadata';
import Head from '@docusaurus/Head';
import { useLocation } from '@docusaurus/router';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useActivePlugin, useDoc } from '@docusaurus/plugin-content-docs/client';

const served = typeof document === 'undefined' ? null : {
  path: window.location.pathname,
  canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
  ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null,
};

export default function MetadataWrapper(props) {
  const { siteConfig } = useDocusaurusContext();
  const { metadata } = useDoc();
  const { pathname } = useLocation();
  const plugin = useActivePlugin({ failfast: false });
  const part = siteConfig.customFields?.cloudParts?.[plugin?.pluginId];
  const keep = served?.canonical && served.path === pathname ? served : null;
  const title = part ? `${metadata.title} | ${part.editionName} | WSO2 Docs` : null;
  return (
    <>
      <Metadata {...props} />
      {(title || keep) && (
        <Head>
          {title && <title>{title}</title>}
          {title && <meta property="og:title" content={title} />}
          {keep && <link rel="canonical" href={keep.canonical} />}
          {keep?.ogUrl && <meta property="og:url" content={keep.ogUrl} />}
        </Head>
      )}
    </>
  );
}
