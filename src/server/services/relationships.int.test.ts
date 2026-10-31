// Teacher requests and independent approvals (milestone M09, Done when: "every transition writes
// relationship_event and audit_log, and the authorization matrix passes"), against a migrated
// throwaway database: request, approve, reject, resubmit, withdraw and end through the services,
// each with its event, its audit row, its notifications and its queued e-mails; who may do what
// (student, teacher, stranger, reviewer, staff without the second factor); idempotency; the Free
// Sifu limit (DEFAULT D06); the display preference (DEFAULT D05); reviewer visibility (DEFAULT D03);
// and the lineage.recompute job.

import { and, asc, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, authUser, consentRecord, emailDelivery, lineage, lineageMembership, notification, person, relationshipEvent, teachingRelationship, trainingPeriod } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { lineageRecomputeHandler, recomputeLineageMembership } from '../jobs/lineage-recompute';
import { listNotifications } from './notifications';
import { personProfile, personStudents } from './lineage';
import { consentWithdraw } from './privacy';
import { profileUpdate } from './profile';
import {
  approveRelationship,
  endRelationship,
  getRelationship,
  myTeachers,
  REQUEST_LIMIT_MESSAGE,
  REQUESTS_PER_WINDOW,
  REQUESTS_TO_ONE_TEACHER_PER_WINDOW,
  rejectRelationship,
  requestTeacher,
  resubmitRelationship,
  studentRequests,
  TEACHER_REQUEST_LIMIT_MESSAGE,
  withdrawRelationship,
} from './relationships';
import { key, type Member, member, meta, newLineage, ongoingFrom, staff } from './relationships.test-support';

const cache = vi.hoisted(() => ({ revalidated: [] as string[] }));
vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: (tag: string) => {
    cache.revalidated.push(tag);
  },
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
let lineageId: string;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  lineageId = await newLineage();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

async function events(relationshipId: string) {
  return getDb()
    .select({ from: relationshipEvent.fromStatus, to: relationshipEvent.toStatus, actor: relationshipEvent.actorUserId, role: relationshipEvent.actorRole, reason: relationshipEvent.reason })
    .from(relationshipEvent)
    .where(eq(relationshipEvent.relationshipId, relationshipId))
    .orderBy(asc(relationshipEvent.createdAt), asc(relationshipEvent.id));
}

async function audits(relationshipId: string) {
  return getDb()
    .select({ action: auditLog.action, actor: auditLog.actorUserId, before: auditLog.before, after: auditLog.after, reason: auditLog.reason })
    .from(auditLog)
    .where(and(eq(auditLog.subjectType, 'teaching_relationship'), eq(auditLog.subjectId, relationshipId)))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
}

async function notificationsOf(userId: string, template: string) {
  return getDb()
    .select({ payload: notification.payload })
    .from(notification)
    .where(and(eq(notification.userId, userId), eq(notification.template, template)));
}

async function emailsTo(to: string, template: string) {
  const [row] = await getDb()
    .select({ n: count() })
    .from(emailDelivery)
    .where(and(eq(emailDelivery.toEmail, to), eq(emailDelivery.template, template)));
  return row!.n;
}

async function statusOf(id: string) {
  const [row] = await getDb().select({ status: teachingRelationship.status, visibility: teachingRelationship.visibility }).from(teachingRelationship).where(eq(teachingRelationship.id, id));
  return row!;
}

async function request(student: Member, teacher: Member, extra: Record<string, unknown> = {}) {
  const result = await requestTeacher(student.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key(), ...extra }, meta);
  return result.relationship.id;
}

async function visibilityOf(personId: string) {
  const [row] = await getDb().select({ visibility: person.visibility }).from(person).where(eq(person.id, personId));
  return row!.visibility;
}

/** The account's publication consent records, oldest first. */
async function publicationActions(userId: string) {
  const rows = await getDb()
    .select({ action: consentRecord.action })
    .from(consentRecord)
    .where(and(eq(consentRecord.userId, userId), eq(consentRecord.kind, 'publication')))
    .orderBy(asc(consentRecord.occurredAt), asc(consentRecord.id));
  return rows.map((r) => r.action);
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { code?: string } | null;
  return error?.code ?? 'OK';
}

