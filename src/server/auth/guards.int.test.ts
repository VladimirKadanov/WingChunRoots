// Guards and the rules of plan §3.2 (milestone M02, Done when 3): a role × route matrix; a staff
// session without two_factor_verified_at is refused on /admin (a 403 decision; the page sends it
// to /account/security); trustDevice is ignored for staff and works for members; a staff role needs 2FA; a role change ends every session; a protected oRPC procedure accepts a
// cookie session and a bearer session and refuses a request without one.

import { randomBytes } from 'node:crypto';

import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { auditLog, authSession, authVerification } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { handleApiRequest } from '../rpc/handler';
import { setUserRole } from '../services/roles';
import { signedSessionToken } from './credentials';
import { checkRoute, ROUTE_POLICIES } from './guards';
import type { Principal, Role } from './principal';
import { principalFromHeaders } from './session';
import {
  authFetch,
  createAccount,
  sessionCount,
  signIn,
  startAuthTestDatabase,
  stopAuthTestDatabase,
  TEST_APP_URL,
  secretFromTotpUri,
  TestBrowser,
  totpCode,
  userRow,
} from './test-support';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

const META = { requestId: 'test-request', ipHmac: null };

const cookieHeaders = (browser: TestBrowser) => new Headers({ cookie: browser.cookieHeader() });
const bearerHeaders = (token: string) => new Headers({ authorization: `Bearer ${token}` });

/** A session row created directly, without the second factor, as its signed bearer token. */
async function unverifiedSession(userId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await getDb().insert(authSession).values({ id: uuidv7(), userId, token, expiresAt: new Date(Date.now() + 3_600_000) });
  return signedSessionToken(token, process.env.BETTER_AUTH_SECRET!);
}

