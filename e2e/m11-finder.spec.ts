/**
 * Milestone M11, the school finder's map (review round 1, group B): the address keeps the search
 * apart from the view, the phone's sheet (plan §5.6: snap points [0.15, 0.5, 0.92], every drag has
 * a button alternative, Esc collapses the panel, the sheet never covers the focused element), the
 * selected pin and "Search this area" clear of the map's controls, every school in the first view
 * on a phone, and the zoom buttons in forced colours.
 *
 * Read only: the demo schools of the seed (D20), with the local map styles of the E2E build
 * (src/server/geo/map-styles.ts), so the spec runs in the ordinary projects. The phone tests set
 * the 390 x 844 viewport of the milestone themselves.
 */

import { expect, test, type Page } from '@playwright/test';

import { distanceKm } from '../src/lib/school-finder';
import { closeHelpers, giveOwnAddress } from './helpers/auth';
import { mapSettled, markerSlugs } from './helpers/schools';

test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

/** The address once the map has stopped and its last view write is in (VIEW_WRITE_MS). */
async function settledAddress(page: Page): Promise<URLSearchParams> {
  const map = page.getByTestId('school-map');
  let last = '';
  await expect
    .poll(
      async () => {
        const now = `${await map.getAttribute('data-moving')} ${page.url()}`;
        const same = now === last && now.startsWith('false ');
        last = now;
        return same;
      },
      { intervals: [700], timeout: 15_000, message: 'the map and its address settle' },
    )
    .toBe(true);
  return new URL(page.url()).searchParams;
}

/** The finder's summary line ("1 school within 50 km · all lineages"), in a page loaded whole. */
const summaryOf = (page: Page) => page.getByTestId('school-summary').textContent();

/** Moves the map with the arrow keys (MapLibre's keyboard handler: 100 px a press), as a keyboard user does. */
async function pressOnMap(page: Page, key: string, presses: number) {
  await page.locator('canvas.maplibregl-canvas').focus();
  for (let i = 0; i < presses; i += 1) await page.keyboard.press(key);
  await settledAddress(page);
}

// --- The address -------------------------------------------------------------------------------

test('@M11 moving the map after "Search this area" keeps the search: a reload answers the search on screen (review code-3)', async ({ page }) => {
  await page.goto('/schools?near=Sofia&radius=50');
  await mapSettled(page);
  const searchArea = page.getByTestId('search-area');
  // A few presses east, past a third of the radius: the view has left the search.
  for (let i = 0; i < 6 && !(await searchArea.isVisible()); i += 1) await pressOnMap(page, 'ArrowRight', 1);
  await expect(searchArea).toBeVisible();
  await searchArea.click();
  await page.waitForURL((url) => url.searchParams.get('radius') === '50' && !url.searchParams.has('near'));
  // The search as a shared link opens it: its schools and its summary.
  await page.reload();
  await mapSettled(page);
  const searched = new URL(page.url()).searchParams;
  const schools = await markerSlugs(page);
  const summary = await summaryOf(page);
  expect(schools, 'a search around a point some 30 km east of Sofia').toContain('demo-school-sofia');
  expect(summary).toMatch(/^1 school within 50 km/);
  const center = { lat: Number(searched.get('clat') ?? searched.get('lat')), lng: Number(searched.get('clng') ?? searched.get('lng')) };

  // Far south of the search, without searching again: only the view moves.
  let panned = searched;
  for (let i = 0; i < 8 && distanceKm(center, { lat: Number(panned.get('lat')), lng: Number(panned.get('lng')) }) < 120; i += 1) {
    await pressOnMap(page, 'ArrowDown', 3);
    panned = new URL(page.url()).searchParams;
  }
  expect(distanceKm(center, { lat: Number(panned.get('lat')), lng: Number(panned.get('lng')) }), 'the view is far from the search').toBeGreaterThan(120);
  for (const key of ['clat', 'clng', 'radius']) expect(panned.get(key), `${key} after the move`).toBe(searched.get(key));

  // A reload (or the address shared) answers the same search, at the moved view.
  await page.reload();
  await mapSettled(page);
  expect(await markerSlugs(page)).toEqual(schools);
  expect(await summaryOf(page)).toBe(summary);
  const reloaded = new URL(page.url()).searchParams;
  for (const key of ['clat', 'clng', 'radius']) expect(reloaded.get(key), `${key} after the reload`).toBe(searched.get(key));
  expect(Number(reloaded.get('lat'))).toBeCloseTo(Number(panned.get('lat')), 3);
});

// --- The phone ---------------------------------------------------------------------------------

test.describe('at 390x844', () => {
  test.use(PHONE);

  test('@M11 the first view shows every school on a phone (review screens-5)', async ({ page }) => {
    await page.goto('/schools');
    await mapSettled(page);
    const frame = (await page.getByTestId('school-map-frame').boundingBox())!;
    const markers = page.getByTestId('school-marker');
    const count = await markers.count();
    await expect(page.getByTestId('show-list')).toContainText(`${count} schools`);
    for (let i = 0; i < count; i += 1) {
      const box = (await markers.nth(i).boundingBox())!;
      const slug = await markers.nth(i).getAttribute('data-slug');
      expect(
        { left: box.x >= frame.x, right: box.x + box.width <= frame.x + frame.width, top: box.y >= frame.y, bottom: box.y + box.height <= frame.y + frame.height },
        `${slug} inside the map`,
      ).toEqual({ left: true, right: true, top: true, bottom: true });
    }
  });

});
