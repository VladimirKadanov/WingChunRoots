// The rules of plan §3.2 inside Better Auth (milestone M02, In scope 2; fix rounds 1 and 2):
//
// hooks.before
//   /sign-up/email                 refused (400 CONSENT_REQUIRED) without the adult, terms and
//                                  authenticity ticks (DEFAULT D10); refused with a name or an image
//                                  (names live in the profile; no image URLs). Notes, for
//                                  accounts.ts, whether the password is the one of the unconfirmed
//                                  account with this address (a double tap, an e-mail that seemed
//                                  slow): one password check for every sign-up, so the time says
//                                  nothing. Nothing is decided here: the endpoint checks the request
//                                  first, and only a request it accepts reaches accounts.ts.
//   /sign-in/email                 reserves the attempt before the password is checked (throttle.ts),
//                                  refused (429 TOO_MANY_ATTEMPTS) once 10 in a row failed for the
//                                  address, or for this browser when it is a known one
//                                  (known-devices.ts); the demo accounts cannot sign in on a public
//                                  deployment (answered like a wrong password).
//   password-gated endpoints       /two-factor/enable, /two-factor/disable,
//                                  /two-factor/generate-backup-codes and /change-password reserve an
//                                  attempt on the same key, so a stolen session cannot guess the
//                                  password through them (/verify-password is not served; config.ts);
//                                  enable and new backup codes are refused (403
//                                  SECOND_FACTOR_REQUIRED) for a staff session that has not passed
//                                  the second factor: a password alone never verifies it.
//   /two-factor/verify-totp        `trustDevice` is dropped for staff (the trust-device cookie would
//   /two-factor/verify-backup-code skip the second factor); a TOTP code works once (replay); inside a
//                                  session the attempt is reserved first and refused once 10 in a row
//                                  failed (15 minutes; the plugin locks only sign-ins); a backup code
//                                  is read in its stored form. That lock is the account's, the one
//                                  the plugin checks at sign-in. A session that has already passed
//                                  the second factor is refused (400 SECOND_FACTOR_ALREADY_VERIFIED)
//                                  unless it confirms a pending setup: its codes would count on that
//                                  lock, and a stolen session could lock the owner's sign-in.
//   /two-factor/disable            refused for staff (a staff role needs 2FA).
//   Each reservation stays open in the request's scope (request-scope.ts) until the after hook
//   settles it, and is given back when the request ends without the after hook.
// hooks.after
//   /sign-up/email                 the same body for a new and an existing address (no enumeration).
//   /sign-in/email                 a wrong password keeps its reservation; a right one clears the key
//                                  and makes this browser a known one; anything else gives it back.
//                                  The right password of an unconfirmed account is answered and
//                                  counted like a wrong one (Better Auth has sent a new confirmation
//                                  link): otherwise a sign-up followed by a sign-in with the password
//                                  just chosen would tell a free address (403) from a taken one (401).
//   /reset-password                the browser that used the e-mailed link becomes a known one (the
//                                  address comes from onPasswordReset through the request scope).
//   password-gated endpoints       as for sign-in (INVALID_PASSWORD keeps the reservation); the
//                                  browser that changed the password stays a known one.
//   /two-factor/verify-totp        the session that proved the second factor gets
//   /two-factor/verify-backup-code two_factor_verified_at (requireStaff2FA() checks it); a wrong code
//                                  keeps the session's reservation, anything else gives it back; the
//                                  claim on a TOTP code is kept only when the code was accepted.
// databaseHooks
//   user.create.after              the sign-up ticks become consent_record rows (consent.grant).
//   user.update.after              auth.2fa.enable in the audit log.
//   session.create.before          ip_address holds the ip_hmac, never the address (plan §6.4).
//
// Ending every session on a role change and when 2FA is turned on is a database trigger
// (migration *_auth_roles_sessions), so it holds for every path, cookie and bearer alike.
//
// User hooks run before plugin hooks, so the bearer plugin has not yet turned an
// `Authorization: Bearer` header into a cookie when these run: sessionOf() reads both.

import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { setRequestCookie } from 'better-auth/cookies/utils';
import { and, eq, gt, sql } from 'drizzle-orm';

