// The worker (plan §6.1; milestone M01b, In scope 2): creates the queues, registers the handlers
// and the schedules on a pg-boss instance that connects as app_rw. src/worker.ts runs it as its own
// process; the integration tests run it in-process.
//
// Logs carry job and delivery ids and counts, never an address, a name or template data (plan §6.4).

import { eq } from 'drizzle-orm';
import type { JobWithMetadata, PgBoss, WorkOptions } from 'pg-boss';

import type { Database } from '../db';
import { emailDelivery } from '../db/schema';
import { describeError, MailBusyError, MailInputError } from '../mail/mailer';
import type { Mailer } from '../mail/types';
import { purgeExpiredEmailAddresses } from '../services/retention';
import { TemplateDataError } from '../templates/email';
import { type EmailSendJob, QUEUE, QUEUE_OPTIONS, type QueueName, type QueueOptions, SCHEDULES } from './queues';

export interface WorkerOptions {
  /** A pg-boss instance from createBoss({ kind: 'worker' }), not started. */
  boss: PgBoss;
  /** The app_rw database. */
  db: Database;
  mailer: Mailer;
  /** Per-queue option overrides (tests: short retry delays). */
  queueOptions?: Partial<Record<QueueName, Partial<QueueOptions>>>;
  /** How often idle handlers look for jobs, in seconds (pg-boss minimum 0.5; default 2). */
  pollingIntervalSeconds?: number;
  /** Register the recurring jobs (default true). */
  schedules?: boolean;
  log?: (line: string) => void;
}

export interface RunningWorker {
  boss: PgBoss;
  stop(): Promise<void>;
}

/** Creates or updates the queues: rows in pgboss.queue only, so app_rw can do it. */
export async function ensureQueues(boss: PgBoss, overrides: WorkerOptions['queueOptions'] = {}): Promise<void> {
  for (const [name, defaults] of QUEUE_OPTIONS) {
    const options = { ...defaults, ...overrides[name] };
    await boss.createQueue(name, options);
    // createQueue leaves an existing queue as it is; updateQueue brings its options up to date.
    await boss.updateQueue(name, options);
  }
}

/** Handles email.send jobs: one delivery each, retried by pg-boss until the queue's retryLimit. */
export function emailSendHandler(db: Database, mailer: Mailer, log: (line: string) => void) {
  return async (jobs: JobWithMetadata<EmailSendJob>[]): Promise<void> => {
    for (const job of jobs) {
      const { deliveryId, data } = job.data;
      const [row] = await db.select().from(emailDelivery).where(eq(emailDelivery.id, deliveryId));
      if (!row) {
        // db:seed or a reset removed it; nothing left to send.
        log(`${QUEUE.emailSend}: job ${job.id}: delivery ${deliveryId} no longer exists`);
        continue;
      }
      if (row.status !== 'queued' || row.toEmail === null) {
        log(`${QUEUE.emailSend}: job ${job.id}: delivery ${row.id} is already ${row.status}`);
        continue;
      }
      try {
        const result = await mailer.send({
          template: row.template as never,
          to: row.toEmail,
          data: data as never,
          idempotencyKey: row.idempotencyKey,
          userId: row.userId,
        });
        log(`${QUEUE.emailSend}: job ${job.id}: delivery ${result.deliveryId} ${result.status}${result.duplicate ? ' (already decided)' : ''}`);
      } catch (error) {
        if (error instanceof MailInputError || error instanceof TemplateDataError) {
          // Permanent: retrying cannot help.
          await mailer.markFailed(row.id, describeError(error));
          log(`${QUEUE.emailSend}: job ${job.id}: delivery ${row.id} failed permanently (${error.name})`);
          continue;
        }
        const last = job.retryCount >= job.retryLimit;
        if (last && !(error instanceof MailBusyError)) await mailer.markFailed(row.id, describeError(error));
        log(
          `${QUEUE.emailSend}: job ${job.id}: delivery ${row.id} attempt ${job.retryCount + 1} of ${job.retryLimit + 1} failed` +
            (last ? '; no attempts left' : '; will retry'),
        );
        throw error;
      }
    }
  };
}

/** Dead letters of email.send: the last attempt failed or expired. */
export function emailSendFailedHandler(mailer: Mailer, log: (line: string) => void) {
  return async (jobs: JobWithMetadata<EmailSendJob>[]): Promise<void> => {
    for (const job of jobs) {
      const changed = await mailer.markFailed(job.data.deliveryId, 'no attempts left');
      if (changed) log(`${QUEUE.emailSendFailed}: delivery ${job.data.deliveryId} marked failed`);
    }
  };
}

/** Starts pg-boss, the queues, the handlers and the schedules. */
export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const { boss, db, mailer, queueOptions, pollingIntervalSeconds = 2, schedules = true } = options;
  const log = options.log ?? ((line: string) => console.log(line));

  await boss.start();
  await ensureQueues(boss, queueOptions);

  const work: WorkOptions & { includeMetadata: true } = { includeMetadata: true, pollingIntervalSeconds };
  await boss.work(QUEUE.emailSend, { ...work, localConcurrency: 2 }, emailSendHandler(db, mailer, log));
  await boss.work(QUEUE.emailSendFailed, work, emailSendFailedHandler(mailer, log));
  await boss.work(QUEUE.retentionPurge, work, async () => {
    const result = await purgeExpiredEmailAddresses(db);
    log(`${QUEUE.retentionPurge}: erased ${result.emailDeliveries} delivery address(es), ${result.invitations} invitation address(es)`);
  });

  if (schedules) {
    for (const { queue, cron } of SCHEDULES) await boss.schedule(queue, cron, null, { tz: 'UTC', missed: 'once' });
  }

  return {
    boss,
    async stop() {
      await boss.stop({ graceful: true, timeout: 30_000 });
    },
  };
}
