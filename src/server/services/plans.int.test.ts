// Plans, test plans, pilot access and notifications through the API (milestone M08, In scope 2-6):
// the plans.*, account.setType, grants.* and notifications.* procedures over /api/v1 with bearer
// sessions (the future native app) and over /api/rpc with the cookie (the web), against a migrated
// throwaway database. The Server Actions wrap the same procedures (src/server/rpc/parity.ts).

import { randomBytes } from 'node:crypto';

import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signedSessionToken } from '../auth/credentials';
import {
  createAccount,
  signIn,
  startAuthTestDatabase,
  stopAuthTestDatabase,
  TEST_APP_URL,
  type TestAccount,
} from '../auth/test-support';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, authSession, entitlementGrant, notification, pilotAccessRequest } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { handleApiRequest } from '../rpc/handler';
import { PILOT_REQUESTS_PER_WINDOW, PLANS_BANNER, PROPOSED_PRICE_LABEL } from './plans';

let testDb: TestDatabase | undefined;
let admins: { account: TestAccount; token: string }[] = [];

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  admins = [];
  for (const label of ['grants-admin-a', 'grants-admin-b']) {
    const account = await createAccount({ role: 'admin', label });
    admins.push({ account, token: (await signIn(account)).token });
  }
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

type Json = Record<string, unknown>;

