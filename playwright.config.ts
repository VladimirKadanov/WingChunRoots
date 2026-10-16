import { mkdirSync } from 'node:fs';

import { defineConfig } from '@playwright/test';

import { buildProjects } from './e2e/projects';

const ci = process.env.CI === 'true';
// A dedicated port, so E2E always runs against a fresh `next start` and never reuses `pnpm dev`.
const port = Number(process.env.E2E_PORT || 3100);
const baseURL = `http://127.0.0.1:${port}`;
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
  projects: buildProjects({ ci, chromiumExecutable: process.env.PW_CHROMIUM_EXECUTABLE }),
  webServer: {
    // `pnpm build` runs first (scripts/verify.sh, CI). From M01b the worker (`pnpm worker`) joins here.
    // Redirection that both sh and cmd.exe understand.
    command: `pnpm start --hostname 127.0.0.1 --port ${port} > test-results/server.log 2>&1`,
    url: `${baseURL}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
