/**
 * Visual regression (plan §5.8 (d)): every key screen of e2e/routes.ts at 390x844 and 1440x900
 * in both themes, against the baselines committed in e2e/__screenshots__/. Only the `visual`
 * project runs this file, in CI, where the browser is exactly the one the pinned Playwright
 * expects; baselines are Linux-only and change only through a commit. How to review and update
 * them: docs/guides/admin-guide.bg.md.
 *
 * Chinese names are masked: they use the system CJK fonts (plan §5.3), which a runner image can
 * change without any change in the app.
 */

import { expect, test } from '@playwright/test';

import { KEY_ROUTES, SCREEN_SIZES, THEMES } from './routes';

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
          const response = await page.goto(route.path);
          expect(response?.status()).toBe(route.status);
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await expect(page).toHaveScreenshot(`${route.name}-${size.name}-${theme}.png`, {
            mask: [page.locator('[lang^="zh"]')],
          });
        });
      }
    }
  });
}
