/**
 * Milestone M23: Federation billing in test mode (docs/adr/0026-federation-billing.md). A new
 * account applies for a federation and an archivist approves it. An administrator starts a
 * 12-month trial without a card on /admin/organizations/[id]; the owner sees it on the
 * organization's billing page and continues with yearly billing on the test checkout: nothing is
 * charged before the trial ends (a payment of $0.00), the trial is "Continued as a subscription",
 * and every change waits for the end of the trial period. A second federation subscribes monthly,
 * switches to yearly at once (the unused month credited), schedules monthly for the period end and
 * takes it back; a co-admin reads the page without a form, and the API answers 403 to its change.
 * Downstream independence (specification §10.3): a member student's Premium Student stays when the
 * federation's trial is ended early and when its cancelled subscription ends. axe runs on every new
 * page in both themes. No real charge: the test provider only (BILLING_PROVIDER unset).
 *
 * It creates organizations, subscriptions and trials and moves the test clock, so the spec runs in
 * the `exclusive` project (e2e/projects.ts, PUBLIC_WRITE_SPECS). Every account is a new
 * `demo-e2e-…@example.test` account with a fictional `Demo …` name (D20).
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, userIdOf } from './helpers/auth';
import { letters } from './helpers/evidence';
import { apiPost, freshAccount } from './helpers/plans';
import { freshContext, signedIn, visible } from './helpers/schools';
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

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The signed-in account applies for a federation through the API (as the form does). */
async function applyForFederation(page: Page): Promise<{ organizationId: string; caseId: string }> {
  const applied = await apiPost(page, '/organizations/apply', {
    name: `Demo ${capital(letters())} Federation`,
    kind: 'federation',
    leaderName: 'Demo Leader Person',
    leaderTitle: null,
    websiteUrl: null,
    countryCode: 'BG',
    schoolsEstimate: 3,
    evidenceIds: [],
    note: null,
    idempotencyKey: randomUUID(),
  });
  expect(applied.status(), await applied.text()).toBe(200);
  return (await applied.json()) as { organizationId: string; caseId: string };
}

/** An archivist takes the case and approves it from the version on the card (review.get). */
async function approve(browser: Parameters<typeof signedIn>[0], caseId: string) {
  const archivist = await signedIn(browser, 'archivist');
  try {
    const assigneeId = await userIdOf('demo-archivist@example.test');
    const assigned = await apiPost(archivist.page, '/review/assign', { caseId, assigneeId, idempotencyKey: randomUUID() });
    expect(assigned.status(), await assigned.text()).toBe(200);
    const card = await archivist.page.request.get(`/api/v1/review/${caseId}`, { headers: { origin: BASE_URL } });
    const organizationVersion = ((await card.json()) as { organization: { version: string } }).organization.version;
    const decided = await apiPost(archivist.page, '/review/decide', { caseId, decision: 'verify', reason: null, idempotencyKey: randomUUID(), organizationVersion });
    expect(decided.status(), await decided.text()).toBe(200);
  } finally {
    await archivist.context.close();
  }
}

/** A new account with an approved federation, signed in on `page`. */
async function approvedFederation(page: Page, browser: Parameters<typeof signedIn>[0], name: string) {
  const owner = await freshAccount(page, { name });
  const applied = await applyForFederation(page);
  await approve(browser, applied.caseId);
  return { owner, organizationId: applied.organizationId, billing: `/dashboard/organization/${applied.organizationId}/billing` };
}

/** Pays the open checkout on the test checkout page with the given card and button. */
async function pay(page: Page, card: string, button: string) {
  const form = visible(page.getByTestId('test-pay-form'));
  await form.getByLabel(card).check();
  await form.getByRole('button', { name: button }).click();
}

/** Reloads `path` until `testId` has `attribute` = `value` (the worker applies the provider's events). */
async function untilAttribute(page: Page, path: string, testId: string, attribute: string, value: string) {
  await expect
    .poll(
      async () => {
        await page.goto(path);
        return (await visible(page.getByTestId(testId)).getAttribute(attribute, { timeout: 2000 }).catch(() => null)) ?? '';
      },
      { timeout: 30_000 },
    )
    .toBe(value);
}

async function organizationSubscriptionOf(organizationId: string, live = true): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`
    SELECT id::text AS id FROM billing_subscription WHERE subject_organization_id = ${organizationId}::uuid
    ${live ? sql`AND status IN ('active', 'past_due')` : sql``} ORDER BY created_at DESC LIMIT 1`);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]!.id;
}

