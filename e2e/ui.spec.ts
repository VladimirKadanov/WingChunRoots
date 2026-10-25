/**
 * M00b, after review: the behaviour of the shell, the overlays and the home page that the
 * Done-when tests in smoke.spec.ts do not cover. Safe-area insets are emulated in Chromium only
 * (WebKit outside a device cannot); there those parts check the layout without insets.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectNoAxeViolations, openInTheme } from './helpers/ui';
import { THEMES } from './routes';

const PHONE = { width: 390, height: 844 };

async function emulateInsets(page: Page, browserName: string, insets: { top: number; right: number; bottom: number; left: number }) {
  if (browserName !== 'chromium') return { top: 0, right: 0, bottom: 0, left: 0 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  return insets;
}

/** The top edge of a sheet once its snap transition has finished. */
async function settledTop(sheet: Locator): Promise<number> {
  let previous = Number.NaN;
  for (let i = 0; i < 40; i++) {
    const top = (await sheet.boundingBox())?.y ?? Number.NaN;
    if (Math.abs(top - previous) < 0.5) return top;
    previous = top;
    await sheet.page().waitForTimeout(60);
  }
  return previous;
}

/** True when the point hits the page itself (not a scrim or an overlay). */
function hitsPage(page: Page, x: number, y: number) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px!, py!);
    return !!el && !!document.querySelector('main')?.contains(el);
  }, [x, y]);
}

/** For each visible tab of the phone tab bar: does a tap at its centre reach that tab? */
function tabsHit(page: Page) {
  return tabBar(page).evaluate((nav) =>
    [...nav.querySelectorAll('a')]
      .filter((a) => a.getBoundingClientRect().width > 0 && a.getBoundingClientRect().height > 0)
      .map((a) => {
        const box = a.getBoundingClientRect();
        return `${a.textContent}: ${a.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))}`;
      }),
  );
}

/** True when the centre of the element is not covered by anything else. */
function seenAtCentre(locator: Locator) {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  });
}

/**
 * Tabs through the page from its top until focus leaves <main>'s controls for the sheet, and
 * lists every page control that took focus while something else covered its centre (WCAG
 * 2.4.11: an open non-modal sheet must never hide the focused control). Also returns how many
 * page controls took focus and whether the walk got past the last one.
 */
async function coveredFocusStops(page: Page) {
  // Start at <main> itself (it takes focus from the skip link), so the next Tab is its first control.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('main').focus();
  const covered: string[] = [];
  let stops = 0;
  let done = false;
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press('Tab');
    // WebKit scrolls to a focused control after the key event, and FocusInView (the app shell)
    // finishes the job a frame later: look once both have run.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || !document.querySelector('main')?.contains(el)) return 'past';
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (el.contains(hit)) return 'seen';
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 30);
      return `${label} at y ${Math.round(box.y)}, under ${hit?.closest('[role="dialog"]') ? 'the sheet' : hit?.tagName}`;
    });
    // Past <main>'s last control (into the sheet, which comes after it).
    if (stop === 'past') {
      done = true;
      break;
    }
    stops++;
    if (stop !== 'seen') covered.push(stop);
  }
  return { stops, covered, done };
}

/** True when two boxes do not overlap. */
function clear(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
}

const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Main' });
/** The living line's row of one person (by the exact Latin name). */
const row = (page: Page, name: string) =>
  page.locator('[data-row]').filter({ has: page.locator('[data-name]', { hasText: new RegExp(`^${name}$`) }) });

