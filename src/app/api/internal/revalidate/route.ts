import { revalidateTag } from 'next/cache';

import { SCHOOLS_TAG } from '@/server/cache-tags';
import { handleRevalidate } from '@/server/revalidate';

// POST /api/internal/revalidate (plan §6.4; milestone M09): the worker drops the public cache after
// it recomputes the counters. A shared secret guards it (src/server/revalidate.ts); revalidateTag
// with the 'max' profile marks the entries stale, so the next visit refreshes them. M20: `schools`,
// which the worker sends after the activity check hid a school, expires at once instead, so no
// visit is served the hidden school from a stale entry (as the procedures expire it).
export function POST(request: Request): Promise<Response> {
  return handleRevalidate(request, (tag) => (tag === SCHOOLS_TAG ? revalidateTag(tag, { expire: 0 }) : revalidateTag(tag, 'max')));
}
