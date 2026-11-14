// `pnpm account:reset-2fa --email <address>` (review 2026-11-13, auth.md 2; docs/adr/0029-safety-net.md):
// the way back when an account has lost its authenticator and its backup codes, or when a rotated
// BETTER_AUTH_SECRET made every stored TOTP secret unreadable (docs/operations/incident.md, "Lost
// second factor"). It removes the account's second factor (resetTwoFactorFromCommandLine in
// src/server/services/two-factor.ts), ends its sessions, takes a staff role away (a staff role needs
// a second factor) and writes auth.2fa.reset to the audit log.
//
// Local only, exactly like `pnpm admin:create` (src/server/auth/admin-create.ts): refused with
// NODE_ENV=production and for a database that is not on this machine. Prints no secret, no URL and
// not even the address it was given. Values come from the environment, then from .env.

import path from 'node:path';

import { closeDb } from '../db';
import { loadDotEnv } from '../db/dotenv';
import { stopProducer } from '../jobs/boss';
import { isServiceError } from '../services/errors';
import { resetTwoFactorFromCommandLine } from '../services/two-factor';
import { emailArgument } from './admin-create';
import { assertResetTwoFactorLocal, RESET_2FA_NEXT_STEPS, RESET_2FA_USAGE } from './reset-2fa';

async function main(): Promise<number> {
  const email = emailArgument(process.argv.slice(2));
  if (!email) {
    console.error(RESET_2FA_USAGE);
    return 2;
  }
  // .env first, so that a NODE_ENV=production or a remote DATABASE_URL set there is seen too.
  loadDotEnv(path.resolve('.env'));
  assertResetTwoFactorLocal();
  try {
    const outcome = await resetTwoFactorFromCommandLine(email);
    if (!outcome.changed) {
      console.log('account:reset-2fa: the account has no second factor; nothing changed.');
      return 0;
    }
    console.log('account:reset-2fa: the second factor of the account is removed (auth.2fa.reset is in the audit log); every session of the account ended.');
    if (outcome.roleRemoved) {
      console.log(`account:reset-2fa: the account was ${outcome.roleRemoved === 'admin' ? 'an admin' : `a ${outcome.roleRemoved}`}; a staff role needs a second factor, so it is now a plain account (role.change is in the audit log).`);
      console.log('account:reset-2fa: next: the account signs in with its password, turns two-factor authentication on at /account/security, then give the role back (pnpm admin:create --email <address> for an admin; /admin/users for the other roles).');
    } else {
      console.log('account:reset-2fa: next: the account signs in with its password and can turn two-factor authentication on again at /account/security.');
    }
    return 0;
  } catch (error) {
    if (!isServiceError(error)) throw error;
    console.error(`account:reset-2fa: ${error.message}`);
    const next = RESET_2FA_NEXT_STEPS[error.code];
    if (next) console.error(`account:reset-2fa: ${next}`);
    return 1;
  } finally {
    // The security notice queues an e-mail job (src/server/jobs/outbox.ts).
    await stopProducer();
    await closeDb();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`account:reset-2fa: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
