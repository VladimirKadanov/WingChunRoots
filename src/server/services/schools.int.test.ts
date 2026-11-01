// Schools and the map (milestone M11, Done when 3; plan §6.4) against PostGIS, on the seeded demo
// data: a school 49 km away is returned and one 51 km away is not; EXPLAIN of the service's own
// radius query shows the GiST index on the geography column; app_public_ro cannot read
// school_private_location; distances are whole kilometres from the public point (the city centre
// for a city-only school); last_activity_at does not move on sign-in (D17); the lineage filter;
// and the pin rule (Professional Sifu to publish, revoking it hides the pin and keeps the school).
// Fictional data only (D20): demo- slugs and example.test addresses.

import { randomBytes } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { assignReviewCase, decideReviewCase, getReviewCase } from './review';
import { confirmSchool, createSchool, mySchools, radiusQuery, schoolEditor, schoolGet, schoolsInViewport, schoolsSearch, submitSchool, updateSchool } from './schools';

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
    const schoolVersion = (await getReviewCase(moderator.principal, { id: submitted.caseId })).school!.version;
    const decided = await decideReviewCase(moderator.principal, { caseId: submitted.caseId, decision: 'verify', reason: null, idempotencyKey: key(), schoolVersion }, meta);
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

// --- M11 review fixes ----------------------------------------------------------------------------

