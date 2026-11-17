// /admin/schools (milestone M20; specification §7.3; docs/adr/0023-school-activity.md): the listed
// schools with their activity check, for moderators and administrators with a verified second
// factor (schools.adminList). Hidden, then awaiting, then current, the longest without an edit or a
// confirmation first within each; a filter by
// stage (links, so it works without JavaScript): current, awaiting confirmation (from day 90; the
// Sifu was asked) and hidden from the map (from day 105; kept). Each stage in words with a mark,
// never colour alone. Staff see the school's name, city and dates only: no contact and no point.
// Control panel (docs/adr/0035-control-panel.md): a table with a search (name, city or address),
// the stage views with their counts and pages of 50, all in the URL. Reads the session, so it
// renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { ADMIN_SCHOOLS_LOAD_ERROR } from '@/components/account/load-errors/admin-schools';
import { PageRedirect } from '@/components/account/page-redirect';
import { adminFieldClass, AdminPageHeader, EmptyState, Pager, RangeLine, table as t } from '@/components/admin/table-parts';
import { ActivityState } from '@/components/schools/activity-state';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay, formatShortDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

export const instant = false;

export const metadata: Metadata = {
  title: 'School activity',
  robots: { index: false },
};

const PAGE = '/admin/schools';
const STAGES = [
  { value: 'all', label: 'All listed' },
  { value: 'current', label: 'Current' },
  { value: 'awaiting_confirmation', label: 'Awaiting confirmation' },
  { value: 'hidden', label: 'Hidden from the map' },
] as const;
type StageFilter = (typeof STAGES)[number]['value'];

type Search = Promise<Record<string, string | string[] | undefined>>;

function schoolsHref(stage: StageFilter, q: string | null, page = 1): string {
  const params = new URLSearchParams();
  if (stage !== 'all') params.set('stage', stage);
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search ? `${PAGE}?${search}` : PAGE;
}

