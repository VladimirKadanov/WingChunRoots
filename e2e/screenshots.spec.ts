/**
 * The `@screenshots` project (plan §5.8 (f), §7.8): writes every key screen of e2e/routes.ts to
 * docs/screenshots/<milestone>/<screen>-<390x844|1440x900>-<dark|light>.png, full page, for the
 * PR and the design review, and the screen states below that a route alone does not reach (a
 * form after its submit). Runs only on request: `pnpm screenshots` (all of them) or
 * `SCREENSHOTS_MILESTONE=M05 pnpm screenshots` (those of one milestone).
 */

import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { BASE_URL, closeHelpers, giveOwnAddress, signInAs, uniqueEmail } from './helpers/auth';
import { KEY_ROUTES, SCREEN_SIZES, THEMES } from './routes';

const only = process.env.SCREENSHOTS_MILESTONE;
const routes = KEY_ROUTES.filter((route) => !only || route.milestone === only);

/** A screen reached by steps on a page, with fictional data only (D20). Not compared visually. */
interface ScreenState {
  name: string;
  milestone: string;
  /** Brings the page to the state; returns when it is on screen. */
  reach: (page: Page) => Promise<void>;
}

const STATES: readonly ScreenState[] = [
  {
    // The pending two-factor setup: QR code, key, and the app link only on a coarse pointer.
    name: 'security-setup',
    milestone: 'M02',
    async reach(page) {
      const account = await signInAs(page, 'new');
      await page.goto('/account/security');
      await page.getByLabel('Your password', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
      await expect(page.getByText('Setup not finished')).toBeVisible();
    },
  },
  {
    // The answer to a password-reset request.
    name: 'reset-sent',
    milestone: 'M02',
    async reach(page) {
      await giveOwnAddress(page.context());
      await page.goto('/reset-password');
      await page.getByLabel('E-mail address', { exact: true }).fill(uniqueEmail('screenshot'));
      await page.getByRole('button', { name: 'Send the reset link' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible();
    },
  },
  {
    // The profile when its lineage read fails (the test fault switch, src/server/faults.ts).
    name: 'person-error',
    milestone: 'M04',
    async reach(page) {
      await page.context().addCookies([{ name: 'wcr-test-fault', value: `lineage-once:${randomUUID()}`, url: BASE_URL }]);
      await page.goto('/people/demo-two-lineages');
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    },
  },
  {
    // A student's own pending request on the teacher's profile (DEFAULT D03).
    name: 'person-own-pending',
    milestone: 'M04',
    async reach(page) {
      await signInAs(page, 'demo-pending');
      await page.goto('/people/demo-hub-a');
      await expect(page.locator('li[data-person="demo-pending"]').getByText('Pending', { exact: true })).toBeVisible();
    },
  },
];
const states = STATES.filter((state) => !only || state.milestone === only);

test.afterAll(closeHelpers);

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
          if (route.signInAs) await signInAs(page, route.signInAs);
          const response = await page.goto(route.path);
          expect(response?.status()).toBe(route.status);
          await capture(page, `docs/screenshots/${route.milestone}/${route.name}-${size.name}-${theme}.png`);
        });
      }
    }

    for (const state of states) {
      for (const theme of THEMES) {
        test(`${state.name} at ${size.name} in the ${theme} theme`, { tag: ['@screenshots'] }, async ({ page }) => {
          await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
          await state.reach(page);
          await capture(page, `docs/screenshots/${state.milestone}/${state.name}-${size.name}-${theme}.png`);
        });
      }
    }
  });
}

/** A full-page capture of `page` once its fonts are ready. */
async function capture(page: Page, file: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Chromium's full-page capture drops the touch emulation, so a phone page came out with the
  // layout of a mouse pointer (`pointer: fine`: no "Open in authenticator app", no larger link
  // targets). On a touch screen the viewport grows to the page's height instead, and the capture
  // is of the viewport. The shell is at least 100dvh tall, so the height settles at once.
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  const viewport = page.viewportSize();
  if (touch && viewport) {
    for (let i = 0; i < 3; i += 1) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      if (height <= (page.viewportSize()?.height ?? 0)) break;
      await page.setViewportSize({ width: viewport.width, height });
    }
  }
  // A full-page capture draws the fixed phone tab bar where the first screen ends, over
  // the content. Here it sits at the end of the page instead, in the room the page keeps
  // for it (--page-clear-bottom), where a visitor who scrolls down sees it too.
  await page.evaluate(() => {
    document.getElementById('screenshot-tab-bar')?.remove();
    const bar = document.querySelector<HTMLElement>('[data-tab-bar]');
    if (!bar || getComputedStyle(bar).position !== 'fixed') return;
    // A style rule, not the element's style: it holds when React renders the bar again.
    const rule = document.createElement('style');
    rule.id = 'screenshot-tab-bar';
    const place = (top: number) => {
      rule.textContent = `[data-tab-bar] { position: absolute !important; bottom: auto !important; top: ${top}px !important; }`;
    };
    place(0);
    document.head.append(rule);
    const origin = bar.getBoundingClientRect().top + window.scrollY;
    place(document.documentElement.scrollHeight - bar.offsetHeight - origin);
  });
  await page.screenshot({ path: file, fullPage: !touch, animations: 'disabled', caret: 'hide' });
  if (touch && viewport) await page.setViewportSize(viewport);
}
