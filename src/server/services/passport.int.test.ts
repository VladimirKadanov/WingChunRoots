// The training passport (milestone M19, In scope 2, 4, 5, 6, 8 and 10; docs/adr/0022-passport.md)
// against PostGIS, on the seeded demo data: who writes (DEFAULT M19, question 1: the teacher with a
// verified relationship or an admin of the issuing organization; never the student, who hides an
// entry or proposes a correction; a relationship in arbitration reads only); the plan's passport
// (question 3: a downgrade hides the full timeline and keeps every entry); a private certificate
// never in a public answer and never served to a stranger (question 4); an examiner the public
// cannot see is not named; staff remove an entry with a reason (audited, the owner told);
// attendance only at a past event, for one's own students. Fictional data only (D20).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, authUser, entitlementGrant, event, notification, organizationAdmin, organizationMembership, passportExam, passportRank, person, teachingRelationship } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { createObjectStore, type ObjectStore } from '../storage';
import { plainImage } from '../storage/test-images';
import {
  addExam,
  addRank,
  addSkill,
  ARBITRATION_READ_ONLY,
  markAttendance,
  myPassport,
  openCertificate,
  passportGet,
  passportStudents,
  removeCertificate,
  removePassportEntry,
  setVisibility,
  STUDENT_CANNOT_RECORD,
  updateEntry,
  uploadCertificate,
  withdrawEntry,
} from './passport';
import { member, meta, newLineage, principalOf, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
const storeRoot = mkdtempSync(path.join(tmpdir(), 'wcr-passport-int-'));
let store: ObjectStore;

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
  store = createObjectStore({ driver: 'filesystem', dir: storeRoot });
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(storeRoot, { recursive: true, force: true });
});

async function refusal(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code: string; message: string };
    return { code: e.code, message: e.message };
  }
  throw new Error('expected a refusal');
}

async function relate(teacherPersonId: string, studentPersonId: string, status: 'verified' | 'in_arbitration' | 'pending_teacher' = 'verified') {
  const lineageId = await newLineage('m19');
  const [row] = await getDb()
    .insert(teachingRelationship)
    .values({ teacherPersonId, studentPersonId, lineageId, status, visibility: status === 'pending_teacher' ? 'involved_only' : 'public' })
    .returning({ id: teachingRelationship.id });
  return row!.id;
}

