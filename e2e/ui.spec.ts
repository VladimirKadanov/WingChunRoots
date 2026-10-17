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

    // Expanded, the whole sheet shows (as tall as its content allows).
    await sheet.getByRole('button', { name: 'Expand' }).click();
    const top = await settledTop(sheet);
    expect(top).toBeLessThan(PHONE.height * 0.5 - 100);
    expect(top + (await sheet.boundingBox())!.height).toBeCloseTo(PHONE.height, 0);
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
    await expect(tabBar(page).getByRole('link', { name: 'Explore' }).filter({ visible: true })).toBeInViewport();

    // At the peek the body is off screen and inert; the page behind takes taps.
    await expect(sheet.locator('[inert]')).toHaveCount(1);
    expect(await hitsPage(page, PHONE.width / 2, 200)).toBe(true);

    // Expanded, the whole sheet shows above the tab bar (as tall as its content allows).
    await sheet.getByRole('button', { name: 'Expand' }).click();
    const top = await settledTop(sheet);
    expect(barTop - top).toBeGreaterThan(Math.max(96, header) + 40);
    expect(top + (await sheet.boundingBox())!.height).toBeCloseTo(barTop, 0);
    await expect(sheet.locator('[inert]')).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Collapse' }).click();
    expect(barTop - (await settledTop(sheet))).toBeLessThanOrEqual(Math.max(96, header) + 2);
    await expect(sheet.locator('[inert]')).toHaveCount(1);
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
    for (const path of ['/', '/styleguide']) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const widths = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(widths[0], `${path}: no horizontal scroll`).toBeLessThanOrEqual(widths[1]!);
      // Tab labels wrap inside their tab instead of being cut.
      for (const tab of await tabBar(page).getByRole('link').filter({ visible: true }).all()) {
        const clipped = await tab.evaluate((el) => [...el.querySelectorAll('span')].some((s) => s.scrollWidth > s.clientWidth + 1));
        expect(clipped, `${path}: ${await tab.textContent()}`).toBe(false);
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
          });
          return problems;
        }),
      )
      .toEqual([]);

    // The sheet title wraps instead of being cut.
    await page.goto('/styleguide');
    await page.getByRole('button', { name: 'Open a sheet' }).click();
    const title = page.getByRole('dialog', { name: 'Mira Probnova' }).getByRole('heading');
    await expect(title).toBeVisible();
    expect(await title.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
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

  test('@M00b from 768 px a sheet is a side panel on the right', async ({ page }) => {
    await page.goto('/styleguide');
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
});

test('@M00b the dialog, the sheets, the menu and a toast have no axe violations in either theme', async ({ page }) => {
  for (const theme of THEMES) {
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
  }
});

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

test('@M00b the Lineage tab is current on its placeholder page once the page has hydrated', async ({ page }) => {
  const response = await page.goto('/explore');
  expect(response?.status()).toBe(404);
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
