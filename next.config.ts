import type { NextConfig } from 'next';

/**
 * The script policy of every page (review 2026-11-13, ops M5 and uploads 8; owner decision
 * 2026-11-27, docs/adr/0088-review-1113-leftovers.md): a baseline now, a nonce policy at go-live.
 * Scripts, styles, fonts, frames, workers and connections come from this site only, apart from the
 * map tiles (OpenFreeMap) and the two video players; no plugins, no <base>, forms post here (or to
 * the payment page). Inline scripts stay allowed: Next.js's own bootstrap and the theme script are
 * inline, and a per-request nonce would make every cached page dynamic (Cache Components).
 * DEFAULT review-1113: 'unsafe-inline' for scripts until the go-live nonce policy.
 */
function contentSecurityPolicy(dev = process.env.NODE_ENV !== 'production', https = false): string {
  const map = 'https://tiles.openfreemap.org';
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${map}`,
    "font-src 'self' data:",
    `connect-src 'self' ${map}${dev ? ' ws: wss:' : ''}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'frame-src https://www.youtube-nocookie.com https://player.vimeo.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

/**
 * Response headers of every route (milestone M02 fix round 1): no framing (clickjacking of the
 * sign-in and security forms), no MIME sniffing, no full URL (with a token) in the Referer of a
 * link to another site, the script policy above, and no camera, microphone or the like.
 * HSTS only when the build's APP_URL is https; the Docker image is built without one, so the
 * proxy in front of it sends HSTS too (deploy/staging/Caddyfile, docker/caddy/Caddyfile.example).
 */
function securityHeaders(appUrl: string | undefined = process.env.APP_URL): { key: string; value: string }[] {
  const https = appUrl?.startsWith('https://') === true;
  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(undefined, https) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  ];
  if (https) {
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
  // M12: the Docker image's build (WCR_STANDALONE=1, Dockerfile) also writes <distDir>/standalone,
  // the minimal server the image runs (`node server.js`). Other builds (E2E, verify, Lighthouse)
  // leave it out: it copies node_modules files such as Next.js's own Open Graph library into
  // .next, which the M00b font check scans (docs/plan/questions/M12.md, question 3, default 1).
  ...(process.env.WCR_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  // M11 + M12: the Open Graph image of a school reads its fonts with readFile from node_modules
  // (src/app/schools/[slug]/opengraph-image.tsx), a path the trace cannot see; without this the
  // standalone server of the Docker image has no fonts and the image fails.
  outputFileTracingIncludes: {
    '/schools/**': ['./node_modules/@fontsource/noto-serif-display/files/noto-serif-display-{latin,latin-ext,greek,cyrillic}-400-normal.woff'],
  },
  // Explicit, opt-in caching with 'use cache' (plan §3.1, §6.4).
  cacheComponents: true,
  partialPrefetching: true,
  // React Compiler is on from day one: no hand-written useMemo/useCallback (plan §3.1).
  reactCompiler: true,
  poweredByHeader: false,
  // Review 2026-11-13 (ops M5): no component uses next/image, so /_next/image (an unauthenticated
  // resize endpoint) is switched off.
  images: { unoptimized: true },
  turbopack: {
    rules: {
      // M11: `import url from '…/file.mjs?asset'` emits the file as published, under a hashed name
      // in /_next/static/media/, and gives its URL (MapLibre's Web Worker: src/components/map/maplibre.ts).
      '*.mjs': { condition: { query: '?asset' }, type: 'asset' },
    },
  },
  headers: async () => [{ source: '/:path*', headers: securityHeaders() }],
  // Usability review 2026-11: the account settings are one area under /account. "Account type and
  // plan" was /dashboard/settings; links to it (old e-mails, bookmarks) keep working, with their
  // query and, in the browser, their #fragment (/account/plan#notifications-heading points on to
  // /account/notifications). 308: for good, and a POST stays a POST.
  // Role replay 2026-11-25 (P2-13, ADR 0068): the billing page is part of "Plan and billing" too;
  // ?checkout=, ?plan= and ?outcome= go with the redirect, and the browser keeps #outcome.
  redirects: async () => [
    { source: '/dashboard/settings', destination: '/account/plan', permanent: true },
    { source: '/dashboard/billing', destination: '/account/plan', permanent: true },
  ],
  experimental: {
    // DEFAULT (plan §10.2, row 10): agent feedback needs telemetry, so it stays off.
    // Telemetry itself is disabled with NEXT_TELEMETRY_DISABLED=1 (package.json scripts, CI, hook).
    agentFeedback: false,
  },
};

export default nextConfig;
