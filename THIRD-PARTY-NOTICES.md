# Third-party notices

The WSO2 Docs Platform (`@wso2/docs`) is licensed under the Apache License 2.0. It ships or installs the third-party material below, under its own licence.

## Inter

The theme's text font (`site/wso2-theme/fonts/`), served with the shared theme to every page.

- **Source:** the `@fontsource-variable/inter` npm package, version 5.2.8, the variable font's normal style: `files/inter-<subset>-wght-normal.woff2` for the subsets `latin`, `latin-ext`, `cyrillic`, `cyrillic-ext`, `greek`, `greek-ext` and `vietnamese`, copied unchanged, with the `@font-face` rules of its `index.css` in `site/wso2-theme/css/fonts.css`.
- **Copyright:** Copyright 2016 The Inter Project Authors (<https://github.com/rsms/inter>).
- **Licence:** SIL Open Font License 1.1, <https://openfontlicense.org>. The licence travels with the fonts, as `site/wso2-theme/fonts/OFL.txt`.

## Inter Tight

The theme's heading font (`site/wso2-theme/fonts/`), served with the shared theme to every page.

- **Source:** the `@fontsource-variable/inter-tight` npm package, version 5.3.0, the variable font's normal style: `files/inter-tight-<subset>-wght-normal.woff2` for the subsets `latin`, `latin-ext`, `cyrillic`, `cyrillic-ext`, `greek`, `greek-ext` and `vietnamese`, copied unchanged, with the `@font-face` rules of its `index.css` in `site/wso2-theme/css/fonts.css`.
- **Copyright:** Copyright 2022 The Inter Project Authors (<https://github.com/rsms/inter-tight>).
- **Licence:** SIL Open Font License 1.1, <https://openfontlicense.org>. The licence travels with the fonts, as `site/wso2-theme/fonts/OFL-inter-tight.txt`.

## Sidebar icons

The sidebar icons (`lib/nav-icons.mjs`) are drawn from three sources. Each icon is inlined as SVG into the pages that use it.

### Octicons

- **Source:** the `@primer/octicons` npm package, version 18.0.0, installed as a dependency (not copied). Its 16px icons are the `octicons/<name>-16` names.
- **Copyright:** Copyright (c) 2023 GitHub Inc.
- **Licence:** MIT License, <https://github.com/primer/octicons/blob/main/LICENSE>.

### Font Awesome Free

- **Source:** `@fortawesome/fontawesome-free` 6.3.0, the SVG files `svgs/brands/react.svg`, `vuejs.svg`, `angular.svg`, `js.svg`, `node-js.svg` and `svgs/solid/user-shield.svg`, copied unchanged into `icons/fontawesome/`. They are the `fontawesome/brands/<name>` and `fontawesome/solid/<name>` names.
- **Attribution:** Font Awesome Free 6.3.0 by Fonticons, Inc., <https://fontawesome.com>. Copyright 2023 Fonticons, Inc.
- **Licence:** the icons are licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0), <https://creativecommons.org/licenses/by/4.0/>; see <https://fontawesome.com/license/free>. Each file keeps its attribution comment, and so does each inlined icon.

### WSO2 custom icons

- **Source:** `wso2/docs-is` at commit `6561173262c3b2fc0bc6913eb17e7fbf70c0c5e0`, the files `en/theme/material/assets/libs/custom-icons/nextjs.svg`, `nuxt.svg`, `dotnet.svg`, `expressjs.svg`, `spring-boot.svg` and `mcp.svg`, copied unchanged into `icons/wso2/`. They are the `wso2/<name>` names.
- **Copyright:** Copyright (c) 2025, WSO2 LLC. (<https://www.wso2.com>).
- **Licence:** Apache License 2.0, <http://www.apache.org/licenses/LICENSE-2.0>, as the files and their repository state.

The framework and product logos among these icons are trademarks of their owners. WSO2 Docs shows them only to name the framework or product a sidebar entry is about.
