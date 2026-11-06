// The event calendar (milestone M17, In scope 2, 3, 4, 7 and 9; docs/adr/0020-events.md) against
// PostGIS, on the seeded demo data: the Professional Sifu allowance of 3 a month counted in the
// event's own zone (DEFAULT M17, question 1) under the quota lock, so two publications at once never
// pass it together; a move to another month counts again; an organization publishes only with
// Federation, then without a limit (DEFAULT D25); Free Sifu and Student accounts are refused with a
// machine-readable answer; an instructor or organizer the public cannot see is in no public answer;
// the notices go only to Premium Students of the teachers, once (DEFAULT M17, question 3); staff
// remove an event with a reason (audited) and it is 404 everywhere, its poster too. Fictional data
// only (D20).

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { wallTimeToInstant } from '../../lib/event-time';
import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, entitlementGrant, event, notification, organizationAdmin, person, teachingRelationship } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { sendEventNotices } from '../jobs/event-notify';
import { handlePhotoRequest } from '../photo-http';
import { plainImage } from '../storage/test-images';
import {
  cancelEvent,
  createEvent,
  eventEditor,
  eventGet,
  eventsList,
  myEvents,
  removeEvent,
  updateEvent,
  uploadEventPoster,
} from './events';
import { grantOrganizationPlan } from './organization-grants';
import { carryOutDeletionFromCommandLine, requestAccountDeletion } from './privacy';
import { createUser, member, meta, newLineage, principalOf, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
const photoRoot = mkdtempSync(path.join(tmpdir(), 'wcr-events-int-'));
const saved = { media: process.env.MEDIA_STORAGE, mediaDir: process.env.MEDIA_STORAGE_DIR };

beforeAll(async () => {
  process.env.MEDIA_STORAGE = 'filesystem';
  process.env.MEDIA_STORAGE_DIR = photoRoot;
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  rmSync(photoRoot, { recursive: true, force: true });
  if (saved.media === undefined) delete process.env.MEDIA_STORAGE;
  else process.env.MEDIA_STORAGE = saved.media;
  if (saved.mediaDir === undefined) delete process.env.MEDIA_STORAGE_DIR;
  else process.env.MEDIA_STORAGE_DIR = saved.mediaDir;
});

/** Two years ahead, so the dates stay in the future whenever the test runs. */
const YEAR = new Date().getUTCFullYear() + 2;
const at = (monthDay: string, time = '10:00') => `${YEAR}-${monthDay}T${time}`;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

async function refusal(promise: Promise<unknown>): Promise<{ code: string; message: string; details: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code: string; message: string; details?: Record<string, unknown> };
    return { code: e.code, message: e.message, details: e.details ?? {} };
  }
  throw new Error('expected a refusal');
}

