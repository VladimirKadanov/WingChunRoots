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
}

export const ROUTES: readonly AppRoute[] = [
  { path: '/', name: 'home', status: 200, milestone: 'M00b', key: true },
  { path: '/styleguide', name: 'styleguide', status: 200, milestone: 'M00b', key: true },
  { path: '/legal/licenses', name: 'licenses', status: 200, milestone: 'M00b' },
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
