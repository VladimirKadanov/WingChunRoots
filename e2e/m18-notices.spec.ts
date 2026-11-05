/**
 * Milestone M18: lifecycle notices. A password reset brings the "password changed" e-mail (security:
 * always e-mailed, no unsubscribe link); a category switched off in the settings stops its e-mail and
 * keeps the notice; the e-mail's unsubscribe link switches its category off without signing in (the
 * page, and the one-click POST of List-Unsubscribe, RFC 8058); /dashboard/notifications by keyboard
 * (categories, pages, "Mark all as read"), with 44 px targets on a phone and axe in both themes.
 * Every test uses accounts of its own (fictional, D20), so it runs beside the other specs.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { expect, type Locator, test, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { emailDelivery, notification, notificationPreference } from '../src/server/db/schema';
import { stopProducer } from '../src/server/jobs/boss';
import { notify } from '../src/server/services/notify';
import { authPost, closeHelpers, createConfirmedAccount, emailLinkFromOutbox, loadTestEnv, signInWithPassword, userIdOf } from './helpers/auth';
import { openMailbox } from './helpers/mailbox';
import { freshAccount } from './helpers/plans';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(async () => {
  await stopProducer();
  await closeHelpers();
});

const UNSUBSCRIBE_LINK = /https?:\/\/[^\s"<>()[\]]+\/unsubscribe\?token=[^\s"<>()[\]]+/;

/** A plan.expiring notice for the account, as the daily job sends it (src/server/jobs/plan-expiry.ts). */
async function planNotice(userId: string) {
  const grantId = randomUUID();
  const payload = { grantId, planCode: 'premium_student', endsAt: new Date(Date.UTC(2027, 0, 31)).toISOString(), nextPlanCode: 'free_student' };
  return getDb().transaction((tx) => notify(tx, userId, 'plan.expiring', payload, { key: `plan.expiring:${grantId}` }));
}

async function planEmailChoice(userId: string) {
  const [row] = await getDb()
    .select({ email: notificationPreference.email })
    .from(notificationPreference)
    .where(and(eq(notificationPreference.userId, userId), eq(notificationPreference.category, 'plan')));
  return row?.email;
}

/**
 * Only what is on screen: Next.js keeps earlier routes of the tab in the page, hidden (React
 * Activity), with the same test ids.
 */
const shown = (locator: Locator) => locator.filter({ visible: true });

async function expectTouchTargets(page: Page, selector: string) {
  for (const box of await page.locator(selector).evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })))) {
    expect(box.h, selector).toBeGreaterThanOrEqual(44);
    expect(box.w, selector).toBeGreaterThanOrEqual(44);
  }
}

test('@M18 a password reset brings the "password changed" e-mail and notice, without an unsubscribe link', async ({ page }) => {
  const account = await createConfirmedAccount(page, 'm18-reset');
  const asked = await authPost(page, '/request-password-reset', { email: account.email, redirectTo: '/reset-password' });
  expect(asked.status(), await asked.text()).toBe(200);
  const token = new URL(await emailLinkFromOutbox('reset-password', account.email)).searchParams.get('token');
  const password = `demo-new-password-${randomBytes(4).toString('hex')}`;
  const reset = await authPost(page, '/reset-password', { token, newPassword: password });
  expect(reset.status(), await reset.text()).toBe(200);

  const message = await openMailbox().waitFor(account.email, { subject: 'Your password was changed · WingChunRoots', timeoutMs: 30_000 });
  expect(message.text).toContain('The password of your WingChunRoots account was changed.');
  expect(message.text).toContain('/account/security');
  // Security e-mail is never switched off: no unsubscribe link, no List-Unsubscribe.
  expect(message.headers['list-unsubscribe']).toBeUndefined();
  expect(message.text).not.toMatch(/unsubscribe/i);
  // No address, IP address or place in it.
  expect(message.text.replace(/https?:\/\/\S+/g, '')).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);

  await signInWithPassword(page, account.email, password);
  await page.goto('/dashboard/notifications?category=security');
  await expect(page.getByTestId('notification').first()).toContainText('Your password was changed');
});

