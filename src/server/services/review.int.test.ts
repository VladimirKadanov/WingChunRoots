// Historical teacher claims, the review queue and archival edits (milestone M10a, In scope 1, 4
// and 5), against a migrated throwaway database: the claim creates a private record and an open
// case; every decision (review.assign, review.decide) writes a relationship_event and an audit row;
// who may decide (an archivist on a case they took, an administrator on any; a moderator only asks
// for information; nobody on their own claim; nobody without the second factor); the archival edit
// keeps actor, role, reason and evidence_ids in person.update; and the queue never shows a storage
// key. Fictional data only (D20): demo- slugs, example.test addresses, generated PDFs.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, asc, eq, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, evidenceFile, evidenceLink, notification, person, personBio, personName, relationshipEvent, reviewCase, reviewNote, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { filesystemStore } from '../storage/fs';
import { pgErrorOf } from './errors';
import { ARCHIVAL_EVIDENCE_MESSAGE, CLAIM_EVIDENCE_MESSAGE, openEvidence, uploadEvidence } from './evidence';
import { requestHistoricalTeacher } from './historical';
import { myTeachers, REQUESTS_PER_WINDOW, REQUESTS_TO_ONE_TEACHER_PER_WINDOW, withdrawRelationship } from './relationships';
import { addReviewNote, assignReviewCase, decideReviewCase, getArchiveRecord, getReviewCase, listReviewCases, updateArchiveRecord } from './review';
import { key, type Member, member, meta, newLineage, ongoingFrom, principalOf, staff } from './relationships.test-support';

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
const root = mkdtempSync(path.join(tmpdir(), 'wcr-review-int-'));
const store = filesystemStore(root);

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  lineageId = await newLineage('m10a-review');
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(root, { recursive: true, force: true });
});

function fictionalPdf(seed: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`%PDF-1.4\n% Demo evidence ${seed}, invented for the WingChunRoots tests.\n%%EOF\n`);
}

async function upload(m: Pick<Member, 'principal'>, seed: string, caseId: string | null = null) {
  const bytes = fictionalPdf(seed);
  const stream = new Response(bytes).body!;
  return uploadEvidence(m.principal, { declaredLength: bytes.length, body: stream, name: encodeURIComponent(`demo-${seed}.pdf`), caseId }, meta, store);
}

async function claim(label: string, extra: Record<string, unknown> = {}) {
  const student = await member(label);
  const file = await upload(student, label);
  const result = await requestHistoricalTeacher(
    student.principal,
    { teacherName: `Demo Historical ${label}`, lifeStatus: 'deceased', lineageId, periods: ongoingFrom('1988-03'), evidenceIds: [file.id], note: 'A fictional certificate.', idempotencyKey: key(), ...extra },
    meta,
  );
  const [rel] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, result.relationship.id));
  return { student, file, result, caseId: result.caseId, relationshipId: result.relationship.id, teacherId: rel!.teacherPersonId };
}

async function events(relationshipId: string) {
  return getDb()
    .select({ from: relationshipEvent.fromStatus, to: relationshipEvent.toStatus, actor: relationshipEvent.actorUserId, role: relationshipEvent.actorRole, reason: relationshipEvent.reason })
    .from(relationshipEvent)
    .where(eq(relationshipEvent.relationshipId, relationshipId))
    .orderBy(asc(relationshipEvent.createdAt), asc(relationshipEvent.id));
}

async function auditsOf(subjectId: string) {
  return getDb()
    .select({ action: auditLog.action, actor: auditLog.actorUserId, role: auditLog.actorRole, after: auditLog.after, reason: auditLog.reason })
    .from(auditLog)
    .where(eq(auditLog.subjectId, subjectId))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
}

async function isPublicPerson(id: string): Promise<boolean> {
  const result = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_person WHERE id = ${id}::uuid`);
  return result.rows[0]!.n === 1;
}

async function isPublicEdge(teacherId: string, studentId: string): Promise<boolean> {
  const result = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_edge WHERE teacher_person_id = ${teacherId}::uuid AND student_person_id = ${studentId}::uuid`);
  return result.rows[0]!.n === 1;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e,
  )) as { code?: string } | null;
  return error?.code ?? 'OK';
}

/** 'OK', the code of a ServiceError, or the SQLSTATE of a database error (40P01: a deadlock). */
async function outcome(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'OK',
    (e: unknown) => pgErrorOf(e)?.code ?? String(e),
  );
}

