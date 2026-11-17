// The table of the review queue on /admin/review (milestone M10a, In scope 4; plan §5.6 "Tables"):
// TanStack Table 9 (table-core) builds the column and row model on the server; the markup is ours,
// as on /admin/grants. Filtering, sorting and paging run on the server with their state in the
// URL (the filter form, the sort link, the page links), so the table ships no JavaScript. Below a
// container width of 52rem (phones, a desktop at 200 % zoom) each row becomes a card: the header row
// is not displayed and each value carries its label. Status is said in words, never by colour alone.
// M10b: a case without a relationship (an instructor verification, a profile report) names its
// profile in the People column and in its link's name, so two such cases are told apart.

import { constructTable, createColumnHelper, tableFeatures } from '@tanstack/table-core';
import { FlexRender } from '@tanstack/table-core/flex-render';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { NameText } from '@/components/account/person-names';
import { EmptyState, Mark, type MarkTone, Pager, RangeLine, table as t } from '@/components/admin/table-parts';
import { formatDay, formatShortDay } from '@/lib/dates';
import { waitedOver, waitedText } from '@/lib/waited';
import type { ReviewList, ReviewListRow } from '@/server/services/review';

/** Control panel: each status with a shape as well as its word (never colour alone). */
const STATUS_MARK: Record<ReviewListRow['status'], { symbol: string; tone: MarkTone }> = {
  open: { symbol: '○', tone: 'neutral' },
  in_review: { symbol: '◐', tone: 'neutral' },
  needs_info: { symbol: '?', tone: 'attention' },
  resolved: { symbol: '✓', tone: 'good' },
  dismissed: { symbol: '–', tone: 'neutral' },
};
/** A waiting case older than this is marked late (REVIEW_LATE_DAYS in the service). */
const LATE_DAYS = 3;
/** A row with the time the list was read, so the Waiting column measures to it. */
type QueueRow = ReviewListRow & { now: number };

/** What the profile of a case without a relationship is to it: shown, and spoken in the link's name. */
const SUBJECT_ROLE: Partial<Record<ReviewListRow['kind'], { shown: string; spoken: string }>> = {
  instructor_verification: { shown: 'Instructor', spoken: 'instructor' },
  profile_report: { shown: 'Reported', spoken: 'reported profile' },
};
const subjectRole = (row: QueueRow) => SUBJECT_ROLE[row.kind] ?? { shown: 'Profile', spoken: 'profile' };

const features = tableFeatures({ coreReactivityFeature: storeReactivityBindings() });
const helper = createColumnHelper<typeof features, QueueRow>();

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
              ) : row.school ? (
                <>school {row.school.name}, </>
              ) : row.organization ? (
                <>organization {row.organization.name}, </>
              ) : row.subject ? (
                <>
                  {subjectRole(row).spoken} <NameText name={row.subject.name} />,{' '}
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
      // M11: a school listing names the school and its city.
      if (row.school) {
        return (
          <span className="grid gap-0.5" data-testid="case-school">
            <span>
              <span className="text-sm text-fg-muted">School </span>
              {row.school.name}
            </span>
            <span className="text-sm text-fg-muted">
              {row.school.city}, {row.school.countryCode}
            </span>
          </span>
        );
      }
      // M15: an organization's application names the organization and its country.
      if (row.organization) {
        return (
          <span className="grid gap-0.5" data-testid="case-organization">
            <span>
              <span className="text-sm text-fg-muted">Organization </span>
              {row.organization.name}
            </span>
            {row.organization.countryCode ? <span className="text-sm text-fg-muted">{row.organization.countryCode}</span> : null}
          </span>
        );
      }
      if ((!row.teacher || !row.student) && row.subject) {
        return (
          <span data-testid="case-subject">
            <span className="text-sm text-fg-muted">{subjectRole(row).shown} </span>
            <NameText name={row.subject.name} />
          </span>
        );
      }
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
    cell: (info) => {
      const mark = STATUS_MARK[info.row.original.status];
      return (
        <Mark symbol={mark.symbol} tone={mark.tone}>
          {info.getValue()}
        </Mark>
      );
    },
  }),
  helper.accessor('assignee', {
    id: 'assignee',
    header: 'Assigned to',
    cell: (info) => {
      const value = info.getValue();
      return <span className={value === null ? 'text-fg-muted' : value === 'me' ? 'font-semibold' : undefined}>{value === 'me' ? 'You' : value === 'other' ? 'Another reviewer' : 'Nobody yet'}</span>;
    },
  }),
  helper.accessor('openedAt', {
    id: 'waiting',
    header: 'Waiting',
    cell: (info) => {
      const { openedAt, status, now } = info.row.original;
      const open = status === 'open' || status === 'in_review' || status === 'needs_info';
      return (
        <span className="grid gap-0.5">
          {open && waitedOver(openedAt, now, LATE_DAYS) ? (
            <Mark symbol="!" tone="danger" testId="case-late">
              {waitedText(openedAt, now)}
              <span className="sr-only">, over {LATE_DAYS} days</span>
            </Mark>
          ) : (
            <span className="whitespace-nowrap tabular">{open ? waitedText(openedAt, now) : '—'}</span>
          )}
          <span className="text-sm text-fg-muted">
            <span className="sr-only">opened </span>
            <Day value={openedAt} />
          </span>
        </span>
      );
    },
  }),
]);

