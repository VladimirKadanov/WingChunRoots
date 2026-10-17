// The pg-boss schema `pgboss` (plan §6.1, §6.2; milestone M01b, In scope 1).
//
// pg-boss runs with `migrate: false`: the application roles never run DDL. This migration step
// creates and updates the schema as the role `migrator` from pg-boss's own construction and
// migration plans (getConstructionPlans, getMigrationPlans), and grants app_rw what the worker and
// the producers need: USAGE on the schema and DML on its tables, never CREATE on the database or
// on the schema. `pnpm db:migrate` runs it after the Drizzle migrations (src/server/db/admin.ts).
//
// SQL compatible with PostgreSQL 16+ (plan §3.2); pg-boss supports 13+.

import { getConstructionPlans, getMigrationPlans } from 'pg-boss';
import type { Client } from 'pg';

/** The schema pg-boss lives in. */
export const PGBOSS_SCHEMA = 'pgboss';

/**
 * The schema version a construction plan installs. Read from the plan rather than from
 * pg-boss's package.json, so this module needs no `import.meta` and also loads where TypeScript is
 * compiled to CommonJS (Playwright).
 */
export function constructionPlanVersion(plan: string): number {
  const match = /INSERT INTO \S+\.version\(version\) VALUES \('(\d+)'\)/.exec(plan);
  if (!match) throw new Error('the pg-boss construction plan names no schema version');
  return Number(match[1]);
}

/** The schema version the pinned pg-boss expects (its package.json `pgboss.schema`). */
export const PGBOSS_SCHEMA_VERSION: number = constructionPlanVersion(getConstructionPlans(PGBOSS_SCHEMA));

export interface PgBossMigration {
  /** The version before this run: null when the schema did not exist. */
  from: number | null;
  /** The version after this run. */
  to: number;
  /** What happened: `created`, `migrated` or `unchanged`. */
  action: 'created' | 'migrated' | 'unchanged';
  /** Deferred indexes that were missing or invalid and have been rebuilt (see repairDeferredIndexes). */
  repaired: string[];
}

/** The installed pg-boss schema version, or null when the schema is not installed. */
export async function installedPgBossVersion(client: Client): Promise<number | null> {
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT to_regclass('${PGBOSS_SCHEMA}.version') IS NOT NULL AS ok`,
  );
  if (!rows[0]?.ok) return null;
  const version = await client.query<{ version: string }>(`SELECT version FROM ${PGBOSS_SCHEMA}.version`);
  const value = version.rows[0]?.version;
  return value === undefined ? null : Number(value);
}

/**
 * Splits a pg-boss migration script into its transaction (BEGIN ... COMMIT) and the statements
 * that follow it. getMigrationPlans appends index builds with CREATE INDEX CONCURRENTLY after the
 * COMMIT, and those cannot run inside a transaction block, which a multi-statement query string
 * is; so each of them goes to the server on its own.
 */
export function splitMigrationScript(script: string): { transaction: string; concurrent: string[] } {
  const marker = /^\s*COMMIT;\s*$/gm;
  let end = -1;
  for (let match = marker.exec(script); match; match = marker.exec(script)) end = match.index + match[0].length;
  if (end < 0) return { transaction: script, concurrent: [] };
  const concurrent = script
    .slice(end)
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    // A chunk of comments alone is not a statement.
    .filter((statement) => statement.split('\n').some((line) => line.trim() !== '' && !line.trim().startsWith('--')));
  return { transaction: script.slice(0, end), concurrent };
}

/**
 * The index builds that pg-boss's migration plans run after their COMMIT (CREATE INDEX
 * CONCURRENTLY IF NOT EXISTS on job_common), by index name, for the indexes that the current schema
 * version has. Collected from the plans of every version pg-boss can still migrate from, the newest
 * statement winning, so that a build from any earlier migration can be repeated.
 */
export function deferredIndexBuilds(): Map<string, string> {
  const current = new Set(
    [...getConstructionPlans(PGBOSS_SCHEMA).matchAll(/CREATE (?:UNIQUE )?INDEX (job_i\d+) ON /g)].map((m) =>
      m[1]!.replace(/^job_/, 'job_common_'),
    ),
  );
  const builds = new Map<string, string>();
  for (let version = PGBOSS_SCHEMA_VERSION - 1; version > 0; version--) {
    let script: string;
    try {
      script = getMigrationPlans(PGBOSS_SCHEMA, version);
    } catch {
      break; // older than pg-boss can migrate from
    }
    for (const statement of splitMigrationScript(script).concurrent) {
      const name = /CREATE (?:UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS (\w+) ON /.exec(statement)?.[1];
      if (name && current.has(name) && !builds.has(name)) builds.set(name, statement);
    }
  }
  return builds;
}

/**
 * Rebuilds the deferred indexes (deferredIndexBuilds) that are missing or invalid. The version
 * row is committed before those builds run, so an interrupted or failed CREATE INDEX CONCURRENTLY
 * would otherwise stay missing (or INVALID, which IF NOT EXISTS skips) while every later run reports
 * the schema as current. Any other invalid index in the schema is an error.
 */
async function repairDeferredIndexes(client: Client): Promise<string[]> {
  const indexes = async () =>
    new Map(
      (
        await client.query<{ name: string; valid: boolean }>(
          `SELECT c.relname AS name, i.indisvalid AS valid
             FROM pg_index i
             JOIN pg_class c ON c.oid = i.indexrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1`,
          [PGBOSS_SCHEMA],
        )
      ).rows.map((row) => [row.name, row.valid]),
    );
  const before = await indexes();
  const repaired: string[] = [];
  for (const [name, statement] of deferredIndexBuilds()) {
    const valid = before.get(name);
    if (valid === true) continue;
    if (valid === false) await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${PGBOSS_SCHEMA}.${name}`);
    await client.query(statement);
    repaired.push(name);
  }
  const invalid = [...(await indexes())].filter(([, valid]) => !valid).map(([name]) => name);
  if (invalid.length > 0) throw new Error(`invalid indexes in the pg-boss schema: ${invalid.join(', ')}`);
  return repaired;
}

