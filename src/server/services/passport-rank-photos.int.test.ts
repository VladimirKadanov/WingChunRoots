// Grading photos on ranks (owner decision 2026-11-18, docs/adr/0046-passport-extras.md) against
// PostGIS: a student on a plan with the full passport puts up to three photos of their own gallery
// on one of their ranks; the public passport shows them only on the full passport and only while
// they are in the gallery; nobody else chooses them. Fictional data only (D20).

import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, entitlementGrant, passportRank, passportRankPhoto, personPhoto } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { myPassport, passportGet, setRankPhotos } from './passport';
import { member, meta } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase();
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code: string }).code;
  }
  throw new Error('expected a refusal');
}

async function premium(userId: string) {
  await getDb()
    .insert(entitlementGrant)
    .values({ subjectUserId: userId, planCode: 'premium_student', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: rank photos test plan' });
}

async function galleryPhoto(personId: string, position: number, status: 'gallery' | 'removed' = 'gallery') {
  const id = uuidv7();
  await getDb()
    .insert(personPhoto)
    .values({
      id,
      personId,
      storageKey: `photos/${randomBytes(24).toString('hex')}`,
      sha256: randomBytes(32).toString('hex'),
      width: 512,
      height: 512,
      sizeBytes: 1000,
      status,
      position,
      removedAt: status === 'removed' ? new Date() : null,
    });
  return id;
}

async function rankOf(personId: string, title = 'Demo rank') {
  const id = uuidv7();
  await getDb().insert(passportRank).values({ id, personId, rank: title, on: '2024-05-01', precision: 'month', visibility: 'public' });
  return id;
}

describe('grading photos on a rank', () => {
  it('a Free Student may not choose them', async () => {
    const free = await member('rank-photos-free');
    const rank = await rankOf(free.personId);
    const photo = await galleryPhoto(free.personId, 0);
    expect(await refusal(setRankPhotos(free.principal, { rankId: rank, photoIds: [photo] }, meta))).toBe('ENTITLEMENT_REQUIRED');
    expect((await myPassport(free.principal)).rankPhotos).toEqual({ allowed: false, limit: 3 });
  });

  it('up to three of the own gallery, in order, shown on the full public passport; taken off with an empty list', async () => {
    const student = await member('rank-photos-full');
    await premium(student.account.id);
    const rank = await rankOf(student.personId);
    const [a, b, c, d] = [await galleryPhoto(student.personId, 0), await galleryPhoto(student.personId, 1), await galleryPhoto(student.personId, 2), await galleryPhoto(student.personId, 3)];

    expect(await refusal(setRankPhotos(student.principal, { rankId: rank, photoIds: [a!, b!, c!, d!] }, meta))).toBe('BAD_REQUEST');
    expect(await setRankPhotos(student.principal, { rankId: rank, photoIds: [c!, a!] }, meta)).toEqual({ id: rank, photoIds: [c, a] });

    const mine = await myPassport(student.principal);
    expect(mine.rankPhotos).toEqual({ allowed: true, limit: 3 });
    expect(mine.entries.find((e) => e.id === rank)!.photos.map((p) => p.id)).toEqual([c, a]);
    const shown = await passportGet(null, { slug: student.slug });
    const entry = shown.timeline.flatMap((y) => y.items).find((e) => e.id === rank)!;
    expect(entry.photos.map((p) => p.id)).toEqual([c, a]);
    expect(entry.photos[0]!.small).toMatch(new RegExp(`^/api/photos/${c}/[0-9a-f]{16}/96\\.webp$`));
    expect(shown.currentRank!.photos.map((p) => p.id)).toEqual([c, a]);

    // A photo taken out of the gallery drops out of the rank.
    await getDb().update(personPhoto).set({ status: 'removed', removedAt: new Date() }).where(eq(personPhoto.id, c!));
    expect((await passportGet(null, { slug: student.slug })).currentRank!.photos.map((p) => p.id)).toEqual([a]);

    const audited = await getDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, rank));
    expect(audited.map((row) => row.action)).toContain('passport.rank_photos');

    expect(await setRankPhotos(student.principal, { rankId: rank, photoIds: [] }, meta)).toEqual({ id: rank, photoIds: [] });
    expect(await getDb().select().from(passportRankPhoto).where(eq(passportRankPhoto.rankId, rank))).toHaveLength(0);
  });

  it('never a photo of somebody else or out of the gallery, never on somebody else’s rank', async () => {
    const student = await member('rank-photos-own');
    await premium(student.account.id);
    const other = await member('rank-photos-other');
    await premium(other.account.id);
    const rank = await rankOf(student.personId);
    const theirs = await galleryPhoto(other.personId, 0);
    const removed = await galleryPhoto(student.personId, 0, 'removed');
    const mine = await galleryPhoto(student.personId, 1);
    expect(await refusal(setRankPhotos(student.principal, { rankId: rank, photoIds: [theirs] }, meta))).toBe('BAD_REQUEST');
    expect(await refusal(setRankPhotos(student.principal, { rankId: rank, photoIds: [removed] }, meta))).toBe('BAD_REQUEST');
    expect(await refusal(setRankPhotos(other.principal, { rankId: rank, photoIds: [theirs] }, meta))).toBe('NOT_FOUND');
    expect(await refusal(setRankPhotos(other.principal, { rankId: rank, photoIds: [mine] }, meta))).toBe('NOT_FOUND');
  });

  it('kept but not shown when the plan drops to the basic passport', async () => {
    const student = await member('rank-photos-basic');
    await premium(student.account.id);
    const rank = await rankOf(student.personId);
    const photo = await galleryPhoto(student.personId, 0);
    await setRankPhotos(student.principal, { rankId: rank, photoIds: [photo] }, meta);
    await getDb().update(entitlementGrant).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(entitlementGrant.subjectUserId, student.account.id));
    const shown = await passportGet(null, { slug: student.slug });
    expect(shown.level).toBe('basic');
    expect(shown.currentRank!.photos).toEqual([]);
    expect(await getDb().select().from(passportRankPhoto).where(eq(passportRankPhoto.rankId, rank))).toHaveLength(1);
  });
});
