// next/cache outside Next.js, for pnpm perf:api (scripts/perf-api.ts): the services tag and time
// their 'use cache' reads, which only a Next.js server with cacheComponents can do. Outside it the
// directive is an ordinary string, so every request reads the database: perf:api measures the
// uncached path, the worst case of a public read.

/** No-ops: the arguments are ignored. */
export function cacheTag(): void {}
export function cacheLife(): void {}
export function revalidateTag(): void {}
export function updateTag(): void {}
