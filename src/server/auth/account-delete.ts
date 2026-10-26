// The arguments of `pnpm account:delete` (src/server/auth/account-delete-cli.ts; milestone M07,
// In scope 5 and 9), apart from the command so that unit tests can import them.

import { assertNotProduction } from '../db/env';
import { assertLocalDatabase } from './admin-create';

export const ACCOUNT_DELETE_USAGE = 'usage: pnpm account:delete --case <id> [--cancel]';

/**
 * Refuses anything but a local environment, like `pnpm admin:create`: NODE_ENV=production, or a
 * database that is not on this machine. The message names the command and no URL.
 */
export function assertAccountDeleteLocal(env: Record<string, string | undefined> = process.env): void {
  assertNotProduction('account:delete', env);
  assertLocalDatabase('account:delete', env);
}

export interface AccountDeleteArguments {
  caseId: string;
  /** Close the request without carrying it out (the member changed their mind). */
  cancel: boolean;
}

/** `--case <id>` or `--case=<id>`, and `--cancel`; null when the case is missing or an argument is unknown. */
export function accountDeleteArguments(args: readonly string[]): AccountDeleteArguments | null {
  let caseId: string | null = null;
  let cancel = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--case') {
      const value = args[i + 1]?.trim();
      if (!value || value.startsWith('--')) return null;
      caseId = value;
      i += 1;
    } else if (arg.startsWith('--case=')) {
      caseId = arg.slice('--case='.length).trim() || null;
    } else if (arg === '--cancel') {
      cancel = true;
    } else if (arg !== '--') {
      return null;
    }
  }
  return caseId ? { caseId, cancel } : null;
}

/** What to do next after a refusal, by service error code. */
export const ACCOUNT_DELETE_NEXT_STEPS: Readonly<Record<string, string>> = {
  BAD_REQUEST: 'Copy the case id from "Account deletion requests" on /admin.',
  NOT_FOUND: 'Copy the case id from "Account deletion requests" on /admin.',
  CONFLICT: 'Only an open request can be carried out or cancelled; see docs/guides/admin-guide.bg.md, section 13.',
};
