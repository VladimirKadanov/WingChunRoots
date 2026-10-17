import { describe, expect, it } from 'vitest';

import { SCREENSHOTS_SPEC, VISUAL_SPEC, buildProjects } from './projects';

describe('buildProjects', () => {
  it('runs desktop and mobile Chromium outside CI, without WebKit', () => {
    const projects = buildProjects({ ci: false });
    expect(projects.map((p) => p.name)).toEqual(['desktop-chromium', 'mobile-chromium']);
  });

  it('adds mobile WebKit (iPhone) in CI', () => {
    const projects = buildProjects({ ci: true });
    expect(projects.map((p) => p.name)).toEqual([
      'desktop-chromium',
      'mobile-chromium',
      'mobile-webkit',
    ]);
    const webkit = projects.find((p) => p.name === 'mobile-webkit');
    expect(webkit?.use?.defaultBrowserType).toBe('webkit');
    expect(webkit?.use?.isMobile).toBe(true);
  });

  it('uses a 1440x900 desktop viewport and a Pixel-class phone', () => {
    const [desktop, mobile] = buildProjects({ ci: false });
    expect(desktop?.use?.viewport).toEqual({ width: 1440, height: 900 });
    expect(mobile?.use?.isMobile).toBe(true);
    expect(mobile?.use?.hasTouch).toBe(true);
    expect(mobile?.use?.defaultBrowserType).toBe('chromium');
  });

  it('points only the Chromium projects at PW_CHROMIUM_EXECUTABLE when it is set', () => {
    const executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    const projects = buildProjects({ ci: true, chromiumExecutable: executablePath });
    const byName = Object.fromEntries(projects.map((p) => [p.name, p]));
    expect(byName['desktop-chromium']?.use?.launchOptions?.executablePath).toBe(executablePath);
    expect(byName['mobile-chromium']?.use?.launchOptions?.executablePath).toBe(executablePath);
    expect(byName['mobile-webkit']?.use?.launchOptions).toBeUndefined();
  });

  it('leaves launch options alone when no executable is given', () => {
    for (const project of buildProjects({ ci: false })) {
      expect(project.use?.launchOptions).toBeUndefined();
    }
  });
});

describe('buildProjects: visual and screenshots (M00b)', () => {
  it('adds neither project unless asked', () => {
    for (const ci of [false, true]) {
      const names = buildProjects({ ci }).map((p) => p.name);
      expect(names).not.toContain('visual');
      expect(names).not.toContain('screenshots');
    }
  });

  it('adds a Chromium visual project that runs only visual.spec.ts, with platform baselines', () => {
    const executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    const projects = buildProjects({ ci: true, visual: true, chromiumExecutable: executablePath });
    expect(projects.map((p) => p.name)).toEqual(['desktop-chromium', 'mobile-chromium', 'mobile-webkit', 'visual']);
    const visual = projects.find((p) => p.name === 'visual');
    expect(visual?.testMatch).toBe(VISUAL_SPEC);
    expect(visual?.snapshotPathTemplate).toContain('{platform}');
    expect(visual?.use?.defaultBrowserType).toBe('chromium');
    expect(visual?.use?.launchOptions?.executablePath).toBe(executablePath);
  });

  it('adds a Chromium screenshots project that runs only screenshots.spec.ts', () => {
    const projects = buildProjects({ ci: false, screenshots: true });
    expect(projects.map((p) => p.name)).toEqual(['desktop-chromium', 'mobile-chromium', 'screenshots']);
    expect(projects.at(-1)?.testMatch).toBe(SCREENSHOTS_SPEC);
    expect(projects.at(-1)?.use?.defaultBrowserType).toBe('chromium');
  });

  it('keeps the visual and screenshot specs out of the other projects', () => {
    for (const project of buildProjects({ ci: true })) {
      expect(project.testIgnore).toEqual([VISUAL_SPEC, SCREENSHOTS_SPEC]);
    }
  });
});
