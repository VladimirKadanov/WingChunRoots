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
}

/**
 * Playwright projects (plan §5.8 (d)): desktop-chromium (1440x900) and mobile-chromium
 * (Pixel class) everywhere, mobile-webkit (iPhone) only in CI.
 */
export function buildProjects({ ci, chromiumExecutable }: ProjectOptions): Project[] {
  const chromiumLaunch = chromiumExecutable
    ? { launchOptions: { executablePath: chromiumExecutable } }
    : {};

  const projects: Project[] = [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...chromiumLaunch,
      },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], ...chromiumLaunch },
    },
  ];

  if (ci) {
    projects.push({ name: 'mobile-webkit', use: { ...devices['iPhone 15'] } });
  }

  return projects;
}
