// The worker process (plan §6.1; milestone M01b): `pnpm worker`, or `pnpm worker:dev` with reload.
//
// Connects only as app_rw, to the database of DATABASE_URL (else TEST_DATABASE_URL), with the
// password DB_APP_RW_PASSWORD; delivers e-mail through MAIL_TRANSPORT (src/server/mail/config.ts).
// The pg-boss schema must exist: `pnpm db:migrate` creates it (pg-boss runs with migrate: false).
// Values come from the environment, then from .env. Stops gracefully on SIGINT and SIGTERM.

import path from 'node:path';

import { closeDb, getDb } from './server/db';
import { loadDotEnv } from './server/db/dotenv';
import { appRwUrl, createBoss } from './server/jobs/boss';
import { startWorker } from './server/jobs/worker';
import { createMailer, createTransportFromConfig, mailConfig } from './server/mail';

const log = (line: string) => console.log(`worker: ${line}`);

async function main(): Promise<void> {
  loadDotEnv(path.resolve('.env'));
  const config = mailConfig();
  const transport = createTransportFromConfig(config);
  const db = getDb();
  const boss = createBoss({ connectionString: appRwUrl(), kind: 'worker' });
  const worker = await startWorker({ boss, db, mailer: createMailer({ db, transport, from: config.from }), log });
  log(`ready (mail transport: ${config.transport})`);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: stopping`);
    try {
      await worker.stop();
      await transport.close();
      await closeDb();
      log('stopped');
      process.exit(0);
    } catch (error) {
      console.error(`worker: stop failed: ${(error as Error).message}`);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((error: unknown) => {
  // Messages here come from configuration and connection errors; never a URL with its password
  // (env.ts and pg leave passwords out of their messages).
  console.error(`worker: failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