describe('every transition writes relationship_event and audit_log', () => {
  it('request → approve: pending and involved_only, then verified and public with both people public, both told by notification and e-mail, the counters job queued', async () => {
    const teacher = await member('m09-teacher', { sifu: true });
    const student = await member('m09-student', { hidden: true });
    const result = await requestTeacher(
      student.principal,
      { teacherId: teacher.personId, lineageId, periods: [{ from: '2019-04', to: null, ongoing: true }], displayPrimary: false, idempotencyKey: key() },
      meta,
    );
    const id = result.relationship.id;
    expect(result.relationship).toMatchObject({ status: 'pending_teacher', visibility: 'involved_only', viewerRole: 'student', trainingStart: 'April 2019' });
    expect(await statusOf(id)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
    expect(await notificationsOf(teacher.account.id, 'relationship.requested')).toEqual([{ payload: { relationshipId: id, resubmitted: false } }]);
    expect(await emailsTo(teacher.account.email, 'relationship-requested')).toBe(1);
    // The teacher's dashboard notification names the student and the training start (In scope 2;
    // M09 review, requirements-3), read from the request when the list is read.
    const requestedNote = (await listNotifications(teacher.principal)).items.find((n) => n.template === 'relationship.requested')!;
    expect(requestedNote.body).toEqual([{ name: { value: 'Demo m09 student', lang: 'en' } }, { text: ` asks you to confirm that you taught them in Demo m09 Lineage. Training started: April 2019.` }]);

    cache.revalidated = [];
    const approved = await approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta);
    expect(approved).toMatchObject({ replayed: false, relationship: { status: 'verified', visibility: 'public', isDisplayPrimary: true, viewerRole: 'teacher' } });
    expect(await events(id)).toEqual([
      { from: null, to: 'pending_teacher', actor: student.account.id, role: 'student', reason: null },
      { from: 'pending_teacher', to: 'verified', actor: teacher.account.id, role: 'teacher', reason: null },
    ]);
    const rows = await audits(id);
    expect(rows.map((r) => [r.action, r.actor])).toEqual([
      ['relationship.request', student.account.id],
      ['relationship.approve', teacher.account.id],
    ]);
    expect(rows[1]!.after).toMatchObject({ status: 'verified', visibility: 'public', publishedPersonIds: [student.personId] });
    // No name in the audit log (plan §6.4).
    expect(JSON.stringify(rows)).not.toContain('Demo');
    const [studentRow] = await getDb().select({ visibility: person.visibility }).from(person).where(eq(person.id, student.personId));
    expect(studentRow!.visibility).toBe('public');
    expect(await notificationsOf(student.account.id, 'relationship.approved')).toEqual([{ payload: { relationshipId: id, role: 'student' } }]);
    expect(await notificationsOf(teacher.account.id, 'relationship.approved')).toEqual([{ payload: { relationshipId: id, role: 'teacher' } }]);
    expect(await emailsTo(student.account.email, 'relationship-approved')).toBe(1);
    expect(await emailsTo(teacher.account.email, 'relationship-approved')).toBe(1);
    // The counters job names the lineage only: the worker drops no tag the procedure drops below
    // (M09 review, requirements-1).
    const jobs = await getDb().execute<{ data: { lineageIds: string[] } }>(sql`SELECT data FROM pgboss.job WHERE name = 'lineage.recompute'`);
    expect(jobs.rows.some((j) => j.data.lineageIds.includes(lineageId))).toBe(true);
    expect(jobs.rows.map((j) => Object.keys(j.data))).toEqual(jobs.rows.map(() => ['lineageIds']));
    // The public cache of both people, their lineage and the explorer's start list is dropped.
    expect(cache.revalidated).toEqual(expect.arrayContaining([`person:${teacher.personId}`, `person:${student.personId}`, `lineage:${lineageId}`, 'explore-start']));
    // The notification names the other person when it is read.
    const list = await listNotifications(student.principal);
    const approvedNote = list.items.find((n) => n.template === 'relationship.approved')!;
    expect(approvedNote.body[0]).toEqual({ name: { value: 'Demo m09 teacher', lang: 'en' } });
  });

  it('reject → resubmit → withdraw, each with its event and audit row; the reason is neutral and the student is told', async () => {
    const teacher = await member('m09-rejecting', { sifu: true });
    const student = await member('m09-corrected');
    const id = await request(student, teacher);
    await rejectRelationship(teacher.principal, { relationshipId: id, reason: 'dates', idempotencyKey: key() }, meta);
    expect(await statusOf(id)).toEqual({ status: 'rejected', visibility: 'involved_only' });
    expect(await notificationsOf(student.account.id, 'relationship.rejected')).toEqual([{ payload: { relationshipId: id, reason: 'dates' } }]);
    expect(await emailsTo(student.account.email, 'relationship-rejected')).toBe(1);
    const mine = await myTeachers(student.principal);
    expect(mine.requests.find((r) => r.id === id)).toMatchObject({ status: 'rejected', rejection: { reason: 'dates', text: 'The training dates need correcting.' }, can: { resubmit: true, withdraw: true } });
    const note = (await listNotifications(student.principal)).items.find((n) => n.template === 'relationship.rejected')!;
    expect(note.action).toEqual({ label: 'Correct and send again', href: `/dashboard/teachers/new?resubmit=${id}` });

    await resubmitRelationship(student.principal, { relationshipId: id, periods: [{ from: '2018', to: '2021', ongoing: false }], idempotencyKey: key() }, meta);
    expect(await statusOf(id)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
    // The corrected request's notification shows the corrected start.
    const corrected = (await listNotifications(teacher.principal)).items.find((n) => n.template === 'relationship.requested' && n.title === 'Teacher request sent again')!;
    expect(corrected.body.at(-1)).toEqual({ text: ' corrected their request and asks again to confirm that you taught them in Demo m09 Lineage. Training started: 2018.' });
    const periods = await getDb().select({ startsOn: trainingPeriod.startsOn, endsOn: trainingPeriod.endsOn, precision: trainingPeriod.precision }).from(trainingPeriod).where(eq(trainingPeriod.relationshipId, id));
    expect(periods).toEqual([{ startsOn: '2018-01-01', endsOn: '2021-01-01', precision: 'year' }]);
    expect(await notificationsOf(teacher.account.id, 'relationship.requested')).toHaveLength(2);
    expect(await emailsTo(teacher.account.email, 'relationship-requested')).toBe(2);
    // The rejection notification no longer offers to correct a request that waits again.
    expect((await listNotifications(student.principal)).items.find((n) => n.template === 'relationship.rejected')!.action).toBeNull();

    await withdrawRelationship(student.principal, { relationshipId: id, idempotencyKey: key() }, meta);
    expect(await statusOf(id)).toEqual({ status: 'withdrawn', visibility: 'involved_only' });
    expect((await events(id)).map((e) => [e.from, e.to, e.reason])).toEqual([
      [null, 'pending_teacher', null],
      ['pending_teacher', 'rejected', 'dates'],
      ['rejected', 'pending_teacher', 'resubmitted'],
      ['pending_teacher', 'withdrawn', null],
    ]);
    expect((await audits(id)).map((a) => a.action)).toEqual(['relationship.request', 'relationship.reject', 'relationship.resubmit', 'relationship.withdraw']);
    // The teacher's request notification says it was withdrawn and offers nothing.
    const teacherNote = (await listNotifications(teacher.principal)).items.find((n) => n.template === 'relationship.requested')!;
    expect(teacherNote.action).toBeNull();
  });

  it('end: the teacher marks the training as ended; the link stays verified and public, historical, and the student is told', async () => {
    const teacher = await member('m09-ending', { sifu: true });
    const student = await member('m09-ended');
    const id = await request(student, teacher, { periods: [{ from: '2019-04', to: null, ongoing: true }] });
    await approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta);
    cache.revalidated = [];
    const ended = await endRelationship(teacher.principal, { relationshipId: id, endedOn: '2024', idempotencyKey: key() }, meta);
    // The public cache of both people and their lineage is dropped at once (plan §6.4, docs/api/lineage.md
    // §6.1): no counters job follows an end, so nothing else would drop it (M09 review, requirements-2).
    expect(cache.revalidated).toEqual(expect.arrayContaining([`person:${teacher.personId}`, `person:${student.personId}`, `lineage:${lineageId}`]));
    expect(ended.relationship).toMatchObject({ status: 'verified', visibility: 'public', historical: true, statusLabel: 'Verified · training ended', can: { end: false } });
    // The end keeps the coarser precision of the two: the period becomes 2019–2024.
    expect(ended.relationship.periods).toEqual([{ from: '2019', to: '2024', ongoing: false, precision: 'year', school: null }]);
    expect((await events(id)).at(-1)).toEqual({ from: 'verified', to: 'verified', actor: teacher.account.id, role: 'teacher', reason: 'training_ended' });
    expect((await audits(id)).at(-1)).toMatchObject({ action: 'relationship.end', reason: 'training_ended' });
    expect(await notificationsOf(student.account.id, 'relationship.ended')).toEqual([{ payload: { relationshipId: id, by: 'teacher' } }]);
    expect(await refusal(endRelationship(student.principal, { relationshipId: id, endedOn: '2024', idempotencyKey: key() }, meta))).toBe('CONFLICT');
  });
});