test.describe('@M00b phone', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('@M00b the skip link stays above a status-bar inset until it is focused', async ({ page, browserName }) => {
    const insets = await emulateInsets(page, browserName, { top: 59, right: 0, bottom: 34, left: 0 });
    await page.goto('/');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    const hidden = (await skip.boundingBox())!;
    expect(hidden.y + hidden.height, 'hidden above the top edge').toBeLessThanOrEqual(0.5);
    await skip.focus();
    await expect.poll(async () => (await skip.boundingBox())!.y).toBeGreaterThanOrEqual(insets.top);
    await expect(skip).toBeInViewport();
  });

  test('@M00b the first screen shows the line from Lo Laam-fung to So Chuk-ching with its seals', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const limit = (await tabBar(page).boundingBox())!.y;
    for (const name of ['Lo Laam-fung', 'Mak Kai-chung', 'So Chuk-ching']) {
      const box = (await row(page, name).boundingBox())!;
      expect(box.y + box.height, `${name}: above the tab bar`).toBeLessThanOrEqual(limit);
    }
    for (const index of [0, 1]) {
      const seal = (await page.locator(`[data-ghost-seal="${index}"]`).boundingBox())!;
      expect(seal.y + seal.height, `seal ${index}: above the tab bar`).toBeLessThanOrEqual(limit);
    }
  });

  test('@M00b a modal sheet opens at half height over a scrim; Expand and Collapse move it', async ({ page }) => {
    await page.goto('/styleguide');
    await page.getByRole('button', { name: 'Open a sheet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Mira Probnova' });
    await expect(sheet).toBeVisible();
    expect(await settledTop(sheet)).toBeGreaterThan(PHONE.height * 0.5 - 24);
    expect(await settledTop(sheet)).toBeLessThan(PHONE.height * 0.5 + 24);
    expect(await hitsPage(page, PHONE.width / 2, 120), 'the scrim covers the page').toBe(false);
    // The scrim is seen, not only hit: fully opaque at every snap point.
    const scrim = page.locator('[data-drawer-backdrop]');
    await expect(scrim).toHaveCSS('opacity', '1');

    // Expanded, the whole sheet shows (as tall as its content allows).
    await sheet.getByRole('button', { name: 'Expand' }).click();
    const top = await settledTop(sheet);
    expect(top).toBeLessThan(PHONE.height * 0.5 - 100);
    expect(top + (await sheet.boundingBox())!.height).toBeCloseTo(PHONE.height, 0);
    await expect(scrim).toHaveCSS('opacity', '1');
    await sheet.getByRole('button', { name: 'Collapse' }).click();
    expect(await settledTop(sheet)).toBeGreaterThan(PHONE.height * 0.5 - 24);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });

  test('@M00b a non-modal sheet peeks above the tab bar, keeps its body inert and the page usable', async ({ page, browserName }) => {
    await emulateInsets(page, browserName, { top: 47, right: 0, bottom: 34, left: 0 });
    await page.goto('/styleguide');
    await page.getByRole('button', { name: 'Show a peek sheet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Jade Lantern Hall' });
    await expect(sheet).toBeVisible();

    const barTop = (await tabBar(page).boundingBox())!.y;
    const header = await sheet.evaluate((el) => el.firstElementChild!.getBoundingClientRect().height + 1);
    const visible = barTop - (await settledTop(sheet));
    expect(visible, 'the peek is at least 96 px').toBeGreaterThanOrEqual(96 - 1);
    expect(visible, 'the peek shows the whole header').toBeGreaterThanOrEqual(header - 1);
    expect(visible, 'the peek is no taller than its header').toBeLessThanOrEqual(Math.max(96, header) + 2);
    await expect(sheet.getByRole('button', { name: 'Expand' })).toBeInViewport();
    // The tab bar is drawn and tappable, not only in the viewport: nothing of the sheet is
    // painted over it (toBeInViewport checks geometry, not what is on top).
    expect(await tabsHit(page)).toEqual(['Explore: true', 'Lineage: true', 'Schools: true', 'Me: true']);

    // At the peek the body is off screen and inert; the page behind takes taps.
    await expect(sheet.locator('[inert]')).toHaveCount(1);
    expect(await hitsPage(page, PHONE.width / 2, 200)).toBe(true);

    // Expanded, the whole sheet shows above the tab bar (as tall as its content allows).
    await sheet.getByRole('button', { name: 'Expand' }).click();
    const top = await settledTop(sheet);
    expect(barTop - top).toBeGreaterThan(Math.max(96, header) + 40);
    expect(top + (await sheet.boundingBox())!.height).toBeCloseTo(barTop, 0);
    await expect(sheet.locator('[inert]')).toHaveCount(0);
    expect(await tabsHit(page), 'expanded, the sheet stays above the tabs').toEqual(['Explore: true', 'Lineage: true', 'Schools: true', 'Me: true']);
    await sheet.getByRole('button', { name: 'Collapse' }).click();
    expect(barTop - (await settledTop(sheet))).toBeLessThanOrEqual(Math.max(96, header) + 2);
    await expect(sheet.locator('[inert]')).toHaveCount(1);

    // A tap on a tab under the open peek navigates.
    await tabBar(page).getByRole('link', { name: 'Lineage' }).filter({ visible: true }).tap();
    await expect(page).toHaveURL(/\/explore$/);
  });

  test('@M00b while a non-modal sheet peeks, no page control takes focus under it, at 100 % and 150 % text', async ({ page, browserName }) => {
    await emulateInsets(page, browserName, { top: 47, right: 0, bottom: 34, left: 0 });
    await page.goto('/styleguide');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const sheet = page.getByRole('dialog', { name: 'Jade Lantern Hall' });
    for (const [viewport, text] of [
      [PHONE, '100%'],
      [{ width: 360, height: 640 }, '150%'],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.evaluate((size) => document.documentElement.style.setProperty('font-size', size), text);
      await page.getByRole('button', { name: 'Show a peek sheet' }).click();
      await expect(sheet).toBeVisible();
      const top = await settledTop(sheet);
      // The page keeps the peek's room clear (Chromium centres a control it scrolls to on focus;
      // WebKit scrolls it only as far as the scroll padding, so the padding itself must hold).
      const padding = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom));
      expect(padding, `${viewport.width} px, ${text}: focus scrolls above the peek`).toBeGreaterThanOrEqual(viewport.height - top);
      const { stops, covered, done } = await coveredFocusStops(page);
      expect(done, `${viewport.width} px, ${text}: Tab got past the page's last control`).toBe(true);
      expect(stops, `${viewport.width} px, ${text}: page controls took focus`).toBeGreaterThan(0);
      expect(covered, `${viewport.width} px, ${text}: focused under the sheet or the tab bar`).toEqual([]);
      await sheet.getByRole('button', { name: 'Close' }).click();
      await expect(sheet).toBeHidden();
    }
  });

  test('@M00b a focus below a half-height sheet expands it, so the focused control is seen', async ({ page, browserName }) => {
    await emulateInsets(page, browserName, { top: 47, right: 0, bottom: 34, left: 0 });
    await page.goto('/styleguide');
    await page.getByRole('button', { name: 'Open a sheet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Mira Probnova' });
    await expect(sheet).toBeVisible();
    await settledTop(sheet);
    const action = sheet.getByRole('button', { name: 'Copy the link' });
    expect((await action.boundingBox())!.y, 'at half height the action is below the screen').toBeGreaterThan(PHONE.height);

    // Tab on from Close to the action at the end of the sheet.
    const focused = () => action.evaluate((el) => el === document.activeElement);
    await sheet.getByRole('button', { name: 'Close' }).focus();
    for (let i = 0; i < 8 && !(await focused()); i++) await page.keyboard.press('Tab');
    // WebKit can be set to Tab through fields only (macOS "Tab to links"): then focus it directly.
    if (!(await focused())) await action.focus();
    expect(await focused()).toBe(true);

    await settledTop(sheet);
    await expect(sheet.getByRole('button', { name: 'Collapse' })).toBeVisible();
    await expect.poll(() => seenAtCentre(action), 'the focused action is on screen and not covered').toBe(true);
  });

  test('@M00b a page control focused where the browser does not scroll to it is brought clear of the bars and the peek', async ({ page }) => {
    // WebKit can leave a focused control under the tab bar or below the window; FocusInView (the
    // app shell) scrolls it into the clear band. Focus without the browser's own scroll stands in
    // for that, in every engine. The sheet opens from the keyboard: FocusInView acts while the
    // keyboard is in use.
    await page.goto('/styleguide');
    await page.getByRole('button', { name: 'Show a peek sheet' }).focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Jade Lantern Hall' });
    await expect(sheet).toBeVisible();
    await settledTop(sheet);
    await page.evaluate(() => window.scrollTo(0, 0));
    const result = await page.evaluate(async () => {
      const clearBottom = () => window.innerHeight - Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom);
      const control = [...document.querySelectorAll<HTMLElement>('main button, main input, main a[href]')].find(
        (el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().top > clearBottom(),
      );
      if (!control) return 'no control below the clear band';
      control.focus({ preventScroll: true });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = control.getBoundingClientRect();
      const seen = control.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      return seen && box.bottom <= clearBottom() + 1 ? 'clear' : `${control.textContent || control.tagName} at ${Math.round(box.top)}-${Math.round(box.bottom)}`;
    });
    expect(result).toBe('clear');
  });

  test('@M00b a focus below a non-modal sheet at half height expands it; the clipped viewport never scrolls', async ({ page, browserName }) => {
    await emulateInsets(page, browserName, { top: 47, right: 0, bottom: 34, left: 0 });
    await page.goto('/styleguide');
    await page.getByRole('button', { name: 'Show a peek sheet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Jade Lantern Hall' });
    await expect(sheet).toBeVisible();
    const barTop = (await tabBar(page).boundingBox())!.y;
    const peekTop = await settledTop(sheet);

    // Drag the sheet by its header from the peek to half height (half of the room above the tabs).
    const half = barTop / 2;
    const x = PHONE.width / 2;
    // Slowly, and still for a moment before letting go: a flick would carry it on to full height.
    await page.mouse.move(x, peekTop + 20);
    await page.mouse.down();
    for (let step = 1; step <= 20; step++) {
      await page.mouse.move(x, peekTop + 20 - ((peekTop - half) * step) / 20);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(250);
    await page.mouse.up();
    const top = await settledTop(sheet);
    expect(top, 'at half height').toBeGreaterThan(half - 24);
    expect(top, 'at half height').toBeLessThan(half + 24);
    await expect(sheet.getByRole('button', { name: 'Expand' })).toBeVisible();

    const action = sheet.getByRole('button', { name: 'Copy the hall’s link' });
    expect((await action.boundingBox())!.y, 'at half height the action is below the edge').toBeGreaterThan(barTop);
    const focused = () => action.evaluate((el) => el === document.activeElement);
    await sheet.getByRole('button', { name: 'Close' }).focus();
    for (let i = 0; i < 12 && !(await focused()); i++) await page.keyboard.press('Tab');
    if (!(await focused())) await action.focus();
    expect(await focused()).toBe(true);

    // The sheet expanded (its state, not only its look), and the viewport that clips it at the
    // tab bar did not scroll to show the focus instead.
    await settledTop(sheet);
    await expect(sheet.getByRole('button', { name: 'Collapse' })).toBeVisible();
    expect(await sheet.evaluate((el) => el.parentElement!.scrollTop)).toBe(0);
    // At full height the page is behind the sheet whatever its padding: it keeps no screen of it.
    const padding = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom));
    expect(padding, 'no screen-tall scroll padding behind a full sheet').toBeLessThan(PHONE.height / 2);
    await expect.poll(() => seenAtCentre(action), 'the focused action is on screen and not covered').toBe(true);
  });

  test('@M00b a toast lands above an open peek sheet and leaves its header usable', async ({ page, browserName }) => {
    await emulateInsets(page, browserName, { top: 47, right: 0, bottom: 34, left: 0 });
    await page.goto('/styleguide');
    await page.getByRole('button', { name: 'Show a peek sheet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Jade Lantern Hall' });
    await expect(sheet).toBeVisible();
    const top = await settledTop(sheet);
    await page.getByRole('button', { name: 'Show a toast' }).click();
    const toast = page.getByRole('dialog', { name: 'Link verified' });
    await expect(toast).toBeVisible();
    await expect.poll(async () => {
      const box = (await toast.boundingBox())!;
      return box.y + box.height;
    }).toBeLessThanOrEqual(top);
    for (const name of ['Expand', 'Close']) expect(await seenAtCentre(sheet.getByRole('button', { name })), name).toBe(true);
  });

  test('@M00b in a short landscape window at 150 % text a toast stays on screen above a peeking sheet', async ({ page }) => {
    await page.setViewportSize({ width: 740, height: 360 });
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('font-size', '150%'));
    });
    await page.goto('/styleguide');
    await page.getByRole('button', { name: 'Show a peek sheet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Jade Lantern Hall' });
    await expect(sheet).toBeVisible();
    const top = await settledTop(sheet);
    // Clicked by script: in a 360 px window the button may be scrolled out of view.
    await page.getByRole('button', { name: 'Show a toast' }).evaluate((button: HTMLElement) => button.click());
    const toast = page.getByRole('dialog', { name: 'Link verified' });
    await expect(toast).toBeVisible();
    await expect.poll(async () => {
      const box = (await toast.boundingBox())!;
      return box.y + box.height;
    }).toBeLessThanOrEqual(top);
    expect((await toast.boundingBox())!.y, 'on screen').toBeGreaterThanOrEqual(0);
  });

  for (const text of ['100%', '150%']) {
    test(`@M00b at ${text} text a toast over a full-height sheet sits under its header and covers none of its controls`, async ({ page, browserName }) => {
      const insets = await emulateInsets(page, browserName, { top: 47, right: 0, bottom: 34, left: 0 });
      await page.addInitScript((size) => {
        document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('font-size', size));
      }, text);
      await page.goto('/styleguide');
      await page.getByRole('button', { name: 'Open a sheet' }).click();
      const sheet = page.getByRole('dialog', { name: 'Mira Probnova' });
      await expect(sheet).toBeVisible();
      await sheet.getByRole('button', { name: 'Expand' }).click();
      await settledTop(sheet);
      await sheet.getByRole('button', { name: 'Copy the link' }).click();
      const toast = page.getByRole('dialog', { name: 'Link copied' });
      await expect(toast).toBeVisible();

      // No room above a full-height sheet: the toast hangs under its header, on screen (below the
      // status bar), clear of the title and of every button of the sheet, the one that raised it too.
      const heading = sheet.getByRole('heading', { name: 'Mira Probnova' });
      const headerBottom = await sheet.evaluate((el) => el.firstElementChild!.getBoundingClientRect().bottom);
      await expect.poll(async () => (await toast.boundingBox())!.y).toBeGreaterThanOrEqual(headerBottom);
      const box = (await toast.boundingBox())!;
      expect(box.y, 'below the status bar').toBeGreaterThanOrEqual(insets.top);
      expect(box.y + box.height, 'on screen').toBeLessThanOrEqual(PHONE.height);
      expect(clear(box, (await heading.boundingBox())!), 'clear of the title').toBe(true);
      const buttons = sheet.getByRole('button');
      for (let i = 0; i < (await buttons.count()); i++) {
        const button = buttons.nth(i);
        const bounds = await button.boundingBox();
        if (bounds) expect(clear(box, bounds), `clear of "${await button.textContent()}${await button.getAttribute('aria-label') ?? ''}"`).toBe(true);
      }
      // Over the sheet the toast is the page's paper, not the sheet's surface (it is not a card of the sheet).
      const ground = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await ground(toast)).not.toBe(await ground(sheet));

      // At half height the toast moves above the sheet's top edge.
      await sheet.getByRole('button', { name: 'Collapse' }).click();
      const top = await settledTop(sheet);
      await expect.poll(async () => {
        const at = (await toast.boundingBox())!;
        return at.y + at.height;
      }).toBeLessThanOrEqual(top);
    });
  }

  test('@M00b the tab bar keeps as much room under the current tab’s chop as above its icon, with no bottom inset', async ({ page }) => {
    await page.goto('/');
    const explore = tabBar(page).getByRole('link', { name: 'Explore' }).filter({ visible: true });
    await expect(explore).toHaveAttribute('aria-current', 'page');
    // The chop is stamped in (a scale transition): wait until it rests.
    const room = () =>
      explore.evaluate((tab) => {
        const box = tab.getBoundingClientRect();
        const icon = tab.querySelector('svg')!.getBoundingClientRect();
        const chop = tab.lastElementChild!.getBoundingClientRect();
        return { above: icon.top - box.top, below: box.bottom - chop.bottom, chop: chop.height };
      });
    await expect.poll(async () => (await room()).chop).toBeGreaterThan(4);
    const { above, below } = await room();
    expect(below, 'the chop never sits on the screen edge').toBeGreaterThanOrEqual(4);
    expect(Math.abs(above - below), `above the icon ${above.toFixed(1)} px, under the chop ${below.toFixed(1)} px`).toBeLessThanOrEqual(1.5);
  });

  test('@M00b on a 320 px phone at 150 % text every tab label still reads as one word', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('font-size', '150%'));
    });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(tabBar(page).getByRole('link').filter({ visible: true })).toHaveCount(4);
    const lines = await tabBar(page).evaluate((nav) =>
      [...nav.querySelectorAll('a')]
        .filter((a) => a.getBoundingClientRect().width > 0)
        .map((a) => {
          const range = document.createRange();
          range.selectNodeContents(a.querySelector('span')!);
          return `${a.textContent}: ${new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size}`;
        }),
    );
    expect(lines).toEqual(['Explore: 1', 'Lineage: 1', 'Schools: 1', 'Me: 1']);
  });

  test('@M00b form controls use at least 16 px text, so iOS does not zoom into them', async ({ page }) => {
    for (const path of ['/', '/styleguide']) {
      await page.goto(path);
      const sizes = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('input, select, textarea')].map((el) => ({
          name: el.getAttribute('aria-label') || el.id || el.tagName,
          size: Number.parseFloat(getComputedStyle(el).fontSize),
        })),
      );
      expect(sizes.length, path).toBeGreaterThan(0);
      for (const { name, size } of sizes) expect(size, `${path}: ${name}`).toBeGreaterThanOrEqual(16);
    }
  });

  test('@M00b at 150 % text the rows, the tabs and the sheet title still fit', async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('font-size', '150%'));
    });
    // No horizontal scroll on narrow phones either (320 px is the smallest supported width).
    for (const width of [320, 340]) {
      await page.setViewportSize({ width, height: 640 });
      for (const path of ['/', '/styleguide']) {
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const widths = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        expect(widths[0], `${path} at ${width} px: no horizontal scroll`).toBeLessThanOrEqual(widths[1]!);
      }
    }
    await page.setViewportSize(PHONE);
    for (const path of ['/', '/styleguide']) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const widths = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(widths[0], `${path}: no horizontal scroll`).toBeLessThanOrEqual(widths[1]!);
      // Tab labels wrap inside their tab instead of being cut. Checked in one step: React replaces
      // the tab list's Suspense fallback with the streamed list after load (see smoke.spec.ts).
      await expect(tabBar(page).getByRole('link').filter({ visible: true })).toHaveCount(4);
      const tabs = await tabBar(page).evaluate((nav) =>
        [...nav.querySelectorAll('a')]
          .filter((a) => a.getBoundingClientRect().width > 0 && a.getBoundingClientRect().height > 0)
          .map((a) => {
            // Line boxes of the label (a word broken across two lines adds one).
            const range = document.createRange();
            range.selectNodeContents(a.querySelector('span')!);
            return {
              label: a.textContent ?? '',
              clipped: [...a.querySelectorAll('span')].some((s) => s.scrollWidth > s.clientWidth + 1),
              lines: new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size,
            };
          }),
      );
      expect(tabs, `${path}: four visible tabs`).toHaveLength(4);
      for (const tab of tabs) {
        expect(tab.clipped, `${path}: ${tab.label}`).toBe(false);
        // One word, one line: a label never breaks inside the word at 150 %.
        expect(tab.lines, `${path}: ${tab.label} on one line`).toBe(1);
      }
    }

    // The living line: rows do not overlap, and each node sits level with its name.
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>('[data-row]')];
          const problems: string[] = [];
          rows.forEach((row, i) => {
            const box = row.getBoundingClientRect();
            const next = rows[i + 1]?.getBoundingClientRect();
            if (next && box.bottom > next.top + 0.5) problems.push(`row ${i} overlaps row ${i + 1}`);
            const name = row.querySelector('[data-name]')!.getBoundingClientRect();
            const node = document.querySelector(`[data-node="${i}"]`)!.getBoundingClientRect();
            const y = node.top + node.height / 2;
            if (y < name.top - 1 || y > name.bottom + 1) problems.push(`node ${i} at ${y.toFixed(0)}, name ${name.top.toFixed(0)}-${name.bottom.toFixed(0)}`);
            // The spine keeps to its column, between the year and the name, as the text grows.
            const year = document.createRange();
            year.selectNodeContents(row.querySelector('button > span')!);
            if (node.right > name.left - 1) problems.push(`node ${i} (to x ${node.right.toFixed(0)}) runs into the name at x ${name.left.toFixed(0)}`);
            if (year.getBoundingClientRect().right > node.left + 1) problems.push(`year ${i} runs into node ${i}`);
          });
          return problems;
        }),
      )
      .toEqual([]);

    // The tab bar grows with the text, and a peeking sheet rests on it, wherever its top is now:
    // nothing of the sheet covers the tabs, and the top of every icon still hits its tab.
    await page.goto('/styleguide');
    await page.getByRole('button', { name: 'Show a peek sheet' }).click();
    const peek = page.getByRole('dialog', { name: 'Jade Lantern Hall' });
    await expect(peek).toBeVisible();
    await settledTop(peek);
    const barTop = (await tabBar(page).boundingBox())!.y;
    expect(barTop, 'the tab bar is taller than its 64 px token').toBeLessThan(PHONE.height - 64);
    const sheetBottom = await peek.evaluate((el) => el.parentElement!.getBoundingClientRect().bottom);
    expect(sheetBottom, 'the peek ends at the top of the tab bar').toBeLessThanOrEqual(barTop + 0.5);
    const icons = await tabBar(page).evaluate((nav) =>
      [...nav.querySelectorAll('a')]
        .filter((a) => a.getBoundingClientRect().width > 0)
        .map((a) => {
          const icon = a.querySelector('svg')!.getBoundingClientRect();
          return `${a.textContent}: ${a.contains(document.elementFromPoint(icon.x + icon.width / 2, icon.top + 1))}`;
        }),
    );
    expect(icons).toEqual(['Explore: true', 'Lineage: true', 'Schools: true', 'Me: true']);
    await peek.getByRole('button', { name: 'Close' }).click();
    await expect(peek).toBeHidden();

    // The sheet titles wrap instead of being cut, on narrow phones too, and a peek shows its whole title.
    for (const viewport of [PHONE, { width: 360, height: 640 }, { width: 320, height: 640 }]) {
      await page.setViewportSize(viewport);
      for (const [opener, name] of [
        ['Open a sheet', 'Mira Probnova'],
        ['Show a peek sheet', 'Jade Lantern Hall'],
      ] as const) {
        await page.getByRole('button', { name: opener }).click();
        const sheet = page.getByRole('dialog', { name });
        const title = sheet.getByRole('heading', { name });
        await expect(title).toBeVisible();
        await settledTop(sheet);
        const where = `${name} at ${viewport.width} px`;
        expect(await title.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1), `${where}: not cut`).toBe(true);
        const bottom = await title.evaluate((el) => el.getBoundingClientRect().bottom);
        // By its element: a modal sheet hides the rest of the page from the accessibility tree.
        expect(bottom, `${where}: above the tab bar`).toBeLessThanOrEqual((await page.locator('[data-tab-bar]').boundingBox())!.y);
        for (const button of ['Close', 'Expand']) {
          const size = (await sheet.getByRole('button', { name: button }).boundingBox())!;
          expect(Math.round(size.width), `${where}: ${button} keeps a 44 px target`).toBe(44);
        }
        await sheet.getByRole('button', { name: 'Close' }).click();
        await expect(sheet).toBeHidden();
      }
    }
  });
});

