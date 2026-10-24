// requireEntitlement() and effectivePlan() (milestone M08; plan §6.5): the one place that decides
// what an account's plan allows. They read the account type and the grants of entitlement_grant
// and count the current use; the decisions themselves are the pure functions of effective.ts.
//
// Services call them; routes and components never do (ESLint). A quota check that guards a write
// runs through withQuota() (quota.ts), which takes the advisory lock first, in the same transaction.

import { and, countDistinct, eq, inArray, isNull } from 'drizzle-orm';

import { getDb, type Database } from '../db';
import { authUser, entitlementGrant, person, PUBLIC_RELATIONSHIP_STATUSES, teachingRelationship } from '../db/schema';
import { decide, type EffectivePlan, type EntitlementDecision, type GrantPeriod, resolveEffectivePlan } from './effective';
import type { FeatureKey } from './plans';

/** A Drizzle database or an open transaction. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/** Who holds rights: an account. Organizations (Federation, Phase 3) come later (D12). */
export interface EntitlementSubject {
  kind: 'user';
  userId: string;
}

export interface EntitlementOptions {
  /** The transaction of the write the check guards; the shared pool otherwise. */
  db?: Executor;
  now?: Date;
}

export class UnknownSubjectError extends Error {
  constructor() {
    super('entitlements: no such account');
    this.name = 'UnknownSubjectError';
  }
}

/** Every grant of an account (any state); resolveEffectivePlan() picks the ones in effect. */
export async function grantsOf(db: Executor, userId: string): Promise<GrantPeriod[]> {
  return db
    .select({
      id: entitlementGrant.id,
      planCode: entitlementGrant.planCode,
      source: entitlementGrant.source,
      startsAt: entitlementGrant.startsAt,
      endsAt: entitlementGrant.endsAt,
      revokedAt: entitlementGrant.revokedAt,
    })
    .from(entitlementGrant)
    .where(eq(entitlementGrant.subjectUserId, userId));
}

/** The plan in effect for an account now (or at `now`): the free plan of its type as the floor. */
export async function effectivePlan(subject: EntitlementSubject, options: EntitlementOptions = {}): Promise<EffectivePlan> {
  const db = options.db ?? getDb();
  const [account] = await db.select({ accountType: authUser.accountType }).from(authUser).where(eq(authUser.id, subject.userId));
  if (!account) throw new UnknownSubjectError();
  return resolveEffectivePlan(account.accountType, await grantsOf(db, subject.userId), options.now ?? new Date());
}

/**
 * How much of a counted feature the account uses now. Approved students (D06): the distinct
 * students of the account's own person whose relationship is established (verified or in
 * arbitration), whatever its visibility. The other features count nothing in Phase 1.
 */
export async function currentUse(db: Executor, subject: EntitlementSubject, key: FeatureKey): Promise<number> {
  if (key !== 'approve_students') return 0;
  const [row] = await db
    .select({ n: countDistinct(teachingRelationship.studentPersonId) })
    .from(teachingRelationship)
    .innerJoin(person, eq(person.id, teachingRelationship.teacherPersonId))
    .where(
      and(
        eq(person.claimedByUserId, subject.userId),
        isNull(person.deletedAt),
        inArray(teachingRelationship.status, [...PUBLIC_RELATIONSHIP_STATUSES]),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Whether `unit` already counts in the current use of `key`: for approved students, whether that
 * student already has an established relationship with the account's own person. Approving another
 * link of a student who counts adds nothing to the count (D06 counts distinct students).
 */
export async function alreadyCounted(db: Executor, subject: EntitlementSubject, key: FeatureKey, unit: string): Promise<boolean> {
  if (key !== 'approve_students') return false;
  const [row] = await db
    .select({ n: countDistinct(teachingRelationship.studentPersonId) })
    .from(teachingRelationship)
    .innerJoin(person, eq(person.id, teachingRelationship.teacherPersonId))
    .where(
      and(
        eq(person.claimedByUserId, subject.userId),
        isNull(person.deletedAt),
        eq(teachingRelationship.studentPersonId, unit),
        inArray(teachingRelationship.status, [...PUBLIC_RELATIONSHIP_STATUSES]),
      ),
    );
  return (row?.n ?? 0) > 0;
}

/**
 * Whether the subject may use one more of `key` (plan §6.5): `{ ok: true }` or a machine-readable
 * refusal `{ ok: false, code: 'quota' | 'plan', limit, current, grantedBy }`. The upgrade prompt is
 * built only from this refusal and the matrix. On its own it decides and locks nothing: a check
 * that guards a write goes through withQuota() (quota.ts).
 */
export async function requireEntitlement(
  subject: EntitlementSubject,
  key: FeatureKey,
  options: EntitlementOptions = {},
): Promise<EntitlementDecision> {
  const db = options.db ?? getDb();
  const { plan } = await effectivePlan(subject, { db, now: options.now });
  return decide(key, plan, await currentUse(db, subject, key));
}
