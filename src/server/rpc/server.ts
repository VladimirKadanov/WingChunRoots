// The router called in-process (plan §6.8): Server Actions and pages call the procedures through
// this client, with the context of the current request, so a form and an API call run the same
// procedure, the same checks and the same services.
//
// It logs a procedure that fails unexpectedly in the same one safe line as the HTTP handlers
// (./failure-log.ts; M08 review round 2, recheck-2) and then throws a bare INTERNAL_SERVER_ERROR in
// its place (final check, security-1). The original error never leaves the interceptor: a page
// that awaits a procedure without a catch hands Next.js only that bare error, so Next.js's own log
// line has no SQL and none of the parameters a database error quotes, such as the e-mail address
// an administrator searched for or an account's id (CLAUDE.md §6); the segment's error.tsx shows
// the calm error state. A Server Action answers with a calm message (formStateFromFailure in
// ./form.ts) instead of rethrowing.

import { createRouterClient } from '@orpc/server';

import type { Principal } from '../auth/principal';
import { createContext } from './context';
import { logProcedureFailure } from './failure-log';
import { type RpcContext, router } from './router';

/**
 * A client of the router for this request. The context is built once per client, so several
 * calls read the session once; pass `principal` when the caller already has it (a page after
 * guardRoute, an action with getRequestPrincipal), and it is not read again at all.
 */
export function serverClient(headers: Headers, principal?: Principal | null) {
  let context: Promise<RpcContext> | undefined;
  return createRouterClient(router, { context: () => (context ??= createContext(headers, principal)), interceptors: [logProcedureFailure] });
}

export { ORPCError } from '@orpc/server';
export type { Router } from './router';
