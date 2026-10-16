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

// ELK is loaded only by src/lib/lineage-layout, which runs in the explorer's Web Worker or in
// a Node background job, never in a page bundle or the request path (plan §4.1).
const elkOnlyInLayoutModule = {
  group: ['elkjs', 'elkjs/*'],
  message: 'ELK is used only through src/lib/lineage-layout (Web Worker or background job), never in the request path (plan §4.1).',
};
const noLayoutInRequestPath = {
  group: [
    '**/lineage-layout/layout',
    '**/lineage-layout/layout.ts',
    '**/lineage-layout/layout.worker',
    '**/lineage-layout/layout.worker.ts',
    '**/lineage-layout/worker-handler',
    '**/lineage-layout/worker-handler.ts',
  ],
  message:
    'Layouts run in the Web Worker (src/components/lineage/useLayoutWorker.ts) or in a background job, never in a page bundle or the request path (plan §4.1). Types, presets and ranks may be imported.',
};

// Browser and DOM globals that src/lib/lineage-layout must not use (plan §6.1). Only
// *.worker.ts files are exempt, so layout.worker.ts may use `self` and `postMessage`.
const domGlobals = [
  'window', 'document', 'self', 'navigator', 'location', 'history', 'localStorage',
  'sessionStorage', 'indexedDB', 'caches', 'postMessage', 'addEventListener',
  'removeEventListener', 'dispatchEvent', 'onmessage', 'onerror', 'close', 'importScripts',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt', 'open', 'print', 'screen',
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio', 'scrollX',
  'scrollY', 'frames', 'parent', 'top', 'opener', 'customElements', 'HTMLElement', 'SVGElement',
  'DOMParser', 'XMLHttpRequest', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
  'Image', 'Worker', 'SharedWorker', 'FileReader', 'OffscreenCanvas', 'CanvasRenderingContext2D',
].map((name) => ({
  name,
  message: `src/lib/lineage-layout is pure TypeScript without DOM globals (plan §6.1); only *.worker.ts may use worker globals.`,
}));

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'no-restricted-imports': restrictImports([elkOnlyInLayoutModule]),
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
        elkOnlyInLayoutModule,
        noLayoutInRequestPath,
      ]),
    },
  },
  {
    // The request path of the server: everything in src/server except the background jobs.
    files: ['src/server/**/*.{ts,tsx}'],
    ignores: ['src/server/jobs/**'],
    rules: {
      'no-restricted-imports': restrictImports([elkOnlyInLayoutModule, noLayoutInRequestPath]),
    },
  },
  {
    // layout.worker.ts may use worker globals (plan §4.1), but the import bans apply to it too.
    files: ['src/lib/lineage-layout/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports([
        {
          group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'next', 'next/*', '@xyflow/*'],
          message: 'src/lib/lineage-layout is pure TypeScript: no React, DOM or Next.js (plan §6.1).',
        },
        {
          group: ['@/server', '@/server/*', '**/server/*', '**/server'],
          message: 'src/lib/lineage-layout must not depend on src/server (plan §6.1).',
        },
        {
          group: ['elkjs/lib/elk-worker', 'elkjs/lib/elk-worker.*', 'elkjs/lib/elk-api', 'elkjs/lib/elk-api.*', 'elkjs/lib/main', 'elkjs/lib/main.*'],
          message: 'Import elkjs/lib/elk.bundled.js only: it runs in the calling thread, so there is no worker inside the worker (plan §4.1).',
        },
      ]),
      'no-restricted-globals': ['error', ...domGlobals],
      // The module also runs under Node's type stripping (pnpm bench:layout), which keeps
      // every import that is not marked `type`.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['src/lib/lineage-layout/**/*.worker.ts'],
    rules: {
      'no-restricted-globals': 'off',
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
