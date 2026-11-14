// `pnpm erasures:replay [--apply] [--include-unconfirmed]` (review 2026-11,
// docs/adr/0032-retention-and-withdrawal.md): after a backup is restored, repeats the erasures and
// withdrawals that were made after the dump was taken, from the erasure ledger
// (src/server/erasure-ledger.ts, services/erasure-replay.ts). Run it BEFORE anyone uses the
// restored database (docs/operations/backup-and-restore.md).
//
// Without `--apply` it only looks: it lists what it would erase and changes nothing. It is safe to run
// twice. An entry the ledger holds only as "begin" (the process stopped before it was confirmed) is
// listed and left alone unless `--include-unconfirmed` is given.
//
// Local only, like `pnpm account:delete`: refused with NODE_ENV=production and for a database that is
// not on this machine. Prints ids, operations and counts only, never a name or an address. It runs in
// its own process and cannot drop the web server's public cache, so it says to restart the web server.
// Values come from the environment, then from .env.

import path from 'node:path';

import { closeDb } from './db';
import { loadDotEnv } from './db/dotenv';
import { ledgerDir } from './erasure-ledger';
import { ERASURES_REPLAY_USAGE, assertErasuresReplayLocal, erasuresReplayArguments } from './erasures-replay';
import { stopProducer } from './jobs/boss';
import { replayErasures, summariseReplay } from './services/erasure-replay';

const say = (line: string) => console.log(`erasures:replay: ${line}`);

async function main(): Promise<number> {
  const args = erasuresReplayArguments(process.argv.slice(2));
  if (!args) {
    console.error(ERASURES_REPLAY_USAGE);
    return 2;
  }
  // .env first, so that a NODE_ENV=production or a remote DATABASE_URL set there is seen too.
  loadDotEnv(path.resolve('.env'));
  assertErasuresReplayLocal(process.env);
  try {
    say(`ledger folder ${ledgerDir()}${args.apply ? '' : ' (dry run: nothing is changed; add --apply to carry it out)'}`);
    const report = await replayErasures({ apply: args.apply, includeUnconfirmed: args.includeUnconfirmed });
    for (const line of report.lines) {
      say(`${line.op} ${line.id}${line.confirmed ? '' : ' (unconfirmed)'}: ${line.state}, ${line.action}${line.note ? ` (${line.note})` : ''}`);
    }
    if (report.unreadable > 0) say(`${report.unreadable} ledger line(s) could not be read and were skipped (a line torn by a crash looks like this).`);
    const n = summariseReplay(report);
    say(
      `${n.total} entr${n.total === 1 ? 'y' : 'ies'}: ${args.apply ? `${n.erased} carried out` : `${n['would-erase']} to carry out`}, ${n.nothing} already in order or absent` +
        `, ${n['skipped-unconfirmed']} unconfirmed and left alone, ${n.blocked} blocked, ${n.failed} failed.`,
    );
    if (n['skipped-unconfirmed'] > 0) {
      say('an unconfirmed entry was begun but never marked done: check in the audit log whether the erasure was made, then add --include-unconfirmed to carry it out.');
    }
    if (!args.apply && n['would-erase'] > 0) say('this was a dry run. Run it again with --apply to carry these out.');
    if (args.apply && n.erased > 0) say('now restart the web server (stop pnpm start or pnpm dev and start it again), so public pages drop the cached profiles.');
    return n.blocked > 0 || n.failed > 0 ? 1 : 0;
  } finally {
    // An erasure that hides a public profile queues lineage.recompute (src/server/services/lineage-membership.ts).
    await stopProducer();
    await closeDb();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`erasures:replay: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
