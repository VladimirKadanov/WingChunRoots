import { describe, expect, it } from 'vitest';

import { EXCLUSIVE_SPEC, EXCLUSIVE_SPECS, PILOT_SPEC, PUBLIC_WRITE_SPECS, SCREENSHOTS_SPEC, VISUAL_SPEC, VITALS_TAG, buildProjects, runPaths } from './projects';

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

  it('keeps the visual, screenshot, exclusive and pilot specs out of the other projects', () => {
    for (const project of buildProjects({ ci: true })) {
      expect(project.testIgnore).toEqual([VISUAL_SPEC, SCREENSHOTS_SPEC, EXCLUSIVE_SPEC, ...PUBLIC_WRITE_SPECS, PILOT_SPEC]);
    }
  });
});

describe('buildProjects: exclusive (M08 final check)', () => {
  it('builds only the exclusive project, one test at a time, in a run of its own', () => {
    const executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    for (const options of [{ ci: false }, { ci: true }, { ci: true, visual: true }, { ci: false, screenshots: true }]) {
      const projects = buildProjects({ ...options, exclusive: true, chromiumExecutable: executablePath });
      expect(projects.map((p) => p.name)).toEqual(['exclusive']);
      const [exclusive] = projects;
      expect(exclusive?.testMatch).toEqual(EXCLUSIVE_SPECS);
      // The table-locking specs (M08) and the specs that make links, schools, photos, events or passports public (M09–M19), or hide and show a school by its activity check (M20), or list a school with its schedule and trial requests (M21).
      expect(exclusive?.testMatch).toEqual([
        EXCLUSIVE_SPEC,
        '**/m09-requests.spec.ts',
        '**/m10a-evidence.spec.ts',
        '**/m10b-claims.spec.ts',
        '**/m11-schools.spec.ts',
        '**/m14-photos.spec.ts',
        '**/m15-organizations.spec.ts',
        '**/m16-galleries.spec.ts',
        '**/m17-events.spec.ts',
        '**/m19-passport.spec.ts',
        '**/m20-school-activity.spec.ts',
        '**/m21-trial-lessons.spec.ts',
        '**/m22-billing.spec.ts',
        '**/m23-federation-billing.spec.ts',
        '**/m25-governance.spec.ts',
      ]);
      expect(exclusive?.fullyParallel).toBe(false);
      expect(exclusive?.workers).toBe(1);
      // No dependencies: they would run every other project in full, whatever --grep says.
      expect(exclusive?.dependencies).toBeUndefined();
      expect(exclusive?.use?.viewport).toEqual({ width: 1440, height: 900 });
      expect(exclusive?.use?.launchOptions?.executablePath).toBe(executablePath);
    }
  });

  it('never runs in the ordinary run', () => {
    for (const options of [{ ci: false }, { ci: true }, { ci: true, visual: true }, { ci: false, screenshots: true }]) {
      expect(buildProjects(options).map((p) => p.name)).not.toContain('exclusive');
    }
  });

  it('keeps its server log, artifacts and report apart from the ordinary run', () => {
    const ordinary = runPaths(false);
    const exclusive = runPaths(true);
    expect(ordinary.serverLog).toBe('test-results/server.log');
    for (const key of ['serverLog', 'outputDir', 'htmlReport'] as const) expect(exclusive[key]).not.toBe(ordinary[key]);
    // Playwright empties outputDir at the start of a run: the exclusive one must not hold the other.
    expect(ordinary.outputDir.startsWith(exclusive.outputDir)).toBe(false);
    expect(exclusive.outputDir.startsWith(ordinary.outputDir)).toBe(false);
  });
});

