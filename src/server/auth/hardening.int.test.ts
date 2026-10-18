// The review fixes of milestone M02 (fix round 1) through Better Auth's HTTP API: who owns an
// address (pre-registration takeover, H1), no account enumeration in the sign-up answer, sealed
// tokens in the outbox, limits that changing the client address cannot dodge, one use per TOTP
// code, a lock for wrong codes inside a session, backup codes, and refused profile fields.

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getDb } from '../db';
import { withClient } from '../db/admin';
import { authAccount, authSession, authTwoFactor, authUser, emailDelivery } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { jobTemplateData } from '../jobs/outbox';
import type { EmailSendJob } from '../jobs/queues';
import { ANSWER_FLOORS } from './answer-floor';
import { generateBackupCodes } from './credentials';
import { ACCOUNT_EMAIL_HOURLY_CAPS } from './emails';
import { handleAuthRequest } from './route';
import { SIGN_IN_FAILURE_LIMIT, signInKey } from './throttle';
import {
  authFetch,
  createAccount,
  deliveryCount,
  outboxJob,
  signIn,
  startAuthTestDatabase,
  stopAuthTestDatabase,
  TEST_APP_URL,
  TestBrowser,
  tokenFromOutbox,
  totpCode,
  userRow,
  verifyTotpOnce,
} from './test-support';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

const ALL_TICKS = { terms: true, privacy_ack: true, authenticity_declaration: true, age_18_plus: true };
let n = 0;
const address = (label: string) => `demo-hardening-${label}-${++n}@example.test`;

function signUp(email: string, password: string, extra: Record<string, unknown> = {}) {
  return authFetch(new TestBrowser(), '/sign-up/email', { body: { name: '', email, password, consents: ALL_TICKS, ...extra } });
}

function signInWith(email: string, password: string, browser = new TestBrowser()) {
  return authFetch(browser, '/sign-in/email', { body: { email, password } });
}

async function userId(email: string): Promise<string> {
  const [row] = await getDb().select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return row.id;
}

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

/** POST through the route handler of /api/auth, with the X-Forwarded-For a client chooses. */
async function viaRoute(path: string, body: unknown, forwardedFor: string) {
  const response = await handleAuthRequest(
    new Request(new URL(`/api/auth${path}`, TEST_APP_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_APP_URL, 'x-forwarded-for': forwardedFor },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, data: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

describe('limits that a changed client address cannot dodge', () => {
  it('a forged X-Forwarded-For chain gives no fresh address: the requests share one limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      // Without TRUSTED_PROXIES only a single-entry header is believed; a chain resolves to no address.
      const result = await viaRoute('/sign-in/email', { email: address('chain'), password: 'wrong password 1' }, `203.0.113.${i + 1}, 198.51.100.200`);
      statuses.push(result.status);
    }
    expect(statuses).toContain(429);
  });

  it(`locks an address after ${SIGN_IN_FAILURE_LIMIT} failed sign-ins from any number of client addresses`, async () => {
    const account = await createAccount({ label: 'sign-in-lock' });
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) {
      expect((await signInWith(account.email, `wrong password ${i}`)).status).toBe(401);
    }
    // The right password from yet another address is refused too, until the lock ends.
    const locked = await signInWith(account.email, account.password);
    expect(locked.status).toBe(429);
    expect(locked.data?.code).toBe('TOO_MANY_ATTEMPTS');
    // An unknown address locks the same way: the lock says nothing about whether an account exists.
    const unknown = address('unknown');
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) expect((await signInWith(unknown, `wrong ${i}`)).status).toBe(401);
    expect((await signInWith(unknown, 'wrong again')).status).toBe(429);
    // A password reset (the mailbox owner) clears the lock.
    await authFetch(new TestBrowser(), '/request-password-reset', { body: { email: account.email } });
    const token = await tokenFromOutbox('reset-password', account.email);
    await authFetch(new TestBrowser(), '/reset-password', { body: { token, newPassword: 'a new long password' } });
    expect((await signInWith(account.email, 'a new long password')).status).toBe(200);
  });

  it(`a parallel burst from many client addresses gets at most ${SIGN_IN_FAILURE_LIMIT} password checks`, async () => {
    const account = await createAccount({ label: 'sign-in-burst' });
    const burst = 50;
    const results = await Promise.all(
      Array.from({ length: burst }, (_, i) =>
        viaRoute('/sign-in/email', { email: account.email, password: `wrong burst password ${i}` }, `192.0.2.${i + 1}`),
      ),
    );
    const tally = (status: number, code: string) => results.filter((r) => r.status === status && r.data?.code === code).length;
    expect(tally(401, 'INVALID_EMAIL_OR_PASSWORD')).toBeLessThanOrEqual(SIGN_IN_FAILURE_LIMIT);
    expect(tally(401, 'INVALID_EMAIL_OR_PASSWORD') + tally(429, 'TOO_MANY_ATTEMPTS')).toBe(burst);
    // The lock holds for the right password afterwards too.
    expect((await signInWith(account.email, account.password)).status).toBe(429);
  });

  it('a right password clears the failures counted so far', async () => {
    const account = await createAccount({ label: 'sign-in-clear' });
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT - 1; i += 1) await signInWith(account.email, `wrong ${i}`);
    expect((await signInWith(account.email, account.password)).status).toBe(200);
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT - 1; i += 1) await signInWith(account.email, `wrong ${i}`);
    expect((await signInWith(account.email, account.password)).status).toBe(200);
  });
});

