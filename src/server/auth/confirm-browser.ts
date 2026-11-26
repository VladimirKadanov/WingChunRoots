// Signed in by "Confirm my address" in the browser that signed up (role replay 2026-11-25, P1-6,
// docs/adr/0069-sign-in-on-confirmation.md).
//
// Better Auth signs an account in when its address is confirmed for the first time
// (emailVerification.autoSignInAfterVerification): a second press of the same link confirms
// nothing and signs nobody in, so a link signs in once. That session is kept only in the browser
// that signed up: a sign-up leaves a cookie with a keyed hash of the address (never the address),
// and a confirmation in any other
// browser (a forwarded mail, a mail scanner, another device) has its new session deleted again and
// goes to the sign-in form, as before. A dropped session leaves no trace on the wire: its
// Set-Cookie entries are taken off the response, so a browser already signed in to another account
// stays signed in to it.

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { createAuthMiddleware } from 'better-auth/api';
import { expireCookie } from 'better-auth/cookies';

import { VERIFY_EMAIL_EXPIRES_IN_S } from './emails';
import { normalizeAddress } from './throttle';

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** The cookie of a sign-up: a keyed hash of the address it was for (prefixed like every auth cookie). */
export const CONFIRM_BROWSER_COOKIE = 'confirm_browser';

/** After an accepted sign-up: this browser may be signed in by the address's first confirmation. */
export async function markSignUpBrowser(ctx: HookContext, email: string): Promise<void> {
  const cookie = ctx.context.createAuthCookie(CONFIRM_BROWSER_COOKIE, { maxAge: VERIFY_EMAIL_EXPIRES_IN_S });
  ctx.setCookie(cookie.name, markOf(ctx, email), cookie.attributes);
}

function markOf(ctx: HookContext, email: string): string {
  return createHmac('sha256', ctx.context.secret).update(`confirm-browser:${normalizeAddress(email)}`).digest('base64url');
}

function sameMark(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * After /verify-email: a session the confirmation created stays only when this browser signed up
 * with that address; otherwise it is deleted and its cookies expire. The mark is used up either way.
 */
export async function keepConfirmationSessionInSignUpBrowser(ctx: HookContext): Promise<'kept' | 'dropped' | 'none'> {
  const created = ctx.context.newSession;
  if (!created) return 'none';
  const cookie = ctx.context.createAuthCookie(CONFIRM_BROWSER_COOKIE);
  const marked = ctx.getCookie(cookie.name);
  if (marked) expireCookie(ctx, cookie);
  if (marked && sameMark(marked, markOf(ctx, created.user.email))) return 'kept';
  await ctx.context.internalAdapter.deleteSession(created.session.token);
  const { sessionToken, sessionData, dontRememberToken } = ctx.context.authCookies;
  dropSetCookies(ctx, [sessionToken.name, sessionData.name, dontRememberToken.name]);
  ctx.context.setNewSession(null);
  return 'dropped';
}

/** Takes the response's pending Set-Cookie entries for these cookies (and their chunks) off it. */
function dropSetCookies(ctx: HookContext, names: readonly string[]): void {
  const scoped = ctx as HookContext & { responseHeaders?: Headers };
  const targets = new Set<Headers>();
  if (scoped.responseHeaders) targets.add(scoped.responseHeaders);
  if (ctx.context.responseHeaders) targets.add(ctx.context.responseHeaders);
  const ours = (entry: string) => names.some((name) => entry.startsWith(`${name}=`) || entry.startsWith(`${name}.`));
  for (const headers of targets) {
    const existing = headers.getSetCookie();
    const survivors = existing.filter((entry) => !ours(entry));
    if (survivors.length === existing.length) continue;
    headers.delete('set-cookie');
    for (const entry of survivors) headers.append('set-cookie', entry);
  }
}
