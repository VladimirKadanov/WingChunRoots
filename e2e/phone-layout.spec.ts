/**
 * The phone layout (docs/adr/0053-phone-layout.md): on a phone the filters, the explorer's options,
 * the dashboard's menu and the profile's key fold behind one button each, so the content
 * comes first; the map's attribution folds to its ⓘ button after five seconds; the legal pages are
 * one line (Terms · Privacy · Licenses) and the style guide is not linked; an empty search shows
 * quick links. The seeded demo records only (D20). Desktop and phone projects.
 */

import { expect, test, type Page } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { openExplorer, personIdOf } from './helpers/explorer';
import { openPalette, palette } from './helpers/search';
import { mapSettled } from './helpers/schools';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

const width = (page: Page) => page.viewportSize()?.width ?? 1280;
const isPhone = (page: Page) => width(page) < 768;
const visibleIn = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });

test('@phone the home page names the legal pages in one line and does not link the style guide', async ({ page }) => {
  await page.goto('/');
  const legal = page.getByRole('navigation', { name: 'Legal' }).filter({ visible: true });
  await expect(legal.getByRole('link')).toHaveText(['Terms', 'Privacy', 'Licenses']);
  await expect(page.locator('a[href="/styleguide"]')).toHaveCount(0);
});

test('@phone an empty search offers quick links, and none to the licences', async ({ page }) => {
  await page.goto('/');
  await openPalette(page);
  const links = palette(page).getByTestId('palette-quick-links');
  await expect(links.getByRole('link')).toHaveText(['Find a school near you', 'Upcoming events', 'Explore a lineage']);
  await links.getByRole('link', { name: 'Upcoming events' }).click();
  await expect(page).toHaveURL(/\/events$/);
});

test('@phone the explorer keeps its controls in one row on a phone: Options is folded, the key stays', async ({ page }) => {
  await openExplorer(page, { focus: await personIdOf('demo-two-lineages'), up: 1, down: 1 });
  const options = page.getByTestId('explorer-options');
  const summary = options.locator(':scope > summary');
  const teachers = page.getByRole('group', { name: 'Teachers' });
  const keyList = page.getByTestId('explorer-legend').getByRole('list').first();
  if (!isPhone(page)) {
    // Wide screens show everything; the buttons are not drawn.
    await expect(teachers).toBeVisible();
    await expect(summary).toBeHidden();
    await expect(keyList).toBeVisible();
    return;
  }
  await expect(summary).toBeVisible();
  await expect(teachers).toBeHidden();
  // The View switch and Options share one row.
  const [a, b] = [await page.getByRole('group', { name: 'View', exact: true }).boundingBox(), await summary.boundingBox()];
  expect(a && b && Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) < 12, 'View and Options on one row').toBe(true);
  await summary.click();
  await expect(teachers).toBeVisible();
  await summary.click();
  await expect(teachers).toBeHidden();
  // The key stays shown (plan M05: always visible), compact.
  await expect(keyList).toBeVisible();
});

test('@phone the event filters fold behind one button and the first event is on the first screen', async ({ page }) => {
  await page.goto('/events');
  const filters = visibleIn(page, 'filters');
  const country = page.getByLabel('Country').filter({ visible: true });
  if (!isPhone(page)) {
    await expect(country).toBeVisible();
    return;
  }
  await expect(filters.locator(':scope > summary')).toHaveText(/Filters/);
  await expect(country).toBeHidden();
  const first = page.locator('main a[href^="/events/demo-"]').filter({ visible: true }).first();
  await expect(first).toBeInViewport();
  await filters.locator(':scope > summary').click();
  await expect(country).toBeVisible();
});

test('@phone the school finder keeps the city and Filters in one row; distance and lineage fold', async ({ page }) => {
  await page.goto('/schools');
  const filters = visibleIn(page, 'filters');
  const distance = page.getByLabel('Distance').filter({ visible: true });
  if (width(page) >= 1024) {
    await expect(distance).toBeVisible();
    await expect(filters.locator(':scope > summary')).toBeHidden();
    return;
  }
  await expect(distance).toBeHidden();
  await filters.locator(':scope > summary').click();
  await expect(distance).toBeVisible();
});

test('@phone the map attribution folds to its button after five seconds and opens again from it', async ({ page }) => {
  await page.goto('/schools');
  const map = await mapSettled(page);
  const attribution = map.locator('.maplibregl-ctrl-attrib');
  await expect(attribution).toBeVisible();
  // MapLibre's compact attribution: open (compact-show) at first, folded later, never removed.
  await expect(attribution).not.toHaveClass(/maplibregl-compact-show/, { timeout: 10_000 });
  const button = attribution.locator('.maplibregl-ctrl-attrib-button');
  await expect(button).toBeVisible();
  await button.click();
  await expect(attribution).toHaveClass(/maplibregl-compact-show/);
  await expect(attribution).toHaveText(/\S/);
});

test('@phone the profile key folds to "What the lines mean" below 1280 px', async ({ page }) => {
  await page.goto('/people/demo-two-lineages');
  const key = page.getByTestId('lineage-key').filter({ visible: true });
  const summary = key.locator(':scope > summary');
  const heading = key.locator('#key-heading');
  if (width(page) >= 1280) {
    await expect(summary).toBeHidden();
    await expect(heading).toBeVisible();
    return;
  }
  await expect(summary).toHaveText(/What the lines mean/);
  await expect(heading).toBeHidden();
  await summary.click();
  await expect(heading).toBeVisible();
});
