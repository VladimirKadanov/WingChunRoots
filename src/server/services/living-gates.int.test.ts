// A person whose life status is unknown is treated as living (review 2026-11-14, owner decision;
// docs/adr/0031-consent-and-living-gates.md), against a migrated throwaway database: the verify
// panel asks the plain choice before it verifies a claim about such a teacher; "the evidence shows
// the person is deceased" (with a written reason) establishes the death and publishes, "I cannot
// establish this" verifies and leaves the record hidden; an archival edit establishes it later, only
// with evidence; no path publishes an unknown record or sets a public one to unknown. Fictional
// data only (D20).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, notification, person, personName, recordRevision, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { filesystemStore } from '../storage/fs';
import { uploadEvidence } from './evidence';
import { requestHistoricalTeacher } from './historical';
import { myTeachers } from './relationships';
import { key, type Member, member, meta, newLineage, ongoingFrom, staff } from './relationships.test-support';
import { publishPeople, UNKNOWN_STATUS_MESSAGE } from './publication';
import { assignReviewCase, DECEASED_REASON_MESSAGE, decideReviewCase, updateArchiveRecord } from './review';
import { proposeRecordChange } from './stewardship';
import { restoreProfile } from './takedown';

vi.mock('next/cache', () => ({ cacheTag: () => undefined, cacheLife: () => undefined, revalidateTag: () => undefined, updateTag: () => undefined }));

let testDb: TestDatabase | undefined;
let lineageId: string;
const root = mkdtempSync(path.join(tmpdir(), 'wcr-living-gates-'));
const store = filesystemStore(root);

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  lineageId = await newLineage('living-gates');
});
afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(root, { recursive: true, force: true });
});

async function upload(m: Pick<Member, 'principal'>, seed: string) {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% Demo evidence ${seed}, invented for the WingChunRoots tests.\n%%EOF\n`);
  return uploadEvidence(m.principal, { declaredLength: bytes.length, body: new Response(bytes).body!, name: encodeURIComponent(`demo-${seed}.pdf`), caseId: null }, meta, store);
}

/** A claim about a historical teacher whose life status the claimant gave as "not known". */
async function unknownClaim(label: string, opts: { hidden?: boolean; lifeStatus?: 'unknown' | 'deceased' } = {}) {
  const student = await member(label, { hidden: opts.hidden });
  const file = await upload(student, label);
  const result = await requestHistoricalTeacher(
    student.principal,
    { teacherName: `Demo Historical ${label}`, lifeStatus: opts.lifeStatus ?? 'unknown', lineageId, periods: ongoingFrom('1988-03'), evidenceIds: [file.id], note: 'A fictional certificate.', idempotencyKey: key() },
    meta,
  );
  const [rel] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, result.relationship.id));
  return { student, file, caseId: result.caseId, relationshipId: result.relationship.id, teacherId: rel!.teacherPersonId };
}

const teacherOf = async (id: string) => (await getDb().select().from(person).where(eq(person.id, id)))[0]!;
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: { code?: string }) => e.code ?? String(e),
  );
const fieldsOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: { fields?: Record<string, string> }) => e.fields ?? null,
  );
const isPublicEdge = async (relationshipId: string) =>
  (await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_edge WHERE id = ${relationshipId}::uuid`)).rows[0]!.n === 1;
