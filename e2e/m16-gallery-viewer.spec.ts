/**
 * Milestone M16: the viewer of a gallery (docs/adr/0019-galleries.md), on the seeded gallery of
 * demo-two-lineages (D20: generated images), which no test changes: so it runs in the ordinary
 * projects, on the desktop and on the phones. With the keyboard: Enter on a photo, the arrow keys
 * while the focus is inside the viewer, Esc, and the focus back on the photo. By touch: a tap on a
 * photo and on Previous/Next (44 px), nothing only on hover. The image fits the screen, there is no
 * new window, and axe runs with the viewer open in both themes.
 */

import { expect, type Locator, test } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

const SEEDED = '/people/demo-two-lineages';

test('@M16 the profile gallery opens in its viewer with the keyboard: Enter, the arrow keys, Esc, and the focus back on the photo', async ({ page }) => {
  await page.goto(SEEDED);
  const grid = page.getByTestId('profile-gallery').getByTestId('gallery-grid');
  await expect(grid).toBeVisible();
  const links = grid.locator('a[data-gallery-photo]');
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(2);
  // Every thumbnail has its alt text (the caption, or the name and its place), and a 44 px target.
  for (let i = 0; i < count; i++) {
    await expect(links.nth(i).locator('img')).toHaveAttribute('alt', /\S/);
    const box = await links.nth(i).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await links.first().focus();
  await page.keyboard.press('Enter');
  const title = page.getByTestId('gallery-viewer-title');
  await expect(title).toHaveText(`Photo 1 of ${count}`);
  const image = page.getByTestId('gallery-viewer-image');
  await expect(image).toHaveAttribute('alt', /\S/);
  await expect(image).toHaveAttribute('src', /\/full\.webp$/);
  // The arrow keys move while the focus is inside the viewer; the buttons do the same.
  await page.keyboard.press('ArrowRight');
  await expect(title).toHaveText(`Photo 2 of ${count}`);
  await page.keyboard.press('ArrowLeft');
  await expect(title).toHaveText(`Photo 1 of ${count}`);
  const next = page.getByTestId('gallery-next');
  const nextBox = await next.boundingBox();
  expect(nextBox!.height).toBeGreaterThanOrEqual(44);
  await next.click();
  await expect(title).toHaveText(`Photo 2 of ${count}`);
  await page.getByTestId('gallery-previous').click();
  await expect(title).toHaveText(`Photo 1 of ${count}`);

  // axe with the viewer open, in both themes.
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `profile gallery viewer (${theme})`);
  }

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gallery-viewer')).toHaveCount(0);
  await expect(links.first()).toBeFocused();
  // No new window, no pop-up: the page is the same one.
  expect(page.context().pages()).toHaveLength(1);
});

test('@M16 by touch on a phone (a click on the desktop): a tap opens the viewer, Previous and Next move, the photo fits the screen', async ({ page, isMobile }) => {
  const press = (locator: Locator) => (isMobile ? locator.tap() : locator.click());
  await page.goto(SEEDED);
  const links = page.getByTestId('profile-gallery').getByTestId('gallery-grid').locator('a[data-gallery-photo]');
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(2);
  await press(links.first());
  const title = page.getByTestId('gallery-viewer-title');
  await expect(title).toHaveText(`Photo 1 of ${count}`);
  await press(page.getByTestId('gallery-next'));
  await expect(title).toHaveText(`Photo 2 of ${count}`);
  await press(page.getByTestId('gallery-previous'));
  await expect(title).toHaveText(`Photo 1 of ${count}`);
  const image = page.getByTestId('gallery-viewer-image');
  await expect(image).toBeVisible();
  const box = (await image.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.height).toBeLessThanOrEqual(viewport.height);
  // No sideways scroll of the page behind it.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
