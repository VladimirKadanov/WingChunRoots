// The control panel's lists (docs/adr/0038-control-panel-pages.md): the review queue's saved views
// and filters, the schools and organizations tables with their search, the billing figures and
// filters, and the system status with its problems first. Server-rendered lists: every filter is a
// link or a GET form, so the state is in the address. Fictional data only (D20).

import { expect, test, type Locator, type Page } from '@playwright/test';

import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations } from './helpers/ui';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

const visible = (locator: Locator) => locator.filter({ visible: true });

async function admin(browser: import('@playwright/test').Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, 'admin');
  return { page, close: () => context.close() };
}

/** The total of a count line ("Cases 1 to 5 of 12", or "No cases match."). */
async function totalOf(line: Locator): Promise<number> {
  const text = (await line.innerText()).replace(/\s+/g, ' ');
  const match = / of (\d+)/.exec(text);
  return match ? Number(match[1]) : 0;
}

test('@controlpanel @admin the review queue: each saved view shows as many cases as its count; filters and the waiting column', async ({ browser }) => {
  const { page, close } = await admin(browser);
  await page.goto('/admin/review');
  const views = visible(page.getByRole('navigation', { name: 'Saved views of the queue' }));
  await expect(views.getByRole('link', { name: /^All waiting/ })).toHaveAttribute('aria-current', 'page');
  await expectNoAxeViolations(page, '/admin/review (saved views)');
  for (const testId of ['view-all', 'view-decide', 'view-mine', 'view-unassigned', 'view-late']) {
    const link = visible(page.getByTestId(testId));
    const count = Number((await link.innerText()).match(/(\d+)\s*$/)![1]);
    await link.click();
    await expect(visible(page.getByTestId(testId))).toHaveAttribute('aria-current', 'page');
    expect(await totalOf(visible(page.getByTestId('queue-count'))), testId).toBe(count);
  }
  // A group from the dashboard's list opens with ?group=; the form keeps it and adds the waiting time.
  await page.goto('/admin/review?group=claims');
  await expect(visible(page.locator('#filter-group'))).toHaveValue('claims');
  await visible(page.locator('#filter-age')).selectOption('7d');
  await visible(page.getByRole('button', { name: 'Show cases' })).click();
  await page.waitForURL(/[?&]age=7d/);
  expect(new URL(page.url()).searchParams.get('group')).toBe('claims');
  // Every row says how long it waited; a late one says so in words as well as with a mark.
  await page.goto('/admin/review?status=all');
  const rows = visible(page.getByTestId('review-row'));
  if ((await rows.count()) > 0) await expect(rows.first().locator('td').nth(4)).toContainText(/\d+ (day|days|h)|under 1 h|—/);
  for (const late of await visible(page.getByTestId('case-late')).all()) await expect(late).toContainText('over 3 days');
  await close();
});

test('@controlpanel @admin the review queue on a phone: the saved views stay, the dropdowns fold behind More filters (role replay P2-11)', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 } });
  await giveOwnAddress(context);
  const page = await context.newPage();
  await signInAs(page, 'admin');
  await page.goto('/admin/review');
  await expect(visible(page.getByTestId('queue-summary'))).toContainText(/\d+ for you to decide/);
  await expect(visible(page.getByTestId('view-decide'))).toBeVisible();
  const more = page.getByTestId('queue-filters').getByTestId('filters');
  await expect(more.locator(':scope > summary')).toContainText('More filters');
  await expect(page.locator('#filter-kind')).toBeHidden();
  await more.locator(':scope > summary').click();
  await expect(page.locator('#filter-kind')).toBeVisible();
  await page.locator('#filter-age').selectOption('7d');
  await page.getByRole('button', { name: 'Show cases' }).click();
  await page.waitForURL(/[?&]age=7d/);
  await expect(page.getByTestId('queue-filters').getByTestId('filters').locator(':scope > summary')).toContainText('More filters · 1');
  await context.close();
});

