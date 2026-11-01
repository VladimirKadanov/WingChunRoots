/**
 * Milestone M11, review fixes of the finder and the school form (screens-3, screens-7, screens-9,
 * screens-10, screens-11): the phone's map view with large text, a distance chosen without a place,
 * the list's selected row and the form's checkboxes in forced colours, and the focus around "Drop
 * the pin on a map". The pages run on the project's own device (the phone checks on
 * mobile-chromium; WebKit only in CI).
 *
 * Read only: nothing is saved, and the Sifus are new `demo-e2e-…@example.test` accounts with
 * private profiles and fictional `Demo …` names (D20), so nothing public changes and the spec runs
 * in the ordinary run, not with PUBLIC_WRITE_SPECS.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { closeHelpers, giveOwnAddress, loadTestEnv } from './helpers/auth';
import { letters } from './helpers/evidence';
import { freshAccount } from './helpers/plans';
import { mapSettled, visible } from './helpers/schools';
import { expectNoAxeViolations } from './helpers/ui';
import { THEMES } from './routes';

test.beforeAll(loadTestEnv);
test.afterAll(closeHelpers);

test.beforeEach(async ({ context }) => {
  // Rate limits are per client address: each test is its own client.
  await giveOwnAddress(context);
});

const finderSearch = (page: Page) => page.getByRole('search', { name: 'Find a school' });

/** The page is narrower than the finder's two-column layout (1024 px): the phone's map view. */
const narrow = (page: Page) => page.evaluate(() => !matchMedia('(min-width: 64rem)').matches);

// --- Geometry ----------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

/** After scrolling it into view, the control itself is what a tap at its centre reaches (nothing covers it). */
async function reachable(control: Locator): Promise<boolean> {
  await control.scrollIntoViewIfNeeded();
  return control.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  });
}

/** The selected option of a <select> and whether its text fits the select's text box (not cut). */
function selectText(select: Locator) {
  return select.evaluate((el: HTMLSelectElement) => {
    const style = getComputedStyle(el);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = el.options[el.selectedIndex]?.text ?? '';
    const room = el.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    return { text, fits: context.measureText(text).width <= room };
  });
}

// --- Pixels ------------------------------------------------------------------------------------

type Rgb = [number, number, number];

/** The pixels of a screenshot (PNG), decoded by the page's own canvas. */
async function pixels(page: Page, png: Buffer): Promise<{ width: number; height: number; rgb: Rgb[] }> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    const rgb: [number, number, number][] = [];
    for (let i = 0; i < data.length; i += 4) rgb.push([data[i]!, data[i + 1]!, data[i + 2]!]);
    return { width: image.width, height: image.height, rgb };
  }, png.toString('base64'));
}

const distance = (a: Rgb, b: Rgb) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const mean = (list: Rgb[]): Rgb => [0, 1, 2].map((i) => list.reduce((sum, p) => sum + p[i]!, 0) / list.length) as Rgb;

/** The most common colour of a screenshot: its ground (Canvas, in forced colours). */
function ground(list: Rgb[]): Rgb {
  const counts = new Map<string, number>();
  for (const p of list) counts.set(p.join(','), (counts.get(p.join(',')) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0].split(',').map(Number) as Rgb;
}

/** The mean colour of a strip of the page (CSS px, in the viewport). */
async function stripColour(page: Page, clip: Box): Promise<Rgb> {
  return mean((await pixels(page, await page.screenshot({ clip, scale: 'css' }))).rgb);
}

/** How far a row's 4 px left edge is from the ground just inside it: a bar is far, no bar is near. */
async function leftBar(page: Page, row: Locator): Promise<number> {
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  const band = { y: Math.round(box.y + 8), height: Math.max(4, Math.round(box.height - 16)) };
  const edge = await stripColour(page, { x: Math.round(box.x), width: 4, ...band });
  const ground = await stripColour(page, { x: Math.round(box.x) + 6, width: 4, ...band });
  return distance(edge, ground);
}

// --- The tests ---------------------------------------------------------------------------------

test('@M11 in forced colours only the selected school of the list has the bar beside it', async ({ page }) => {
  // The list view: nothing is selected, so no row has a bar.
  await page.goto('/schools?view=list');
  const rows = visible(page.getByTestId('school-row'));
  expect(await rows.count()).toBeGreaterThan(2);
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme, forcedColors: 'active' });
    for (let i = 0; i < 3; i += 1) {
      expect(await leftBar(page, rows.nth(i)), `${theme}, forced colours: row ${i + 1} of the list view has no bar`).toBeLessThan(40);
    }
  }
  await page.emulateMedia({ forcedColors: 'none' });

  // The list beside the map (from 1024 px): "Show on the map" selects a school; its row alone has the bar.
  if (await narrow(page)) await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/schools');
  await mapSettled(page);
  const aside = page.locator('aside[aria-labelledby="school-list-heading"]');
  const sofia = aside.locator('[data-testid="school-row"][data-slug="demo-school-sofia"]');
  await sofia.getByTestId('show-on-map').click();
  await expect(sofia).toHaveAttribute('data-selected', 'true');
  const others = aside.locator('[data-testid="school-row"]:not([data-selected])');
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme, forcedColors: 'active' });
    expect(await leftBar(page, sofia), `${theme}, forced colours: the selected row has its bar`).toBeGreaterThan(100);
    for (let i = 0; i < 2; i += 1) {
      expect(await leftBar(page, others.nth(i)), `${theme}, forced colours: an unselected row beside the map has no bar`).toBeLessThan(40);
    }
  }
  await page.emulateMedia({ forcedColors: 'none' });
});
