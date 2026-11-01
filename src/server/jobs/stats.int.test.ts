// What /admin/system and /healthz read of the job queue (milestone M12): counts per queue straight
// from pgboss.job as app_rw, the newest failed jobs without their payload, and whether the queue's
// schema is at the version this build expects.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRoleDatabase, type Database } from '../db';
import { withClient } from '../db/admin';
import { rolePassword } from '../db/env';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { startProducer } from './boss';
import { QUEUE, QUEUE_OPTIONS } from './queues';
import { queueCounts, queueSchemaReady, recentFailedJobs } from './stats';

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createRoleDatabase('app_rw', testDb.url, rolePassword('app_rw'));
});

afterAll(async () => {
  await db?.$client.end();
  await testDb?.drop();
});

describe('queueCounts and recentFailedJobs', () => {
  it('list every queue of the app, zero when it is empty', async () => {
    const counts = await queueCounts(db);
    expect(counts.map((q) => q.queue)).toEqual(QUEUE_OPTIONS.map(([name]) => name));
    expect(counts.every((q) => q.waiting === 0 && q.ready === 0 && q.active === 0 && q.failed === 0 && q.oldestReadySeconds === null)).toBe(true);
    expect(await recentFailedJobs(db)).toEqual([]);
  });

  it('count waiting, ready, active and failed jobs, and the age of the oldest ready one', async () => {
    const boss = await startProducer(testDb.roleUrl('app_rw'));
    try {
      const ready = await boss.send(QUEUE.retentionPurge, { secret: 'demo-payload@wingchunroots.test' });
      await boss.send(QUEUE.retentionPurge, {}, { startAfter: 3600 });
      const active = await boss.send(QUEUE.searchKeysRebuild, {});
      const failed = await boss.send(QUEUE.lineageRecompute, { lineageIds: ['demo'] });
      await withClient(testDb.url, async (c) => {
        await c.query(`UPDATE pgboss.job SET start_after = now() - interval '120 seconds' WHERE id = $1`, [ready]);
        await c.query(`UPDATE pgboss.job SET state = 'active', started_on = now() WHERE id = $1`, [active]);
        await c.query(`UPDATE pgboss.job SET state = 'failed', retry_count = 2, completed_on = now() WHERE id = $1`, [failed]);
      });

      const byName = new Map((await queueCounts(db)).map((q) => [q.queue, q]));
      const purge = byName.get(QUEUE.retentionPurge);
      expect(purge).toMatchObject({ waiting: 2, ready: 1, active: 0, failed: 0 });
      expect(purge?.oldestReadySeconds).toBeGreaterThanOrEqual(119);
      expect(byName.get(QUEUE.searchKeysRebuild)).toMatchObject({ waiting: 0, ready: 0, active: 1, failed: 0, oldestReadySeconds: null });
      expect(byName.get(QUEUE.lineageRecompute)).toMatchObject({ waiting: 0, active: 0, failed: 1 });

      const failures = await recentFailedJobs(db);
      expect(failures).toEqual([{ id: failed, queue: QUEUE.lineageRecompute, failedAt: expect.any(String), attempts: 3 }]);
      // Queue names, times and attempts only: never a job's payload.
      expect(JSON.stringify(failures)).not.toContain('demo');
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});

describe('queueSchemaReady', () => {
  it('is true at the expected version, false at another, and throws without the schema', async () => {
    expect(await queueSchemaReady(db)).toBe(true);
    await withClient(testDb.url, async (c) => {
      await c.query('UPDATE pgboss.version SET version = version - 1');
      try {
        expect(await queueSchemaReady(db)).toBe(false);
      } finally {
        await c.query('UPDATE pgboss.version SET version = version + 1');
      }
    });
    expect(await queueSchemaReady(db)).toBe(true);

    // checkHealth (src/server/services/system.ts) counts a throw as a failed check.
    const empty = await createTestDatabase({ migrate: false });
    const other = createRoleDatabase('app_rw', empty.url, rolePassword('app_rw'));
    try {
      await expect(queueSchemaReady(other)).rejects.toThrow();
    } finally {
      await other.$client.end();
      await empty.drop();
    }
  });
});
