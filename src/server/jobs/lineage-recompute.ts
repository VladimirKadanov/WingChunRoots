// lineage.recompute (plan §6.3, §6.4; milestone M09, In scope 4 and 5): after a change to the
// verified edges (an approval), the worker recomputes lineage_membership of the lineages it touched
// and then asks the web process to drop the public cache of that derived data, through POST
// /api/internal/revalidate (src/server/revalidate.ts): the 'use cache' entries live in the web
// process's memory.
//
// The worker revalidates only the tag of the data it changes itself, lineage-membership:<lineage id>
// (src/server/cache.ts), never the person and lineage tags the approval already expired at once with
// revalidateTag(tag, { expire: 0 }): the internal route's revalidateTag(tag, 'max') would turn that
// hard expiry back into stale-while-revalidate and let the first public read after an approval show
// the counts from before it (M09 review, requirements-1). The descendant counts and the subtrees are
// read from v_public_edge when they are asked for, so no public page depends on this job.
//
// lineage_membership reads only v_public_edge and v_public_person (plan §6.2: a counter that saw a
// pending request would reveal it). A lineage's members are the people at either end of its public
// edges and its public root; `depth` counts generations below the root along the lineage's public
// edges, null for a member not connected to the root. The lineage's public edges are read once
// (a MATERIALIZED CTE: the view is security_barrier, so reading it per generation re-runs its
// subqueries each time), and the job's transaction has its own statement timeout
// (RECOMPUTE_STATEMENT_TIMEOUT): a background job is not bound by the 2 s budget of a request.
//
// Logs carry the job id and counts, never a name or an id of a person (plan §6.4).

import { sql } from 'drizzle-orm';
import type { JobWithMetadata } from 'pg-boss';

import type { Database } from '../db';
import { MAX_TAGS, revalidateUrl, revalidateSecret } from '../revalidate';
import { lineageMembershipTag } from '../cache-tags';
import { type LineageRecomputeJob, QUEUE } from './queues';

/** A bound on the generations walked: far more than any lineage has; it only stops bad data. */
const MAX_DEPTH = 64;

/**
 * The statement timeout of a recompute's transaction (a default with no D number;
 * docs/adr/0011-teacher-requests.md). Far above the measured cost (about 0.15 s for 20,000 members
 * of one lineage) and well inside the job's expiry (expireInSeconds 120, ./queues.ts), so a stuck
 * recompute fails and pg-boss retries it before the job expires.
 */
export const RECOMPUTE_STATEMENT_TIMEOUT = '30s';

/** Rewrites lineage_membership of one lineage in one transaction; returns the number of members. */
export async function recomputeLineageMembership(db: Database, lineageId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${RECOMPUTE_STATEMENT_TIMEOUT}'`));
    await tx.execute(sql`DELETE FROM lineage_membership WHERE lineage_id = ${lineageId}::uuid`);
    const inserted = await tx.execute<{ n: number }>(sql`
WITH RECURSIVE edges AS MATERIALIZED (
  SELECT e.teacher_person_id, e.student_person_id FROM v_public_edge e WHERE e.lineage_id = ${lineageId}::uuid
),
root AS (
  SELECT l.root_person_id AS id FROM lineage l
   WHERE l.id = ${lineageId}::uuid AND l.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM v_public_person vp WHERE vp.id = l.root_person_id)
),
members AS (
  SELECT teacher_person_id AS id FROM edges
  UNION SELECT student_person_id FROM edges
  UNION SELECT id FROM root
),
down(id, depth) AS (
  SELECT id, 0 FROM root
  UNION
  SELECT e.student_person_id, d.depth + 1
    FROM down d JOIN edges e ON e.teacher_person_id = d.id
   WHERE d.depth < ${MAX_DEPTH}
),
depths AS (
  SELECT id, min(depth) AS depth FROM down GROUP BY id
),
ins AS (
  INSERT INTO lineage_membership (lineage_id, person_id, depth, computed_at)
  SELECT ${lineageId}::uuid, m.id, dp.depth, now()
    FROM members m LEFT JOIN depths dp ON dp.id = m.id
  RETURNING 1
)
SELECT count(*)::int AS n FROM ins`);
    return inserted.rows[0]?.n ?? 0;
  });
}