let sofia: string;
let admin: Awaited<ReturnType<typeof staff>>;
beforeAll(async () => {
  const found = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM place WHERE name = 'Sofia' AND country_code = 'BG' ORDER BY population DESC NULLS LAST LIMIT 1`);
  sofia = found.rows[0]!.id;
  admin = await staff('events-admin', 'admin');
});

async function grant(userId: string, planCode: 'pro_sifu' | 'premium_student') {
  await getDb().insert(entitlementGrant).values({ subjectUserId: userId, planCode, source: 'test_grant', startsAt: new Date(Date.now() - 60_000), reason: 'Demo: M17 test plan' });
}

async function proSifu(label: string) {
  const m = await member(label, { sifu: true });
  await grant(m.account.id, 'pro_sifu');
  return m;
}

const seminar = (startsAt: string, endsAt: string, extra: Record<string, unknown> = {}) => ({
  title: 'Demo test seminar',
  kind: 'seminar' as const,
  startsAt,
  endsAt,
  placeId: sofia,
  ...extra,
});

async function relate(teacherPersonId: string, studentPersonId: string, status: 'verified' | 'in_arbitration' | 'pending_teacher' = 'verified') {
  const lineageId = await newLineage('m17');
  await getDb().insert(teachingRelationship).values({ teacherPersonId, studentPersonId, lineageId, status, visibility: status === 'pending_teacher' ? 'involved_only' : 'public' });
}

describe('the Professional Sifu allowance (DEFAULT M17, question 1)', () => {
  it('three a month; the fourth is refused with ENTITLEMENT_REQUIRED and no upgrade above Professional Sifu', async () => {
    const sifu = await proSifu('events-pro');
    expect(await codeOf(createEvent(sifu.principal, seminar(at('03-06'), at('03-06', '17:00')), meta))).toBe('ok');
    expect(await codeOf(createEvent(sifu.principal, { ...seminar(at('03-13'), at('03-13', '17:00')), title: 'Demo second seminar' }, meta))).toBe('ok');
    expect(await codeOf(createEvent(sifu.principal, { ...seminar(at('03-20'), at('03-20', '17:00')), title: 'Demo third seminar' }, meta))).toBe('ok');
    const fourth = await refusal(createEvent(sifu.principal, { ...seminar(at('03-27'), at('03-27', '17:00')), title: 'Demo fourth seminar' }, meta));
    expect(fourth.code).toBe('ENTITLEMENT_REQUIRED');
    expect(fourth.details.entitlement).toMatchObject({ ok: false, code: 'quota', key: 'events', month: `${YEAR}-03`, limit: 3, current: 3 });
    // Another month still has room.
    expect(await codeOf(createEvent(sifu.principal, { ...seminar(at('04-10'), at('04-10', '17:00')), title: 'Demo April seminar' }, meta))).toBe('ok');
    const mine = await myEvents(sifu.principal);
    expect(mine.allowance?.limit).toBe(3);
    expect(mine.upgrade).toBeNull();
    expect(mine.events).toHaveLength(4);
  });

  it('M18: a refusal at the limit leaves one dashboard notice a month; a plan without events leaves none', async () => {
    const sifu = await proSifu('events-limit-notice');
    let refused = 0;
    for (let day = 1; day <= 12 && refused < 2; day++) {
      const d = String(day).padStart(2, '0');
      const result = await codeOf(createEvent(sifu.principal, { ...seminar(at(`05-${d}`), at(`05-${d}`, '17:00')), title: `Demo May seminar ${d}` }, meta));
      if (result === 'ENTITLEMENT_REQUIRED') refused++;
      else expect(result).toBe('ok');
    }
    expect(refused).toBe(2);
    const notices = await getDb().select().from(notification).where(and(eq(notification.userId, sifu.account.id), eq(notification.template, 'limit.reached')));
    expect(notices).toHaveLength(1);
    expect(notices[0]!.payload).toMatchObject({ feature: 'events', planCode: 'pro_sifu', upgradeTo: null });
    expect(notices[0]!.dedupeKey).toMatch(/^limit\.reached:events:\d{4}-\d{2}$/);

    const free = await member('events-free-no-notice', { sifu: true });
    expect(await codeOf(createEvent(free.principal, seminar(at('05-10'), at('05-10', '12:00')), meta))).toBe('ENTITLEMENT_REQUIRED');
    expect(await getDb().select().from(notification).where(eq(notification.userId, free.account.id))).toHaveLength(0);
  });

  it('a cancelled event does not count', async () => {
    const sifu = await proSifu('events-cancel-count');
    const one = await createEvent(sifu.principal, seminar(at('05-01'), at('05-01', '12:00')), meta);
    await createEvent(sifu.principal, { ...seminar(at('05-02'), at('05-02', '12:00')), title: 'Demo second' }, meta);
    await createEvent(sifu.principal, { ...seminar(at('05-03'), at('05-03', '12:00')), title: 'Demo third' }, meta);
    await cancelEvent(sifu.principal, { id: one.id, note: 'Moved to a later date.' }, meta);
    expect(await codeOf(createEvent(sifu.principal, { ...seminar(at('05-04'), at('05-04', '12:00')), title: 'Demo fourth' }, meta))).toBe('ok');
    // The month is full again: the next one is refused.
    expect(await codeOf(createEvent(sifu.principal, { ...seminar(at('05-05'), at('05-05', '12:00')), title: 'Demo fifth' }, meta))).toBe('ENTITLEMENT_REQUIRED');
  });

  it('publications at once never pass the limit together (the quota lock): 3 pass, the 4th is refused', async () => {
    const sifu = await proSifu('events-race');
    const results = await Promise.all(
      ['Demo race one', 'Demo race two', 'Demo race three', 'Demo race four'].map((title, i) => codeOf(createEvent(sifu.principal, { ...seminar(at(`06-1${i}`), at(`06-1${i}`, '12:00')), title }, meta))),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r === 'ENTITLEMENT_REQUIRED')).toHaveLength(1);
    const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(event).where(eq(event.organizerUserId, sifu.account.id));
    expect(row!.n).toBe(3);
  });

  it('counts the month in the event’s own zone, not in UTC', async () => {
    const sifu = await proSifu('events-zone');
    await createEvent(sifu.principal, seminar(at('03-03'), at('03-03', '12:00')), meta);
    await createEvent(sifu.principal, { ...seminar(at('03-04'), at('03-04', '12:00')), title: 'Demo second' }, meta);
    await createEvent(sifu.principal, { ...seminar(at('03-05'), at('03-05', '12:00')), title: 'Demo third' }, meta);
    // March is full. 1 April 01:30 in Sofia is still 31 March in UTC: it counts in April.
    const april = await createEvent(sifu.principal, { ...seminar(at('04-01', '01:30'), at('04-01', '03:00')), title: 'Demo night class' }, meta);
    const [row] = await getDb().select({ startsAt: event.startsAt }).from(event).where(eq(event.id, april.id));
    expect(row!.startsAt.toISOString().slice(0, 10)).toBe(`${YEAR}-03-31`);
  });

  it('a move to a full month is refused; a change inside the month is not', async () => {
    const sifu = await proSifu('events-move');
    await createEvent(sifu.principal, seminar(at('07-01'), at('07-01', '12:00')), meta);
    await createEvent(sifu.principal, { ...seminar(at('07-02'), at('07-02', '12:00')), title: 'Demo second' }, meta);
    await createEvent(sifu.principal, { ...seminar(at('07-03'), at('07-03', '12:00')), title: 'Demo third' }, meta);
    const august = await createEvent(sifu.principal, { ...seminar(at('08-01'), at('08-01', '12:00')), title: 'Demo August' }, meta);
    expect(await codeOf(updateEvent(sifu.principal, { id: august.id, ...seminar(at('08-15'), at('08-15', '12:00')), title: 'Demo August, later' }, meta))).toBe('ok');
    const moved = await refusal(updateEvent(sifu.principal, { id: august.id, ...seminar(at('07-20'), at('07-20', '12:00')), title: 'Demo August' }, meta));
    expect(moved.code).toBe('ENTITLEMENT_REQUIRED');
    expect(moved.details.entitlement).toMatchObject({ key: 'events', month: `${YEAR}-07` });
    const [row] = await getDb().select({ title: event.title, revision: event.revision }).from(event).where(eq(event.id, august.id));
    expect(row).toEqual({ title: 'Demo August, later', revision: 1 });
  });

  it('a change read before another moved the event is refused, never writing the old month back', async () => {
    const sifu = await proSifu('events-stale');
    const moving = await createEvent(sifu.principal, seminar(at('09-03'), at('09-03', '12:00')), meta);
    let pending: Promise<string> | undefined;
    await getDb().transaction(async (t) => {
      // Another request holds the row and moves the event to October while this change waits on it.
      await t.execute(sql`SELECT id FROM event WHERE id = ${moving.id}::uuid FOR UPDATE`);
      pending = codeOf(updateEvent(sifu.principal, { id: moving.id, ...seminar(at('09-03'), at('09-03', '12:00')), title: 'Demo stale title' }, meta));
      await new Promise((resolve) => setTimeout(resolve, 500));
      await t.update(event).set({ startsAt: new Date(`${YEAR}-10-05T08:00:00Z`), endsAt: new Date(`${YEAR}-10-05T10:00:00Z`) }).where(eq(event.id, moving.id));
    });
    expect(await pending).toBe('CONFLICT');
    const [row] = await getDb().select({ startsAt: event.startsAt, title: event.title }).from(event).where(eq(event.id, moving.id));
    expect(row).toEqual({ startsAt: new Date(`${YEAR}-10-05T08:00:00Z`), title: 'Demo test seminar' });
  });

  it('a form sent twice at the last place of the month publishes once and answers with the event', async () => {
    const sifu = await proSifu('events-twice');
    await createEvent(sifu.principal, seminar(at('11-03'), at('11-03', '12:00')), meta);
    await createEvent(sifu.principal, { ...seminar(at('11-04'), at('11-04', '12:00')), title: 'Demo second' }, meta);
    const form = { ...seminar(at('11-20'), at('11-20', '12:00')), title: 'Demo sent twice' };
    const first = await createEvent(sifu.principal, form, meta);
    const again = await createEvent(sifu.principal, form, meta);
    expect(again.id).toBe(first.id);
    const [n] = await getDb().select({ n: sql<number>`count(*)::int` }).from(event).where(eq(event.organizerUserId, sifu.account.id));
    expect(n!.n).toBe(3);
  });

  it('only the organizer changes or cancels an event (404 for anyone else)', async () => {
    const sifu = await proSifu('events-owner');
    const other = await proSifu('events-other');
    const created = await createEvent(sifu.principal, seminar(at('09-01'), at('09-01', '12:00')), meta);
    expect(await codeOf(updateEvent(other.principal, { id: created.id, ...seminar(at('09-01'), at('09-01', '13:00')) }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(cancelEvent(other.principal, { id: created.id }, meta))).toBe('NOT_FOUND');
    expect(await codeOf(eventEditor(other.principal, { id: created.id }))).toBe('NOT_FOUND');
    expect(await codeOf(cancelEvent(sifu.principal, { id: created.id }, meta))).toBe('ok');
    // Cancelled: shown with its status, never changed again.
    expect((await eventGet(null, { slug: created.slug })).status).toBe('cancelled');
    expect(await codeOf(updateEvent(sifu.principal, { id: created.id, ...seminar(at('09-01'), at('09-01', '13:00')) }, meta))).toBe('CONFLICT');
  });

  it('refuses the hour the clocks skip and an end before the start', async () => {
    const sifu = await proSifu('events-times');
    const skipped = wallTimeToInstant(`${YEAR}-03-${lastSunday(YEAR, 3)}T03:30`, 'Europe/Sofia');
    expect(skipped).toEqual({ ok: false, reason: 'skipped' });
    const r = await refusal(createEvent(sifu.principal, seminar(`${YEAR}-03-${lastSunday(YEAR, 3)}T03:30`, `${YEAR}-03-${lastSunday(YEAR, 3)}T06:00`), meta));
    expect(r.code).toBe('BAD_REQUEST');
    const backwards = await refusal(createEvent(sifu.principal, seminar(at('10-01', '12:00'), at('10-01', '10:00')), meta));
    expect(backwards.code).toBe('BAD_REQUEST');
  });
});

/** The day of the last Sunday of a month (the European change of summer time), two digits. */
function lastSunday(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  return String(last.getUTCDate() - last.getUTCDay()).padStart(2, '0');
}

describe('who may publish', () => {
  it('Free Sifu and a Student account are refused with ENTITLEMENT_REQUIRED', async () => {
    const free = await member('events-free', { sifu: true });
    const r = await refusal(createEvent(free.principal, seminar(at('03-10'), at('03-10', '12:00')), meta));
    expect(r.code).toBe('ENTITLEMENT_REQUIRED');
    expect(r.details.entitlement).toMatchObject({ ok: false, key: 'events', grantedBy: 'pro_sifu' });
    const mine = await myEvents(free.principal);
    expect(mine.upgrade?.to.code).toBe('pro_sifu');
    expect(mine.upgrade?.benefits.map((b) => b.feature)[0]).toBe('events');

    const student = await member('events-student');
    expect((await refusal(createEvent(student.principal, seminar(at('03-10'), at('03-10', '12:00')), meta))).code).toBe('ENTITLEMENT_REQUIRED');
    expect(await codeOf(createEvent(null, seminar(at('03-10'), at('03-10', '12:00')), meta))).toBe('UNAUTHORIZED');
  });

  it('an organization publishes only with Federation, then without a limit (DEFAULT D25)', async () => {
    const owner = await createUser('events-org-admin');
    const [org] = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM organization WHERE slug = 'demo-association-south'`).then((r) => r.rows);
    await getDb().insert(organizationAdmin).values({ organizationId: org!.id, userId: owner.id, role: 'owner' });
    const principal = principalOf(owner);
    const asOrg = (day: string, title: string) => createEvent(principal, { ...seminar(at(day), at(day, '12:00')), title, organizationId: org!.id }, meta);
    const refused = await refusal(asOrg('11-01', 'Demo association seminar'));
    expect(refused.code).toBe('ENTITLEMENT_REQUIRED');
    expect(refused.details.entitlement).toMatchObject({ grantedBy: 'federation' });
    await grantOrganizationPlan(admin.principal, { organizationId: org!.id, reason: 'M17 test plan (fictional)' }, meta);
    // More than Professional Sifu's 3 a month.
    for (const day of ['11-02', '11-03', '11-04', '11-05']) expect(await codeOf(asOrg(day, `Demo association day ${day}`))).toBe('ok');
    // Not an admin of it: a field error, nothing published.
    const stranger = await createUser('events-org-stranger');
    expect(await codeOf(createEvent(principalOf(stranger), { ...seminar(at('11-05'), at('11-05', '12:00')), organizationId: org!.id }, meta))).toBe('BAD_REQUEST');
    const list = await eventsList(null, { when: 'upcoming', country: 'BG', limit: 50 });
    expect(list.items.filter((i) => i.organizer?.kind === 'organization' && i.organizer.slug === 'demo-association-south')).toHaveLength(4);
  });
});

