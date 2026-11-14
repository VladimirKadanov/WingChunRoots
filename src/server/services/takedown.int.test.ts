// A staff take-down of a profile and its restore (review 2026-11; docs/adr/0030-takedown-
// suspension-erasure.md), against a migrated throwaway database: who may do it, that it works for a
// self-kept profile and for an unclaimed, archive-kept or historical record, that every public
// surface leaves the record out and nothing can publish it while it is held, that the owner is told
// and the audit rows carry shapes only, and that an upheld report can take the profile down.
// Fictional data only (D20).

import { randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, consentRecord, contentReport, notification, person, personName, reviewNote, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { personProfile } from './lineage';
import { consentWithdraw } from './privacy';
import { profileUpdate } from './profile';
import { approveRelationship, requestTeacher } from './relationships';
import { key, member, meta, newLineage, ongoingFrom, staff } from './relationships.test-support';
import { reportProfile } from './reports';
import { assignReviewCase, decideReviewCase, getArchiveRecord, getReviewCase } from './review';
import { restoreProfile, takeDownProfile } from './takedown';

// The tags the public cache is told to drop (src/server/cache.ts calls revalidateTag).
const dropped = vi.hoisted(() => ({ tags: [] as string[] }));
vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: (tag: string) => void dropped.tags.push(tag),
  updateTag: (tag: string) => void dropped.tags.push(tag),
}));

let testDb: TestDatabase | undefined;
beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});
afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});
beforeEach(() => {
  dropped.tags.length = 0;
});

const REASON = 'The photo and the biography do not match the person named.';

