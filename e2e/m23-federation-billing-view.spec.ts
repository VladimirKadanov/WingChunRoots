/**
 * Milestone M23: Federation billing as it is seen (docs/adr/0026-federation-billing.md), on the
 * desktop and the phone, from the seeded demo data: demo-federation-owner owns
 * demo-federation-north, which holds a Federation test plan; its billing page shows the plan, what
 * Federation gives now, monthly and yearly offers with proposed prices and the note that member
 * schools and students keep their own plans. demo-organization-admin, an admin but not an owner,
 * reads the same page without a form. The administrator's page of the organization says why no
 * trial can start (it holds Federation already). /plans points federation owners to the billing
 * page. axe runs in both themes; on a phone every control is at least 44 px. It only reads, so it
 * runs in the ordinary projects. Fictional (D20).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
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
    els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => ({ h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width, text: el.textContent ?? '' })),
  );
  expect(boxes.length, selector).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.h, `${selector}: ${box.text}`).toBeGreaterThanOrEqual(44);
    expect(box.w, `${selector}: ${box.text}`).toBeGreaterThanOrEqual(44);
  }
}

async function demoFederation(): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM organization WHERE slug = 'demo-federation-north'`);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]!.id;
}

test('@M23 the owner of the demo federation: its plan, what it gives now and the monthly and yearly offers', async ({ page }, testInfo) => {
  const id = await demoFederation();
  await signInAs(page, 'demo-federation-owner');
  await page.goto(`/dashboard/organization/${id}`);
  await expect(shown(page.getByTestId('organization-billing-link'))).toHaveAttribute('href', `/dashboard/organization/${id}/billing`);
  await page.goto(`/dashboard/organization/${id}/billing`);
  await expect(shown(page.getByTestId('test-mode-banner'))).toContainText('Test mode, no real charge');
  await expect(shown(page.getByTestId('organization-billing-plan'))).toHaveAttribute('data-plan', 'federation');
  await expect(shown(page.getByTestId('federation-benefits')).getByRole('listitem')).toHaveCount(3);
  await expect(shown(page.getByTestId('organization-billing-page'))).toContainText('Member schools and students keep their own plans');
  await expect(shown(page.getByTestId('offer-federation-month'))).toContainText('$99.00 a month');
  await expect(shown(page.getByTestId('offer-federation-year'))).toContainText('$990.00 a year');
  await expect(shown(page.getByText('Proposed price (not final)'))).toHaveCount(2);
  await expect(page.getByTestId('organization-trial')).toHaveCount(0);
  await expect(shown(page.getByTestId('no-payments'))).toBeVisible();
  await axeBothThemes(page, '/dashboard/organization/[id]/billing (owner)');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid^="offer-federation-"] button');
});

test('@M23 an admin who is not an owner reads the page without a form; another account gets 404', async ({ page, browser }) => {
  const id = await demoFederation();
  await signInAs(page, 'demo-organization-admin');
  await page.goto(`/dashboard/organization/${id}/billing`);
  await expect(shown(page.getByTestId('organization-billing-plan'))).toHaveAttribute('data-plan', 'federation');
  await expect(shown(page.getByTestId('organization-offers-note'))).toContainText('Only an owner of the organization can choose its plan.');
  await expect(page.locator('[data-testid^="offer-federation-"]')).toHaveCount(0);
  await axeBothThemes(page, '/dashboard/organization/[id]/billing (admin)');

  const other = await browser.newContext({ baseURL: BASE_URL });
  try {
    await giveOwnAddress(other);
    const otherPage = await other.newPage();
    await signInAs(otherPage, 'demo-premium-student');
    expect((await otherPage.request.get(`/api/v1/billing/organizations/${id}`)).status()).toBe(404);
    await otherPage.goto(`/dashboard/organization/${id}/billing`);
    await expect(shown(otherPage.getByTestId('organization-billing-not-found'))).toBeVisible();
    await expect(otherPage.getByTestId('organization-billing-plan')).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('@M23 the administrator’s page of the demo federation says why no trial can start', async ({ page }) => {
  const id = await demoFederation();
  await signInAs(page, 'admin');
  await page.goto(`/admin/organizations/${id}`);
  const section = shown(page.getByTestId('admin-organization-trial'));
  await expect(section).toContainText('A trial without a card');
  await expect(section.getByTestId('organization-trial-note')).toContainText('holds Federation already');
  await expect(page.getByTestId('organization-trial-form')).toHaveCount(0);
  await axeBothThemes(page, '/admin/organizations/[id] (no trial)');
});

test('@M23 /plans points the owner of an approved federation to the billing page, and sells nothing itself', async ({ page }) => {
  await page.goto('/plans');
  const section = shown(page.locator('section#organizations'));
  await expect(section.getByRole('link', { name: 'the organization’s billing page' })).toHaveAttribute('href', '/dashboard/organization');
  await expect(section).toContainText('test mode, with no real charge');
  await expect(page.getByTestId('choose-federation')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
});