test('@controlpanel @admin schools and organizations: a table searched by name, with the stage and approval filters', async ({ browser }) => {
  const { page, close } = await admin(browser);
  await page.goto('/admin/schools');
  const first = visible(page.getByTestId('admin-school')).first();
  const slug = (await first.getAttribute('data-slug'))!;
  await visible(page.getByLabel('School, city or address')).fill(slug);
  await visible(page.getByRole('button', { name: 'Search' })).click();
  await page.waitForURL(/[?&]q=/);
  await expect(visible(page.locator(`[data-testid="admin-school"][data-slug="${slug}"]`))).toHaveCount(1);
  await expect(visible(page.getByTestId('admin-schools-count'))).toContainText(/Schools 1 to \d+ of \d+/);
  // The stage links keep the search.
  expect(await visible(page.locator('[data-testid="admin-schools-stage"][data-stage="hidden"]')).getAttribute('href')).toContain(`q=${slug}`);
  await visible(page.getByLabel('School, city or address')).fill('zz-no-such-demo-school');
  await visible(page.getByRole('button', { name: 'Search' })).click();
  await expect(visible(page.getByTestId('admin-schools-empty'))).toContainText('clear the search');
  await expectNoAxeViolations(page, '/admin/schools (no match)');

  await page.goto('/admin/organizations');
  await expectNoAxeViolations(page, '/admin/organizations');
  const orgs = visible(page.getByTestId('admin-organization'));
  const all = await orgs.count();
  expect(all).toBeGreaterThan(0);
  await visible(page.getByLabel('Approval')).selectOption('active');
  await visible(page.getByRole('button', { name: 'Show', exact: true })).click();
  await page.waitForURL(/[?&]status=active/);
  for (const row of await orgs.all()) await expect(row).toHaveAttribute('data-status', 'active');
  // A malformed filter falls back to the default instead of an error page.
  await page.goto('/admin/organizations?status=nope&plan=nope');
  await expect(orgs).toHaveCount(all);
  await close();
});

test('@controlpanel @admin billing: the figures, the value by plan and the subscriptions filtered by plan and holder', async ({ browser }) => {
  const { page, close } = await admin(browser);
  await page.goto('/admin/billing');
  await expect(visible(page.getByTestId('admin-billing-figures'))).toContainText('Monthly recurring value');
  await expect(visible(page.getByTestId('admin-billing-by-plan'))).toContainText('Premium Student');
  await expectNoAxeViolations(page, '/admin/billing (figures)');
  await visible(page.getByLabel('Plan', { exact: true })).selectOption('premium_student');
  await visible(page.getByRole('button', { name: 'Show', exact: true })).click();
  await page.waitForURL(/[?&]plan=premium_student/);
  await expect(visible(page.getByRole('link', { name: 'Premium Student · demo-premium-student@example.test' }))).toBeVisible();
  await expect(page.getByRole('link', { name: /^Professional Sifu · / })).toHaveCount(0);
  await page.goto('/admin/billing?q=demo-free-sifu-5');
  await expect(visible(page.getByTestId('admin-subscription'))).toHaveCount(1);
  // A failed payment is said in words, not by colour alone.
  for (const row of await visible(page.locator('[data-testid="admin-subscription"][data-status="past_due"]')).all()) {
    await expect(row.getByTestId('admin-subscription-attention')).toHaveText(/Needs a look/);
  }
  await close();
});

test('@controlpanel @admin system status: what needs attention comes first, in words', async ({ browser }) => {
  const { page, close } = await admin(browser);
  await page.goto('/admin/system');
  const problems = visible(page.getByTestId('system-problems'));
  await expect(problems).toBeVisible();
  const state = await problems.getAttribute('data-state');
  const sections = await visible(page.locator('[data-testid$="-section"]')).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  const verdicts = await visible(page.locator('[data-testid$="-verdict"]')).evaluateAll((els) => els.map((el) => el.getAttribute('data-state')));
  expect(sections.length).toBe(3);
  // Sections that need attention come before the ones that are fine.
  const firstOk = verdicts.indexOf('ok');
  if (firstOk >= 0) expect(verdicts.slice(firstOk)).not.toContain('attention');
  expect(state).toBe(verdicts.includes('attention') ? 'attention' : 'ok');
  if (state === 'attention') await expect(problems.getByRole('link', { name: 'Show it' }).first()).toHaveAttribute('href', /^#(queues|email|backup)$/);
  await expectNoAxeViolations(page, '/admin/system (problems first)');
  await close();
});
