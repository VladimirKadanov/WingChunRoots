// The retention of a third party's record and of the evidence of a refused claim, against the real
// flows that make them (invitations.ts, historical.ts, review.ts): the audit marker that the purge
// looks for is written by the services themselves, so a change of their wording would fail here,
// not silently stop the purge. Fictional data only (D20).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { evidenceFile, person, personName, reviewNote, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { filesystemStore } from '../storage/fs';
import { uploadEvidence } from './evidence';
import { requestHistoricalTeacher } from './historical';
import { inviteTeacher } from './invitations';
import { key, member, meta, newLineage, ongoingFrom, staff } from './relationships.test-support';
import { NOTE_PURGED, purgeEndedClaimData, purgeThirdPartyRecords } from './retention-records';
import { addReviewNote, assignReviewCase, decideReviewCase } from './review';

vi.mock('next/cache', () => ({ cacheTag: () => undefined, cacheLife: () => undefined, revalidateTag: () => undefined, updateTag: () => undefined }));

let testDb: TestDatabase | undefined;
let lineageId: string;
const root = mkdtempSync(path.join(tmpdir(), 'wcr-retention-flows-'));
const store = filesystemStore(root);

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  lineageId = await newLineage('retention-flows');
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(root, { recursive: true, force: true });
});

async function upload(m: Awaited<ReturnType<typeof member>>, seed: string) {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% Demo evidence ${seed}, invented for the WingChunRoots tests.\n%%EOF\n`);
  return uploadEvidence(m.principal, { declaredLength: bytes.length, body: new Response(bytes).body!, name: encodeURIComponent(`demo-${seed}.pdf`), caseId: null }, meta, store);
}

/** Moves everything about a record `days` into the past, as if the claim had ended then. */
async function backdate(personId: string, days: number): Promise<void> {
  const at = sql`now() - make_interval(days => ${days})`;
  await getDb().execute(sql`UPDATE person SET created_at = ${at}, updated_at = ${at} WHERE id = ${personId}::uuid`);
  await getDb().execute(sql`UPDATE teaching_relationship SET updated_at = ${at} WHERE teacher_person_id = ${personId}::uuid`);
  await getDb().execute(sql`UPDATE invitation SET expires_at = ${at}, created_at = ${at}, updated_at = ${at} WHERE person_id = ${personId}::uuid`);
  await getDb().execute(sql`UPDATE review_case SET resolved_at = ${at}, updated_at = ${at} WHERE resolved_at IS NOT NULL AND person_id = ${personId}::uuid`);
  await getDb().execute(sql`UPDATE review_case SET resolved_at = ${at}, updated_at = ${at}
                             WHERE resolved_at IS NOT NULL AND relationship_id IN (SELECT id FROM teaching_relationship WHERE teacher_person_id = ${personId}::uuid)`);
}

describe('a teacher invited by a student who never joined', () => {
  it('is removed 60 days after the invitation ended, and the request that waited for them is withdrawn', async () => {
    const student = await member('rf-invite');
    const result = await inviteTeacher(
      student.principal,
      { teacherName: 'Demo Invited Retention', lineageId, periods: ongoingFrom('2012-09'), email: 'demo-rf-invite@example.test', evidenceIds: [], idempotencyKey: key() },
      meta,
    );
    const [rel] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, result.relationship.id));
    const teacherId = rel!.teacherPersonId;

    // Inside the period: nothing happens, however old the record is.
    await backdate(teacherId, 59);
    expect(await purgeThirdPartyRecords(getDb())).toMatchObject({ deleted: 0, removed: 0 });
    await backdate(teacherId, 61);
    expect(await purgeThirdPartyRecords(getDb())).toEqual({ deleted: 0, removed: 1, requestsWithdrawn: 1 });

    const [teacher] = await getDb().select({ slug: person.slug, deletedAt: person.deletedAt }).from(person).where(eq(person.id, teacherId));
    expect(teacher!.slug).toBe(`removed-${teacherId.replaceAll('-', '')}`);
    expect(teacher!.deletedAt).not.toBeNull();
    expect(await getDb().select().from(personName).where(eq(personName.personId, teacherId))).toEqual([]);
    const [after] = await getDb().select({ status: teachingRelationship.status }).from(teachingRelationship).where(eq(teachingRelationship.id, result.relationship.id));
    expect(after!.status).toBe('withdrawn');
    // The student's own record and request history are not touched.
    expect(await getDb().select({ id: person.id }).from(person).where(eq(person.id, student.personId))).toHaveLength(1);
  });
});

describe('a historical teacher claim that was refused', () => {
  it('loses its evidence file and its review notes after 90 days, and the teacher record after 60', async () => {
    const student = await member('rf-claim');
    const file = await upload(student, 'rf-claim');
    const result = await requestHistoricalTeacher(
      student.principal,
      { teacherName: 'Demo Historical Retention', lifeStatus: 'deceased', lineageId, periods: ongoingFrom('1988-03'), evidenceIds: [file.id], note: 'A fictional certificate.', idempotencyKey: key() },
      meta,
    );
    const [rel] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, result.relationship.id));
    const teacherId = rel!.teacherPersonId;

    const reviewer = await staff('rf-claim-arch', 'archivist');
    await assignReviewCase(reviewer.principal, { caseId: result.caseId, assigneeId: reviewer.account.id, idempotencyKey: key() }, meta);
    await addReviewNote(reviewer.principal, { caseId: result.caseId, body: 'Internal: the certificate does not match.', idempotencyKey: key() }, meta);
    await decideReviewCase(reviewer.principal, { caseId: result.caseId, decision: 'reject', reason: 'Demo: not established.', idempotencyKey: key() }, meta);

    // Just refused: nothing is due.
    expect(await purgeEndedClaimData(getDb(), { evidenceStore: store })).toMatchObject({ files: 0, notes: 0 });
    const [stamped] = await getDb().select({ until: evidenceFile.retentionUntil, deletedAt: evidenceFile.deletedAt }).from(evidenceFile).where(eq(evidenceFile.id, file.id));
    expect(stamped!.until).not.toBeNull();
    expect(stamped!.deletedAt).toBeNull();
    expect(await store.get(await keyOf(file.id))).not.toBeNull();

    await backdate(teacherId, 91);
    expect(await purgeEndedClaimData(getDb(), { evidenceStore: store })).toMatchObject({ files: 1, failed: 0 });
    const [gone] = await getDb().select({ deletedAt: evidenceFile.deletedAt, name: evidenceFile.originalName }).from(evidenceFile).where(eq(evidenceFile.id, file.id));
    expect(gone!.deletedAt).not.toBeNull();
    expect(gone!.name).toBeNull();
    expect(await store.get(await keyOf(file.id))).toBeNull();
    const notes = await getDb().select({ body: reviewNote.body }).from(reviewNote).where(eq(reviewNote.reviewCaseId, result.caseId));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.body === NOTE_PURGED)).toBe(true);

    // The record made for the dead teacher: refused, past 60 days.
    expect(await purgeThirdPartyRecords(getDb())).toMatchObject({ removed: 1 });
  });
});

async function keyOf(fileId: string): Promise<string> {
  const [row] = await getDb().select({ key: evidenceFile.storageKey }).from(evidenceFile).where(eq(evidenceFile.id, fileId));
  return row!.key;
}
