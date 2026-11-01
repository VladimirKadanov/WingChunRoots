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

import { expect, test, type Locator, type Page } from '@playwright/test';

import { distanceKm } from '../src/lib/school-finder';
import { closeHelpers, giveOwnAddress } from './helpers/auth';
import { mapSettled, markerSlugs } from './helpers/schools';

test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const marker = (page: Page, slug: string) => page.locator(`[data-testid="school-marker"][data-slug="${slug}"]`);
const sheetOf = (page: Page) => page.getByTestId('school-sheet');

/** The boxes of the map's controls that show (MapLibre's attribution and each zoom button). */
async function shownControls(page: Page): Promise<(Box & { name: string })[]> {
  return page.locator('.maplibregl-ctrl-attrib, .maplibregl-ctrl-group > button').evaluateAll((items) =>
    items
      .filter((item) => getComputedStyle(item).visibility === 'visible' && item.getClientRects().length > 0)
      .map((item) => {
        const r = item.getBoundingClientRect();
        return { name: item.getAttribute('aria-label') ?? item.className, x: r.x, y: r.y, width: r.width, height: r.height };
      }),
  );
}

/**
 * Whether `element` is what the window shows at its centre and near its four corners (nothing
 * covers any part of it). The corner points sit 4 px in, inside the controls' rounded corners
 * (--radius-md), which hit testing leaves to the element behind.
 */
function uncovered(element: Locator): Promise<boolean> {
  return element.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const inset = 4;
    const points = [
      [r.x + r.width / 2, r.y + r.height / 2],
      [r.x + inset, r.y + inset],
      [r.right - inset, r.y + inset],
      [r.x + inset, r.bottom - inset],
      [r.right - inset, r.bottom - inset],
    ];
    return points.every(([x, y]) => {
      const hit = document.elementFromPoint(x!, y!);
      return !!hit && (hit === el || el.contains(hit));
    });
  });
}

/** The top of the sheet, once it has come to rest. */
async function restingSheetTop(page: Page): Promise<number> {
  const sheet = sheetOf(page);
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const top = Math.round((await sheet.boundingBox())!.y);
        const same = top === last;
        last = top;
        return same;
      },
      { intervals: [300], message: 'the sheet comes to rest' },
    )
    .toBe(true);
  return last;
}

