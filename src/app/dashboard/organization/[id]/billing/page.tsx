// /dashboard/organization/<id>/billing (milestone M23; docs/adr/0026-federation-billing.md;
// specification §10.1–10.3): an organization's Federation plan in test mode (billing.organization):
// its trial without a card and when it ends, its subscription with what happens next, a change of
// billing period (monthly to yearly now, yearly to monthly at the period end: DEFAULT M23, question
// 2), cancel and resume, and the payment history. An owner chooses monthly or yearly Federation,
// also to continue the trial (the first charge then comes at its end); another admin reads only
// (DEFAULT M23, question 1). Only what Federation gives now is named (CLAUDE.md §11), with the
// proposed price (DEFAULT D09), and every screen says "Test mode, no real charge". A lapsed
// Federation never touches the member schools' and students' own plans (specification §10.3), and
// the page says so. Any organization the account does not administer is "not found".

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_BILLING_LOAD_ERROR } from '@/components/account/load-errors/organization-billing';
import { PageRedirect } from '@/components/account/page-redirect';
import { SubscriptionStatusTag, TestModeBanner, TrialStatusTag } from '@/components/billing/status';
import { CheckIcon, DashIcon } from '@/components/icons';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { SubscriptionChanges } from '../../../billing/changes';
import { CANCEL_CHANGE_FORM, CANCEL_FORM, changePlanFormId, CHECKOUT_FORM, RESUME_FORM } from '../../../billing/form-ids';
import { CancelForm, CheckoutForm, ConfirmingRefresh, ResumeForm } from '../../../billing/forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Organization billing',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

function Outcome({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div id="outcome" role="status" tabIndex={-1} className="grid gap-2 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-ui" data-testid={testId}>
      {children}
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="organization-billing-not-found">
      <p className="eyebrow">
        <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center">
          Your organizations
        </Link>
      </p>
      <h1 className="mt-2 font-display text-feature">Organization not found</h1>
    </div>
  );
}

