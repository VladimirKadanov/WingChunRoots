// Journey review P3-9: a page opens with one sentence; the rules it used to list before the first
// control sit folded under "How this works". A native <details>: no JavaScript, keyboard and touch
// work as they do for any disclosure, and the text is in the HTML for search and screen readers.

import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

export function HowThisWorks({ children, className, testId = 'how-this-works' }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <details className={cx('group max-w-[60ch]', className)} data-testid={testId}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-ui font-semibold text-fg [&::-webkit-details-marker]:hidden">
        How this works
        <span aria-hidden="true" className="text-fg-muted transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="grid gap-2 pt-1 pb-2 text-ui text-fg-muted">{children}</div>
    </details>
  );
}
