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
