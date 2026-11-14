// The arguments and the local-only rule of `pnpm erasures:replay` (src/server/erasures-replay-cli.ts;
// review 2026-11, docs/adr/0032-retention-and-withdrawal.md), apart from the command so that unit
// tests can import them.

import { assertLocalDatabase } from './auth/admin-create';
import { assertNotProduction } from './db/env';

export const ERASURES_REPLAY_USAGE = 'usage: pnpm erasures:replay [--apply] [--include-unconfirmed]';

/**
 * Refuses anything but a local environment, like `pnpm account:delete`: NODE_ENV=production, or a
 * database that is not on this machine. The message names the command and no URL.
 */
export function assertErasuresReplayLocal(env: Record<string, string | undefined> = process.env): void {
  assertNotProduction('erasures:replay', env);
  assertLocalDatabase('erasures:replay', env);
}

export interface ErasuresReplayArguments {
  /** False (the default): a dry run that changes nothing. */
  apply: boolean;
  /** Also repeat entries that have a `begin` line and no `done`. */
  includeUnconfirmed: boolean;
}

/** `--apply` and `--include-unconfirmed`; null when an argument is unknown. */
export function erasuresReplayArguments(args: readonly string[]): ErasuresReplayArguments | null {
  const out: ErasuresReplayArguments = { apply: false, includeUnconfirmed: false };
  for (const arg of args) {
    if (arg === '--apply') out.apply = true;
    else if (arg === '--include-unconfirmed') out.includeUnconfirmed = true;
    else if (arg !== '--') return null;
  }
  return out;
}
