// Governance (milestone M25; docs/adr/0028-governance.md; specification §15, §16.1), against a
// migrated throwaway database:
//   - succession: only the owner nominates (a verified student on a plan that allows it) and
//     revokes, only the nominee answers and requests; a request needs evidence and either a
//     reported death or more than 180 days without activity; inactivity alone never transfers
//     anything and never marks anyone deceased, and an approval moves the school listings and the
//     organization administration only (the record, its life status and its teaching history stay);
//   - lineage dispute reports change nothing by themselves; the reported people are no parties; an
//     upheld report sets the relationship in arbitration, a report not upheld changes nothing;
//   - appeals: one per decision, by a party, never decided by the member of staff who decided;
//   - stewardship: a shared record changes only by an archivist (an archival edit or an approved
//     proposal), each change in its append-only history, which app_rw cannot rewrite.
// Fictional data only (D20): demo- slugs, example.test addresses, generated PDFs.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, authUser, lineageReport, notification, organization, organizationAdmin, person, personName, recordRevision, reviewCase, school, successionNomination, successionRequest, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { getPartyCase } from './cases';
import { appealDecision, reportLineage } from './disputes';
import { uploadEvidence } from './evidence';
import { createGrant } from './grants';
import { applyOrganization } from './organizations';
import { assignReviewCase, decideReviewCase, getReviewCase, updateArchiveRecord } from './review';
import { createSchool } from './schools';
import { proposeRecordChange, proposeOptions, recordHistory } from './stewardship';
import { answerNomination, nominateSuccessor, requestSuccession, revokeNomination, successionMine } from './succession';
import { key, type Member, member, meta, newLineage, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
const root = mkdtempSync(path.join(tmpdir(), 'wcr-governance-int-'));
let admin: Awaited<ReturnType<typeof staff>>;
let admin2: Awaited<ReturnType<typeof staff>>;
let moderator: Awaited<ReturnType<typeof staff>>;
let moderator2: Awaited<ReturnType<typeof staff>>;
let archivist: Awaited<ReturnType<typeof staff>>;

beforeAll(async () => {
  process.env.EVIDENCE_STORAGE = 'filesystem';
  process.env.EVIDENCE_STORAGE_DIR = root;
  testDb = await startAuthTestDatabase();
  // The GeoNames places (a school needs a city).
  const { seedDatabase } = await import('../db/seed');
  await seedDatabase(testDb.url);
  admin = await staff('gov-admin', 'admin');
  admin2 = await staff('gov-admin-2', 'admin');
  moderator = await staff('gov-moderator', 'moderator');
  moderator2 = await staff('gov-moderator-2', 'moderator');
  archivist = await staff('gov-archivist', 'archivist');
}, 120_000);

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(root, { recursive: true, force: true });
});

function fictionalPdf(seed: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`%PDF-1.4\n% Demo evidence ${seed}, invented for the WingChunRoots tests.\n%%EOF\n`);
}

async function upload(m: Pick<Member, 'principal'>, seed = key()) {
  const bytes = fictionalPdf(seed);
  return uploadEvidence(m.principal, { declaredLength: bytes.length, body: new Response(bytes).body!, name: encodeURIComponent(`demo-${seed.slice(0, 8)}.pdf`), caseId: null }, meta);
}

async function grant(m: Member, planCode: 'pro_sifu' | 'premium_student') {
  await createGrant(admin.principal, { email: m.account.email, planCode, reason: 'M25 governance test (fictional)' }, meta);
}

async function verified(teacher: Member, student: Member) {
  const lineageId = await newLineage('m25-gov');
  const id = uuidv7();
  await getDb().insert(teachingRelationship).values({ id, teacherPersonId: teacher.personId, studentPersonId: student.personId, lineageId, status: 'verified', visibility: 'public' });
  return id;
}

/** The owner's account without any activity for `days` days. */
async function idle(m: Member, days: number) {
  // The account itself is older than its last activity, as a real one is.
  await getDb().execute(
    sql`UPDATE auth_user SET last_active_at = now() - make_interval(days => ${days}), created_at = now() - make_interval(days => ${days + 30}) WHERE id = ${m.account.id}::uuid`,
  );
  await getDb().execute(sql`UPDATE auth_session SET updated_at = now() - make_interval(days => ${days}), created_at = now() - make_interval(days => ${days}) WHERE user_id = ${m.account.id}::uuid`);
}