async function premium(userId: string) {
  const [row] = await getDb()
    .insert(entitlementGrant)
    .values({ subjectUserId: userId, planCode: 'premium_student', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: M19 test plan' })
    .returning({ id: entitlementGrant.id });
  return row!.id;
}

/** A teacher and a student with a verified relationship, the student on Premium Student when `full`. */
async function pair(label: string, full = false) {
  const teacher = await member(`${label}-teacher`, { sifu: true });
  const student = await member(`${label}-student`);
  await relate(teacher.personId, student.personId);
  if (full) await premium(student.account.id);
  return { teacher, student };
}

const pngFile = async (name = 'demo-certificate.png') => new File([new Uint8Array(await plainImage('png', 320, 220))], name, { type: 'image/png' });

describe('who writes (DEFAULT M19, question 1)', () => {
  it('the verified teacher records a rank, an examination and a skill; the student is told once', async () => {
    const { teacher, student } = await pair('writes');
    const rank = await addRank(teacher.principal, { personId: student.personId, rank: 'Demo first level', date: '2019' }, meta);
    const exam = await addExam(teacher.principal, { personId: student.personId, awardedRank: 'Demo first level', date: '2019-05-12' }, meta);
    const skill = await addSkill(teacher.principal, { personId: student.personId, name: 'Demo form', progress: 'learning', date: '2020-03' }, meta);
    expect([rank.kind, exam.kind, skill.kind]).toEqual(['rank', 'exam', 'skill']);
    const notices = await getDb().select().from(notification).where(and(eq(notification.userId, student.account.id), eq(notification.template, 'passport.entry-added')));
    expect(notices).toHaveLength(3);
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'passport.add'), eq(auditLog.subjectId, rank.id)));
    expect(audits).toHaveLength(1);
    // The audit row names no person, only ids and facts.
    expect(JSON.stringify(audits[0]!.after)).not.toContain('Demo');
  });

  it('a student cannot write a rank of their own, nor change one: they propose a correction', async () => {
    const { teacher, student } = await pair('own-rank');
    const own = await refusal(addRank(student.principal, { personId: student.personId, rank: 'Demo master', date: '2020' }, meta));
    expect(own).toEqual({ code: 'FORBIDDEN', message: STUDENT_CANNOT_RECORD });
    const rank = await addRank(teacher.principal, { personId: student.personId, rank: 'Demo first level', date: '2019' }, meta);
    expect((await refusal(updateEntry(student.principal, { kind: 'rank', id: rank.id, rank: 'Demo master' }, meta))).code).toBe('FORBIDDEN');
    expect(['FORBIDDEN', 'NOT_FOUND']).toContain((await refusal(withdrawEntry(student.principal, { kind: 'rank', id: rank.id }, meta))).code);
    const proposed = await updateEntry(student.principal, { kind: 'rank', id: rank.id, correction: 'The rank was awarded in 2018.' }, meta);
    expect(proposed.correction).toBe(true);
    const [row] = await getDb().select().from(passportRank).where(eq(passportRank.id, rank.id));
    expect(row!.rank).toBe('Demo first level');
    expect(row!.correctionNote).toBe('The rank was awarded in 2018.');
    const told = await getDb().select().from(notification).where(and(eq(notification.userId, teacher.account.id), eq(notification.template, 'passport.correction')));
    expect(told).toHaveLength(1);
    // The teacher's change clears the proposal.
    await updateEntry(teacher.principal, { kind: 'rank', id: rank.id, date: '2018' }, meta);
    const [after] = await getDb().select().from(passportRank).where(eq(passportRank.id, rank.id));
    expect(after!.correctionNote).toBeNull();
    expect(after!.precision).toBe('year');
  });

  it('a relationship in arbitration reads only; a stranger and a pending teacher get "no such student"', async () => {
    const teacher = await member('arb-teacher', { sifu: true });
    const student = await member('arb-student');
    const relationshipId = await relate(teacher.personId, student.personId);
    const rank = await addRank(teacher.principal, { personId: student.personId, rank: 'Demo first level', date: null }, meta);
    await getDb().update(teachingRelationship).set({ status: 'in_arbitration' }).where(eq(teachingRelationship.id, relationshipId));
    expect(await refusal(addRank(teacher.principal, { personId: student.personId, rank: 'Demo second level', date: null }, meta))).toEqual({ code: 'FORBIDDEN', message: ARBITRATION_READ_ONLY });
    expect((await refusal(updateEntry(teacher.principal, { kind: 'rank', id: rank.id, rank: 'Demo other' }, meta))).code).toBe('FORBIDDEN');
    const view = await passportStudents(teacher.principal, { personId: student.personId });
    expect(view.selected?.student.canRecord).toBe(false);
    expect(view.selected?.entries.map((e) => [e.id, e.canChange])).toEqual([[rank.id, false]]);

    const stranger = await member('arb-stranger', { sifu: true });
    expect((await refusal(addRank(stranger.principal, { personId: student.personId, rank: 'Demo rank', date: null }, meta))).code).toBe('NOT_FOUND');
    const pending = await member('arb-pending', { sifu: true });
    await relate(pending.personId, student.personId, 'pending_teacher');
    expect((await refusal(addRank(pending.principal, { personId: student.personId, rank: 'Demo rank', date: null }, meta))).code).toBe('NOT_FOUND');
  });

  it('an admin of the issuing organization records for its members only', async () => {
    const admin = await member('org-admin');
    const memberStudent = await member('org-member');
    const outsider = await member('org-outsider');
    const [org] = await getDb().execute<{ id: string }>(sql`SELECT id FROM organization WHERE slug = 'demo-federation-north'`).then((r) => r.rows);
    await getDb().insert(organizationAdmin).values({ organizationId: org!.id, userId: admin.account.id, role: 'admin' });
    await getDb().insert(organizationMembership).values({ organizationId: org!.id, personId: memberStudent.personId });
    const written = await addRank(admin.principal, { personId: memberStudent.personId, rank: 'Demo federation level', date: '2024', organizationId: org!.id }, meta);
    expect(written.kind).toBe('rank');
    expect((await refusal(addRank(admin.principal, { personId: outsider.personId, rank: 'Demo level', date: null, organizationId: org!.id }, meta))).code).toBe('NOT_FOUND');
    const students = await passportStudents(admin.principal, { personId: memberStudent.personId });
    expect(students.selected?.entries.map((e) => [e.id, e.canChange])).toEqual([[written.id, true]]);
  });

  it('dates as precise as known: a date after today and a malformed one are refused', async () => {
    const { teacher, student } = await pair('dates');
    expect((await refusal(addRank(teacher.principal, { personId: student.personId, rank: 'Demo', date: '2999' }, meta))).code).toBe('BAD_REQUEST');
    expect((await refusal(addRank(teacher.principal, { personId: student.personId, rank: 'Demo', date: '12/05/2019' }, meta))).code).toBe('BAD_REQUEST');
    const ok = await addRank(teacher.principal, { personId: student.personId, rank: 'Demo', date: '2019-05' }, meta);
    const [row] = await getDb().select().from(passportRank).where(eq(passportRank.id, ok.id));
    expect([row!.on, row!.precision]).toEqual(['2019-05-01', 'month']);
  });
});

