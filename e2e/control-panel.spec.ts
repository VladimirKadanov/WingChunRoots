// The control panel (docs/adr/0035-control-panel.md): the shell's account entry (Sign in and Create
// account when signed out; the account menu with the account's own pages and Sign out when signed
// in; the Control panel row for staff only), the admin sidebar on every /admin page with the current
// section marked, the dashboard figures and the accounts table. Fictional data only (D20).

import { expect, test, type Locator } from '@playwright/test';

import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations } from './helpers/ui';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

const visible = (locator: Locator) => locator.filter({ visible: true });

test('@controlpanel signed out, the shell offers Sign in (and, in the rail, Create account)', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(visible(page.getByTestId('shell-sign-in')).first()).toHaveAttribute('href', /\/sign-in/);
  if (!testInfo.project.name.startsWith('mobile')) {
    await expect(visible(page.getByTestId('shell-sign-up')).first()).toHaveAttribute('href', /\/sign-up/);
  }
  await expect(visible(page.getByTestId('account-menu-trigger'))).toHaveCount(0);
});

test('@controlpanel a member opens the account menu, sees their own pages and no control panel, and signs out', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  const account = await signInAs(page, 'new');
  await page.goto('/dashboard');
  const trigger = visible(page.getByTestId('account-menu-trigger')).first();
  await trigger.click();
  const menu = visible(page.getByTestId('account-menu'));
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(account.email);
  for (const name of ['My dashboard', 'My profile', 'Notifications', 'Plan and billing', 'Account and security', 'Privacy and your data']) {
    await expect(menu.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(menu.getByTestId('account-menu-control-panel')).toHaveCount(0);
  await expectNoAxeViolations(page, 'the open account menu');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await trigger.click();
  await visible(page.getByTestId('account-menu')).getByTestId('account-menu-sign-out').click();
  await page.waitForURL(/\/sign-in/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in/);
  await context.close();
});

test('@controlpanel @admin an administrator reaches the control panel from the account menu and moves through the sidebar', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, 'admin');
  await page.goto('/dashboard');
  await visible(page.getByTestId('account-menu-trigger')).first().click();
  await visible(page.getByTestId('account-menu')).getByTestId('account-menu-control-panel').click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  const nav = visible(page.getByTestId('admin-nav'));
  const current = () => visible(nav.locator('a[aria-current="page"]'));
  await expect(current()).toHaveText(/^Dashboard/);
  if (testInfo.project.name.startsWith('mobile')) {
    await visible(nav.getByRole('link', { name: /^Accounts/ })).click();
  } else {
    for (const group of ['Overview', 'Queues', 'Directory', 'Archive', 'Money', 'System']) await expect(nav).toContainText(group);
    await visible(nav.getByRole('link', { name: /^Accounts/ })).click();
  }
  await page.waitForURL(/\/admin\/accounts/);
  await expect(current()).toHaveText(/^Accounts/);

  // The accounts table: every account, searchable, with a count line.
  await expect(visible(page.getByTestId('accounts-table'))).toBeVisible();
  await expect(visible(page.getByTestId('accounts-count'))).toContainText(/\d+/);
  await page.goto('/admin/accounts?state=staff');
  const rows = visible(page.locator('[data-account]'));
  await expect(rows.first()).toBeVisible();
  await expectNoAxeViolations(page, 'the accounts table');

  // A page below a section marks that section.
  await page.goto('/admin/review');
  await expect(current()).toHaveText(/^Review requests/);
  await context.close();
});

test('@controlpanel @admin a moderator sees only the sections they may open', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, 'moderator');
  await page.goto('/admin');
  const nav = visible(page.getByTestId('admin-nav'));
  await expect(nav.getByRole('link', { name: /^Review requests/ }).first()).toBeAttached();
  await expect(nav.getByRole('link', { name: /^Billing/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /^Accounts/ })).toHaveCount(0);
  await context.close();
});