describe('end: the end date (M09 review, code-6)', () => {
  it('refuses an end before 1900 (also without a recorded start), in the future or before the period’s start, and changes nothing', async () => {
    const teacher = await member('m09-end-dates-teacher', { sifu: true });
    const student = await member('m09-end-dates-student');
    const id = await request(student, teacher, { periods: [{ from: '2019-04', to: null, ongoing: true }] });
    await approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta);
    const refused = async (endedOn: string) => {
      const error = (await endRelationship(student.principal, { relationshipId: id, endedOn, idempotencyKey: key() }, meta).catch((e: unknown) => e)) as {
        code: string;
        fields: Record<string, string>;
      };
      return { code: error.code, fields: error.fields };
    };
    // A period with no recorded start, as some archive records have: only the bound of 1900 applies.
    await getDb().update(trainingPeriod).set({ startsOn: null, precision: 'unknown' }).where(eq(trainingPeriod.relationshipId, id));
    expect(await refused('0001')).toEqual({ code: 'BAD_REQUEST', fields: { endedOn: "The end can't be before 1900." } });
    expect(await refused('1899-12')).toEqual({ code: 'BAD_REQUEST', fields: { endedOn: "The end can't be before 1900." } });
    expect(await refused(`${new Date().getUTCFullYear() + 1}`)).toEqual({ code: 'BAD_REQUEST', fields: { endedOn: "The end can't be in the future." } });
    // With a recorded start: not before it.
    await getDb().update(trainingPeriod).set({ startsOn: '2019-04-01', precision: 'month' }).where(eq(trainingPeriod.relationshipId, id));
    expect(await refused('2018')).toEqual({ code: 'BAD_REQUEST', fields: { endedOn: "The end can't be before the start (2019)." } });
    const periods = await getDb().select({ ongoing: trainingPeriod.ongoing, endsOn: trainingPeriod.endsOn }).from(trainingPeriod).where(eq(trainingPeriod.relationshipId, id));
    expect(periods).toEqual([{ ongoing: true, endsOn: null }]);
    expect((await events(id)).filter((e) => e.reason === 'training_ended')).toEqual([]);
    // 1900 itself is a valid end of a period without a recorded start.
    await getDb().update(trainingPeriod).set({ startsOn: null, precision: 'unknown' }).where(eq(trainingPeriod.relationshipId, id));
    const ended = await endRelationship(student.principal, { relationshipId: id, endedOn: '1900', idempotencyKey: key() }, meta);
    expect(ended.relationship.periods).toEqual([{ from: null, to: '1900', ongoing: false, precision: 'year', school: null }]);
  });
});

