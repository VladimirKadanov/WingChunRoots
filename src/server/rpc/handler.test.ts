// The CSRF check of the oRPC endpoints (src/server/rpc/handler.ts, csrfRefusal; docs/adr/0004-auth.md
// section 6).

import { ORPCError } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';

import { csrfRefusal, logProcedureFailure, procedureFailureLine, sessionHeaders } from './handler';

const APP = 'https://wingchunroots.example';
const post = (headers: Record<string, string>) => new Request(`${APP}/api/v1/consent/record`, { method: 'POST', headers });

describe('csrfRefusal', () => {
  it('lets a same-origin change with cookies through, and refuses one from another site or without an origin', () => {
    expect(csrfRefusal(post({ cookie: 'wcr.session_token=x', origin: APP }), APP)).toBeNull();
    expect(csrfRefusal(post({ cookie: 'wcr.session_token=x', 'sec-fetch-site': 'same-origin' }), APP)).toBeNull();
    expect(csrfRefusal(post({ cookie: 'wcr.session_token=x', origin: 'https://evil.example' }), APP)).toBe('origin');
    expect(csrfRefusal(post({ cookie: 'wcr.session_token=x' }), APP)).toBe('no-origin');
  });

  it('exempts a bearer request: a browser cannot add that header across sites without a preflight', () => {
    expect(csrfRefusal(post({ authorization: 'Bearer abc.def', origin: 'https://evil.example' }), APP)).toBeNull();
    expect(csrfRefusal(post({ authorization: 'bearer abc.def', cookie: 'wcr.session_token=x', origin: 'https://evil.example' }), APP)).toBeNull();
  });

  it('exempts no other Authorization scheme: a browser attaches Basic or Negotiate credentials by itself (fix round 3)', () => {
    for (const authorization of ['Basic eDp5', 'Negotiate abc', 'Bearer', 'Bearerabc', 'Token abc']) {
      expect(csrfRefusal(post({ authorization, cookie: 'wcr.session_token=x', origin: 'https://evil.example' }), APP)).toBe('origin');
    }
  });

  it('leaves safe methods and requests without cookies alone', () => {
    expect(csrfRefusal(new Request(`${APP}/api/v1/account/me`, { headers: { cookie: 'x=1', origin: 'https://evil.example' } }), APP)).toBeNull();
    expect(csrfRefusal(post({ origin: 'https://evil.example' }), APP)).toBeNull();
  });
});

describe('sessionHeaders (M08 review round 1, security-7)', () => {
  it('drops the cookies of a bearer request, so its session can come only from the token', () => {
    const request = post({ authorization: 'Bearer x', cookie: 'wcr.session_token=valid', origin: 'https://evil.example', 'x-request-id': 'r1' });
    const headers = sessionHeaders(request);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.get('authorization')).toBe('Bearer x');
    expect(headers.get('x-request-id')).toBe('r1');
    // The request itself is not changed.
    expect(request.headers.get('cookie')).toBe('wcr.session_token=valid');
  });

  it('keeps the cookies of every other request', () => {
    for (const authorization of [undefined, 'Basic eDp5', 'Bearerabc']) {
      const request = post({ cookie: 'wcr.session_token=valid', ...(authorization ? { authorization } : {}) });
      expect(sessionHeaders(request).get('cookie'), authorization).toBe('wcr.session_token=valid');
    }
  });
});

describe('procedure failure log (M08 review round 1, security-6)', () => {
  const deadlock = Object.assign(new Error('deadlock detected while inserting demo-person@example.test'), { name: 'DatabaseError', code: '40P01' });

  it('logs an unexpected error with the procedure, its name, the PostgreSQL code and the request id, never its message', () => {
    const line = procedureFailureLine(new Error('wrapped', { cause: deadlock }), ['plans', 'requestPilotAccess'], 'req-1');
    expect(line).toBe('rpc plans.requestPilotAccess failed: Error (postgres 40P01) request req-1');
    expect(procedureFailureLine(deadlock, ['account', 'setType'], 'req-2')).toBe('rpc account.setType failed: DatabaseError (postgres 40P01) request req-2');
    expect(procedureFailureLine(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 }), ['grants', 'create'], 'r')).toContain('rpc grants.create failed');
  });

  it('does not log expected answers: refusals, field errors, not found, too many requests', () => {
    for (const [code, status] of [['UNAUTHORIZED', 401], ['FORBIDDEN', 403], ['BAD_REQUEST', 400], ['NOT_FOUND', 404], ['TOO_MANY_REQUESTS', 429]] as const) {
      expect(procedureFailureLine(new ORPCError(code, { status }), ['x'], 'r'), code).toBeNull();
    }
  });

  it('the interceptor writes the line and throws a bare 500 in place of the error (final check, security-1); the input never reaches the log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const context = { principal: null, meta: { requestId: 'req-3', ipHmac: null } };
      const thrown = await logProcedureFailure({ next: () => Promise.reject(deadlock), path: ['grants', 'create'], context }).then(
        () => null,
        (error: unknown) => error,
      );
      // Not the original error: a page that awaits serverClient() without a catch hands Next.js
      // this one, so Next.js's own log line has no SQL, no parameters and no address in it.
      expect(thrown).not.toBe(deadlock);
      expect(thrown).toBeInstanceOf(ORPCError);
      const replaced = thrown as ORPCError<string, unknown>;
      expect(replaced.status).toBe(500);
      expect(replaced.code).toBe('INTERNAL_SERVER_ERROR');
      expect(replaced.message).toBe('Internal server error');
      expect(replaced.cause).toBeUndefined();
      expect(replaced.data).toBeUndefined();
      expect(`${replaced.message} ${String(replaced.cause)} ${replaced.stack ?? ''}`).not.toContain('@');
      expect(spy).toHaveBeenCalledTimes(1);
      const logged = String(spy.mock.calls[0]?.[0]);
      expect(logged).toBe('rpc grants.create failed: DatabaseError (postgres 40P01) request req-3');
      expect(logged).not.toContain('@');
      await expect(logProcedureFailure({ next: () => Promise.resolve(7), path: ['x'], context })).resolves.toBe(7);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('lets an expected answer through unchanged and unlogged, with its message and fields', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const context = { principal: null, meta: { requestId: 'req-4', ipHmac: null } };
      const refusal = new ORPCError('BAD_REQUEST', { status: 400, message: 'Check the highlighted fields.', data: { fields: { email: 'Enter it.' } } });
      await expect(logProcedureFailure({ next: () => Promise.reject(refusal), path: ['grants', 'create'], context })).rejects.toBe(refusal);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
