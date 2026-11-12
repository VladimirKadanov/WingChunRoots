// /billing/test-checkout/[id] (milestone M22; docs/adr/0025-billing.md): the checkout page of the
// app's own test provider, in place of a provider's hosted checkout. The plan, its proposed price
// and the three test cards (succeeds, declines, fails at renewal); "Test mode, no real charge" at
// the top. Only the account that started the checkout sees it (billing.testCheckout; 404 for any
// other). Reads the session, so it renders per request. M23: an organization's checkout goes back
// to the organization's billing page, and one during a trial says nothing is charged before it ends.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { LoadError } from '@/components/account/load-error';
import { TEST_CHECKOUT_LOAD_ERROR } from '@/components/account/load-errors/test-checkout';
import { PageRedirect } from '@/components/account/page-redirect';
import { TestModeBanner } from '@/components/billing/status';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageReadOne } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { TestPayForm } from './form';
import { TEST_PAY_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Test checkout',
  robots: { index: false },
};

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function TestCheckoutPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const page = `/billing/test-checkout/${encodeURIComponent(id)}`;
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const read = await pageReadOne(serverClient(await headers(), guard.principal).billing.testCheckout({ checkoutId: id }));
  if (read.missing) notFound();
  const checkout = read.value;
  if (!checkout) return <LoadError {...TEST_CHECKOUT_LOAD_ERROR} retryHref={page} />;
  const query = await searchParams;
  const initial = await readFormResult(TEST_PAY_FORM, typeof query.outcome === 'string' ? query.outcome : '');

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[40rem]">
        <p className="eyebrow">
          <Link href={checkout.backHref} className="link inline-flex min-h-11 items-center">
            Billing
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Test checkout</h1>
        <div className="mt-4">
          <TestModeBanner label={checkout.testModeLabel}>
            This page stands in for a payment provider&apos;s checkout. No card number is entered and nothing is ever charged.
          </TestModeBanner>
        </div>
        <section aria-labelledby="order-heading" className="mt-8 grid gap-2 border-t-2 border-fg pt-3" data-testid="test-checkout-order">
          <h2 id="order-heading" className="font-display text-2xl">
            {checkout.planName}
          </h2>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-display text-xl tabular">{checkout.price}</span>
            <span className="text-sm text-fg-muted">{checkout.priceLabel}</span>
          </p>
          <p className="text-sm text-fg-muted">Renews {checkout.interval === 'year' ? 'every year' : 'every month'} until you cancel. You can cancel at any time.</p>
          {checkout.trialEndsAt ? (
            // M23 (DEFAULT M23, question 3): a checkout during the trial charges nothing before it ends.
            <p className="text-ui" data-testid="test-checkout-trial">
              The organization&apos;s trial runs until <span data-visual-date="">{formatDay(checkout.trialEndsAt)}</span>. Nothing is charged today; the first
              payment of {checkout.amount} is due then.
            </p>
          ) : null}
        </section>
        <div className="mt-8">
          {checkout.status === 'open' ? (
            <TestPayForm checkoutId={checkout.id} amount={checkout.trialEndsAt ? null : checkout.amount} cards={checkout.cards} initial={initial} />
          ) : (
            <div className="grid justify-items-start gap-3" data-testid="test-checkout-closed">
              <p className="text-ui">
                {checkout.status === 'completed' ? 'This checkout is paid.' : 'This checkout has expired. Nothing was charged.'}
              </p>
              <Link href={`${checkout.backHref}?checkout=${checkout.id}#outcome`} className={buttonVariants({ variant: 'secondary' })}>
                Back to billing
              </Link>
            </div>
          )}
        </div>
        <p className="mt-6 text-ui">
          <Link href={`${checkout.backHref}?checkout=${checkout.id}&cancelled=1#outcome`} className="link inline-flex min-h-11 items-center">
            Leave the checkout
          </Link>
        </p>
      </div>
    </div>
  );
}
