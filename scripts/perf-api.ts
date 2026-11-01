// pnpm perf:api (milestone M13, In scope 4; plan §4.11, DEFAULT D24): the p95 of lineage.ego and
// schools.search through the HTTP API (/api/v1, the oRPC OpenAPI handler the native app calls),
// on the fictional graph of pnpm perf:queries (about 55,000 people and 100,000 teaching
// relationships, scripts/lib/perf-graph.ts) with fictional schools around the cities of the
// GeoNames extract. A throwaway database on the TEST_DATABASE_URL server is created, seeded,
// filled, measured and dropped. Every request runs the whole procedure: input validation, the
// service with its permission checks, the database through app_public_ro with the 2 s budget, the
// output schema and the JSON answer. next/cache is replaced by a stub (scripts/lib/next-cache-stub.ts),
// so no answer comes from the 'use cache' memory of a server: this is the uncached worst case.
//
//   pnpm perf:api            # writes its section of docs/perf/api.md; exit 1 when a p95 is 300 ms or more
//   pnpm perf:api --stdout   # prints the section instead (scripts/verify.d/M13.sh)
//   pnpm perf:api --keep     # keeps the throwaway database for EXPLAIN (its name is printed)

import { stubNextCache } from './lib/next-cache-hook';

stubNextCache();

import('./lib/perf-api-run')
  .then(({ main }) => main())
  .catch((error: unknown) => {
    console.error(`perf:api: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