export default async function OrganizationBillingPage({ params, searchParams }: Props) {
  const { id } = await params;
  const page = `/dashboard/organization/${UUID.test(id) ? id : ''}${UUID.test(id) ? '/billing' : ''}`;
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!UUID.test(id)) return <NotFound />;
  const query = await searchParams;
  const checkoutId = one(query.checkout);
  const read = await pageRead(
    serverClient(await headers(), guard.principal)
      .billing.organization({ organizationId: id, ...(UUID.test(checkoutId) ? { checkout: checkoutId } : {}) })
      .catch((error: unknown) => {
        if (rpcErrorCode(error) === 'NOT_FOUND') return 'missing' as const;
        throw error;
      }),
  );
  if (read === 'missing') return <NotFound />;
  const view = read;
  if (!view) return <LoadError {...ORGANIZATION_BILLING_LOAD_ERROR} retryHref={page} />;

  const outcome = one(query.outcome);
  const sub = view.subscription;
  const [checkoutMonth, checkoutYear, cancelState, resumeState, cancelChangeState] = await Promise.all([
    readFormResult(`${CHECKOUT_FORM}-month`, outcome),
    readFormResult(`${CHECKOUT_FORM}-year`, outcome),
    readFormResult(CANCEL_FORM, outcome),
    readFormResult(RESUME_FORM, outcome),
    readFormResult(CANCEL_CHANGE_FORM, outcome),
  ]);
  const changeResults = Object.fromEntries(
    await Promise.all((sub?.changeOptions ?? []).map(async (o) => [`${o.planCode}-${o.interval}`, await readFormResult(changePlanFormId(o.planCode, o.interval), outcome)] as const)),
  );
  const live = sub !== null && (sub.status === 'active' || sub.status === 'past_due');
  const confirming = view.checkout !== null && view.checkout.status === 'open' && query.cancelled !== '1' && !live;
  const trialRunning = view.trial?.status === 'active';
  const org = view.organization;
  const orgId = org.id;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="organization-billing-page">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href={`/dashboard/organization/${orgId}`} className="link inline-flex min-h-11 items-center [overflow-wrap:anywhere]">
            {org.name}
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Organization billing</h1>
        <div className="mt-4">
          <TestModeBanner label={view.testModeLabel}>
            Payments here use test cards only{view.provider === 'stripe' ? ' (Stripe test mode)' : ''}. Prices are proposed and not final.
          </TestModeBanner>
        </div>

        <div className="mt-8 grid gap-10">
          {view.checkout && query.cancelled === '1' ? (
            <Outcome testId="checkout-left">
              <p>You left the checkout. Nothing was charged.</p>
            </Outcome>
          ) : confirming ? (
            <Outcome testId="checkout-confirming">
              <p>Confirming the payment for {view.checkout!.planName} with the test provider. This page updates by itself in a few seconds.</p>
              <p>
                <Link href={`${page}?checkout=${view.checkout!.id}#outcome`} className="link inline-flex min-h-11 items-center">
                  Check again
                </Link>
              </p>
              <ConfirmingRefresh />
            </Outcome>
          ) : view.checkout && view.checkout.status === 'expired' && !live ? (
            <Outcome testId="checkout-expired">
              <p>That checkout has expired. Nothing was charged; you can start again below.</p>
            </Outcome>
          ) : view.checkout && live && sub ? (
            <Outcome testId="checkout-done">
              <p className="flex items-start gap-2">
                <CheckIcon size={18} className="mt-1 shrink-0" />
                <span>
                  The organization’s plan is now {sub.planName}. {view.testModeLabel}.
                </span>
              </p>
            </Outcome>
          ) : null}

          <section aria-labelledby="org-plan-heading" className="grid gap-4">
            <h2 id="org-plan-heading" className="font-display text-2xl">
              The organization’s plan
            </h2>
            <p className="text-ui" data-testid="organization-billing-plan" data-plan={view.plan.code ?? 'none'}>
              <span className="font-semibold">{view.plan.label}</span>
              {view.plan.until ? (
                <span className="text-fg-muted" data-visual-date="">
                  {' '}
                  · until {formatDay(view.plan.until)}
                </span>
              ) : null}
            </p>
            <p className="max-w-[60ch] text-sm text-fg-muted">
              {org.kindLabel} · {org.approvalLabel} · You: {view.you.role === 'owner' ? 'Owner' : 'Admin'}
              {view.you.canManage ? '' : '. Only an owner can choose or change the plan.'}
            </p>
            <div className="grid gap-2">
              <h3 className="font-display text-xl">What Federation gives now</h3>
              <ul className="grid gap-1 text-ui" data-testid="federation-benefits">
                {view.benefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2">
                    <CheckIcon size={16} className="mt-1 shrink-0" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
              <p className="max-w-[60ch] text-sm text-fg-muted">
                Member schools and students keep their own plans whatever happens to the organization’s plan: a school’s Professional Sifu or a student’s
                Premium Student is theirs alone.
              </p>
            </div>
          </section>

          {view.trial ? (
            <section aria-labelledby="trial-heading" className="grid gap-3" data-testid="organization-trial" data-status={view.trial.status}>
              <h2 id="trial-heading" className="font-display text-2xl">
                Trial
              </h2>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{view.trial.months} months, no card</span>
                <TrialStatusTag status={view.trial.status} label={view.trial.statusLabel} />
              </p>
              <p className="max-w-[60ch] text-ui" data-testid="trial-summary">
                <span data-visual-date="">{view.trial.summary}</span>
              </p>
            </section>
          ) : null}

          {sub && live ? (
            <section aria-labelledby="subscription-heading" className="grid gap-4" data-testid="billing-subscription" data-status={sub.status}>
              <h2 id="subscription-heading" className="font-display text-2xl">
                Subscription
              </h2>
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
                <CancelForm subscriptionId={sub.id} planName={sub.planName} until={formatDay(sub.accessUntil ?? sub.currentPeriodEnd)} initial={cancelState} organizationId={orgId} />
              ) : null}
              {sub.canResume ? <ResumeForm subscriptionId={sub.id} initial={resumeState} organizationId={orgId} /> : null}
              {view.you.canManage ? <SubscriptionChanges sub={sub} results={changeResults} cancelChangeResult={cancelChangeState} organizationId={orgId} /> : null}
              {sub.status === 'past_due' ? (
                <p className="max-w-[60ch] text-sm text-fg-muted">
                  The test provider retries the payment. If it does not go through by the date above, the organization’s plan ends; nothing is deleted, and
                  member schools and students keep their own plans.
                </p>
              ) : null}
            </section>
          ) : null}

          {view.offers.length > 0 ? (
            <section aria-labelledby="offers-heading" className="grid gap-4">
              <h2 id="offers-heading" className="font-display text-2xl">
                {trialRunning ? 'Continue after the trial' : 'Choose Federation'}
              </h2>
              {view.offers.map((offer) => (
                <CheckoutForm
                  key={offer.interval}
                  offer={offer}
                  testModeLabel={view.testModeLabel}
                  chosen={false}
                  initial={offer.interval === 'year' ? checkoutYear : checkoutMonth}
                  organizationId={orgId}
                  note={trialRunning && view.trial ? `Nothing is charged before the trial ends on ${formatDay(view.trial.endsAt)}; the first payment is due then.` : undefined}
                />
              ))}
            </section>
          ) : view.offersNote ? (
            <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="organization-offers-note">
              {view.offersNote}
            </p>
          ) : null}

          <section aria-labelledby="history-heading" className="grid gap-4">
            <h2 id="history-heading" className="font-display text-2xl">
              Payment history
            </h2>
            {[sub, ...view.earlier].every((s) => !s || s.invoices.length === 0) ? (
              <p className="text-ui text-fg-muted" data-testid="no-payments">
                No payments yet.
              </p>
            ) : (
              <ul className="grid" data-testid="payment-history">
                {[sub, ...view.earlier].flatMap((s) =>
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

          {view.earlier.length > 0 || (sub && !live) ? (
            <section aria-labelledby="earlier-heading" className="grid gap-3">
              <h2 id="earlier-heading" className="font-display text-2xl">
                Earlier subscriptions
              </h2>
              <ul className="grid">
                {[...(sub && !live ? [sub] : []), ...view.earlier].map((s) => (
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
            <Link href={`/dashboard/organization/${orgId}`} className="link inline-flex min-h-11 items-center">
              Back to the organization
            </Link>
            <Link href="/plans" className="link inline-flex min-h-11 items-center">
              Compare plans
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
