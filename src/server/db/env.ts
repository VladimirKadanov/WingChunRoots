// Database URLs, role credentials and the safety rules of the db:* scripts (plan §6.2, §7.5).
//
// Environment (names only in .env.example; values local, plan §7.7):
//   DATABASE_URL       superuser URL of the development database (Docker Compose locally).
//   TEST_DATABASE_URL  superuser URL of the disposable test database (cloud session, CI, local).
//   DB_MIGRATOR_PASSWORD, DB_APP_RW_PASSWORD, DB_APP_PUBLIC_RO_PASSWORD: the role passwords set
//                      by scripts/db-bootstrap.sh. The application connects as app_rw and
//                      app_public_ro to the host and database of DATABASE_URL.

import { existsSync } from 'node:fs';

export type DbRole = 'migrator' | 'app_rw' | 'app_public_ro';

export const ROLE_PASSWORD_ENV: Record<DbRole, string> = {
  migrator: 'DB_MIGRATOR_PASSWORD',
  app_rw: 'DB_APP_RW_PASSWORD',
  app_public_ro: 'DB_APP_PUBLIC_RO_PASSWORD',
};

type Env = Record<string, string | undefined>;

/** Loads .env from the current directory for the CLI scripts; the environment always wins. */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

function parse(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error('not a valid postgres:// URL');
  }
}

/** The database name in a postgres:// URL. */
export function databaseName(url: string): string {
  return decodeURIComponent(parse(url).pathname.replace(/^\//, ''));
}

/** The same server and credentials, another database. */
export function withDatabase(url: string, database: string): string {
  const u = parse(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}

/** The same server and database, connecting as `role` with `password`. */
export function roleUrl(url: string, role: DbRole, password: string): string {
  const u = parse(url);
  u.username = encodeURIComponent(role);
  u.password = encodeURIComponent(password);
  return u.toString();
}

/** The password of a role from the environment, or a clear error. */
export function rolePassword(role: DbRole, env: Env = process.env): string {
  const name = ROLE_PASSWORD_ENV[role];
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set (local: scripts/init-env.sh; cloud: scripts/cloud-setup.sh)`);
  }
  return value;
}

/** True for a loopback host or a Unix socket. */
export function isLocalHost(url: string): boolean {
  const u = parse(url);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const socketHost = u.searchParams.get('host');
  if (host === '' && (socketHost === null || socketHost.startsWith('/'))) return true;
  return host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * The URL without its password, and the password (decoded) apart, for a child process that takes
 * the password from PGPASSWORD instead of its command line (visible to every local user).
 */
export function splitPassword(url: string): { url: string; password: string } {
  const u = parse(url);
  const password = decodeURIComponent(u.password);
  u.password = '';
  return { url: u.toString(), password };
}

/** URL without its password, for messages. Never log a full URL. */
export function redactUrl(url: string): string {
  const u = parse(url);
  if (u.password) u.password = '***';
  return u.toString();
}

/**
 * The database the db:* scripts work on: DATABASE_URL, or TEST_DATABASE_URL when DATABASE_URL is
 * not set (cloud sessions and CI have only the test database).
 */
export function targetDatabaseUrl(env: Env = process.env): string {
  const url = env.DATABASE_URL || env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('neither DATABASE_URL nor TEST_DATABASE_URL is set (local: scripts/init-env.sh; cloud: scripts/cloud-setup.sh)');
  }
  return url;
}

/** db:seed never runs in production (plan §7.5). */
export function assertNotProduction(command: string, env: Env = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(`${command} refuses to run with NODE_ENV=production`);
  }
}

/**
 * db:reset only runs against a local database or TEST_DATABASE_URL, and never with
 * NODE_ENV=production (milestone M01, In scope 1).
 */
export function assertSafeToReset(url: string, env: Env = process.env): void {
  assertNotProduction('db:reset', env);
  const isTestDatabase = !!env.TEST_DATABASE_URL && sameDatabase(url, env.TEST_DATABASE_URL);
  if (!isLocalHost(url) && !isTestDatabase) {
    throw new Error(`db:reset refuses a database that is neither local nor TEST_DATABASE_URL: ${redactUrl(url)}`);
  }
}

function sameDatabase(a: string, b: string): boolean {
  const ua = parse(a);
  const ub = parse(b);
  return (
    ua.hostname === ub.hostname &&
    (ua.port || '5432') === (ub.port || '5432') &&
    databaseName(a) === databaseName(b)
  );
}
