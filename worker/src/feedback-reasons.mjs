// The reasons a reader can give after voting "No" on a page (Analytics and
// feedback). Shared by the feedback widget and the Edge Worker's feedback
// endpoint, so it has no Node imports and lives with the Edge Worker
// (lib/page-links.mjs re-exports it).
export const FEEDBACK_REASONS = [
  { id: 'inaccurate', label: 'Inaccurate' },
  { id: 'missing-information', label: 'Missing information' },
  { id: 'hard-to-follow', label: 'Hard to follow' },
  { id: 'example-does-not-work', label: "Example doesn't work" },
  { id: 'other', label: 'Other' },
];
