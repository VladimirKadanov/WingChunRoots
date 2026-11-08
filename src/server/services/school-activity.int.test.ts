// School activity checks (milestone M20, In scope 1–9; specification §7.3; DEFAULT D17, D18)
// against PostGIS, on the seeded demo data: the boundaries at day 89/90 and 104/105, reruns and two
// runs at once, a missed run, the database's clock, the organization's admins, the restore by a
// confirmation or an edit with and without Professional Sifu, sign-in that never counts, a hidden
// school absent from every public answer, no exact point anywhere, the staff list and the demo
// schools. Fictional data only (D20): demo- slugs and example.test addresses.

import { randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEMO_ACTIVITY_SCHOOLS, generateFixtures } from '../../fixtures/generate';
import { createAccount, setTestAuthEnv, signIn, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { withClient } from '../db/admin';
import { auditLog, authUser, emailDelivery, entitlementGrant, notification, notificationPreference, person, personName, school, schoolInstructor } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { jobTemplateData } from '../jobs/outbox';
import type { EmailSendJob } from '../jobs/queues';
import { schoolActivityHandler } from '../jobs/school-activity';
import { renderNotification } from '../templates/notifications';
import { organizationGet } from './organizations';
import { member, meta, principalOf, staff } from './relationships.test-support';
import { adminSchools, runSchoolActivityCheck, SCHOOL_CONFIRM_GRACE_DAYS } from './school-activity';
import { confirmSchool, mySchools, schoolEditor, schoolGet, schoolSitemap, schoolsInViewport, schoolsSearch, updateSchool } from './schools';
import { searchQuery } from './search';

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

const DAY = 24 * 60 * 60 * 1000;

async function cityOf(name: string, countryCode: string) {
  const result = await getDb().execute<{ id: string; lat: number; lng: number }>(sql`
    SELECT id, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng FROM place WHERE name = ${name} AND country_code = ${countryCode}
     ORDER BY population DESC NULLS LAST LIMIT 1`);
  return result.rows[0]!;
}

async function proGrant(userId: string) {
  await getDb()
    .insert(entitlementGrant)
    .values({ subjectUserId: userId, planCode: 'pro_sifu', source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: M20 test plan' });
}

type Age = string;

/**
 * A listed (active) school of a new Sifu, `age` without activity (an SQL interval, measured from the
 * database's now()). City only by default, so its exact point is private: the tests look for it.
 * The Sifu holds Professional Sifu unless `pro` is false.
 */
async function listedSchool(label: string, age: Age, opts: { pro?: boolean; stage?: 'awaiting_confirmation'; awaitingFor?: Age; exact?: boolean } = {}) {
  const sifu = await member(`m20-${label}`, { sifu: true });
  if (opts.pro !== false) await proGrant(sifu.account.id);
  const city = await cityOf('Varna', 'BG');
  // A made-up private point a few hundred metres from the centre, with digits no centroid has.
  const exact = { lat: Math.round((city.lat + 0.00731) * 1e5) / 1e5, lng: Math.round((city.lng + 0.00617) * 1e5) / 1e5 };
  const slug = `demo-m20-${label}-${randomBytes(3).toString('hex')}`;
  const name = `Demo M20 ${label} Hall`;
  const point = sql`ST_SetSRID(ST_MakePoint(${exact.lng}::float8, ${exact.lat}::float8), 4326)::geography`;
  const inserted = await getDb().execute<{ id: string }>(sql`
    INSERT INTO school (slug, name, place_id, location_privacy, public_point, status, created_by_user_id, last_activity_at,
                        activity_stage, activity_awaiting_since)
    VALUES (${slug}, ${name}, ${city.id}::uuid, ${opts.exact ? 'exact' : 'city_only'}, ${point}, 'active', ${sifu.account.id}::uuid, now() - ${age}::interval,
            ${opts.stage ?? 'current'}, ${opts.stage ? sql`now() - ${opts.awaitingFor ?? '15 days'}::interval` : null})
    RETURNING id`);
  const id = inserted.rows[0]!.id;
  await getDb().execute(sql`INSERT INTO school_private_location (school_id, exact_point) VALUES (${id}::uuid, ${point})`);
  await getDb().insert(schoolInstructor).values({ schoolId: id, personId: sifu.personId, role: 'head_instructor' });
  return { id, slug, name, sifu, exact, placeId: city.id };
}

async function stageOf(id: string) {
  const [row] = await getDb()
    .select({ stage: school.activityStage, awaitingSince: school.activityAwaitingSince, hiddenAt: school.activityHiddenAt, status: school.status, deletedAt: school.deletedAt })
    .from(school)
    .where(eq(school.id, id));
  return row!;
}

const noticesOf = (userId: string) => getDb().select().from(notification).where(eq(notification.userId, userId));
const deliveriesOf = (userId: string) => getDb().select().from(emailDelivery).where(eq(emailDelivery.userId, userId));

async function isPublic(id: string): Promise<boolean> {
  const rows = await getDb().execute(sql`SELECT 1 FROM v_public_school WHERE id = ${id}::uuid`);
  return rows.rows.length === 1;
}

const run = (opts: Parameters<typeof runSchoolActivityCheck>[1] = {}) => runSchoolActivityCheck(getDb(), opts);

// First: a run with a later `now` (the clock test) moves the demo schools on too.
describe('the demo schools (In scope 8; D20)', () => {
  it('demo-school-awaiting-birmingham awaits confirmation and is public; demo-school-hidden-munich is hidden and kept, with their notices', async () => {
    const awaiting = fixtures.schools.find((s) => s.slug === DEMO_ACTIVITY_SCHOOLS.awaiting)!;
    const hidden = fixtures.schools.find((s) => s.slug === DEMO_ACTIVITY_SCHOOLS.hidden)!;
    expect(awaiting).toMatchObject({ activityStage: 'awaiting_confirmation', status: 'active', createdByUserId: fixtures.accounts['demo-pro-sifu-8'] });
    expect(hidden).toMatchObject({ activityStage: 'hidden', status: 'active', deletedAt: null });
    expect(await isPublic(awaiting.id)).toBe(true);
    expect(await isPublic(hidden.id)).toBe(false);
    const templates = fixtures.notifications.filter((n) => n.userId === fixtures.accounts['demo-pro-sifu-8'] && n.template.startsWith('school.activity-')).map((n) => n.template);
    expect(templates.sort()).toEqual(['school.activity-awaiting', 'school.activity-awaiting', 'school.activity-hidden']);
    for (const n of fixtures.notifications.filter((x) => x.template.startsWith('school.activity-'))) expect(() => renderNotification(n.template, n.payload)).not.toThrow();
    // The ids of the schools of M01 did not move.
    expect(fixtures.schools.findIndex((s) => s.slug === DEMO_ACTIVITY_SCHOOLS.awaiting)).toBeGreaterThan(fixtures.schools.findIndex((s) => s.slug === 'demo-school-hamburg-draft'));
  });
});

describe('the day 90 and day 105 boundaries (In scope 2; DEFAULT D17)', () => {
  it('day 89 stays current; day 90 awaits confirmation: the owner is asked by notice and e-mail, the listing stays public', async () => {
    const young = await listedSchool('day89', '89 days 23 hours');
    const due = await listedSchool('day90', '90 days');
    await run();
    expect((await stageOf(young.id)).stage).toBe('current');
    expect(await noticesOf(young.sifu.account.id)).toHaveLength(0);

    const asked = await stageOf(due.id);
    expect(asked.stage).toBe('awaiting_confirmation');
    expect(asked.awaitingSince).toBeInstanceOf(Date);
    expect(asked.hiddenAt).toBeNull();
    expect(await isPublic(due.id)).toBe(true);
    const [notice] = await noticesOf(due.sifu.account.id);
    expect(notice).toMatchObject({ template: 'school.activity-awaiting' });
    expect(notice!.dedupeKey).toMatch(new RegExp(`^school\\.activity-awaiting:${due.id}:\\d+$`));
    const text = renderNotification(notice!.template, notice!.payload);
    expect(text.title).toBe('Is your school listing still current?');
    expect(text.action).toEqual({ label: 'Confirm the listing', href: `/dashboard/schools/${due.id}` });
    // Calm: a date, never a countdown or a warning (CLAUDE.md §11).
    expect(JSON.stringify(text)).not.toMatch(/days? left|hurry|last chance|warning|urgent|!/i);
    // The Schools category is e-mailed by default.
    expect(await deliveriesOf(due.sifu.account.id)).toHaveLength(1);
    // The owner's views say so.
    const mine = (await mySchools(due.sifu.principal)).schools.find((s) => s.id === due.id)!;
    expect(mine).toMatchObject({ pin: 'shown', activity: { stage: 'awaiting_confirmation', label: 'Awaiting confirmation' } });
    expect(Date.parse(mine.activity.hiddenFrom!)).toBeGreaterThan(Date.now() + 13 * DAY);
  });

  it('day 104 stays awaiting; day 105 hides the pin and the listing and keeps the school; the owner is told how to show it again', async () => {
    const early = await listedSchool('day104', '104 days 23 hours', { stage: 'awaiting_confirmation', awaitingFor: '14 days 23 hours' });
    const due = await listedSchool('day105', '105 days', { stage: 'awaiting_confirmation', awaitingFor: '15 days' });
    cache.revalidated = [];
    const revalidated: string[][] = [];
    await run({ revalidate: async (tags) => void revalidated.push(tags) });
    expect((await stageOf(early.id)).stage).toBe('awaiting_confirmation');
    expect(await isPublic(early.id)).toBe(true);

    const hidden = await stageOf(due.id);
    expect(hidden).toMatchObject({ stage: 'hidden', status: 'active', deletedAt: null });
    expect(hidden.hiddenAt).toBeInstanceOf(Date);
    expect(await isPublic(due.id)).toBe(false);
    // The public cache of schools is dropped through the web process.
    expect(revalidated).toEqual([['schools']]);
    const notices = await noticesOf(due.sifu.account.id);
    expect(notices.map((n) => n.template)).toEqual(['school.activity-hidden']);
    const text = renderNotification(notices[0]!.template, notices[0]!.payload);
    expect(text.body.map((b) => ('text' in b ? b.text : '')).join(' ')).toContain('Nothing is deleted. To show it again, press “This listing is current”');
    const mine = (await mySchools(due.sifu.principal)).schools.find((s) => s.id === due.id)!;
    expect(mine).toMatchObject({ status: 'active', pin: 'activity_hidden', activity: { stage: 'hidden', label: 'Hidden from the map' } });
    // The audit log names the stages, by the system.
    const audit = await getDb().select().from(auditLog).where(and(eq(auditLog.subjectId, due.id), eq(auditLog.action, 'school.activity_hidden')));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: null, actorRole: 'system' });
  });

  it('a run that missed days asks first and hides only after the grace period: never without notice', async () => {
    const late = await listedSchool('missed', '120 days');
    await run();
    expect((await stageOf(late.id)).stage).toBe('awaiting_confirmation');
    expect(await isPublic(late.id)).toBe(true);
    // A day before the end of the grace period: still awaiting.
    await getDb().execute(sql`UPDATE school SET activity_awaiting_since = now() - ${`${SCHOOL_CONFIRM_GRACE_DAYS - 1} days`}::interval WHERE id = ${late.id}::uuid`);
    await run();
    expect((await stageOf(late.id)).stage).toBe('awaiting_confirmation');
    await getDb().execute(sql`UPDATE school SET activity_awaiting_since = now() - ${`${SCHOOL_CONFIRM_GRACE_DAYS} days`}::interval WHERE id = ${late.id}::uuid`);
    await run();
    expect((await stageOf(late.id)).stage).toBe('hidden');
    expect((await noticesOf(late.sifu.account.id)).map((n) => n.template).sort()).toEqual(['school.activity-awaiting', 'school.activity-hidden']);
  });
});

describe('idempotent reruns and the clock (In scope 2)', () => {
  it('reruns, a retried job and two runs at once change nothing more: one notice per school and stage', async () => {
    const a = await listedSchool('rerun', '95 days');
    await Promise.all([run(), run()]);
    await run();
    await run();
    expect((await stageOf(a.id)).stage).toBe('awaiting_confirmation');
    expect(await noticesOf(a.sifu.account.id)).toHaveLength(1);
    expect(await deliveriesOf(a.sifu.account.id)).toHaveLength(1);
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.subjectId, a.id), eq(auditLog.action, 'school.activity_awaiting')));
    expect(audits).toHaveLength(1);
  });

  it('a confirmation that commits while the job runs wins: the job writes nothing for that school', async () => {
    const s = await listedSchool('race', '120 days', { stage: 'awaiting_confirmation', awaitingFor: '20 days' });
    let job: Promise<unknown> | undefined;
    // The confirmation holds the row (as schools.confirm does inside its transaction) while the job
    // reaches its UPDATE, which waits for it and then finds its conditions no longer hold.
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE school SET last_activity_at = now(), activity_stage = 'current', activity_awaiting_since = NULL, activity_hidden_at = NULL
         WHERE id = ${s.id}::uuid`);
      job = run();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await job;
    expect(await stageOf(s.id)).toMatchObject({ stage: 'current', awaitingSince: null, hiddenAt: null });
    expect(await isPublic(s.id)).toBe(true);
    expect((await noticesOf(s.sifu.account.id)).filter((n) => n.template === 'school.activity-hidden')).toHaveLength(0);
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.subjectId, s.id), eq(auditLog.action, 'school.activity_hidden')));
    expect(audits).toHaveLength(0);
  });

  it('ages come from the database clock: a worker whose clock runs ahead moves nothing early; a last activity in the future is younger', async () => {
    const young = await listedSchool('clock', '80 days');
    const future = await listedSchool('future', '-2 days');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(Date.now() + 60 * DAY));
      await run();
    } finally {
      vi.useRealTimers();
    }
    expect((await stageOf(young.id)).stage).toBe('current');
    expect((await stageOf(future.id)).stage).toBe('current');
    // A test may give the instant itself (the job never does).
    await run({ now: new Date(Date.now() + 15 * DAY) });
    expect((await stageOf(young.id)).stage).toBe('awaiting_confirmation');
    expect((await stageOf(future.id)).stage).toBe('current');
  });

  it('a school without a listing account (a record of the platform) is never checked, nor is a draft or a deleted one', async () => {
    const platform = fixtures.schools.find((s) => s.slug === 'demo-school-athens')!;
    const draft = await listedSchool('draft', '200 days');
    await getDb().update(school).set({ status: 'draft' }).where(eq(school.id, draft.id));
    const gone = await listedSchool('deleted', '200 days');
    await getDb().update(school).set({ deletedAt: new Date() }).where(eq(school.id, gone.id));
    await run();
    expect((await stageOf(platform.id)).stage).toBe('current');
    expect(await isPublic(platform.id)).toBe(true);
    expect((await stageOf(draft.id)).stage).toBe('current');
    expect((await stageOf(gone.id)).stage).toBe('current');
  });

  it('the job handler logs counts only and passes the e-mails to its own pg-boss', async () => {
    await listedSchool('handler', '100 days');
    const lines: string[] = [];
    await schoolActivityHandler(getDb(), (line) => lines.push(line), undefined, async () => undefined)([{ id: 'job-1', retryCount: 0, retryLimit: 3 } as never]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^schools\.activity: job job-1: \d+ awaiting confirmation, \d+ hidden, \d+ notice\(s\)$/);
  });
});

describe('the organization (In scope 2)', () => {
  it("the admins of an organization the school accepted are told on day 90 (once each), never on day 105; the owner's e-mail can be switched off", async () => {
    const s = await listedSchool('org', '100 days');
    const orgAdmin = await member('m20-org-admin');
    const organizationId = fixtures.organizations.find((o) => o.slug === 'demo-federation-north')!.id;
    await getDb().execute(sql`INSERT INTO organization_admin (organization_id, user_id, role) VALUES (${organizationId}::uuid, ${orgAdmin.account.id}::uuid, 'admin')`);
    await getDb().execute(sql`
      INSERT INTO organization_school (organization_id, school_id, status, answered_at) VALUES (${organizationId}::uuid, ${s.id}::uuid, 'accepted', now())`);
    await getDb().insert(notificationPreference).values({ userId: s.sifu.account.id, category: 'schools', email: false });
    await run();
    await run();
    const told = await noticesOf(orgAdmin.account.id);
    expect(told).toHaveLength(1);
    const text = renderNotification(told[0]!.template, told[0]!.payload);
    expect(text.title).toBe('A school of your organization: listing to confirm');
    expect(text.action?.href).toBe(`/dashboard/organization/${organizationId}`);
    // The owner still has the notice in the dashboard, without the e-mail they switched off.
    expect(await noticesOf(s.sifu.account.id)).toHaveLength(1);
    expect(await deliveriesOf(s.sifu.account.id)).toHaveLength(0);
    await getDb().execute(sql`UPDATE school SET last_activity_at = now() - interval '106 days', activity_awaiting_since = now() - interval '16 days' WHERE id = ${s.id}::uuid`);
    await run();
    expect((await stageOf(s.id)).stage).toBe('hidden');
    expect(await noticesOf(orgAdmin.account.id)).toHaveLength(1);
    // The organization's public page no longer lists it.
    const page = await organizationGet(null, { slug: 'demo-federation-north' });
    expect(JSON.stringify(page)).not.toContain(s.slug);
  });
});

describe('restore (In scope 4; DEFAULT D17, D18)', () => {
  it('"This listing is current" shows a hidden school again with Professional Sifu, and the check starts over', async () => {
    const s = await listedSchool('restore', '120 days', { stage: 'awaiting_confirmation', awaitingFor: '20 days' });
    await run();
    expect(await isPublic(s.id)).toBe(false);
    cache.revalidated = [];
    await confirmSchool(s.sifu.principal, { id: s.id }, meta);
    expect(await stageOf(s.id)).toMatchObject({ stage: 'current', awaitingSince: null, hiddenAt: null });
    expect(await isPublic(s.id)).toBe(true);
    expect(cache.revalidated).toContain('schools');
    expect((await schoolEditor(s.sifu.principal, { id: s.id })).school).toMatchObject({ pin: 'shown', activity: { stage: 'current' } });
    // A new period: the job does not ask again until day 90 of it.
    await run();
    expect((await stageOf(s.id)).stage).toBe('current');
  });

  it('an edit restores too; saving the same details is no edit and restores nothing', async () => {
    const s = await listedSchool('edit', '120 days', { stage: 'awaiting_confirmation', awaitingFor: '20 days', exact: true });
    await run();
    expect((await stageOf(s.id)).stage).toBe('hidden');
    const fields = { id: s.id, name: s.name, placeId: s.placeId, locationPrivacy: 'exact' as const, point: s.exact };
    await updateSchool(s.sifu.principal, fields, meta);
    expect((await stageOf(s.id)).stage).toBe('hidden');
    expect(await isPublic(s.id)).toBe(false);
    await updateSchool(s.sifu.principal, { ...fields, description: 'Demo: still training (fictional).' }, meta);
    expect((await stageOf(s.id)).stage).toBe('current');
    expect(await isPublic(s.id)).toBe(true);
  });

  it("without the entitlement: a Free Sifu's confirmation is recorded and unlocks no pin; a later Professional Sifu plan shows it", async () => {
    const s = await listedSchool('free', '120 days', { pro: false, stage: 'awaiting_confirmation', awaitingFor: '20 days' });
    await run();
    expect((await stageOf(s.id)).stage).toBe('hidden');
    expect((await mySchools(s.sifu.principal)).schools.find((x) => x.id === s.id)!.pin).toBe('activity_hidden');
    await confirmSchool(s.sifu.principal, { id: s.id }, meta);
    expect((await stageOf(s.id)).stage).toBe('current');
    expect(await isPublic(s.id)).toBe(false);
    expect((await mySchools(s.sifu.principal)).schools.find((x) => x.id === s.id)!.pin).toBe('needs_plan');
    await proGrant(s.sifu.account.id);
    expect(await isPublic(s.id)).toBe(true);
  });

  it('a hidden school whose listing is moderated away stays off the map after a confirmation is refused', async () => {
    const s = await listedSchool('moderated', '120 days', { stage: 'awaiting_confirmation', awaitingFor: '20 days' });
    await run();
    await getDb().update(school).set({ status: 'hidden' }).where(eq(school.id, s.id));
    await expect(confirmSchool(s.sifu.principal, { id: s.id }, meta)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await isPublic(s.id)).toBe(false);
  });

  it('signing in never counts as activity (DEFAULT D17)', async () => {
    const account = await createAccount({ label: 'm20-signin' });
    const db = getDb();
    await db.update(authUser).set({ accountType: 'sifu' }).where(eq(authUser.id, account.id));
    const personId = (await db.insert(person).values({ slug: `demo-m20-signin-${randomBytes(3).toString('hex')}`, kind: 'living', stewardship: 'self', claimedByUserId: account.id, visibility: 'public' }).returning({ id: person.id }))[0]!.id;
    await db.insert(personName).values({ personId, value: 'Demo M20 Signin Sifu', script: 'Latn', lang: 'en', isPrimary: true });
    await proGrant(account.id);
    const city = await cityOf('Varna', 'BG');
    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO school (slug, name, place_id, location_privacy, public_point, status, created_by_user_id, last_activity_at, activity_stage, activity_awaiting_since, activity_hidden_at)
      VALUES (${`demo-m20-signin-${randomBytes(3).toString('hex')}`}, 'Demo M20 Signin Hall', ${city.id}::uuid, 'city_only',
              (SELECT centroid FROM place WHERE id = ${city.id}::uuid), 'active', ${account.id}::uuid, now() - interval '120 days', 'hidden', now() - interval '30 days', now() - interval '15 days')
      RETURNING id`);
    const id = inserted.rows[0]!.id;
    const before = await db.select({ at: school.lastActivityAt, stage: school.activityStage }).from(school).where(eq(school.id, id));
    await signIn(account);
    await signIn(account);
    await mySchools(principalOf({ id: account.id, email: account.email }));
    const after = await db.select({ at: school.lastActivityAt, stage: school.activityStage }).from(school).where(eq(school.id, id));
    expect(after).toEqual(before);
    expect(after[0]!.stage).toBe('hidden');
  });
});