test('@M23 an administrator starts a trial without a card; the owner continues yearly and nothing is charged before it ends', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { owner, organizationId, billing } = await approvedFederation(page, browser, 'Demo Trial Federation Owner');

  // Before the trial: no plan, monthly and yearly offers with proposed prices.
  await page.goto(`/dashboard/organization/${organizationId}`);
  await visible(page.getByTestId('organization-billing-link')).click();
  await page.waitForURL(`**${billing}`);
  await expect(visible(page.getByTestId('test-mode-banner'))).toContainText('Test mode, no real charge');
  await expect(visible(page.getByTestId('organization-billing-plan'))).toHaveAttribute('data-plan', 'none');
  await expect(visible(page.getByTestId('offer-federation-month'))).toContainText('$99.00 a month');
  await expect(visible(page.getByTestId('offer-federation-year'))).toContainText('$990.00 a year');
  await expect(visible(page.getByTestId('federation-benefits'))).toBeVisible();
  await expect(visible(page.getByTestId('no-payments'))).toBeVisible();
  await axeBothThemes(page, '/dashboard/organization/[id]/billing (no plan)');

  // The administrator starts the trial: 12 months by default, with a reason.
  const admin = await signedIn(browser, 'admin');
  try {
    await admin.page.goto(`/admin/organizations/${organizationId}`);
    const section = visible(admin.page.getByTestId('admin-organization-trial'));
    const form = section.getByTestId('organization-trial-form');
    await expect(form.getByLabel('Length')).toHaveValue('12');
    await axeBothThemes(admin.page, '/admin/organizations/[id] (trial form)');
    // Without a reason: refused, nothing starts.
    await form.getByRole('button', { name: 'Start the trial' }).click();
    await expect(visible(admin.page.getByTestId('admin-organization-trial'))).toContainText('Give a reason');
    await visible(admin.page.getByTestId('organization-trial-form')).getByLabel('Reason').fill('Demo trial for a fictional federation');
    await visible(admin.page.getByTestId('organization-trial-form')).getByRole('button', { name: 'Start the trial' }).click();
    await expect(visible(admin.page.getByTestId('admin-organization-trial')).getByTestId('organization-trial')).toHaveAttribute('data-status', 'active');
    await expect(visible(admin.page.getByTestId('trial-status'))).toContainText('Trial running');
    await expect(admin.page.getByTestId('organization-trial-form')).toHaveCount(0);
    await axeBothThemes(admin.page, '/admin/organizations/[id] (trial running)');
  } finally {
    await admin.context.close();
  }

  // The owner sees the trial and the plan; the offers continue after it.
  await page.goto(billing);
  await expect(visible(page.getByTestId('organization-billing-plan'))).toHaveAttribute('data-plan', 'federation');
  await expect(visible(page.getByTestId('organization-trial'))).toHaveAttribute('data-status', 'active');
  await expect(visible(page.getByTestId('trial-summary'))).toContainText('no card and no charge');
  await expect(visible(page.getByRole('heading', { name: 'Continue after the trial' }))).toBeVisible();
  await axeBothThemes(page, '/dashboard/organization/[id]/billing (trial)');
  const notices = await getDb().execute<{ template: string }>(sql`SELECT template FROM notification WHERE user_id = ${owner.userId}::uuid`);
  expect(notices.rows.map((r) => r.template)).toContain('federation.trial-started');

  // Yearly billing during the trial: nothing today, the first payment when the trial ends.
  await visible(page.getByTestId('offer-federation-year')).getByRole('button', { name: 'Choose yearly billing' }).click();
  await page.waitForURL(/\/billing\/test-checkout\/[0-9a-f-]{36}$/);
  await expect(visible(page.getByTestId('test-checkout-order'))).toContainText('Federation');
  await expect(visible(page.getByTestId('test-checkout-trial'))).toContainText('Nothing is charged today');
  await axeBothThemes(page, '/billing/test-checkout/[id] (during a trial)');
  await pay(page, 'Test card that succeeds', 'Subscribe with the test card');
  await page.waitForURL(new RegExp(`${billing}\\?checkout=`));
  await expect(visible(page.getByTestId('checkout-done'))).toContainText('The organization’s plan is now Federation', { timeout: 30_000 });
  await expect(visible(page.getByTestId('organization-trial'))).toHaveAttribute('data-status', 'converted');
  await expect(visible(page.getByTestId('payment-history'))).toContainText('$0.00');
  await expect(visible(page.getByTestId('billing-subscription'))).toContainText('$990.00 a year');
  // Still inside the trial's free period: a change waits for its end.
  await expect(visible(page.getByTestId('change-plan-month'))).toHaveAttribute('data-when', 'period_end');
  await axeBothThemes(page, '/dashboard/organization/[id]/billing (continued)');
});

