/**
 * ADR 0051: organizations are one step away. The Organizations item of the menu (the rail from
 * 768 px, the "Orgs" tab on phones) replaces the former "Me" item, whose pages the account menu
 * opens; the palette finds an approved organization by its name; the sitemap lists the list and
 * every approved organization's page. The seeded demo organizations only (`Demo …`, D20). Read-only:
 * desktop and phone projects.
 */

import { expect, test } from '@playwright/test';

import { BASE_URL, closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { openPalette, option, searchInput } from './helpers/search';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

test('@nav the menu leads to the organizations, which become the current item; no Me item is left', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const phone = (page.viewportSize()?.width ?? 1280) < 768;
  const item = nav.getByRole('link', { name: phone ? 'Orgs' : 'Organizations', exact: true }).filter({ visible: true });
  await expect(item).toHaveAttribute('href', '/organizations');
  await expect(nav.getByRole('link', { name: 'Me', exact: true }).filter({ visible: true })).toHaveCount(0);
  // Five items, in this order, on either form of the menu (the list's links: not the brand link).
  await expect(nav.locator('li > a').filter({ visible: true })).toHaveText(
    phone ? ['Home', 'Lineage', 'Schools', 'Orgs', 'Events'] : ['Home', 'Lineage', 'Schools', 'Organizations', 'Events'],
  );

  await item.click();
  await expect(page).toHaveURL(/\/organizations$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Organizations' })).toBeVisible();
  await expect(item).toHaveAttribute('aria-current', 'page');

  // An organization's own page keeps the item current.
  await page.goto('/organizations/demo-federation-north');
  await expect(page.getByRole('heading', { level: 1, name: 'Demo Federation North' })).toBeVisible();
  await expect(item).toHaveAttribute('aria-current', 'page');
});

test('@nav the palette finds an approved organization by its name and opens its page', async ({ page }) => {
  await page.goto('/schools');
  await openPalette(page);
  await searchInput(page).fill('federation north');
  const hit = option(page, 'Demo Federation North');
  await expect(hit).toBeVisible();
  await expect(hit).toContainText('Federation');
  await hit.click();
  await expect(page).toHaveURL(/\/organizations\/demo-federation-north$/);
});

test('@nav the sitemap lists the organizations and each approved organization', async ({ request }) => {
  const sitemap = await request.get(`${BASE_URL}/sitemap.xml`);
  expect(sitemap.status()).toBe(200);
  const text = await sitemap.text();
  expect(text).toContain('/organizations</loc>');
  expect(text).toContain('/organizations/demo-federation-north</loc>');
});
