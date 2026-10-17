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
  {
    group: ['next/font/google', 'next/font/google/*', '@next/font/google', '@next/font/google/*'],
    message: 'Fonts are self-hosted with next/font/local from @fontsource (plan §5.3): never a request to Google.',
  },
];

// Packages that only one module may import (plan §6.1; milestone M01b).
const modulePackages = [
  {
    module: 'src/server/jobs',
    group: ['pg-boss', 'pg-boss/*'],
    message: 'Only src/server/jobs uses pg-boss: queue work with its outbox helpers (src/server/jobs/outbox.ts).',
  },
  {
    module: 'src/server/mail',
    group: ['nodemailer', 'nodemailer/*'],
    message: 'Only src/server/mail sends e-mail: queue it with queueEmail (src/server/jobs/outbox.ts).',
  },
  {
    module: 'src/server/templates',
    group: ['react-email', 'react-email/*', '@react-email/*'],
    message: 'E-mail templates live only in src/server/templates/email (CLAUDE.md §2).',
  },
];

/**
 * no-restricted-imports with the forbidden packages, the packages other modules own, and extra
 * module-boundary patterns. `module` names the module being configured: its own packages are allowed.
 */
function restrictImports(extra = [], { module } = {}) {
  const owned = modulePackages.filter((p) => p.module !== module).map(({ group, message }) => ({ group, message }));
  return ['error', { patterns: [...forbiddenPackages, ...owned, ...extra] }];
}

// ELK is loaded only by src/lib/lineage-layout, which runs in the explorer's Web Worker or in
// a Node background job, never in a page bundle or the request path (plan §4.1).
const elkOnlyInLayoutModule = {
  group: ['elkjs', 'elkjs/*'],
  message: 'ELK is used only through src/lib/lineage-layout (Web Worker or background job), never in the request path (plan §4.1).',
};
// UI primitives (M00b): Base UI is wrapped once, in src/components/ui (the shadcn/ui pattern),
// so styling, focus rings and the history layer stay in one place.
const baseUiOnlyInUi = {
  group: ['@base-ui/react', '@base-ui/react/*'],
  message: 'Use the wrappers in src/components/ui; only they import Base UI (ADR 0006).',
};
// The shell, the home page and the ink drawings run on every page or in client islands: they
// use the small `cx` helper, not tailwind-merge and the token tables behind @/lib/utils (JS budget).
const noTailwindMerge = {
  group: ['@/lib/utils', '**/lib/utils', 'tailwind-merge', 'tailwind-merge/*'],
  message: 'Use cx from @/lib/cx here: cn pulls tailwind-merge and the design tokens into every page (ADR 0006).',
};
// src/design is data and pure functions (tokens, colour maths, the ink geometry), read by the
// token generator, tests and scripts; only fonts.ts and theme.ts touch Next.js or the browser.
const designPurity = {
  group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'next', 'next/*', '@/components/*', '@/app/*', '@/server/*', '@/lib/*'],
  message: 'src/design is pure TypeScript (tokens, colour and ink geometry); only fonts.ts and theme.ts may use Next.js or the browser (ADR 0006).',
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

// What no-restricted-imports and no-restricted-globals cannot see in src/lib/lineage-layout:
// dynamic imports, and DOM globals read through globalThis (`globalThis.document`).
const layoutDynamicImportBans = [
  {
    selector: String.raw`ImportExpression[source.value=/^(react|react-dom|next|@xyflow)(\/|$)/]`,
    message: 'src/lib/lineage-layout is pure TypeScript: no React, DOM or Next.js, not even through import() (plan §6.1).',
  },
  {
    selector: String.raw`ImportExpression[source.value=/^(@\/server|.*\/server)(\/|$)/]`,
    message: 'src/lib/lineage-layout must not depend on src/server, not even through import() (plan §6.1).',
  },
  {
    selector: String.raw`ImportExpression[source.value=/^elkjs(\/lib\/(elk-worker|elk-api|main)|$)/]`,
    message: 'Import elkjs/lib/elk.bundled.js only (plan §4.1).',
  },
];
const layoutGlobalThisDomBan = {
  selector: `MemberExpression[object.name='globalThis'][property.name=/^(${domGlobals.map((g) => g.name).join('|')})$/]`,
  message: 'src/lib/lineage-layout is pure TypeScript without DOM globals, also through globalThis (plan §6.1); only *.worker.ts may use worker globals.',
};

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
        {
          group: ['@/server/jobs', '@/server/jobs/*', '**/server/jobs', '**/server/jobs/*', '@/server/mail', '@/server/mail/*', '**/server/mail', '**/server/mail/*'],
          message: 'Routes and components never queue jobs or send e-mail: go through src/server/services (plan §6.1).',
        },
        elkOnlyInLayoutModule,
        noLayoutInRequestPath,
        baseUiOnlyInUi,
      ]),
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports([elkOnlyInLayoutModule, noLayoutInRequestPath]),
    },
  },
  {
    files: ['src/components/shell/**/*.{ts,tsx}', 'src/components/home/**/*.{ts,tsx}', 'src/components/ink/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports([elkOnlyInLayoutModule, noLayoutInRequestPath, baseUiOnlyInUi, noTailwindMerge]),
    },
  },
  {
    files: ['src/design/**/*.ts'],
    ignores: ['src/design/fonts.ts', 'src/design/theme.ts', 'src/design/**/*.test.ts'],
    rules: {
      'no-restricted-imports': restrictImports([elkOnlyInLayoutModule, designPurity]),
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
  // Each module that owns a package may import it (see modulePackages). These blocks come after
  // the request-path block so they replace it for their own files; they keep its ELK and layout
  // bans, except that the background jobs may run layouts (plan §4.1).
  ...modulePackages.map(({ module }) => ({
    files: [`${module}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': restrictImports(
        module === 'src/server/jobs' ? [elkOnlyInLayoutModule] : [elkOnlyInLayoutModule, noLayoutInRequestPath],
        { module },
      ),
    },
  })),
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
      'no-restricted-syntax': ['error', ...layoutDynamicImportBans, layoutGlobalThisDomBan],
      // The module also runs under Node's type stripping (pnpm bench:layout), which keeps
      // every import that is not marked `type`.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['src/lib/lineage-layout/**/*.worker.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-syntax': ['error', ...layoutDynamicImportBans],
    },
  },
  {
    // The rest of src/lib is shared with pages and the request path: no ELK and no layout
    // there either, so a re-export cannot carry them into a page bundle (plan §4.1).
    files: ['src/lib/**/*.{ts,tsx}'],
    ignores: ['src/lib/lineage-layout/**'],
    rules: {
      'no-restricted-imports': restrictImports([elkOnlyInLayoutModule, noLayoutInRequestPath]),
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
