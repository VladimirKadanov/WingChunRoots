// Administrative database operations behind `pnpm db:*` and the integration tests (milestone
// M01): bootstrap, migrations, reset, throwaway databases, migration checks and the content hash
// of the seeded data. Never imported by the application at run time.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

import { assertSafeToReset, databaseName, redactUrl, splitPassword, withDatabase } from './env';

/** The repository root: the nearest directory with this project's package.json. */
export function repoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).name === 'wingchunroots') return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('cannot find the wingchunroots repository root');
    dir = parent;
  }
}

export const migrationsFolder = (): string => path.join(repoRoot(), 'drizzle');

/** Migration folders in apply order (drizzle-kit 1.0 layout: drizzle/<timestamp>_<name>/migration.sql). */
export function migrationNames(): string[] {
  const dir = migrationsFolder();
  return readdirSync(dir)
    .filter((name) => existsSync(path.join(dir, name, 'migration.sql')))
    .sort((a, b) => a.localeCompare(b));
}

export async function withClient<T>(url: string, fn: (client: Client) => Promise<T>, applicationName = 'wingchunroots:admin'): Promise<T> {
  const client = new Client({ connectionString: url, application_name: applicationName });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function isSuperuser(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ rolsuper: boolean }>('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
  return rows[0]?.rolsuper === true;
}

/**
 * Runs `attempt` again while it fails with "tuple concurrently updated": test files bootstrap
 * their own databases in parallel, and the cluster-wide ALTER ROLE statements of
 * scripts/db-bootstrap.sql then race. The script is idempotent, so running it again is safe.
 */
export async function retryOnConcurrentRoleUpdate(attempt: () => Promise<{ ok: boolean; stderr: string }>, describe: string): Promise<void> {
  for (let n = 1; ; n++) {
    const { ok, stderr } = await attempt();
    if (ok) return;
    if (n < 8 && stderr.includes('tuple concurrently updated')) {
      await new Promise((resolve) => setTimeout(resolve, 50 * n + randomBytes(1)[0]!));
      continue;
    }
    throw new Error(`scripts/db-bootstrap.sql failed on ${describe}:\n${stderr.trim()}`);
  }
}

/** scripts/db-bootstrap.sql reads the role passwords with \getenv, which psql 15 added. */
export const PSQL_MIN_MAJOR = 15;

/** The major version in `psql --version` output, or 0 when there is none. */
export function psqlMajor(versionOutput: string): number {
  const match = /(\d+)/.exec(versionOutput);
  return match ? Number(match[1]) : 0;
}

let psqlChecked = false;

/** Fails with a clear hint unless the psql on PATH is new enough for scripts/db-bootstrap.sql. */
export function assertPsqlVersion(): void {
  if (psqlChecked) return;
  const result = spawnSync('psql', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw new Error(`psql could not run (install the PostgreSQL client): ${result.error.message}`);
  const major = psqlMajor(result.stdout);
  if (major < PSQL_MIN_MAJOR) {
    throw new Error(
      `psql ${major} is too old: scripts/db-bootstrap.sql needs psql ${PSQL_MIN_MAJOR} or newer (\\getenv). ` +
        'On Ubuntu 24.04 (WSL2) install postgresql-client (psql 16); Ubuntu 22.04 ships psql 14, so install ' +
        'postgresql-client-16 from the PostgreSQL apt repository or move to Ubuntu 24.04 (README.md).',
    );
  }
  psqlChecked = true;
}

/**
 * psql against `url` with the password in PGPASSWORD instead of the command line, where every
 * local user could read it (ps, /proc/<pid>/cmdline).
 */
export function spawnPsql(url: string, args: string[], env: NodeJS.ProcessEnv = process.env): SpawnSyncReturns<string> {
  const { url: bare, password } = splitPassword(url);
  return spawnSync('psql', [bare, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: password ? { ...env, PGPASSWORD: password } : env,
  });
}

/**
 * Runs scripts/db-bootstrap.sql against `superuserUrl` with psql (the script uses psql meta
 * commands). Role passwords come from the environment through \getenv; unset ones stay as they are.
 */
export async function runBootstrap(superuserUrl: string): Promise<void> {
  assertPsqlVersion();
  await retryOnConcurrentRoleUpdate(async () => {
    const result = spawnPsql(superuserUrl, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(repoRoot(), 'scripts', 'db-bootstrap.sql')]);
    if (result.error) throw new Error(`psql could not run (install the PostgreSQL client): ${result.error.message}`);
    return { ok: result.status === 0, stderr: result.stderr };
  }, redactUrl(superuserUrl));
}

/**
 * The pinned drizzle-kit, run with this Node: `node <drizzle-kit>/bin.cjs <args>`. Not the
 * node_modules/.bin shim, which is a POSIX script on Linux and a .cmd file on native Windows
 * (and .cmd files need a shell since Node's fix for CVE-2024-27980).
 */
export function runDrizzleKit(args: string[]): SpawnSyncReturns<string> {
  const root = repoRoot();
  // drizzle-kit's `exports` hide package.json and bin.cjs, so start from its main entry point.
  let dir = path.dirname(createRequire(path.join(root, 'package.json')).resolve('drizzle-kit'));
  while (!existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('cannot find the drizzle-kit package');
    dir = parent;
  }
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['drizzle-kit'];
  if (!bin) throw new Error('drizzle-kit has no bin entry');
  return spawnSync(process.execPath, [path.join(dir, bin), ...args], { cwd: root, encoding: 'utf8' });
}

/**
 * Applies every pending migration as the role `migrator` (SET ROLE), whoever connects, so every
 * application object has the same owner in every environment. Returns the newly applied names.
 */
export async function migrateDatabase(url: string): Promise<string[]> {
  return withClient(
    url,
    async (client) => {
      try {
        await client.query('SET ROLE migrator');
      } catch (error) {
        throw new Error(
          `cannot SET ROLE migrator on ${redactUrl(url)} (${(error as Error).message}). ` +
            'Run scripts/db-bootstrap.sh for this database first, and connect as a superuser or as migrator.',
        );
      }
      const before = new Set(await appliedMigrations(client));
      await migrate(drizzle({ client }), { migrationsFolder: migrationsFolder() });
      const after = await appliedMigrations(client);
      return after.filter((name) => !before.has(name));
    },
    'wingchunroots:migrate',
  );
}

/** Names of the migrations recorded in drizzle.__drizzle_migrations (empty before the first run). */
export async function appliedMigrations(client: Client): Promise<string[]> {
  const { rows: exists } = await client.query<{ ok: boolean }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok",
  );
  if (!exists[0]?.ok) return [];
  const { rows } = await client.query<{ name: string }>('SELECT name FROM drizzle.__drizzle_migrations ORDER BY id');
  return rows.map((r) => r.name);
}

