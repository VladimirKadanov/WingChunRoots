// Quotas under concurrent requests (M08, Done when 2; plan §6.5): ten approvals at once for a
// Free Sifu with four students give exactly one success, because withQuota() takes the advisory
// lock of (feature, subject) and counts in the same transaction as the write. The approval here
// is a minimal stand-in for M09's transition (pending_teacher → verified); M09 calls the same
// withQuota() after the global lock of plan §6.3.

import { randomBytes } from 'node:crypto';

import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { authUser, entitlementGrant, lineage, person, personName, teachingRelationship } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { requireEntitlement } from './access';
import { lockQuota, withQuota } from './quota';

let testDb: TestDatabase | undefined;
let lineageId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  process.env.DATABASE_URL = testDb.url;
  lineageId = uuidv7();
  await getDb().insert(lineage).values({ id: lineageId, slug: `demo-quota-${randomBytes(3).toString('hex')}`, name: 'Demo Quota Lineage' });
});

afterAll(async () => {
  await closeDb();
  await testDb?.drop();
});

async function newPerson(label: string, userId: string | null = null): Promise<string> {
  const id = uuidv7();
  await getDb()
    .insert(person)
    .values({
      id,
      slug: `demo-${label}-${randomBytes(4).toString('hex')}`,
      kind: 'living',
      stewardship: userId ? 'self' : 'unclaimed',
      claimedByUserId: userId,
    });
  await getDb().insert(personName).values({ personId: id, value: `Demo ${label}`, script: 'Latn', lang: 'und-Latn', isPrimary: true });
  return id;
}

interface Sifu {
  userId: string;
  personId: string;
  pending: string[];
}

/** A Sifu account with its own person, `verified` students and `pending` requests. */
async function sifuWith(verified: number, pending: number): Promise<Sifu> {
  const userId = uuidv7();
  await getDb().insert(authUser).values({ id: userId, email: `demo-quota-${randomBytes(4).toString('hex')}@example.test`, emailVerified: true, accountType: 'sifu' });
  const personId = await newPerson('quota-sifu', userId);
  const rel = async (status: 'verified' | 'pending_teacher') => {
    const id = uuidv7();
    await getDb()
      .insert(teachingRelationship)
      .values({ id, teacherPersonId: personId, studentPersonId: await newPerson('quota-student'), lineageId, status, visibility: status === 'verified' ? 'public' : 'involved_only' });
    return id;
  };
  for (let i = 0; i < verified; i++) await rel('verified');
  const ids: string[] = [];
  for (let i = 0; i < pending; i++) ids.push(await rel('pending_teacher'));
  return { userId, personId, pending: ids };
}

/**
 * A barrier for `n` transactions: each one waits until all of them are open, so they really run
 * at the same time (otherwise the first one could finish before the pool has opened the others'
 * connections, and the test would pass without any lock).
 */
function barrier(n: number): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  const all = new Promise<void>((resolve) => (open = resolve));
  return () => {
    arrived += 1;
    if (arrived === n) open();
    return all;
  };
}