/** The live count of a throttle key (0 when absent or expired). */
async function throttleCount(key: string): Promise<number> {
  const rows = await getDb().execute<{ count: number }>(sql`SELECT count FROM auth_throttle WHERE key = ${key} AND expires_at > now()`);
  return rows.rows[0]?.count ?? 0;
}

describe('a reservation whose request fails unexpectedly', () => {
  it('is given back: errors that checked no password never lock an address', async () => {
    const account = await createAccount({ label: 'unexpected-error' });
    const { getAuth } = await import('./config');
    const context = await getAuth().$context;
    const broken = vi.spyOn(context.internalAdapter, 'findUserByEmail').mockRejectedValue(new Error('the database went away'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (let i = 0; i < SIGN_IN_FAILURE_LIMIT + 2; i += 1) {
        const result = await viaRoute('/sign-in/email', { email: account.email, password: `whatever ${i}` }, `203.0.113.${i + 100}`);
        expect(result.status).toBe(500);
      }
    } finally {
      broken.mockRestore();
      quiet.mockRestore();
    }
    expect(await throttleCount(signInKey(account.email))).toBe(0);
    expect((await signInWith(account.email, account.password)).status).toBe(200);
  });
});

describe('nobody can lock the owner out of an account', () => {
  it('duplicate sign-ups do not use up the e-mails that get the owner back in', async () => {
    const owner = await createAccount({ label: 'notice-flood' });
    for (let i = 0; i < 5; i += 1) expect((await signUp(owner.email, `someone else tried ${i}`)).status).toBe(200);
    // The notice goes once an hour; repeats inside the hour are not sent again.
    expect(await deliveryCount('account-exists', owner.email)).toBe(1);
    expect((await authFetch(new TestBrowser(), '/request-password-reset', { body: { email: owner.email } })).status).toBe(200);
    expect(await deliveryCount('reset-password', owner.email)).toBe(1);
  });

  it('a stranger who keeps an address locked and floods it with sign-ups cannot keep the owner out', async () => {
    const owner = await createAccount({ label: 'kept-out' });
    const lockAgain = async (round: number) => {
      for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) await signInWith(owner.email, `stranger ${round} guess ${i}`);
    };
    await lockAgain(1);
    for (let i = 0; i < 5; i += 1) await signUp(owner.email, `stranger sign-up ${i}`);
    expect((await signInWith(owner.email, owner.password)).status).toBe(429);

    // The owner asks for a reset: it is sent, whatever the stranger did.
    expect((await authFetch(new TestBrowser(), '/request-password-reset', { body: { email: owner.email } })).status).toBe(200);
    const token = await tokenFromOutbox('reset-password', owner.email);
    const ownersBrowser = new TestBrowser();
    expect((await authFetch(ownersBrowser, '/reset-password', { body: { token, newPassword: 'the owner is back in' } })).status).toBe(200);

    // The stranger locks the address again right away; the owner's browser still signs in...
    await lockAgain(2);
    expect((await signInWith(owner.email, 'the owner is back in')).data?.code).toBe('TOO_MANY_ATTEMPTS');
    const back = await signInWith(owner.email, 'the owner is back in', ownersBrowser);
    expect(back.status).toBe(200);
    // ...and keeps doing so after the session ends, because the browser is now a known one.
    await lockAgain(3);
    const later = new TestBrowser();
    for (const [name, value] of ownersBrowser.cookies) if (name.includes('known_device')) later.cookies.set(name, value);
    expect((await signInWith(owner.email, 'the owner is back in', later)).status).toBe(200);
  });

  it('a known browser has a lock of its own: its failures never lock the address for others', async () => {
    const owner = await createAccount({ label: 'known-own-lock' });
    const { browser } = await signIn(owner);
    expect(browser.hasCookie('known_device')).toBe(true);
    // The same browser (its known-device cookie) from a new client address each time, so the
    // per-address rate limit of the endpoint never answers instead of the lock.
    const sameBrowser = () => {
      const copy = new TestBrowser();
      for (const [name, value] of browser.cookies) if (name.includes('known_device')) copy.cookies.set(name, value);
      return copy;
    };
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) expect((await signInWith(owner.email, `typo ${i}`, sameBrowser())).status).toBe(401);
    const locked = await signInWith(owner.email, owner.password, sameBrowser());
    expect(locked.status).toBe(429);
    expect(locked.data?.code).toBe('TOO_MANY_ATTEMPTS');
    // A new browser (no known-device cookie) is not affected by those failures.
    expect((await signInWith(owner.email, owner.password)).status).toBe(200);
  });

  it('a new password ends every known browser of the account but the one that chose it', async () => {
    const owner = await createAccount({ label: 'known-reset' });
    const knownOnly = (browser: TestBrowser) => {
      const copy = new TestBrowser();
      for (const [name, value] of browser.cookies) if (name.includes('known_device')) copy.cookies.set(name, value);
      return copy;
    };
    // The owner's browser, and a browser of someone who learned the old password.
    const { browser: ownersOld } = await signIn(owner);
    const { browser: leaked } = await signIn(owner);
    await authFetch(new TestBrowser(), '/request-password-reset', { body: { email: owner.email } });
    const token = await tokenFromOutbox('reset-password', owner.email);
    const chooser = new TestBrowser();
    expect((await authFetch(chooser, '/reset-password', { body: { token, newPassword: 'the new password of the owner' } })).status).toBe(200);
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) await signInWith(owner.email, `stranger guess ${i}`);
    // The cookies of the old password are not known any more: they share the address-wide lock.
    expect((await signInWith(owner.email, 'the new password of the owner', knownOnly(leaked))).data?.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await signInWith(owner.email, 'the new password of the owner', knownOnly(ownersOld))).data?.code).toBe('TOO_MANY_ATTEMPTS');
    // The browser that chose the new password is known for it.
    expect((await signInWith(owner.email, 'the new password of the owner', knownOnly(chooser))).status).toBe(200);
  });

  it('a known-device cookie of one address does nothing for another address', async () => {
    const first = await createAccount({ label: 'known-first' });
    const second = await createAccount({ label: 'known-second' });
    const { browser } = await signIn(first);
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) await signInWith(second.email, `stranger guess ${i}`);
    const refused = await signInWith(second.email, second.password, browser);
    expect(refused.status).toBe(429);
    expect(refused.data?.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('wrong passwords through a stolen session count toward the lock of the address', async () => {
    const owner = await createAccount({ label: 'session-guess' });
    const { browser } = await signIn(owner);
    // A thief with the session cookie only (not the owner's known-device cookie), from a new
    // client address per request.
    const thief = () => {
      const copy = new TestBrowser();
      for (const [name, value] of browser.cookies) if (!name.includes('known_device')) copy.cookies.set(name, value);
      return copy;
    };
    const guess = (i: number) =>
      authFetch(thief(), '/change-password', { body: { currentPassword: `thief guess ${i}`, newPassword: 'the thief wants this one' } });
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT; i += 1) expect((await guess(i)).data?.code).toBe('INVALID_PASSWORD');
    const locked = await guess(SIGN_IN_FAILURE_LIMIT);
    expect(locked.status).toBe(429);
    expect(locked.data?.code).toBe('TOO_MANY_ATTEMPTS');
    // The same lock as sign-in: strangers are refused there too, the owner's own browser is not.
    expect((await signInWith(owner.email, owner.password)).data?.code).toBe('TOO_MANY_ATTEMPTS');
    const ownBrowser = new TestBrowser();
    for (const [name, value] of browser.cookies) if (name.includes('known_device')) ownBrowser.cookies.set(name, value);
    expect((await signInWith(owner.email, owner.password, ownBrowser)).status).toBe(200);
  });
});

