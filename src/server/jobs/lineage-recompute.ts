// lineage.recompute (plan §6.3, §6.4; milestone M09, In scope 4 and 5): after a change to the
// verified edges (an approval), the worker recomputes lineage_membership of the lineages it touched
// and then asks the web process to drop the public cache, through POST /api/internal/revalidate
// (src/server/revalidate.ts): the 'use cache' entries live in the web process's memory.
//
// lineage_membership reads only v_public_edge and v_public_person (plan §6.2: a counter that saw a
// pending request would reveal it). A lineage's members are the people at either end of its public
// edges and its public root; `depth` counts generations below the root along the lineage's public
// edges, null for a member not connected to the root.
//
// Logs carry the job id and counts, never a name or an id of a person (plan §6.4).

import { sql } from 'drizzle-orm';
import type { JobWithMetadata } from 'pg-boss';

import type { Database } from '../db';
import { revalidateUrl, revalidateSecret } from '../revalidate';
import { lineageTag } from '../cache-tags';
import { type LineageRecomputeJob, QUEUE } from './queues';

/** A bound on the generations walked: far more than any lineage has; it only stops bad data. */
const MAX_DEPTH = 64;

/** Rewrites lineage_membership of one lineage in one transaction; returns the number of members. */
export async function recomputeLineageMembership(db: Database, lineageId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM lineage_membership WHERE lineage_id = ${lineageId}::uuid`);
    const inserted = await tx.execute<{ n: number }>(sql`
WITH RECURSIVE root AS (
  SELECT l.root_person_id AS id FROM lineage l
   WHERE l.id = ${lineageId}::uuid AND l.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM v_public_person vp WHERE vp.id = l.root_person_id)
),
members AS (
  SELECT e.teacher_person_id AS id FROM v_public_edge e WHERE e.lineage_id = ${lineageId}::uuid
  UNION SELECT e.student_person_id FROM v_public_edge e WHERE e.lineage_id = ${lineageId}::uuid
  UNION SELECT id FROM root
),
down(id, depth) AS (
  SELECT id, 0 FROM root
  UNION
  SELECT e.student_person_id, d.depth + 1
    FROM down d JOIN v_public_edge e ON e.teacher_person_id = d.id AND e.lineage_id = ${lineageId}::uuid
   WHERE d.depth < ${MAX_DEPTH}
),
ins AS (
  INSERT INTO lineage_membership (lineage_id, person_id, depth, computed_at)
  SELECT ${lineageId}::uuid, m.id, (SELECT min(d.depth) FROM down d WHERE d.id = m.id), now()
    FROM members m
  RETURNING 1
)
SELECT count(*)::int AS n FROM ins`);
    return inserted.rows[0]?.n ?? 0;
  });
}

export interface RevalidateCall {
  (tags: string[]): Promise<void>;
}

/** POSTs the tags to the web process's internal route; throws on any answer but 200. */
export const postRevalidate: RevalidateCall = async (tags) => {
  if (tags.length === 0) return;
  const response = await fetch(revalidateUrl(), {
    method: 'POST',
    headers: { authorization: `Bearer ${revalidateSecret()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tags }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`revalidate answered ${response.status}`);
};

/** What a log line may say about an error: its SQLSTATE, or else the error's name (plan §6.4). */
function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return `database error ${code}`;
  return error instanceof Error ? error.name : 'unknown error';
}

/**
 * Handles lineage.recompute jobs: one recompute per distinct lineage of the batch, then one
 * revalidation of every tag. A failure is logged with its code only and rethrown as an error that
 * carries only that code (pg-boss stores it with the job), so pg-boss retries the job.
 */
export function lineageRecomputeHandler(db: Database, log: (line: string) => void, revalidate: RevalidateCall = postRevalidate) {
  return async (jobs: JobWithMetadata<LineageRecomputeJob>[]): Promise<void> => {
    for (const job of jobs) {
      const lineageIds = [...new Set(job.data.lineageIds ?? [])];
      try {
        let members = 0;
        for (const id of lineageIds) members += await recomputeLineageMembership(db, id);
        const tags = [...new Set([...(job.data.tags ?? []), ...lineageIds.map(lineageTag)])];
        await revalidate(tags);
        log(`${QUEUE.lineageRecompute}: job ${job.id}: ${lineageIds.length} lineage(s), ${members} member(s), ${tags.length} tag(s) revalidated`);
      } catch (error) {
        const code = failureCode(error);
        const last = job.retryCount >= job.retryLimit;
        log(`${QUEUE.lineageRecompute}: job ${job.id}: attempt ${job.retryCount + 1} of ${job.retryLimit + 1} failed (${code})${last ? '; no attempts left' : '; will retry'}`);
        throw new Error(`${QUEUE.lineageRecompute} failed: ${code}`);
      }
    }
  };
}
