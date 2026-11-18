// /admin/billing (milestone M22; docs/adr/0025-billing.md): the subscriptions in test mode, newest
// first, for administrators with a verified second factor (billing.adminList; read-only). A filter
// by status (links, so it works without JavaScript), each status in words with a shape, never
// colour alone, and the provider events the app could not tie to a subscription. Reads the
// session, so it renders per request.
//
// Control panel (docs/adr/0038-control-panel-pages.md): the figures first (monthly value of the live
// subscriptions at the proposed prices, paid plans, failed payments, plans ending), the value by
// plan, then a table filtered by status, plan and holder, with a failed payment marked in words, a
// shape and a bar, never colour alone.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { ADMIN_BILLING_LOAD_ERROR } from '@/components/account/load-errors/admin-billing';
import { PageRedirect } from '@/components/account/page-redirect';
import { adminFieldClass, EmptyState, Pager, RangeLine, table as t } from '@/components/admin/table-parts';
import { SubscriptionStatusTag, TestModeBanner } from '@/components/billing/status';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay, formatShortDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { TEST_MODE_LABEL } from '@/server/entitlements/plans';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { BILLING_ADMIN_PAGE_SIZE, billingAdminListInput } from '@/server/services/billing';

export const instant = false;

export const metadata: Metadata = {
  title: 'Subscriptions',
  robots: { index: false },
};

const PAGE = '/admin/billing';
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'past_due', label: 'Payment failed' },
  { value: 'canceled', label: 'Ended' },
] as const;
type Filter = (typeof FILTERS)[number]['value'];
const PLAN_OPTIONS = [
  { value: 'premium_student', label: 'Premium Student' },
  { value: 'pro_sifu', label: 'Professional Sifu' },
  { value: 'federation', label: 'Federation' },
] as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

const usd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

function billingHref(state: { status: Filter; plan: string | null; q: string | null }, page = 1): string {
  const params = new URLSearchParams();
  if (state.status !== 'all') params.set('status', state.status);
  if (state.plan) params.set('plan', state.plan);
  if (state.q) params.set('q', state.q);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return search ? `${PAGE}?${search}` : PAGE;
}

function Tile({ label, value, note, href, alert = false, testId }: { label: string; value: string; note: ReactNode; href?: string; alert?: boolean; testId?: string }) {
  const body = (
    <>
      <span className="text-sm text-fg-muted">{label}</span>
      <span className={cx('font-display text-2xl leading-none tabular', alert && 'text-danger')}>
        {alert ? <span aria-hidden="true">! </span> : null}
        {value}
      </span>
      <span className="text-sm text-fg-muted">{note}</span>
    </>
  );
  const box = cx('grid min-w-0 content-start gap-1.5 rounded-md border bg-surface-1 p-4', alert ? 'border-2 border-dashed border-danger' : 'border-border-subtle');
  return href ? (
    <Link href={href} className={cx(box, 'hover:border-border-strong')} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={box} data-testid={testId}>
      {body}
    </div>
  );
}