export interface RevalidateCall {
  (tags: string[]): Promise<void>;
}

/** The internal route answered with something other than 200: its status is safe to log. */
export class RevalidateAnswerError extends Error {
  constructor(readonly status: number) {
    super(`revalidate answered ${status}`);
    this.name = 'RevalidateAnswerError';
  }
}

/**
 * A RevalidateCall that POSTs the tags to the web process's internal route, at most MAX_TAGS per
 * request (the route's own limit: a well-connected teacher's change can name more); it throws on
 * any answer but 200. `send` and `env` are parameters for the unit test.
 */
export function revalidatePoster(send: typeof fetch = (input, init) => fetch(input, init), env: Record<string, string | undefined> = process.env): RevalidateCall {
  return async (tags) => {
    for (let start = 0; start < tags.length; start += MAX_TAGS) {
      const response = await send(revalidateUrl(env), {
        method: 'POST',
        headers: { authorization: `Bearer ${revalidateSecret(env)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tags: tags.slice(start, start + MAX_TAGS) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new RevalidateAnswerError(response.status);
    }
  };
}

/** The worker's RevalidateCall: the internal route at INTERNAL_APP_URL or APP_URL. */
export const postRevalidate: RevalidateCall = revalidatePoster();

/**
 * What a log line may say about an error (plan §6.4): its SQLSTATE, the status the internal route
 * answered (401: the web process and the worker hold different secrets), the system code of a
 * failed connection (ECONNREFUSED: the web process is not reachable at the address), or else the
 * error's name. Never a message, which could carry data.
 */
export function failureCode(error: unknown): string {
  if (error instanceof RevalidateAnswerError) return `revalidate answered ${error.status}`;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return `database error ${code}`;
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof cause === 'string' && /^E[A-Z_]{2,30}$/.test(cause)) return `revalidate unreachable (${cause})`;
  return error instanceof Error ? error.name : 'unknown error';
}

/**
 * Handles lineage.recompute jobs: one recompute per distinct lineage of the batch, then one
 * revalidation of their lineage-membership tags, posted also when a recompute failed (the entries
 * are dropped whatever happened; M09 review, code-3). A failure is logged with its code only and
 * rethrown as an error that carries only that code (pg-boss stores it with the job), so pg-boss
 * retries the job.
 */
export function lineageRecomputeHandler(db: Database, log: (line: string) => void, revalidate: RevalidateCall = postRevalidate) {
  return async (jobs: JobWithMetadata<LineageRecomputeJob>[]): Promise<void> => {
    for (const job of jobs) {
      const lineageIds = [...new Set(job.data.lineageIds ?? [])];
      const tags = lineageIds.map(lineageMembershipTag);
      let members = 0;
      let failure: { error: unknown } | null = null;
      try {
        for (const id of lineageIds) members += await recomputeLineageMembership(db, id);
      } catch (error) {
        failure = { error };
      }
      try {
        await revalidate(tags);
      } catch (error) {
        failure ??= { error };
      }
      if (failure) {
        const code = failureCode(failure.error);
        const last = job.retryCount >= job.retryLimit;
        log(`${QUEUE.lineageRecompute}: job ${job.id}: attempt ${job.retryCount + 1} of ${job.retryLimit + 1} failed (${code})${last ? '; no attempts left' : '; will retry'}`);
        throw new Error(`${QUEUE.lineageRecompute} failed: ${code}`);
      }
      log(`${QUEUE.lineageRecompute}: job ${job.id}: ${lineageIds.length} lineage(s), ${members} member(s), ${tags.length} tag(s) revalidated`);
    }
  };
}
