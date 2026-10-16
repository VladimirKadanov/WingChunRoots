// Milestone M01b, Done when 2 (outbox.int.test.ts): one idempotency key gives exactly one
// email_delivery row; a failed send is retried; after the last attempt the delivery is `failed`;
// a job from a rolled-back transaction is never sent. Runs the real worker in-process as app_rw,
// with a transport that records every attempt.

import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { emailDelivery } from '../db/schema';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { createMailer } from '../mail/mailer';
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
    const key = `test:once:${to}`;
    const input = { template: 'mail-check' as const, to, data: sample, idempotencyKey: key };

    const first = await w.db.transaction((tx) => queueEmail(tx, input, w.boss));
    const second = await w.db.transaction((tx) => queueEmail(tx, input, w.boss));
    // Two transactions racing with the same key: one waits for the other and finds its row.
    const raced = await Promise.all([
      w.db.transaction((tx) => queueEmail(tx, input, w.boss)),
      w.db.transaction((tx) => queueEmail(tx, input, w.boss)),
    ]);
    expect(first.queued).toBe(true);
    expect(second).toEqual({ deliveryId: first.deliveryId, queued: false });
    expect(raced.map((r) => r.deliveryId)).toEqual([first.deliveryId, first.deliveryId]);

    const [{ n }] = (await w.db.select({ n: count() }).from(emailDelivery).where(eq(emailDelivery.idempotencyKey, key))) as [{ n: number }];
    expect(n).toBe(1);
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

  it('retries a failed send and records every attempt', async () => {
    const to = testAddress('fail-twice');
    const key = `test:retry:${to}`;
    await w.db.transaction((tx) => queueEmail(tx, { template: 'mail-check', to, data: sample, idempotencyKey: key }, w.boss));

    const row = await settled(key);
    expect(row).toMatchObject({ status: 'sent', attempts: 3, error: null });
    expect(transport.attempts.filter((a) => a.to === to).map((a) => a.ok)).toEqual([false, false, true]);
  });

  it('marks the delivery failed after the last attempt, without the address in the error', async () => {
    const to = testAddress('fail-always');
    const key = `test:fail:${to}`;
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
    const key = `test:rollback:${to}`;
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
    await w.db.transaction((tx) =>
      queueEmail(tx, { template: 'mail-check', to: later, data: sample, idempotencyKey: `test:after:${later}` }, w.boss),
    );
    await settled(`test:after:${later}`);
    expect(transport.attempts.some((a) => a.to === to)).toBe(false);
  });

  it('fails at once, without retries, when the template refuses the data', async () => {
    const to = testAddress('bad-data');
    const key = `test:bad-data:${to}`;
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