describe('the authorization matrix (role × ownership)', () => {
  type Who = 'student' | 'teacher' | 'stranger' | 'reviewer' | 'unverifiedStaff';
  const people = {} as Record<Who, { principal: Member['principal'] }>;

  // New people for every case: the request window counts each student's requests to one teacher
  // (REQUESTS_TO_ONE_TEACHER_PER_WINDOW), and the cases are about who may act, not about the window.
  beforeEach(async () => {
    people.teacher = await member('m09-matrix-teacher', { sifu: true });
    people.student = await member('m09-matrix-student');
    people.stranger = await member('m09-matrix-stranger', { sifu: true });
    people.reviewer = await staff('m09-matrix-reviewer', 'moderator');
    people.unverifiedStaff = await staff('m09-matrix-staff', 'admin', { unverified: true });
  });

  // A lineage of its own per case: one active request per (teacher, student, lineage).
  const pending = async () => request(people.student as Member, people.teacher as Member, { lineageId: await newLineage('m09-matrix') });
  const rejected = async () => {
    const id = await pending();
    await rejectRelationship(people.teacher.principal, { relationshipId: id, reason: 'details', idempotencyKey: key() }, meta);
    return id;
  };
  const verified = async () => {
    const id = await pending();
    await approveRelationship(people.teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta);
    return id;
  };

  const actions = {
    approve: { setup: pending, run: (who: Who, id: string) => approveRelationship(people[who].principal, { relationshipId: id, idempotencyKey: key() }, meta) },
    reject: { setup: pending, run: (who: Who, id: string) => rejectRelationship(people[who].principal, { relationshipId: id, reason: 'lineage', idempotencyKey: key() }, meta) },
    withdraw: { setup: pending, run: (who: Who, id: string) => withdrawRelationship(people[who].principal, { relationshipId: id, idempotencyKey: key() }, meta) },
    resubmit: { setup: rejected, run: (who: Who, id: string) => resubmitRelationship(people[who].principal, { relationshipId: id, periods: ongoingFrom('2020'), idempotencyKey: key() }, meta) },
    end: { setup: verified, run: (who: Who, id: string) => endRelationship(people[who].principal, { relationshipId: id, endedOn: '2025', idempotencyKey: key() }, meta) },
    get: { setup: pending, run: (who: Who, id: string) => getRelationship(people[who].principal, { id }) },
  } as const;

  // OK: allowed. 404: a stranger learns nothing, not even that the request exists (plan §6.4).
  // 403: a participant or a reviewer whose side may not do this. Reviewers read, never act.
  const matrix: Record<keyof typeof actions, Record<Who, 'OK' | 'FORBIDDEN' | 'NOT_FOUND'>> = {
    approve: { teacher: 'OK', student: 'FORBIDDEN', stranger: 'NOT_FOUND', reviewer: 'FORBIDDEN', unverifiedStaff: 'NOT_FOUND' },
    reject: { teacher: 'OK', student: 'FORBIDDEN', stranger: 'NOT_FOUND', reviewer: 'FORBIDDEN', unverifiedStaff: 'NOT_FOUND' },
    withdraw: { teacher: 'FORBIDDEN', student: 'OK', stranger: 'NOT_FOUND', reviewer: 'FORBIDDEN', unverifiedStaff: 'NOT_FOUND' },
    resubmit: { teacher: 'FORBIDDEN', student: 'OK', stranger: 'NOT_FOUND', reviewer: 'FORBIDDEN', unverifiedStaff: 'NOT_FOUND' },
    end: { teacher: 'OK', student: 'OK', stranger: 'NOT_FOUND', reviewer: 'FORBIDDEN', unverifiedStaff: 'NOT_FOUND' },
    get: { teacher: 'OK', student: 'OK', stranger: 'NOT_FOUND', reviewer: 'OK', unverifiedStaff: 'NOT_FOUND' },
  };

  for (const [action, row] of Object.entries(matrix) as [keyof typeof actions, Record<Who, string>][]) {
    for (const [who, expected] of Object.entries(row) as [Who, string][]) {
      it(`${action} by the ${who}: ${expected}`, async () => {
        const id = await actions[action].setup();
        const before = { status: await statusOf(id), events: (await events(id)).length, audits: (await audits(id)).length };
        expect(await refusal(actions[action].run(who, id))).toBe(expected);
        if (expected !== 'OK' || action === 'get') {
          // A refusal (or a read) changes nothing and writes nothing.
          expect({ status: await statusOf(id), events: (await events(id)).length, audits: (await audits(id)).length }).toEqual(before);
        } else {
          expect((await events(id)).length).toBe(before.events + 1);
          expect((await audits(id)).length).toBe(before.audits + 1);
        }
      });
    }
  }

  it('a request for an id that does not exist is 404, like one the caller may not see', async () => {
    expect(await refusal(approveRelationship(people.teacher.principal, { relationshipId: uuidv7(), idempotencyKey: key() }, meta))).toBe('NOT_FOUND');
    expect(await refusal(getRelationship(people.reviewer.principal, { id: uuidv7() }))).toBe('NOT_FOUND');
  });

  it('without a session every procedure refuses with 401', async () => {
    expect(await refusal(requestTeacher(null, { teacherId: uuidv7(), periods: ongoingFrom(), idempotencyKey: key() }, meta))).toBe('UNAUTHORIZED');
    expect(await refusal(approveRelationship(null, { relationshipId: uuidv7(), idempotencyKey: key() }, meta))).toBe('UNAUTHORIZED');
    expect(await refusal(myTeachers(null))).toBe('UNAUTHORIZED');
  });
});