/** The stand-in for M09's approval: the quota check and the transition in one transaction. */
function approve(sifu: Sifu, relationshipId: string, ready?: () => Promise<void>) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT 1`);
    await ready?.();
    return withQuota(tx, { kind: 'user', userId: sifu.userId }, 'approve_students', async () => {
      const updated = await tx
        .update(teachingRelationship)
        .set({ status: 'verified', visibility: 'public', confirmedByUserId: sifu.userId, confirmedAt: new Date() })
        .where(and(eq(teachingRelationship.id, relationshipId), eq(teachingRelationship.status, 'pending_teacher')))
        .returning({ id: teachingRelationship.id });
      return updated.length;
    });
  });
}

async function verifiedCount(personId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(teachingRelationship)
    .where(and(eq(teachingRelationship.teacherPersonId, personId), inArray(teachingRelationship.status, ['verified', 'in_arbitration'])));
  return row!.n;
}

describe('withQuota() under concurrent approvals', () => {
  it('10 parallel approvals at Free Sifu with 4 students give exactly 1 success', async () => {
    const sifu = await sifuWith(4, 10);
    const ready = barrier(sifu.pending.length);
    const outcomes = await Promise.all(sifu.pending.map((id) => approve(sifu, id, ready)));

    const successes = outcomes.filter((o) => o.ok);
    expect(successes).toHaveLength(1);
    expect(successes[0]).toMatchObject({ ok: true, value: 1, decision: { plan: 'free_sifu', limit: 5, current: 4 } });
    for (const refusal of outcomes.filter((o) => !o.ok)) {
      expect(refusal).toEqual({ ok: false, code: 'quota', plan: 'free_sifu', limit: 5, current: 5, grantedBy: 'pro_sifu' });
    }
    expect(await verifiedCount(sifu.personId)).toBe(5);
    // The refused requests stay pending (plan §3.2).
    const [pending] = await getDb()
      .select({ n: count() })
      .from(teachingRelationship)
      .where(and(eq(teachingRelationship.teacherPersonId, sifu.personId), eq(teachingRelationship.status, 'pending_teacher')));
    expect(pending!.n).toBe(9);
  });

  it('with an active Pro Sifu grant every one of them succeeds (no limit in the pilot)', async () => {
    const sifu = await sifuWith(4, 6);
    await getDb().insert(entitlementGrant).values({ subjectUserId: sifu.userId, planCode: 'pro_sifu', source: 'test_grant', reason: 'Demo quota test' });
    const ready = barrier(sifu.pending.length);
    const outcomes = await Promise.all(sifu.pending.map((id) => approve(sifu, id, ready)));
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(await verifiedCount(sifu.personId)).toBe(10);
  });

  it('the lock serializes one subject and leaves another subject free', async () => {
    const first = await sifuWith(0, 0);
    const other = await sifuWith(0, 0);
    const subject = { kind: 'user' as const, userId: first.userId };
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));

    const holder = getDb().transaction(async (tx) => {
      await lockQuota(tx, subject, 'approve_students');
      locked();
      await held;
    });
    await isLocked;

    // Another subject's lock is free at once.
    await getDb().transaction((tx) => lockQuota(tx, { kind: 'user', userId: other.userId }, 'approve_students'));
    // The same feature of another kind for the same subject is a different key too.
    await getDb().transaction((tx) => lockQuota(tx, subject, 'school_map'));

    let waiterDone = false;
    const waiter = getDb()
      .transaction((tx) => lockQuota(tx, subject, 'approve_students'))
      .then(() => {
        waiterDone = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(waiterDone).toBe(false);
    release();
    await holder;
    await waiter;
    expect(waiterDone).toBe(true);
  });

  it('at the limit, a second link of a student who already counts is approved; a new student is not (D06 counts distinct students)', async () => {
    const sifu = await sifuWith(5, 1);
    const subject = { kind: 'user' as const, userId: sifu.userId };
    const [counted] = await getDb()
      .select({ studentId: teachingRelationship.studentPersonId })
      .from(teachingRelationship)
      .where(and(eq(teachingRelationship.teacherPersonId, sifu.personId), eq(teachingRelationship.status, 'verified')))
      .limit(1);
    const otherLineage = uuidv7();
    await getDb().insert(lineage).values({ id: otherLineage, slug: `demo-quota-${randomBytes(3).toString('hex')}`, name: 'Demo Quota Lineage Two' });
    const secondLink = uuidv7();
    await getDb().insert(teachingRelationship).values({
      id: secondLink,
      teacherPersonId: sifu.personId,
      studentPersonId: counted!.studentId,
      lineageId: otherLineage,
      status: 'pending_teacher',
      visibility: 'involved_only',
    });
    const [newStudent] = await getDb()
      .select({ id: teachingRelationship.id, studentId: teachingRelationship.studentPersonId })
      .from(teachingRelationship)
      .where(and(eq(teachingRelationship.teacherPersonId, sifu.personId), eq(teachingRelationship.lineageId, lineageId), eq(teachingRelationship.status, 'pending_teacher')));

    const run = (relationshipId: string, unit: string) =>
      getDb().transaction((tx) =>
        withQuota(
          tx,
          subject,
          'approve_students',
          async () => {
            const updated = await tx
              .update(teachingRelationship)
              .set({ status: 'verified', confirmedByUserId: sifu.userId, confirmedAt: new Date() })
              .where(and(eq(teachingRelationship.id, relationshipId), eq(teachingRelationship.status, 'pending_teacher')))
              .returning({ id: teachingRelationship.id });
            return updated.length;
          },
          { unit },
        ),
      );

    expect(await run(newStudent!.id, newStudent!.studentId)).toEqual({ ok: false, code: 'quota', plan: 'free_sifu', limit: 5, current: 5, grantedBy: 'pro_sifu' });
    expect(await run(secondLink, counted!.studentId)).toEqual({ ok: true, value: 1, decision: { ok: true, plan: 'free_sifu', limit: 5, current: 5 } });
    // Still five distinct students.
    expect(await requireEntitlement(subject, 'approve_students')).toMatchObject({ ok: false, code: 'quota', current: 5 });
  });

  it('requireEntitlement() alone reads the same decision without writing', async () => {
    const sifu = await sifuWith(5, 1);
    expect(await requireEntitlement({ kind: 'user', userId: sifu.userId }, 'approve_students')).toMatchObject({ ok: false, code: 'quota', current: 5 });
  });
});
