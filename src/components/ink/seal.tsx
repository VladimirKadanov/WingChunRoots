// Seals: the stamp that names a link's state next to its stroke (plan §4.6). Each state has its
// own shape (tilted square with a check, square with an hourglass, dashed circle with "?",
// diamond with scales, …) and always comes with a text label; colour only repeats the shape.

import type { ReactNode, SVGProps } from 'react';
import type { LinkStyle } from '@/design/tokens';
import { cx } from '@/lib/cx';

export type SealKind = LinkStyle['seal'];

const paths: Record<SealKind, ReactNode> = {
  // Verified: a pressed jade chop with a check.
  check: (
    <>
      <path d="M3.1 2.7L20.9 2.2 21.7 20.9 2.5 21.5Z" fill="var(--verified)" />
      <path d="M7.1 12.3l3.3 3.3 6.8-7.3" fill="none" stroke="var(--on-verified)" strokeWidth={2.5} strokeLinecap="square" />
    </>
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

export interface SealProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  kind: SealKind;
  /** Rendered size in px (default 18). */
  size?: number;
}

/** Decorative: the state is always also written in words next to it. */
export function Seal({ kind, size = 18, className, ...props }: SealProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cx('inline-block shrink-0', className)}
      data-seal={kind}
      {...props}
    >
      {paths[kind]}
    </svg>
  );
}
