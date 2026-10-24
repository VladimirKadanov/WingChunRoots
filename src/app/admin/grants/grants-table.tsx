// The table of plan grants on /admin/grants (milestone M08, In scope 3; plan §5.6 "Tables"):
// TanStack Table 9 (table-core) builds the column and row model on the server; the markup is
// ours. Sorting, filtering and paging also run on the server, with their state in the URL (header
// links, the search form, page links), so the table needs no JavaScript and the route ships none
// for it; only the revoke forms are client islands.
//
// Each grant is its own row group: the data row, then a full-width row with its revoke form, so
// opening a revoke never reflows the columns (review round 1, design-6). Dates are short and never
// wrap; an address is always shown whole, wrapping before its "@" when it must (review round 2,
// recheck-6: a cut address with the rest only in a hover title hid it from keyboard and touch).
// The caption says the order. Below a container width of 52rem (phones, and a desktop at 200 % zoom; a11y-webview-14)
// the groups become cards instead of scrolling sideways: the header row is not displayed, so its
// sort links leave the tab order, and a visible "Sort by" bar takes their place (design-5,
// a11y-webview-4). The explicit table roles keep the semantics when the display changes.

import { constructTable, createColumnHelper, tableFeatures } from '@tanstack/table-core';
import { FlexRender } from '@tanstack/table-core/flex-render';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { CheckIcon, DashIcon, PlannedIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import { formatDay, formatShortDay } from '@/lib/dates';
import type { FormState } from '@/lib/form-state';
import type { GrantList, GrantRow, GrantSort } from '@/server/services/grants';
import { RevokeGrantForm } from './forms';

const features = tableFeatures({ coreReactivityFeature: storeReactivityBindings() });
const helper = createColumnHelper<typeof features, GrantRow>();

/** The column ids are the sort keys of grants.list where a column sorts. */
const SORTABLE = new Set<string>(['email', 'plan', 'starts', 'ends', 'state']);

/** What each sort key is called in words (review round 1, a11y-webview-10), in the "Sort by" bar's order. */
const SORT_LABELS: Record<GrantSort, string> = {
  created: 'date given',
  email: 'account',
  plan: 'plan',
  starts: 'start date',
  ends: 'end date',
  state: 'state',
};

/** The direction in words: dates by age, text alphabetically. */
function directionWords(sort: GrantSort, dir: 'asc' | 'desc'): string {
  if (sort === 'created' || sort === 'starts' || sort === 'ends') return dir === 'asc' ? 'oldest first' : 'newest first';
  if (sort === 'email' || sort === 'plan') return dir === 'asc' ? 'A to Z' : 'Z to A';
  return dir === 'asc' ? 'ascending' : 'descending';
}

const STATE_ICONS = {
  active: CheckIcon,
  scheduled: PlannedIcon,
  ended: DashIcon,
  revoked: DashIcon,
} as const;

/** A day in the short form that never wraps, with the full date in its title. */
function Day({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatDay(value)} className="whitespace-nowrap tabular">
      {formatShortDay(value)}
    </time>
  );
}

