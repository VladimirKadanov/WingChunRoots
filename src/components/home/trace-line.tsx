'use client';

// "Trace this hall's line": the call to action of the featured hall. Until the explorer opens
// (M05), it does the one real thing the home page can do with a line: it scrolls back to the
// living line at the top and traces it from the founder to the newest student. Without
// JavaScript it is a plain link to that drawing (#demo-line).
//
// Also the solid text tones of the living line's rows (plan §4.7: dimming never uses opacity).
// A row beyond the traced person steps down one tone, so a dimmed year can never read brighter
// than an active one; trace-line.test.ts checks both themes.

import type { ReactNode } from 'react';
import { ArrowRightIcon } from '@/components/icons';
import type { ColorRole } from '@/design/tokens';

/** Dispatched on window; the living line listens and traces to `detail.index`. */
export const TRACE_LINE_EVENT = 'wcr:trace-line';

export interface TraceLineDetail {
  /** Index in DEMO_LINE of the person to trace to. */
  index: number;
}

/** The colour role of each text in a row of the living line, traced or beyond the trace. */
export const ROW_TONE_ROLES = {
  active: { year: 'fg-muted', name: 'fg' },
  dimmed: { year: 'fg-subtle', name: 'fg-muted' },
} as const satisfies Record<'active' | 'dimmed', Record<'year' | 'name', ColorRole>>;

/** The same roles as utility classes (literal, so Tailwind finds them). */
export const ROW_TONES = {
  active: { year: 'text-fg-muted', name: 'text-fg' },
  dimmed: { year: 'text-fg-subtle', name: 'text-fg-muted' },
} as const satisfies Record<keyof typeof ROW_TONE_ROLES, Record<'year' | 'name', `text-${ColorRole}`>>;

/**
 * `className` comes from the server (buttonVariants), so this island does not load the button's
 * variant tables and tailwind-merge (the home page's JavaScript budget).
 */
export function TraceLineButton({ index, className, children }: { index: number; className: string; children: ReactNode }) {
  return (
    <a
      href="#demo-line"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent<TraceLineDetail>(TRACE_LINE_EVENT, { detail: { index } }));
      }}
    >
      {children}
      <ArrowRightIcon />
    </a>
  );
}
