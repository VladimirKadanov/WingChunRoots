import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The `@/*` path of tsconfig.json (M00b: design tokens and components import through it).
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'e2e/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Integration tests need a database: pnpm test:int (vitest.int.config.mts).
    exclude: ['**/node_modules/**', '**/.next/**', 'e2e/**/*.spec.ts', 'src/**/*.int.test.ts'],
  },
});
