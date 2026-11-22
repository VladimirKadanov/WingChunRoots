/**
 * The kung fu family of Premium Student (docs/adr/0048-kung-fu-family.md). The seeded Premium
 * Student (demo-premium-student) opens the family page from the menu, filters by country, follows a
 * classmate (private: the follow shows only on their own page) and unfollows again; a Free Student
 * gets the plan's explanation and no list. axe runs on the page in both themes. Fictional (D20).
 *
 * Follows are private, so no public page changes and the spec runs with the others. Each project
 * follows a different classmate, so parallel projects never undo each other's follow.
 */

import { expect, test, type Page } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';
import { openDashboardMenu } from './helpers/phone-layout';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

async function axeBothThemes(page: Page, label: string) {
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `${label} (${theme})`);
  }
}

async function expectTouchTargets(page: Page, selector: string) {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => ({ h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width, text: el.textContent ?? '' })),
  );
  expect(boxes.length, selector).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.h, `${selector}: ${box.text}`).toBeGreaterThanOrEqual(44);
    expect(box.w, `${selector}: ${box.text}`).toBeGreaterThanOrEqual(44);
  }
}

const pick = (name: string, count: number) => [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % count;

test('@premium a student sees their kung fu family, follows a classmate privately and unfollows', async ({ page }, testInfo) => {
  await signInAs(page, 'demo-premium-student');
  await page.goto('/dashboard');
  await openDashboardMenu(page);
  await page.getByTestId('dashboard-family').filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/family$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Your kung fu family' })).toBeVisible();

  const people = page.getByTestId('family-branch').getByTestId('family-person');
  const count = await people.count();
  expect(count).toBeGreaterThan(0);
  await axeBothThemes(page, '/dashboard/family');
  if (testInfo.project.name.startsWith('mobile')) await expectTouchTargets(page, '[data-testid="family-person"] button, [data-testid="family-person"] a');

  const row = people.nth(pick(testInfo.project.name, count));
  const name = (await row.getByRole('link').first().innerText()).trim();
  const button = row.getByTestId('family-follow');
  if ((await button.count()) === 0) {
    // A rerun after an interrupted one: start from not following.
    await row.getByTestId('family-unfollow').click();
    await expect(page.getByTestId('family-notice')).toHaveText('You no longer follow them.');
  }
  await page
    .getByTestId('family-branch')
    .getByTestId('family-person')
    .filter({ hasText: name })
    .first()
    .getByTestId('family-follow')
    .click();
  await expect(page.getByTestId('family-notice')).toHaveText('Followed. Nobody else can see who you follow.');
  const followed = page.getByTestId('family-follows').getByTestId('family-followed').filter({ hasText: name });
  await expect(followed).toHaveCount(1);

  await followed.getByTestId('family-unfollow').click();
  await expect(page.getByTestId('family-notice')).toHaveText('You no longer follow them.');
  await expect(page.getByTestId('family-follows').getByTestId('family-followed').filter({ hasText: name })).toHaveCount(0);

  // The country filter is a plain GET form.
  const countries = page.getByTestId('family-country');
  if ((await countries.count()) > 0) {
    const options = await countries.locator('option').evaluateAll((list) => list.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    if (options.length > 0) {
      await countries.selectOption(options[0]!);
      await page.getByTestId('family-country-form').getByRole('button', { name: 'Show' }).click();
      await expect(page).toHaveURL(new RegExp(`country=${options[0]}`));
    }
  }
});

test('@premium a Free Student gets the explanation of the plan and no family list', async ({ page }) => {
  await signInAs(page, 'demo-two-lineages');
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-family')).toHaveCount(0);
  await page.goto('/dashboard/family');
  await expect(page.getByTestId('family-not-included')).toBeVisible();
  await expect(page.getByTestId('family-branch')).toHaveCount(0);
  await axeBothThemes(page, '/dashboard/family on a free plan');
});
