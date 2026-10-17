// The HTTP side of the oRPC router (plan §6.8): RPCHandler at /api/rpc for the web client and
// OpenAPIHandler at /api/v1 for the future native app, both with the same router and context.
//
// CSRF (docs/adr/0004-auth.md): a request that changes something and carries cookies must come
// from this site: Origin equal to APP_URL, or, without an Origin header, Sec-Fetch-Site:
// same-origin. A request with an Authorization header is exempt: a browser cannot add that header
// to a cross-site request without a CORS preflight, and the app answers no preflight. Next.js
// checks Server Actions itself (Origin against Host).

import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { RPCHandler } from '@orpc/server/fetch';

import { appUrl } from '../auth/env';
import { createContext } from './context';
import { router } from './router';

export const RPC_PREFIX = '/api/rpc';
export const OPENAPI_PREFIX = '/api/v1';

const rpcHandler = new RPCHandler(router);
const openApiHandler = new OpenAPIHandler(router);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** null when the request may proceed; otherwise the reason it looks like a cross-site request. */
export function csrfRefusal(request: Request, origin: string = appUrl()): string | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  if (request.headers.has('authorization')) return null;
  if (!request.headers.has('cookie')) return null;
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin !== null) return requestOrigin === origin ? null : 'origin';
  return request.headers.get('sec-fetch-site') === 'same-origin' ? null : 'no-origin';
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export async function handleApiRequest(request: Request, api: 'rpc' | 'openapi'): Promise<Response> {
  if (csrfRefusal(request)) {
    return json(403, { code: 'CSRF', message: 'Cross-site request refused.' });
  }
  const context = await createContext(request.headers);
  const result =
    api === 'rpc'
      ? await rpcHandler.handle(request, { prefix: RPC_PREFIX, context })
      : await openApiHandler.handle(request, { prefix: OPENAPI_PREFIX, context });
  if (!result.matched) return json(404, { code: 'NOT_FOUND', message: 'No such procedure.' });
  // Answers depend on the session: never stored by a shared cache.
  result.response.headers.set('cache-control', 'private, no-store');
  return result.response;
}
