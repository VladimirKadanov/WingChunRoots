// The public cache (plan §6.4, "the cache is only public"; milestone M04). Only public DTOs
// (src/server/dto/public.ts) enter a 'use cache' function, without a session, cookies or roles,
// and every entry is tagged so a change can drop exactly the answers it affects:
//
//   person:<id>    every person an answer contains (and the person it was asked about, even when
//                  the answer was "not found"), so a change to a person or to one of their
//                  relationships drops it;
//   lineage:<id>   for a subtree or a profile, the person at its root (their descendant count and
//                  outline change when anything below them changes); and every lineage an answer
//                  names (a renamed lineage or a new root);
//   explore-start  the explorer's start list (M05): every lineage with its public root and its
//                  number of public people, so any change to whether a person or a relationship
//                  is public drops it.
//
// The services that change these records (M09 onwards) call invalidatePublic(). Answers for a
// signed-in participant with their own involved_only relationships are never cached.

import { cacheTag, revalidateTag, updateTag } from 'next/cache';

export { EXPLORE_START_TAG, lineageTag, personTag } from './cache-tags';

/** Next.js takes at most 128 tags per cacheTag() call (later calls append). */
const MAX_TAGS_PER_CALL = 128;

/** Tags the current 'use cache' entry. Only inside a 'use cache' function. */
export function tagCacheEntry(tags: Iterable<string>): void {
  const unique = [...new Set(tags)];
  for (let i = 0; i < unique.length; i += MAX_TAGS_PER_CALL) {
    cacheTag(...unique.slice(i, i + MAX_TAGS_PER_CALL));
  }
}

/**
 * Drops the cached public answers with these tags. From a Server Action it uses updateTag (the
 * next request reads fresh data); from an oRPC procedure, revalidateTag with expire 0, since
 * updateTag works only in Server Actions (plan §6.4). The worker, a separate process, calls
 * POST /api/internal/revalidate instead (M09, src/server/revalidate.ts).
 */
export function invalidatePublic(tags: Iterable<string>, caller: 'server-action' | 'procedure'): void {
  for (const tag of new Set(tags)) {
    if (caller === 'server-action') updateTag(tag);
    else revalidateTag(tag, { expire: 0 });
  }
}
