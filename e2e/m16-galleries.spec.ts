/**
 * Milestone M16: galleries (docs/adr/0019-galleries.md). The seeded gallery of demo-two-lineages
 * (D20: generated images) opens in its viewer with the keyboard (Enter, the arrow keys, Esc, the
 * focus back on the photo) and by touch-sized buttons; a new account adds a photo with the
 * keyboard on /dashboard/photos, captions it, meets its Free Student limit (the upgrade prompt,
 * only there) and removes it; a Sifu adds a logo and a room photo to their school, whose public
 * page then shows them, and no served rendition carries the photo's GPS position. axe runs on the
 * profile with the viewer open and on both management pages, in both themes. Every image is
 * generated here: a flat colour, nothing of a real person.
 *
 * The school becomes public and a new public profile is made, which changes pages other specs and
 * the visual regression compare, so the spec runs in the `exclusive` project, in a Playwright run of
 * its own after the others (e2e/projects.ts, PUBLIC_WRITE_SPECS).
 */

import { expect, test, type Page } from '@playwright/test';

import { jpegWithGps, plainImage } from '../src/server/storage/test-images';
import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { apiPost, freshAccount } from './helpers/plans';
import { approveListing, freshContext, pendingListing, signedIn } from './helpers/schools';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

const SEEDED = '/people/demo-two-lineages';

/** Moves the focus with Tab until the focused element has `testId` (at most `max` steps). */
async function tabTo(page: Page, testId: string, max = 120) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, testId)) return;
  }
  throw new Error(`Tab never reached ${testId}`);
}

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

test('@M16 an owner adds a photo with the keyboard, captions it, meets the Free Student limit, and removes it', async ({ page }) => {
  test.setTimeout(120_000);
  await freshAccount(page, { name: 'Demo Gallery Owner' });
  await page.goto('/dashboard/photos');
  await expect(page.getByRole('heading', { level: 1, name: 'Your photos' })).toBeVisible();
  await expect(page.getByTestId('gallery-manager-allowance')).toContainText('0 of 1');
  await expect(page.getByTestId('upgrade-prompt')).toHaveCount(0);
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `dashboard photos, empty (${theme})`);
  }

  // Keyboard only: Tab to the picker, Enter opens the system file chooser.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await tabTo(page, 'gallery-input');
  const label = page.getByTestId('gallery-manager').locator('label', { hasText: 'Add photo' });
  await expect(label).toHaveCSS('outline-style', 'solid');
  expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'demo-photo.png', mimeType: 'image/png', buffer: Buffer.from(await plainImage('png', 400, 300)) });
  await expect(page.getByTestId('gallery-status')).toHaveText('Photo added.');
  await expect(page.getByTestId('gallery-item')).toHaveCount(1);
  await expect(page.getByTestId('gallery-item-state')).toHaveText('Photo 1 of 1 · Profile photo');

  // At the real limit: the picker says so in words, and the upgrade prompt appears.
  await expect(page.getByTestId('gallery-manager-allowance')).toContainText('1 of 1');
  await expect(page.getByTestId('upgrade-prompt')).toBeVisible();
  await expect(page.getByTestId('gallery-input')).toHaveAttribute('aria-disabled', 'true');

  // The caption: the photo's alt text everywhere.
  await page.getByTestId('gallery-caption').fill('Demo morning class');
  await page.getByTestId('gallery-caption-save').click();
  await expect(page.getByTestId('gallery-status')).toHaveText('Caption saved.');
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `dashboard photos, at the limit (${theme})`);
  }

  // The profile shows it, with the alt text from the caption.
  await page.getByTestId('gallery-profile-link').click();
  const grid = page.getByTestId('profile-gallery').getByTestId('gallery-grid');
  await expect(grid.locator('img')).toHaveAttribute('alt', 'Demo morning class');
  await expect(page.getByTestId('gallery-allowance')).toContainText('1 of 1');

  // Removed: the gallery is empty and the picker free again.
  await page.goto('/dashboard/photos');
  await page.getByTestId('gallery-remove').click();
  await expect(page.getByTestId('gallery-status')).toHaveText('Photo removed. You have no profile photo now.');
  await expect(page.getByTestId('gallery-item')).toHaveCount(0);
  await expect(page.getByTestId('upgrade-prompt')).toHaveCount(0);
  await expect(page.getByTestId('gallery-input')).not.toHaveAttribute('aria-disabled', 'true');
});

