/**
 * Milestone M22: payments in test mode (docs/adr/0025-billing.md). A new Free Sifu chooses
 * Professional Sifu on /plans, reaches the test provider's checkout, is declined with the test card
 * that is declined (nothing changes), pays with the test card that succeeds, and the worker applies
 * the provider's event: the plan is Professional Sifu. The Sifu cancels at the end of the period
 * (the plan stays until then); the administrator moves the test clock to the end of the period, and
 * the account is back on Free Sifu with the ended subscription and its payment kept. A new student
 * pays Premium Student with the test card that fails at renewal: at the end of the period the
 * renewal fails (Payment failed, access kept for the grace period), and at the end of the grace
 * period the plan ends. axe runs on every new page in both themes. No real charge: the test
 * provider only (BILLING_PROVIDER unset).
 *
 * The administrator's list of subscriptions gains rows and the accounts' plans change, so the spec
 * runs in the `exclusive` project (e2e/projects.ts, PUBLIC_WRITE_SPECS). Every account is a new
 * `demo-e2e-…@example.test` account with a fictional `Demo …` name (D20).
 */

import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { apiPost, freshAccount } from './helpers/plans';
import { sifuAccount, signedIn, visible } from './helpers/schools';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

async function axeBothThemes(page: Page, label: string) {
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `${label} (${theme})`);
  }
}

/** Pays the open checkout on the test checkout page with `card`. */
async function pay(page: Page, card: string, amount: string) {
  const form = visible(page.getByTestId('test-pay-form'));
  await form.getByLabel(card).check();
  await form.getByRole('button', { name: `Pay ${amount} in test mode` }).click();
}

