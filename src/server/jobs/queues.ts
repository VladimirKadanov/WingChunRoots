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
  /** Rewrite the search keys of every person (src/server/search/store.ts; M07): after db:seed, or a change to the key rules. */
  searchKeysRebuild: 'search.keys.rebuild',
  /**
   * M09 (plan §6.3, §6.4): after a change to the verified edges, recompute lineage_membership of the
   * lineages it touched (from v_public_edge only), then drop the cache of that derived data
   * (lineage-membership:<id>) through POST /api/internal/revalidate (src/server/jobs/lineage-recompute.ts).
   */
  lineageRecompute: 'lineage.recompute',
  /**
   * M17 (DEFAULT M17, question 3): the dashboard notices of a published or cancelled event, to the
   * Premium Students whose established teacher organizes or teaches it (src/server/jobs/event-notify.ts).
   */
  eventsNotify: 'events.notify',
  /**
   * M18: once a day, the notices of plan grants that end within 7 days and of those that have ended
   * (src/server/jobs/plan-expiry.ts).
   */
  plansExpiry: 'plans.expiry',
  /**
   * M20 (DEFAULT D17, D18): once a day, the activity check of the listed schools: day 90 asks the
   * owner to confirm the listing, day 105 hides its pin (src/server/jobs/school-activity.ts).
   */
  schoolsActivity: 'schools.activity',
  /**
   * M22 (docs/adr/0025-billing.md): apply one stored provider event (billing_event) to the
   * subscription and its plan grant, idempotently and in the provider's order (src/server/jobs/billing.ts).
   */
  billingEvent: 'billing.event',
  /**
   * M22 (DEFAULT M22, question 5): every hour, end the subscriptions whose renewal failed and whose
   * grace of BILLING_GRACE_DAYS has run out (src/server/jobs/billing.ts).
   */
  billingGrace: 'billing.grace',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/** The payload of email.send (and of its dead letters). The address stays in email_delivery. */
export interface EmailSendJob {
  deliveryId: string;
  /** Template data, checked again by the template before rendering; without its secret fields. */
  data: unknown;
  /** The template's secret fields (account links), sealed for this delivery (src/server/mail/seal.ts). */
  sealed?: string;
  /**
   * M18: the unsubscribe link of an e-mail whose category can be switched off (MailUnsubscribe),
   * sealed for this delivery like a token: whoever holds it switches the category off.
   */
  unsubscribe?: string;
}

/**
 * The payload of lineage.recompute: ids only, never a name (plan §6.4). The worker revalidates only
 * lineage-membership:<id> of these lineages; the change's own person and lineage tags were expired
 * by the procedure that made it (M09 review, requirements-1). A job queued before that carries a
 * `tags` field too, which the handler ignores.
 */
export interface LineageRecomputeJob {
  lineageIds: string[];
}

/** The payload of events.notify: the event's id and the change, never its text (plan §6.4). */
export interface EventsNotifyJob {
  eventId: string;
  change: 'published' | 'cancelled';
}

/** The payload of billing.event: the id of the stored event row, never its content (plan §6.4). */
export interface BillingEventJob {
  eventId: string;
}

export interface JobData {
  [QUEUE.emailSend]: EmailSendJob;
  [QUEUE.emailSendFailed]: EmailSendJob;
  [QUEUE.retentionPurge]: Record<string, never>;
  [QUEUE.searchKeysRebuild]: Record<string, never>;
  [QUEUE.lineageRecompute]: LineageRecomputeJob;
  [QUEUE.eventsNotify]: EventsNotifyJob;
  [QUEUE.plansExpiry]: Record<string, never>;
  [QUEUE.schoolsActivity]: Record<string, never>;
  [QUEUE.billingEvent]: BillingEventJob;
  [QUEUE.billingGrace]: Record<string, never>;
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
  // M07: one job rewrites every person's keys in batches; its payload is empty, so nothing personal stays behind.
  [QUEUE.searchKeysRebuild, { retryLimit: 3, retryDelay: 60, expireInSeconds: 600, deleteAfterSeconds: 7 * DAY }],
  // M09: a few seconds of work per job; retried briefly when the web process does not answer yet.
  [QUEUE.lineageRecompute, { retryLimit: 5, retryDelay: 10, retryBackoff: true, retryDelayMax: 300, expireInSeconds: 120, deleteAfterSeconds: DAY }],
  // M17: one insert of notices per job; its payload holds ids only.
  [QUEUE.eventsNotify, { retryLimit: 5, retryDelay: 10, retryBackoff: true, retryDelayMax: 300, expireInSeconds: 120, deleteAfterSeconds: DAY }],
  // M18: a daily pass over the grants that end; idempotent by its notice keys.
  [QUEUE.plansExpiry, { retryLimit: 3, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 600, deleteAfterSeconds: 7 * DAY }],
  // M20: a daily pass over the listed schools; idempotent by their stages and the notice keys.
  [QUEUE.schoolsActivity, { retryLimit: 3, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 600, deleteAfterSeconds: 7 * DAY }],
  // M22: one event per job, retried while its subscription is not known yet (an invoice before its
  // subscription); the payload is a row id. 1 + 6 attempts over about half an hour.
  [QUEUE.billingEvent, { retryLimit: 6, retryDelay: 5, retryBackoff: true, retryDelayMax: 600, expireInSeconds: 120, deleteAfterSeconds: 7 * DAY }],
  // M22: a daily pass over the past-due subscriptions; idempotent by their status.
  [QUEUE.billingGrace, { retryLimit: 3, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 600, deleteAfterSeconds: 7 * DAY }],
];

/** Recurring jobs: cron in UTC. */
export const SCHEDULES: ReadonlyArray<{ queue: QueueName; cron: string }> = [
  // Daily at 03:17 UTC, away from the top of the hour.
  { queue: QUEUE.retentionPurge, cron: '17 3 * * *' },
  // M18: daily at 06:41 UTC, the notices of plans that end.
  { queue: QUEUE.plansExpiry, cron: '41 6 * * *' },
  // M20: daily at 05:23 UTC, the activity check of the listed schools.
  { queue: QUEUE.schoolsActivity, cron: '23 5 * * *' },
  // M22: hourly at :37, the end of the grace of unpaid renewals (an hour late at most).
  { queue: QUEUE.billingGrace, cron: '37 * * * *' },
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
