/**
 * Role replay 2026-11-25, P2-12: the city field is a type-ahead over every place of the GeoNames
 * extract (a town of about 9,000 people, not in the old list of large cities), and "My city is
 * missing" tells the admins a place's name and country. Fictional demo data only (D20).
 */
import { expect, test } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../src/server/db';
import { closeHelpers, loadTestEnv } from './helpers/auth';
import { freshAccount } from './helpers/plans';
import { chooseCity, expectNoAxeViolations } from './helpers/ui';

test.beforeAll(() => {
  loadTestEnv();
});
test.afterAll(closeHelpers);

test('@nav the profile finds a small town by any spelling and saves it (P2-12)', async ({ page }) => {
  const account = await freshAccount(page, { name: 'Demo Townsfolk Ilex' });
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('button', { name: 'Add a name' })).toBeVisible();

  // The Cyrillic spelling finds it as well; the keyboard moves through the options.
  const box = page.getByRole('combobox', { name: 'City or town' });
  await box.fill('Банско');
  const option = page.getByRole('option', { name: 'Bansko, BG' });
  await expect(option).toBeVisible();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  await box.press('ArrowDown');
  await expect(box).toHaveAttribute('aria-activedescendant', (await option.getAttribute('id'))!);
  await box.press('Escape');
  await expect(box).toHaveAttribute('aria-expanded', 'false');

  await chooseCity(page, 'Bansk', 'Bansko, BG');
  // Choosing the town sets its country.
  await expect(page.getByLabel('Country', { exact: true })).toHaveValue('BG');
  await expectNoAxeViolations(page, '/dashboard/profile (city type-ahead)');
  await page.getByRole('button', { name: 'Save my profile' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toBeVisible();

  const rows = await getDb().execute<{ place: string | null }>(sql`
    SELECT pl.name AS place FROM person p JOIN auth_user u ON u.id = p.claimed_by_user_id LEFT JOIN place pl ON pl.id = p.place_id WHERE u.email = ${account.email}`);
  expect(rows.rows).toEqual([{ place: 'Bansko' }]);

  // The saved town is shown again after a reload.
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'City or town' })).toHaveValue('Bansko, BG');
});

test('@nav "My city is missing" tells the admins and leads back to the form (P2-12)', async ({ page }) => {
  await freshAccount(page, { name: 'Demo Townsfolk Juniper' });
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('button', { name: 'Add a name' })).toBeVisible();
  await page.getByTestId('missing-city-link').first().click();
  await expect(page).toHaveURL(/\/dashboard\/places\/missing\?next=%2Fdashboard%2Fprofile/);
  await expect(page.getByRole('heading', { level: 1, name: 'My city is missing' })).toBeVisible();

  // Nothing typed: the form says what is missing.
  await page.getByRole('button', { name: 'Tell the administrators' }).click();
  await expect(page.getByText('Type the name of your city or town.').first()).toBeVisible();

  const name = `Demo Hamlet ${Date.now().toString(36)}`;
  await page.getByLabel('City or town').fill(name);
  await page.getByLabel('Country').selectOption('BG');
  await page.getByRole('button', { name: 'Tell the administrators' }).click();
  await expect(page.getByText(`The administrators now know that ${name} is missing`)).toBeVisible();

  const told = await getDb().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM notification n JOIN auth_user u ON u.id = n.user_id
     WHERE u.role = 'admin' AND n.template = 'place.missing' AND n.payload->>'name' = ${name}`);
  expect(told.rows[0]!.n).toBeGreaterThan(0);

  await page.getByTestId('missing-place-back').click();
  await expect(page).toHaveURL(/\/dashboard\/profile$/);
});
