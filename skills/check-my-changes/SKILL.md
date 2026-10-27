---
name: check-my-changes
description: Checks changed WSO2 Docs pages in a Content repo before a pull request. Use when asked to check, review or lint docs changes, a branch, or a page in a wso2/docs-* repository.
allowed-tools: Read Edit Bash Grep Glob
---

# Check my changes

Two passes over the author's changed pages in a WSO2 Docs Content repo (a repo with `docspace.yaml` and `docs/`): first the Platform's checks, then a judgement **review** against the standards. The checks and the standards both come from the Platform, so this skill's verdict matches the pull request's.

Reference, read when the step names it:
- `references/checks.md`: every check, what it enforces and how to fix it.
- `references/standards.md`: the style guide, terminology, page types, Edition writing rules, admonitions and front matter.

## Step 1: Run the check

Run from the Content repo root:

```bash
npx @wso2/docs check --format json --out .wso2-docs-check.json
```

Add `--no-build` only if the author asks for speed; say that the preview build was skipped. Done when the command has exited and the JSON report exists (exit code 1 means a blocking failure, 0 means none).

## Step 2: Explain and fix the blocking findings

For each check with `"status": "fail"`, take every finding whose `blocking` is true. Explain it in one plain sentence (what is wrong, where, why it matters to the reader), using the fix in `references/checks.md` for that check id. Offer the concrete edit; apply it only when the author agrees. Findings with `"overridden": true` were accepted by a Doc space owner: list them, don't fix them.

Done when every blocking finding is fixed, or the author has declined its fix. Re-run Step 1 after fixes; the result must read `"result": "pass"`.

## Step 3: Review the changed pages

The report's `base` is what the pages are compared with. List the changed pages with `git diff --name-only <base.ref> -- docs` plus untracked files under `docs/`. Read each changed page in full, then review **only changed lines** for new rules, and the whole page for structure. Apply every item below to every changed page:

1. **Page type**: the front-matter `type` (or the folder default) matches the content. Check the structure and "what reviewers check" list for that type in `references/standards.md`.
2. **Style**: the style guide's rules (sentence case, second person, active voice, bold UI labels, code formatting, descriptive link text, language on every code fence, no `$` prompts). The warn-only findings of Step 1 (`vale`, `spelling`, `headings`) are a starting point, not the whole review.
3. **Terminology**: product names, retired names only as "(formerly …)", preferred terms.
4. **Edition markers**: read the page as each Edition renders it (Cloud, and self-hosted). Every marked page reads correctly in each: no dangling "as shown above", no heading left empty, `{edition.*}` variables instead of hard-coded product names, markers instead of "In Cloud…" prose.
5. **Alt text**: every new image's alt text says what the image shows.
6. **Testable steps**: each numbered step is one action the reader can perform and check; commands are copy-pasteable; a how-to has a verify section.

Report per page: the item, the line, the quote, and a suggested rewrite. Group "should fix" apart from "consider". Done when all six items have been applied to every changed page.

## Step 4: Summarize

End with the check result (pass or fail, blocking count), then the review findings per page. Leave committing and pushing to the author.
