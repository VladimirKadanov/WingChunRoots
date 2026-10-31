// Teacher requests through the API (milestone M09, Done when; plan §6.8): a request and its
// approval through /api/v1 with `Authorization: Bearer` (the future native app) give the same result
// and the same audit rows as the web form, whose Server Actions call the same procedures in-process
// (serverClient, src/server/rpc/parity.ts). /api/rpc with the session cookie, as the browser calls
// it, is checked too. The refusals keep their codes over HTTP: 404 for a stranger, 403 for the
// student, 403 ENTITLEMENT_REQUIRED with the refusal in `data.entitlement` at the plan's limit.

import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAccount, signIn, startAuthTestDatabase, stopAuthTestDatabase, TEST_APP_URL } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, authUser, person, personName, relationshipEvent } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { handleApiRequest } from '../rpc/handler';
import { serverClient } from '../rpc/server';
import { key, newLineage, principalOf } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
let lineageId: string;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  lineageId = await newLineage('m09-api');
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
  return { status: response.status, data: (text ? JSON.parse(text) : null) as Json };
}

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

/** A member signed in for real (a bearer session), with a public person; a Sifu when `sifu`. */
async function signedInMember(label: string, sifu = false) {
  const account = await createAccount({ label });
  const { token } = await signIn(account);
  const db = getDb();
  if (sifu) await db.update(authUser).set({ accountType: 'sifu' }).where(eq(authUser.id, account.id));
  const [created] = await db
    .insert(person)
    .values({ slug: `demo-${label}-${account.id.slice(-6)}`, kind: 'living', stewardship: 'self', claimedByUserId: account.id, visibility: 'public' })
    .returning({ id: person.id });
  await db.insert(personName).values({ personId: created!.id, value: `Demo ${label}`, script: 'Latn', lang: 'en', isPrimary: true });
  return { account, token, personId: created!.id, principal: principalOf(account) };
}

/** What a flow leaves behind, without ids and times: the statuses and the audit actions with their shapes. */
async function trail(relationshipId: string) {
  const events = await getDb()
    .select({ from: relationshipEvent.fromStatus, to: relationshipEvent.toStatus, role: relationshipEvent.actorRole })
    .from(relationshipEvent)
    .where(eq(relationshipEvent.relationshipId, relationshipId))
    .orderBy(asc(relationshipEvent.createdAt), asc(relationshipEvent.id));
  const audits = await getDb()
    .select({ action: auditLog.action, before: auditLog.before, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.subjectType, 'teaching_relationship'), eq(auditLog.subjectId, relationshipId)))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
  const shape = (value: unknown) => (value && typeof value === 'object' ? Object.keys(value).sort() : value);
  return {
    events,
    audits: audits.map((a) => ({
      action: a.action,
      before: shape(a.before),
      after: shape(a.after),
      status: (a.after as { status?: string } | null)?.status ?? null,
      visibility: (a.after as { visibility?: string } | null)?.visibility ?? null,
    })),
  };
}

const periods = [{ from: '2019-04', to: null, ongoing: true }];

