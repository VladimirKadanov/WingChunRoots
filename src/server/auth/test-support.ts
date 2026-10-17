// Helpers for the integration tests of the accounts module (milestone M02): a throwaway database
// that getDb(), the outbox and Better Auth all use, an HTTP client with a cookie jar that calls
// `auth.handler` like a browser, accounts created directly in the database, and the tokens of
// the account e-mails read back from the outbox job.

import { randomBytes } from 'node:crypto';

import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { and, eq, sql } from 'drizzle-orm';

import { closeDb, getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { authAccount, authTwoFactor, authUser } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { stopProducer } from '../jobs/boss';
import { encryptTotpSecret, generateBackupCodes, hashAccountPassword } from './credentials';

export const TEST_APP_URL = 'http://127.0.0.1:3999';
export const TEST_PASSWORD = 'demo-password-for-tests';

/** Throwaway secrets for this process, and APP_URL for the e-mail links and the origin check. */
export function setTestAuthEnv(): void {
  process.env.BETTER_AUTH_SECRET = `test-${randomBytes(24).toString('hex')}`;
  process.env.IP_HMAC_KEY = `test-${randomBytes(24).toString('hex')}`;
  process.env.APP_URL = TEST_APP_URL;
}

/** A migrated throwaway database that getDb(), the outbox producer and Better Auth use. */
export async function startAuthTestDatabase(): Promise<TestDatabase> {
  setTestAuthEnv();
  const db = await createTestDatabase();
  process.env.DATABASE_URL = db.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
  return db;
}

export async function stopAuthTestDatabase(db: TestDatabase | undefined): Promise<void> {
  await stopProducer();
  await closeDb();
  await db?.drop();
}

let ipCounter = 0;

/** A browser: a cookie jar and its own client address (rate limits are per address). */
export class TestBrowser {
  readonly cookies = new Map<string, string>();
  readonly ip: string;
  bearer: string | null = null;

  constructor() {
    ipCounter += 1;
    this.ip = `198.51.100.${(ipCounter % 250) + 1}`;
    // A different /24 per hundreds of browsers is not needed: tests create a few dozen at most.
  }

  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  headers(extra: Record<string, string> = {}): Headers {
    const h = new Headers({ 'x-forwarded-for': this.ip, 'user-agent': 'wcr-int-test', origin: TEST_APP_URL, ...extra });
    if (this.cookies.size > 0) h.set('cookie', this.cookieHeader());
    if (this.bearer) h.set('authorization', `Bearer ${this.bearer}`);
    return h;
  }

  /** Stores the Set-Cookie values of a response; Max-Age=0 removes a cookie. */
  absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';');
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i).trim();
      const value = pair!.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '';
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  hasCookie(fragment: string): boolean {
    return [...this.cookies.keys()].some((k) => k.includes(fragment));
  }
}

/** Calls a Better Auth endpoint through auth.handler, as `browser`. */
export async function authFetch(
  browser: TestBrowser,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string> } = {},
): Promise<{ status: number; data: Record<string, unknown> | null; response: Response }> {
  const { getAuth } = await import('./config');
  const url = new URL(`/api/auth${path}`, TEST_APP_URL);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const method = init.method ?? 'POST';
  const headers = browser.headers(method === 'POST' ? { 'content-type': 'application/json' } : {});
  const response = await getAuth().handler(
    new Request(url, { method, headers, body: method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined }),
  );
  browser.absorb(response);
  const text = await response.clone().text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data, response };
}

export interface TestAccount {
  id: string;
  email: string;
  password: string;
  totpSecret: string | null;
}

let accountCounter = 0;

