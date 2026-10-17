// The rules of plan §3.2 inside Better Auth (milestone M02, In scope 2):
//
// hooks.before
//   /sign-up/email                 refused (400 CONSENT_REQUIRED) without the adult, terms and
//                                  authenticity ticks (DEFAULT D10).
//   /two-factor/verify-totp        `trustDevice` is dropped for staff: a staff account proves the
//   /two-factor/verify-backup-code second factor on every sign-in (the trust-device cookie would
//                                  skip it).
//   /two-factor/disable            refused for staff (a staff role needs 2FA).
// hooks.after
//   /two-factor/verify-totp        the session that proved the second factor gets
//   /two-factor/verify-backup-code two_factor_verified_at; requireStaff2FA() checks it.
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
import { eq } from 'drizzle-orm';

import { writeAudit } from '../audit';
import { getDb } from '../db';
import { authSession, authUser } from '../db/schema';
import { ConsentRequiredError, grantConsents, parseSignUpConsents } from '../services/consent';
import { requestMeta } from '../services/context';
import { ipHmac } from './ip';
import { isStaffRole } from './principal';

export const VERIFY_TOTP_PATH = '/two-factor/verify-totp';
export const VERIFY_BACKUP_CODE_PATH = '/two-factor/verify-backup-code';
const SECOND_FACTOR_PATHS = new Set([VERIFY_TOTP_PATH, VERIFY_BACKUP_CODE_PATH]);
/** The two-factor plugin's cookie for a sign-in waiting for its second factor. */
const TWO_FACTOR_COOKIE = 'two_factor';
const USER_AGENT_MAX = 512;
const IP_HMAC = /^[0-9a-f]{64}$/;

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

export const beforeHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path === '/sign-up/email') {
    try {
      parseSignUpConsents(bodyOf(ctx).consents);
    } catch (error) {
      if (error instanceof ConsentRequiredError) {
        throw new APIError('BAD_REQUEST', { code: error.code, message: error.message, missing: error.missing });
      }
      throw error;
    }
    return;
  }

  if (SECOND_FACTOR_PATHS.has(ctx.path)) {
    const body = bodyOf(ctx);
    if (!body.trustDevice) return;
    // trustDevice only matters for a sign-in waiting for its second factor (the endpoint ignores
    // it for a signed-in session). Kept only for an account that is certainly not staff.
    const user = await pendingSignInUser(ctx);
    if (user && !isStaffRole((user as { role?: unknown }).role)) return;
    return { context: { body: { ...body, trustDevice: false } } };
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

export const afterHook = createAuthMiddleware(async (ctx) => {
  if (!SECOND_FACTOR_PATHS.has(ctx.path)) return;
  const returned = ctx.context.returned;
  if (!returned || isAPIError(returned) || returned instanceof Response) return;
  // The sign-in flow and the enable flow create a new session (newSession); verifying inside an
  // existing session returns that session's token.
  const token = ctx.context.newSession?.session.token ?? (returned as { token?: unknown }).token;
  if (typeof token !== 'string' || token === '') return;
  await markSecondFactorVerified(token);
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

/** The session row stores the ip_hmac and a bounded user agent (plan §6.4). */
export async function beforeSessionCreate(session: { ipAddress?: string | null; userAgent?: string | null } & Record<string, unknown>) {
  const ip = session.ipAddress ?? null;
  return {
    data: {
      ...session,
      ipAddress: ip && IP_HMAC.test(ip) ? ip : ipHmac(ip || null),
      userAgent: session.userAgent ? session.userAgent.slice(0, USER_AGENT_MAX) : null,
    },
  };
}
