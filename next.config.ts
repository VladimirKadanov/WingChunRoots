import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Explicit, opt-in caching with 'use cache' (plan §3.1, §6.4).
  cacheComponents: true,
  partialPrefetching: true,
  // React Compiler is on from day one: no hand-written useMemo/useCallback (plan §3.1).
  reactCompiler: true,
  poweredByHeader: false,
  experimental: {
    // DEFAULT (plan §10.2, row 10): agent feedback needs telemetry, so it stays off.
    // Telemetry itself is disabled with NEXT_TELEMETRY_DISABLED=1 (package.json scripts, CI, hook).
    agentFeedback: false,
  },
};

export default nextConfig;