describe('a hidden school is off every public answer, with no exact point anywhere (In scope 1; CLAUDE.md §6)', () => {
  it('the finder, the map, the page, search, the sitemap and app_public_ro do not have it; the owner and staff still do', async () => {
    const s = await listedSchool('public', '120 days', { stage: 'awaiting_confirmation', awaitingFor: '20 days' });
    const city = await cityOf('Varna', 'BG');
    // While it awaits confirmation it is public everywhere.
    expect((await schoolsSearch(null, { center: { lat: city.lat, lng: city.lng }, radiusKm: 20 })).schools.map((x) => x.slug)).toContain(s.slug);
    await run();
    expect((await stageOf(s.id)).stage).toBe('hidden');

    expect((await schoolsSearch(null, {})).schools.map((x) => x.slug)).not.toContain(s.slug);
    expect((await schoolsSearch(null, { center: { lat: city.lat, lng: city.lng }, radiusKm: 20 })).schools.map((x) => x.slug)).not.toContain(s.slug);
    expect((await schoolsInViewport(null, { west: -180, south: -85, east: 180, north: 85 })).schools.map((x) => x.slug)).not.toContain(s.slug);
    await expect(schoolGet(null, { slug: s.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await schoolSitemap()).map((x) => x.slug)).not.toContain(s.slug);
    expect((await searchQuery(null, { q: s.name })).schools.map((x) => x.slug)).not.toContain(s.slug);
    await withClient(testDb!.url, async (c) => {
      await c.query('SET ROLE app_public_ro');
      const rows = await c.query('SELECT id FROM v_public_school WHERE id = $1', [s.id]);
      expect(rows.rows).toEqual([]);
    });

    // Still kept and shown to its owner and to staff.
    expect((await mySchools(s.sifu.principal)).schools.map((x) => x.id)).toContain(s.id);
    const moderator = await staff('m20-public-mod', 'moderator');
    expect((await adminSchools(moderator.principal, { stage: 'hidden' })).schools.map((x) => x.id)).toContain(s.id);

    // The private point is in no notice, e-mail, staff answer, owner list or audit row.
    const digits = [s.exact.lat, s.exact.lng].map((n) => n.toFixed(5));
    const notices = await noticesOf(s.sifu.account.id);
    const jobs = await getDb().execute<{ data: EmailSendJob }>(sql`
      SELECT j.data FROM pgboss.job j JOIN email_delivery d ON d.id::text = j.data ->> 'deliveryId' WHERE j.name = 'email.send' AND d.user_id = ${s.sifu.account.id}::uuid`);
    expect(jobs.rows.length).toBeGreaterThan(0);
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.subjectId, s.id));
    const everything = JSON.stringify([
      notices,
      notices.map((n) => renderNotification(n.template, n.payload)),
      jobs.rows.map((j) => jobTemplateData(j.data)),
      await adminSchools(moderator.principal),
      await mySchools(s.sifu.principal),
      audits,
    ]);
    for (const d of digits) expect(everything).not.toContain(d);
  });
});

describe('schools.adminList (In scope 6)', () => {
  it('moderators and administrators with a second factor; the stage filter and the counts; archivists and members refused', async () => {
    const admin = await staff('m20-admin', 'admin');
    const all = await adminSchools(admin.principal);
    expect(all.stage).toBe('all');
    expect(all.counts.awaiting_confirmation).toBeGreaterThanOrEqual(1);
    expect(all.counts.hidden).toBeGreaterThanOrEqual(1);
    const awaiting = await adminSchools(admin.principal, { stage: 'awaiting_confirmation' });
    expect(awaiting.schools.length).toBeGreaterThan(0);
    expect(awaiting.schools.every((x) => x.activity.stage === 'awaiting_confirmation' && x.activity.hiddenFrom !== null)).toBe(true);
    // The longest without activity first.
    const times = all.schools.map((x) => Date.parse(x.activity.lastActivityAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const archivist = await staff('m20-archivist', 'archivist');
    await expect(adminSchools(archivist.principal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const unverified = await staff('m20-admin-no2fa', 'admin', { unverified: true });
    await expect(adminSchools(unverified.principal)).rejects.toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });
    const someone = await member('m20-someone');
    await expect(adminSchools(someone.principal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
