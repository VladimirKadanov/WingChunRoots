// The db:* package scripts (milestone M01, In scope 1):
//
//   pnpm db:migrate   apply pending migrations (as migrator) to DATABASE_URL, or to
//                     TEST_DATABASE_URL when DATABASE_URL is not set, then create or update the
//                     pg-boss schema (M01b; pg-boss itself runs with migrate: false)
//   pnpm db:seed      replace the application data with the fictional demo data (never in production)
//   pnpm db:reset     drop every application object; only a local database or TEST_DATABASE_URL,
//                     never with NODE_ENV=production; run db:migrate and db:seed after it
//   pnpm db:check     drizzle-kit check, no ungenerated schema changes, and every migration and the
//                     pg-boss schema applied to a new empty database (twice: the second run
//                     applies nothing)
//
// Values come from the environment, then from .env (the environment wins). Every URL is printed
// without its password.

import path from 'node:path';

import { PGBOSS_SCHEMA_VERSION, type PgBossMigration } from '../jobs/schema';
import {
  createDatabase,
  dropDatabase,
  migrateAll,
  migrationNames,
  repoRoot,
  resetDatabase,
  runBootstrap,
  runDrizzleKit,
  throwawayDatabaseName,
} from './admin';
import { loadDotEnv } from './dotenv';
import { redactUrl, targetDatabaseUrl } from './env';
import { seedDatabase } from './seed';

const log = (message: string) => console.log(message);

function describePgBoss({ action, from, to, repaired }: PgBossMigration): string {
  const rebuilt = repaired.length > 0 ? `; rebuilt the unfinished index build(s) ${repaired.join(', ')}` : '';
  if (action === 'created') return `pg-boss schema created at version ${to}${rebuilt}`;
  if (action === 'migrated') return `pg-boss schema migrated from version ${from} to ${to}${rebuilt}`;
  return `pg-boss schema already at version ${to}${rebuilt}`;
}

async function migrate(): Promise<void> {
  const url = targetDatabaseUrl();
  const { drizzle: applied, pgboss } = await migrateAll(url);
  log(applied.length > 0 ? `db:migrate: applied ${applied.join(', ')}` : 'db:migrate: nothing to apply');
  log(`db:migrate: ${describePgBoss(pgboss)}`);
  log(`db:migrate: ${redactUrl(url)} is at ${migrationNames().at(-1) ?? '(no migrations)'}`);
}

async function seed(): Promise<void> {
  const url = targetDatabaseUrl();
  const result = await seedDatabase(url);
  const counts = Object.entries(result.counts)
    .map(([table, n]) => `${table} ${n}`)
    .join(', ');
  log(`db:seed: seed ${result.seed} loaded into ${redactUrl(url)}: ${counts}`);
  log(`db:seed: content hash ${result.hash}`);
  for (const what of result.skipped) {
    log(`db:seed: warning: demo accounts created without ${what}; scripts/init-env.sh adds the variables`);
  }
}

async function reset(): Promise<void> {
  const url = targetDatabaseUrl();
  await resetDatabase(url);
  log(`db:reset: ${redactUrl(url)} is empty (run pnpm db:migrate && pnpm db:seed)`);
}

/** Runs the pinned drizzle-kit and returns its JSON result. */
function drizzleKit(args: string[]): { status: string; [key: string]: unknown } {
  const result = runDrizzleKit([...args, '--output', 'json']);
  if (result.error) throw result.error;
  const line = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .at(-1);
  if (!line) {
    throw new Error(`drizzle-kit ${args.join(' ')} printed no JSON (exit ${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(line) as { status: string };
}

async function check(): Promise<void> {
  const conflicts = drizzleKit(['check']);
  if (conflicts.status !== 'ok') throw new Error(`drizzle-kit check: ${JSON.stringify(conflicts)}`);
  log('db:check: drizzle-kit check: no conflicts between migrations');

  const pending = drizzleKit(['generate', '--explain']);
  if (pending.status !== 'no_changes') {
    throw new Error(`the schema has changes without a migration (run pnpm db:generate): ${JSON.stringify(pending)}`);
  }
  log('db:check: the schema in src/server/db/schema matches the migrations');

  // A new empty database on the test server (or the development server), dropped at the end.
  const server = process.env.TEST_DATABASE_URL || targetDatabaseUrl();
  const name = throwawayDatabaseName('wcr_check');
  const url = await createDatabase(server, name);
  try {
    await runBootstrap(url);
    const { drizzle: applied, pgboss } = await migrateAll(url);
    const expected = migrationNames();
    if (applied.join() !== expected.join()) {
      throw new Error(`applied ${applied.length} of ${expected.length} migrations: ${applied.join(', ')}`);
    }
    if (pgboss.action !== 'created' || pgboss.to !== PGBOSS_SCHEMA_VERSION || pgboss.repaired.length > 0) {
      throw new Error(`the pg-boss schema step on an empty database: ${describePgBoss(pgboss)}`);
    }
    const again = await migrateAll(url);
    if (again.drizzle.length > 0) throw new Error(`a second run applied ${again.drizzle.join(', ')}`);
    if (again.pgboss.action !== 'unchanged' || again.pgboss.repaired.length > 0) {
      throw new Error(`a second run: ${describePgBoss(again.pgboss)}`);
    }
    log(`db:check: all ${expected.length} migrations apply to an empty database (${expected.join(', ')})`);
    log(`db:check: the pg-boss schema step creates version ${PGBOSS_SCHEMA_VERSION} and a second run changes nothing`);
  } finally {
    await dropDatabase(server, name);
  }
}

const COMMANDS: Record<string, () => Promise<void>> = { migrate, seed, reset, check };

async function main(): Promise<void> {
  const command = process.argv[2] ?? '';
  const run = COMMANDS[command];
  if (!run) {
    console.error(`usage: tsx src/server/db/cli.ts <${Object.keys(COMMANDS).join('|')}>`);
    process.exit(2);
  }
  loadDotEnv(path.join(repoRoot(), '.env'));
  await run();
}

main().catch((error: unknown) => {
  console.error(`db:${process.argv[2] ?? ''}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
