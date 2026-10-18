// The Better Auth HTTP API under /api/auth (milestone M02): sign-up, sign-in, e-mail confirmation,
// password reset and two-factor authentication, for the web forms (through Server Actions) and for
// a native client (bearer tokens in `set-auth-token` and `Authorization: Bearer`).
//
// Better Auth sees X-Forwarded-For as the one client address clientIp() resolved (ip.ts), so its
// rate limiter, the session's ip_hmac and the audit log agree, and a client cannot pick a new
// address per request by adding entries to the header.

import { answerFloorMs, waitForFloor } from './answer-floor';
import { AUTH_BASE_PATH, getAuth } from './config';
import { withClientIp } from './ip';
import { runAuthRequest } from './request-scope';

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

/**
 * Hands `request` to Better Auth in a request scope of its own (request-scope.ts): the only way in.
 * An answer that could tell whether an address has an account waits for its floor
 * (answer-floor.ts), on the forms' path and the HTTP API's alike.
 */
export async function dispatchAuth(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const response = await runAuthRequest(() => getAuth().handler(request));
  const pathname = new URL(request.url).pathname;
  const path = pathname.startsWith(AUTH_BASE_PATH) ? pathname.slice(AUTH_BASE_PATH.length) : pathname;
  await waitForFloor(answerFloorMs(path, response.status), startedAt);
  return response;
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  return dispatchAuth(await authRequest(request));
}
