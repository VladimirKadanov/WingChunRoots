// Schools and the map (milestone M11, Done when 3; plan §6.4) against PostGIS, on the seeded demo
// data: a school 49 km away is returned and one 51 km away is not; EXPLAIN of the service's own
// radius query shows the GiST index on the geography column; app_public_ro cannot read
// school_private_location; distances are whole kilometres from the public point (the city centre
// for a city-only school); last_activity_at does not move on sign-in (D17); the lineage filter;
// and the pin rule (Professional Sifu to publish, revoking it hides the pin and keeps the school).
// Fictional data only (D20): demo- slugs and example.test addresses.

import { randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { generateFixtures } from '../../fixtures/generate';
import { createAccount, signIn, setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { withClient } from '../db/admin';
import { authUser, entitlementGrant, person, personName, reviewCase, school } from '../db/schema';
import { PG, pgError } from '../db/test-support';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { revokeGrant } from './grants';
import { key, member, meta, principalOf, staff } from './relationships.test-support';
import { assignReviewCase, decideReviewCase } from './review';
import { confirmSchool, createSchool, mySchools, radiusQuery, schoolGet, schoolsInViewport, schoolsSearch, submitSchool, updateSchool } from './schools';

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
const fixtures = generateFixtures();

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

async function cityOf(name: string, countryCode: string) {
  const result = await getDb().execute<{ id: string; lat: number; lng: number }>(sql`
    SELECT id, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng FROM place WHERE name = ${name} AND country_code = ${countryCode}
     ORDER BY population DESC NULLS LAST LIMIT 1`);
  return result.rows[0]!;
}

/** A listed platform school (no listing account) at `distanceM` north of `center`. */
async function schoolNorthOf(label: string, placeId: string, center: { lat: number; lng: number }, distanceM: number): Promise<string> {
  const slug = `demo-m11-${label}-${randomBytes(3).toString('hex')}`;
  await getDb().execute(sql`
    INSERT INTO school (slug, name, place_id, location_privacy, public_point, status)
    VALUES (${slug}, ${`Demo ${label} Hall`}, ${placeId}::uuid, 'exact',
            ST_Project(ST_SetSRID(ST_MakePoint(${center.lng}::float8, ${center.lat}::float8), 4326)::geography, ${distanceM}::float8, 0)::geography, 'active')`);
  return slug;
}

describe('the radius search (plan §6.4)', () => {
  // A centre in the sea east of Varna: no demo school within 100 km of it.
  const center = { lat: 43.2, lng: 28.2 };

  it('returns a school 49 km away and not one 51 km away, with whole kilometres', async () => {
    const varna = await cityOf('Varna', 'BG');
    const near = await schoolNorthOf('49km', varna.id, center, 49_000);
    const far = await schoolNorthOf('51km', varna.id, center, 51_000);
    const answer = await schoolsSearch(null, { center, radiusKm: 50 });
    const slugs = answer.schools.map((s) => s.slug);
    expect(slugs).toContain(near);
    expect(slugs).not.toContain(far);
    expect(answer.schools.find((s) => s.slug === near)).toMatchObject({ distanceKm: 49, precision: 'exact' });
    expect(answer).toMatchObject({ radiusKm: 50, center, total: answer.schools.length });
    const wider = await schoolsSearch(null, { center, radiusKm: 52 });
    expect(wider.schools.map((s) => [s.slug, s.distanceKm])).toEqual(expect.arrayContaining([[near, 49], [far, 51]]));
  });

  it('rounds every distance to a whole kilometre', async () => {
    const varna = await cityOf('Varna', 'BG');
    const slug = await schoolNorthOf('rounding', varna.id, center, 12_620);
    const answer = await schoolsSearch(null, { center, radiusKm: 20 });
    const hit = answer.schools.find((s) => s.slug === slug)!;
    expect(hit.distanceKm).toBe(13);
    for (const s of answer.schools) expect(Number.isInteger(s.distanceKm)).toBe(true);
  });

  it("EXPLAIN of the service's radius query uses the GiST index on school.public_point (geography)", async () => {
    const plan = await getDb().transaction(async (tx) => {
      // A handful of rows: tell the planner a sequential scan is not an option, as at scale.
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const result = await tx.execute<{ 'QUERY PLAN': string }>(sql`EXPLAIN ${radiusQuery(center, 50, null)}`);
      return result.rows.map((r) => r['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('school_public_point_gist_idx');
    expect(plan).not.toMatch(/public_point\)?::geometry/);
    const type = await getDb().execute<{ t: string }>(sql`SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute WHERE attrelid = 'school'::regclass AND attname = 'public_point'`);
    expect(type.rows[0]!.t).toBe('geography(Point,4326)');
  });

  it('answers a city-only school at its city centre: precision "city", the distance from the centre, never the exact point', async () => {
    const plovdiv = await cityOf('Plovdiv', 'BG');
    const cityOnly = fixtures.schools.find((s) => s.slug === 'demo-school-city-only')!;
    const exact = fixtures.schoolPrivateLocations.find((l) => l.schoolId === cityOnly.id)!.exactPoint;
    const answer = await schoolsSearch(null, { center: exact, radiusKm: 10 });
    const hit = answer.schools.find((s) => s.slug === 'demo-school-city-only')!;
    const centroid = { lat: Math.round(plovdiv.lat * 1e5) / 1e5, lng: Math.round(plovdiv.lng * 1e5) / 1e5 };
    expect(hit).toMatchObject({ precision: 'city', point: centroid });
    const fromCentre = await getDb().execute<{ km: number }>(sql`
      SELECT round(ST_Distance(centroid, ST_SetSRID(ST_MakePoint(${exact.lng}::float8, ${exact.lat}::float8), 4326)::geography) / 1000)::int AS km FROM place WHERE id = ${plovdiv.id}::uuid`);
    expect(hit.distanceKm).toBe(fromCentre.rows[0]!.km);
    // The answer echoes its centre (the caller's own input, here the exact point on purpose); the schools never carry it.
    const json = JSON.stringify([answer.schools, await schoolGet(null, { slug: 'demo-school-city-only' }), await schoolsSearch(null, {})]);
    expect(json).not.toContain(String(exact.lat));
    expect(json).not.toContain(String(exact.lng));
    const inView = await schoolsInViewport(null, { west: exact.lng - 0.5, south: exact.lat - 0.5, east: exact.lng + 0.5, north: exact.lat + 0.5 });
    expect(inView.schools.find((s) => s.slug === 'demo-school-city-only')).toMatchObject({ precision: 'city', point: centroid });
    expect(JSON.stringify(inView)).not.toContain(String(exact.lat));
  });
});

describe('the public role', () => {
  it('cannot read school_private_location', async () => {
    await withClient(testDb!.roleUrl('app_public_ro'), async (c) => {
      const error = await pgError(c.query('SELECT exact_point FROM school_private_location LIMIT 1'));
      expect(error.code).toBe(PG.insufficientPrivilege);
    });
  });
});

describe('the lineage filter (lineage_membership from v_public_edge)', () => {
  const rootOf = (slug: string) => fixtures.persons.find((p) => p.slug === slug)!.id;

  it('returns only schools whose instructors descend from the chosen fictional root', async () => {
    const a = await schoolsSearch(null, { lineageRootId: rootOf('demo-root-a') });
    const b = await schoolsSearch(null, { lineageRootId: rootOf('demo-root-b') });
    expect(a.schools.map((s) => s.slug).sort()).toEqual(['demo-school-new-york', 'demo-school-sofia', 'demo-school-two-lineages']);
    expect(b.schools.map((s) => s.slug).sort()).toEqual(['demo-school-athens', 'demo-school-kowloon', 'demo-school-london', 'demo-school-two-lineages']);
    expect(a.lineage).toMatchObject({ rootSlug: 'demo-root-a' });
    const sofia = await cityOf('Sofia', 'BG');
    const near = await schoolsSearch(null, { center: sofia, radiusKm: 50, lineageRootId: rootOf('demo-root-b') });
    expect(near.schools).toEqual([]);
  });
});

describe('listing a school', () => {
  async function asSifu(label: string, plan: 'free_sifu' | 'pro_sifu') {
    const m = await member(label, { sifu: true });
    if (plan === 'pro_sifu') {
      await getDb()
        .insert(entitlementGrant)
        .values({ subjectUserId: m.account.id, planCode: 'pro_sifu', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: M11 test plan' });
    }
    return m;
  }

  const fields = async () => {
    const sofia = await cityOf('Sofia', 'BG');
    return { name: 'Demo M11 Kwoon', placeId: sofia.id, locationPrivacy: 'city_only' as const, point: { lat: sofia.lat + 0.01, lng: sofia.lng + 0.01 } };
  };

  it('a Free Sifu keeps a draft: submit is refused with ENTITLEMENT_REQUIRED and the refusal', async () => {
    const free = await asSifu('m11-free', 'free_sifu');
    const created = await createSchool(free.principal, { ...(await fields()), idempotencyKey: key() }, meta);
    expect(created.status).toBe('draft');
    await expect(submitSchool(free.principal, { id: created.id }, meta)).rejects.toMatchObject({
      code: 'ENTITLEMENT_REQUIRED',
      details: { entitlement: { ok: false, code: 'plan', plan: 'free_sifu', grantedBy: 'pro_sifu' } },
    });
    const [row] = await getDb().select({ status: school.status }).from(school).where(eq(school.id, created.id));
    expect(row!.status).toBe('draft');
  });

  it('the same create key twice makes one school', async () => {
    const pro = await asSifu('m11-key', 'pro_sifu');
    const k = key();
    const first = await createSchool(pro.principal, { ...(await fields()), idempotencyKey: k }, meta);
    const again = await createSchool(pro.principal, { ...(await fields()), idempotencyKey: k }, meta);
    expect(again).toMatchObject({ id: first.id, replayed: true });
    expect((await mySchools(pro.principal)).schools).toHaveLength(1);
  });

  it('a Pro Sifu publishes after the listing review; revoking the grant hides the pin and keeps the school', async () => {
    const pro = await asSifu('m11-pro', 'pro_sifu');
    const created = await createSchool(pro.principal, { ...(await fields()), idempotencyKey: key() }, meta);
    const submitted = await submitSchool(pro.principal, { id: created.id }, meta);
    expect(submitted.status).toBe('pending_review');
    expect(await schoolsSearch(null, {})).not.toMatchObject({ schools: expect.arrayContaining([expect.objectContaining({ id: created.id })]) });

    const moderator = await staff('m11-mod', 'moderator');
    await assignReviewCase(moderator.principal, { caseId: submitted.caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    const decided = await decideReviewCase(moderator.principal, { caseId: submitted.caseId, decision: 'verify', reason: null, idempotencyKey: key() }, meta);
    expect(decided.case).toMatchObject({ status: 'resolved', resolution: 'approved', school: { id: created.id, status: 'active', point: null } });
    expect(cache.revalidated).toContain('schools');
    const listed = (await schoolsSearch(null, {})).schools.find((s) => s.id === created.id);
    expect(listed).toMatchObject({ precision: 'city', instructors: [expect.objectContaining({ slug: pro.slug })] });

    const admin = await staff('m11-admin', 'admin');
    const [grant] = await getDb().select({ id: entitlementGrant.id }).from(entitlementGrant).where(eq(entitlementGrant.subjectUserId, pro.account.id));
    await revokeGrant(admin.principal, { grantId: grant!.id, reason: 'Demo: end of the M11 test' }, meta);
    expect((await schoolsSearch(null, {})).schools.find((s) => s.id === created.id)).toBeUndefined();
    await expect(schoolGet(null, { slug: created.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const own = (await mySchools(pro.principal)).schools.find((s) => s.id === created.id);
    expect(own).toMatchObject({ status: 'active', pin: 'needs_plan' });
    const [kept] = await getDb().select({ deletedAt: school.deletedAt }).from(school).where(eq(school.id, created.id));
    expect(kept).toEqual({ deletedAt: null });
  });

  it('a reviewer cannot decide their own listing, and a returned listing is a draft with the reason', async () => {
    const pro = await asSifu('m11-own', 'pro_sifu');
    await getDb().update(authUser).set({ role: 'moderator', twoFactorEnabled: true }).where(eq(authUser.id, pro.account.id));
    const created = await createSchool(pro.principal, { ...(await fields()), idempotencyKey: key() }, meta);
    const { caseId } = await submitSchool(pro.principal, { id: created.id }, meta);
    const self = principalOf(pro.account, 'moderator');
    await expect(decideReviewCase(self, { caseId, decision: 'verify', reason: null, idempotencyKey: key() }, meta)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const moderator = await staff('m11-mod2', 'moderator');
    await assignReviewCase(moderator.principal, { caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    const k = key();
    await decideReviewCase(moderator.principal, { caseId, decision: 'reject', reason: 'Add the training hall details (fictional).', idempotencyKey: k }, meta);
    const replay = await decideReviewCase(moderator.principal, { caseId, decision: 'reject', reason: 'Add the training hall details (fictional).', idempotencyKey: k }, meta);
    expect(replay.replayed).toBe(true);
    const [row] = await getDb().select({ status: school.status }).from(school).where(eq(school.id, created.id));
    expect(row!.status).toBe('draft');
    const [c] = await getDb().select({ resolution: reviewCase.resolution, reason: reviewCase.resolutionReason }).from(reviewCase).where(eq(reviewCase.id, caseId));
    expect(c).toEqual({ resolution: 'rejected', reason: 'Add the training hall details (fictional).' });
  });
});

describe('last_activity_at (D17)', () => {
  it('does not change on sign-in; an edit and a confirmation move it', async () => {
    const account = await createAccount({ label: 'm11-signin' });
    const db = getDb();
    await db.update(authUser).set({ accountType: 'sifu' }).where(eq(authUser.id, account.id));
    const personId = (await db.insert(person).values({ slug: `demo-m11-signin-${randomBytes(3).toString('hex')}`, kind: 'living', stewardship: 'self', claimedByUserId: account.id, visibility: 'public' }).returning({ id: person.id }))[0]!.id;
    await db.insert(personName).values({ personId, value: 'Demo Signin Sifu', script: 'Latn', lang: 'en', isPrimary: true });
    await db.insert(entitlementGrant).values({ subjectUserId: account.id, planCode: 'pro_sifu', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: M11 test plan' });
    const principal = principalOf({ id: account.id, email: account.email });
    const sofia = await cityOf('Sofia', 'BG');
    const created = await createSchool(principal, { name: 'Demo Signin Hall', placeId: sofia.id, locationPrivacy: 'exact', point: { lat: sofia.lat, lng: sofia.lng }, idempotencyKey: key() }, meta);
    const at = async () => (await db.select({ at: school.lastActivityAt }).from(school).where(eq(school.id, created.id)))[0]!.at.getTime();
    const before = await at();

    await signIn(account);
    await signIn(account);
    expect(await at()).toBe(before);

    await updateSchool(principal, { id: created.id, name: 'Demo Signin Hall Two', placeId: sofia.id, locationPrivacy: 'exact', point: { lat: sofia.lat, lng: sofia.lng } }, meta);
    const edited = await at();
    expect(edited).toBeGreaterThan(before);
    // Saving the same details again is no edit.
    await updateSchool(principal, { id: created.id, name: 'Demo Signin Hall Two', placeId: sofia.id, locationPrivacy: 'exact', point: { lat: sofia.lat, lng: sofia.lng } }, meta);
    expect(await at()).toBe(edited);

    await db.update(school).set({ status: 'active' }).where(and(eq(school.id, created.id)));
    await confirmSchool(principal, { id: created.id }, meta);
    expect(await at()).toBeGreaterThan(edited);
  });
});
