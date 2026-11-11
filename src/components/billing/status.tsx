// The state of a subscription in test mode (M22), as a mark and words, never colour alone
// (CLAUDE.md §10): a filled disc with a check (active, renews), a ring with a short bar (cancelled
// at the period end: runs, then stops), a ring with an exclamation mark (a renewal payment failed),
// a dashed ring (ended or not paid). The mark is decorative; the words say it.

import type { ReactNode } from 'react';

import type { SubscriptionStatus } from '@/server/services/billing';

type Shape = 'active' | 'ending' | 'past_due' | 'ended';

function shapeOf(status: SubscriptionStatus, cancelAtPeriodEnd: boolean): Shape {
  if (status === 'active') return cancelAtPeriodEnd ? 'ending' : 'active';
  if (status === 'past_due') return 'past_due';
  return 'ended';
}

function Mark({ shape }: { shape: Shape }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" className="block shrink-0">
      {shape === 'active' ? (
        <>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="M5.8 10.4l2.9 2.9 5.5-6" fill="none" stroke="var(--bg)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : shape === 'ending' ? (
        <>
          <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6 10h8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </>
      ) : shape === 'past_due' ? (
        <>
          <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 5.4v5.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <circle cx="10" cy="14.2" r="1.15" fill="currentColor" />
        </>
      ) : (
        <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.4" />
      )}
    </svg>
  );
}

export function SubscriptionStatusTag({ status, cancelAtPeriodEnd, label }: { status: SubscriptionStatus; cancelAtPeriodEnd: boolean; label: string }) {
  const shape = shapeOf(status, cancelAtPeriodEnd);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-border-strong px-2 py-0.5 text-sm" data-testid="subscription-status" data-status={shape}>
      <Mark shape={shape} />
      {label}
    </span>
  );
}

/** "Test mode, no real charge": the label every billing screen carries, with a shape and the words. */
export function TestModeBanner({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div data-testid="test-mode-banner" className="grid gap-1 rounded-sm border-2 border-dashed border-fg bg-surface-2 px-4 py-3 text-ui">
      <p className="flex items-start gap-2 font-semibold">
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false" className="mt-0.5 block shrink-0">
          <rect x="2" y="4.5" width="16" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M2.5 8.5h15" stroke="currentColor" strokeWidth="1.6" />
          <path d="M4 18L16 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>{label}</span>
      </p>
      {children ? <div className="text-sm text-fg-muted">{children}</div> : null}
    </div>
  );
}
