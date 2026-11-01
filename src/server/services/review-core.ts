// What every kind of review case shares (milestones M10a and M10b; plan §5.6, §6.6, §6.7): the
// case row and its lock, who a case is about (nobody reviews a case of their own), the case's own
// history (review_event) with its idempotency key, and the notice to the staff who handle a kind.
// review.ts (the queue and the historical claims), claims.ts, instructor.ts, reports.ts and
// arbitration.ts build on it; it imports none of them.
//
// Lock order, everywhere: the relationship first (FOR UPDATE), then its case, then a person. A
// relationship_event takes a KEY SHARE lock on its relationship (the foreign key), so a case taken
// first would deadlock against a withdrawal or another decision (M10a review, code-1).
//
// Logs and audit rows carry ids and codes, never a name or a reviewer's words (plan §6.4).

import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import type { Principal, StaffRole } from '../auth/principal';
import { uuidv7 } from '../db/ids';
import { authUser, notification, person, reviewCase, reviewEvent, teachingRelationship } from '../db/schema';
import { OPEN_REVIEW_CASE_STATUSES, type REVIEW_EVENT_ACTIONS, STAFF_ROLES } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import type { Transaction } from '../jobs/outbox';
import type { ReviewCaseKind, ReviewCaseStatus } from '../templates/review';
import { pgErrorOf, ServiceError } from './errors';

export type ReviewEventAction = (typeof REVIEW_EVENT_ACTIONS)[number];

export const NO_CASE = 'No such case.';
export const caseNotFound = () => new ServiceError('NOT_FOUND', NO_CASE);
export const isOpenCase = (status: string) => (OPEN_REVIEW_CASE_STATUSES as readonly string[]).includes(status);

/**
 * Who decides a case of each kind (plan §6.7): an archivist or an administrator verifies claims and
 * instructors; a moderator or an administrator sets arbitration and decides disputes and reports
 * (DEFAULT D19; reports: a default with no D number, docs/evidence-and-review.md). Any reviewer may
 * take a claim or an instructor's case and ask its parties for more information when it is theirs
 * (a dispute or a report: only its deciders, ASSIGNED_TO_DECIDERS), and keep internal notes.
 */
export const DECIDERS: Readonly<Record<Exclude<ReviewCaseKind, 'deletion_request'>, readonly StaffRole[]>> = {
  historical_claim: ['archivist', 'admin'],
  person_claim: ['archivist', 'admin'],
  instructor_verification: ['archivist', 'admin'],
  relationship_dispute: ['moderator', 'admin'],
  profile_report: ['moderator', 'admin'],
  school_listing: ['archivist', 'admin'],
};

/**
 * The kinds only their deciders take (review.assign): a dispute or a report is all decision, and
 * the reviewer of a dispute opens both sides' files (evidence.ts accessOfFiles), so a reviewer who
 * cannot decide it never holds it. The other kinds: any reviewer, who may ask for information.
 */
export const ASSIGNED_TO_DECIDERS: ReadonlySet<ReviewCaseKind> = new Set(['relationship_dispute', 'profile_report']);

/** The roles a case of `kind` may be assigned to. */
export function assignableRoles(kind: ReviewCaseKind): readonly StaffRole[] {
  if (kind === 'deletion_request') return ['admin'];
  return ASSIGNED_TO_DECIDERS.has(kind) ? DECIDERS[kind] : STAFF_ROLES;
}

