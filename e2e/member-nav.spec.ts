/**
 * Member navigation (owner request 2026-11-17, docs/adr/0039-member-navigation.md): the dashboard
 * menu shows each account only the groups it uses and marks the current page in words and shape,
 * the dashboard home lists the next steps of a new account, and the home page knows a member is
 * signed in. Only reads, so it runs in the ordinary projects. Fictional demo accounts (D20).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations } from './helpers/ui';
import { openDashboardMenu } from './helpers/phone-layout';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** Only what is on screen: the phone menu and the desktop sidebar are both in the page, one hidden. */
const shown = (locator: Locator) => locator.filter({ visible: true });
const menu = (page: Page) => page.getByRole('navigation', { name: 'Dashboard' });
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

test('@nav a student sees learning and their own pages, never teaching or organizations', async ({ page }) => {
  await signInAs(page, 'demo-premium-student');
  await page.goto('/dashboard');
  // ADR 0053: below 1024 px one button names the page and opens the menu.
  if (isPhone(page)) await expect(page.getByTestId('dashboard-menu').filter({ visible: true }).locator(':scope > summary')).toContainText('Dashboard · Overview');
  await openDashboardMenu(page);
  const nav = menu(page);
  await expect(shown(nav.getByRole('link', { name: 'Overview' }))).toHaveAttribute('aria-current', 'page');
  for (const name of ['My teachers', 'Training passport', 'Trial lessons', 'Profile', 'Plan and billing', 'Settings']) {
    await expect(shown(nav.getByRole('link', { name, exact: true }))).toHaveCount(1);
  }
  // Role replay 2026-11-25 (P2-7): Digital successor is a Sifu's page (or one's own nomination).
  for (const name of ['Student requests', 'My schools', 'Instructor verification', 'Digital successor']) {
    await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  // The menu follows the page: the passport is current there.
  await shown(nav.getByRole('link', { name: 'Training passport' })).click();
  await expect(page).toHaveURL(/\/dashboard\/passport$/);
  if (isPhone(page)) await expect(page.getByTestId('dashboard-menu').filter({ visible: true }).locator(':scope > summary')).toContainText('Dashboard · Training passport');
  await openDashboardMenu(page);
  await expect(shown(menu(page).getByRole('link', { name: 'Training passport' }))).toHaveAttribute('aria-current', 'page');
  await expectNoAxeViolations(page, 'dashboard menu (student)');
});

test('@nav an organization owner reaches their organization from the dashboard menu', async ({ page }) => {
  await signInAs(page, 'demo-federation-owner');
  await page.goto('/dashboard');
  await openDashboardMenu(page);
  const link = shown(menu(page).getByRole('link', { name: 'All your organizations' }));
  await expect(link).toHaveAttribute('href', '/dashboard/organization');
  const own = shown(menu(page).locator('a[href^="/dashboard/organization/"]')).first();
  await expect(own).toBeVisible();
  await own.click();
  await expect(page).toHaveURL(/\/dashboard\/organization\/[0-9a-f-]+$/);
  await openDashboardMenu(page);
  await expect(shown(menu(page).locator('a[aria-current="page"]'))).toHaveCount(1);
});

test('@nav a Sifu gets teaching tools, and a new member gets next steps that start with the profile', async ({ page, browser }) => {
  await signInAs(page, 'demo-pro-sifu-8');
  await page.goto('/dashboard');
  await openDashboardMenu(page);
  for (const name of ['Student requests', 'My schools', 'Events']) {
    await expect(shown(menu(page).getByRole('link', { name, exact: true }))).toHaveCount(1);
  }
  // P2-7: Teaching first, then Schools and events, then the Sifu's own training.
  const groupOrder = await shown(menu(page).locator('p.uppercase')).allTextContents();
  expect(groupOrder.slice(0, 4).map((t) => t.toLowerCase())).toEqual(['overview', 'teaching', 'schools and events', 'my training']);

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
    // Role replay P2-6: someone who only manages an organization can leave onboarding for it.
    await fresh.goto('/onboarding');
    await fresh.getByTestId('organization-only').getByRole('link', { name: 'I only manage an organization' }).click();
    await expect(fresh).toHaveURL(/\/dashboard\/organization$/);
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

test('@nav a Premium Student sees "Your Premium" with the pages the plan adds; a free account does not (role replay P3-3)', async ({ page }) => {
  await signInAs(page, 'demo-premium-student');
  await page.goto('/dashboard');
  const strip = shown(page.getByTestId('your-premium'));
  await expect(strip.getByRole('heading', { level: 2 })).toHaveText('Your Premium Student');
  await expect(strip.getByRole('link', { name: /Your passport timeline/ })).toHaveAttribute('href', '/dashboard/passport');
  await expect(strip.getByRole('link', { name: /Kung fu family/ })).toHaveAttribute('href', '/dashboard/family');
  await expect(strip.getByRole('link', { name: /Your lineage card/ })).toHaveAttribute('href', /^\/people\/demo-[a-z0-9-]+\/card$/);
  await page.context().clearCookies();
  await signInAs(page, 'demo-root-a');
  await page.goto('/dashboard');
  await expect(page.getByTestId('next-steps').or(page.getByTestId('plan-name')).first()).toBeVisible();
  await expect(page.getByTestId('your-premium')).toHaveCount(0);
});
