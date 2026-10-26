// The review fixes of milestone M02 (fix round 1) through Better Auth's HTTP API: who owns an
// address (pre-registration takeover, H1), no account enumeration in the sign-up answer, sealed
// tokens in the outbox, limits that changing the client address cannot dodge, one use per TOTP
// code, a lock for wrong codes inside a session, backup codes, and refused profile fields.
//
// This file: pre-registration takeover, the sign-up answer, answer time, confirmation links and the
// outbox. The rest is in hardening-limits.int.test.ts and hardening-lockout.int.test.ts; the three
// files, each with its own throwaway database, run in parallel (their answer floors made one file
// the slowest of the integration tests).

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '../db';
import { authAccount } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { jobTemplateData } from '../jobs/outbox';
import type { EmailSendJob } from '../jobs/queues';
import { ANSWER_FLOORS } from './answer-floor';
import { ACCOUNT_EMAIL_HOURLY_CAPS } from './emails';
import { SIGN_IN_FAILURE_LIMIT } from './throttle';
import {
  address,
  ALL_TICKS,
  authFetch,
  createAccount,
  deliveryCount,
  outboxJob,
  signIn,
  signInWith,
  signUp,
  startAuthTestDatabase,
  stopAuthTestDatabase,
  TestBrowser,
  tokenFromOutbox,
  userId,
  userRow,
} from './test-support';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

