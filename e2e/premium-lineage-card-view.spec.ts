/**
 * The lineage card (docs/adr/0045-lineage-card.md), as it is seen, on the desktop and the phone.
 * demo-premium-student (person demo-b-166) is public and holds Premium Student, so their profile links to the card,
 * which shows their public route of descent ending in them; the share image is a PNG; on paper
 * only the card is printed. A person whose plan has no card gets "Not on the record" (the page
 * streams, so inline and never indexed) and a 404 for the image. axe runs in both themes. It only reads, so it runs in the ordinary projects. Fictional (D20).
 */

import { expect, test } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

test('@premium a Premium Student has a lineage card: the profile links to it, it ends in them, and it prints alone', async ({ page }) => {
  await page.goto('/people/demo-b-166');
  const link = page.getByTestId('lineage-card-link');
  await expect(link).toHaveText('Lineage card');
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page).toHaveURL(/\/people\/demo-b-166\/card$/);

  const card = page.getByTestId('lineage-card');
  await expect(card).toBeVisible();
  const steps = card.getByTestId('lineage-card-step');
  expect(await steps.count()).toBeGreaterThanOrEqual(2);
  const name = (await page.getByRole('heading', { level: 1 }).innerText()).replace(/^Lineage card of /, '').trim();
  await expect(steps.last()).toContainText(name);
  await expect(steps.last()).toContainText('This member');
  await expect(steps.first()).toContainText('Earliest known teacher');
  await expect(page.getByTestId('print-card')).toBeVisible();
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `lineage card (${theme})`);
  }

  // The share image: a PNG of the same route.
  const href = await page.getByTestId('share-image').getAttribute('href');
  const image = await page.request.get(href!);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');

  // On paper: the card, without the app's navigation or the buttons.
  await page.emulateMedia({ media: 'print' });
  await expect(card).toBeVisible();
  await expect(page.getByRole('navigation', { name: /main|primary/i })).toBeHidden();
  await expect(page.getByTestId('lineage-card-actions')).toBeHidden();
});

test('@premium a person whose plan has no card: no link, "Not on the record" on the page, 404 for the image', async ({ page }) => {
  await page.goto('/people/demo-two-lineages');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('lineage-card-link')).toHaveCount(0);
  await page.goto('/people/demo-two-lineages/card');
  await expect(page.getByRole('heading', { level: 1, name: 'No public profile at this address' })).toBeVisible();
  await expect(page.getByTestId('lineage-card')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect((await page.request.get('/people/demo-two-lineages/card/image')).status()).toBe(404);
});
