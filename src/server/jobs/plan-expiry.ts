// plans.expiry (milestone M18, In scope 5; docs/adr/0021-notices.md): once a day, the notices of
// plan grants that end within 7 days (plan.expiring) and of those that have ended (plan.expired),
// one per grant and step, through notify() (dashboard, and e-mail unless the account switched the
// Plan category off).
//
// - Only an account's own grants (entitlement_grant.subject_user_id), never a revoked one: a revoked
//   grant has had its own notice (plan.revoked, M08).
// - Expiring: the grant is in effect now (started) and ends in the next 7 days. Ended: it ended in
//   the last 7 days (a missed day of the job catches up; an older end is not announced late).
// - The plan the account has after the end is the plan in effect at that instant without this grant
//   (its other grants and its account type): when another grant of the same plan carries it on,
//   nothing ends, and no notice is sent.
// - Idempotent: the key `plan.expiring:<grant id>` or `plan.expired:<grant id>` makes one notice per
//   grant and step, however often the job runs. Logs carry counts only (plan §6.4).

import { and, gt, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import type { JobWithMetadata, PgBoss } from 'pg-boss';

import type { Database } from '../db';
import { authUser, entitlementGrant } from '../db/schema';
import { resolveEffectivePlan } from '../entitlements/effective';
import { notify } from '../services/notify';
import { QUEUE } from './queues';

/** DEFAULT M18 (In scope 5): the notice of an end comes 7 days before it. */
export const PLAN_EXPIRY_NOTICE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlanEndResult {
  expiring: number;
  expired: number;
}

/** Writes the notices of the grants that end soon or have ended. */
export async function sendPlanEndNotices(db: Database, now = new Date(), boss?: PgBoss): Promise<PlanEndResult> {
  const soon = new Date(now.getTime() + PLAN_EXPIRY_NOTICE_DAYS * DAY_MS);
  const since = new Date(now.getTime() - PLAN_EXPIRY_NOTICE_DAYS * DAY_MS);
  const ending = await db
    .select({ id: entitlementGrant.id, subjectUserId: entitlementGrant.subjectUserId, planCode: entitlementGrant.planCode, startsAt: entitlementGrant.startsAt, endsAt: entitlementGrant.endsAt })
    .from(entitlementGrant)
    .where(
      and(
        isNotNull(entitlementGrant.subjectUserId),
        isNull(entitlementGrant.revokedAt),
        isNotNull(entitlementGrant.endsAt),
        gt(entitlementGrant.endsAt, since),
        lte(entitlementGrant.endsAt, soon),
        lte(entitlementGrant.startsAt, now),
      ),
    );
  if (ending.length === 0) return { expiring: 0, expired: 0 };
  const userIds = [...new Set(ending.map((g) => g.subjectUserId!))];
  const accounts = await db.select({ id: authUser.id, accountType: authUser.accountType }).from(authUser).where(inArray(authUser.id, userIds));
  const typeOf = new Map(accounts.map((a) => [a.id, a.accountType]));
  const grants = await db
    .select({
      id: entitlementGrant.id,
      subjectUserId: entitlementGrant.subjectUserId,
      planCode: entitlementGrant.planCode,
      source: entitlementGrant.source,
      startsAt: entitlementGrant.startsAt,
      endsAt: entitlementGrant.endsAt,
      revokedAt: entitlementGrant.revokedAt,
    })
    .from(entitlementGrant)
    .where(inArray(entitlementGrant.subjectUserId, userIds));

  const result: PlanEndResult = { expiring: 0, expired: 0 };
  for (const grant of ending) {
    const userId = grant.subjectUserId!;
    const accountType = typeOf.get(userId);
    if (!accountType) continue;
    const endsAt = grant.endsAt!;
    const others = grants.filter((g) => g.subjectUserId === userId && g.id !== grant.id);
    const next = resolveEffectivePlan(accountType, others, endsAt).plan;
    // Another grant of the same plan carries it on: nothing ends.
    if (next === grant.planCode) continue;
    const step = endsAt.getTime() > now.getTime() ? 'plan.expiring' : 'plan.expired';
    const sent = await db.transaction((tx) =>
      notify(
        tx,
        userId,
        step,
        { grantId: grant.id, planCode: grant.planCode, endsAt: endsAt.toISOString(), nextPlanCode: next },
        { key: `${step}:${grant.id}`, boss },
      ),
    );
    if (sent.notified) result[step === 'plan.expiring' ? 'expiring' : 'expired'] += 1;
  }
  return result;
}

/** Handles plans.expiry. A failure is logged and rethrown with its code only (plan §6.4). */
export function planExpiryHandler(db: Database, log: (line: string) => void, boss?: PgBoss) {
  return async (jobs: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    for (const job of jobs) {
      try {
        const result = await sendPlanEndNotices(db, new Date(), boss);
        log(`${QUEUE.plansExpiry}: job ${job.id}: ${result.expiring} ending soon, ${result.expired} ended`);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        const reason = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? `database error ${code}` : error instanceof Error ? error.name : 'unknown error';
        const last = job.retryCount >= job.retryLimit;
        log(`${QUEUE.plansExpiry}: job ${job.id}: attempt ${job.retryCount + 1} of ${job.retryLimit + 1} failed (${reason})${last ? '; no attempts left' : '; will retry'}`);
        throw new Error(`${QUEUE.plansExpiry} failed: ${reason}`);
      }
    }
  };
}
