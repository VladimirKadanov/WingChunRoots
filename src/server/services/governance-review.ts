// The decisions on the governance cases of milestone M25 (docs/adr/0028-governance.md), called by
// review-kinds.ts decideKind once review.decide holds the case (FOR UPDATE), has replayed a repeated
// key and has checked who decides (review-core.ts DECIDERS), the assignment and that the case is
// open. Each writes the case's history (review_event), its audit rows and its notices in the
// caller's transaction.
//
//   succession_request  verify (an administrator; DEFAULT M25, question 1): the nomination is still
//                       accepted and, on inactivity, the owner is still inactive (checked again);
//                       the owner's school listings and organization administration pass to the
//                       successor (DEFAULT M25, question 8; the owner's own organization admin rows
//                       are revoked, pending teacher requests stay with the owner's record);
//                       pending work of those schools and organizations (trial lesson
//                       requests, school link requests) follows them. Nothing else changes: the
//                       owner's record, its life status, students, relationships and history stay.
//                       reject (reason): nothing changes. needs_info: the successor is asked.
//   lineage_report      verify = uphold (reason): the relationship is set in arbitration (shown
//                       neutrally as "Disputed"), both people asked for evidence, not told who
//                       reported; reject = not upheld (reason): nothing changes, and it counts
//                       against no one. needs_info: the reporter is asked.
//   decision_appeal     never by the member of staff who decided the appealed case; only by a
//                       decider of the appealed kind. verify = uphold (reason): the appealed case is
//                       reopened for a new decision (by someone other than the first decider), and
//                       a decided dispute's relationship goes back in arbitration; reject (reason):
//                       the decision stands.
//   record_proposal     verify (an archivist; reason): the proposal is applied to the shared record
//                       (refused if the record changed since in a field it changes) and written to
//                       its change history; reject (reason).
//
// Logs and audit rows carry ids and codes; a reviewer's words stay in the case (plan §6.4).

import { and, eq, isNull, ne } from 'drizzle-orm';

import { writeAudit } from '../audit';
import { hasStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { decisionAppeal, lineageReport, organizationAdmin, recordProposal, reviewCase, school, successionNomination, successionRequest, teachingRelationship } from '../db/schema';
import { SCHOOLS_TAG } from '../cache';
import { enqueue, type Transaction } from '../jobs/outbox';
import { QUEUE } from '../jobs/queues';
import { openArbitration } from './arbitration';
import type { RequestMeta } from './context';
import { appealOfCase } from './disputes';
import { ServiceError } from './errors';
import { notify } from './notify';
import { neighbourTags } from './profile';
import { publicTags, recordEvent, rowById } from './relationships';
import { askParties, type KindDecisionInput, type KindDecisionOutcome, resolveCase, tellDisputeParties } from './review-kinds';
import { type CaseRow, caseById, DECIDERS, ownSide, recordCaseEvent } from './review-core';
import { changedFields, recordRevisionRow, recordState, writeRecordFields } from './stewardship';
import { mayStillSucceed, stillInactive } from './succession';

const NONE: KindDecisionOutcome = { tags: [] };

const needReason = (input: KindDecisionInput, message: string) => {
  if (!input.reason) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { reason: message });
};

/** needs_info: the question goes to the account that opened the case, which is told of it. */
async function askOpener(tx: Transaction, p: Principal, c: CaseRow, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  await askParties(tx, p, c, input, meta);
  if (c.openedByUserId) await notify(tx, c.openedByUserId, 'case.question', { caseId: c.id }, { key: `case-question:${c.id}:${input.idempotencyKey.slice(0, 60)}` });
  return NONE;
}

/**
 * Whether the reviewer is a party of a governance case: the generic parties (review-core.ts
 * ownSide) and, for a lineage report, the two people of the reported relationship, whose case it is
 * about although they are not told of it (DEFAULT M25, question 11).
 */
async function governanceSide(tx: Transaction, p: Principal, c: CaseRow): Promise<boolean> {
  if (await ownSide(tx, p, c)) return true;
  if (c.kind !== 'lineage_report') return false;
  const [r] = await tx.select({ relationshipId: lineageReport.relationshipId }).from(lineageReport).where(eq(lineageReport.reviewCaseId, c.id));
  return r?.relationshipId ? ownSide(tx, p, { kind: 'relationship_dispute', relationshipId: r.relationshipId, openedByUserId: null, personId: null }) : false;
}

