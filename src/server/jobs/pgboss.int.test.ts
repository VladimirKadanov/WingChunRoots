// Milestone M01b, Done when 2 (pgboss.int.test.ts): the worker starts as app_rw, which has no CREATE
// on the database. The schema `pgboss` comes from the migration step as migrator (pg-boss runs with
// migrate: false), and that step also updates an older schema (plan §6.2).

import { getRollbackPlans } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../db/admin';
import { PG, pgError, rows, value } from '../db/test-support';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { createBoss } from './boss';
import { QUEUE } from './queues';
import { installedPgBossVersion, migratePgBossSchema, PGBOSS_SCHEMA, PGBOSS_SCHEMA_VERSION } from './schema';
import { eventually, recordingTransport, startTestWorker, testAddress } from './test-support';
import { queueEmail } from './outbox';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

const asMigrator = <T>(fn: Parameters<typeof withClient<T>>[1]) =>
  withClient(testDb.url, async (client) => {
    await client.query('SET ROLE migrator');
    return fn(client);
  });

describe('the pg-boss schema', () => {
  it('exists at the version of the pinned pg-boss, and migrator owns every object in it', async () => {
    await withClient(testDb.url, async (c) => {
      expect(await installedPgBossVersion(c)).toBe(PGBOSS_SCHEMA_VERSION);
      expect(await value<string>(c, `SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = $1`, [PGBOSS_SCHEMA])).toBe('migrator');
      const owners = await rows<{ owner: string }>(
        c,
        `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1`,
        [PGBOSS_SCHEMA],
      );
      expect(owners.map((r) => r.owner)).toEqual(['migrator']);
    });
  });

  it('app_rw has USAGE and DML there, but CREATE nowhere: not on the database, not on a schema', async () => {
    await withClient(testDb.url, async (c) => {
      const privileges = await rows<Record<string, boolean>>(
        c,
        `SELECT has_database_privilege('app_rw', current_database(), 'CREATE') AS db_create,
                has_schema_privilege('app_rw', $1, 'CREATE') AS pgboss_create,
                has_schema_privilege('app_rw', 'public', 'CREATE') AS public_create,
                has_schema_privilege('app_rw', $1, 'USAGE') AS pgboss_usage,
                has_table_privilege('app_rw', $1 || '.job', 'SELECT, INSERT, UPDATE, DELETE') AS job_dml,
                has_table_privilege('app_rw', $1 || '.queue', 'SELECT, INSERT, UPDATE, DELETE') AS queue_dml,
                has_schema_privilege('app_public_ro', $1, 'USAGE') AS public_ro_usage,
                (SELECT rolcreatedb OR rolcreaterole OR rolsuper FROM pg_roles WHERE rolname = 'app_rw') AS role_attributes`,
        [PGBOSS_SCHEMA],
      );
      expect(privileges[0]).toEqual({
        db_create: false,
        pgboss_create: false,
        public_create: false,
        pgboss_usage: true,
        job_dml: true,
        queue_dml: true,
        public_ro_usage: false,
        role_attributes: false,
      });
    });
    await withClient(testDb.roleUrl('app_rw'), async (c) => {
      expect((await pgError(c.query(`CREATE TABLE ${PGBOSS_SCHEMA}.demo_x (id int)`))).code).toBe(PG.insufficientPrivilege);
      expect((await pgError(c.query('CREATE SCHEMA demo_x'))).code).toBe(PG.insufficientPrivilege);
      expect((await pgError(c.query(`DROP TABLE ${PGBOSS_SCHEMA}.job`))).message).toMatch(/must be owner/);
    });
  });

  it('the worker starts as app_rw with migrate: false, sends and works a job', async () => {
    const transport = recordingTransport();
    const w = await startTestWorker(testDb, transport);
    try {
      const sessions = await withClient(testDb.url, (c) =>
        rows<{ usename: string }>(
          c,
          `SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'wingchunroots:worker'`,
        ),
      );
      expect(sessions.map((s) => s.usename)).toEqual(['app_rw']);

      const to = testAddress('pgboss');
      const key = `test:pgboss:${to}`;
      await w.db.transaction((tx) =>
        queueEmail(tx, { template: 'mail-check', to, data: { recipientNames: [{ value: 'Demo Student', lang: 'en' }] }, idempotencyKey: key }, w.boss),
      );
      await eventually(async () => (transport.delivered.some((m) => m.to === to) ? true : undefined), 20_000, 'the e-mail');
      const queues = (await w.boss.getQueues()).map((q) => q.name);
      expect(queues).toEqual(expect.arrayContaining(Object.values(QUEUE)));
    } finally {
      await w.stop();
    }
  });

  it('a producer starts as app_rw too, and pg-boss refuses to start on a database without the schema', async () => {
    const producer = createBoss({ connectionString: testDb.roleUrl('app_rw'), kind: 'producer' });
    await producer.start();
    await producer.stop({ graceful: false });

    const empty = await createTestDatabase({ migrate: false });
    try {
      const boss = createBoss({ connectionString: empty.roleUrl('app_rw'), kind: 'worker' });
      await expect(boss.start()).rejects.toThrow(/pg-boss is not installed/);
      await boss.stop({ graceful: false });
    } finally {
      await empty.drop();
    }
  });
});

describe('the migration step', () => {
  it('a second run changes nothing', async () => {
    expect(await asMigrator(migratePgBossSchema)).toEqual({ from: PGBOSS_SCHEMA_VERSION, to: PGBOSS_SCHEMA_VERSION, action: 'unchanged' });
  });

  it('updates an older schema with the migration plans, index builds included', async () => {
    await asMigrator(async (c) => {
      await c.query(getRollbackPlans(PGBOSS_SCHEMA, PGBOSS_SCHEMA_VERSION));
      const previous = await installedPgBossVersion(c);
      expect(previous).toBeLessThan(PGBOSS_SCHEMA_VERSION);

      expect(await migratePgBossSchema(c)).toEqual({ from: previous, to: PGBOSS_SCHEMA_VERSION, action: 'migrated' });
      const invalid = await rows(
        c,
        `SELECT i.indexrelid::regclass::text AS name FROM pg_index i
           JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1 AND NOT i.indisvalid`,
        [PGBOSS_SCHEMA],
      );
      expect(invalid).toEqual([]);
    });
    // The grants hold for what the migration created.
    await withClient(testDb.url, async (c) => {
      const missing = await rows(
        c,
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
            AND NOT has_table_privilege('app_rw', c.oid, 'SELECT, INSERT, UPDATE, DELETE')`,
        [PGBOSS_SCHEMA],
      );
      expect(missing).toEqual([]);
    });
  });

  it('refuses a schema newer than the pinned pg-boss', async () => {
    await asMigrator(async (c) => {
      await c.query(`UPDATE ${PGBOSS_SCHEMA}.version SET version = $1`, [PGBOSS_SCHEMA_VERSION + 1]);
      try {
        await expect(migratePgBossSchema(c)).rejects.toThrow(/newer than the/);
      } finally {
        await c.query(`UPDATE ${PGBOSS_SCHEMA}.version SET version = $1`, [PGBOSS_SCHEMA_VERSION]);
      }
    });
  });
});