describe('privacy of the public answers', () => {
  it('an instructor or organizer the public cannot see is not shown; no account, reason or storage key', async () => {
    const sifu = await proSifu('events-privacy');
    const visible = await member('events-visible');
    const hidden = await member('events-hidden');
    const created = await createEvent(sifu.principal, { ...seminar(at('12-01'), at('12-01', '12:00')), instructorIds: [visible.personId, hidden.personId] }, meta);
    expect((await eventGet(null, { slug: created.slug })).instructors.map((i) => i.slug).sort()).toEqual([hidden.slug, visible.slug].sort());
    await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, hidden.personId));
    const page = await eventGet(null, { slug: created.slug });
    expect(page.instructors.map((i) => i.slug)).toEqual([visible.slug]);
    const text = JSON.stringify(page);
    for (const secret of [hidden.slug, sifu.account.id, sifu.account.email, 'photos/']) expect(text).not.toContain(secret);
    // A hidden person cannot be named as an instructor.
    expect(await codeOf(createEvent(sifu.principal, { ...seminar(at('12-02'), at('12-02', '12:00')), title: 'Demo other', instructorIds: [hidden.personId] }, meta))).toBe('BAD_REQUEST');
    // The organizer hidden: the event stays, without an organizer.
    await getDb().update(person).set({ visibility: 'involved_only' }).where(eq(person.id, sifu.personId));
    expect((await eventGet(null, { slug: created.slug })).organizer).toBeNull();
  });
});