describe('requests: checks and idempotency', () => {
  it('refuses yourself, a hidden or unknown teacher, a teacher without an account, bad periods and a duplicate', async () => {
    const teacher = await member('m09-checks-teacher', { sifu: true });
    const student = await member('m09-checks-student');
    const hidden = await member('m09-checks-hidden', { hidden: true });
    const fields = async (input: Record<string, unknown>) => {
      const error = (await requestTeacher(student.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key(), ...input } as never, meta).catch((e: unknown) => e)) as {
        code: string;
        fields: Record<string, string>;
      };
      return { code: error.code, fields: Object.keys(error.fields ?? {}) };
    };
    expect(await fields({ teacherId: student.personId })).toEqual({ code: 'BAD_REQUEST', fields: ['teacherId'] });
    expect(await fields({ teacherId: hidden.personId })).toEqual({ code: 'BAD_REQUEST', fields: ['teacherId'] });
    expect(await fields({ teacherId: uuidv7() })).toEqual({ code: 'BAD_REQUEST', fields: ['teacherId'] });
    expect(await fields({ periods: [{ from: null, to: null, ongoing: true }] })).toEqual({ code: 'BAD_REQUEST', fields: ['periods.0.from'] });
    expect(await fields({ periods: [{ from: '2020', to: null, ongoing: false }] })).toEqual({ code: 'BAD_REQUEST', fields: ['periods.0.to'] });
    expect(await fields({ periods: [{ from: '2020', to: '2019', ongoing: false }] })).toEqual({ code: 'BAD_REQUEST', fields: ['periods.0.to'] });
    expect(await fields({ periods: [{ from: '1899', to: null, ongoing: true }] })).toEqual({ code: 'BAD_REQUEST', fields: ['periods.0.from'] });
    expect(await fields({ periods: [{ from: `${new Date().getUTCFullYear() + 1}`, to: null, ongoing: true }] })).toEqual({ code: 'BAD_REQUEST', fields: ['periods.0.from'] });
    expect(await fields({ periods: [{ from: '2020-13', to: null, ongoing: true }] })).toEqual({ code: 'BAD_REQUEST', fields: ['periods.0.from'] });
    // A teacher with no lineage of their own: the student has to choose one.
    expect(await fields({ lineageId: null })).toEqual({ code: 'BAD_REQUEST', fields: ['lineageId'] });

    const unclaimed = uuidv7();
    await getDb().insert(person).values({ id: unclaimed, slug: `demo-m09-unclaimed-${unclaimed.slice(-6)}`, kind: 'living', stewardship: 'unclaimed', visibility: 'public' });
    await getDb().execute(sql`INSERT INTO person_name (person_id, value, script, lang, is_primary) VALUES (${unclaimed}::uuid, 'Demo Unclaimed', 'Latn', 'en', true)`);
    expect(await fields({ teacherId: unclaimed })).toEqual({ code: 'BAD_REQUEST', fields: ['teacherId'] });

    await request(student, teacher);
    expect(await fields({})).toEqual({ code: 'CONFLICT', fields: ['teacherId'] });
  });

  it('the same idempotency key replays the request: one row, one event, one e-mail', async () => {
    const teacher = await member('m09-replay-teacher', { sifu: true });
    const student = await member('m09-replay-student');
    const input = { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() };
    const [a, b] = await Promise.all([requestTeacher(student.principal, input, meta), requestTeacher(student.principal, input, meta)]);
    expect(a.relationship.id).toBe(b.relationship.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await events(a.relationship.id)).toHaveLength(1);
    expect(await emailsTo(teacher.account.email, 'relationship-requested')).toBe(1);
  });

  it('a double approval (the same key twice at once, then a new key) records one approval and sends one e-mail each', async () => {
    const teacher = await member('m09-double-teacher', { sifu: true });
    const student = await member('m09-double-student');
    const id = await request(student, teacher);
    const same = { relationshipId: id, idempotencyKey: key() };
    const outcomes = await Promise.all([approveRelationship(teacher.principal, same, meta), approveRelationship(teacher.principal, same, meta)]);
    expect(outcomes.map((o) => o.replayed).sort()).toEqual([false, true]);
    expect((await approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta)).replayed).toBe(true);
    expect((await events(id)).filter((e) => e.to === 'verified')).toHaveLength(1);
    expect((await audits(id)).filter((a) => a.action === 'relationship.approve')).toHaveLength(1);
    expect(await emailsTo(student.account.email, 'relationship-approved')).toBe(1);
    expect(await emailsTo(teacher.account.email, 'relationship-approved')).toBe(1);
  });

  it('a key reused for another change is refused', async () => {
    const teacher = await member('m09-reuse-teacher', { sifu: true });
    const student = await member('m09-reuse-student');
    const id = await request(student, teacher);
    const reused = key();
    await rejectRelationship(teacher.principal, { relationshipId: id, reason: 'dates', idempotencyKey: reused }, meta);
    const other = await request(student, await member('m09-reuse-other', { sifu: true }));
    expect(await refusal(approveRelationship(teacher.principal, { relationshipId: other, idempotencyKey: reused }, meta))).toBe('NOT_FOUND');
    expect(await refusal(approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: reused }, meta))).toBe('CONFLICT');
  });

  it('a request key sent again with another teacher or lineage is refused, and nothing is sent to that teacher (code review)', async () => {
    const first = await member('m09-rekey-first', { sifu: true });
    const second = await member('m09-rekey-second', { sifu: true });
    const student = await member('m09-rekey-student');
    const otherLineage = await newLineage('m09-rekey');
    const reused = key();
    const id = (await requestTeacher(student.principal, { teacherId: first.personId, lineageId, periods: ongoingFrom(), idempotencyKey: reused }, meta)).relationship.id;
    // The same request again (a double click): the replay.
    expect((await requestTeacher(student.principal, { teacherId: first.personId, lineageId, periods: ongoingFrom(), idempotencyKey: reused }, meta)).relationship.id).toBe(id);
    expect(await refusal(requestTeacher(student.principal, { teacherId: second.personId, lineageId, periods: ongoingFrom(), idempotencyKey: reused }, meta))).toBe('CONFLICT');
    expect(await refusal(requestTeacher(student.principal, { teacherId: first.personId, lineageId: otherLineage, periods: ongoingFrom(), idempotencyKey: reused }, meta))).toBe('CONFLICT');
    const toSecond = await getDb().select({ id: teachingRelationship.id }).from(teachingRelationship).where(eq(teachingRelationship.teacherPersonId, second.personId));
    expect(toSecond).toEqual([]);
    expect(await emailsTo(second.account.email, 'relationship-requested')).toBe(0);
  });

  it('a request → withdraw loop stops at the request window, and the teacher gets one request e-mail a day (M09 review, code-2)', async () => {
    const teacher = await member('m09-loop-teacher', { sifu: true });
    const student = await member('m09-loop-student');
    for (let i = 0; i < REQUESTS_TO_ONE_TEACHER_PER_WINDOW; i += 1) {
      const id = await request(student, teacher);
      await withdrawRelationship(student.principal, { relationshipId: id, idempotencyKey: key() }, meta);
    }
    const error = (await requestTeacher(student.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta).catch((e: unknown) => e)) as {
      code: string;
      message: string;
    };
    expect(error).toMatchObject({ code: 'TOO_MANY_REQUESTS', message: TEACHER_REQUEST_LIMIT_MESSAGE });
    // Every request reached the dashboard, the first one only by e-mail; the refused one nowhere.
    expect(await notificationsOf(teacher.account.id, 'relationship.requested')).toHaveLength(REQUESTS_TO_ONE_TEACHER_PER_WINDOW);
    expect(await emailsTo(teacher.account.email, 'relationship-requested')).toBe(1);
    const rows = await getDb().select({ id: teachingRelationship.id }).from(teachingRelationship).where(eq(teachingRelationship.studentPersonId, student.personId));
    expect(rows).toHaveLength(REQUESTS_TO_ONE_TEACHER_PER_WINDOW);

    // Other teachers: the account's own window, REQUESTS_PER_WINDOW requests in all.
    for (let i = REQUESTS_TO_ONE_TEACHER_PER_WINDOW; i < REQUESTS_PER_WINDOW; i += 1) await request(student, await member(`m09-loop-other-${i}`));
    const last = await member('m09-loop-last');
    const over = (await requestTeacher(student.principal, { teacherId: last.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta).catch((e: unknown) => e)) as {
      code: string;
      message: string;
    };
    expect(over).toMatchObject({ code: 'TOO_MANY_REQUESTS', message: REQUEST_LIMIT_MESSAGE });
    expect(await notificationsOf(last.account.id, 'relationship.requested')).toEqual([]);
  });

  it('a corrected request counts in the window, and is e-mailed to the teacher who declined it (M09 review, code-2)', async () => {
    const teacher = await member('m09-window-teacher', { sifu: true });
    const student = await member('m09-window-student');
    const id = await request(student, teacher);
    await rejectRelationship(teacher.principal, { relationshipId: id, reason: 'dates', idempotencyKey: key() }, meta);
    await resubmitRelationship(student.principal, { relationshipId: id, periods: ongoingFrom('2018'), idempotencyKey: key() }, meta);
    expect(await emailsTo(teacher.account.email, 'relationship-requested')).toBe(2);
    await rejectRelationship(teacher.principal, { relationshipId: id, reason: 'dates', idempotencyKey: key() }, meta);
    await resubmitRelationship(student.principal, { relationshipId: id, periods: ongoingFrom('2017'), idempotencyKey: key() }, meta);
    await rejectRelationship(teacher.principal, { relationshipId: id, reason: 'dates', idempotencyKey: key() }, meta);
    expect(await refusal(resubmitRelationship(student.principal, { relationshipId: id, periods: ongoingFrom('2016'), idempotencyKey: key() }, meta))).toBe('TOO_MANY_REQUESTS');
    expect(await statusOf(id)).toEqual({ status: 'rejected', visibility: 'involved_only' });
  });

  it('a resubmit counts against the pending requests cap like a new request (code review)', async () => {
    const teacher = await member('m09-cap-teacher', { sifu: true });
    const student = await member('m09-cap-student');
    const id = await request(student, teacher);
    await rejectRelationship(teacher.principal, { relationshipId: id, reason: 'dates', idempotencyKey: key() }, meta);
    // Twenty other requests wait (MAX_PENDING_REQUESTS), written directly: the cap is the point here.
    for (let i = 0; i < 20; i += 1) {
      const other = uuidv7();
      await getDb().insert(person).values({ id: other, slug: `demo-m09-cap-${other.slice(-12)}`, kind: 'living', stewardship: 'unclaimed', visibility: 'public' });
      await getDb()
        .insert(teachingRelationship)
        .values({ id: uuidv7(), teacherPersonId: other, studentPersonId: student.personId, lineageId, status: 'pending_teacher', visibility: 'involved_only', verificationPath: 'teacher_approval' });
    }
    expect(await refusal(resubmitRelationship(student.principal, { relationshipId: id, periods: ongoingFrom('2018'), idempotencyKey: key() }, meta))).toBe('TOO_MANY_REQUESTS');
    expect(await statusOf(id)).toEqual({ status: 'rejected', visibility: 'involved_only' });
  });
});

