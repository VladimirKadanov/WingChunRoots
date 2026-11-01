// pnpm perf:web (milestone M13, In scope 5; plan §5.8 (c), DEFAULT D24): Lighthouse in the mobile
// profile for every main route of plan §5.5, signed in where the page needs it, against a running
// `next start` of this build on the test database (scripts/verify.d/M13.sh starts one). The body is
// scripts/lib/lighthouse-routes-run.ts, loaded after next/cache is replaced by a stub (the session
// and invitation it prepares go through the services).
//
//   pnpm perf:web --base=http://127.0.0.1:3103 [--chrome-path=<chrome>]   # writes its section of docs/perf/web-vitals.md
//   pnpm perf:web --base=… --stdout                                       # prints the section instead
//   pnpm perf:web --base=… --only=/schools                                # only the routes whose path contains it
//
// Exit status 1 when a route is over a threshold of lighthouserc.json or a run fails.

import { stubNextCache } from './lib/next-cache-hook';

stubNextCache();

import('./lib/lighthouse-routes-run')
  .then(({ main }) => main())
  // The services can leave a database pool or a job queue open: the run ends here, with its status.
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(`perf:web: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
