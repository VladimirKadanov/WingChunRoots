// Better Auth 1.7 (milestone M02; plan §3.2; docs/adr/0004-auth.md). One instance per process,
// created on first use so that `next build` never needs the secrets.
//
// - Drizzle adapter over the app_rw pool; tables auth_* (modelName); UUIDv7 ids from the app.
// - E-mail and password with verification (24 h) and password reset (1 h); sign-in needs a
//   confirmed address; a reset ends every session.
// - Rate limiting on in every environment (Better Auth turns it off outside production unless
//   asked), in memory: one `next start` process in Phase 1.
// - Plugins: twoFactor (TOTP and backup codes), admin (the role field, bans), bearer (the same
//   session in `Authorization: Bearer`, signed tokens only).
// - The admin plugin's HTTP endpoints, the e-mail OTP second factor and /update-user are switched
//   off (disabledPaths): roles change only through src/server/services/roles.ts, which checks 2FA
//   and writes the audit log; later milestones open what they need behind requireStaff2FA().
// - A duplicate sign-up wipes the password of an unconfirmed account and a reset confirms the
//   address (accounts.ts): only the owner of a mailbox ever holds a working password for it.

import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins/admin';
import { bearer } from 'better-auth/plugins/bearer';
import { twoFactor } from 'better-auth/plugins/two-factor';

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../../lib/account-limits';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { AUTH_TABLES } from '../db/schema';
import { onEmailVerified, onExistingUserSignUp, onPasswordReset, refuseStaleConfirmationLink } from './accounts';
import { BACKUP_CODE_COUNT, newBackupCodes } from './credentials';
import { invitationFromCallback, RESET_PASSWORD_EXPIRES_IN_S, sendPasswordResetEmail, sendVerificationEmail, VERIFY_EMAIL_EXPIRES_IN_S } from './emails';
import { appUrl, authSecret, trustedProxies } from './env';
import { afterHook, afterUserCreate, afterUserUpdate, beforeHook, beforeSessionCreate } from './hooks';
import { proxyList } from './ip';
import { logAuth, logAuthApiError } from './logger';

export const AUTH_BASE_PATH = '/api/auth';
export const COOKIE_PREFIX = 'wcr';
export const TOTP_ISSUER = 'WingChunRoots';

/** Endpoints that are not served over HTTP in M02 (404). */
export const DISABLED_AUTH_PATHS = [
  // The name and image of an account are not edited through Better Auth: names live in the
  // profile (person_name), and an account has no image (CHECK auth_user_no_image).
  '/update-user',
  // E-mail OTP as a second factor is not offered: TOTP and backup codes only.
  '/two-factor/send-otp',
  '/two-factor/verify-otp',
  // Hands out the account's TOTP secret for the password alone, which would let a session that
  // has not passed the second factor verify itself. The key of a new setup comes only from
  // /two-factor/enable, once (the web page keeps it sealed for its browser).
  '/two-factor/get-totp-uri',
  // Answers whether a password is right for any session, with no attempt counted: a stolen session
  // could guess the password through it. Nothing in the app needs it.
  '/verify-password',
  // Deleting an account is not offered yet (user.deleteUser is off, so it answers 404 anyway); it
  // takes the password, and would have to be one of the password-gated endpoints (hooks.ts).
  '/delete-user',
  // The admin plugin's endpoints: no user management over HTTP yet (see above).
  '/admin/set-role',
  '/admin/get-user',
  '/admin/create-user',
  '/admin/update-user',
  '/admin/list-users',
  '/admin/list-user-sessions',
  '/admin/unban-user',
  '/admin/ban-user',
  '/admin/impersonate-user',
  '/admin/stop-impersonating',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/admin/remove-user',
  '/admin/set-user-password',
  '/admin/has-permission',
];

export function createAuth() {
  const origin = appUrl();
  // Fails closed on a public deployment without TRUSTED_PROXIES (src/server/auth/env.ts), and on an
  // entry that is not an address or a CIDR range, before the first request needs the client address.
  proxyList(trustedProxies());
  return betterAuth({
    appName: TOTP_ISSUER,
    baseURL: origin,
    basePath: AUTH_BASE_PATH,
    secret: authSecret(),
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    logger: { level: 'warn', log: (level, message, ...args) => logAuth(level, message, ...args) },
    // The router would print unexpected errors through its own global logger, unredacted.
    onAPIError: { onError: (error) => logAuthApiError(error) },
    database: drizzleAdapter(getDb(), { provider: 'pg', schema: AUTH_TABLES, transaction: false }),
    user: { modelName: 'auth_user' },
    session: {
      modelName: 'auth_session',
      additionalFields: {
        twoFactorVerifiedAt: { type: 'date', required: false, input: false },
      },
    },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification', storeIdentifier: 'hashed' },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      database: { generateId: () => uuidv7() },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_EXPIRES_IN_S,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, token }) => sendPasswordResetEmail(user, token),
      // A duplicate sign-up and a password reset decide who owns the address (accounts.ts, H1).
      onExistingUserSignUp: ({ user }) => onExistingUserSignUp({ user }),
      onPasswordReset: ({ user }) => onPasswordReset({ user }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: VERIFY_EMAIL_EXPIRES_IN_S,
      // M10b: the link keeps the invitation a sign-up started from (the request's callbackURL).
      sendVerificationEmail: ({ user, token, url }) => sendVerificationEmail(user, token, invitationFromCallback(url)),
      // After Better Auth has checked the token: a link from before the password changed, or of an
      // account without one, is refused (accounts.ts); a confirmed address's sign-in lock ends.
      beforeEmailVerification: (user, request) => refuseStaleConfirmationLink(user, request),
      afterEmailVerification: (user) => onEmailVerified(user),
    },
    rateLimit: {
      enabled: true,
      storage: 'memory',
      customRules: {
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
      },
    },
    disabledPaths: DISABLED_AUTH_PATHS,
    hooks: { before: beforeHook, after: afterHook },
    databaseHooks: {
      user: { create: { after: afterUserCreate }, update: { after: afterUserUpdate } },
      session: { create: { before: beforeSessionCreate } },
    },
    plugins: [
      twoFactor({
        issuer: TOTP_ISSUER,
        schema: { twoFactor: { modelName: 'auth_two_factor' } },
        // Upper-case XXXX-XXXX codes without look-alike characters (credentials.ts); the before
        // hook reads a typed code in this form.
        backupCodeOptions: { amount: BACKUP_CODE_COUNT, customBackupCodesGenerate: newBackupCodes },
      }),
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      bearer({ requireSignature: true }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

// One instance per process; on globalThis so `next dev` reloads do not create more.
const globalAuth = globalThis as unknown as { __wcrAuth?: Auth };

export function getAuth(): Auth {
  globalAuth.__wcrAuth ??= createAuth();
  return globalAuth.__wcrAuth;
}
