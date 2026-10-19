import { mkdirSync } from 'node:fs';

import { defineConfig } from '@playwright/test';

import { buildProjects, runPaths } from './e2e/projects';

const ci = process.env.CI === 'true';
// A dedicated port, so E2E always runs against a fresh `next start` and never reuses `pnpm dev`.
const port = Number(process.env.E2E_PORT || 3100);
const baseURL = `http://127.0.0.1:${port}`;
// The origin the app builds its e-mail links with and accepts requests from (M02): the test server.
const serverEnv = { APP_URL: baseURL };
// The specs that lock a whole table run alone, in a run of their own (e2e/projects.ts,
// EXCLUSIVE_SPEC): PW_EXCLUSIVE=1, after the ordinary run (scripts/verify.sh does both).
const exclusive = process.env.PW_EXCLUSIVE === '1';
const paths = runPaths(exclusive);
// Created here rather than with `mkdir -p` in webServer.command, which must also run in cmd.exe.
mkdirSync('test-results', { recursive: true });

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Artifacts live below test-results/ so the server log (test-results/server.log) survives.
  outputDir: paths.outputDir,
  fullyParallel: true,
  forbidOnly: ci,
  retries: 0,
  reporter: ci
    ? [['list'], ['html', { open: 'never', outputFolder: paths.htmlReport }]]
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
    exclusive,
  }),
  webServer: [
    {
      name: 'web',
      // `pnpm build` runs first (scripts/verify.sh, CI). Redirection that both sh and cmd.exe understand.
      // The log is test-results/server.log (test-results/server-exclusive.log in the exclusive run).
      command: `pnpm start --hostname 127.0.0.1 --port ${port} > ${paths.serverLog} 2>&1`,
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
