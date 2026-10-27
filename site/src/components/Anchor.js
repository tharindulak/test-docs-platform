// <Anchor id="…" />: a link target that is not a heading (migrated
// <a name="…"> anchors). It registers the id with Docusaurus's broken-anchor
// check, so links to it are validated like links to headings.
import React from 'react';
import useBrokenLinks from '@docusaurus/useBrokenLinks';

export default function Anchor({ id }) {
  useBrokenLinks().collectAnchor(id);
  return <span id={id} />;
}
