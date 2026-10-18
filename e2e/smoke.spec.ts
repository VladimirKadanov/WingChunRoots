import { readFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { THEME_COLOR } from '../src/design/theme';
import { THEME_COOKIE } from '../src/design/tokens';
import { closeHelpers, signInForRoute } from './helpers/auth';
import { expectNoAxeViolations, openInTheme, resolvedTheme } from './helpers/ui';
import { ROUTES, THEMES } from './routes';

test.afterAll(closeHelpers);

test('@smoke home page responds with 200 and has no axe violations', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'WingChunRoots' })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// M00b: design system, themes, app shell, fonts and licences.

const GOOGLE_FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const PHONE = { width: 390, height: 844 };

async function themeCookie(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === THEME_COOKIE)?.value;
}

test('@M00b home page renders in both themes with no axe violations', async ({ page }) => {
  const backgrounds = new Set<string>();
  for (const theme of THEMES) {
    const response = await openInTheme(page, '/', theme);
    expect(response?.status()).toBe(200);
    expect(await resolvedTheme(page)).toBe(theme);
    backgrounds.add(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Every teacher, every student, on the record');
    await expect(page.getByRole('searchbox', { name: 'Search the demo line' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'How a link earns its seal' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /^Jade Lantern Hall/ })).toBeVisible();
    await expectNoAxeViolations(page, `/ (${theme})`);
  }
  // Each theme paints its own ground.
  expect(backgrounds.size).toBe(2);
});

test('@M00b the theme follows prefers-color-scheme, the manual choice persists across reloads and the server renders it without a flash', async ({ page }) => {
  // 1. No choice: the page follows the system, also when it changes while the page is open.
  await openInTheme(page, '/', 'light');
  expect(await resolvedTheme(page)).toBe('light');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await themeCookie(page)).toBeUndefined();
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await resolvedTheme(page)).toBe('dark');

  // 2. A manual choice (the visible theme switch: top bar on phones, side rail on desktop).
  const themeSwitch = page.getByRole('combobox', { name: 'Theme' }).filter({ visible: true });
  await expect(themeSwitch).toHaveValue('system');
  await themeSwitch.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await resolvedTheme(page)).toBe('light');
  expect(await themeCookie(page)).toBe('light');
  for (const meta of await page.locator('meta[name="theme-color"]').all()) {
    await expect(meta).toHaveAttribute('content', THEME_COLOR.light);
  }

  // 3. It persists across reloads although the system still prefers dark.
  await page.reload();
  expect(await resolvedTheme(page)).toBe('light');
  await expect(themeSwitch).toHaveValue('light');

  // 4. No flash: the document the server sends carries the blocking theme script in <head>,
  //    and the theme is already set when the parser reaches <body>, before anything paints.
  const html = await (await page.request.get('/')).text();
  const head = html.slice(0, html.indexOf('<body'));
  expect(head).toContain(`${THEME_COOKIE}=(dark|light)`);
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      observer.disconnect();
      const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
      (window as unknown as { __atFirstBody: unknown }).__atFirstBody = {
        theme: document.documentElement.getAttribute('data-theme'),
        themeColors: metas.map((m) => m.getAttribute('content')),
      };
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto('/styleguide');
  const atFirstBody = await page.evaluate(() => (window as unknown as { __atFirstBody: unknown }).__atFirstBody);
  expect(atFirstBody).toEqual({ theme: 'light', themeColors: [THEME_COLOR.light, THEME_COLOR.light] });
  expect(await resolvedTheme(page)).toBe('light');

  // 5. "Match the system" forgets the choice.
  await themeSwitch.selectOption('system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await themeCookie(page)).toBeUndefined();
  expect(await resolvedTheme(page)).toBe('dark');
});

