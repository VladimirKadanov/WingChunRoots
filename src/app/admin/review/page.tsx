// /admin/review (milestone M10a, In scope 4 and 5; plan §5.6, §6.6, §6.7): the review queue.
// Archivists, moderators and administrators whose session passed the second factor see the open
// cases (review.list), filtered by kind, status and assignee, oldest first; each opens its case
// card (/admin/review/<id>). The archival edit starts here too: a record's address (its slug)
// opens it at /admin/review/records/<slug>. A signed-in account without a staff role sees the
// explicit denied state (plan §5.6); a staff session without the second factor is sent to verify.
//
// The filters are a plain GET form and the state is in the URL, so the page works without
// JavaScript and ships none of its own. Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { reviewLoadError } from '@/app/admin/review/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { AdminPageHeader, AdminViews } from '@/components/admin/table-parts';
import { ChevronDownIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { ReviewList, ReviewListInput } from '@/server/services/review';
import { queueHref, ReviewTable } from './review-table';
import { withStrong } from './text';
import { loadErrorWords } from '@/components/admin/i18n/load-error-words';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('Review queue'), robots: { index: false } };
}

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value.slice(0, 40) : undefined);

const inputClass = 'block min-h-12 w-full rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg';
// The class of SelectField's select (fieldClassName in src/components/account/fields.tsx, a client
// module this page does not load), without the native arrow.
const selectClass = `${inputClass} min-w-0 appearance-none pr-11 hover:border-fg-muted focus-visible:border-fg`;

/** A filter select styled as every select of the app (SelectField): no native arrow, the chevron (screens-11). */
function FilterSelect({ id, label, name, defaultValue, children }: { id: string; label: string; name: string; defaultValue: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <select id={id} name={name} defaultValue={defaultValue} className={selectClass}>
          {children}
        </select>
        <ChevronDownIcon size={20} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-fg-muted" />
      </div>
    </div>
  );
}

function returnPath(query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const key of ['kind', 'group', 'status', 'assigned', 'age', 'sort', 'page'] as const) {
    const value = one(query[key]);
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return search ? `/admin/review?${search}` : '/admin/review';
}

/** The saved views of the queue, with their counts (under the list's status filter, which they keep). */
function queueViews(t: AdminT, list: ReviewList) {
  const f = list.filters;
  const base: Pick<ReviewList, 'filters' | 'page'> = { filters: { ...f, kind: undefined, group: undefined, assigned: 'any', age: 'any', sort: 'oldest' }, page: 1 };
  const plain = !f.kind && f.sort === 'oldest';
  const view = (label: string, count: number, changes: Partial<ReviewList['filters']>, testId?: string) => {
    const next = { ...base, filters: { ...base.filters, ...changes } };
    const current = plain && (f.group ?? null) === (next.filters.group ?? null) && f.assigned === next.filters.assigned && f.age === next.filters.age;
    return { label, count, href: queueHref(next, {}), current, testId };
  };
  return [
    view(f.status === 'waiting' ? t('All waiting') : t('All'), list.counts.all, {}, 'view-all'),
    view(t('Assigned to me'), list.counts.mine, { assigned: 'me' }, 'view-mine'),
    view(t('Nobody assigned'), list.counts.unassigned, { assigned: 'none' }, 'view-unassigned'),
    view(t('Waiting over 3 days'), list.counts.late, { age: '3d' }, 'view-late'),
    ...list.counts.groups.map((g) => view(t(g.label), g.count, { group: g.value })),
  ];
}

/** "12 waiting", "3 open", with {n} left for the number (withStrong). */
function statusCountText(t: AdminT, list: ReviewList): string {
  switch (list.filters.status) {
    case 'waiting':
      return t('{n} waiting');
    case 'all':
      return t('{n} in all');
    case 'open':
      return t('{n} open');
    case 'in_review':
      return t('{n} in review');
    case 'needs_info':
      return t('{n} needs information');
    case 'resolved':
      return t('{n} decided');
    case 'dismissed':
      return t('{n} closed');
    default:
      return `{n} ${list.statuses.find((x) => x.value === list.filters.status)?.label.toLowerCase() ?? ''}`;
  }
}