import { MAX_PASSWORD_LENGTH } from '../../lib/account-limits';
import { writeAudit } from '../audit';
import { getDb } from '../db';
import { authAccount, authSession, authTwoFactor, authUser, emailDelivery } from '../db/schema';
import { ConsentRequiredError, grantConsents, parseSignUpConsents } from '../services/consent';
import { requestMeta } from '../services/context';
import { normalizeBackupCode } from './credentials';
import { isPublicDeployment } from './env';
import { clientIp, ipHmac } from './ip';
import { passwordAttemptKey, rememberDevice } from './known-devices';
import { isStaffRole } from './principal';
import { hold, requestScope, settle } from './request-scope';
import { claimOnce, clear, release, reserve, SIGN_IN_FAILURE_LIMIT, SIGN_IN_LOCK_S, TOTP_REPLAY_WINDOW_S, totpKey } from './throttle';

export const VERIFY_TOTP_PATH = '/two-factor/verify-totp';
export const VERIFY_BACKUP_CODE_PATH = '/two-factor/verify-backup-code';
const SECOND_FACTOR_PATHS = new Set([VERIFY_TOTP_PATH, VERIFY_BACKUP_CODE_PATH]);
/**
 * Endpoints of a signed-in session that check the account's password: src/server/rpc/api-parity.test.ts
 * keeps the list complete, hardening-lockout.int.test.ts tests what they count.
 */
export const PASSWORD_GATED_PATHS = new Set(['/two-factor/enable', '/two-factor/disable', '/two-factor/generate-backup-codes', '/change-password']);
/** Of those, the ones that hand out a second factor: a staff session must have passed it first. */
const SECOND_FACTOR_ISSUING_PATHS = new Set(['/two-factor/enable', '/two-factor/generate-backup-codes']);
/** The two-factor plugin's cookie for a sign-in waiting for its second factor. */
const TWO_FACTOR_COOKIE = 'two_factor';
const USER_AGENT_MAX = 512;
const IP_HMAC = /^[0-9a-f]{64}$/;
/** In-session second-factor failures in a row before the session's account is locked (like sign-in). */
const SESSION_2FA_FAILURE_LIMIT = 10;
const SESSION_2FA_LOCK_S = 15 * 60;
/** Addresses of the demo accounts (pnpm db:seed, tests); never on a public deployment. */
const DEMO_ADDRESS = /^demo-[a-z0-9-]+@example\.test$/i;
const TOO_MANY_ATTEMPTS = 'Too many wrong passwords for this address. Try again in 15 minutes, or choose a new password.';

/** Better Auth's answer to a wrong password, byte for byte (APIError.from keeps message before code). */
const WRONG_PASSWORD = { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' };
const wrongPassword = () => new APIError('UNAUTHORIZED', WRONG_PASSWORD);
/**
 * The same answer from an after hook. An APIError thrown there would keep the endpoint's status
 * (better-call answers with the status the endpoint refused with), so the hook hands back the
 * response itself: 401, the same JSON body and content type.
 */
const wrongPasswordResponse = () =>
  new Response(JSON.stringify(WRONG_PASSWORD), { status: 401, statusText: 'UNAUTHORIZED', headers: { 'content-type': 'application/json' } });

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
type DbHookContext = { path?: string; body?: unknown; headers?: Headers; request?: Request } | null;

/** The session of a hook's request, from the session cookie or from `Authorization: Bearer`. */
async function sessionOf(ctx: HookContext) {
  const source = ctx.headers ?? ctx.request?.headers;
  if (!source) return null;
  const headers = new Headers(source);
  const authorization = headers.get('authorization');
  if (authorization && authorization.slice(0, 7).toLowerCase() === 'bearer ') {
    const token = authorization.slice(7).trim();
    // The bearer plugin runs with requireSignature: the token is the signed cookie value.
    if (token.includes('.')) setRequestCookie(headers, ctx.context.authCookies.sessionToken.name, decodeToken(token));
  }
  return getSessionFromCtx({ ...ctx, headers } as HookContext, { disableRefresh: true });
}

function decodeToken(token: string): string {
  try {
    return token.includes('%') ? decodeURIComponent(token) : token;
  } catch {
    return token;
  }
}

/** The account of a sign-in that waits for its second factor (the signed two_factor cookie). */
async function pendingSignInUser(ctx: HookContext) {
  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!identifier) return null;
  const verification = await ctx.context.internalAdapter.findVerificationValue(identifier);
  if (!verification) return null;
  return ctx.context.internalAdapter.findUserById(verification.value);
}

function bodyOf(ctx: HookContext): Record<string, unknown> {
  return ctx.body && typeof ctx.body === 'object' ? (ctx.body as Record<string, unknown>) : {};
}

function refuse(status: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS', code: string, message: string): never {
  throw new APIError(status, { code, message });
}