describe('approval: the plan, the display preference and the people', () => {
  it('Free Sifu with five students: the sixth approval is refused with the entitlement refusal and the request stays pending (DEFAULT D06)', async () => {
    const teacher = await member('m09-limit-teacher', { sifu: true });
    for (let i = 0; i < 5; i++) {
      const s = await member(`m09-limit-student-${i}`);
      await approveRelationship(teacher.principal, { relationshipId: await request(s, teacher), idempotencyKey: key() }, meta);
    }
    const sixth = await member('m09-limit-sixth');
    const id = await request(sixth, teacher);
    const error = (await approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta).catch((e: unknown) => e)) as {
      code: string;
      message: string;
      details: { entitlement: unknown };
    };
    expect(error.code).toBe('ENTITLEMENT_REQUIRED');
    expect(error.message).toBe('You have approved 5 of 5 students on Free Sifu. The request stays pending.');
    expect(error.details.entitlement).toEqual({ ok: false, code: 'quota', plan: 'free_sifu', limit: 5, current: 5, grantedBy: 'pro_sifu' });
    expect(await statusOf(id)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
    expect(await events(id)).toHaveLength(1);
    const queue = await studentRequests(teacher.principal);
    expect(queue.allowance).toEqual({ approved: 5, limit: 5, planName: 'Free Sifu' });
    expect(queue.upgrade).toMatchObject({ feature: 'approve_students', allowance: { current: 5, limit: 5 }, to: { code: 'pro_sifu' } });
  });

  it('a Student account cannot approve: the refusal names the plan, and the request stays pending', async () => {
    const teacher = await member('m09-student-type-teacher');
    const student = await member('m09-student-type-student');
    const id = await request(student, teacher);
    const error = (await approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta).catch((e: unknown) => e)) as {
      code: string;
      details: { entitlement: { code: string } };
    };
    expect(error.code).toBe('ENTITLEMENT_REQUIRED');
    expect(error.details.entitlement.code).toBe('plan');
    expect(await statusOf(id)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
  });

  it('a resubmit without a lineage goes to the teacher’s own lineage, as the form’s "The teacher’s own lineage" says (code review)', async () => {
    const own = await newLineage('m09-own');
    const grand = await member('m09-own-grand', { sifu: true });
    const teacher = await member('m09-own-teacher', { sifu: true });
    const student = await member('m09-own-student');
    // The teacher's own public line: a student of `grand` in `own`.
    const line = await request(teacher, grand, { lineageId: own });
    await approveRelationship(grand.principal, { relationshipId: line, idempotencyKey: key() }, meta);
    const id = await request(student, teacher);
    await rejectRelationship(teacher.principal, { relationshipId: id, reason: 'lineage', idempotencyKey: key() }, meta);
    await resubmitRelationship(student.principal, { relationshipId: id, lineageId: null, periods: ongoingFrom(), idempotencyKey: key() }, meta);
    const [row] = await getDb().select({ lineageId: teachingRelationship.lineageId, status: teachingRelationship.status }).from(teachingRelationship).where(eq(teachingRelationship.id, id));
    expect(row).toEqual({ lineageId: own, status: 'pending_teacher' });
  });

  it('a request whose student profile was removed is never approved and stays pending (code review)', async () => {
    const teacher = await member('m09-removed-teacher', { sifu: true });
    const student = await member('m09-removed-student');
    const id = await request(student, teacher);
    await getDb().update(person).set({ deletedAt: new Date() }).where(eq(person.id, student.personId));
    expect(await refusal(approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta))).toBe('CONFLICT');
    expect(await statusOf(id)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
    expect((await events(id)).filter((e) => e.to === 'verified')).toEqual([]);
  });

  it('two teachers in two lineages are approved independently; the display preference moves the primary line (DEFAULT D05)', async () => {
    const otherLineage = await newLineage('m09-second');
    const first = await member('m09-first-teacher', { sifu: true });
    const second = await member('m09-second-teacher', { sifu: true });
    const student = await member('m09-two-teachers');
    const a = await request(student, first);
    const b = await request(student, second, { lineageId: otherLineage, displayPrimary: true });
    await approveRelationship(first.principal, { relationshipId: a, idempotencyKey: key() }, meta);
    expect(await statusOf(b)).toEqual({ status: 'pending_teacher', visibility: 'involved_only' });
    await approveRelationship(second.principal, { relationshipId: b, idempotencyKey: key() }, meta);
    const rows = await getDb()
      .select({ id: teachingRelationship.id, primary: teachingRelationship.isDisplayPrimary, status: teachingRelationship.status })
      .from(teachingRelationship)
      .where(eq(teachingRelationship.studentPersonId, student.personId));
    expect(rows.find((r) => r.id === a)).toMatchObject({ status: 'verified', primary: false });
    expect(rows.find((r) => r.id === b)).toMatchObject({ status: 'verified', primary: true });
  });

  it('a profile whose owner withdrew its publication stays hidden after an approval (DEFAULT D03)', async () => {
    const teacher = await member('m09-consent-teacher', { sifu: true });
    const student = await member('m09-consent-student', { hidden: true });
    await getDb().execute(sql`INSERT INTO consent_record (user_id, kind, document_version, action, occurred_at)
      VALUES (${student.account.id}::uuid, 'publication', 'v1', 'granted', now() - interval '1 hour'),
             (${student.account.id}::uuid, 'publication', 'v1', 'withdrawn', now())`);
    const id = await request(student, teacher);
    await approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta);
    const [row] = await getDb().select({ visibility: person.visibility }).from(person).where(eq(person.id, student.personId));
    expect(row!.visibility).toBe('involved_only');
    expect(await statusOf(id)).toEqual({ status: 'verified', visibility: 'public' });
  });

  // M09 review, code-1 and security-1: the owner never granted publication (onboarding with the box
  // unticked), an approval made the profile public, and the owner then hid it. The hide must survive
  // the next approval on both paths: the profile editor and /account/privacy.
  const OWNER_NAMES = [{ value: 'Demo Hidden Owner', script: 'Latn', lang: 'en', isPrimary: true }];
  const hideAfterApproval = async (label: string, hide: (owner: Member) => Promise<unknown>) => {
    const first = await member(`${label}-first`, { sifu: true });
    const second = await member(`${label}-second`, { sifu: true });
    const owner = await member(`${label}-owner`, { hidden: true });
    await approveRelationship(first.principal, { relationshipId: await request(owner, first), idempotencyKey: key() }, meta);
    expect(await visibilityOf(owner.personId)).toBe('public');
    expect(await publicationActions(owner.account.id)).toEqual([]);
    // A student finds the owner while the profile is public and sends a request.
    const student = await member(`${label}-student`);
    const toOwner = await request(student, owner);
    await hide(owner);
    expect(await visibilityOf(owner.personId)).toBe('involved_only');
    // The hide is on record as the owner's refusal of publication.
    expect(await publicationActions(owner.account.id)).toEqual(['withdrawn']);
    const next = await request(owner, second, { lineageId: await newLineage(`${label}-next`) });
    await approveRelationship(second.principal, { relationshipId: next, idempotencyKey: key() }, meta);
    expect(await statusOf(next)).toEqual({ status: 'verified', visibility: 'public' });
    expect(await visibilityOf(owner.personId)).toBe('involved_only');
    // And when the owner is the teacher: approving that request does not publish them either.
    await getDb().update(authUser).set({ accountType: 'sifu' }).where(eq(authUser.id, owner.account.id));
    await approveRelationship(owner.principal, { relationshipId: toOwner, idempotencyKey: key() }, meta);
    expect(await statusOf(toOwner)).toEqual({ status: 'verified', visibility: 'public' });
    expect(await visibilityOf(owner.personId)).toBe('involved_only');
    // Ticking the box again publishes the profile, with a grant: approvals publish it again.
    await profileUpdate(owner.principal, { names: OWNER_NAMES, showPublicly: true }, meta);
    expect(await publicationActions(owner.account.id)).toEqual(['withdrawn', 'granted']);
  };

  it('a profile that an approval made public and its owner then hid in the profile editor stays hidden after the next approval (DEFAULT D03)', async () => {
    await hideAfterApproval('m09-hide-editor', (owner) =>
      profileUpdate(owner.principal, { names: OWNER_NAMES, showPublicly: false }, meta),
    );
  });

  it('a profile that an approval made public and its owner then hid on /account/privacy stays hidden after the next approval (DEFAULT D03)', async () => {
    await hideAfterApproval('m09-hide-privacy', async (owner) => {
      expect(await consentWithdraw(owner.principal, { kinds: ['publication'] }, meta)).toEqual({ withdrawn: ['publication'], profileHidden: true });
    });
  });
});