export default async function AdminSchoolsPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const asked = typeof query.stage === 'string' ? query.stage : 'all';
  const stage: StageFilter = STAGES.some((s) => s.value === asked) ? (asked as StageFilter) : 'all';
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : '';
  const pageAsked = typeof query.page === 'string' && /^[1-9][0-9]{0,3}$/.test(query.page) ? Number(query.page) : 1;
  const here = schoolsHref(stage, q || null, pageAsked);
  const guard = await guardRoute(PAGE, here);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  const view = await pageRead(serverClient(await headers(), guard.principal).schools.adminList({ stage, q: q || undefined, page: pageAsked }));
  if (!view) return <LoadError {...ADMIN_SCHOOLS_LOAD_ERROR} retryHref={here} />;
  const total = view.counts.current + view.counts.awaiting_confirmation + view.counts.hidden;
  const count = (value: StageFilter) => (value === 'all' ? total : view.counts[value]);
  const pages = Math.max(1, Math.ceil(view.total / view.pageSize));

  return (
    <div className="mx-auto max-w-[96rem] px-page pt-6 pb-10 md:pt-8 md:pb-14">
      <AdminPageHeader
        eyebrow={
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Control panel
          </Link>
        }
        title="School activity"
        summary={
          <span>
            <strong>{total}</strong> listed · <strong>{view.counts.awaiting_confirmation}</strong> awaiting confirmation · <strong>{view.counts.hidden}</strong> hidden from the map
          </span>
        }
        intro={
          <>
            A listed school whose Sifu has not edited or confirmed it for 90 days awaits confirmation: the Sifu is asked, and the school stays on the map. From day 105
            it is hidden from the public map and list until the Sifu confirms it. Nothing is deleted, and signing in does not count. New listings are decided in the{' '}
            <Link href="/admin/review?group=listings" className="link">
              review queue
            </Link>
            .
          </>
        }
      />

      <nav aria-label="Filter by stage" className="mt-6">
        <ul className="flex flex-wrap gap-2" data-testid="admin-schools-filter">
          {STAGES.map((s) => (
            <li key={s.value}>
              <Link
                href={schoolsHref(s.value, q || null)}
                aria-current={s.value === stage ? 'page' : undefined}
                className={cx(
                  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm border px-3 text-sm',
                  // The chosen one is said with a heavier border and a mark, not by colour alone (as /dashboard/notifications).
                  s.value === stage ? 'border-2 border-fg px-[11px] font-semibold' : 'border-border-strong text-fg-muted hover:border-fg-muted hover:text-fg',
                )}
                data-testid="admin-schools-stage"
                data-stage={s.value}
              >
                {s.value === stage ? <span aria-hidden="true" className="size-1.5 rounded-full bg-fg" /> : null}
                {s.label}
                <span aria-hidden="true">·</span>
                <span>{count(s.value)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form role="search" action={PAGE} method="get" className="mt-5 flex flex-wrap items-end gap-3" data-testid="admin-schools-search">
        {stage !== 'all' ? <input type="hidden" name="stage" value={stage} /> : null}
        <div className="grid min-w-0 flex-1 basis-[18rem] gap-1.5 sm:max-w-[30rem]">
          <label htmlFor="schools-q" className="text-sm font-semibold">
            School, city or address
          </label>
          <input id="schools-q" name="q" type="search" defaultValue={q} maxLength={120} autoComplete="off" spellCheck={false} className={adminFieldClass} />
        </div>
        <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          Search
        </button>
        {q ? (
          <Link href={schoolsHref(stage, null)} className="link inline-flex min-h-12 items-center text-ui">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="mt-5 grid gap-4">
        <RangeLine noun="Schools" total={view.total} page={view.page} pageSize={view.pageSize} testId="admin-schools-count" extra={<span>hidden first, then awaiting, the longest without activity first</span>} />
        {view.schools.length === 0 ? (
          <EmptyState testId="admin-schools-empty">
            {q
              ? `No listed school matches “${q}”${stage === 'all' ? '' : ` in this stage`}. Check the spelling, or clear the search.`
              : stage === 'all'
                ? 'No school is listed.'
                : `No listed school is in this stage: ${STAGES.find((s) => s.value === stage)!.label.toLowerCase()}.`}
          </EmptyState>
        ) : (
          <div className="@container">
            <table role="table" data-testid="admin-schools" className={t.table}>
              <caption className="sr-only">Listed schools, hidden first, then awaiting confirmation, the longest without activity first</caption>
              <thead role="rowgroup" className={t.thead}>
                <tr role="row" className={t.headRow}>
                  <th role="columnheader" scope="col" className={t.th}>School</th>
                  <th role="columnheader" scope="col" className={t.th}>Activity</th>
                  <th role="columnheader" scope="col" className={t.th}>Last edit or confirmation</th>
                  <th role="columnheader" scope="col" className={t.th}>Public map</th>
                  <th role="columnheader" scope="col" className={t.th}>Listed by</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={t.tbody}>
                {view.schools.map((school) => (
                  <tr role="row" key={school.id} className={t.row} data-testid="admin-school" data-activity={school.activity.stage} data-slug={school.slug}>
                    <td role="cell" className={t.td}>
                      <span className="block font-semibold [overflow-wrap:anywhere]">
                        {school.public ? (
                          <Link href={`/schools/${school.slug}`} className="link inline-flex min-h-11 items-center @min-[52rem]:-my-2.5">
                            {school.name}
                          </Link>
                        ) : (
                          school.name
                        )}
                      </span>
                      <span className="block text-sm text-fg-muted">
                        {school.city}, {school.countryCode}
                      </span>
                    </td>
                    <td role="cell" className={t.td}>
                      <span className={t.cardLabel}>Activity</span>
                      <span className="text-sm">
                        <ActivityState stage={school.activity.stage} testId="admin-school-activity">
                          {school.activity.stage === 'hidden' && school.activity.hiddenAt
                            ? `Hidden from the map since ${formatDay(school.activity.hiddenAt)} (asked on ${formatDay(school.activity.awaitingSince ?? school.activity.hiddenAt)})`
                            : school.activity.stage === 'awaiting_confirmation' && school.activity.awaitingSince
                              ? `Awaiting confirmation since ${formatDay(school.activity.awaitingSince)}; hidden from about ${formatDay(school.activity.hiddenFrom ?? school.activity.awaitingSince)} without it`
                              : 'Current'}
                        </ActivityState>
                      </span>
                    </td>
                    <td role="cell" className={cx(t.td, 'whitespace-nowrap')}>
                      <span className={t.cardLabel}>Last edit or confirmation</span>
                      <time dateTime={school.activity.lastActivityAt} title={formatDay(school.activity.lastActivityAt)}>
                        {formatShortDay(school.activity.lastActivityAt)}
                      </time>
                    </td>
                    <td role="cell" className={t.td}>
                      <span className={t.cardLabel}>Public map</span>
                      <span className={school.public ? undefined : 'text-fg-muted'}>{school.public ? 'On the public map' : 'Not on the public map'}</span>
                    </td>
                    <td role="cell" className={t.td}>
                      <span className={t.cardLabel}>Listed by</span>
                      {school.listedByAccount ? 'A Sifu' : <span className="text-fg-muted">A record of the platform, not checked</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager label="Pages of schools" page={view.page} pages={pages} href={(page) => schoolsHref(stage, q || null, page)} />
      </div>
    </div>
  );
}
