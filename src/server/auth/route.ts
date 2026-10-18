// The Better Auth HTTP API under /api/auth (milestone M02): sign-up, sign-in, e-mail confirmation,
// password reset and two-factor authentication, for the web forms (through Server Actions) and for
// a native client (bearer tokens in `set-auth-token` and `Authorization: Bearer`).
//
// Better Auth sees X-Forwarded-For as the one client address clientIp() resolved (ip.ts), so its
// rate limiter, the session's ip_hmac and the audit log agree, and a client cannot pick a new
// address per request by adding entries to the header.

import { getAuth } from './config';
import { withClientIp } from './ip';

/**
 * The request Better Auth handles: the same URL, method and body, with the resolved client address.
 * It is built from its parts, never as `new Request(request, …)`: the request Next.js hands a route
 * is not an instance of the runtime's own Request class, and on Node.js 24 that constructor reads
 * its private state and throws (every POST to /api/auth answered 500).
 */
export async function authRequest(request: Request): Promise<Request> {
  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
  return new Request(request.url, { method, headers: withClientIp(request.headers), body });
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  return getAuth().handler(await authRequest(request));
}
