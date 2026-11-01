// The state of the job queue for /admin/system and /healthz (milestone M12; plan §3.1
// "Наблюдение"): counted from pgboss.job itself, which app_rw may read (src/server/jobs/schema.ts),
// rather than from pg-boss's monitor counters, which only move while a worker runs its
// maintenance. Never a job's payload or output: they can hold names (plan §6.4).
//
// SQL compatible with PostgreSQL 16+ (plan §3.2).

import { sql } from 'drizzle-orm';

import type { Database } from '../db';
import { PGBOSS_SCHEMA, PGBOSS_SCHEMA_VERSION } from './schema';
import { QUEUE_OPTIONS } from './queues';

export interface QueueCounts {
  queue: string;
  /** Created or waiting for a retry: the queue's depth (jobs scheduled for later included). */
  waiting: number;
  /** Of `waiting`, those whose start time has come. */
  ready: number;
  /** Taken by a worker right now. */
  active: number;
  /** Failed after their last retry and not yet deleted (pg-boss keeps them for the queue's retention). */
  failed: number;
  /** Seconds since the oldest ready job could start; null when none is ready. */
  oldestReadySeconds: number | null;
}

export interface FailedJob {
  id: string;
  queue: string;
  /** When the last attempt failed (ISO 8601). */
  failedAt: string | null;
  /** Attempts made: the first one and its retries. */
  attempts: number;
}

/** Counts per queue: every queue of this app (QUEUE_OPTIONS), then any other queue with jobs. */
export async function queueCounts(db: Database): Promise<QueueCounts[]> {
  const { rows } = await db.execute<{
    queue: string;
    waiting: string;
    ready: string;
    active: string;
    failed: string;
    oldest_ready_seconds: string | null;
  }>(sql`
    SELECT name AS queue,
           count(*) FILTER (WHERE state IN ('created', 'retry')) AS waiting,
           count(*) FILTER (WHERE state IN ('created', 'retry') AND start_after <= now()) AS ready,
           count(*) FILTER (WHERE state = 'active') AS active,
           count(*) FILTER (WHERE state = 'failed') AS failed,
           floor(extract(epoch FROM now() - min(start_after) FILTER (WHERE state IN ('created', 'retry') AND start_after <= now())))::bigint
             AS oldest_ready_seconds
      FROM ${sql.raw(PGBOSS_SCHEMA)}.job
     WHERE state IN ('created', 'retry', 'active', 'failed')
     GROUP BY name`);
  const byName = new Map(rows.map((row) => [row.queue, row]));
  const names = [...QUEUE_OPTIONS.map(([name]) => name as string), ...[...byName.keys()].filter((name) => !QUEUE_OPTIONS.some(([q]) => q === name)).sort()];
  return names.map((queue) => {
    const row = byName.get(queue);
    return {
      queue,
      waiting: Number(row?.waiting ?? 0),
      ready: Number(row?.ready ?? 0),
      active: Number(row?.active ?? 0),
      failed: Number(row?.failed ?? 0),
      oldestReadySeconds: row?.oldest_ready_seconds == null ? null : Number(row.oldest_ready_seconds),
    };
  });
}

/** The newest failed jobs: queue, time and attempts only. */
export async function recentFailedJobs(db: Database, limit = 10): Promise<FailedJob[]> {
  const { rows } = await db.execute<{ id: string; queue: string; failed_at: Date | string | null; attempts: number }>(sql`
    SELECT id::text AS id, name AS queue, completed_on AS failed_at, retry_count + 1 AS attempts
      FROM ${sql.raw(PGBOSS_SCHEMA)}.job
     WHERE state = 'failed'
     ORDER BY completed_on DESC NULLS LAST
     LIMIT ${limit}`);
  return rows.map((row) => ({
    id: row.id,
    queue: row.queue,
    failedAt: row.failed_at === null ? null : new Date(row.failed_at).toISOString(),
    attempts: Number(row.attempts),
  }));
}

/** Whether the queue's schema answers at the version this build expects (the worker needs it). */
export async function queueSchemaReady(db: Database): Promise<boolean> {
  const { rows } = await db.execute<{ version: string | null }>(sql`
    SELECT (SELECT version::text FROM ${sql.raw(PGBOSS_SCHEMA)}.version LIMIT 1) AS version`);
  return Number(rows[0]?.version) === PGBOSS_SCHEMA_VERSION;
}
