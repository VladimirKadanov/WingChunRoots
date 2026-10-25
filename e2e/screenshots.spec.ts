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
import { apiPost, freshAccount, giveStudents, signInSeededAdmin } from './helpers/plans';
import { openPalette, option, PALETTE_STATES, search, waitForSearchKeys } from './helpers/search';
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
    // The profile when its own read fails (the person-once test fault).
    name: 'person-profile-error',
    milestone: 'M04',
    async reach(page) {
      await page.context().addCookies([{ name: 'wcr-test-fault', value: `person-once:${randomUUID()}`, url: BASE_URL }]);
      await page.goto('/people/demo-two-lineages');
      await expect(page.getByRole('heading', { level: 1, name: 'This profile could not be loaded' })).toBeVisible();
    },
  },
  {
    // A hidden person's address: the 404 "Not on the record" (src/proxy.ts).
    name: 'person-not-on-record',
    milestone: 'M04',
    async reach(page) {
      const response = await page.goto('/people/demo-claim-only-teacher');
      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { level: 1, name: 'No public profile at this address' })).toBeVisible();
    },
  },
  {
    // A hub's profile: the 12 earliest of its students, the rest in the list view.
    name: 'person-hub',
    milestone: 'M04',
    async reach(page) {
      await page.goto('/people/demo-hub-a');
      await expect(page.getByRole('list', { name: /^Students of / })).toBeVisible();
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
      // Without the link's #give-plan: a full-page capture of a page scrolled to a fragment draws
      // the sticky sidebar where the scroll left it.
      await page.goto(`/admin/grants?request=${requestId}`);
      await expect(page.getByTestId('request-answered')).toBeVisible();
    },
  },
  {
    // M07: the search palette with the people a Cantonese romanization finds.
    name: 'palette',
    milestone: 'M07',
    async reach(page) {
      await waitForSearchKeys();
      await page.goto('/');
      await openPalette(page);
      await search(page, 'So Ching');
      await expect(option(page, 'So Ching Laam').first()).toBeVisible();
    },
  },
  {
    // M07: the empty palette with its hint (no recent searches in a new browser).
    name: 'palette-empty',
    milestone: 'M07',
    async reach(page) {
      await page.goto('/');
      await openPalette(page);
    },
  },
  {
    // M07: a query nothing public matches.
    name: 'palette-no-match',
    milestone: 'M07',
    async reach(page) {
      await waitForSearchKeys();
      await page.goto('/');
      await openPalette(page);
      await search(page, 'Zzyzx Quorvane');
      await expect(page.getByText('No public record matches', { exact: false })).toBeVisible();
    },
  },
  // M07: the stored Chinese name a query matched, the recent searches, a failed search.
  ...PALETTE_STATES.map((state) => ({ ...state, milestone: 'M07' })),
  {
    // M07: the profile editor refusing a save without a Latin-script display name.
    name: 'profile-invalid',
    milestone: 'M07',
    async reach(page) {
      await freshAccount(page, { name: 'Demo Screenshot Name' });
      await page.goto('/dashboard/profile');
      await page.getByLabel('Written in').first().selectOption({ label: 'Chinese, Traditional characters' });
      await page.getByRole('button', { name: 'Save my profile' }).click();
      await expect(page.locator('[data-form-message]').filter({ visible: true })).toBeVisible();
    },
  },
  {
    // M07: a profile with names in three scripts, public, after its save.
    name: 'profile-saved',
    milestone: 'M07',
    async reach(page) {
      await freshAccount(page, { name: 'Demo Lantern Example' });
      const saved = await apiPost(page, '/profile/update', {
        names: [
          { kind: 'name', value: 'Demo Lantern Example', script: 'Latn', lang: 'und-Latn', romanization: null, isPrimary: true },
          { kind: 'name', value: '燈籠', script: 'Hant', lang: 'zh-Hant', romanization: null, isPrimary: false },
          { kind: 'romanization', value: 'dang1 lung4', script: 'Latn', lang: 'yue-Latn', romanization: 'jyutping', isPrimary: false },
          { kind: 'name', value: 'Демо Фенер', script: 'Cyrl', lang: 'bg-Cyrl', romanization: null, isPrimary: false },
        ],
        bio: { body: 'A fictional practitioner of the demo data, training since the pilot began.', lang: 'en' },
        trainingStartYear: 2015,
        showPublicly: true,
      });
      expect(saved.status(), await saved.text()).toBe(200);
      await page.goto('/dashboard/profile');
      await page.getByRole('button', { name: 'Save my profile' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Your profile is saved.' })).toBeVisible();
    },
  },
  {
    // M07: /account/privacy once a deletion request is open.
    name: 'account-deletion-requested',
    milestone: 'M07',
    async reach(page) {
      await freshAccount(page, { name: 'Demo Departing Example' });
      const asked = await apiPost(page, '/account/request-deletion', { confirm: true });
      expect(asked.status(), await asked.text()).toBe(200);
      await page.goto('/account/privacy');
      await expect(page.getByText(/You asked for your account to be deleted on/)).toBeVisible();
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
