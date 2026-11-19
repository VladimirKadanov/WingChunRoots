// The kung fu family (ADR 0048): the family page from the public lineage only, private follows on a
// plan that includes them, and the weekly digest with counts only, once per account and week.

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { entitlementGrant, notification, passportRank, person, personFollow, teachingRelationship, trainingPeriod } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { familyGet, followAdd, followRemove, followsList, followState, isoWeek, runFamilyDigest } from './family';
import { member, newLineage } from './relationships.test-support';

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

const grant = async (userId: string) => {
  const [row] = await getDb()
    .insert(entitlementGrant)
    .values({ subjectUserId: userId, planCode: 'premium_student', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: ADR 0048 test plan' })
    .returning({ id: entitlementGrant.id });
  return row!.id;
};
const endGrant = (id: string) => getDb().update(entitlementGrant).set({ endsAt: new Date(Date.now() - 1_000) }).where(eq(entitlementGrant.id, id));

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'answered',
    (error: { code?: string }) => error.code,
  );

/** A verified relationship, public unless `hidden`, with a start when `from` is given. */
async function teaches(lineageId: string, teacherPersonId: string, studentPersonId: string, opts: { from?: string; hidden?: boolean; confirmedAt?: Date } = {}) {
  const [rel] = await getDb()
    .insert(teachingRelationship)
    .values({ teacherPersonId, studentPersonId, lineageId, status: 'verified', visibility: opts.hidden ? 'involved_only' : 'public', confirmedAt: opts.confirmedAt ?? new Date(Date.now() - 30 * 86_400_000) })
    .returning({ id: teachingRelationship.id });
  if (opts.from) await getDb().insert(trainingPeriod).values({ relationshipId: rel!.id, startsOn: `${opts.from}-01-01`, precision: 'year', ongoing: true });
  return rel!.id;
}

describe('the kung fu family (ADR 0048)', () => {
  it('shows teachers, classmates by seniority and cousins from the public lineage only; nothing on a lower plan', async () => {
    const lineageId = await newLineage('family');
    const grand = await member('family-grand', { sifu: true });
    const teacher = await member('family-teacher', { sifu: true });
    const uncle = await member('family-uncle', { sifu: true });
    const me = await member('family-me');
    const senior = await member('family-senior');
    const junior = await member('family-junior');
    const privateMate = await member('family-private');
    const hiddenMate = await member('family-hidden', { hidden: true });
    const cousin = await member('family-cousin');
    await getDb().update(person).set({ countryCode: 'BG' }).where(eq(person.id, senior.personId));
    await getDb().update(person).set({ countryCode: 'DE' }).where(eq(person.id, cousin.personId));

    await teaches(lineageId, grand.personId, teacher.personId);
    await teaches(lineageId, grand.personId, uncle.personId);
    await teaches(lineageId, teacher.personId, me.personId, { from: '2019', hidden: true });
    await teaches(lineageId, teacher.personId, senior.personId, { from: '2015' });
    await teaches(lineageId, teacher.personId, junior.personId, { from: '2022', confirmedAt: new Date() });
    await teaches(lineageId, teacher.personId, privateMate.personId, { hidden: true });
    await teaches(lineageId, teacher.personId, hiddenMate.personId);
    await teaches(lineageId, uncle.personId, cousin.personId);

    const free = await familyGet(me.principal);
    expect(free.allowed).toBe(false);
    expect(free.branches).toEqual([]);
    expect(await codeOf(followAdd(me.principal, { slug: senior.slug }))).toBe('ENTITLEMENT_REQUIRED');

    const grantId = await grant(me.account.id);
    const family = await familyGet(me.principal);
    expect(family.allowed).toBe(true);
    expect(family.branches).toHaveLength(1);
    const [branch] = family.branches;
    expect(branch!.teacher.slug).toBe(teacher.slug);
    expect(branch!.ownStartYear).toBe(2019);
    // Neither the private relationship nor the hidden person shows.
    expect(branch!.classmates.map((c) => [c.slug, c.seniority, c.isNew])).toEqual([
      [senior.slug, 'senior', false],
      [junior.slug, 'junior', true],
    ]);
    expect(family.cousins.map((g) => [g.teacher.slug, g.via.slug, g.cousins.map((c) => c.slug)])).toEqual([[uncle.slug, teacher.slug, [cousin.slug]]]);
    expect(family.countries).toEqual(['BG', 'DE']);

    const inBulgaria = await familyGet(me.principal, { country: 'BG' });
    expect(inBulgaria.branches[0]!.classmates.map((c) => c.slug)).toEqual([senior.slug]);
    expect(inBulgaria.cousins).toEqual([]);
    expect(await codeOf(familyGet(me.principal, { country: 'bulgaria' }))).toBe('BAD_REQUEST');

    await endGrant(grantId);
    expect((await familyGet(me.principal)).allowed).toBe(false);
  });

  it('keeps follows private, refuses yourself and anyone not public, and keeps them on a lower plan', async () => {
    const me = await member('follow-me');
    const other = await member('follow-other');
    const hidden = await member('follow-hidden', { hidden: true });
    const grantId = await grant(me.account.id);

    expect(await followAdd(me.principal, { slug: other.slug })).toEqual({ slug: other.slug, followed: true });
    // Twice is the same as once.
    await followAdd(me.principal, { slug: other.slug });
    expect(await codeOf(followAdd(me.principal, { slug: me.slug }))).toBe('BAD_REQUEST');
    expect(await codeOf(followAdd(me.principal, { slug: hidden.slug }))).toBe('NOT_FOUND');
    expect(await codeOf(followAdd(me.principal, { slug: 'Not a slug!' }))).toBe('NOT_FOUND');
    expect(await codeOf(followAdd(null, { slug: other.slug }))).toBe('UNAUTHORIZED');

    await getDb().insert(passportRank).values({ personId: other.personId, rank: 'Demo follow level', on: '2026-01-01', precision: 'month', visibility: 'public' });
    const list = await followsList(me.principal);
    expect(list.people).toEqual([{ slug: other.slug, name: expect.objectContaining({ value: expect.any(String) }), rank: 'Demo follow level', newRank: true }]);
    expect(await followState(me.principal, other.slug)).toEqual({ allowed: true, followed: true, self: false });
    // The person followed does not see it.
    expect((await followsList(other.principal)).people).toEqual([]);
    expect(await followState(other.principal, me.slug)).toMatchObject({ followed: false });

    await endGrant(grantId);
    expect(await codeOf(followAdd(me.principal, { slug: hidden.slug }))).toBe('NOT_FOUND');
    const kept = await followsList(me.principal);
    expect(kept.allowed).toBe(false);
    expect(kept.people).toHaveLength(1);
    // Unfollowing works on any plan.
    expect(await followRemove(me.principal, { slug: other.slug })).toEqual({ slug: other.slug, followed: false });
    expect(await getDb().select().from(personFollow).where(eq(personFollow.followerUserId, me.account.id))).toEqual([]);
  });
});

describe('the weekly digest (ADR 0048)', () => {
  it('counts who joined under your teachers and new ranks of the people you follow, once a week, on the plan only', async () => {
    const lineageId = await newLineage('digest');
    const teacher = await member('digest-teacher', { sifu: true });
    const me = await member('digest-me');
    const freeMate = await member('digest-free');
    const newcomer = await member('digest-newcomer');
    const followed = await member('digest-followed');
    await teaches(lineageId, teacher.personId, me.personId);
    await teaches(lineageId, teacher.personId, freeMate.personId);
    await teaches(lineageId, teacher.personId, newcomer.personId, { confirmedAt: new Date(Date.now() - 86_400_000) });
    await grant(me.account.id);
    await getDb().insert(personFollow).values({ followerUserId: me.account.id, personId: followed.personId });
    await getDb().insert(passportRank).values({ personId: followed.personId, rank: 'Demo digest level', on: '2026-02-01', precision: 'month', visibility: 'public' });

    const now = new Date();
    const first = await runFamilyDigest(getDb(), now);
    expect(first.notices).toBeGreaterThanOrEqual(1);
    const mine = await getDb()
      .select({ payload: notification.payload, key: notification.dedupeKey })
      .from(notification)
      .where(and(eq(notification.userId, me.account.id), eq(notification.template, 'family.digest')));
    expect(mine).toEqual([{ payload: { week: isoWeek(now), joined: 1, ranks: 1 }, key: `family.digest:${isoWeek(now)}` }]);
    // The classmate on a free plan hears nothing, though someone joined under their teacher too.
    const theirs = await getDb()
      .select({ id: notification.id })
      .from(notification)
      .where(and(eq(notification.userId, freeMate.account.id), eq(notification.template, 'family.digest')));
    expect(theirs).toEqual([]);

    // A rerun in the same week sends nothing more.
    await runFamilyDigest(getDb(), now);
    const again = await getDb()
      .select({ id: notification.id })
      .from(notification)
      .where(and(eq(notification.userId, me.account.id), eq(notification.template, 'family.digest')));
    expect(again).toHaveLength(1);
  });

  it('names the ISO week', () => {
    expect(isoWeek(new Date('2026-11-19T12:00:00Z'))).toBe('2026-W47');
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
  });
});
