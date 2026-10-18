// The table of plan grants on /admin/grants (milestone M08, In scope 3; plan §5.6 "Tables"):
// TanStack Table 9 (table-core) builds the column and row model on the server; the markup is
// ours. Sorting, filtering and paging also run on the server, with their state in the URL (header
// links, the search form, page links), so the table needs no JavaScript and the route ships none
// for it; only the revoke forms are client islands. Below a container width of 40rem the rows
// become cards instead of scrolling sideways; the explicit table roles keep the semantics when the
// display changes.

import { constructTable, createColumnHelper, tableFeatures } from '@tanstack/table-core';
import { FlexRender } from '@tanstack/table-core/flex-render';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { CheckIcon, DashIcon, PlannedIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import type { FormState } from '@/lib/form-state';
import type { GrantList, GrantRow, GrantSort } from '@/server/services/grants';
import { RevokeGrantForm } from './forms';

const features = tableFeatures({ coreReactivityFeature: storeReactivityBindings() });
const helper = createColumnHelper<typeof features, GrantRow>();

/** The column ids are the sort keys of grants.list where a column sorts. */
const SORTABLE = new Set<string>(['email', 'plan', 'starts', 'ends', 'state']);

const STATE_ICONS = {
  active: CheckIcon,
  scheduled: PlannedIcon,
  ended: DashIcon,
  revoked: DashIcon,
} as const;

const columns = helper.columns([
  helper.accessor('email', {
    id: 'email',
    header: 'Account',
    cell: (info) => (
      <span className="grid gap-0.5">
        <span translate="no" className="font-semibold [overflow-wrap:anywhere]">
          {info.getValue()}
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
  helper.accessor('startsAt', { id: 'starts', header: 'Starts', cell: (info) => formatDay(info.getValue()) }),
  helper.accessor('endsAt', {
    id: 'ends',
    header: 'Ends',
    cell: (info) => {
      const value = info.getValue();
      return value ? formatDay(value) : <span className="text-fg-muted">No end date</span>;
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
              {formatDay(row.revokedAt)}
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
        <span className="[overflow-wrap:anywhere]">{info.getValue()}</span>
        {info.row.original.grantedBy ? (
          <span className="text-sm text-fg-muted">
            by <span translate="no">{info.row.original.grantedBy}</span>
          </span>
        ) : null}
      </span>
    ),
  }),
  // Rendered by GrantsTable itself (ActionsCell), which has the outcome of a revoke without JavaScript.
  helper.display({ id: 'actions', header: 'Actions' }),
]);

function ActionsCell({ row, revoked }: { row: GrantRow; revoked: FormState | null }) {
  if (row.state !== 'active' && row.state !== 'scheduled') return <span className="text-sm text-fg-muted">None</span>;
  const initial = revoked?.values?.grantId === row.id ? revoked : null;
  return <RevokeGrantForm grantId={row.id} planName={row.planName} email={row.email} initial={initial} />;
}

/** The address of this page with the list's state and `changes` applied. */
function hrefWith(list: GrantList, changes: Partial<{ sort: GrantSort; dir: 'asc' | 'desc'; page: number }>): string {
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

export function GrantsTable({ list, revoked }: { list: GrantList; revoked?: FormState | null }) {
  const table = constructTable({ features, columns, data: list.rows });
  return (
    <div className="@container grid gap-4">
      {list.rows.length === 0 ? (
        <p className="rounded-sm bg-surface-2 px-4 py-4 text-ui text-fg-muted">
          {list.q ? 'No grant matches this address.' : 'No plan has been given yet. Use the form above to give a test plan.'}
        </p>
      ) : (
        <table role="table" data-testid="grants-table" className="w-full border-collapse text-left text-ui @max-[40rem]:block">
          <caption className="sr-only">Plan grants, sorted by {list.sort === 'created' ? 'date given' : list.sort}, {list.dir === 'asc' ? 'ascending' : 'descending'}</caption>
          <thead role="rowgroup" className="@max-[40rem]:sr-only">
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
                          href={hrefWith(list, { sort: id as GrantSort, dir: current && list.dir === 'asc' ? 'desc' : 'asc', page: 1 })}
                          className="inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline"
                        >
                          {FlexRender({ header }) as ReactNode}
                          <span aria-hidden="true" className={cx('text-xs', current ? 'text-fg' : 'text-fg-subtle')}>
                            {current ? (list.dir === 'asc' ? '▲' : '▼') : '△'}
                          </span>
                          <span className="sr-only">, sort {current && list.dir === 'asc' ? 'descending' : 'ascending'}</span>
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
          <tbody role="rowgroup" className="@max-[40rem]:grid @max-[40rem]:gap-3">
            {table.getRowModel().rows.map((row) => (
              <tr
                role="row"
                key={row.id}
                data-testid="grant-row"
                data-state={row.original.state}
                className="border-b border-border-subtle align-top @max-[40rem]:grid @max-[40rem]:gap-2 @max-[40rem]:rounded-sm @max-[40rem]:border @max-[40rem]:p-4"
              >
                {row.getAllCells().map((cell) => (
                  <td role="cell" key={cell.id} className="px-2 py-3 first:pl-0 @max-[40rem]:block @max-[40rem]:p-0">
                    <span aria-hidden="true" className="hidden text-label font-semibold text-fg-muted @max-[40rem]:block">
                      {String(cell.column.columnDef.header)}
                    </span>
                    {cell.column.id === 'actions' ? <ActionsCell row={row.original} revoked={revoked ?? null} /> : (FlexRender({ cell }) as ReactNode)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
