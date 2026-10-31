// The tags of the public cache (src/server/cache.ts), without Next.js: the worker builds and sends
// them too (src/server/jobs/lineage-recompute.ts, POST /api/internal/revalidate; milestone M09).

export const personTag = (personId: string) => `person:${personId}`;
export const lineageTag = (id: string) => `lineage:${id}`;
export const EXPLORE_START_TAG = 'explore-start';
