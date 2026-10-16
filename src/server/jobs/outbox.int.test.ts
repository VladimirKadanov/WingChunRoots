// Milestone M01b, Done when 2 (outbox.int.test.ts): one idempotency key gives exactly one
// email_delivery row; a failed send is retried; after the last attempt the delivery is `failed`;
// a job from a rolled-back transaction is never sent. Runs the real worker in-process as app_rw,
// with a transport that records every attempt.

import { randomUUID } from 'node:crypto';

import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../db/admin';
import { emailDelivery } from '../db/schema';
import { value } from '../db/test-support';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { createMailer, MailInputError } from '../mail/mailer';
import { queueEmail } from './outbox';
import { QUEUE } from './queues';
import { eventually, recordingTransport, startTestWorker, testAddress, type TestWorker } from './test-support';

let testDb: TestDatabase;
let w: TestWorker;
// Addresses with "fail-twice" fail on the first two attempts, "fail-always" on every attempt.
const transport = recordingTransport(
  (message, attempt) => message.to.startsWith('fail-always') || (message.to.startsWith('fail-twice') && attempt <= 2),
);

const sample = { recipientNames: [{ value: 'Demo Student', lang: 'en' }] };

beforeAll(async () => {
  testDb = await createTestDatabase();
  w = await startTestWorker(testDb, transport);
});

afterAll(async () => {
  await w?.stop();
  await testDb?.drop();
});

async function delivery(idempotencyKey: string) {
  const [row] = await w.db.select().from(emailDelivery).where(eq(emailDelivery.idempotencyKey, idempotencyKey));
  return row;
}

