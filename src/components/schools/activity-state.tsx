// The activity check of a listed school (milestone M20; DEFAULT D17), as a mark and words, never
// colour alone (CLAUDE.md §10): a filled disc with a check (current), a ring with a clock hand
// (awaiting confirmation), a ring crossed out (hidden from the map). Decorative mark; the text next
// to it says the same. A Server Component: the owner's and the staff's pages share it.

import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

export type ActivityStageKind = 'current' | 'awaiting_confirmation' | 'hidden';

export function ActivityMark({ stage, className }: { stage: ActivityStageKind; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false" className={cx('mt-[0.15em] block shrink-0', className)}>
      {stage === 'current' ? (
        <>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="M5.8 10.4l2.9 2.9 5.5-6" fill="none" stroke="var(--bg)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : stage === 'awaiting_confirmation' ? (
        <>
          <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 5.2V10l3.2 2.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.4" />
          <path d="M4.4 15.6L15.6 4.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** The stage with its mark: `data-activity` carries it for the tests. */
export function ActivityState({ stage, children, className, testId }: { stage: ActivityStageKind; children: ReactNode; className?: string; testId?: string }) {
  return (
    <span data-activity={stage} data-testid={testId} className={cx('inline-flex items-start gap-2', className)}>
      <ActivityMark stage={stage} />
      <span>{children}</span>
    </span>
  );
}
