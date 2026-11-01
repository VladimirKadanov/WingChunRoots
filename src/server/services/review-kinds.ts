// The decisions on the review case kinds of milestone M10b (plan §5.6, §6.6, §6.7), called by
// review.decide (review.ts) once it holds the locks (the relationship, then the case), has replayed
// a repeated key and has checked who decides (review-core.ts DECIDERS), the assignment and that the
// case is open. Each writes the case's history (review_event), every change of a relationship's
// status as a relationship_event, and its audit rows, in the caller's transaction, with the notices.
//
//   person_claim             verify: the record becomes the claimant's own (claimed_by_user_id,
//                            stewardship self; still involved_only) and each awaiting_claim
//                            relationship of the case moves to pending_teacher, which the teacher
//                            then answers as in M09; reject (with a reason): the relationship stays
//                            awaiting_claim and the student may invite again; needs_info.
//   instructor_verification  verify: "Instructor" instead of "Instructor (unverified)" on the
//                            profile, and the relationship panel's "Approved by an unverified
//                            instructor" goes (DEFAULT D04/D13); audit instructor.verify; reject;
//                            needs_info.
//   profile_report           verify (uphold) or reject (dismiss), with no automatic hiding: what a
//                            report shows is put right with the archival edit or by an
//                            administrator (DEFAULT, docs/evidence-and-review.md).
//   relationship_dispute     verify: in_arbitration → verified (the link stands); reject:
//                            in_arbitration → revoked (out of the public lineage); needs_info: the
//                            parties are asked again. Always with a reason both parties read
//                            (DEFAULT D19).
//
// Logs and audit rows carry ids and codes; a reviewer's words stay in the case (plan §6.4).

import { and, eq, isNull } from 'drizzle-orm';

import { writeAudit } from '../audit';
import type { Principal } from '../auth/principal';
import { authUser, contentReport, notification, person, personClaim, reviewCase, reviewNote, teachingRelationship } from '../db/schema';
import { enqueue, queueEmail, type Transaction } from '../jobs/outbox';
import { QUEUE } from '../jobs/queues';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';
import { filesOfCases } from './evidence';
import { neighbourTags } from './profile';
import { accountOf, namesFor, publicTags, recordEvent, type RelRow, url } from './relationships';
import { type CaseRow, recordCaseEvent } from './review-core';

export interface KindDecisionInput {
  decision: 'verify' | 'reject' | 'needs_info';
  reason: string | null;
  idempotencyKey: string;
}

export interface KindDecisionOutcome {
  /** Public cache tags to drop after the commit. */
  tags: string[];
}

const NONE: KindDecisionOutcome = { tags: [] };

