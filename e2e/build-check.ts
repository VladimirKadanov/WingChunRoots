// Which build the E2E tests run against (milestone M04, review round 2). playwright.config.ts
// starts `pnpm start` with WCR_TEST_FAULTS set, for the error-state tests. Only the E2E build
// (`pnpm build:e2e`, WCR_E2E_BUILD=1) has that test switch; a deployable build (`pnpm build`)
// refuses to start with it (src/server/faults.ts), so `pnpm e2e` or `pnpm screenshots` after a
// plain `pnpm build` would stop at the web server with a bare exit code. This check says why
// before anything starts.
//
// The marker is the build's own record of its inlined `env` (next.config.ts sets WCR_E2E_BUILD
// there): `<distDir>/required-server-files.json` → config.env.WCR_E2E_BUILD === '1'.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RUN_E2E_BUILD = 'run `pnpm build:e2e` first (the E2E build, with the test fault switch; never deploy it)';

/** Why the build in `distDir` cannot serve the E2E tests, or null when it can. */
export function e2eBuildProblem(distDir: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(distDir, 'required-server-files.json'), 'utf8');
  } catch {
    return `There is no build in ${distDir}: ${RUN_E2E_BUILD}.`;
  }
  let flag: unknown;
  try {
    flag = (JSON.parse(text) as { config?: { env?: Record<string, unknown> } }).config?.env?.WCR_E2E_BUILD;
  } catch {
    return `The build in ${distDir} is incomplete: ${RUN_E2E_BUILD}.`;
  }
  if (flag !== '1') {
    return `The build in ${distDir} is a deployable build (\`pnpm build\`), which has no test fault switch and refuses to start with WCR_TEST_FAULTS: ${RUN_E2E_BUILD}.`;
  }
  return null;
}
