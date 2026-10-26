// `pnpm account:delete --case <id>` (milestone M07, In scope 5 and 9): carries out an account
// deletion request until the review tool of M10a (carryOutDeletionFromCommandLine in
// src/server/services/privacy.ts); with `--cancel`, closes it without carrying it out. The case id
// is on /admin, under "Account deletion requests".
//
// Local only, like `pnpm admin:create`: refused with NODE_ENV=production and for a database that
// is not on this machine. Prints ids only, never a name or an address. It runs in its own process
// and cannot drop the web server's public cache, so it says to restart the web server.
// Values come from the environment, then from .env.

import path from 'node:path';

import { closeDb } from '../db';
import { loadDotEnv } from '../db/dotenv';
import { isServiceError } from '../services/errors';
import { cancelDeletionFromCommandLine, carryOutDeletionFromCommandLine } from '../services/privacy';
import { ACCOUNT_DELETE_NEXT_STEPS, ACCOUNT_DELETE_USAGE, accountDeleteArguments, assertAccountDeleteLocal } from './account-delete';

async function main(): Promise<number> {
  const args = accountDeleteArguments(process.argv.slice(2));
  if (!args) {
    console.error(ACCOUNT_DELETE_USAGE);
    return 2;
  }
  // .env first, so that a NODE_ENV=production or a remote DATABASE_URL set there is seen too.
  loadDotEnv(path.resolve('.env'));
  assertAccountDeleteLocal(process.env);
  try {
    if (args.cancel) {
      await cancelDeletionFromCommandLine(args.caseId);
      console.log('account:delete: the request is closed without being carried out (account.deletion_cancel is in the audit log).');
      return 0;
    }
    const outcome = await carryOutDeletionFromCommandLine(args.caseId);
    console.log('account:delete: the sign-in account, its sessions and its consent records are deleted; the request is closed (account.delete is in the audit log).');
    if (outcome.personId) {
      console.log(`account:delete: profile ${outcome.personId} keeps only its Latin display name, as an unclaimed record (${outcome.visibility}).`);
    }
    console.log('account:delete: now restart the web server (stop pnpm start or pnpm dev and start it again), so public pages drop the cached profile.');
    return 0;
  } catch (error) {
    if (!isServiceError(error)) throw error;
    console.error(`account:delete: ${error.message}`);
    const next = ACCOUNT_DELETE_NEXT_STEPS[error.code];
    if (next) console.error(`account:delete: ${next}`);
    return 1;
  } finally {
    await closeDb();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`account:delete: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