/** needs_info on any kind: the question as a note the parties read, the case waits for them. */
async function askParties(tx: Transaction, p: Principal, c: CaseRow, input: KindDecisionInput, meta: RequestMeta): Promise<void> {
  await tx.update(reviewCase).set({ status: 'needs_info', updatedAt: new Date() }).where(eq(reviewCase.id, c.id));
  await tx.insert(reviewNote).values({ reviewCaseId: c.id, authorUserId: p.user.id, body: input.reason!, isInternal: false });
  await recordCaseEvent(tx, { caseId: c.id, action: 'needs_info', from: c.status, to: 'needs_info', actor: p, key: input.idempotencyKey });
  await writeAudit(tx, {
    action: 'review.needs_info',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'review_case',
    subjectId: c.id,
    before: { status: c.status },
    after: { status: 'needs_info', kind: c.kind, relationshipId: c.relationshipId },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
}

/** Closes the case with its resolution and writes review.resolve; returns the review_event id. */
async function resolveCase(
  tx: Transaction,
  p: Principal,
  c: CaseRow,
  input: KindDecisionInput,
  resolution: 'approved' | 'rejected',
  meta: RequestMeta,
): Promise<string> {
  const now = new Date();
  await tx.update(reviewCase).set({ status: 'resolved', resolution, resolutionReason: input.reason, resolvedAt: now, updatedAt: now }).where(eq(reviewCase.id, c.id));
  const eventId = await recordCaseEvent(tx, { caseId: c.id, action: resolution === 'approved' ? 'approve' : 'reject', from: c.status, to: 'resolved', actor: p, key: input.idempotencyKey });
  await writeAudit(tx, {
    action: 'review.resolve',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'review_case',
    subjectId: c.id,
    before: { status: c.status },
    after: { status: 'resolved', resolution, kind: c.kind, relationshipId: c.relationshipId, personId: c.personId },
    evidenceIds: ((await filesOfCases(tx, [c.id])).get(c.id) ?? []).map((f) => f.id),
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  return eventId;
}

async function emailOf(tx: Transaction, userId: string | null): Promise<{ id: string; email: string } | null> {
  if (!userId) return null;
  const [row] = await tx.select({ id: authUser.id, email: authUser.email }).from(authUser).where(eq(authUser.id, userId));
  return row ?? null;
}

// --- person_claim ------------------------------------------------------------------------------

async function tellClaimant(tx: Transaction, c: CaseRow, decision: 'approved' | 'rejected' | 'needs_info', eventKey: string): Promise<void> {
  const claimant = await emailOf(tx, c.openedByUserId);
  if (!claimant) return;
  await tx.insert(notification).values({ userId: claimant.id, template: 'claim.decided', payload: { caseId: c.id, decision } });
  const teacherNames = c.personId ? await namesFor(tx, c.personId) : [];
  if (teacherNames.length === 0) return;
  await queueEmail(tx, {
    template: 'claim-decided',
    to: claimant.email,
    userId: claimant.id,
    idempotencyKey: `claim-decided:${eventKey}`,
    data: { decision, teacherNames, url: url(decision === 'approved' ? '/dashboard/students/requests' : `/dashboard/cases/${c.id}`) },
  });
}

async function decidePersonClaim(tx: Transaction, p: Principal, c: CaseRow, row: RelRow | null, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  if (!row || !c.personId || !c.openedByUserId) throw new ServiceError('CONFLICT', 'This claim can no longer be decided: its request or its record is gone.');
  if (row.status !== 'awaiting_claim') {
    throw new ServiceError('CONFLICT', row.status === 'withdrawn' ? 'The student has withdrawn the request this claim answers.' : 'The request this claim answers no longer waits for the teacher to join.');
  }
  if (input.decision === 'needs_info') {
    await askParties(tx, p, c, input, meta);
    await tellClaimant(tx, c, 'needs_info', `${c.id}:${input.idempotencyKey}`);
    return NONE;
  }
  const now = new Date();
  if (input.decision === 'reject') {
    const eventId = await resolveCase(tx, p, c, input, 'rejected', meta);
    await tx.update(personClaim).set({ status: 'rejected', decidedByUserId: p.user.id, decidedAt: now, updatedAt: now }).where(and(eq(personClaim.reviewCaseId, c.id), eq(personClaim.status, 'pending')));
    await writeAudit(tx, {
      action: 'person.claim',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: c.personId,
      before: { status: 'pending' },
      after: { status: 'rejected', caseId: c.id },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await tellClaimant(tx, c, 'rejected', eventId);
    const student = await accountOf(tx, row.studentPersonId);
    if (student) await tx.insert(notification).values({ userId: student.id, template: 'invitation.claimed', payload: { relationshipId: row.id, stage: 'refused' } });
    return NONE;
  }

  // verify: the person after the case (the lock order of review-core.ts).
  const [record] = await tx
    .select({ claimedBy: person.claimedByUserId, stewardship: person.stewardship, deletedAt: person.deletedAt, visibility: person.visibility })
    .from(person)
    .where(eq(person.id, c.personId))
    .for('update');
  if (!record || record.deletedAt || record.claimedBy || record.stewardship !== 'unclaimed') throw new ServiceError('CONFLICT', 'This record can no longer be claimed.');
  const [own] = await tx.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, c.openedByUserId), isNull(person.deletedAt)));
  if (own) throw new ServiceError('CONFLICT', 'The claimant has a profile of their own now. Refuse this claim, or ask them about it.');
  const claimant = await emailOf(tx, c.openedByUserId);
  if (!claimant) throw new ServiceError('CONFLICT', 'The claimant’s account no longer exists. Refuse this claim.');

  // The record becomes the claimant's own; it stays involved_only until a link with it is verified.
  await tx.update(person).set({ claimedByUserId: c.openedByUserId, stewardship: 'self', updatedAt: now }).where(eq(person.id, c.personId));
  await tx.update(personClaim).set({ status: 'approved', decidedByUserId: p.user.id, decidedAt: now, updatedAt: now }).where(and(eq(personClaim.reviewCaseId, c.id), eq(personClaim.status, 'pending')));
  const eventId = await resolveCase(tx, p, c, input, 'approved', meta);
  await writeAudit(tx, {
    action: 'person.claim',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'person',
    subjectId: c.personId,
    before: { status: 'pending', stewardship: 'unclaimed', claimedByUserId: null },
    after: { status: 'approved', stewardship: 'self', claimedByUserId: c.openedByUserId, visibility: record.visibility, caseId: c.id },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  // awaiting_claim → pending_teacher: only now, after the approved claim (plan §6.7).
  await tx.update(teachingRelationship).set({ status: 'pending_teacher', statusReason: null, updatedAt: now }).where(eq(teachingRelationship.id, row.id));
  await recordEvent(tx, { relationshipId: row.id, from: 'awaiting_claim', to: 'pending_teacher', actor: p, role: p.user.role, reason: 'person_claim_approved', key: input.idempotencyKey });
  await writeAudit(tx, {
    action: 'relationship.claimed',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'teaching_relationship',
    subjectId: row.id,
    before: { status: 'awaiting_claim', visibility: row.visibility },
    after: { status: 'pending_teacher', visibility: row.visibility, caseId: c.id },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  await tellClaimant(tx, c, 'approved', eventId);
  // The teacher now answers the request as in M09: it waits in their queue.
  await tx.insert(notification).values({ userId: claimant.id, template: 'relationship.requested', payload: { relationshipId: row.id, resubmitted: false } });
  const student = await accountOf(tx, row.studentPersonId);
  if (student) await tx.insert(notification).values({ userId: student.id, template: 'invitation.claimed', payload: { relationshipId: row.id, stage: 'approved' } });
  return NONE;
}

// --- instructor_verification -------------------------------------------------------------------

async function tellInstructor(tx: Transaction, c: CaseRow, decision: 'verified' | 'rejected' | 'needs_info', eventKey: string): Promise<void> {
  const sifu = await emailOf(tx, c.openedByUserId);
  if (!sifu) return;
  await tx.insert(notification).values({ userId: sifu.id, template: 'instructor.decided', payload: { caseId: c.id, decision } });
  const recipientNames = c.personId ? await namesFor(tx, c.personId) : [];
  await queueEmail(tx, {
    template: 'instructor-decided',
    to: sifu.email,
    userId: sifu.id,
    idempotencyKey: `instructor-decided:${eventKey}`,
    data: { decision, url: url('/dashboard/instructor'), ...(recipientNames.length > 0 ? { recipientNames } : {}) },
  });
}

async function decideInstructor(tx: Transaction, p: Principal, c: CaseRow, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  if (!c.personId) throw new ServiceError('CONFLICT', 'This case can no longer be decided: the profile is gone.');
  if (input.decision === 'needs_info') {
    await askParties(tx, p, c, input, meta);
    await tellInstructor(tx, c, 'needs_info', `${c.id}:${input.idempotencyKey}`);
    return NONE;
  }
  const approved = input.decision === 'verify';
  const eventId = await resolveCase(tx, p, c, input, approved ? 'approved' : 'rejected', meta);
  if (approved) {
    await writeAudit(tx, {
      action: 'instructor.verify',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: c.personId,
      before: { instructor: 'unverified' },
      after: { instructor: 'verified', caseId: c.id },
      evidenceIds: ((await filesOfCases(tx, [c.id])).get(c.id) ?? []).map((f) => f.id),
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
  }
  await tellInstructor(tx, c, approved ? 'verified' : 'rejected', eventId);
  // The profile's label and the panel note of every link this teacher approved (cached pages).
  return { tags: approved ? await neighbourTags(tx, c.personId) : [] };
}

// --- profile_report ----------------------------------------------------------------------------

async function decideReport(tx: Transaction, p: Principal, c: CaseRow, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  if (input.decision === 'needs_info') throw new ServiceError('CONFLICT', 'A report is upheld or dismissed.');
  const upheld = input.decision === 'verify';
  await resolveCase(tx, p, c, input, upheld ? 'approved' : 'rejected', meta);
  await tx
    .update(contentReport)
    .set({ status: upheld ? 'resolved' : 'dismissed', updatedAt: new Date() })
    .where(eq(contentReport.reviewCaseId, c.id));
  return NONE;
}

// --- relationship_dispute ----------------------------------------------------------------------

/**
 * Both parties of an arbitration, by notification and e-mail (DEFAULT D19): the stage, the
 * reviewers' words (the reason, the question or the decision) and the link to the case page where
 * they send evidence.
 */
export async function tellDisputeParties(
  tx: Transaction,
  row: Pick<RelRow, 'id' | 'teacherPersonId' | 'studentPersonId' | 'lineageName'>,
  caseId: string,
  stage: 'opened' | 'needs_info' | 'kept' | 'revoked',
  reason: string,
  eventKey: string,
): Promise<void> {
  const teacherNames = await namesFor(tx, row.teacherPersonId);
  const studentNames = await namesFor(tx, row.studentPersonId);
  for (const [role, personId, otherNames, ownNames] of [
    ['student', row.studentPersonId, teacherNames, studentNames],
    ['teacher', row.teacherPersonId, studentNames, teacherNames],
  ] as const) {
    const account = await accountOf(tx, personId);
    if (!account) continue;
    await tx.insert(notification).values({ userId: account.id, template: 'relationship.arbitration', payload: { relationshipId: row.id, caseId, stage, reason } });
    if (otherNames.length === 0) continue;
    await queueEmail(tx, {
      template: 'relationship-arbitration',
      to: account.email,
      userId: account.id,
      idempotencyKey: `relationship-arbitration:${eventKey}:${role}`,
      data: {
        stage,
        role,
        otherNames: [...otherNames],
        lineageName: row.lineageName,
        reason,
        url: url(`/dashboard/cases/${caseId}`),
        ...(ownNames.length > 0 ? { recipientNames: [...ownNames] } : {}),
      },
    });
  }
}

async function decideDispute(tx: Transaction, p: Principal, c: CaseRow, row: RelRow | null, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  if (!row) throw new ServiceError('CONFLICT', 'This dispute can no longer be decided: its relationship is gone.');
  if (row.status !== 'in_arbitration') throw new ServiceError('CONFLICT', 'This relationship is no longer in arbitration.');
  if (!input.reason) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { reason: 'Write the reason both parties will read.' });
  if (input.decision === 'needs_info') {
    await askParties(tx, p, c, input, meta);
    await tellDisputeParties(tx, row, c.id, 'needs_info', input.reason, `${c.id}:${input.idempotencyKey}`);
    return NONE;
  }
  const kept = input.decision === 'verify';
  const now = new Date();
  const to = kept ? 'verified' : 'revoked';
  await tx
    .update(teachingRelationship)
    // A revoked link leaves the public lineage (v_public_edge) and is no student's primary line.
    .set({ status: to, statusReason: 'arbitration', ...(kept ? {} : { isDisplayPrimary: false }), updatedAt: now })
    .where(eq(teachingRelationship.id, row.id));
  const eventId = await resolveCase(tx, p, c, input, kept ? 'approved' : 'rejected', meta);
  await recordEvent(tx, { relationshipId: row.id, from: 'in_arbitration', to, actor: p, role: p.user.role, reason: 'arbitration', key: input.idempotencyKey });
  await writeAudit(tx, {
    action: kept ? 'relationship.arbitration' : 'relationship.revoke',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'teaching_relationship',
    subjectId: row.id,
    before: { status: 'in_arbitration', isDisplayPrimary: row.isDisplayPrimary },
    after: { status: to, caseId: c.id, ...(kept ? {} : { isDisplayPrimary: false }) },
    reason: input.reason,
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  await tellDisputeParties(tx, row, c.id, kept ? 'kept' : 'revoked', input.reason, eventId);
  await enqueue(tx, QUEUE.lineageRecompute, { lineageIds: [row.lineageId] });
  return { tags: await publicTags(tx, row) };
}

// --- The dispatcher ----------------------------------------------------------------------------

/** The decision on a case of an M10b kind (see the top of this file). */
export async function decideKind(tx: Transaction, p: Principal, c: CaseRow, row: RelRow | null, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  try {
    switch (c.kind) {
      case 'person_claim':
        return await decidePersonClaim(tx, p, c, row, input, meta);
      case 'instructor_verification':
        return await decideInstructor(tx, p, c, input, meta);
      case 'profile_report':
        return await decideReport(tx, p, c, input, meta);
      case 'relationship_dispute':
        return await decideDispute(tx, p, c, row, input, meta);
      default:
        throw new ServiceError('CONFLICT', 'Cases of this kind are decided elsewhere.');
    }
  } catch (error) {
    // Another account took the record in the meantime (one profile per account).
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint?.startsWith('person_claimed_by')) throw new ServiceError('CONFLICT', 'The claimant has a profile of their own now. Refuse this claim, or ask them about it.');
    throw error;
  }
}