export default async function ReviewQueuePage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const guard = await guardRoute('/admin/review', returnPath(query));
  const t = await getAdminT();
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <div className="max-w-[46rem]" data-testid="review-denied">
          <p className="eyebrow">{t('Administration')}</p>
          <h1 className="mt-2 font-display text-feature">{t('Not available')}</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted">
            {t("You don't have access to the review queue. It is available to archivists, moderators and administrators.")}
          </p>
          <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
            <Link href="/account" className="link inline-flex min-h-11 items-center">
              {t('Back to your account')}
            </Link>
          </p>
        </div>
      </div>
    );
  }
  // An unknown or malformed parameter falls back to its default in the service (review.list).
  const input = {
    kind: one(query.kind) || undefined,
    group: one(query.group) || undefined,
    age: one(query.age) || undefined,
    status: one(query.status) || undefined,
    assigned: one(query.assigned) || undefined,
    sort: one(query.sort) || undefined,
    page: one(query.page) || undefined,
  } as ReviewListInput;
  const client = serverClient(await headers(), guard.principal);
  const list = await pageRead(client.review.list(input).catch(() => client.review.list({})));
  if (!list) return <LoadError words={loadErrorWords(t)} {...reviewLoadError(t)} retryHref={returnPath(query)} />;
  const archivist = guard.principal?.user.role === 'archivist';

  const { counts } = list;
  const statusCount = statusCountText(t, list);

  return (
    <div className="mx-auto max-w-[96rem] px-page pt-6 pb-10 md:pt-8 md:pb-14">
      <AdminPageHeader
        eyebrow={
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            {t('Control panel')}
          </Link>
        }
        title={t('Review queue')}
        summary={
          <span data-testid="queue-summary">
            {withStrong(statusCount, counts.all)} · {withStrong(t('{n} assigned to you'), counts.mine)} · {withStrong(t('{n} with nobody'), counts.unassigned)} ·{' '}
            {counts.late > 0 ? (
              <span className="font-semibold text-danger">
                <span aria-hidden="true">! </span>
                {t('{n} over 3 days', { n: counts.late })}
              </span>
            ) : (
              t('none over 3 days')
            )}
          </span>
        }
        intro={
          <span data-testid="queue-intro">
            {t(
              'Cases that wait for a decision, oldest first. An archivist or an administrator decides historical teacher claims, profile claims and instructor verifications; a moderator or an administrator decides profile reports and disputes. Take a case to open it. Every decision is kept in the audit log.',
            )}
          </span>
        }
      />

      <div className="mt-6 grid gap-6 2xl:grid-cols-[14rem_minmax(0,1fr)] 2xl:gap-8">
        <AdminViews label={t('Saved views of the queue')} views={queueViews(t, list)} />

        <div className="grid min-w-0 content-start gap-5">
          <form method="get" action="/admin/review" role="search" aria-label={t('Filter the queue')} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] items-end gap-3" data-testid="queue-filters">
            <FilterSelect id="filter-group" name="group" label={t('Group')} defaultValue={list.filters.group ?? ''}>
              <option value="">{t('Every group')}</option>
              {counts.groups.map((g) => (
                <option key={g.value} value={g.value}>
                  {t(g.label)} ({g.count})
                </option>
              ))}
            </FilterSelect>
            <FilterSelect id="filter-kind" name="kind" label={t('Kind')} defaultValue={list.filters.kind ?? ''}>
              <option value="">{t('Any kind')}</option>
              {list.kinds.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {t(kind.label)} ({counts.kinds[kind.value] ?? 0})
                </option>
              ))}
            </FilterSelect>
            <FilterSelect id="filter-status" name="status" label={t('Status')} defaultValue={list.filters.status}>
              {list.statuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {t(status.label)}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect id="filter-assigned" name="assigned" label={t('Assigned to')} defaultValue={list.filters.assigned}>
              <option value="any">{t('Anyone')}</option>
              <option value="me">{t('Me')}</option>
              <option value="none">{t('Nobody yet')}</option>
            </FilterSelect>
            <FilterSelect id="filter-age" name="age" label={t('Waiting')} defaultValue={list.filters.age}>
              <option value="any">{t('Any time')}</option>
              <option value="1d">{t('Over 1 day')}</option>
              <option value="3d">{t('Over 3 days')}</option>
              <option value="7d">{t('Over a week')}</option>
            </FilterSelect>
            {list.filters.sort !== 'oldest' ? <input type="hidden" name="sort" value={list.filters.sort} /> : null}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                {t('Show cases')}
              </button>
              {returnPath(query) !== '/admin/review' ? (
                <Link href="/admin/review" className="link inline-flex min-h-12 items-center text-ui">
                  {t('Clear')}
                </Link>
              ) : null}
            </div>
          </form>

          <ReviewTable list={list} t={t} />
        </div>
      </div>

      <div className="mt-10 grid max-w-[60rem] gap-10">
        <section aria-labelledby="archive-heading" className="grid gap-3 border-t border-border-subtle pt-6">
          <h2 id="archive-heading" className="font-display text-2xl">
            {t('Archival records')}
          </h2>
          <p className="max-w-[60ch] text-ui text-fg-muted">
            {archivist
              ? t('Correct a record kept by the platform or unclaimed, with a reason and optional evidence. Enter the record’s address: the part after /people/.')
              : t('Archivists correct records kept by the platform or unclaimed. You can open a record to read it.')}
          </p>
          <form method="get" action="/admin/review/records" className="grid gap-3 sm:max-w-[34rem]" data-testid="record-lookup">
            <label htmlFor="record-slug" className="text-sm font-semibold">
              {t('Record address')}
            </label>
            <input id="record-slug" name="slug" autoComplete="off" maxLength={120} pattern="[a-z0-9\-]+" className={inputClass} />
            <div>
              <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
                {t('Open the record')}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
