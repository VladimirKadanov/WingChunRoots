// billing.event and billing.grace (milestone M22; docs/adr/0025-billing.md).
//
// - billing.event: applies one stored provider event (src/server/billing/webhook.ts stored it and
//   queued this job in the same transaction) through src/server/services/billing.ts. Idempotent: a
//   processed event is a no-op, and an older snapshot than the stored one is "stale". An event about
//   a subscription the app does not know yet (its creating event is still on the way) is retried;
//   on the last attempt it is recorded as "unknown".
// - billing.grace: hourly, ends the subscriptions whose failed renewal stayed unpaid past the grace
//   period (DEFAULT M22, question 5).
//
// When a change touches a Sifu plan (a public pin depends on it), the public cache of schools is
// dropped through the web process's internal route. Logs carry ids, outcomes and counts only (plan §6.4).

import type { JobWithMetadata, PgBoss } from 'pg-boss';

import type { Database } from '../db';
import { SCHOOLS_TAG } from '../cache-tags';
import { applyStoredEvent, BillingEventNotReady, endExpiredGrace } from '../services/billing';
import { failureCode, postRevalidate, type RevalidateCall } from './lineage-recompute';
import { type BillingEventJob, QUEUE } from './queues';

/** Handles billing.event. A failure is logged and rethrown with its code only. */
export function billingEventHandler(_db: Database, log: (line: string) => void, boss?: PgBoss, revalidate: RevalidateCall = postRevalidate) {
  return async (jobs: JobWithMetadata<BillingEventJob>[]): Promise<void> => {
    for (const job of jobs) {
      const last = job.retryCount >= job.retryLimit;
      try {
        const result = await applyStoredEvent(job.data.eventId, { final: last, boss });
        log(`${QUEUE.billingEvent}: job ${job.id}: event ${job.data.eventId}: ${result.outcome}`);
        if (result.touchesSchools) await revalidate([SCHOOLS_TAG]);
      } catch (error) {
        const code = error instanceof BillingEventNotReady ? 'subscription not known yet' : failureCode(error);
        log(`${QUEUE.billingEvent}: job ${job.id}: attempt ${job.retryCount + 1} of ${job.retryLimit + 1} failed (${code})${last ? '; no attempts left' : '; will retry'}`);
        throw new Error(`${QUEUE.billingEvent} failed: ${code}`);
      }
    }
  };
}

/** Handles billing.grace. The jobs carry nothing: one run answers every job of the batch. */
export function billingGraceHandler(_db: Database, log: (line: string) => void, boss?: PgBoss, revalidate: RevalidateCall = postRevalidate) {
  return async (jobs: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    const job = jobs[0];
    if (!job) return;
    try {
      const result = await endExpiredGrace({ boss });
      log(`${QUEUE.billingGrace}: job ${job.id}: ${result.ended} subscription(s) ended after the grace period`);
      if (result.touchesSchools) await revalidate([SCHOOLS_TAG]);
    } catch (error) {
      const code = failureCode(error);
      const last = job.retryCount >= job.retryLimit;
      log(`${QUEUE.billingGrace}: job ${job.id}: attempt ${job.retryCount + 1} of ${job.retryLimit + 1} failed (${code})${last ? '; no attempts left' : '; will retry'}`);
      throw new Error(`${QUEUE.billingGrace} failed: ${code}`);
    }
  };
}