describe('pre-registration takeover (H1)', () => {
  it('a second sign-up wipes the first password; only the mailbox owner can finish the account', async () => {
    const victim = address('victim');
    const attackerPassword = 'the attacker chose this one';
    const ownerPassword = 'the owner chose this one';

    // 1. The attacker signs up with the victim's address; a confirmation e-mail goes to the victim.
    const first = await signUp(victim, attackerPassword);
    expect(first.status).toBe(200);
    const attackerLink = await tokenFromOutbox('verify-email', victim);

    // 2. The victim signs up too: the same answer as for a new address...
    const second = await signUp(victim, 'the owner tried this first');
    expect(second.status).toBe(200);
    expect(second.data).toEqual(first.data);
    // ...the attacker's password is gone, and the victim gets a link to choose a password.
    const [credential] = await getDb()
      .select({ password: authAccount.password })
      .from(authAccount)
      .where(and(eq(authAccount.userId, await userId(victim)), eq(authAccount.providerId, 'credential')));
    expect(credential?.password).toBeNull();
    expect(await deliveryCount('finish-sign-up', victim)).toBe(1);

    // 3. The attacker's password no longer signs in, and the first confirmation link is dead.
    expect((await signInWith(victim, attackerPassword)).status).toBe(401);
    const stale = await authFetch(new TestBrowser(), '/verify-email', { method: 'GET', query: { token: attackerLink } });
    expect(stale.status).toBe(401);
    expect(stale.data?.code).toBe('INVALID_TOKEN');
    expect((await userRow(await userId(victim)))?.emailVerified).toBe(false);

    // 4. Asking for a new confirmation link sends the finish link again, never a bare confirmation.
    const verifyBefore = await deliveryCount('verify-email', victim);
    await authFetch(new TestBrowser(), '/send-verification-email', { body: { email: victim } });
    expect(await deliveryCount('verify-email', victim)).toBe(verifyBefore);
    expect(await deliveryCount('finish-sign-up', victim)).toBe(2);

    // 5. The owner follows the finish link: the password is theirs and the address is confirmed.
    const finish = await tokenFromOutbox('finish-sign-up', victim);
    const reset = await authFetch(new TestBrowser(), '/reset-password', { body: { token: finish, newPassword: ownerPassword } });
    expect(reset.status).toBe(200);
    expect((await userRow(await userId(victim)))?.emailVerified).toBe(true);
    expect((await signInWith(victim, ownerPassword)).status).toBe(200);
    expect((await signInWith(victim, attackerPassword)).status).toBe(401);
  });

  it('a second sign-up with the same password (a double tap) keeps the account and sends a fresh confirmation link', async () => {
    const email = address('double-tap');
    const password = 'the same password twice';
    expect((await signUp(email, password)).status).toBe(200);
    const firstLink = await tokenFromOutbox('verify-email', email);
    // A double tap within the same second makes the same link: it is not sent twice.
    expect((await signUp(email, password)).status).toBe(200);
    expect(await deliveryCount('finish-sign-up', email)).toBe(0);
    // Later (the first e-mail seemed slow), a new link goes out.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await signUp(email, password)).status).toBe(200);
    expect(await deliveryCount('verify-email', email)).toBeGreaterThanOrEqual(2);
    expect(await deliveryCount('finish-sign-up', email)).toBe(0);
    // Nothing was wiped: both links work, and the password signs in once the address is confirmed.
    const secondLink = await tokenFromOutbox('verify-email', email);
    expect(secondLink).not.toBe(firstLink);
    const confirm = await authFetch(new TestBrowser(), '/verify-email', { method: 'GET', query: { token: firstLink } });
    expect(confirm.status).toBe(200);
    expect((await userRow(await userId(email)))?.emailVerified).toBe(true);
    expect((await signInWith(email, password)).status).toBe(200);
  });

  it('a sign-up that Better Auth refuses tells nothing about the password and changes nothing', async () => {
    const email = address('oracle');
    const password = 'the password of whoever signed up';
    expect((await signUp(email, password)).status).toBe(200);
    const verifyBefore = await deliveryCount('verify-email', email);
    // Bodies the endpoint refuses before it looks at the address: no name field, a padded address.
    const refused = [
      (guess: string) => authFetch(new TestBrowser(), '/sign-up/email', { body: { email, password: guess, consents: ALL_TICKS } }),
      (guess: string) => signUp(` ${email}`, guess),
    ];
    for (const send of refused) {
      const right = await send(password);
      const wrong = await send('not the password at all');
      expect(right.status).toBe(400);
      expect({ status: wrong.status, data: wrong.data }).toEqual({ status: right.status, data: right.data });
    }
    // No confirmation link went out for the right guess, and no password was wiped for a wrong one.
    expect(await deliveryCount('verify-email', email)).toBe(verifyBefore);
    expect(await deliveryCount('finish-sign-up', email)).toBe(0);
    const [credential] = await getDb()
      .select({ password: authAccount.password })
      .from(authAccount)
      .where(and(eq(authAccount.userId, await userId(email)), eq(authAccount.providerId, 'credential')));
    expect(credential?.password).not.toBeNull();
  });

  it('a sign-up with the address of a confirmed account changes nothing and tells the owner', async () => {
    const owner = await createAccount({ label: 'confirmed-owner' });
    const result = await signUp(owner.email, 'someone else tried this');
    expect(result.status).toBe(200);
    expect(await deliveryCount('account-exists', owner.email)).toBe(1);
    expect((await signInWith(owner.email, owner.password)).status).toBe(200);
    expect((await signInWith(owner.email, 'someone else tried this')).status).toBe(401);
  });

  it('a password reset confirms the address (the link reached the mailbox)', async () => {
    const email = address('reset-confirms');
    await signUp(email, 'first password of this one');
    await authFetch(new TestBrowser(), '/request-password-reset', { body: { email } });
    const token = await tokenFromOutbox('reset-password', email);
    expect((await authFetch(new TestBrowser(), '/reset-password', { body: { token, newPassword: 'second password here' } })).status).toBe(200);
    expect((await userRow(await userId(email)))?.emailVerified).toBe(true);
  });
});

