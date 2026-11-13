// Account suspension (review 2026-11; docs/adr/0030-takedown-suspension-erasure.md), against a
// migrated throwaway database with real sessions: a live cookie or bearer session is refused on every
// path the moment the account is suspended, a session created in that moment is refused too, the
// account cannot sign in, a lifted suspension works again, nobody suspends their own account or the
// last active administrator, the account gets no e-mail or notice, and the audit rows carry no address.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, authSession, authUser, emailDelivery, notification } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { handleApiRequest } from '../rpc/handler';
import { notify } from '../services/notify';
import { listSuspended, suspendAccount, unsuspendAccount } from '../services/suspension';
import { sendPasswordResetEmail } from './emails';
import { accountSuspended } from './suspension';
import { principalFromHeaders } from './session';
import { signedSessionToken } from './credentials';
import { authFetch, createAccount, sessionCount, signIn, startAuthTestDatabase, stopAuthTestDatabase, TEST_APP_URL, TestBrowser } from './test-support';

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});
afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

const META = { requestId: 'suspension-int-test', ipHmac: null };
const REASON = 'Fictional abuse report that staff confirmed.';

const cookieHeaders = (browser: TestBrowser) => new Headers({ cookie: browser.cookieHeader() });
const bearerHeaders = (token: string) => new Headers({ authorization: `Bearer ${token}` });

function rpc(path: string, headers: Headers, body?: unknown) {
  const h = new Headers(headers);
  if (body !== undefined) h.set('content-type', 'application/json');
  return handleApiRequest(new Request(`${TEST_APP_URL}/api/rpc${path}`, { method: 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify({ json: body }) }), 'rpc');
}

/** An administrator with a verified second factor, as the service sees it, with a real account row. */
async function admin(label: string) {
  const account = await createAccount({ role: 'admin', label });
  const { browser, token } = await signIn(account);
  const principal = (await principalFromHeaders(bearerHeaders(token)))!;
  return { account, browser, token, principal };
}

const standing = async (userId: string) => (await getDb().select({ banned: authUser.banned, reason: authUser.banReason, expires: authUser.banExpires }).from(authUser).where(eq(authUser.id, userId)))[0]!;

describe('accountSuspended', () => {
  it('is a flag with an optional end', () => {
    const now = new Date('2026-11-13T12:00:00Z');
    expect(accountSuspended({ banned: false }, now)).toBe(false);
    expect(accountSuspended({ banned: true, banExpires: null }, now)).toBe(true);
    expect(accountSuspended({ banned: true, banExpires: new Date('2026-11-14T00:00:00Z') }, now)).toBe(true);
    expect(accountSuspended({ banned: true, banExpires: new Date('2026-11-12T00:00:00Z') }, now)).toBe(false);
    expect(accountSuspended({ banned: true, banExpires: 'not a date' }, now)).toBe(true);
  });
});