describe('a pending request is visible only to its people and the reviewers (DEFAULT D03)', () => {
  it('the teacher’s list of students shows it to the student, the teacher and a reviewer, never to a stranger or anonymously', async () => {
    const teacher = await member('m09-visible-teacher', { sifu: true });
    const student = await member('m09-visible-student', { hidden: true });
    const stranger = await member('m09-visible-stranger');
    const reviewer = await staff('m09-visible-reviewer', 'archivist');
    const unverified = await staff('m09-visible-unverified', 'moderator', { unverified: true });
    await request(student, teacher);
    const students = async (principal: Member['principal'] | null) =>
      (await personStudents(principal, { slug: teacher.slug, page: 1, pageSize: 12, order: 'name' })).own.map((s) => s.person.id);
    expect(await students(student.principal)).toEqual([student.personId]);
    expect(await students(teacher.principal)).toEqual([student.personId]);
    expect(await students(reviewer.principal)).toEqual([student.personId]);
    expect(await students(stranger.principal)).toEqual([]);
    expect(await students(unverified.principal)).toEqual([]);
    expect(await students(null)).toEqual([]);
    // The hidden student's own profile: the reviewer may open it, a stranger gets the 404 of a missing person.
    expect((await personProfile(reviewer.principal, { slug: student.slug })).id).toBe(student.personId);
    expect(await refusal(personProfile(stranger.principal, { slug: student.slug }))).toBe('NOT_FOUND');
  });
});

