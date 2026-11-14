// A ledger line for the restore drill (scripts/restore-drill.sh, check 11; review 2026-11,
// docs/adr/0032-retention-and-withdrawal.md): writes `begin` and `done` for one erasure of the
// given account into the ledger folder the drill made for itself, as if the account had been
// erased after the archive was taken.
//
//   tsx scripts/ops/erasure-ledger-fixture.ts --dir <folder> --id <account id>
//
// The folder is required and never defaulted: the drill must not write into the real ledger
// (ERASURE_LEDGER_DIR, or erasures/ in the backup folder). Prints nothing but "ok".

import path from 'node:path';

import { assertNotProduction } from '../../src/server/db/env';
import { appendLedger } from '../../src/server/erasure-ledger';

function option(name: string): string | null {
  const args = process.argv.slice(2);
  const at = args.indexOf(name);
  const value = at >= 0 ? args[at + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

async function main(): Promise<void> {
  assertNotProduction('erasure-ledger-fixture');
  const dir = option('--dir');
  const id = option('--id');
  if (!dir || !id) throw new Error('usage: tsx scripts/ops/erasure-ledger-fixture.ts --dir <folder> --id <account id>');
  const folder = path.resolve(dir);
  await appendLedger({ op: 'account.erase', id, state: 'begin' }, { dir: folder });
  await appendLedger({ op: 'account.erase', id, state: 'done' }, { dir: folder });
  process.stdout.write('ok\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`erasure-ledger-fixture: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