/** The share of the sheet's viewport (the window above the tab bar) that the resting sheet covers. */
async function sheetShare(page: Page): Promise<number> {
  const top = await restingSheetTop(page);
  const viewport = await sheetOf(page).evaluate((el) => el.parentElement!.getBoundingClientRect());
  return (viewport.bottom - top) / viewport.height;
}

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

  test('@M11 the selected pin stays above the sheet and clear of the map controls at the first and middle snap points (review screens-1)', async ({ page }) => {
    /** The pin is inside the map, above the sheet, and no control that shows overlaps it. */
    const pinClear = async (pin: Locator, label: string) => {
      await restingSheetTop(page);
      await mapSettled(page);
      await expect
        .poll(
          async () => {
            const frame = (await page.getByTestId('school-map-frame').boundingBox())!;
            const top = (await sheetOf(page).boundingBox())!.y;
            const box = (await pin.boundingBox())!;
            const over = (await shownControls(page)).filter((control) => overlaps(box, control)).map((control) => control.name);
            return { aboveSheet: box.y + box.height <= top, inFrame: box.y >= frame.y, under: over };
          },
          { message: label },
        )
        .toEqual({ aboveSheet: true, inFrame: true, under: [] });
    };

    // One school (a short list: the sheet is no taller than its content), as in the milestone's test.
    await page.goto('/schools?near=Sofia&radius=50');
    await mapSettled(page);
    const sofia = marker(page, 'demo-school-sofia');
    await sofia.tap();
    await expect(sofia).toHaveAttribute('aria-pressed', 'true');
    await pinClear(sofia, 'one school: the sheet at its first snap point');
    await sheetOf(page).getByRole('button', { name: 'Expand' }).click();
    await pinClear(sofia, 'one school: the sheet expanded');

    // Every school (a list taller than half the window, so the sheet rests at its real 0.5 point), London in view.
    await page.goto('/schools?lat=51.5074&lng=-0.1278&z=6');
    await mapSettled(page);
    const london = marker(page, 'demo-school-london');
    await london.tap();
    await expect(sheetOf(page)).toBeVisible();
    await expect(london).toHaveAttribute('aria-pressed', 'true');
    await pinClear(london, 'every school: the sheet at its first snap point');
    await sheetOf(page).getByRole('button', { name: 'Expand' }).click();
    expect(Math.abs((await sheetShare(page)) - 0.5), 'the sheet rests at its 0.5 snap point').toBeLessThan(0.02);
    await pinClear(london, 'every school: the sheet at its middle snap point');
  });

  test('@M11 "Search this area" after a move with the keyboard is clear of the attribution (review screens-6)', async ({ page }) => {
    await page.goto('/schools?near=Sofia&radius=50');
    await mapSettled(page);
    const searchArea = page.getByTestId('search-area');
    for (let i = 0; i < 6 && !(await searchArea.isVisible()); i += 1) await pressOnMap(page, 'ArrowRight', 1);
    await expect(searchArea).toBeVisible();
    const box = (await searchArea.boundingBox())!;
    expect((await shownControls(page)).filter((control) => overlaps(box, control)).map((control) => control.name)).toEqual([]);
    expect(await uncovered(searchArea), 'nothing covers "Search this area"').toBe(true);
    // The attribution is folded to its button, which opens it again.
    const toggle = page.locator('.maplibregl-ctrl-attrib-button');
    await expect(page.locator('.maplibregl-ctrl-attrib')).not.toHaveClass(/maplibregl-compact-show/);
    await toggle.tap();
    await expect(page.locator('.maplibregl-ctrl-attrib')).toHaveClass(/maplibregl-compact-show/);
  });

  test('@M11 the sheet steps through its snap points with Expand, and Esc lowers it one step before it closes (review screens-12)', async ({ page }) => {
    await page.goto('/schools?lat=51.5074&lng=-0.1278&z=6');
    await mapSettled(page);
    const london = marker(page, 'demo-school-london');
    const sheet = sheetOf(page);
    await london.tap();
    await expect(sheet).toBeVisible();
    const first = await restingSheetTop(page);

    // Expand: the middle snap point, then the last; Collapse at the last goes back to the first.
    await sheet.getByRole('button', { name: 'Expand' }).click();
    expect(Math.abs((await sheetShare(page)) - 0.5), 'Expand: the 0.5 snap point').toBeLessThan(0.02);
    const middle = await restingSheetTop(page);
    expect(middle).toBeLessThan(first);
    await sheet.getByRole('button', { name: 'Expand' }).click();
    const last = await restingSheetTop(page);
    expect(last, 'Expand again: the last snap point').toBeLessThan(middle);
    await sheet.getByRole('button', { name: 'Collapse' }).click();
    expect(await restingSheetTop(page)).toBe(first);

    // Esc from the last point: the middle one, then the first, with the school still selected.
    await sheet.getByRole('button', { name: 'Expand' }).click();
    await sheet.getByRole('button', { name: 'Expand' }).click();
    expect(await restingSheetTop(page)).toBe(last);
    await page.keyboard.press('Escape');
    expect(await restingSheetTop(page), 'Esc: one snap point down').toBe(middle);
    await expect(sheet).toBeVisible();
    await expect(london).toHaveAttribute('aria-pressed', 'true');
    // Esc with the focus on the map lowers the sheet as well.
    await london.focus();
    await page.keyboard.press('Escape');
    expect(await restingSheetTop(page), 'Esc: down to the first snap point').toBe(first);
    await expect(london).toHaveAttribute('aria-pressed', 'true');
    // From the first snap point Esc closes the sheet, and the selection with it.
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(london).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('show-list')).toBeVisible();
  });
});