test.describe('@M00b phone layout', () => {
  test.use({ viewport: PHONE });

  test('@M00b at 390x844 the app shell respects safe-area insets and has no horizontal scroll', async ({ page, browserName }) => {
    const insets = { top: 47, right: 0, bottom: 34, left: 0 };
    // Chromium can emulate a notch and a home indicator; WebKit outside a device cannot, so
    // there the test checks the viewport, the layout and the scroll only (env() is 0).
    const emulated = browserName === 'chromium';
    if (emulated) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    }
    const top = emulated ? insets.top : 0;
    const bottom = PHONE.height - (emulated ? insets.bottom : 0);

    for (const route of ROUTES) {
      await signInForRoute(page, route);
      const response = await page.goto(route.path);
      expect(response?.status(), route.path).toBe(route.status);
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);

      // The top bar's content starts below the status bar / notch.
      const brand = page.getByRole('banner').getByRole('link', { name: 'WingChunRoots, home' });
      expect((await brand.boundingBox())?.y ?? -1, `${route.path}: brand below the top inset`).toBeGreaterThanOrEqual(top);

      // The bottom tabs sit above the home indicator and inside the screen. They are measured in
      // one step: a prerendered page streams the tab list after its Suspense fallback, and React
      // replaces the fallback (same layout) a frame or more after load, so a tab found by one
      // call can be gone by the next.
      const nav = page.getByRole('navigation', { name: 'Main' });
      await expect(nav.getByRole('link').filter({ visible: true })).toHaveCount(4);
      const tabs = await nav.evaluate((el) =>
        [...el.querySelectorAll('a')]
          .map((a) => a.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0)
          .map((box) => ({ y: box.y, height: box.height })),
      );
      expect(tabs, `${route.path}: four visible tabs`).toHaveLength(4);
      for (const box of tabs) {
        expect(box.y + box.height, `${route.path}: tab above the bottom inset`).toBeLessThanOrEqual(bottom + 0.5);
        expect(box.y, `${route.path}: tab on screen`).toBeGreaterThan(PHONE.height / 2);
      }

      // The end of the page scrolls clear of the tab bar.
      const tabBarTop = await page.getByRole('navigation', { name: 'Main' }).evaluate((nav) => nav.getBoundingClientRect().top);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const mainBottom = await page.locator('main').evaluate((main) => main.getBoundingClientRect().bottom);
      expect(mainBottom, `${route.path}: content ends above the tab bar`).toBeLessThanOrEqual(tabBarTop + 0.5);

      // No horizontal scroll.
      const widths = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(widths.doc, `${route.path}: no horizontal scroll`).toBeLessThanOrEqual(widths.viewport);
      expect(widths.body, `${route.path}: no horizontal scroll`).toBeLessThanOrEqual(widths.viewport);
    }
  });

  test('@M00b every interactive element on / and /styleguide is at least 44x44 px on mobile', async ({ page }) => {
    const tooSmall = async (label: string) => {
      const small = await page.evaluate(() => {
        const selector = [
          'a[href]',
          'button',
          'input:not([type="hidden"])',
          'select',
          'textarea',
          'summary',
          '[role="button"]',
          '[role="link"]',
          '[role="tab"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="switch"]',
          '[role^="menuitem"]',
          // Focusable for the keyboard but not a pointer target (WCAG 2.5.8): tab panels.
          '[tabindex]:not([tabindex="-1"]):not([role="tabpanel"])',
        ].join(',');
        return [...document.querySelectorAll<HTMLElement>(selector)]
          .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
          .filter((el) => !el.closest('[inert]'))
          // Base UI's invisible focus sentinels around popups (1x1 px, aria-hidden).
          .filter((el) => !el.hasAttribute('data-base-ui-focus-guard'))
          .map((el) => ({ el, box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.width < 44 - 0.01 || box.height < 44 - 0.01)
          .map(({ el, box }) => {
            const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 40) || el.tagName;
            return `${el.tagName.toLowerCase()} "${name}" ${box.width.toFixed(1)}x${box.height.toFixed(1)}`;
          });
      });
      expect(small, `${label}: interactive elements smaller than 44x44 px`).toEqual([]);
    };

    for (const path of ['/', '/styleguide']) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await tooSmall(path);
    }
    // An open menu (the style guide's specimen): its items too.
    await page.getByRole('button', { name: 'Actions' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem').first()).toBeVisible();
    // Measured after the opening transition, at full scale and opacity. Polled, because the
    // transition may not have started yet when the items become visible (WebKit).
    await expect
      .poll(() => menu.evaluate((el) => `${getComputedStyle(el).scale} ${getComputedStyle(el).opacity}`))
      .toMatch(/^(none|1) 1$/);
    await tooSmall('/styleguide with a menu open');
  });
});