const isPublicPerson = async (id: string) => (await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_person WHERE id = ${id}::uuid`)).rows[0]!.n === 1;
const auditsOf = async (subjectId: string, action: string) =>
  getDb()
    .select({ after: auditLog.after, reason: auditLog.reason, evidenceIds: auditLog.evidenceIds })
    .from(auditLog)
    .where(and(eq(auditLog.subjectId, subjectId), eq(auditLog.action, action)))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
const decidedPayloads = async (userId: string) =>
  (await getDb().select({ payload: notification.payload }).from(notification).where(and(eq(notification.userId, userId), eq(notification.template, 'review.decided')))).map((n) => n.payload);

async function claimFor(admin: Awaited<ReturnType<typeof staff>>, caseId: string) {
  await assignReviewCase(admin.principal, { caseId, assigneeId: admin.account.id, idempotencyKey: key() }, meta);
}

describe('verifying a claim about a teacher whose life status is unknown', () => {
  it('asks the plain choice first, and refuses a choice that makes no sense; nothing is written when it refuses', async () => {
    const archivist = await staff('lg-choice-arch', 'archivist');
    const { caseId, relationshipId, teacherId } = await unknownClaim('lg-choice');
    await claimFor(archivist, caseId);

    expect(await fieldsOf(decideReviewCase(archivist.principal, { caseId, decision: 'verify', idempotencyKey: key() }, meta))).toMatchObject({ deceased: expect.any(String) });
    // "The evidence shows this person is deceased" needs the written reason that cites it.
    expect(await fieldsOf(decideReviewCase(archivist.principal, { caseId, decision: 'verify', deceased: 'established', idempotencyKey: key() }, meta))).toEqual({ reason: DECEASED_REASON_MESSAGE });
    // The choice belongs to a verify, nothing else.
    expect(await code(decideReviewCase(archivist.principal, { caseId, decision: 'reject', reason: 'No.', deceased: 'not_established', idempotencyKey: key() }, meta))).toBe('BAD_REQUEST');

    const [rel] = await getDb().select({ status: teachingRelationship.status }).from(teachingRelationship).where(eq(teachingRelationship.id, relationshipId));
    expect(rel!.status).toBe('under_review');
    expect(await teacherOf(teacherId)).toMatchObject({ lifeStatus: 'unknown', visibility: 'involved_only' });
    expect(await auditsOf(teacherId, 'person.update')).toEqual([]); // the claim wrote person.create; nothing changed since
  });

  it('"the evidence shows this person is deceased": the record becomes deceased with the reason, and the link and the record are public', async () => {
    const archivist = await staff('lg-est-arch', 'archivist');
    const { student, file, caseId, relationshipId, teacherId } = await unknownClaim('lg-est');
    await claimFor(archivist, caseId);
    const reason = 'The fictional hall register, page 3, gives the year of death.';
    await decideReviewCase(archivist.principal, { caseId, decision: 'verify', deceased: 'established', reason, idempotencyKey: key() }, meta);

    expect(await teacherOf(teacherId)).toMatchObject({ lifeStatus: 'deceased', visibility: 'public' });
    expect(await isPublicPerson(teacherId)).toBe(true);
    expect(await isPublicEdge(relationshipId)).toBe(true);

    // The establishing step: audited by shape with the reason and the evidence the decision rests on ...
    const updates = await auditsOf(teacherId, 'person.update');
    expect(updates.at(-1)).toMatchObject({ reason, evidenceIds: [file.id], after: { archival: true, via: 'committee_review', changed: { lifeStatus: true }, lifeStatus: 'deceased', caseId } });
    expect(JSON.stringify(updates.at(-1)!.after)).not.toContain('register');
    // ... kept in the record's history ...
    const revisions = await getDb().select().from(recordRevision).where(eq(recordRevision.personId, teacherId));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ source: 'archival_edit', actorUserId: archivist.account.id, reviewCaseId: caseId, changed: ['lifeStatus'], reason });
    // ... and on the verify.
    expect((await auditsOf(relationshipId, 'relationship.verify'))[0]!.after).toMatchObject({ status: 'verified', shown: true, lifeStatus: 'deceased', deathEstablished: true, publishedPersonIds: expect.arrayContaining([teacherId]) });
    // The claimant is told the link is confirmed (and public).
    expect(await decidedPayloads(student.account.id)).toEqual([{ relationshipId, decision: 'verified' }]);
    expect((await myTeachers(student.principal)).teachers.find((v) => v.id === relationshipId)).toMatchObject({ status: 'verified', shown: true });
  });

  it('"I cannot establish this": the claim is verified, the record stays hidden as a living person, and the claimant is told it is not public yet', async () => {
    const archivist = await staff('lg-not-arch', 'archivist');
    const { student, caseId, relationshipId, teacherId } = await unknownClaim('lg-not');
    await claimFor(archivist, caseId);
    await decideReviewCase(archivist.principal, { caseId, decision: 'verify', deceased: 'not_established', idempotencyKey: key() }, meta);

    const [rel] = await getDb().select({ status: teachingRelationship.status, visibility: teachingRelationship.visibility }).from(teachingRelationship).where(eq(teachingRelationship.id, relationshipId));
    expect(rel).toEqual({ status: 'verified', visibility: 'public' });
    expect(await teacherOf(teacherId)).toMatchObject({ lifeStatus: 'unknown', visibility: 'involved_only' });
    expect(await isPublicPerson(teacherId)).toBe(false);
    expect(await isPublicEdge(relationshipId)).toBe(false);
    expect((await auditsOf(relationshipId, 'relationship.verify'))[0]!.after).toMatchObject({ shown: false, lifeStatus: 'unknown', deathEstablished: false, publishedPersonIds: [] });
    expect(await getDb().select().from(recordRevision).where(eq(recordRevision.personId, teacherId))).toEqual([]);
    expect(await decidedPayloads(student.account.id)).toEqual([{ relationshipId, decision: 'verified', shown: false }]);
    expect((await myTeachers(student.principal)).teachers.find((v) => v.id === relationshipId)).toMatchObject({ status: 'verified', shown: false });
  });

  it('a later archival edit establishes the death, only with evidence and a reason, and then publishes the record and the link', async () => {
    const reviewer = await staff('lg-late-rev', 'archivist');
    const archivist = await staff('lg-late-arch', 'archivist');
    const { student, caseId, relationshipId, teacherId } = await unknownClaim('lg-late');
    await claimFor(reviewer, caseId);
    await decideReviewCase(reviewer.principal, { caseId, decision: 'verify', deceased: 'not_established', idempotencyKey: key() }, meta);

    const edit = { personId: teacherId, primaryName: 'Demo Historical lg-late', lifeStatus: 'deceased' as const, reason: 'The fictional obituary of the hall.', evidenceIds: [] as string[] };
    // No evidence, no death: the record stays unknown.
    expect(await fieldsOf(updateArchiveRecord(archivist.principal, edit, meta))).toMatchObject({ evidenceIds: expect.any(String) });
    expect(await teacherOf(teacherId)).toMatchObject({ lifeStatus: 'unknown', visibility: 'involved_only' });
    // A reason is required as for every archival edit.
    const fresh = await upload(archivist, 'lg-late-obituary');
    expect(await code(updateArchiveRecord(archivist.principal, { ...edit, reason: '  ', evidenceIds: [fresh.id] }, meta))).toBe('BAD_REQUEST');

    const result = await updateArchiveRecord(archivist.principal, { ...edit, evidenceIds: [fresh.id] }, meta);
    expect(result.changed).toBe(true);
    expect(await teacherOf(teacherId)).toMatchObject({ lifeStatus: 'deceased', visibility: 'public' });
    expect(await isPublicEdge(relationshipId)).toBe(true);
    expect((await auditsOf(teacherId, 'person.update')).at(-1)).toMatchObject({ reason: edit.reason, evidenceIds: [fresh.id], after: { deathEstablished: true, published: true } });
    expect((await myTeachers(student.principal)).teachers.find((v) => v.id === relationshipId)).toMatchObject({ shown: true });
  });

  it('establishes the death even when the claimant has not chosen to be public: the record is published, the link is not', async () => {
    const archivist = await staff('lg-priv-arch', 'archivist');
    const { student, caseId, relationshipId, teacherId } = await unknownClaim('lg-priv', { hidden: true });
    await claimFor(archivist, caseId);
    await decideReviewCase(archivist.principal, { caseId, decision: 'verify', deceased: 'established', reason: 'The fictional register shows it.', idempotencyKey: key() }, meta);

    // A historical master has no account to ask; the claimant never ticked "Show my profile publicly".
    expect(await teacherOf(teacherId)).toMatchObject({ lifeStatus: 'deceased', visibility: 'public' });
    expect((await teacherOf(student.personId)).visibility).toBe('involved_only');
    expect(await isPublicEdge(relationshipId)).toBe(false);
    expect(await decidedPayloads(student.account.id)).toEqual([{ relationshipId, decision: 'verified', shown: false }]);
  });

  it('asks nothing when the claimant says the teacher has died', async () => {
    const archivist = await staff('lg-dead-arch', 'archivist');
    const { caseId, relationshipId, teacherId } = await unknownClaim('lg-dead', { lifeStatus: 'deceased' });
    await claimFor(archivist, caseId);
    await decideReviewCase(archivist.principal, { caseId, decision: 'verify', idempotencyKey: key() }, meta);
    expect(await teacherOf(teacherId)).toMatchObject({ lifeStatus: 'deceased', visibility: 'public' });
    expect(await isPublicEdge(relationshipId)).toBe(true);
  });
});

describe('a record whose life status is unknown is never public', () => {
  async function record(label: string, lifeStatus: 'unknown' | 'deceased' | 'living', visibility: 'public' | 'involved_only') {
    const id = uuidv7();
    await getDb().insert(person).values({ id, slug: `demo-${label}-${key().slice(0, 8)}`, kind: 'historical', lifeStatus, stewardship: 'platform', visibility });
    await getDb().insert(personName).values({ personId: id, value: `Demo ${label}`, script: 'Latn', lang: 'en', isPrimary: true });
    return id;
  }

  it('publishPeople publishes the people of a verified link only where the rules allow it', async () => {
    const unknown = await record('lg-pub-unknown', 'unknown', 'involved_only');
    const deceased = await record('lg-pub-deceased', 'deceased', 'involved_only');
    const granted = await member('lg-pub-granted', { hidden: true, granted: true });
    const silent = await member('lg-pub-silent', { hidden: true });
    const published = await getDb().transaction((tx) => publishPeople(tx, [unknown, deceased, granted.personId, silent.personId]));
    expect(published.sort()).toEqual([deceased, granted.personId].sort());
    expect((await teacherOf(unknown)).visibility).toBe('involved_only');
    expect((await teacherOf(silent.personId)).visibility).toBe('involved_only');
  });

  it('an archival edit and a proposal never set a public record to unknown', async () => {
    const archivist = await staff('lg-unk-arch', 'archivist');
    const proposer = await member('lg-unk-proposer', { sifu: true });
    const id = await record('lg-unk-public', 'deceased', 'public');
    const base = { personId: id, primaryName: 'Demo lg-unk-public', reason: 'A fictional correction.', evidenceIds: [] as string[] };
    expect(await fieldsOf(updateArchiveRecord(archivist.principal, { ...base, lifeStatus: 'unknown' }, meta))).toEqual({ lifeStatus: UNKNOWN_STATUS_MESSAGE });
    expect(await fieldsOf(proposeRecordChange(proposer.principal, { ...base, lifeStatus: 'unknown', bio: null, idempotencyKey: key() }, meta))).toEqual({ lifeStatus: UNKNOWN_STATUS_MESSAGE });
    expect(await teacherOf(id)).toMatchObject({ lifeStatus: 'deceased', visibility: 'public' });
  });

  it('putting a held record back never publishes one whose status is unknown (a hold from before the rule)', async () => {
    const moderator = await staff('lg-held-mod', 'moderator');
    const id = await record('lg-held', 'unknown', 'involved_only');
    // The state a take-down of a public record left before the rule existed (the migration corrects it; this is the belt).
    await getDb().execute(sql`UPDATE person SET taken_down_at = now(), taken_down_reason = 'A fictional hold.', taken_down_visibility = 'public' WHERE id = ${id}::uuid`);
    await restoreProfile(moderator.principal, { personId: id, reason: 'A fictional restore.' }, meta);
    expect(await teacherOf(id)).toMatchObject({ lifeStatus: 'unknown', visibility: 'involved_only', takenDownAt: null });
    expect(await isPublicPerson(id)).toBe(false);
  });
});