/**
 * Creates or updates the pg-boss schema on `client`, which must already act as the role
 * `migrator` (SET ROLE migrator), rebuilds deferred indexes that an interrupted run left missing
 * or invalid, then (re)applies the privileges of app_rw. Idempotent.
 */
export async function migratePgBossSchema(client: Client): Promise<PgBossMigration> {
  const from = await installedPgBossVersion(client);
  let action: PgBossMigration['action'] = 'unchanged';
  if (from === null) {
    await client.query(getConstructionPlans(PGBOSS_SCHEMA));
    action = 'created';
  } else if (from < PGBOSS_SCHEMA_VERSION) {
    const { transaction, concurrent } = splitMigrationScript(getMigrationPlans(PGBOSS_SCHEMA, from));
    await client.query(transaction);
    for (const statement of concurrent) await client.query(statement);
    action = 'migrated';
  } else if (from > PGBOSS_SCHEMA_VERSION) {
    throw new Error(
      `the pg-boss schema is at version ${from}, newer than the ${PGBOSS_SCHEMA_VERSION} of the pinned pg-boss: ` +
        'run the matching release of the application, or roll back with getRollbackPlans()',
    );
  }
  const repaired = await repairDeferredIndexes(client);
  await grantPgBossPrivileges(client);
  const to = await installedPgBossVersion(client);
  if (to !== PGBOSS_SCHEMA_VERSION) {
    throw new Error(`the pg-boss schema is at version ${to} after the migration step, expected ${PGBOSS_SCHEMA_VERSION}`);
  }
  return { from, to, action, repaired };
}

/**
 * The privileges of the application roles on the pg-boss schema (plan §6.2). app_rw gets USAGE and
 * DML, and the same on tables and sequences that later pg-boss migrations create as migrator;
 * nobody else gets anything. CREATE is never granted, so app_rw cannot run DDL there.
 */
export const PGBOSS_GRANTS = [
  `REVOKE ALL ON SCHEMA ${PGBOSS_SCHEMA} FROM PUBLIC`,
  `GRANT USAGE ON SCHEMA ${PGBOSS_SCHEMA} TO app_rw`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${PGBOSS_SCHEMA} TO app_rw`,
  `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${PGBOSS_SCHEMA} TO app_rw`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA ${PGBOSS_SCHEMA} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA ${PGBOSS_SCHEMA} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_rw`,
] as const;

async function grantPgBossPrivileges(client: Client): Promise<void> {
  await client.query('BEGIN');
  try {
    for (const statement of PGBOSS_GRANTS) await client.query(statement);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
