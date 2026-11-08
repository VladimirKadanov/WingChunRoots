// /admin/schools (milestone M20; specification §7.3; docs/adr/0023-school-activity.md): the listed
// schools with their activity check, for moderators and administrators with a verified second
// factor (schools.adminList). The longest without an edit or a confirmation first; a filter by
// stage (links, so it works without JavaScript): current, awaiting confirmation (from day 90; the
// Sifu was asked) and hidden from the map (from day 105; kept). Each stage in words with a mark,
// never colour alone. Staff see the school's name, city and dates only: no contact and no point.
// Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { ADMIN_SCHOOLS_LOAD_ERROR } from '@/components/account/load-errors/admin-schools';
import { PageRedirect } from '@/components/account/page-redirect';
import { ActivityState } from '@/components/schools/activity-state';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
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

export default async function AdminSchoolsPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const asked = typeof query.stage === 'string' ? query.stage : 'all';
  const stage: StageFilter = STAGES.some((s) => s.value === asked) ? (asked as StageFilter) : 'all';
  const guard = await guardRoute(PAGE, stage === 'all' ? PAGE : `${PAGE}?stage=${stage}`);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  const view = await pageRead(serverClient(await headers(), guard.principal).schools.adminList({ stage }));
  if (!view) return <LoadError {...ADMIN_SCHOOLS_LOAD_ERROR} retryHref={PAGE} />;
  const total = view.counts.current + view.counts.awaiting_confirmation + view.counts.hidden;
  const count = (value: StageFilter) => (value === 'all' ? total : view.counts[value]);

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow">
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Administration
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">School activity</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          A listed school whose Sifu has not edited or confirmed it for 90 days awaits confirmation: the Sifu is asked, and the school stays on the map. From day 105
          it is hidden from the public map and list until the Sifu confirms it. Nothing is deleted, and signing in does not count.
        </p>

        <nav aria-label="Filter by stage" className="mt-6">
          <ul className="flex flex-wrap gap-2" data-testid="admin-schools-filter">
            {STAGES.map((s) => (
              <li key={s.value}>
                <Link
                  href={s.value === 'all' ? PAGE : `${PAGE}?stage=${s.value}`}
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

        {view.schools.length === 0 ? (
          <p className="mt-8 text-fg-muted" data-testid="admin-schools-empty">
            {stage === 'all' ? 'No school is listed.' : `No listed school is in this stage: ${STAGES.find((s) => s.value === stage)!.label.toLowerCase()}.`}
          </p>
        ) : (
          <ul className="mt-6 grid" data-testid="admin-schools">
            {view.schools.map((school) => (
              <li key={school.id} className="grid gap-1 border-b border-border-subtle py-4" data-testid="admin-school" data-activity={school.activity.stage} data-slug={school.slug}>
                <p className="font-display text-lg [overflow-wrap:anywhere]">
                  {school.public ? (
                    <Link href={`/schools/${school.slug}`} className="link inline-flex min-h-11 items-center">
                      {school.name}
                    </Link>
                  ) : (
                    <span className="inline-flex min-h-11 items-center">{school.name}</span>
                  )}
                </p>
                <p className="text-sm text-fg-muted">
                  {school.city}, {school.countryCode} · last edited or confirmed {formatDay(school.activity.lastActivityAt)}
                  {school.listedByAccount ? '' : ' · a record of the platform, not checked'}
                </p>
                <p className="text-sm">
                  <ActivityState stage={school.activity.stage} testId="admin-school-activity">
                    {school.activity.stage === 'hidden' && school.activity.hiddenAt
                      ? `Hidden from the map since ${formatDay(school.activity.hiddenAt)} (asked on ${formatDay(school.activity.awaitingSince ?? school.activity.hiddenAt)})`
                      : school.activity.stage === 'awaiting_confirmation' && school.activity.awaitingSince
                        ? `Awaiting confirmation since ${formatDay(school.activity.awaitingSince)}; hidden from about ${formatDay(school.activity.hiddenFrom ?? school.activity.awaitingSince)} without it`
                        : 'Current'}
                  </ActivityState>
                </p>
                <p className="text-sm text-fg-muted">{school.public ? 'On the public map' : 'Not on the public map'}</p>
              </li>
            ))}
          </ul>
        )}
        {view.truncated ? <p className="mt-4 text-sm text-fg-muted">The first 200 schools are shown, the longest without activity first.</p> : null}
      </div>
    </div>
  );
}
