// /dashboard/billing (milestone M22; docs/adr/0025-billing.md): the account's plan and its
// subscription in test mode (billing.mine): the status in words and a shape, what happens next with
// a date, cancel at the end of the period or resume, the payment history from the provider's
// invoices, and the paid plan of the account's type to choose. Every screen says "Test mode, no real
// charge". ?checkout=<id> reports on a checkout the account just left (the provider's event is
// applied by the worker within seconds; the page reads itself again meanwhile). Reads the session,
// so it renders per request. M23: a change of plan or billing period scheduled for the period end,
// and the changes the subscription may make (none while each account type has one monthly plan).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { BILLING_LOAD_ERROR } from '@/components/account/load-errors/billing';
import { PageRedirect } from '@/components/account/page-redirect';
import { SubscriptionStatusTag, TestModeBanner } from '@/components/billing/status';
import { CheckIcon, DashIcon } from '@/components/icons';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { PLANS, type PlanCode } from '@/server/entitlements/plans';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { CancelForm, CheckoutForm, ConfirmingRefresh, ResumeForm } from './forms';
import { SubscriptionChanges } from './changes';
import { CANCEL_CHANGE_FORM, CANCEL_FORM, changePlanFormId, CHECKOUT_FORM, RESUME_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Billing',
  robots: { index: false },
};

const PAGE = '/dashboard/billing';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

function Outcome({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div id="outcome" role="status" tabIndex={-1} className="grid gap-2 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-ui" data-testid={testId}>
      {children}
    </div>
  );
}