test('@M16 a Sifu adds a logo and a room photo to their school; the public page shows them and no rendition carries a GPS position', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const admin = await signedIn(browser, 'admin');
  try {
    const { school } = await pendingListing(page, admin.page);
    await page.goto(`/dashboard/schools/${school.id}/photos`);
    await expect(page.getByRole('heading', { level: 1, name: 'Logo and photos' })).toBeVisible();
    await expect(page.getByTestId('school-rooms-count')).toHaveText('0 of 12 photos.');
    for (const theme of THEMES) {
      await switchColorScheme(page, theme);
      await expectNoAxeViolations(page, `school photos, empty (${theme})`);
    }

    await page.getByTestId('school-logo-input').setInputFiles({ name: 'demo-logo.png', mimeType: 'image/png', buffer: Buffer.from(await plainImage('png', 300, 120)) });
    await expect(page.getByTestId('school-photos-status')).toHaveText('Logo added.');
    await expect(page.getByTestId('school-logo-preview')).toBeVisible();
    await page.getByTestId('school-room-input').setInputFiles({ name: 'demo-room.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await jpegWithGps(640, 480)) });
    await expect(page.getByTestId('school-photos-status')).toHaveText('Photo added.');
    await expect(page.getByTestId('school-rooms-count')).toHaveText('1 of 12 photos.');
    await page.getByTestId('school-room-item').getByTestId('gallery-caption').fill('Demo training room');
    await page.getByTestId('school-room-item').getByTestId('gallery-caption-save').click();
    await expect(page.getByTestId('school-photos-status')).toHaveText('Caption saved.');
    for (const theme of THEMES) {
      await switchColorScheme(page, theme);
      await expectNoAxeViolations(page, `school photos, with a logo and a room (${theme})`);
    }

    // Listed: an anonymous visitor sees the logo and the room photo on the public page.
    await approveListing(admin.page, school.id);
    const visitor = await freshContext(browser);
    try {
      await visitor.page.goto(`/schools/${school.slug}`);
      await expect(visitor.page.getByTestId('school-logo')).toBeVisible();
      const room = visitor.page.getByTestId('school-gallery-grid').locator('img');
      await expect(room).toHaveAttribute('alt', 'Demo training room');
      const link = (await visitor.page.getByTestId('school-gallery-grid').locator('a').getAttribute('href'))!;
      const sources = [link, (await room.getAttribute('src'))!, (await visitor.page.getByTestId('school-logo').getAttribute('src'))!];
      for (const src of sources) {
        expect(src).toMatch(/^\/api\/school-photos\/[0-9a-f-]{36}\/[0-9a-f]{16}\/(96|512|full)\.webp$/);
        const served = await visitor.page.request.get(src);
        expect(served.status()).toBe(200);
        expect(served.headers()['content-type']).toBe('image/webp');
        const bytes = await served.body();
        expect(bytes.includes(Buffer.from('GPS'))).toBe(false);
        expect(bytes.includes(Buffer.from('Exif'))).toBe(false);
      }
      // The page itself names no exact position either (city-only or exact, never the photo's).
      expect(await visitor.page.content()).not.toContain('GPS');
    } finally {
      await visitor.context.close();
    }

    // The owner removes the room photo again; the count says so.
    const removed = await apiPost(page, '/schools/photos/remove', { photoId: (await page.getByTestId('school-room-item').getAttribute('data-photo'))! });
    expect(removed.status(), await removed.text()).toBe(200);
  } finally {
    await admin.context.close();
  }
});