describe('the plan of the passport (DEFAULT M19, question 3)', () => {
  it('Premium Student shows the full timeline; after a downgrade the basic one, every entry kept', async () => {
    const { teacher, student } = await pair('downgrade', true);
    await addRank(teacher.principal, { personId: student.personId, rank: 'Demo first level', date: '2018' }, meta);
    const current = await addRank(teacher.principal, { personId: student.personId, rank: 'Demo second level', date: '2021-06' }, meta);
    const exam = await addExam(teacher.principal, { personId: student.personId, awardedRank: 'Demo second level', date: '2021-06-12' }, meta);
    const full = await passportGet(null, { slug: student.slug });
    expect(full.level).toBe('full');
    expect(full.currentRank?.id).toBe(current.id);
    expect(full.timeline.flatMap((y) => y.items).map((e) => e.id)).toContain(exam.id);

    await getDb().update(entitlementGrant).set({ revokedAt: new Date(), revokeReason: 'Demo: downgrade' }).where(eq(entitlementGrant.subjectUserId, student.account.id));
    const basic = await passportGet(null, { slug: student.slug });
    expect(basic.level).toBe('basic');
    expect(basic.currentRank?.id).toBe(current.id);
    expect(basic.timeline).toEqual([]);
    expect(JSON.stringify(basic)).not.toContain(exam.id);
    // Kept, not deleted (D08): the owner sees it, hidden by the plan, with the upgrade offer.
    const mine = await myPassport(student.principal);
    const hidden = mine.entries.find((e) => e.id === exam.id)!;
    expect(hidden).toMatchObject({ visibility: 'public', shownOnProfile: false, hiddenByPlan: true });
    expect(mine.hiddenByPlan).toBe(2);
    expect(mine.upgrade?.to.code).toBe('premium_student');
    expect(mine.upgrade?.benefits.length).toBeGreaterThan(0);
    const [row] = await getDb().select().from(passportExam).where(eq(passportExam.id, exam.id));
    expect(row!.status).toBe('active');
  });

  it('experience as precise as the dates: the basic passport says only the year it began', async () => {
    const { teacher, student } = await pair('experience');
    await addRank(teacher.principal, { personId: student.personId, rank: 'Demo level', date: null }, meta);
    await getDb().update(person).set({ trainingStartYear: 2015 }).where(eq(person.id, student.personId));
    const basic = await passportGet(null, { slug: student.slug });
    expect(basic.experience?.text).toBe('since 2015');
    expect(basic.experience?.text).not.toMatch(/month/);
  });

  it('a private entry and a withdrawn one are in no public answer', async () => {
    const { teacher, student } = await pair('private', true);
    const skill = await addSkill(teacher.principal, { personId: student.personId, name: 'Demo private form', date: '2022' }, meta);
    const rank = await addRank(teacher.principal, { personId: student.personId, rank: 'Demo withdrawn level', date: '2022' }, meta);
    await setVisibility(student.principal, { kind: 'skill', id: skill.id, visibility: 'private' }, meta);
    await withdrawEntry(teacher.principal, { kind: 'rank', id: rank.id }, meta);
    const shown = JSON.stringify(await passportGet(null, { slug: student.slug }));
    expect(shown).not.toContain(skill.id);
    expect(shown).not.toContain('Demo private form');
    expect(shown).not.toContain(rank.id);
    // A teacher cannot set the student's visibility.
    expect((await refusal(setVisibility(teacher.principal, { kind: 'skill', id: skill.id, visibility: 'public' }, meta))).code).toBe('NOT_FOUND');
  });

  it('a person who is not public has no public passport (404)', async () => {
    const teacher = await member('hidden-person-teacher', { sifu: true });
    const student = await member('hidden-person', { hidden: true });
    await relate(teacher.personId, student.personId);
    await addRank(teacher.principal, { personId: student.personId, rank: 'Demo level', date: '2020' }, meta);
    expect((await refusal(passportGet(null, { slug: student.slug }))).code).toBe('NOT_FOUND');
  });
});

