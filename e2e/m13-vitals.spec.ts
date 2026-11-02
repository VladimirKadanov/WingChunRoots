/**
 * Milestone M13, In scope 5 (plan §5.8 (c)): INP of the key interactions at 4x CPU throttling. The
 * selection of a node, which opens the panel (a bottom sheet on a phone), is measured by
 * e2e/m05-explorer.spec.ts and a key press in the graph by e2e/m06-explorer-a11y.spec.ts; this spec
 * adds the opening of the search palette, from the home page's search field and from the app
 * shell's, with the same probes (web-vitals' onINP, else Event Timing, else a frame measure).
 * Read-only: it runs in the ordinary projects. docs/perf/web-vitals.md records the values.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { installInpProbes, interactionInp, type InpResult } from './helpers/explorer-checks';
import { palette } from './helpers/search';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

/** Opens the palette with a click or tap on `field`, then closes it with Escape. */
async function openAndClose(page: Page, field: Locator) {
  await field.click();
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
}

function report(where: string, result: InpResult) {
  test.info().annotations.push({
    type: `INP (ms, worst of 3 palette openings, 4x CPU, ${where}, ${result.method})`,
    description: `${result.inp} (Event Timing ${result.eventTiming ?? 'none'}, frame measure ${Math.round(result.frame)})`,
  });
}

test('@M13 opening the search palette responds with INP under 200 ms at 4x CPU throttling', async ({ page, browserName }) => {
  await installInpProbes(page);
  await page.goto('/');
  // Both fields are server-drawn buttons; they open the palette once their islands have hydrated.
  const home = page.locator('[data-home-search]').filter({ visible: true });
  const shell = page.locator('[data-search-field]').filter({ visible: true }).first();
  await expect(home).toBeVisible();
  await expect(shell).toBeVisible();
  await page.waitForLoadState('networkidle');

  const fromHome = await interactionInp(page, browserName, 3, () => openAndClose(page, home));
  report('home page search field', fromHome);
  expect(fromHome.inp).toBeLessThan(200);

  // A fresh page, so the shell's openings are measured on their own.
  await page.goto('/people/demo-two-lineages');
  await expect(shell).toBeVisible();
  await page.waitForLoadState('networkidle');
  const fromShell = await interactionInp(page, browserName, 3, () => openAndClose(page, shell));
  report('app shell search field on a profile', fromShell);
  expect(fromShell.inp).toBeLessThan(200);
});
