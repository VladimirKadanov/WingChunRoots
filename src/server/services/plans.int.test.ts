// Plans, test plans, pilot access and notifications through the API (milestone M08, In scope 2-6):
// the plans.*, account.setType, grants.* and notifications.* procedures over /api/v1 with bearer
// sessions (the future native app) and over /api/rpc with the cookie (the web), against a migrated
// throwaway database. The Server Actions wrap the same procedures (src/server/rpc/parity.ts).

import { randomBytes } from 'node:crypto';

import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
import {
  auditLog,
  authSession,
  entitlementGrant,
  lineage,
  notification,
  person,
  personName,
  pilotAccessRequest,
  reviewCase,
  teachingRelationship,
} from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { handleApiRequest } from '../rpc/handler';
import {
  ACCOUNT_TYPE_CHANGES_PER_WINDOW,
  ACCOUNT_TYPE_LIMIT_MESSAGE,
  PILOT_REQUEST_WINDOW_DAYS,
  PILOT_REQUESTS_PER_WINDOW,
  pilotRequestLimitMessage,
  PLANS_BANNER,
  PROPOSED_PRICE_LABEL,
} from './plans';


// M11: grants and account type changes drop the cached school answers (revalidateTag), which
// needs Next.js's request store; recorded here instead.
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
    const plans = result.data.plans as { code: string; availability: string; price: { label: string | null; text: string; monthlyUsd: number } }[];
    expect(plans.map((p) => p.code)).toEqual(['free_student', 'premium_student', 'free_sifu', 'pro_sifu', 'federation']);
    // Every price is a proposal; a free plan is "Free", with no proposal label (review round 1, design-10).
    for (const plan of plans) expect(plan.price.label, plan.code).toBe(plan.price.monthlyUsd === 0 ? null : PROPOSED_PRICE_LABEL);
    for (const plan of plans) if (plan.price.monthlyUsd === 0) expect(plan.price.text).toBe('Free');
    expect(plans.find((p) => p.code === 'federation')!.price.text).toBe('$99 a month or $990 a year');
    expect(plans.find((p) => p.code === 'federation')!.availability).toBe('planned');
    const features = result.data.features as { key: string; availability: string }[];
    expect(features.filter((f) => f.availability === 'now').map((f) => f.key)).toEqual(['identity', 'claim_teachers', 'approve_students', 'school_map']);
  });

  it('plans.mine needs a session; a new account is a Student on Free Student', async () => {
    expect((await v1(null, 'GET', '/plans/mine')).status).toBe(401);
    const { token } = await member('mine');
    const mine = await v1(token, 'GET', '/plans/mine');
    expect(mine.status).toBe(200);
    expect(mine.data).toMatchObject({
      accountType: 'student',
      plan: { code: 'free_student' },
      instructor: { label: 'Student' },
      verifiedInstructor: false,
      grants: [],
      pilotRequest: null,
    });
  });

  it('plans.mine says whether the person is a verified instructor, also while the account is a Student (review round 2, recheck-9)', async () => {
    const { account, token } = await member('mine-verified');
    const personId = uuidv7();
    await getDb()
      .insert(person)
      .values({ id: personId, slug: `demo-mine-verified-${randomBytes(4).toString('hex')}`, kind: 'living', stewardship: 'self', claimedByUserId: account.id });
    await getDb().insert(personName).values({ personId, value: 'Demo Verified Teacher', script: 'Latn', lang: 'und-Latn', isPrimary: true });
    await getDb().insert(reviewCase).values({ kind: 'instructor_verification', status: 'resolved', personId, resolution: 'approved', resolvedAt: new Date() });
    expect((await v1(token, 'GET', '/plans/mine')).data).toMatchObject({ accountType: 'student', instructor: { status: 'not_instructor' }, verifiedInstructor: true });
    expect((await v1(token, 'POST', '/account/type', { accountType: 'sifu' })).status).toBe(200);
    expect((await v1(token, 'GET', '/plans/mine')).data).toMatchObject({
      accountType: 'sifu',
      instructor: { status: 'verified', label: 'Instructor' },
      verifiedInstructor: true,
    });
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

  it(`allows ${ACCOUNT_TYPE_CHANGES_PER_WINDOW} changes a day, then answers 429 and writes nothing (review round 1, security-2)`, async () => {
    const { account, token } = await member('type-limit');
    const types = ['sifu', 'student'] as const;
    for (let i = 0; i < ACCOUNT_TYPE_CHANGES_PER_WINDOW; i += 1) {
      const result = await v1(token, 'POST', '/account/type', { accountType: types[i % 2] });
      expect(result.status, `change ${i + 1}`).toBe(200);
      expect(result.data.changed).toBe(true);
    }
    const audits = async () =>
      (await getDb().select({ n: count() }).from(auditLog).where(and(eq(auditLog.action, 'account.type_change'), eq(auditLog.subjectId, account.id))))[0]!.n;
    expect(await audits()).toBe(ACCOUNT_TYPE_CHANGES_PER_WINDOW);
    const current = types[(ACCOUNT_TYPE_CHANGES_PER_WINDOW - 1) % 2];
    const other = current === 'sifu' ? 'student' : 'sifu';
    const refused = await v1(token, 'POST', '/account/type', { accountType: other });
    expect(refused.status).toBe(429);
    expect(refused.data.message).toBe(ACCOUNT_TYPE_LIMIT_MESSAGE);
    expect(await audits()).toBe(ACCOUNT_TYPE_CHANGES_PER_WINDOW);
    expect((await v1(token, 'GET', '/plans/mine')).data.accountType).toBe(current);
    // Choosing the type it already has changes nothing and is not refused.
    expect(await v1(token, 'POST', '/account/type', { accountType: current })).toMatchObject({ status: 200, data: { changed: false } });
    // The web path is limited the same way.
    expect((await rpcWithCookie(token, '/account/setType', { accountType: other })).status).toBe(429);
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
    expect(item?.action?.href).toBe(`/admin/grants?request=${requestId}#give-plan`);

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

  it('switching the account type closes an open request for a plan of the old type, so a new one can follow', async () => {
    const { account, token } = await member('pilot-switch');
    const first = await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'premium_student' });
    const firstId = (first.data.request as { id: string }).id;
    expect((await v1(token, 'POST', '/account/type', { accountType: 'sifu' })).status).toBe(200);

    const [closed] = await getDb().select().from(pilotAccessRequest).where(eq(pilotAccessRequest.id, firstId));
    expect(closed).toMatchObject({ status: 'closed', closedByUserId: null, grantId: null });
    expect(closed!.closedAt).not.toBeNull();
    const [audit] = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'account.type_change'), eq(auditLog.subjectId, account.id)));
    expect(audit!.after).toMatchObject({ accountType: 'sifu', closedPilotRequestId: firstId });

    const second = await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' });
    expect(second.data).toMatchObject({ created: true, request: { planCode: 'pro_sifu', status: 'open' } });
    expect((await v1(token, 'GET', '/plans/mine')).data).toMatchObject({ pilotRequest: { planCode: 'pro_sifu' } });
  });

  it('the admins’ notification keeps no name: the list shows the requester’s current name, and none once the request is gone', async () => {
    const { account, token } = await member('pilot-name', 'sifu');
    const personId = uuidv7();
    await getDb()
      .insert(person)
      .values({ id: personId, slug: `demo-pilot-name-${randomBytes(4).toString('hex')}`, kind: 'living', stewardship: 'self', claimedByUserId: account.id });
    await getDb().insert(personName).values({ personId, value: 'Demo Pilot Asker', script: 'Latn', lang: 'und-Latn', isPrimary: true });
    const result = await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' });
    const requestId = (result.data.request as { id: string }).id;

    const admin = admins[0]!;
    const [stored] = (await notificationsOf(admin.account.id, 'pilot-access.requested')).filter((row) => (row.payload as { requestId: string }).requestId === requestId);
    expect(stored!.payload).toEqual({ requestId, planCode: 'pro_sifu' });

    type Item = { id: string; body: ({ text: string } | { name: { value: string } })[]; action: { href: string } | null; template: string };
    const shown = async () => {
      const items = (await v1(admin.token, 'GET', '/notifications')).data.items as Item[];
      return items.find((item) => item.action?.href === `/admin/grants?request=${requestId}#give-plan`);
    };
    expect((await shown())?.body[0]).toEqual({ name: { value: 'Demo Pilot Asker', lang: 'und-Latn' } });
    await getDb().update(personName).set({ value: 'Demo Pilot Renamed' }).where(eq(personName.personId, personId));
    expect((await shown())?.body[0]).toEqual({ name: { value: 'Demo Pilot Renamed', lang: 'und-Latn' } });

    // The request goes with its account (ON DELETE CASCADE): the notification names nobody.
    await getDb().delete(pilotAccessRequest).where(eq(pilotAccessRequest.id, requestId));
    const items = (await v1(admin.token, 'GET', '/notifications')).data.items as Item[];
    const gone = items.find((item) => item.id === stored!.id);
    expect(gone?.action).toBeNull();
    expect(gone?.body).toEqual([{ text: 'A since deleted account asked for pilot access to Professional Sifu. The request was removed with the account.' }]);
    expect(JSON.stringify(items)).not.toContain('Demo Pilot');
  });

  it('an admin session without the second factor sees neither the requester, the plan nor the open count (review round 2, recheck-1)', async () => {
    const { account, token } = await member('pilot-hidden', 'sifu');
    const personId = uuidv7();
    await getDb()
      .insert(person)
      .values({ id: personId, slug: `demo-pilot-hidden-${randomBytes(4).toString('hex')}`, kind: 'living', stewardship: 'self', claimedByUserId: account.id });
    await getDb().insert(personName).values({ personId, value: 'Demo Hidden Asker', script: 'Latn', lang: 'und-Latn', isPrimary: true });
    const result = await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' });
    const requestId = (result.data.request as { id: string }).id;
    const href = `/admin/grants?request=${requestId}#give-plan`;
    type Item = { title: string; body: ({ text: string } | { name: { value: string } })[]; action: { href: string } | null };
    const find = async (bearer: string) => ((await v1(bearer, 'GET', '/notifications')).data.items as Item[]).find((item) => item.action?.href === href);

    // The same admin account: once with a session that only knows the password, once verified.
    const admin = admins[1]!;
    const unverified = await unverifiedSession(admin.account.id);
    const hidden = await find(unverified);
    expect(hidden?.body).toEqual([
      { text: 'An account asked for pilot access. Confirm this session with your authenticator app to see who asked and for which plan.' },
    ]);
    expect(JSON.stringify(hidden)).not.toContain('Demo Hidden Asker');
    expect(JSON.stringify(hidden)).not.toContain('Professional Sifu');
    const hiddenDash = await v1(unverified, 'GET', '/dashboard');
    expect(hiddenDash.data.staff).toEqual({ role: 'admin', secondFactorVerified: false, openPilotRequests: null });
    expect(JSON.stringify(hiddenDash.data)).not.toContain('Demo Hidden Asker');

    const shown = await find(admin.token);
    expect(shown?.body).toEqual([{ name: { value: 'Demo Hidden Asker', lang: 'und-Latn' } }, { text: ' asked for Professional Sifu.' }]);
    const dash = await v1(admin.token, 'GET', '/dashboard');
    expect(dash.data.staff).toMatchObject({ role: 'admin', secondFactorVerified: true });
    expect((dash.data.staff as { openPilotRequests: number }).openPilotRequests).toBeGreaterThanOrEqual(1);

    // A moderator whose session proved the second factor gets no count either: it is admin work.
    const moderator = await createAccount({ role: 'moderator', label: 'pilot-hidden-moderator' });
    const modDash = await v1((await signIn(moderator)).token, 'GET', '/dashboard');
    expect(modDash.data.staff).toEqual({ role: 'moderator', secondFactorVerified: true, openPilotRequests: null });
  });

  it(`allows ${PILOT_REQUESTS_PER_WINDOW} requests in the window, then answers 429 with the day it can ask again`, async () => {
    const { account, token } = await member('pilot-rate', 'student');
    let first: Date | null = null;
    for (let i = 0; i < PILOT_REQUESTS_PER_WINDOW; i += 1) {
      const asked = await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'premium_student' });
      expect(asked.data).toMatchObject({ created: true });
      const request = asked.data.request as { id: string; createdAt: string };
      first ??= new Date(request.createdAt);
      // An admin closes it without a grant (review round 2, recheck-5: grants.closeRequest).
      const closed = await v1(admins[0]!.token, 'POST', '/admin/grants/close-request', { requestId: request.id, reason: 'Demo pilot test of the limit' });
      expect(closed.status, JSON.stringify(closed.data)).toBe(200);
    }
    const limited = await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'premium_student' });
    expect(limited.status).toBe(429);
    // No promise of an answer: the first whole day on which the oldest request has left the window.
    expect(limited.data.message).toBe(pilotRequestLimitMessage(new Date(first!.getTime() + PILOT_REQUEST_WINDOW_DAYS * 86_400_000)));
    expect(limited.data.message).toMatch(/^You have asked for pilot access 3 times in 30 days\. You can ask again from \d{1,2} \w+ \d{4}; nothing is charged\.$/);
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
    // M11: the account's school pins appear with the plan (DEFAULT D08/D18).
    expect(cache.revalidated).toContain('schools');
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

  it('closes a pilot request without a plan: reason required, audited, the account told, its plan unchanged (review round 2, recheck-5)', async () => {
    const { account, token } = await member('pilot-close', 'sifu');
    const asked = await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' });
    const requestId = (asked.data.request as { id: string }).id;
    const admin = admins[0]!;
    // Only an admin whose session proved the second factor; a reason is required.
    expect((await v1(token, 'POST', '/admin/grants/close-request', { requestId, reason: 'x' })).status).toBe(403);
    const unverified = await v1(await unverifiedSession(admin.account.id), 'POST', '/admin/grants/close-request', { requestId, reason: 'x' });
    expect(unverified).toMatchObject({ status: 403, data: { code: 'SECOND_FACTOR_REQUIRED' } });
    const noReason = await v1(admin.token, 'POST', '/admin/grants/close-request', { requestId, reason: '  ' });
    expect(noReason.status).toBe(400);
    expect(noReason.data.data?.fields).toHaveProperty('reason');
    expect((await v1(admin.token, 'POST', '/admin/grants/close-request', { requestId: uuidv7(), reason: 'x' })).status).toBe(404);

    const closed = await v1(admin.token, 'POST', '/admin/grants/close-request', { requestId, reason: 'Demo pilot: not this time' });
    expect(closed.status).toBe(200);
    expect(closed.data).toMatchObject({ id: requestId, email: account.email, planCode: 'pro_sifu', planName: 'Professional Sifu' });
    const [row] = await getDb().select().from(pilotAccessRequest).where(eq(pilotAccessRequest.id, requestId));
    expect(row).toMatchObject({ status: 'closed', closedByUserId: admin.account.id, grantId: null });
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'pilot_access.close'), eq(auditLog.subjectId, requestId)));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: admin.account.id, reason: 'Demo pilot: not this time', before: { status: 'open', planCode: 'pro_sifu', userId: account.id } });
    // The account hears of it, without the reason; its plan has not changed; it can ask again.
    const items = (await v1(token, 'GET', '/notifications')).data.items as { template: string; title: string; body: { text: string }[] }[];
    const told = items.find((item) => item.template === 'pilot-access.closed');
    expect(told?.title).toBe('Pilot access request closed');
    expect(told?.body[0]?.text).toBe(
      'An administrator closed your request for pilot access to Professional Sifu without giving the plan. Your plan has not changed and nothing is charged.',
    );
    expect(JSON.stringify(items)).not.toContain('not this time');
    expect((await v1(token, 'GET', '/plans/mine')).data).toMatchObject({ plan: { code: 'free_sifu' }, pilotRequest: null });
    expect((await v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' })).data).toMatchObject({ created: true });
    // A request already answered is not closed twice.
    expect((await v1(admin.token, 'POST', '/admin/grants/close-request', { requestId, reason: 'again' })).status).toBe(409);
    // Every admin's notification of it now says it was answered and offers no review (final check, screens-4).
    for (const other of admins) {
      const [stored] = (await notificationsOf(other.account.id, 'pilot-access.requested')).filter((n) => (n.payload as { requestId: string }).requestId === requestId);
      const listed = ((await v1(other.token, 'GET', '/notifications')).data.items as { id: string; action: unknown; body: { text?: string }[] }[]).find(
        (item) => item.id === stored!.id,
      );
      expect(listed?.action).toBeNull();
      expect(listed?.body.map((segment) => segment.text ?? '').join('')).toContain('The request has already been answered.');
    }
    // The grants page has nothing to fill in for it.
    expect((await v1(admin.token, 'GET', `/admin/grants?request=${requestId}`)).data).toMatchObject({ prefill: null });
  });

  it('a grant answers the request the form came from only when it is the account’s own', async () => {
    const admin = admins[0]!;
    const asking = await member('grant-request-a', 'sifu');
    const other = await member('grant-request-b', 'sifu');
    const a = (await v1(asking.token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' })).data.request as { id: string };
    const b = (await v1(other.token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' })).data.request as { id: string };

    // The form came from A's request, but the admin gave the plan to B: A's request stays open.
    const created = await v1(admin.token, 'POST', '/admin/grants/create', { email: other.account.email, planCode: 'pro_sifu', reason: 'Demo: other account', requestId: a.id });
    expect(created.status).toBe(200);
    // Without a start the plan starts today at 00:00 UTC, as the form and the guides say (review round 2, recheck-8).
    expect(created.data.startsAt).toBe(`${today()}T00:00:00.000Z`);
    const rows = await getDb().select({ id: pilotAccessRequest.id, status: pilotAccessRequest.status }).from(pilotAccessRequest).where(eq(pilotAccessRequest.id, a.id));
    expect(rows).toEqual([{ id: a.id, status: 'open' }]);
    const [answered] = await getDb().select().from(pilotAccessRequest).where(eq(pilotAccessRequest.id, b.id));
    expect(answered).toMatchObject({ status: 'closed', grantId: created.data.id });
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
    const noPlan = await v1(admin.token, 'POST', '/admin/grants/create', { email: student.account.email, planCode: '', reason: 'Demo' });
    expect(noPlan.data.data?.fields).toMatchObject({ planCode: 'Choose a plan.' });
    // An empty form gets every field error at once, not one round trip per field (final check, screens-2).
    const empty = await v1(admin.token, 'POST', '/admin/grants/create', { email: '', reason: '' });
    expect(empty.status).toBe(400);
    expect(empty.data.data?.fields).toEqual({
      planCode: 'Choose a plan.',
      email: 'Enter the e-mail address of the account.',
      reason: 'Give a reason; it is kept in the audit log.',
    });
    const badDates = await v1(admin.token, 'POST', '/admin/grants/create', { email: 'not-an-address', planCode: 'nope', reason: '', startsOn: 'soon', endsOn: 'later' });
    expect(Object.keys(badDates.data.data?.fields ?? {}).sort()).toEqual(['email', 'endsOn', 'planCode', 'reason', 'startsOn']);
    const [grants] = await getDb().select({ n: count() }).from(entitlementGrant).where(eq(entitlementGrant.subjectUserId, student.account.id));
    expect(grants!.n).toBe(0);
  });

  it('refuses a start before today and a start or end more than two years ahead (review round 1, security-3)', async () => {
    const admin = admins[0]!;
    const student = await member('grant-dates');
    const give = (dates: { startsOn?: string; endsOn?: string }) =>
      v1(admin.token, 'POST', '/admin/grants/create', { email: student.account.email, planCode: 'premium_student', reason: 'Demo dates', ...dates });
    const past = await give({ startsOn: '1970-01-01' });
    expect(past.status).toBe(400);
    expect(past.data.data?.fields).toMatchObject({ startsOn: 'The start cannot be before today.' });
    expect((await give({ startsOn: inDays(-1) })).data.data?.fields).toMatchObject({ startsOn: 'The start cannot be before today.' });
    const far = await give({ startsOn: '9999-12-31' });
    expect(far.status).toBe(400);
    expect(far.data.data?.fields).toMatchObject({ startsOn: 'Choose a date within the next two years.' });
    expect((await give({ endsOn: '9999-12-31' })).data.data?.fields).toMatchObject({ endsOn: 'Choose a date within the next two years.' });
    expect((await give({ startsOn: inDays(800) })).status).toBe(400);
    const [none] = await getDb().select({ n: count() }).from(entitlementGrant).where(eq(entitlementGrant.subjectUserId, student.account.id));
    expect(none!.n).toBe(0);
    // Today and a day well inside the two years are fine.
    expect((await give({ startsOn: today(), endsOn: inDays(700) })).status).toBe(200);
  });

  it('a grant that starts later is announced with its start; the plan does not change before it (review round 1, security-4)', async () => {
    const admin = admins[0]!;
    const sifu = await member('grant-later', 'sifu');
    const created = await v1(admin.token, 'POST', '/admin/grants/create', {
      email: sifu.account.email,
      planCode: 'pro_sifu',
      reason: 'Demo later start',
      startsOn: inDays(30),
      endsOn: inDays(60),
    });
    expect(created.status).toBe(200);
    const [row] = await notificationsOf(sifu.account.id, 'plan.granted');
    expect(row!.payload).toMatchObject({ planCode: 'pro_sifu', startsAt: `${inDays(30)}T00:00:00.000Z`, endsAt: `${inDays(60)}T00:00:00.000Z` });
    const list = (await v1(sifu.token, 'GET', '/notifications')).data as { items: { template: string; body: { text?: string }[] }[] };
    const text = list.items.find((item) => item.template === 'plan.granted')!.body.map((segment) => segment.text ?? '').join('');
    expect(text).toContain(`for the pilot from ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${inDays(30)}T00:00:00Z`))}`);
    expect((await v1(sifu.token, 'GET', '/plans/mine')).data).toMatchObject({ plan: { code: 'free_sifu' } });
  });
});

describe('a bearer request is read without its cookie (review round 1, security-7)', () => {
  it('an invalid bearer token next to a valid session cookie is no session: 401, and nothing changes', async () => {
    const { account, token } = await member('bearer-cookie');
    const response = await handleApiRequest(
      new Request(`${TEST_APP_URL}/api/v1/account/type`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer x',
          cookie: `wcr.session_token=${encodeURIComponent(token)}`,
          origin: 'https://evil.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ accountType: 'sifu' }),
      }),
      'openapi',
    );
    expect(response.status).toBe(401);
    const audits = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'account.type_change'), eq(auditLog.subjectId, account.id)));
    expect(audits).toEqual([]);
    // The cookie alone, from this site, still works; the token as a bearer too.
    expect((await rpcWithCookie(token, '/account/setType', { accountType: 'sifu' })).status).toBe(200);
    expect((await v1(token, 'POST', '/account/type', { accountType: 'student' })).status).toBe(200);
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

  it('at the Free Sifu limit the upgrade offer counts every waiting request, beyond the 50 listed', async () => {
    const sifu = await member('dash-limit', 'sifu');
    const lineageId = uuidv7();
    const otherLineageId = uuidv7();
    await getDb()
      .insert(lineage)
      .values([
        { id: lineageId, slug: `demo-dash-${randomBytes(3).toString('hex')}`, name: 'Demo Dashboard Lineage' },
        { id: otherLineageId, slug: `demo-dash-${randomBytes(3).toString('hex')}`, name: 'Demo Dashboard Lineage Two' },
      ]);
    const newPeople = async (n: number, claimedByUserId: string | null = null) => {
      const ids = Array.from({ length: n }, () => uuidv7());
      await getDb()
        .insert(person)
        .values(ids.map((id) => ({ id, slug: `demo-dash-${randomBytes(5).toString('hex')}`, kind: 'living' as const, stewardship: claimedByUserId ? ('self' as const) : ('unclaimed' as const), claimedByUserId })));
      await getDb()
        .insert(personName)
        .values(ids.map((personId, i) => ({ personId, value: `Demo Dash ${i + 1}`, script: 'Latn', lang: 'und-Latn', isPrimary: true })));
      return ids;
    };
    const [own] = await newPeople(1, sifu.account.id);
    const students = await newPeople(5 + 52);
    await getDb()
      .insert(teachingRelationship)
      .values(
        students.map((studentPersonId, i) => ({
          id: uuidv7(),
          teacherPersonId: own!,
          studentPersonId,
          lineageId,
          status: i < 5 ? ('verified' as const) : ('pending_teacher' as const),
          visibility: 'involved_only' as const,
        })),
      );

    // One more request from a student who already counts: approving it would not grow the count.
    await getDb().insert(teachingRelationship).values({ id: uuidv7(), teacherPersonId: own!, studentPersonId: students[0]!, lineageId: otherLineageId, status: 'pending_teacher', visibility: 'involved_only' });

    const overview = (await v1(sifu.token, 'GET', '/dashboard')).data as {
      sifu: { requests: unknown[]; students: { approved: number }; upgrade: { waiting: { count: number }; to: { code: string } } | null };
    };
    expect(overview.sifu.students.approved).toBe(5);
    expect(overview.sifu.requests).toHaveLength(50);
    expect(overview.sifu.upgrade).toMatchObject({ feature: 'approve_students', heading: 'More students with Professional Sifu', waiting: { count: 52 }, to: { code: 'pro_sifu' } });
  });

  it('a removed profile (deleted_at) shows in no list by name or slug and waits for nobody (final check, security-2)', async () => {
    const sifu = await member('dash-removed', 'sifu');
    const student = await member('dash-removed-student');
    const lineageId = uuidv7();
    await getDb().insert(lineage).values({ id: lineageId, slug: `demo-dash-${randomBytes(3).toString('hex')}`, name: 'Demo Removed Lineage' });
    const own = uuidv7();
    const asker = uuidv7();
    const askerSlug = `demo-dash-removed-${randomBytes(4).toString('hex')}`;
    await getDb()
      .insert(person)
      .values([
        { id: own, slug: `demo-dash-${randomBytes(5).toString('hex')}`, kind: 'living', stewardship: 'self', claimedByUserId: sifu.account.id },
        { id: asker, slug: askerSlug, kind: 'living', stewardship: 'self', claimedByUserId: student.account.id },
      ]);
    await getDb()
      .insert(personName)
      .values([
        { personId: own, value: 'Demo Removed Teacher', script: 'Latn', lang: 'und-Latn', isPrimary: true },
        { personId: asker, value: 'Demo Removed Asker', script: 'Latn', lang: 'und-Latn', isPrimary: true },
        { personId: asker, value: '陳演示', script: 'Hant', lang: 'zh-Hant', isPrimary: false },
      ]);
    // Five established students reach the Free Sifu limit; the asker's request waits.
    const established = Array.from({ length: 5 }, () => uuidv7());
    await getDb().insert(person).values(established.map((id) => ({ id, slug: `demo-dash-${randomBytes(5).toString('hex')}`, kind: 'living' as const, stewardship: 'unclaimed' as const })));
    await getDb()
      .insert(teachingRelationship)
      .values([
        ...established.map((studentPersonId) => ({ id: uuidv7(), teacherPersonId: own, studentPersonId, lineageId, status: 'verified' as const, visibility: 'involved_only' as const })),
        { id: uuidv7(), teacherPersonId: own, studentPersonId: asker, lineageId, status: 'pending_teacher', visibility: 'involved_only' },
      ]);
    type Ref = { slug: string | null; name: { value: string }; original: unknown; removed: boolean };
    const before = (await v1(sifu.token, 'GET', '/dashboard')).data as { sifu: { requests: { student: Ref }[]; upgrade: { waiting: { count: number } } | null } };
    expect(before.sifu.requests.map((r) => r.student)).toMatchObject([{ slug: askerSlug, name: { value: 'Demo Removed Asker' }, removed: false }]);
    expect(before.sifu.upgrade?.waiting.count).toBe(1);

    await getDb().update(person).set({ deletedAt: new Date() }).where(eq(person.id, asker));
    const after = (await v1(sifu.token, 'GET', '/dashboard')).data as { sifu: { requests: { student: Ref }[]; upgrade: { waiting: { count: number } } | null } };
    expect(after.sifu.requests.map((r) => r.student)).toEqual([{ id: asker, slug: null, name: { value: 'A removed profile', lang: 'en' }, original: null, removed: true }]);
    // Nothing waits because of the limit any more: no upgrade offer.
    expect(after.sifu.upgrade).toBeNull();
    const text = JSON.stringify(after);
    expect(text).not.toContain('Demo Removed Asker');
    expect(text).not.toContain('陳演示');
    expect(text).not.toContain(askerSlug);
  });
});

// Review round 1 (security-1, code-1, code-3): every account-scoped write takes the account's row
// lock first (lockAccount, FOR NO KEY UPDATE), so two requests for one account wait in line instead
// of deadlocking on the foreign-key check of an insert.
describe('concurrent changes to one account', () => {
  const ROUNDS = 20;

  it(`the account type switch and "Request pilot access" at once never deadlock (${ROUNDS} rounds)`, async () => {
    const statuses: number[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const { token } = await member(`race-type-${round}`, 'sifu');
      const results = await Promise.all([
        v1(token, 'POST', '/account/type', { accountType: 'student' }),
        v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' }),
      ]);
      statuses.push(...results.map((result) => result.status));
    }
    // A request that came second may be refused (400: Pro Sifu is for Sifu accounts), never failed.
    expect(statuses.filter((status) => status >= 500)).toEqual([]);
  });

  it(`a grant and "Request pilot access" at once never leave a request open for a plan the account has (${ROUNDS} rounds)`, async () => {
    const admin = admins[0]!;
    const statuses: number[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      const { account, token } = await member(`race-grant-${round}`, 'sifu');
      const results = await Promise.all([
        v1(token, 'POST', '/plans/request-pilot-access', { planCode: 'pro_sifu' }),
        v1(admin.token, 'POST', '/admin/grants/create', { email: account.email, planCode: 'pro_sifu', reason: 'Demo race probe' }),
      ]);
      statuses.push(...results.map((result) => result.status));
      const [open] = await getDb()
        .select({ n: count() })
        .from(pilotAccessRequest)
        .where(and(eq(pilotAccessRequest.userId, account.id), eq(pilotAccessRequest.status, 'open')));
      expect(open?.n, `round ${round}: no open request beside the grant`).toBe(0);
    }
    // The request either came first (and the grant answered it) or saw the grant (409).
    expect(statuses.filter((status) => status >= 500)).toEqual([]);
  });
});