test('@M18 a category switched off in the settings stops its e-mail; the notice still comes', async ({ page }) => {
  const account = await freshAccount(page, { name: 'Demo Notice Pupil' });
  await page.goto('/dashboard/settings');
  const form = page.getByTestId('notification-emails-form');
  const plan = form.getByRole('checkbox', { name: /^Plan\b/ });
  await expect(plan).toBeChecked();
  await expect(form.getByRole('checkbox', { name: /^Events\b/ })).not.toBeChecked();
  // Security and account are listed as always e-mailed, never as a choice.
  await expect(form.getByRole('checkbox', { name: /^Security\b/ })).toHaveCount(0);
  await expect(page.getByTestId('locked-categories')).toContainText('Security');
  await plan.uncheck();
  await form.getByRole('button', { name: 'Save e-mail settings' }).click();
  await expect(page.getByText('Your e-mail settings are saved. Dashboard notifications stay on.')).toBeVisible();
  await expect.poll(() => planEmailChoice(account.userId)).toBe(false);
  await page.reload();
  await expect(page.getByTestId('notification-emails-form').getByRole('checkbox', { name: /^Plan\b/ })).not.toBeChecked();

  expect(await planNotice(account.userId)).toEqual({ notified: true, emailed: false });
  expect(await getDb().select().from(emailDelivery).where(and(eq(emailDelivery.userId, account.userId), eq(emailDelivery.template, 'notice')))).toHaveLength(0);
  await page.goto('/dashboard/notifications?category=plan');
  await expect(page.getByTestId('notification')).toHaveCount(1);

  // On again: the next one is e-mailed.
  await page.goto('/dashboard/settings');
  await page.getByTestId('notification-emails-form').getByRole('checkbox', { name: /^Plan\b/ }).check();
  await page.getByTestId('notification-emails-form').getByRole('button', { name: 'Save e-mail settings' }).click();
  await expect.poll(() => planEmailChoice(account.userId)).toBe(true);
  expect(await planNotice(account.userId)).toEqual({ notified: true, emailed: true });
  await openMailbox().waitFor(account.email, { subject: /^Your pilot plan has an end date/, timeoutMs: 30_000 });
});

