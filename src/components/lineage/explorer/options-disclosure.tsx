// The explorer's Options button on phones (phone review 2026-11, docs/adr/0053-phone-layout.md).
// Its own file: the legend, in explorer.tsx, is never inside a <details> (plan M05, verify.d/M06.sh).

import type { ReactNode } from 'react';

import { FilterIcon } from '@/components/icons';

/**
 * The view's options (phone review 2026-11, ADR 0053). From md they sit in the toolbar's row as
 * before (.filter-disclosure-md in globals.css: the details and its content as display: contents).
 * Under md one Options button (a <details>, no script: /explore is at its script budget) opens
 * them in a panel below the row, over the top of the graph; a dot (and "changed" for screen
 * readers) says when an option is not at its default.
 */
export function OptionsDisclosure({ changed, children }: { changed: boolean; children: ReactNode }) {
  return (
    <details className="filter-disclosure filter-disclosure-md group/options" data-testid="explorer-options">
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-sm border border-border-strong px-2.5 text-sm font-semibold select-none hover:bg-surface-3 group-open/options:bg-surface-3">
        <FilterIcon size={18} />
        Options
        {changed ? (
          <>
            <span aria-hidden="true" className="size-2 rounded-full bg-fg" />
            <span className="sr-only">(changed)</span>
          </>
        ) : null}
      </summary>
      <div className="absolute inset-x-0 top-full z-20 flex flex-wrap items-center gap-2 border-b border-border-subtle bg-surface-1 py-2 pr-[max(1rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] shadow-lg">
        {children}
      </div>
    </details>
  );
}