/** A key derived from the decision's own key, for a second history row the decision writes. */
const derivedKey = (key: string, suffix: string) => `${key.slice(0, 60)}-${suffix}`;

// --- succession_request ------------------------------------------------------------------------

async function decideSuccession(tx: Transaction, p: Principal, c: CaseRow, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  const [r] = await tx.select().from(successionRequest).where(eq(successionRequest.reviewCaseId, c.id)).for('update');
  if (!r || r.status !== 'pending') throw new ServiceError('CONFLICT', 'This succession request is no longer pending.');
  if (input.decision === 'needs_info') return askOpener(tx, p, c, input, meta);
  needReason(input, 'Write the reason the successor and the owner read.');
  const [n] = await tx.select().from(successionNomination).where(eq(successionNomination.id, r.nominationId)).for('update');
  const now = new Date();
  if (input.decision === 'reject') {
    await tx.update(successionRequest).set({ status: 'rejected', decidedAt: now, updatedAt: now }).where(eq(successionRequest.id, r.id));
    await resolveCase(tx, p, c, input, 'rejected', meta);
    await writeAudit(tx, {
      action: 'succession.decide',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'succession_request',
      subjectId: r.id,
      after: { outcome: 'rejected', basis: r.basis, caseId: c.id },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    if (r.requesterUserId) await notify(tx, r.requesterUserId, 'succession.decided', { caseId: c.id, decision: 'rejected', role: 'successor' }, { key: `succession-decided:${c.id}:${now.getTime()}` });
    if (r.ownerUserId) await notify(tx, r.ownerUserId, 'succession.decided', { caseId: c.id, decision: 'rejected', role: 'owner' }, { key: `succession-decided-owner:${c.id}:${now.getTime()}` });
    return NONE;
  }
  if (!n || n.status !== 'accepted' || !r.ownerUserId || !r.requesterUserId) throw new ServiceError('CONFLICT', 'The nomination is no longer in force: refuse this request.');
  // The successor must still hold a plan that may succeed, and not be banned (DEFAULT M25, question 2).
  if (!(await mayStillSucceed(tx, r.requesterUserId))) {
    throw new ServiceError('CONFLICT', 'The successor no longer holds Premium Student or Professional Sifu, or the account is suspended: refuse this request with a reason.');
  }
  // Inactivity is checked again: an owner who came back stops the transfer.
  if (r.basis === 'inactivity' && !(await stillInactive(tx, r.ownerUserId))) {
    throw new ServiceError('CONFLICT', 'The owner’s account has been active again since the request: an inactivity request cannot be approved. Refuse it with a reason.');
  }
  // The transfer: the school listings and the organization administration, nothing else.
  const schools = await tx
    .update(school)
    .set({ createdByUserId: r.requesterUserId, updatedAt: now })
    .where(and(eq(school.createdByUserId, r.ownerUserId), isNull(school.deletedAt)))
    .returning({ id: school.id });
  const admins = await tx
    .select({ id: organizationAdmin.id, organizationId: organizationAdmin.organizationId, role: organizationAdmin.role })
    .from(organizationAdmin)
    .where(and(eq(organizationAdmin.userId, r.ownerUserId), isNull(organizationAdmin.revokedAt)))
    .for('update');
  for (const a of admins) {
    const [held] = await tx
      .select({ id: organizationAdmin.id, role: organizationAdmin.role })
      .from(organizationAdmin)
      .where(and(eq(organizationAdmin.organizationId, a.organizationId), eq(organizationAdmin.userId, r.requesterUserId), isNull(organizationAdmin.revokedAt)))
      .for('update');
    if (!held) await tx.insert(organizationAdmin).values({ organizationId: a.organizationId, userId: r.requesterUserId, role: a.role, grantedByUserId: p.user.id });
    else if (a.role === 'owner' && held.role !== 'owner') await tx.update(organizationAdmin).set({ role: 'owner', updatedAt: now }).where(eq(organizationAdmin.id, held.id));
    await tx.update(organizationAdmin).set({ revokedAt: now, revokedByUserId: p.user.id, updatedAt: now }).where(eq(organizationAdmin.id, a.id));
  }
  const transferred = { schoolIds: schools.map((s) => s.id), organizationIds: [...new Set(admins.map((a) => a.organizationId))] };
  await tx.update(successionRequest).set({ status: 'approved', decidedAt: now, transferred, updatedAt: now }).where(eq(successionRequest.id, r.id));
  await resolveCase(tx, p, c, input, 'approved', meta);
  await writeAudit(tx, {
    action: 'succession.transfer',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'succession_request',
    subjectId: r.id,
    before: { ownerUserId: r.ownerUserId, basis: r.basis, inactiveDays: r.inactiveDays },
    after: { successorUserId: r.requesterUserId, ...transferred, lifeStatusChanged: false, caseId: c.id },
    reason: input.reason,
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  await notify(tx, r.requesterUserId, 'succession.decided', { caseId: c.id, decision: 'approved', role: 'successor' }, { key: `succession-decided:${c.id}:${now.getTime()}` });
  await notify(tx, r.ownerUserId, 'succession.decided', { caseId: c.id, decision: 'approved', role: 'owner' }, { key: `succession-decided-owner:${c.id}:${now.getTime()}` });
  // A school's pin follows its listing account's plan (v_public_school): the public lists change.
  return { tags: schools.length > 0 ? [SCHOOLS_TAG] : [] };
}

// --- lineage_report ----------------------------------------------------------------------------

async function decideLineageReport(tx: Transaction, p: Principal, c: CaseRow, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  const [r] = await tx.select().from(lineageReport).where(eq(lineageReport.reviewCaseId, c.id)).for('update');
  if (!r || r.status !== 'open') throw new ServiceError('CONFLICT', 'This report has been decided.');
  if (await governanceSide(tx, p, c)) throw new ServiceError('FORBIDDEN', 'This relationship is yours: another moderator or an administrator decides the report.');
  if (input.decision === 'needs_info') return askOpener(tx, p, c, input, meta);
  needReason(input, 'Write the reason the reporter reads.');
  const now = new Date();
  if (input.decision === 'reject') {
    // Not upheld: nothing changes, and nothing is held against the reporter.
    await tx.update(lineageReport).set({ status: 'not_upheld', updatedAt: now }).where(eq(lineageReport.id, r.id));
    await resolveCase(tx, p, c, input, 'rejected', meta);
    await writeAudit(tx, {
      action: 'dispute.decide',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'review_case',
      subjectId: c.id,
      after: { outcome: 'not_upheld', relationshipId: r.relationshipId },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    if (r.reporterUserId) await notify(tx, r.reporterUserId, 'dispute.decided', { caseId: c.id, outcome: 'not_upheld' }, { key: `dispute-decided:${c.id}:${now.getTime()}` });
    return NONE;
  }
  // Uphold: the relationship goes in arbitration, as review.arbitrate does it.
  const row = r.relationshipId ? await rowById(tx, r.relationshipId, true) : null;
  if (!row) throw new ServiceError('CONFLICT', 'The relationship is gone: this report can only be not upheld.');
  let disputeCaseId: string | null = null;
  if (row.status === 'verified') disputeCaseId = await openArbitration(tx, p, row, input.reason!, derivedKey(input.idempotencyKey, 'arb'), meta);
  else if (row.status !== 'in_arbitration') throw new ServiceError('CONFLICT', 'The relationship is no longer verified: this report can only be not upheld.');
  await tx.update(lineageReport).set({ status: 'upheld', updatedAt: now }).where(eq(lineageReport.id, r.id));
  await resolveCase(tx, p, c, input, 'approved', meta);
  await writeAudit(tx, {
    action: 'dispute.decide',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'review_case',
    subjectId: c.id,
    after: { outcome: 'upheld', relationshipId: row.id, disputeCaseId },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  if (r.reporterUserId) await notify(tx, r.reporterUserId, 'dispute.decided', { caseId: c.id, outcome: 'upheld' }, { key: `dispute-decided:${c.id}:${now.getTime()}` });
  return { tags: disputeCaseId ? await publicTags(tx, row) : [] };
}

// --- decision_appeal ---------------------------------------------------------------------------

/** The roles that decide an appeal of a case of `kind`: its own deciders (review-core.ts DECIDERS). */
export function appealDeciders(kind: CaseRow['kind']) {
  return kind === 'deletion_request' || kind === 'decision_appeal' ? (['admin'] as const) : DECIDERS[kind];
}

async function decideAppeal(tx: Transaction, p: Principal, c: CaseRow, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  const a = await appealOfCase(tx, c.id, true);
  if (!a || a.status !== 'pending') throw new ServiceError('CONFLICT', 'This appeal has been decided.');
  if (a.originalDeciderUserId === p.user.id) throw new ServiceError('FORBIDDEN', 'You decided the appealed case: another member of staff decides its appeal.');
  if (!hasStaff2FA(p, appealDeciders(a.appealedKind))) throw new ServiceError('FORBIDDEN', 'The deciders of the appealed kind decide its appeal.');
  // Nobody decides an appeal of a case in which they are a party (the other side of a dispute, the
  // owner of a succession request, the people of a reported relationship).
  const appealedCase = await caseById(tx, a.appealedCaseId, false);
  if (appealedCase && (await governanceSide(tx, p, appealedCase))) throw new ServiceError('FORBIDDEN', 'You are a party of the appealed case: another member of staff decides its appeal.');
  if (input.decision === 'needs_info') return askOpener(tx, p, c, input, meta);
  needReason(input, 'Write the reason the party who appealed reads.');
  const now = new Date();
  const appellant = (await tx.select({ id: reviewCase.openedByUserId }).from(reviewCase).where(eq(reviewCase.id, c.id)))[0]?.id ?? null;
  if (input.decision === 'reject') {
    await tx.update(decisionAppeal).set({ status: 'rejected', updatedAt: now }).where(eq(decisionAppeal.id, a.id));
    await resolveCase(tx, p, c, input, 'rejected', meta);
    await writeAudit(tx, { action: 'appeal.decide', actorUserId: p.user.id, actorRole: p.user.role, subjectType: 'review_case', subjectId: a.appealedCaseId, after: { outcome: 'rejected', appealCaseId: c.id }, requestId: meta.requestId, ipHmac: meta.ipHmac });
    if (appellant) await notify(tx, appellant, 'appeal.decided', { caseId: c.id, outcome: 'rejected' }, { key: `appeal-decided:${c.id}` });
    return NONE;
  }
  // Uphold: reopen the appealed case. The relationship first (the lock order of review-core.ts).
  const [peek] = await tx.select({ relationshipId: reviewCase.relationshipId }).from(reviewCase).where(eq(reviewCase.id, a.appealedCaseId));
  const row = peek?.relationshipId ? await rowById(tx, peek.relationshipId, true) : null;
  const appealed = await caseById(tx, a.appealedCaseId, true);
  if (!appealed || appealed.status !== 'resolved') throw new ServiceError('CONFLICT', 'The appealed case is no longer decided.');
  let tags: string[] = [];
  if (a.appealedKind === 'relationship_dispute') {
    if (!row) throw new ServiceError('CONFLICT', 'The relationship is gone: this appeal can only be rejected.');
    if (row.status !== 'verified' && row.status !== 'revoked') throw new ServiceError('CONFLICT', 'The relationship has changed since the decision: this appeal can only be rejected.');
    await tx.update(teachingRelationship).set({ status: 'in_arbitration', statusReason: 'appeal', updatedAt: now }).where(eq(teachingRelationship.id, row.id));
    await recordEvent(tx, { relationshipId: row.id, from: row.status, to: 'in_arbitration', actor: p, role: p.user.role, reason: 'appeal', key: derivedKey(input.idempotencyKey, 'rel') });
    await enqueue(tx, QUEUE.lineageRecompute, { lineageIds: [row.lineageId] });
    tags = await publicTags(tx, row);
  } else if (a.appealedKind === 'lineage_report') {
    const [r] = await tx.select({ id: lineageReport.id, relationshipId: lineageReport.relationshipId, reporterUserId: lineageReport.reporterUserId }).from(lineageReport).where(eq(lineageReport.reviewCaseId, appealed.id)).for('update');
    if (!r) throw new ServiceError('CONFLICT', 'The report is gone: this appeal can only be rejected.');
    if (r.relationshipId && r.reporterUserId) {
      const [open] = await tx.select({ id: lineageReport.id }).from(lineageReport).where(and(eq(lineageReport.relationshipId, r.relationshipId), eq(lineageReport.reporterUserId, r.reporterUserId), eq(lineageReport.status, 'open'), ne(lineageReport.id, r.id)));
      if (open) throw new ServiceError('CONFLICT', 'The same member has a newer open report of this relationship: decide that one, and reject this appeal.');
    }
    await tx.update(lineageReport).set({ status: 'open', updatedAt: now }).where(eq(lineageReport.id, r.id));
  } else if (a.appealedKind === 'succession_request') {
    const [r] = await tx.select({ id: successionRequest.id, nominationId: successionRequest.nominationId }).from(successionRequest).where(eq(successionRequest.reviewCaseId, appealed.id)).for('update');
    const [n] = r ? await tx.select({ status: successionNomination.status }).from(successionNomination).where(eq(successionNomination.id, r.nominationId)) : [];
    if (!r || n?.status !== 'accepted') throw new ServiceError('CONFLICT', 'The nomination is no longer in force: this appeal can only be rejected.');
    const [pending] = await tx.select({ id: successionRequest.id }).from(successionRequest).where(and(eq(successionRequest.nominationId, r.nominationId), eq(successionRequest.status, 'pending')));
    if (pending) throw new ServiceError('CONFLICT', 'A newer succession request on this nomination is pending: decide that one, and reject this appeal.');
    await tx.update(successionRequest).set({ status: 'pending', decidedAt: null, updatedAt: now }).where(eq(successionRequest.id, r.id));
  } else {
    const [proposal] = await tx.select({ id: recordProposal.id, personId: recordProposal.personId, proposerUserId: recordProposal.proposerUserId }).from(recordProposal).where(eq(recordProposal.reviewCaseId, appealed.id)).for('update');
    if (!proposal) throw new ServiceError('CONFLICT', 'The proposal is gone: this appeal can only be rejected.');
    if (proposal.proposerUserId) {
      const [pending] = await tx.select({ id: recordProposal.id }).from(recordProposal).where(and(eq(recordProposal.personId, proposal.personId), eq(recordProposal.proposerUserId, proposal.proposerUserId), eq(recordProposal.status, 'pending'), ne(recordProposal.id, proposal.id)));
      if (pending) throw new ServiceError('CONFLICT', 'The same member has a newer pending proposal for this record: decide that one, and reject this appeal.');
    }
    await tx.update(recordProposal).set({ status: 'pending', updatedAt: now }).where(eq(recordProposal.id, proposal.id));
  }
  // The reopened case waits for a decider other than the first one (review.ts decideOtherKind).
  const reopenedStatus = a.appealedKind === 'relationship_dispute' ? 'needs_info' : 'open';
  await tx
    .update(reviewCase)
    .set({ status: reopenedStatus, resolution: null, resolutionReason: null, resolvedAt: null, assignedToUserId: null, updatedAt: now })
    .where(eq(reviewCase.id, appealed.id));
  const eventId = await recordCaseEvent(tx, { caseId: appealed.id, action: 'reopen', from: 'resolved', to: reopenedStatus, actor: p, key: derivedKey(input.idempotencyKey, 'reopen') });
  await tx.update(decisionAppeal).set({ status: 'upheld', updatedAt: now }).where(eq(decisionAppeal.id, a.id));
  await resolveCase(tx, p, c, input, 'approved', meta);
  await writeAudit(tx, {
    action: 'appeal.decide',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'review_case',
    subjectId: a.appealedCaseId,
    before: { status: 'resolved', resolution: appealed.resolution },
    after: { outcome: 'upheld', status: reopenedStatus, appealCaseId: c.id, ...(row ? { relationshipId: row.id } : {}) },
    reason: input.reason,
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  if (appellant) await notify(tx, appellant, 'appeal.decided', { caseId: c.id, outcome: 'upheld' }, { key: `appeal-decided:${c.id}` });
  if (row && a.appealedKind === 'relationship_dispute') {
    await tellDisputeParties(tx, row, appealed.id, 'needs_info', `The decision was reopened on appeal. ${input.reason}`, eventId);
  }
  return { tags };
}


// --- record_proposal ---------------------------------------------------------------------------

async function decideProposal(tx: Transaction, p: Principal, c: CaseRow, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  const [proposal] = await tx.select().from(recordProposal).where(eq(recordProposal.reviewCaseId, c.id)).for('update');
  if (!proposal || proposal.status !== 'pending') throw new ServiceError('CONFLICT', 'This proposal has been decided.');
  if (input.decision === 'needs_info') return askOpener(tx, p, c, input, meta);
  needReason(input, 'Write the reason the proposer reads; it is kept in the record’s change history.');
  const now = new Date();
  if (input.decision === 'reject') {
    await tx.update(recordProposal).set({ status: 'rejected', updatedAt: now }).where(eq(recordProposal.id, proposal.id));
    await resolveCase(tx, p, c, input, 'rejected', meta);
    await writeAudit(tx, { action: 'record.decide', actorUserId: p.user.id, actorRole: p.user.role, subjectType: 'person', subjectId: proposal.personId, after: { outcome: 'rejected', caseId: c.id }, requestId: meta.requestId, ipHmac: meta.ipHmac });
    if (proposal.proposerUserId) await notify(tx, proposal.proposerUserId, 'proposal.decided', { caseId: c.id, decision: 'rejected' }, { key: `proposal-decided:${c.id}:${now.getTime()}` });
    return NONE;
  }
  const state = await recordState(tx, { id: proposal.personId }, true);
  if (!state) throw new ServiceError('CONFLICT', 'The record is gone: refuse this proposal.');
  if (state.stewardship === 'self') throw new ServiceError('CONFLICT', 'The record is kept by its owner now: refuse this proposal.');
  const proposed = changedFields(proposal.base, proposal.proposed);
  const since = changedFields(proposal.base, state.fields);
  if (since.some((f) => proposed.includes(f))) throw new ServiceError('CONFLICT', 'The record changed since the proposal in a field it changes. Refuse it with a reason, or ask for a new proposal.');
  // Only the fields the proposal changes; the others keep what the record says now.
  const next = { ...state.fields };
  for (const f of proposed) {
    if (f === 'originalName') {
      next.originalName = proposal.proposed.originalName;
      next.originalLang = proposal.proposed.originalLang;
    } else (next as Record<string, unknown>)[f] = proposal.proposed[f];
  }
  const written = await writeRecordFields(tx, state, next);
  if (written.changed.length > 0) {
    await recordRevisionRow(tx, { personId: state.id, source: 'proposal', actorUserId: p.user.id, reviewCaseId: c.id, changed: written.changed, before: state.fields, after: next, reason: input.reason! });
  }
  await tx.update(recordProposal).set({ status: 'approved', updatedAt: now }).where(eq(recordProposal.id, proposal.id));
  await resolveCase(tx, p, c, input, 'approved', meta);
  await writeAudit(tx, {
    action: 'person.update',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'person',
    subjectId: state.id,
    before: { lifeStatus: state.fields.lifeStatus, stewardship: state.stewardship },
    after: { archival: true, proposal: c.id, changed: written.changed, lifeStatus: next.lifeStatus, ...(written.searchKeys !== null ? { searchKeys: written.searchKeys } : {}) },
    reason: input.reason,
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  if (proposal.proposerUserId) await notify(tx, proposal.proposerUserId, 'proposal.decided', { caseId: c.id, decision: 'approved' }, { key: `proposal-decided:${c.id}:${now.getTime()}` });
  return { tags: await neighbourTags(tx, state.id) };
}

// --- The dispatcher ----------------------------------------------------------------------------

export const GOVERNANCE_KINDS: ReadonlySet<CaseRow['kind']> = new Set(['succession_request', 'lineage_report', 'decision_appeal', 'record_proposal']);

/** The decision on a governance case (see the top of this file). */
export async function decideGovernanceKind(tx: Transaction, p: Principal, c: CaseRow, input: KindDecisionInput, meta: RequestMeta): Promise<KindDecisionOutcome> {
  switch (c.kind) {
    case 'succession_request':
      return decideSuccession(tx, p, c, input, meta);
    case 'lineage_report':
      return decideLineageReport(tx, p, c, input, meta);
    case 'decision_appeal':
      return decideAppeal(tx, p, c, input, meta);
    case 'record_proposal':
      return decideProposal(tx, p, c, input, meta);
    default:
      throw new ServiceError('CONFLICT', 'Cases of this kind are decided elsewhere.');
  }
}