test('@M00b fonts are self-hosted (no requests to fonts.googleapis.com or fonts.gstatic.com)', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const origin = new URL(baseURL!).origin;

  for (const route of ROUTES) {
    await signInForRoute(page, route);
    await page.goto(route.path);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const loaded = await page.evaluate(() =>
      [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/["']/g, '')),
    );
    expect(loaded, `${route.path}: the display face`).toContain('Gloock');
    expect(loaded, `${route.path}: the text face`).toContain('Schibsted Grotesk');
    // Only the two latin faces are preloaded; the Cyrillic display face downloads only where a
    // page shows Cyrillic in display text (the home page's names), and then once.
    await expect(page.locator('link[rel="preload"][as="font"]'), `${route.path}: font preloads`).toHaveCount(2);
    const noto = loaded.filter((family) => family === 'Noto Serif Display');
    if (route.path === '/') expect(noto, '/: the Cyrillic display face, once').toHaveLength(1);
    if (route.path === '/legal/licenses') expect(noto, '/legal/licenses: no Cyrillic display text').toHaveLength(0);

    // Nor do the stylesheets name a Google host.
    const sheets = await page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => (l as HTMLLinkElement).href));
    for (const sheet of sheets) {
      const css = await (await page.request.get(sheet)).text();
      for (const host of GOOGLE_FONT_HOSTS) expect(css, sheet).not.toContain(host);
    }
  }

  const hosts = requests.map((url) => new URL(url).hostname);
  for (const host of GOOGLE_FONT_HOSTS) expect(hosts).not.toContain(host);
  const fonts = requests.filter((url) => /\.(woff2?|ttf|otf)(\?|$)/.test(url));
  expect(fonts.length).toBeGreaterThanOrEqual(2);
  for (const font of fonts) expect(new URL(font).origin, font).toBe(origin);
});

test('@M00b /legal/licenses lists the third-party licenses', async ({ page }) => {
  const notices = JSON.parse(readFileSync('src/app/legal/licenses/notices.json', 'utf8')) as {
    notices: { name: string; version: string; license: string; text: number | null }[];
    texts: string[];
    addenda: { title: string }[];
  };
  const response = await page.goto('/legal/licenses');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Licenses' })).toBeVisible();

  // Every package the app ships, grouped by licence, and every addendum. Tailwind CSS is listed
  // because the CSS it generates ships, although it is a development dependency.
  const packages = page.getByRole('region', { name: /packages?$/ }).getByRole('listitem');
  await expect(packages).toHaveCount(notices.notices.length);
  for (const name of ['next', 'react', 'react-dom', '@base-ui/react', '@fontsource/gloock', '@fontsource-variable/schibsted-grotesk', 'elkjs', 'tailwindcss']) {
    expect(notices.notices.map((n) => n.name), name).toContain(name);
    await expect(packages.getByText(name, { exact: true }).first()).toBeAttached();
  }
  for (const license of ['MIT', 'OFL-1.1', 'Apache-2.0']) {
    await expect(page.getByRole('region', { name: new RegExp(`^${license.replace(/[.]/g, '\\.')}: \\d+ packages?$`) })).toBeVisible();
  }
  expect(notices.addenda.length).toBeGreaterThanOrEqual(3);
  for (const addendum of notices.addenda) {
    await expect(page.getByRole('heading', { level: 3, name: addendum.title })).toBeVisible();
  }

  // Each distinct licence text is on the page once, and every package links to its own.
  await expect(page.getByRole('region', { name: 'Licence texts' }).getByRole('article')).toHaveCount(notices.texts.length);
  expect(new Set(notices.texts).size).toBe(notices.texts.length);

  // A package opens to its licence text.
  const react = packages.filter({ has: page.getByText('react', { exact: true }) }).first();
  const link = react.getByRole('link', { name: 'Licence text of react' });
  const target = (await link.getAttribute('href'))!;
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${target}$`));
  await expect(page.locator(target)).toBeInViewport();
  await expect(page.locator(target).locator('pre')).toContainText('Permission is hereby granted');
  await expect(page.locator(target)).toContainText(`react ${notices.notices.find((n) => n.name === 'react')!.version}`);
});
