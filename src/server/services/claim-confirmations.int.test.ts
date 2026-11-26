// "Ask the teacher to confirm" (role replay 2026-11-25, P3-8, ADR 0067), against a migrated
// throwaway database:
//   - the case card of a profile claim lists the record's verified teachers with an account (never
//     the claimant, never a teacher without an account or a link that is not verified);
//   - the reviewer who may ask the claimant asks one teacher once; the teacher is told; asking again
//     changes nothing; anyone else may not ask;
//   - the teacher reads their student's name and nothing of the claimant; anyone else gets 404;
//   - the teacher answers once (the same answer again is a replay); the assigned reviewer is told;
//     the reviewers read the answer and the note on the case; a closed case takes no answer;
//   - the audit rows carry ids only.
// Fictional data only (D20): demo- slugs, example.test addresses.

import { randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, notification, person, personName, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { answerClaimConfirmation, askTeacherToConfirm, getClaimConfirmation } from './claim-confirmations';
import { grantConsents, REQUIRED_SIGN_UP_CONSENTS } from './consent';
import { requestProfileClaim } from './profile-claims';
import { assignReviewCase, decideReviewCase, getReviewCase } from './review';
import { key, member, meta, newLineage, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { code?: string } | null;
  return error?.code ?? 'OK';
}

/** A public, unclaimed record of a living person, its verified teacher with an account, a teacher without one, and a claim by a newcomer. */
async function claimOfTaughtRecord(label: string) {
  const db = getDb();
  const recordId = uuidv7();
  await db.insert(person).values({ id: recordId, slug: `demo-asked-${label}-${randomBytes(4).toString('hex')}`, kind: 'living', lifeStatus: 'living', stewardship: 'unclaimed', visibility: 'public' });
  await db.insert(personName).values({ personId: recordId, value: 'Demo Asked Student', script: 'Latn', lang: 'en', isPrimary: true });
  const teacher = await member(`asked-teacher-${label}`, { sifu: true });
  const lineageId = await newLineage('p3-8');
  const [verified] = await db
    .insert(teachingRelationship)
    .values({ teacherPersonId: teacher.personId, studentPersonId: recordId, lineageId, status: 'verified', visibility: 'public' })
    .returning({ id: teachingRelationship.id });
  // A teacher record nobody claimed, and a link still waiting: neither is offered.
  const unclaimedTeacher = uuidv7();
  await db.insert(person).values({ id: unclaimedTeacher, slug: `demo-asked-unclaimed-${randomBytes(4).toString('hex')}`, kind: 'living', lifeStatus: 'living', stewardship: 'unclaimed', visibility: 'public' });
  await db.insert(personName).values({ personId: unclaimedTeacher, value: 'Demo Unclaimed Teacher', script: 'Latn', lang: 'en', isPrimary: true });
  await db.insert(teachingRelationship).values({ teacherPersonId: unclaimedTeacher, studentPersonId: recordId, lineageId: await newLineage('p3-8'), status: 'verified', visibility: 'public' });
  const pendingTeacher = await member(`asked-pending-${label}`, { sifu: true });
  await db.insert(teachingRelationship).values({ teacherPersonId: pendingTeacher.personId, studentPersonId: recordId, lineageId: await newLineage('p3-8'), status: 'pending_teacher', visibility: 'involved_only' });
  const claimant = await member(`asked-claimant-${label}`);
  await db.delete(person).where(eq(person.id, claimant.personId));
  await db.transaction((tx) => grantConsents(tx, claimant.account.id, 'user', REQUIRED_SIGN_UP_CONSENTS, meta));
  const claim = await requestProfileClaim(claimant.principal, { personId: recordId, note: 'A fictional note for the reviewers.', idempotencyKey: key() }, meta);
  return { recordId, teacher, claimant, pendingTeacher, caseId: claim.caseId, relationshipId: verified!.id };
}

describe('asking the teacher of a claimed record', () => {
  it('lists the verified teachers with an account; the assigned archivist asks once, and the teacher is told', async () => {
    const c = await claimOfTaughtRecord('ask');
    const archivist = await staff(`p3-8-archivist-${randomBytes(3).toString('hex')}`, 'archivist');
    const moderator = await staff(`p3-8-moderator-${randomBytes(3).toString('hex')}`, 'moderator');

    const before = await getReviewCase(archivist.principal, { id: c.caseId });
    expect(before.confirmations.map((t) => [t.relationshipId, t.teacher.id, t.ask])).toEqual([[c.relationshipId, c.teacher.personId, null]]);
    // Not assigned yet: the card shows the teacher, but no button.
    expect(before.can.askTeacher).toBe(false);
    expect(await refusal(askTeacherToConfirm(archivist.principal, { caseId: c.caseId, relationshipId: c.relationshipId }, meta))).toBe('FORBIDDEN');
    expect(await refusal(askTeacherToConfirm(moderator.principal, { caseId: c.caseId, relationshipId: c.relationshipId }, meta))).toBe('FORBIDDEN');
    expect(await refusal(askTeacherToConfirm(c.claimant.principal, { caseId: c.caseId, relationshipId: c.relationshipId }, meta))).toBe('FORBIDDEN');

    await assignReviewCase(archivist.principal, { caseId: c.caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
    expect((await getReviewCase(archivist.principal, { id: c.caseId })).can.askTeacher).toBe(true);
    // Only a teacher the card offers.
    const [pending] = await getDb().select({ id: teachingRelationship.id }).from(teachingRelationship).where(eq(teachingRelationship.teacherPersonId, c.pendingTeacher.personId));
    expect(await refusal(askTeacherToConfirm(archivist.principal, { caseId: c.caseId, relationshipId: pending!.id }, meta))).toBe('BAD_REQUEST');

    const asked = await askTeacherToConfirm(archivist.principal, { caseId: c.caseId, relationshipId: c.relationshipId }, meta);
    expect(asked.replayed).toBe(false);
    expect(await askTeacherToConfirm(archivist.principal, { caseId: c.caseId, relationshipId: c.relationshipId }, meta)).toEqual({ id: asked.id, replayed: true });
    const notices = await getDb().select().from(notification).where(and(eq(notification.userId, c.teacher.account.id), eq(notification.template, 'claim.confirmation_asked')));
    expect(notices.map((n) => n.payload)).toEqual([{ confirmationId: asked.id }]);
    const after = await getReviewCase(archivist.principal, { id: c.caseId });
    expect(after.confirmations[0]!.ask).toMatchObject({ id: asked.id, answer: null, answeredAt: null });

    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'review.ask_teacher'), eq(auditLog.subjectId, c.caseId)));
    expect(audit!.after).toEqual({ confirmationId: asked.id, relationshipId: c.relationshipId });
  });

  it('the teacher reads their student and nothing of the claimant, answers once, and the assigned reviewer is told', async () => {
    const c = await claimOfTaughtRecord('answer');
    const archivist = await staff(`p3-8-archivist-${randomBytes(3).toString('hex')}`, 'archivist');
    await assignReviewCase(archivist.principal, { caseId: c.caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
    const { id } = await askTeacherToConfirm(archivist.principal, { caseId: c.caseId, relationshipId: c.relationshipId }, meta);

    const view = await getClaimConfirmation(c.teacher.principal, { id });
    expect(view).toMatchObject({ id, open: true, answer: null, student: { id: c.recordId, name: { value: 'Demo Asked Student' } } });
    expect(JSON.stringify(view)).not.toContain(c.claimant.account.email);
    expect(JSON.stringify(view)).not.toContain(c.claimant.account.id);
    for (const other of [c.claimant.principal, archivist.principal, c.pendingTeacher.principal]) expect(await refusal(getClaimConfirmation(other, { id }))).toBe('NOT_FOUND');
    expect(await refusal(answerClaimConfirmation(c.claimant.principal, { id, answer: 'yes' }, meta))).toBe('NOT_FOUND');
    expect(await refusal(answerClaimConfirmation(c.teacher.principal, { id, answer: 'maybe' as 'yes' }, meta))).toBe('BAD_REQUEST');

    const answered = await answerClaimConfirmation(c.teacher.principal, { id, answer: 'yes', note: 'They told me after class.' }, meta);
    expect(answered).toMatchObject({ replayed: false, confirmation: { answer: 'yes', answerLabel: 'Yes, it is my student', note: 'They told me after class.' } });
    expect((await answerClaimConfirmation(c.teacher.principal, { id, answer: 'yes', note: 'They told me after class.' }, meta)).replayed).toBe(true);
    expect(await refusal(answerClaimConfirmation(c.teacher.principal, { id, answer: 'no' }, meta))).toBe('CONFLICT');

    const told = await getDb().select().from(notification).where(and(eq(notification.userId, archivist.account.id), eq(notification.template, 'review.updated')));
    expect(told.map((n) => n.payload)).toContainEqual({ caseId: c.caseId, change: 'confirmation' });
    const card = await getReviewCase(archivist.principal, { id: c.caseId });
    expect(card.confirmations[0]!.ask).toMatchObject({ answer: 'yes', note: 'They told me after class.' });
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'claim_confirmation.answer'), eq(auditLog.subjectId, c.caseId)));
    expect(audit!.after).toEqual({ confirmationId: id, answer: 'yes', noteLength: 25 });
  });

  it('a decided case takes no answer, and its card offers no more asks', async () => {
    const c = await claimOfTaughtRecord('closed');
    const archivist = await staff(`p3-8-archivist-${randomBytes(3).toString('hex')}`, 'archivist');
    await assignReviewCase(archivist.principal, { caseId: c.caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
    const { id } = await askTeacherToConfirm(archivist.principal, { caseId: c.caseId, relationshipId: c.relationshipId }, meta);
    await decideReviewCase(archivist.principal, { caseId: c.caseId, decision: 'reject', reason: 'The evidence does not show it (fictional).', idempotencyKey: key() }, meta);
    expect((await getClaimConfirmation(c.teacher.principal, { id })).open).toBe(false);
    expect(await refusal(answerClaimConfirmation(c.teacher.principal, { id, answer: 'yes' }, meta))).toBe('CONFLICT');
    expect((await getReviewCase(archivist.principal, { id: c.caseId })).can.askTeacher).toBe(false);
  });
});
