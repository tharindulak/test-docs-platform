# AGENTS.md

This repo is the Platform behind WSO2 Docs, and the single home of its spec, glossary and wayfinder maps.

## The spec

`spec/` is the normative spec: what WSO2 Docs does and why, as current rules. It is the authority; tickets are history.

- **Before changing behaviour**, read `spec/README.md` and the spec file for that topic.
- **When a behaviour or decision changes**, update the spec file in the same commit, and set its "Last checked against code" date when you have checked it against the code.
- **When code and spec disagree**, report the conflict to the user, with both sides and the file. Either the code is a bug or the spec changes in the same change; the user decides which. Known conflicts are in `spec/open-items.md`.
- **When a wayfinder ticket resolves**, write the ticket's Answer, the map's Decisions line and the spec change in one commit.

## Words

Use only the terms in `GLOSSARY.md`. When a term is added, renamed or redefined, update `GLOSSARY.md` per the `domain-modeling` skill, and the spec with it.

## Where things are

- Wayfinder maps and tickets: `.scratch/wso2-doc-space/` (first map) and `.scratch/wso2-docs-navigation/` (navigation map). Older tickets name an earlier tracker folder; read it as `.scratch/` here.
- The guides people follow: `standards/contribute/docs/get-started/product-teams.mdx` (product teams) and `standards/contribute/docs/get-started/platform-team.mdx` (the Platform team). Read them for how-to steps; the spec holds the rules.
- Skills: `.claude/skills/` and `.agents/skills/`. Author skills shipped to writers: `skills/`.

## Working rules

- **Outward-facing actions wait for the user's approval**: no push, no remote repo creation, no PRs or posting, no deploys. Requests carry no personal data.
- **Build outside the main checkout**, in a worktree of your own with its own `npm ci`: `site/.docusaurus` is per checkout, and so is the cache in `.cache/wso2-docs/`.
- **Test as you go with `npm test -- <files>`**, the files your change touches, or `npm run test:fast`: everything but the builds (`test/build/`), as the pre-commit hook runs it. Run the full suite (`npm test`) once, on what gets merged: before you report when you work alone, or on the merged result when several agents' branches merge together, where each of those agents stops at `test:fast` and the `test/build/` files its change touches. A merged tree identical to a tested commit counts as tested. The suite sets its own timeout, cold Docusaurus cache and, on a machine that has one, the build lock.
- **The Docusaurus cache misses Platform code changes** (`node_modules/.cache`, `site/node_modules/.cache`): delete it after you change `plugins/`, `site/`, `chrome/` or `lib/`, before a build you run by hand.
- **Rules for this machine** (paths, the build lock, parallel agents, commit trailer) are in `AGENTS.local.md` in the main checkout, `$(git rev-parse --git-common-dir)/..`, when it exists. Read it before you build or commit.
