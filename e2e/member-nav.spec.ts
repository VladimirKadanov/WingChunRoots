/**
 * Member navigation (owner request 2026-11-17, docs/adr/0036-member-navigation.md): the dashboard
 * menu shows each account only the groups it uses and marks the current page in words and shape,
 * the dashboard home lists the next steps of a new account, and the home page knows a member is
 * signed in. Only reads, so it runs in the ordinary projects. Fictional demo accounts (D20).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations } from './helpers/ui';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** Only what is on screen: the phone row and the desktop sidebar are both in the page, one hidden. */
const shown = (locator: Locator) => locator.filter({ visible: true });
const menu = (page: Page) => page.getByRole('navigation', { name: 'Dashboard' });

test('@nav a student sees learning and their own pages, never teaching or organizations', async ({ page }) => {
  await signInAs(page, 'demo-premium-student');
  await page.goto('/dashboard');
  const nav = menu(page);
  await expect(shown(nav.getByRole('link', { name: 'Overview' }))).toHaveAttribute('aria-current', 'page');
  for (const name of ['My teachers', 'Training passport', 'Trial lessons', 'Profile', 'Plan and billing', 'Settings']) {
    await expect(shown(nav.getByRole('link', { name, exact: true }))).toHaveCount(1);
  }
  for (const name of ['Student requests', 'My schools', 'Instructor verification']) {
    await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  // The menu follows the page: the passport is current there.
  await shown(nav.getByRole('link', { name: 'Training passport' })).click();
  await expect(page).toHaveURL(/\/dashboard\/passport$/);
  await expect(shown(menu(page).getByRole('link', { name: 'Training passport' }))).toHaveAttribute('aria-current', 'page');
  await expectNoAxeViolations(page, 'dashboard menu (student)');
});

test('@nav an organization owner reaches their organization from the dashboard menu', async ({ page }) => {
  await signInAs(page, 'demo-federation-owner');
  await page.goto('/dashboard');
  const link = shown(menu(page).getByRole('link', { name: 'All your organizations' }));
  await expect(link).toHaveAttribute('href', '/dashboard/organization');
  const own = shown(menu(page).locator('a[href^="/dashboard/organization/"]')).first();
  await expect(own).toBeVisible();
  await own.click();
  await expect(page).toHaveURL(/\/dashboard\/organization\/[0-9a-f-]+$/);
  await expect(shown(menu(page).locator('a[aria-current="page"]'))).toHaveCount(1);
});

test('@nav a Sifu gets teaching tools, and a new member gets next steps that start with the profile', async ({ page, browser }) => {
  await signInAs(page, 'demo-pro-sifu-8');
  await page.goto('/dashboard');
  for (const name of ['Student requests', 'My schools', 'Events']) {
    await expect(shown(menu(page).getByRole('link', { name, exact: true }))).toHaveCount(1);
  }

  const context = await browser.newContext();
  try {
    await giveOwnAddress(context);
    const fresh = await context.newPage();
    await signInAs(fresh, 'new');
    await fresh.goto('/dashboard');
    const steps = fresh.getByTestId('next-steps');
    await expect(steps.getByRole('heading', { level: 2, name: 'Get started' })).toBeVisible();
    await expect(steps).toContainText('0 of 2 done');
    await expect(fresh.getByTestId('next-step-profile')).toHaveAttribute('data-done', 'false');
    await expect(steps.getByRole('link', { name: 'Set up your profile' })).toHaveAttribute('href', '/onboarding?next=%2Fdashboard');
  } finally {
    await context.close();
  }
});

test('@nav the home page offers a member their dashboard instead of signing up', async ({ page }) => {
  await page.goto('/');
  await expect(shown(page.getByTestId('home-account'))).toHaveAttribute('data-signed-in', 'false');
  await expect(shown(page.getByTestId('home-account')).getByRole('link', { name: 'Create an account' })).toBeVisible();
  await signInAs(page, 'demo-pending');
  await page.goto('/');
  await expect(shown(page.getByTestId('home-account'))).toHaveAttribute('data-signed-in', 'true');
  await expect(shown(page.getByTestId('home-account')).getByRole('link', { name: 'Open your dashboard' })).toHaveAttribute('href', '/dashboard');
  await expect(shown(page.getByTestId('home-account')).getByRole('link', { name: 'Create an account' })).toHaveCount(0);
});
