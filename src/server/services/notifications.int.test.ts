// Notices (milestone M18, In scope 2–8): notify() writes the dashboard notice and, when the catalog
// and the account's choice allow it, queues the e-mail with its key, its hourly budget and its
// unsubscribe link; a blocked or deleted account gets nothing; the preferences and the one-press
// unsubscribe; the list by page and category; the plan-end job; the limit notice; the retention.

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { authUser, emailDelivery, entitlementGrant, notification, notificationPreference } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { jobUnsubscribe } from '../jobs/outbox';
import { sendPlanEndNotices } from '../jobs/plan-expiry';
import type { EmailSendJob } from '../jobs/queues';
import { recordingTransport } from '../jobs/test-support';
import { createMailer } from '../mail/mailer';
import { notice } from '../templates/email/notice';
import { ServiceError } from './errors';
import { tellLimitReached } from './limit-notices';
import {
  listNotifications,
  markAllNotificationsRead,
  notificationPreferences,
  setNotificationPreference,
  unsubscribe,
  unsubscribeInfo,
} from './notifications';
import { NOTICE_EMAIL_HOURLY_CAP, notify } from './notify';
import { purgeOldNotifications } from './retention';
import { createUser, principalOf } from './relationships.test-support';
import { signUnsubscribeToken } from './unsubscribe';

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
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

const DAY = 24 * 60 * 60 * 1000;

async function account(label: string) {
  const a = await createUser(`m18-${label}`);
  return { ...a, principal: principalOf(a) };
}

const send = (userId: string, kind: Parameters<typeof notify>[2], payload: Record<string, unknown>, key?: string) =>
  getDb().transaction((tx) => notify(tx, userId, kind, payload, key ? { key } : {}));

async function notices(userId: string) {
  return getDb().select().from(notification).where(eq(notification.userId, userId));
}

async function deliveries(userId: string) {
  return getDb().select().from(emailDelivery).where(eq(emailDelivery.userId, userId));
}

async function jobOf(deliveryId: string): Promise<EmailSendJob> {
  const rows = await getDb().execute<{ data: EmailSendJob }>(sql`SELECT data FROM pgboss.job WHERE name = 'email.send' AND data ->> 'deliveryId' = ${deliveryId}`);
  return rows.rows[0]!.data;
}

const planEnd = { grantId: '0192f0c4-0000-7000-8000-000000000001', planCode: 'premium_student', endsAt: '2026-10-31T00:00:00.000Z', nextPlanCode: 'free_student' };