function rpc(path: string, init: { method?: string; headers?: Headers; body?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return handleApiRequest(
    new Request(`${TEST_APP_URL}/api/rpc${path}`, {
      method: init.method ?? 'POST',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify({ json: init.body }),
    }),
    'rpc',
  );
}

function v1(path: string, init: { method?: string; headers?: Headers; body?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return handleApiRequest(
    new Request(`${TEST_APP_URL}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    'openapi',
  );
}

describe('role × route matrix', () => {
  const ROUTES = ['/', '/legal/terms', ...Object.keys(ROUTE_POLICIES)];
  type Who = 'anonymous' | Role;
  const expected: Record<Who, Record<string, 200 | 401 | 403>> = {
    anonymous: { '/': 200, '/legal/terms': 200, '/onboarding': 401, '/account': 401, '/account/security': 401, '/admin': 401 },
    user: { '/': 200, '/legal/terms': 200, '/onboarding': 200, '/account': 200, '/account/security': 200, '/admin': 403 },
    moderator: { '/': 200, '/legal/terms': 200, '/onboarding': 200, '/account': 200, '/account/security': 200, '/admin': 200 },
    archivist: { '/': 200, '/legal/terms': 200, '/onboarding': 200, '/account': 200, '/account/security': 200, '/admin': 200 },
    admin: { '/': 200, '/legal/terms': 200, '/onboarding': 200, '/account': 200, '/account/security': 200, '/admin': 200 },
  };

  it('covers every protected route', () => {
    for (const who of Object.keys(expected) as Who[]) expect(Object.keys(expected[who]).sort()).toEqual([...ROUTES].sort());
  });

  for (const who of Object.keys(expected) as Who[]) {
    it(`${who}: real sessions, cookie and bearer`, async () => {
      let principals: (Principal | null)[] = [null];
      if (who !== 'anonymous') {
        const account = await createAccount({ role: who, label: who });
        const { browser, token } = await signIn(account);
        principals = [await principalFromHeaders(cookieHeaders(browser)), await principalFromHeaders(bearerHeaders(token))];
        expect(principals.map((p) => p?.via)).toEqual(['cookie', 'bearer']);
        for (const p of principals) {
          expect(p?.user.role).toBe(who);
          // Staff sign-in proved the second factor in this session.
          if (who !== 'user') expect(p?.session.twoFactorVerifiedAt).toBeInstanceOf(Date);
        }
      }
      for (const principal of principals) {
        for (const route of ROUTES) {
          const decision = checkRoute(route, principal);
          expect(decision.ok ? 200 : decision.status, `${who} ${route}`).toBe(expected[who][route]);
        }
      }
    });
  }
});

/** Drops the session cookies of `browser` and keeps the rest (the trust-device cookie). */
function signOutKeepingOtherCookies(browser: TestBrowser): void {
  for (const name of [...browser.cookies.keys()]) {
    if (name.includes('session_token') || name.includes('session_data')) browser.cookies.delete(name);
  }
  browser.bearer = null;
}

describe('second factor of staff sessions', () => {
  it('a staff session without two_factor_verified_at is refused on /admin (403 decision) and sent to /account/security', async () => {
    const admin = await createAccount({ role: 'admin', label: 'unverified-admin' });
    const token = await unverifiedSession(admin.id);
    for (const headers of [bearerHeaders(token), new Headers({ cookie: `wcr.session_token=${encodeURIComponent(token)}` })]) {
      const principal = await principalFromHeaders(headers);
      expect(principal?.user.role).toBe('admin');
      expect(principal?.session.twoFactorVerifiedAt).toBeNull();
      const decision = checkRoute('/admin', principal);
      expect(decision).toMatchObject({ ok: false, status: 403, code: 'SECOND_FACTOR_REQUIRED', redirectTo: '/account/security?next=%2Fadmin' });
      // Other signed-in pages stay open, so the session can prove the second factor there.
      expect(checkRoute('/account/security', principal).ok).toBe(true);
    }
    const response = await rpc('/admin/overview', { headers: bearerHeaders(token) });
    expect(response.status).toBe(403);
    expect((await response.json()).json.code).toBe('SECOND_FACTOR_REQUIRED');
  });

  it('verifying TOTP inside the session sets two_factor_verified_at, and /admin opens', async () => {
    const moderator = await createAccount({ role: 'moderator', label: 'verify-in-session' });
    const token = await unverifiedSession(moderator.id);
    const browser = new TestBrowser();
    browser.bearer = token;
    const result = await authFetch(browser, '/two-factor/verify-totp', { body: { code: await totpCode(moderator.totpSecret!) } });
    expect(result.status).toBe(200);
    const principal = await principalFromHeaders(bearerHeaders(token));
    expect(principal?.session.twoFactorVerifiedAt).toBeInstanceOf(Date);
    expect(checkRoute('/admin', principal).ok).toBe(true);
    const response = await rpc('/admin/overview', { headers: bearerHeaders(token) });
    expect(response.status).toBe(200);
    expect((await response.json()).json).toEqual({ failedEmailDeliveries: 0 });
  });

  it('a wrong code leaves the session unverified', async () => {
    const archivist = await createAccount({ role: 'archivist', label: 'wrong-code' });
    const token = await unverifiedSession(archivist.id);
    const browser = new TestBrowser();
    browser.bearer = token;
    const result = await authFetch(browser, '/two-factor/verify-totp', { body: { code: '000000' } });
    expect(result.status).toBe(401);
    expect((await principalFromHeaders(bearerHeaders(token)))?.session.twoFactorVerifiedAt).toBeNull();
  });

  it('the password alone never verifies a staff session: no TOTP secret, no new backup codes, no new setup', async () => {
    const moderator = await createAccount({ role: 'moderator', label: 'password-only' });
    const token = await unverifiedSession(moderator.id);
    // A new client address per request, so the per-address rate limit never answers instead.
    const asSession = () => {
      const browser = new TestBrowser();
      browser.bearer = token;
      return browser;
    };
    const password = { password: moderator.password };
    // Not served: the TOTP secret for the password, and an uncounted check of the password.
    expect((await authFetch(asSession(), '/two-factor/get-totp-uri', { body: password })).status).toBe(404);
    expect((await authFetch(asSession(), '/verify-password', { body: password })).status).toBe(404);
    for (const path of ['/two-factor/generate-backup-codes', '/two-factor/enable']) {
      const refused = await authFetch(asSession(), path, { body: password });
      expect(refused.status, path).toBe(403);
      expect(refused.data?.code, path).toBe('SECOND_FACTOR_REQUIRED');
    }
    expect((await rpc('/admin/overview', { headers: bearerHeaders(token) })).status).toBe(403);
    expect((await principalFromHeaders(bearerHeaders(token)))?.session.twoFactorVerifiedAt).toBeNull();

    // Once the session has passed the second factor, new backup codes need only the password.
    expect((await authFetch(asSession(), '/two-factor/verify-totp', { body: { code: await totpCode(moderator.totpSecret!) } })).status).toBe(200);
    const codes = await authFetch(asSession(), '/two-factor/generate-backup-codes', { body: password });
    expect(codes.status).toBe(200);
    expect(codes.data?.backupCodes).toHaveLength(10);
  });

  it('trustDevice is ignored for staff and kept for other accounts', async () => {
    const staff = await createAccount({ role: 'archivist', label: 'trust-staff' });
    const { browser } = await signIn(staff, { trustDevice: true });
    expect(browser.hasCookie('trust_device')).toBe(false);
    const trusted = await getDb()
      .select()
      .from(authVerification)
      .where(and(eq(authVerification.value, staff.id)));
    expect(trusted).toHaveLength(0);
    // The next sign-in on the same browser asks for the second factor again. Only the session
    // cookies go: a trust-device cookie, had one been set, would stay and be used.
    signOutKeepingOtherCookies(browser);
    const again = await authFetch(browser, '/sign-in/email', { body: { email: staff.email, password: staff.password } });
    expect(again.data?.twoFactorRedirect).toBe(true);

    const member = await createAccount({ role: 'user', twoFactor: true, label: 'trust-member' });
    const signedIn = await signIn(member, { trustDevice: true });
    expect(signedIn.browser.hasCookie('trust_device')).toBe(true);
    // The member's next sign-in on that browser skips the second factor: the device is trusted.
    signOutKeepingOtherCookies(signedIn.browser);
    const trustedSignIn = await authFetch(signedIn.browser, '/sign-in/email', { body: { email: member.email, password: member.password } });
    expect(trustedSignIn.status).toBe(200);
    expect(trustedSignIn.data?.twoFactorRedirect).toBeUndefined();
    expect(signedIn.browser.hasCookie('session_token')).toBe(true);
  });

  it('a staff account cannot turn two-factor authentication off', async () => {
    const admin = await createAccount({ role: 'admin', label: 'disable' });
    const { browser, token } = await signIn(admin);
    const viaCookie = await authFetch(browser, '/two-factor/disable', { body: { password: admin.password } });
    expect(viaCookie.status).toBe(403);
    const bearerOnly = new TestBrowser();
    bearerOnly.bearer = token;
    expect((await authFetch(bearerOnly, '/two-factor/disable', { body: { password: admin.password } })).status).toBe(403);
    expect((await userRow(admin.id))!.twoFactorEnabled).toBe(true);
  });

  it('turning 2FA on ends the other sessions, verifies the new one and is audited', async () => {
    const member = await createAccount({ role: 'user', twoFactor: false, label: 'enable' });
    const { browser } = await signIn(member);
    const other = await signIn(member);
    expect(await sessionCount(member.id)).toBe(2);

    const enabled = await authFetch(browser, '/two-factor/enable', { body: { password: member.password } });
    expect(enabled.status).toBe(200);
    const secret = secretFromTotpUri(String(enabled.data?.totpURI));
    expect(enabled.data?.backupCodes).toHaveLength(10);
    const verified = await authFetch(browser, '/two-factor/verify-totp', { body: { code: await totpCode(secret) } });
    expect(verified.status).toBe(200);

    expect((await userRow(member.id))!.twoFactorEnabled).toBe(true);
    expect(await sessionCount(member.id)).toBe(1);
    expect(await principalFromHeaders(cookieHeaders(other.browser))).toBeNull();
    const current = await principalFromHeaders(cookieHeaders(browser));
    expect(current?.user.twoFactorEnabled).toBe(true);
    expect(current?.session.twoFactorVerifiedAt).toBeInstanceOf(Date);
    const audit = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'auth.2fa.enable'), eq(auditLog.subjectId, member.id)));
    expect(audit).toHaveLength(1);
  });

  it("the admin plugin's HTTP endpoints are switched off, also for an admin", async () => {
    const admin = await createAccount({ role: 'admin', label: 'plugin' });
    const member = await createAccount({ label: 'plugin-target' });
    const { browser } = await signIn(admin);
    for (const path of ['/admin/set-role', '/admin/impersonate-user', '/admin/create-user', '/admin/list-users']) {
      const result = await authFetch(browser, path, { body: { userId: member.id, role: 'admin' } });
      expect(result.status, path).toBe(404);
    }
    expect((await userRow(member.id))!.role).toBe('user');
  });
});

describe('roles', () => {
  async function verifiedAdmin() {
    const admin = await createAccount({ role: 'admin', label: 'role-admin' });
    const { token } = await signIn(admin);
    return { admin, token, principal: (await principalFromHeaders(bearerHeaders(token)))! };
  }

  it('a staff role is not given to an account without 2FA', async () => {
    const { principal } = await verifiedAdmin();
    const member = await createAccount({ label: 'no-2fa' });
    for (const role of ['moderator', 'archivist', 'admin'] as const) {
      await expect(setUserRole(principal, { userId: member.id, role }, META)).rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED', status: 409 });
    }
    expect((await userRow(member.id))!.role).toBe('user');
  });

  it('a role change ends every session of the account, cookie and bearer, and is audited', async () => {
    const { principal, admin } = await verifiedAdmin();
    const member = await createAccount({ role: 'user', twoFactor: true, label: 'promote' });
    const cookieSession = await signIn(member);
    const bearerSession = await signIn(member);
    expect(await sessionCount(member.id)).toBe(2);

    const change = await setUserRole(principal, { userId: member.id, role: 'moderator', reason: 'demo' }, META);
    expect(change).toEqual({ userId: member.id, before: 'user', after: 'moderator', changed: true });
    expect(await sessionCount(member.id)).toBe(0);
    expect(await principalFromHeaders(cookieHeaders(cookieSession.browser))).toBeNull();
    expect(await principalFromHeaders(bearerHeaders(bearerSession.token))).toBeNull();
    const [audit] = await getDb().select().from(auditLog).where(and(eq(auditLog.action, 'role.change'), eq(auditLog.subjectId, member.id)));
    expect(audit).toMatchObject({ actorUserId: admin.id, actorRole: 'admin', before: { role: 'user' }, after: { role: 'moderator' } });
  });

  it('only an admin with a verified second factor changes roles, and never their own', async () => {
    const member = await createAccount({ role: 'user', twoFactor: true, label: 'target' });
    const moderator = await createAccount({ role: 'moderator', label: 'not-admin' });
    const moderatorPrincipal = await principalFromHeaders(bearerHeaders((await signIn(moderator)).token));
    await expect(setUserRole(moderatorPrincipal, { userId: member.id, role: 'archivist' }, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const admin = await createAccount({ role: 'admin', label: 'unverified-role-admin' });
    const unverified = await principalFromHeaders(bearerHeaders(await unverifiedSession(admin.id)));
    await expect(setUserRole(unverified, { userId: member.id, role: 'archivist' }, META)).rejects.toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });

    const { principal } = await verifiedAdmin();
    await expect(setUserRole(principal, { userId: principal.user.id, role: 'user' }, META)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(setUserRole(null, { userId: member.id, role: 'archivist' }, META)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await userRow(member.id))!.role).toBe('user');
  });
});

describe('oRPC', () => {
  it('a protected procedure accepts a cookie session and a bearer session and refuses a request without one', async () => {
    const member = await createAccount({ label: 'rpc' });
    const { browser, token } = await signIn(member);

    const viaCookie = await rpc('/account/me', { headers: new Headers({ cookie: browser.cookieHeader(), origin: TEST_APP_URL }), body: {} });
    expect(viaCookie.status).toBe(200);
    expect((await viaCookie.json()).json).toMatchObject({ user: { id: member.id, role: 'user' }, session: { via: 'cookie' }, person: null });

    const viaBearer = await rpc('/account/me', { headers: bearerHeaders(token), body: {} });
    expect(viaBearer.status).toBe(200);
    expect((await viaBearer.json()).json).toMatchObject({ user: { id: member.id }, session: { via: 'bearer' } });

    const anonymous = await rpc('/account/me', { body: {} });
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).json.code).toBe('UNAUTHORIZED');

    // The OpenAPI side, for the native client: the same procedure, the same rules.
    expect((await v1('/account/me', { headers: bearerHeaders(token) })).status).toBe(200);
    expect((await v1('/account/me', { headers: new Headers({ cookie: browser.cookieHeader() }) })).status).toBe(200);
    expect((await v1('/account/me')).status).toBe(401);
    expect((await v1('/account/me', { headers: bearerHeaders(`${token.slice(0, -4)}AAA=`) })).status).toBe(401);

    // The session is checked before the input: no field errors for a request without the right session.
    const malformed = { primaryName: 42, trainingStartYear: 'soon' };
    const anonymousChange = await v1('/account/onboard', { method: 'POST', body: malformed });
    expect(anonymousChange.status).toBe(401);
    expect(JSON.stringify(await anonymousChange.json())).not.toContain('fields');
    const memberSetRole = await v1('/admin/set-role', { method: 'POST', headers: bearerHeaders(token), body: { userId: 'x', role: 'god' } });
    expect(memberSetRole.status).toBe(403);
    expect(JSON.stringify(await memberSetRole.json())).not.toContain('fields');
  });

  it('refuses a cookie-authenticated change from another site (CSRF), and allows bearer requests', async () => {
    const member = await createAccount({ label: 'csrf' });
    const { browser, token } = await signIn(member);
    const body = { kinds: ['terms'] };
    const crossSite = await rpc('/consent/record', { headers: new Headers({ cookie: browser.cookieHeader(), origin: 'https://evil.example' }), body });
    expect(crossSite.status).toBe(403);
    const noOrigin = await rpc('/consent/record', { headers: new Headers({ cookie: browser.cookieHeader() }), body });
    expect(noOrigin.status).toBe(403);
    const sameSite = await rpc('/consent/record', { headers: new Headers({ cookie: browser.cookieHeader(), origin: TEST_APP_URL }), body });
    expect(sameSite.status).toBe(200);
    const bearer = await v1('/consent/record', { method: 'POST', headers: bearerHeaders(token), body: { kinds: ['privacy_ack'] } });
    expect(bearer.status).toBe(200);
    const rows = await getDb()
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'consent.grant'), eq(auditLog.subjectId, member.id), like(auditLog.requestId, '%')));
    expect(rows).toHaveLength(2);
  });
});
