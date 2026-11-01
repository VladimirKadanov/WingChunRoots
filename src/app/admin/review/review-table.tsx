// The table of the review queue on /admin/review (milestone M10a, In scope 4; plan §5.6 "Tables"):
// TanStack Table 9 (table-core) builds the column and row model on the server; the markup is ours,
// as on /admin/grants. Filtering, sorting and paging run on the server with their state in the
// URL (the filter form, the sort link, the page links), so the table ships no JavaScript. Below a
// container width of 52rem (phones, a desktop at 200 % zoom) each row becomes a card: the header row
// is not displayed and each value carries its label. Status is said in words, never by colour alone.

import { constructTable, createColumnHelper, tableFeatures } from '@tanstack/table-core';
import { FlexRender } from '@tanstack/table-core/flex-render';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { NameText } from '@/components/account/person-names';
import { formatDay, formatShortDay } from '@/lib/dates';
import type { ReviewList, ReviewListRow } from '@/server/services/review';

const features = tableFeatures({ coreReactivityFeature: storeReactivityBindings() });
const helper = createColumnHelper<typeof features, ReviewListRow>();

function Day({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatDay(value)} className="whitespace-nowrap tabular">
      {formatShortDay(value)}
    </time>
  );
}

const columns = helper.columns([
  helper.accessor('kindLabel', {
    id: 'case',
    header: 'Case',
    cell: (info) => {
      const row = info.row.original;
      return (
        <span className="grid gap-0.5">
          {/* The 44 px target is centred on the text; in the table layout it is pulled up by the
              difference, so the text shares the first line of the row's other cells (screens-11).
              The name says which case it opens: the people and the day (plan §5.6, screens-6). */}
          <Link href={`/admin/review/${row.id}`} className="link inline-flex min-h-11 items-center font-semibold @min-[52rem]:-mt-3" data-testid="case-link">
            {info.getValue()}
            {/* Starts with a word: a browser puts a space before this hidden text. */}
            <span className="sr-only">
              case:{' '}
              {row.teacher && row.student ? (
                <>
                  teacher <NameText name={row.teacher.name} />, student <NameText name={row.student.name} />,{' '}
                </>
              ) : null}
              opened {formatDay(row.openedAt)}
            </span>
          </Link>
          <span className="text-sm text-fg-muted">{row.files === 1 ? '1 file' : `${row.files} files`}</span>
        </span>
      );
    },
  }),
  helper.accessor('teacher', {
    id: 'people',
    header: 'People',
    cell: (info) => {
      const row = info.row.original;
      if (!row.teacher || !row.student) return <span className="text-fg-muted">—</span>;
      return (
        <span className="grid gap-0.5">
          <span>
            <span className="text-sm text-fg-muted">Teacher </span>
            <NameText name={row.teacher.name} />
          </span>
          <span>
            <span className="text-sm text-fg-muted">Student </span>
            <NameText name={row.student.name} />
          </span>
          {row.lineageName ? <span className="text-sm text-fg-muted">{row.lineageName}</span> : null}
        </span>
      );
    },
  }),
  helper.accessor('statusLabel', {
    id: 'status',
    header: 'Status',
    cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
  }),
  helper.accessor('assignee', {
    id: 'assignee',
    header: 'Assigned to',
    cell: (info) => {
      const value = info.getValue();
      return <span className={value === null ? 'text-fg-muted' : undefined}>{value === 'me' ? 'You' : value === 'other' ? 'Another reviewer' : 'Nobody yet'}</span>;
    },
  }),
  helper.accessor('openedAt', { id: 'opened', header: 'Opened', cell: (info) => <Day value={info.getValue()} /> }),
]);

/** The address of the queue with the list's state and `changes` applied. */
export function queueHref(list: ReviewList, changes: Partial<{ sort: 'oldest' | 'newest'; page: number }>): string {
  const params = new URLSearchParams();
  const { kind, status, assigned } = list.filters;
  if (kind) params.set('kind', kind);
  if (status !== 'waiting') params.set('status', status);
  if (assigned !== 'any') params.set('assigned', assigned);
  const sort = changes.sort ?? list.filters.sort;
  if (sort !== 'oldest') params.set('sort', sort);
  const page = changes.page ?? list.page;
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/admin/review${query ? `?${query}` : ''}`;
}

export function ReviewTable({ list }: { list: ReviewList }) {
  const table = constructTable({ features, columns, data: list.rows, getRowId: (row) => row.id });
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const other = list.filters.sort === 'oldest' ? 'newest' : 'oldest';
  return (
    <div className="@container grid gap-4">
      <p className="flex flex-wrap items-center gap-x-4 text-sm text-fg-muted">
        <span>
          {list.total === 1 ? '1 case' : `${list.total} cases`} · {list.filters.sort === 'oldest' ? 'oldest first' : 'newest first'}
        </span>
        <Link href={queueHref(list, { sort: other, page: 1 })} className="link inline-flex min-h-11 items-center" data-testid="queue-sort">
          Show {other} first
        </Link>
      </p>
      {list.rows.length === 0 ? (
        <p data-testid="queue-empty" className="rounded-sm bg-surface-2 px-4 py-4 text-ui text-fg-muted">
          No case matches these filters.
        </p>
      ) : (
        <table role="table" data-testid="review-table" className="w-full border-collapse text-left text-ui @max-[52rem]:grid @max-[52rem]:gap-3">
          <caption className="sr-only">Review cases, {list.filters.sort === 'oldest' ? 'oldest first' : 'newest first'}</caption>
          <thead role="rowgroup" className="@max-[52rem]:hidden">
            {table.getHeaderGroups().map((group) => (
              <tr role="row" key={group.id} className="border-b border-border-strong">
                {group.headers.map((header) => (
                  <th role="columnheader" key={header.id} scope="col" className="px-2 py-2 align-bottom text-sm font-semibold text-fg-muted first:pl-0">
                    <span className="inline-flex min-h-11 items-center">{FlexRender({ header }) as ReactNode}</span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody role="rowgroup" className="@max-[52rem]:grid @max-[52rem]:gap-3">
            {table.getRowModel().rows.map((row) => (
              <tr
                role="row"
                key={row.id}
                data-testid="review-row"
                data-case={row.original.id}
                data-status={row.original.status}
                className="border-b border-border-subtle align-top @max-[52rem]:grid @max-[52rem]:gap-2 @max-[52rem]:rounded-sm @max-[52rem]:border @max-[52rem]:p-4"
              >
                {row.getAllCells().map((cell) => (
                  <td role="cell" key={cell.id} className="px-2 pt-3 pb-3 first:pl-0 @max-[52rem]:block @max-[52rem]:p-0">
                    <span className="hidden text-label font-semibold text-fg-muted @max-[52rem]:block">{String(cell.column.columnDef.header)}</span>
                    {FlexRender({ cell }) as ReactNode}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 ? (
        <nav aria-label="Pages of the queue" className="flex flex-wrap items-center gap-4 text-sm">
          {list.page > 1 ? (
            <Link href={queueHref(list, { page: list.page - 1 })} className="link inline-flex min-h-11 items-center">
              Previous page
            </Link>
          ) : null}
          <span className="text-fg-muted">
            Page {list.page} of {pages}
          </span>
          {list.page < pages ? (
            <Link href={queueHref(list, { page: list.page + 1 })} className="link inline-flex min-h-11 items-center">
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
