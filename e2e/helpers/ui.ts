// Shared steps of the UI tests (M00b): themes, axe and fonts.

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

import type { Theme } from '../routes';

/** The cookie that stores a manual theme choice (src/design/tokens.ts THEME_COOKIE). */
export const THEME_COOKIE = 'wcr-theme';

/** Opens `path` with the system colour scheme set to `theme` and waits for the web fonts. */
export async function openInTheme(page: Page, path: string, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  const response = await page.goto(path);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return response;
}

/** The theme the page shows: the computed color-scheme of <html>. */
export function resolvedTheme(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
}

/** axe with every rule it enables by default (WCAG 2.x A and AA plus best practices). */
export async function expectNoAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(' ')}`).join('\n')}`,
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
}
