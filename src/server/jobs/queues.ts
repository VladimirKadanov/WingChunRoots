// Queues of the worker (plan §6.1; milestone M01b): names, options and the shape of their jobs.
// The options are created and kept up to date by the worker on start (createQueue/updateQueue,
// which only write rows in pgboss.queue: no DDL, so app_rw can do it).

import type { PgBoss, Queue } from 'pg-boss';

export const QUEUE = {
  /** Deliver one e-mail (email_delivery row) through the Mailer. */
  emailSend: 'email.send',
  /** Dead letters of email.send: the last attempt failed or expired; mark the delivery failed. */
  emailSendFailed: 'email.send.failed',
  /** Daily erasure of e-mail addresses past their retention period (src/server/services/retention.ts). */
  retentionPurge: 'retention.purge',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** The payload of email.send (and of its dead letters). The address stays in email_delivery. */
export interface EmailSendJob {
  deliveryId: string;
  /** Template data, checked again by the template before rendering. */
  data: unknown;
}

export interface JobData {
  [QUEUE.emailSend]: EmailSendJob;
  [QUEUE.emailSendFailed]: EmailSendJob;
  [QUEUE.retentionPurge]: Record<string, never>;
}

/** Options of a queue; policy and partition stay at their defaults (standard, shared job table). */
export type QueueOptions = Omit<Queue, 'name' | 'policy' | 'partition'>;

const DAY = 86_400;

/**
 * Options per queue, in creation order (a dead-letter queue exists before the queue that names it).
 * email.send: 1 attempt + 5 retries with exponential backoff. pg-boss waits
 * retryDelay * 2^n * (1 + random) before retry n + 1 (n = 0..4): 1-2, 2-4, 4-8, 8-16 and 16-30 min
 * (capped by retryDelayMax), so the last attempt comes 31-60 min after the first; then the
 * dead-letter queue. An attempt is bounded by the SMTP
 * timeouts (src/server/mail/transports.ts), well inside expireInSeconds. Finished jobs (whose
 * payload may hold names) are deleted after 7 days.
 */
export const QUEUE_OPTIONS: ReadonlyArray<readonly [QueueName, QueueOptions]> = [
  [QUEUE.emailSendFailed, { retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInSeconds: 60, deleteAfterSeconds: 7 * DAY }],
  [
    QUEUE.emailSend,
    {
      retryLimit: 5,
      retryDelay: 60,
      retryBackoff: true,
      retryDelayMax: 30 * 60,
      expireInSeconds: 120,
      deleteAfterSeconds: 7 * DAY,
      deadLetter: QUEUE.emailSendFailed,
    },
  ],
  [QUEUE.retentionPurge, { retryLimit: 3, retryDelay: 300, expireInSeconds: 600, deleteAfterSeconds: 30 * DAY }],
];

/** Recurring jobs: cron in UTC. */
export const SCHEDULES: ReadonlyArray<{ queue: QueueName; cron: string }> = [
  // Daily at 03:17 UTC, away from the top of the hour.
  { queue: QUEUE.retentionPurge, cron: '17 3 * * *' },
];

/**
 * Creates the queues that do not exist yet and brings the options of every queue up to date: rows
 * in pgboss.queue only, so app_rw can do it. The worker and every producer run it on start, because
 * pg-boss refuses to send to a queue that does not exist.
 */
export async function ensureQueues(
  boss: PgBoss,
  overrides: Partial<Record<QueueName, Partial<QueueOptions>>> = {},
): Promise<void> {
  for (const [name, defaults] of QUEUE_OPTIONS) {
    const options = { ...defaults, ...overrides[name] };
    await boss.createQueue(name, options);
    // createQueue leaves an existing queue as it is; updateQueue brings its options up to date.
    await boss.updateQueue(name, options);
  }
}
