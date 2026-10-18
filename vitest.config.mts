import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const EXCLUDE = ['**/node_modules/**', '**/.next/**', 'e2e/**/*.spec.ts', 'src/**/*.int.test.ts'];

/**
 * The layout tests that measure time or lay out the whole M01 fixture (M03: the plan §4.11
 * guards, D24). They run after the other unit tests, one file at a time, so the other files'
 * workers do not share the CPU with them: on a 4-core machine (a cloud session, a CI runner) the
 * contention alone pushed the 500-person view past its budget. The budgets are unchanged.
 */
const TIMED = ['src/lib/lineage-layout/layout.perf.test.ts', 'src/lib/lineage-layout/layout.test.ts'];

export default defineConfig({
  // The `@/*` path of tsconfig.json (M00b: design tokens and components import through it).
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}', 'e2e/**/*.test.ts', 'scripts/**/*.test.ts'],
          // Integration tests need a database: pnpm test:int (vitest.int.config.mts).
          exclude: [...EXCLUDE, ...TIMED],
        },
      },
      {
        extends: true,
        test: {
          name: 'timed',
          include: TIMED,
          exclude: EXCLUDE,
          fileParallelism: false,
          // Projects with a higher group order start once the lower groups have finished.
          sequence: { groupOrder: 1 },
          // Vitest's 5 s default is a hang guard, not a budget: "keeps rows = ranks … in every
          // standard view of the fixture" lays out all views of the 600-person fixture (4.6 s on
          // an idle 4-core cloud session). The time budgets are the explicit assertions of
          // layout.perf.test.ts (1000 ms per ego view, 2500 ms for about 500 people), unchanged.
          testTimeout: 60_000,
        },
      },
    ],
  },
});
