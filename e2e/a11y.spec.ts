/**
 * axe on every page of e2e/routes.ts in both themes (plan §5.8 (d), docs/plan/RULES.md).
 * The theme comes from the system colour scheme, the path most visitors take. Tagged @smoke,
 * so every milestone's `scripts/verify.sh` runs it, not only M00b.
 */

import { expect, test } from '@playwright/test';

import { closeHelpers, signInAs } from './helpers/auth';
import { openInTheme, expectNoAxeViolations, resolvedTheme } from './helpers/ui';
import { ROUTES, THEMES } from './routes';

test.afterAll(closeHelpers);

for (const route of ROUTES) {
  for (const theme of THEMES) {
    test(`@M00b ${route.path} (${route.name}) has no axe violations in the ${theme} theme`, { tag: ['@smoke', '@a11y'] }, async ({ page }) => {
      if (route.signInAs) await signInAs(page, route.signInAs);
      const response = await openInTheme(page, route.path, theme);
      expect(response?.status()).toBe(route.status);
      expect(await resolvedTheme(page)).toBe(theme);
      await expectNoAxeViolations(page, `${route.path} (${theme})`);
    });
  }
}
