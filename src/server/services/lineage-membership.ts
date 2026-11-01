// lineage_membership mirrors v_public_edge (plan §6.2, §6.3; M11 In scope 5): the worker rewrites
// it after every change to what that view returns (src/server/jobs/lineage-recompute.ts). An
// approval changes an edge (relationships.ts, review.ts); a person who becomes public or hidden
// changes every edge they are on, and the root of every lineage they head (M11 review, code-2:
// the public school finder filters by lineage from this table, so a stale row would name a link
// that now runs only through a hidden person). The job is queued in the transaction of the change,
// so it commits with it.

import { sql } from 'drizzle-orm';

import { PUBLIC_RELATIONSHIP_STATUSES } from '../db/schema/common';
import { enqueue, type Transaction } from '../jobs/outbox';
import { QUEUE } from '../jobs/queues';

/** The lineages whose public edges or public root change when this person's visibility does. */
export async function lineagesOfPerson(tx: Transaction, personId: string): Promise<string[]> {
  const result = await tx.execute<{ id: string }>(sql`
    SELECT r.lineage_id::text AS id FROM teaching_relationship r
     WHERE (r.teacher_person_id = ${personId}::uuid OR r.student_person_id = ${personId}::uuid)
       AND r.status IN (${sql.join(PUBLIC_RELATIONSHIP_STATUSES.map((s) => sql`${s}`), sql`, `)})
    UNION
    SELECT l.id::text FROM lineage l WHERE l.root_person_id = ${personId}::uuid AND l.deleted_at IS NULL
     ORDER BY 1`);
  return result.rows.map((r) => r.id);
}

/**
 * Queues lineage.recompute, inside `tx`, for the lineages of a person whose visibility changed.
 * Returns the lineages queued (none: nothing to queue).
 */
export async function queueRecomputeForPerson(tx: Transaction, personId: string): Promise<string[]> {
  const lineageIds = await lineagesOfPerson(tx, personId);
  if (lineageIds.length > 0) await enqueue(tx, QUEUE.lineageRecompute, { lineageIds });
  return lineageIds;
}
