// The state of a trial lesson request (M21), as a mark and words, never colour alone (CLAUDE.md
// §10): a ring with a clock hand (waiting for the school), a filled disc with a check (answered), a
// ring crossed out (declined), a plain ring (closed). The mark is decorative; the words say it.

import type { TrialStatus } from '@/server/services/trial-lessons';

function Mark({ status }: { status: TrialStatus }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" className="block shrink-0">
      {status === 'answered' ? (
        <>
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="M5.8 10.4l2.9 2.9 5.5-6" fill="none" stroke="var(--bg)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : status === 'open' ? (
        <>
          <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10 5.2V10l3.2 2.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : status === 'declined' ? (
        <>
          <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M4.4 15.6L15.6 4.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </>
      ) : (
        <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.4" />
      )}
    </svg>
  );
}

export function TrialStatusTag({ status, label }: { status: TrialStatus; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-border-strong px-2 py-0.5 text-sm" data-testid="trial-status" data-status={status}>
      <Mark status={status} />
      {label}
    </span>
  );
}
