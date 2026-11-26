/**
 * Role replay 2026-11-25, P3-1: on a phone the profile editor shows each saved name as a row with
 * Edit, and only one opens at a time; a new name opens by itself. A computer keeps every name open.
 * Fictional demo data only (D20); nothing is saved.
 */
import { expect, test } from '@playwright/test';

import { signInAs } from './helpers/auth';
import { expectNoAxeViolations } from './helpers/ui';

test('@nav on a phone the names are rows with Edit, one open at a time (P3-1)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, 'demo-root-a');
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('button', { name: 'Add a name' })).toBeVisible();

  const rows = page.locator('[data-name-row]');
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  await expect(page.locator('[data-name-row][data-collapsed]')).toHaveCount(count);
  // A closed row names the name, its script and whether it is the display name.
  await expect(rows.first().getByTestId('name-summary')).toContainText('Display name');
  await expect(page.locator('input[name="names.0.value"]')).toBeHidden();

  await rows.nth(1).getByRole('button', { name: 'Edit name 2' }).click();
  await expect(page.locator('input[name="names.1.value"]')).toBeFocused();
  await expect(page.locator('[data-name-row][data-collapsed]')).toHaveCount(count - 1);

  // Opening another closes the first.
  await rows.first().getByRole('button', { name: 'Edit name 1' }).click();
  await expect(page.locator('input[name="names.0.value"]')).toBeVisible();
  await expect(page.locator('input[name="names.1.value"]')).toBeHidden();

  // Done closes it and gives the focus back to its Edit.
  await rows.first().getByRole('button', { name: 'Done with name 1' }).click();
  await expect(rows.first().getByRole('button', { name: 'Edit name 1' })).toBeFocused();
  await expect(page.locator('[data-name-row][data-collapsed]')).toHaveCount(count);

  // A new name opens by itself.
  await page.getByRole('button', { name: 'Add a name' }).click();
  await expect(page.locator(`input[name="names.${count}.value"]`)).toBeFocused();
  await expect(page.locator('[data-name-row][data-collapsed]')).toHaveCount(count);
  await expectNoAxeViolations(page, '/dashboard/profile (phone, names as rows)');
});

test('@nav on a computer every name stays open (P3-1)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAs(page, 'demo-root-a');
  await page.goto('/dashboard/profile');
  await expect(page.getByRole('button', { name: 'Add a name' })).toBeVisible();
  await expect(page.locator('[data-name-row][data-collapsed]')).toHaveCount(0);
  await expect(page.locator('input[name="names.1.value"]')).toBeVisible();
});
