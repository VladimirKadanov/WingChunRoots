// The parts the control panel's lists share (owner request 2026-11-17, docs/adr/0035-control-panel.md):
// the page header, the saved views with their counts, the count line, the pager, the status mark
// and the classes of a dense table that becomes cards under a container width of 52rem. Server
// markup only, with no script: the filters, the sort and the pages are plain links and GET forms,
// with their state in the URL, so the admin routes keep their script budget (plan §5.8 (c)). A
// status is a word with a mark (a shape), never colour alone.

import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { cx } from "@/lib/cx";

/** A filter field (input or select) of a list's GET form. */
export const adminFieldClass =
  "block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-3 text-field text-fg hover:border-fg-muted focus-visible:border-fg";

/** The table, its header cells, its rows and its cells: a dense table, cards under 52rem. */
export const table = {
  table:
    "w-full border-collapse text-left text-ui @max-[52rem]:grid @max-[52rem]:gap-3",
  thead: "@max-[52rem]:hidden",
  headRow: "border-b border-border-strong",
  th: "sticky top-0 z-[1] bg-bg px-2 py-2 align-bottom text-sm font-medium whitespace-nowrap text-fg-muted first:pl-0 last:pr-0",
  tbody: "@max-[52rem]:grid @max-[52rem]:gap-3",
  row: "border-b border-border-subtle align-top hover:bg-surface-1 @max-[52rem]:grid @max-[52rem]:gap-2 @max-[52rem]:rounded-md @max-[52rem]:border @max-[52rem]:bg-surface-1 @max-[52rem]:p-4",
  td: "px-2 py-3 first:pl-0 last:pr-0 @max-[52rem]:block @max-[52rem]:p-0",
  /** The label a cell carries when its row is a card. */
  cardLabel: "hidden text-label font-semibold text-fg-muted @max-[52rem]:block",
} as const;

export function AdminPageHeader({
  title,
  intro,
  summary,
  eyebrow = "Control panel",
}: {
  title: string;
  intro?: ReactNode;
  summary?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="grid gap-2">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="font-display text-feature">{title}</h1>
      {summary ? <p className="text-ui text-fg">{summary}</p> : null}
      {intro ? (
        <p className="max-w-[72ch] text-ui text-fg-muted">{intro}</p>
      ) : null}
    </header>
  );
}

export interface AdminView {
  href: string;
  label: string;
  count?: number;
  current: boolean;
  testId?: string;
}

/** The saved views of a list, each with its count: a column beside the table from 1536 px (narrower, the table keeps the width it needs to stay a table), a wrapped row above it under that. */
export function AdminViews({
  label,
  views,
}: {
  label: string;
  views: readonly AdminView[];
}) {
  return (
    <nav aria-label={label} className="min-w-0">
      <ul className="flex flex-wrap gap-2 2xl:grid 2xl:gap-0.5">
        {views.map((view) => (
          <li key={view.href}>
            <Link
              href={view.href}
              aria-current={view.current ? "page" : undefined}
              data-testid={view.testId}
              className={cx(
                "flex min-h-11 items-center gap-3 rounded-sm border px-3 text-ui 2xl:border-transparent 2xl:border-l-[3px]",
                view.current
                  ? "border-fg bg-surface-2 font-semibold 2xl:border-l-fg"
                  : "border-border-subtle hover:bg-surface-1",
              )}
            >
              <span>{view.label}</span>
              {view.count === undefined ? null : (
                <span className="ml-auto text-sm text-fg-muted tabular">
                  {view.count}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** "Cases 1 to 25 of 37": the count line of a list. */
export function RangeLine({
  noun,
  total,
  page,
  pageSize,
  testId,
  extra,
}: {
  noun: string;
  total: number;
  page: number;
  pageSize: number;
  testId?: string;
  extra?: ReactNode;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <p
      className="flex flex-wrap items-center gap-x-4 text-sm text-fg-muted"
      data-testid={testId}
      aria-live="polite"
    >
      <span>
        {total === 0
          ? `No ${noun.toLowerCase()} match.`
          : `${noun} ${first} to ${last} of ${total}`}
      </span>
      {extra}
    </p>
  );
}

/** Previous and next, with "Page 2 of 5": shown only when there is more than one page. */
export function Pager({
  label,
  page,
  pages,
  href,
}: {
  label: string;
  page: number;
  pages: number;
  href: (page: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center gap-3 text-ui"
    >
      {page > 1 ? (
        <Link
          href={href(page - 1)}
          className={buttonVariants({ variant: "secondary" })}
          rel="prev"
        >
          Previous
        </Link>
      ) : null}
      <span className="text-fg-muted">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link
          href={href(page + 1)}
          className={buttonVariants({ variant: "secondary" })}
          rel="next"
        >
          Next
        </Link>
      ) : null}
    </nav>
  );
}

export type MarkTone = "neutral" | "attention" | "danger" | "good";

const TONE: Record<MarkTone, string> = {
  neutral: "text-fg",
  attention: "text-review",
  danger: "text-danger",
  good: "text-verified",
};

/** A status in words with a shape before it (aria-hidden: the word says it). */
export function Mark({
  symbol,
  tone = "neutral",
  children,
  testId,
}: {
  symbol: string;
  tone?: MarkTone;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <span
      className={cx(
        // Inline, not a flex box: its box is the text's, so it lines up with the other cells' first line.
        "font-semibold",
        TONE[tone],
      )}
      data-testid={testId}
    >
      <span aria-hidden="true" className="mr-1.5 inline-block w-4 text-center">
        {symbol}
      </span>
      {children}
    </span>
  );
}

/** The empty state of a list: what is empty and what to do. */
export function EmptyState({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-md border border-dashed border-border-strong px-5 py-6 text-ui text-fg-muted"
    >
      {children}
    </div>
  );
}
