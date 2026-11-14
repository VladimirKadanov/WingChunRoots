// The arguments and the local-only rule of `pnpm account:reset-2fa` (review 2026-11-13, auth.md 2):
// the same rule as `pnpm admin:create`, and the same --email argument.

import { describe, expect, it } from 'vitest';

import { emailArgument } from './admin-create';
import { assertResetTwoFactorLocal, RESET_2FA_NEXT_STEPS, RESET_2FA_USAGE } from './reset-2fa';

describe('assertResetTwoFactorLocal', () => {
  const local = 'postgres://postgres:throwaway@127.0.0.1:5432/wingchunroots';

  it('accepts a database on this machine', () => {
    expect(() => assertResetTwoFactorLocal({ DATABASE_URL: local })).not.toThrow();
    expect(() => assertResetTwoFactorLocal({ TEST_DATABASE_URL: 'postgres://postgres:throwaway@localhost/wcr_test' })).not.toThrow();
  });

  it('refuses production and a remote database, naming the command and not the URL', () => {
    expect(() => assertResetTwoFactorLocal({ DATABASE_URL: local, NODE_ENV: 'production' })).toThrow(/account:reset-2fa.*NODE_ENV=production/);
    const remote = 'postgres://postgres:throwaway-secret@db.example.test:5432/wingchunroots';
    expect(() => assertResetTwoFactorLocal({ DATABASE_URL: remote })).toThrow(/account:reset-2fa works only with a database on this machine/);
    try {
      assertResetTwoFactorLocal({ DATABASE_URL: remote });
    } catch (error) {
      expect(String(error)).not.toContain('throwaway-secret');
      expect(String(error)).not.toContain('db.example.test');
    }
  });

  it('refuses when no database is set', () => {
    expect(() => assertResetTwoFactorLocal({})).toThrow(/DATABASE_URL/);
  });
});

describe('the command line', () => {
  it('takes --email <address> and --email=<address>, and has a usage line', () => {
    expect(emailArgument(['--email', 'demo-lost-device@example.test'])).toBe('demo-lost-device@example.test');
    expect(emailArgument(['--email=demo-lost-device@example.test'])).toBe('demo-lost-device@example.test');
    expect(RESET_2FA_USAGE).toBe('usage: pnpm account:reset-2fa --email <address>');
    expect(Object.keys(RESET_2FA_NEXT_STEPS)).toEqual(['NOT_FOUND', 'BAD_REQUEST']);
  });
});
