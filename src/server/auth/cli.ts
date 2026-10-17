// `pnpm admin:create --email <address>` (milestone M02, In scope 10): the first administrator of a
// local environment. The account signs up as anyone does (/sign-up), confirms its address and turns
// on two-factor authentication (/account/security); this command then gives it the admin role
// (grantAdminFromCommandLine in src/server/services/roles.ts). Every session of the account ends,
// so it signs in again with its authenticator code.
//
// Local only (src/server/auth/admin-create.ts): refused with NODE_ENV=production and for a database
// that is not on this machine. Prints no secret, no URL and not even the address it was given.
// Values come from the environment, then from .env.

import path from 'node:path';

import { closeDb } from '../db';
import { loadDotEnv } from '../db/dotenv';
import { isServiceError } from '../services/errors';
import { grantAdminFromCommandLine } from '../services/roles';
import { ADMIN_CREATE_NEXT_STEPS, ADMIN_CREATE_USAGE, assertLocalEnvironment, emailArgument } from './admin-create';

async function main(): Promise<number> {
  const email = emailArgument(process.argv.slice(2));
  if (!email) {
    console.error(ADMIN_CREATE_USAGE);
    return 2;
  }
  // .env first, so that a NODE_ENV=production or a remote DATABASE_URL set there is seen too.
  loadDotEnv(path.resolve('.env'));
  assertLocalEnvironment();
  try {
    const outcome = await grantAdminFromCommandLine(email);
    if (outcome === 'already-admin') {
      console.log('admin:create: the account is already an admin; nothing changed.');
    } else {
      console.log('admin:create: the account is now an admin (role.change is in the audit log).');
      console.log('admin:create: every session of the account ended: sign in again with the password and the authenticator code.');
    }
    return 0;
  } catch (error) {
    if (!isServiceError(error)) throw error;
    console.error(`admin:create: ${error.message}`);
    const next = ADMIN_CREATE_NEXT_STEPS[error.code];
    if (next) console.error(`admin:create: ${next}`);
    return 1;
  } finally {
    await closeDb();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`admin:create: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