async function jobsFor(deliveryId: string): Promise<number> {
  const { rows } = await w.db.$client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pgboss.job WHERE name = $1 AND data->>'deliveryId' = $2`,
    [QUEUE.emailSend, deliveryId],
  );
  return Number(rows[0]!.n);
}

async function rowsFor(idempotencyKey: string): Promise<number> {
  const [{ n }] = (await w.db.select({ n: count() }).from(emailDelivery).where(eq(emailDelivery.idempotencyKey, idempotencyKey))) as [
    { n: number },
  ];
  return n;
}

/** Sessions of the test database whose INSERT into email_delivery waits for a lock. */
async function waitingInserts(): Promise<number> {
  return withClient(testDb.url, (c) =>
    value<number>(
      c,
      `SELECT count(*)::int FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'insert into "email_delivery"%'`,
    ),
  );
}

/** Idempotency keys are ids, never addresses (checkIdempotencyKey refuses "@"). */
const newKey = (label: string) => `test:${label}:${randomUUID()}`;

async function settled(idempotencyKey: string) {
  return eventually(
    async () => {
      const row = await delivery(idempotencyKey);
      return row && row.status !== 'queued' ? row : undefined;
    },
    30_000,
    `delivery ${idempotencyKey} to leave "queued"`,
  );
}

describe('the outbox', () => {
  it('one idempotency key gives exactly one email_delivery row, one job and one message', async () => {
    const to = testAddress('once');
    const key = newKey('once');
    const input = { template: 'mail-check' as const, to, data: sample, idempotencyKey: key };

    const first = await w.db.transaction((tx) => queueEmail(tx, input, w.boss));
    const second = await w.db.transaction((tx) => queueEmail(tx, input, w.boss));
    // Two more transactions after the first commit: both find its row.
    const later = await Promise.all([
      w.db.transaction((tx) => queueEmail(tx, input, w.boss)),
      w.db.transaction((tx) => queueEmail(tx, { ...input, to: to.toUpperCase() }, w.boss)),
    ]);
    expect(first.queued).toBe(true);
    expect(second).toEqual({ deliveryId: first.deliveryId, queued: false });
    expect(later).toEqual([
      { deliveryId: first.deliveryId, queued: false },
      { deliveryId: first.deliveryId, queued: false },
    ]);

    expect(await rowsFor(key)).toBe(1);
    expect(await jobsFor(first.deliveryId)).toBe(1);

    const row = await settled(key);
    expect(row).toMatchObject({ id: first.deliveryId, status: 'sent', attempts: 1, error: null, toEmail: to });
    expect(row.sentAt).toBeInstanceOf(Date);

    // The Mailer itself is idempotent too: another send with the key delivers nothing.
    const again = await createMailer({ db: w.db, transport, from: 'WingChunRoots <no-reply@wingchunroots.test>' }).send(input);
    expect(again).toEqual({ deliveryId: first.deliveryId, status: 'sent', duplicate: true });
    expect(transport.delivered.filter((m) => m.to === to)).toHaveLength(1);
    expect(transport.delivered.find((m) => m.to === to)?.messageId).toBe(`<${first.deliveryId}@wingchunroots.test>`);
  });

  it('two first-time transactions with a new key: the second waits for the first, then finds its row', async () => {
    const to = testAddress('race');
    const key = newKey('race');
    const input = { template: 'mail-check' as const, to, data: sample, idempotencyKey: key };

    let inserted!: () => void;
    const firstInserted = new Promise<void>((resolve) => (inserted = resolve));
    const first = w.db.transaction(async (tx) => {
      const result = await queueEmail(tx, input, w.boss);
      inserted();
      // Keep the new row uncommitted until the second transaction's INSERT waits for it on the
      // unique key: the race of two first-time inserts, not a second insert after a commit.
      await eventually(async () => ((await waitingInserts()) > 0 ? true : undefined), 10_000, 'the second INSERT to wait');
      return result;
    });
    await Promise.race([firstInserted, first]);
    expect(await rowsFor(key)).toBe(0); // not committed yet
    const second = w.db.transaction((tx) => queueEmail(tx, input, w.boss));

    const [a, b] = await Promise.all([first, second]);
    expect(a.queued).toBe(true);
    expect(b).toEqual({ deliveryId: a.deliveryId, queued: false });
    expect(await rowsFor(key)).toBe(1);
    expect(await jobsFor(a.deliveryId)).toBe(1);
    const row = await settled(key);
    expect(row).toMatchObject({ id: a.deliveryId, status: 'sent', attempts: 1 });
    expect(transport.delivered.filter((m) => m.to === to)).toHaveLength(1);
  });

  it('refuses a key that is reused for another recipient or template, and keeps the first e-mail', async () => {
    const to = testAddress('reused');
    const key = newKey('reused');
    const { deliveryId } = await w.db.transaction((tx) =>
      queueEmail(tx, { template: 'mail-check', to, data: sample, idempotencyKey: key }, w.boss),
    );
    const other = testAddress('other');
    await expect(
      w.db.transaction((tx) => queueEmail(tx, { template: 'mail-check', to: other, data: sample, idempotencyKey: key }, w.boss)),
    ).rejects.toThrow(MailInputError);
    // The Mailer checks it too.
    const mailer = createMailer({ db: w.db, transport, from: 'WingChunRoots <no-reply@wingchunroots.test>' });
    await expect(mailer.send({ template: 'mail-check', to: other, data: sample, idempotencyKey: key })).rejects.toThrow(/another e-mail/);

    const row = await settled(key);
    expect(row).toMatchObject({ id: deliveryId, toEmail: to, status: 'sent', attempts: 1 });
    expect(await rowsFor(key)).toBe(1);
    expect(transport.attempts.some((a) => a.to === other)).toBe(false);
  });

  it('refuses a key with "@" before anything is written: keys hold no personal data', async () => {
    const to = testAddress('at-key');
    await expect(
      w.db.transaction((tx) => queueEmail(tx, { template: 'mail-check', to, data: sample, idempotencyKey: `test:at:${to}` }, w.boss)),
    ).rejects.toThrow(/must not hold personal data/);
    expect(await rowsFor(`test:at:${to}`)).toBe(0);
  });

  it('retries a failed send and records every attempt', async () => {
    const to = testAddress('fail-twice');
    const key = newKey('retry');
    await w.db.transaction((tx) => queueEmail(tx, { template: 'mail-check', to, data: sample, idempotencyKey: key }, w.boss));

    const row = await settled(key);
    expect(row).toMatchObject({ status: 'sent', attempts: 3, error: null });
    expect(transport.attempts.filter((a) => a.to === to).map((a) => a.ok)).toEqual([false, false, true]);
  });

  it('marks the delivery failed after the last attempt, without the address in the error', async () => {
    const to = testAddress('fail-always');
    const key = newKey('fail');
    const { deliveryId } = await w.db.transaction((tx) =>
      queueEmail(tx, { template: 'mail-check', to, data: sample, idempotencyKey: key }, w.boss),
    );

    const row = await settled(key);
    // retryLimit 2 (FAST_RETRIES): one attempt and two retries, then no more.
    expect(row).toMatchObject({ id: deliveryId, status: 'failed', attempts: 3, sentAt: null });
    expect(row.error).toContain('550 mailbox unavailable');
    expect(row.error).not.toContain(to);
    expect(row.error).toContain('<address>');
    expect(transport.attempts.filter((a) => a.to === to)).toHaveLength(3);
    // The job ends failed (and its dead letter changes nothing more).
    await eventually(async () => {
      const { rows } = await w.db.$client.query<{ state: string }>(
        `SELECT state::text FROM pgboss.job WHERE name = $1 AND data->>'deliveryId' = $2`,
        [QUEUE.emailSend, deliveryId],
      );
      return rows[0]?.state === 'failed' ? true : undefined;
    }, 10_000, 'the email.send job to be failed');
    // Nothing more after the last attempt.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(transport.attempts.filter((a) => a.to === to)).toHaveLength(3);
    expect((await delivery(key))?.attempts).toBe(3);
  });

  it('never sends the job of a rolled-back transaction', async () => {
    const to = testAddress('rolled-back');
    const key = newKey('rollback');
    let deliveryId: string | undefined;
    await expect(
      w.db.transaction(async (tx) => {
        ({ deliveryId } = await queueEmail(tx, { template: 'mail-check', to, data: sample, idempotencyKey: key }, w.boss));
        expect(await tx.select().from(emailDelivery).where(eq(emailDelivery.id, deliveryId))).toHaveLength(1);
        throw new Error('the change fails after the e-mail was queued');
      }),
    ).rejects.toThrow('the change fails');
    expect(deliveryId).toBeDefined();

    expect(await delivery(key)).toBeUndefined();
    expect(await jobsFor(deliveryId!)).toBe(0);
    // A delivery queued afterwards goes out, so the worker was polling all along.
    const later = testAddress('after-rollback');
    const laterKey = newKey('after');
    await w.db.transaction((tx) => queueEmail(tx, { template: 'mail-check', to: later, data: sample, idempotencyKey: laterKey }, w.boss));
    await settled(laterKey);
    expect(transport.attempts.some((a) => a.to === to)).toBe(false);
  });

  it('fails at once, without retries, when the template refuses the data', async () => {
    const to = testAddress('bad-data');
    const key = newKey('bad-data');
    // queueEmail checks the data, so a bad job can only come from elsewhere: write one directly.
    await w.db.transaction(async (tx) => {
      const [row] = await tx.insert(emailDelivery).values({ toEmail: to, template: 'mail-check', idempotencyKey: key }).returning();
      await w.boss.send(QUEUE.emailSend, { deliveryId: row!.id, data: { recipientNames: 'not a list' } });
    });
    const row = await settled(key);
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    expect(row.error).toMatch(/TemplateDataError|1 to 4 names/);
    expect(transport.attempts.some((a) => a.to === to)).toBe(false);
  });

  it('refuses an address that is not one plain address, before anything is written', async () => {
    const bad = ['two@wingchunroots.test, three@wingchunroots.test', 'Demo <demo@wingchunroots.test>', 'demo@wingchunroots.test\r\nBcc: x@wingchunroots.test'];
    for (const [i, to] of bad.entries()) {
      await expect(
        w.db.transaction((tx) => queueEmail(tx, { template: 'mail-check', to, data: sample, idempotencyKey: `test:bad:${i}` }, w.boss)),
      ).rejects.toThrow(/one plain e-mail address/);
    }
    const [{ n }] = (await w.db
      .select({ n: count() })
      .from(emailDelivery)
      .where(sql`${emailDelivery.idempotencyKey} LIKE 'test:bad:%'`)) as [{ n: number }];
    expect(n).toBe(0);
  });
});