/** A teacher name of letters only (names refuse digits): A, B, ..., Z, Aa, Ab, ... */
const letters = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(97 + (i % 26))}`);

describe('a historical teacher claim', () => {
  it('creates a private historical record, an under_review committee link and an open case with the files; archivists and administrators are told, moderators are not', async () => {
    const archivist = await staff('rv-claim-arch', 'archivist');
    const admin = await staff('rv-claim-admin', 'admin');
    const moderator = await staff('rv-claim-mod', 'moderator');
    const { student, file, result, caseId, relationshipId, teacherId } = await claim('rv-claim');

    const [teacher] = await getDb().select().from(person).where(eq(person.id, teacherId));
    // DEFAULT D03: the record a student creates is involved_only until a link of it is verified.
    expect(teacher).toMatchObject({ kind: 'historical', lifeStatus: 'deceased', stewardship: 'platform', visibility: 'involved_only', claimedByUserId: null, createdByUserId: student.account.id });
    const [rel] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, relationshipId));
    expect(rel).toMatchObject({ status: 'under_review', verificationPath: 'committee_review', visibility: 'involved_only', studentPersonId: student.personId });
    const [c] = await getDb().select().from(reviewCase).where(eq(reviewCase.id, caseId));
    expect(c).toMatchObject({ kind: 'historical_claim', status: 'open', relationshipId, openedByUserId: student.account.id, assignedToUserId: null });
    const links = await getDb().select({ file: evidenceLink.evidenceFileId }).from(evidenceLink).where(eq(evidenceLink.reviewCaseId, caseId));
    expect(links).toEqual([{ file: file.id }]);
    const notes = await getDb().select({ body: reviewNote.body, internal: reviewNote.isInternal }).from(reviewNote).where(eq(reviewNote.reviewCaseId, caseId));
    expect(notes).toEqual([{ body: 'A fictional certificate.', internal: false }]);

    expect(await events(relationshipId)).toEqual([{ from: null, to: 'under_review', actor: student.account.id, role: 'student', reason: null }]);
    expect((await auditsOf(relationshipId)).map((a) => a.action)).toEqual(['relationship.request']);
    expect((await auditsOf(teacherId)).map((a) => a.action)).toEqual(['person.create']);
    // No name in an audit row (plan §6.4).
    expect(JSON.stringify(await auditsOf(teacherId))).not.toContain('Demo Historical');

    const told = async (userId: string) =>
      (await getDb().select({ payload: notification.payload }).from(notification).where(and(eq(notification.userId, userId), eq(notification.template, 'review.opened')))).filter(
        (n) => (n.payload as { caseId: string }).caseId === caseId,
      ).length;
    expect(await told(archivist.account.id)).toBe(1);
    expect(await told(admin.account.id)).toBe(1);
    expect(await told(moderator.account.id)).toBe(0);

    // Private: absent from the public views; the student sees it on Your teachers, under review.
    expect(await isPublicPerson(teacherId)).toBe(false);
    expect(await isPublicEdge(teacherId, student.personId)).toBe(false);
    expect(result.relationship.status).toBe('under_review');
    const mine = await myTeachers(student.principal);
    expect(JSON.stringify(mine)).toContain(relationshipId);
  });

  it('a double submit with one idempotency key sends one claim', async () => {
    const student = await member('rv-replay');
    const file = await upload(student, 'rv-replay');
    const input = { teacherName: 'Demo Historical Replay', lineageId, periods: ongoingFrom(), evidenceIds: [file.id], idempotencyKey: key() };
    const first = await requestHistoricalTeacher(student.principal, input, meta);
    const second = await requestHistoricalTeacher(student.principal, input, meta);
    expect(second).toMatchObject({ replayed: true, caseId: first.caseId });
    const cases = await getDb().select({ id: reviewCase.id }).from(reviewCase).where(eq(reviewCase.openedByUserId, student.account.id));
    expect(cases).toHaveLength(1);
  });

  it('needs evidence of the student’s own: none, or another account’s file, is refused', async () => {
    const student = await member('rv-own-files');
    const other = await member('rv-own-files-other');
    const foreign = await upload(other, 'rv-foreign');
    const base = { teacherName: 'Demo Historical Files', lineageId, periods: ongoingFrom() };
    await expect(requestHistoricalTeacher(student.principal, { ...base, evidenceIds: [], idempotencyKey: key() }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { evidenceIds: expect.any(String) } });
    await expect(requestHistoricalTeacher(student.principal, { ...base, evidenceIds: [foreign.id], idempotencyKey: key() }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { evidenceIds: expect.any(String) } });
  });

  it('refuses a living teacher on record: they confirm requests themselves', async () => {
    const living = await member('rv-living-teacher', { sifu: true });
    const student = await member('rv-living-student');
    const file = await upload(student, 'rv-living');
    await expect(
      requestHistoricalTeacher(student.principal, { teacherId: living.personId, periods: ongoingFrom(), evidenceIds: [file.id], idempotencyKey: key() }, meta),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { teacherId: expect.stringContaining('not a historical record') } });
  });
});

describe('review decisions write relationship_event and audit_log', () => {
  it('an archivist takes the case and verifies it: the link and both records are public, the student is told, lineage.recompute is queued; a repeat replays', async () => {
    const archivist = await staff('rv-verify-arch', 'archivist');
    const { student, caseId, relationshipId, teacherId } = await claim('rv-verify');
    const assignKey = key();
    await assignReviewCase(archivist.principal, { caseId, assigneeId: archivist.account.id, idempotencyKey: assignKey }, meta);
    const replayAssign = await assignReviewCase(archivist.principal, { caseId, assigneeId: archivist.account.id, idempotencyKey: assignKey }, meta);
    expect(replayAssign.replayed).toBe(true);
    const verifyKey = key();
    cache.revalidated.length = 0;
    const verified = await decideReviewCase(archivist.principal, { caseId, decision: 'verify', reason: 'The fictional certificate matches.', idempotencyKey: verifyKey }, meta);
    expect(verified).toMatchObject({ replayed: false, case: { status: 'resolved', resolution: 'approved' } });
    expect(cache.revalidated.length).toBeGreaterThan(0);

    const [rel] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, relationshipId));
    expect(rel).toMatchObject({ status: 'verified', visibility: 'public', confirmedByUserId: archivist.account.id });
    expect(await isPublicPerson(teacherId)).toBe(true);
    expect(await isPublicEdge(teacherId, student.personId)).toBe(true);

    expect(await events(relationshipId)).toEqual([
      { from: null, to: 'under_review', actor: student.account.id, role: 'student', reason: null },
      { from: 'under_review', to: 'under_review', actor: archivist.account.id, role: 'archivist', reason: 'assigned' },
      { from: 'under_review', to: 'verified', actor: archivist.account.id, role: 'archivist', reason: 'review' },
    ]);
    expect((await auditsOf(relationshipId)).map((a) => [a.action, a.role])).toEqual([
      ['relationship.request', 'user'],
      ['relationship.verify', 'archivist'],
    ]);
    expect((await auditsOf(caseId)).map((a) => [a.action, a.role])).toEqual([
      ['review.assign', 'archivist'],
      ['review.resolve', 'archivist'],
    ]);
    const decided = await getDb().select({ payload: notification.payload }).from(notification).where(and(eq(notification.userId, student.account.id), eq(notification.template, 'review.decided')));
    expect(decided.map((n) => n.payload)).toEqual([{ relationshipId, decision: 'verified' }]);
    const jobs = await getDb().execute<{ data: { lineageIds: string[] } }>(sql`SELECT data FROM pgboss.job WHERE name = 'lineage.recompute'`);
    expect(jobs.rows.some((j) => j.data.lineageIds.includes(lineageId))).toBe(true);

    const replay = await decideReviewCase(archivist.principal, { caseId, decision: 'verify', reason: 'The fictional certificate matches.', idempotencyKey: verifyKey }, meta);
    expect(replay.replayed).toBe(true);
    expect(await events(relationshipId)).toHaveLength(3);
    // Decided: no second decision with a new key.
    expect(await refusal(decideReviewCase(archivist.principal, { caseId, decision: 'reject', reason: 'Too late.', idempotencyKey: key() }, meta))).toBe('CONFLICT');
  });

  it('who decides: a moderator takes a case and asks for information but neither verifies nor refuses; an archivist takes the case first; an administrator decides any; no second factor, no staff role or one’s own claim is refused', async () => {
    const moderator = await staff('rv-who-mod', 'moderator');
    const archivist = await staff('rv-who-arch', 'archivist');
    const admin = await staff('rv-who-admin', 'admin');
    const archivistNo2fa = principalOf(archivist.account, 'archivist', { unverified: true });
    const { student, caseId } = await claim('rv-who');

    expect(await refusal(listReviewCases(student.principal))).toBe('FORBIDDEN');
    expect(await refusal(getReviewCase(student.principal, { id: caseId }))).toBe('FORBIDDEN');
    expect(await refusal(decideReviewCase(student.principal, { caseId, decision: 'verify', idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    expect(await refusal(listReviewCases(archivistNo2fa))).toBe('SECOND_FACTOR_REQUIRED');
    expect(await refusal(decideReviewCase(archivistNo2fa, { caseId, decision: 'verify', idempotencyKey: key() }, meta))).toBe('SECOND_FACTOR_REQUIRED');
    expect(await refusal(decideReviewCase(null, { caseId, decision: 'verify', idempotencyKey: key() }, meta))).toBe('UNAUTHORIZED');

    // An archivist decides only a case assigned to them; a moderator never verifies or refuses.
    expect(await refusal(decideReviewCase(archivist.principal, { caseId, decision: 'verify', idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    await assignReviewCase(moderator.principal, { caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    expect(await refusal(decideReviewCase(moderator.principal, { caseId, decision: 'verify', idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    expect(await refusal(decideReviewCase(moderator.principal, { caseId, decision: 'reject', reason: 'No.', idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    // Only an administrator gives a case to someone else.
    expect(await refusal(assignReviewCase(moderator.principal, { caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    await decideReviewCase(moderator.principal, { caseId, decision: 'needs_info', reason: 'Add a photo of the fictional certificate.', idempotencyKey: key() }, meta);
    expect((await getReviewCase(moderator.principal, { id: caseId })).status).toBe('needs_info');

    // The administrator gives it to the archivist; an administrator could also decide unassigned.
    await assignReviewCase(admin.principal, { caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
    const asArchivist = await getReviewCase(archivist.principal, { id: caseId });
    expect(asArchivist.can).toMatchObject({ verify: true, reject: true, needsInfo: true });
    const asModerator = await getReviewCase(moderator.principal, { id: caseId });
    expect(asModerator.can).toMatchObject({ verify: false, reject: false });

    // Nobody reviews a claim of their own: an archivist who is the student.
    const ownStudent = await member('rv-own-arch', { role: 'archivist' });
    const own = await upload(ownStudent, 'rv-own');
    const ownClaim = await requestHistoricalTeacher(ownStudent.principal, { teacherName: 'Demo Historical Own', lineageId, periods: ongoingFrom(), evidenceIds: [own.id], idempotencyKey: key() }, meta);
    expect(await refusal(assignReviewCase(ownStudent.principal, { caseId: ownClaim.caseId, assigneeId: ownStudent.account.id, idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    expect(await refusal(decideReviewCase(ownStudent.principal, { caseId: ownClaim.caseId, decision: 'verify', idempotencyKey: key() }, meta))).toBe('FORBIDDEN');
    const adminVerdict = await decideReviewCase(admin.principal, { caseId: ownClaim.caseId, decision: 'verify', idempotencyKey: key() }, meta);
    expect(adminVerdict.case.resolution).toBe('approved');
  });

  it('a refusal needs a reason the claimant reads; the link is rejected and the case resolved', async () => {
    const admin = await staff('rv-reject-admin', 'admin');
    const { student, caseId, relationshipId, teacherId } = await claim('rv-reject');
    const missing = await decideReviewCase(admin.principal, { caseId, decision: 'reject', reason: '  ', idempotencyKey: key() }, meta).catch((e: unknown) => e);
    expect(missing).toMatchObject({ code: 'BAD_REQUEST', fields: { reason: expect.any(String) } });
    await decideReviewCase(admin.principal, { caseId, decision: 'reject', reason: 'The fictional certificate names another hall.', idempotencyKey: key() }, meta);
    const [rel] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, relationshipId));
    expect(rel).toMatchObject({ status: 'rejected', visibility: 'involved_only' });
    const [c] = await getDb().select().from(reviewCase).where(eq(reviewCase.id, caseId));
    expect(c).toMatchObject({ status: 'resolved', resolution: 'rejected', resolutionReason: 'The fictional certificate names another hall.' });
    expect((await events(relationshipId)).at(-1)).toMatchObject({ from: 'under_review', to: 'rejected', actor: admin.account.id, role: 'admin' });
    expect((await auditsOf(relationshipId)).map((a) => a.action)).toEqual(['relationship.request', 'relationship.reject']);
    expect(JSON.stringify(await myTeachers(student.principal))).toContain('The fictional certificate names another hall.');
    expect(await isPublicPerson(teacherId)).toBe(false);
  });

  it('needs_info: the question reaches the claimant; their next file brings the case back to its reviewer, who is told', async () => {
    const archivist = await staff('rv-info-arch', 'archivist');
    const { student, caseId, relationshipId } = await claim('rv-info');
    await assignReviewCase(archivist.principal, { caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
    await decideReviewCase(archivist.principal, { caseId, decision: 'needs_info', reason: 'Add the second page of the fictional certificate.', idempotencyKey: key() }, meta);
    expect((await events(relationshipId)).at(-1)).toMatchObject({ from: 'under_review', to: 'under_review', reason: 'needs_info' });
    expect((await auditsOf(caseId)).map((a) => a.action)).toEqual(['review.assign', 'review.needs_info']);
    expect(JSON.stringify(await myTeachers(student.principal))).toContain('Add the second page of the fictional certificate.');

    await upload(student, 'rv-info-page-2', caseId);
    const [c] = await getDb().select({ status: reviewCase.status }).from(reviewCase).where(eq(reviewCase.id, caseId));
    expect(c!.status).toBe('in_review');
    const updates = await getDb().select({ payload: notification.payload }).from(notification).where(and(eq(notification.userId, archivist.account.id), eq(notification.template, 'review.updated')));
    expect(updates.map((u) => u.payload)).toEqual([{ caseId, change: 'evidence' }]);

    // An internal note stays with the reviewers.
    await addReviewNote(archivist.principal, { caseId, body: 'Internal: the second page looks fine.', idempotencyKey: key() }, meta);
    expect(JSON.stringify(await myTeachers(student.principal))).not.toContain('Internal: the second page');
    expect((await getReviewCase(archivist.principal, { id: caseId })).notes.map((n) => [n.author, n.internal])).toEqual([
      ['claimant', false],
      ['you', false],
      ['you', true],
    ]);
  });

  it('the queue lists open claims with filters; the case card links a file only for who may open it and never carries a storage key', async () => {
    const moderator = await staff('rv-queue-mod', 'moderator');
    const admin = await staff('rv-queue-admin', 'admin');
    const { caseId, file } = await claim('rv-queue');
    const list = await listReviewCases(moderator.principal, { kind: 'historical_claim', status: 'open', assigned: 'none', sort: 'newest' });
    expect(list.rows.map((r) => r.id)).toContain(caseId);
    expect(list.rows.every((r) => r.kind === 'historical_claim' && r.status === 'open' && r.assignee === null)).toBe(true);
    expect(list.kinds.map((k) => k.value)).not.toContain('deletion_request');

    const [stored] = await getDb().select({ storageKey: evidenceFile.storageKey }).from(evidenceFile).where(eq(evidenceFile.id, file.id));
    const unassigned = await getReviewCase(moderator.principal, { id: caseId });
    expect(unassigned.files.map((f) => f.href)).toEqual([null]);
    const asAdmin = await getReviewCase(admin.principal, { id: caseId });
    expect(asAdmin.files.map((f) => f.href)).toEqual([`/api/evidence/${file.id}`]);
    for (const view of [list, unassigned, asAdmin]) expect(JSON.stringify(view)).not.toContain(stored!.storageKey);

    // The uploaded file's name (personal data) goes only to those who may open the file, as the
    // migration documents (M10a review, security-4): not to an unassigned moderator.
    expect(unassigned.files.map((f) => f.name)).toEqual([null]);
    expect(JSON.stringify(unassigned)).not.toContain('demo-rv-queue.pdf');
    expect(asAdmin.files.map((f) => f.name)).toEqual(['demo-rv-queue.pdf']);
    await assignReviewCase(moderator.principal, { caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    const assigned = await getReviewCase(moderator.principal, { id: caseId });
    expect(assigned.files.map((f) => [f.name, f.href])).toEqual([['demo-rv-queue.pdf', `/api/evidence/${file.id}`]]);
  });
});

describe('the archival edit (plan §6.6)', () => {
  async function platformRecord(label: string) {
    const id = (await getDb()
      .insert(person)
      .values({ slug: `demo-${label}-${key().slice(0, 8)}`, kind: 'historical', lifeStatus: 'unknown', stewardship: 'platform', visibility: 'public' })
      .returning({ id: person.id, slug: person.slug }))[0]!;
    await getDb().insert(personName).values({ personId: id.id, value: `Demo Archive ${label}`, script: 'Latn', lang: 'und-Latn', isPrimary: true });
    return id;
  }

  it('an archivist corrects a platform record with a reason and evidence; person.update keeps actor, role, reason and evidence_ids; an unchanged edit writes nothing', async () => {
    const archivist = await staff('rv-arch-edit', 'archivist');
    const record = await platformRecord('rv-arch');
    const file = await upload({ principal: archivist.principal }, 'rv-arch-evidence');
    const input = {
      personId: record.id,
      primaryName: 'Demo Archive Corrected',
      originalName: '示範師傅',
      originalLang: 'zh-Hant',
      lifeStatus: 'deceased' as const,
      bio: 'A fictional teacher of the demo lineage.',
      reason: 'The fictional hall register gives this spelling.',
      evidenceIds: [file.id],
    };
    const result = await updateArchiveRecord(archivist.principal, input, meta);
    expect(result.changed).toBe(true);
    expect(result.record).toMatchObject({ primaryName: 'Demo Archive Corrected', lifeStatus: 'deceased', bio: 'A fictional teacher of the demo lineage.', original: { value: '示範師傅', lang: 'zh-Hant' } });
    expect(result.record.files.map((f) => f.id)).toEqual([file.id]);

    const audits = await getDb()
      .select({ actor: auditLog.actorUserId, role: auditLog.actorRole, reason: auditLog.reason, after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'person.update'), eq(auditLog.subjectId, record.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor: archivist.account.id, role: 'archivist', reason: 'The fictional hall register gives this spelling.', after: { archival: true, evidence_ids: [file.id], lifeStatus: 'deceased' } });
    // Neither a name nor the biography is copied into the audit row.
    expect(JSON.stringify(audits[0])).not.toContain('Demo Archive');
    expect(JSON.stringify(audits[0])).not.toContain('fictional teacher of the demo');
    const [bio] = await getDb().select({ body: personBio.body }).from(personBio).where(eq(personBio.personId, record.id));
    expect(bio!.body).toBe('A fictional teacher of the demo lineage.');

    const again = await updateArchiveRecord(archivist.principal, input, meta);
    expect(again.changed).toBe(false);
    expect(await getDb().select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, 'person.update'), eq(auditLog.subjectId, record.id)))).toHaveLength(1);
  });

  // M10a review, security-1 and requirements-2: archive.update linked any file the archivist could
  // open (as the assigned reviewer of a claim, too), and accessOf then opened every file linked to a
  // record to every archivist. Now a record links only the archivist's own uploads that are in no
  // claim, and a download is exactly In scope 3: uploader, teacher concerned, assigned reviewers,
  // administrators.
  it('links only files the archivist uploaded for the edit, never a claim’s; a record’s file opens for its uploader and the administrators, 404 for another archivist', async () => {
    const archivist = await staff('rv-arch-link', 'archivist');
    const otherArchivist = await staff('rv-arch-link-other', 'archivist');
    const moderator = await staff('rv-arch-link-mod', 'moderator');
    const admin = await staff('rv-arch-link-admin', 'admin');
    const record = await platformRecord('rv-arch-link');
    const base = { personId: record.id, primaryName: 'Demo Archive rv-arch-link', lifeStatus: 'unknown' as const, reason: 'The fictional register.' };
    const open = (p: Parameters<typeof openEvidence>[0], id: string) => openEvidence(p, id, meta, store);
    const notFound = (p: Parameters<typeof openEvidence>[0], id: string) => expect(open(p, id)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    const linkedTo = async (fileId: string) =>
      (await getDb().select({ personId: evidenceLink.personId }).from(evidenceLink).where(eq(evidenceLink.evidenceFileId, fileId))).map((l) => l.personId).filter(Boolean);

    // A student's claim file: the archivist assigned to the case opens it, but cannot link it.
    const { caseId, file } = await claim('rv-arch-link-claim');
    await assignReviewCase(archivist.principal, { caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta);
    await (await open(archivist.principal, file.id)).body.cancel();
    const viaApi = await updateArchiveRecord(archivist.principal, { ...base, primaryName: 'Demo Archive Linked', evidenceIds: [file.id] }, meta).catch((e: unknown) => e);
    expect(viaApi).toMatchObject({ code: 'BAD_REQUEST', fields: { evidenceIds: ARCHIVAL_EVIDENCE_MESSAGE } });
    expect(await linkedTo(file.id)).toEqual([]);
    await notFound(otherArchivist.principal, file.id); // never assigned
    await assignReviewCase(archivist.principal, { caseId, assigneeId: null, idempotencyKey: key() }, meta);
    await notFound(archivist.principal, file.id); // no longer assigned

    // The archivist's own file sent with a claim of their own stays with that claim.
    const claimant = await member('rv-arch-link-claimant', { role: 'archivist' });
    const ownClaimFile = await upload(claimant, 'rv-arch-link-own-claim');
    await requestHistoricalTeacher(claimant.principal, { teacherName: 'Demo Historical Own Link', lineageId, periods: ongoingFrom(), evidenceIds: [ownClaimFile.id], idempotencyKey: key() }, meta);
    const ownClaim = await updateArchiveRecord(claimant.principal, { ...base, primaryName: 'Demo Archive Own Claim', evidenceIds: [ownClaimFile.id] }, meta).catch((e: unknown) => e);
    expect(ownClaim).toMatchObject({ code: 'BAD_REQUEST', fields: { evidenceIds: CLAIM_EVIDENCE_MESSAGE } });
    expect(await linkedTo(ownClaimFile.id)).toEqual([]);

    // Another archivist's upload is not this archivist's to link either.
    const theirs = await upload({ principal: otherArchivist.principal }, 'rv-arch-link-theirs');
    expect(await updateArchiveRecord(archivist.principal, { ...base, evidenceIds: [theirs.id] }, meta).catch((e: unknown) => e)).toMatchObject({
      code: 'BAD_REQUEST',
      fields: { evidenceIds: ARCHIVAL_EVIDENCE_MESSAGE },
    });

    // A file uploaded for the edit is linked, and opens for its uploader and the administrators only.
    const mine = await upload({ principal: archivist.principal }, 'rv-arch-link-register');
    const saved = await updateArchiveRecord(archivist.principal, { ...base, evidenceIds: [mine.id] }, meta);
    expect(saved.record.files.map((f) => [f.id, f.name, f.href])).toEqual([[mine.id, 'demo-rv-arch-link-register.pdf', `/api/evidence/${mine.id}`]]);
    expect(await linkedTo(mine.id)).toEqual([record.id]);
    await (await open(archivist.principal, mine.id)).body.cancel();
    await (await open(admin.principal, mine.id)).body.cancel();
    await notFound(otherArchivist.principal, mine.id);
    await notFound(moderator.principal, mine.id);
    // The record page shows the others neither the link nor the file's name.
    for (const viewer of [otherArchivist, moderator]) {
      const view = await getArchiveRecord(viewer.principal, { slug: record.slug });
      expect(view.files.map((f) => [f.id, f.name, f.href])).toEqual([[mine.id, null, null]]);
    }
    expect((await getArchiveRecord(admin.principal, { slug: record.slug })).files.map((f) => f.href)).toEqual([`/api/evidence/${mine.id}`]);
  });

  it('requires a reason; a moderator and an administrator get 403; a record kept by its owner is refused', async () => {
    const archivist = await staff('rv-arch-rules', 'archivist');
    const moderator = await staff('rv-arch-rules-mod', 'moderator');
    const admin = await staff('rv-arch-rules-admin', 'admin');
    const record = await platformRecord('rv-arch-rules');
    const base = { personId: record.id, primaryName: 'Demo Archive Renamed', lifeStatus: 'unknown' as const, reason: 'The fictional register.' };
    const noReason = await updateArchiveRecord(archivist.principal, { ...base, reason: '   ' }, meta).catch((e: unknown) => e);
    expect(noReason).toMatchObject({ code: 'BAD_REQUEST', fields: { reason: 'Write the reason for this edit.' } });
    expect(await refusal(updateArchiveRecord(moderator.principal, base, meta))).toBe('FORBIDDEN');
    expect(await refusal(updateArchiveRecord(admin.principal, base, meta))).toBe('FORBIDDEN');
    expect((await getArchiveRecord(moderator.principal, { slug: record.slug })).editable).toBe(false);

    const owned = await member('rv-arch-owned');
    expect(await refusal(updateArchiveRecord(archivist.principal, { ...base, personId: owned.personId }, meta))).toBe('FORBIDDEN');
    expect((await getArchiveRecord(archivist.principal, { slug: owned.slug })).editable).toBe(false);
    expect(await getDb().select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, 'person.update'), eq(auditLog.subjectId, record.id)))).toHaveLength(0);
  });
});

// M10a review, code-1: review.assign took the case FOR UPDATE and then, through the foreign key of
// its relationship_event, a KEY SHARE lock on the relationship, while review.decide and
// relationships.withdraw take the relationship FOR UPDATE first and the case second: the two
// deadlocked (40P01, a 500 for one of them). Every path now takes the relationship first.
describe('concurrent changes to one case', () => {
  /** Waits until a backend of this test database waits for a lock (review.assign behind `locker`). */
  async function untilSomeoneWaits(locker: Client): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      await locker.query('SELECT pg_stat_clear_snapshot()');
      const { rows } = await locker.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
      if (rows[0]!.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('review.assign never waited for the relationship lock');
  }

  it('review.assign waits for the relationship before it locks the case, the order of review.decide and relationships.withdraw', async () => {
    const archivist = await staff('rv-lock-order-arch', 'archivist');
    const { caseId, relationshipId } = await claim('rv-lock-order');
    const locker = new Client({ connectionString: testDb!.url });
    await locker.connect();
    try {
      await locker.query('BEGIN');
      await locker.query("SET LOCAL statement_timeout = '5s'");
      // The first step of review.decide and relationships.withdraw: the relationship FOR UPDATE.
      await locker.query('SELECT id FROM teaching_relationship WHERE id = $1 FOR UPDATE', [relationshipId]);
      const assign = outcome(assignReviewCase(archivist.principal, { caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta));
      await untilSomeoneWaits(locker);
      // Their second step, the case FOR UPDATE, does not wait for review.assign (before the fix: a deadlock).
      const second = await locker.query('SELECT id FROM review_case WHERE id = $1 FOR UPDATE', [caseId]).then(
        () => 'OK',
        (e: unknown) => pgErrorOf(e)?.code ?? String(e),
      );
      await locker.query('ROLLBACK');
      expect({ second, assign: await assign }).toEqual({ second: 'OK', assign: 'OK' });
    } finally {
      await locker.query('ROLLBACK').catch(() => undefined);
      await locker.end();
    }
  });

  const ROUNDS = 10;

  it(`"Assign to me" at the moment the student withdraws, or an administrator refuses, never deadlocks (${ROUNDS} rounds each)`, async () => {
    const archivist = await staff('rv-race-arch', 'archivist');
    const admin = await staff('rv-race-admin', 'admin');
    const outcomes: string[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const withdrawn = await claim(`rv-race-withdraw-${round}`, { teacherName: `Demo Historical Withdrawn ${letters(round)}` });
      outcomes.push(
        ...(await Promise.all([
          outcome(assignReviewCase(archivist.principal, { caseId: withdrawn.caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta)),
          outcome(withdrawRelationship(withdrawn.student.principal, { relationshipId: withdrawn.relationshipId, idempotencyKey: key() }, meta)),
        ])),
      );
      const refused = await claim(`rv-race-refuse-${round}`, { teacherName: `Demo Historical Refused ${letters(round)}` });
      outcomes.push(
        ...(await Promise.all([
          outcome(assignReviewCase(archivist.principal, { caseId: refused.caseId, assigneeId: archivist.account.id, idempotencyKey: key() }, meta)),
          outcome(decideReviewCase(admin.principal, { caseId: refused.caseId, decision: 'reject', reason: 'The fictional certificate is unreadable.', idempotencyKey: key() }, meta)),
        ])),
      );
    }
    // The one that came second may be refused (the case is closed or decided), never failed.
    expect(outcomes.filter((o) => o !== 'OK' && o !== 'CONFLICT')).toEqual([]);
  });
});

// M10a review, code-2: review.assign, unassign and needs_info write under_review -> under_review
// events with the reviewer as actor, and the request window counted them as the reviewer's own
// teacher requests: a reviewer who trains too was refused their own claim (429).
describe('the request window of a reviewer who trains too', () => {
  it(`a reviewer's queue work is not their own requests: after ${REQUESTS_PER_WINDOW} assign, unassign and needs_info events on claims about one teacher, they claim that teacher themselves`, async () => {
    const reviewer = await member('rv-window-arch', { role: 'archivist' });
    const [teacher] = await getDb()
      .insert(person)
      .values({ slug: `demo-rv-window-teacher-${key().slice(0, 8)}`, kind: 'historical', lifeStatus: 'deceased', stewardship: 'platform', visibility: 'public' })
      .returning({ id: person.id });
    await getDb().insert(personName).values({ personId: teacher!.id, value: 'Demo Window Teacher', script: 'Latn', lang: 'und-Latn', isPrimary: true });
    const aboutTeacher = { teacherId: teacher!.id, teacherName: null };
    const claims = [];
    for (let i = 0; i < 5; i += 1) claims.push(await claim(`rv-window-student-${i}`, aboutTeacher));
    // Four cases taken and released, one taken and sent back with a question: ten reviewer events.
    for (const c of claims.slice(0, 4)) {
      await assignReviewCase(reviewer.principal, { caseId: c.caseId, assigneeId: reviewer.account.id, idempotencyKey: key() }, meta);
      await assignReviewCase(reviewer.principal, { caseId: c.caseId, assigneeId: null, idempotencyKey: key() }, meta);
    }
    await assignReviewCase(reviewer.principal, { caseId: claims[4]!.caseId, assigneeId: reviewer.account.id, idempotencyKey: key() }, meta);
    await decideReviewCase(reviewer.principal, { caseId: claims[4]!.caseId, decision: 'needs_info', reason: 'Add the other page of the fictional certificate.', idempotencyKey: key() }, meta);
    const reviewerEvents = await getDb()
      .select({ id: relationshipEvent.id })
      .from(relationshipEvent)
      .where(and(eq(relationshipEvent.actorUserId, reviewer.account.id), eq(relationshipEvent.toStatus, 'under_review')));
    expect(reviewerEvents.length).toBeGreaterThanOrEqual(Math.max(REQUESTS_PER_WINDOW, REQUESTS_TO_ONE_TEACHER_PER_WINDOW));

    // Their own claim of the same teacher is their first request of the day (before the fix: 429).
    const evidence = await upload(reviewer, 'rv-window-own');
    const own = await requestHistoricalTeacher(reviewer.principal, { ...aboutTeacher, lineageId, periods: ongoingFrom('2001-09'), evidenceIds: [evidence.id], idempotencyKey: key() }, meta);
    expect(own.relationship.status).toBe('under_review');
  });
});

