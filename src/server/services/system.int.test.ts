// The system status of milestone M12 (src/server/services/system.ts): /admin/system reads queue
// depth, failed jobs, failed e-mail deliveries and the newest local archive, for staff whose
// session passed the second factor and for no one else; /healthz answers only {"ok":true}.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { databaseName } from '../db/env';
import { emailDelivery } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { startProducer } from '../jobs/boss';
import { QUEUE } from '../jobs/queues';
import { createUser, principalOf } from './relationships.test-support';
import { healthAnswer, systemStatus } from './system';

let testDb: TestDatabase | undefined;
let backups: string;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  backups = await mkdtemp(path.join(tmpdir(), 'wcr-system-'));
  process.env.BACKUP_DIR = backups;
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
  await rm(backups, { recursive: true, force: true });
});

describe('systemStatus', () => {
  it('refuses anyone but staff with a verified second factor', async () => {
    await expect(systemStatus(null)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const member = await createUser('system-member');
    await expect(systemStatus(principalOf(member))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const admin = await createUser('system-admin', 'admin');
    await expect(systemStatus(principalOf(admin, 'admin', { unverified: true }))).rejects.toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });
  });

  it('counts the queue, failed jobs and e-mail deliveries, and names the newest archive', async () => {
    const archivist = await createUser('system-archivist', 'archivist');
    const principal = principalOf(archivist, 'archivist');

    const empty = await systemStatus(principal);
    expect(empty.queue).toMatchObject({ waiting: 0, ready: 0, active: 0, failed: 0, recentFailures: [] });
    expect(empty.email).toEqual({ failed: 0, waiting: 0, lastFailedAt: null });
    expect(empty.backup).toEqual({ latest: null, count: 0 });

    // The queues exist once a worker or producer has started (ensureQueues).
    const boss = await startProducer(testDb!.roleUrl('app_rw'));
    await boss.stop({ graceful: false });
    const db = getDb();
    await db.execute(sql`
      INSERT INTO pgboss.job (name, data, start_after) VALUES
        (${QUEUE.retentionPurge}, '{}'::jsonb, now() + interval '1 day'),
        (${QUEUE.searchKeysRebuild}, '{}'::jsonb, now() - interval '30 seconds')`);
    await db.execute(sql`
      INSERT INTO pgboss.job (name, data, state, retry_count, completed_on) VALUES
        (${QUEUE.lineageRecompute}, '{"lineageIds":["demo"]}'::jsonb, 'failed', 2, now())`);
    const lastAttempt = new Date('2026-10-30T12:00:00.000Z');
    await db.insert(emailDelivery).values([
      { idempotencyKey: 'system-failed-1', toEmail: 'demo-failed-1@example.test', template: 'mail-check', status: 'failed', lastAttemptAt: new Date('2026-10-29T12:00:00.000Z') },
      { idempotencyKey: 'system-failed-2', toEmail: 'demo-failed-2@example.test', template: 'mail-check', status: 'failed', lastAttemptAt: lastAttempt },
      { idempotencyKey: 'system-queued-1', toEmail: 'demo-queued-1@example.test', template: 'mail-check', status: 'queued' },
      { idempotencyKey: 'system-sent-1', toEmail: 'demo-sent-1@example.test', template: 'mail-check', status: 'sent' },
    ]);
    const database = databaseName(testDb!.url);
    await writeFile(path.join(backups, `${database}-20261031T020000Z.dump`), 'older');
    await writeFile(path.join(backups, `${database}-20261101T020000Z.dump`), 'newest');
    await writeFile(path.join(backups, `${database}-20261101T020000Z.dump.sha256`), 'x');
    await writeFile(path.join(backups, `other_database-20261102T020000Z.dump`), 'another database');

    const status = await systemStatus(principal);
    expect(status.queue).toMatchObject({ waiting: 2, ready: 1, active: 0, failed: 1 });
    expect(status.queue.queues.find((q) => q.queue === QUEUE.retentionPurge)).toMatchObject({ waiting: 1, ready: 0 });
    expect(status.queue.queues.find((q) => q.queue === QUEUE.searchKeysRebuild)).toMatchObject({ waiting: 1, ready: 1 });
    expect(status.queue.recentFailures).toEqual([{ id: expect.any(String), queue: QUEUE.lineageRecompute, failedAt: expect.any(String), attempts: 3 }]);
    expect(status.email).toEqual({ failed: 2, waiting: 1, lastFailedAt: lastAttempt.toISOString() });
    expect(status.backup).toEqual({
      latest: { file: `${database}-20261101T020000Z.dump`, createdAt: '2026-11-01T02:00:00.000Z', sizeBytes: 6, hasChecksum: true },
      count: 2,
    });
    // Counts, queue names and times: never an address or a job's payload.
    expect(JSON.stringify(status)).not.toMatch(/@|demo/);
  });
});

describe('healthAnswer', () => {
  it('answers only {"ok":true} with 200 when the database and the queue schema answer', async () => {
    expect(await healthAnswer(new Headers())).toEqual({ status: 200, body: '{"ok":true}' });
  });
});
