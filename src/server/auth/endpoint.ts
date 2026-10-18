// Calls a Better Auth endpoint the way an HTTP client would (milestone M02): through
// `auth.handler`, so the web forms get exactly what /api/auth gives a native client, including
// rate limiting, disabled paths, the origin check and the hooks. Server Actions use it through
// src/server/auth/web.ts; they are thin wrappers, never a second implementation (plan §6.8).

import { AUTH_BASE_PATH } from './config';
import { appUrl } from './env';
import { withClientIp } from './ip';
import { dispatchAuth } from './route';

/**
 * Request headers passed on from the browser's request. The session travels in the cookie; the
 * client address as the single address clientIp() resolved (ip.ts).
 */
const FORWARDED_HEADERS = ['cookie', 'user-agent', 'x-forwarded-for', 'x-request-id', 'accept-language'];

export interface AuthCallInit {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  /** The headers of the incoming request. */
  headers: Headers;
}

export interface AuthCallResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Better Auth's error code (`INVALID_EMAIL_OR_PASSWORD`, ...) when not ok. */
  code: string | null;
  /** The Set-Cookie values of the response, for the browser. */
  setCookies: string[];
}

export async function callAuthEndpoint<T = unknown>(path: string, init: AuthCallInit): Promise<AuthCallResult<T>> {
  const origin = appUrl();
  const url = new URL(`${AUTH_BASE_PATH}${path}`, origin);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
  const forwarded = withClientIp(init.headers);
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = forwarded.get(name);
    if (value) headers.set(name, value);
  }
  // Next.js has already checked that the Server Action came from this site (Origin against Host).
  headers.set('origin', origin);
  const method = init.method ?? 'POST';
  if (method === 'POST') headers.set('content-type', 'application/json');
  const request = new Request(url, { method, headers, body: method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined });
  const response = await dispatchAuth(request);
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const code =
    !response.ok && data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string'
      ? (data as { code: string }).code
      : response.ok
        ? null
        : `HTTP_${response.status}`;
  return { ok: response.ok, status: response.status, data: response.ok ? (data as T) : null, code, setCookies: response.headers.getSetCookie() };
}