interface SecondFactorUser {
  id: string;
  role?: unknown;
  inSession: boolean;
  /** A signed-in session that has already passed the second factor (two_factor_verified_at). */
  verified: boolean;
}

/** The account a second-factor request is for: the session's, or the sign-in's that waits for it. */
async function secondFactorUser(ctx: HookContext): Promise<SecondFactorUser | null> {
  const session = await sessionOf(ctx);
  if (session) {
    const verifiedAt = (session.session as { twoFactorVerifiedAt?: unknown }).twoFactorVerifiedAt;
    return { id: session.user.id, role: (session.user as { role?: unknown }).role, inSession: true, verified: Boolean(verifiedAt) };
  }
  const pending = await pendingSignInUser(ctx);
  return pending ? { id: pending.id, role: (pending as { role?: unknown }).role, inSession: false, verified: false } : null;
}

/** Whether the account has a TOTP setup that waits for its first code (/two-factor/enable). */
async function hasPendingSetup(userId: string): Promise<boolean> {
  const [row] = await getDb().select({ verified: authTwoFactor.verified }).from(authTwoFactor).where(eq(authTwoFactor.userId, userId));
  return row?.verified === false;
}

/** Reserves a password attempt for `email` from this browser, or refuses with 429 when it is locked. */
async function reservePasswordAttempt(ctx: HookContext, email: string): Promise<void> {
  const key = await passwordAttemptKey(ctx, email);
  if (!(await reserve(key, SIGN_IN_LOCK_S, SIGN_IN_FAILURE_LIMIT))) {
    refuse('TOO_MANY_REQUESTS', 'TOO_MANY_ATTEMPTS', TOO_MANY_ATTEMPTS);
  }
  hold('password', key, () => release(key));
}

function succeeded(returned: unknown): boolean {
  return returned !== undefined && !(returned instanceof Response) && !isAPIError(returned);
}

/**
 * Settles the password attempt the before hook reserved: a refusal in `counted` (a wrong password)
 * keeps it, success clears the key, anything else gives it back. True when the request succeeded
 * with the right password.
 */
async function settlePasswordAttempt(
  ctx: HookContext,
  /** The key outside a request scope, where nothing was held. */
  keyOf: () => Promise<string | null>,
  counted: ReadonlySet<string>,
): Promise<boolean> {
  const held = settle('password');
  const key = held === undefined ? await keyOf() : held;
  if (key === null) return false;
  const returned = ctx.context.returned;
  const code = errorCode(returned);
  if (code !== null && counted.has(code)) return false;
  if (succeeded(returned)) {
    await clear(key);
    return true;
  }
  await release(key);
  return false;
}

/**
 * The sign-in refusals that count toward the lock: a wrong password, and the right password of an
 * unconfirmed account, which is answered like a wrong one (security-1): if it cleared or gave back
 * the attempt, ten sign-ins with the password just chosen would lock a taken address and never a
 * free one. The lock of the address ends when its owner confirms it (accounts.ts).
 */
const SIGN_IN_COUNTED = new Set(['INVALID_EMAIL_OR_PASSWORD', 'EMAIL_NOT_VERIFIED']);
const SESSION_PASSWORD_COUNTED = new Set(['INVALID_PASSWORD']);

let dummyHash: Promise<string> | undefined;

/**
 * The id of the unconfirmed account with `email` whose password is `password`, or null. Every
 * sign-up pays for exactly one password check (against a made-up hash when there is no such
 * account), so the time of the answer says nothing about the address. The address is matched the
 * way Better Auth stores it (lower case, nothing trimmed).
 */
async function unconfirmedWithPassword(ctx: HookContext, email: string, password: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: authUser.id, emailVerified: authUser.emailVerified, hash: authAccount.password })
    .from(authUser)
    .leftJoin(authAccount, and(eq(authAccount.userId, authUser.id), eq(authAccount.providerId, 'credential')))
    .where(eq(authUser.email, email.toLowerCase()));
  const candidate = row && !row.emailVerified && row.hash ? row : null;
  dummyHash ??= ctx.context.password.hash('a password that no account has, for an even time');
  const hash = candidate?.hash ?? (await dummyHash);
  const same = await ctx.context.password.verify({ hash, password }).catch(() => false);
  return candidate && same ? candidate.id : null;
}

/**
 * The second-factor attempt of a signed-in session, reserved before the code is checked: false
 * when the account's second factor is locked (10 in a row failed). One UPDATE, so a burst of
 * parallel codes gets no more checks than the limit. An account without a second factor is left
 * to the plugin.
 */