test('@M23 monthly to yearly now, monthly again at the period end and taken back; a co-admin only reads', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { organizationId, billing } = await approvedFederation(page, browser, 'Demo Switching Federation Owner');
  await page.goto(billing);
  await visible(page.getByTestId('offer-federation-month')).getByRole('button', { name: 'Choose monthly billing' }).click();
  await page.waitForURL(/\/billing\/test-checkout\//);
  await pay(page, 'Test card that succeeds', 'Pay $99.00 in test mode');
  await expect(visible(page.getByTestId('checkout-done'))).toContainText('The organization’s plan is now Federation', { timeout: 30_000 });
  await expect(visible(page.getByTestId('payment-history'))).toContainText('$99.00');

  // An upgrade takes effect now: yearly, with the unused month credited.
  const toYear = visible(page.getByTestId('change-plan-year'));
  await expect(toYear).toHaveAttribute('data-when', 'now');
  await toYear.getByRole('button', { name: 'Switch to yearly billing' }).click();
  await expect(visible(page.getByTestId('billing-subscription'))).toContainText('$990.00 a year', { timeout: 30_000 });
  // The prorated invoice arrives with the provider's event, which the worker applies.
  await expect
    .poll(
      async () => {
        await page.goto(billing);
        return visible(page.getByTestId('payment-history')).getByRole('listitem').count();
      },
      { timeout: 30_000 },
    )
    .toBe(2);

  // A downgrade waits for the period end, and can be taken back.
  const toMonth = visible(page.getByTestId('change-plan-month'));
  await expect(toMonth).toHaveAttribute('data-when', 'period_end');
  await toMonth.getByRole('button', { name: 'Switch to monthly billing' }).click();
  await expect(visible(page.getByTestId('scheduled-change'))).toContainText('billed monthly at $99.00');
  await expect(visible(page.getByTestId('billing-subscription'))).toContainText('$990.00 a year');
  await axeBothThemes(page, '/dashboard/organization/[id]/billing (change scheduled)');
  await visible(page.getByTestId('cancel-change-form')).getByRole('button', { name: 'Keep the current plan and billing' }).click();
  await expect(page.getByTestId('scheduled-change')).toHaveCount(0);
  await expect(visible(page.getByTestId('change-plan-month'))).toBeVisible();

  // A co-admin reads the page without a form; the API refuses its change.
  const co = await freshContext(browser);
  try {
    const coAdmin = await freshAccount(co.page, { name: 'Demo Federation Co Admin' });
    const added = await apiPost(page, '/organizations/admins/add', { organizationId, email: coAdmin.email });
    expect(added.status(), await added.text()).toBe(200);
    await co.page.goto(billing);
    await expect(visible(co.page.getByTestId('organization-billing-plan'))).toHaveAttribute('data-plan', 'federation');
    await expect(visible(co.page.getByTestId('organization-billing-page'))).toContainText('Only an owner can choose or change the plan.');
    await expect(co.page.getByTestId('cancel-form')).toHaveCount(0);
    await expect(co.page.getByTestId('billing-changes')).toHaveCount(0);
    const subscriptionId = await organizationSubscriptionOf(organizationId);
    const refused = await apiPost(co.page, '/billing/change-plan', { subscriptionId, planCode: 'federation', interval: 'month' });
    expect(refused.status(), await refused.text()).toBe(403);
    // Another account is told nothing.
    const stranger = await signedIn(browser, 'user');
    try {
      expect((await stranger.page.request.get(`/api/v1/billing/organizations/${organizationId}`)).status()).toBe(404);
    } finally {
      await stranger.context.close();
    }
  } finally {
    await co.context.close();
  }
});