describe('a suspended account', () => {
  it('loses its live sessions at once and is refused on every path, then signs in again when it is lifted', async () => {
    const boss = await admin('suspend-boss');
    const victim = await createAccount({ label: 'suspend-victim' });
    const { browser, token } = await signIn(victim);
    await signIn(victim); // a second session, on another device
    expect(await sessionCount(victim.id)).toBe(2);
    // Before: the cookie and the bearer token are the account's, on a procedure and on Better Auth.
    expect((await principalFromHeaders(cookieHeaders(browser)))?.user.id).toBe(victim.id);
    expect((await principalFromHeaders(bearerHeaders(token)))?.user.id).toBe(victim.id);
    expect((await rpc('/account/me', bearerHeaders(token))).status).toBe(200);
    expect((await authFetch(browser, '/get-session', { method: 'GET' })).data?.user).toBeTruthy();

    const result = await suspendAccount(boss.principal, { email: victim.email, reason: REASON }, META);
    expect(result).toEqual({ userId: victim.id, suspended: true, until: null, sessionsEnded: 2 });
    expect(await sessionCount(victim.id)).toBe(0);
    expect(await standing(victim.id)).toMatchObject({ banned: true, reason: REASON, expires: null });

    // The same cookie and token, after: no principal, a 401 on a procedure, no session on Better Auth.
    expect(await principalFromHeaders(cookieHeaders(browser))).toBeNull();
    expect(await principalFromHeaders(bearerHeaders(token))).toBeNull();
    expect((await rpc('/account/me', bearerHeaders(token))).status).toBe(401);
    expect((await authFetch(browser, '/get-session', { method: 'GET' })).data).toBeNull();

    // Sign-in is refused, with the suspension's own words.
    const signInAgain = await authFetch(new TestBrowser(), '/sign-in/email', { body: { email: victim.email, password: victim.password } });
    expect(signInAgain.status).toBe(403);
    expect(signInAgain.data).toMatchObject({ code: 'BANNED_USER' });
    expect(await sessionCount(victim.id)).toBe(0);

    // Lifting it: sign-in works again; the old sessions stay ended.
    const lifted = await unsuspendAccount(boss.principal, { email: victim.email, reason: 'The report was withdrawn.' }, META);
    expect(lifted).toMatchObject({ userId: victim.id, suspended: false });
    expect(await standing(victim.id)).toMatchObject({ banned: false, reason: null, expires: null });
    expect(await principalFromHeaders(bearerHeaders(token))).toBeNull();
    const back = await signIn(victim);
    expect((await principalFromHeaders(bearerHeaders(back.token)))?.user.id).toBe(victim.id);
  });

  it('is refused even when a session exists: one created in the moment of the suspension, on every path', async () => {
    const boss = await admin('race-boss');
    const victim = await createAccount({ label: 'race-victim' });
    const { browser } = await signIn(victim);
    await suspendAccount(boss.principal, { userId: victim.id, reason: REASON }, META);
    // A session row that appears after the suspension (the race of a sign-in that had passed its check).
    const raw = 'raced-session-token-' + uuidv7();
    await getDb().insert(authSession).values({ id: uuidv7(), userId: victim.id, token: raw, expiresAt: new Date(Date.now() + 3_600_000) });
    const signed = await signedSessionToken(raw, process.env.BETTER_AUTH_SECRET!);
    expect(await principalFromHeaders(bearerHeaders(signed))).toBeNull();
    expect(await principalFromHeaders(new Headers({ cookie: `wcr.session_token=${encodeURIComponent(signed)}` }))).toBeNull();
    expect((await rpc('/account/me', bearerHeaders(signed))).status).toBe(401);
    // Better Auth's own endpoints refuse the live session too, except signing out.
    const raced = new TestBrowser();
    raced.cookies.set('wcr.session_token', signed);
    const list = await authFetch(raced, '/list-sessions', { method: 'GET' });
    expect(list.status).toBe(403);
    expect(list.data).toMatchObject({ code: 'BANNED_USER' });
    expect((await authFetch(raced, '/get-session', { method: 'GET' })).status).toBe(403);
    expect((await authFetch(raced, '/sign-out')).status).toBe(200);
    expect(await sessionCount(victim.id)).toBe(0);
    void browser;
  });

  it('a ban set any other way ends the sessions too (the trigger), and a ban that has ended is no ban', async () => {
    const victim = await createAccount({ label: 'trigger-victim' });
    const { token } = await signIn(victim);
    expect(await sessionCount(victim.id)).toBe(1);
    await getDb().update(authUser).set({ banned: true, banReason: 'set by hand' }).where(eq(authUser.id, victim.id));
    expect(await sessionCount(victim.id)).toBe(0);
    expect(await principalFromHeaders(bearerHeaders(token))).toBeNull();
    // An end date in the past: the flag is stale, the account is not suspended.
    await getDb().update(authUser).set({ banExpires: new Date(Date.now() - 1000) }).where(eq(authUser.id, victim.id));
    const again = await signIn(victim).catch(() => null);
    expect(again?.token).toBeTruthy();
    expect(accountSuspended(await standing(victim.id))).toBe(false);
  });

  it('gets no e-mail and no notice while it is suspended', async () => {
    const boss = await admin('quiet-boss');
    const victim = await createAccount({ label: 'quiet-victim' });
    await suspendAccount(boss.principal, { email: victim.email, reason: REASON }, META);
    await getDb().transaction((tx) => notify(tx, victim.id, 'security.password-changed', {}));
    expect(await getDb().select().from(notification).where(eq(notification.userId, victim.id))).toHaveLength(0);
    await sendPasswordResetEmail({ id: victim.id, email: victim.email, emailVerified: true }, 'a-token-for-the-test');
    expect(await getDb().select().from(emailDelivery).where(eq(emailDelivery.userId, victim.id))).toHaveLength(0);
    // The suspension itself sent nothing either.
    expect(await getDb().select().from(emailDelivery).where(eq(emailDelivery.toEmail, victim.email))).toHaveLength(0);
    // Lifted, the account gets its mail again.
    await unsuspendAccount(boss.principal, { email: victim.email, reason: 'Resolved.' }, META);
    await getDb().transaction((tx) => notify(tx, victim.id, 'security.password-changed', {}));
    expect(await getDb().select().from(notification).where(eq(notification.userId, victim.id))).toHaveLength(1);
  });

  it('can be suspended until a date, and a date in the past is refused', async () => {
    const boss = await admin('until-boss');
    const victim = await createAccount({ label: 'until-victim' });
    const past = new Date(Date.now() - 60_000).toISOString();
    await expect(suspendAccount(boss.principal, { email: victim.email, reason: REASON, until: past }, META)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { until: expect.any(String) } });
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const result = await suspendAccount(boss.principal, { email: victim.email, reason: REASON, until }, META);
    expect(result.until).toBe(until);
    expect((await listSuspended(boss.principal)).accounts.find((a) => a.id === victim.id)).toMatchObject({ email: victim.email, reason: REASON, until });
    // Ended by itself: no longer listed and not suspended.
    await getDb().update(authUser).set({ banExpires: new Date(Date.now() - 1000) }).where(eq(authUser.id, victim.id));
    expect((await listSuspended(boss.principal)).accounts.find((a) => a.id === victim.id)).toBeUndefined();
  });
});