test('@M00b Back closes the dialog and the sheet; closing them otherwise leaves no history entry', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.goto('/styleguide');
  const layer = () => page.evaluate(() => (window.history.state as Record<string, unknown> | null)?.wcrLayer ?? null);

  const dialog = page.getByRole('dialog', { name: 'Withdraw this claim?' });
  await page.getByRole('button', { name: 'Open a dialog' }).click();
  await expect(dialog).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(`${baseURL}/styleguide`);

  const sheet = page.getByRole('dialog', { name: 'Mira Probnova' });
  await page.getByRole('button', { name: 'Open a sheet' }).click();
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(`${baseURL}/styleguide`);

  // Closed with a button or Esc: the entry the layer added is gone, so Back leaves the page.
  await page.getByRole('button', { name: 'Open a dialog' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Open a sheet' }).click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect.poll(layer).toBeNull();
  await page.goBack();
  await expect(page).toHaveURL(`${baseURL}/`);
});

test.describe('@M00b desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@M00b from 1024 px a sheet is a side panel on the right; from 768 px a bottom sheet right of the rail', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/styleguide');
    await page.getByRole('button', { name: 'Open a sheet' }).click();
    const tablet = page.getByRole('dialog', { name: 'Mira Probnova' });
    await expect(tablet).toBeVisible();
    const railRight = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-w')));
    const half = (await tablet.boundingBox())!;
    expect(half.x, 'never over the rail').toBeGreaterThanOrEqual(railRight);
    expect(await settledTop(tablet)).toBeGreaterThan(1024 * 0.5 - 24);
    await expect(tablet.getByRole('button', { name: 'Expand' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tablet).toBeHidden();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Open a sheet' }).click();
    const sheet = page.getByRole('dialog', { name: 'Mira Probnova' });
    await expect(sheet).toBeVisible();
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.x)).toBe(1440 - 420);
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBeCloseTo(420, 0);
    expect(box.y).toBeCloseTo(0, 0);
    expect(box.height).toBeCloseTo(900, 0);
    await expect(sheet.getByRole('button', { name: 'Expand' })).toHaveCount(0);
  });

  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    test(`@M00b at ${viewport.width} px no page control takes focus under an open non-modal sheet, and a toast clears the sheet and the rail`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/styleguide');
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.getByRole('button', { name: 'Show a peek sheet' }).click();
      const sheet = page.getByRole('dialog', { name: 'Jade Lantern Hall' });
      await expect(sheet).toBeVisible();
      const top = await settledTop(sheet);
      // The page keeps the sheet's room clear: below 1024 px focus scrolls above the bottom sheet
      // (scroll padding); from 1024 px the panel docks and the page narrows beside it.
      const room = await page.evaluate(() => ({
        padding: Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
        mainRight: document.querySelector('main')!.getBoundingClientRect().right,
      }));
      if (viewport.width < 1024) expect(room.padding, 'focus scrolls above the sheet').toBeGreaterThanOrEqual(viewport.height - top);
      else expect(room.mainRight, 'the page ends where the panel begins').toBeLessThanOrEqual((await sheet.boundingBox())!.x + 0.5);
      const { stops, covered, done } = await coveredFocusStops(page);
      expect(done, 'Tab got past the page’s last control').toBe(true);
      expect(stops).toBeGreaterThan(0);
      expect(covered).toEqual([]);
      // The page lays out by its own width, which the docked panel narrows: nothing overflows.
      const overflowing = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('main *')) {
          if (el instanceof SVGElement) continue;
          const style = getComputedStyle(el);
          if (style.overflowX !== 'visible' || style.display === 'inline' || style.display === 'contents' || el.clientWidth === 0) continue;
          if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}": ${el.scrollWidth} px in ${el.clientWidth}`);
        }
        return out;
      });
      expect(overflowing).toEqual([]);

      // The page's own toast button is not under the sheet, so a click reaches it.
      const show = page.getByRole('button', { name: 'Show a toast' });
      await show.scrollIntoViewIfNeeded();
      expect(await seenAtCentre(show)).toBe(true);
      await show.click();
      const toast = page.getByRole('dialog', { name: 'Link verified' });
      await expect(toast).toBeVisible();
      await expect.poll(async () => clear((await toast.boundingBox())!, (await sheet.boundingBox())!), 'clear of the sheet').toBe(true);
      // The rail's controls stay seen: the toast keeps right of the rail.
      const railRight = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-w')));
      expect((await toast.boundingBox())!.x).toBeGreaterThanOrEqual(railRight);
      const theme = tabBar(page).getByRole('combobox', { name: 'Theme' });
      expect(await seenAtCentre(theme), 'the Theme control is not covered').toBe(true);
      expect(await seenAtCentre(sheet.getByRole('button', { name: 'Close' })), 'Close').toBe(true);
    });
  }
});

