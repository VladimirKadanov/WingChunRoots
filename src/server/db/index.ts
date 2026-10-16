// Data access (plan §6.1): two connection pools, one per database role.
//   getDb()        app_rw         services and the worker
//   getPublicDb()  app_public_ro  anonymous reads; sees only v_public_person, v_public_edge and
//                                 v_public_school, so a bug in a public query cannot reach a
//                                 private table.
// Every connection has statement_timeout = 2 s. Only src/server code imports this module; routes
// and components go through src/server/services (ESLint enforces the boundary).

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import { type DbRole, rolePassword, roleUrl, targetDatabaseUrl } from './env';

export const STATEMENT_TIMEOUT_MS = 2_000;

export type Database = NodePgDatabase & { $client: Pool };

/** Pool settings shared by both roles. */
export function poolConfig(connectionString: string, applicationName: string): PoolConfig {
  return {
    connectionString,
    application_name: applicationName,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    max: 10,
    idleTimeoutMillis: 30_000,
  };
}

/** A Drizzle database on its own pool for `role`, on the server and database of `baseUrl`. */
export function createRoleDatabase(role: Exclude<DbRole, 'migrator'>, baseUrl: string, password: string): Database {
  const pool = new Pool(poolConfig(roleUrl(baseUrl, role, password), `wingchunroots:${role}`));
  // An idle pooled client can die (PostgreSQL restart, pg_terminate_backend, a laptop waking
  // from sleep). node-postgres then emits 'error' on the pool; without a listener Node treats it
  // as an unhandled 'error' event and the whole process (next start, the worker) exits. The pool
  // drops the dead client and opens a new one on the next query. Only the role and the SQLSTATE
  // are logged: never the URL, a query or its parameters (plan §6.4).
  pool.on('error', (error) => logIdleClientError(role, error));
  return drizzle({ client: pool });
}

/** The log line for a pooled client that failed while idle. */
export function logIdleClientError(role: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`db pool ${role}: idle client error${typeof code === 'string' ? ` ${code}` : ''}`);
}

// One pool per role per process; kept on globalThis so `next dev` reloads do not leak pools.
const globalPools = globalThis as unknown as { __wcrDb?: Partial<Record<DbRole, Database>> };

function cached(role: Exclude<DbRole, 'migrator'>): Database {
  globalPools.__wcrDb ??= {};
  const existing = globalPools.__wcrDb[role];
  if (existing) return existing;
  const db = createRoleDatabase(role, targetDatabaseUrl(), rolePassword(role));
  globalPools.__wcrDb[role] = db;
  return db;
}

/** The app_rw database: services and the worker. */
export function getDb(): Database {
  return cached('app_rw');
}

/** The app_public_ro database: anonymous reads of the three public views only. */
export function getPublicDb(): Database {
  return cached('app_public_ro');
}

/** Closes both pools (worker shutdown, scripts). */
export async function closeDb(): Promise<void> {
  const pools = globalPools.__wcrDb ?? {};
  globalPools.__wcrDb = {};
  await Promise.all(Object.values(pools).map((db) => db.$client.end()));
}
