/**
 * The `@screenshots` project (plan §5.8 (f), §7.8): writes every key screen of e2e/routes.ts to
 * docs/screenshots/<milestone>/<screen>-<390x844|1440x900>-<dark|light>.png, full page, for the
 * PR and the design review, and the screen states below that a route alone does not reach (a
 * form after its submit). Runs only on request: `pnpm screenshots` (all of them) or
 * `SCREENSHOTS_MILESTONE=M05 pnpm screenshots` (those of one milestone).
 */

import { expect, test, type Page } from '@playwright/test';

import { closeHelpers, giveOwnAddress, signInAs, uniqueEmail } from './helpers/auth';
import { apiPost, freshAccount, giveStudents, signInSeededAdmin } from './helpers/plans';
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
    // M08: /admin/grants, with the grants and the pilot requests of the moment (not in the visual
    // regression: the tests add rows to it while it runs).
    name: 'admin-grants',
    milestone: 'M08',
    async reach(page) {
      await signInAs(page, 'admin');
      await page.goto('/admin/grants');
      await expect(page.getByRole('heading', { level: 1, name: 'Plan grants' })).toBeVisible();
    },
  },
  {
    // M08: a new Sifu's dashboard, every list empty with its next action.
    name: 'dashboard-sifu-empty',
    milestone: 'M08',
    async reach(page) {
      await freshAccount(page, { name: 'Demo New Sifu', sifu: true });
      await page.goto('/dashboard');
      await expect(page.getByTestId('empty-schools')).toBeVisible();
    },
  },
  {
    // M08: the upgrade prompt once "Request pilot access" was pressed.
    name: 'upgrade-requested',
    milestone: 'M08',
    async reach(page) {
      const sifu = await freshAccount(page, { name: 'Demo Asking Sifu', sifu: true });
      await giveStudents(sifu.userId, 5, 1);
      await page.goto('/dashboard');
      await page.getByTestId('upgrade-summary').click();
      await page.getByTestId('request-pilot-access').click();
      await expect(page.getByRole('status').filter({ hasText: 'Nothing is charged.' })).toBeVisible();
    },
  },
  {
    // M08 review round 1: the upgrade prompt opened from its one-line summary.
    name: 'upgrade-open',
    milestone: 'M08',
    async reach(page) {
      await signInAs(page, 'demo-free-sifu-5');
      await page.goto('/dashboard');
      await page.getByTestId('upgrade-summary').click();
      await expect(page.getByTestId('upgrade-benefits')).toBeVisible();
    },
  },
  {
    // M08 review round 1: an administrator's dashboard, staff work first.
    name: 'dashboard-admin',
    milestone: 'M08',
    async reach(page) {
      await signInAs(page, 'admin');
      await page.goto('/dashboard');
      await expect(page.getByTestId('staff-work')).toBeVisible();
    },
  },
  {
    // M08 review round 2: the same dashboard in a session that knows only the password.
    name: 'dashboard-admin-unverified',
    milestone: 'M08',
    async reach(page) {
      await signInSeededAdmin(page.context());
      await page.goto('/dashboard');
      await expect(page.getByTestId('staff-work')).toHaveAttribute('data-second-factor', 'unverified');
    },
  },
  {
    // M08 review round 2: an open pilot access request with its "Close request…" form.
    name: 'pilot-request-close',
    milestone: 'M08',
    async reach(page) {
      const sifu = await freshAccount(page, { name: 'Demo Closing Sifu', sifu: true });
      const asked = await apiPost(page, '/plans/request-pilot-access', { planCode: 'pro_sifu' });
      expect(asked.status(), await asked.text()).toBe(200);
      await signInAs(page, 'admin');
      await page.goto(`/admin/grants?q=${encodeURIComponent(sifu.email)}`);
      const request = page.getByTestId('pilot-request').first();
      await request.getByText('Close request…').click();
      await expect(request.getByLabel('Reason for closing')).toBeVisible();
    },
  },
  {
    // M08 final check (screens-4): the address of a pilot access request already answered.
    name: 'request-answered',
    milestone: 'M08',
    async reach(page) {
      await freshAccount(page, { name: 'Demo Answered Sifu', sifu: true });
      const asked = await apiPost(page, '/plans/request-pilot-access', { planCode: 'pro_sifu' });
      expect(asked.status(), await asked.text()).toBe(200);
      const requestId = ((await asked.json()) as { request: { id: string } }).request.id;
      await signInAs(page, 'admin');
      const closed = await apiPost(page, '/admin/grants/close-request', { requestId, reason: 'Demo pilot: answered for the screenshot' });
      expect(closed.status(), await closed.text()).toBe(200);
      await page.goto(`/admin/grants?request=${requestId}#give-plan`);
      await expect(page.getByTestId('request-answered')).toBeVisible();
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
