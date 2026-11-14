// The Better Auth HTTP API under /api/auth (milestone M02): sign-up, sign-in, e-mail confirmation,
// password reset and two-factor authentication, for the web forms (through Server Actions) and for
// a native client (bearer tokens in `set-auth-token` and `Authorization: Bearer`).
//
// Better Auth sees X-Forwarded-For as the one client address clientIp() resolved (ip.ts), so its
// rate limiter, the session's ip_hmac and the audit log agree, and a client cannot pick a new
// address per request by adding entries to the header.
//
// The body is bounded (review 2026-11-13, auth.md 1; docs/adr/0029-safety-net.md): AUTH_BODY_MAX_BYTES,
// by the declared Content-Length first and then by counting the stream, before anything is buffered
// or handed to Better Auth. The largest legitimate body is a sign-up form (a few hundred bytes).

import { BodyTooLargeError, declaredLengthRefusal, payloadTooLarge, readBoundedOrThrow } from '../http-body';
import { answerFloorMs, waitForFloor } from './answer-floor';
import { AUTH_BASE_PATH, getAuth } from './config';
import { withClientIp } from './ip';
import { runAuthRequest } from './request-scope';

/**
 * The largest body /api/auth takes. DEFAULT review-2026-11: 64 KiB (docs/plan/questions/
 * review-2026-11-safety-net.md, Q3). The longest field is a password or a name of a few hundred
 * characters; a backup code, a TOTP code and a token are a few dozen.
 */
export const AUTH_BODY_MAX_BYTES = 64 * 1024;

const AUTH_BODY_MESSAGE = 'The request body is too large.';

/**
 * The request Better Auth handles: the same URL, method and body, with the resolved client address.
 * It is built from its parts, never as `new Request(request, …)`: the request Next.js hands a route
 * is not an instance of the runtime's own Request class, and on Node.js 24 that constructor reads
 * its private state and throws (every POST to /api/auth answered 500).
 *
 * The body is read through its stream, counting bytes: past AUTH_BODY_MAX_BYTES the read stops and
 * BodyTooLargeError is thrown (handleAuthRequest answers 413), however long the client says it is.
 */
export async function authRequest(request: Request): Promise<Request> {
  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBoundedOrThrow(request, AUTH_BODY_MAX_BYTES);
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
  // An honest, oversize Content-Length is refused without touching the stream.
  const method = request.method.toUpperCase();
  const refused = method === 'GET' || method === 'HEAD' ? null : declaredLengthRefusal(request, AUTH_BODY_MAX_BYTES, AUTH_BODY_MESSAGE);
  if (refused) return refused;
  let bounded: Request;
  try {
    bounded = await authRequest(request);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return payloadTooLarge(AUTH_BODY_MESSAGE);
    throw error;
  }
  return dispatchAuth(bounded);
}