/** The account's subscription id, as the database holds it (one per account in these tests). */
async function subscriptionOf(userId: string): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM billing_subscription WHERE subject_user_id = ${userId}::uuid`);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]!.id;
}

/** The administrator moves the test clock of `subscriptionId` one step on /admin/billing/[id]. */
async function moveClock(admin: Page, subscriptionId: string, step: string) {
  await admin.goto(`/admin/billing/${subscriptionId}`);
  await visible(admin.getByTestId('test-clock')).getByRole('button', { name: step }).click();
  await expect(visible(admin.getByTestId('test-clock'))).not.toContainText('Moving the test clock');
}

test('@M22 a Sifu pays Professional Sifu in test mode, cancels, and keeps its records after the period', async ({ page, browser, request }) => {
  const sifu = await sifuAccount(page, 'Billing Sifu');

  // /plans → the billing page with the chosen plan.
  await page.goto('/plans');
  await visible(page.getByTestId('choose-pro_sifu')).click();
  await page.waitForURL(/\/dashboard\/billing\?plan=pro_sifu/);
  await expect(visible(page.getByTestId('test-mode-banner'))).toContainText('Test mode, no real charge');
  await expect(visible(page.getByTestId('billing-plan'))).toContainText('Free Sifu');
  await expect(visible(page.getByTestId('no-payments'))).toBeVisible();
  const offer = visible(page.getByTestId('offer-pro_sifu'));
  await expect(offer).toBeVisible();
  await axeBothThemes(page, '/dashboard/billing (Free Sifu)');

  // The checkout of the test provider.
  await offer.getByRole('button', { name: 'Choose Professional Sifu' }).click();
  await page.waitForURL(/\/billing\/test-checkout\/[0-9a-f-]{36}$/);
  const checkoutId = new URL(page.url()).pathname.split('/').pop()!;
  await expect(visible(page.getByTestId('test-mode-banner'))).toBeVisible();
  await expect(visible(page.getByTestId('test-checkout-order'))).toContainText('Professional Sifu');
  await axeBothThemes(page, '/billing/test-checkout/[id]');

  // Another account never sees that checkout.
  const other = await signedIn(browser, 'user');
  try {
    // The page streams after its shell (status 200), so the API answers for the status.
    expect((await other.page.request.get(`/api/v1/billing/test-checkout/${checkoutId}`)).status()).toBe(404);
    await other.page.goto(`/billing/test-checkout/${checkoutId}`);
    await expect(visible(other.page.getByRole('heading', { name: 'This page is not drawn yet' }))).toBeVisible();
    await expect(other.page.getByTestId('test-pay-form')).toHaveCount(0);
  } finally {
    await other.context.close();
  }
  // Nobody without a session pays it.
  expect((await request.post(`${BASE_URL}/api/v1/billing/test-checkout/pay`, { data: { checkoutId, card: 'succeeds' } })).status()).toBe(401);

  // A declined card: an error, nothing changes.
  await pay(page, 'Test card that is declined', '$19.00');
  await expect(visible(page.getByTestId('test-pay-form'))).toContainText(/declined/i);
  expect(page.url()).toContain(`/billing/test-checkout/${checkoutId}`);
  const none = await getDb().execute(sql`SELECT 1 FROM billing_subscription WHERE subject_user_id = ${sifu.userId}::uuid`);
  expect(none.rows).toHaveLength(0);

  // The card that succeeds: back on the billing page, confirmed once the worker applied the event.
  await pay(page, 'Test card that succeeds', '$19.00');
  await page.waitForURL(new RegExp(`/dashboard/billing\\?checkout=${checkoutId}`));
  await expect(visible(page.getByTestId('checkout-done'))).toContainText('Your plan is now Professional Sifu', { timeout: 30_000 });
  const subscription = visible(page.getByTestId('billing-subscription'));
  await expect(subscription).toHaveAttribute('data-status', 'active');
  await expect(subscription.getByTestId('subscription-status')).toContainText('Active');
  await expect(visible(page.getByTestId('payment-history'))).toContainText('$19.00');
  await expect(visible(page.getByTestId('payment-history'))).toContainText('Paid (test)');
  await axeBothThemes(page, '/dashboard/billing (active)');

  // A second checkout of the same account is refused while the subscription renews.
  const again = await apiPost(page, '/billing/checkout', { planCode: 'pro_sifu', interval: 'month' });
  expect(again.status(), await again.text()).toBe(409);

  // The plan, in the settings; the account type cannot change while the subscription renews.
  await page.goto('/dashboard/settings');
  await expect(visible(page.getByTestId('settings-plan'))).toContainText('Professional Sifu');
  await expect(visible(page.getByTestId('settings-paid-plan'))).toBeVisible();
  const type = await apiPost(page, '/account/type', { accountType: 'student' });
  expect(type.status(), await type.text()).toBe(409);

  // Cancel at the end of the period: the plan stays until then.
  await page.goto('/dashboard/billing');
  await visible(page.getByTestId('billing-subscription')).getByRole('button', { name: 'Cancel at the end of the period' }).click();
  await expect(visible(page.getByTestId('subscription-status')).first()).toContainText('Cancels at the period end');
  await expect(visible(page.getByTestId('billing-plan'))).toContainText('Professional Sifu');
  await expect(visible(page.getByRole('button', { name: 'Resume the subscription' }))).toBeVisible();

  // The administrator sees it and moves the test clock to the end of the period.
  const subscriptionId = await subscriptionOf(sifu.userId);
  const admin = await signedIn(browser, 'admin');
  try {
    await admin.page.goto('/admin/billing');
    await expect(visible(admin.page.getByTestId('test-mode-banner'))).toBeVisible();
    await expect(visible(admin.page.getByRole('link', { name: `Professional Sifu · ${sifu.email}` }))).toBeVisible();
    await axeBothThemes(admin.page, '/admin/billing');
    await admin.page.goto(`/admin/billing/${subscriptionId}`);
    await expect(visible(admin.page.getByTestId('admin-billing-events'))).toContainText('subscription.created');
    await axeBothThemes(admin.page, '/admin/billing/[id]');
    await moveClock(admin.page, subscriptionId, 'Move to the end of the period');
  } finally {
    await admin.context.close();
  }

  // Back on Free Sifu; the ended subscription and its payment are kept.
  await expect
    .poll(
      async () => {
        await page.goto('/dashboard/billing');
        return (await visible(page.getByTestId('billing-plan')).textContent()) ?? '';
      },
      { timeout: 30_000 },
    )
    .toContain('Free Sifu');
  const earlier = visible(page.getByTestId('earlier-subscription'));
  await expect(earlier).toHaveCount(1);
  await expect(earlier.getByTestId('subscription-status')).toContainText('Ended');
  await expect(visible(page.getByTestId('payment-history'))).toContainText('$19.00');
  await axeBothThemes(page, '/dashboard/billing (ended)');
  await page.goto('/dashboard/settings');
  await expect(visible(page.getByTestId('settings-plan'))).toContainText('Free Sifu');
});

test('@M22 a failed renewal keeps the plan for the grace period, then the plan ends', async ({ page, browser }) => {
  const student = await freshAccount(page, { name: 'Demo Billing Student' });
  await page.goto('/dashboard/billing?plan=premium_student');
  await visible(page.getByTestId('offer-premium_student')).getByRole('button', { name: 'Choose Premium Student' }).click();
  await page.waitForURL(/\/billing\/test-checkout\//);
  await pay(page, 'Test card that fails at renewal', '$4.00');
  await expect(visible(page.getByTestId('checkout-done'))).toContainText('Your plan is now Premium Student', { timeout: 30_000 });

  const subscriptionId = await subscriptionOf(student.userId);
  const admin = await signedIn(browser, 'admin');
  try {
    // The renewal fails: Payment failed, the plan stays during the grace period.
    await moveClock(admin.page, subscriptionId, 'Move to the end of the period');
    await expect
      .poll(
        async () => {
          await page.goto('/dashboard/billing');
          return (await visible(page.getByTestId('billing-subscription')).getAttribute('data-status').catch(() => null)) ?? '';
        },
        { timeout: 30_000 },
      )
      .toBe('past_due');
    await expect(visible(page.getByTestId('subscription-status')).first()).toContainText('Payment failed');
    await expect(visible(page.getByTestId('billing-plan'))).toContainText('Premium Student');
    await expect(visible(page.getByTestId('payment-history'))).toContainText('Failed (test)');
    await axeBothThemes(page, '/dashboard/billing (payment failed)');

    // The end of the grace period: the plan ends; the records stay.
    await moveClock(admin.page, subscriptionId, 'Move to the end of the grace period');
  } finally {
    await admin.context.close();
  }
  await expect
    .poll(
      async () => {
        await page.goto('/dashboard/billing');
        return (await visible(page.getByTestId('billing-plan')).textContent()) ?? '';
      },
      { timeout: 30_000 },
    )
    .toContain('Free Student');
  await expect(visible(page.getByTestId('earlier-subscription')).getByTestId('subscription-status')).toContainText('Ended');
});
