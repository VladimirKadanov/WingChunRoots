// The arguments and the local-only rule of `pnpm admin:create` (milestone M02, In scope 10).

import { describe, expect, it } from 'vitest';

import { assertLocalEnvironment, emailArgument } from './admin-create';

describe('emailArgument', () => {
  it('reads --email <address> and --email=<address>', () => {
    expect(emailArgument(['--email', 'demo-first-admin@example.test'])).toBe('demo-first-admin@example.test');
    expect(emailArgument(['--email=demo-first-admin@example.test'])).toBe('demo-first-admin@example.test');
    expect(emailArgument(['--', '--email', ' demo-first-admin@example.test '])).toBe('demo-first-admin@example.test');
  });

  it('is null without an address', () => {
    expect(emailArgument([])).toBeNull();
    expect(emailArgument(['--email'])).toBeNull();
    expect(emailArgument(['--email='])).toBeNull();
    expect(emailArgument(['demo-first-admin@example.test'])).toBeNull();
  });
});

describe('assertLocalEnvironment', () => {
  const local = 'postgres://postgres:throwaway@127.0.0.1:5432/wingchunroots';

  it('accepts a database on this machine', () => {
    expect(() => assertLocalEnvironment({ DATABASE_URL: local })).not.toThrow();
    expect(() => assertLocalEnvironment({ TEST_DATABASE_URL: 'postgres://postgres:throwaway@localhost/wcr_test' })).not.toThrow();
  });

  it('refuses production and a remote database, without naming the URL', () => {
    expect(() => assertLocalEnvironment({ DATABASE_URL: local, NODE_ENV: 'production' })).toThrow(/NODE_ENV=production/);
    const remote = 'postgres://postgres:throwaway-secret@db.example.test:5432/wingchunroots';
    expect(() => assertLocalEnvironment({ DATABASE_URL: remote })).toThrow(/only with a database on this machine/);
    try {
      assertLocalEnvironment({ DATABASE_URL: remote });
    } catch (error) {
      expect(String(error)).not.toContain('throwaway-secret');
      expect(String(error)).not.toContain('db.example.test');
    }
  });

  it('refuses when no database is set', () => {
    expect(() => assertLocalEnvironment({})).toThrow(/DATABASE_URL/);
  });
});