const publicIds = async (...ids: string[]) =>
  (await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM v_public_person WHERE id = ANY (${sql.raw(`ARRAY[${ids.map((i) => `'${i}'::uuid`).join(',')}]`)})`)).rows.map((r) => r.id);

const rowOf = async (personId: string) => (await getDb().select().from(person).where(eq(person.id, personId)))[0]!;

async function kept(label: string, stewardship: 'platform' | 'unclaimed', kind: 'living' | 'historical' = 'historical') {
  const id = uuidv7();
  const slug = `demo-${label}-${randomBytes(4).toString('hex')}`;
  await getDb().insert(person).values({ id, slug, kind, stewardship, visibility: 'public', lifeStatus: kind === 'historical' ? 'deceased' : 'living' });
  await getDb().insert(personName).values({ personId: id, value: `Demo ${label}`, script: 'Latn', lang: 'en', isPrimary: true });
  return { id, slug };
}

describe('take down and restore', () => {
  it('takes a self-kept profile off every public surface, tells the owner, audits shapes, and restores it', async () => {
    const owner = await member('takedown-owner');
    const moderator = await staff('takedown-mod', 'moderator');
    expect(await publicIds(owner.personId)).toEqual([owner.personId]);
    await expect(personProfile(null, { slug: owner.slug })).resolves.toBeDefined();

    const result = await takeDownProfile(moderator.principal, { personId: owner.personId, reason: REASON }, meta);
    expect(result).toEqual({ personId: owner.personId, slug: owner.slug, takenDown: true, visibility: 'involved_only', changed: true });
    const held = await rowOf(owner.personId);
    expect(held).toMatchObject({ visibility: 'involved_only', takenDownVisibility: 'public', takenDownReason: REASON });
    expect(held.takenDownAt).toBeInstanceOf(Date);

    // Gone from the public view and from the public profile; the owner and the staff still open it.
    expect(await publicIds(owner.personId)).toEqual([]);
    await expect(personProfile(null, { slug: owner.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const stranger = await member('takedown-stranger');
    await expect(personProfile(stranger.principal, { slug: owner.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(personProfile(owner.principal, { slug: owner.slug })).resolves.toBeDefined();
    await expect(personProfile(moderator.principal, { slug: owner.slug })).resolves.toBeDefined();
    // The public cache is told: the person and the lists that show people.
    expect(dropped.tags).toEqual(expect.arrayContaining([`person:${owner.personId}`, 'schools', 'events', 'organizations', 'explore-start']));

    // The owner is told, with the reason; the staff member is not named.
    const notices = await getDb().select().from(notification).where(and(eq(notification.userId, owner.account.id), eq(notification.template, 'profile.taken-down')));
    expect(notices).toHaveLength(1);
    expect(notices[0]!.payload).toEqual({ reason: REASON });

    // The audit row: ids and shapes, the reason in its own column.
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'person.takedown'), eq(auditLog.subjectId, owner.personId)));
    expect(audit).toMatchObject({ actorUserId: moderator.account.id, actorRole: 'moderator', subjectType: 'person', reason: REASON });
    expect(audit!.before).toEqual({ visibility: 'public' });
    expect(audit!.after).toEqual({ visibility: 'involved_only', held: true, stewardship: 'self', caseId: null });
    expect(JSON.stringify([audit!.before, audit!.after])).not.toContain('Demo');

    // Asking again changes nothing and writes nothing.
    const again = await takeDownProfile(moderator.principal, { personId: owner.personId, reason: REASON }, meta);
    expect(again.changed).toBe(false);
    expect(await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'person.takedown'), eq(auditLog.subjectId, owner.personId)))).toHaveLength(1);

    // The restore returns it to what it was, tells the owner and audits it.
    dropped.tags.length = 0;
    const admin = await staff('takedown-admin', 'admin');
    const restored = await restoreProfile(admin.principal, { personId: owner.personId, reason: 'The report was a mistake.' }, meta);
    expect(restored).toEqual({ personId: owner.personId, slug: owner.slug, takenDown: false, visibility: 'public', changed: true });
    expect(await rowOf(owner.personId)).toMatchObject({ visibility: 'public', takenDownAt: null, takenDownReason: null, takenDownVisibility: null });
    expect(await publicIds(owner.personId)).toEqual([owner.personId]);
    expect(dropped.tags).toContain(`person:${owner.personId}`);
    expect(await getDb().select().from(notification).where(and(eq(notification.userId, owner.account.id), eq(notification.template, 'profile.restored')))).toHaveLength(1);
    const [restoreAudit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'person.restore'), eq(auditLog.subjectId, owner.personId)));
    expect(restoreAudit).toMatchObject({ actorUserId: admin.account.id, reason: 'The report was a mistake.' });
    expect((await restoreProfile(admin.principal, { personId: owner.personId, reason: 'Again.' }, meta)).changed).toBe(false);
  });

  it.each([
    ['an unclaimed living record', 'unclaimed', 'living'],
    ['an archive-kept historical record', 'platform', 'historical'],
    ['an unclaimed historical record', 'unclaimed', 'historical'],
  ] as const)('works for %s, with nobody to tell', async (_label, stewardship, kind) => {
    const record = await kept('kept-record', stewardship, kind);
    const moderator = await staff('kept-mod', 'moderator');
    await takeDownProfile(moderator.principal, { personId: record.id, reason: REASON }, meta);
    expect(await publicIds(record.id)).toEqual([]);
    await expect(personProfile(null, { slug: record.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await rowOf(record.id)).takenDownVisibility).toBe('public');
    await restoreProfile(moderator.principal, { personId: record.id, reason: 'Checked against the evidence.' }, meta);
    expect(await publicIds(record.id)).toEqual([record.id]);
    await expect(personProfile(null, { slug: record.slug })).resolves.toBeDefined();
    // A record without an account tells nobody: no notice carries this record's id or reason.
    expect(await getDb().select().from(notification).where(sql`${notification.template} IN ('profile.taken-down', 'profile.restored') AND ${notification.payload}->>'reason' = ${REASON} AND ${notification.userId} IN (SELECT claimed_by_user_id FROM person WHERE id = ${record.id})`)).toHaveLength(0);
  });

  it('is for a moderator or an administrator with a verified second factor, with a reason, on a record that is not their own', async () => {
    const target = await member('takedown-target');
    const archivist = await staff('takedown-arch', 'archivist');
    const unverified = await staff('takedown-unverified', 'moderator', { unverified: true });
    const moderator = await staff('takedown-mod2', 'moderator');
    const input = { personId: target.personId, reason: REASON };
    await expect(takeDownProfile(null, input, meta)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(takeDownProfile(target.principal, input, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(takeDownProfile(archivist.principal, input, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(takeDownProfile(unverified.principal, input, meta)).rejects.toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });
    await expect(takeDownProfile(moderator.principal, { personId: target.personId, reason: '   ' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { reason: expect.any(String) } });
    await expect(takeDownProfile(moderator.principal, { personId: target.personId, reason: 'x'.repeat(501) }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(takeDownProfile(moderator.principal, { personId: uuidv7(), reason: REASON }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Nothing was changed by any refusal.
    expect((await rowOf(target.personId)).takenDownAt).toBeNull();
    // A member of staff does not handle their own record.
    const own = await member('takedown-own-staff', { role: 'moderator' });
    await expect(takeDownProfile(own.principal, { personId: own.personId, reason: REASON }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A removed record (deleted_at) is not there to take down.
    const removed = await kept('removed-record', 'platform');
    await getDb().update(person).set({ deletedAt: new Date() }).where(eq(person.id, removed.id));
    await expect(takeDownProfile(moderator.principal, { personId: removed.id, reason: REASON }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Restore: the same people.
    await takeDownProfile(moderator.principal, input, meta);
    await expect(restoreProfile(target.principal, { personId: target.personId, reason: 'Please.' }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(restoreProfile(archivist.principal, { personId: target.personId, reason: 'Please.' }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(restoreProfile(moderator.principal, { personId: target.personId, reason: '' }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('cannot be undone by any other path: the database refuses a public held record', async () => {
    const owner = await member('takedown-check');
    const moderator = await staff('takedown-check-mod', 'moderator');
    await takeDownProfile(moderator.principal, { personId: owner.personId, reason: REASON }, meta);
    await expect(getDb().update(person).set({ visibility: 'public' }).where(eq(person.id, owner.personId))).rejects.toMatchObject({
      cause: { constraint: 'person_taken_down_hidden' },
    });
    // The hold columns are set together.
    await expect(getDb().update(person).set({ takenDownReason: null }).where(eq(person.id, owner.personId))).rejects.toMatchObject({
      cause: { constraint: 'person_taken_down_complete' },
    });
  });

  it('the owner can keep editing, and their choice about publication waits for the restore', async () => {
    const owner = await member('takedown-edit');
    const moderator = await staff('takedown-edit-mod', 'moderator');
    const names = [{ value: 'Demo Takedown Edit', script: 'Latn', lang: 'en', isPrimary: true }];
    await profileUpdate(owner.principal, { personId: owner.personId, names, showPublicly: true }, meta);
    await takeDownProfile(moderator.principal, { personId: owner.personId, reason: REASON }, meta);

    // Saving the form with the box still ticked changes nothing, and does not publish.
    const saved = await profileUpdate(owner.principal, { personId: owner.personId, names, showPublicly: true }, meta);
    expect(saved.visibilityChanged).toBe(false);
    expect(saved.profile).toMatchObject({ visibility: 'involved_only', takenDown: true, wantsPublic: true });
    expect(await publicIds(owner.personId)).toEqual([]);

    // Unticking it while held keeps the person hidden after the restore, and withdraws the consent as always.
    await profileUpdate(owner.principal, { personId: owner.personId, names, showPublicly: false }, meta);
    expect((await rowOf(owner.personId)).takenDownVisibility).toBe('involved_only');
    const restored = await restoreProfile(moderator.principal, { personId: owner.personId, reason: 'Resolved.' }, meta);
    expect(restored).toMatchObject({ visibility: 'involved_only', takenDown: false });
    expect(await publicIds(owner.personId)).toEqual([]);
    const [latest] = await getDb().select({ action: consentRecord.action }).from(consentRecord).where(and(eq(consentRecord.userId, owner.account.id), eq(consentRecord.kind, 'publication'))).orderBy(sql`${consentRecord.occurredAt} DESC`, sql`${consentRecord.id} DESC`).limit(1);
    expect(latest?.action).toBe('withdrawn');

    // And when the owner withdrew the consent some other way while the record was held, the restore respects it too (DEFAULT D03).
    const second = await member('takedown-withdrawn');
    await profileUpdate(second.principal, { personId: second.personId, names: [{ value: 'Demo Takedown Withdrawn', script: 'Latn', lang: 'en', isPrimary: true }], showPublicly: true }, meta);
    await takeDownProfile(moderator.principal, { personId: second.personId, reason: REASON }, meta);
    await getDb().insert(consentRecord).values({ userId: second.account.id, kind: 'publication', action: 'withdrawn', documentVersion: 'test' });
    const back = await restoreProfile(moderator.principal, { personId: second.personId, reason: 'Resolved.' }, meta);
    expect(back.visibility).toBe('involved_only');
  });

  it('withdrawing the publication consent on the privacy page while held is kept for the restore', async () => {
    const owner = await member('takedown-consent');
    const moderator = await staff('takedown-consent-mod', 'moderator');
    await takeDownProfile(moderator.principal, { personId: owner.personId, reason: REASON }, meta);
    expect((await rowOf(owner.personId)).takenDownVisibility).toBe('public');
    const result = await consentWithdraw(owner.principal, { kinds: ['publication'] }, meta);
    // Nothing public changes (the record is hidden already), but the choice waits for the restore.
    expect(result).toEqual({ withdrawn: ['publication'], profileHidden: false, profileHeld: true });
    expect((await rowOf(owner.personId)).takenDownVisibility).toBe('involved_only');
    const back = await restoreProfile(moderator.principal, { personId: owner.personId, reason: 'Resolved.' }, meta);
    expect(back.visibility).toBe('involved_only');
    expect(await publicIds(owner.personId)).toEqual([]);
  });

  it('an approval that would publish both ends of a link leaves a held person hidden', async () => {
    const teacher = await member('takedown-teacher', { sifu: true });
    const student = await member('takedown-student', { hidden: true, granted: true });
    const moderator = await staff('takedown-link-mod', 'moderator');
    const lineageId = await newLineage('takedown');
    const request = await requestTeacher(student.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta);
    await takeDownProfile(moderator.principal, { personId: student.personId, reason: REASON }, meta);
    await approveRelationship(teacher.principal, { relationshipId: request.relationship.id, idempotencyKey: key() }, meta);
    const [link] = await getDb().select({ status: teachingRelationship.status }).from(teachingRelationship).where(eq(teachingRelationship.id, request.relationship.id));
    expect(link?.status).toBe('verified');
    expect(await publicIds(teacher.personId, student.personId)).toEqual([teacher.personId]);
    expect((await rowOf(student.personId)).takenDownAt).not.toBeNull();
    // The restore then publishes what the approval would have: nothing was lost (the student granted
    // the consent to publish; one who withdrew it or never granted it would stay hidden, below).
    expect((await rowOf(student.personId)).takenDownVisibility).toBe('public');
    const back = await restoreProfile(moderator.principal, { personId: student.personId, reason: 'Resolved.' }, meta);
    expect(back.visibility).toBe('public');
    expect(await publicIds(teacher.personId, student.personId)).toEqual([teacher.personId, student.personId].sort());
  });

  it('an approval during a hold does not mark a person for publication whose owner withdrew the consent', async () => {
    const teacher = await member('takedown-teacher-w', { sifu: true });
    const student = await member('takedown-student-w');
    const moderator = await staff('takedown-link-mod-w', 'moderator');
    const lineageId = await newLineage('takedown-w');
    const request = await requestTeacher(student.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta);
    await takeDownProfile(moderator.principal, { personId: student.personId, reason: REASON }, meta);
    await consentWithdraw(student.principal, { kinds: ['publication'] }, meta);
    await approveRelationship(teacher.principal, { relationshipId: request.relationship.id, idempotencyKey: key() }, meta);
    expect((await rowOf(student.personId)).takenDownVisibility).toBe('involved_only');
    const back = await restoreProfile(moderator.principal, { personId: student.personId, reason: 'Resolved.' }, meta);
    expect(back.visibility).toBe('involved_only');
    expect(await publicIds(student.personId)).toEqual([]);
  });
});

describe('a restore never publishes without a granted consent (DEFAULT D03, review 2026-11-14)', () => {
  it('a record that was public without any consent record stays private after a take-down and a restore', async () => {
    const owner = await member('takedown-legacy', { granted: false });
    const moderator = await staff('takedown-legacy-mod', 'moderator');
    await takeDownProfile(moderator.principal, { personId: owner.personId, reason: REASON }, meta);
    expect((await rowOf(owner.personId)).takenDownVisibility).toBe('public');
    const back = await restoreProfile(moderator.principal, { personId: owner.personId, reason: 'Resolved.' }, meta);
    expect(back.visibility).toBe('involved_only');
    expect(await publicIds(owner.personId)).toEqual([]);
  });

  it('an approval during a hold does not mark a person for publication whose owner never granted the consent', async () => {
    const teacher = await member('takedown-teacher-n', { sifu: true });
    const student = await member('takedown-student-n', { hidden: true });
    const moderator = await staff('takedown-link-mod-n', 'moderator');
    const lineageId = await newLineage('takedown-n');
    const request = await requestTeacher(student.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta);
    await takeDownProfile(moderator.principal, { personId: student.personId, reason: REASON }, meta);
    await approveRelationship(teacher.principal, { relationshipId: request.relationship.id, idempotencyKey: key() }, meta);
    expect((await rowOf(student.personId)).takenDownVisibility).toBe('involved_only');
    const back = await restoreProfile(moderator.principal, { personId: student.personId, reason: 'Resolved.' }, meta);
    expect(back.visibility).toBe('involved_only');
  });
});

describe('an upheld report', () => {
  async function report() {
    const reported = await member('report-target');
    const reporter = await member('report-reporter');
    const moderator = await staff('report-mod', 'moderator');
    const { caseId } = await reportProfile(reporter.principal, { personId: reported.personId, reason: 'misleading', details: 'A fictional detail.', idempotencyKey: key() }, meta);
    await assignReviewCase(moderator.principal, { caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    return { reported, reporter, moderator, caseId };
  }

  it('takes the profile down only when staff choose it (off by default), with the reason, recorded on the case', async () => {
    const plain = await report();
    await decideReviewCase(plain.moderator.principal, { caseId: plain.caseId, decision: 'verify', reason: 'Upheld.', idempotencyKey: key() }, meta);
    expect((await rowOf(plain.reported.personId)).takenDownAt).toBeNull();
    expect(await publicIds(plain.reported.personId)).toEqual([plain.reported.personId]);

    const chosen = await report();
    const view = await getReviewCase(chosen.moderator.principal, { id: chosen.caseId });
    expect(view.subject?.takeDown).toEqual({ held: false, reason: null, allowed: true });
    const decided = await decideReviewCase(chosen.moderator.principal, { caseId: chosen.caseId, decision: 'verify', reason: REASON, takeDown: true, idempotencyKey: key() }, meta);
    expect(decided.case.status).toBe('resolved');
    expect(await publicIds(chosen.reported.personId)).toEqual([]);
    expect(await rowOf(chosen.reported.personId)).toMatchObject({ visibility: 'involved_only', takenDownReason: REASON, takenDownVisibility: 'public' });
    expect(decided.case.subject?.takeDown).toMatchObject({ held: true, reason: REASON });
    expect(decided.case.subject?.facts).toContainEqual({ label: 'Public pages', value: 'Taken down by staff' });
    // The case carries the take-down as an internal note, and the audit row names the case.
    const notes = await getDb().select().from(reviewNote).where(eq(reviewNote.reviewCaseId, chosen.caseId));
    expect(notes.filter((n) => n.isInternal && n.body.startsWith('Profile taken down.'))).toHaveLength(1);
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'person.takedown'), eq(auditLog.subjectId, chosen.reported.personId)));
    expect((audit!.after as { caseId?: string }).caseId).toBe(chosen.caseId);
    const [content] = await getDb().select().from(contentReport).where(eq(contentReport.reviewCaseId, chosen.caseId));
    expect(content?.status).toBe('resolved');
    expect(dropped.tags).toContain(`person:${chosen.reported.personId}`);
    // The owner reads the reason, and the record page shows the hold with the means to restore it.
    const [notice] = await getDb().select().from(notification).where(and(eq(notification.userId, chosen.reported.account.id), eq(notification.template, 'profile.taken-down')));
    expect(notice?.payload).toEqual({ reason: REASON });
    const record = await getArchiveRecord(chosen.moderator.principal, { slug: chosen.reported.slug });
    expect(record.takeDown).toMatchObject({ held: true, reason: REASON, allowed: true });
    expect(record.takeDown.since).toEqual(expect.any(String));
  });

  it('refuses a take-down without a reason, on a dismissal, or on a case of another kind', async () => {
    const r = await report();
    await expect(decideReviewCase(r.moderator.principal, { caseId: r.caseId, decision: 'verify', takeDown: true, idempotencyKey: key() }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { reason: expect.any(String) } });
    await expect(decideReviewCase(r.moderator.principal, { caseId: r.caseId, decision: 'reject', reason: 'No.', takeDown: true, idempotencyKey: key() }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { takeDown: expect.any(String) } });
    await expect(decideReviewCase(r.moderator.principal, { caseId: r.caseId, decision: 'verify', reason: 'x'.repeat(501), takeDown: true, idempotencyKey: key() }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await rowOf(r.reported.personId)).takenDownAt).toBeNull();
    // The case is still open: nothing was half done.
    expect((await getReviewCase(r.moderator.principal, { id: r.caseId })).status).not.toBe('resolved');
  });

  it('can be taken down and restored from the case itself', async () => {
    const r = await report();
    await takeDownProfile(r.moderator.principal, { personId: r.reported.personId, reason: REASON, caseId: r.caseId }, meta);
    const held = await getReviewCase(r.moderator.principal, { id: r.caseId });
    expect(held.subject?.takeDown).toMatchObject({ held: true, allowed: true });
    await restoreProfile(r.moderator.principal, { personId: r.reported.personId, reason: 'Resolved.', caseId: r.caseId }, meta);
    expect((await getReviewCase(r.moderator.principal, { id: r.caseId })).subject?.takeDown).toMatchObject({ held: false });
    // A case about another record is not a place to record it.
    const other = await member('report-other');
    await expect(takeDownProfile(r.moderator.principal, { personId: other.personId, reason: REASON, caseId: r.caseId }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(takeDownProfile(r.moderator.principal, { personId: other.personId, reason: REASON, caseId: uuidv7() }, meta)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
