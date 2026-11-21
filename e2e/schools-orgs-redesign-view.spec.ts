/**
 * ADR 0052, part 2: the redesigned school and organization pages, the specs that only read. The
 * organization list as cards (a drawn banner without an uploaded one, the public counts in words),
 * an organization's page (the banner, the shield of its initials, the numbers, the About text, the
 * school cards and the map of its cities with the cities named in a list), a school's page (the
 * banner, the seal, the numbers, the phone's jumps to the trial lesson and the contact) and the
 * finder's rows (the training days and "First lesson free" in words). axe in both themes. The seeded
 * demo records only (D20). Desktop and phone projects.
 */

import { expect, test, type Page } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

async function axeInBothThemes(page: Page, label: string) {
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `${label} (${theme})`);
  }
}

test('@redesign the organization list shows a card per organization, with a drawn banner and its public counts', async ({ page }) => {
  await page.goto('/organizations');
  const south = page.locator('[data-testid="organization-row"][data-slug="demo-association-south"]');
  await expect(south).toBeVisible();
  // No banner uploaded: the drawing, which is decorative.
  const banner = south.getByTestId('organization-card-banner');
  await expect(banner).toHaveAttribute('data-drawn', 'true');
  await expect(banner.locator('svg').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(south.getByTestId('organization-counts')).toContainText('3 schools');
  // The whole card opens the page, through the heading's link.
  await south.getByRole('link', { name: 'Demo Association South' }).click();
  await expect(page).toHaveURL(/\/organizations\/demo-association-south$/);
  await page.goto('/organizations');
  await axeInBothThemes(page, '/organizations, cards');
});

test('@redesign an organization page: banner, numbers, school cards and the cities its schools are in, named in a list', async ({ page }) => {
  await page.goto('/organizations/demo-association-south');
  await expect(page.getByRole('heading', { level: 1, name: 'Demo Association South' })).toBeVisible();
  await expect(page.getByTestId('organization-banner')).toHaveAttribute('data-drawn', 'true');
  // Each number follows its words in the markup (a term, then its value), shown above them.
  const stats = page.getByTestId('organization-stats');
  await expect(stats).toContainText('schools3');
  await expect(stats).toContainText('cities3');
  await expect(page.getByTestId('organization-school')).toHaveCount(3);
  // The map is a drawing; the cities are named beside it, with their schools in words.
  const cities = page.getByTestId('organization-cities');
  await expect(cities.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await expect(cities.locator('svg circle')).toHaveCount(6);
  const named = await page.getByTestId('organization-city').allInnerTexts();
  expect(named.map((t) => t.replace(/\s+/g, ' ').trim()).sort()).toEqual(['Athens, GR 1 school', 'Plovdiv, BG 1 school', 'Sofia, BG 1 school']);
  // No school's point is in the page: the cities are at their centres.
  const html = await page.content();
  expect(html).not.toMatch(/"(lat|lng)":\s*-?\d+\.\d{3,}/);
  await axeInBothThemes(page, '/organizations/demo-association-south');

  // The About text, where the organization wrote one.
  await page.goto('/organizations/demo-federation-north');
  await expect(page.getByTestId('organization-about')).toContainText('A demo federation of schools in the north');
});

test('@redesign a school page: banner, seal, numbers, and on a phone the jumps to the trial lesson and the contact', async ({ page }) => {
  await page.goto('/schools/demo-school-athens');
  await expect(page.getByRole('heading', { level: 1, name: 'Demo Kwoon Athens' })).toBeVisible();
  await expect(page.getByTestId('school-banner')).toHaveAttribute('data-drawn', 'true');
  const stats = page.getByTestId('school-stats');
  await expect(stats.locator('dt')).toHaveText([/instructors?/, /listed members?/, /class(es)? a week/, /forms? taught/]);
  const jumps = page.getByTestId('school-quick-actions');
  if (isPhone(page)) {
    await expect(jumps).toBeVisible();
    const trial = jumps.getByRole('link', { name: 'Trial lesson' });
    expect((await trial.boundingBox())!.height, 'a 44 px target on a phone').toBeGreaterThanOrEqual(44);
    await trial.click();
    await expect(page).toHaveURL(/#school-trial$/);
    await expect(page.locator('#school-trial')).toBeInViewport();
  } else {
    await expect(jumps).toBeHidden();
  }
  await axeInBothThemes(page, '/schools/demo-school-athens');
});

test('@redesign the finder list says the days a school trains and that the first lesson is free, in words', async ({ page }) => {
  await page.goto('/schools?view=list');
  const sofia = page.locator('[data-testid="school-row"][data-slug="demo-school-sofia"]');
  await expect(sofia.getByTestId('school-days')).toContainText('Trains');
  await expect(sofia.getByTestId('school-days').locator('.sr-only')).toHaveText('Monday, Wednesday, Saturday');
  await expect(sofia.getByTestId('school-first-free')).toHaveText('First lesson free');
  // A school without a timetable shows no days.
  await expect(page.locator('[data-testid="school-row"][data-slug="demo-school-athens"]').getByTestId('school-days')).toHaveCount(0);
  await axeInBothThemes(page, '/schools?view=list, rows');
});
