// The Next.js side of the accounts module (milestone M02): the principal of the current request,
// the page guard, and Better Auth calls from Server Actions with their cookies passed on to the
// browser. Only pages, layouts and Server Actions import this file (it reads next/headers).

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { type AuthCallInit, type AuthCallResult, callAuthEndpoint } from './endpoint';
import { checkRoute } from './guards';
import type { Principal } from './principal';
import { principalFromHeaders } from './session';

/** The principal of the current request, read once per request. */
export const getRequestPrincipal = cache(async (): Promise<Principal | null> => principalFromHeaders(await headers()));

/**
 * The guard of a protected page (ROUTE_POLICIES in guards.ts): the principal, or a redirect to
 * sign-in (no session) or to /account/security (a staff session without a verified second
 * factor). Any other refusal returns `{ forbidden: true }` and the page says so.
 */
export async function guardRoute(path: string): Promise<{ principal: Principal; forbidden?: never } | { forbidden: true }> {
  const decision = checkRoute(path, await getRequestPrincipal());
  if (decision.ok) {
    if (!decision.principal) redirect(`/sign-in?next=${encodeURIComponent(path)}`);
    return { principal: decision.principal };
  }
  if (decision.redirectTo) redirect(decision.redirectTo);
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
 * cookies it sets (session, two-factor challenge, sign-out) back to the browser.
 */
export async function authAction<T = unknown>(path: string, init: Omit<AuthCallInit, 'headers'> = {}): Promise<AuthCallResult<T>> {
  const result = await callAuthEndpoint<T>(path, { ...init, headers: await headers() });
  const jar = await cookies();
  for (const raw of result.setCookies) {
    const cookie = parseSetCookie(raw);
    if (cookie) jar.set(cookie.name, cookie.value, cookie.options);
  }
  return result;
}
