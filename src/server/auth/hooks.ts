// The rules of plan §3.2 inside Better Auth (milestone M02, In scope 2; fix round 1):
//
// hooks.before
//   /sign-up/email                 refused (400 CONSENT_REQUIRED) without the adult, terms and
//                                  authenticity ticks (DEFAULT D10); refused with a name or an image
//                                  (names live in the profile; no image URLs).
//   /sign-in/email                 refused (429 TOO_MANY_ATTEMPTS) after 10 failed sign-ins in a row
//                                  for the address (throttle.ts); the demo accounts cannot sign in on
//                                  a public deployment.
//   /verify-email                  a link older than the account's password, or of an account without
//                                  one, is refused (accounts.ts).
//   /two-factor/verify-totp        `trustDevice` is dropped for staff (the trust-device cookie would
//   /two-factor/verify-backup-code skip the second factor); a session that failed 10 times in a row
//                                  is locked for 15 minutes (the plugin locks only sign-ins); a TOTP
//                                  code works once (replay); a backup code is read in its stored form.
//   /two-factor/disable            refused for staff (a staff role needs 2FA).
// hooks.after
//   /sign-up/email                 the same body for a new and an existing address (no enumeration).
//   /sign-in/email                 counts failed passwords per address; a right password clears it.
//   /two-factor/verify-totp        the session that proved the second factor gets
//   /two-factor/verify-backup-code two_factor_verified_at (requireStaff2FA() checks it); failures
//                                  inside a session count toward its lock.
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

import { writeAudit } from '../audit';
import { getDb } from '../db';
import { authSession, authTwoFactor, authUser, emailDelivery } from '../db/schema';
import { ConsentRequiredError, grantConsents, parseSignUpConsents } from '../services/consent';
import { requestMeta } from '../services/context';
import { assertConfirmationLinkCurrent } from './accounts';
import { normalizeBackupCode } from './credentials';
import { isPublicDeployment } from './env';
import { clientIp, ipHmac } from './ip';
import { isStaffRole } from './principal';
import { claimOnce, clear, countOf, hit, SIGN_IN_FAILURE_LIMIT, SIGN_IN_LOCK_S, signInKey, TOTP_REPLAY_WINDOW_S, totpKey } from './throttle';

export const VERIFY_TOTP_PATH = '/two-factor/verify-totp';
export const VERIFY_BACKUP_CODE_PATH = '/two-factor/verify-backup-code';
const SECOND_FACTOR_PATHS = new Set([VERIFY_TOTP_PATH, VERIFY_BACKUP_CODE_PATH]);
/** The two-factor plugin's cookie for a sign-in waiting for its second factor. */
const TWO_FACTOR_COOKIE = 'two_factor';
const USER_AGENT_MAX = 512;
const IP_HMAC = /^[0-9a-f]{64}$/;
/** In-session second-factor failures in a row before the session's account is locked (like sign-in). */
const SESSION_2FA_FAILURE_LIMIT = 10;
const SESSION_2FA_LOCK_S = 15 * 60;
/** Addresses of the demo accounts (pnpm db:seed, tests); never on a public deployment. */
const DEMO_ADDRESS = /^demo-[a-z0-9-]+@example\.test$/i;

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