// One test per theme: ten axe scans of /styleguide in one test came close to the 30 s test
// timeout in mobile WebKit (32.5 s in CI run 39041835017, 22.5 s in mobile Chromium).
for (const theme of THEMES) {
  test(`@M00b the dialog, the sheets, the menu and a toast have no axe violations in the ${theme} theme`, async ({ page }) => {
    await openInTheme(page, '/styleguide', theme);

    await page.getByRole('button', { name: 'Open a dialog' }).click();
    await expect(page.getByRole('dialog', { name: 'Withdraw this claim?' })).toBeVisible();
    await expectNoAxeViolations(page, `/styleguide dialog (${theme})`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Open a sheet' }).click();
    await expect(page.getByRole('dialog', { name: 'Mira Probnova' })).toBeVisible();
    await expectNoAxeViolations(page, `/styleguide sheet (${theme})`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Show a peek sheet' }).click();
    await expect(page.getByRole('dialog', { name: 'Jade Lantern Hall' })).toBeVisible();
    await expectNoAxeViolations(page, `/styleguide peek sheet (${theme})`);
    await page.getByRole('dialog', { name: 'Jade Lantern Hall' }).getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expectNoAxeViolations(page, `/styleguide menu (${theme})`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await page.getByRole('button', { name: 'Show a toast' }).click();
    await expect(page.getByText('Link verified')).toBeVisible();
    await expectNoAxeViolations(page, `/styleguide toast (${theme})`);
  });
}

test('@M00b no text on the home page renders under 11 px, the hall tree included, from 320 px to desktop', async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const el = node.parentElement;
        if (!text || !el) continue;
        const box = el.getBoundingClientRect();
        // Hidden, or visually hidden for screen readers (1 x 1 px).
        if (box.width < 2 || box.height < 2 || getComputedStyle(el).visibility === 'hidden') continue;
        if (el.closest('script, style, noscript, [hidden]')) continue;
        let size = Number.parseFloat(getComputedStyle(el).fontSize);
        if (el instanceof SVGGraphicsElement) {
          const ctm = el.getScreenCTM();
          if (ctm) size *= Math.hypot(ctm.a, ctm.b);
        }
        if (size < 11 - 0.05) out.push(`${size.toFixed(2)} px: ${text.slice(0, 40)}`);
      }
      return out;
    });
    expect(small, `${viewport.width}x${viewport.height}`).toEqual([]);
  }
});