/** A session of `account` that has not passed the second factor (password only, then a fresh row). */
async function unverifiedSession(account: Awaited<ReturnType<typeof createAccount>>) {
  const { browser } = await signIn(account);
  await getDb().update(authSession).set({ twoFactorVerifiedAt: null }).where(eq(authSession.userId, account.id));
  return browser;
}

describe('TOTP', () => {
  it('a code works once: the same code is refused for a second sign-in, the next one works', async () => {
    const moderator = await createAccount({ role: 'moderator', label: 'replay' });
    const code = await totpCode(moderator.totpSecret!);
    const first = new TestBrowser();
    await signInWith(moderator.email, moderator.password, first);
    expect((await authFetch(first, '/two-factor/verify-totp', { body: { code } })).status).toBe(200);
    const second = new TestBrowser();
    await signInWith(moderator.email, moderator.password, second);
    const replay = await authFetch(second, '/two-factor/verify-totp', { body: { code } });
    expect(replay.status).toBe(401);
    expect(replay.data?.code).toBe('CODE_ALREADY_USED');
    // The refusal is not a failed attempt: the challenge still takes the next code.
    expect((await authFetch(second, '/two-factor/verify-totp', { body: { code: await totpCode(moderator.totpSecret!, 1) } })).status).toBe(200);
  });

  it('a wrong code does not use up the right one', async () => {
    const moderator = await createAccount({ role: 'moderator', label: 'wrong-then-right' });
    const browser = new TestBrowser();
    await signInWith(moderator.email, moderator.password, browser);
    expect((await authFetch(browser, '/two-factor/verify-totp', { body: { code: '000000' } })).status).toBe(401);
    expect((await verifyTotpOnce(browser, moderator.totpSecret!)).status).toBe(200);
  });

  it('locks a session after 10 wrong codes in a row, even with the right code next', async () => {
    const moderator = await createAccount({ role: 'moderator', label: 'session-lock' });
    const session = await unverifiedSession(moderator);
    // The same session from a new client address each time: the per-address limit never applies.
    const fromNewAddress = () => {
      const browser = new TestBrowser();
      for (const [name, value] of session.cookies) browser.cookies.set(name, value);
      return browser;
    };
    for (let i = 0; i < 10; i += 1) {
      const wrong = await authFetch(fromNewAddress(), '/two-factor/verify-totp', { body: { code: String(100000 + i) } });
      expect(wrong.status).toBe(401);
    }
    const locked = await authFetch(fromNewAddress(), '/two-factor/verify-totp', { body: { code: await totpCode(moderator.totpSecret!, 1) } });
    expect(locked.status).toBe(429);
    expect(locked.data?.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    const [row] = await getDb().select({ lockedUntil: authTwoFactor.lockedUntil }).from(authTwoFactor).where(eq(authTwoFactor.userId, moderator.id));
    expect(row?.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it('a parallel burst of codes inside a session gets at most 10 checks', async () => {
    const moderator = await createAccount({ role: 'moderator', label: 'session-burst' });
    const session = await unverifiedSession(moderator);
    const fromNewAddress = () => {
      const browser = new TestBrowser();
      for (const [name, value] of session.cookies) browser.cookies.set(name, value);
      return browser;
    };
    // Codes that are certainly wrong: none of the ones the plugin would accept now.
    const valid = new Set(await Promise.all(([-1, 0, 1] as const).map((step) => totpCode(moderator.totpSecret!, step))));
    const codes: string[] = [];
    for (let candidate = 200000; codes.length < 40; candidate += 7) if (!valid.has(String(candidate))) codes.push(String(candidate));
    const results = await Promise.all(codes.map((code) => authFetch(fromNewAddress(), '/two-factor/verify-totp', { body: { code } })));
    const wrong = results.filter((r) => r.status === 401 && r.data?.code === 'INVALID_CODE').length;
    const locked = results.filter((r) => r.status === 429 && r.data?.code === 'ACCOUNT_TEMPORARILY_LOCKED').length;
    expect(wrong).toBeLessThanOrEqual(10);
    expect(wrong + locked).toBe(codes.length);
  });
});

async function backupCodesOf(userIdValue: string): Promise<string[]> {
  const { codes, encrypted } = await generateBackupCodes(process.env.BETTER_AUTH_SECRET!);
  await getDb().update(authTwoFactor).set({ backupCodes: encrypted }).where(eq(authTwoFactor.userId, userIdValue));
  return codes;
}

describe('backup codes', () => {
  it('are upper-case XXXX-XXXX codes without look-alike characters', async () => {
    const { codes } = await generateBackupCodes(process.env.BETTER_AUTH_SECRET!);
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('sign a staff account in with two_factor_verified_at, once each; typed in lower case without the dash too', async () => {
    const archivist = await createAccount({ role: 'archivist', label: 'backup-sign-in' });
    const codes = await backupCodesOf(archivist.id);
    const browser = new TestBrowser();
    await signInWith(archivist.email, archivist.password, browser);
    const typed = codes[0]!.replace('-', '').toLowerCase();
    const result = await authFetch(browser, '/two-factor/verify-backup-code', { body: { code: typed } });
    expect(result.status).toBe(200);
    const [session] = await getDb().select().from(authSession).where(eq(authSession.userId, archivist.id));
    expect(session?.twoFactorVerifiedAt).toBeInstanceOf(Date);

    // The same code again (a new sign-in) is refused.
    const again = new TestBrowser();
    await signInWith(archivist.email, archivist.password, again);
    const reused = await authFetch(again, '/two-factor/verify-backup-code', { body: { code: codes[0] } });
    expect(reused.status).toBe(401);
  });

  it('verify an existing session that has not passed the second factor', async () => {
    const archivist = await createAccount({ role: 'archivist', label: 'backup-in-session' });
    const codes = await backupCodesOf(archivist.id);
    const browser = await unverifiedSession(archivist);
    const [before] = await getDb().select().from(authSession).where(eq(authSession.userId, archivist.id));
    expect(before?.twoFactorVerifiedAt).toBeNull();
    expect((await authFetch(browser, '/two-factor/verify-backup-code', { body: { code: codes[1] } })).status).toBe(200);
    const [after] = await getDb().select().from(authSession).where(eq(authSession.id, before!.id));
    expect(after?.twoFactorVerifiedAt).toBeInstanceOf(Date);
  });
});

describe('a public deployment', () => {
  it('refuses the demo addresses at sign-in like a wrong password', async () => {
    const account = await createAccount({ label: 'public-demo' });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_URL', 'https://wingchunroots.example');
    vi.stubEnv('TRUSTED_PROXIES', '10.0.0.1');
    try {
      const result = await signInWith(account.email, account.password);
      expect(result.status).toBe(401);
      expect(result.data?.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    } finally {
      vi.unstubAllEnvs();
    }
    expect((await signInWith(account.email, account.password)).status).toBe(200);
  });
});

describe('a sign-up whose consents cannot be stored', () => {
  it('leaves no account and no queued confirmation e-mail behind', async () => {
    // The first statement that stores a consent fails: an account that cannot hold consents.
    const email = address('no-consents');
    await withClient(testDb.url, async (c) => {
      await c.query(`CREATE FUNCTION demo_refuse_consent() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'demo refusal'; END $$`);
      await c.query(`CREATE TRIGGER demo_refuse_consent BEFORE INSERT ON consent_record FOR EACH ROW EXECUTE FUNCTION demo_refuse_consent()`);
    });
    try {
      const result = await signUp(email, 'a long demo password');
      expect(result.status).toBeGreaterThanOrEqual(400);
    } finally {
      await withClient(testDb.url, async (c) => {
        await c.query(`DROP TRIGGER demo_refuse_consent ON consent_record`);
        await c.query(`DROP FUNCTION demo_refuse_consent()`);
      });
    }
    expect(await getDb().select().from(authUser).where(eq(authUser.email, email))).toHaveLength(0);
    expect(await getDb().select().from(emailDelivery).where(and(eq(emailDelivery.toEmail, email), eq(emailDelivery.status, 'queued')))).toHaveLength(0);
  });
});
