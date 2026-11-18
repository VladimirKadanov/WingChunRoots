// Attendance claims (owner decision 2026-11-18, docs/adr/0046-passport-extras.md) against PostGIS,
// on the seeded demo data: a student on a plan with the full passport says they attended a past
// event; the claim shows only in their own passport until the organizer confirms it; a refused
// claim is kept, shown to nobody and cannot be made again; a waiting one can be taken back; the
// organizer marking the student turns a claim into their own record. Fictional data only (D20).

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, authUser, entitlementGrant, event, eventAttendance, notification, person, teachingRelationship } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { attendanceClaimable, attendanceClaims, claimAttendance, decideAttendanceClaim, markAttendance, myPassport, passportGet, withdrawEntry } from './passport';
import { member, meta, newLineage, principalOf } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
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

async function premiumStudent(label: string) {
  const student = await member(label);
  await getDb()
    .insert(entitlementGrant)
    .values({ subjectUserId: student.account.id, planCode: 'premium_student', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: claims test plan' });
  return student;
}

/** The demo organizer (demo-pro-sifu-8, Professional Sifu) and its past and future events. */
async function organizer() {
  const [account] = await getDb().select({ id: authUser.id, email: authUser.email }).from(authUser).where(eq(authUser.email, 'demo-pro-sifu-8@example.test'));
  const [own] = await getDb().select({ id: person.id }).from(person).where(eq(person.slug, 'demo-pro-sifu-8'));
  const [past] = await getDb().select({ id: event.id }).from(event).where(eq(event.slug, 'demo-past-seminar-athens'));
  const [future] = await getDb().select({ id: event.id }).from(event).where(eq(event.slug, 'demo-seminar-chum-kiu-sofia'));
  return { principal: principalOf(account!), userId: account!.id, personId: own!.id, past: past!.id, future: future!.id };
}

async function statusOf(id: string) {
  const [row] = await getDb().select({ status: eventAttendance.status, teacher: eventAttendance.teacherPersonId, claimed: eventAttendance.claimed }).from(eventAttendance).where(eq(eventAttendance.id, id));
  return row!;
}

describe('who may claim', () => {
  it('a Free Student may not: no events offered, and the claim is refused at the plan', async () => {
    const org = await organizer();
    const free = await member('claims-free');
    const options = await attendanceClaimable(free.principal);
    expect(options).toMatchObject({ allowed: false, events: [] });
    expect((await refusal(claimAttendance(free.principal, { eventId: org.past }, meta))).code).toBe('ENTITLEMENT_REQUIRED');
  });

  it('only a past published event, never one the claimant organized or taught at', async () => {
    const org = await organizer();
    const student = await premiumStudent('claims-when');
    expect((await refusal(claimAttendance(student.principal, { eventId: org.future }, meta))).code).toBe('CONFLICT');
    expect((await refusal(claimAttendance(student.principal, { eventId: '00000000-0000-7000-8000-000000000000' }, meta))).code).toBe('NOT_FOUND');
    // The organizer (Professional Sifu, the full passport) cannot claim their own event.
    expect((await refusal(claimAttendance(org.principal, { eventId: org.past }, meta))).code).toBe('CONFLICT');
    expect((await attendanceClaimable(org.principal)).events.map((e) => e.id)).not.toContain(org.past);
  });
});

describe('a claim and its decision', () => {
  it('waits, seen only by the student; the organizer confirms it and it joins the public passport', async () => {
    const org = await organizer();
    const student = await premiumStudent('claims-confirm');
    expect((await attendanceClaimable(student.principal)).events.map((e) => e.id)).toContain(org.past);

    const claim = await claimAttendance(student.principal, { eventId: org.past }, meta);
    expect(await statusOf(claim.id)).toMatchObject({ status: 'pending', claimed: true, teacher: null });
    // Only in the student's own passport, marked as waiting; never in the public one.
    const mine = await myPassport(student.principal);
    expect(mine.entries.find((e) => e.id === claim.id)).toMatchObject({ kind: 'attendance', waitingForOrganizer: true, shownOnProfile: false, hiddenByPlan: false });
    expect(JSON.stringify(await passportGet(null, { slug: student.slug }))).not.toContain(claim.id);
    // Once per event; and no longer offered.
    expect((await refusal(claimAttendance(student.principal, { eventId: org.past }, meta))).code).toBe('CONFLICT');
    expect((await attendanceClaimable(student.principal)).events.map((e) => e.id)).not.toContain(org.past);
    // The organizer is told, without the student's name in the notice.
    const told = await getDb().select().from(notification).where(and(eq(notification.userId, org.userId), eq(notification.template, 'passport.attendance-claimed')));
    expect(told.length).toBeGreaterThan(0);

    // Somebody else neither sees nor decides it.
    const stranger = await member('claims-stranger', { sifu: true });
    expect((await attendanceClaims(stranger.principal)).claims.map((c) => c.id)).not.toContain(claim.id);
    expect((await refusal(decideAttendanceClaim(stranger.principal, { id: claim.id, decision: 'approve' }, meta))).code).toBe('NOT_FOUND');

    const waiting = await attendanceClaims(org.principal);
    expect(waiting.claims.find((c) => c.id === claim.id)).toMatchObject({ event: { id: org.past }, student: { slug: student.slug } });
    expect(await decideAttendanceClaim(org.principal, { id: claim.id, decision: 'approve' }, meta)).toEqual({ id: claim.id, status: 'active' });
    expect(await statusOf(claim.id)).toMatchObject({ status: 'active', teacher: org.personId });
    // Asking again is the same answer; the opposite one is refused.
    expect(await decideAttendanceClaim(org.principal, { id: claim.id, decision: 'approve' }, meta)).toEqual({ id: claim.id, status: 'active' });
    expect((await refusal(decideAttendanceClaim(org.principal, { id: claim.id, decision: 'refuse' }, meta))).code).toBe('CONFLICT');

    const shown = await passportGet(null, { slug: student.slug });
    expect(shown.timeline.flatMap((y) => y.items).map((e) => e.id)).toContain(claim.id);
    expect((await attendanceClaims(org.principal)).claims.map((c) => c.id)).not.toContain(claim.id);
    const decided = await getDb().select().from(notification).where(and(eq(notification.userId, student.account.id), eq(notification.template, 'passport.attendance-decided')));
    expect(decided).toHaveLength(1);
    expect(decided[0]!.payload).toMatchObject({ approved: true });
    const audited = await getDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, claim.id));
    expect(audited.map((a) => a.action)).toEqual(expect.arrayContaining(['passport.attendance_claim', 'passport.attendance_decide']));
  });

  it('refused: kept, shown to nobody, not claimable again; the organizer marking the student makes it their record', async () => {
    const org = await organizer();
    const student = await premiumStudent('claims-refuse');
    const claim = await claimAttendance(student.principal, { eventId: org.past }, meta);
    expect(await decideAttendanceClaim(org.principal, { id: claim.id, decision: 'refuse' }, meta)).toEqual({ id: claim.id, status: 'refused' });
    expect((await myPassport(student.principal)).entries.map((e) => e.id)).not.toContain(claim.id);
    expect(JSON.stringify(await passportGet(null, { slug: student.slug }))).not.toContain(claim.id);
    expect((await refusal(claimAttendance(student.principal, { eventId: org.past }, meta))).code).toBe('CONFLICT');
    expect((await attendanceClaimable(student.principal)).events.map((e) => e.id)).not.toContain(org.past);
    const [told] = await getDb().select().from(notification).where(and(eq(notification.userId, student.account.id), eq(notification.template, 'passport.attendance-decided')));
    expect(told!.payload).toMatchObject({ approved: false });

    // The student's teacher (the organizer) marks them after all: the refused claim becomes the record.
    const lineageId = await newLineage('claims');
    await getDb().insert(teachingRelationship).values({ teacherPersonId: org.personId, studentPersonId: student.personId, lineageId, status: 'verified', visibility: 'public' });
    expect((await markAttendance(org.principal, { eventId: org.past, personIds: [student.personId] }, meta)).marked).toBe(1);
    expect(await statusOf(claim.id)).toMatchObject({ status: 'active', teacher: org.personId });
  });

  it('a waiting claim can be taken back by the student only, and then made again', async () => {
    const org = await organizer();
    const student = await premiumStudent('claims-withdraw');
    const claim = await claimAttendance(student.principal, { eventId: org.past }, meta);
    const other = await premiumStudent('claims-withdraw-other');
    expect((await refusal(withdrawEntry(other.principal, { kind: 'attendance', id: claim.id }, meta))).code).toBe('NOT_FOUND');
    expect(await withdrawEntry(student.principal, { kind: 'attendance', id: claim.id }, meta)).toMatchObject({ withdrawn: true });
    expect(await statusOf(claim.id)).toMatchObject({ status: 'withdrawn' });
    expect((await myPassport(student.principal)).entries.map((e) => e.id)).not.toContain(claim.id);
    expect((await attendanceClaims(org.principal)).claims.map((c) => c.id)).not.toContain(claim.id);
    const again = await claimAttendance(student.principal, { eventId: org.past }, meta);
    expect(again.id).not.toBe(claim.id);
  });
});