describe('lineage.recompute', () => {
  it('rewrites lineage_membership from the public views only and revalidates only its own tag through the internal route', async () => {
    const recomputed = await newLineage('m09-recompute');
    const teacher = await member('m09-recompute-teacher', { sifu: true });
    const student = await member('m09-recompute-student');
    const hiddenStudent = await member('m09-recompute-hidden');
    const id = await request(student, teacher, { lineageId: recomputed });
    await request(hiddenStudent, teacher, { lineageId: recomputed });
    await approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta);
    expect(await recomputeLineageMembership(getDb(), recomputed)).toBe(2);
    const members = await getDb().select({ personId: lineageMembership.personId }).from(lineageMembership).where(eq(lineageMembership.lineageId, recomputed));
    // The pending request is not counted (plan §6.2).
    expect(members.map((m) => m.personId).sort()).toEqual([teacher.personId, student.personId].sort());
    // With the teacher as the lineage's root: generations below the root (the smallest, GROUP BY min).
    await getDb().update(lineage).set({ rootPersonId: teacher.personId }).where(eq(lineage.id, recomputed));
    expect(await recomputeLineageMembership(getDb(), recomputed)).toBe(2);
    const depths = await getDb().select({ personId: lineageMembership.personId, depth: lineageMembership.depth }).from(lineageMembership).where(eq(lineageMembership.lineageId, recomputed));
    expect(Object.fromEntries(depths.map((d) => [d.personId, d.depth]))).toEqual({ [teacher.personId]: 0, [student.personId]: 1 });

    const posted: string[][] = [];
    const lines: string[] = [];
    const handler = lineageRecomputeHandler(getDb(), (line) => lines.push(line), async (tags) => {
      posted.push(tags);
    });
    // A job queued before the M09 review also carries the change's tags: they are not posted again.
    await handler([{ id: 'job-1', data: { lineageIds: [recomputed], tags: [`person:${teacher.personId}`] }, retryCount: 0, retryLimit: 5 } as never]);
    expect(posted).toEqual([[`lineage-membership:${recomputed}`]]);
    expect(lines.join('\n')).not.toContain('Demo');
  });
});