/** Names broken inside a word, and nodes that do not sit level with their name. */
function lineProblems(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('[data-row]').forEach((row, i) => {
      const name = row.querySelector('[data-name]')!;
      const range = document.createRange();
      range.selectNodeContents(name);
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
      const words = (name.textContent ?? '').trim().split(/\s+/).length;
      if (lines > words) out.push(`${name.textContent}: ${lines} lines for ${words} words`);
      const box = name.getBoundingClientRect();
      const node = document.querySelector(`[data-node="${i}"]`)!.getBoundingClientRect();
      const y = node.top + node.height / 2;
      if (y < box.top - 1 || y > box.bottom + 1) out.push(`node ${i} at ${Math.round(y)}, name at ${Math.round(box.top)}-${Math.round(box.bottom)}`);
    });
    return out;
  });
}

const TABLET_TO_DESKTOP = [
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

test('@M00b from tablets to desktop no name in the line breaks inside a word', async ({ page }) => {
  for (const viewport of TABLET_TO_DESKTOP) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    expect(await lineProblems(page), `${viewport.width}x${viewport.height}`).toEqual([]);
  }
});

test('@M00b every row of the line has the same height and its year on the name\'s baseline, from 320 px to desktop', async ({ page }) => {
  for (const width of [320, 360, 375, 390, 400, 640, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-row]')].map((row) => {
        // The first baseline of an element: where a zero-size inline-block at its start sits.
        const baseline = (el: Element) => {
          const mark = document.createElement('span');
          mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
          el.prepend(mark);
          const y = mark.getBoundingClientRect().top;
          mark.remove();
          return y;
        };
        return {
          name: row.querySelector('[data-name]')!.textContent,
          height: row.getBoundingClientRect().height,
          shift: baseline(row.querySelector('button > span')!) - baseline(row.querySelector('[data-name]')!),
        };
      }),
    );
    const heights = new Set(rows.map((r) => Math.round(r.height)));
    expect([...heights], `${width} px: one row height (the server draws the spine for it)`).toEqual([64]);
    for (const r of rows) expect(Math.abs(r.shift), `${width} px: ${r.name}: year on the name's baseline`).toBeLessThanOrEqual(1);
  }
});

