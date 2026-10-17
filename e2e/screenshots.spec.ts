/**
 * The `@screenshots` project (plan §5.8 (f), §7.8): writes every key screen of e2e/routes.ts to
 * docs/screenshots/<milestone>/<screen>-<390x844|1440x900>-<dark|light>.png, full page, for the
 * PR and the design review. Runs only on request: `pnpm screenshots` (all key screens) or
 * `SCREENSHOTS_MILESTONE=M05 pnpm screenshots` (the screens of one milestone).
 */

import { expect, test } from '@playwright/test';

import { KEY_ROUTES, SCREEN_SIZES, THEMES } from './routes';

const only = process.env.SCREENSHOTS_MILESTONE;
const routes = KEY_ROUTES.filter((route) => !only || route.milestone === only);

for (const size of SCREEN_SIZES) {
  test.describe(size.name, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      isMobile: size.mobile,
      hasTouch: size.mobile,
      // Phone screenshots at 2x so text stays legible in the PR.
      deviceScaleFactor: size.mobile ? 2 : 1,
    });

    for (const route of routes) {
      for (const theme of THEMES) {
        test(`${route.path} (${route.name}) at ${size.name} in the ${theme} theme`, { tag: ['@screenshots'] }, async ({ page }) => {
          await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
          const response = await page.goto(route.path);
          expect(response?.status()).toBe(route.status);
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await page.screenshot({
            path: `docs/screenshots/${route.milestone}/${route.name}-${size.name}-${theme}.png`,
            fullPage: true,
            animations: 'disabled',
            caret: 'hide',
          });
        });
      }
    }
  });
}
