/**
 * Role replay 2026-11-25, P2-10 (ADR 0070): beside the dashboard's and the control panel's own menu
 * the site rail folds to icons from 1024 px; each icon keeps its name for assistive technology and
 * shows it beside itself on hover and keyboard focus. Elsewhere the rail keeps its words. Fictional
 * demo accounts only (D20).
 */
import { expect, test, type Page } from '@playwright/test';

import { signInAs } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

// A computer in every project (the phone projects too): the folded rail is a desktop layout.
test.use({ isMobile: false, hasTouch: false });

const rail = (page: Page) => page.locator('nav[data-tab-bar]');
const railLink = (page: Page, name: string) => rail(page).getByRole('link', { name, exact: true }).filter({ visible: true });
const width = (page: Page) => rail(page).evaluate((element) => Math.round(element.getBoundingClientRect().width));

test('@nav the dashboard folds the site rail to icons that name themselves on hover and focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs(page, 'demo-root-a');
  await page.goto('/dashboard');
  await expect.poll(() => width(page)).toBeLessThanOrEqual(80);
  for (const name of ['Home', 'Lineage', 'Schools', 'Organizations', 'Events']) await expect(railLink(page, name)).toBeVisible();

  // The name is hidden until the icon is pointed at or focused.
  const schools = railLink(page, 'Schools');
  const label = schools.getByText('Schools', { exact: true });
  const shown = () => label.evaluate((element) => getComputedStyle(element).clipPath === 'none');
  expect(await shown()).toBe(false);
  await schools.hover();
  await expect.poll(shown).toBe(true);
  await page.mouse.move(900, 600);
  await expect.poll(shown).toBe(false);
  await railLink(page, 'Events').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect.poll(() => railLink(page, 'Events').getByText('Events', { exact: true }).evaluate((element) => getComputedStyle(element).clipPath)).toBe('none');

  // The search, the account and the theme switch keep their names.
  await expect(rail(page).getByRole('button', { name: /Find a name/ })).toBeVisible();
  await expect(rail(page).getByTestId('account-menu-trigger').filter({ visible: true })).toBeVisible();
  await expect(rail(page).getByRole('switch', { name: 'Dark theme' }).filter({ visible: true })).toBeVisible();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `/dashboard (folded rail, ${theme})`);
  }

  // Outside the dashboard the rail keeps its words.
  await page.goto('/schools');
  await expect.poll(() => width(page)).toBeGreaterThan(200);
  await expect(railLink(page, 'Schools').getByText('Schools', { exact: true })).toBeVisible();
});

test('@nav between 768 and 1024 px the dashboard keeps the wide rail (its menu is above the page)', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await signInAs(page, 'demo-root-a');
  await page.goto('/dashboard');
  await expect.poll(() => width(page)).toBeGreaterThan(200);
});

test('@nav the control panel folds the site rail too', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAs(page, 'admin');
  await page.goto('/admin');
  await expect.poll(() => width(page)).toBeLessThanOrEqual(80);
  await expectNoAxeViolations(page, '/admin (folded rail)');
});