export interface CaseRow {
  id: string;
  kind: ReviewCaseKind;
  status: ReviewCaseStatus;
  relationshipId: string | null;
  personId: string | null;
  openedByUserId: string | null;
  assignedToUserId: string | null;
  resolution: 'approved' | 'rejected' | null;
  resolutionReason: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const caseColumns = {
  id: reviewCase.id,
  kind: reviewCase.kind,
  status: reviewCase.status,
  relationshipId: reviewCase.relationshipId,
  personId: reviewCase.personId,
  openedByUserId: reviewCase.openedByUserId,
  assignedToUserId: reviewCase.assignedToUserId,
  resolution: reviewCase.resolution,
  resolutionReason: reviewCase.resolutionReason,
  resolvedAt: reviewCase.resolvedAt,
  createdAt: reviewCase.createdAt,
  updatedAt: reviewCase.updatedAt,
};

/** A case of the queue (never an account deletion request, M07), locked FOR UPDATE when `lock`. */
export async function caseById(db: Executor, id: string, lock = false): Promise<CaseRow | null> {
  const query = db.select(caseColumns).from(reviewCase).where(and(eq(reviewCase.id, id), ne(reviewCase.kind, 'deletion_request')));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/**
 * The accounts a case is about: the account that opened it, the accounts of the relationship's
 * teacher and student, and the account of the person it names (the claimed record, the instructor,
 * the reported profile). Nobody reviews a case of their own, whatever their role: such a reviewer
 * takes no action on it, is not given it, and reads it as the parties do (no internal notes).
 */
export async function partiesOf(db: Executor, c: Pick<CaseRow, 'kind' | 'relationshipId' | 'openedByUserId' | 'personId'>): Promise<Set<string>> {
  const out = new Set<string>();
  // A dispute is opened by the moderator who set the arbitration: they are its reviewer, not a party.
  if (c.openedByUserId && c.kind !== 'relationship_dispute') out.add(c.openedByUserId);
  if (c.relationshipId) {
    const rows = await db
      .select({ userId: person.claimedByUserId })
      .from(teachingRelationship)
      .innerJoin(person, or(eq(person.id, teachingRelationship.teacherPersonId), eq(person.id, teachingRelationship.studentPersonId)))
      .where(and(eq(teachingRelationship.id, c.relationshipId), isNull(person.deletedAt)));
    for (const row of rows) if (row.userId) out.add(row.userId);
  }
  if (c.personId) {
    const [named] = await db.select({ userId: person.claimedByUserId }).from(person).where(eq(person.id, c.personId));
    if (named?.userId) out.add(named.userId);
  }
  return out;
}

/** Whether this reviewer is one of the case's parties: nobody reviews their own case. */
export async function ownSide(db: Executor, p: Principal, c: Pick<CaseRow, 'kind' | 'relationshipId' | 'openedByUserId' | 'personId'>): Promise<boolean> {
  return (await partiesOf(db, c)).has(p.user.id);
}

/**
 * One row of a case's history (review_event), with the idempotency key of the call that made the
 * change (plan §5.6) when it carries one. Returns the event's id (an e-mail's idempotency key).
 */
export async function recordCaseEvent(
  tx: Transaction,
  event: { caseId: string; action: ReviewEventAction; from: ReviewCaseStatus | null; to: ReviewCaseStatus; actor: Principal; key: string | null },
): Promise<string> {
  const id = uuidv7();
  await tx.insert(reviewEvent).values({
    id,
    reviewCaseId: event.caseId,
    action: event.action,
    fromStatus: event.from,
    toStatus: event.to,
    actorUserId: event.actor.user.id,
    actorRole: event.actor.user.role,
    idempotencyKey: event.key,
  });
  return id;
}

/** The int4 namespace of the per-account case lock: pg_advisory_xact_lock(CASE_LOCK_SPACE, hashtext(user)). */
const CASE_LOCK_SPACE = 11;

/**
 * Takes the account's case lock (M10b review, code-4): reports.create, instructor.request and
 * invitations.accept count the account's own rows before they add one (reports a day, instructor
 * requests a day, one pending profile claim), and calls at the same time would each count before
 * the others commit. With the lock they run one after the other, and each count (a new snapshot
 * per statement, READ COMMITTED) sees what the calls before it wrote. Taken first in the
 * transaction, before any row lock, so a call never waits for it while holding one.
 */
export async function lockAccountCases(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CASE_LOCK_SPACE}::int, hashtext(${userId}::text))`);
}

/** The case event an idempotency key of this account recorded already, or null. */
export async function caseReplayOf(db: Executor, userId: string, key: string): Promise<{ caseId: string; action: ReviewEventAction; toStatus: ReviewCaseStatus } | null> {
  const [row] = await db
    .select({ caseId: reviewEvent.reviewCaseId, action: reviewEvent.action, toStatus: reviewEvent.toStatus })
    .from(reviewEvent)
    .where(and(eq(reviewEvent.actorUserId, userId), eq(reviewEvent.idempotencyKey, key)));
  return row ?? null;
}

/** A unique violation of a case event's key: another call with the key committed first. */
export function isCaseKeyConflict(error: unknown): boolean {
  const pg = pgErrorOf(error);
  return pg?.code === '23505' && pg.constraint === 'review_event_idempotency_key';
}

/**
 * The staff who handle a kind get the queue's notice of a new case (no name: the case card shows
 * the people to a session that proved the second factor).
 */
export async function tellStaff(tx: Transaction, caseId: string, kind: ReviewCaseKind, exclude: readonly string[] = []): Promise<void> {
  const roles = kind === 'deletion_request' ? (['admin'] as const) : DECIDERS[kind];
  const staff = await tx
    .select({ id: authUser.id })
    .from(authUser)
    .where(and(inArray(authUser.role, [...roles]), eq(authUser.banned, false)))
    .limit(200);
  const rows = staff.filter((s) => !exclude.includes(s.id)).map((s) => ({ userId: s.id, template: 'review.opened', payload: { caseId, kind } }));
  if (rows.length > 0) await tx.insert(notification).values(rows);
}

/** The reviewer a case is assigned to is told that a party answered (evidence, a reply). */
export async function tellAssignee(tx: Transaction, c: Pick<CaseRow, 'id' | 'assignedToUserId'>, change: 'evidence' | 'withdrawn'): Promise<void> {
  if (c.assignedToUserId) await tx.insert(notification).values({ userId: c.assignedToUserId, template: 'review.updated', payload: { caseId: c.id, change } });
}
