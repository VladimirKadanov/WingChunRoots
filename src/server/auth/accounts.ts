// Who owns an address (milestone M02 fix round 1, finding H1: pre-registration takeover).
//
// The attack: someone signs up with another person's address and a password of their own. The
// owner later signs up too; Better Auth answers a duplicate sign-up like a new one (no account
// enumeration) and drops the second password, and when the owner then confirms the address from
// either e-mail, the first password still works: the account is the attacker's.
//
// The rules:
// - A sign-up with the address of an UNCONFIRMED account wipes that account's password and sends
//   the address a finish-sign-up e-mail: a password-reset link. Whoever controls the mailbox
//   chooses the password; nobody else ever holds a working one. Exception (fix round 2): the same
//   password as the account's is the person who created it signing up again (a double tap, an
//   e-mail that seemed slow): a fresh confirmation link, nothing wiped. The before hook (hooks.ts)
//   notes the match in the request scope; it is acted on only here, once Better Auth has accepted
//   the request (its body, the origin), so a request it refuses learns nothing and changes nothing.
// - A sign-up with the address of a CONFIRMED account changes nothing and sends the owner an
//   account-exists e-mail (sign in, or ask for a new password).
// - A password reset confirms the address: the link reached the mailbox.
// - A confirmation link is refused while the account has no password, and when it was issued
//   before the password last changed (its `iat` against auth_account.updated_at), so a link from
//   before a wipe or a reset never confirms an account someone else set up. This runs in
//   emailVerification.beforeEmailVerification, after Better Auth has checked the token's signature
//   and expiry and found the unconfirmed account (fix round 3, code-2: it used to run in the before
//   hook on the unchecked claims, so a forged token told whether an address had a pending account),
//   and it refuses with Better Auth's own answer to a bad token.
// - Confirming the address ends its sign-in lock: only the mailbox owner has the link, and the
//   right password of an unconfirmed account counts like a wrong one (hooks.ts, security-1).
// - Unconfirmed accounts are deleted after 7 days (src/server/services/retention.ts; a DEFAULT).
//
// What remains: the owner of an address who confirms an account they never created (from the
// unsolicited e-mail) confirms it for whoever created it. The e-mail says to ignore it when it
// was not expected, and the owner can take the account back at any time with a password reset,
// which ends every session.

import { APIError, createEmailVerificationToken } from 'better-auth/api';
import { and, eq } from 'drizzle-orm';

import { getDb } from '../db';
import { authAccount, authUser } from '../db/schema';
import { sendAccountExistsEmail, sendFinishSignUpEmail, sendVerificationEmail, VERIFY_EMAIL_EXPIRES_IN_S } from './emails';
import { authSecret } from './env';
import { requestScope } from './request-scope';
import { clear, signInKey } from './throttle';
import { confirmationClaims } from './tokens';

const CLOCK_SKEW_S = 5;

interface ExistingUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

/** emailAndPassword.onExistingUserSignUp: see the rules above. */
export async function onExistingUserSignUp({ user }: { user: ExistingUser }): Promise<void> {
  if (user.emailVerified) {
    await sendAccountExistsEmail(user);
    return;
  }
  if (requestScope()?.samePasswordUserId === user.id) {
    // sendVerificationEmail sends the finish-sign-up e-mail instead if the password has been
    // wiped in the meantime (a sign-up with another password).
    await sendVerificationEmail(user, await createEmailVerificationToken(authSecret(), user.email, undefined, VERIFY_EMAIL_EXPIRES_IN_S));
    return;
  }
  await getDb()
    .update(authAccount)
    .set({ password: null, updatedAt: new Date() })
    .where(and(eq(authAccount.userId, user.id), eq(authAccount.providerId, 'credential')));
  await sendFinishSignUpEmail(user);
}

/**
 * emailAndPassword.onPasswordReset: the link reached the mailbox, so the address is confirmed and
 * its sign-in lock ends; the after hook makes the browser a known one (the address travels in the
 * request scope).
 */
export async function onPasswordReset({ user }: { user: { id: string; email: string } }): Promise<void> {
  await getDb()
    .update(authUser)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(and(eq(authUser.id, user.id), eq(authUser.emailVerified, false)));
  await clear(signInKey(user.email));
  const scope = requestScope();
  if (scope) scope.resetEmail = user.email;
}

/** Better Auth's answer to a token it cannot use (verify-email's redirectOnError, INVALID_TOKEN). */
function invalidToken(callbackURL: string | null): APIError {
  const error = { message: 'Invalid token', code: 'INVALID_TOKEN' };
  if (!callbackURL) return new APIError('UNAUTHORIZED', error);
  // Better Auth's originCheck has accepted callbackURL before the endpoint ran (a root-relative path
  // or a trusted origin); the error goes on it the way appendQueryParams does.
  const relative = callbackURL.startsWith('/');
  const url = new URL(callbackURL, 'http://placeholder.invalid');
  url.searchParams.append('error', error.code);
  return new APIError('FOUND', undefined, new Headers({ location: relative ? url.href.slice(url.origin.length) : url.href }));
}

/**
 * emailVerification.beforeEmailVerification: Better Auth has verified the token (signature,
 * expiry) and found `user` unconfirmed; refuses the link while the account has no password, or when
 * the password changed after the link was issued. The token's `iat` is read from the request only
 * now that its signature is known to be good.
 */
export async function refuseStaleConfirmationLink(user: { id: string }, request?: Request): Promise<void> {
  const query = request ? new URL(request.url).searchParams : null;
  const token = query?.get('token');
  const iat = token ? confirmationClaims(token)?.iat : undefined;
  const [row] = await getDb()
    .select({ password: authAccount.password, changedAt: authAccount.updatedAt })
    .from(authAccount)
    .where(and(eq(authAccount.userId, user.id), eq(authAccount.providerId, 'credential')));
  const stale =
    typeof iat !== 'number' ||
    !row?.password ||
    // A few seconds of tolerance: the token's clock is the app's, updated_at may be the database's.
    Math.floor(row.changedAt.getTime() / 1000) > iat + CLOCK_SKEW_S;
  if (stale) throw invalidToken(query?.get('callbackURL') ?? null);
}

/** emailVerification.afterEmailVerification: the owner has the mailbox, so the address's sign-in lock ends. */
export async function onEmailVerified(user: { email: string }): Promise<void> {
  await clear(signInKey(user.email));
}
