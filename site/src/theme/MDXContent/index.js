// Safe swizzle (wrap): on doc pages, Edition notices above the content and the
// feedback widget, "Edit this page" and "Report an issue" after it.
import React from 'react';
import MDXContent from '@theme-original/MDXContent';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import EditionNotices from '@site/src/components/chrome/EditionNotices';
import PageEnd from '@site/src/components/chrome/PageEnd';

// useDoc reads its context before throwing, so the hook order stays stable.
function useOptionalDoc() {
  try {
    return useDoc();
  } catch {
    return null;
  }
}

export default function MDXContentWrapper(props) {
  const doc = useOptionalDoc();
  if (!doc) return <MDXContent {...props} />;
  return (
    <>
      <EditionNotices cloudContent={doc.frontMatter?.wso2_cloud_content === true} />
      <MDXContent {...props} />
      <PageEnd doc={doc} />
    </>
  );
}
