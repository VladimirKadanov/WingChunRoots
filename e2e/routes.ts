/**
 * Every page of the app (plan §5.8 (d), docs/plan/RULES.md): e2e/a11y.spec.ts runs axe on each
 * one in both themes. A milestone that adds or changes a screen adds its route here.
 * Pure data, so scripts can read it too.
 */

import type { DemoAccountSlug } from '../src/fixtures/generate';

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
   * M08: also a demo account by slug (src/fixtures/generate.ts), for the dashboards.
   */
  signInAs?: 'new' | 'user' | 'admin' | DemoAccountSlug;
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
  // People and their lineage (M04): a profile, its list view, and the page a hidden or missing
  // person gets (the same for both, plan §6.4).
  { path: '/people/demo-two-lineages', name: 'person', status: 200, milestone: 'M04', key: true },
  { path: '/people/demo-two-lineages/lineage', name: 'person-lineage', status: 200, milestone: 'M04', key: true },
  { path: '/people/demo-claim-only-teacher', name: 'person-not-on-record', status: 404, milestone: 'M04' },
  // The not-found page, through a path that no route will ever use.
  { path: '/demo-no-such-page', name: 'not-found', status: 404, milestone: 'M00b' },
  // Plans and dashboards (M08). The dashboards of demo accounts that no test changes: Free Sifu at
  // its limit with the upgrade prompt, and a student with a pending request. /admin/grants lists
  // grants and requests that the tests add while the visual regression runs, so its screenshots
  // come from a screen state (e2e/screenshots.spec.ts) instead.
  { path: '/plans', name: 'plans', status: 200, milestone: 'M08', key: true },
  { path: '/dashboard', name: 'dashboard-sifu', status: 200, milestone: 'M08', key: true, signInAs: 'demo-free-sifu-5' },
  { path: '/dashboard', name: 'dashboard-student', status: 200, milestone: 'M08', key: true, signInAs: 'demo-pending' },
  { path: '/dashboard/settings', name: 'dashboard-settings', status: 200, milestone: 'M08', key: true, signInAs: 'demo-free-sifu-5' },
  { path: '/admin/grants', name: 'admin-grants', status: 200, milestone: 'M08', signInAs: 'admin' },
  // The explorer (M05): its starting page. The three graph views and the list view need a demo
  // person's id, so they are screen states (e2e/screenshots.spec.ts, e2e/visual.spec.ts; axe in
  // e2e/m05-explorer.spec.ts).
  { path: '/explore', name: 'explore-start', status: 200, milestone: 'M05', key: true },
  // Names, profile and privacy (M07): the profile editor and the privacy page of a demo account
  // that no test changes (the tests that save use accounts of their own). The search palette is a
  // screen state (e2e/screenshots.spec.ts, e2e/visual.spec.ts, e2e/m07-search.spec.ts).
  { path: '/dashboard/profile', name: 'profile', status: 200, milestone: 'M07', key: true, signInAs: 'demo-pending' },
  { path: '/account/privacy', name: 'account-privacy', status: 200, milestone: 'M07', key: true, signInAs: 'demo-pending' },
  // Teacher requests (M09): demo accounts that no test changes. demo-pending has one request
  // waiting; demo-free-sifu-5 has five students, one request at its limit and the upgrade prompt
  // (its approval is refused, so nothing changes). The tests that approve use accounts of their own.
  { path: '/dashboard/teachers', name: 'teachers', status: 200, milestone: 'M09', key: true, signInAs: 'demo-pending' },
  { path: '/dashboard/teachers/new', name: 'teachers-new', status: 200, milestone: 'M09', key: true, signInAs: 'demo-pending' },
  { path: '/dashboard/students/requests', name: 'student-requests', status: 200, milestone: 'M09', key: true, signInAs: 'demo-free-sifu-5' },
  // Evidence and the review queue (M10a). The claim form of a demo account that no test changes;
  // the queue as the seeded administrator sees it (the seeded cases: the M10a spec, which adds and
  // decides cases, runs in the exclusive run after the visual regression); the archival edit of
  // demo-root-c as the seeded archivist. The case card needs a case's id: a screen state
  // (e2e/screenshots.spec.ts).
  { path: '/dashboard/teachers/historical', name: 'teachers-historical', status: 200, milestone: 'M10a', key: true, signInAs: 'demo-pending' },
  { path: '/admin/review', name: 'review-queue', status: 200, milestone: 'M10a', key: true, signInAs: 'admin' },
  { path: '/admin/review/records/demo-root-c', name: 'review-record', status: 200, milestone: 'M10a', key: true, signInAs: 'demo-archivist' },
  // Invitations, claims, instructors, reports and arbitration (M10b): demo accounts that no test
  // changes (the tests that invite, claim, report and arbitrate use accounts of their own). The
  // invitation page needs a token and the arbitration form a relationship's id: screen states
  // (e2e/screenshots.spec.ts), with axe in e2e/m10b-claims.spec.ts.
  { path: '/dashboard/teachers/invite', name: 'teachers-invite', status: 200, milestone: 'M10b', key: true, signInAs: 'demo-pending' },
  { path: '/dashboard/instructor', name: 'instructor', status: 200, milestone: 'M10b', key: true, signInAs: 'demo-free-sifu-5' },
  { path: '/dashboard/cases', name: 'cases', status: 200, milestone: 'M10b', signInAs: 'demo-pending' },
  { path: '/people/demo-two-lineages/report', name: 'report', status: 200, milestone: 'M10b', key: true, signInAs: 'demo-pending' },
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
