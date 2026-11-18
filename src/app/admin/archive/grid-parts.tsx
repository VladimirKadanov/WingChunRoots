// The shared parts of the archive editor's working views (control panel 2026-11,
// docs/adr/0035-control-panel.md): figure tiles, filter chips, a link's status in words with a mark
// (never colour alone), the years of a link, sortable column headers and the pager. All server
// markup: filters, sorting and paging are plain links and GET forms with their state in the URL.

import Link from 'next/link';
import type { ReactNode } from 'react';

import type { AdminT } from '@/components/admin/i18n/translate';
import { buttonVariants } from '@/components/ui/button-variants';

export const fieldClass =
  'block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-3 text-field text-fg hover:border-fg-muted focus-visible:border-fg';

export const years = (t: AdminT, from: number | null, to: number | null) =>
  from === null ? t('Years not known') : to === null ? t('From {year}', { year: from }) : from === to ? String(from) : `${from}–${to}`;

export function Column({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto px-page pt-6 pb-10 md:pt-9 md:pb-14 ${wide ? 'max-w-[90rem]' : 'max-w-content'}`}>{children}</div>;
}

export function Figure({ t, label, value, note, href }: { t: AdminT; label: string; value: number; note?: string; href?: string }) {
  const body = (
    <>
      <span className="text-sm text-fg-muted">{label}</span>
      <span className="font-display text-2xl leading-none">{t.num(value)}</span>
      {note ? <span className="text-sm text-fg-muted">{note}</span> : null}
    </>
  );
  const box = 'grid min-w-0 content-start gap-1.5 rounded-md border border-border-subtle bg-surface-1 p-4';
  return href ? (
    <Link href={href} className={`${box} hover:border-border-strong`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** A filter as a link; the chosen one is marked with aria-current and an ink fill (and its weight). */
export function Chip({ href, current, children, testId }: { href: string; current: boolean; children: ReactNode; testId?: string }) {
  return (
    <Link
      href={href}
      aria-current={current ? 'true' : undefined}
      data-testid={testId}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border-subtle px-3.5 text-sm whitespace-nowrap text-fg-muted hover:border-border-strong hover:text-fg aria-[current=true]:border-fg aria-[current=true]:bg-fg aria-[current=true]:font-semibold aria-[current=true]:text-fg-inverse"
    >
      {children}
    </Link>
  );
}

export function Chips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {children}
    </nav>
  );
}

const STATUS = {
  verified: { mark: '✓', className: 'text-verified' },
  in_arbitration: { mark: '⚖', className: 'text-review' },
  revoked: { mark: '×', className: 'text-fg-muted' },
} as const;

function statusText(t: AdminT, status: keyof typeof STATUS): string {
  switch (status) {
    case 'verified':
      return t('Verified');
    case 'in_arbitration':
      return t('In arbitration');
    case 'revoked':
      return t('Ended');
  }
}

/** A link's status: a mark and a word. */
export function LinkStatus({ t, status }: { t: AdminT; status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${s.className}`}>
      <span aria-hidden="true">{s.mark}</span>
      {statusText(t, status)}
    </span>
  );
}

/** "No source" or "Years not known": something to fix, with a question mark (never colour alone). */
export function Missing({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-review">
      <span aria-hidden="true">?</span>
      {children}
    </span>
  );
}

/** A sortable column header: a link that sorts by the column, marked when it is the order now. */
export function SortHeader({ t, label, href, current, className = '' }: { t: AdminT; label: string; href: string; current: boolean; className?: string }) {
  return (
    <th role="columnheader" scope="col" aria-sort={current ? 'ascending' : undefined} className={`px-2 py-2 text-sm font-medium whitespace-nowrap text-fg-muted ${className}`}>
      <Link href={href} className="inline-flex min-h-11 items-center gap-1 hover:text-fg aria-[current=true]:font-semibold aria-[current=true]:text-fg" aria-current={current ? 'true' : undefined}>
        {label}
        {current ? <span aria-hidden="true">▲</span> : null}
        {current ? <span className="sr-only"> {t('(sorted)')}</span> : <span className="sr-only">{t(', sort by this column')}</span>}
      </Link>
    </th>
  );
}

export function Header({ label, className = '' }: { label: ReactNode; className?: string }) {
  return (
    <th role="columnheader" scope="col" className={`px-2 py-2 text-sm font-medium whitespace-nowrap text-fg-muted ${className}`}>
      {label}
    </th>
  );
}

/**
 * The count line above a table: "People 1 to 50 of 1,302". `none` and `range` are the page's own
 * sentences (translated there); `range` gets {from}, {to} and {total}.
 */
export function CountLine({
  t,
  total,
  page,
  pageSize,
  none,
  range,
  testId,
}: {
  t: AdminT;
  total: number;
  page: number;
  pageSize: number;
  none: string;
  range: (vars: { from: string; to: string; total: string }) => string;
  testId: string;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <p className="text-sm text-fg-muted" data-testid={testId} aria-live="polite">
      {total === 0 ? none : range({ from: t.num(first), to: t.num(last), total: t.num(total) })}
    </p>
  );
}

export function Pager({ t, page, pages, href, label }: { t: AdminT; page: number; pages: number; href: (page: number) => string; label: string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-3 text-ui">
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonVariants({ variant: 'secondary' })} rel="prev">
          {t('Previous')}
        </Link>
      ) : null}
      <span className="text-fg-muted">
        {t('Page {page} of {pages}', { page: t.num(page), pages: t.num(pages) })}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className={buttonVariants({ variant: 'secondary' })} rel="next">
          {t('Next')}
        </Link>
      ) : null}
    </nav>
  );
}

/** The cell classes of a table that becomes cards below a container width of 52rem. */
export const cell = 'px-2 py-3 @max-[52rem]:block @max-[52rem]:p-0';
export const rowClass =
  'border-b border-border-subtle align-top hover:bg-surface-2 @max-[52rem]:grid @max-[52rem]:gap-2 @max-[52rem]:rounded-md @max-[52rem]:border @max-[52rem]:bg-surface-1 @max-[52rem]:p-4';
export const tableClass = 'w-full border-collapse text-left text-ui @max-[52rem]:grid @max-[52rem]:gap-3';
export const theadClass = 'sticky top-0 z-[1] bg-bg @max-[52rem]:hidden';

/** The label of a cell, shown only when the row is a card. */
export function CardLabel({ children }: { children: ReactNode }) {
  return <span className="sr-only @max-[52rem]:not-sr-only @max-[52rem]:text-sm @max-[52rem]:text-fg-muted">{children} </span>;
}
