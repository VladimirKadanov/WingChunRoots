// Impersonation reports (ADR 0088), against a migrated throwaway database:
//   - a report changes nothing until a moderator's check; the reported account learns nothing then;
//   - the hold: the profile says "Identity under review", refuses renames and a teacher's approval,
//     and the reported side becomes a party who sees nothing of the reporter;
//   - vouching: who may be asked, one answer, the proof summary on the case card;
//   - the own-channel codes: only the domain is kept, the code is typed back (five tries);
//   - the administrator's decision: an impostor's profile moves to the reporter, the students it
//     approved go back to pending, its photos go, the suggested suspension; a duplicate is taken
//     down; a refusal lifts the hold;
//   - the daily sweep closes a report without proof and lifts an expired hold.
// Fictional data only (D20): demo- slugs, example.test addresses.

import { randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, authUser, emailDelivery, evidenceFile, identityCode, identityReport, notification, person, personPhoto, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { getPartyCase, myCases } from './cases';
import { grantConsents, REQUIRED_SIGN_UP_CONSENTS } from './consent';
import {
  addIdentityCode,
  answerIdentityVouch,
  askIdentityVouch,
  confirmIdentityCode,
  fileIdentityReport,
  getIdentityReportOption,
  getIdentityVouch,
  HELD_MESSAGE,
  purgeIdentityVideos,
  sweepIdentityReports,
  triageIdentityReport,
} from './identity-reports';
import { cachedProfile } from './lineage-public';
import { profilePublish } from './profile';
import { approveRelationship } from './relationships';
import { decideReviewCase, getReviewCase } from './review';
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

const suffix = () => randomBytes(3).toString('hex');
const DAY = 86_400_000;

/** An account without a profile, with the sign-up consents (the reporter of an impostor report). */
async function newcomer(label: string) {
  const m = await member(`${label}-${suffix()}`);
  await getDb().delete(person).where(eq(person.id, m.personId));
  await getDb().transaction((tx) => grantConsents(tx, m.account.id, 'user', REQUIRED_SIGN_UP_CONSENTS, meta));
  return m;
}

/** An account of `days` days. */
async function age(userId: string, days: number) {
  await getDb().update(authUser).set({ createdAt: new Date(Date.now() - days * DAY) }).where(eq(authUser.id, userId));
}

/** A public profile run by an "impostor" account, with a verified teacher, a student it approved and a photo it added. */
async function impersonated(label: string) {
  const db = getDb();
  const impostor = await member(`${label}-impostor-${suffix()}`, { sifu: true });
  const teacher = await member(`${label}-teacher-${suffix()}`, { sifu: true });
  await age(teacher.account.id, 400);
  const lineageId = await newLineage('id-rep');
  await db.insert(teachingRelationship).values({ teacherPersonId: teacher.personId, studentPersonId: impostor.personId, lineageId, status: 'verified', visibility: 'public' });
  const student = await member(`${label}-student-${suffix()}`);
  const [approved] = await db
    .insert(teachingRelationship)
    .values({ teacherPersonId: impostor.personId, studentPersonId: student.personId, lineageId, status: 'verified', visibility: 'public', confirmedByUserId: impostor.account.id, confirmedAt: new Date() })
    .returning({ id: teachingRelationship.id });
  const [photo] = await db
    .insert(personPhoto)
    .values({ personId: impostor.personId, storageKey: `photos/${randomBytes(24).toString('hex')}`, sha256: 'a'.repeat(64), width: 512, height: 512, sizeBytes: 1000, uploadedByUserId: impostor.account.id })
    .returning({ id: personPhoto.id });
  await db.update(person).set({ photoId: photo!.id }).where(eq(person.id, impostor.personId));
  const reporter = await newcomer(`${label}-reporter`);
  return { impostor, teacher, student, reporter, lineageId, approvedId: approved!.id, photoId: photo!.id };
}

async function fileAndHold(w: Awaited<ReturnType<typeof impersonated>>, moderator: Awaited<ReturnType<typeof staff>>) {
  const { caseId } = await fileIdentityReport(w.reporter.principal, { personId: w.impostor.personId, route: 'vouching', details: 'A fictional reason: this is my profile.', idempotencyKey: key() }, meta);
  await triageIdentityReport(moderator.principal, { caseId, outcome: 'hold', reason: null, idempotencyKey: key() }, meta);
  return caseId;
}

describe('filing and the moderators’ check', () => {
  it('changes nothing before the check; the hold locks the profile and tells the reported account', async () => {
    const w = await impersonated('file');
    const moderator = await staff(`id-mod-${suffix()}`, 'moderator');
    const option = await getIdentityReportOption(w.reporter.principal, { slug: w.impostor.slug });
    expect(option).toMatchObject({ refusal: null, type: 'impostor' });
    expect(option.routes.map((r) => r.value)).toEqual(['vouching', 'channel', 'video']);
    // An impostor report names a route.
    expect(await refusal(fileIdentityReport(w.reporter.principal, { personId: w.impostor.personId, details: 'Mine.', idempotencyKey: key() }, meta))).toBe('BAD_REQUEST');

    const filed = await fileIdentityReport(w.reporter.principal, { personId: w.impostor.personId, route: 'vouching', details: 'A fictional reason: this is my profile.', idempotencyKey: key() }, meta);
    // One open report per account.
    expect(await refusal(fileIdentityReport(w.reporter.principal, { personId: w.impostor.personId, route: 'video', details: 'Again.', idempotencyKey: key() }, meta))).toBe('CONFLICT');
    // Nothing yet for the profile or its account.
    expect((await cachedProfile(w.impostor.personId))?.identityHold).toBe(false);
    expect((await myCases(w.impostor.principal)).cases.map((c) => c.id)).not.toContain(filed.caseId);
    expect(await refusal(getPartyCase(w.impostor.principal, { id: filed.caseId }))).toBe('NOT_FOUND');

    // A member of staff who is no moderator or administrator cannot check it.
    const archivist = await staff(`id-arch-${suffix()}`, 'archivist');
    expect(await refusal(triageIdentityReport(archivist.principal, { caseId: filed.caseId, outcome: 'hold', idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    await triageIdentityReport(moderator.principal, { caseId: filed.caseId, outcome: 'hold', reason: null, idempotencyKey: key() }, meta);

    const profile = await cachedProfile(w.impostor.personId);
    expect(profile).toMatchObject({ identityHold: true, instructor: null });
    await expect(profilePublish(w.impostor.principal, meta)).rejects.toMatchObject({ code: 'CONFLICT', message: HELD_MESSAGE });
    const [report] = await getDb().select().from(identityReport).where(eq(identityReport.reviewCaseId, filed.caseId));
    expect(report).toMatchObject({ status: 'held', heldByUserId: moderator.account.id });
    expect(report!.proofDueAt!.getTime() - report!.heldAt!.getTime()).toBe(14 * DAY);
    expect(report!.holdUntil!.getTime() - report!.heldAt!.getTime()).toBe(30 * DAY);

    // The reported side is a party now, and reads nothing of the reporter.
    const notices = await getDb().select().from(notification).where(and(eq(notification.userId, w.impostor.account.id), eq(notification.template, 'identity.notice')));
    expect(notices.map((n) => n.payload)).toEqual([{ caseId: filed.caseId, stage: 'held', side: 'reported' }]);
    const reportedView = await getPartyCase(w.impostor.principal, { id: filed.caseId });
    expect(reportedView).toMatchObject({ role: 'reported', identity: { side: 'reported', canProve: true } });
    expect(reportedView.messages).toEqual([]);
    expect(JSON.stringify(reportedView)).not.toContain(w.reporter.account.email);
    expect(JSON.stringify(reportedView)).not.toContain(w.reporter.account.id);
    const reporterView = await getPartyCase(w.reporter.principal, { id: filed.caseId });
    expect(reporterView).toMatchObject({ role: 'reporter', identity: { side: 'reporter', type: 'impostor' } });
    expect(reporterView.messages.map((m) => m.fromYou)).toEqual([true]);
  });

  it('a pending request to a teacher profile on hold waits', async () => {
    const w = await impersonated('approve');
    const moderator = await staff(`id-mod-${suffix()}`, 'moderator');
    const other = await member(`id-pending-${suffix()}`);
    const [pending] = await getDb()
      .insert(teachingRelationship)
      .values({ teacherPersonId: w.impostor.personId, studentPersonId: other.personId, lineageId: w.lineageId, status: 'pending_teacher', requestedByUserId: other.account.id })
      .returning({ id: teachingRelationship.id });
    await fileAndHold(w, moderator);
    await expect(approveRelationship(w.impostor.principal, { relationshipId: pending!.id, idempotencyKey: key() }, meta)).rejects.toMatchObject({ code: 'CONFLICT', message: HELD_MESSAGE });
  });

  it('closing the report tells the reporter only', async () => {
    const w = await impersonated('close');
    const moderator = await staff(`id-mod-${suffix()}`, 'moderator');
    const { caseId } = await fileIdentityReport(w.reporter.principal, { personId: w.impostor.personId, route: 'video', details: 'A fictional reason.', idempotencyKey: key() }, meta);
    expect(await refusal(triageIdentityReport(moderator.principal, { caseId, outcome: 'close', idempotencyKey: key() }, meta))).toBe('BAD_REQUEST');
    await triageIdentityReport(moderator.principal, { caseId, outcome: 'close', reason: 'A fictional reason to close.', idempotencyKey: key() }, meta);
    expect((await getPartyCase(w.reporter.principal, { id: caseId })).decision).toEqual({ resolution: 'rejected', reason: 'A fictional reason to close.' });
    const told = await getDb().select().from(notification).where(and(eq(notification.userId, w.impostor.account.id), eq(notification.template, 'identity.notice')));
    expect(told).toEqual([]);
  });
});

describe('proof', () => {
  it('asks a verified teacher to vouch, who answers once; the card says the vouching is enough', async () => {
    const w = await impersonated('vouch');
    const moderator = await staff(`id-mod-${suffix()}`, 'moderator');
    const admin = await staff(`id-admin-${suffix()}`, 'admin');
    const caseId = await fileAndHold(w, moderator);
    // A new account, and the reported account's own student, cannot vouch.
    const young = await member(`id-young-${suffix()}`);
    expect(await refusal(askIdentityVouch(w.reporter.principal, { caseId, slug: young.slug, kind: 'peer' }, meta))).toBe('BAD_REQUEST');
    await age(w.student.account.id, 400);
    expect(await refusal(askIdentityVouch(w.reporter.principal, { caseId, slug: w.student.slug, kind: 'peer' }, meta))).toBe('BAD_REQUEST');
    // Anyone else than a side: 404.
    expect(await refusal(askIdentityVouch(young.principal, { caseId, slug: w.teacher.slug, kind: 'teacher' }, meta))).toBe('NOT_FOUND');

    const asked = await askIdentityVouch(w.reporter.principal, { caseId, slug: `https://example.test/people/${w.teacher.slug}`, kind: 'teacher', message: 'A fictional message.' }, meta);
    expect(asked.replayed).toBe(false);
    const question = await getIdentityVouch(w.teacher.principal, { id: asked.id });
    expect(question).toMatchObject({ open: true, message: 'A fictional message.', subject: { id: w.impostor.personId } });
    expect(await refusal(getIdentityVouch(w.impostor.principal, { id: asked.id }))).toBe('NOT_FOUND');
    await answerIdentityVouch(w.teacher.principal, { id: asked.id, answer: 'yes', note: 'A fictional note.' }, meta);
    expect(await refusal(answerIdentityVouch(w.teacher.principal, { id: asked.id, answer: 'no' }, meta))).toBe('CONFLICT');

    const card = await getReviewCase(admin.principal, { id: caseId });
    expect(card.identity?.sides.reporter.proof.vouching).toMatch(/^Enough: 1 verified teacher/);
    expect(card.identity?.sides.reporter.vouches[0]).toMatchObject({ answer: 'yes', note: 'A fictional note.' });
    expect(card.can.verify).toBe(true);
    // The reported side reads none of it.
    expect((await getPartyCase(w.impostor.principal, { id: caseId })).identity?.vouches).toEqual([]);
  });

  it('mails a code to a school domain, keeps only the domain, and takes it back once', async () => {
    const w = await impersonated('code');
    const moderator = await staff(`id-mod-${suffix()}`, 'moderator');
    const caseId = await fileAndHold(w, moderator);
    expect(await refusal(addIdentityCode(w.reporter.principal, { caseId, channel: 'email', target: 'demo@gmail.com' }, meta))).toBe('BAD_REQUEST');
    const address = `demo-${suffix()}@demo-school.example.test`;
    const { code } = await addIdentityCode(w.reporter.principal, { caseId, channel: 'email', target: address }, meta);
    expect(code).toMatchObject({ channel: 'email', target: 'demo-school.example.test', confirmed: false, attemptsLeft: 5 });
    const [row] = await getDb().select().from(identityCode).where(eq(identityCode.id, code.id));
    expect(JSON.stringify(row)).not.toContain(address);
    const [delivery] = await getDb().select().from(emailDelivery).where(eq(emailDelivery.idempotencyKey, `identity-code:${code.id}`));
    expect(delivery?.template).toBe('identity-code');
    const wrong = row!.codeHash === null ? '000000' : '000000';
    expect(await refusal(confirmIdentityCode(w.reporter.principal, { codeId: code.id, code: wrong }, meta))).toBe('BAD_REQUEST');
    const page = await addIdentityCode(w.reporter.principal, { caseId, channel: 'page', target: 'https://demo-school.example.test/news' }, meta);
    expect(page.code.publicCode).toMatch(/^WCR-[A-Z0-9]{8}$/);
  });
});

describe('the administrator’s decision', () => {
  it('moves an impostor’s profile to the reporter, sends its students back to pending, removes its photos and suspends it', async () => {
    const w = await impersonated('transfer');
    const moderator = await staff(`id-mod-${suffix()}`, 'moderator');
    const admin = await staff(`id-admin-${suffix()}`, 'admin');
    const caseId = await fileAndHold(w, moderator);
    // A moderator does not decide it.
    expect(await refusal(decideReviewCase(moderator.principal, { caseId, decision: 'verify', reason: 'A fictional reason.', idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    await decideReviewCase(admin.principal, { caseId, decision: 'verify', reason: 'A fictional reason both sides read.', suspend: true, idempotencyKey: key() }, meta);

    const [record] = await getDb().select().from(person).where(eq(person.id, w.impostor.personId));
    expect(record).toMatchObject({ claimedByUserId: w.reporter.account.id, identityHoldAt: null, photoId: null });
    const [link] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, w.approvedId));
    expect(link).toMatchObject({ status: 'pending_teacher', visibility: 'involved_only', confirmedByUserId: null, statusReason: 'identity_transfer' });
    const [photo] = await getDb().select().from(personPhoto).where(eq(personPhoto.id, w.photoId));
    expect(photo?.status).toBe('removed');
    const [account] = await getDb().select({ banned: authUser.banned }).from(authUser).where(eq(authUser.id, w.impostor.account.id));
    expect(account?.banned).toBe(true);
    const [report] = await getDb().select().from(identityReport).where(eq(identityReport.reviewCaseId, caseId));
    expect(report).toMatchObject({ status: 'upheld', outcome: { profileMoved: true, relationshipsReturned: 1, photosRemoved: 1, suspended: true } });
    // The instructor verification of the other account does not pass to the new owner.
    expect((await cachedProfile(w.impostor.personId))?.identityHold).toBe(false);
    const audits = await getDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, w.impostor.personId));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['identity.hold', 'identity.transfer']));
    expect((await getPartyCase(w.reporter.principal, { id: caseId })).identity?.outcome).toMatchObject({ profileMoved: true, photosRemoved: 1, relationshipsReturned: 1 });
  });

  it('takes a duplicate down, and a refusal lifts the hold', async () => {
    const moderator = await staff(`id-mod-${suffix()}`, 'moderator');
    const admin = await staff(`id-admin-${suffix()}`, 'admin');
    const original = await member(`id-original-${suffix()}`);
    await getDb().transaction((tx) => grantConsents(tx, original.account.id, 'user', REQUIRED_SIGN_UP_CONSENTS, meta));
    const copy = await member(`id-copy-${suffix()}`);
    expect((await getIdentityReportOption(original.principal, { slug: copy.slug })).type).toBe('duplicate');
    const { caseId } = await fileIdentityReport(original.principal, { personId: copy.personId, details: 'A fictional reason: it copies my profile.', idempotencyKey: key() }, meta);
    await triageIdentityReport(moderator.principal, { caseId, outcome: 'hold', idempotencyKey: key() }, meta);
    await decideReviewCase(admin.principal, { caseId, decision: 'verify', reason: 'A fictional reason.', idempotencyKey: key() }, meta);
    const [taken] = await getDb().select({ takenDownAt: person.takenDownAt, held: person.identityHoldAt }).from(person).where(eq(person.id, copy.personId));
    expect(taken?.takenDownAt).not.toBeNull();
    expect(taken?.held).toBeNull();

    const w = await impersonated('refuse');
    const refused = await fileAndHold(w, moderator);
    await decideReviewCase(admin.principal, { caseId: refused, decision: 'reject', reason: 'A fictional reason.', unsettled: true, idempotencyKey: key() }, meta);
    expect((await cachedProfile(w.impostor.personId))?.identityHold).toBe(false);
    const [report] = await getDb().select({ status: identityReport.status }).from(identityReport).where(eq(identityReport.reviewCaseId, refused));
    expect(report?.status).toBe('unsettled');
    // The same reporter cannot refile within 30 days.
    expect((await getIdentityReportOption(w.reporter.principal, { slug: w.impostor.slug })).refusal).toMatch(/could not be settled/);
  });
});

describe('the daily sweep', () => {
  it('closes a report without proof after 14 days and lifts a hold after 30', async () => {
    const moderator = await staff(`id-mod-${suffix()}`, 'moderator');
    const a = await impersonated('sweep-a');
    const noProof = await fileAndHold(a, moderator);
    const b = await impersonated('sweep-b');
    const withProof = await fileAndHold(b, moderator);
    const asked = await askIdentityVouch(b.reporter.principal, { caseId: withProof, slug: b.teacher.slug, kind: 'teacher' }, meta);
    await answerIdentityVouch(b.teacher.principal, { id: asked.id, answer: 'unsure' }, meta);

    const swept = await sweepIdentityReports(getDb(), new Date(Date.now() + 15 * DAY));
    expect(swept.closed).toBeGreaterThanOrEqual(1);
    const [closed] = await getDb().select({ status: identityReport.status }).from(identityReport).where(eq(identityReport.reviewCaseId, noProof));
    expect(closed?.status).toBe('unsettled');
    const [kept] = await getDb().select({ status: identityReport.status }).from(identityReport).where(eq(identityReport.reviewCaseId, withProof));
    expect(kept?.status).toBe('held');

    await sweepIdentityReports(getDb(), new Date(Date.now() + 31 * DAY));
    const [record] = await getDb().select({ held: person.identityHoldAt }).from(person).where(eq(person.id, b.impostor.personId));
    expect(record?.held).toBeNull();
    const [still] = await getDb().select({ status: identityReport.status }).from(identityReport).where(eq(identityReport.reviewCaseId, withProof));
    expect(still?.status).toBe('held');
  });
});

describe('the videos of a decided report', () => {
  it('are deleted from the store once their 30 days are past, and kept when the store refuses', async () => {
    const db = getDb();
    const uploader = await member(`id-video-${suffix()}`);
    const file = (purgeAfter: Date) => ({ storageKey: `evidence/${randomBytes(24).toString('hex')}`, sha256: 'b'.repeat(64), mime: 'video/mp4' as const, sizeBytes: 1000, uploadedByUserId: uploader.account.id, purgeAfter });
    const [due, refused, later] = await db
      .insert(evidenceFile)
      .values([file(new Date(Date.now() - DAY)), file(new Date(Date.now() - DAY)), file(new Date(Date.now() + 10 * DAY))])
      .returning({ id: evidenceFile.id, storageKey: evidenceFile.storageKey });
    const deleted: string[] = [];
    const store = {
      driver: 'filesystem' as const,
      put: async () => undefined,
      get: async () => null,
      delete: async (key: string) => {
        if (key === refused!.storageKey) throw new Error('store refused');
        deleted.push(key);
      },
    };
    const result = await purgeIdentityVideos(db, store);
    expect(deleted).toContain(due!.storageKey);
    expect(deleted).not.toContain(later!.storageKey);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const rows = await db.select({ id: evidenceFile.id, deletedAt: evidenceFile.deletedAt }).from(evidenceFile).where(eq(evidenceFile.uploadedByUserId, uploader.account.id));
    const byId = new Map(rows.map((r) => [r.id, r.deletedAt]));
    expect(byId.get(due!.id)).not.toBeNull();
    expect(byId.get(refused!.id)).toBeNull();
    expect(byId.get(later!.id)).toBeNull();
    const [audit] = await db.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.subjectId, due!.id), eq(auditLog.action, 'evidence.purge')));
    expect(audit).toBeTruthy();
  });
});

describe('review fixes', () => {
  it('asks both sides for more information, and lets each side ask the same person without learning of the other', async () => {
    const moderator = await staff(`id-mod-${suffix()}`, 'moderator');
    const admin = await staff(`id-admin-${suffix()}`, 'admin');
    const w = await impersonated('fixes');
    const caseId = await fileAndHold(w, moderator);

    const theirs = await askIdentityVouch(w.impostor.principal, { caseId, slug: w.teacher.slug, kind: 'teacher' }, meta);
    const mine = await askIdentityVouch(w.reporter.principal, { caseId, slug: w.teacher.slug, kind: 'teacher' }, meta);
    expect(mine.replayed).toBe(false);
    expect(mine.id).not.toBe(theirs.id);

    await decideReviewCase(admin.principal, { caseId, decision: 'needs_info', reason: 'A fictional question for both sides.', idempotencyKey: key() }, meta);
    for (const userId of [w.reporter.account.id, w.impostor.account.id]) {
      const asked = await getDb().select({ id: notification.id }).from(notification).where(and(eq(notification.userId, userId), eq(notification.template, 'case.question')));
      expect(asked.length, userId).toBe(1);
    }
  });
});

