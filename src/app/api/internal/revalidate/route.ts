import { revalidateTag } from 'next/cache';

import { handleRevalidate } from '@/server/revalidate';

// POST /api/internal/revalidate (plan §6.4; milestone M09): the worker drops the public cache after
// it recomputes the counters. A shared secret guards it (src/server/revalidate.ts); revalidateTag
// with the 'max' profile marks the entries stale, so the next visit refreshes them.
export function POST(request: Request): Promise<Response> {
  return handleRevalidate(request, (tag) => revalidateTag(tag, 'max'));
}
