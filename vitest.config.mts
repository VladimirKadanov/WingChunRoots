import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const EXCLUDE = ['**/node_modules/**', '**/.next/**', 'e2e/**/*.spec.ts', 'src/**/*.int.test.ts'];

/**
 * The layout tests that measure time or lay out the whole M01 fixture (M03: the plan §4.11
 * guards, D24). They run after the other unit tests, one file at a time, so the other files'
 * workers do not share the CPU with them: on a 4-core machine (a cloud session, a CI runner) the
 * contention alone pushed the 500-person view past its budget. The budgets are unchanged.
 */
export const TIMED = ['src/lib/lineage-layout/layout.perf.test.ts', 'src/lib/lineage-layout/layout.test.ts'];

/**
 * The unit tests that change what other files would see: module mocks, a fresh module registry,
 * environment variables, globals or fake timers. They keep Vitest's isolation (a fresh module
 * graph per file). Every other unit test file shares its worker's modules with the files before
 * it (`isolate: false`), which halves the time of those files; scripts/vitest-isolation.test.ts
 * fails when a file outside this list starts to use one of those APIs, and
 * scripts/vitest-shared-state.ts (a setup file of the `unit` project) fails a file that leaves
 * process.env, fake timers or a property of globalThis, Date, Math, console or JSON changed,
 * however it did so.
 */
export const ISOLATED = [
  'src/lib/lineage-layout/layout.worker.test.ts',
  'src/proxy.test.ts',
  'src/server/auth/answer-floor.test.ts',
  'src/server/auth/request-scope.test.ts',
  'src/server/auth/startup.test.ts',
  'src/server/db/ids.test.ts',
  'src/server/faults.test.ts',
  'src/server/forms/flash.test.ts',
  'src/server/forms/two-factor.test.ts',
  'src/server/rpc/api-parity.test.ts',
  'src/server/services/lineage-graph.test.ts',
];

const UNIT = ['src/**/*.test.{ts,tsx}', 'e2e/**/*.test.ts', 'scripts/**/*.test.ts'];

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
          include: UNIT,
          // Integration tests need a database: pnpm test:int (vitest.int.config.mts).
          exclude: [...EXCLUDE, ...TIMED, ...ISOLATED],
          // Threads that keep their module graph from one file to the next (see ISOLATED).
          pool: 'threads',
          isolate: false,
          // Fails a file that leaves process.env, fake timers or a property of globalThis, Date,
          // Math, console or JSON changed.
          setupFiles: ['./scripts/vitest-shared-state.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'unit-isolated',
          include: ISOLATED,
          exclude: EXCLUDE,
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