describe('notices (DEFAULT M17, question 3)', () => {
  it('only Premium Students of the organizer or an instructor, once per person and change', async () => {
    const sifu = await proSifu('events-notify');
    const teacher = await member('events-notify-teacher');
    const premium = await member('events-premium');
    const free = await member('events-free-student');
    const pending = await member('events-pending-student');
    const arbitration = await member('events-arbitration-student');
    await grant(premium.account.id, 'premium_student');
    await grant(pending.account.id, 'premium_student');
    await grant(arbitration.account.id, 'premium_student');
    await relate(sifu.personId, premium.personId);
    await relate(sifu.personId, free.personId);
    await relate(sifu.personId, pending.personId, 'pending_teacher');
    await relate(teacher.personId, arbitration.personId, 'in_arbitration');
    const created = await createEvent(sifu.principal, { ...seminar(at('03-12'), at('03-12', '12:00')), instructorIds: [teacher.personId] }, meta);
    // The job was queued with the change, ids only.
    const jobs = await getDb().execute<{ data: unknown }>(sql`SELECT data FROM pgboss.job WHERE name = 'events.notify' AND data->>'eventId' = ${created.id}`);
    expect(jobs.rows.map((j) => j.data)).toEqual([{ eventId: created.id, change: 'published' }]);

    const first = await sendEventNotices(getDb(), { eventId: created.id, change: 'published' });
    expect(first).toMatchObject({ written: 2, recipients: 2, skipped: false });
    expect((await sendEventNotices(getDb(), { eventId: created.id, change: 'published' })).written).toBe(0);
    const rows = await getDb()
      .select({ userId: notification.userId, template: notification.template, payload: notification.payload })
      .from(notification)
      .where(sql`${notification.payload}->>'eventId' = ${created.id}`);
    expect(rows.map((r) => r.userId).sort()).toEqual([premium.account.id, arbitration.account.id].sort());
    expect(rows[0]!.payload).toMatchObject({ eventId: created.id, slug: created.slug, startDay: `${YEAR}-03-12` });

    await cancelEvent(sifu.principal, { id: created.id }, meta);
    // A publication's job that runs after the cancellation sends nothing more.
    expect((await sendEventNotices(getDb(), { eventId: created.id, change: 'published' })).skipped).toBe(true);
    expect((await sendEventNotices(getDb(), { eventId: created.id, change: 'cancelled' })).written).toBe(2);
    const cancelled = await getDb().select({ id: notification.id }).from(notification).where(and(eq(notification.template, 'event.cancelled'), sql`${notification.payload}->>'eventId' = ${created.id}`));
    expect(cancelled).toHaveLength(2);
  });
});

