/**
 * Role replay 2026-11-25, P3-4 and P3-6: the home page keeps one search box and adds "Coming up"
 * (the next three public events) and "Find a school" with a city field; the explorer's start page
 * has the search on top and its lineages as cards with the root and the size. Fictional demo data
 * only (D20).
 */
import { expect, test } from '@playwright/test';

import { expectNoAxeViolations } from './helpers/ui';

test('@nav the home page has one search box, the next three events and a school search by city (P3-4)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-home-search]').filter({ visible: true })).toHaveCount(1);

  const comingUp = page.getByTestId('home-coming-up');
  await expect(comingUp).toHaveAttribute('data-state', 'shown');
  await expect(comingUp.getByRole('heading', { name: 'Coming up' })).toBeVisible();
  const rows = comingUp.getByTestId('event-row');
  await expect(rows).toHaveCount(3);
  // Soonest first, and only upcoming ones.
  for (const row of await rows.all()) await expect(row).not.toHaveAttribute('data-slug', 'demo-past-seminar-athens');
  await expect(comingUp.getByRole('link', { name: 'All events' })).toHaveAttribute('href', '/events');

  const finder = page.getByTestId('home-find-school');
  await expect(finder.getByRole('link', { name: 'Find a school on the map' })).toHaveAttribute('href', '/schools');
  await finder.getByLabel('City or town').fill('Sofia');
  await finder.getByRole('button', { name: 'Show schools' }).click();
  await page.waitForURL((url) => url.pathname === '/schools' && url.searchParams.get('near') === 'Sofia' && url.searchParams.get('view') === 'list');
  await expect(page.getByTestId('near-missing')).toHaveCount(0);
});

test('@nav the home page passes axe with the new start section', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-coming-up')).toHaveAttribute('data-state', 'shown');
  await expectNoAxeViolations(page, '/ (start here with Coming up)');
});

test('@nav the explorer starts with the search and the lineages as cards with root and size (P3-6)', async ({ page }) => {
  await page.goto('/explore');
  const main = page.getByRole('main');
  await expect(main.locator('[data-home-search]')).toBeVisible();
  const cards = main.getByTestId('explore-lineage');
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) {
    await expect(card.getByRole('heading', { level: 3 })).toHaveText(/^Demo Lineage [A-C]$/);
    await expect(card.locator('a[href^="/people/"]')).toHaveAttribute('href', /^\/people\/demo-[a-z0-9-]+$/);
    await expect(card.getByTestId('explore-lineage-size')).toHaveText(/^\d[\d,]* (person|people) on the public record$/);
    await expect(card.getByRole('link', { name: /^Explore Demo Lineage [A-C]$/ })).toHaveAttribute('href', /^\/explore\?focus=.+&lineage=.+$/);
  }
  // The search opens the palette.
  await main.locator('[data-home-search]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