describe('privacy (In scope 8)', () => {
  it('an examiner the public cannot see is not named', async () => {
    const { teacher, student } = await pair('examiner', true);
    const hidden = await member('hidden-examiner', { hidden: true });
    const visible = await member('visible-examiner');
    const a = await addExam(teacher.principal, { personId: student.personId, awardedRank: 'Demo level A', date: '2020', examinerPersonId: hidden.personId }, meta);
    const b = await addExam(teacher.principal, { personId: student.personId, awardedRank: 'Demo level B', date: '2021', examinerPersonId: visible.personId }, meta);
    const view = await passportGet(null, { slug: student.slug });
    const entries = view.timeline.flatMap((y) => y.items);
    expect(entries.find((e) => e.id === a.id)?.examiner).toBeNull();
    expect(entries.find((e) => e.id === b.id)?.examiner?.slug).toBe(visible.slug);
    expect(JSON.stringify(view)).not.toContain(hidden.slug);
  });

  it('a private certificate never leaks: not in the public answer, served only to the owner and their teachers', async () => {
    const { teacher, student } = await pair('certificate', true);
    const privateOne = await uploadCertificate(student.principal, { file: await pngFile(), title: 'Demo private certificate', date: '2020' }, meta, store);
    const publicOne = await uploadCertificate(student.principal, { file: await pngFile(), title: 'Demo public certificate', date: '2021', visibility: 'public' }, meta, store);
    expect(privateOne.visibility).toBe('private');
    const shown = JSON.stringify(await passportGet(null, { slug: student.slug }));
    expect(shown).not.toContain(privateOne.id);
    expect(shown).not.toContain('Demo private certificate');
    expect(shown).toContain(publicOne.id);

    const address = (c: typeof privateOne) => {
      const [, , , id, hash, file] = c.image.small.split('/');
      return { id: id!, hash: hash!, file: file! };
    };
    const stranger = await member('certificate-stranger');
    expect(await openCertificate(null, address(privateOne), store)).toBeNull();
    expect(await openCertificate(stranger.principal, address(privateOne), store)).toBeNull();
    expect(await openCertificate(student.principal, address(privateOne), store)).toMatchObject({ notModified: false, public: false });
    expect(await openCertificate(teacher.principal, address(privateOne), store)).toMatchObject({ notModified: false, public: false });
    expect(await openCertificate(null, address(publicOne), store)).toMatchObject({ notModified: false, public: true });
    // A wrong hash is the same 404.
    expect(await openCertificate(student.principal, { ...address(privateOne), hash: '0'.repeat(16) }, store)).toBeNull();

    // On the basic passport a public certificate is not shown either.
    await getDb().update(entitlementGrant).set({ revokedAt: new Date(), revokeReason: 'Demo: downgrade' }).where(eq(entitlementGrant.subjectUserId, student.account.id));
    expect(JSON.stringify(await passportGet(null, { slug: student.slug }))).not.toContain(publicOne.id);
    expect(await openCertificate(null, address(publicOne), store)).toBeNull();

    // Removed: its files go, the row stays withdrawn.
    await removeCertificate(student.principal, { id: privateOne.id }, meta, store);
    expect(await openCertificate(student.principal, address(privateOne), store)).toBeNull();
    expect((await refusal(removeCertificate(stranger.principal, { id: publicOne.id }, meta, store))).code).toBe('NOT_FOUND');
  });

  it('a certificate must be an image: a PDF is refused', async () => {
    const student = await member('certificate-pdf');
    const pdf = new File([new TextEncoder().encode('%PDF-1.4\n%demo\n')], 'demo.pdf', { type: 'application/pdf' });
    const refused = await refusal(uploadCertificate(student.principal, { file: pdf }, meta, store));
    expect(['UNSUPPORTED_MEDIA_TYPE', 'BAD_REQUEST']).toContain(refused.code);
  });
});