describe('cancellation notices', () => {
  it('go only to the students told of the publication, and never for an event that is over', async () => {
    const sifu = await proSifu('events-cancel-notice');
    const premium = await member('events-cancel-premium');
    await grant(premium.account.id, 'premium_student');
    await relate(sifu.personId, premium.personId);
    // Cancelled before the publication's notices went out: nothing at all.
    const quick = await createEvent(sifu.principal, seminar(at('04-12'), at('04-12', '12:00')), meta);
    await cancelEvent(sifu.principal, { id: quick.id }, meta);
    expect((await sendEventNotices(getDb(), { eventId: quick.id, change: 'published' })).skipped).toBe(true);
    expect((await sendEventNotices(getDb(), { eventId: quick.id, change: 'cancelled' })).written).toBe(0);
    // Told, then cancelled after it ended: no cancellation notice either.
    const told = await createEvent(sifu.principal, { ...seminar(at('04-19'), at('04-19', '12:00')), title: 'Demo told' }, meta);
    expect((await sendEventNotices(getDb(), { eventId: told.id, change: 'published' })).written).toBe(1);
    await cancelEvent(sifu.principal, { id: told.id }, meta);
    const after = new Date(`${YEAR}-04-20T00:00:00Z`);
    expect((await sendEventNotices(getDb(), { eventId: told.id, change: 'cancelled' }, after)).skipped).toBe(true);
    expect((await sendEventNotices(getDb(), { eventId: told.id, change: 'cancelled' })).written).toBe(1);
  });
});

