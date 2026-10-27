// Docusaurus compiles a site's .js files except under node_modules/ (its
// excludeJS rule). Installed from npm (npx @wso2/docs), the Platform's site sits
// under node_modules/@wso2/docs/site/, so its components, which are JSX, would
// reach webpack uncompiled and the build would fail. This rule compiles
// site/src/ with Docusaurus's own JS loader there; in a checkout it adds nothing.
import path from 'node:path';

export const SOURCE_RULE_TEST = /\.[jt]sx?$/i;

export default function siteSource(context) {
  const src = path.join(context.siteDir, 'src');
  return {
    name: 'wso2-site-source',
    configureWebpack(config, isServer, { getJSLoader }) {
      if (!src.split(path.sep).includes('node_modules')) return {};
      return { module: { rules: [{ test: SOURCE_RULE_TEST, include: src, use: [getJSLoader({ isServer })] }] } };
    },
  };
}