test('@M00b the headline never puts a word on a line of its own, from 320 to 1920 px', async ({ page }) => {
  for (const width of [320, 360, 390, 600, 768, 1024, 1144, 1280, 1310, 1440, 1536, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const lines = await page.locator('main h1').evaluate((h1) => {
      const byTop = new Map<number, string[]>();
      const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of node.textContent!.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const top = Math.round(range.getClientRects()[0]!.top);
          byTop.set(top, [...(byTop.get(top) ?? []), match[0]]);
        }
      }
      return [...byTop.values()];
    });
    for (const words of lines) expect(words.length, `${width} px: "${words.join(' ')}" in ${JSON.stringify(lines)}`).toBeGreaterThan(1);
  }
});

test('@M00b nothing in <main> overflows its box on / and /styleguide, from 320 to 1440 px', async ({ page }) => {
  for (const width of [320, 360, 390, 768, 800, 852, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/styleguide']) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth} px wide`);
        for (const el of document.querySelectorAll<HTMLElement>('main *')) {
          if (el instanceof SVGElement) continue;
          const style = getComputedStyle(el);
          // Scroll containers (the tab list) and inline boxes have no overflow of their own to check.
          if (style.overflowX !== 'visible' || style.display === 'inline' || style.display === 'contents' || el.clientWidth === 0) continue;
          if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}": ${el.scrollWidth} px in ${el.clientWidth}`);
        }
        return out;
      });
      expect(problems, `${path} at ${width} px`).toEqual([]);
    }
  }
});