describe('removal by staff', () => {
  it('needs a verified second factor and a reason; audited; 404 everywhere, the poster too', async () => {
    const sifu = await proSifu('events-remove');
    const created = await createEvent(sifu.principal, seminar(at('02-10'), at('02-10', '12:00')), meta);
    const file = new File([new Uint8Array(await plainImage('png', 300, 200))], 'demo-poster.png', { type: 'image/png' });
    const { poster } = await uploadEventPoster(sifu.principal, { id: created.id, file }, meta);
    const [, , , id, hash, name] = poster.full.split('/');
    const address = { id: id!, hash: hash!, file: name! };
    expect((await handlePhotoRequest(new Request('http://localhost/'), address, { kind: 'event' })).status).toBe(200);

    expect(await codeOf(removeEvent(sifu.principal, { id: created.id, reason: 'Demo reason' }, meta))).toBe('FORBIDDEN');
    const unverified = await staff('events-unverified', 'moderator', { unverified: true });
    expect(await codeOf(removeEvent(unverified.principal, { id: created.id, reason: 'Demo reason' }, meta))).toBe('SECOND_FACTOR_REQUIRED');
    const moderator = await staff('events-moderator', 'moderator');
    expect(await codeOf(removeEvent(moderator.principal, { id: created.id, reason: '  ' }, meta))).toBe('BAD_REQUEST');
    expect(await removeEvent(moderator.principal, { id: created.id, reason: 'Demo: not a Wing Chun event.' }, meta)).toEqual({ id: created.id, removed: true });

    expect(await codeOf(eventGet(null, { slug: created.slug }))).toBe('NOT_FOUND');
    expect(await codeOf(cancelEvent(sifu.principal, { id: created.id }, meta))).toBe('NOT_FOUND');
    expect((await handlePhotoRequest(new Request('http://localhost/'), address, { kind: 'event' })).status).toBe(404);
    const files = readdirSync(photoRoot, { recursive: true }).map(String).filter((f) => f.endsWith('.webp'));
    expect(files.some((f) => f.includes(created.id))).toBe(false);
    const [audit] = await getDb()
      .select({ actor: auditLog.actorUserId, reason: auditLog.reason })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'event.remove'), eq(auditLog.subjectId, created.id)));
    expect(audit).toEqual({ actor: moderator.account.id, reason: 'Demo: not a Wing Chun event.' });
  });
});

