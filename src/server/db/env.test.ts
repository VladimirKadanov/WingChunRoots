import { describe, expect, it } from 'vitest';

import { assertSafeToReset, databaseName, isLocalHost, migratorUrl, redactUrl, rolePassword, roleUrl, splitPassword, targetDatabaseUrl, withDatabase } from './env';

const LOCAL = 'postgres://postgres:secret@127.0.0.1:5432/wingchunroots';
const TEST = 'postgres://postgres:secret@db.internal:5432/wingchunroots_test';

describe('database URLs', () => {
  it('reads and replaces the database name', () => {
    expect(databaseName(LOCAL)).toBe('wingchunroots');
    expect(databaseName(withDatabase(LOCAL, 'wcr_it_1'))).toBe('wcr_it_1');
  });

  it('builds role URLs and never shows a password in messages', () => {
    const url = roleUrl(LOCAL, 'app_public_ro', 'p@ss/word');
    expect(new URL(url).username).toBe('app_public_ro');
    expect(decodeURIComponent(new URL(url).password)).toBe('p@ss/word');
    expect(redactUrl(url)).not.toContain('word');
    expect(redactUrl(LOCAL)).toBe('postgres://postgres:***@127.0.0.1:5432/wingchunroots');
  });

  it('recognises local hosts', () => {
    expect(isLocalHost(LOCAL)).toBe(true);
    expect(isLocalHost('postgres://u@localhost/db')).toBe(true);
    expect(isLocalHost('postgres://u@[::1]:5432/db')).toBe(true);
    expect(isLocalHost('postgres:///db?host=/var/run/postgresql')).toBe(true);
    expect(isLocalHost(TEST)).toBe(false);
    expect(isLocalHost('postgres://u@127.example.com/db')).toBe(false);
  });

  it('prefers DATABASE_URL and falls back to TEST_DATABASE_URL', () => {
    expect(targetDatabaseUrl({ DATABASE_URL: LOCAL, TEST_DATABASE_URL: TEST })).toBe(LOCAL);
    expect(targetDatabaseUrl({ TEST_DATABASE_URL: TEST })).toBe(TEST);
    expect(() => targetDatabaseUrl({})).toThrow(/neither DATABASE_URL nor TEST_DATABASE_URL/);
  });

  it('splits the password off a URL for PGPASSWORD (never on a command line)', () => {
    expect(splitPassword('postgres://postgres:p%40ss%2Fword@127.0.0.1:5432/wingchunroots?sslmode=disable')).toEqual({
      url: 'postgres://postgres@127.0.0.1:5432/wingchunroots?sslmode=disable',
      password: 'p@ss/word',
    });
    expect(splitPassword('postgres://postgres@127.0.0.1/wingchunroots')).toEqual({
      url: 'postgres://postgres@127.0.0.1/wingchunroots',
      password: '',
    });
  });

  it('adds DB_MIGRATOR_PASSWORD, URL-encoded, to a migrator URL without a password (Compose migrate)', () => {
    const bare = 'postgres://migrator@postgres:5432/wingchunroots';
    const url = migratorUrl(bare, { DB_MIGRATOR_PASSWORD: 'p@ss/w#rd%1' });
    expect(url).toBe('postgres://migrator:p%40ss%2Fw%23rd%251@postgres:5432/wingchunroots');
    expect(splitPassword(url).password).toBe('p@ss/w#rd%1');
    expect(databaseName(url)).toBe('wingchunroots');
    // A URL with its own password, another user or no password variable stays as it is.
    expect(migratorUrl(LOCAL, { DB_MIGRATOR_PASSWORD: 'x' })).toBe(LOCAL);
    expect(migratorUrl('postgres://postgres@127.0.0.1/wingchunroots', { DB_MIGRATOR_PASSWORD: 'x' })).toBe('postgres://postgres@127.0.0.1/wingchunroots');
    expect(migratorUrl(bare, {})).toBe(bare);
  });

  it('asks for a missing role password by its variable name', () => {
    expect(() => rolePassword('app_rw', {})).toThrow(/DB_APP_RW_PASSWORD/);
    expect(rolePassword('migrator', { DB_MIGRATOR_PASSWORD: 'x' })).toBe('x');
  });
});

describe('db:reset safety (M01, In scope 1)', () => {
  it('allows a local database', () => {
    expect(() => assertSafeToReset(LOCAL, {})).not.toThrow();
  });

  it('allows a remote host only when it is TEST_DATABASE_URL', () => {
    expect(() => assertSafeToReset(TEST, { TEST_DATABASE_URL: TEST })).not.toThrow();
    expect(() => assertSafeToReset(TEST, {})).toThrow(/neither local nor TEST_DATABASE_URL/);
    expect(() => assertSafeToReset(withDatabase(TEST, 'wingchunroots'), { TEST_DATABASE_URL: TEST })).toThrow(/neither local/);
  });

  it('refuses NODE_ENV=production, even for a local database', () => {
    expect(() => assertSafeToReset(LOCAL, { NODE_ENV: 'production' })).toThrow(/production/);
  });

  it('names the command it guards (db:seed empties every table too)', () => {
    expect(() => assertSafeToReset(TEST, {}, 'db:seed')).toThrow(/^db:seed refuses a database that is neither local/);
    expect(() => assertSafeToReset(LOCAL, { NODE_ENV: 'production' }, 'db:seed')).toThrow(/^db:seed refuses to run/);
  });
});