/** An address with a preferred line break before its "@": the whole address, never cut. */
function EmailText({ email }: { email: string }) {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

const columns = helper.columns([
  helper.accessor('email', {
    id: 'email',
    header: 'Account',
    cell: (info) => (
      <span className="grid gap-0.5">
        <span translate="no" className="block max-w-[30ch] font-semibold [overflow-wrap:anywhere] @max-[52rem]:max-w-none">
          <EmailText email={info.getValue()} />
        </span>
        <span className="text-sm text-fg-muted">{info.row.original.accountType === 'sifu' ? 'Sifu account' : 'Student account'}</span>
      </span>
    ),
  }),
  helper.accessor('planName', {
    id: 'plan',
    header: 'Plan',
    cell: (info) => (
      <span className="grid gap-0.5">
        <span>{info.getValue()}</span>
        <span className="text-sm text-fg-muted">{info.row.original.sourceLabel}</span>
      </span>
    ),
  }),
  helper.accessor('startsAt', { id: 'starts', header: 'Starts', cell: (info) => <Day value={info.getValue()} /> }),
  helper.accessor('endsAt', {
    id: 'ends',
    header: 'Ends',
    cell: (info) => {
      const value = info.getValue();
      return value ? <Day value={value} /> : <span className="whitespace-nowrap text-fg-muted">No end date</span>;
    },
  }),
  helper.accessor('stateLabel', {
    id: 'state',
    header: 'State',
    cell: (info) => {
      const row = info.row.original;
      const Icon = STATE_ICONS[row.state];
      return (
        <span className="grid gap-0.5">
          <span className={cx('inline-flex items-center gap-1.5 font-semibold', row.state !== 'active' && 'text-fg-muted')}>
            <Icon size={16} />
            {info.getValue()}
          </span>
          {row.state === 'active' && !row.inEffect ? <span className="text-sm text-fg-muted">Not in effect: other account type</span> : null}
          {row.revokedAt ? (
            <span className="text-sm text-fg-muted">
              <Day value={row.revokedAt} />
              {row.revokedBy ? (
                <>
                  {' '}
                  by <span translate="no">{row.revokedBy}</span>
                </>
              ) : null}
              {row.revokeReason ? `: ${row.revokeReason}` : null}
            </span>
          ) : null}
        </span>
      );
    },
  }),
  helper.accessor('reason', {
    id: 'reason',
    header: 'Reason',
    cell: (info) => (
      <span className="grid gap-0.5">
        <span className="break-words">{info.getValue()}</span>
        {info.row.original.grantedBy ? (
          <span className="text-sm text-fg-muted">
            by <span translate="no">{info.row.original.grantedBy}</span>
          </span>
        ) : null}
      </span>
    ),
  }),
]);

/** The address of this page with the list's state and `changes` applied. */
export function hrefWith(list: GrantList, changes: Partial<{ sort: GrantSort; dir: 'asc' | 'desc'; page: number }>): string {
  const params = new URLSearchParams();
  if (list.q) params.set('q', list.q);
  const sort = changes.sort ?? list.sort;
  const dir = changes.dir ?? list.dir;
  if (sort !== 'created' || dir !== 'desc') {
    params.set('sort', sort);
    params.set('dir', dir);
  }
  const page = changes.page ?? list.page;
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/admin/grants${query ? `?${query}` : ''}`;
}

/** The next direction for a sort link: the other one for the current sort, else its natural one. */
function nextDir(list: GrantList, sort: GrantSort): 'asc' | 'desc' {
  if (list.sort === sort) return list.dir === 'asc' ? 'desc' : 'asc';
  return sort === 'created' ? 'desc' : 'asc';
}

/** Card mode only: the sort control the hidden header row would give (design-5, a11y-webview-4). */
function SortBar({ list }: { list: GrantList }) {
  return (
    <nav aria-label="Sort grants" data-testid="grants-sort" className="hidden flex-wrap items-center gap-x-4 text-sm @max-[52rem]:flex">
      <span className="text-fg-muted">Sort by</span>
      {(Object.keys(SORT_LABELS) as GrantSort[]).map((sort) => {
        const current = list.sort === sort;
        return (
          <Link
            key={sort}
            href={hrefWith(list, { sort, dir: nextDir(list, sort), page: 1 })}
            aria-current={current ? 'true' : undefined}
            // At least 44×44 CSS px on a phone, however short the word (final check, screens-7).
            className={cx(
              'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-1 underline-offset-4 hover:underline',
              current ? 'font-semibold text-fg underline' : 'text-fg-muted',
            )}
          >
            {SORT_LABELS[sort].replace(/^./, (c) => c.toUpperCase())}
            {current ? (
              <>
                <span aria-hidden="true" className="text-xs">
                  {list.dir === 'asc' ? '▲' : '▼'}
                </span>
                <span className="sr-only"> ({directionWords(sort, list.dir)}; press for {directionWords(sort, nextDir(list, sort))})</span>
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function GrantsTable({ list, revoked }: { list: GrantList; revoked?: FormState | null }) {
  // Rows keyed by the grant, so a row keeps its revoke form (and its outcome) when the page refreshes.
  const table = constructTable({ features, columns, data: list.rows, getRowId: (row) => row.id });
  const order = `Sorted by ${SORT_LABELS[list.sort]}, ${directionWords(list.sort, list.dir)}`;
  const span = columns.length;
  return (
    <div className="@container grid gap-4">
      {list.rows.length === 0 ? (
        <p className="rounded-sm bg-surface-2 px-4 py-4 text-ui text-fg-muted">
          {list.q ? 'No grant matches this address.' : 'No plan has been given yet. Use the form above to give a test plan.'}
        </p>
      ) : (
        <>
          <SortBar list={list} />
          <table role="table" data-testid="grants-table" className="w-full border-collapse text-left text-ui @max-[52rem]:grid @max-[52rem]:gap-3">
            <caption className="pb-2 text-left text-sm text-fg-muted @max-[52rem]:sr-only">
              <span className="sr-only">Plan grants. </span>
              {order}
            </caption>
            <thead role="rowgroup" className="@max-[52rem]:hidden">
              {table.getHeaderGroups().map((group) => (
                <tr role="row" key={group.id} className="border-b border-border-strong">
                  {group.headers.map((header) => {
                    const id = header.column.id;
                    const sortable = SORTABLE.has(id);
                    const current = list.sort === id;
                    return (
                      <th
                        role="columnheader"
                        key={header.id}
                        scope="col"
                        aria-sort={current ? (list.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                        className="px-2 py-2 align-bottom text-sm font-semibold text-fg-muted first:pl-0"
                      >
                        {sortable ? (
                          <Link
                            href={hrefWith(list, { sort: id as GrantSort, dir: nextDir(list, id as GrantSort), page: 1 })}
                            className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline"
                          >
                            {FlexRender({ header }) as ReactNode}
                            <span aria-hidden="true" className={cx('text-xs', current ? 'text-fg' : 'text-fg-subtle')}>
                              {current ? (list.dir === 'asc' ? '▲' : '▼') : '△'}
                            </span>
                            <span className="sr-only"> (sort {nextDir(list, id as GrantSort) === 'asc' ? 'ascending' : 'descending'})</span>
                          </Link>
                        ) : (
                          <span className="inline-flex min-h-11 items-center">{FlexRender({ header }) as ReactNode}</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            {table.getRowModel().rows.map((row) => {
              const grant = row.original;
              const initial = revoked?.values?.grantId === grant.id ? revoked : null;
              return (
                <tbody
                  role="rowgroup"
                  key={row.id}
                  data-testid="grant-row"
                  data-state={grant.state}
                  className="border-b border-border-subtle @max-[52rem]:grid @max-[52rem]:gap-3 @max-[52rem]:rounded-sm @max-[52rem]:border @max-[52rem]:p-4"
                >
                  <tr role="row" className="align-top @max-[52rem]:grid @max-[52rem]:gap-2">
                    {row.getAllCells().map((cell) => (
                      <td role="cell" key={cell.id} className="px-2 pt-3 pb-2 first:pl-0 @max-[52rem]:block @max-[52rem]:p-0">
                        {/* In card mode the header row is not displayed: each value carries its label. */}
                        <span className="hidden text-label font-semibold text-fg-muted @max-[52rem]:block">{String(cell.column.columnDef.header)}</span>
                        {FlexRender({ cell }) as ReactNode}
                      </td>
                    ))}
                  </tr>
                  <tr role="row" className="has-[>td:empty]:hidden @max-[52rem]:grid">
                    <td role="cell" colSpan={span} className="pb-3 empty:hidden @max-[52rem]:block @max-[52rem]:p-0">
                      <RevokeGrantForm
                        grantId={grant.id}
                        planName={grant.planName}
                        email={grant.email}
                        revocable={grant.state === 'active' || grant.state === 'scheduled'}
                        back={hrefWith(list, {})}
                        initial={initial}
                      />
                    </td>
                  </tr>
                </tbody>
              );
            })}
          </table>
        </>
      )}
      {list.pages > 1 ? (
        <nav aria-label="Pages of plan grants" className="flex flex-wrap items-center gap-x-5 text-ui">
          {list.page > 1 ? (
            <Link href={hrefWith(list, { page: list.page - 1 })} className="link inline-flex min-h-11 items-center">
              Previous page
            </Link>
          ) : null}
          <span className="text-fg-muted">
            Page {list.page} of {list.pages} ({list.total} grants)
          </span>
          {list.page < list.pages ? (
            <Link href={hrefWith(list, { page: list.page + 1 })} className="link inline-flex min-h-11 items-center">
              Next page
            </Link>
          ) : null}
        </nav>
      ) : (
        <p className="text-sm text-fg-muted">{list.total === 1 ? '1 grant' : `${list.total} grants`}</p>
      )}
    </div>
  );
}
