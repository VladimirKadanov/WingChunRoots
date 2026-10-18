// Loads .env for the command-line scripts, the worker and the tests (plan §7.7); the environment
// always wins. A module of its own, so the web server's import graph (next build traces it) has no
// file read with a run-time path. `next start` reads .env itself.

import { existsSync } from 'node:fs';

export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
