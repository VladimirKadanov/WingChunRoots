// pg-boss instances (plan §6.1, §6.2; milestone M01b).
//
// Every instance connects as app_rw and runs with `migrate: false`: the schema `pgboss` belongs to
// migrator and is created by `pnpm db:migrate` (./schema.ts). `reindex: false` as well, because
// REINDEX needs ownership of the indexes; an operator runs boss.getReindexCommands() as migrator
// when needed.
//
//   worker    src/worker.ts: supervision (retention of jobs, expiry), schedules and the handlers.
//   producer  the web process and scripts: only sends jobs, inside the caller's transaction
//             (./outbox.ts). Started lazily, one per process.

import { PgBoss } from 'pg-boss';

import { rolePassword, roleUrl, targetDatabaseUrl } from '../db/env';
import { redactAddresses } from '../mail/mailer';
import { PGBOSS_SCHEMA } from './schema';

type Env = Record<string, string | undefined>;

/** The app_rw URL of the application database (DATABASE_URL, else TEST_DATABASE_URL). */
export function appRwUrl(env: Env = process.env): string {
  return roleUrl(targetDatabaseUrl(env), 'app_rw', rolePassword('app_rw', env));
}

export interface BossOptions {
  /** postgres:// URL that connects as app_rw. */
  connectionString: string;
  /** `worker` supervises and runs schedules; `producer` only sends. */
  kind: 'worker' | 'producer';
}

/** A pg-boss instance with the project's fixed settings; not started. */
export function createBoss({ connectionString, kind }: BossOptions): PgBoss {
  const worker = kind === 'worker';
  const boss = new PgBoss({
    connectionString,
    application_name: `wingchunroots:${kind}`,
    schema: PGBOSS_SCHEMA,
    max: worker ? 6 : 2,
    migrate: false,
    createSchema: false,
    reindex: false,
    supervise: worker,
    schedule: worker,
  });
  // Without a listener an 'error' event would end the process. Only the kind of error is logged:
  // pg errors can quote values from rows (plan §6.4).
  boss.on('error', (error) => logBossError(kind, error));
  return boss;
}

export function logBossError(kind: string, error: unknown): void {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? ` ${e.code}` : '';
  const message = typeof e.message === 'string' ? `: ${redactAddresses(e.message).split('\n')[0]?.slice(0, 200)}` : '';
  console.error(`pg-boss ${kind}: error${code}${message}`);
}

// One producer per process; kept on globalThis so `next dev` reloads do not leak pools.
const globalProducer = globalThis as unknown as { __wcrProducer?: Promise<PgBoss> };

/** The started producer of this process (created on first use, as app_rw). */
export function getProducer(): Promise<PgBoss> {
  globalProducer.__wcrProducer ??= createBoss({ connectionString: appRwUrl(), kind: 'producer' })
    .start()
    .catch((error: unknown) => {
      globalProducer.__wcrProducer = undefined;
      throw error;
    });
  return globalProducer.__wcrProducer;
}

/** Stops the producer of this process, if any (scripts, tests). */
export async function stopProducer(): Promise<void> {
  const producer = globalProducer.__wcrProducer;
  globalProducer.__wcrProducer = undefined;
  if (producer) await (await producer).stop({ graceful: false });
}