export default async function BillingPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const checkoutId = one(query.checkout);
  const mine = await pageRead(serverClient(await headers(), guard.principal).billing.mine(UUID.test(checkoutId) ? { checkout: checkoutId } : {}));
  if (!mine) return <LoadError {...BILLING_LOAD_ERROR} retryHref={PAGE} />;

  const outcome = one(query.outcome);
  const [checkoutState, cancelState, resumeState] = await Promise.all([
    readFormResult(CHECKOUT_FORM, outcome),
    readFormResult(CANCEL_FORM, outcome),
    readFormResult(RESUME_FORM, outcome),
  ]);
  const sub = mine.subscription;
  const changeResults = Object.fromEntries(
    await Promise.all((sub?.changeOptions ?? []).map(async (o) => [`${o.planCode}-${o.interval}`, await readFormResult(changePlanFormId(o.planCode, o.interval), outcome)] as const)),
  );
  const cancelChangeState = await readFormResult(CANCEL_CHANGE_FORM, outcome);
  const live = sub !== null && (sub.status === 'active' || sub.status === 'past_due');
  const wanted = one(query.plan) as PlanCode;
  const wantedPlan = Object.hasOwn(PLANS, wanted) ? PLANS[wanted] : null;
  const otherType = wantedPlan && !live && !mine.offers.some((o) => o.planCode === wanted) && wantedPlan.audience !== mine.accountType && wantedPlan.audience !== 'organization';
  const confirming = mine.checkout !== null && mine.checkout.status === 'open' && query.cancelled !== '1' && !live;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Billing</h1>
        <div className="mt-4">
          <TestModeBanner label={mine.testModeLabel}>
            Payments here use test cards only{mine.provider === 'stripe' ? ' (Stripe test mode)' : ''}. Prices are proposed and not final.
          </TestModeBanner>
        </div>

        <div className="mt-8 grid gap-10">
          {mine.checkout && query.cancelled === '1' ? (
            <Outcome testId="checkout-left">
              <p>You left the checkout. Nothing was charged.</p>
            </Outcome>
          ) : confirming ? (
            <Outcome testId="checkout-confirming">
              <p>Confirming your payment for {mine.checkout!.planName} with the test provider. This page updates by itself in a few seconds.</p>
              <p>
                <Link href={`${PAGE}?checkout=${mine.checkout!.id}#outcome`} className="link inline-flex min-h-11 items-center">
                  Check again
                </Link>
              </p>
              <ConfirmingRefresh />
            </Outcome>
          ) : mine.checkout && mine.checkout.status === 'expired' && !live ? (
            <Outcome testId="checkout-expired">
              <p>That checkout has expired. Nothing was charged; you can start again below.</p>
            </Outcome>
          ) : mine.checkout && live && sub ? (
            <Outcome testId="checkout-done">
              <p className="flex items-start gap-2">
                <CheckIcon size={18} className="mt-1 shrink-0" />
                <span>Your plan is now {sub.planName}. {mine.testModeLabel}.</span>
              </p>
            </Outcome>
          ) : null}

          <section aria-labelledby="current-heading" className="grid gap-4">
            <h2 id="current-heading" className="font-display text-2xl">
              Your plan
            </h2>
            <p className="text-ui" data-testid="billing-plan">
              <span className="font-semibold">{mine.plan.name}</span>
              {!live ? <span className="text-fg-muted"> — no subscription</span> : null}
            </p>
            {sub && live ? (
              <div className="grid gap-4 border-t border-border-subtle pt-4" data-testid="billing-subscription" data-status={sub.status}>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-display text-xl">{sub.planName}</span>
                  <SubscriptionStatusTag status={sub.status} cancelAtPeriodEnd={sub.cancelAtPeriodEnd} label={sub.statusLabel} />
                </p>
                <p className="text-ui" data-testid="billing-summary">
                  <span data-visual-date="">{sub.summary}</span>
                </p>
                <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-fg-muted">Price</dt>
                  <dd>
                    {sub.price} <span className="text-fg-muted">(proposed, test mode)</span>
                  </dd>
                  <dt className="text-fg-muted">Current period</dt>
                  <dd data-visual-date="">
                    {formatDay(sub.currentPeriodStart)} to {formatDay(sub.currentPeriodEnd)}
                  </dd>
                </dl>
                {sub.canCancel ? (
                  <CancelForm subscriptionId={sub.id} planName={sub.planName} until={formatDay(sub.accessUntil ?? sub.currentPeriodEnd)} initial={cancelState} />
                ) : null}
                {sub.canResume ? <ResumeForm subscriptionId={sub.id} initial={resumeState} /> : null}
                <SubscriptionChanges sub={sub} results={changeResults} cancelChangeResult={cancelChangeState} />
                {sub.status === 'past_due' ? (
                  <p className="max-w-[60ch] text-sm text-fg-muted">
                    The test provider retries the payment. If it does not go through by the date above, the plan ends and your account has its
                    free plan; nothing you added is deleted.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          {mine.offers.length > 0 ? (
            <section aria-labelledby="offers-heading" className="grid gap-4">
              <h2 id="offers-heading" className="font-display text-2xl">
                Choose a paid plan
              </h2>
              {mine.offers.map((offer) => (
                <CheckoutForm key={`${offer.planCode}-${offer.interval}`} offer={offer} testModeLabel={mine.testModeLabel} chosen={offer.planCode === wanted} initial={checkoutState} />
              ))}
            </section>
          ) : null}
          {otherType && wantedPlan ? (
            <p className="max-w-[60ch] text-ui text-fg-muted" data-testid="other-type">
              {wantedPlan.name} is for {wantedPlan.audience === 'sifu' ? 'Sifu' : 'Student'} accounts.{' '}
              <Link href="/dashboard/settings" className="link inline-flex min-h-11 items-center">
                Change your account type
              </Link>
            </p>
          ) : null}

          <section aria-labelledby="history-heading" className="grid gap-4">
            <h2 id="history-heading" className="font-display text-2xl">
              Payment history
            </h2>
            {[sub, ...mine.earlier].every((s) => !s || s.invoices.length === 0) ? (
              <p className="text-ui text-fg-muted" data-testid="no-payments">
                No payments yet.
              </p>
            ) : (
              <ul className="grid" data-testid="payment-history">
                {[sub, ...mine.earlier].flatMap((s) =>
                  s
                    ? s.invoices.map((invoice) => (
                        <li key={invoice.id} className="grid gap-1 border-b border-border-subtle py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline" data-status={invoice.status}>
                          <p className="text-ui">
                            <span className="font-semibold">{s.planName}</span>{' '}
                            <span className="text-fg-muted" data-visual-date="">
                              {formatDay(invoice.periodStart)} to {formatDay(invoice.periodEnd)}
                            </span>
                          </p>
                          <p className="flex items-center gap-2 text-ui tabular">
                            {invoice.amount}
                            <span className="inline-flex items-center gap-1 text-sm">
                              {invoice.status === 'paid' ? <CheckIcon size={16} /> : <DashIcon size={16} />}
                              {invoice.statusLabel}
                            </span>
                          </p>
                        </li>
                      ))
                    : [],
                )}
              </ul>
            )}
          </section>

          {mine.earlier.length > 0 || (sub && !live) ? (
            <section aria-labelledby="earlier-heading" className="grid gap-3">
              <h2 id="earlier-heading" className="font-display text-2xl">
                Earlier subscriptions
              </h2>
              <ul className="grid">
                {[...(sub && !live ? [sub] : []), ...mine.earlier].map((s) => (
                  <li key={s.id} className="grid gap-1 border-b border-border-subtle py-3" data-testid="earlier-subscription">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{s.planName}</span>
                      <SubscriptionStatusTag status={s.status} cancelAtPeriodEnd={s.cancelAtPeriodEnd} label={s.statusLabel} />
                    </p>
                    <p className="text-sm text-fg-muted" data-visual-date="">
                      {s.summary}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="flex flex-wrap gap-x-5 text-ui">
            <Link href="/plans" className="link inline-flex min-h-11 items-center">
              Compare plans
            </Link>
            <Link href="/dashboard/settings" className="link inline-flex min-h-11 items-center">
              Account type and plan
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