describe('sign-up answer (no account enumeration)', () => {
  it('is the same answer for a new address, an unconfirmed one (same or other password) and a confirmed one', async () => {
    const fresh = await signUp(address('fresh'), 'a long demo password');
    const unconfirmed = address('unconfirmed');
    await signUp(unconfirmed, 'a long demo password');
    const again = await signUp(unconfirmed, 'a long demo password');
    const other = await signUp(unconfirmed, 'another long demo password');
    const confirmed = await createAccount({ label: 'enumeration' });
    const existing = await signUp(confirmed.email, 'a long demo password');
    const shape = (response: Response) => ({
      contentType: response.headers.get('content-type'),
      cookies: response.headers.getSetCookie(),
      headers: [...response.headers.keys()].sort(),
    });
    for (const result of [fresh, again, other, existing]) {
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ token: null, user: null });
      expect(shape(result.response)).toEqual(shape(fresh.response));
    }
  });

  it('a sign-in with the password just chosen answers the same for a free, a pending and a taken address (fix round 3)', async () => {
    // Before, the free address answered 403 EMAIL_NOT_VERIFIED and a taken one 401: a sign-up
    // followed by a sign-in told whether an address had an account.
    const password = 'the prober chose this one';
    const pending = address('probe-pending');
    expect((await signUp(pending, 'someone signed up first with this')).status).toBe(200);
    const taken = await createAccount({ label: 'probe-taken' });
    const answers: Array<{ status: number; body: string; headers: string[] }> = [];
    for (const email of [address('probe-free'), pending, taken.email]) {
      expect((await signUp(email, password)).status).toBe(200);
      const result = await signInWith(email, password);
      answers.push({ status: result.status, body: await result.response.text(), headers: [...result.response.headers.keys()].sort() });
    }
    // Byte for byte Better Auth's answer to a wrong password.
    expect(answers[0]).toMatchObject({ status: 401, body: '{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}' });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it('so does the lock: ten such sign-ins lock a free address like a taken one, and confirming the address ends it', async () => {
    const password = 'the prober chose this one too';
    const free = address('lock-free');
    const taken = await createAccount({ label: 'lock-taken' });
    const burst = async (email: string) => {
      expect((await signUp(email, password)).status).toBe(200);
      const results = await Promise.all(Array.from({ length: SIGN_IN_FAILURE_LIMIT + 1 }, () => signInWith(email, password)));
      return results.map((result) => result.status).sort();
    };
    const statuses = await burst(free);
    expect(statuses).toEqual([...Array<number>(SIGN_IN_FAILURE_LIMIT).fill(401), 429]);
    expect(await burst(taken.email)).toEqual(statuses);
    // The owner of the free address opens the confirmation link: the lock ends, the password signs in.
    const token = await tokenFromOutbox('verify-email', free);
    expect((await authFetch(new TestBrowser(), '/verify-email', { method: 'GET', query: { token } })).status).toBe(200);
    expect((await signInWith(free, password)).status).toBe(200);
  });

  it('refuses a name and an image (names live in the profile; an account has no image)', async () => {
    const named = await signUp(address('named'), 'a long demo password', { name: 'Demo Name' });
    expect(named.status).toBe(400);
    expect(named.data?.code).toBe('NAME_NOT_ACCEPTED');
    const pictured = await signUp(address('pictured'), 'a long demo password', { image: 'javascript:alert(1)' });
    expect(pictured.status).toBe(400);
    expect(pictured.data?.code).toBe('IMAGE_NOT_ACCEPTED');
    // And /update-user is not served at all.
    const account = await createAccount({ label: 'update-user' });
    const { browser } = await signIn(account);
    expect((await authFetch(browser, '/update-user', { body: { image: 'javascript:alert(1)' } })).status).toBe(404);
  });
});

describe('answer time (fix round 3, security-2)', () => {
  it('a sign-up, a reset request and a refused sign-in take at least their floor, for a free and a taken address', async () => {
    const taken = await createAccount({ label: 'floor-taken' });
    const timed = async (run: () => Promise<{ status: number }>) => {
      const startedAt = performance.now();
      const { status } = await run();
      return { status, ms: performance.now() - startedAt };
    };
    // setTimeout may fire a millisecond before performance.now() says the time is up.
    const atLeast = (path: string) => ANSWER_FLOORS[path]!.ms - 2;
    for (const email of [address('floor-free'), taken.email]) {
      const signUpTime = await timed(() => signUp(email, 'a long demo password'));
      expect(signUpTime.status).toBe(200);
      expect(signUpTime.ms).toBeGreaterThanOrEqual(atLeast('/sign-up/email'));
      const resetTime = await timed(() => authFetch(new TestBrowser(), '/request-password-reset', { body: { email } }));
      expect(resetTime.status).toBe(200);
      expect(resetTime.ms).toBeGreaterThanOrEqual(atLeast('/request-password-reset'));
      const signInTime = await timed(() => signInWith(email, 'not the password of anyone'));
      expect(signInTime.status).toBe(401);
      expect(signInTime.ms).toBeGreaterThanOrEqual(atLeast('/sign-in/email'));
    }
  });
});

