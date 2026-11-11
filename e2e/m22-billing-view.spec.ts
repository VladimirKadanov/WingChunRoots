/**
 * Milestone M22: the seeded subscriptions in test mode as they are seen (docs/adr/0025-billing.md;
 * src/fixtures/billing.ts), on the desktop and the phone. demo-premium-student has an active
 * Premium Student subscription that renews a month after it started; demo-free-sifu-5 an earlier
 * Professional Sifu subscription, cancelled and ended, with its payment kept, and is back on Free
 * Sifu. The administrator's list and the page of one subscription with its provider events; /plans
 * with "Choose this plan" and "Test mode, no real charge". axe runs in both themes; on a phone every
 * control is at least 44 px. It only reads (nothing is paid, cancelled or moved), so it runs in the
 * ordinary projects. Fictional (D20).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** Only what is on screen: Next.js keeps earlier routes of the tab in the page, hidden. */
const shown = (locator: Locator) => locator.filter({ visible: true });

async function axeBothThemes(page: Page, label: string) {
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `${label} (${theme})`);
  }
}

async function expectTouchTargets(page: Page, selector: string) {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, text: el.textContent ?? '' })),
  );
  expect(boxes.length, selector).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.h, `${selector}: ${box.text}`).toBeGreaterThanOrEqual(44);
    expect(box.w, `${selector}: ${box.text}`).toBeGreaterThanOrEqual(44);
  }
}

async function demoSubscriptionOf(email: string): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`
    SELECT s.id::text AS id FROM billing_subscription s JOIN auth_user u ON u.id = s.subject_user_id WHERE u.email = ${email}`);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]!.id;
}

test('@M22 the active demo subscription: its state, what happens next and its payment', async ({ page }, testInfo) => {
  await signInAs(page, 'demo-premium-student');
  await page.goto('/dashboard/billing');
  await expect(shown(page.getByTestId('test-mode-banner'))).toContainText('Test mode, no real charge');
  await expect(shown(page.getByTestId('billing-plan'))).toContainText('Premium Student');
  const subscription = shown(page.getByTestId('billing-subscription'));
  await expect(subscription).toHaveAttribute('data-status', 'active');
  await expect(subscription.getByTestId('subscription-status')).toContainText('Active');
  await expect(shown(page.getByTestId('billing-summary'))).toContainText(/Renews on/);
  await expect(subscription.getByRole('button', { name: 'Cancel at the end of the period' })).toBeVisible();
  await expect(shown(page.getByTestId('payment-history'))).toContainText('$4.00');
  await expect(shown(page.getByTestId('payment-history'))).toContainText('Paid (test)');
  // A live subscription: no offer to buy another.
  await expect(page.getByTestId('offer-premium_student')).toHaveCount(0);
  await axeBothThemes(page, '/dashboard/billing (active)');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="billing-subscription"] button');

  // The settings name the paid plan and link to billing.
  await page.goto('/dashboard/settings');
  await expect(shown(page.getByTestId('settings-paid-plan'))).toContainText('Premium Student');
  await expect(shown(page.getByTestId('settings-paid-plan')).getByRole('link', { name: 'Manage billing' })).toHaveAttribute('href', '/dashboard/billing');
});

test('@M22 the ended demo subscription keeps its records; the account is back on its free plan', async ({ page }) => {
  await signInAs(page, 'demo-free-sifu-5');
  await page.goto('/dashboard/billing');
  await expect(shown(page.getByTestId('billing-plan'))).toContainText('Free Sifu');
  await expect(page.getByTestId('billing-subscription')).toHaveCount(0);
  const earlier = shown(page.getByTestId('earlier-subscription'));
  await expect(earlier).toHaveCount(1);
  await expect(earlier).toContainText('Professional Sifu');
  await expect(earlier.getByTestId('subscription-status')).toContainText('Ended');
  await expect(shown(page.getByTestId('payment-history'))).toContainText('$19.00');
  await expect(shown(page.getByTestId('offer-pro_sifu'))).toBeVisible();
  await axeBothThemes(page, '/dashboard/billing (ended)');
  await page.goto('/dashboard/settings');
  await expect(page.getByTestId('settings-paid-plan')).toHaveCount(0);
});

test('@M22 /plans offers the paid plans that exist now, in test mode', async ({ page }) => {
  await page.goto('/plans');
  for (const code of ['premium_student', 'pro_sifu']) {
    await expect(shown(page.getByTestId(`choose-${code}`))).toHaveAttribute('href', `/dashboard/billing?plan=${code}`);
  }
  // The planned Federation is not for sale.
  await expect(page.getByTestId('choose-federation')).toHaveCount(0);
  // Without a session, the billing page asks to sign in and comes back.
  await shown(page.getByTestId('choose-pro_sifu')).click();
  await page.waitForURL(/\/sign-in\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toMatch(/^\/dashboard\/billing/);
});

test('@M22 the administrator sees every subscription and its provider events, read-only', async ({ page }, testInfo) => {
  await signInAs(page, 'admin');
  await page.goto('/admin');
  await expect(shown(page.getByTestId('admin-billing-link'))).toHaveAttribute('href', '/admin/billing');
  await page.goto('/admin/billing');
  await expect(shown(page.getByRole('link', { name: 'Premium Student · demo-premium-student@example.test' }))).toBeVisible();
  await expect(shown(page.getByRole('link', { name: 'Professional Sifu · demo-free-sifu-5@example.test' }))).toBeVisible();
  await axeBothThemes(page, '/admin/billing');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="admin-billing-filter"] a');
  await page.goto('/admin/billing?status=canceled');
  await expect(shown(page.getByRole('link', { name: 'Professional Sifu · demo-free-sifu-5@example.test' }))).toBeVisible();
  await expect(page.getByRole('link', { name: 'Premium Student · demo-premium-student@example.test' })).toHaveCount(0);

  await page.goto(`/admin/billing/${await demoSubscriptionOf('demo-free-sifu-5@example.test')}`);
  const events = shown(page.getByTestId('admin-billing-events'));
  for (const type of ['invoice.paid', 'subscription.created', 'subscription.updated', 'subscription.deleted']) await expect(events).toContainText(type);
  // An ended subscription has no test clock.
  await expect(page.getByTestId('test-clock')).toHaveCount(0);
  await axeBothThemes(page, '/admin/billing/[id] (ended)');

  await page.goto(`/admin/billing/${await demoSubscriptionOf('demo-premium-student@example.test')}`);
  await expect(shown(page.getByTestId('test-clock')).getByRole('button', { name: 'Move to the end of the period' })).toBeVisible();
  await axeBothThemes(page, '/admin/billing/[id] (active)');
});

test('@M22 a member never reaches the administrator pages of billing', async ({ page }) => {
  await signInAs(page, 'demo-premium-student');
  await page.goto('/admin/billing');
  await expect(shown(page.getByText('Not available'))).toBeVisible();
  await expect(page.getByTestId('admin-billing')).toHaveCount(0);
});
