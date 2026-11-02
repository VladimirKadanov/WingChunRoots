// The HTTP side of the oRPC router (plan §6.8): RPCHandler at /api/rpc for the web client and
// OpenAPIHandler at /api/v1 for the future native app, both with the same router and context.
//
// CSRF (docs/adr/0004-auth.md): a request that changes something and carries cookies must come
// from this site: Origin equal to APP_URL, or, without an Origin header, Sec-Fetch-Site:
// same-origin. A request with `Authorization: Bearer <token>` is exempt: a browser cannot add that
// header to a cross-site request without a CORS preflight, and the app answers no preflight. Any
// other scheme is not (fix round 3, security-6): a browser attaches Basic or Negotiate credentials
// on its own, and the session would still come from the cookie. Next.js checks Server Actions
// itself (Origin against Host).
//
// A bearer request is read without its cookies (M08 review round 1, security-7): the exemption
// above holds only if its session can come from the token alone. Otherwise `Authorization: Bearer
// x` with a valid session cookie would skip the origin check and still be signed in by the cookie.
//
// A procedure that fails with anything but an expected answer (an ORPCError below 500: refused,
// not found, a field error) is logged in one line: the procedure, the error's name, the PostgreSQL
// code and the request id (M08 review round 1, security-6; ./failure-log.ts, which serverClient()
// uses too). Never the input, the principal, an address or the error's message, which can quote
// SQL parameters (CLAUDE.md §6).

import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { RPCHandler } from '@orpc/server/fetch';

import { appUrl } from '../auth/env';
import { PHOTO_MAX_BYTES } from '../db/schema/common';
import { createContext } from './context';
import { logProcedureFailure } from './failure-log';
import { router } from './router';

export { logProcedureFailure, procedureFailureLine } from './failure-log';

export const RPC_PREFIX = '/api/rpc';
export const OPENAPI_PREFIX = '/api/v1';

const rpcHandler = new RPCHandler(router, { clientInterceptors: [logProcedureFailure] });
const openApiHandler = new OpenAPIHandler(router, { clientInterceptors: [logProcedureFailure] });

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** The bearer session of a native client: the same test as session.ts. */
const BEARER = /^bearer\s/i;

/** null when the request may proceed; otherwise the reason it looks like a cross-site request. */
export function csrfRefusal(request: Request, origin: string = appUrl()): string | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  if (BEARER.test(request.headers.get('authorization') ?? '')) return null;
  if (!request.headers.has('cookie')) return null;
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin !== null) return requestOrigin === origin ? null : 'origin';
  return request.headers.get('sec-fetch-site') === 'same-origin' ? null : 'no-origin';
}

/** The headers the session is read from: without cookies for a bearer request (see the top). */
export function sessionHeaders(request: Request): Headers {
  if (!BEARER.test(request.headers.get('authorization') ?? '')) return request.headers;
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  return headers;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * M14: the largest multipart body a procedure takes: one profile photo (DEFAULT D07: 5 MB) and the
 * form's own bytes. Only photos.upload sends files.
 */
export const MULTIPART_MAX_BYTES = PHOTO_MAX_BYTES + 64 * 1024;

/**
 * M14: a request body is checked by its Content-Length BEFORE oRPC reads it, so a large or endless
 * body is never buffered. No procedure takes more than one photo, so any body above
 * MULTIPART_MAX_BYTES is 413, whatever its type. A body that is not JSON (multipart, an octet
 * stream, ...: oRPC reads those whole) also needs its Content-Length (411 without one). A JSON body
 * without a length (a chunked client) passes, as before M14. null when the request may proceed.
 */
export function bodyRefusal(request: Request): Response | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  const type = (request.headers.get('content-type') ?? '').trim();
  const value = (request.headers.get('content-length') ?? '').trim();
  const multipart = /^multipart\//i.test(type);
  if (value === '') {
    if (type === '' || /^application\/(?:[\w.+-]*\+)?json\b/i.test(type)) return null;
    return json(411, { code: 'LENGTH_REQUIRED', message: multipart ? 'Send the file with its size (Content-Length).' : 'Send the body with its size (Content-Length).' });
  }
  if (!/^\d{1,16}$/.test(value)) return json(400, { code: 'BAD_REQUEST', message: 'The Content-Length header is not a number.' });
  if (Number(value) > MULTIPART_MAX_BYTES) {
    return json(413, {
      code: 'PAYLOAD_TOO_LARGE',
      message: multipart ? `This photo is larger than ${PHOTO_MAX_BYTES / (1024 * 1024)} MB. Choose a smaller copy.` : 'The request body is too large.',
    });
  }
  return null;
}

export async function handleApiRequest(request: Request, api: 'rpc' | 'openapi'): Promise<Response> {
  if (csrfRefusal(request)) {
    return json(403, { code: 'CSRF', message: 'Cross-site request refused.' });
  }
  const refused = bodyRefusal(request);
  if (refused) {
    refused.headers.set('cache-control', 'private, no-store');
    return refused;
  }
  const context = await createContext(sessionHeaders(request));
  const result =
    api === 'rpc'
      ? await rpcHandler.handle(request, { prefix: RPC_PREFIX, context })
      : await openApiHandler.handle(request, { prefix: OPENAPI_PREFIX, context });
  if (!result.matched) return json(404, { code: 'NOT_FOUND', message: 'No such procedure.' });
  // Answers depend on the session: never stored by a shared cache.
  result.response.headers.set('cache-control', 'private, no-store');
  return result.response;
}
