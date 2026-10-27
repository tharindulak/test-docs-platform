// "Edit this page" and "Report an issue" links (Analytics and feedback).
// Pure: the build computes edit links and the browser builds issue links.

// Fixes go to main first and reach older versions by backport label, so a
// self-hosted page that also exists on main is edited there. A page that only
// exists on its version branch is edited on that branch. `dir` is the Doc
// space's directory in its Content repo (`identity-server`; '' for a Doc space
// at the repo root) and `branch` the Edition's branch (default
// `[<dir>/]release/<id>`). mainFiles is the set of repo paths on main (null
// when unknown: then the branch file, which always exists, is used).
export function editLink({ repo, editionId, docPath, mainFiles, dir = '', branch }) {
  if (!repo || !docPath) return null;
  const file = `${dir ? `${dir.replace(/\/$/, '')}/` : ''}docs/${docPath}`;
  const onMainBranch = editionId === 'cloud' || editionId === 'next';
  const toMain = onMainBranch || Boolean(mainFiles?.has(file));
  const target = toMain ? 'main' : (branch ?? `${dir ? `${dir.replace(/\/$/, '')}/` : ''}release/${editionId}`);
  return {
    url: `https://github.com/${repo}/edit/${target}/${file}`,
    // Shown next to the link when a self-hosted page is edited on main.
    note: toMain && !onMainBranch ? 'Fixes apply to the newest docs first, then to older versions.' : null,
  };
}

// A new GitHub issue in the Doc space's repo, prefilled with the page URL, the
// Edition and any selected text. issues = { repo, template?, labels? }.
export function issueLink({ issues, pageUrl, pageTitle, editionName, selection, reason }) {
  if (!issues?.repo) return null;
  const quote = (selection ?? '').trim().slice(0, 1500);
  const body = [
    `**Page:** ${pageUrl}`,
    `**Edition:** ${editionName}`,
    ...(reason ? [`**Feedback:** ${reason}`] : []),
    ...(quote ? ['', '**Selected text:**', quote.split('\n').map((l) => `> ${l}`).join('\n')] : []),
    '',
    "**What's wrong or missing?**",
    '',
  ].join('\n');
  const params = new URLSearchParams({ title: `Docs: ${pageTitle}`, body });
  if (issues.template) params.set('template', issues.template);
  if (issues.labels) params.set('labels', [].concat(issues.labels).join(','));
  return `https://github.com/${issues.repo}/issues/new?${params}`;
}

// Reasons offered after "No". The ids are what the feedback endpoint counts,
// so the list lives with the Edge Worker.
export { FEEDBACK_REASONS } from '../worker/src/feedback-reasons.mjs';

// The body of one POST to the feedback endpoint. A vote is one POST; a reason
// chosen after "No" is a second POST with kind "reason". No cookies, no text.
export function feedbackEvent({ kind, docSpace, edition, asLatest, page, vote, reason }) {
  return {
    v: 1, kind, docSpace, edition, latest: Boolean(asLatest), page, vote,
    ...(kind === 'reason' ? { reason } : {}),
  };
}
