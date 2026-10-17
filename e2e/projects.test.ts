import { describe, expect, it } from 'vitest';

import { buildProjects } from './projects';

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
