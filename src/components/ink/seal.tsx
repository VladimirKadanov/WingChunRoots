// Seals: the stamp that names a link's state next to its stroke (plan §4.6). Each state has its
// own shape (a round chop with a carved brush check, square with an hourglass, dashed circle with "?",
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

/**
 * Verified: a round chop pressed slightly askew, the way an official seal is stamped, not a
 * ticked box. From CHOP_DETAIL_PX up the edge is cut by hand (uneven, with chipped spots) and a
 * carved ring, broken where the brush check leaves it, frames the check. Smaller, a dedicated
 * simplified chop: a smooth oval with a bolder check, since detail would only blur at 13 px.
 */
function chop(small: boolean): ReactNode {
  return small ? (
    <g transform="rotate(-6 12 12)">
      <path d="M21.5 10.7C21.8 12.8 21.5 15.4 20.7 17.3C19.8 19.1 18.1 20.9 16.4 21.8C14.7 22.8 12.4 23.2 10.5 22.8C8.6 22.4 6.4 21.1 5.1 19.5C3.8 17.9 2.8 15.4 2.6 13.3C2.3 11.2 2.7 8.7 3.5 6.8C4.3 4.9 5.8 2.9 7.5 2C9.2 1.1 11.6 0.9 13.5 1.4C15.4 1.8 17.5 3.1 18.8 4.6C20.1 6.2 21.2 8.6 21.5 10.7Z" fill="var(--verified)" />
      <path d="M5.3 12C6.8 10.9 8.3 11.6 10.2 13.8C12.4 10.4 15 7.8 18.2 5.5C19.2 4.9 19.9 5.9 19.1 6.7C16.2 9.8 13.9 13.3 12 17.4C11.3 18.8 9.8 18.9 9.1 17.6C8.2 15.8 7 14.4 5.4 13.3C4.8 12.9 4.8 12.3 5.3 12Z" fill="var(--on-verified)" />
    </g>
  ) : (
    <g transform="rotate(-6 12 12)">
      <path d="M21.4 10.7C21.5 11.5 21.6 12.4 21.5 13.3C21.5 14.2 21.6 15.1 21.3 15.9C21.1 16.7 20.5 17.4 20 18.1C19.6 18.8 19.1 19.5 18.6 20.1C18 20.6 17.4 21.3 16.8 21.6C16.1 21.9 15.2 21.8 14.5 22C13.8 22.2 13.1 22.7 12.4 22.8C11.6 22.9 10.8 22.8 10.1 22.6C9.3 22.4 8.4 22.2 7.8 21.8C7.2 21.3 6.7 20.5 6.2 19.8C5.7 19.1 5.2 18.5 4.8 17.8C4.4 17.1 3.9 16.5 3.5 15.7C3.1 15 2.5 14.2 2.4 13.3C2.2 12.5 2.2 11.5 2.4 10.7C2.5 9.9 3.1 9.2 3.3 8.3C3.5 7.5 3.3 6.4 3.6 5.7C4 4.9 4.6 4.2 5.2 3.6C5.8 3.1 6.5 2.7 7.2 2.4C7.9 2 8.6 1.6 9.3 1.4C10.1 1.3 10.9 1.4 11.7 1.5C12.4 1.6 13.1 1.8 13.9 1.9C14.6 2.1 15.5 1.9 16.1 2.4C16.7 2.9 16.9 4.2 17.4 4.8C18 5.4 18.9 5.4 19.4 6C20 6.6 20.3 7.5 20.6 8.2C20.9 9 21.2 9.8 21.4 10.7Z" fill="var(--verified)" />
      <path d="M12.6 3.3C8 3 4.3 6.9 4.2 11.9C4.1 16.6 7.4 20.6 11.9 20.8M14.9 20.4C18 19.3 19.9 16.2 19.9 12.1C19.9 9.7 19.1 7.5 17.7 5.8" fill="none" stroke="var(--on-verified)" strokeWidth={0.9} strokeLinecap="round" />
      <path d="M6.1 11.6C7.3 11.1 8.4 11.7 10.3 14.1C12.3 10.9 14.6 8.2 17.6 5.9C18.2 5.5 18.7 6 18.3 6.5C15.6 9.6 13.4 13.1 11.5 17.2C11 18.2 9.9 18.3 9.4 17.3C8.6 15.5 7.6 14.2 6.2 13.1C5.6 12.6 5.6 11.9 6.1 11.6Z" fill="var(--on-verified)" />
    </g>
  );
}

const paths: Record<Exclude<SealKind, 'check'>, ReactNode> = {
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

/** From this rendered size the verified chop shows its cut edge and carved ring. */
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
      className={cx('inline-block shrink-0', tone === 'dim' && 'seal-dim', className)}
      data-seal={kind}
      data-tone={tone}
      {...props}
    >
      {kind === 'check' ? chop(size < CHOP_DETAIL_PX) : paths[kind]}
    </svg>
  );
}
