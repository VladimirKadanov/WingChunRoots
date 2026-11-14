// The erasure ledger as the services use it (src/server/erasure-ledger.ts, docs/adr/0032-retention-and-withdrawal.md).
//
// `beginLedger` throws ErasureLedgerError when the line cannot be written, and the erasure must then be
// refused (fail closed). A bare Error would reach an administrator's form, an API client or a member as
// "Internal server error", with the reason only in the server log. This turns it into the refusal the
// caller can show:
//
//   operator  an administrator or the command line: the message names the folder and the system error
//             code (never a person) and says what to check;
//   member    a signed-in member withdrawing their own request: a calm sentence that says nothing was
//             changed and that trying again later is safe; the reason goes to the log for whoever runs
//             the server.
//
// A ServiceError is the refusal the services already use, so the transaction rolls back as for any other
// refusal. No line was written, so the caller has no handle to settle (there is nothing to mark `aborted`).

import { beginLedger, checkLedgerWritable, ErasureLedgerError, type LedgerHandle, type LedgerOperation } from '../erasure-ledger';
import { logger } from '../log';
import { ServiceError } from './errors';

export const LEDGER_MEMBER_MESSAGE = 'This could not be done just now and nothing was changed. Try again in a little while; if it keeps happening, ask the administrator.';

type Audience = 'operator' | 'member';

function refusal(op: LedgerOperation, error: unknown, audience: Audience): unknown {
  if (!(error instanceof ErasureLedgerError)) return error;
  // The message holds a folder and an error code: no person, no id.
  logger().error(`[erasure-ledger] ${op} refused: ${error.message}`);
  return new ServiceError('CONFLICT', audience === 'operator' ? error.message : LEDGER_MEMBER_MESSAGE);
}

export async function beginLedgerOrRefuse(op: LedgerOperation, id: string, audience: Audience): Promise<LedgerHandle> {
  try {
    return await beginLedger(op, id);
  } catch (error) {
    throw refusal(op, error, audience);
  }
}

/**
 * The same refusal, ahead of a step the refusal cannot take back (an erasure ends the account's
 * subscriptions before its transaction): nothing is written, `begin` stays the check that counts.
 */
export async function requireLedgerWritable(op: LedgerOperation, audience: Audience): Promise<void> {
  try {
    await checkLedgerWritable();
  } catch (error) {
    throw refusal(op, error, audience);
  }
}
