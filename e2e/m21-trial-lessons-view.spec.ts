/**
 * Milestone M21: the seeded schedule, fees, trial lesson requests and statistics as they are seen
 * (docs/adr/0024-trial-lessons.md), on the desktop and the phone. demo-pro-sifu-8's
 * demo-school-sofia has four weekly classes, its fees and "the first trial lesson is free"; two
 * requests (demo-root-a's open one, demo-premium-student's answered one) and six weeks of counters
 * ending on 8 November 2026. The public page shows the schedule and the trial action by viewer; the
 * owner's inbox, schedule and statistics; each sender's own list. axe runs in both themes; on a
 * phone every control is at least 44 px. It only reads (nothing is sent, answered or saved), so it
 * runs in the ordinary projects. Fictional (D20).
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

const SOFIA = 'demo-school-sofia';
/** A day of the last week of the seeded counters, so the weeks shown do not move with the clock. */
const LAST_DEMO_WEEK = '2026-11-08';

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

async function sofiaId(): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM school WHERE slug = ${SOFIA}`);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]!.id;
}

test('@M21 the public page shows the schedule and fees, and the trial action by viewer', async ({ page }, testInfo) => {
  await page.goto(`/schools/${SOFIA}`);
  const schedule = shown(page.getByTestId('school-schedule'));
  await expect(schedule.getByTestId('school-schedule-slot')).toHaveCount(4);
  await expect(schedule).toContainText('Monday');
  await expect(schedule).toContainText('Europe/Sofia');
  await expect(shown(page.getByTestId('school-first-trial-free'))).toHaveText('The first trial lesson is free.');
  await expect(shown(page.getByTestId('school-fees'))).toContainText(/fictional/i);
  await expect(shown(page.getByTestId('school-trial-sign-in'))).toHaveAttribute('href', `/sign-in?next=${encodeURIComponent(`/schools/${SOFIA}/trial`)}`);
  await axeBothThemes(page, `/schools/${SOFIA} (visitor)`);
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="school-trial"] a');

  // The sign-in link comes back to the form.
  await page.goto(`/schools/${SOFIA}/trial`);
  await page.waitForURL(/\/sign-in\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toBe(`/schools/${SOFIA}/trial`);

  // The owner: "your own school"; demo-root-a: its open request.
  await signInAs(page, 'demo-pro-sifu-8');
  await page.goto(`/schools/${SOFIA}`);
  await expect(shown(page.getByTestId('school-trial-state'))).toHaveAttribute('data-state', 'own_school');
  await page.context().clearCookies();
  await signInAs(page, 'demo-root-a');
  await page.goto(`/schools/${SOFIA}`);
  await expect(shown(page.getByTestId('school-trial-state'))).toHaveAttribute('data-state', 'open');
  await page.goto(`/schools/${SOFIA}/trial`);
  await expect(shown(page.getByTestId('trial-refused'))).toHaveAttribute('data-state', 'open');
});

test('@M21 the request form, with what the school will see; 44 px targets on a phone', async ({ page }, testInfo) => {
  // demo-pending has a profile and no request at Sofia: the form, nothing sent.
  await signInAs(page, 'demo-pending');
  await page.goto(`/schools/${SOFIA}`);
  await shown(page.getByTestId('school-trial-request')).click();
  await page.waitForURL(new RegExp(`/schools/${SOFIA}/trial$`));
  const form = shown(page.getByTestId('trial-form'));
  await expect(shown(page.getByTestId('trial-privacy-notice'))).toContainText('your profile name');
  // "By phone" shows the phone field; "By e-mail" hides it again.
  await expect(shown(page.getByTestId('trial-phone'))).toHaveCount(0);
  await form.getByTestId('trial-contact-phone').check();
  await expect(shown(page.getByTestId('trial-phone'))).toHaveCount(1);
  await axeBothThemes(page, `/schools/${SOFIA}/trial`);
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="trial-form"] label:has(input[type="radio"]), [data-testid="trial-form"] button');
  await form.getByTestId('trial-contact-email').check();
  await expect(shown(page.getByTestId('trial-phone'))).toHaveCount(0);
});

test('@M21 the senders see their own requests, with the state in words and the answer', async ({ page }) => {
  await signInAs(page, 'demo-premium-student');
  await page.goto('/dashboard/trial-lessons');
  const answered = shown(page.locator('[data-testid="own-trial-request"][data-status="answered"]'));
  await expect(answered).toHaveCount(1);
  await expect(answered.getByTestId('trial-status')).toHaveText('Answered');
  await expect(answered.getByTestId('trial-status').locator('svg[aria-hidden="true"]')).toHaveCount(1);
  await expect(answered.getByTestId('own-trial-reply')).toBeVisible();
  await axeBothThemes(page, '/dashboard/trial-lessons (answered)');

  await page.context().clearCookies();
  await signInAs(page, 'demo-root-a');
  await page.goto('/dashboard/trial-lessons');
  await expect(shown(page.locator('[data-testid="own-trial-request"][data-status="open"]')).getByTestId('trial-status')).toHaveText('Waiting for the school');
});

test("@M21 the owner's inbox, schedule and statistics of demo-school-sofia; 44 px targets on a phone", async ({ page }, testInfo) => {
  const id = await sofiaId();
  await signInAs(page, 'demo-pro-sifu-8');
  await page.goto(`/dashboard/schools/${id}`);
  await expect(shown(page.getByTestId('school-schedule-summary'))).toContainText('4 weekly classes, fees described, the first trial lesson is free');

  // The inbox: the open request first, with its actions; the answered one with Close only.
  await shown(page.getByTestId('school-trials-link')).click();
  await page.waitForURL(new RegExp(`/dashboard/schools/${id}/inquiries$`));
  const inquiries = shown(page.getByTestId('trial-inquiry'));
  await expect(inquiries).toHaveCount(2);
  await expect(inquiries.first()).toHaveAttribute('data-status', 'open');
  await expect(inquiries.first().getByTestId('trial-answer')).toBeVisible();
  await expect(inquiries.nth(1)).toHaveAttribute('data-status', 'answered');
  await expect(inquiries.nth(1).getByTestId('trial-answer')).toHaveCount(0);
  await expect(inquiries.nth(1).getByTestId('trial-close')).toBeVisible();
  await expect(shown(page.getByTestId('trial-filters')).getByRole('link', { name: 'All (2)' })).toHaveAttribute('aria-current', 'page');
  await axeBothThemes(page, '/dashboard/schools/[id]/inquiries');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="trial-filters"] a, [data-testid="trial-actions"] button');
  await shown(page.getByTestId('trial-filters')).getByRole('link', { name: 'Waiting (1)' }).click();
  await page.waitForURL(/\?status=open$/);
  await expect(shown(page.getByTestId('trial-inquiry'))).toHaveCount(1);

  // The schedule form, read only here.
  await page.goto(`/dashboard/schools/${id}/schedule`);
  const rows = shown(page.getByTestId('schedule-row'));
  await expect(rows).toHaveCount(7);
  await expect(rows.first().getByLabel('Day')).toHaveValue('1');
  await axeBothThemes(page, '/dashboard/schools/[id]/schedule');

  // The statistics of the seeded weeks: 12 weeks, a table and a chart with its text alternative.
  await page.goto(`/dashboard/schools/${id}/stats?week=${LAST_DEMO_WEEK}`);
  const stats = shown(page.getByTestId('school-stats'));
  await expect(stats).toHaveAttribute('data-last-week', '2026-11-02');
  await expect(stats.getByTestId('stats-week')).toHaveCount(12);
  await expect(stats.getByTestId('stats-chart')).toHaveAttribute('aria-hidden', 'true');
  await expect(stats.locator('figcaption')).toContainText('The table below has every count');
  await expect(shown(page.getByTestId('stats-later'))).toBeVisible();
  await axeBothThemes(page, '/dashboard/schools/[id]/stats');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="school-stats"] nav a');
});
