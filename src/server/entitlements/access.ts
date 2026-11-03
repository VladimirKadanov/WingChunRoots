// requireEntitlement() and effectivePlan() (milestone M08; plan §6.5): the one place that decides
// what an account's plan allows. They read the account type and the grants of entitlement_grant
// and count the current use; the decisions themselves are the pure functions of effective.ts.
//
// Services call them; routes and components never do (ESLint). A quota check that guards a write
// runs through withQuota() (quota.ts), which takes the advisory lock first, in the same transaction.

import { and, countDistinct, eq, inArray, isNull } from 'drizzle-orm';

import { getDb, type Database } from '../db';
import { authUser, entitlementGrant, GALLERY_PHOTO_STATUSES, person, personPhoto, PUBLIC_RELATIONSHIP_STATUSES, teachingRelationship } from '../db/schema';
import { decide, type EffectivePlan, type EntitlementDecision, type GrantPeriod, grantState, resolveEffectivePlan } from './effective';
import { feature, type FeatureKey } from './plans';

/** A Drizzle database or an open transaction. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

/** An account: its plan comes from its account type and its grants (plan §6.5). */
export interface UserSubject {
  kind: 'user';
  userId: string;
}

/**
 * M15: an organization (D12): its only plan is Federation, held through a grant
 * (entitlement_grant.subject_organization_id; test or complimentary in the pilot, DEFAULT D09). It
 * never adds to, or takes from, the plan of any account of its admins (DEFAULT D08).
 */
export interface OrganizationSubject {
  kind: 'organization';
  organizationId: string;
}

/** Who holds rights: an account or (M15) an organization. */
export type EntitlementSubject = UserSubject | OrganizationSubject;

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
export async function effectivePlan(subject: UserSubject, options: EntitlementOptions = {}): Promise<EffectivePlan> {
  const db = options.db ?? getDb();
  const [account] = await db.select({ accountType: authUser.accountType }).from(authUser).where(eq(authUser.id, subject.userId));
  if (!account) throw new UnknownSubjectError();
  return resolveEffectivePlan(account.accountType, await grantsOf(db, subject.userId), options.now ?? new Date());
}

/**
 * M14 (DEFAULT D07): the active profile photos of the account's own person (at most one). M16
 * (docs/adr/0019-galleries.md): every photo of the person's gallery counts, the profile photo
 * among them (statuses `active` and `gallery`). Only person_photo is counted: evidence files are
 * never photos of a gallery and never count against the allowance (DEFAULT D13), and a school's
 * logo and room photos (school_photo) have their own limit.
 *
 * With `personId` (alreadyCounted): only that person's profile photo, the one photos.upload
 * replaces, so a replacement adds nothing while a new photo of the gallery always counts.
 */
async function activePhotos(db: Executor, subject: UserSubject, personId?: string): Promise<number> {
  const [row] = await db
    .select({ n: countDistinct(personPhoto.id) })
    .from(personPhoto)
    .innerJoin(person, eq(person.id, personPhoto.personId))
    .where(
      and(
        eq(person.claimedByUserId, subject.userId),
        isNull(person.deletedAt),
        personId === undefined ? inArray(personPhoto.status, [...GALLERY_PHOTO_STATUSES]) : eq(personPhoto.status, 'active'),
        personId === undefined ? undefined : eq(personPhoto.personId, personId),
      ),
    );
  return row?.n ?? 0;
}

/**
 * How much of a counted feature the account uses now. Approved students (D06): the distinct
 * students of the account's own person whose relationship is established (verified or in
 * arbitration), whatever its visibility. Photos (M14, DEFAULT D07): the current profile photo of
 * the account's own person counts as one; M16: with every other photo of its gallery. The other features count nothing in Phase 1.
 */
export async function currentUse(db: Executor, subject: EntitlementSubject, key: FeatureKey): Promise<number> {
  // An organization counts nothing in M15: its features are not counted allowances.
  if (subject.kind === 'organization') return 0;
  if (key === 'photos') return activePhotos(db, subject);
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
  if (subject.kind === 'organization') return false;
  // M14: replacing the profile photo of a person who has one adds nothing (the unit is the person).
  if (key === 'photos') return (await activePhotos(db, subject, unit)) > 0;
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
  if (subject.kind === 'organization') {
    // M15: an organization holds Federation or nothing; without it, Federation is what allows it.
    const org = await organizationPlan(subject, { db, now: options.now });
    if (org.plan) return decide(key, org.plan, 0);
    return { ok: false, code: 'plan', plan: 'federation', limit: 0, current: 0, grantedBy: feature(key).values.federation.included ? 'federation' : null };
  }
  const { plan } = await effectivePlan(subject, { db, now: options.now });
  return decide(key, plan, await currentUse(db, subject, key));
}

/** M15: every grant of an organization (any state). */
export async function organizationGrantsOf(db: Executor, organizationId: string): Promise<GrantPeriod[]> {
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
    .where(eq(entitlementGrant.subjectOrganizationId, organizationId));
}

export interface OrganizationPlan {
  /** 'federation' while an active Federation grant holds, else null (an organization has no free plan). */
  plan: 'federation' | null;
  /** The grant that gives it. */
  grantId: string | null;
  /** When it stops if nothing changes (null: no end, or no plan). */
  until: Date | null;
}

/**
 * M15: the plan in effect for an organization now: Federation while an active grant of it holds
 * (the longest-lasting one when several overlap), else none. Only Federation counts: an
 * organization holds no account's plan (DEFAULT D08).
 */
export async function organizationPlan(subject: OrganizationSubject, options: EntitlementOptions = {}): Promise<OrganizationPlan> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const active = (await organizationGrantsOf(db, subject.organizationId)).filter((g) => g.planCode === 'federation' && grantState(g, now) === 'active');
  if (active.length === 0) return { plan: null, grantId: null, until: null };
  const best = active.reduce((a, b) => (a.endsAt === null ? a : b.endsAt === null || b.endsAt.getTime() > a.endsAt.getTime() ? b : a));
  return { plan: 'federation', grantId: best.id, until: best.endsAt };
}
