// The lineage card (ADR 0045): only for a public person whose plan includes it, with their public
// routes of descent; NOT_FOUND for anyone else, the same as a missing address (plan §6.4).

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { entitlementGrant, person, teachingRelationship } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { lineageCard } from './lineage-card';
import { member, meta, newLineage } from './relationships.test-support';

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

const grant = (userId: string, planCode: 'premium_student' | 'pro_sifu') =>
  getDb().insert(entitlementGrant).values({ subjectUserId: userId, planCode, source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: ADR 0045 test plan' });

const link = (teacherPersonId: string, studentPersonId: string, lineageId: string) =>
  getDb()
    .insert(teachingRelationship)
    .values({ teacherPersonId, studentPersonId, lineageId, status: 'verified', visibility: 'public', confirmedAt: new Date() });

async function refused(slug: string) {
  return lineageCard(null, { slug }, meta).then(
    () => 'answered',
    (error: { code?: string }) => error.code,
  );
}

describe('the lineage card (ADR 0045)', () => {
  it('answers for a public member whose plan includes it, with the public route from the earliest teacher', async () => {
    const root = await member('card-root');
    const teacher = await member('card-teacher');
    const student = await member('card-student');
    const lineageId = await newLineage('card');
    await link(root.personId, teacher.personId, lineageId);
    await link(teacher.personId, student.personId, lineageId);

    // Free Student: no card, the same answer as a missing address.
    expect(await refused(student.slug)).toBe('NOT_FOUND');
    expect(await refused('demo-no-such-person-card')).toBe('NOT_FOUND');

    await grant(student.account.id, 'premium_student');
    const card = await lineageCard(null, { slug: student.slug }, meta);
    expect(card).toMatchObject({ personId: student.personId, slug: student.slug });
    expect(card.paths.paths.map((p) => p.personIds)).toEqual([[root.personId, teacher.personId, student.personId]]);
  });

  it('never shows a teacher whose profile is not public, and is NOT_FOUND for a member who is not public', async () => {
    const hiddenRoot = await member('card-hidden-root', { hidden: true });
    const teacher = await member('card-visible-teacher');
    const student = await member('card-paying-student');
    const lineageId = await newLineage('cardhidden');
    await link(hiddenRoot.personId, teacher.personId, lineageId);
    await link(teacher.personId, student.personId, lineageId);
    await grant(student.account.id, 'premium_student');

    const card = await lineageCard(null, { slug: student.slug }, meta);
    expect(card.paths.paths.map((p) => p.personIds)).toEqual([[teacher.personId, student.personId]]);
    expect(card.paths.nodes.map((n) => n.id)).not.toContain(hiddenRoot.personId);

    // Paying never publishes anyone: the member hides their profile, the card goes.
    await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, student.personId));
    expect(await refused(student.slug)).toBe('NOT_FOUND');
  });

  it('is part of Professional Sifu, and goes when the plan ends', async () => {
    const sifu = await member('card-pro-sifu', { sifu: true });
    await grant(sifu.account.id, 'pro_sifu');
    const card = await lineageCard(null, { slug: sifu.slug }, meta);
    // No teacher on the record: a card with no route (the page says so).
    expect(card.paths.paths).toEqual([]);
    await getDb().update(entitlementGrant).set({ revokedAt: new Date(), revokeReason: 'Demo: ended' }).where(eq(entitlementGrant.subjectUserId, sifu.account.id));
    expect(await refused(sifu.slug)).toBe('NOT_FOUND');
  });
});
