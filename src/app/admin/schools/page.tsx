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
import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { adminFieldClass, AdminPageHeader, EmptyState, Pager, RangeLine, table as tbl } from '@/components/admin/table-parts';
import { ActivityState } from '@/components/schools/activity-state';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('School activity'), robots: { index: false } };
}

const PAGE = '/admin/schools';
const STAGES = [{ value: 'all' }, { value: 'current' }, { value: 'awaiting_confirmation' }, { value: 'hidden' }] as const;
type StageFilter = (typeof STAGES)[number]['value'];

function stageLabel(t: AdminT, stage: StageFilter): string {
  switch (stage) {
    case 'all': return t('All listed');
    case 'current': return t('Current');
    case 'awaiting_confirmation': return t('Awaiting confirmation');
    case 'hidden': return t('Hidden from the map');
  }
}

/** The empty state of a stage view, in words (the stage's name lower-cased in English, as before). */
function emptyStage(t: AdminT, stage: Exclude<StageFilter, 'all'>): string {
  switch (stage) {
    case 'current': return t('No listed school is in this stage: current.');
    case 'awaiting_confirmation': return t('No listed school is in this stage: awaiting confirmation.');
    case 'hidden': return t('No listed school is in this stage: hidden from the map.');
  }
}

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
  const t = await getAdminT();
  const asked = typeof query.stage === 'string' ? query.stage : 'all';
  const stage: StageFilter = STAGES.some((s) => s.value === asked) ? (asked as StageFilter) : 'all';
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 120) : '';
  const pageAsked = typeof query.page === 'string' && /^[1-9][0-9]{0,3}$/.test(query.page) ? Number(query.page) : 1;
  const here = schoolsHref(stage, q || null, pageAsked);
  const guard = await guardRoute(PAGE, here);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  const view = await pageRead(serverClient(await headers(), guard.principal).schools.adminList({ stage, q: q || undefined, page: pageAsked }));
  if (!view) return <LoadError
        eyebrow={t('Administration')}
        title={t('School activity')}
        message={t("We couldn't load the schools. Nothing was changed.")}
        back={{ href: ADMIN_SCHOOLS_LOAD_ERROR.back.href, label: t('Back to administration') }}
        retryHref={here} />;
  const total = view.counts.current + view.counts.awaiting_confirmation + view.counts.hidden;
  const count = (value: StageFilter) => (value === 'all' ? total : view.counts[value]);
  const pages = Math.max(1, Math.ceil(view.total / view.pageSize));

  return (
    <div className="mx-auto max-w-[96rem] px-page pt-6 pb-10 md:pt-8 md:pb-14">
      <AdminPageHeader
        eyebrow={
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            {t('Control panel')}
          </Link>
        }
        title={t('School activity')}
        summary={
          <span>
            <strong>{total}</strong> {t('listed')} · <strong>{view.counts.awaiting_confirmation}</strong> {t('awaiting confirmation')} · <strong>{view.counts.hidden}</strong> {t('hidden from the map')}
          </span>
        }
        intro={
          <>
            {t('A listed school whose Sifu has not edited or confirmed it for 90 days awaits confirmation: the Sifu is asked, and the school stays on the map. From day 105 it is hidden from the public map and list until the Sifu confirms it. Nothing is deleted, and signing in does not count. New listings are decided in the')}{' '}
            <Link href="/admin/review?group=schools" className="link">
              {t('review queue')}
            </Link>
            .
          </>
        }
      />

      <nav aria-label={t('Filter by stage')} className="mt-6">
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
                {stageLabel(t, s.value)}
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
            {t('School, city or address')}
          </label>
          <input id="schools-q" name="q" type="search" defaultValue={q} maxLength={120} autoComplete="off" spellCheck={false} className={adminFieldClass} />
        </div>
        <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
          {t('Search')}
        </button>
        {q ? (
          <Link href={schoolsHref(stage, null)} className="link inline-flex min-h-12 items-center text-ui">
            {t('Clear')}
          </Link>
        ) : null}
      </form>

      <div className="mt-5 grid gap-4">
        <RangeLine noun="Schools" total={view.total} page={view.page} pageSize={view.pageSize} testId="admin-schools-count" extra={<span>{t('hidden first, then awaiting, the longest without activity first')}</span>} />
        {view.schools.length === 0 ? (
          <EmptyState testId="admin-schools-empty">
            {q
              ? stage === 'all'
                ? t('No listed school matches “{q}”. Check the spelling, or clear the search.', { q })
                : t('No listed school matches “{q}” in this stage. Check the spelling, or clear the search.', { q })
              : stage === 'all'
                ? t('No school is listed.')
                : emptyStage(t, stage)}
          </EmptyState>
        ) : (
          <div className="@container">
            <table role="table" data-testid="admin-schools" className={tbl.table}>
              <caption className="sr-only">{t('Listed schools, hidden first, then awaiting confirmation, the longest without activity first')}</caption>
              <thead role="rowgroup" className={tbl.thead}>
                <tr role="row" className={tbl.headRow}>
                  <th role="columnheader" scope="col" className={tbl.th}>{t('School')}</th>
                  <th role="columnheader" scope="col" className={tbl.th}>{t('Activity')}</th>
                  <th role="columnheader" scope="col" className={tbl.th}>{t('Last edit or confirmation')}</th>
                  <th role="columnheader" scope="col" className={tbl.th}>{t('Public map')}</th>
                  <th role="columnheader" scope="col" className={tbl.th}>{t('Listed by')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={tbl.tbody}>
                {view.schools.map((school) => (
                  <tr role="row" key={school.id} className={tbl.row} data-testid="admin-school" data-activity={school.activity.stage} data-slug={school.slug}>
                    <td role="cell" className={tbl.td}>
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
                    <td role="cell" className={tbl.td}>
                      <span className={tbl.cardLabel}>{t('Activity')}</span>
                      <span className="text-sm">
                        <ActivityState stage={school.activity.stage} testId="admin-school-activity">
                          {school.activity.stage === 'hidden' && school.activity.hiddenAt
                            ? t('Hidden from the map since {since} (asked on {asked})', { since: t.day(school.activity.hiddenAt), asked: t.day(school.activity.awaitingSince ?? school.activity.hiddenAt) })
                            : school.activity.stage === 'awaiting_confirmation' && school.activity.awaitingSince
                              ? t('Awaiting confirmation since {since}; hidden from about {from} without it', { since: t.day(school.activity.awaitingSince), from: t.day(school.activity.hiddenFrom ?? school.activity.awaitingSince) })
                              : t('Current')}
                        </ActivityState>
                      </span>
                    </td>
                    <td role="cell" className={cx(tbl.td, 'whitespace-nowrap')}>
                      <span className={tbl.cardLabel}>{t('Last edit or confirmation')}</span>
                      <time dateTime={school.activity.lastActivityAt} title={t.day(school.activity.lastActivityAt)}>
                        {t.shortDay(school.activity.lastActivityAt)}
                      </time>
                    </td>
                    <td role="cell" className={tbl.td}>
                      <span className={tbl.cardLabel}>{t('Public map')}</span>
                      <span className={school.public ? undefined : 'text-fg-muted'}>{school.public ? t('On the public map') : t('Not on the public map')}</span>
                    </td>
                    <td role="cell" className={tbl.td}>
                      <span className={tbl.cardLabel}>{t('Listed by')}</span>
                      {school.listedByAccount ? t('A Sifu') : <span className="text-fg-muted">{t('A record of the platform, not checked')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager label={t('Pages of schools')} page={view.page} pages={pages} href={(page) => schoolsHref(stage, q || null, page)} />
      </div>
    </div>
  );
}
