// `pnpm api:openapi` writes docs/api/openapi.json from the router; `pnpm api:openapi --check`
// exits with status 1 when the committed file differs (CI, scripts/verify.d/M04.sh).

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { OPENAPI_FILE, openApiJson } from './openapi';

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const path = resolve(process.cwd(), OPENAPI_FILE);
  const next = await openApiJson();
  if (check) {
    const current = await readFile(path, 'utf8').catch(() => null);
    if (current !== next) {
      console.error(`api:openapi: ${OPENAPI_FILE} is out of date with the router; run pnpm api:openapi and commit it`);
      process.exit(1);
    }
    console.log(`api:openapi: ${OPENAPI_FILE} matches the router`);
    return;
  }
  await writeFile(path, next);
  console.log(`api:openapi: wrote ${OPENAPI_FILE}`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`api:openapi: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