test('@M23 downstream independence: a member student keeps Premium Student when the trial ends early and when the subscription ends', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { organizationId, billing } = await approvedFederation(page, browser, 'Demo Downstream Federation Owner');

  // A student with its own Premium Student subscription.
  const s = await freshContext(browser);
  try {
    const student = await freshAccount(s.page, { name: 'Demo Downstream Student' });
    const checkout = await apiPost(s.page, '/billing/checkout', { planCode: 'premium_student', interval: 'month' });
    expect(checkout.status(), await checkout.text()).toBe(200);
    const { checkoutId } = (await checkout.json()) as { checkoutId: string };
    const paid = await apiPost(s.page, '/billing/test-checkout/pay', { checkoutId, card: 'succeeds' });
    expect(paid.status(), await paid.text()).toBe(200);
    await untilAttribute(s.page, '/dashboard/billing', 'billing-subscription', 'data-status', 'active');

    // The trial lets the federation list the student as a member.
    const admin = await signedIn(browser, 'admin');
    try {
      const started = await apiPost(admin.page, '/admin/organizations/trial/start', { organizationId, months: 6, reason: 'Demo downstream trial' });
      expect(started.status(), await started.text()).toBe(200);
      // Only a public profile is listed as a member: the student makes its own profile public.
      const [person] = (await getDb().execute<{ slug: string }>(sql`UPDATE person SET visibility = 'public' WHERE claimed_by_user_id = ${student.userId}::uuid RETURNING slug`)).rows;
      const memberAdded = await apiPost(page, '/organizations/members/add', { organizationId, personSlug: person!.slug });
      expect(memberAdded.status(), await memberAdded.text()).toBe(200);

      // The administrator ends the trial early on its page: the federation has no plan; the student's stays.
      await admin.page.goto(`/admin/organizations/${organizationId}`);
      const end = visible(admin.page.getByTestId('organization-trial-end-form'));
      await end.getByLabel('Reason to end the trial').fill('Demo: ended early');
      await end.getByRole('button', { name: 'End the trial now' }).click();
      await expect(visible(admin.page.getByTestId('admin-organization-trial')).getByTestId('organization-trial')).toHaveAttribute('data-status', 'revoked');
    } finally {
      await admin.context.close();
    }
    await page.goto(billing);
    await expect(visible(page.getByTestId('organization-billing-plan'))).toHaveAttribute('data-plan', 'none');
    await expect(visible(page.getByTestId('organization-trial'))).toHaveAttribute('data-status', 'revoked');
    await s.page.goto('/dashboard/billing');
    await expect(visible(s.page.getByTestId('billing-plan'))).toContainText('Premium Student');
    await expect(visible(s.page.getByTestId('billing-subscription'))).toHaveAttribute('data-status', 'active');

    // The federation subscribes, cancels, and the test clock ends it: the student's plan stays.
    await visible(page.getByTestId('offer-federation-month')).getByRole('button', { name: 'Choose monthly billing' }).click();
    await page.waitForURL(/\/billing\/test-checkout\//);
    await pay(page, 'Test card that succeeds', 'Pay $99.00 in test mode');
    await expect(visible(page.getByTestId('checkout-done'))).toContainText('The organization’s plan is now Federation', { timeout: 30_000 });
    await visible(page.getByTestId('billing-subscription')).getByRole('button', { name: 'Cancel at the end of the period' }).click();
    await expect(visible(page.getByTestId('subscription-status')).first()).toContainText('Cancels at the period end');
    const subscriptionId = await organizationSubscriptionOf(organizationId);
    const clock = await signedIn(browser, 'admin');
    try {
      await clock.page.goto(`/admin/billing/${subscriptionId}`);
      await visible(clock.page.getByTestId('test-clock')).getByRole('button', { name: 'Move to the end of the period' }).click();
      await expect(visible(clock.page.getByTestId('test-clock'))).not.toContainText('Moving the test clock');
    } finally {
      await clock.context.close();
    }
    await untilAttribute(page, billing, 'organization-billing-plan', 'data-plan', 'none');
    await expect(visible(page.getByTestId('earlier-subscription'))).toHaveCount(1);
    await s.page.goto('/dashboard/billing');
    await expect(visible(s.page.getByTestId('billing-plan'))).toContainText('Premium Student');
    await expect(visible(s.page.getByTestId('billing-subscription'))).toHaveAttribute('data-status', 'active');
    // The membership stays as it was.
    const memberships = await getDb().execute(sql`SELECT 1 FROM organization_membership WHERE organization_id = ${organizationId}::uuid`);
    expect(memberships.rows).toHaveLength(1);
    // The student never hears of the federation's billing.
    const heard = await getDb().execute(sql`SELECT 1 FROM notification WHERE user_id = ${student.userId}::uuid AND (template LIKE 'federation.%' OR payload->>'organizationId' = ${organizationId})`);
    expect(heard.rows).toHaveLength(0);
  } finally {
    await s.context.close();
  }
});
