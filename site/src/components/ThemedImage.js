// <ThemedImage light="…" dark="…" alt="…" />: one image per colour theme,
// for screenshots taken in both (Platform component catalogue). Pages give
// literal paths; plugins/remark-themed-image.mjs turns relative ones into
// bundled assets before compile. The theme's own `sources` form still works,
// and with no dark image the light one shows in both themes.
import React from 'react';
import ThemeThemedImage from '@theme/ThemedImage';

export default function ThemedImage({ light, dark, sources, ...props }) {
  return <ThemeThemedImage {...props} sources={sources ?? { light, dark: dark ?? light }} />;
}