async function reserveSessionSecondFactor(userId: string): Promise<boolean> {
  const fresh = sql`(${authTwoFactor.lockedUntil} IS NOT NULL AND ${authTwoFactor.lockedUntil} <= now())`;
  const next = sql`CASE WHEN ${fresh} THEN 1 ELSE ${authTwoFactor.failedVerificationCount} + 1 END`;
  const reserved = await getDb()
    .update(authTwoFactor)
    .set({
      failedVerificationCount: next,
      lockedUntil: sql`CASE WHEN ${next} >= ${SESSION_2FA_FAILURE_LIMIT} THEN now() + make_interval(secs => ${SESSION_2FA_LOCK_S})
                            WHEN ${fresh} THEN NULL
                            ELSE ${authTwoFactor.lockedUntil} END`,
    })
    .where(and(eq(authTwoFactor.userId, userId), sql`(${authTwoFactor.lockedUntil} IS NULL OR ${authTwoFactor.lockedUntil} <= now())`))
    .returning({ id: authTwoFactor.id });
  if (reserved.length > 0) return true;
  const [row] = await getDb().select({ id: authTwoFactor.id }).from(authTwoFactor).where(eq(authTwoFactor.userId, userId));
  return row === undefined;
}

/** Gives back a reserved in-session attempt whose outcome was not a wrong code. */
async function releaseSessionSecondFactor(userId: string): Promise<void> {
  const next = sql`GREATEST(${authTwoFactor.failedVerificationCount} - 1, 0)`;
  await getDb()
    .update(authTwoFactor)
    .set({
      failedVerificationCount: next,
      lockedUntil: sql`CASE WHEN ${next} < ${SESSION_2FA_FAILURE_LIMIT} THEN NULL ELSE ${authTwoFactor.lockedUntil} END`,
    })
    .where(and(eq(authTwoFactor.userId, userId), gt(authTwoFactor.failedVerificationCount, 0)));
}

export const beforeHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path === '/sign-up/email') {
    const body = bodyOf(ctx);
    try {
      parseSignUpConsents(body.consents);
    } catch (error) {
      if (error instanceof ConsentRequiredError) {
        throw new APIError('BAD_REQUEST', { code: error.code, message: error.message, missing: error.missing });
      }
      throw error;
    }
    if (typeof body.name === 'string' && body.name.trim() !== '') {
      refuse('BAD_REQUEST', 'NAME_NOT_ACCEPTED', 'Send an empty name; names are added in the profile after sign-up.');
    }
    if (body.image !== undefined && body.image !== null) refuse('BAD_REQUEST', 'IMAGE_NOT_ACCEPTED', 'An account has no image.');
    if (typeof body.email === 'string' && typeof body.password === 'string' && body.password.length <= MAX_PASSWORD_LENGTH) {
      const same = await unconfirmedWithPassword(ctx, body.email, body.password);
      // Only noted: onExistingUserSignUp acts on it once the endpoint has accepted the request.
      const scope = requestScope();
      if (same && scope) scope.samePasswordUserId = same;
    }
    return;
  }

  if (ctx.path === '/sign-in/email') {
    const email = bodyOf(ctx).email;
    if (typeof email !== 'string') return;
    if (DEMO_ADDRESS.test(email.trim()) && isPublicDeployment()) throw wrongPassword();
    await reservePasswordAttempt(ctx, email);
    return;
  }

  if (PASSWORD_GATED_PATHS.has(ctx.path)) {
    const session = await sessionOf(ctx);
    if (!session) return;
    const staff = isStaffRole((session.user as { role?: unknown }).role);
    if (ctx.path === '/two-factor/disable' && staff) {
      refuse('FORBIDDEN', 'STAFF_NEEDS_TWO_FACTOR', 'A staff account keeps two-factor authentication on.');
    }
    const verifiedAt = (session.session as { twoFactorVerifiedAt?: unknown }).twoFactorVerifiedAt;
    if (SECOND_FACTOR_ISSUING_PATHS.has(ctx.path) && staff && !verifiedAt) {
      refuse('FORBIDDEN', 'SECOND_FACTOR_REQUIRED', 'Confirm this session with your authenticator app first.');
    }
    await reservePasswordAttempt(ctx, session.user.email);
    return;
  }

  if (SECOND_FACTOR_PATHS.has(ctx.path)) {
    const body = bodyOf(ctx);
    const user = await secondFactorUser(ctx);
    // Nothing to prove for a session that has passed the second factor, except a new setup's first
    // code. Refused before anything is claimed or counted (fix round 3, code-3).
    if (user?.verified && !(await hasPendingSetup(user.id))) {
      refuse('BAD_REQUEST', 'SECOND_FACTOR_ALREADY_VERIFIED', 'This session has already passed the second factor.');
    }
    const changes: Record<string, unknown> = {};
    if (ctx.path === VERIFY_BACKUP_CODE_PATH && typeof body.code === 'string') changes.code = normalizeBackupCode(body.code);
    const claim = ctx.path === VERIFY_TOTP_PATH && user && typeof body.code === 'string' && /^\d{6}$/.test(body.code) ? totpKey(user.id, body.code) : null;
    // Claimed before the plugin checks it, so two requests with one code cannot both pass; held at
    // once, before any other await, so a request that ends early gives it back, and the after hook
    // keeps it only when the code was accepted (code-4). Not counted as an attempt.
    if (claim && !(await claimOnce(claim, TOTP_REPLAY_WINDOW_S))) {
      refuse('UNAUTHORIZED', 'CODE_ALREADY_USED', 'This code has just been used. Wait for the next code in your app.');
    }
    if (claim) hold('totp-claim', claim, () => clear(claim));
    if (user?.inSession && !(await reserveSessionSecondFactor(user.id))) {
      if (claim) {
        settle('totp-claim');
        await clear(claim);
      }
      refuse('TOO_MANY_REQUESTS', 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many wrong codes. Try again in 15 minutes.');
    }
    if (user?.inSession) {
      const userId = user.id;
      hold('second-factor', userId, () => releaseSessionSecondFactor(userId));
    }
    // trustDevice only matters for a sign-in waiting for its second factor (the endpoint ignores
    // it for a signed-in session). Kept only for an account that is certainly not staff.
    if (body.trustDevice && !(user && !user.inSession && !isStaffRole(user.role))) changes.trustDevice = false;
    if (Object.keys(changes).length > 0) return { context: { body: { ...body, ...changes } } };
    return;
  }
});

