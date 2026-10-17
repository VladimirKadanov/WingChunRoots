// Seals: the stamp that names a link's state next to its stroke (plan §4.6). Each state has its
// own shape (a carved chop with a brush check, square with an hourglass, dashed circle with "?",
// diamond with scales, …) and always comes with a text label; colour only repeats the shape.
//
// tone="dim" draws the same shape in the solid dimmed tone (plan §4.7: never opacity): the
// pencil draft of an untraced line and the rows beyond a traced person. The shape still names
// the state; the colour is dropped (the .seal-dim rule in globals.css re-points the state
// colours at --dim-stroke).

import type { ReactNode, SVGProps } from 'react';
import type { LinkStyle } from '@/design/tokens';
import { cx } from '@/lib/cx';

export type SealKind = LinkStyle['seal'];

const paths: Record<SealKind, ReactNode> = {
  // Verified: a chop pressed slightly askew, its edge bled into the paper, with a brush check
  // carved out of it (negative space, tapering to the upper stroke's end). The carved frame and
  // two specks of eroded ink are drawn only at sizes where they read (CHOP_DETAIL_PX).
  check: (
    <g transform="rotate(-4 12 12)">
      <path
        d="M3.2 2.9C5.4 2.5 7.4 2.8 9.6 2.6C12.2 2.4 14.3 2.8 16.7 2.5C18.4 2.3 19.9 2.6 21.3 2.4C21.6 4.6 21.2 6.4 21.5 8.6C21.8 11.2 21.3 13.4 21.6 15.8C21.8 17.7 21.4 19.6 21.6 21.4C19.5 21.7 17.6 21.3 15.3 21.6C12.9 21.9 10.7 21.4 8.4 21.7C6.5 21.9 4.5 21.5 2.6 21.7C2.3 19.6 2.8 17.5 2.5 15.2C2.2 12.8 2.7 10.6 2.4 8.3C2.2 6.4 2.6 4.6 3.2 2.9Z"
        fill="var(--verified)"
      />
      <g className="seal-detail">
        <path
          d="M4.7 6.9V4.7H11.6M13.9 4.6H19.3V10.8M19.4 13.4V19.3H8.6M6.2 19.4H4.6V9.4"
          fill="none"
          stroke="var(--on-verified)"
          strokeWidth={0.95}
          strokeLinecap="round"
        />
        <circle cx="20.5" cy="3.5" r="0.45" fill="var(--on-verified)" />
        <circle cx="3.5" cy="20.4" r="0.38" fill="var(--on-verified)" />
      </g>
      <path
        d="M5.9 12.6C6.9 11.9 7.9 12.2 10 14.5C12.4 11.2 14.9 8.6 18.4 6.3C18.9 6 19.2 6.4 18.8 6.8C15.8 9.8 13.2 13.3 11 17.4C10.6 18.1 9.9 18.1 9.5 17.4C8.6 15.6 7.5 14.2 5.9 12.6Z"
        fill="var(--on-verified)"
      />
    </g>
  ),
  // Under review: an open square with an hourglass.
  hourglass: (
    <>
      <path d="M3 3h18v18H3z" fill="var(--bg)" stroke="var(--review)" strokeWidth={1.8} />
      <path
        d="M8.3 6.6h7.4M8.3 17.4h7.4M9.2 6.6c0 3.2 5.6 3.4 5.6 5.4s-5.6 2.2-5.6 5.4M14.8 6.6c0 3.2-5.6 3.4-5.6 5.4s5.6 2.2 5.6 5.4"
        fill="none"
        stroke="var(--review)"
        strokeWidth={1.5}
      />
    </>
  ),
  // Unconfirmed: a dashed circle with a question mark.
  question: (
    <>
      <circle cx="12" cy="12" r="9.6" fill="var(--bg)" stroke="var(--unconfirmed)" strokeWidth={1.6} strokeDasharray="2.4 2.2" />
      <path
        d="M9.4 9.7a2.7 2.7 0 1 1 3.7 2.5c-.75.3-1.1.85-1.1 1.6v.5"
        fill="none"
        stroke="var(--unconfirmed)"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.1" r="1.1" fill="var(--unconfirmed)" />
    </>
  ),
  // In arbitration: a diamond with scales.
  scales: (
    <>
      <path d="M12 1.6L22.4 12 12 22.4 1.6 12Z" fill="var(--bg)" stroke="var(--arbitration)" strokeWidth={1.6} />
      <path
        d="M12 7.4v8.8M9.6 16.2h4.8M7.6 9.4h8.8M7.6 9.4l-1.7 3.5h3.4zM16.4 9.4l-1.7 3.5h3.4z"
        fill="none"
        stroke="var(--arbitration)"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </>
  ),
  // Cross-lineage: a hollow arch between two halls.
  bridge: (
    <>
      <path d="M2.5 3.5h19v17h-19z" fill="var(--bg)" stroke="var(--cross-lineage)" strokeWidth={1.6} strokeDasharray="5 2 1.5 2" />
      <path d="M6 17.5c0-6 2.6-9 6-9s6 3 6 9" fill="none" stroke="var(--cross-lineage)" strokeWidth={1.8} strokeLinecap="round" />
      <circle cx="6" cy="17.5" r="1.6" fill="var(--cross-lineage)" />
      <circle cx="18" cy="17.5" r="1.6" fill="var(--cross-lineage)" />
    </>
  ),
  // Historical: a period between two ticks.
  period: (
    <>
      <path d="M3 3h18v18H3z" fill="var(--bg)" stroke="var(--fg-muted)" strokeWidth={1.4} />
      <path d="M7 8v8M17 8v8M7 12h10" fill="none" stroke="var(--fg-muted)" strokeWidth={1.6} strokeLinecap="round" />
    </>
  ),
};

/** Below this rendered size the chop's carved frame and specks would only blur the check. */
export const CHOP_DETAIL_PX = 20;

export interface SealProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  kind: SealKind;
  /** Rendered size in px (default 18). */
  size?: number;
  /** "state": the state's colour; "dim": the solid dimmed tone, same shape (plan §4.7). */
  tone?: 'state' | 'dim';
}

/** Decorative: the state is always also written in words next to it. */
export function Seal({ kind, size = 18, tone = 'state', className, ...props }: SealProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cx('inline-block shrink-0', tone === 'dim' && 'seal-dim', size < CHOP_DETAIL_PX && 'seal-small', className)}
      data-seal={kind}
      data-tone={tone}
      {...props}
    >
      {paths[kind]}
    </svg>
  );
}
