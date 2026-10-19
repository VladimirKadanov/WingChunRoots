// What a Server Action shows when a procedure it wraps refuses (milestone M02): the procedure's
// message and field errors, the same ones an API client receives in the error's `data.fields`.

import { ORPCError } from '@orpc/server';

import type { FormState } from '../../lib/form-state';

/** The form state for a refused procedure call, or null when `error` is not a procedure error. */
export function formStateFromRpcError(error: unknown, values?: Record<string, string>): FormState | null {
  if (!(error instanceof ORPCError)) return null;
  const data = error.data as { fields?: Record<string, string> } | undefined;
  return {
    status: 'error',
    message: error.message,
    ...(data?.fields ? { fields: data.fields } : {}),
    ...(values ? { values } : {}),
  };
}

/** The error code of a refused procedure call (`UNAUTHORIZED`, `CONFLICT`, ...), or null. */
export function rpcErrorCode(error: unknown): string | null {
  return error instanceof ORPCError ? error.code : null;
}

/** What a form says when a procedure fails unexpectedly (M08 review round 2, recheck-2). */
export const UNEXPECTED_FAILURE_MESSAGE = 'Something went wrong on our side; nothing was changed. Try again.';

/**
 * The form state for any failure of a wrapped procedure: its answer when it refused (an ORPCError
 * below 500, as formStateFromRpcError), or UNEXPECTED_FAILURE_MESSAGE for anything else (a database
 * timeout, a bug). serverClient() has already logged that one in a safe line (./failure-log.ts);
 * the action returns this instead of rethrowing, so Next.js neither logs the error whole (with
 * the SQL parameters it may quote) nor replaces the page with its error page. "Nothing was
 * changed" holds because each M08 mutation writes in one transaction, its answer included.
 */
export function formStateFromFailure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof ORPCError && error.status < 500) return formStateFromRpcError(error, values)!;
  return { status: 'error', message: UNEXPECTED_FAILURE_MESSAGE, ...(values ? { values } : {}) };
}