async function v1(token: string | null, method: 'GET' | 'POST', path: string, body?: unknown) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await handleApiRequest(
    new Request(`${TEST_APP_URL}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    'openapi',
  );
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : null) as Json & { data?: { fields?: Record<string, string> } } };
}

/** /api/rpc with the session cookie, as the web client calls it (same-site Origin). */
async function rpcWithCookie(token: string, path: string, body: unknown) {
  const response = await handleApiRequest(
    new Request(`${TEST_APP_URL}/api/rpc${path}`, {
      method: 'POST',
      headers: { cookie: `wcr.session_token=${encodeURIComponent(token)}`, origin: TEST_APP_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ json: body }),
    }),
    'rpc',
  );
  return { status: response.status, data: ((await response.json()) as { json: Json }).json };
}

async function member(label: string, accountType?: 'student' | 'sifu') {
  const account = await createAccount({ label });
  const { token } = await signIn(account);
  if (accountType === 'sifu') expect((await v1(token, 'POST', '/account/type', { accountType: 'sifu' })).status).toBe(200);
  return { account, token };
}

/** A session row of `userId` created directly, without the second factor, as its bearer token. */
async function unverifiedSession(userId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await getDb().insert(authSession).values({ id: uuidv7(), userId, token, expiresAt: new Date(Date.now() + 3_600_000) });
  return signedSessionToken(token, process.env.BETTER_AUTH_SECRET!);
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function notificationsOf(userId: string, template?: string) {
  return getDb()
    .select()
    .from(notification)
    .where(and(eq(notification.userId, userId), template ? eq(notification.template, template) : undefined));
}

describe('plans.catalog and plans.mine', () => {
  it('the catalog is public: proposed prices, the banner and planned features marked', async () => {
    const result = await v1(null, 'GET', '/plans');
    expect(result.status).toBe(200);
    expect(result.data.banner).toBe(PLANS_BANNER);
    const plans = result.data.plans as { code: string; availability: string; price: { label: string } }[];
    expect(plans.map((p) => p.code)).toEqual(['free_student', 'premium_student', 'free_sifu', 'pro_sifu', 'federation']);
    for (const plan of plans) expect(plan.price.label).toBe(PROPOSED_PRICE_LABEL);
    expect(plans.find((p) => p.code === 'federation')!.availability).toBe('planned');
    const features = result.data.features as { key: string; availability: string }[];
    expect(features.filter((f) => f.availability === 'now').map((f) => f.key)).toEqual(['identity', 'claim_teachers', 'approve_students', 'school_map']);
  });

  it('plans.mine needs a session; a new account is a Student on Free Student', async () => {
    expect((await v1(null, 'GET', '/plans/mine')).status).toBe(401);
    const { token } = await member('mine');
    const mine = await v1(token, 'GET', '/plans/mine');
    expect(mine.status).toBe(200);
    expect(mine.data).toMatchObject({ accountType: 'student', plan: { code: 'free_student' }, instructor: { label: 'Student' }, grants: [], pilotRequest: null });
  });
});

describe('account.setType', () => {
  it('Sifu sets Free Sifu and shows "Instructor (unverified)"; audited; verifies nothing (DEFAULT D04)', async () => {
    const { account, token } = await member('to-sifu');
    const result = await v1(token, 'POST', '/account/type', { accountType: 'sifu' });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ accountType: 'sifu', changed: true, plan: { code: 'free_sifu', name: 'Free Sifu' }, instructor: { status: 'unverified', label: 'Instructor (unverified)' } });
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.type_change'), eq(auditLog.subjectId, account.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: account.id, before: { accountType: 'student', plan: 'free_student' }, after: { accountType: 'sifu', plan: 'free_sifu' } });
    // No grant and no review case: the plan comes from the account type alone.
    const [grants] = await getDb().select({ n: count() }).from(entitlementGrant).where(eq(entitlementGrant.subjectUserId, account.id));
    expect(grants!.n).toBe(0);

    // The web client: the same procedure over /api/rpc with the cookie.
    const back = await rpcWithCookie(token, '/account/setType', { accountType: 'student' });
    expect(back.status).toBe(200);
    expect(back.data).toMatchObject({ accountType: 'student', plan: { code: 'free_student' }, instructor: { label: 'Student' } });
  });

  it('refuses another value and a request without a session', async () => {
    const { token } = await member('type-invalid');
    const refused = await v1(token, 'POST', '/account/type', { accountType: 'master' });
    expect(refused.status).toBe(400);
    expect(refused.data.data?.fields).toHaveProperty('accountType');
    expect((await v1(null, 'POST', '/account/type', { accountType: 'sifu' })).status).toBe(401);
  });
});

describe('plans.requestPilotAccess', () => {
  it('notifies every admin, creates no grant and charges nothing; a second click sends nothing new', async () => {
    const { account, token } = await member('pilot', 'sifu');
    const before = await Promise.all(admins.map(({ account: a }) => notificationsOf(a.id, 'pilot-access.requested')));

    const result = await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ created: true, charged: false, request: { planCode: 'pro_sifu', planName: 'Professional Sifu', status: 'open' } });
    const requestId = (result.data.request as { id: string }).id;

    for (const [i, { account: admin }] of admins.entries()) {
      const rows = await notificationsOf(admin.id, 'pilot-access.requested');
      expect(rows.length).toBe(before[i]!.length + 1);
      expect(rows.some((row) => (row.payload as { requestId?: string }).requestId === requestId)).toBe(true);
    }
    // The admin's dashboard shows it with a link to the request.
    const list = await v1(admins[0]!.token, 'GET', '/notifications');
    const item = (list.data.items as { template: string; action: { href: string } | null }[]).find((n) => n.template === 'pilot-access.requested');
    expect(item?.action?.href).toBe(`/admin/grants?request=${requestId}`);

    const [grants] = await getDb().select({ n: count() }).from(entitlementGrant).where(eq(entitlementGrant.subjectUserId, account.id));
    expect(grants!.n).toBe(0);
    expect((await v1(token, 'GET', '/plans/mine')).data).toMatchObject({ plan: { code: 'free_sifu' }, pilotRequest: { id: requestId } });
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'pilot_access.request'), eq(auditLog.subjectId, requestId)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ planCode: 'pro_sifu', currentPlan: 'free_sifu', notifiedAdmins: admins.length });

    const again = await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' });
    expect(again.data).toMatchObject({ created: false, charged: false, request: { id: requestId } });
    for (const [i, { account: admin }] of admins.entries()) {
      expect((await notificationsOf(admin.id, 'pilot-access.requested')).length).toBe(before[i]!.length + 1);
    }
  });

  it('refuses a plan of the other account type, a plan the account has, and a request without a session', async () => {
    const student = await member('pilot-student');
    const wrong = await v1(student.token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' });
    expect(wrong.status).toBe(400);
    expect(wrong.data.data?.fields).toHaveProperty('planCode');
    expect((await v1(student.token, 'POST', '/plans/request-pilot-access', { planCode: 'federation' })).status).toBe(400);
    expect((await v1(null, 'POST', '/plans/request-pilot-access', { planCode: 'premium_student' })).status).toBe(401);

    const sifu = await member('pilot-has-plan', 'sifu');
    const granted = await v1(admins[0]!.token, 'POST', '/admin/grants/create', { email: sifu.account.email, planCode: 'pro_sifu', reason: 'Demo: pilot test' });
    expect(granted.status).toBe(200);
    expect((await v1(sifu.token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' })).status).toBe(409);
  });

  it(`allows ${PILOT_REQUESTS_PER_WINDOW} requests in the window, then answers 429`, async () => {
    const { account, token } = await member('pilot-rate', 'student');
    for (let i = 0; i < PILOT_REQUESTS_PER_WINDOW; i += 1) {
      expect((await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'premium_student' })).data).toMatchObject({ created: true });
      // An admin closes it without a grant (left unanswered, it would only be returned again).
      await getDb()
        .update(pilotAccessRequest)
        .set({ status: 'closed', closedAt: new Date(), closedByUserId: admins[0]!.account.id })
        .where(and(eq(pilotAccessRequest.userId, account.id), eq(pilotAccessRequest.status, 'open')));
    }
    const limited = await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'premium_student' });
    expect(limited.status).toBe(429);
    const [open] = await getDb()
      .select({ n: count() })
      .from(pilotAccessRequest)
      .where(and(eq(pilotAccessRequest.userId, account.id), eq(pilotAccessRequest.status, 'open')));
    expect(open!.n).toBe(0);
  });
});

describe('grants.* (admin with a verified second factor)', () => {
  it('no session 401; a member, a moderator and an admin session without the second factor 403', async () => {
    expect((await v1(null, 'GET', '/admin/grants')).status).toBe(401);
    const { token } = await member('grants-member');
    expect((await v1(token, 'GET', '/admin/grants')).status).toBe(403);
    expect((await v1(token, 'POST', '/admin/grants/create', { email: 'demo-x@example.test', planCode: 'pro_sifu', reason: 'x' })).status).toBe(403);
    const moderator = await createAccount({ role: 'moderator', label: 'grants-moderator' });
    expect((await v1((await signIn(moderator)).token, 'GET', '/admin/grants')).status).toBe(403);
    const unverified = await unverifiedSession(admins[0]!.account.id);
    const refused = await v1(unverified, 'GET', '/admin/grants');
    expect(refused.status).toBe(403);
    expect(refused.data.code).toBe('SECOND_FACTOR_REQUIRED');
    expect((await v1(unverified, 'POST', '/admin/grants/revoke', { grantId: uuidv7(), reason: 'x' })).status).toBe(403);
  });

  it('gives a Pro Sifu test plan with a reason, start and end; audited; answers the pilot request; then revokes it', async () => {
    const admin = admins[0]!;
    const sifu = await member('grant-target', 'sifu');
    const request = await v1(sifu.token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' });
    const requestId = (request.data.request as { id: string }).id;

    const created = await v1(admin.token, 'POST', '/admin/grants/create', {
      email: sifu.account.email.toUpperCase(),
      planCode: 'pro_sifu',
      reason: 'Demo: pilot test of the student limit',
      startsOn: today(),
      endsOn: inDays(30),
      requestId,
    });
    expect(created.status).toBe(200);
    expect(created.data).toMatchObject({ email: sifu.account.email, planCode: 'pro_sifu', source: 'test_grant', state: 'active', inEffect: true, reason: 'Demo: pilot test of the student limit', grantedBy: admin.account.email });
    const grantId = created.data.id as string;

    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'grant.create'), eq(auditLog.subjectId, grantId)));
    expect(audit).toMatchObject({ actorUserId: admin.account.id, actorRole: 'admin', reason: 'Demo: pilot test of the student limit', after: { userId: sifu.account.id, planCode: 'pro_sifu' } });
    const [closed] = await getDb().select().from(pilotAccessRequest).where(eq(pilotAccessRequest.id, requestId));
    expect(closed).toMatchObject({ status: 'closed', grantId, closedByUserId: admin.account.id });
    expect(await notificationsOf(sifu.account.id, 'plan.granted')).toHaveLength(1);
    expect((await v1(sifu.token, 'GET', '/plans/mine')).data).toMatchObject({ plan: { code: 'pro_sifu' }, pilotRequest: null });

    const list = await v1(admin.token, 'GET', `/admin/grants?q=${encodeURIComponent(sifu.account.email)}`);
    expect(list.status).toBe(200);
    expect((list.data.rows as { id: string }[]).map((r) => r.id)).toEqual([grantId]);

    const twice = await v1(admin.token, 'POST', '/admin/grants/create', { email: sifu.account.email, planCode: 'pro_sifu', reason: 'Demo: again' });
    expect(twice.status).toBe(409);

    const revoked = await v1(admin.token, 'POST', '/admin/grants/revoke', { grantId, reason: 'Demo: end of the test' });
    expect(revoked.status).toBe(200);
    expect(revoked.data).toMatchObject({ state: 'revoked', revokeReason: 'Demo: end of the test', revokedBy: admin.account.email });
    const [revokeAudit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'grant.revoke'), eq(auditLog.subjectId, grantId)));
    expect(revokeAudit).toMatchObject({ actorUserId: admin.account.id, reason: 'Demo: end of the test' });
    expect(await notificationsOf(sifu.account.id, 'plan.revoked')).toHaveLength(1);
    expect((await v1(sifu.token, 'GET', '/plans/mine')).data).toMatchObject({ plan: { code: 'free_sifu' } });
    expect((await v1(admin.token, 'POST', '/admin/grants/revoke', { grantId, reason: 'Again' })).status).toBe(409);
  });

  it('refuses a missing reason, dates in the wrong order, an unknown account and a plan of the other account type', async () => {
    const admin = admins[0]!;
    const student = await member('grant-invalid');
    const noReason = await v1(admin.token, 'POST', '/admin/grants/create', { email: student.account.email, planCode: 'premium_student', reason: ' ' });
    expect(noReason.status).toBe(400);
    expect(noReason.data.data?.fields).toHaveProperty('reason');
    const order = await v1(admin.token, 'POST', '/admin/grants/create', {
      email: student.account.email,
      planCode: 'premium_student',
      reason: 'Demo',
      startsOn: inDays(10),
      endsOn: inDays(5),
    });
    expect(order.status).toBe(400);
    expect(order.data.data?.fields).toHaveProperty('endsOn');
    expect((await v1(admin.token, 'POST', '/admin/grants/create', { email: 'demo-nobody@example.test', planCode: 'premium_student', reason: 'Demo' })).status).toBe(404);
    const audience = await v1(admin.token, 'POST', '/admin/grants/create', { email: student.account.email, planCode: 'pro_sifu', reason: 'Demo' });
    expect(audience.status).toBe(400);
    expect(audience.data.data?.fields).toHaveProperty('planCode');
    expect((await v1(admin.token, 'POST', '/admin/grants/create', { email: student.account.email, planCode: 'federation', reason: 'Demo' })).status).toBe(400);
    const [grants] = await getDb().select({ n: count() }).from(entitlementGrant).where(eq(entitlementGrant.subjectUserId, student.account.id));
    expect(grants!.n).toBe(0);
  });
});

describe('notifications.*', () => {
  it('lists own notifications with the unread count; marks own ones read, by id or all; never another account’s', async () => {
    const a = await member('notify-a');
    const b = await member('notify-b');
    const insert = (userId: string) =>
      getDb()
        .insert(notification)
        .values({ userId, template: 'plan.revoked', payload: { planCode: 'premium_student' } })
        .returning({ id: notification.id });
    const [a1] = await insert(a.account.id);
    await insert(a.account.id);
    const [b1] = await insert(b.account.id);

    const list = await v1(a.token, 'GET', '/notifications');
    expect(list.status).toBe(200);
    expect(list.data.unread).toBe(2);
    expect((list.data.items as { title: string }[])[0]!.title).toBe('Pilot plan ended: Premium Student');

    // Another account's id matches nothing and says nothing about it.
    const other = await v1(a.token, 'POST', '/notifications/mark-read', { ids: [b1!.id] });
    expect(other.data).toEqual({ updated: 0, unread: 2 });
    const [bRow] = await getDb().select().from(notification).where(eq(notification.id, b1!.id));
    expect(bRow!.readAt).toBeNull();

    expect((await v1(a.token, 'POST', '/notifications/mark-read', { ids: [a1!.id] })).data).toEqual({ updated: 1, unread: 1 });
    expect((await v1(a.token, 'POST', '/notifications/mark-read', { ids: [a1!.id] })).data).toEqual({ updated: 0, unread: 1 });
    expect((await rpcWithCookie(a.token, '/notifications/markRead', { all: true })).data).toEqual({ updated: 1, unread: 0 });
    expect((await v1(b.token, 'GET', '/notifications')).data.unread).toBe(1);

    expect((await v1(a.token, 'POST', '/notifications/mark-read', { ids: ['not-an-id'] })).status).toBe(400);
    expect((await v1(a.token, 'POST', '/notifications/mark-read', { all: false })).status).toBe(400);
    expect((await v1(null, 'POST', '/notifications/mark-read', { all: true })).status).toBe(401);
    expect((await v1(null, 'GET', '/notifications')).status).toBe(401);
  });
});

describe('dashboard.overview', () => {
  it('needs a session; a Student without a profile gets empty lists; a Sifu gets the Sifu sections', async () => {
    expect((await v1(null, 'GET', '/dashboard')).status).toBe(401);
    const student = await member('dash-student');
    expect((await v1(student.token, 'GET', '/dashboard')).data).toMatchObject({
      accountType: 'student',
      hasProfile: false,
      student: { teachers: [], requests: [] },
      sifu: null,
      notifications: { unread: 0, items: [] },
    });
    const sifu = await member('dash-sifu', 'sifu');
    expect((await v1(sifu.token, 'GET', '/dashboard')).data).toMatchObject({
      accountType: 'sifu',
      instructor: { label: 'Instructor (unverified)' },
      student: null,
      sifu: { requests: [], schools: [], students: { approved: 0, limit: 5 }, upgrade: null },
    });
  });
});
