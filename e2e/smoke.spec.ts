import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('@smoke home page responds with 200 and has no axe violations', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'WingChunRoots' })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