describe('relationships over /api/v1 with a bearer session and through the web form', () => {
  it('request and approve: the same result and the same audit through /api/v1 (bearer) as through the web form (in-process) and /api/rpc (cookie)', async () => {
    // The native app: /api/v1 with Authorization: Bearer.
    const t1 = await signedInMember('m09-api-teacher', true);
    const s1 = await signedInMember('m09-api-student');
    const requested = await v1(s1.token, 'POST', '/relationships/request', { teacherId: t1.personId, lineageId, periods, idempotencyKey: key() });
    expect(requested.status).toBe(200);
    const apiId = (requested.data.relationship as { id: string }).id;
    expect(requested.data).toMatchObject({ replayed: false, relationship: { status: 'pending_teacher', visibility: 'involved_only', viewerRole: 'student' } });
    const approved = await v1(t1.token, 'POST', '/relationships/approve', { relationshipId: apiId, idempotencyKey: key() });
    expect(approved.status).toBe(200);
    expect(approved.data).toMatchObject({ replayed: false, relationship: { status: 'verified', visibility: 'public', viewerRole: 'teacher' } });

    // The web form: its Server Actions call the same procedures in-process (serverClient).
    const t2 = await signedInMember('m09-form-teacher', true);
    const s2 = await signedInMember('m09-form-student');
    const formRequest = await serverClient(new Headers(), s2.principal).relationships.request({ teacherId: t2.personId, lineageId, periods, displayPrimary: false, idempotencyKey: key() });
    const formApprove = await serverClient(new Headers(), t2.principal).relationships.approve({ relationshipId: formRequest.relationship.id, idempotencyKey: key() });
    expect(formApprove.relationship).toMatchObject({ status: 'verified', visibility: 'public' });

    // The browser's own calls: /api/rpc with the session cookie.
    const t3 = await signedInMember('m09-rpc-teacher', true);
    const s3 = await signedInMember('m09-rpc-student');
    const rpcRequest = await rpcWithCookie(s3.token, '/relationships/request', { teacherId: t3.personId, lineageId, periods, idempotencyKey: key() });
    expect(rpcRequest.status).toBe(200);
    const rpcId = (rpcRequest.data.relationship as { id: string }).id;
    expect((await rpcWithCookie(t3.token, '/relationships/approve', { relationshipId: rpcId, idempotencyKey: key() })).status).toBe(200);

    const [api, form, rpc] = [await trail(apiId), await trail(formRequest.relationship.id), await trail(rpcId)];
    expect(api.events).toEqual([
      { from: null, to: 'pending_teacher', role: 'student' },
      { from: 'pending_teacher', to: 'verified', role: 'teacher' },
    ]);
    expect(api.audits.map((a) => [a.action, a.status, a.visibility])).toEqual([
      ['relationship.request', 'pending_teacher', 'involved_only'],
      ['relationship.approve', 'verified', 'public'],
    ]);
    expect(form).toEqual(api);
    expect(rpc).toEqual(api);

    // The read over the API: the student and the teacher see it, a stranger gets 404.
    const stranger = await signedInMember('m09-api-stranger');
    expect((await v1(s1.token, 'GET', `/relationships/${apiId}`)).status).toBe(200);
    expect((await v1(t1.token, 'GET', `/relationships/${apiId}`)).status).toBe(200);
    expect((await v1(stranger.token, 'GET', `/relationships/${apiId}`)).status).toBe(404);
    expect((await v1(null, 'GET', `/relationships/${apiId}`)).status).toBe(401);
    const mine = await v1(s1.token, 'GET', '/relationships/mine');
    expect(mine.status).toBe(200);
    expect((mine.data.teachers as { id: string }[]).map((t) => t.id)).toEqual([apiId]);
  });

  it('the refusals keep their codes over HTTP, and a refusal changes nothing', async () => {
    const teacher = await signedInMember('m09-api-refusals-teacher', true);
    const student = await signedInMember('m09-api-refusals-student');
    const stranger = await signedInMember('m09-api-refusals-stranger', true);
    const requested = await v1(student.token, 'POST', '/relationships/request', { teacherId: teacher.personId, lineageId, periods, idempotencyKey: key() });
    const id = (requested.data.relationship as { id: string }).id;
    expect((await v1(stranger.token, 'POST', '/relationships/approve', { relationshipId: id, idempotencyKey: key() })).status).toBe(404);
    expect((await v1(student.token, 'POST', '/relationships/approve', { relationshipId: id, idempotencyKey: key() })).status).toBe(403);
    expect((await v1(null, 'POST', '/relationships/approve', { relationshipId: id, idempotencyKey: key() })).status).toBe(401);
    const bad = await v1(student.token, 'POST', '/relationships/request', { teacherId: teacher.personId, lineageId, periods: [{ from: 'soon', ongoing: true }], idempotencyKey: key() });
    expect(bad.status).toBe(400);
    expect((bad.data.data as { fields: Record<string, string> }).fields['periods.0.from']).toMatch(/year/);
    expect((await trail(id)).events).toHaveLength(1);
  });

  it('at the Free Sifu limit the approval answers 403 ENTITLEMENT_REQUIRED with the refusal for the upgrade prompt', async () => {
    const teacher = await signedInMember('m09-api-limit-teacher', true);
    for (let i = 0; i < 5; i++) {
      const s = await signedInMember(`m09-api-limit-${i}`);
      const r = await v1(s.token, 'POST', '/relationships/request', { teacherId: teacher.personId, lineageId, periods, idempotencyKey: key() });
      expect((await v1(teacher.token, 'POST', '/relationships/approve', { relationshipId: (r.data.relationship as { id: string }).id, idempotencyKey: key() })).status).toBe(200);
    }
    const sixth = await signedInMember('m09-api-limit-sixth');
    const r = await v1(sixth.token, 'POST', '/relationships/request', { teacherId: teacher.personId, lineageId, periods, idempotencyKey: key() });
    const refused = await v1(teacher.token, 'POST', '/relationships/approve', { relationshipId: (r.data.relationship as { id: string }).id, idempotencyKey: key() });
    expect(refused.status).toBe(403);
    expect(refused.data).toMatchObject({
      code: 'ENTITLEMENT_REQUIRED',
      data: { entitlement: { ok: false, code: 'quota', plan: 'free_sifu', limit: 5, current: 5, grantedBy: 'pro_sifu' } },
    });
    const queue = await v1(teacher.token, 'GET', '/relationships/incoming');
    expect(queue.data).toMatchObject({ allowance: { approved: 5, limit: 5 }, upgrade: { feature: 'approve_students' } });
    expect((queue.data.requests as { status: string }[]).map((x) => x.status)).toEqual(['pending_teacher']);
  });
});
