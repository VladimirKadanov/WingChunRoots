// The router called in-process (plan §6.8): Server Actions and pages call the procedures through
// this client, with the context of the current request, so a form and an API call run the same
// procedure, the same checks and the same services.

import { createRouterClient } from '@orpc/server';

import type { Principal } from '../auth/principal';
import { createContext } from './context';
import { type RpcContext, router } from './router';

/**
 * A client of the router for this request. The context is built once per client, so several
 * calls read the session once; pass `principal` when the caller already has it (a page after
 * guardRoute, an action with getRequestPrincipal), and it is not read again at all.
 */
export function serverClient(headers: Headers, principal?: Principal | null) {
  let context: Promise<RpcContext> | undefined;
  return createRouterClient(router, { context: () => (context ??= createContext(headers, principal)) });
}

export { ORPCError } from '@orpc/server';
export type { Router } from './router';
