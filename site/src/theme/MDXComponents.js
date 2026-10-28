// Safe swizzle (wrap): adds the Platform's MDX components to every page.
// Each one needs a Markdown form in lib/markdown-forms.mjs (CI checks this).
import MDXComponents from '@theme-original/MDXComponents';
import Anchor from '@site/src/components/Anchor';
import DocsLink from '@site/src/components/DocsLink';
import FileLink from '@site/src/components/FileLink';
import EditionMarker from '@site/src/components/EditionMarker';
import SelfHostedAddition from '@site/src/components/SelfHostedAddition';
import ApiComponents from '@site/src/components/api';
import PageActions from '@site/src/components/PageActions';
import LayoutComponents from '@site/src/components/layouts';

export default {
  ...MDXComponents,
  a: FileLink,
  Anchor,
  DocsLink,
  EditionMarker,
  SelfHostedAddition,
  ...ApiComponents,
  ...LayoutComponents,
  PageActions,
};