/** An account created directly in the database: confirmed e-mail, password, optional TOTP. */
export async function createAccount(
  opts: { role?: 'user' | 'moderator' | 'archivist' | 'admin'; twoFactor?: boolean; label?: string } = {},
): Promise<TestAccount> {
  accountCounter += 1;
  const email = `demo-${opts.label ?? 'account'}-${accountCounter}-${randomBytes(3).toString('hex')}@example.test`;
  const twoFactor = opts.twoFactor ?? (opts.role !== undefined && opts.role !== 'user');
  const id = uuidv7();
  const db = getDb();
  await db.insert(authUser).values({ id, email, emailVerified: true, role: opts.role ?? 'user', twoFactorEnabled: twoFactor });
  await db.insert(authAccount).values({ userId: id, providerId: 'credential', accountId: id, password: await hashAccountPassword(TEST_PASSWORD) });
  let totpSecret: string | null = null;
  if (twoFactor) {
    totpSecret = randomBytes(20).toString('hex');
    const authSecret = process.env.BETTER_AUTH_SECRET!;
    await db.insert(authTwoFactor).values({
      userId: id,
      secret: await encryptTotpSecret(totpSecret, authSecret),
      backupCodes: (await generateBackupCodes(authSecret)).encrypted,
      verified: true,
    });
  }
  return { id, email, password: TEST_PASSWORD, totpSecret };
}

export function totpCode(secret: string): Promise<string> {
  return createOTP(secret).totp();
}

/** The secret behind an otpauth:// URI (base32 in the URI, as authenticator apps read it). */
export function secretFromTotpUri(uri: string): string {
  const encoded = new URL(uri).searchParams.get('secret');
  if (!encoded) throw new Error('the TOTP URI has no secret');
  return new TextDecoder().decode(base32.decode(encoded));
}

/**
 * Signs `account` in with its password and, when it has TOTP, the current code. Returns the
 * browser with the session cookie, and the bearer token of the session.
 */
export async function signIn(
  account: TestAccount,
  opts: { trustDevice?: boolean; browser?: TestBrowser } = {},
): Promise<{ browser: TestBrowser; token: string }> {
  const browser = opts.browser ?? new TestBrowser();
  const first = await authFetch(browser, '/sign-in/email', { body: { email: account.email, password: account.password } });
  if (first.status !== 200) throw new Error(`sign-in failed: ${first.status} ${JSON.stringify(first.data)}`);
  let tokenHeader = first.response.headers.get('set-auth-token');
  if (first.data?.twoFactorRedirect) {
    if (!account.totpSecret) throw new Error('sign-in asks for a second factor, but the account has no TOTP secret');
    const second = await authFetch(browser, '/two-factor/verify-totp', {
      body: { code: await totpCode(account.totpSecret), ...(opts.trustDevice ? { trustDevice: true } : {}) },
    });
    if (second.status !== 200) throw new Error(`verify-totp failed: ${second.status} ${JSON.stringify(second.data)}`);
    tokenHeader = second.response.headers.get('set-auth-token');
  }
  if (!tokenHeader) throw new Error('no set-auth-token header');
  return { browser, token: tokenHeader };
}

/** The token in the newest account e-mail of `template` to `to`, from the queued job's data. */
export async function tokenFromOutbox(template: 'verify-email' | 'reset-password', to: string): Promise<string> {
  const rows = await getDb().execute<{ url: string }>(sql`
    SELECT j.data -> 'data' ->> 'url' AS url
      FROM pgboss.job j
      JOIN email_delivery d ON d.id::text = j.data ->> 'deliveryId'
     WHERE d.template = ${template} AND d.to_email = ${to}
     ORDER BY d.created_at DESC
     LIMIT 1`);
  const url = rows.rows[0]?.url;
  if (!url) throw new Error(`no ${template} e-mail to ${to} in the outbox`);
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error('the e-mail link has no token');
  return token;
}

export async function sessionCount(userId: string): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM auth_session WHERE user_id = ${userId}`);
  return rows.rows[0]?.n ?? 0;
}

export async function userRow(userId: string) {
  const [row] = await getDb().select().from(authUser).where(and(eq(authUser.id, userId)));
  return row;
}
