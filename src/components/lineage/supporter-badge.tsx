// The Supporter badge (owner decision 2026-11-18, docs/adr/0049-supporter-badge.md): a member on
// Premium Student or Professional Sifu chose to show it. A pill with a rhombus and the word, in ink:
// a shape of its own, never the round verification seal of plan §4.6, and never colour alone.
// It says the member supports WingChunRoots and nothing else.

export function SupporterBadge({ testId }: { testId?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-fg px-2.5 py-0.5 text-sm font-semibold text-fg" data-testid={testId}>
      <svg aria-hidden="true" viewBox="0 0 10 10" className="size-2.5 fill-current">
        <path d="M5 0 10 5 5 10 0 5Z" />
      </svg>
      Supporter
      <span className="sr-only"> of WingChunRoots</span>
    </span>
  );
}