describe('notify()', () => {
  it('writes the dashboard notice and queues its e-mail once per key', async () => {
    const a = await account('once');
    expect(await send(a.id, 'security.password-changed', {}, 'test:once')).toEqual({ notified: true, emailed: true });
    expect(await send(a.id, 'security.password-changed', {}, 'test:once')).toEqual({ notified: false, emailed: false });
    expect(await notices(a.id)).toHaveLength(1);
    const mail = await deliveries(a.id);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ template: 'notice', toEmail: a.email, idempotencyKey: 'notice:security.password-changed:test:once' });
    // Security e-mail cannot be switched off: no unsubscribe link.
    expect(jobUnsubscribe(await jobOf(mail[0]!.id))).toBeUndefined();
  });

  it('a dashboard-only kind is never e-mailed', async () => {
    const a = await account('dashboard-only');
    expect(await send(a.id, 'limit.reached', { feature: 'photos', planCode: 'free_student', limit: 1, upgradeTo: 'premium_student', month: '2026-10' }, 'test:limit')).toEqual({
      notified: true,
      emailed: false,
    });
    expect(await deliveries(a.id)).toHaveLength(0);
  });

  it('follows the account’s choice per category, and the default without one', async () => {
    const a = await account('choice');
    // Events: off by default.
    expect((await send(a.id, 'event.cancelled', { eventId: planEnd.grantId, slug: 'demo-camp-plovdiv', title: 'Demo seminar', startDay: '2027-03-13' }, 'test:ev1')).emailed).toBe(false);
    await setNotificationPreference(a.principal, { category: 'events', email: true });
    expect((await send(a.id, 'event.cancelled', { eventId: '0192f0c4-0000-7000-8000-000000000002', slug: 'demo-camp-plovdiv', title: 'Demo seminar', startDay: '2027-03-13' }, 'test:ev2')).emailed).toBe(true);
    // Plan: on by default, then off.
    expect((await send(a.id, 'plan.expiring', planEnd, 'test:plan1')).emailed).toBe(true);
    await setNotificationPreference(a.principal, { category: 'plan', email: false });
    const off = await send(a.id, 'plan.expiring', planEnd, 'test:plan2');
    expect(off).toEqual({ notified: true, emailed: false });
    expect(await notices(a.id)).toHaveLength(4);
  });

  it('never lets security or account e-mails be switched off', async () => {
    const a = await account('locked');
    for (const category of ['security', 'account'] as const) {
      await expect(setNotificationPreference(a.principal, { category, email: false })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    await expect(getDb().insert(notificationPreference).values({ userId: a.id, category: 'security', email: false })).rejects.toThrow();
    const { categories } = await notificationPreferences(a.principal);
    expect(categories.filter((c) => c.locked).map((c) => c.category)).toEqual(['security', 'account']);
    expect(categories.find((c) => c.category === 'events')).toMatchObject({ email: false, chosen: false });
  });

  it('a blocked or deleted account gets nothing; an expired block lets it through', async () => {
    const banned = await account('banned');
    await getDb().update(authUser).set({ banned: true }).where(eq(authUser.id, banned.id));
    expect(await send(banned.id, 'security.backup-codes', {})).toEqual({ notified: false, emailed: false });
    expect(await notices(banned.id)).toHaveLength(0);
    expect(await deliveries(banned.id)).toHaveLength(0);

    const expired = await account('ban-expired');
    await getDb().update(authUser).set({ banned: true, banExpires: new Date(Date.now() - DAY) }).where(eq(authUser.id, expired.id));
    expect((await send(expired.id, 'security.backup-codes', {})).notified).toBe(true);

    expect(await send('0192f0c4-0000-7000-8000-00000000dead', 'security.backup-codes', {})).toEqual({ notified: false, emailed: false });
  });

  it(`e-mails at most ${NOTICE_EMAIL_HOURLY_CAP} of one template to one account in an hour; the notices stay`, async () => {
    const a = await account('budget');
    let emailed = 0;
    for (let i = 0; i <= NOTICE_EMAIL_HOURLY_CAP; i++) if ((await send(a.id, 'security.backup-codes', {}, `test:budget:${i}`)).emailed) emailed++;
    expect(emailed).toBe(NOTICE_EMAIL_HOURLY_CAP);
    expect(await notices(a.id)).toHaveLength(NOTICE_EMAIL_HOURLY_CAP + 1);
    expect(await deliveries(a.id)).toHaveLength(NOTICE_EMAIL_HOURLY_CAP);
  });
});