export default async function AdminBillingPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const asked = one(query.status) ?? 'all';
  const filter: Filter = FILTERS.some((f) => f.value === asked) ? (asked as Filter) : 'all';
  const field = billingAdminListInput.shape;
  const valid = <T,>(r: { success: true; data: T } | { success: false }) => (r.success ? r.data : undefined);
  const plan = valid(field.plan.safeParse(one(query.plan) || undefined)) ?? null;
  const q = valid(field.q.safeParse(one(query.q)?.slice(0, 200) || undefined)) || null;
  const page = valid(field.page.safeParse(one(query.page))) ?? 1;
  const state = { status: filter, plan, q };
  const here = billingHref(state, page);
  const guard = await guardRoute(PAGE, here);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  const view = await pageRead(
    serverClient(await headers(), guard.principal).billing.adminList({ ...(filter === 'all' ? {} : { status: filter }), ...(plan ? { plan } : {}), ...(q ? { q } : {}), page }),
  );
  if (!view) return <LoadError {...ADMIN_BILLING_LOAD_ERROR} retryHref={PAGE} />;
  const { summary } = view;
  const counts: Record<Filter, number> = {
    all: Object.values(summary.byStatus).reduce((a, b) => a + b, 0),
    active: summary.byStatus.active,
    past_due: summary.byStatus.past_due,
    canceled: summary.byStatus.canceled,
  };
  const filtered = filter !== 'all' || plan !== null || q !== null;

  return (
    <div className="mx-auto max-w-[96rem] px-page pt-6 pb-10 md:pt-8 md:pb-14">
      <header className="grid gap-2">
        <p className="eyebrow">
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Control panel
          </Link>
        </p>
        <h1 className="font-display text-feature">Subscriptions</h1>
      </header>
      <div className="mt-4 max-w-[60rem]">
        <TestModeBanner label={TEST_MODE_LABEL}>Read-only. Each subscription shows its provider events in the order they happened.</TestModeBanner>
      </div>

      <section aria-labelledby="billing-figures" className="mt-6 grid gap-4">
        <h2 id="billing-figures" className="sr-only">
          Figures
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3" data-testid="admin-billing-figures">
          <Tile label="Monthly recurring value" value={usd.format(summary.monthlyCents / 100)} note="live subscriptions at the proposed prices, a yearly plan a twelfth" />
          <Tile label="Paid plans" value={String(summary.live)} note="active or with a failed payment" />
          <Tile
            label="Failed payments"
            value={String(summary.pastDue)}
            note={summary.pastDue > 0 ? 'in the grace period: show them' : 'none now'}
            href={summary.pastDue > 0 ? billingHref({ status: 'past_due', plan: null, q: null }) : undefined}
            alert={summary.pastDue > 0}
            testId="admin-billing-past-due"
          />
          <Tile label="Ending at the period end" value={String(summary.ending)} note="cancelled, access runs to the end" />
        </div>
        {summary.byPlan.length > 0 ? (
          <div className="@container max-w-[44rem]">
            <table role="table" className={t.table} data-testid="admin-billing-by-plan">
              <caption className="mb-1 text-left text-sm font-semibold">By plan, live subscriptions</caption>
              <thead role="rowgroup" className={t.thead}>
                <tr role="row" className={t.headRow}>
                  <th role="columnheader" scope="col" className={t.th}>Plan</th>
                  <th role="columnheader" scope="col" className={cx(t.th, 'text-right')}>Live</th>
                  <th role="columnheader" scope="col" className={cx(t.th, 'text-right')}>Monthly value</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={t.tbody}>
                {summary.byPlan.map((row) => (
                  <tr role="row" key={row.code} className={t.row}>
                    <td role="cell" className={t.td}>
                      <Link href={billingHref({ status: 'all', plan: row.code, q: null })} className="link inline-flex min-h-11 items-center @min-[52rem]:-my-2.5">
                        {row.name}
                      </Link>
                    </td>
                    <td role="cell" className={cx(t.td, 'tabular @min-[52rem]:text-right')}>
                      <span className={t.cardLabel}>Live</span>
                      {row.live}
                    </td>
                    <td role="cell" className={cx(t.td, 'tabular @min-[52rem]:text-right')}>
                      <span className={t.cardLabel}>Monthly value</span>
                      {usd.format(row.monthlyCents / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm text-fg-muted">The prices are the proposed ones, not final. A plan given as a grant costs nothing and is not counted here.</p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="billing-list" className="mt-10 grid gap-4">
        <h2 id="billing-list" className="font-display text-2xl">
          All subscriptions
        </h2>
        <nav aria-label="Filter by status">
          <ul className="flex flex-wrap gap-2" data-testid="admin-billing-filter">
            {FILTERS.map((f) => (
              <li key={f.value}>
                <Link
                  href={billingHref({ ...state, status: f.value })}
                  aria-current={f.value === filter ? 'page' : undefined}
                  className={cx(
                    'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm border px-3 text-sm',
                    f.value === filter ? 'border-2 border-fg px-[11px] font-semibold' : 'border-border-strong text-fg-muted hover:border-fg-muted hover:text-fg',
                  )}
                >
                  {f.value === filter ? <span aria-hidden="true" className="size-1.5 rounded-full bg-fg" /> : null}
                  {f.label}
                  <span aria-hidden="true">·</span>
                  <span>{counts[f.value]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <form role="search" action={PAGE} method="get" className="flex flex-wrap items-end gap-3" data-testid="admin-billing-search">
          {filter !== 'all' ? <input type="hidden" name="status" value={filter} /> : null}
          <div className="grid min-w-0 flex-1 basis-[16rem] gap-1.5 sm:max-w-[26rem]">
            <label htmlFor="billing-q" className="text-sm font-semibold">
              Account address or organization
            </label>
            <input id="billing-q" name="q" type="search" defaultValue={q ?? ''} maxLength={200} autoComplete="off" spellCheck={false} translate="no" className={adminFieldClass} />
          </div>
          <div className="grid min-w-0 basis-[12rem] gap-1.5">
            <label htmlFor="billing-plan" className="text-sm font-semibold">
              Plan
            </label>
            <select id="billing-plan" name="plan" defaultValue={plan ?? ''} className={adminFieldClass}>
              <option value="">Every plan</option>
              {PLAN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Show
          </button>
          {filtered ? (
            <Link href={PAGE} className="link inline-flex min-h-12 items-center text-ui">
              Clear
            </Link>
          ) : null}
        </form>

        <RangeLine noun="Subscriptions" total={view.total} page={view.page} pageSize={BILLING_ADMIN_PAGE_SIZE} testId="admin-billing-count" extra={<span>newest first</span>} />
        {view.rows.length === 0 ? (
          <EmptyState testId="admin-billing-empty">
            No subscription{filtered ? ' matches these filters. Change them, or clear them.' : ' yet. Paid plans appear here once a member starts one in test mode.'}
          </EmptyState>
        ) : (
          <div className="@container">
            <table role="table" data-testid="admin-billing" className={t.table}>
              <caption className="sr-only">Subscriptions in test mode, newest first</caption>
              <thead role="rowgroup" className={t.thead}>
                <tr role="row" className={t.headRow}>
                  <th role="columnheader" scope="col" className={t.th}>Subscription</th>
                  <th role="columnheader" scope="col" className={t.th}>State</th>
                  <th role="columnheader" scope="col" className={t.th}>Started</th>
                  <th role="columnheader" scope="col" className={t.th}>Access until</th>
                  <th role="columnheader" scope="col" className={t.th}>Provider</th>
                  <th role="columnheader" scope="col" className={cx(t.th, 'text-right')}>Events</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={t.tbody}>
                {view.rows.map((row) => {
                  const pastDue = row.status === 'past_due';
                  return (
                    <tr
                      role="row"
                      key={row.id}
                      className={cx(t.row, pastDue && 'bg-surface-2 [&>td:first-child]:border-l-4 [&>td:first-child]:border-l-danger [&>td:first-child]:pl-3 @max-[52rem]:border-l-4 @max-[52rem]:border-l-danger')}
                      data-testid="admin-subscription"
                      data-status={row.status}
                    >
                      <td role="cell" className={t.td}>
                        <Link href={`${PAGE}/${row.id}`} className="link grid min-h-11 content-center [overflow-wrap:anywhere] @min-[52rem]:-my-1">
                          <span className="font-semibold">
                            {row.planName}
                            <span className="sr-only"> · </span>
                          </span>
                          <span className="text-sm" translate="no">
                            {row.holder}
                          </span>
                        </Link>
                      </td>
                      <td role="cell" className={t.td}>
                        <span className={t.cardLabel}>State</span>
                        <span className="grid justify-items-start gap-1">
                          <SubscriptionStatusTag status={row.status} cancelAtPeriodEnd={row.cancelAtPeriodEnd} label={row.statusLabel} />
                          {pastDue ? (
                            <span className="text-sm font-semibold text-danger" data-testid="admin-subscription-attention">
                              <span aria-hidden="true">! </span>Needs a look
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td role="cell" className={cx(t.td, 'whitespace-nowrap')} data-visual-date="">
                        <span className={t.cardLabel}>Started</span>
                        <time dateTime={row.createdAt} title={formatDay(row.createdAt)}>
                          {formatShortDay(row.createdAt)}
                        </time>
                      </td>
                      <td role="cell" className={cx(t.td, 'whitespace-nowrap')} data-visual-date="">
                        <span className={t.cardLabel}>Access until</span>
                        {row.accessUntil ? (
                          <time dateTime={row.accessUntil} title={formatDay(row.accessUntil)}>
                            {formatShortDay(row.accessUntil)}
                          </time>
                        ) : (
                          <span className="text-fg-muted">—</span>
                        )}
                      </td>
                      <td role="cell" className={t.td}>
                        <span className={t.cardLabel}>Provider</span>
                        {row.provider === 'test' ? 'Test provider' : 'Stripe test mode'}
                      </td>
                      <td role="cell" className={cx(t.td, 'tabular @min-[52rem]:text-right')}>
                        <span className={t.cardLabel}>Events</span>
                        {row.events}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager label="Pages of subscriptions" page={view.page} pages={view.pages} href={(p) => billingHref(state, p)} />
      </section>

      {view.unmatched.length > 0 ? (
        <section aria-labelledby="unmatched-heading" className="mt-10 grid max-w-[60rem] gap-3">
          <h2 id="unmatched-heading" className="font-display text-2xl">
            Events not tied to a subscription
          </h2>
          <p className="max-w-[60ch] text-sm text-fg-muted">
            Signed events the app recorded but did not apply: an unknown subscription, one that names another account, or a second live subscription.
          </p>
          <ul className="grid" data-testid="admin-billing-unmatched">
            {view.unmatched.map((e) => (
              <li key={e.id} className="border-b border-border-subtle py-2 text-sm">
                <span className="font-semibold">{e.providerType}</span> · {e.outcome} ·{' '}
                <span className="text-fg-muted" data-visual-date="">
                  {formatDay(e.receivedAt)}
                </span>{' '}
                <span className="text-fg-muted [overflow-wrap:anywhere]" translate="no">
                  {e.providerEventId}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
