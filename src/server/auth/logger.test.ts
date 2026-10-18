// Better Auth's log lines without e-mail or IP addresses (plan §6.4, CLAUDE.md §6).

import { afterEach, describe, expect, it, vi } from 'vitest';

import { logAuth, logAuthApiError, redactLogText } from './logger';

describe('redactLogText', () => {
  it.each([
    ['from 198.18.0.7', 'from <ip>'],
    ['from 2001:db8::1', 'from <ip>'],
    ['from fe80::1%eth0', 'from <ip>%eth0'],
    ['from ::1', 'from <ip>'],
    ['from [2001:0db8:0000:0000:0000:0000:0000:0001]:3000', 'from [<ip>]:3000'],
    ['from 2001:db8:85a3:0:0:8a2e:370:7334, then', 'from <ip>, then'],
  ])('removes the IP address in %j', (input, expected) => {
    expect(redactLogText(input)).toBe(expected);
  });

  it('removes e-mail addresses and keeps the rest of the message', () => {
    const line = redactLogText('Sign-up attempt for existing email: demo-someone@example.test');
    expect(line).not.toContain('@');
    expect(line).toContain('Sign-up attempt for existing email:');
  });

  it('writes control characters as escapes: a callbackURL with a line break cannot forge a log line (fix round 3)', () => {
    const forged = 'Invalid callbackURL: https://evil.example/\nauth error: forged line\r\u2028\u0000\u001b[31m';
    const line = redactLogText(forged);
    expect(line).toBe('Invalid callbackURL: https://evil.example/\\nauth error: forged line\\r\\u2028\\u0000\\u001b[31m');
    expect(line).not.toMatch(/[\u0000-\u001f\u2028]/);
  });

  it('leaves ordinary text with a colon alone', () => {
    expect(redactLogText('Rate limit: /sign-in/email')).toBe('Rate limit: /sign-in/email');
    expect(redactLogText('Error: INVALID_CODE')).toBe('Error: INVALID_CODE');
  });
});

describe('logAuthApiError (Better Auth onAPIError.onError)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs nothing for an expected refusal (an APIError below 500)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    logAuthApiError(Object.assign(new Error('Invalid email or password'), { statusCode: 401 }));
    expect(error).not.toHaveBeenCalled();
  });

  it('logs an unexpected error by name and code only, never its message', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = Object.assign(new Error('insert failed for demo-someone@example.test from 198.18.0.7'), { code: 'DB_DOWN' });
    logAuthApiError(failure);
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toBe('auth error: request failed (Error DB_DOWN)');
    expect(line).not.toContain('@');
    expect(line).not.toContain('198.18');
  });

  it('logs a server error status (500 and above)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    logAuthApiError(Object.assign(new Error('boom'), { statusCode: 500 }));
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('the adapter error Better Auth prints around the logger (fix round 3)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints only the name of the query error that follows "Failed to query fallback join", once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // What @better-auth/core's adapter does: the logger line, then console.error(error) at once.
    logAuth('error', 'Failed to query fallback join for model auth_account:', { where: [{ field: 'userId', value: 'x' }], limit: 100 });
    const query = Object.assign(new Error('Failed query: select … where user_id = $1 params: 0190f0c4-0000-7000-8000-000000000000,demo-someone@example.test'), {
      name: 'DrizzleQueryError',
    });
    console.error(query);
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0]?.[0])).toBe('auth error: Failed to query fallback join for model auth_account:');
    expect(error.mock.calls[1]).toEqual(['auth error: query error withheld (DrizzleQueryError)']);
    // Only that one call: the next one is printed as it is.
    console.error('an unrelated line');
    expect(error.mock.calls[2]).toEqual(['an unrelated line']);
  });

  it('puts console.error back when the expected call does not come in the same tick', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    logAuth('error', 'Failed to query fallback join for model auth_user:');
    await Promise.resolve();
    console.error('later, unrelated');
    expect(error.mock.calls[1]).toEqual(['later, unrelated']);
  });
});
