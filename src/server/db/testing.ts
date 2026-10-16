// Throwaway databases for the integration tests (milestone M01, In scope 9).
//
// Server:
//   - TEST_DATABASE_URL (cloud session, CI, local Docker Compose): a superuser URL. Every test
//     file gets its own database on that server, created empty from template0 and dropped at the
//     end; the roles are cluster-wide and keep the passwords from the environment.
//   - otherwise Testcontainers starts the same PostGIS image as docker-compose.yml and CI (needs
//     a Docker daemon; cloud sessions have none and always use TEST_DATABASE_URL). Role
//     passwords default to random throwaway values for that container.
// Each database is bootstrapped with scripts/db-bootstrap.sql (the single source of the roles,
// the database owner and PostGIS), then optionally migrated and seeded.

import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { createDatabase, dropDatabase, migrateDatabase, repoRoot, runBootstrap, throwawayDatabaseName } from './admin';
import { type DbRole, loadDotEnv, ROLE_PASSWORD_ENV, rolePassword, roleUrl, withDatabase } from './env';
import { seedDatabase, type SeedResult } from './seed';

/** Same image and digest as docker-compose.yml and CI (scripts/verify.d/M01.sh compares them). */
export const POSTGIS_IMAGE =
  'postgis/postgis:18-3.6@sha256:60f6ad1d21ea86a67d47780b9a0d1e1d200500f62b19293fa834d0dea80b8677';

interface TestServer {
  kind: 'TEST_DATABASE_URL' | 'testcontainers';
  superuserUrl: string;
  bootstrap(databaseUrl: string, databaseName: string): Promise<void>;
}

let serverPromise: Promise<TestServer> | undefined;

function testServer(): Promise<TestServer> {
  serverPromise ??= startTestServer();
  return serverPromise;
}

async function startTestServer(): Promise<TestServer> {
  loadDotEnv(path.join(repoRoot(), '.env'));
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    // Fail early with a clear message when a password is missing.
    for (const role of Object.keys(ROLE_PASSWORD_ENV) as DbRole[]) rolePassword(role);
    return { kind: 'TEST_DATABASE_URL', superuserUrl: url, bootstrap: async (databaseUrl) => runBootstrap(databaseUrl) };
  }
  return startContainer();
}

async function startContainer(): Promise<TestServer> {
  // Loaded only when needed: with TEST_DATABASE_URL the tests never touch Docker.
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  for (const name of Object.values(ROLE_PASSWORD_ENV)) {
    process.env[name] ||= randomBytes(16).toString('hex');
  }
  const container = await new PostgreSqlContainer(POSTGIS_IMAGE)
    .withEnvironment({ POSTGRES_INITDB_ARGS: '--encoding=UTF8 --locale=C.UTF-8' })
    .withCopyFilesToContainer([{ source: path.join(repoRoot(), 'scripts', 'db-bootstrap.sql'), target: '/tmp/db-bootstrap.sql' }])
    .start();
  const env = Object.fromEntries(Object.values(ROLE_PASSWORD_ENV).map((name) => [name, process.env[name] ?? '']));
  return {
    kind: 'testcontainers',
    superuserUrl: withDatabase(container.getConnectionUri(), 'postgres'),
    // psql inside the container, so the host needs no PostgreSQL client.
    async bootstrap(_databaseUrl, databaseName) {
      const result = await container.exec(
        ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', container.getUsername(), '-d', databaseName, '-f', '/tmp/db-bootstrap.sql'],
        { env },
      );
      if (result.exitCode !== 0) throw new Error(`scripts/db-bootstrap.sql failed in the container: ${result.stderr || result.output}`);
    },
  };
}

export interface TestDatabase {
  name: string;
  /** Superuser URL of the throwaway database. */
  url: string;
  /** The same database as `role`, with its password from the environment. */
  roleUrl(role: DbRole): string;
  /** Migrations applied by createTestDatabase (all of them unless `migrate: false`). */
  applied: string[];
  seeded?: SeedResult;
  server: TestServer['kind'];
  drop(): Promise<void>;
}

/** A new, bootstrapped database; migrated unless `migrate: false`, seeded when `seed: true`. */
export async function createTestDatabase(opts: { migrate?: boolean; seed?: boolean } = {}): Promise<TestDatabase> {
  const server = await testServer();
  const name = throwawayDatabaseName('wcr_it');
  const url = await createDatabase(server.superuserUrl, name);
  const drop = () => dropDatabase(server.superuserUrl, name);
  try {
    await server.bootstrap(url, name);
    const applied = opts.migrate === false ? [] : await migrateDatabase(url);
    const seeded = opts.seed ? await seedDatabase(url) : undefined;
    return {
      name,
      url,
      roleUrl: (role) => roleUrl(url, role, rolePassword(role)),
      applied,
      seeded,
      server: server.kind,
      drop,
    };
  } catch (error) {
    await drop();
    throw error;
  }
}
