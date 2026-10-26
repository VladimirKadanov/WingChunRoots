// The review fixes of milestone M02 (fix round 1) through Better Auth's HTTP API: who owns an
// address (pre-registration takeover, H1), no account enumeration in the sign-up answer, sealed
// tokens in the outbox, limits that changing the client address cannot dodge, one use per TOTP
// code, a lock for wrong codes inside a session, backup codes, and refused profile fields.
//
// This file: the limits that a changed client address cannot dodge, a reservation whose request
// fails unexpectedly, the second factor (TOTP, backup codes), a public deployment and consents that
// cannot be stored. See hardening.int.test.ts for the rest.

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getDb } from '../db';
import { withClient } from '../db/admin';
import { authSession, authTwoFactor, authUser, emailDelivery } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { generateBackupCodes } from './credentials';
import { handleAuthRequest } from './route';
import { SIGN_IN_FAILURE_LIMIT, signInKey } from './throttle';
import {
  address,
  authFetch,
  createAccount,
  secretFromTotpUri,
  signIn,
  signInWith,
  signUp,
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

describe('the second factor of a session that has passed it (fix round 3)', () => {
  /** The same browser (its cookies) from a new client address: the per-address limit never applies. */
  const fromNewAddress = (browser: TestBrowser) => {
    const copy = new TestBrowser();
    for (const [name, value] of browser.cookies) copy.cookies.set(name, value);
    return copy;
  };

  it('posts no codes: wrong codes through a stolen verified session neither count nor lock the owner\'s sign-in', async () => {
    // Before, each wrong code counted on the account-wide lock: ten of them through a stolen
    // cookie, without the password, locked the owner's sign-in (and backup codes) for 15 minutes.
    const member = await createAccount({ twoFactor: true, label: 'verified-session' });
    const { browser } = await signIn(member);
    for (let i = 0; i < 12; i += 1) {
      const wrong = await authFetch(fromNewAddress(browser), '/two-factor/verify-totp', { body: { code: String(300000 + i) } });
      expect(wrong.status).toBe(400);
      expect(wrong.data?.code).toBe('SECOND_FACTOR_ALREADY_VERIFIED');
    }
    const backup = await authFetch(fromNewAddress(browser), '/two-factor/verify-backup-code', { body: { code: 'AAAA-AAAA' } });
    expect(backup.data?.code).toBe('SECOND_FACTOR_ALREADY_VERIFIED');
    const [row] = await getDb()
      .select({ failed: authTwoFactor.failedVerificationCount, lockedUntil: authTwoFactor.lockedUntil })
      .from(authTwoFactor)
      .where(eq(authTwoFactor.userId, member.id));
    expect(row).toEqual({ failed: 0, lockedUntil: null });
    // The owner signs in from another browser with the code in the app.
    const owner = new TestBrowser();
    expect((await signInWith(member.email, member.password, owner)).data?.twoFactorRedirect).toBe(true);
    expect((await verifyTotpOnce(owner, member.totpSecret!)).status).toBe(200);
  });

  it('still confirms a new setup with its first code', async () => {
    const member = await createAccount({ twoFactor: true, label: 're-setup' });
    const { browser } = await signIn(member);
    expect((await authFetch(browser, '/two-factor/disable', { body: { password: member.password } })).status).toBe(200);
    const enabled = await authFetch(browser, '/two-factor/enable', { body: { password: member.password } });
    expect(enabled.status).toBe(200);
    // Whatever the plugin did to the session on the way, this session has passed the second factor.
    await getDb().update(authSession).set({ twoFactorVerifiedAt: new Date() }).where(eq(authSession.userId, member.id));
    const secret = secretFromTotpUri(String(enabled.data?.totpURI));
    const confirmed = await authFetch(browser, '/two-factor/verify-totp', { body: { code: await totpCode(secret) } });
    expect(confirmed.status, JSON.stringify(confirmed.data)).toBe(200);
    expect((await userRow(member.id))?.twoFactorEnabled).toBe(true);
  });
});

describe('a TOTP code that was not accepted (fix round 3)', () => {
  it('stays usable whatever refused it: five wrong codes, the right one refused for too many tries, then a new challenge takes it', async () => {
    // Before, the claim on the code was given back only for a wrong code: the next sign-in with the
    // code shown in the app got CODE_ALREADY_USED for two minutes.
    const moderator = await createAccount({ role: 'moderator', label: 'claim-release' });
    const challenge = new TestBrowser();
    await signInWith(moderator.email, moderator.password, challenge);
    const fromNewAddress = () => {
      const copy = new TestBrowser();
      for (const [name, value] of challenge.cookies) copy.cookies.set(name, value);
      return copy;
    };
    const valid = new Set(await Promise.all(([-1, 0, 1] as const).map((step) => totpCode(moderator.totpSecret!, step))));
    const wrongCodes = ['400001', '400002', '400003', '400004', '400005', '400006', '400007'].filter((code) => !valid.has(code)).slice(0, 5);
    for (const code of wrongCodes) {
      expect((await authFetch(fromNewAddress(), '/two-factor/verify-totp', { body: { code } })).data?.code).toBe('INVALID_CODE');
    }
    const code = await totpCode(moderator.totpSecret!);
    const refused = await authFetch(fromNewAddress(), '/two-factor/verify-totp', { body: { code } });
    expect(refused.data?.code).toBe('TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE');
    const again = new TestBrowser();
    await signInWith(moderator.email, moderator.password, again);
    const accepted = await authFetch(again, '/two-factor/verify-totp', { body: { code } });
    expect(accepted.status, JSON.stringify(accepted.data)).toBe(200);
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
