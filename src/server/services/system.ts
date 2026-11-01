// The state of the running system (milestone M12; plan §3.1 "Наблюдение", §3.3, §7.6):
//
//   healthAnswer()  for /healthz (checkHealth): the database answers and the job queue's schema
//                   is ready. The route says only {"ok":true} or {"ok":false} and a status code;
//                   which check failed goes to the log, never to the answer.
//   systemStatus()  for /admin/system (staff with a verified second factor): the depth of the job
//                   queue, failed jobs, failed e-mail deliveries and the time of the last local
//                   archive (scripts/backup-local.sh). Counts, queue names and times only: never a
//                   job's payload, an address or a name (plan §6.4).

import { inArray, sql } from 'drizzle-orm';

import { requestIdFrom } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { type BackupFile, backupDir, backupSummary } from '../backups';
import { getDb } from '../db';
import { databaseName, targetDatabaseUrl } from '../db/env';
import { emailDelivery } from '../db/schema';
import { type FailedJob, type QueueCounts, queueCounts, queueSchemaReady, recentFailedJobs } from '../jobs/stats';
import { requestLogger } from '../log';

export type HealthCheck = 'database' | 'queue';

export interface HealthResult {
  ok: boolean;
  /** The checks that failed, for the log (never for the answer). */
  failed: HealthCheck[];
}

/** How long a check may take before it counts as failed (the pool has no connect timeout). */
export const HEALTH_CHECK_TIMEOUT_MS = 3_000;

function withinTime<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('health check timed out')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Runs the checks of /healthz; never throws. */
export async function checkHealth(timeoutMs = HEALTH_CHECK_TIMEOUT_MS): Promise<HealthResult> {
  const checks: Record<HealthCheck, () => Promise<boolean>> = {
    database: async () => {
      const { rows } = await getDb().execute<{ ok: number }>(sql`SELECT 1 AS ok`);
      return Number(rows[0]?.ok) === 1;
    },
    queue: async () => queueSchemaReady(getDb()),
  };
  // In parallel, so a stalled database answers within one timeout (the Compose probe allows 5 s).
  const entries = Object.entries(checks) as [HealthCheck, () => Promise<boolean>][];
  const results = await Promise.all(entries.map(([, check]) => withinTime(check(), timeoutMs).catch(() => false)));
  const failed = entries.filter((_, i) => !results[i]).map(([name]) => name);
  return { ok: failed.length === 0, failed };
}

/** The whole answer of /healthz: only {"ok":true} (200) or {"ok":false} (503); a failure is logged. */
export async function healthAnswer(headers: Headers): Promise<{ status: 200 | 503; body: '{"ok":true}' | '{"ok":false}' }> {
  const health = await checkHealth();
  if (health.ok) return { status: 200, body: '{"ok":true}' };
  requestLogger(requestIdFrom(headers)).warn({ failed: health.failed }, 'healthz: a check failed');
  return { status: 503, body: '{"ok":false}' };
}

export interface SystemStatus {
  /** When these numbers were read (ISO 8601). */
  checkedAt: string;
  queue: {
    /** Jobs waiting in every queue (created or waiting for a retry): the queue's depth. */
    waiting: number;
    /** Of those, the jobs whose start time has come. */
    ready: number;
    active: number;
    /** Jobs that failed after their last retry and are still kept. */
    failed: number;
    queues: QueueCounts[];
    /** The newest failed jobs (queue, time, attempts). */
    recentFailures: FailedJob[];
  };
  email: {
    /** Deliveries that failed for good (status failed). */
    failed: number;
    /** Deliveries not sent yet (status queued). */
    waiting: number;
    /** The last attempt of the newest failed delivery (ISO 8601), or null. */
    lastFailedAt: string | null;
  };
  backup: {
    /** The newest local archive of the app's database, or null when there is none yet. */
    latest: BackupFile | null;
    count: number;
  };
}

/** /admin/system: for staff whose session passed the second factor. */
export async function systemStatus(principal: Principal | null): Promise<SystemStatus> {
  requireStaff2FA(principal);
  const db = getDb();
  const [queues, recentFailures, emails, backups] = await Promise.all([
    queueCounts(db),
    recentFailedJobs(db),
    db
      .select({
        failed: sql<number>`count(*) FILTER (WHERE ${emailDelivery.status} = 'failed')`.mapWith(Number),
        waiting: sql<number>`count(*) FILTER (WHERE ${emailDelivery.status} = 'queued')`.mapWith(Number),
        lastFailedAt: sql<Date | string | null>`max(${emailDelivery.lastAttemptAt}) FILTER (WHERE ${emailDelivery.status} = 'failed')`,
      })
      .from(emailDelivery)
      .where(inArray(emailDelivery.status, ['failed', 'queued'])),
    backupSummary(backupDir(), databaseName(targetDatabaseUrl())),
  ]);
  const sum = (key: 'waiting' | 'ready' | 'active' | 'failed') => queues.reduce((total, q) => total + q[key], 0);
  const email = emails[0];
  return {
    checkedAt: new Date().toISOString(),
    queue: { waiting: sum('waiting'), ready: sum('ready'), active: sum('active'), failed: sum('failed'), queues, recentFailures },
    email: {
      failed: Number(email?.failed ?? 0),
      waiting: Number(email?.waiting ?? 0),
      lastFailedAt: email?.lastFailedAt ? new Date(email.lastFailedAt).toISOString() : null,
    },
    backup: backups,
  };
}
