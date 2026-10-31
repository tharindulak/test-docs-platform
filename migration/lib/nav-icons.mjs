// Sidebar icons from an MkDocs Material nav (Extension points: sidebar
// icons). A theme with `extra.nav_icons` maps a nav title to
// `{ icon, level }`; the legacy template gives a nav entry the icon when its
// title is a key and its level (1 for the top) is the entry's `level`, one of
// a list of levels, or any level when `level` is left out. An index page that
// Material's navigation.indexes folds into its section is never drawn, so its
// icon is never seen. The product config adds what its template skips
// (`navIcons.skip`) and where its own SVG icons live (`navIcons.customIcons`).
// The converter writes the Platform's name: `sidebar_custom_props.icon` on a
// page, `customProps.icon` in a folder's _category_.yml.
import { navIconProblem } from '../../lib/nav-icons.mjs';

// The legacy icon of one nav entry ({ title, level, url }), or null.
export function legacyNavIcon(navIcons, entry, { skip } = {}) {
  if (!navIcons || typeof entry.title !== 'string' || !Object.hasOwn(navIcons, entry.title)) return null;
  if (skip?.(entry)) return null;
  const e = navIcons[entry.title] ?? {};
  const ok = e.level === undefined || (Array.isArray(e.level) ? e.level.includes(entry.level) : e.level === entry.level);
  return ok && e.icon ? String(e.icon) : null;
}

// Material's bundled icon names (octicons/…, fontawesome/…) are the
// Platform's; the theme's own SVG files (<customIcons><name>.svg) are
// wso2/<name>. { name } when the Platform has the icon, else { problem }.
export function platformIconName(icon, { customIcons } = {}) {
  let name = icon;
  if (customIcons && icon.startsWith(customIcons) && icon.endsWith('.svg')) name = `wso2/${icon.slice(customIcons.length, -'.svg'.length)}`;
  const problem = navIconProblem(name);
  return problem ? { problem: `the legacy icon ${icon} is not a Platform sidebar icon (${problem})` } : { name };
}

// MkDocs' Page.is_index: index.md, or README.md, which MkDocs builds as the index.
export const isIndexSrc = (src) => /(^|\/)(index|README)\.md$/.test(String(src).trim());