test.describe('@M00b without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('@M00b the server-drawn spine sits level with every name, from 320 px phones to desktop', async ({ page }) => {
    for (const viewport of [{ width: 320, height: 640 }, { width: 360, height: 800 }, { width: 390, height: 844 }, ...TABLET_TO_DESKTOP]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      expect(await lineProblems(page), `${viewport.width}x${viewport.height}`).toEqual([]);
    }
  });
});

// Until M05 /explore was the "not drawn yet" page (404); since M05 it is the explorer (200), and
// the Lineage tab is current there in the same way.
test('@M00b the Lineage tab is current on the explorer page once the page has hydrated', async ({ page }) => {
  const response = await page.goto('/explore');
  expect(response?.status()).toBe(200);
  const links = tabBar(page).getByRole('link').filter({ visible: true });
  await expect(links.filter({ hasText: 'Lineage' })).toHaveAttribute('aria-current', 'page');
  await expect(links.filter({ hasText: 'Explore' })).not.toHaveAttribute('aria-current', 'page');
});

test('@M00b tracing inks the line in its states over the pencil draft, also under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const ink = page.locator('[data-layer="ink"] [data-state]');
  await expect(ink).toHaveCount(0);
  await expect(page.locator('[data-layer="draft"] > *')).toHaveCount(7);

  await row(page, 'So Chuk-ching').getByRole('button').click();
  await expect(ink).toHaveCount(2);
  await expect(page.locator('[data-row] [aria-current="true"]')).toContainText('So Chuk-ching');

  // "Trace this hall's line" traces to the newest student: every link, the last one under review.
  await page.getByRole('link', { name: 'Trace this hall’s line' }).click();
  await expect(ink).toHaveCount(7);
  await expect(page.locator('[data-row] [aria-current="true"]')).toContainText('Georgi Maketov');
  await expect(page.locator('#demo-line')).toBeInViewport();
  const colours = await ink.evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
  const draft = await page.locator('[data-layer="draft"]').evaluate((el) => getComputedStyle(el).color);
  expect(new Set(colours).size, 'verified and under review differ').toBe(2);
  for (const colour of colours) expect(colour, 'inked, not the draft tone').not.toBe(draft);
  // The animations end at full opacity (reduced motion: at once).
  await expect.poll(() => ink.evaluateAll((els) => els.every((el) => getComputedStyle(el).opacity === '1'))).toBe(true);
});
