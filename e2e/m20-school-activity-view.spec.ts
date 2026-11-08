/**
 * Milestone M20: the seeded schools in the activity check as they are seen (docs/adr/0023-school-activity.md),
 * on the desktop and the phone. demo-pro-sifu-8 listed demo-school-awaiting-birmingham (awaiting
 * confirmation since 2 November 2026, still on the map) and demo-school-hidden-munich (hidden from
 * the map since 15 October 2026, kept); the public sees the first and not the second; the owner sees
 * each stage in words with a mark and its date, and one primary action "This listing is current";
 * the staff page lists them with a filter by stage that works by keyboard. axe runs in both themes;
 * on a phone every control is at least 44 px. It only reads (no confirmation is pressed), so it runs
 * in the ordinary projects. Fictional (D20).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

const AWAITING = 'demo-school-awaiting-birmingham';
const HIDDEN = 'demo-school-hidden-munich';

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

test('@M20 the seeded awaiting school stays public, the hidden one is off every public answer', async ({ page, request }) => {
  expect((await request.get(`${BASE_URL}/api/v1/schools/${AWAITING}`)).status()).toBe(200);
  expect((await request.get(`${BASE_URL}/api/v1/schools/${HIDDEN}`)).status()).toBe(404);
  const sitemap = await (await request.get(`${BASE_URL}/sitemap.xml`)).text();
  expect(sitemap).toContain(`/schools/${AWAITING}</loc>`);
  expect(sitemap).not.toContain(`/schools/${HIDDEN}<`);
  await page.goto(`/schools/${HIDDEN}`);
  await expect(shown(page.getByTestId('school-not-listed'))).toBeVisible();
  await page.goto('/schools?near=Munich&radius=50&view=list');
  const rows = await shown(page.getByTestId('school-row')).evaluateAll((items) => items.map((item) => item.getAttribute('data-slug') ?? ''));
  expect(rows).not.toContain(HIDDEN);
});

test('@M20 the owner sees each stage in words, a mark and its date, with "This listing is current"; 44 px targets on a phone', async ({ page }, testInfo) => {
  await signInAs(page, 'demo-pro-sifu-8');
  await page.goto('/dashboard/schools');
  const awaiting = shown(page.locator(`[data-testid="own-school"][data-activity="awaiting_confirmation"]`));
  const hidden = shown(page.locator(`[data-testid="own-school"][data-activity="hidden"]`));
  await expect(awaiting.getByTestId('own-school-activity')).toContainText('Awaiting confirmation since 2 November 2026');
  await expect(hidden.getByTestId('own-school-activity')).toContainText('Hidden from the map since 15 October 2026');
  for (const state of [awaiting, hidden]) await expect(state.getByTestId('own-school-activity').locator('svg[aria-hidden="true"]')).toHaveCount(1);
  await axeBothThemes(page, '/dashboard/schools (demo-pro-sifu-8)');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="own-school"] a');

  // The awaiting school: still on the map, with the day it would be hidden without a confirmation.
  await awaiting.getByRole('link', { name: 'Demo Wing Chun Club Birmingham' }).click();
  await page.waitForURL(/\/dashboard\/schools\/[0-9a-f-]{36}$/);
  await expect(shown(page.getByTestId('school-activity'))).toHaveText('Awaiting confirmation since 2 November 2026');
  await expect(shown(page.getByTestId('school-listing'))).toHaveAttribute('data-pin', 'shown');
  await expect(shown(page.getByTestId('school-activity-note'))).toContainText('about 16 November 2026');
  await expect(shown(page.getByTestId('school-confirm')).getByRole('button', { name: 'This listing is current' })).toBeVisible();
  await axeBothThemes(page, '/dashboard/schools/[id] (awaiting)');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="school-confirm"] button, [data-testid="school-listing"] a');

  // The hidden school: kept, off the map, and how to show it again.
  await page.goto('/dashboard/schools');
  await shown(page.locator(`[data-testid="own-school"][data-activity="hidden"]`)).getByRole('link', { name: 'Demo Kwoon Munich' }).click();
  await page.waitForURL(/\/dashboard\/schools\/[0-9a-f-]{36}$/);
  await expect(shown(page.getByTestId('school-activity'))).toHaveText('Hidden from the map since 15 October 2026');
  await expect(shown(page.getByTestId('school-pin'))).toHaveText('Not on the map: hidden until you confirm the listing is current');
  await expect(shown(page.getByTestId('school-activity-note'))).toContainText('Nothing is deleted');
  await axeBothThemes(page, '/dashboard/schools/[id] (hidden)');
});

test('@M20 the staff page lists the stages and filters them by keyboard', async ({ page }, testInfo) => {
  await signInAs(page, 'admin');
  await page.goto('/admin');
  await shown(page.getByTestId('admin-schools-link')).click();
  await page.waitForURL(/\/admin\/schools$/);
  const school = (slug: string) => shown(page.locator(`[data-testid="admin-school"][data-slug="${slug}"]`));
  await expect(school(AWAITING)).toHaveAttribute('data-activity', 'awaiting_confirmation');
  await expect(school(AWAITING).getByTestId('admin-school-activity')).toContainText('Awaiting confirmation since 2 November 2026');
  await expect(school(HIDDEN)).toHaveAttribute('data-activity', 'hidden');
  await expect(school(HIDDEN)).toContainText('Not on the public map');
  await axeBothThemes(page, '/admin/schools');

  // The filter: links, so Tab and Enter reach it; the chosen one says so in words to a screen reader.
  const hiddenFilter = shown(page.locator('[data-testid="admin-schools-stage"][data-stage="hidden"]'));
  await hiddenFilter.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/admin\/schools\?stage=hidden$/);
  await expect(shown(page.locator('[data-testid="admin-schools-stage"][data-stage="hidden"]'))).toHaveAttribute('aria-current', 'page');
  const stages = await shown(page.getByTestId('admin-school')).evaluateAll((items) => items.map((item) => item.getAttribute('data-activity')));
  expect(stages.length).toBeGreaterThan(0);
  expect(new Set(stages)).toEqual(new Set(['hidden']));
  await expect(school(AWAITING)).toHaveCount(0);
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="admin-schools-stage"]');
});