describe('staff removal (In scope 6)', () => {
  it('a moderator with a verified second factor removes an entry with a reason: audited, the owner told', async () => {
    const { teacher, student } = await pair('removal', true);
    const rank = await addRank(teacher.principal, { personId: student.personId, rank: 'Demo wrong level', date: '2020' }, meta);
    const unverified = await staff('passport-unverified', 'moderator', { unverified: true });
    expect((await refusal(removePassportEntry(unverified.principal, { kind: 'rank', id: rank.id, reason: 'Demo reason' }, meta, store))).code).toBe('SECOND_FACTOR_REQUIRED');
    expect((await refusal(removePassportEntry(teacher.principal, { kind: 'rank', id: rank.id, reason: 'Demo reason' }, meta, store))).code).toBe('FORBIDDEN');
    const moderator = await staff('passport-moderator', 'moderator');
    expect((await refusal(removePassportEntry(moderator.principal, { kind: 'rank', id: rank.id, reason: '  ' }, meta, store))).code).toBe('BAD_REQUEST');
    const removed = await removePassportEntry(moderator.principal, { kind: 'rank', id: rank.id, reason: 'Demo: recorded on the wrong person.' }, meta, store);
    expect(removed.removed).toBe(true);
    const [row] = await getDb().select().from(passportRank).where(eq(passportRank.id, rank.id));
    expect(row).toMatchObject({ status: 'removed', removalReason: 'Demo: recorded on the wrong person.', removedByUserId: moderator.account.id });
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'passport.remove'), eq(auditLog.subjectId, rank.id)));
    expect(audits).toHaveLength(1);
    const told = await getDb().select().from(notification).where(and(eq(notification.userId, student.account.id), eq(notification.template, 'content.removed')));
    expect(told.map((n) => n.payload)).toEqual([{ content: 'passport_entry', reason: 'Demo: recorded on the wrong person.' }]);
    expect(JSON.stringify(await passportGet(null, { slug: student.slug }))).not.toContain(rank.id);
    // The teacher cannot bring it back.
    expect((await refusal(updateEntry(teacher.principal, { kind: 'rank', id: rank.id, rank: 'Demo again' }, meta))).code).toBe('NOT_FOUND');
  });
});

