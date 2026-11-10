// /dashboard/schools/[id]/stats (M21, docs/adr/0024-trial-lessons.md): the basic statistics of one of
// the account's schools (schools.stats): the last 12 ISO weeks, as a table (the text alternative)
// and a bar chart of the page views, whose numbers are written on the bars, so nothing is said by
// colour alone. ?week=YYYY-MM-DD shows the 12 weeks ending with that day's week; "Earlier" and
// "Later" step by 12 weeks inside the days kept (400). Counts only: no visitor is ever known.
// Professional Sifu (`school_business`); on Free Sifu the page shows the calm upgrade prompt and no
// numbers. Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { SCHOOL_STATS_LOAD_ERROR } from '@/components/account/load-errors/trial-lessons';
import { PageRedirect } from '@/components/account/page-redirect';
import { UPGRADE_CLOSED_PARAM, UPGRADE_OPEN_PARAM } from '@/components/plans/form-ids';
import { UpgradePrompt } from '@/components/plans/upgrade-prompt';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatShortDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { pageReadOne } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { SchoolStatsWeek } from '@/server/services/school-stats';
import { requestPilotAccessAction } from '../../../actions';
import { EditorShell, SchoolNotFound } from '../../parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'School statistics',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNS = [
  ['pageViews', 'Page views'],
  ['pinOpens', 'Map and card opens'],
  ['contactClicks', 'Contact clicks'],
  ['trialInquiries', 'Trial requests'],
] as const;

/** The day `days` after the YYYY-MM-DD `day` (UTC). */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** "3 Nov": a day without its year. */
const dayMonth = (day: string) => formatShortDay(day).replace(/ \d{4}$/, '');

/** "3 Nov – 9 Nov 2026": the Monday and the Sunday of an ISO week. */
function weekLabel(weekStart: string): string {
  return `${dayMonth(weekStart)} – ${formatShortDay(addDays(weekStart, 6))}`;
}

/** The page views by week as bars, each with its number above it; the table says the same. */
function ViewsChart({ weeks }: { weeks: SchoolStatsWeek[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.pageViews));
  const W = 600;
  const H = 180;
  const top = 22;
  const bottom = 26;
  const slot = W / weeks.length;
  const bar = Math.min(32, slot * 0.6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true" focusable="false" data-testid="stats-chart">
      <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} stroke="var(--border-strong)" strokeWidth="1" />
      {weeks.map((w, i) => {
        const height = ((H - top - bottom) * w.pageViews) / max;
        const x = i * slot + (slot - bar) / 2;
        const y = H - bottom - height;
        return (
          <g key={w.weekStart}>
            <rect x={x} y={y} width={bar} height={Math.max(height, w.pageViews > 0 ? 1 : 0)} rx="2" fill="var(--fg)" />
            <text x={x + bar / 2} y={y - 6} textAnchor="middle" fontSize="12" fill="var(--fg)" className="tabular-nums">
              {w.pageViews}
            </text>
            {i % 2 === weeks.length % 2 ? null : (
              <text x={x + bar / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--fg-muted)">
                {dayMonth(w.weekStart)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SchoolStatsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const valid = UUID.test(id);
  const page = `/dashboard/schools/${valid ? id : ''}`;
  const statsPage = `${page}/stats`;
  const guard = await guardRoute(valid ? statsPage : page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!valid) return <SchoolNotFound />;
  const query = await searchParams;
  const weekOf = typeof query.week === 'string' && DAY.test(query.week) ? query.week : null;
  const { missing, value: view } = await pageReadOne(serverClient(await headers(), guard.principal) .schools.stats({ id, weekOf }));
  if (missing) return <SchoolNotFound />;
  if (!view) return <LoadError {...SCHOOL_STATS_LOAD_ERROR} retryHref={weekOf ? `${statsPage}?week=${weekOf}` : statsPage} />;

  const lead = (
    <>
      Counts only: how often people looked at {view.school.name} on this site. No visitor is known or kept; your own visits, staff and bots are
      not counted.{' '}
      <Link href={page} className="link inline-flex min-h-11 items-center">
        Back to the listing
      </Link>
    </>
  );

  if (!view.available) {
    return (
      <EditorShell title={`Statistics of ${view.school.name}`} lead={lead}>
        <div className="grid gap-4" data-testid="stats-unavailable">
          <p className="text-ui">Weekly statistics are part of Professional Sifu. Your schedule, fees and trial lesson requests work on every plan.</p>
          {view.upgrade ? (
            <UpgradePrompt
              offer={view.upgrade}
              requestAction={requestPilotAccessAction}
              notNowAction={statsPage}
              closedByChoice={query[UPGRADE_CLOSED_PARAM.name] === UPGRADE_CLOSED_PARAM.value}
              expanded={query[UPGRADE_OPEN_PARAM.name] === UPGRADE_OPEN_PARAM.value}
            />
          ) : null}
        </div>
      </EditorShell>
    );
  }

  const weeks = view.weeks;
  const first = weeks[0]?.weekStart;
  const last = view.lastWeekStart;
  const range = first && last ? `${weekLabel(first)} to ${weekLabel(last)}` : '';
  return (
    <EditorShell title={`Statistics of ${view.school.name}`} lead={lead}>
      <section aria-labelledby="stats-weeks" className="grid gap-4" data-testid="school-stats" data-last-week={last ?? ''}>
        <h2 id="stats-weeks" className="font-display text-xl">
          The {weeks.length} weeks from {first ? formatShortDay(first) : ''} to {last ? formatShortDay(addDays(last, 6)) : ''}
        </h2>
        {view.totals ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="stats-totals">
            {COLUMNS.map(([key, label]) => (
              <div key={key} className="rounded-sm border border-border-subtle p-3">
                <dt className="text-sm text-fg-muted">{label}</dt>
                <dd className="font-display text-2xl tabular-nums">{view.totals![key]}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <figure className="grid gap-2">
          <ViewsChart weeks={weeks} />
          <figcaption className="text-sm text-fg-muted">
            Page views by week, {range}; each bar has its number. The table below has every count.
          </figcaption>
        </figure>
        {/* Scrolls sideways on a narrow phone: a region that a keyboard can reach and scroll. */}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Counts by week">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm" data-testid="stats-table">
            <caption className="sr-only">Counts by week, {range}</caption>
            <thead>
              <tr className="border-b border-border-strong text-fg-muted">
                <th scope="col" className="py-2 pr-3 font-normal">
                  Week
                </th>
                {COLUMNS.map(([key, label]) => (
                  <th key={key} scope="col" className="py-2 pr-3 text-right font-normal">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStart} className="border-b border-border-subtle" data-testid="stats-week" data-week={w.weekStart}>
                  <th scope="row" className="py-2 pr-3 font-normal whitespace-nowrap">
                    {weekLabel(w.weekStart)}
                  </th>
                  {COLUMNS.map(([key]) => (
                    <td key={key} className="py-2 pr-3 text-right tabular-nums">
                      {w[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav aria-label="Other weeks" className="flex flex-wrap gap-3">
          {view.earlier && first ? (
            <Link href={`${statsPage}?week=${addDays(first, -1)}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })} data-testid="stats-earlier">
              Earlier weeks
            </Link>
          ) : null}
          {view.later && last ? (
            <Link href={`${statsPage}?week=${addDays(last, 7 * weeks.length)}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })} data-testid="stats-later">
              Later weeks
            </Link>
          ) : null}
        </nav>
        <p className="text-sm text-fg-muted">Weeks start on Monday (UTC). Counts older than 400 days are deleted.</p>
      </section>
    </EditorShell>
  );
}
