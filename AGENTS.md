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

- Wayfinder maps and tickets: `.scratch/wso2-doc-space/` (first map) and `.scratch/wso2-docs-navigation/` (navigation map). Older tickets name `/home/jo/workspace/wso2docs` as the tracker; read it as `.scratch/` here.
- The guides people follow: `standards/contribute/docs/get-started/product-teams.mdx` (product teams) and `standards/contribute/docs/get-started/platform-team.mdx` (the Platform team). Read them for how-to steps; the spec holds the rules.
- Skills: `.claude/skills/` and `.agents/skills/`. Author skills shipped to writers: `skills/`.

## Working rules

- **Outward-facing actions wait for the user's approval**: no push, no remote repo creation, no PRs or posting, no deploys. Requests carry no personal data.
- **Stop only processes you started, by their PID.** `pkill` and `killall` reach other agents' runs.
- **One heavy build at a time**, under `timeout 1500` with `DOCUSAURUS_NO_PERSISTENT_CACHE=1`, in your own worktree under `/home/jo/workspace/docs-platform-wt/`. The main checkout's `site/.docusaurus` is shared, so builds never run there.
- **Large outputs go under `/home/jo/workspace/docs-platform-wt/_work-<task>/`**, since `/tmp` has a quota.
- **Leave other people's branches, worktrees and files as they are**; delete only what you created.
- **Merge to `main` only after the full suite (`npm test`) passes**, and run it again on the merged commit.
- **End every commit message with** `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
