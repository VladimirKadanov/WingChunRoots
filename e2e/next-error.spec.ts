// The check that a page is not Next.js's error page (e2e/helpers/next-error.ts) can fail (M08
// polish 2, note 1): on the error page of this build, the one `next build` renders from Next.js's
// global-error page (.next/server/app/_global-error.html), it finds the root and the heading, and
// expectNoNextErrorPage() fails. On a page of the app it passes.

import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { expectNoNextErrorPage, NEXT_ERROR_ROOT, NEXT_ERROR_TITLE } from './helpers/next-error';

test("@M08 the check for Next.js's error page fails on the error page of this build and passes on a page of the app", async ({ page }) => {
  await page.setContent(readFileSync('.next/server/app/_global-error.html', 'utf8'));
  await expect(page.locator(NEXT_ERROR_ROOT)).toHaveCount(1);
  await expect(page.getByText(NEXT_ERROR_TITLE)).toBeVisible();
  await expect(expectNoNextErrorPage(page, { timeout: 500 })).rejects.toThrow("Next.js's error page");

  await page.goto('/plans');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoNextErrorPage(page);
});
