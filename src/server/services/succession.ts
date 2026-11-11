// Digital successors and succession requests (milestone M25, In scope 1; specification §15;
// docs/adr/0028-governance.md).
//
//   succession.mine      the account's page: as an owner, the nomination and the verified students
//                        it may nominate; as a nominee, the nominations it received and its requests
//   succession.nominate  an owner with the `successor` entitlement (Professional Sifu, or the owner
//                        of an organization holding Federation) nominates one of their verified
//                        students who holds Premium Student or Professional Sifu (DEFAULT M25,
//                        question 2): pending; at most one live nomination per owner
//   succession.answer    the nominee accepts or declines a pending nomination
//   succession.revoke    the owner revokes a pending or accepted nomination; a pending request of it
//                        is withdrawn and its case closed
//   succession.request   the accepted successor asks for the transfer: after a death they report or
//                        after more than SUCCESSION_INACTIVITY_DAYS without activity of the owner's
//                        account, always with evidence (the private store), as a review_case of kind
//                        succession_request that an administrator decides (governance-review.ts)
//
// Inactivity alone never transfers anything and never marks anyone deceased: a request on
// inactivity only opens a review, the owner is told at once (an account notice, always e-mailed),
// the approval checks the inactivity again, and no step of succession ever changes a person's life
// status (memorial status is a separate decision, specification §15; DEFAULT M25, question 1).
//
// Logs and audit rows carry ids, states, the basis and day counts, never a name or a note.

