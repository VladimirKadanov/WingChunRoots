// Known browsers of an address (milestone M02 fix round 2; the "device cookie" of the OWASP
// authentication guidance against account lockout).
//
// The per-address sign-in lock (throttle.ts) stops a stranger from guessing a password from many
// client addresses, but on its own it also lets the stranger keep the owner out: ten wrong
// passwords every fifteen minutes and the right one is refused too. So a browser that has shown it
// knows the password of an address (a right password at sign-in) or owns its mailbox (a password
// reset from the e-mailed link) gets a signed, httpOnly cookie `wcr.known_device` naming the
// address and a random device id. Its password attempts count on a key of their own
// (signInDeviceKey: ten in a row lock that browser alone), and the address-wide lock does not
// apply to it. A stranger without the cookie still has the address-wide limit, and cannot forge
// the cookie: it is signed with BETTER_AUTH_SECRET.
//
// The cookie holds no address in clear: each entry is a keyed hash of the address (IP_HMAC_KEY)
// and the device id; up to five addresses per browser, the newest first. It lasts 180 days and is
// renewed by every right password. A native client keeps it like any other cookie of the auth
// endpoints (docs/adr/0004-auth.md, section 7).

import { generateRandomString } from 'better-auth/crypto';
import type { createAuthMiddleware } from 'better-auth/api';

import { normalizeAddress, signInDeviceKey, signInKey, throttleDigest } from './throttle';

export const KNOWN_DEVICE_COOKIE = 'known_device';
export const KNOWN_DEVICE_MAX_AGE_S = 180 * 24 * 3600;
const MAX_ENTRIES = 5;
const ENTRY = /^([0-9a-f]{24})-([A-Za-z0-9]{24})$/;

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

interface Entry {
  tag: string;
  device: string;
}

const addressTag = (email: string) => throttleDigest(`known-device:${normalizeAddress(email)}`).slice(0, 24);

async function entriesOf(ctx: HookContext): Promise<Entry[]> {
  const cookie = ctx.context.createAuthCookie(KNOWN_DEVICE_COOKIE);
  const value = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!value) return [];
  const entries: Entry[] = [];
  for (const raw of value.split('~')) {
    const match = ENTRY.exec(raw);
    if (match) entries.push({ tag: match[1]!, device: match[2]! });
  }
  return entries.slice(0, MAX_ENTRIES);
}

/** The device id of this request's browser for `email`, or null when the browser is not known for it. */
export async function knownDevice(ctx: HookContext, email: string): Promise<string | null> {
  const tag = addressTag(email);
  return (await entriesOf(ctx)).find((entry) => entry.tag === tag)?.device ?? null;
}

/** The throttle key of a password attempt for `email` from this request's browser. */
export async function passwordAttemptKey(ctx: HookContext, email: string): Promise<string> {
  const device = await knownDevice(ctx, email);
  return device ? signInDeviceKey(email, device) : signInKey(email);
}

/** Marks this request's browser as a known one for `email` (sets or renews the cookie). */
export async function rememberDevice(ctx: HookContext, email: string): Promise<void> {
  const tag = addressTag(email);
  const entries = await entriesOf(ctx);
  const device = entries.find((entry) => entry.tag === tag)?.device ?? generateRandomString(24, 'a-z', 'A-Z', '0-9');
  const next = [{ tag, device }, ...entries.filter((entry) => entry.tag !== tag)].slice(0, MAX_ENTRIES);
  const cookie = ctx.context.createAuthCookie(KNOWN_DEVICE_COOKIE, { maxAge: KNOWN_DEVICE_MAX_AGE_S });
  await ctx.setSignedCookie(cookie.name, next.map((entry) => `${entry.tag}-${entry.device}`).join('~'), ctx.context.secret, cookie.attributes);
}