describe('attendance (In scope 1 and 2)', () => {
  it('the organizer marks their own students at a past event, once; never at a future one, never a stranger', async () => {
    const [sifuAccount] = await getDb().select({ id: authUser.id, email: authUser.email }).from(authUser).where(eq(authUser.email, 'demo-pro-sifu-8@example.test'));
    const sifu = principalOf(sifuAccount!);
    const [sifuPerson] = await getDb().select({ id: person.id }).from(person).where(eq(person.slug, 'demo-pro-sifu-8'));
    const student = await member('attendance-student');
    await relate(sifuPerson!.id, student.personId);
    const [past] = await getDb().select({ id: event.id }).from(event).where(eq(event.slug, 'demo-past-seminar-athens'));
    const [future] = await getDb().select({ id: event.id }).from(event).where(eq(event.slug, 'demo-seminar-chum-kiu-sofia'));
    expect((await markAttendance(sifu, { eventId: past!.id, personIds: [student.personId] }, meta)).marked).toBe(1);
    expect((await markAttendance(sifu, { eventId: past!.id, personIds: [student.personId] }, meta)).marked).toBe(0);
    expect((await refusal(markAttendance(sifu, { eventId: future!.id, personIds: [student.personId] }, meta))).code).toBe('CONFLICT');
    const stranger = await member('attendance-stranger');
    expect((await refusal(markAttendance(sifu, { eventId: past!.id, personIds: [stranger.personId] }, meta))).code).toBe('BAD_REQUEST');
    const other = await member('attendance-other', { sifu: true });
    expect((await refusal(markAttendance(other.principal, { eventId: past!.id, personIds: [student.personId] }, meta))).code).toBe('NOT_FOUND');
    const view = await passportStudents(sifu, { personId: student.personId });
    expect(view.selected?.events.find((e) => e.id === past!.id)?.attended).toBe(true);
  });
});

describe('the demo passports (In scope 9)', () => {
  it('the Premium Student has a full passport; the Free Student a basic one with hidden entries kept', async () => {
    const [premiumPerson] = await getDb()
      .select({ slug: person.slug })
      .from(person)
      .innerJoin(authUser, eq(authUser.id, person.claimedByUserId))
      .where(eq(authUser.email, 'demo-premium-student@example.test'));
    const full = await passportGet(null, { slug: premiumPerson!.slug });
    expect(full.level).toBe('full');
    expect(full.currentRank?.title).toBe('Second level');
    const kinds = full.timeline.flatMap((y) => y.items).map((e) => e.kind);
    for (const kind of ['rank', 'exam', 'skill', 'certificate', 'attendance'] as const) expect(kinds).toContain(kind);
    const entries = full.timeline.flatMap((y) => y.items);
    expect(entries.find((e) => e.kind === 'exam')?.examiner?.slug).toBe('demo-cjk-name');
    expect(entries.find((e) => e.kind === 'skill' && e.progress === 'learning')?.progressLabel).toBe('Learning');
    expect(entries.filter((e) => e.kind === 'certificate')).toHaveLength(1);

    const basic = await passportGet(null, { slug: 'demo-two-lineages' });
    expect(basic.level).toBe('basic');
    expect(basic.currentRank?.title).toBe('First level');
    expect(basic.timeline).toEqual([]);
    const kept = await getDb().execute<{ n: number }>(sql`
      SELECT (SELECT count(*) FROM passport_rank r JOIN person p ON p.id = r.person_id WHERE p.slug = 'demo-two-lineages' AND r.status = 'active')
           + (SELECT count(*) FROM passport_exam r JOIN person p ON p.id = r.person_id WHERE p.slug = 'demo-two-lineages' AND r.status = 'active')
           + (SELECT count(*) FROM passport_skill r JOIN person p ON p.id = r.person_id WHERE p.slug = 'demo-two-lineages' AND r.status = 'active') AS n`);
    expect(Number(kept.rows[0]!.n)).toBe(4);
  });
});
