// The Next.js side of the accounts module (milestone M02): the principal of the current request,
// the page guard, and Better Auth calls from Server Actions with their cookies passed on to the
// browser. Only pages, layouts and Server Actions import this file (it reads next/headers).

import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { type AuthCallInit, type AuthCallResult, callAuthEndpoint } from './endpoint';
import { checkRoute } from './guards';
import type { Principal } from './principal';
import { principalFromHeaders } from './session';

/** The principal of the current request, read once per request. */
export const getRequestPrincipal = cache(async (): Promise<Principal | null> => principalFromHeaders(await headers()));

export type RouteGuard =
  | { principal: Principal; redirectTo?: never; forbidden?: never }
  | { redirectTo: string; principal?: never; forbidden?: never }
  | { forbidden: true; principal?: never; redirectTo?: never };

/**
 * The guard of a protected page (ROUTE_POLICIES in guards.ts): the principal, or where to send
 * the visitor (sign-in without a session, /account/security for a staff session without a
 * verified second factor), which the page renders with <PageRedirect> rather than redirect()
 * (see page-redirect.tsx). Any other refusal returns `{ forbidden: true }` and the page says so.
 */
export async function guardRoute(path: string): Promise<RouteGuard> {
  const decision = checkRoute(path, await getRequestPrincipal());
  if (decision.ok) {
    if (!decision.principal) return { redirectTo: `/sign-in?next=${encodeURIComponent(path)}` };
    return { principal: decision.principal };
  }
  if (decision.redirectTo) return { redirectTo: decision.redirectTo };
  return { forbidden: true };
}

interface ParsedCookie {
  name: string;
  value: string;
  options: {
    path?: string;
    domain?: string;
    maxAge?: number;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
  };
}

/** One Set-Cookie value, as cookies().set() takes it. */
export function parseSetCookie(raw: string): ParsedCookie | null {
  const [pair, ...attributes] = raw.split(';');
  const eq = pair?.indexOf('=') ?? -1;
  if (!pair || eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  let value = pair.slice(eq + 1).trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep the raw value
  }
  const options: ParsedCookie['options'] = {};
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = rawKey?.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'path') options.path = val;
    else if (key === 'domain') options.domain = val;
    else if (key === 'max-age') options.maxAge = Number(val);
    else if (key === 'expires') options.expires = new Date(val);
    else if (key === 'httponly') options.httpOnly = true;
    else if (key === 'secure') options.secure = true;
    else if (key === 'samesite') {
      const v = val.toLowerCase();
      if (v === 'lax' || v === 'strict' || v === 'none') options.sameSite = v;
    }
  }
  return { name, value, options };
}

/**
 * Calls a Better Auth endpoint from a Server Action with the browser's cookies, and passes the
 * cookies it sets (session, two-factor challenge, sign-out) back to the browser. `anonymous`
 * leaves the session out, for a form that acts for any address rather than for the signed-in
 * account (asking for a new confirmation link).
 */
export async function authAction<T = unknown>(
  path: string,
  { anonymous = false, ...init }: Omit<AuthCallInit, 'headers'> & { anonymous?: boolean } = {},
): Promise<AuthCallResult<T>> {
  const forwarded = new Headers(await headers());
  if (anonymous) {
    forwarded.delete('cookie');
    forwarded.delete('authorization');
  }
  const result = await callAuthEndpoint<T>(path, { ...init, headers: forwarded });
  const jar = await cookies();
  for (const raw of result.setCookies) {
    const cookie = parseSetCookie(raw);
    if (cookie) jar.set(cookie.name, cookie.value, cookie.options);
  }
  return result;
}

/**
 * The principal of the session that a Better Auth call has just created (sign-in, the second
 * factor), read from the cookies it set: the browser sends them only with its next request, but
 * the action decides where to send it now.
 */
export async function principalFromSetCookies(setCookies: readonly string[]): Promise<Principal | null> {
  const pairs = setCookies
    .filter((raw) => !/;\s*max-age=0(;|$)/i.test(raw))
    .map((raw) => raw.split(';')[0]!.trim())
    .filter((pair) => pair.indexOf('=') > 0);
  if (pairs.length === 0) return null;
  return principalFromHeaders(new Headers({ cookie: pairs.join('; ') }));
}
