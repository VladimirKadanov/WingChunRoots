// The notice at a limit of the plan (milestone M18, In scope 5; DEFAULT M18, question 2;
// docs/adr/0021-notices.md).
//
// When an action meets a real limit of the plan (requireEntitlement's refusal with code `quota`:
// the students a Free Sifu approves, D06; photos, D07; events a month, M17), the account gets one
// notice in the dashboard per feature and calendar month (UTC), with the upgrade prompt of M08 (only
// benefits with availability 'now'). Never an e-mail (the catalog's `limit.reached` is dashboard
// only), never for a feature the plan does not include at all (code `plan`: that is not a limit the
// account met, and the page says so already).
//
// The refusal rolls the action's transaction back, so the notice is written after it, in a
// transaction of its own. A notice that cannot be written never changes the refusal the caller gets.

import { getDb } from '../db';
import type { EntitlementDecision } from '../entitlements/effective';
import { logger } from '../log';
import type { LimitFeature } from '../templates/notifications';
import { isServiceError } from './errors';
import { notify } from './notify';

type Refusal = Extract<EntitlementDecision, { ok: false }>;

/** The month key of a notice: one per feature and calendar month (UTC). */
export function limitMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** The refusal behind an ENTITLEMENT_REQUIRED error, when it is a used-up allowance. */
function quotaRefusal(error: unknown): Refusal | null {
  if (!isServiceError(error) || error.code !== 'ENTITLEMENT_REQUIRED') return null;
  const decision = error.details.entitlement as Partial<Refusal> | undefined;
  if (!decision || decision.ok !== false || decision.code !== 'quota' || typeof decision.plan !== 'string' || typeof decision.limit !== 'number') return null;
  return decision as Refusal;
}

/**
 * Writes the limit notice for `error` when it is a used-up allowance of `feature`; does nothing for
 * any other error. Never throws.
 */
export async function tellLimitReached(userId: string, feature: LimitFeature, error: unknown, now = new Date()): Promise<void> {
  const refusal = quotaRefusal(error);
  if (!refusal || refusal.limit === null) return;
  const month = limitMonth(now);
  try {
    await getDb().transaction((tx) =>
      notify(
        tx,
        userId,
        'limit.reached',
        { feature, planCode: refusal.plan, limit: refusal.limit, upgradeTo: refusal.grantedBy, month },
        { key: `limit.reached:${feature}:${month}` },
      ),
    );
  } catch (failure) {
    const code = (failure as { code?: unknown } | null)?.code;
    logger().error(`[notify] limit.reached: the notice could not be written (${typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? `database error ${code}` : 'error'})`);
  }
}

/** Runs `action`; when it fails at a used-up allowance of `feature`, writes the notice and rethrows. */
export async function withLimitNotice<T>(userId: string, feature: LimitFeature, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    await tellLimitReached(userId, feature, error);
    throw error;
  }
}