describe('account deletion', () => {
  it("removes the Sifu's own events and their posters (404), and nothing of the Sifu stays on them", async () => {
    const sifu = await proSifu('events-delete');
    const created = await createEvent(sifu.principal, { ...seminar(at('01-20'), at('01-20', '12:00')), description: 'Demo text', venue: 'Demo hall' }, meta);
    const file = new File([new Uint8Array(await plainImage('png', 200, 200))], 'demo-poster.png', { type: 'image/png' });
    await uploadEventPoster(sifu.principal, { id: created.id, file }, meta);
    const [before] = await getDb().select({ key: event.posterStorageKey }).from(event).where(eq(event.id, created.id));
    const { request } = await requestAccountDeletion(sifu.principal, { confirm: true }, meta);
    await carryOutDeletionFromCommandLine(request.id);
    expect(await codeOf(eventGet(null, { slug: created.slug }))).toBe('NOT_FOUND');
    const [row] = await getDb().select().from(event).where(eq(event.id, created.id));
    expect(row).toMatchObject({ status: 'removed', organizerUserId: null, description: null, venue: null, posterStorageKey: null });
    const files = readdirSync(photoRoot, { recursive: true }).map((f) => String(f).split(path.sep).join('/'));
    expect(files.some((f) => f.startsWith(`${before!.key}/`))).toBe(false);
  });
});

describe('the demo events (D20)', () => {
  it('three of demo-pro-sifu-8 in March 2027, one online, one cancelled, one past, one of an organization', async () => {
    const upcoming = await eventsList(null, { when: 'upcoming', limit: 50 });
    const past = await eventsList(null, { when: 'past', limit: 50 });
    const slugs = [...upcoming.items, ...past.items].map((e) => e.slug);
    for (const slug of ['demo-seminar-chum-kiu-sofia', 'demo-spring-camp-london', 'demo-grading-day-sofia', 'demo-online-theory-evening', 'demo-cancelled-exam-session', 'demo-past-seminar-athens', 'demo-federation-summer-camp']) {
      expect(slugs).toContain(slug);
    }
    // The month's allowance of demo-pro-sifu-8 is used up: three published events start in March 2027.
    const march = upcoming.items.filter((e) => e.organizer?.slug === 'demo-pro-sifu-8' && e.status === 'published' && e.startsAt.startsWith('2027-03'));
    expect(march.map((e) => e.slug).sort()).toEqual(['demo-grading-day-sofia', 'demo-seminar-chum-kiu-sofia', 'demo-spring-camp-london']);
    expect(past.items.map((e) => e.slug)).toContain('demo-past-seminar-athens');
    const online = upcoming.items.find((e) => e.slug === 'demo-online-theory-evening')!;
    expect(online).toMatchObject({ online: true, city: null, countryCode: null });
    expect((await eventsList(null, { when: 'upcoming', format: 'online' })).items.every((e) => e.online)).toBe(true);
    expect((await eventsList(null, { when: 'upcoming', kind: 'camp' })).items.every((e) => e.kind === 'camp')).toBe(true);
    const [notice] = await getDb().select({ template: notification.template }).from(notification).where(eq(notification.template, 'event.published'));
    expect(notice?.template).toBe('event.published');
  });
});
