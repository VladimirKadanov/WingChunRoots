// Review 2026-11-13 (ops M3; docs/adr/0088-review-1113-leftovers.md): what the running processes
// report about themselves, so that a stopped worker is noticed.
//
// - system_heartbeat: one row per process kind ('worker'), the time of its last beat. The worker
//   writes it on start and every WORKER_HEARTBEAT_SECONDS (src/server/jobs/heartbeat.ts); /healthz/deep
//   and /admin/system read it. No address, host name or payload: a kind and two times. Read and
//   written by app_rw only.

import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const SYSTEM_PROCESS_KINDS = ['worker'] as const;

export const systemHeartbeat = pgTable(
  'system_heartbeat',
  {
    kind: text('kind', { enum: SYSTEM_PROCESS_KINDS }).primaryKey(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    beatAt: timestamp('beat_at', { withTimezone: true }).notNull(),
  },
  (t) => [check('system_heartbeat_kind_check', sql`${t.kind} IN ('worker')`)],
);
