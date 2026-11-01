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
 *
 * WebKit applies an emulated scheme to the page's styles only in its next rendering update, so
 * right after emulateMedia() getAnimations() can come back before the switch has started any
 * transition (CI run 40645974337, mobile-webkit: the shell's navigation labels measured mid-fade
 * on the light ground). The page's own media query is therefore awaited first, then one frame, in
 * whose rendering update the new styles start their transitions.
 */
export async function switchColorScheme(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate(async (dark) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    const deadline = performance.now() + 5_000;
    while (scheme.matches !== dark) {
      if (performance.now() > deadline) throw new Error('The page never saw the new colour scheme.');
      await frame();
    }
    await frame();
    const transitions = document.getAnimations().filter((animation) => animation instanceof CSSTransition);
    while (transitions.some((transition) => transition.playState === 'running')) {
      await frame();
    }
  }, theme === 'dark');
}

/** The theme the page shows: the computed color-scheme of <html>. */
export function resolvedTheme(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
}

/**
 * axe with every rule it enables by default (WCAG 2.x A and AA plus best practices). A contrast
 * violation names the colours axe measured, so a CI log tells a real token pair from a colour
 * caught mid-transition.
 *
 * After a soft navigation (a Server Action's redirect, say) the new <title> can arrive
 * after the page's content, so axe runs once the document has a title again: a title that never
 * comes still fails here (CI run 41323978929: document-title on /account/security?codes=new).
 */
export async function expectNoAxeViolations(page: Page, label: string) {
  await expect(page, `${label}: the document has its title`).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).analyze();
  type Node = (typeof results.violations)[number]['nodes'][number];
  const measured = (node: Node) => {
    const data = node.any.find((check) => check.id === 'color-contrast')?.data as
      | { fgColor?: string; bgColor?: string; contrastRatio?: number }
      | undefined;
    return data?.contrastRatio ? ` (${data.fgColor} on ${data.bgColor}, ${data.contrastRatio}:1)` : '';
  };
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(' ')}${measured(n)}`).join('\n')}`,
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
