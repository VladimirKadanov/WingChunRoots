import { mkdirSync } from 'node:fs';

import { defineConfig } from '@playwright/test';

import { e2eBuildProblem } from './e2e/build-check';
import { buildProjects } from './e2e/projects';

const ci = process.env.CI === 'true';
// A dedicated port, so E2E always runs against a fresh `next start` and never reuses `pnpm dev`.
const port = Number(process.env.E2E_PORT || 3100);
const baseURL = `http://127.0.0.1:${port}`;
// The origin the app builds its e-mail links with and accepts requests from (M02): the test server.
// M04: the test fault switch, honoured only with this loopback APP_URL and only in the E2E build
// (`pnpm build:e2e`; a deployable build refuses to start with it, src/server/faults.ts).
const serverEnv = { APP_URL: baseURL, WCR_TEST_FAULTS: 'lineage-once,person-once' };
// So the run stops at once with "run `pnpm build:e2e` first" when the build in .next is missing or
// deployable (`pnpm build`), instead of at the web server with a bare exit code (e2e/build-check.ts).
// Listing the tests starts no server and needs no build.
const buildProblem = process.argv.includes('--list') ? null : e2eBuildProblem(process.env.WCR_DIST_DIR || '.next');
if (buildProblem) throw new Error(buildProblem);
// Created here rather than with `mkdir -p` in webServer.command, which must also run in cmd.exe.
mkdirSync('test-results', { recursive: true });

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Artifacts live below test-results/ so the server log (test-results/server.log) survives.
  outputDir: './test-results/artifacts',
  fullyParallel: true,
  forbidOnly: ci,
  retries: 0,
  reporter: ci
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Visual regression (M00b, e2e/visual.spec.ts): a missing baseline fails the test (Playwright's
  // 'default' mode), which still saves the screenshot as …-actual.png so that
  // scripts/visual-baselines.sh can print it from CI. Baselines change only through a commit
  // (docs/guides/admin-guide.bg.md).
  updateSnapshots: 'default',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  projects: buildProjects({
    ci,
    chromiumExecutable: process.env.PW_CHROMIUM_EXECUTABLE,
    visual: ci || process.env.PW_VISUAL === '1',
    screenshots: process.env.PW_SCREENSHOTS === '1',
  }),
  webServer: [
    {
      name: 'web',
      // `pnpm build:e2e` runs first (scripts/verify.sh, CI). Redirection that both sh and cmd.exe understand.
      command: `pnpm start --hostname 127.0.0.1 --port ${port} > test-results/server.log 2>&1`,
      url: `${baseURL}/`,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The job worker (milestone M01b): delivers the e-mail that tests read with
      // e2e/helpers/mailbox.ts. Same database and mail settings as the web server. Ready once it
      // prints its ready line; its output appears in the test output with the prefix [worker].
      name: 'worker',
      command: 'pnpm worker',
      env: serverEnv,
      wait: { stdout: /worker: ready/ },
      stdout: 'pipe',
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
  ],
});
