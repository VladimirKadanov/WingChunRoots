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
import { PageRedirect } from '@/components/account/page-redirect';
import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { SubscriptionStatusTag, TestModeBanner } from '@/components/billing/status';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageReadOne } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { AdminSubscriptionDetail } from '@/server/services/billing';
import { priceLabel, providerLabel, subscriptionStatusLabel } from '../labels';
import { billingLoadError } from '../load-error-text';
import { TEST_CLOCK_FORM } from './form-ids';
import { TestClockForm } from './forms';
import { loadErrorWords } from '@/components/admin/i18n/load-error-words';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('Subscription'), robots: { index: false } };
}

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** What became of a provider event, in words; an outcome this page does not know shows as it is. */
function outcomeLabel(t: AdminT, outcome: string): string {
  switch (outcome) {
    case 'pending': return t('Waiting for the worker');
    case 'applied': return t('Applied');
    case 'stale': return t('Older than the stored state: not applied');
    case 'unknown': return t('Unknown subscription');
    case 'mismatch': return t('Names another account: not applied');
    case 'ignored': return t('Not used');
    case 'conflict': return t('A second live subscription: not applied');
    default: return outcome;
  }
}

/** A test clock step's button, in words (the service's label). */
function stepLabel(t: AdminT, step: 'period_end' | 'grace_end'): string {
  return step === 'period_end' ? t('Move to the end of the period') : t('Move to the end of the grace period');
}

const timeOf = (t: AdminT, iso: string) => t('{day}, {time} UTC', { day: t.day(iso), time: iso.slice(11, 19) });

/**
 * The subscription's state in one sentence: the service's own summary in English, the same said
 * from its values in Bulgarian (docs/adr/0043-admin-bulgarian.md).
 */
function summaryText(t: AdminT, sub: AdminSubscriptionDetail['subscription']): string {
  if (t.lang === 'en') return sub.summary;
  switch (sub.status) {
    case 'active': {
      if (sub.cancelAtPeriodEnd) return t('Cancelled at the end of the period. You keep {plan} until {date}; nothing more is charged.', { plan: sub.planName, date: t.day(sub.currentPeriodEnd) });
      const next = sub.scheduledChange;
      if (next) {
        const vars = { date: t.day(sub.currentPeriodEnd), plan: next.planName, price: priceLabel(t, next.price) };
        return next.interval === 'year'
          ? t('Renews on {date} as {plan}, billed yearly at {price}.', vars)
          : t('Renews on {date} as {plan}, billed monthly at {price}.', vars);
      }
      return t('Renews on {date}.', { date: t.day(sub.currentPeriodEnd) });
    }
    case 'past_due':
      return t('The renewal payment failed. You keep {plan} until {date} while the payment is retried.', {
        plan: sub.planName,
        date: t.day(sub.accessUntil ?? sub.currentPeriodEnd),
      });
    case 'canceled':
      return t('Ended on {date}. Your records, links and history are kept.', { date: t.day(sub.endedAt ?? sub.currentPeriodEnd) });
    default:
      return t('The payment was not completed.');
  }
}

export default async function AdminSubscriptionPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const page = `/admin/billing/${encodeURIComponent(id)}`;
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  const t = await getAdminT();
  const read = await pageReadOne(serverClient(await headers(), guard.principal).billing.adminGet({ subscriptionId: id }));
  if (read.missing) notFound();
  const view = read.value;
  if (!view) return <LoadError words={loadErrorWords(t)} {...billingLoadError(t)} retryHref={page} />;
  const query = await searchParams;
  const initial = await readFormResult(TEST_CLOCK_FORM, typeof query.outcome === 'string' ? query.outcome : '');
  const sub = view.subscription;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow">
          <Link href="/admin/billing" className="link inline-flex min-h-11 items-center">
            {t('Subscriptions')}
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">
          {sub.planName} · {sub.holder}
        </h1>
        <div className="mt-4">
          <TestModeBanner label={t('Test mode, no real charge')} />
        </div>

        <section aria-labelledby="state-heading" className="mt-8 grid gap-3">
          <h2 id="state-heading" className="font-display text-2xl">
            {t('State')}
          </h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <SubscriptionStatusTag status={sub.status} cancelAtPeriodEnd={sub.cancelAtPeriodEnd} label={subscriptionStatusLabel(t, sub.status, sub.cancelAtPeriodEnd)} />
            <span className="text-ui" data-visual-date="">
              {summaryText(t, sub)}
            </span>
          </p>
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
            <dt className="text-fg-muted">{t('Provider')}</dt>
            <dd>{providerLabel(t, sub.provider)}</dd>
            <dt className="text-fg-muted">{t('Provider subscription')}</dt>
            <dd className="[overflow-wrap:anywhere]" translate="no">
              {sub.providerSubscriptionId}
            </dd>
            <dt className="text-fg-muted">{t('Version applied')}</dt>
            <dd className="tabular">{sub.providerVersion}</dd>
            <dt className="text-fg-muted">{t('Price')}</dt>
            <dd>{t('{price} (proposed)', { price: priceLabel(t, sub.price) })}</dd>
            <dt className="text-fg-muted">{t('Current period')}</dt>
            <dd data-visual-date="">{t('{from} to {to}', { from: t.day(sub.currentPeriodStart), to: t.day(sub.currentPeriodEnd) })}</dd>
            <dt className="text-fg-muted">{t('Access until')}</dt>
            <dd data-visual-date="">{sub.accessUntil ? t.day(sub.accessUntil) : '—'}</dd>
          </dl>
        </section>

        {view.testClock.available ? (
          <section aria-labelledby="clock-heading" className="mt-10 grid gap-3">
            <h2 id="clock-heading" className="font-display text-2xl">
              {t('Test clock')}
            </h2>
            <p className="max-w-[60ch] text-sm text-fg-muted">
              {t(
                'Moves this subscription on the test provider as if time had passed: a renewal (paid, or failed with the card that fails at renewal), the end of a cancelled subscription, or the end of the grace period. Audited.',
              )}
            </p>
            <TestClockForm subscriptionId={sub.id} steps={view.testClock.steps.map((s) => ({ step: s.step, label: stepLabel(t, s.step) }))} initial={initial} />
          </section>
        ) : null}

        <section aria-labelledby="events-heading" className="mt-10 grid gap-3">
          <h2 id="events-heading" className="font-display text-2xl">
            {t('Provider events')}
          </h2>
          {view.events.length === 0 ? (
            <p className="text-fg-muted">{t('No events yet.')}</p>
          ) : (
            <ol className="grid" data-testid="admin-billing-events">
              {view.events.map((e) => (
                <li key={e.id} className="grid gap-0.5 border-b border-border-subtle py-2 text-sm" data-outcome={e.outcome}>
                  <p>
                    <span className="font-semibold">{e.providerType}</span> · {outcomeLabel(t, e.outcome)}
                  </p>
                  <p className="text-fg-muted">
                    <span data-visual-date="">{timeOf(t, e.providerCreatedAt)}</span> ·{' '}
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
            {t('Invoices')}
          </h2>
          {sub.invoices.length === 0 ? (
            <p className="text-fg-muted">{t('No invoices.')}</p>
          ) : (
            <ul className="grid">
              {sub.invoices.map((invoice) => (
                <li key={invoice.id} className="border-b border-border-subtle py-2 text-sm">
                  {invoice.amount} · {invoice.status === 'paid' ? t('Paid (test)') : t('Failed (test)')} ·{' '}
                  <span className="text-fg-muted" data-visual-date="">
                    {t('{from} to {to}', { from: t.day(invoice.periodStart), to: t.day(invoice.periodEnd) })}
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
