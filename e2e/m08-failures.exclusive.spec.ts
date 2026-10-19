// M08 final check: what the M08 pages do when a read fails, and what the server log keeps of it.
//
// Each test holds an ACCESS EXCLUSIVE lock on a whole table, so the page's read waits until the
// statement timeout (2 s, plan §6.1) ends it with a DrizzleQueryError whose text quotes its SQL
// parameters (the e-mail address an administrator searched for, an account's id). Every other test
// would wait on that lock too, so this file runs only in the `exclusive` project, in a Playwright
// run of its own after the ordinary one, one test at a time (e2e/projects.ts, EXCLUSIVE_SPEC):
// `PW_EXCLUSIVE=1 pnpm e2e`, which scripts/verify.sh runs after the ordinary run.
//
//   requirements-2: /dashboard, /dashboard/settings and /admin/grants show their error state inside
//                   the app shell, with "Try again", with and without JavaScript.
//   security-1:     the server log has the one safe line of serverClient() and never the address or
//                   the account id, also for a page that awaits the read without a catch (/account,
//                   its own two-factor read).
//   polish, note 1: /account (milestone M02) shows the unread count M08 added to its dashboard link;
//                   when that read fails, the page renders in full without the count, never Next.js's
//                   bare error page.

import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { getDb } from '../src/server/db';
import { notification } from '../src/server/db/schema';
import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { freshAccount, signInSeededAdmin } from './helpers/plans';
import { runPaths } from './projects';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

type LockedTable = 'notification' | 'entitlement_grant' | 'auth_two_factor';

/** Runs `run` while another connection holds an ACCESS EXCLUSIVE lock on `table`. */
async function whileLocked<T>(table: LockedTable, run: () => Promise<T>): Promise<T> {
  const holder = await getDb().$client.connect();
  try {
    await holder.query('BEGIN');
    // A fixed list of table names: nothing from outside reaches this statement.
    await holder.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    return await run();
  } finally {
    await holder.query('ROLLBACK').catch(() => {});
    holder.release();
  }
}

// The web server of this run (PW_EXCLUSIVE=1) writes its own log.
const serverLog = () => readFileSync(runPaths(true).serverLog, 'utf8');

/** The page's error state: inside the app shell (its main navigation), with its message and "Try again". */
async function expectErrorState(page: Page, title: string, message: string) {
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const alert = page.getByTestId('load-error');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(message);
  await expect(alert.getByTestId('load-error-retry')).toHaveText('Try again');
}

/** A context like `context` (same cookies and client address), with JavaScript off. */
async function withoutJavaScript(browser: Browser, context: BrowserContext): Promise<{ context: BrowserContext; page: Page }> {
  const copy = await browser.newContext({ baseURL: BASE_URL, javaScriptEnabled: false, storageState: await context.storageState() });
  await giveOwnAddress(copy);
  return { context: copy, page: await copy.newPage() };
}

