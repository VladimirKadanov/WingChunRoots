// Integration tests (milestone M01): src/**/*.int.test.ts against PostGIS, through
// TEST_DATABASE_URL or, without it, Testcontainers (src/server/db/testing.ts). Each test file
// creates and drops its own database, so files may run in parallel.
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The same `@/` alias as tsconfig.json and the unit tests (M09: revalidate.int.test.ts imports a route).
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    pool: 'forks',
    // Creating, migrating and seeding a database takes seconds; starting a container longer.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
