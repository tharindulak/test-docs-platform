// Safe swizzle (wrap): a Cloud part's page is titled with the part's Cloud
// Edition, "Guardrails | AI Gateway Cloud | WSO2 Docs" (URLs, latest and
// canonicals), although it is built inside its platform's Cloud tree, whose
// own pages read "... | API Platform Cloud | WSO2 Docs". The later <title>
// wins in the head, on the server render and on client navigation alike.
import React from 'react';
import Metadata from '@theme-original/DocItem/Metadata';
import Head from '@docusaurus/Head';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useActivePlugin, useDoc } from '@docusaurus/plugin-content-docs/client';

export default function MetadataWrapper(props) {
  const { siteConfig } = useDocusaurusContext();
  const { metadata } = useDoc();
  const plugin = useActivePlugin({ failfast: false });
  const part = siteConfig.customFields?.cloudParts?.[plugin?.pluginId];
  if (!part) return <Metadata {...props} />;
  const title = `${metadata.title} | ${part.editionName} | WSO2 Docs`;
  return (
    <>
      <Metadata {...props} />
      <Head>
        <title>{title}</title>
        <meta property="og:title" content={title} />
      </Head>
    </>
  );
}
