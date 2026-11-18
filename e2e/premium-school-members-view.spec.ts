/**
 * The members of a school page (docs/adr/0044-premium-student.md), as they are seen, on the
 * desktop and the phone. demo-premium-student chose "List me on my school's page"; their teacher
 * demo-pro-sifu-8 teaches at demo-school-london, so the page lists them with the fuller card of
 * Premium Student. The section is server-rendered; axe runs in both themes and every link is at
 * least 44 px high. It only reads, so it runs in the ordinary projects. Fictional (D20).
 */

import { expect, test } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

test('@premium the school page lists the member who chose it, with the Premium Student card; schools without listed members show no section', async ({ page }) => {
  await page.goto('/schools/demo-school-london');
  const section = page.getByTestId('school-members');
  await expect(section.getByRole('heading', { level: 2, name: 'Members' })).toBeVisible();
  await expect(section).toContainText('1 member has chosen to be listed here.');
  const card = section.getByTestId('school-member');
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-full', 'true');
  const link = card.getByRole('link');
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(link).toHaveAttribute('href', /^\/people\/demo-/);
  // The instructor is listed above, never among the members.
  const instructors = await page.getByTestId('school-instructor').evaluateAll((items) => items.map((item) => item.getAttribute('data-slug')));
  expect(instructors).not.toContain(await card.getAttribute('data-slug'));
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `school members (${theme})`);
  }

  await page.goto('/schools/demo-school-sofia');
  await expect(page.getByRole('heading', { level: 2, name: 'Instructors' })).toBeVisible();
  await expect(page.getByTestId('school-members')).toHaveCount(0);
});
