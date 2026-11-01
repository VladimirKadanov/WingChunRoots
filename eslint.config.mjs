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
    // M07: the search keys are made in one place, so the form, the store and the query agree.
    module: 'src/server/search',
    group: ['transliteration', 'transliteration/*', 'pinyin-pro', 'pinyin-pro/*', 'to-jyutping', 'to-jyutping/*', 'opencc-js', 'opencc-js/*'],
    message: 'Only src/server/search transliterates names: use keysForName and queryForms (src/server/search/keys.ts).',
  },
  {
    // M12: one logger, so every line goes through the same redaction (src/server/log/redact.ts).
    module: 'src/server/log',
    group: ['pino', 'pino/*'],
    message: 'Only src/server/log writes log lines with pino: use logger(), requestLogger() and reportError() (src/server/log).',
  },
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
  {
    module: 'src/server/auth',
    group: ['better-auth', 'better-auth/*', '@better-auth/*'],
    message: 'Only src/server/auth talks to Better Auth: use its guards, session and web helpers (milestone M02).',
  },
  {
    // M10a: evidence objects are stored and images re-encoded in one place, behind ObjectStore.
    module: 'src/server/storage',
    group: ['aws4fetch', 'aws4fetch/*', 'sharp', 'sharp/*'],
    message: 'Only src/server/storage talks to the object store and re-encodes images: use ObjectStore and sanitize.ts (src/server/storage).',
  },
  {
    module: 'src/server/rpc',
    group: ['@orpc/*', '!@orpc/client', '!@orpc/client/*', '!@orpc/tanstack-query'],
    message: 'Only src/server/rpc builds the oRPC router and handlers; Server Actions call serverClient() (plan §6.8).',
  },
  {
    // M11: the map library loads only through the map islands (next/dynamic), never with a page
    // (scripts/check-bundle-budget.mjs, MAPLIBRE).
    module: 'src/components/map',
    group: ['maplibre-gl', 'maplibre-gl/*', '@vis.gl/react-maplibre', '@vis.gl/react-maplibre/*'],
    message: 'Only src/components/map imports MapLibre; pages load its islands with next/dynamic (milestone M11).',
  },
  {
    // M05: the browser's client of /api/rpc and its TanStack Query helpers, in one place.
    module: 'src/lib/rpc-client',
    group: ['@orpc/client', '@orpc/client/*', '@orpc/tanstack-query'],
    message: 'The browser reaches the oRPC router only through src/lib/rpc-client (plan §6.8).',
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

// Routes and components (src/app, src/components) never touch the database, the queue or the mailer:
// they go through src/server/services (plan §6.1). Every block for those folders spreads these, since
// a later block replaces the rule of an earlier one for the same files.
const routeBans = [
  {
    group: ['@/server/db', '@/server/db/*', '**/server/db', '**/server/db/*'],
    message: 'Routes and components never touch the database: go through src/server/services (plan §6.1).',
  },
  {
    group: ['@/server/jobs', '@/server/jobs/*', '**/server/jobs', '**/server/jobs/*', '@/server/mail', '@/server/mail/*', '**/server/mail', '**/server/mail/*'],
    message: 'Routes and components never queue jobs or send e-mail: go through src/server/services (plan §6.1).',
  },
  // M10a: evidence goes through src/server/services/evidence.ts (and src/server/evidence-http.ts
  // for the two route handlers), which checks who may store or read it; never the store itself.
  {
    group: ['@/server/storage', '@/server/storage/*', '**/server/storage', '**/server/storage/*'],
    message: 'Routes and components never touch the evidence store: go through src/server/services/evidence.ts (plan §6.4).',
  },
  elkOnlyInLayoutModule,
  noLayoutInRequestPath,
  // M08: the plan matrix (pure data) is open to routes and components; deciding what a plan
  // allows is not: requireEntitlement() and the quota lock run inside a service (plan §6.5).
  {
    group: ['@/server/entitlements/*', '!@/server/entitlements/plans', '**/server/entitlements/*', '!**/server/entitlements/plans'],
    message: 'Routes and components read only the plan matrix (src/server/entitlements/plans.ts); services decide entitlements (plan §6.5).',
  },
];

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
  {
    // React Compiler memoizes (reactCompiler in next.config.ts): no hand-written useMemo or
    // useCallback (plan §3.1). src/lib/lineage-layout sets its own no-restricted-syntax below
    // and imports no React at all.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: String.raw`ImportSpecifier[imported.name=/^(useMemo|useCallback)$/]`,
          message: 'React Compiler memoizes: no hand-written useMemo or useCallback (plan §3.1).',
        },
        {
          selector: String.raw`MemberExpression[object.name='React'][property.name=/^(useMemo|useCallback)$/]`,
          message: 'React Compiler memoizes: no hand-written useMemo or useCallback (plan §3.1).',
        },
      ],
    },
  },
  // Module boundaries (plan §6.1).
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports([...routeBans, baseUiOnlyInUi]),
    },
  },
  {
    // M04: the request-time person check goes through the lineage service like a route.
    files: ['src/proxy.ts'],
    rules: {
      'no-restricted-imports': restrictImports(routeBans),
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports(routeBans),
    },
  },
  {
    // The account forms (M02) are client islands too: they use button-variants.ts, not the Button.
    files: [
      'src/components/shell/**/*.{ts,tsx}',
      'src/components/home/**/*.{ts,tsx}',
      'src/components/ink/**/*.{ts,tsx}',
      'src/components/account/**/*.{ts,tsx}',
      'src/components/plans/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': restrictImports([...routeBans, baseUiOnlyInUi, noTailwindMerge]),
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
  // The map islands (M11) are components: they keep the bans of src/components.
  ...modulePackages.map(({ module }) => ({
    files: [`${module}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': restrictImports(
        module === 'src/server/jobs'
          ? [elkOnlyInLayoutModule]
          : module === 'src/components/map'
            ? [...routeBans, baseUiOnlyInUi, noTailwindMerge]
            : [elkOnlyInLayoutModule, noLayoutInRequestPath],
        { module },
      ),
    },
  })),
  {
    // src/server/auth/test-support.ts sets throwaway secrets and drives the auth endpoints for the
    // integration tests: no module of the app may import it, only tests.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src',
              from: './src/server/auth/test-support.ts',
              message: 'Only tests import src/server/auth/test-support.ts (it sets throwaway secrets).',
            },
          ],
        },
      ],
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
    ignores: ['src/lib/lineage-layout/**', 'src/lib/rpc-client/**'],
    rules: {
      'no-restricted-imports': restrictImports([elkOnlyInLayoutModule, noLayoutInRequestPath]),
    },
  },
  {
    // M05: the same bans for the browser's oRPC client, which may import its own packages.
    files: ['src/lib/rpc-client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports([elkOnlyInLayoutModule, noLayoutInRequestPath], { module: 'src/lib/rpc-client' }),
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