/** The account a second-factor request is for: the session's, or the sign-in's that waits for it. */
async function secondFactorUser(ctx: HookContext): Promise<{ id: string; role?: unknown; inSession: boolean } | null> {
  const session = await sessionOf(ctx);
  if (session) return { id: session.user.id, role: (session.user as { role?: unknown }).role, inSession: true };
  const pending = await pendingSignInUser(ctx);
  return pending ? { id: pending.id, role: (pending as { role?: unknown }).role, inSession: false } : null;
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
    return;
  }

  if (ctx.path === '/sign-in/email') {
    const email = bodyOf(ctx).email;
    if (typeof email !== 'string') return;
    if (DEMO_ADDRESS.test(email.trim()) && isPublicDeployment()) {
      refuse('UNAUTHORIZED', 'INVALID_EMAIL_OR_PASSWORD', 'Invalid email or password');
    }
    if ((await countOf(signInKey(email))) >= SIGN_IN_FAILURE_LIMIT) {
      refuse(
        'TOO_MANY_REQUESTS',
        'TOO_MANY_ATTEMPTS',
        'Too many failed sign-ins for this address. Try again in 15 minutes, or choose a new password.',
      );
    }
    return;
  }

  if (ctx.path === '/verify-email') {
    await assertConfirmationLinkCurrent((ctx.query as Record<string, unknown> | undefined)?.token);
    return;
  }

  if (SECOND_FACTOR_PATHS.has(ctx.path)) {
    const body = bodyOf(ctx);
    const user = await secondFactorUser(ctx);
    const changes: Record<string, unknown> = {};
    if (user?.inSession) {
      const [row] = await getDb()
        .select({ lockedUntil: authTwoFactor.lockedUntil })
        .from(authTwoFactor)
        .where(eq(authTwoFactor.userId, user.id));
      if (row?.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
        refuse('TOO_MANY_REQUESTS', 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many wrong codes. Try again in 15 minutes.');
      }
    }
    if (ctx.path === VERIFY_BACKUP_CODE_PATH && typeof body.code === 'string') changes.code = normalizeBackupCode(body.code);
    if (ctx.path === VERIFY_TOTP_PATH && user && typeof body.code === 'string' && /^\d{6}$/.test(body.code)) {
      // Claimed before the plugin checks it, so two requests with one code cannot both pass;
      // released by the after hook when the code was wrong.
      if (!(await claimOnce(totpKey(user.id, body.code), TOTP_REPLAY_WINDOW_S))) {
        refuse('UNAUTHORIZED', 'CODE_ALREADY_USED', 'This code has just been used. Wait for the next code in your app.');
      }
    }
    // trustDevice only matters for a sign-in waiting for its second factor (the endpoint ignores
    // it for a signed-in session). Kept only for an account that is certainly not staff.
    if (body.trustDevice && !(user && !user.inSession && !isStaffRole(user.role))) changes.trustDevice = false;
    if (Object.keys(changes).length > 0) return { context: { body: { ...body, ...changes } } };
    return;
  }

  if (ctx.path === '/two-factor/disable') {
    const session = await sessionOf(ctx);
    if (session && isStaffRole((session.user as { role?: unknown }).role)) {
      throw new APIError('FORBIDDEN', {
        code: 'STAFF_NEEDS_TWO_FACTOR',
        message: 'A staff account keeps two-factor authentication on.',
      });
    }
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
    if (typeof email !== 'string' || !returned || returned instanceof Response) return;
    const code = errorCode(returned);
    if (code === 'INVALID_EMAIL_OR_PASSWORD') await hit(signInKey(email), SIGN_IN_LOCK_S, SIGN_IN_FAILURE_LIMIT);
    // The password was right (signed in, or only the address is unconfirmed).
    else if (!isAPIError(returned) || code === 'EMAIL_NOT_VERIFIED') await clear(signInKey(email));
    return;
  }

  if (!SECOND_FACTOR_PATHS.has(ctx.path)) return;
  if (!returned || returned instanceof Response) return;
  if (isAPIError(returned)) {
    const code = errorCode(returned);
    if (code !== 'INVALID_CODE' && code !== 'INVALID_BACKUP_CODE') return;
    const user = await secondFactorUser(ctx);
    if (!user) return;
    const typed = bodyOf(ctx).code;
    if (ctx.path === VERIFY_TOTP_PATH && typeof typed === 'string') await clear(totpKey(user.id, typed));
    // The plugin counts the failures of a sign-in itself; these are the ones inside a session.
    if (user.inSession) await recordSessionSecondFactorFailure(user.id);
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

/** One more failed code inside a session; the tenth in a row locks the account for 15 minutes. */
async function recordSessionSecondFactorFailure(userId: string): Promise<void> {
  await getDb()
    .update(authTwoFactor)
    .set({
      failedVerificationCount: sql`${authTwoFactor.failedVerificationCount} + 1`,
      lockedUntil: sql`CASE WHEN ${authTwoFactor.failedVerificationCount} + 1 >= ${SESSION_2FA_FAILURE_LIMIT}
                            THEN now() + make_interval(secs => ${SESSION_2FA_LOCK_S})
                            ELSE ${authTwoFactor.lockedUntil} END`,
    })
    .where(eq(authTwoFactor.userId, userId));
}

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
