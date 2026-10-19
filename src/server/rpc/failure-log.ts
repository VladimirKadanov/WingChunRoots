// The one log line of a procedure that failed unexpectedly (M08 review round 1, security-6; round 2,
// recheck-2). Every way into the router logs through it: the RPCHandler at /api/rpc and the
// OpenAPIHandler at /api/v1 (./handler.ts, clientInterceptors) and serverClient(), which the pages
// and Server Actions call in-process (./server.ts, interceptors).
//
// An expected answer (an ORPCError below 500: refused, not found, a field error, too many requests)
// is not logged and passes through unchanged. Anything else is one line: the procedure, the error's
// name, the PostgreSQL code and the request id. Never the input, the principal, an address or the
// error's message, which can quote SQL parameters such as an e-mail address (CLAUDE.md §6).
//
// After that line, the error itself goes no further (M08 final check, security-1): the caller gets
// a bare ORPCError INTERNAL_SERVER_ERROR ("Internal server error", no cause). A page that awaits
// serverClient() without a catch then hands Next.js an error with nothing personal in it, so its
// own log line (and the error boundary's digest) carries no SQL and no parameters. The HTTP
// handlers answer this error with the same 500 body they gave before, and formStateFromFailure
// (./form.ts) only needs its status.

import { ORPCError } from '@orpc/server';

import { pgErrorOf } from '../services/errors';
import type { RpcContext } from './router';

/** The one log line of a failed procedure call; null for an expected answer. */
export function procedureFailureLine(error: unknown, path: readonly string[], requestId: string): string | null {
  if (error instanceof ORPCError && error.status < 500) return null;
  const name = error instanceof Error ? error.name : typeof error;
  const code = pgErrorOf(error)?.code;
  const safe = (value: string) => value.replace(/[^\w.:-]/g, '?').slice(0, 64);
  return `rpc ${safe(path.join('.'))} failed: ${safe(name)}${code ? ` (postgres ${safe(code)})` : ''} request ${safe(requestId)}`;
}

/** What every unexpected failure becomes once it is logged: no message of its own, no cause. */
export function internalServerError(): ORPCError<'INTERNAL_SERVER_ERROR', undefined> {
  return new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Internal server error' });
}

/**
 * Logs a failed procedure call (procedureFailureLine). An expected answer goes through unchanged;
 * anything else is replaced by internalServerError(), so the original error (with the SQL and the
 * parameters a database error quotes) never reaches another log.
 */
export async function logProcedureFailure<T>(options: { next: () => Promise<T>; path: readonly string[]; context: RpcContext }): Promise<T> {
  try {
    return await options.next();
  } catch (error) {
    const line = procedureFailureLine(error, options.path, options.context.meta.requestId);
    if (!line) throw error;
    console.error(line);
    throw internalServerError();
  }
}
