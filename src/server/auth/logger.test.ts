// Better Auth's log lines without e-mail or IP addresses (plan §6.4, CLAUDE.md §6).

import { afterEach, describe, expect, it, vi } from 'vitest';

import { logAuthApiError, redactLogText } from './logger';

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
