// The control panel's reports (docs/adr/0041-control-panel-reports.md): one report at a time from
// the list beside it, the period from a GET form, server-drawn charts with their numbers in a
// table, and a CSV download per table. Billing for administrators only. Fictional data only (D20).

import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations } from './helpers/ui';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

const visible = (locator: Locator) => locator.filter({ visible: true });

async function as(browser: Browser, who: 'admin' | 'moderator'): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, who);
  return { page, close: () => context.close() };
}

test('@controlpanel @admin reports: from the sidebar, each report, the period form and a CSV download', async ({ browser }) => {
  const { page, close } = await as(browser, 'admin');
  await page.goto('/admin');
  await visible(visible(page.getByTestId('admin-nav')).getByRole('link', { name: /^Reports/ })).click();
  await page.waitForURL(/\/admin\/reports$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  await expect(visible(visible(page.getByTestId('admin-nav')).locator('a[aria-current="page"]'))).toHaveText(/^Reports/);
  await expect(page.getByTestId('report')).toHaveAttribute('data-report', 'growth');
  await expect(page.getByTestId('growth-total')).toHaveCount(4);
  // The chart's numbers are in a table for screen readers: 13 weeks by default.
  await expect(page.locator('figure table.sr-only').first().locator('tbody tr')).toHaveCount(13);
  // No script of the page's own: the period is a GET form.
  await page.locator('#report-period').selectOption('12m');
  await page.getByRole('button', { name: 'Show' }).click();
  await page.waitForURL(/[?&]period=12m/);
  await expect(page.locator('figure table.sr-only').first().locator('tbody tr')).toHaveCount(12);

  const list = page.getByTestId('report-list');
  for (const key of ['review', 'archive', 'schools', 'billing']) {
    await list.locator(`[data-report="${key}"]`).click();
    await page.waitForURL(new RegExp(`report=${key}`));
    expect(new URL(page.url()).searchParams.get('period')).toBe('12m');
    await expect(page.getByTestId('report')).toHaveAttribute('data-report', key);
    await expect(list.locator(`[data-report="${key}"]`)).toHaveAttribute('aria-current', 'page');
  }
  await expectNoAxeViolations(page, '/admin/reports (billing)');

  // The review report: a row per group and the total; its CSV has the same groups.
  await page.goto('/admin/reports?report=review&period=30d');
  await expect(visible(page.getByTestId('review-group-row')).first()).toBeVisible();
  await expect(visible(page.getByTestId('review-group-total'))).toContainText('All groups');
  await expectNoAxeViolations(page, '/admin/reports (review)');
  const csv = page.getByTestId('report-csv').filter({ hasText: 'Download CSV' }).last();
  const href = await csv.getAttribute('href');
  expect(href).toBe('/api/admin/reports/review-groups?period=30d');
  const answer = await page.request.get(href!);
  expect(answer.status()).toBe(200);
  expect(answer.headers()['content-type']).toContain('text/csv');
  expect(answer.headers()['cache-control']).toBe('no-store');
  expect(answer.headers()['content-disposition']).toMatch(/^attachment; filename="wingchunroots-review-groups-30d-\d{4}-\d{2}-\d{2}\.csv"$/);
  const lines = (await answer.text()).trim().split('\r\n');
  expect(lines[0]).toBe('Group,Opened,Decided,Approved,Rejected,Closed without a decision,Median days to decision,Appealed,Open now');
  expect(lines.at(-1)).toMatch(/^All groups,/);
  expect((await page.request.get('/api/admin/reports/nothing?period=30d')).status()).toBe(404);
  await close();
});

test('@controlpanel @admin reports: a moderator gets no billing report, and a signed-out visitor no CSV', async ({ browser }) => {
  const { page, close } = await as(browser, 'moderator');
  await page.goto('/admin/reports');
  await expect(page.getByTestId('report-list').locator('[data-report="billing"]')).toHaveCount(0);
  await page.goto('/admin/reports?report=billing');
  await expect(page.getByTestId('report')).toHaveAttribute('data-report', 'growth');
  expect((await page.request.get('/api/admin/reports/billing-plans?period=90d')).status()).toBe(403);
  expect((await page.request.get('/api/admin/reports/growth?period=90d')).status()).toBe(200);
  await close();
  const anonymous = await browser.newContext({ baseURL: BASE_URL });
  expect((await anonymous.request.get('/api/admin/reports/growth?period=90d')).status()).toBe(401);
  await anonymous.close();
});
