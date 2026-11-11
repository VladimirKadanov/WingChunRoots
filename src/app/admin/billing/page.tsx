// /admin/billing (milestone M22; docs/adr/0025-billing.md): the subscriptions in test mode, newest
// first, for administrators with a verified second factor (billing.adminList; read-only). A filter
// by status (links, so it works without JavaScript), each status in words with a shape, never
// colour alone, and the provider events the app could not tie to a subscription. Reads the
// session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { ADMIN_BILLING_LOAD_ERROR } from '@/components/account/load-errors/admin-billing';
import { PageRedirect } from '@/components/account/page-redirect';
import { SubscriptionStatusTag, TestModeBanner } from '@/components/billing/status';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { TEST_MODE_LABEL } from '@/server/entitlements/plans';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

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

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminBillingPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const asked = typeof query.status === 'string' ? query.status : 'all';
  const filter: Filter = FILTERS.some((f) => f.value === asked) ? (asked as Filter) : 'all';
  const page = typeof query.page === 'string' && /^\d{1,5}$/.test(query.page) ? Math.max(1, Number(query.page)) : 1;
  const here = filter === 'all' ? PAGE : `${PAGE}?status=${filter}`;
  const guard = await guardRoute(PAGE, here);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  const view = await pageRead(serverClient(await headers(), guard.principal).billing.adminList({ ...(filter === 'all' ? {} : { status: filter }), page }));
  if (!view) return <LoadError {...ADMIN_BILLING_LOAD_ERROR} retryHref={PAGE} />;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow">
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            Administration
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Subscriptions</h1>
        <div className="mt-4">
          <TestModeBanner label={TEST_MODE_LABEL}>Read-only. Each subscription shows its provider events in the order they happened.</TestModeBanner>
        </div>

        <nav aria-label="Filter by status" className="mt-6">
          <ul className="flex flex-wrap gap-2" data-testid="admin-billing-filter">
            {FILTERS.map((f) => (
              <li key={f.value}>
                <Link
                  href={f.value === 'all' ? PAGE : `${PAGE}?status=${f.value}`}
                  aria-current={f.value === filter ? 'page' : undefined}
                  className={cx(
                    'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm border px-3 text-sm',
                    f.value === filter ? 'border-2 border-fg px-[11px] font-semibold' : 'border-border-strong text-fg-muted hover:border-fg-muted hover:text-fg',
                  )}
                >
                  {f.value === filter ? <span aria-hidden="true" className="size-1.5 rounded-full bg-fg" /> : null}
                  {f.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {view.rows.length === 0 ? (
          <p className="mt-8 text-fg-muted" data-testid="admin-billing-empty">
            No subscription{filter === 'all' ? '' : ' with this status'}.
          </p>
        ) : (
          <ul className="mt-6 grid" data-testid="admin-billing">
            {view.rows.map((row) => (
              <li key={row.id} className="grid gap-1 border-b border-border-subtle py-4" data-testid="admin-subscription">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href={`${PAGE}/${row.id}`} className="link inline-flex min-h-11 items-center font-display text-lg [overflow-wrap:anywhere]">
                    {row.planName} · {row.holder}
                  </Link>
                  <SubscriptionStatusTag status={row.status} cancelAtPeriodEnd={row.cancelAtPeriodEnd} label={row.statusLabel} />
                </p>
                <p className="text-sm text-fg-muted" data-visual-date="">
                  {row.provider === 'test' ? 'Test provider' : 'Stripe test mode'} · started {formatDay(row.createdAt)}
                  {row.accessUntil ? ` · access until ${formatDay(row.accessUntil)}` : ''} · {row.events} event{row.events === 1 ? '' : 's'}
                </p>
              </li>
            ))}
          </ul>
        )}
        {view.pages > 1 ? (
          <nav aria-label="Pages" className="mt-4 flex gap-4 text-ui">
            {view.page > 1 ? (
              <Link href={`${here}${here.includes('?') ? '&' : '?'}page=${view.page - 1}`} className="link inline-flex min-h-11 items-center">
                Newer
              </Link>
            ) : null}
            <span className="inline-flex min-h-11 items-center text-fg-muted">
              Page {view.page} of {view.pages}
            </span>
            {view.page < view.pages ? (
              <Link href={`${here}${here.includes('?') ? '&' : '?'}page=${view.page + 1}`} className="link inline-flex min-h-11 items-center">
                Older
              </Link>
            ) : null}
          </nav>
        ) : null}

        {view.unmatched.length > 0 ? (
          <section aria-labelledby="unmatched-heading" className="mt-10 grid gap-3">
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
    </div>
  );
}
