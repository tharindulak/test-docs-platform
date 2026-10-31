// Sidebar icons (Extension points): finds every icon the docs instances'
// pages (`sidebar_custom_props.icon`) and sidebars (a folder's
// `_category_.yml` `customProps.icon`) name, checks each against the allow-list
// (lib/nav-icons.mjs) and hands the SVG of the icons in use to the sidebar as
// global data, so the server-rendered menu inlines them
// (site/src/theme/DocSidebarItems). A strict build fails on an unknown name;
// a preview warns and draws the entry without its icon.
import { navIcon, navIconProblem } from '../lib/nav-icons.mjs';

// Every { icon, where } the loaded docs content names.
export function iconsIn(allContent) {
  const out = [];
  const walk = (items, where) => {
    for (const item of items ?? []) {
      if (item.customProps?.icon !== undefined) out.push({ icon: item.customProps.icon, where: `${where}: the sidebar entry "${item.label ?? item.id}"` });
      if (item.type === 'category') walk(item.items, where);
    }
  };
  for (const [id, content] of Object.entries(allContent['docusaurus-plugin-content-docs'] ?? {})) {
    for (const v of content?.loadedVersions ?? []) {
      for (const d of v.docs ?? []) {
        const icon = d.frontMatter?.sidebar_custom_props?.icon;
        if (icon !== undefined) out.push({ icon, where: String(d.source).replace(/^@site\//, '') });
      }
      for (const [name, items] of Object.entries(v.sidebars ?? {})) walk(items, `docs instance ${id}, sidebar ${name}`);
    }
  }
  return out;
}

export default function navIcons(context, { strict = true } = {}) {
  return {
    name: 'wso2-nav-icons',
    async allContentLoaded({ allContent, actions }) {
      const icons = {};
      const problems = new Set();
      for (const { icon, where } of iconsIn(allContent)) {
        const problem = navIconProblem(icon);
        if (problem) problems.add(`${where}: ${problem}`);
        else icons[icon] = navIcon(icon);
      }
      if (problems.size) {
        const message = `Unknown sidebar icons (the allowed names are in Contribute's "Add a sidebar icon" guide):\n  ${[...problems].join('\n  ')}`;
        if (strict) throw new Error(message);
        console.warn(`[WARNING] ${message}`);
      }
      actions.setGlobalData({ icons });
    },
  };
}
