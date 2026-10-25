/**
 * Visual regression (plan §5.8 (d)): every key screen of e2e/routes.ts at 390x844 and 1440x900
 * in both themes, against the baselines committed in e2e/__screenshots__/. Only the `visual`
 * project runs this file, in CI, where the browser is exactly the one the pinned Playwright
 * expects; baselines are Linux-only and change only through a commit. How to review and update
 * them: docs/guides/admin-guide.bg.md.
 *
 * Chinese names are made transparent by e2e/visual.css: they use the system CJK fonts (plan
 * §5.3), which a runner image can change without any change in the app.
 */

import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { NAV_ITEMS } from '../src/components/shell/nav';
import { closeHelpers, signInAs } from './helpers/auth';
import { EXPLORER_VIEWS, openExplorer } from './helpers/explorer';
import { KEY_ROUTES, SCREEN_SIZES, THEMES } from './routes';

test.afterAll(closeHelpers);

for (const size of SCREEN_SIZES) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      isMobile: size.mobile,
      hasTouch: size.mobile,
      deviceScaleFactor: 1,
    });

    for (const route of KEY_ROUTES) {
      for (const theme of THEMES) {
        test(`${route.path} (${route.name}) at ${size.name} in the ${theme} theme`, { tag: ['@visual'] }, async ({ page }) => {
          await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
          if (route.signInAs) await signInAs(page, route.signInAs);
          const response = await page.goto(route.path);
          expect(response?.status()).toBe(route.status);
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          // The shell marks the page's tab once its navigation has streamed in or hydrated
          // (src/components/shell/nav-links.tsx); a screenshot taken before that shows no tab.
          const tab = NAV_ITEMS.find((item) => item.match(route.path));
          if (tab) {
            const currentTab = page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]').filter({ visible: true });
            await expect(currentTab).toHaveAttribute('href', tab.href);
          }
          await expect(page).toHaveScreenshot(`${route.name}-${size.name}-${theme}.png`, {
            stylePath: resolve('e2e/visual.css'),
          });
        });
      }
    }

    // M05: the explorer's three views (screen states: they need a demo person's id).
    for (const view of EXPLORER_VIEWS) {
      for (const theme of THEMES) {
        test(`the explorer's ${view.name} view at ${size.name} in the ${theme} theme`, { tag: ['@visual'] }, async ({ page }) => {
          await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
          await openExplorer(page, await view.params());
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await expect(page).toHaveScreenshot(`explore-${view.name}-${size.name}-${theme}.png`, { stylePath: resolve('e2e/visual.css') });
        });
      }
    }
  });
}
