// The arguments and the safety rule of `pnpm account:reset-2fa` (src/server/auth/reset-2fa-cli.ts;
// review 2026-11-13, auth.md 2; docs/adr/0029-safety-net.md), apart from the command so that unit
// tests can import them.

import { assertNotProduction } from '../db/env';
import { assertLocalDatabase } from './admin-create';

export const RESET_2FA_USAGE = 'usage: pnpm account:reset-2fa --email <address>';

/**
 * Refuses anything but a local environment, exactly like `pnpm admin:create`: NODE_ENV=production,
 * or a database (DATABASE_URL, or TEST_DATABASE_URL without it) that is not on this machine. The
 * message names the command and no URL.
 */
export function assertResetTwoFactorLocal(env: Record<string, string | undefined> = process.env): void {
  assertNotProduction('account:reset-2fa', env);
  assertLocalDatabase('account:reset-2fa', env);
}

/** What to do next after a refusal, by service error code. */
export const RESET_2FA_NEXT_STEPS: Readonly<Record<string, string>> = {
  NOT_FOUND: 'Check the address of the account (it is stored in lower case).',
  BAD_REQUEST: RESET_2FA_USAGE,
};