/** A Professional Sifu, their verified student on Premium Student, and an accepted nomination. */
async function succession() {
  const owner = await member('gov-owner', { sifu: true });
  const heir = await member('gov-heir');
  await grant(owner, 'pro_sifu');
  await grant(heir, 'premium_student');
  const relationshipId = await verified(owner, heir);
  const { nomination } = await nominateSuccessor(owner.principal, { successorPersonId: heir.personId }, meta);
  await answerNomination(heir.principal, { nominationId: nomination.id, answer: 'accept' }, meta);
  return { owner, heir, relationshipId, nominationId: nomination.id };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? 'THROWN';
  }
}

async function decide(who: { principal: Member['principal'] }, caseId: string, decision: 'verify' | 'reject', reason = 'A fictional reason.', assign = true) {
  if (assign) await assignReviewCase(who.principal, { caseId, assigneeId: who.principal.user.id, idempotencyKey: key() }, meta);
  return decideReviewCase(who.principal, { caseId, decision, reason, idempotencyKey: key() }, meta);
}

async function lifeStatusOf(personId: string) {
  const [row] = await getDb().select({ lifeStatus: person.lifeStatus, kind: person.kind }).from(person).where(eq(person.id, personId));
  return row!;
}

describe('succession: nomination', () => {
  it('only a verified student on Premium Student or Professional Sifu can be nominated, by an owner whose plan allows it', async () => {
    const owner = await member('gov-free-owner', { sifu: true });
    const heir = await member('gov-free-heir');
    await verified(owner, heir);
    // Free Sifu: the feature is not in the plan.
    expect(await code(nominateSuccessor(owner.principal, { successorPersonId: heir.personId }, meta))).toBe('ENTITLEMENT_REQUIRED');
    await grant(owner, 'pro_sifu');
    // A Free Student nominee is refused (DEFAULT M25 question 2), as the field's error.
    expect(await code(nominateSuccessor(owner.principal, { successorPersonId: heir.personId }, meta))).toBe('BAD_REQUEST');
    // Someone who is not a verified student of the owner.
    const stranger = await member('gov-stranger');
    await grant(stranger, 'premium_student');
    expect(await code(nominateSuccessor(owner.principal, { successorPersonId: stranger.personId }, meta))).not.toBe('ok');
    await grant(heir, 'premium_student');
    const { nomination } = await nominateSuccessor(owner.principal, { successorPersonId: heir.personId }, meta);
    expect(nomination.status).toBe('pending');
    // A repeated submit is the same nomination; one live nomination per owner.
    expect((await nominateSuccessor(owner.principal, { successorPersonId: heir.personId }, meta)).nomination.id).toBe(nomination.id);
    const second = await member('gov-second-heir');
    await grant(second, 'premium_student');
    await verified(owner, second);
    expect(await code(nominateSuccessor(owner.principal, { successorPersonId: second.personId }, meta))).toBe('CONFLICT');
    const page = await successionMine(heir.principal);
    expect(page.received.map((r) => r.id)).toEqual([nomination.id]);
  });

  it('only the nominee answers, only the owner revokes; a revocation closes a waiting request and its case', async () => {
    const s = await succession();
    expect(await code(answerNomination(s.owner.principal, { nominationId: s.nominationId, answer: 'decline' }, meta))).toBe('NOT_FOUND');
    expect(await code(revokeNomination(s.heir.principal, { nominationId: s.nominationId }, meta))).toBe('NOT_FOUND');
    await idle(s.owner, 200);
    const file = await upload(s.heir);
    const { request } = await requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'inactivity', note: 'A fictional request.', evidenceIds: [file.id], idempotencyKey: key() }, meta);
    await revokeNomination(s.owner.principal, { nominationId: s.nominationId }, meta);
    const [r] = await getDb().select({ status: successionRequest.status }).from(successionRequest).where(eq(successionRequest.id, request.id));
    expect(r!.status).toBe('withdrawn');
    const [c] = await getDb().select({ status: reviewCase.status }).from(reviewCase).where(eq(reviewCase.id, request.caseId));
    expect(c!.status).not.toBe('open');
    const [n] = await getDb().select({ status: successionNomination.status, revokedAt: successionNomination.revokedAt }).from(successionNomination).where(eq(successionNomination.id, s.nominationId));
    expect(n!.status).toBe('revoked');
    expect(n!.revokedAt).not.toBeNull();
  });
});

