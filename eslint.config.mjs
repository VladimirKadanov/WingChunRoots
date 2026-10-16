import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Packages that must never be imported (plan §7.3, item 14).
const forbiddenPackages = [
  { group: ['vaul', 'vaul/*'], message: 'vaul is unmaintained: use the Base UI Drawer (plan §3.1).' },
  { group: ['@antv/*'], message: '@antv/* is forbidden after the May 2026 npm worm (plan §3.2).' },
  { group: ['cytoscape-svg'], message: 'cytoscape-svg is GPL-3.0 (plan §3.1).' },
  { group: ['@cosmograph/*'], message: '@cosmograph/* has a non-commercial license.' },
  { group: ['mapbox-gl', 'mapbox-gl/*'], message: 'Use MapLibre GL JS (plan §3.1).' },
  { group: ['reactflow', 'reactflow/*'], message: 'Use @xyflow/react (the current React Flow package).' },
  {
    group: [
      'next-intl',
      'next-intl/*',
      'i18next',
      'react-i18next',
      'next-i18next',
      'react-intl',
      '@lingui/*',
      '@inlang/paraglide-js',
      '@inlang/paraglide-*',
    ],
    message: 'The UI is English only, permanently: no translation libraries (plan §5).',
  },
];

/** no-restricted-imports with the forbidden packages plus extra module-boundary patterns. */
function restrictImports(extra = []) {
  return ['error', { patterns: [...forbiddenPackages, ...extra] }];
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'no-restricted-imports': restrictImports(),
    },
  },
  // Module boundaries (plan §6.1).
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports([
        {
          group: ['@/server/db', '@/server/db/*', '**/server/db', '**/server/db/*'],
          message: 'Routes and components never touch the database: go through src/server/services (plan §6.1).',
        },
      ]),
    },
  },
  {
    files: ['src/lib/lineage-layout/**/*.ts'],
    ignores: ['src/lib/lineage-layout/layout.worker.ts'],
    rules: {
      'no-restricted-imports': restrictImports([
        {
          group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'next', 'next/*', '@xyflow/*'],
          message: 'src/lib/lineage-layout is pure TypeScript: no React, DOM or Next.js (plan §6.1).',
        },
        {
          group: ['@/server', '@/server/*', '**/server/*'],
          message: 'src/lib/lineage-layout must not depend on src/server (plan §6.1).',
        },
      ]),
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'test-results/**',
    'playwright-report/**',
    'blob-report/**',
    '.verify/**',
    'coverage/**',
  ]),
]);
