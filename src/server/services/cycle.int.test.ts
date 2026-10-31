// The cycle check under concurrent approvals (milestone M09, Done when; plan §6.3): three requests
// that would form A→B, B→C and C→A, approved at the same moment by their three teachers, give
// exactly two successes. Each approval takes pg_advisory_xact_lock(hashtext('teaching_relationship.verify'))
// first, so they run one after another, and the cycle check of the last one, on the base table,
// sees the two edges the others committed.

import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { relationshipEvent, teachingRelationship } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { approveRelationship, closesCycle, requestTeacher } from './relationships';
import { key, member, meta, newLineage, ongoingFrom } from './relationships.test-support';

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

describe('the cycle check', () => {
  it('three concurrent approvals forming A→B, B→C, C→A give exactly two successes', async () => {
    const lineageId = await newLineage('m09-cycle');
    const a = await member('m09-cycle-a', { sifu: true });
    const b = await member('m09-cycle-b', { sifu: true });
    const c = await member('m09-cycle-c', { sifu: true });
    // Requests first: none is verified yet, so none of them closes a cycle on its own.
    const ask = async (student: typeof a, teacher: typeof a) =>
      (await requestTeacher(student.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom('2015'), idempotencyKey: key() }, meta)).relationship.id;
    const ab = await ask(b, a);
    const bc = await ask(c, b);
    const ca = await ask(a, c);

    const outcomes = await Promise.allSettled([
      approveRelationship(a.principal, { relationshipId: ab, idempotencyKey: key() }, meta),
      approveRelationship(b.principal, { relationshipId: bc, idempotencyKey: key() }, meta),
      approveRelationship(c.principal, { relationshipId: ca, idempotencyKey: key() }, meta),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('cycle') });

    const rows = await getDb()
      .select({ id: teachingRelationship.id, status: teachingRelationship.status })
      .from(teachingRelationship)
      .where(inArray(teachingRelationship.id, [ab, bc, ca]));
    expect(rows.filter((r) => r.status === 'verified')).toHaveLength(2);
    // The refused one stays pending, with no event of an approval.
    const refused = rows.find((r) => r.status !== 'verified')!;
    expect(refused.status).toBe('pending_teacher');
    const approvals = await getDb()
      .select({ id: relationshipEvent.id })
      .from(relationshipEvent)
      .where(and(eq(relationshipEvent.relationshipId, refused.id), eq(relationshipEvent.toStatus, 'verified')));
    expect(approvals).toHaveLength(0);
  });

  it('a hidden verified edge still closes a cycle (the base table, not v_public_edge)', async () => {
    const lineageId = await newLineage('m09-cycle-hidden');
    const teacher = await member('m09-cycle-hidden-teacher', { sifu: true });
    const student = await member('m09-cycle-hidden-student', { hidden: true });
    await getDb().insert(teachingRelationship).values({
      teacherPersonId: teacher.personId,
      studentPersonId: student.personId,
      lineageId,
      status: 'verified',
      visibility: 'involved_only',
    });
    // The student as the teacher of their own teacher: a cycle, though the edge is not public.
    expect(await closesCycle(getDb(), student.personId, teacher.personId)).toBe(true);
    const refusal = await requestTeacher(teacher.principal, { teacherId: student.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta).catch(
      (e: unknown) => e,
    );
    // A hidden student cannot be found as a teacher at all; the cycle check stands behind it.
    expect(refusal).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a request that would close a cycle with a verified link is refused at once with a clear message', async () => {
    const lineageId = await newLineage('m09-cycle-early');
    const teacher = await member('m09-cycle-early-teacher', { sifu: true });
    const student = await member('m09-cycle-early-student', { sifu: true });
    const id = (await requestTeacher(student.principal, { teacherId: teacher.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta)).relationship.id;
    await approveRelationship(teacher.principal, { relationshipId: id, idempotencyKey: key() }, meta);
    const refusal = (await requestTeacher(teacher.principal, { teacherId: student.personId, lineageId, periods: ongoingFrom(), idempotencyKey: key() }, meta).catch(
      (e: unknown) => e,
    )) as { code: string; message: string; fields: Record<string, string> };
    expect(refusal.code).toBe('CONFLICT');
    expect(refusal.fields.teacherId).toContain('This would create a cycle');
  });
});