describe('succession: requests and the transfer', () => {
  it('inactivity within 180 days is refused; a request needs evidence; inactivity alone never marks anyone deceased', async () => {
    const s = await succession();
    const before = await lifeStatusOf(s.owner.personId);
    await idle(s.owner, 100);
    const file = await upload(s.heir);
    expect(await code(requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'inactivity', note: 'A fictional request.', evidenceIds: [file.id], idempotencyKey: key() }, meta))).toBe('CONFLICT');
    await idle(s.owner, 181);
    expect(await code(requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'inactivity', note: 'A fictional request.', evidenceIds: [], idempotencyKey: key() }, meta))).toBe('BAD_REQUEST');
    // A pending nomination (not accepted yet) cannot ask, and the owner never asks for themselves.
    expect(await code(requestSuccession(s.owner.principal, { nominationId: s.nominationId, basis: 'inactivity', note: 'A fictional request.', evidenceIds: [file.id], idempotencyKey: key() }, meta))).toBe('NOT_FOUND');
    const { request } = await requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'inactivity', note: 'A fictional request.', evidenceIds: [file.id], idempotencyKey: key() }, meta);
    expect(request.status).toBe('pending');
    // Nothing transfers and nothing about the owner changes until an administrator decides.
    expect(await lifeStatusOf(s.owner.personId)).toEqual(before);
    const [c] = await getDb().select({ kind: reviewCase.kind, status: reviewCase.status }).from(reviewCase).where(eq(reviewCase.id, request.caseId));
    expect(c).toEqual({ kind: 'succession_request', status: 'open' });
  });

  it('only an administrator decides; an approval moves the schools and organizations and keeps the record, its life status and its history', async () => {
    const s = await succession();
    const city = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM place ORDER BY population DESC NULLS LAST, id LIMIT 1`);
    const saved = await createSchool(s.owner.principal, { name: 'Demo Succession Hall', placeId: city.rows[0]!.id, locationPrivacy: 'city_only', idempotencyKey: key() }, meta);
    const applied = await applyOrganization(
      s.owner.principal,
      { name: 'Demo Succession Federation', kind: 'federation', leaderName: 'Demo Leader', leaderTitle: null, websiteUrl: null, countryCode: 'BG', schoolsEstimate: 2, evidenceIds: [], note: null, idempotencyKey: key() },
      meta,
    );
    await getDb().update(organization).set({ status: 'active' }).where(eq(organization.id, applied.organizationId));
    const before = await lifeStatusOf(s.owner.personId);
    const relationshipsBefore = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.teacherPersonId, s.owner.personId));
    await idle(s.owner, 200);
    const file = await upload(s.heir);
    const { request } = await requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'inactivity', note: 'A fictional request.', evidenceIds: [file.id], idempotencyKey: key() }, meta);
    // A moderator or an archivist cannot decide it (DEFAULT M25 question 1).
    expect(await code(decide(moderator, request.caseId, 'verify'))).toBe('FORBIDDEN');
    expect(await code(decide(archivist, request.caseId, 'verify'))).toBe('FORBIDDEN');
    // A reason is required.
    await assignReviewCase(admin.principal, { caseId: request.caseId, assigneeId: admin.principal.user.id, idempotencyKey: key() }, meta);
    expect(await code(decideReviewCase(admin.principal, { caseId: request.caseId, decision: 'verify', reason: '', idempotencyKey: key() }, meta))).toBe('BAD_REQUEST');
    await decideReviewCase(admin.principal, { caseId: request.caseId, decision: 'verify', reason: 'The fictional evidence was checked.', idempotencyKey: key() }, meta);

    const [moved] = await getDb().select({ by: school.createdByUserId }).from(school).where(eq(school.id, saved.id));
    expect(moved!.by).toBe(s.heir.account.id);
    const liveAdmins = await getDb()
      .select({ userId: organizationAdmin.userId, role: organizationAdmin.role })
      .from(organizationAdmin)
      .where(and(eq(organizationAdmin.organizationId, applied.organizationId), isNull(organizationAdmin.revokedAt)));
    expect(liveAdmins).toEqual([{ userId: s.heir.account.id, role: 'owner' }]);
    // The owner's record and history are untouched: inactivity never marks anyone deceased.
    expect(await lifeStatusOf(s.owner.personId)).toEqual(before);
    expect(await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.teacherPersonId, s.owner.personId))).toEqual(relationshipsBefore);
    const [r] = await getDb().select().from(successionRequest).where(eq(successionRequest.id, request.id));
    expect(r!.status).toBe('approved');
    expect(r!.transferred).toEqual({ schoolIds: [saved.id], organizationIds: [applied.organizationId] });
    const audits = await getDb().select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, 'succession.transfer'), eq(auditLog.subjectId, request.id)));
    expect(audits).toHaveLength(1);
    expect((audits[0]!.after as { lifeStatusChanged: boolean }).lifeStatusChanged).toBe(false);
  });

  it('an approved nomination takes no further request; a successor who lost the plan or was banned is not approved', async () => {
    const s = await succession();
    const first = await requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'reported_death', note: 'A fictional report.', evidenceIds: [(await upload(s.heir)).id], idempotencyKey: key() }, meta);
    await getDb().update(authUser).set({ banned: true }).where(eq(authUser.id, s.heir.account.id));
    expect(await code(decide(admin, first.request.caseId, 'verify'))).toBe('CONFLICT');
    await getDb().update(authUser).set({ banned: false }).where(eq(authUser.id, s.heir.account.id));
    await decideReviewCase(admin.principal, { caseId: first.request.caseId, decision: 'verify', reason: 'The fictional evidence was checked.', idempotencyKey: key() }, meta);
    expect(await code(requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'reported_death', note: 'Again.', evidenceIds: [(await upload(s.heir)).id], idempotencyKey: key() }, meta))).toBe('CONFLICT');
    const mine = await successionMine(s.heir.principal);
    expect(mine.received.find((n) => n.id === s.nominationId)?.mayRequest).toBe(false);
  });

  it('a refused request is in the audit log too', async () => {
    const s = await succession();
    const { request } = await requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'reported_death', note: 'A fictional report.', evidenceIds: [(await upload(s.heir)).id], idempotencyKey: key() }, meta);
    await decide(admin, request.caseId, 'reject', 'The fictional evidence is not enough.');
    const audits = await getDb().select({ after: auditLog.after }).from(auditLog).where(and(eq(auditLog.action, 'succession.decide'), eq(auditLog.subjectId, request.id)));
    expect(audits).toHaveLength(1);
  });

  it('a sign-out keeps the last refresh of the session as activity', async () => {
    const s = await succession();
    await idle(s.owner, 200);
    await getDb().execute(sql`UPDATE auth_session SET updated_at = now() - interval '1 day' WHERE user_id = ${s.owner.account.id}::uuid`);
    const { afterSessionDelete } = await import('../auth/hooks');
    const [sess] = await getDb().execute<{ updated_at: string }>(sql`SELECT updated_at FROM auth_session WHERE user_id = ${s.owner.account.id}::uuid ORDER BY updated_at DESC LIMIT 1`).then((r) => r.rows);
    await afterSessionDelete({ userId: s.owner.account.id, updatedAt: new Date(sess?.updated_at ?? Date.now() - 86_400_000) });
    await getDb().execute(sql`DELETE FROM auth_session WHERE user_id = ${s.owner.account.id}::uuid`);
    expect(await code(requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'inactivity', note: 'A fictional request.', evidenceIds: [(await upload(s.heir)).id], idempotencyKey: key() }, meta))).toBe('CONFLICT');
  });

  it('an owner who comes back before the decision stops an inactivity transfer', async () => {
    const s = await succession();
    await idle(s.owner, 200);
    const file = await upload(s.heir);
    const { request } = await requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'inactivity', note: 'A fictional request.', evidenceIds: [file.id], idempotencyKey: key() }, meta);
    await getDb().update(authUser).set({ lastActiveAt: new Date() }).where(eq(authUser.id, s.owner.account.id));
    expect(await code(decide(admin, request.caseId, 'verify'))).toBe('CONFLICT');
    const [r] = await getDb().select({ status: successionRequest.status }).from(successionRequest).where(eq(successionRequest.id, request.id));
    expect(r!.status).toBe('pending');
  });

  it('a reported death is reviewed like any request and still never changes the life status by itself', async () => {
    const s = await succession();
    const file = await upload(s.heir);
    const { request } = await requestSuccession(s.heir.principal, { nominationId: s.nominationId, basis: 'reported_death', note: 'A fictional report.', evidenceIds: [file.id], idempotencyKey: key() }, meta);
    await decide(admin, request.caseId, 'reject', 'The fictional evidence is not enough.');
    const [r] = await getDb().select({ status: successionRequest.status }).from(successionRequest).where(eq(successionRequest.id, request.id));
    expect(r!.status).toBe('rejected');
    expect((await lifeStatusOf(s.owner.personId)).lifeStatus).not.toBe('deceased');
  });
});

describe('lineage dispute reports', () => {
  it('a report changes nothing by itself, needs evidence, and the reported people are no parties of it', async () => {
    const teacher = await member('gov-rep-teacher', { sifu: true });
    const student = await member('gov-rep-student');
    const relationshipId = await verified(teacher, student);
    const reporter = await member('gov-reporter');
    expect(await code(reportLineage(reporter.principal, { relationshipId, grounds: 'never_trained', details: 'A fictional report.', evidenceIds: [], idempotencyKey: key() }, meta))).toBe('BAD_REQUEST');
    const file = await upload(reporter);
    const { caseId } = await reportLineage(reporter.principal, { relationshipId, grounds: 'never_trained', details: 'A fictional report.', evidenceIds: [file.id], idempotencyKey: key() }, meta);
    const [rel] = await getDb().select({ status: teachingRelationship.status }).from(teachingRelationship).where(eq(teachingRelationship.id, relationshipId));
    expect(rel!.status).toBe('verified');
    // One open report per account and relationship.
    const again = await upload(reporter);
    expect(await code(reportLineage(reporter.principal, { relationshipId, grounds: 'other', details: 'A fictional report.', evidenceIds: [again.id], idempotencyKey: key() }, meta))).toBe('CONFLICT');
    // The reported people never read the report (nor learn who sent it).
    expect(await code(getPartyCase(teacher.principal, { id: caseId }))).toBe('NOT_FOUND');
    expect(await code(getPartyCase(student.principal, { id: caseId }))).toBe('NOT_FOUND');
    expect((await getPartyCase(reporter.principal, { id: caseId })).kind).toBe('lineage_report');
  });

  it('not upheld changes nothing; upheld sets the relationship in arbitration', async () => {
    const teacher = await member('gov-arb-teacher', { sifu: true });
    const student = await member('gov-arb-student');
    const relationshipId = await verified(teacher, student);
    const reporter = await member('gov-arb-reporter');
    const first = await reportLineage(reporter.principal, { relationshipId, grounds: 'wrong_dates', details: 'A fictional report.', evidenceIds: [(await upload(reporter)).id], idempotencyKey: key() }, meta);
    await decide(moderator, first.caseId, 'reject', 'The fictional evidence does not show it.');
    const [after] = await getDb().select({ status: teachingRelationship.status }).from(teachingRelationship).where(eq(teachingRelationship.id, relationshipId));
    expect(after!.status).toBe('verified');
    const [report] = await getDb().select({ status: lineageReport.status }).from(lineageReport).where(eq(lineageReport.reviewCaseId, first.caseId));
    expect(report!.status).toBe('not_upheld');
    // A report not upheld counts against no one: the reporter can report again.
    const second = await reportLineage(reporter.principal, { relationshipId, grounds: 'never_trained', details: 'A fictional report.', evidenceIds: [(await upload(reporter)).id], idempotencyKey: key() }, meta);
    await decide(moderator, second.caseId, 'verify', 'The fictional evidence shows a problem.');
    const [now] = await getDb().select({ status: teachingRelationship.status }).from(teachingRelationship).where(eq(teachingRelationship.id, relationshipId));
    expect(now!.status).toBe('in_arbitration');
  });

  it('a moderator who is one of the reported people decides nothing about the report, not even "not upheld"', async () => {
    const teacher = await member('gov-party-teacher', { sifu: true, role: 'moderator' });
    const student = await member('gov-party-student');
    const relationshipId = await verified(teacher, student);
    const reporter = await member('gov-party-reporter');
    const { caseId } = await reportLineage(reporter.principal, { relationshipId, grounds: 'never_trained', details: 'A fictional report.', evidenceIds: [(await upload(reporter)).id], idempotencyKey: key() }, meta);
    expect(await code(decide(teacher, caseId, 'reject'))).toBe('FORBIDDEN');
    const [report] = await getDb().select({ status: lineageReport.status }).from(lineageReport).where(eq(lineageReport.reviewCaseId, caseId));
    expect(report!.status).toBe('open');
  });

  it('a question to the reporter reaches them as a notice', async () => {
    const teacher = await member('gov-ask-teacher', { sifu: true });
    const student = await member('gov-ask-student');
    const relationshipId = await verified(teacher, student);
    const reporter = await member('gov-ask-reporter');
    const { caseId } = await reportLineage(reporter.principal, { relationshipId, grounds: 'never_trained', details: 'A fictional report.', evidenceIds: [(await upload(reporter)).id], idempotencyKey: key() }, meta);
    await assignReviewCase(moderator.principal, { caseId, assigneeId: moderator.principal.user.id, idempotencyKey: key() }, meta);
    await decideReviewCase(moderator.principal, { caseId, decision: 'needs_info', reason: 'Which fictional year is meant?', idempotencyKey: key() }, meta);
    const notices = await getDb().select({ payload: notification.payload }).from(notification).where(and(eq(notification.userId, reporter.account.id), eq(notification.template, 'case.question')));
    expect(notices).toHaveLength(1);
    expect((notices[0]!.payload as { caseId: string }).caseId).toBe(caseId);
  });
});

describe('appeals', () => {
  it('one appeal per decision, by a party, never decided by the member of staff who decided', async () => {
    const teacher = await member('gov-appeal-teacher', { sifu: true });
    const student = await member('gov-appeal-student');
    const relationshipId = await verified(teacher, student);
    const reporter = await member('gov-appellant');
    const { caseId } = await reportLineage(reporter.principal, { relationshipId, grounds: 'wrong_teacher', details: 'A fictional report.', evidenceIds: [(await upload(reporter)).id], idempotencyKey: key() }, meta);
    await decide(moderator, caseId, 'reject', 'The fictional evidence does not show it.');
    // Not a party: the same answer as for no such case.
    expect(await code(appealDecision(teacher.principal, { caseId, grounds: 'A fictional appeal.', idempotencyKey: key() }, meta))).toBe('NOT_FOUND');
    const view = await getPartyCase(reporter.principal, { id: caseId });
    expect(view.appeal?.canAppeal).toBe(true);
    const appeal = await appealDecision(reporter.principal, { caseId, grounds: 'A fictional appeal.', idempotencyKey: key() }, meta);
    expect(await code(appealDecision(reporter.principal, { caseId, grounds: 'A second fictional appeal.', idempotencyKey: key() }, meta))).toBe('CONFLICT');
    // The moderator who decided cannot decide the appeal; nor can an archivist (not a decider of reports).
    expect(await code(decide(moderator, appeal.caseId, 'verify'))).toBe('FORBIDDEN');
    const card = await getReviewCase(moderator.principal, { id: appeal.caseId });
    expect([card.can.verify, card.can.reject]).toEqual([false, false]);
    expect(await code(decide(archivist, appeal.caseId, 'verify'))).toBe('FORBIDDEN');
    await decide(moderator2, appeal.caseId, 'verify', 'The report deserves another look.');
    // Upheld: the report is open again, for a decision by someone else than the first decider.
    const [report] = await getDb().select({ status: lineageReport.status }).from(lineageReport).where(eq(lineageReport.reviewCaseId, caseId));
    expect(report!.status).toBe('open');
    expect(await code(decide(moderator, caseId, 'reject', 'A fictional reason.'))).toBe('FORBIDDEN');
    await decide(admin2, caseId, 'reject', 'Looked at again: the fictional evidence does not show it.');
    // The decision made after an appeal is final: no second appeal of the same case.
    const again = await getPartyCase(reporter.principal, { id: caseId });
    expect(again.appeal?.canAppeal).toBe(false);
    expect(again.appeal?.appeal?.caseId).toBe(appeal.caseId);
    expect(await code(appealDecision(reporter.principal, { caseId, grounds: 'A third fictional appeal.', idempotencyKey: key() }, meta))).toBe('CONFLICT');
  });
  it('the owner of a succession request never decides its appeal; an appeal cannot reopen a request beside a newer pending one', async () => {
    const owner = await member('gov-appeal-owner', { sifu: true, role: 'admin' });
    const heir = await member('gov-appeal-heir');
    await grant(owner, 'pro_sifu');
    await grant(heir, 'premium_student');
    await verified(owner, heir);
    const { nomination } = await nominateSuccessor(owner.principal, { successorPersonId: heir.personId }, meta);
    await answerNomination(heir.principal, { nominationId: nomination.id, answer: 'accept' }, meta);
    const { request } = await requestSuccession(heir.principal, { nominationId: nomination.id, basis: 'reported_death', note: 'A fictional report.', evidenceIds: [(await upload(heir)).id], idempotencyKey: key() }, meta);
    await decide(admin, request.caseId, 'reject', 'The fictional evidence is not enough.');
    const appeal = await appealDecision(heir.principal, { caseId: request.caseId, grounds: 'A fictional appeal.', idempotencyKey: key() }, meta);
    // The owner is an administrator, but a party of the appealed case.
    expect(await code(decide(owner, appeal.caseId, 'reject'))).toBe('FORBIDDEN');
    // A newer request on the same nomination is pending: the old one cannot be reopened beside it.
    await requestSuccession(heir.principal, { nominationId: nomination.id, basis: 'reported_death', note: 'A second fictional report.', evidenceIds: [(await upload(heir)).id], idempotencyKey: key() }, meta);
    expect(await code(decide(admin2, appeal.caseId, 'verify', 'Another look.'))).toBe('CONFLICT');
    await decide(admin2, appeal.caseId, 'reject', 'The newer request is decided instead.');
  });
});

describe('stewardship of shared archival records', () => {
  async function sharedRecord() {
    const id = uuidv7();
    const slug = `demo-gov-record-${key().slice(0, 8)}`;
    await getDb().insert(person).values({ id, slug, kind: 'historical', stewardship: 'unclaimed', visibility: 'public', lifeStatus: 'unknown' });
    await getDb().insert(personName).values({ personId: id, value: 'Demo Archival Teacher', script: 'Latn', lang: 'en', isPrimary: true });
    return { id, slug };
  }

  it('a proposal changes nothing until an archivist approves it; the change is kept in the history', async () => {
    const r = await sharedRecord();
    const proposer = await member('gov-proposer', { sifu: true });
    // A change of the life status needs evidence (DEFAULT M25 question 7).
    expect(
      await code(proposeRecordChange(proposer.principal, { personId: r.id, primaryName: 'Demo Archival Teacher', lifeStatus: 'deceased', bio: null, reason: 'A fictional source.', evidenceIds: [], idempotencyKey: key() }, meta)),
    ).toBe('BAD_REQUEST');
    const { caseId } = await proposeRecordChange(
      proposer.principal,
      { personId: r.id, primaryName: 'Demo Archival Teacher Corrected', lifeStatus: 'unknown', bio: 'A fictional biography.', reason: 'A fictional source.', evidenceIds: [], idempotencyKey: key() },
      meta,
    );
    expect((await proposeOptions(proposer.principal, { slug: r.slug })).pendingCaseId).toBe(caseId);
    const [unchanged] = await getDb().select({ value: personName.value }).from(personName).where(and(eq(personName.personId, r.id), eq(personName.isPrimary, true)));
    expect(unchanged!.value).toBe('Demo Archival Teacher');
    // Only an archivist decides a proposal.
    expect(await code(decide(moderator, caseId, 'verify'))).toBe('FORBIDDEN');
    expect(await code(decide(admin, caseId, 'verify'))).toBe('FORBIDDEN');
    await decide(archivist, caseId, 'verify', 'The fictional source was checked.');
    const [changed] = await getDb().select({ value: personName.value }).from(personName).where(and(eq(personName.personId, r.id), eq(personName.isPrimary, true)));
    expect(changed!.value).toBe('Demo Archival Teacher Corrected');
    const history = await recordHistory(null, { slug: r.slug });
    expect(history.revisions).toHaveLength(1);
    expect(history.revisions[0]!.source).toBe('proposal');
    // The public history names neither who changed it nor why.
    expect(history.revisions[0]!.reason).toBeNull();
    expect(JSON.stringify(history)).not.toContain(proposer.account.id);
  });

  it('a record kept by its own person takes no proposal; an archival edit is recorded too', async () => {
    const own = await member('gov-self-kept');
    expect(await code(proposeOptions(own.principal, { slug: own.slug }))).toBe('FORBIDDEN');
    const r = await sharedRecord();
    await updateArchiveRecord(archivist.principal, { personId: r.id, primaryName: 'Demo Archival Teacher Edited', lifeStatus: 'unknown', reason: 'A fictional correction.', evidenceIds: [] }, meta);
    const rows = await getDb().select({ source: recordRevision.source, changed: recordRevision.changed }).from(recordRevision).where(eq(recordRevision.personId, r.id));
    expect(rows).toEqual([{ source: 'archival_edit', changed: ['primaryName'] }]);
  });

  it('no school or organization edits a shared record alone, and an organizational split leaves its history as it was', async () => {
    const r = await sharedRecord();
    const owner = await member('gov-org-owner', { sifu: true });
    const applied = await applyOrganization(
      owner.principal,
      { name: 'Demo Stewardship Federation', kind: 'federation', leaderName: 'Demo Leader', leaderTitle: null, websiteUrl: null, countryCode: 'BG', schoolsEstimate: 2, evidenceIds: [], note: null, idempotencyKey: key() },
      meta,
    );
    await getDb().update(organization).set({ status: 'active' }).where(eq(organization.id, applied.organizationId));
    expect(await code(updateArchiveRecord(owner.principal, { personId: r.id, primaryName: 'Demo Archival Teacher Taken', lifeStatus: 'unknown', reason: 'A fictional claim.', evidenceIds: [] }, meta))).toBe('FORBIDDEN');
    await updateArchiveRecord(archivist.principal, { personId: r.id, primaryName: 'Demo Archival Teacher Kept', lifeStatus: 'unknown', reason: 'A fictional correction.', evidenceIds: [] }, meta);
    const before = await getDb().select().from(recordRevision).where(eq(recordRevision.personId, r.id));
    // The organization splits off (its administration ends): the record's history is not touched.
    await getDb().update(organizationAdmin).set({ revokedAt: new Date() }).where(eq(organizationAdmin.organizationId, applied.organizationId));
    await getDb().update(organization).set({ status: 'suspended' }).where(eq(organization.id, applied.organizationId));
    expect(await getDb().select().from(recordRevision).where(eq(recordRevision.personId, r.id))).toEqual(before);
    const [name] = await getDb().select({ value: personName.value }).from(personName).where(and(eq(personName.personId, r.id), eq(personName.isPrimary, true)));
    expect(name!.value).toBe('Demo Archival Teacher Kept');
  });

  it('the change history is append-only for the application role', async () => {
    const grants = await getDb().execute<{ privilege_type: string }>(
      sql`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'app_rw' AND table_name = 'record_revision' ORDER BY privilege_type`,
    );
    expect(grants.rows.map((g) => g.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });
});
