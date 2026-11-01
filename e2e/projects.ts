import { devices, type PlaywrightTestConfig } from '@playwright/test';

export type Project = NonNullable<PlaywrightTestConfig['projects']>[number];

export interface ProjectOptions {
  /** True in CI (`CI=true`): the only place where WebKit is installed. */
  ci: boolean;
  /**
   * Path to a preinstalled Chromium. Cloud sessions set PW_CHROMIUM_EXECUTABLE when the
   * pinned Playwright expects a different Chromium build than the preinstalled one
   * (plan §7.6). `playwright install` is never run there.
   */
  chromiumExecutable?: string | undefined;
  /**
   * Adds the `visual` project (M00b, plan §5.8 (d)): `@visual` screenshot comparisons against
   * the committed Linux baselines. playwright.config.ts turns it on in CI, where the browser is
   * exactly the one the pinned Playwright expects; elsewhere only with PW_VISUAL=1.
   */
  visual?: boolean;
  /**
   * Adds the `screenshots` project (M00b, plan §7.8): `@screenshots` writes the key screens to
   * docs/screenshots/<milestone>/. On request only (`pnpm screenshots`), never in a test run.
   */
  screenshots?: boolean;
  /**
   * Builds only the `exclusive` project (M08 final check): the specs that lock a whole table, and
   * (M09) those that make links public, in a run of their own after the other one (PW_EXCLUSIVE=1; scripts/verify.sh does both). Within one
   * run Playwright cannot hold them back until the others have finished without running every
   * other project in full whatever the filter (`dependencies` ignore --grep).
   */
  exclusive?: boolean;
  /**
   * Builds only the pilot projects (M13): `pilot.spec.ts` on desktop-chromium, mobile-chromium and,
   * in CI, mobile-webkit, in a run of its own after the exclusive one (PW_PILOT=1; scripts/verify.sh
   * runs all three). The pilot path makes links public and changes seeded demo accounts, so it runs
   * last, where no other spec or screenshot can see what it changed.
   */
  pilot?: boolean;
}

/** Spec files that only their own project runs. */
export const VISUAL_SPEC = '**/visual.spec.ts';
export const SCREENSHOTS_SPEC = '**/screenshots.spec.ts';
/**
 * Specs that hold a lock on a whole table to make the server's reads fail (M08 final check:
 * error states and the server log under a database timeout). Every other test would wait on that
 * lock too, so only the `exclusive` project runs them, in a Playwright run of its own
 * (PW_EXCLUSIVE=1) after the others, one test at a time.
 */
export const EXCLUSIVE_SPEC = '**/*.exclusive.spec.ts';
/**
 * Specs that make links public (M09: teacher requests and approvals; M10a: verified historical
 * claims and the archival edit of demo-root-c; M10b: claimed invitations approved by the teacher,
 * arbitration) or schools (M11: an approved listing, a pin hidden by a revoked plan). A new public
 * link changes the explorer's start list and counts, a new school the finder's lists and the
 * sitemap, and both the public pages other specs and the visual regression compare, so they run
 * with the exclusive specs, after the ordinary run.
 */
export const PUBLIC_WRITE_SPECS = ['**/m09-requests.spec.ts', '**/m10a-evidence.spec.ts', '**/m10b-claims.spec.ts', '**/m11-schools.spec.ts'] as const;
/** Everything the `exclusive` project runs, and the ordinary projects leave out. */
export const EXCLUSIVE_SPECS: string[] = [EXCLUSIVE_SPEC, ...PUBLIC_WRITE_SPECS];
/** The pilot path of plan §2.2 (M13): only the pilot run (PW_PILOT=1) runs it. */
export const PILOT_SPEC = '**/pilot.spec.ts';

/**
 * Where a run's web server writes its log, and where its artifacts go: the exclusive run (`true`)
 * and the pilot run (`'pilot'`, M13) keep their own, so neither empties or overwrites those of a
 * run before it (the visual screenshots that scripts/visual-baselines.sh prints, the server log in
 * the CI artifact).
 */
export function runPaths(run: boolean | 'pilot') {
  if (run === 'pilot') return { serverLog: 'test-results/server-pilot.log', outputDir: './test-results/pilot', htmlReport: 'test-results/pilot-report' };
  return run
    ? { serverLog: 'test-results/server-exclusive.log', outputDir: './test-results/exclusive', htmlReport: 'test-results/exclusive-report' }
    : { serverLog: 'test-results/server.log', outputDir: './test-results/artifacts', htmlReport: 'playwright-report' };
}

/**
 * Playwright projects (plan §5.8 (d)): desktop-chromium (1440x900) and mobile-chromium
 * (Pixel class) everywhere, mobile-webkit (iPhone) only in CI, on request the Chromium-only
 * `visual` and `screenshots` projects, which set their own viewports. With `exclusive`, only the
 * `exclusive` project (Chromium, 1440x900, one test at a time; EXCLUSIVE_SPECS). With `pilot`, only
 * the three device projects, running PILOT_SPEC alone (M13).
 */
export function buildProjects({ ci, chromiumExecutable, visual = false, screenshots = false, exclusive = false, pilot = false }: ProjectOptions): Project[] {
  const chromiumLaunch = chromiumExecutable
    ? { launchOptions: { executablePath: chromiumExecutable } }
    : {};

  if (exclusive) {
    return [
      {
        name: 'exclusive',
        testMatch: EXCLUSIVE_SPECS,
        fullyParallel: false,
        workers: 1,
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 1440, height: 900 },
          ...chromiumLaunch,
        },
      },
    ];
  }
  // The pilot run: the same three devices as the ordinary run, with the pilot spec alone.
  const select = pilot ? { testMatch: PILOT_SPEC } : { testIgnore: [VISUAL_SPEC, SCREENSHOTS_SPEC, ...EXCLUSIVE_SPECS, PILOT_SPEC] };

  const projects: Project[] = [
    {
      name: 'desktop-chromium',
      ...select,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...chromiumLaunch,
      },
    },
    {
      name: 'mobile-chromium',
      ...select,
      use: { ...devices['Pixel 7'], ...chromiumLaunch },
    },
  ];

  if (ci) {
    projects.push({ name: 'mobile-webkit', ...select, use: { ...devices['iPhone 15'] } });
  }
  if (pilot) return projects;

  if (visual) {
    projects.push({
      name: 'visual',
      testMatch: VISUAL_SPEC,
      // One baseline per screen and platform; only Linux baselines are committed (CI).
      snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}',
      use: { ...devices['Desktop Chrome'], ...chromiumLaunch },
    });
  }

  if (screenshots) {
    projects.push({
      name: 'screenshots',
      testMatch: SCREENSHOTS_SPEC,
      use: { ...devices['Desktop Chrome'], ...chromiumLaunch },
    });
  }

  return projects;
}