function errorCode(returned: unknown): string | null {
  if (!isAPIError(returned)) return null;
  const code = (returned.body as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

export const afterHook = createAuthMiddleware(async (ctx) => {
  const returned = ctx.context.returned;

  if (ctx.path === '/sign-up/email') {
    // Better Auth answers a duplicate address with a made-up user whose fields differ from a real
    // one (role, for one); one constant body for every accepted sign-up reveals nothing.
    if (returned && !isAPIError(returned) && !(returned instanceof Response)) return ctx.json({ token: null, user: null });
    return;
  }

  if (ctx.path === '/sign-in/email') {
    const email = bodyOf(ctx).email;
    if (typeof email !== 'string') return;
    const right = await settlePasswordAttempt(ctx, () => passwordAttemptKey(ctx, email), SIGN_IN_COUNTED);
    if (right) await rememberDevice(ctx, email);
    // Better Auth has sent the unconfirmed account a new confirmation link; the answer is the one
    // of a wrong password, so a sign-up and a sign-in together tell nothing about the address.
    if (errorCode(returned) === 'EMAIL_NOT_VERIFIED') return wrongPasswordResponse();
    return;
  }

  if (ctx.path === '/reset-password') {
    // The mailbox owner. The new password has ended every earlier known browser of the account,
    // and onPasswordReset has cleared the address-wide lock.
    const email = requestScope()?.resetEmail;
    if (email && succeeded(returned)) await rememberDevice(ctx, email);
    return;
  }

  if (PASSWORD_GATED_PATHS.has(ctx.path)) {
    const keyOf = async () => {
      const session = await sessionOf(ctx);
      return session ? passwordAttemptKey(ctx, session.user.email) : null;
    };
    const right = await settlePasswordAttempt(ctx, keyOf, SESSION_PASSWORD_COUNTED);
    // A new password ends the account's known browsers; the one that chose it stays known.
    const email = (returned as { user?: { email?: unknown } } | undefined)?.user?.email;
    if (right && ctx.path === '/change-password' && typeof email === 'string') await rememberDevice(ctx, email);
    return;
  }

  if (!SECOND_FACTOR_PATHS.has(ctx.path)) return;
  // Settled here, whatever the outcome.
  const claim = settle('totp-claim');
  const reserved = settle('second-factor');
  if (!succeeded(returned)) {
    const code = errorCode(returned);
    const wrong = code === 'INVALID_CODE' || code === 'INVALID_BACKUP_CODE';
    // A code that was not accepted, for whatever reason (wrong, too many tries in this challenge, a
    // locked account, an expired challenge), stays usable: only an accepted code is used up.
    if (claim) await clear(claim);
    // A wrong code inside a session keeps its reservation (the plugin counts those of a sign-in).
    if (reserved && !wrong) await releaseSessionSecondFactor(reserved);
    if (claim !== undefined) return;
    // Outside a request scope: work out what the before hook reserved.
    const user = await secondFactorUser(ctx);
    if (!user) return;
    const typed = bodyOf(ctx).code;
    if (ctx.path === VERIFY_TOTP_PATH && typeof typed === 'string' && /^\d{6}$/.test(typed)) await clear(totpKey(user.id, typed));
    if (user.inSession && !wrong) await releaseSessionSecondFactor(user.id);
    return;
  }
  // The sign-in flow and the enable flow create a new session (newSession); verifying inside an
  // existing session returns that session's token.
  const token = ctx.context.newSession?.session.token ?? (returned as { token?: unknown }).token;
  if (typeof token !== 'string' || token === '') return;
  await markSecondFactorVerified(token);
  const userId = (returned as { user?: { id?: unknown } }).user?.id;
  if (typeof userId === 'string') {
    await getDb()
      .update(authTwoFactor)
      .set({ failedVerificationCount: 0, lockedUntil: null })
      .where(and(eq(authTwoFactor.userId, userId), gt(authTwoFactor.failedVerificationCount, 0)));
  }
});

/** two_factor_verified_at = now() for the session with `token`. */
export async function markSecondFactorVerified(token: string): Promise<void> {
  const now = new Date();
  await getDb().update(authSession).set({ twoFactorVerifiedAt: now, updatedAt: now }).where(eq(authSession.token, token));
}

/** Records the sign-up ticks; a sign-up whose consents cannot be stored is undone. */
export async function afterUserCreate(user: { id: string; role?: unknown }, ctx: DbHookContext): Promise<void> {
  if (ctx?.path !== '/sign-up/email') return;
  const body = ctx.body && typeof ctx.body === 'object' ? (ctx.body as Record<string, unknown>) : {};
  const headers = ctx.headers ?? ctx.request?.headers ?? new Headers();
  try {
    const kinds = parseSignUpConsents(body.consents);
    await getDb().transaction((tx) => grantConsents(tx, user.id, 'user', kinds, requestMeta(headers)));
  } catch (error) {
    // The Drizzle adapter runs without a transaction, so the account row is already committed;
    // removing it lets the person sign up again instead of leaving an account without consents.
    // A confirmation e-mail already queued for it goes too (its job finds no delivery and stops).
    await getDb().delete(emailDelivery).where(and(eq(emailDelivery.userId, user.id), eq(emailDelivery.status, 'queued')));
    await getDb().delete(authUser).where(eq(authUser.id, user.id));
    throw error;
  }
}

export async function afterUserUpdate(
  user: { id: string; role?: unknown; twoFactorEnabled?: unknown },
  ctx: DbHookContext,
): Promise<void> {
  if (!ctx?.path || !SECOND_FACTOR_PATHS.has(ctx.path) || user.twoFactorEnabled !== true) return;
  // In these two endpoints the only user update is the one that turns 2FA on (the enable flow).
  const meta = requestMeta(ctx.headers ?? ctx.request?.headers ?? new Headers());
  await writeAudit(getDb(), {
    action: 'auth.2fa.enable',
    actorUserId: user.id,
    actorRole: typeof user.role === 'string' ? user.role : null,
    subjectType: 'user',
    subjectId: user.id,
    after: { twoFactorEnabled: true },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
}

/**
 * The session row stores the ip_hmac and a bounded user agent (plan §6.4). The address comes from
 * the request through clientIp(), like the audit log (requestMeta), so one client has one ip_hmac
 * in both; Better Auth's own address (normalised, IPv6 cut to /64) is used only without a request.
 */
export async function beforeSessionCreate(
  session: { ipAddress?: string | null; userAgent?: string | null } & Record<string, unknown>,
  ctx?: DbHookContext,
) {
  const headers = ctx?.headers ?? ctx?.request?.headers;
  const ip = headers ? clientIp(new Headers(headers)) : (session.ipAddress ?? null);
  return {
    data: {
      ...session,
      ipAddress: ip && IP_HMAC.test(ip) ? ip : ipHmac(ip || null),
      userAgent: session.userAgent ? session.userAgent.slice(0, USER_AGENT_MAX) : null,
    },
  };
}
