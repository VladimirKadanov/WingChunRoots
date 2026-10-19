// What a Server Action shows for a failed procedure call (src/server/rpc/form.ts; M08 review
// round 2, recheck-2; final check, security-1).

import { ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';

import { internalServerError } from './failure-log';
import { formStateFromFailure, formStateFromRpcError, isUnexpectedFailure, pageRead, UNEXPECTED_FAILURE_MESSAGE } from './form';

describe('form state of a failed procedure call', () => {
  const refusal = new ORPCError('BAD_REQUEST', { status: 400, message: 'Check the highlighted fields.', data: { fields: { email: 'Enter it.' } } });

  it('shows a refusal with its message and fields', () => {
    const expected = { status: 'error', message: 'Check the highlighted fields.', fields: { email: 'Enter it.' }, values: { email: 'x' } };
    expect(formStateFromRpcError(refusal, { email: 'x' })).toEqual(expected);
    expect(formStateFromFailure(refusal, { email: 'x' })).toEqual(expected);
  });

  it('never shows the bare 500 of an unexpected failure as if it were a refusal', () => {
    expect(formStateFromRpcError(internalServerError())).toBeNull();
    expect(formStateFromRpcError(new Error('x'))).toBeNull();
    expect(formStateFromFailure(internalServerError(), { email: 'x' })).toEqual({ status: 'error', message: UNEXPECTED_FAILURE_MESSAGE, values: { email: 'x' } });
    expect(formStateFromFailure(new Error('x'))).toEqual({ status: 'error', message: UNEXPECTED_FAILURE_MESSAGE });
  });

  it('a page read gives its value, null for an unexpected failure (the error state), and rethrows a refusal (requirements-2)', async () => {
    await expect(pageRead(Promise.resolve(7))).resolves.toBe(7);
    await expect(pageRead(Promise.reject(internalServerError()))).resolves.toBeNull();
    await expect(pageRead(Promise.reject(new Error('x')))).resolves.toBeNull();
    const forbidden = new ORPCError('FORBIDDEN', { status: 403, message: 'No.' });
    await expect(pageRead(Promise.reject(forbidden))).rejects.toBe(forbidden);
    expect(isUnexpectedFailure(refusal)).toBe(false);
    expect(isUnexpectedFailure(internalServerError())).toBe(true);
  });
});
