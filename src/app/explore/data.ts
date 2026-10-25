// The reads of /explore (milestone M05) that need more than "it worked or it did not". As on the
// person pages (src/app/people/[slug]/data.ts, ProfileRead), a person who is not on the record and
// a read that failed are different answers: the first is final, the second gets an error state
// with Retry (plan §5.6, §5.8).

import type { LineageGraphDto } from '@/server/dto/public';
import { ORPCError } from '@/server/rpc/server';

/** Not on the record (missing or hidden, plan §6.4) or a malformed request: retrying cannot change the answer. */
export function isAbsent(error: unknown): boolean {
  return error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST');
}

/** The person in focus: their address, not on the record, or a read that failed (a timeout, the database restarting). */
export type FocusRead = { state: 'found'; slug: string } | { state: 'none' } | { state: 'failed'; error: unknown };

/** The address of the person in focus, from `readAlone` (lineage.ego with no teachers and no students). */
export async function readFocus(readAlone: () => Promise<LineageGraphDto>, focusId: string): Promise<FocusRead> {
  try {
    const slug = (await readAlone()).nodes.find((n) => n.id === focusId)?.slug;
    return slug ? { state: 'found', slug } : { state: 'none' };
  } catch (error) {
    return isAbsent(error) ? { state: 'none' } : { state: 'failed', error };
  }
}