import { and, count, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { authUser, organization, organizationAdmin, person, reviewCase, reviewEvent, reviewNote, successionNomination, successionRequest, teachingRelationship } from '../db/schema';
import { GOVERNANCE_DAILY_LIMIT, GOVERNANCE_TEXT_MAX, LIVE_NOMINATION_STATUSES, SUCCESSION_BASES, SUCCESSION_INACTIVITY_DAYS } from '../db/schema/common';
import { type Executor, effectivePlan, organizationPlan, requireEntitlement } from '../entitlements/access';
import { feature } from '../entitlements/plans';
import type { Transaction } from '../jobs/outbox';
import type { RequestMeta } from './context';
import { peopleRefs, type PersonRef } from './dashboard';
import { pgErrorOf, ServiceError } from './errors';
import { linkFilesToCase } from './evidence';
import { notify } from './notify';
import { fieldErrors, idempotencyKey, isKeyConflict, keyReused } from './relationships';
import { caseReplayOf, isCaseKeyConflict, lockAccountCases, recordCaseEvent, tellStaff } from './review-core';

/** DEFAULT M25 (question 2): the plans a nominee must hold, the source's "active Tier 2 or Tier 3 profile". */
export const SUCCESSOR_PLANS = ['premium_student', 'pro_sifu'] as const;

const NO_NOMINATION = 'No such nomination.';
const noNomination = () => new ServiceError('NOT_FOUND', NO_NOMINATION);

const governanceText = (empty: string | null) =>
  z
    .string()
    .max(GOVERNANCE_TEXT_MAX * 2, { error: `Use at most ${GOVERNANCE_TEXT_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => empty === null || s.length > 0, { error: empty ?? '' })
    .refine((s) => s.length <= GOVERNANCE_TEXT_MAX, { error: `Use at most ${GOVERNANCE_TEXT_MAX} characters.` });

export const nominateInput = z.object({ successorPersonId: z.uuid({ error: 'Choose one of your verified students.' }) });
export const nominationIdInput = z.object({ nominationId: z.uuid({ error: NO_NOMINATION }) });
export const answerNominationInput = nominationIdInput.extend({ answer: z.enum(['accept', 'decline'], { error: 'Accept or decline the nomination.' }) });
export const successionRequestInput = nominationIdInput.extend({
  basis: z.enum(SUCCESSION_BASES, { error: 'Choose what the request rests on.' }),
  note: governanceText('Write what happened and what the evidence shows.'),
  evidenceIds: z.array(z.uuid({ error: 'Attach at least one file of evidence.' })).max(20).default([]),
  idempotencyKey,
});

// --- Facts ----------------------------------------------------------------------------------------

/**
 * Whole days since the account's last activity: its last sign-in (auth_user.last_active_at, kept
 * after a sign-out) or its newest session's last refresh, whichever is later; the account's
 * creation when neither is known. Never a reason by itself to change anything (see the top).
 * DEFAULT M25 (question 9): measured from sign-ins and session refreshes, checked again at approval.
 */
export async function inactiveDaysOf(db: Executor, userId: string): Promise<number> {
  const rows = await db.execute<{ days: number }>(sql`
SELECT floor(extract(epoch FROM (now() - GREATEST(
         COALESCE(u.last_active_at, u.created_at),
         COALESCE((SELECT max(s.updated_at) FROM auth_session s WHERE s.user_id = u.id), u.created_at)))) / 86400)::int AS days
  FROM auth_user u WHERE u.id = ${userId}::uuid`);
  return Math.max(0, rows.rows[0]?.days ?? 0);
}

async function ownPerson(db: Executor, userId: string): Promise<string | null> {
  const [own] = await db.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  return own?.id ?? null;
}

/**
 * Whether the account may nominate a successor (the `successor` entitlement): its own plan, or an
 * organization it owns that holds Federation (specification §3.1, Tier 4).
 */
export async function maySucceed(db: Executor, userId: string): Promise<boolean> {
  if ((await requireEntitlement({ kind: 'user', userId }, 'successor', { db })).ok) return true;
  const owned = await db
    .select({ id: organizationAdmin.organizationId })
    .from(organizationAdmin)
    .innerJoin(organization, eq(organization.id, organizationAdmin.organizationId))
    .where(and(eq(organizationAdmin.userId, userId), eq(organizationAdmin.role, 'owner'), isNull(organizationAdmin.revokedAt), eq(organization.status, 'active')));
  for (const o of owned) if ((await organizationPlan({ kind: 'organization', organizationId: o.id }, { db })).plan === 'federation') return true;
  return false;
}

/** The verified students of a teacher's person who have an account (the people a successor is chosen from). */
async function verifiedStudents(db: Executor, teacherPersonId: string): Promise<{ personId: string; userId: string }[]> {
  const rows = await db
    .selectDistinct({ personId: person.id, userId: person.claimedByUserId })
    .from(teachingRelationship)
    .innerJoin(person, eq(person.id, teachingRelationship.studentPersonId))
    .innerJoin(authUser, eq(authUser.id, person.claimedByUserId))
    .where(and(eq(teachingRelationship.teacherPersonId, teacherPersonId), eq(teachingRelationship.status, 'verified'), isNull(person.deletedAt), eq(authUser.banned, false)))
    .limit(500);
  return rows.filter((r): r is { personId: string; userId: string } => r.userId !== null);
}

async function holdsSuccessorPlan(db: Executor, userId: string): Promise<boolean> {
  const { plan } = await effectivePlan({ kind: 'user', userId }, { db });
  return (SUCCESSOR_PLANS as readonly string[]).includes(plan);
}

/**
 * Whether a successor may still take over at approval (governance-review.ts): their account is not
 * banned and still holds Premium Student or Professional Sifu (DEFAULT M25, question 2).
 */
export async function mayStillSucceed(db: Executor, userId: string): Promise<boolean> {
  const [u] = await db.select({ banned: authUser.banned }).from(authUser).where(eq(authUser.id, userId));
  return !!u && !u.banned && (await holdsSuccessorPlan(db, userId));
}

// --- succession.mine --------------------------------------------------------------------------------

export interface NominationView {
  id: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  statusLabel: string;
  owner: PersonRef | null;
  successor: PersonRef | null;
  createdAt: string;
  respondedAt: string | null;
}

export interface SuccessionRequestView {
  id: string;
  caseId: string;
  nominationId: string;
  basis: 'reported_death' | 'inactivity';
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  statusLabel: string;
  createdAt: string;
}

export interface SuccessionPage {
  /** The account has a profile of its own (a nomination is between two archive records). */
  hasProfile: boolean;
  /** The owner's side: whether the plan allows a nomination, and why not. */
  entitled: boolean;
  entitlementNote: string | null;
  candidates: { person: PersonRef; eligible: boolean }[];
  /** The owner's live nomination, and the earlier ones. */
  nomination: NominationView | null;
  pastNominations: NominationView[];
  /** Succession requests about this owner (their status only: the evidence is the reviewers'). */
  requestsAboutMe: SuccessionRequestView[];
  /** The nominee's side. */
  received: (NominationView & { mayRequest: boolean; inactivityOpen: boolean })[];
  myRequests: SuccessionRequestView[];
  inactivityDays: number;
}

export const NOMINATION_STATUS_LABELS: Record<NominationView['status'], string> = {
  pending: 'Waiting for an answer',
  accepted: 'Accepted',
  declined: 'Declined',
  revoked: 'Revoked',
};

export const SUCCESSION_REQUEST_STATUS_LABELS: Record<SuccessionRequestView['status'], string> = {
  pending: 'Waiting for an administrator',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Closed',
};

const nominationColumns = {
  id: successionNomination.id,
  status: successionNomination.status,
  ownerUserId: successionNomination.ownerUserId,
  ownerPersonId: successionNomination.ownerPersonId,
  successorUserId: successionNomination.successorUserId,
  successorPersonId: successionNomination.successorPersonId,
  createdAt: successionNomination.createdAt,
  respondedAt: successionNomination.respondedAt,
};
type NominationRow = { id: string; status: NominationView['status']; ownerUserId: string; ownerPersonId: string; successorUserId: string; successorPersonId: string; createdAt: Date; respondedAt: Date | null };

const requestColumns = {
  id: successionRequest.id,
  caseId: successionRequest.reviewCaseId,
  nominationId: successionRequest.nominationId,
  basis: successionRequest.basis,
  status: successionRequest.status,
  createdAt: successionRequest.createdAt,
};

function requestView(r: { id: string; caseId: string; nominationId: string; basis: SuccessionRequestView['basis']; status: SuccessionRequestView['status']; createdAt: Date }): SuccessionRequestView {
  return { ...r, statusLabel: SUCCESSION_REQUEST_STATUS_LABELS[r.status], createdAt: r.createdAt.toISOString() };
}

/** succession.mine: the signed-in account's succession page (both sides). */
export async function successionMine(principal: Principal | null): Promise<SuccessionPage> {
  const p = requireUser(principal);
  const db = getDb();
  const own = await ownPerson(db, p.user.id);
  const entitled = await maySucceed(db, p.user.id);
  const owned = await db.select(nominationColumns).from(successionNomination).where(eq(successionNomination.ownerUserId, p.user.id)).orderBy(desc(successionNomination.createdAt)).limit(20);
  const received = await db
    .select(nominationColumns)
    .from(successionNomination)
    .where(and(eq(successionNomination.successorUserId, p.user.id), ne(successionNomination.status, 'revoked')))
    .orderBy(desc(successionNomination.createdAt))
    .limit(20);
  const students = own && entitled ? await verifiedStudents(db, own) : [];
  const refs = await peopleRefs([...new Set([...owned, ...received].flatMap((n) => [n.ownerPersonId, n.successorPersonId]).concat(students.map((s) => s.personId)))]);
  const view = (n: NominationRow): NominationView => ({
    id: n.id,
    status: n.status,
    statusLabel: NOMINATION_STATUS_LABELS[n.status],
    owner: refs.get(n.ownerPersonId) ?? null,
    successor: refs.get(n.successorPersonId) ?? null,
    createdAt: n.createdAt.toISOString(),
    respondedAt: n.respondedAt?.toISOString() ?? null,
  });
  const live = owned.find((n) => (LIVE_NOMINATION_STATUSES as readonly string[]).includes(n.status)) ?? null;
  const aboutMe = await db.select(requestColumns).from(successionRequest).where(eq(successionRequest.ownerUserId, p.user.id)).orderBy(desc(successionRequest.createdAt)).limit(20);
  const mine = await db.select(requestColumns).from(successionRequest).where(eq(successionRequest.requesterUserId, p.user.id)).orderBy(desc(successionRequest.createdAt)).limit(20);
  const candidates = [];
  for (const s of students) {
    if (s.userId === p.user.id) continue;
    const ref = refs.get(s.personId);
    if (ref) candidates.push({ person: ref, eligible: await holdsSuccessorPlan(db, s.userId) });
  }
  const receivedViews = [];
  for (const n of received) {
    // A nomination whose request was approved has done its work: no further request on it.
    const open = n.status === 'accepted' && !mine.some((r) => r.nominationId === n.id && (r.status === 'pending' || r.status === 'approved'));
    // Only whether the inactivity basis is open, never the owner's last activity itself.
    const inactivityOpen = open && (await inactiveDaysOf(db, n.ownerUserId)) > SUCCESSION_INACTIVITY_DAYS;
    receivedViews.push({ ...view(n), mayRequest: open, inactivityOpen });
  }
  const f = feature('successor');
  return {
    hasProfile: own !== null,
    entitled,
    entitlementNote: entitled ? null : `${f.label} comes with Professional Sifu, or with an organization you own that holds Federation.`,
    candidates,
    nomination: live ? view(live) : null,
    pastNominations: owned.filter((n) => n !== live).map(view),
    requestsAboutMe: aboutMe.map(requestView),
    received: receivedViews,
    myRequests: mine.map(requestView),
    inactivityDays: SUCCESSION_INACTIVITY_DAYS,
  };
}

// --- succession.nominate / answer / revoke -----------------------------------------------------------

/** succession.nominate: the owner nominates one of their verified students (see the top). */
export async function nominateSuccessor(principal: Principal | null, raw: z.input<typeof nominateInput>, meta: RequestMeta): Promise<{ nomination: NominationView }> {
  const p = requireUser(principal);
  const parsed = nominateInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const db = getDb();
  try {
    const id = await db.transaction(async (tx) => {
      await lockAccountCases(tx, p.user.id);
      const own = await ownPerson(tx, p.user.id);
      if (!own) throw new ServiceError('CONFLICT', 'Set up your profile first: a successor is chosen among your verified students.');
      if (!(await maySucceed(tx, p.user.id))) {
        throw new ServiceError('ENTITLEMENT_REQUIRED', 'A digital successor comes with Professional Sifu, or with an organization you own that holds Federation.', {}, {
          entitlement: await requireEntitlement({ kind: 'user', userId: p.user.id }, 'successor', { db: tx }),
        });
      }
      const student = (await verifiedStudents(tx, own)).find((s) => s.personId === parsed.data.successorPersonId);
      if (!student || student.userId === p.user.id) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { successorPersonId: 'Choose one of your verified students.' });
      // DEFAULT M25 (question 2): the source's "active Tier 2 or Tier 3 profile".
      if (!(await holdsSuccessorPlan(tx, student.userId))) {
        throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { successorPersonId: 'A successor needs an active Premium Student or Professional Sifu plan.' });
      }
      const [live] = await tx
        .select(nominationColumns)
        .from(successionNomination)
        .where(and(eq(successionNomination.ownerUserId, p.user.id), inArray(successionNomination.status, [...LIVE_NOMINATION_STATUSES])));
      if (live) {
        // A repeated submit of the same nomination is the same nomination.
        if (live.successorPersonId === student.personId && live.status === 'pending') return live.id;
        throw new ServiceError('CONFLICT', 'You already have a successor nomination. Revoke it before you nominate someone else.');
      }
      const nominationId = uuidv7();
      await tx.insert(successionNomination).values({ id: nominationId, ownerUserId: p.user.id, ownerPersonId: own, successorUserId: student.userId, successorPersonId: student.personId, status: 'pending' });
      await writeAudit(tx, {
        action: 'succession.nominate',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'succession_nomination',
        subjectId: nominationId,
        after: { status: 'pending', ownerPersonId: own, successorPersonId: student.personId },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await notify(tx, student.userId, 'succession.nominated', { nominationId }, { key: `succession-nominated:${nominationId}` });
      return nominationId;
    });
    return { nomination: await nominationViewOf(id) };
  } catch (error) {
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'succession_nomination_one_live_key') throw new ServiceError('CONFLICT', 'You already have a successor nomination. Revoke it before you nominate someone else.');
    throw error;
  }
}

async function nominationViewOf(id: string): Promise<NominationView> {
  const [n] = await getDb().select(nominationColumns).from(successionNomination).where(eq(successionNomination.id, id));
  if (!n) throw noNomination();
  const refs = await peopleRefs([n.ownerPersonId, n.successorPersonId]);
  return {
    id: n.id,
    status: n.status,
    statusLabel: NOMINATION_STATUS_LABELS[n.status],
    owner: refs.get(n.ownerPersonId) ?? null,
    successor: refs.get(n.successorPersonId) ?? null,
    createdAt: n.createdAt.toISOString(),
    respondedAt: n.respondedAt?.toISOString() ?? null,
  };
}

async function lockedNomination(tx: Transaction, id: string): Promise<NominationRow | null> {
  const [n] = await tx.select(nominationColumns).from(successionNomination).where(eq(successionNomination.id, id)).for('update');
  return n ?? null;
}

/** succession.answer: the nominee accepts or declines a pending nomination; anyone else gets 404. */
export async function answerNomination(principal: Principal | null, raw: z.input<typeof answerNominationInput>, meta: RequestMeta): Promise<{ nomination: NominationView }> {
  const p = requireUser(principal);
  const parsed = answerNominationInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const { nominationId, answer } = parsed.data;
  await getDb().transaction(async (tx) => {
    const n = await lockedNomination(tx, nominationId);
    if (!n || n.successorUserId !== p.user.id) throw noNomination();
    const to = answer === 'accept' ? 'accepted' : 'declined';
    if (n.status === to) return;
    if (n.status !== 'pending') throw new ServiceError('CONFLICT', n.status === 'revoked' ? 'Your teacher revoked this nomination.' : 'You have answered this nomination already.');
    const now = new Date();
    await tx.update(successionNomination).set({ status: to, respondedAt: now, updatedAt: now }).where(eq(successionNomination.id, n.id));
    await writeAudit(tx, {
      action: 'succession.answer',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'succession_nomination',
      subjectId: n.id,
      before: { status: 'pending' },
      after: { status: to },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await notify(tx, n.ownerUserId, 'succession.answered', { nominationId: n.id, answer: to }, { key: `succession-answered:${n.id}` });
  });
  return { nomination: await nominationViewOf(nominationId) };
}

/** succession.revoke: the owner revokes a pending or accepted nomination; anyone else gets 404. */
export async function revokeNomination(principal: Principal | null, raw: z.input<typeof nominationIdInput>, meta: RequestMeta): Promise<{ nomination: NominationView }> {
  const p = requireUser(principal);
  const parsed = nominationIdInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const { nominationId } = parsed.data;
  await getDb().transaction(async (tx) => {
    const n = await lockedNomination(tx, nominationId);
    if (!n || n.ownerUserId !== p.user.id) throw noNomination();
    if (n.status === 'revoked') return;
    if (n.status === 'declined') throw new ServiceError('CONFLICT', 'This nomination was declined: there is nothing to revoke.');
    const now = new Date();
    await tx.update(successionNomination).set({ status: 'revoked', revokedAt: now, updatedAt: now }).where(eq(successionNomination.id, n.id));
    // A pending request of this nomination is withdrawn: the owner is evidently here.
    const pending = await tx.select({ id: successionRequest.id, caseId: successionRequest.reviewCaseId }).from(successionRequest).where(and(eq(successionRequest.nominationId, n.id), eq(successionRequest.status, 'pending')));
    for (const r of pending) {
      await tx.update(successionRequest).set({ status: 'withdrawn', decidedAt: now, updatedAt: now }).where(eq(successionRequest.id, r.id));
      const [c] = await tx.select({ status: reviewCase.status, assignedTo: reviewCase.assignedToUserId }).from(reviewCase).where(eq(reviewCase.id, r.caseId)).for('update');
      if (c && c.status !== 'resolved' && c.status !== 'dismissed') {
        await tx.update(reviewCase).set({ status: 'dismissed', updatedAt: now }).where(eq(reviewCase.id, r.caseId));
        await tx.insert(reviewEvent).values({ reviewCaseId: r.caseId, action: 'withdraw', fromStatus: c.status, toStatus: 'dismissed', actorUserId: p.user.id, actorRole: p.user.role });
        if (c.assignedTo) await notify(tx, c.assignedTo, 'review.updated', { caseId: r.caseId, change: 'withdrawn' });
      }
    }
    await writeAudit(tx, {
      action: 'succession.revoke',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'succession_nomination',
      subjectId: n.id,
      before: { status: n.status },
      after: { status: 'revoked', withdrawnRequests: pending.map((r) => r.id) },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await notify(tx, n.successorUserId, 'succession.revoked', { nominationId: n.id }, { key: `succession-revoked:${n.id}` });
  });
  return { nomination: await nominationViewOf(nominationId) };
}

// --- succession.request ------------------------------------------------------------------------------

export const INACTIVITY_NOT_YET = `The owner’s account was active within the last ${SUCCESSION_INACTIVITY_DAYS} days. A request on inactivity is possible only after more than ${SUCCESSION_INACTIVITY_DAYS} days without activity; inactivity alone is never taken as a death.`;

/** succession.request: the accepted successor asks for the transfer (see the top of this file). */
export async function requestSuccession(principal: Principal | null, raw: z.input<typeof successionRequestInput>, meta: RequestMeta): Promise<{ request: SuccessionRequestView; replayed: boolean }> {
  const p = requireUser(principal);
  const parsed = successionRequestInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    const outcome = await db.transaction(async (tx) => {
      await lockAccountCases(tx, p.user.id);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        const [earlier] = await tx.select({ id: successionRequest.id }).from(successionRequest).where(eq(successionRequest.reviewCaseId, replay.caseId));
        if (!earlier || replay.action !== 'open') throw keyReused();
        return { id: earlier.id, replayed: true };
      }
      const n = await lockedNomination(tx, input.nominationId);
      if (!n || n.successorUserId !== p.user.id) throw noNomination();
      if (n.status !== 'accepted') throw new ServiceError('CONFLICT', n.status === 'pending' ? 'Accept the nomination first.' : 'This nomination is no longer in force.');
      const [pending] = await tx.select({ id: successionRequest.id }).from(successionRequest).where(and(eq(successionRequest.nominationId, n.id), eq(successionRequest.status, 'pending')));
      if (pending) throw new ServiceError('CONFLICT', 'Your succession request waits for an administrator already.');
      const [approved] = await tx.select({ id: successionRequest.id }).from(successionRequest).where(and(eq(successionRequest.nominationId, n.id), eq(successionRequest.status, 'approved')));
      if (approved) throw new ServiceError('CONFLICT', 'Your succession request on this nomination was approved already.');
      // DEFAULT M25 (question 5): a few requests a day, counted under the account's case lock.
      const [{ n: today } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(successionRequest)
        .where(and(eq(successionRequest.requesterUserId, p.user.id), gt(successionRequest.createdAt, sql`now() - interval '24 hours'`)));
      if (today >= GOVERNANCE_DAILY_LIMIT) throw new ServiceError('TOO_MANY_REQUESTS', 'You have sent several succession requests today. You can send another one tomorrow.');
      const inactiveDays = await inactiveDaysOf(tx, n.ownerUserId);
      if (input.basis === 'inactivity' && inactiveDays <= SUCCESSION_INACTIVITY_DAYS) throw new ServiceError('CONFLICT', INACTIVITY_NOT_YET);
      const caseId = uuidv7();
      // The owner's record is what the case is about: its account is a party and never reviews it.
      await tx.insert(reviewCase).values({ id: caseId, kind: 'succession_request', status: 'open', personId: n.ownerPersonId, openedByUserId: p.user.id });
      const evidenceError = await linkFilesToCase(tx, p.user.id, caseId, input.evidenceIds);
      if (evidenceError) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { evidenceIds: evidenceError });
      await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: p.user.id, body: input.note, isInternal: false });
      const id = uuidv7();
      await tx.insert(successionRequest).values({ id, nominationId: n.id, reviewCaseId: caseId, requesterUserId: p.user.id, ownerUserId: n.ownerUserId, basis: input.basis, inactiveDays, status: 'pending' });
      await recordCaseEvent(tx, { caseId, action: 'open', from: null, to: 'open', actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'succession.request',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'succession_request',
        subjectId: id,
        after: { status: 'pending', basis: input.basis, inactiveDays, nominationId: n.id, caseId },
        evidenceIds: input.evidenceIds,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellStaff(tx, caseId, 'succession_request', [p.user.id, n.ownerUserId]);
      // The owner hears of it at once (an account notice: its e-mail is never switched off).
      await notify(tx, n.ownerUserId, 'succession.requested', { requestId: id, basis: input.basis }, { key: `succession-requested:${id}` });
      return { id, replayed: false };
    });
    const [row] = await db.select(requestColumns).from(successionRequest).where(eq(successionRequest.id, outcome.id));
    return { request: requestView(row!), replayed: outcome.replayed };
  } catch (error) {
    if (isCaseKeyConflict(error) || isKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'succession_request_one_pending_key') throw new ServiceError('CONFLICT', 'Your succession request waits for an administrator already.');
    throw error;
  }
}

/** For the succession case card (review.ts): the facts an administrator weighs. */
export async function successionFacts(db: Executor, caseId: string): Promise<{ label: string; value: string }[] | null> {
  const [r] = await db
    .select({ basis: successionRequest.basis, inactiveDays: successionRequest.inactiveDays, status: successionRequest.status, ownerUserId: successionRequest.ownerUserId, nominationId: successionRequest.nominationId, transferred: successionRequest.transferred })
    .from(successionRequest)
    .where(eq(successionRequest.reviewCaseId, caseId));
  if (!r) return null;
  const [n] = await db.select({ status: successionNomination.status, successorPersonId: successionNomination.successorPersonId, createdAt: successionNomination.createdAt }).from(successionNomination).where(eq(successionNomination.id, r.nominationId));
  const now = r.ownerUserId ? await inactiveDaysOf(db, r.ownerUserId) : null;
  const schools = r.ownerUserId ? await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM school WHERE created_by_user_id = ${r.ownerUserId}::uuid AND deleted_at IS NULL`) : null;
  const orgs = r.ownerUserId
    ? await db.select({ n: count() }).from(organizationAdmin).where(and(eq(organizationAdmin.userId, r.ownerUserId), isNull(organizationAdmin.revokedAt)))
    : [];
  const successor = n ? (await peopleRefs([n.successorPersonId])).get(n.successorPersonId) : undefined;
  return [
    { label: 'Basis', value: r.basis === 'reported_death' ? 'A death reported by the successor (check the evidence; inactivity is not proof of death)' : `More than ${SUCCESSION_INACTIVITY_DAYS} days without activity` },
    { label: 'Days without activity', value: `${r.inactiveDays} when sent${now === null ? '' : `; ${now} now`}` },
    { label: 'Successor', value: successor ? successor.name.value : 'Unknown' },
    { label: 'Nomination', value: n ? `${NOMINATION_STATUS_LABELS[n.status]} (made ${n.createdAt.toISOString().slice(0, 10)})` : 'Gone' },
    {
      label: 'What an approval moves',
      value: r.transferred
        ? `Moved: ${r.transferred.schoolIds.length} school listing(s), ${r.transferred.organizationIds.length} organization administration(s)`
        : `${schools?.rows[0]?.n ?? 0} school listing(s) and ${orgs[0]?.n ?? 0} organization administration(s). The owner’s record, life status, students and relationships stay as they are.`,
    },
  ];
}

/** Whether the owner of a request may still be relied on as inactive (re-checked at approval). */
export async function stillInactive(db: Executor, ownerUserId: string): Promise<boolean> {
  return (await inactiveDaysOf(db, ownerUserId)) > SUCCESSION_INACTIVITY_DAYS;
}