/** A Sifu with their own public person, holding a Professional Sifu test plan when `pro`. */
async function sifuWithPlan(label: string, pro = true) {
  const m = await member(label, { sifu: true });
  if (pro) {
    await getDb()
      .insert(entitlementGrant)
      .values({ subjectUserId: m.account.id, planCode: 'pro_sifu', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: M11 test plan' });
  }
  return m;
}

/** A moderator takes the case and approves the listing as the case card shows it (its version). */
async function approveAsModerator(caseId: string, label: string) {
  const moderator = await staff(label, 'moderator');
  await assignReviewCase(moderator.principal, { caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
  const schoolVersion = (await getReviewCase(moderator.principal, { id: caseId })).school!.version;
  await decideReviewCase(moderator.principal, { caseId, decision: 'verify', reason: null, idempotencyKey: key(), schoolVersion }, meta);
  return moderator;
}

/** A listed (active, public) school of a Pro Sifu, approved through the review. */
async function listedSchool(sifu: Awaited<ReturnType<typeof sifuWithPlan>>, fields: Record<string, unknown>, label: string) {
  const created = await createSchool(sifu.principal, { ...(fields as never), idempotencyKey: key() }, meta);
  const { caseId } = await submitSchool(sifu.principal, { id: created.id }, meta);
  await approveAsModerator(caseId, `${label}-mod`);
  return created;
}

/** A platform school (no listing account), listed, at an exact point (`place` only names its city). */
async function platformSchoolAt(label: string, placeId: string, point: { lat: number; lng: number }): Promise<string> {
  const slug = `demo-m11-${label}-${randomBytes(3).toString('hex')}`;
  await getDb().execute(sql`
    INSERT INTO school (slug, name, place_id, location_privacy, public_point, status)
    VALUES (${slug}, ${`Demo ${label} Hall`}, ${placeId}::uuid, 'exact', ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326)::geography, 'active')`);
  return slug;
}

const viewSlugs = async (box: { west: number; south: number; east: number; north: number }) => (await schoolsInViewport(null, box)).schools.map((s) => s.slug);

describe('schools.inViewport: a box of parallels and meridians (M11 review, code-1)', () => {
  it('a whole-world box returns every public school, also with MapLibre longitudes beyond ±180', async () => {
    const all = (await schoolsSearch(null, {})).schools.map((s) => s.slug).sort();
    expect(all.length).toBeGreaterThanOrEqual(7);
    expect((await viewSlugs({ west: -180, south: -85, east: 180, north: 85 })).sort()).toEqual(all);
    // World copies on both sides (getBounds() of a zoomed-out map), and a box shifted by a full turn.
    expect((await viewSlugs({ west: -540, south: -85, east: 540, north: 85 })).sort()).toEqual(all);
    expect((await viewSlugs({ west: -200, south: -85, east: 160, north: 85 })).sort()).toEqual(all);
    // Wider than 180°: Sofia, Athens, London and New York are all inside -100..100, 20..70.
    expect(await viewSlugs({ west: -100, south: 20, east: 100, north: 70 })).toEqual(
      expect.arrayContaining(['demo-school-sofia', 'demo-school-athens', 'demo-school-london', 'demo-school-new-york', 'demo-school-two-lineages']),
    );
  });

  it('a continental box follows its parallels: a school just inside the southern edge is in, one just north of the box is out', async () => {
    const sofia = await cityOf('Sofia', 'BG');
    const south = await platformSchoolAt('south-edge', sofia.id, { lat: 35.3, lng: 10 });
    const north = await platformSchoolAt('north-out', sofia.id, { lat: 60.4, lng: 10 });
    const europe = await viewSlugs({ west: -10, south: 35, east: 30, north: 60 });
    expect(europe).toContain(south);
    expect(europe).not.toContain(north);
    expect(europe).toEqual(expect.arrayContaining(['demo-school-sofia', 'demo-school-athens', 'demo-school-two-lineages']));
    expect(europe).not.toContain('demo-school-new-york');
    // The same edges with the box shifted by a whole turn (a world copy east of the first).
    expect((await viewSlugs({ west: 350, south: 35, east: 390, north: 60 })).sort()).toEqual([...europe].sort());
  });

  it('a box across the antimeridian, in either form, holds the schools on both sides of 180° and nothing else', async () => {
    const kowloon = await cityOf('Kowloon', 'HK');
    const west = await platformSchoolAt('antimeridian-w', kowloon.id, { lat: -17.5, lng: 179.5 });
    const east = await platformSchoolAt('antimeridian-e', kowloon.id, { lat: -17.5, lng: -179.5 });
    for (const box of [
      { west: 170, south: -25, east: -170, north: -10 },
      { west: 170, south: -25, east: 190, north: -10 },
      { west: -190, south: -25, east: -170, north: -10 },
    ]) {
      expect((await viewSlugs(box)).sort(), JSON.stringify(box)).toEqual([west, east].sort());
    }
  });
});

describe('coordinates are JSON numbers (M11 review, code-5)', () => {
  it('refuses null, empty or boolean coordinates with 400 instead of reading them as 0 or 1', async () => {
    for (const center of [{ lat: null, lng: null }, { lat: '', lng: '' }, { lat: true, lng: false }, { lat: '42.1', lng: '24.7' }]) {
      await expect(schoolsSearch(null, { center } as never), JSON.stringify(center)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { center: expect.any(String) } });
    }
    await expect(schoolsSearch(null, { radiusKm: true } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(schoolsInViewport(null, { west: null, south: '', east: true, north: 1 } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const sifu = await sifuWithPlan('m11-coerce', false);
    const sofia = await cityOf('Sofia', 'BG');
    await expect(
      createSchool(sifu.principal, { name: 'Demo Coerce Hall', placeId: sofia.id, locationPrivacy: 'exact', point: { lat: true, lng: true }, idempotencyKey: key() } as never, meta),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { point: expect.any(String) } });
    expect((await mySchools(sifu.principal)).schools).toEqual([]);
  });
});

describe('the listing review cannot be bypassed (M11 review, code-4)', () => {
  const exactFields = async (name: string) => {
    const sofia = await cityOf('Sofia', 'BG');
    return { name, placeId: sofia.id, locationPrivacy: 'exact' as const, point: { lat: sofia.lat + 0.01, lng: sofia.lng + 0.01 } };
  };

  it('a decision on a listing changed after the reviewer opened it is refused; an approval needs the version it was made from', async () => {
    const sifu = await sifuWithPlan('m11-version');
    const fields = await exactFields('Demo Version Hall');
    const created = await createSchool(sifu.principal, { ...fields, idempotencyKey: key() }, meta);
    const { caseId } = await submitSchool(sifu.principal, { id: created.id }, meta);
    const moderator = await staff('m11-version-mod', 'moderator');
    await assignReviewCase(moderator.principal, { caseId, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    const seen = (await getReviewCase(moderator.principal, { id: caseId })).school!;
    expect(seen).toMatchObject({ name: 'Demo Version Hall', version: expect.stringMatching(/^\d+$/) });

    // The Sifu changes the listing while the reviewer reads it: a new version.
    await updateSchool(sifu.principal, { ...fields, id: created.id, name: 'Demo Version Hall Changed', websiteUrl: 'https://example.test/changed' }, meta);
    for (const decision of ['verify', 'reject', 'needs_info'] as const) {
      await expect(
        decideReviewCase(moderator.principal, { caseId, decision, reason: decision === 'verify' ? null : 'Demo reason (fictional).', idempotencyKey: key(), schoolVersion: seen.version }, meta),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('changed this listing after you opened it') });
    }
    await expect(decideReviewCase(moderator.principal, { caseId, decision: 'verify', reason: null, idempotencyKey: key() }, meta)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await getDb().select({ status: school.status }).from(school).where(eq(school.id, created.id)))[0]!.status).toBe('pending_review');
    await expect(schoolGet(null, { slug: created.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Opened again: the card shows the new details and their version, which the approval carries.
    const fresh = (await getReviewCase(moderator.principal, { id: caseId })).school!;
    expect(fresh).toMatchObject({ name: 'Demo Version Hall Changed', websiteUrl: 'https://example.test/changed' });
    expect(fresh.version).not.toBe(seen.version);
    await decideReviewCase(moderator.principal, { caseId, decision: 'verify', reason: null, idempotencyKey: key(), schoolVersion: fresh.version }, meta);
    expect(await schoolGet(null, { slug: created.slug })).toMatchObject({ name: 'Demo Version Hall Changed' });
  });

  it('a listed school edited in what it is, where, its website or instructors stays listed and opens a review; returning it to draft takes it off the map', async () => {
    const sifu = await sifuWithPlan('m11-edit');
    const fields = await exactFields('Demo Edited Hall');
    const listed = await listedSchool(sifu, fields, 'm11-edit');
    const openCases = async () =>
      getDb()
        .select({ id: reviewCase.id, status: reviewCase.status })
        .from(reviewCase)
        .where(and(eq(reviewCase.schoolId, listed.id), eq(reviewCase.kind, 'school_listing'), inArray(reviewCase.status, ['open', 'in_review', 'needs_info'])));

    // Contacts, the description and the forms: the school stays listed with them, no review.
    await updateSchool(sifu.principal, { ...fields, id: listed.id, contactEmail: 'edited@example.test', description: 'A fictional description.', formsTaught: ['chum_kiu'] }, meta);
    expect(await openCases()).toEqual([]);
    expect(await schoolGet(null, { slug: listed.slug })).toMatchObject({ contactEmail: 'edited@example.test' });

    // A new name, city, pin and website: public at once, and one review case for the edit.
    const london = await cityOf('London', 'GB');
    const moved = { name: 'Demo Totally Different Hall', placeId: london.id, locationPrivacy: 'exact' as const, point: { lat: london.lat + 0.01, lng: london.lng }, websiteUrl: 'https://example.test/anything' };
    cache.revalidated.length = 0;
    await updateSchool(sifu.principal, { ...moved, id: listed.id, contactEmail: 'edited@example.test', description: 'A fictional description.', formsTaught: ['chum_kiu'] }, meta);
    expect(cache.revalidated).toContain('schools');
    const [edit] = await openCases();
    expect(edit).toMatchObject({ status: 'open' });
    expect(await schoolGet(null, { slug: listed.slug })).toMatchObject({ name: 'Demo Totally Different Hall', city: 'London' });
    const [row] = await getDb().select({ status: school.status }).from(school).where(eq(school.id, listed.id));
    expect(row!.status).toBe('active');
    // A second edit joins the open case.
    await updateSchool(sifu.principal, { ...moved, name: 'Demo Totally Different Hall Two', id: listed.id }, meta);
    expect(await openCases()).toEqual([edit]);
    expect((await mySchools(sifu.principal)).schools[0]).toMatchObject({ status: 'active', pin: 'shown' });

    // The reviewer declines the edit: the listing is a draft, off the public map, with the reason.
    const moderator = await staff('m11-edit-mod2', 'moderator');
    await assignReviewCase(moderator.principal, { caseId: edit!.id, assigneeId: moderator.account.id, idempotencyKey: key() }, meta);
    const card = (await getReviewCase(moderator.principal, { id: edit!.id }));
    expect(card).toMatchObject({ can: { verify: true, reject: true, needsInfo: true }, school: { status: 'active', name: 'Demo Totally Different Hall Two' } });
    cache.revalidated.length = 0;
    await decideReviewCase(moderator.principal, { caseId: edit!.id, decision: 'reject', reason: 'Demo: the new website is not this school (fictional).', idempotencyKey: key(), schoolVersion: card.school!.version }, meta);
    expect(cache.revalidated).toContain('schools');
    expect((await getDb().select({ status: school.status }).from(school).where(eq(school.id, listed.id)))[0]!.status).toBe('draft');
    await expect(schoolGet(null, { slug: listed.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await schoolsSearch(null, {})).schools.map((s) => s.id)).not.toContain(listed.id);
    const view = await schoolEditor(sifu.principal, { id: listed.id });
    expect(view).toMatchObject({ school: { status: 'draft' }, review: { statusLabel: 'Returned to draft', reason: 'Demo: the new website is not this school (fictional).' } });
  });

  it('approving the edit of a listed school keeps it listed with the edit', async () => {
    const sifu = await sifuWithPlan('m11-edit-ok');
    const fields = await exactFields('Demo Approved Edit Hall');
    const listed = await listedSchool(sifu, fields, 'm11-edit-ok');
    await updateSchool(sifu.principal, { ...fields, id: listed.id, name: 'Demo Approved Edit Hall Renamed' }, meta);
    const [edit] = await getDb()
      .select({ id: reviewCase.id })
      .from(reviewCase)
      .where(and(eq(reviewCase.schoolId, listed.id), eq(reviewCase.status, 'open')));
    expect(edit).toBeDefined();
    await approveAsModerator(edit!.id, 'm11-edit-ok-mod2');
    const [c] = await getDb().select({ status: reviewCase.status, resolution: reviewCase.resolution }).from(reviewCase).where(eq(reviewCase.id, edit!.id));
    expect(c).toEqual({ status: 'resolved', resolution: 'approved' });
    expect((await getDb().select({ status: school.status }).from(school).where(eq(school.id, listed.id)))[0]!.status).toBe('active');
    expect(await schoolGet(null, { slug: listed.slug })).toMatchObject({ name: 'Demo Approved Edit Hall Renamed' });
  });
});