/**
 * Drops every application object (schemas `public` and `drizzle`) and restores the empty state
 * of a bootstrapped database: an empty `public` schema owned by pg_database_owner and PostGIS.
 * Only for a local database or TEST_DATABASE_URL, never with NODE_ENV=production, and only as a
 * superuser (PostGIS objects belong to the superuser).
 */
export async function resetDatabase(url: string): Promise<void> {
  assertSafeToReset(url);
  await withClient(url, async (client) => {
    if (!(await isSuperuser(client))) {
      throw new Error(`db:reset needs a superuser connection: ${redactUrl(url)}`);
    }
    await client.query('BEGIN');
    try {
      await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public AUTHORIZATION pg_database_owner');
      await client.query('GRANT USAGE ON SCHEMA public TO PUBLIC');
      await client.query("COMMENT ON SCHEMA public IS 'standard public schema'");
      // As scripts/db-bootstrap.sql: PostGIS needs a superuser, the migrations run as migrator.
      await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

const SAFE_DB_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Creates an empty UTF-8 database from template0 (C.UTF-8, as everywhere else in the project). */
export async function createDatabase(superuserUrl: string, name: string): Promise<string> {
  if (!SAFE_DB_NAME.test(name)) throw new Error(`unsafe database name: ${name}`);
  await withClient(superuserUrl, (client) =>
    client.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C.UTF-8'`),
  );
  return withDatabase(superuserUrl, name);
}

export async function dropDatabase(superuserUrl: string, name: string): Promise<void> {
  if (!SAFE_DB_NAME.test(name)) throw new Error(`unsafe database name: ${name}`);
  const maintenance = databaseName(superuserUrl) === name ? withDatabase(superuserUrl, 'postgres') : superuserUrl;
  await withClient(maintenance, (client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}

/** A unique name for a throwaway database. */
export function throwawayDatabaseName(prefix: string): string {
  return `${prefix}_${process.pid}_${randomBytes(4).toString('hex')}`;
}

/**
 * A stable hash of the contents of `tables`: every row as text, sorted, in UTC. Two loads of the
 * same fixtures give the same hash (milestone M01, Done when 2).
 */
export async function contentHash(client: Client, tables: readonly string[]): Promise<string> {
  await client.query("SET TIME ZONE 'UTC'");
  await client.query("SET DateStyle = 'ISO, YMD'");
  const hash = createHash('sha256');
  for (const table of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`unsafe table name: ${table}`);
    const { rows } = await client.query<{ n: string; digest: string }>(
      `SELECT count(*)::text AS n, md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS digest FROM "${table}" t`,
    );
    hash.update(`${table}:${rows[0]!.n}:${rows[0]!.digest}\n`);
  }
  return hash.digest('hex');
}
