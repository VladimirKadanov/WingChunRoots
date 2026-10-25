// `pnpm search:rebuild` (milestone M07): queues search.keys.rebuild, which a running worker turns
// into fresh search keys for every person (after a change to src/server/search/keys.ts).
//
// `pnpm mail:check <address> [--name <Latin-script name>]` (milestone M01b): queues a "mail-check"
// e-mail through the outbox, exactly as a service would, so a running worker (`pnpm worker`)
// delivers it: locally to Mailpit (http://localhost:8025), in a cloud session to .mail/.
// Never with NODE_ENV=production. Values come from the environment, then from .env.

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { closeDb, getDb } from '../db';
import { loadDotEnv } from '../db/dotenv';
import { assertNotProduction } from '../db/env';
import { stopProducer } from './boss';
import { queueEmail } from './outbox';
import { queueSearchKeysRebuild } from './search-keys';

async function searchRebuild(): Promise<void> {
  loadDotEnv(path.resolve('.env'));
  try {
    const jobId = await queueSearchKeysRebuild();
    console.log(`search:rebuild: queued search.keys.rebuild (job ${jobId}); a running worker (pnpm worker) writes the keys`);
  } finally {
    await stopProducer();
    await closeDb();
  }
}

async function main(): Promise<void> {
  const [command, to, ...rest] = process.argv.slice(2);
  if (command === 'search-rebuild') return searchRebuild();
  const nameAt = rest.indexOf('--name');
  const name = nameAt >= 0 ? rest[nameAt + 1] : undefined;
  if (command !== 'mail-check' || !to || (nameAt >= 0 && !name)) {
    console.error('usage: pnpm mail:check <address> [--name <Latin-script name>]');
    process.exit(2);
  }
  // .env first, so that a NODE_ENV=production set there is seen too.
  loadDotEnv(path.resolve('.env'));
  assertNotProduction('mail:check');
  const db = getDb();
  try {
    const { deliveryId } = await db.transaction((tx) =>
      queueEmail(tx, {
        template: 'mail-check',
        to,
        // The language of a name typed here is unknown; und-Latn says only that it is in Latin script.
        data: name ? { recipientNames: [{ value: name, lang: 'und-Latn' }] } : {},
        idempotencyKey: `mail-check:${randomUUID()}`,
      }),
    );
    console.log(`mail:check: queued delivery ${deliveryId}; a running worker (pnpm worker) delivers it`);
  } finally {
    await stopProducer();
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(`mail:check: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
