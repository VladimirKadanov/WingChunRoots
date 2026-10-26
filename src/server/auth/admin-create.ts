// The arguments and the safety rule of `pnpm admin:create` (src/server/auth/cli.ts; milestone M02,
// In scope 10), apart from the command so that unit tests can import them.

import { assertNotProduction, isLocalHost, targetDatabaseUrl } from '../db/env';

export const ADMIN_CREATE_USAGE = 'usage: pnpm admin:create --email <address>';

/** The value of `--email <address>` or `--email=<address>`, or null. */
export function emailArgument(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--email') return args[i + 1]?.trim() || null;
    if (arg.startsWith('--email=')) return arg.slice('--email='.length).trim() || null;
  }
  return null;
}

/**
 * Refuses anything but a local environment: NODE_ENV=production, or a database (DATABASE_URL, or
 * TEST_DATABASE_URL without it) that is not on this machine. The message names no URL.
 */
export function assertLocalEnvironment(env: Record<string, string | undefined> = process.env): void {
  assertNotProduction('admin:create', env);
  assertLocalDatabase('admin:create', env);
}

/**
 * Refuses a database (DATABASE_URL, or TEST_DATABASE_URL without it) that is not on this machine,
 * naming `command` and no URL. Also used by `pnpm account:delete` (src/server/auth/account-delete.ts).
 */
export function assertLocalDatabase(command: string, env: Record<string, string | undefined> = process.env): void {
  if (!isLocalHost(targetDatabaseUrl(env))) {
    throw new Error(`${command} works only with a database on this machine (DATABASE_URL on localhost)`);
  }
}

/** What to do next after a refusal, by service error code. */
export const ADMIN_CREATE_NEXT_STEPS: Readonly<Record<string, string>> = {
  NOT_FOUND: 'Sign up at /sign-up first, confirm the address, turn on two-factor authentication at /account/security, then run this again.',
  CONFLICT: 'Open the confirmation link from the sign-up e-mail first, then run this again.',
  TWO_FACTOR_REQUIRED: 'Sign in, turn on two-factor authentication at /account/security, then run this again.',
};
