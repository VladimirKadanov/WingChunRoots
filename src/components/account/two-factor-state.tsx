// The state of two-factor authentication (milestone M02), as a mark and words, never colour alone
// (plan §5.6): a filled ink disc with a check (on, and this session passed it), a ring with a
// gap and a dot (on, but this session has not passed it yet), a dashed ring with a half disc (the
// setup was started and waits for its first code), an empty ring (off). Decorative mark; the text
// next to it says the same.

import type { ReactNode } from 'react';

export type TwoFactorStateKind = 'on' | 'unverified' | 'pending' | 'off';

function Mark({ state }: { state: TwoFactorStateKind }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false" className="mt-[0.15em] block shrink-0">
      {state === 'on' ? (
        <>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="M5.8 10.4l2.9 2.9 5.5-6" fill="none" stroke="var(--fg-inverse)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : state === 'unverified' ? (
        <>
          <path d="M10 1a9 9 0 1 1-8.2 5.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M10 5.5v5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <circle cx="10" cy="14" r="1.2" fill="currentColor" />
        </>
      ) : state === 'pending' ? (
        <>
          <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.4" />
          <path d="M10 4.6a5.4 5.4 0 0 1 0 10.8z" fill="currentColor" />
        </>
      ) : (
        <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  );
}

export function TwoFactorState({ state, children, className }: { state: TwoFactorStateKind; children: ReactNode; className?: string }) {
  return (
    <span data-two-factor={state} className={['inline-flex items-start gap-2', className].filter(Boolean).join(' ')}>
      <Mark state={state} />
      <span>{children}</span>
    </span>
  );
}