describe('buildProjects: pilot (M13)', () => {
  it('runs only pilot.spec.ts, on desktop and mobile Chromium, and mobile WebKit in CI', () => {
    const executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    expect(buildProjects({ ci: false, pilot: true }).map((p) => p.name)).toEqual(['desktop-chromium', 'mobile-chromium']);
    // Neither the visual nor the screenshots project: the pilot changes what they compare.
    const projects = buildProjects({ ci: true, visual: true, screenshots: true, pilot: true, chromiumExecutable: executablePath });
    expect(projects.map((p) => p.name)).toEqual(['desktop-chromium', 'mobile-chromium', 'mobile-webkit']);
    for (const project of projects) {
      expect(project.testMatch).toBe(PILOT_SPEC);
      expect(project.testIgnore).toBeUndefined();
    }
    const byName = Object.fromEntries(projects.map((p) => [p.name, p]));
    expect(byName['desktop-chromium']?.use?.viewport).toEqual({ width: 1440, height: 900 });
    expect(byName['mobile-chromium']?.use?.isMobile).toBe(true);
    expect(byName['mobile-webkit']?.use?.defaultBrowserType).toBe('webkit');
    expect(byName['mobile-chromium']?.use?.launchOptions?.executablePath).toBe(executablePath);
  });

  it('never runs in the ordinary or the exclusive run', () => {
    for (const options of [{ ci: false }, { ci: true }, { ci: true, visual: true }, { ci: false, screenshots: true }]) {
      for (const project of buildProjects(options)) expect(project.testMatch).not.toBe(PILOT_SPEC);
      expect(buildProjects({ ...options, exclusive: true })[0]?.testMatch).not.toContain(PILOT_SPEC);
    }
  });

  it('keeps its server log, artifacts and report apart from the other runs', () => {
    const pilot = runPaths('pilot');
    for (const other of [runPaths(false), runPaths(true)]) {
      for (const key of ['serverLog', 'outputDir', 'htmlReport'] as const) expect(pilot[key]).not.toBe(other[key]);
      expect(other.outputDir.startsWith(pilot.outputDir)).toBe(false);
      expect(pilot.outputDir.startsWith(other.outputDir)).toBe(false);
    }
  });
});

describe('buildProjects: vitals (the INP budget tests)', () => {
  const grepTitle = (title: string, tags: string[] = []) => [title, ...tags].join(' ');
  const inp = grepTitle('@M05 selecting a node responds with INP under 200 ms at 4x CPU throttling', [VITALS_TAG]);
  const other = grepTitle('@M05 no axe violations on /explore in dark and light themes');
  const matches = (pattern: RegExp | RegExp[] | undefined, title: string) =>
    (Array.isArray(pattern) ? pattern : pattern ? [pattern] : []).some((re) => new RegExp(re.source, re.flags).test(title));

  it('runs only the @vitals tests, on the three devices, one test at a time', () => {
    const executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    expect(buildProjects({ ci: false, vitals: true }).map((p) => p.name)).toEqual(['desktop-chromium', 'mobile-chromium']);
    // Neither the visual nor the screenshots project: nothing runs beside the measurements.
    const projects = buildProjects({ ci: true, visual: true, screenshots: true, vitals: true, chromiumExecutable: executablePath });
    expect(projects.map((p) => p.name)).toEqual(['desktop-chromium', 'mobile-chromium', 'mobile-webkit']);
    for (const project of projects) {
      expect(matches(project.grep, inp), `${project.name}: the INP test`).toBe(true);
      expect(matches(project.grep, other), `${project.name}: another test`).toBe(false);
      expect(project.grepInvert).toBeUndefined();
      expect(project.fullyParallel).toBe(false);
      expect(project.workers).toBe(1);
      expect(project.dependencies).toBeUndefined();
      // The same specs as the ordinary run: never the exclusive, pilot, visual or screenshot ones.
      expect(project.testIgnore).toEqual([VISUAL_SPEC, SCREENSHOTS_SPEC, EXCLUSIVE_SPEC, ...PUBLIC_WRITE_SPECS, PILOT_SPEC]);
    }
    const byName = Object.fromEntries(projects.map((p) => [p.name, p]));
    // The devices of the ordinary run: WebKit stays an iPhone, the INP tests keep their phone.
    expect(byName['desktop-chromium']?.use?.viewport).toEqual({ width: 1440, height: 900 });
    expect(byName['mobile-chromium']?.use?.isMobile).toBe(true);
    expect(byName['mobile-webkit']?.use?.defaultBrowserType).toBe('webkit');
    expect(byName['mobile-webkit']?.use?.isMobile).toBe(true);
    expect(byName['mobile-chromium']?.use?.launchOptions?.executablePath).toBe(executablePath);
  });

  it('leaves the @vitals tests out of the ordinary run, and only them', () => {
    for (const options of [{ ci: false }, { ci: true }]) {
      for (const project of buildProjects(options)) {
        expect(matches(project.grepInvert, inp), `${project.name}: the INP test`).toBe(true);
        expect(matches(project.grepInvert, other), `${project.name}: another test`).toBe(false);
        expect(project.grep).toBeUndefined();
      }
    }
  });

  it('keeps its server log, artifacts and report apart from the other runs', () => {
    const vitals = runPaths('vitals');
    for (const other of [runPaths(false), runPaths(true), runPaths('pilot')]) {
      for (const key of ['serverLog', 'outputDir', 'htmlReport'] as const) expect(vitals[key]).not.toBe(other[key]);
      expect(other.outputDir.startsWith(vitals.outputDir)).toBe(false);
      expect(vitals.outputDir.startsWith(other.outputDir)).toBe(false);
    }
  });
});