/** The address of the queue with the list's state and `changes` applied. */
export function queueHref(list: Pick<ReviewList, 'filters' | 'page'>, changes: Partial<{ sort: 'oldest' | 'newest'; page: number }>): string {
  const params = new URLSearchParams();
  const { kind, group, status, assigned, age } = list.filters;
  if (kind) params.set('kind', kind);
  if (group) params.set('group', group);
  if (status !== 'waiting') params.set('status', status);
  if (assigned !== 'any') params.set('assigned', assigned);
  if (age !== 'any') params.set('age', age);
  const sort = changes.sort ?? list.filters.sort;
  if (sort !== 'oldest') params.set('sort', sort);
  const page = changes.page ?? list.page;
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/admin/review${query ? `?${query}` : ''}`;
}

export function ReviewTable({ list }: { list: ReviewList }) {
  const now = Date.parse(list.asOf);
  const table = constructTable({ features, columns, data: list.rows.map((row) => ({ ...row, now })), getRowId: (row) => row.id });
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const other = list.filters.sort === 'oldest' ? 'newest' : 'oldest';
  return (
    <div className="@container grid gap-4">
      <RangeLine
        noun="Cases"
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        testId="queue-count"
        extra={
          <>
            <span>{list.filters.sort === 'oldest' ? 'oldest first' : 'newest first'}</span>
            <Link href={queueHref(list, { sort: other, page: 1 })} className="link inline-flex min-h-11 items-center" data-testid="queue-sort">
              Show {other} first
            </Link>
          </>
        }
      />
      {list.rows.length === 0 ? (
        <EmptyState testId="queue-empty">
          <p className="font-semibold text-fg">No case matches these filters.</p>
          <p className="mt-1">
            {list.counts.all > 0 ? (
              <>
                {list.counts.all === 1 ? '1 case is' : `${list.counts.all} cases are`} in the queue under this status.{' '}
                <Link href="/admin/review" className="link">
                  Show every waiting case
                </Link>
              </>
            ) : (
              'Nothing waits for a decision: the queue is clear.'
            )}
          </p>
        </EmptyState>
      ) : (
        <table role="table" data-testid="review-table" className={t.table}>
          <caption className="sr-only">Review cases, {list.filters.sort === 'oldest' ? 'oldest first' : 'newest first'}</caption>
          <thead role="rowgroup" className={t.thead}>
            {table.getHeaderGroups().map((group) => (
              <tr role="row" key={group.id} className={t.headRow}>
                {group.headers.map((header) => (
                  <th role="columnheader" key={header.id} scope="col" className={t.th}>
                    <span className="inline-flex min-h-9 items-center">{FlexRender({ header }) as ReactNode}</span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody role="rowgroup" className={t.tbody}>
            {table.getRowModel().rows.map((row) => (
              <tr role="row" key={row.id} data-testid="review-row" data-case={row.original.id} data-status={row.original.status} className={t.row}>
                {row.getAllCells().map((cell) => (
                  <td role="cell" key={cell.id} className={t.td}>
                    <span className={t.cardLabel}>{String(cell.column.columnDef.header)}</span>
                    {FlexRender({ cell }) as ReactNode}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pager label="Pages of the queue" page={list.page} pages={pages} href={(page) => queueHref(list, { page })} />
    </div>
  );
}
