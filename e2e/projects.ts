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
}

/** Spec files that only their own project runs. */
export const VISUAL_SPEC = '**/visual.spec.ts';
export const SCREENSHOTS_SPEC = '**/screenshots.spec.ts';

/**
 * Playwright projects (plan §5.8 (d)): desktop-chromium (1440x900) and mobile-chromium
 * (Pixel class) everywhere, mobile-webkit (iPhone) only in CI, and on request the
 * Chromium-only `visual` and `screenshots` projects, which set their own viewports.
 */
export function buildProjects({ ci, chromiumExecutable, visual = false, screenshots = false }: ProjectOptions): Project[] {
  const chromiumLaunch = chromiumExecutable
    ? { launchOptions: { executablePath: chromiumExecutable } }
    : {};
  const testIgnore = [VISUAL_SPEC, SCREENSHOTS_SPEC];

  const projects: Project[] = [
    {
      name: 'desktop-chromium',
      testIgnore,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...chromiumLaunch,
      },
    },
    {
      name: 'mobile-chromium',
      testIgnore,
      use: { ...devices['Pixel 7'], ...chromiumLaunch },
    },
  ];

  if (ci) {
    projects.push({ name: 'mobile-webkit', testIgnore, use: { ...devices['iPhone 15'] } });
  }

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
