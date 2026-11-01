import type { NextConfig } from 'next';

/**
 * Response headers of every route (milestone M02 fix round 1): no framing (clickjacking of the
 * sign-in and security forms), no MIME sniffing, no full URL (with a token) in the Referer of a
 * link to another site. HSTS only when the build's APP_URL is https: Phase 1 runs on plain http
 * on loopback, where HSTS would do nothing useful.
 */
function securityHeaders(appUrl: string | undefined = process.env.APP_URL): { key: string; value: string }[] {
  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  ];
  if (appUrl?.startsWith('https://')) {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' });
  }
  return headers;
}

const nextConfig: NextConfig = {
  // M04: inlined at build time. Only the E2E build (WCR_E2E_BUILD=1, `pnpm build:e2e`) compiles in
  // the test fault switch; a deployable build drops it (src/server/faults.ts).
  env: { WCR_E2E_BUILD: process.env.WCR_E2E_BUILD === '1' ? '1' : '' },
  // M04: scripts/verify.d/M04.sh makes a deployable build in a directory of its own, beside the
  // E2E build in .next. Unset everywhere else.
  ...(process.env.WCR_DIST_DIR ? { distDir: process.env.WCR_DIST_DIR } : {}),
  // M12: every build also writes <distDir>/standalone, the minimal server the Docker image runs
  // (`node server.js`, Dockerfile). `next start` still serves the build itself (E2E, pnpm start);
  // it only warns that the standalone server exists.
  output: 'standalone',
  // Explicit, opt-in caching with 'use cache' (plan §3.1, §6.4).
  cacheComponents: true,
  partialPrefetching: true,
  // React Compiler is on from day one: no hand-written useMemo/useCallback (plan §3.1).
  reactCompiler: true,
  poweredByHeader: false,
  headers: async () => [{ source: '/:path*', headers: securityHeaders() }],
  experimental: {
    // DEFAULT (plan §10.2, row 10): agent feedback needs telemetry, so it stays off.
    // Telemetry itself is disabled with NEXT_TELEMETRY_DISABLED=1 (package.json scripts, CI, hook).
    agentFeedback: false,
  },
};

export default nextConfig;
