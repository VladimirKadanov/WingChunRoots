import { mkdirSync } from 'node:fs';

import { defineConfig } from '@playwright/test';

import { e2eBuildProblem } from './e2e/build-check';
import { buildProjects, runPaths } from './e2e/projects';

const ci = process.env.CI === 'true';
// A dedicated port, so E2E always runs against a fresh `next start` and never reuses `pnpm dev`.
const port = Number(process.env.E2E_PORT || 3100);
// M12: E2E_BASE_URL runs the tests against a server that is already up, such as the container of
// the Compose profile `app` (the `image` job of ci.yml): no web server, no worker and no build check
// here, and the server keeps its own settings (no test fault switch: a deployable build has none).
const external = process.env.E2E_BASE_URL?.replace(/\/+$/, '') || null;
const baseURL = external ?? `http://127.0.0.1:${port}`;
// The origin the app builds its e-mail links with and accepts requests from (M02): the test server.
// M04: the test fault switch, honoured only with this loopback APP_URL and only in the E2E build
// (`pnpm build:e2e`; a deployable build refuses to start with it, src/server/faults.ts).
// M12: /admin/system reads the local archives of BACKUP_DIR; the E2E server gets a folder of its
// own under test-results/, where e2e/ops.spec.ts writes a fictional archive name.
const serverEnv = { APP_URL: baseURL, WCR_TEST_FAULTS: 'lineage-once,person-once', BACKUP_DIR: 'test-results/backups' };
// So the run stops at once with "run `pnpm build:e2e` first" when the build in .next is missing or
// deployable (`pnpm build`), instead of at the web server with a bare exit code (e2e/build-check.ts).
// Listing the tests starts no server and needs no build.
const buildProblem = process.argv.includes('--list') || external ? null : e2eBuildProblem(process.env.WCR_DIST_DIR || '.next');
if (buildProblem) throw new Error(buildProblem);
// The specs that lock a whole table, and (M09) those that make links public, run alone, in a run
// of their own (e2e/projects.ts, EXCLUSIVE_SPECS): PW_EXCLUSIVE=1, after the ordinary run
// (scripts/verify.sh does both).
const exclusive = process.env.PW_EXCLUSIVE === '1';
const paths = runPaths(exclusive);
// Fewer parallel workers on a slower machine (PW_WORKERS=2): unset keeps Playwright's default.
const workers = process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : undefined;
if (workers !== undefined && !(Number.isInteger(workers) && workers > 0)) {
  throw new Error(`PW_WORKERS must be a positive whole number, not "${process.env.PW_WORKERS}".`);
}
// Created here rather than with `mkdir -p` in webServer.command, which must also run in cmd.exe.
mkdirSync('test-results', { recursive: true });

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Artifacts live below test-results/ so the server log (test-results/server.log) survives.
  outputDir: paths.outputDir,
  fullyParallel: true,
  workers,
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
  webServer: external
    ? []
    : [
        {
          name: 'web',
          // `pnpm build:e2e` runs first (scripts/verify.sh, CI). Redirection that both sh and cmd.exe understand.
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
