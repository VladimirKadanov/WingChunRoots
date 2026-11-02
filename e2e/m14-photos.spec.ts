/**
 * Milestone M14: profile photos. The owner of demo-hub-a (a seeded demo account, D20) adds a photo
 * on their own profile with the keyboard only, sees it on the profile, on their card in the
 * explorer and on their row in a list (demo-root-a's list view, where demo-hub-a is a student),
 * as an anonymous visitor sees it too; then removes it, and the monogram is back everywhere. axe
 * runs on the profile with the photo controls in both themes. The image is generated here: a flat
 * colour, nothing of a real person.
 *
 * Adding a photo changes public pages other specs and the visual regression compare, so the spec
 * runs in the `exclusive` project, in a Playwright run of its own after the others
 * (e2e/projects.ts, PUBLIC_WRITE_SPECS), and leaves the photo removed.
 */

import { expect, test, type Page } from '@playwright/test';

import { plainImage } from '../src/server/storage/test-images';
import { closeHelpers, giveOwnAddress, loadTestEnv, signInAs } from './helpers/auth';
import { nodeOf, openExplorer, personIdOf } from './helpers/explorer';
import { apiPost } from './helpers/plans';
import { expectNoAxeViolations, switchColorScheme } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  await giveOwnAddress(context);
});

const OWNER = 'demo-hub-a';
const LIST_PAGE = '/people/demo-root-a/lineage';

/** Moves the focus with Tab until `isTarget` holds for the focused element (at most `max` steps). */
async function tabTo(page: Page, testId: string, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, testId)) return;
  }
  throw new Error(`Tab never reached ${testId}`);
}

/** The profile header's picture: the photo or the monogram. */
const portrait = (page: Page) => page.getByTestId('person-identity').filter({ visible: true }).first();

test('@M14 the owner adds a photo with the keyboard, sees it on the profile, the explorer card and a list row, and removes it', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signInAs(page, OWNER);
  // Start clean, whatever an earlier, interrupted run left.
  await apiPost(page, '/photos/remove', {});
  const hubId = await personIdOf(OWNER);

  await page.goto(`/people/${OWNER}`);
  await expect(portrait(page).locator('[data-person-monogram]')).toBeVisible();
  const control = page.getByTestId('photo-control').filter({ visible: true });
  await expect(control.getByText('Add photo', { exact: true })).toBeVisible();

  // Keyboard only: Tab to the picker, Enter opens the system file chooser.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await tabTo(page, 'photo-input');
  // The label drawn as the button shows the focus (an outline), at least 44 px tall.
  const label = control.locator('label');
  await expect(label).toHaveCSS('outline-style', 'solid');
  const box = await label.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const bytes = Buffer.from(await plainImage('png', 400, 300));
  await (await chooser).setFiles({ name: 'demo-photo.png', mimeType: 'image/png', buffer: bytes });

  await expect(control.getByTestId('photo-status')).toHaveText('Photo added.');
  const photo = portrait(page).locator('img[data-person-photo]');
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute('alt', /\S/);
  await expect(photo).toHaveAttribute('width', /\d+/);
  await expect(photo).toHaveAttribute('height', /\d+/);
  await expect(control.getByText('Change photo', { exact: true })).toBeVisible();
  // The image itself is served (a WebP).
  const src = (await photo.getAttribute('src'))!;
  expect(src).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\/[0-9a-f]{16}\/512\.webp$/);
  const served = await page.request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/webp');

  // axe on the profile with the photo and its controls, in both themes.
  for (const theme of THEMES) {
    await switchColorScheme(page, theme);
    await expectNoAxeViolations(page, `own profile with a photo (${theme})`);
  }

  // An anonymous visitor: the profile, the explorer card and the row in a list.
  const visitor = await browser.newContext();
  await giveOwnAddress(visitor);
  const anon = await visitor.newPage();
  await anon.goto(`/people/${OWNER}`);
  await expect(portrait(anon).locator('img[data-person-photo]')).toBeVisible();
  await openExplorer(anon, { focus: hubId });
  const card = nodeOf(anon, hubId).locator('img[data-person-photo]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('loading', 'lazy');
  await expect(card).toHaveAttribute('src', /\/96\.webp$/);
  // The card is named by the person already (its aria-label): the thumbnail is not read twice.
  await expect(card).toHaveAttribute('alt', '');
  await anon.goto(LIST_PAGE);
  const row = anon.locator(`li[data-person="${OWNER}"]`).filter({ visible: true }).first();
  await expect(row.locator('img[data-person-photo]')).toBeVisible();
  await expect(row.locator('img[data-person-photo]')).toHaveAttribute('src', /\/96\.webp$/);
  // The name is next to it: the thumbnail has an empty alt.
  await expect(row.locator('img[data-person-photo]')).toHaveAttribute('alt', '');

  // Remove, with the keyboard: the focus moves to the picker, never to the page.
  await page.goto(`/people/${OWNER}`);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await tabTo(page, 'photo-remove');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('photo-control').filter({ visible: true }).getByTestId('photo-status')).toHaveText('Photo removed.');
  await expect(portrait(page).locator('[data-person-monogram]')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('photo-input');
  // The old address is gone at once.
  expect((await page.request.get(src)).status()).toBe(404);

  await anon.goto(LIST_PAGE);
  await expect(anon.locator(`li[data-person="${OWNER}"]`).filter({ visible: true }).first().locator('[data-person-monogram]')).toBeVisible();
  await visitor.close();
});

test('@M14 a file that is not an image is refused in words, and nothing changes', async ({ page }) => {
  await signInAs(page, OWNER);
  await apiPost(page, '/photos/remove', {});
  await page.goto(`/people/${OWNER}`);
  const control = page.getByTestId('photo-control').filter({ visible: true });
  await control.getByTestId('photo-input').setInputFiles({ name: 'demo.png', mimeType: 'image/png', buffer: Buffer.from('%PDF-1.4\n% demo\n%%EOF\n') });
  const status = control.getByTestId('photo-status');
  await expect(status).toHaveAttribute('data-state', 'refused');
  await expect(status).toContainText('Not changed:');
  await expect(status).toContainText('not a JPEG, PNG or WebP image');
  await expect(portrait(page).locator('[data-person-monogram]')).toBeVisible();
});

test('@M14 a visitor sees no photo controls on someone else’s profile', async ({ page }) => {
  await page.goto(`/people/${OWNER}`);
  await expect(page.getByTestId('person-identity').filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId('photo-control')).toHaveCount(0);
});
