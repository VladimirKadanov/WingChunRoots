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

/**
 * Switches the system colour scheme of a page that is already open and waits until its colours
 * have settled: links and buttons fade their colours (150 ms), and axe would otherwise measure
 * the contrast of a colour halfway between the two themes (CI run 39174336892: the tab labels at
 * 4.32:1 on the light ground). getAnimations() applies the new styles first, so it lists the
 * transitions the switch has just started. Their play state is read frame by frame rather than
 * awaiting `finished` or polling getAnimations(): for a transition inside a closed <details>,
 * Chromium never settles that promise, and getAnimations() polled on every frame never came back
 * empty (the security page's "Start again" form).
 */
export async function switchColorScheme(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate(async () => {
    const transitions = document.getAnimations().filter((animation) => animation instanceof CSSTransition);
    while (transitions.some((transition) => transition.playState === 'running')) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
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

/**
 * Makes Chromium treat a tap the way WebKit's GTK and WPE ports do, which Playwright's WebKit (the
 * mobile-webkit project, an iPhone viewport) runs on: a tap whose touch pointerdown was cancelled
 * counts as handled, so no mouse events and no click follow it (WebCore EventHandler::
 * handleTouchEvent; CI run 40225350083, a palette result that a tap never opened). Chromium sends
 * the click, as the Pointer Events spec asks; cancelling the touchend of such a tap stops it.
 * Call before page.goto().
 */
export async function noClickAfterCancelledTouchPress(page: Page) {
  await page.addInitScript(() => {
    let press: PointerEvent | null = null;
    // Kept from the capture phase on, read once every listener has run.
    window.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' && event.isPrimary) press = event;
    }, { capture: true });
    window.addEventListener('touchend', (event) => {
      if (press?.defaultPrevented) event.preventDefault();
      press = null;
    }, { capture: true, passive: false });
  });
}