describe('confirmation links (fix round 3, code-2)', () => {
  const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  /** A token anyone can make: Better Auth's claims with a signature that is not the app's. */
  const forged = (email: string) => [base64url({ alg: 'HS256', typ: 'JWT' }), base64url({ email, iat: 0 }), 'bm90LXRoZS1zaWduYXR1cmU'].join('.');
  async function answer(token: string, callbackURL?: string) {
    const result = await authFetch(new TestBrowser(), '/verify-email', { method: 'GET', query: { token, ...(callbackURL ? { callbackURL } : {}) } });
    return { status: result.status, body: await result.response.text(), location: result.response.headers.get('location') };
  }

  it('a forged token gets the same answer for a pending, a confirmed and an unknown address, with or without callbackURL', async () => {
    // Before, the before hook read the unchecked claims and answered a pending account with a
    // message of its own: a probe without side effects for pending sign-ups.
    const pending = address('forged-pending');
    expect((await signUp(pending, 'a long demo password')).status).toBe(200);
    const confirmed = await createAccount({ label: 'forged-confirmed' });
    const unknown = await answer(forged(address('forged-nobody')));
    expect(unknown).toEqual({ status: 401, body: '{"message":"Invalid token","code":"INVALID_TOKEN"}', location: null });
    expect(await answer(forged(pending))).toEqual(unknown);
    expect(await answer(forged(confirmed.email))).toEqual(unknown);
    const redirected = await answer(forged(address('forged-nobody')), '/sign-in');
    expect(redirected).toMatchObject({ status: 302, location: '/sign-in?error=INVALID_TOKEN' });
    expect(await answer(forged(pending), '/sign-in')).toEqual(redirected);
    expect((await userRow(await userId(pending)))?.emailVerified).toBe(false);
  });

  it('a genuine link from before the password changed gets Better Auth\'s answer to a bad token too', async () => {
    const email = address('stale-link');
    expect((await signUp(email, 'the first password of it')).status).toBe(200);
    const stale = await tokenFromOutbox('verify-email', email);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // updated_at a second after the link's iat
    expect((await signUp(email, 'another password, so it is wiped')).status).toBe(200);
    const unknown = await answer(forged(address('stale-nobody')));
    expect(await answer(stale)).toEqual(unknown);
    expect(await answer(stale, '/sign-in?from=mail')).toEqual({ status: 302, body: '', location: '/sign-in?from=mail&error=INVALID_TOKEN' });
    expect((await userRow(await userId(email)))?.emailVerified).toBe(false);
  });
});

describe('outbox', () => {
  it('stores the links of account e-mails sealed: the job never holds the token in clear', async () => {
    const email = address('sealed');
    await signUp(email, 'a long demo password');
    const job = await outboxJob('verify-email', email);
    expect(job?.sealed).toMatch(/^v1\./);
    expect(job?.data).not.toHaveProperty('url');
    const token = await tokenFromOutbox('verify-email', email);
    const raw = await getDb().execute<{ data: string }>(sql`SELECT data::text AS data FROM pgboss.job WHERE data ->> 'deliveryId' = ${job!.deliveryId}`);
    expect(raw.rows.length).toBeGreaterThan(0);
    for (const row of raw.rows) expect(row.data).not.toContain(token);
  });

  const resetCap = ACCOUNT_EMAIL_HOURLY_CAPS['reset-password'];

  it(`sends at most ${resetCap} reset e-mails an hour to one address, whatever the client address; the first link still works`, async () => {
    const account = await createAccount({ label: 'mail-cap' });
    for (let i = 0; i < resetCap + 3; i += 1) {
      // A new browser (client address) each time: the per-address limit of the endpoint never applies.
      const result = await authFetch(new TestBrowser(), '/request-password-reset', { body: { email: account.email } });
      expect(result.status).toBe(200);
    }
    expect(await deliveryCount('reset-password', account.email)).toBe(resetCap);
    // Whoever spent the budget, the mailbox holds links that work: the oldest one too.
    const rows = await getDb().execute<{ data: EmailSendJob }>(sql`
      SELECT j.data FROM pgboss.job j JOIN email_delivery d ON d.id::text = j.data ->> 'deliveryId'
       WHERE j.name = 'email.send' AND d.template = 'reset-password' AND d.to_email = ${account.email}
       ORDER BY d.created_at ASC LIMIT 1`);
    const oldest = new URL((jobTemplateData(rows.rows[0]!.data) as { url: string }).url).searchParams.get('token')!;
    expect((await authFetch(new TestBrowser(), '/reset-password', { body: { token: oldest, newPassword: 'the oldest link worked' } })).status).toBe(200);
  });

  it('counts the budget in one step: a parallel burst of requests sends no more than the budget', async () => {
    const account = await createAccount({ label: 'mail-cap-burst' });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => authFetch(new TestBrowser(), '/request-password-reset', { body: { email: account.email } })),
    );
    for (const result of results) expect(result.status).toBe(200);
    expect(await deliveryCount('reset-password', account.email)).toBe(resetCap);
  });
});
