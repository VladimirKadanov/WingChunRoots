// The worker's heartbeat (review 2026-11-13, ops M3): the worker writes system_heartbeat on start
// and then every WORKER_HEARTBEAT_SECONDS. A beat older than WORKER_STALE_SECONDS means the worker
// has stopped or cannot reach the database: /healthz/deep answers 503 and /admin/system says so.

import { sql } from 'drizzle-orm';

import type { Database } from '../db';
import { logger } from '../log';

export const WORKER_HEARTBEAT_SECONDS = 60;
/** Five missed beats: long enough for a restart, short enough for an uptime monitor to notice. */
export const WORKER_STALE_SECONDS = 5 * WORKER_HEARTBEAT_SECONDS;

/** Writes the worker's beat now; `started` also resets the start time. */
export async function beat(db: Database, startedAt: Date, now: Date = new Date()): Promise<void> {
  await db.execute(sql`
    INSERT INTO system_heartbeat (kind, started_at, beat_at) VALUES ('worker', ${startedAt}, ${now})
    ON CONFLICT (kind) DO UPDATE SET started_at = EXCLUDED.started_at, beat_at = EXCLUDED.beat_at`);
}

/** Starts the beat; the returned function stops it. A failed beat is logged and tried again next time. */
export function startHeartbeat(db: Database, intervalSeconds = WORKER_HEARTBEAT_SECONDS): () => void {
  const startedAt = new Date();
  const once = () =>
    beat(db, startedAt).catch((error: unknown) => {
      logger().warn({ code: (error as { code?: string } | null)?.code ?? 'unknown' }, 'worker: heartbeat failed');
    });
  void once();
  const timer = setInterval(() => void once(), intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

/** The worker's last beat (ISO 8601), or null when it never beat. */
export async function lastWorkerBeat(db: Database): Promise<string | null> {
  const { rows } = await db.execute<{ beat_at: Date | string }>(sql`SELECT beat_at FROM system_heartbeat WHERE kind = 'worker'`);
  const at = rows[0]?.beat_at;
  return at ? new Date(at).toISOString() : null;
}
