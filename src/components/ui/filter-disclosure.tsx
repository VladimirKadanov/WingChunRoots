// Filters that fold on a phone (phone review 2026-11, docs/adr/0053-phone-layout.md). A <details>
// with no script of its own, so the forms it holds keep working without JavaScript and the page
// keeps its script budget: under the breakpoint a "Filters" button (its summary, with the number
// of filters set) opens them; from the breakpoint the summary is hidden and the fields sit in the
// form as before (globals.css, .filter-disclosure: ::details-content as display: contents, only
// where the browser has it; elsewhere the button stays and opens them).

import type { ReactNode } from 'react';

import { ChevronDownIcon, FilterIcon } from '@/components/icons';
import { cx } from '@/lib/cx';

export function FilterDisclosure({
  active,
  from,
  className,
  summaryClassName,
  panelClassName,
  label = 'Filters',
  setText = (n) => (n === 1 ? '1 set' : `${n} set`),
  children,
}: {
  /** How many filters are set (shown on the button as "Filters · 2"). */
  active: number;
  /** The width from which the fields are always shown: md (48rem) or lg (64rem). */
  from: 'md' | 'lg';
  className?: string;
  summaryClassName?: string;
  panelClassName?: string;
  /** The button's words ("Filters"); the control panel passes its own, translated (ADR 0043). */
  label?: string;
  /** The screen-reader words for the number set ("2 set"). */
  setText?: (n: number) => string;
  children: ReactNode;
}) {
  return (
    <details className={cx('filter-disclosure group/filters', from === 'lg' ? 'filter-disclosure-lg' : 'filter-disclosure-md', className)} data-testid="filters">
      <summary
        className={cx(
          'inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-sm border border-border-strong bg-surface-1 px-3.5 text-sm font-semibold whitespace-nowrap select-none hover:bg-surface-3 group-open/filters:bg-surface-3',
          summaryClassName,
        )}
      >
        <FilterIcon size={18} />
        <span>
          {label}
          {active > 0 ? (
            <>
              {' '}
              <span aria-hidden="true">· {active}</span>
              <span className="sr-only">({setText(active)})</span>
            </>
          ) : null}
        </span>
        <ChevronDownIcon size={16} className="transition-transform group-open/filters:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className={panelClassName}>{children}</div>
    </details>
  );
}