test('@M18 the e-mail’s unsubscribe link switches its category off without signing in', async ({ page, browser }) => {
  const account = await freshAccount(page, { name: 'Demo Unsubscribing Pupil' });
  expect(await planNotice(account.userId)).toEqual({ notified: true, emailed: true });
  const message = await openMailbox().waitFor(account.email, { subject: /^Your pilot plan has an end date/, timeoutMs: 30_000 });
  expect(message.headers['list-unsubscribe-post']).toBe('List-Unsubscribe=One-Click');
  const oneClick = /^<(.+)>$/.exec(message.headers['list-unsubscribe'] ?? '')?.[1];
  expect(oneClick, 'List-Unsubscribe names the one-click address').toMatch(/\/unsubscribe\/one-click\?token=/);
  expect(message.text).toContain('Unsubscribe from Plan e-mails');
  const link = UNSUBSCRIBE_LINK.exec(message.text)?.[0];
  expect(link, 'the unsubscribe link in the e-mail').toBeDefined();
  const url = new URL(link!);

  // A visitor without a session: the link's own page.
  const context = await browser.newContext();
  const visitor = await context.newPage();
  try {
    await visitor.goto(`${url.pathname}${url.search}`);
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Unsubscribe from Plan e-mails');
    // Opening the page changes nothing.
    expect(await planEmailChoice(account.userId)).toBeUndefined();
    for (const theme of THEMES) {
      await switchColorScheme(visitor, theme);
      await expectNoAxeViolations(visitor, `unsubscribe (${theme})`);
    }
    await visitor.getByRole('button', { name: 'Unsubscribe' }).press('Enter');
    await expect(visitor.getByTestId('unsubscribed')).toHaveText('Plan e-mails are off');
    await expect(visitor.getByTestId('unsubscribed')).toBeFocused();
    expect(await planEmailChoice(account.userId)).toBe(false);
    for (const theme of THEMES) {
      await switchColorScheme(visitor, theme);
      await expectNoAxeViolations(visitor, `unsubscribed (${theme})`);
    }

    // The one-click POST of a mail client: the same link answers that it is off, again and again.
    const oneClickUrl = new URL(oneClick!);
    const posted = await visitor.request.post(`${oneClickUrl.pathname}${oneClickUrl.search}`, { form: { 'List-Unsubscribe': 'One-Click' } });
    expect(posted.status()).toBe(200);
    // A token that is not one: 404, nothing named.
    const forged = await visitor.request.post('/unsubscribe/one-click?token=v1.demo', { form: { 'List-Unsubscribe': 'One-Click' } });
    expect(forged.status()).toBe(404);
  } finally {
    await context.close();
  }

  // The settings say so, and the next plan notice comes to the dashboard only.
  await page.goto('/dashboard/settings');
  await expect(page.getByTestId('notification-emails-form').getByRole('checkbox', { name: /^Plan\b/ })).not.toBeChecked();
  expect(await planNotice(account.userId)).toEqual({ notified: true, emailed: false });
  // Switched on again, the old link no longer works.
  await page.getByTestId('notification-emails-form').getByRole('checkbox', { name: /^Plan\b/ }).check();
  await page.getByTestId('notification-emails-form').getByRole('button', { name: 'Save e-mail settings' }).click();
  await expect.poll(() => planEmailChoice(account.userId)).toBe(true);
  await page.goto(`${url.pathname}${url.search}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link no longer works');
});

test('@M18 /dashboard/notifications by keyboard: categories, pages and "Mark all as read"', async ({ page }, testInfo) => {
  const account = await freshAccount(page, { name: 'Demo Many Notices' });
  const userId = (await userIdOf(account.email))!;
  await getDb().transaction(async (tx) => {
    for (let i = 0; i < 22; i++) await notify(tx, userId, 'plan.granted', { planCode: 'pro_sifu' }, { key: `e2e:m18:granted:${i}` });
    await notify(tx, userId, 'limit.reached', { feature: 'photos', planCode: 'free_student', limit: 1, upgradeTo: 'premium_student', month: '2026-10' }, { key: 'limit.reached:photos:2026-10' });
    await notify(tx, userId, 'content.removed', { content: 'photo', reason: 'Demo reason: the photo shows a poster.' }, { key: `content.removed:photo:${randomUUID()}` });
  });
  await page.goto('/dashboard');
  await page.getByTestId('all-notifications-link').click();
  await expect(page).toHaveURL(/\/dashboard\/notifications$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notifications');
  await expect(shown(page.getByTestId('unread-count'))).toHaveText('24 unread');
  await expect(shown(page.getByTestId('notification'))).toHaveCount(20);
  // Unread is said in words and with a shape, not by colour alone.
  await expect(shown(page.getByTestId('notification')).first()).toContainText('New');
  await expect(shown(page.getByTestId('notification-pages'))).toContainText('Page 1 of 2');
  // 44 px targets on a phone: the categories, and each notice's button and link.
  if (testInfo.project.name.startsWith('mobile')) {
    await expectTouchTargets(page, '[data-testid="notification-categories"] a:visible');
    await expectTouchTargets(page, '[data-testid="notification"]:visible button, [data-testid="notification"]:visible a');
  }

  // To the next page by keyboard.
  const older = shown(page.getByTestId('notification-pages')).getByRole('link', { name: 'Older' });
  await older.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/page=2$/);
  await expect(shown(page.getByTestId('notification'))).toHaveCount(4);

  // A category by keyboard: the chosen one is marked with aria-current and a heavier border.
  const nav = shown(page.getByTestId('notification-categories'));
  await nav.getByRole('link', { name: 'Account' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/category=account$/);
  await expect(nav.getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page');
  await expect(shown(page.getByRole('heading', { level: 2, name: /Account notifications/ }))).toBeVisible();
  await expect(shown(page.getByTestId('notification'))).toHaveCount(1);
  await expect(shown(page.getByTestId('notification'))).toContainText('Demo reason: the photo shows a poster.');

  // "Mark all as read" of this category only.
  await shown(page.getByRole('button', { name: 'Mark all as read' })).focus();
  await page.keyboard.press('Enter');
  await expect(shown(page.getByTestId('unread-count'))).toHaveText('23 unread');
  await expect(shown(page.getByTestId('notification')).first()).not.toHaveAttribute('data-unread', 'true');
  await expect
    .poll(async () => (await getDb().select().from(notification).where(and(eq(notification.userId, userId)))).filter((n) => n.readAt === null).length)
    .toBe(23);

  // The empty state of a category without notices.
  await nav.getByRole('link', { name: 'Events' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/category=events$/);
  await expect(shown(page.locator('#notifications'))).toContainText('No events notifications.');

  // Every notice, then all of them read.
  await nav.getByRole('link', { name: 'All' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard\/notifications$/);
  await shown(page.getByRole('button', { name: 'Mark all as read' })).focus();
  await page.keyboard.press('Enter');
  await expect(shown(page.getByTestId('unread-count'))).toHaveText('none unread');

  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `notifications (${theme})`);
  }
});
