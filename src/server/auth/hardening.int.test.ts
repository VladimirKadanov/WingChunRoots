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
import { generateBackupCodes } from './credentials';
import { ACCOUNT_EMAIL_HOURLY_CAP } from './emails';
import { handleAuthRequest } from './route';
import { SIGN_IN_FAILURE_LIMIT } from './throttle';
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
  it('is the same body for a new address, an unconfirmed one and a confirmed one', async () => {
    const fresh = await signUp(address('fresh'), 'a long demo password');
    const unconfirmed = address('unconfirmed');
    await signUp(unconfirmed, 'a long demo password');
    const again = await signUp(unconfirmed, 'a long demo password');
    const confirmed = await createAccount({ label: 'enumeration' });
    const existing = await signUp(confirmed.email, 'a long demo password');
    for (const result of [fresh, again, existing]) {
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ token: null, user: null });
    }
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

  it(`sends at most ${ACCOUNT_EMAIL_HOURLY_CAP} account e-mails an hour to one address, whatever the client address`, async () => {
    const account = await createAccount({ label: 'mail-cap' });
    for (let i = 0; i < ACCOUNT_EMAIL_HOURLY_CAP + 3; i += 1) {
      // A new browser (client address) each time: the per-address limit of the endpoint never applies.
      const result = await authFetch(new TestBrowser(), '/request-password-reset', { body: { email: account.email } });
      expect(result.status).toBe(200);
    }
    expect(await deliveryCount('reset-password', account.email)).toBe(ACCOUNT_EMAIL_HOURLY_CAP);
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

  it('a right password clears the failures counted so far', async () => {
    const account = await createAccount({ label: 'sign-in-clear' });
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT - 1; i += 1) await signInWith(account.email, `wrong ${i}`);
    expect((await signInWith(account.email, account.password)).status).toBe(200);
    for (let i = 0; i < SIGN_IN_FAILURE_LIMIT - 1; i += 1) await signInWith(account.email, `wrong ${i}`);
    expect((await signInWith(account.email, account.password)).status).toBe(200);
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
