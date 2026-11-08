/**
 * Milestone M19: the seeded training passports as they are seen (docs/adr/0022-passport.md), on
 * the desktop and the phone. The Free Student (demo-two-lineages) shows the basic passport and the
 * Premium Student (demo-premium-student, profile demo-b-166) the full timeline (DEFAULT M19,
 * question 3), with the examiner, the skill's progress in words and a mark, the public certificate
 * and the past seminar, never the private certificate (question 4). axe runs in both themes; on a
 * phone every control of the passport pages is at least 44 px. It only reads (a sign-in of a demo
 * account changes nothing of its passport), so it runs in the ordinary projects. Fictional (D20).
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** The seeded Premium Student's profile (src/fixtures/generate.ts, demoPassport; seed 20261016). */
const PREMIUM_PROFILE = '/people/demo-b-166';

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

test('@M19 the Free Student shows the basic passport, the Premium Student the full timeline without the private certificate', async ({ page }) => {
  await page.goto('/people/demo-two-lineages');
  const basic = page.getByTestId('profile-passport');
  await expect(basic).toHaveAttribute('data-level', 'basic');
  await expect(basic.getByTestId('passport-current-rank')).toContainText('First level');
  await expect(basic.getByTestId('passport-timeline')).toHaveCount(0);
  await expect(basic.getByTestId('passport-experience')).toContainText('since ');
  await expect(basic.getByTestId('passport-experience')).not.toContainText('month');

  const answer = await page.request.get(PREMIUM_PROFILE);
  const html = await answer.text();
  expect(html).not.toContain('Demo first aid course certificate');
  await page.goto(PREMIUM_PROFILE);
  const full = page.getByTestId('profile-passport');
  await expect(full).toHaveAttribute('data-level', 'full');
  await expect(full.getByTestId('passport-current-rank')).toContainText('Second level');
  const timeline = full.getByTestId('passport-timeline');
  await expect(timeline.getByTestId('passport-entry').filter({ hasText: 'Examination' }).getByText(/^Examiner:/)).toBeVisible();
  await expect(timeline.locator('[data-testid="skill-progress"][data-progress="learning"]')).toHaveText('Learning');
  await expect(timeline.locator('[data-testid="skill-progress"][data-progress="approved"]')).toHaveText('Approved by the teacher');
  await expect(timeline.getByTestId('certificate-thumb')).toHaveCount(1);
  await expect(timeline.getByText('Demo seminar in Athens')).toBeVisible();
  await axeBothThemes(page, 'profile with a full passport');
});

test('@M19 the passport pages by keyboard and touch: 44 px targets on a phone', async ({ page }, testInfo) => {
  await signInAs(page, 'demo-premium-student');
  await page.goto('/dashboard/passport');
  await expect(page.getByTestId('passport-level')).toHaveAttribute('data-level', 'full');
  // Keyboard: Tab reaches the first entry's "Make private" (nothing is pressed: the seeded passport stays as it is).
  const button = shown(page.getByTestId('passport-make-private')).first();
  for (let i = 0; i < 60 && !(await button.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  await axeBothThemes(page, 'own full passport');
  if (testInfo.project.name.startsWith('mobile')) {
    await expectTouchTargets(page, '[data-testid="own-passport-entry"] button, [data-testid="own-passport-entry"] a, [data-testid="certificate-upload"] button, [data-testid="certificate-upload"] label:has(input[type=radio])');
  }
  await page.goto(PREMIUM_PROFILE);
  if (testInfo.project.name.startsWith('mobile')) {
    await expectTouchTargets(page, '[data-testid="profile-passport"] a');
  }
});