describe('who may suspend whom', () => {
  it('is for an administrator with a verified second factor, with a reason, for an account that exists', async () => {
    const boss = await admin('who-boss');
    const victim = await createAccount({ label: 'who-victim' });
    const moderator = await createAccount({ role: 'moderator', label: 'who-mod' });
    const mod = await signIn(moderator);
    const modPrincipal = (await principalFromHeaders(bearerHeaders(mod.token)))!;
    const member = await createAccount({ label: 'who-member' });
    const memberPrincipal = (await principalFromHeaders(bearerHeaders((await signIn(member)).token)))!;
    const input = { email: victim.email, reason: REASON };
    await expect(suspendAccount(null, input, META)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(suspendAccount(memberPrincipal, input, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(suspendAccount(modPrincipal, input, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(suspendAccount({ ...boss.principal, session: { ...boss.principal.session, twoFactorVerifiedAt: null } }, input, META)).rejects.toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });
    await expect(suspendAccount(boss.principal, { email: victim.email, reason: ' ' }, META)).rejects.toMatchObject({ code: 'BAD_REQUEST', fields: { reason: expect.any(String) } });
    await expect(suspendAccount(boss.principal, { reason: REASON }, META)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(suspendAccount(boss.principal, { email: 'demo-nobody@example.test', reason: REASON }, META)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await standing(victim.id)).banned).toBe(false);
    // Twice is a conflict; lifting what is not suspended too.
    await suspendAccount(boss.principal, input, META);
    await expect(suspendAccount(boss.principal, input, META)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(unsuspendAccount(boss.principal, { email: member.email, reason: 'Resolved.' }, META)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(unsuspendAccount(modPrincipal, { email: victim.email, reason: 'Resolved.' }, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(unsuspendAccount(boss.principal, { email: victim.email, reason: '' }, META)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('never your own account, never the last active administrator', async () => {
    const first = await admin('last-first');
    const second = await admin('last-second');
    await expect(suspendAccount(first.principal, { userId: first.account.id, reason: REASON }, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Every other administrator of this database: a throwaway one has these two and the seeded none.
    const others = await getDb().select({ id: authUser.id }).from(authUser).where(and(eq(authUser.role, 'admin'), sql`${authUser.id} NOT IN (${first.account.id}, ${second.account.id})`));
    // Suspend the others (by the first), so that two administrators remain.
    for (const other of others) await suspendAccount(first.principal, { userId: other.id, reason: REASON }, META);
    // First suspends second: the first is then the last active administrator, and nobody can suspend it.
    await suspendAccount(first.principal, { userId: second.account.id, reason: REASON }, META);
    await expect(suspendAccount(second.principal, { userId: first.account.id, reason: REASON }, META)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await standing(first.account.id)).banned).toBe(false);
    // And the last one cannot be reached by a suspended or demoted administrator's stale request either.
    await unsuspendAccount(first.principal, { userId: second.account.id, reason: 'Resolved.' }, META);
    // Two administrators suspending each other at the same moment: exactly one of them succeeds.
    const settled = await Promise.allSettled([
      suspendAccount(first.principal, { userId: second.account.id, reason: REASON }, META),
      suspendAccount(second.principal, { userId: first.account.id, reason: REASON }, META),
    ]);
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
    const active = await getDb().select({ id: authUser.id, banned: authUser.banned }).from(authUser).where(inArray(authUser.id, [first.account.id, second.account.id]));
    expect(active.filter((a) => !a.banned)).toHaveLength(1);
  });

  it('is audited with ids and shapes, never an address; an erased account cannot be suspended or lifted', async () => {
    const boss = await admin('audit-boss');
    const victim = await createAccount({ label: 'audit-victim' });
    await suspendAccount(boss.principal, { email: victim.email, reason: REASON }, META);
    await unsuspendAccount(boss.principal, { email: victim.email, reason: 'Resolved.' }, META);
    const rows = await getDb().select().from(auditLog).where(and(eq(auditLog.subjectId, victim.id), inArray(auditLog.action, ['account.suspend', 'account.unsuspend'])));
    expect(rows.map((r) => r.action).sort()).toEqual(['account.suspend', 'account.unsuspend']);
    for (const row of rows) {
      expect(row).toMatchObject({ actorUserId: boss.account.id, actorRole: 'admin', subjectType: 'user' });
      expect(JSON.stringify([row.before, row.after])).not.toContain('@');
    }
    expect(rows.find((r) => r.action === 'account.suspend')).toMatchObject({ reason: REASON, after: { suspended: true, until: null, sessionsEnded: 0, role: 'user' } });
    const erased = await createAccount({ label: 'audit-erased' });
    await getDb().update(authUser).set({ email: `erased-${erased.id}@erased.invalid`, banned: true, banReason: 'Account erased' }).where(eq(authUser.id, erased.id));
    await expect(unsuspendAccount(boss.principal, { userId: erased.id, reason: 'Please.' }, META)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(suspendAccount(boss.principal, { userId: erased.id, reason: REASON }, META)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await listSuspended(boss.principal)).accounts.find((a) => a.id === erased.id)).toBeUndefined();
  });
});