describe('unsubscribing (In scope 4)', () => {
  it('the e-mail’s link switches its category off with one press, once; any earlier link stops working', async () => {
    const a = await account('unsubscribe');
    await send(a.id, 'plan.expired', planEnd, 'test:unsub');
    const [mail] = await deliveries(a.id);
    const link = jobUnsubscribe(await jobOf(mail!.id))!;
    expect(link.category).toBe('Plan');
    const token = new URL(link.url).searchParams.get('token')!;
    expect(new URL(link.oneClickUrl).searchParams.get('token')).toBe(token);
    expect(new URL(link.url).pathname).toBe('/unsubscribe');
    expect(new URL(link.oneClickUrl).pathname).toBe('/unsubscribe/one-click');

    expect(await unsubscribeInfo({ token })).toMatchObject({ category: 'plan', state: 'ready' });
    expect(await unsubscribe({ token })).toMatchObject({ category: 'plan', state: 'done' });
    // Again (a mail client's one-click and then the page): still done, nothing else changes.
    expect(await unsubscribe({ token })).toMatchObject({ state: 'done' });
    expect(await unsubscribeInfo({ token })).toMatchObject({ state: 'done' });
    const [row] = await getDb().select().from(notificationPreference).where(and(eq(notificationPreference.userId, a.id), eq(notificationPreference.category, 'plan')));
    expect(row).toMatchObject({ email: false, version: 1 });
    expect((await send(a.id, 'plan.expired', planEnd, 'test:unsub:2')).emailed).toBe(false);

    // Switched on again in the settings: the old link is stale.
    await setNotificationPreference(a.principal, { category: 'plan', email: true });
    await expect(unsubscribeInfo({ token })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(unsubscribe({ token })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a forged token, a locked category and a deleted account with the same answer', async () => {
    const a = await account('forged');
    const good = signUnsubscribeToken({ userId: a.id, category: 'teaching', version: 0 });
    await expect(unsubscribe({ token: `${good.slice(0, -2)}xx` })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(unsubscribe({ token: signUnsubscribeToken({ userId: a.id, category: 'security', version: 0 }) })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(unsubscribe({ token: 'nothing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await getDb().delete(authUser).where(eq(authUser.id, a.id));
    await expect(unsubscribe({ token: good })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the e-mail carries the footer link and the List-Unsubscribe headers (RFC 8058)', async () => {
    const transport = recordingTransport();
    const mailer = createMailer({ db: getDb(), transport, from: 'WingChunRoots <no-reply@wingchunroots.test>' });
    const url = 'http://localhost:3000/unsubscribe?token=demo';
    const oneClickUrl = 'http://localhost:3000/unsubscribe/one-click?token=demo';
    await mailer.send({ template: 'notice', to: 'm18-headers@wingchunroots.test', data: notice.sample, idempotencyKey: 'test:m18:headers', unsubscribe: { url, oneClickUrl, category: 'Teaching' } });
    const [message] = transport.delivered;
    expect(message!.headers['List-Unsubscribe']).toBe(`<${oneClickUrl}>`);
    expect(message!.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(message!.text).toContain('Unsubscribe from Teaching e-mails');
    expect(message!.html).toContain(url);

    await mailer.send({ template: 'notice', to: 'm18-headers@wingchunroots.test', data: notice.sample, idempotencyKey: 'test:m18:no-headers' });
    expect(transport.delivered[1]!.headers['List-Unsubscribe']).toBeUndefined();
    expect(transport.delivered[1]!.text).not.toContain('Unsubscribe');
  });
});

describe('the notification list (In scope 6, 8)', () => {
  it('pages of 20, newest first, a category filter, and "Mark all as read" of a category only', async () => {
    const a = await account('list');
    for (let i = 0; i < 22; i++) await send(a.id, 'security.backup-codes', {}, `test:list:sec:${i}`);
    await send(a.id, 'plan.expiring', planEnd, 'test:list:plan');
    const first = await listNotifications(a.principal, {});
    expect(first).toMatchObject({ page: 1, pages: 2, total: 23, unread: 23, category: null });
    expect(first.items).toHaveLength(20);
    expect(first.items[0]!.category).toBe('plan');
    const second = await listNotifications(a.principal, { page: 2 });
    expect(second.items).toHaveLength(3);
    const plan = await listNotifications(a.principal, { category: 'plan' });
    expect(plan).toMatchObject({ total: 1, pages: 1, category: 'plan' });

    expect(await markAllNotificationsRead(a.principal, { category: 'plan' })).toEqual({ updated: 1, unread: 22 });
    expect(await markAllNotificationsRead(a.principal, {})).toEqual({ updated: 22, unread: 0 });
    await expect(listNotifications(a.principal, { category: 'nope' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(listNotifications(null, {})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('never shows another account’s notices', async () => {
    const a = await account('mine');
    const b = await account('theirs');
    await send(b.id, 'security.backup-codes', {}, 'test:theirs');
    expect((await listNotifications(a.principal, {})).total).toBe(0);
    expect(await markAllNotificationsRead(a.principal, {})).toEqual({ updated: 0, unread: 0 });
    expect((await listNotifications(b.principal, {})).unread).toBe(1);
  });
});

describe('the end of a plan (plans.expiry, In scope 5)', () => {
  async function grant(userId: string, startsAt: Date, endsAt: Date | null, planCode: 'premium_student' | 'pro_sifu' = 'premium_student') {
    const [row] = await getDb()
      .insert(entitlementGrant)
      .values({ subjectUserId: userId, planCode, source: 'test_grant', startsAt, endsAt, reason: 'Demo: M18 test plan' })
      .returning({ id: entitlementGrant.id });
    return row!.id;
  }

  it('one notice 7 days before and one at the end, per grant, however often the job runs', async () => {
    const a = await account('expiry');
    const now = new Date();
    const ends = new Date(now.getTime() + 3 * DAY);
    const id = await grant(a.id, new Date(now.getTime() - 20 * DAY), ends);
    await sendPlanEndNotices(getDb(), now);
    await sendPlanEndNotices(getDb(), now);
    const later = new Date(ends.getTime() + 60_000);
    await sendPlanEndNotices(getDb(), later);
    await sendPlanEndNotices(getDb(), later);
    const rows = (await notices(a.id)).sort((x, y) => x.template.localeCompare(y.template));
    expect(rows.map((r) => [r.template, r.dedupeKey])).toEqual([
      ['plan.expired', `plan.expired:${id}`],
      ['plan.expiring', `plan.expiring:${id}`],
    ]);
    expect(rows[1]!.payload).toMatchObject({ grantId: id, planCode: 'premium_student', nextPlanCode: 'free_student', endsAt: ends.toISOString() });
    // Plan e-mail is on by default: both were e-mailed.
    expect(await deliveries(a.id)).toHaveLength(2);
  });

  it('nothing for a grant carried on by another of the same plan, a revoked one, a far end or an old end', async () => {
    const now = new Date();
    const carried = await account('expiry-carried');
    await grant(carried.id, new Date(now.getTime() - 20 * DAY), new Date(now.getTime() + 2 * DAY));
    await grant(carried.id, new Date(now.getTime() - DAY), new Date(now.getTime() + 60 * DAY));
    const revoked = await account('expiry-revoked');
    const r = await grant(revoked.id, new Date(now.getTime() - 20 * DAY), new Date(now.getTime() + 2 * DAY));
    await getDb().update(entitlementGrant).set({ revokedAt: now, revokeReason: 'Demo: revoked' }).where(eq(entitlementGrant.id, r));
    const far = await account('expiry-far');
    await grant(far.id, new Date(now.getTime() - 20 * DAY), new Date(now.getTime() + 30 * DAY));
    const old = await account('expiry-old');
    await grant(old.id, new Date(now.getTime() - 40 * DAY), new Date(now.getTime() - 10 * DAY));
    const open = await account('expiry-open');
    await grant(open.id, new Date(now.getTime() - 20 * DAY), null);
    await sendPlanEndNotices(getDb(), now);
    for (const x of [carried, revoked, far, old, open]) expect(await notices(x.id), x.email).toHaveLength(0);
  });
});

describe('the limit notice (In scope 5; DEFAULT M18, question 2)', () => {
  const quota = (limit: number) =>
    new ServiceError('ENTITLEMENT_REQUIRED', 'Demo refusal', {}, { entitlement: { ok: false, code: 'quota', plan: 'free_student', limit, current: limit, grantedBy: 'premium_student' } });

  it('one per feature and month, only for a used-up allowance, never e-mailed', async () => {
    const a = await account('limit');
    const october = new Date(Date.UTC(2026, 9, 10));
    await tellLimitReached(a.id, 'photos', quota(1), october);
    await tellLimitReached(a.id, 'photos', quota(1), new Date(Date.UTC(2026, 9, 28)));
    await tellLimitReached(a.id, 'photos', quota(1), new Date(Date.UTC(2026, 10, 2)));
    await tellLimitReached(a.id, 'photos', new ServiceError('ENTITLEMENT_REQUIRED', 'Demo', {}, { entitlement: { ok: false, code: 'plan', plan: 'free_student', limit: 0, current: 0, grantedBy: 'premium_student' } }), october);
    await tellLimitReached(a.id, 'photos', new ServiceError('BAD_REQUEST', 'Demo'), october);
    const rows = await notices(a.id);
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual(['limit.reached:photos:2026-10', 'limit.reached:photos:2026-11']);
    expect(await deliveries(a.id)).toHaveLength(0);
  });
});

describe('retention (In scope 7)', () => {
  it('deletes read notices after 180 days and unread ones after 365', async () => {
    const a = await account('retention');
    const ago = (days: number) => new Date(Date.now() - days * DAY);
    const rows = [
      { label: 'read-old', createdAt: ago(181), readAt: ago(181) },
      { label: 'read-new', createdAt: ago(179), readAt: ago(100) },
      { label: 'unread-old', createdAt: ago(366), readAt: null },
      { label: 'unread-new', createdAt: ago(364), readAt: null },
    ];
    for (const r of rows) {
      await getDb().insert(notification).values({ userId: a.id, template: 'security.backup-codes', payload: { label: r.label }, createdAt: r.createdAt, readAt: r.readAt });
    }
    const { notifications: deleted } = await purgeOldNotifications(getDb());
    expect(deleted).toBeGreaterThanOrEqual(2);
    expect((await notices(a.id)).map((n) => (n.payload as { label: string }).label).sort()).toEqual(['read-new', 'unread-new']);
  });
});
