// The pure core of entitlements (milestone M08; plan §6.5): which plan is in effect for an account
// at a moment, and what a plan allows. No database here, so requireEntitlement.test.ts covers
// every case (overlapping, expired, revoked and future grants) without one; access.ts reads the
// rows and calls these functions.

import {
  type AccountType,
  feature,
  type FeatureKey,
  freePlanFor,
  PLANS,
  type PlanCode,
  plansFor,
} from './plans';

export interface GrantPeriod {
  id: string;
  planCode: PlanCode;
  source: 'test_grant' | 'complimentary' | 'stripe';
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
}

export type GrantState = 'active' | 'scheduled' | 'ended' | 'revoked';

/** Where a grant stands at `now`: revoked wins, then not started yet, then ended. */
export function grantState(grant: GrantPeriod, now: Date): GrantState {
  if (grant.revokedAt !== null && grant.revokedAt.getTime() <= now.getTime()) return 'revoked';
  if (grant.startsAt.getTime() > now.getTime()) return 'scheduled';
  if (grant.endsAt !== null && grant.endsAt.getTime() <= now.getTime()) return 'ended';
  return 'active';
}

function lastsLonger(a: GrantPeriod, b: GrantPeriod): boolean {
  if (b.endsAt === null) return false;
  return a.endsAt === null || a.endsAt.getTime() > b.endsAt.getTime();
}

export interface EffectivePlan {
  /** The plan in effect: the highest of the floor and the active grants of the account's audience. */
  plan: PlanCode;
  /** The free plan of the account type, which every account holds (plan §6.5). */
  floor: PlanCode;
  accountType: AccountType;
  /** The grant that gives `plan`, or null when it is the free floor. */
  grantId: string | null;
  /**
   * When `plan` stops being in effect if nothing changes: the end of its grant, carried on through
   * grants of the same plan that follow without a gap; null for no end or the free plan.
   */
  until: Date | null;
  /**
   * Active grants of a plan for the other account type (a Pro Sifu grant on a Student account):
   * they take effect again when the account type changes back.
   */
  dormantGrantIds: string[];
}

/**
 * The plan in effect for an account (plan §6.5). The floor is the free plan of its account type;
 * an active grant of a higher plan of the same audience lifts it. Overlapping grants never add up:
 * the highest plan wins, and among grants of that plan the one that lasts longest gives `until`.
 * Expired, revoked and future grants do not count. A grant never lowers the plan.
 */
export function resolveEffectivePlan(accountType: AccountType, grants: readonly GrantPeriod[], now: Date): EffectivePlan {
  const floor = freePlanFor(accountType);
  const audience = PLANS[floor].audience;
  let best: { code: PlanCode; grant: GrantPeriod | null } = { code: floor, grant: null };
  const dormant: string[] = [];
  for (const grant of grants) {
    if (grantState(grant, now) !== 'active') continue;
    const plan = PLANS[grant.planCode];
    if (plan.audience !== audience) {
      dormant.push(grant.id);
      continue;
    }
    // A grant of the free plan itself changes nothing.
    if (plan.rank <= PLANS[floor].rank) continue;
    const higher = plan.rank > PLANS[best.code].rank;
    const sameLonger = plan.code === best.code && best.grant !== null && lastsLonger(grant, best.grant);
    if (higher || sameLonger) best = { code: plan.code, grant };
  }
  return {
    plan: best.code,
    floor,
    accountType,
    grantId: best.grant?.id ?? null,
    until: best.grant ? continuedUntil(best.grant, grants, now) : null,
    dormantGrantIds: dormant,
  };
}

/**
 * When the plan of `grant` stops if nothing changes (review round 1, code-6): its end, carried on
 * through every grant of the same plan, active or scheduled, that starts by then. Back-to-back
 * grants (the second starting the day the first ends) continue the plan without a gap.
 */
function continuedUntil(grant: GrantPeriod, grants: readonly GrantPeriod[], now: Date): Date | null {
  let until = grant.endsAt;
  for (let extended = true; extended && until !== null; ) {
    extended = false;
    for (const next of grants) {
      if (next.planCode !== grant.planCode) continue;
      const state = grantState(next, now);
      if (state !== 'active' && state !== 'scheduled') continue;
      if (next.startsAt.getTime() > until.getTime()) continue;
      if (next.endsAt === null) return null;
      if (next.endsAt.getTime() > until.getTime()) {
        until = next.endsAt;
        extended = true;
      }
    }
  }
  return until;
}

/** What requireEntitlement() answers (plan §6.5). */
export type EntitlementDecision =
  | { ok: true; plan: PlanCode; limit: number | null; current: number }
  | {
      ok: false;
      /** 'quota': the plan includes the feature but its allowance is used up; 'plan': it does not include it. */
      code: 'quota' | 'plan';
      plan: PlanCode;
      limit: number | null;
      current: number;
      /** The lowest plan that would allow it, for the upgrade prompt; null when none does. */
      grantedBy: PlanCode | null;
    };

/** The lowest plan that allows one more use of `key` after `current` uses, starting in `plan`'s audience. */
export function lowestPlanAllowing(key: FeatureKey, plan: PlanCode, current: number): PlanCode | null {
  const f = feature(key);
  const allows = (code: PlanCode) => {
    const value = f.values[code];
    if (!value.included) return false;
    return value.limit === undefined || value.limit === null || current < value.limit;
  };
  const own = PLANS[plan];
  for (const candidate of plansFor(own.audience)) {
    if (candidate.rank > own.rank && candidate.availability === 'now' && allows(candidate.code)) return candidate.code;
  }
  // Another account type's free plan (a Student who wants to approve students switches to Sifu).
  for (const audience of ['student', 'sifu'] as const) {
    if (audience === own.audience) continue;
    for (const candidate of plansFor(audience)) {
      if (candidate.availability === 'now' && allows(candidate.code)) return candidate.code;
    }
  }
  return null;
}

/**
 * Whether `plan` allows one more use of `key` when `current` are used (the quota features), or
 * allows the feature at all (the others). Pure: the caller counts `current` in the transaction
 * that holds the quota lock (quota.ts).
 */
export function decide(key: FeatureKey, plan: PlanCode, current: number): EntitlementDecision {
  const value = feature(key).values[plan];
  const limit = value.limit === undefined ? null : value.limit;
  if (!value.included) {
    return { ok: false, code: 'plan', plan, limit: limit ?? 0, current, grantedBy: lowestPlanAllowing(key, plan, current) };
  }
  if (limit !== null && current >= limit) {
    return { ok: false, code: 'quota', plan, limit, current, grantedBy: lowestPlanAllowing(key, plan, current) };
  }
  return { ok: true, plan, limit, current };
}