test('@M08 a failed read of /dashboard shows the error state in the app shell; "Try again" brings the dashboard back, with and without JavaScript', async ({ page, browser }) => {
  const account = await freshAccount(page, { name: 'Demo Locked Dashboard', sifu: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // With JavaScript: the error state, then "Try again" refreshes the page in place.
  await whileLocked('notification', async () => {
    await page.goto('/dashboard');
    await expectErrorState(page, 'Your dashboard', "We couldn't load your dashboard. Nothing was changed.");
  });
  await page.getByTestId('load-error-retry').click();
  await expect(page.getByTestId('account-type')).toHaveText('Sifu');
  await expect(page.getByTestId('load-error')).toHaveCount(0);
  expect(errors, 'no uncaught error').toEqual([]);

  // /dashboard/settings reads the plan: the same state under a lock on the grants.
  await whileLocked('entitlement_grant', async () => {
    await page.goto('/dashboard/settings');
    await expectErrorState(page, 'Account type and plan', "We couldn't load your account type and plan. Nothing was changed.");
  });
  await page.getByTestId('load-error-retry').click();
  await expect(page.getByTestId('settings-plan')).toContainText('Free Sifu');
  await expect(page.getByTestId('load-error')).toHaveCount(0);

  // Without JavaScript: the same state from the server, and "Try again" is a link to the page.
  const noJs = await withoutJavaScript(browser, page.context());
  try {
    await whileLocked('notification', async () => {
      await noJs.page.goto('/dashboard');
      await expectErrorState(noJs.page, 'Your dashboard', "We couldn't load your dashboard. Nothing was changed.");
      await expect(noJs.page.getByTestId('load-error-retry')).toHaveAttribute('href', '/dashboard');
    });
    await noJs.page.getByTestId('load-error-retry').click();
    await expect(noJs.page.getByTestId('account-type')).toHaveText('Sifu');
    await expect(noJs.page.getByTestId('load-error')).toHaveCount(0);
  } finally {
    await noJs.context.close();
  }

  // The log has the safe line of each failed read, and never the account's id (CLAUDE.md §6).
  const log = serverLog();
  expect(log).toMatch(/rpc dashboard\.overview failed: DrizzleQueryError \(postgres 57014\) request /);
  expect(log).toMatch(/rpc plans\.mine failed: DrizzleQueryError \(postgres 57014\) request /);
  expect(log).not.toContain(account.userId);
  expect(log).not.toContain(account.email);
});

test('@M08 a failed read of /admin/grants shows the error state and keeps the searched e-mail address out of the server log', async ({ page, browser }) => {
  const account = await freshAccount(page, { name: 'Demo Searched Sifu', sifu: true });
  const admin = await browser.newContext({ baseURL: BASE_URL });
  await giveOwnAddress(admin);
  await signInSeededAdmin(admin, { verified: true });
  const search = `/admin/grants?q=${encodeURIComponent(account.email)}`;
  try {
    const a = await admin.newPage();
    const errors: string[] = [];
    a.on('pageerror', (error) => errors.push(error.message));
    await whileLocked('entitlement_grant', async () => {
      await a.goto(search);
      await expectErrorState(a, 'Plan grants', "We couldn't load the plan grants. Nothing was changed.");
      // "Try again" asks for the same address: the search stays.
      await expect(a.getByTestId('load-error-retry')).toHaveAttribute('href', search);
    });
    await a.getByTestId('load-error-retry').click();
    await expect(a.getByTestId('load-error')).toHaveCount(0);
    await expect(a.getByLabel('Find by e-mail')).toHaveValue(account.email);
    expect(errors, 'no uncaught error').toEqual([]);
  } finally {
    await admin.close();
  }
  const log = serverLog();
  expect(log).toMatch(/rpc grants\.list failed: DrizzleQueryError \(postgres 57014\) request /);
  expect(log).not.toContain(account.email);
  expect(log, 'not even URL-encoded').not.toContain(encodeURIComponent(account.email));
});

test('@M08 /account renders in full when its unread count cannot be read: the app shell, its navigation and its own content, without the count', async ({ page, browser }) => {
  // The unread count on the dashboard link is M08's; the page is M02's and did not depend on the
  // notification table before. A failed count must not take the account page down (M08 polish, note 1).
  const account = await freshAccount(page, { name: 'Demo Unread Locked' });
  await getDb().insert(notification).values({ userId: account.userId, template: 'plan.granted', payload: { planCode: 'pro_sifu' } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const dashboardLink = page.getByTestId('open-dashboard');

  // Without the lock: the count is on the link.
  await page.goto('/account');
  await expect(dashboardLink).toHaveText('Open your dashboard (1 unread)');

  /**
   * The whole account page: the shell with its "Me" tab, the name, both sections, the e-mail, the
   * link without a count. The tab is marked current once the shell's NavLinks resolve, which
   * without JavaScript stays at its Suspense fallback (no tab current; src/components/shell/nav-links.tsx).
   */
  const expectFullAccountPage = async (p: Page, { javaScript }: { javaScript: boolean }) => {
    const nav = p.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    const me = nav.getByRole('link', { name: 'Me', exact: true });
    await expect(me).toHaveAttribute('href', '/dashboard');
    if (javaScript) await expect(me).toHaveAttribute('aria-current', 'page');
    await expect(p.getByRole('heading', { level: 1 })).toContainText('Demo Unread Locked');
    await expect(p.getByRole('heading', { level: 2, name: 'Profile' })).toBeVisible();
    await expect(p.getByRole('heading', { level: 2, name: 'Sign-in and security' })).toBeVisible();
    await expect(p.getByText(account.email, { exact: true })).toBeVisible();
    await expect(p.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(p.getByTestId('open-dashboard')).toHaveText('Open your dashboard');
    await expect(p.getByTestId('open-dashboard')).toHaveAttribute('href', '/dashboard');
    // Neither Next.js's bare error page nor an error state: nothing on this page failed that it needs.
    await expect(p.getByText("This page couldn't load")).toHaveCount(0);
    await expect(p.getByTestId('load-error')).toHaveCount(0);
  };

  await whileLocked('notification', async () => {
    const response = await page.goto('/account');
    expect(response?.status()).toBe(200);
    await expectFullAccountPage(page, { javaScript: true });
  });
  expect(errors, 'no uncaught error').toEqual([]);

  // Without JavaScript: the same page from the server.
  const noJs = await withoutJavaScript(browser, page.context());
  try {
    await whileLocked('notification', async () => {
      const response = await noJs.page.goto('/account');
      expect(response?.status()).toBe(200);
      await expectFullAccountPage(noJs.page, { javaScript: false });
    });
  } finally {
    await noJs.context.close();
  }

  // Once the table is free again, the count is back.
  await page.goto('/account');
  await expect(dashboardLink).toHaveText('Open your dashboard (1 unread)');

  // The failed reads left the one safe line each, never the account's id, address or SQL parameters.
  const log = serverLog();
  expect(log).toMatch(/rpc notifications\.list failed: DrizzleQueryError \(postgres 57014\) request /);
  expect(log).not.toContain(account.userId);
  expect(log).not.toContain(account.email);
  expect(log).not.toMatch(/params: /);
});

test('@M08 a page that awaits a failed read without a catch logs one safe line: no SQL parameters, no account id', async ({ page }) => {
  // /account (milestone M02) awaits its own reads (the account, its two-factor state) through
  // serverClient() without a catch. Next.js logs what reaches it; since the final check that is a
  // bare "Internal server error" (security-1). The two-factor read quotes the account's id.
  const account = await freshAccount(page, { name: 'Demo Uncaught Read' });
  await whileLocked('auth_two_factor', async () => {
    await page.goto('/account');
  });
  const log = serverLog();
  expect(log).toMatch(/rpc account\.twoFactor failed: DrizzleQueryError \(postgres 57014\) request /);
  expect(log).not.toContain(account.userId);
  expect(log).not.toContain(account.email);
  expect(log).not.toMatch(/params: /);
});
