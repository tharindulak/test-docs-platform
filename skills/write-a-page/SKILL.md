---
name: write-a-page
description: Drafts or converts a WSO2 Docs page to the standards, in a Content repo. Use when asked to write, document, draft or convert a page from notes, a spec or a code change in a wso2/docs-* repository.
allowed-tools: Read Write Edit Bash Grep Glob
---

# Write a page

Drafts one page for a WSO2 Docs Content repo (a repo with `docspace.yaml` and `docs/`) from the author's source material: notes, a spec, a code change or an existing page to convert. The page lands in the right skeleton folder, with the right front matter and Edition markers, written to the WSO2 standards.

Reference, read when the step names it:
- `references/standards.md`: the style guide, terminology, page types, Edition writing rules, admonitions and front matter.
- `references/templates/<type>.mdx`: the template of each page type.

## Step 1: Gather

Collect, in one message to the author if anything is missing:
1. The **source material**. Facts on the page come from it, or from the product's code or docs the author points to. A fact you can't source becomes a question, never a guess.
2. The **page type**: quick-start, tutorial, how-to, concept, reference or release-notes (see "Page types" in `references/standards.md`). One task is one how-to page.
3. The **Editions** it applies to: Cloud only, self-hosted only, self-hosted from a version, or all. Read `editions.yaml` for the variables available.
4. Whether a page on the topic exists: search `docs/` for the topic's key terms. If one does, offer to edit it instead.

Done when the type, the Editions and the facts are settled.

## Step 2: Scaffold

Create the page from its template:

```bash
npx @wso2/docs new <type> --title "<Title in sentence case>" --description "<one sentence, at most 160 characters>"
```

Add `--folder <path under docs/>` when the type's default folder isn't right (for example `guides/sign-in`). For a whole page limited to some Editions, add `editions:` or `selfHostedFrom:` to its front matter.

## Step 3: Draft

Replace every `{/* ... */}` comment of the template with content, following the page type's structure in `references/standards.md` and the style guide in the same file. Use `{edition.productName}` and the other `{edition.*}` variables on shared pages, and `<Edition>` markers for sections or phrases that differ by Edition. Link pages in the same Doc space with relative `.mdx` paths and other Doc spaces with `docs:` links.

Done when no template comment is left and every section of the type's structure has content or is deliberately removed.

## Step 4: Check

Run `npx @wso2/docs check` and fix every blocking finding and every warning on the new page. Then read the page as each Edition renders it and confirm it reads correctly in each. Done when the check reports `Result: pass` with no warnings on the new page.

## Step 5: Hand over

Tell the author the file path, the facts you could not source (as questions), and how to preview it: `npx @wso2/docs preview`. Leave committing to the author.
