// /admin/billing/[id] (milestone M22; docs/adr/0025-billing.md): one subscription in test mode for
// administrators with a verified second factor (billing.adminGet; read-only): its state, its
// invoices, and its provider events in the order they happened, each with its outcome (applied,
// stale, a repeat…). Never card data: the events carry ids, types and times only. With the test
// provider, the test clock moves the subscription to the end of its period or of its grace period
// (billing.testClock). Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { LoadError } from '@/components/account/load-error';
import { ADMIN_BILLING_LOAD_ERROR } from '@/components/account/load-errors/admin-billing';
import { PageRedirect } from '@/components/account/page-redirect';
import { SubscriptionStatusTag, TestModeBanner } from '@/components/billing/status';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { TEST_MODE_LABEL } from '@/server/entitlements/plans';
import { readFormResult } from '@/server/forms/flash';
import { pageReadOne } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { TEST_CLOCK_FORM } from './form-ids';
import { TestClockForm } from './forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Subscription',
  robots: { index: false },
};

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const OUTCOMES: Record<string, string> = {
  pending: 'Waiting for the worker',
  applied: 'Applied',
  stale: 'Older than the stored state: not applied',
  unknown: 'Unknown subscription',
  mismatch: 'Names another account: not applied',
  ignored: 'Not used',
  conflict: 'A second live subscription: not applied',
};

const timeOf = (iso: string) => `${formatDay(iso)}, ${iso.slice(11, 19)} UTC`;

export default async function AdminSubscriptionPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const page = `/admin/billing/${encodeURIComponent(id)}`;
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  const read = await pageReadOne(serverClient(await headers(), guard.principal).billing.adminGet({ subscriptionId: id }));
  if (read.missing) notFound();
  const view = read.value;
  if (!view) return <LoadError {...ADMIN_BILLING_LOAD_ERROR} retryHref={page} />;
  const query = await searchParams;
  const initial = await readFormResult(TEST_CLOCK_FORM, typeof query.outcome === 'string' ? query.outcome : '');
  const sub = view.subscription;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow">
          <Link href="/admin/billing" className="link inline-flex min-h-11 items-center">
            Subscriptions
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">
          {sub.planName} · {sub.holder}
        </h1>
        <div className="mt-4">
          <TestModeBanner label={TEST_MODE_LABEL} />
        </div>

        <section aria-labelledby="state-heading" className="mt-8 grid gap-3">
          <h2 id="state-heading" className="font-display text-2xl">
            State
          </h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <SubscriptionStatusTag status={sub.status} cancelAtPeriodEnd={sub.cancelAtPeriodEnd} label={sub.statusLabel} />
            <span className="text-ui" data-visual-date="">
              {sub.summary}
            </span>
          </p>
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
            <dt className="text-fg-muted">Provider</dt>
            <dd>{sub.provider === 'test' ? 'Test provider' : 'Stripe test mode'}</dd>
            <dt className="text-fg-muted">Provider subscription</dt>
            <dd className="[overflow-wrap:anywhere]" translate="no">
              {sub.providerSubscriptionId}
            </dd>
            <dt className="text-fg-muted">Version applied</dt>
            <dd className="tabular">{sub.providerVersion}</dd>
            <dt className="text-fg-muted">Price</dt>
            <dd>{sub.price} (proposed)</dd>
            <dt className="text-fg-muted">Current period</dt>
            <dd data-visual-date="">
              {formatDay(sub.currentPeriodStart)} to {formatDay(sub.currentPeriodEnd)}
            </dd>
            <dt className="text-fg-muted">Access until</dt>
            <dd data-visual-date="">{sub.accessUntil ? formatDay(sub.accessUntil) : '—'}</dd>
          </dl>
        </section>

        {view.testClock.available ? (
          <section aria-labelledby="clock-heading" className="mt-10 grid gap-3">
            <h2 id="clock-heading" className="font-display text-2xl">
              Test clock
            </h2>
            <p className="max-w-[60ch] text-sm text-fg-muted">
              Moves this subscription on the test provider as if time had passed: a renewal (paid, or failed with the card that fails at renewal),
              the end of a cancelled subscription, or the end of the grace period. Audited.
            </p>
            <TestClockForm subscriptionId={sub.id} steps={view.testClock.steps} initial={initial} />
          </section>
        ) : null}

        <section aria-labelledby="events-heading" className="mt-10 grid gap-3">
          <h2 id="events-heading" className="font-display text-2xl">
            Provider events
          </h2>
          {view.events.length === 0 ? (
            <p className="text-fg-muted">No events yet.</p>
          ) : (
            <ol className="grid" data-testid="admin-billing-events">
              {view.events.map((e) => (
                <li key={e.id} className="grid gap-0.5 border-b border-border-subtle py-2 text-sm" data-outcome={e.outcome}>
                  <p>
                    <span className="font-semibold">{e.providerType}</span> · {OUTCOMES[e.outcome] ?? e.outcome}
                  </p>
                  <p className="text-fg-muted">
                    <span data-visual-date="">{timeOf(e.providerCreatedAt)}</span> ·{' '}
                    <span className="[overflow-wrap:anywhere]" translate="no">
                      {e.providerEventId}
                    </span>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="invoices-heading" className="mt-10 grid gap-3">
          <h2 id="invoices-heading" className="font-display text-2xl">
            Invoices
          </h2>
          {sub.invoices.length === 0 ? (
            <p className="text-fg-muted">No invoices.</p>
          ) : (
            <ul className="grid">
              {sub.invoices.map((invoice) => (
                <li key={invoice.id} className="border-b border-border-subtle py-2 text-sm">
                  {invoice.amount} · {invoice.statusLabel} ·{' '}
                  <span className="text-fg-muted" data-visual-date="">
                    {formatDay(invoice.periodStart)} to {formatDay(invoice.periodEnd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
