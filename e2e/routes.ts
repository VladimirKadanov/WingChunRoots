/**
 * Every page of the app (plan §5.8 (d), docs/plan/RULES.md): e2e/a11y.spec.ts runs axe on each
 * one in both themes. A milestone that adds or changes a screen adds its route here.
 * Pure data, so scripts can read it too.
 */

export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[] = ['dark', 'light'];

export interface AppRoute {
  /** A path that renders the page; for a dynamic route, one with demo data (`demo-` slugs). */
  path: string;
  /** Short name used in test titles and screenshot file names. */
  name: string;
  /** Expected HTTP status of the document. */
  status: number;
  /** The milestone that added or last changed the page. */
  milestone: string;
  /**
   * A key screen: compared in the visual regression (e2e/visual.spec.ts, CI) and written to
   * docs/screenshots/<milestone>/ by the screenshots project (e2e/screenshots.spec.ts).
   */
  key?: boolean;
  /**
   * A page behind sign-in (M02): the specs first sign in with e2e/helpers/auth.ts signInAs():
   * a seeded demo account or role, or `new` (a confirmed account without a profile yet).
   */
  signInAs?: 'new' | 'user' | 'admin';
}

export const ROUTES: readonly AppRoute[] = [
  { path: '/', name: 'home', status: 200, milestone: 'M00b', key: true },
  { path: '/styleguide', name: 'styleguide', status: 200, milestone: 'M00b', key: true },
  { path: '/legal/licenses', name: 'licenses', status: 200, milestone: 'M00b' },
  // Accounts (M02).
  { path: '/sign-up', name: 'sign-up', status: 200, milestone: 'M02', key: true },
  { path: '/sign-in', name: 'sign-in', status: 200, milestone: 'M02', key: true },
  { path: '/sign-in/two-factor', name: 'two-factor', status: 200, milestone: 'M02' },
  { path: '/verify-email', name: 'verify-email', status: 200, milestone: 'M02' },
  { path: '/reset-password', name: 'reset-password', status: 200, milestone: 'M02' },
  { path: '/onboarding', name: 'onboarding', status: 200, milestone: 'M02', key: true, signInAs: 'new' },
  { path: '/account', name: 'account', status: 200, milestone: 'M02', signInAs: 'user' },
  { path: '/account/security', name: 'security', status: 200, milestone: 'M02', signInAs: 'user' },
  { path: '/admin', name: 'admin', status: 200, milestone: 'M02', signInAs: 'admin' },
  { path: '/legal/terms', name: 'terms', status: 200, milestone: 'M02' },
  { path: '/legal/privacy', name: 'privacy', status: 200, milestone: 'M02' },
  // The not-found page, through a path that no route will ever use.
  { path: '/demo-no-such-page', name: 'not-found', status: 404, milestone: 'M00b' },
];

/** The two viewports of the visual regression and the screenshots (plan §5.8 (d)). */
export interface ScreenSize {
  name: '390x844' | '1440x900';
  width: number;
  height: number;
  mobile: boolean;
}
export const SCREEN_SIZES: readonly ScreenSize[] = [
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '1440x900', width: 1440, height: 900, mobile: false },
];

export const KEY_ROUTES: readonly AppRoute[] = ROUTES.filter((route) => route.key);
