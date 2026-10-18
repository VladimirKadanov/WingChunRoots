// The retention job of M01b and M02 (docs/data-model.md §7): e-mail addresses are erased when their
// period is over, and expired sessions and verification values are deleted, and only then. Runs as
// app_rw, like the worker.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRoleDatabase, type Database } from '../db';
import { withClient } from '../db/admin';
import { rolePassword } from '../db/env';
import { PG, pgError, rows } from '../db/test-support';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { purgeExpiredEmailAddresses, purgeExpiredSessions, purgeUnconfirmedAccounts } from './retention';

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

const hash = (n: number) => n.toString(16).padStart(64, '0');

describe('purgeExpiredEmailAddresses', () => {
  it('erases e-mail addresses past their retention period and nothing else', async () => {
    await withClient(testDb.url, async (c) => {
      await c.query(`
        INSERT INTO email_delivery (idempotency_key, to_email, template, status, created_at) VALUES
          ('old-sent',   'old-sent@wingchunroots.test',   'mail-check', 'sent',   now() - interval '91 days'),
          ('old-failed', 'old-failed@wingchunroots.test', 'mail-check', 'failed', now() - interval '91 days'),
          ('old-queued', 'old-queued@wingchunroots.test', 'mail-check', 'queued', now() - interval '91 days'),
          ('recent',     'recent@wingchunroots.test',     'mail-check', 'sent',   now() - interval '89 days')`);
      const [{ id: personId }] = (await c.query<{ id: string }>(`INSERT INTO person (slug, kind) VALUES ('demo-retention', 'living') RETURNING id`)).rows as [{ id: string }];
      await c.query(
        `INSERT INTO invitation (person_id, email, token_hash, status, expires_at, accepted_at, updated_at) VALUES
           ($1, 'accepted-old@wingchunroots.test', $2, 'accepted', now() - interval '40 days', now() - interval '31 days', now() - interval '31 days'),
           ($1, 'accepted-new@wingchunroots.test', $3, 'accepted', now() + interval '10 days', now() - interval '29 days', now() - interval '29 days'),
           ($1, 'expired-old@wingchunroots.test',  $4, 'expired',  now() - interval '31 days', NULL, now() - interval '1 day'),
           ($1, 'pending-old@wingchunroots.test',  $5, 'pending',  now() - interval '31 days', NULL, now() - interval '60 days'),
           ($1, 'pending-new@wingchunroots.test',  $6, 'pending',  now() - interval '29 days', NULL, now() - interval '60 days'),
           ($1, 'revoked-old@wingchunroots.test',  $7, 'revoked',  now() + interval '10 days', NULL, now() - interval '31 days')`,
        [personId, hash(1), hash(2), hash(3), hash(4), hash(5), hash(6)],
      );
    });

    expect(await purgeExpiredEmailAddresses(db)).toEqual({ emailDeliveries: 3, invitations: 4 });
    // Idempotent.
    expect(await purgeExpiredEmailAddresses(db)).toEqual({ emailDeliveries: 0, invitations: 0 });

    await withClient(testDb.url, async (c) => {
      expect(await rows(c, 'SELECT idempotency_key, to_email, status FROM email_delivery ORDER BY idempotency_key')).toEqual([
        { idempotency_key: 'old-failed', to_email: null, status: 'failed' },
        { idempotency_key: 'old-queued', to_email: null, status: 'failed' },
        { idempotency_key: 'old-sent', to_email: null, status: 'sent' },
        { idempotency_key: 'recent', to_email: 'recent@wingchunroots.test', status: 'sent' },
      ]);
      expect(await rows(c, 'SELECT token_hash, email, status FROM invitation ORDER BY token_hash')).toEqual([
        { token_hash: hash(1), email: null, status: 'accepted' },
        { token_hash: hash(2), email: 'accepted-new@wingchunroots.test', status: 'accepted' },
        { token_hash: hash(3), email: null, status: 'expired' },
        { token_hash: hash(4), email: null, status: 'expired' },
        { token_hash: hash(5), email: 'pending-new@wingchunroots.test', status: 'pending' },
        { token_hash: hash(6), email: null, status: 'revoked' },
      ]);
    });
  });

  it('works in batches until nothing is left, and skips a row another transaction holds', async () => {
    await withClient(testDb.url, (c) =>
      c.query(`
        INSERT INTO email_delivery (idempotency_key, to_email, template, status, created_at)
        SELECT 'batch-' || n, 'batch-' || n || '@wingchunroots.test', 'mail-check', 'sent', now() - interval '100 days'
          FROM generate_series(1, 5) AS n`),
    );
    // An attempt of the Mailer holds batch-5 (FOR UPDATE): the purge neither waits for it nor fails.
    await withClient(testDb.url, async (holder) => {
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM email_delivery WHERE idempotency_key = 'batch-5' FOR UPDATE`);
      try {
        expect(await purgeExpiredEmailAddresses(db, { batchSize: 2 })).toEqual({ emailDeliveries: 4, invitations: 0 });
      } finally {
        await holder.query('COMMIT');
      }
    });
    // The next run erases it.
    expect(await purgeExpiredEmailAddresses(db, { batchSize: 2 })).toEqual({ emailDeliveries: 1, invitations: 0 });
    await withClient(testDb.url, async (c) => {
      expect(await rows(c, `SELECT count(*)::int AS n FROM email_delivery WHERE idempotency_key LIKE 'batch-%' AND to_email IS NOT NULL`)).toEqual([
        { n: 0 },
      ]);
    });
    await expect(purgeExpiredEmailAddresses(db, { batchSize: 0 })).rejects.toThrow(/batchSize/);
  });

  it('the database refuses a queued e-mail or a pending invitation without an address', async () => {
    await withClient(testDb.roleUrl('app_rw'), async (c) => {
      const queued = await pgError(c.query(`INSERT INTO email_delivery (idempotency_key, template) VALUES ('no-address', 'mail-check')`));
      expect(queued.code).toBe(PG.checkViolation);
      expect(queued.constraint).toBe('email_delivery_queued_has_address');
      const pending = await pgError(c.query(`UPDATE invitation SET email = NULL WHERE status = 'pending'`));
      expect(pending.code).toBe(PG.checkViolation);
      expect(pending.constraint).toBe('invitation_pending_has_email');
    });
  });
});

describe('purgeExpiredSessions', () => {
  it('deletes expired sessions and verification values and keeps the current ones', async () => {
    await withClient(testDb.url, async (c) => {
      const [{ id: userId }] = (
        await c.query<{ id: string }>(`INSERT INTO auth_user (email, email_verified) VALUES ('demo-retention@example.test', true) RETURNING id`)
      ).rows as [{ id: string }];
      await c.query(
        `INSERT INTO auth_session (token, user_id, expires_at, ip_address) VALUES
           ('expired-1', $1, now() - interval '1 minute', $2),
           ('expired-2', $1, now() - interval '30 days', NULL),
           ('current',   $1, now() + interval '7 days', $2)`,
        [userId, hash(7)],
      );
      await c.query(`
        INSERT INTO auth_verification (identifier, value, expires_at) VALUES
          ('expired-token', 'demo', now() - interval '1 hour'),
          ('current-token', 'demo', now() + interval '1 hour')`);
      await c.query(`
        INSERT INTO auth_throttle (key, count, expires_at) VALUES
          ('sign-in:expired', 3, now() - interval '1 second'),
          ('sign-in:current', 3, now() + interval '15 minutes')`);
    });

    expect(await purgeExpiredSessions(db, { batchSize: 1 })).toEqual({ sessions: 2, verifications: 1, throttles: 1 });
    expect(await purgeExpiredSessions(db)).toEqual({ sessions: 0, verifications: 0, throttles: 0 });
    await withClient(testDb.url, async (c) => {
      expect(await rows(c, `SELECT token FROM auth_session ORDER BY token`)).toEqual([{ token: 'current' }]);
      expect(await rows(c, `SELECT identifier FROM auth_verification ORDER BY identifier`)).toEqual([{ identifier: 'current-token' }]);
      expect(await rows(c, `SELECT key FROM auth_throttle ORDER BY key`)).toEqual([{ key: 'sign-in:current' }]);
    });
    await expect(purgeExpiredSessions(db, { batchSize: 0 })).rejects.toThrow(/batchSize/);
  });
});

describe('purgeUnconfirmedAccounts', () => {
  it('deletes accounts unconfirmed for 7 days with their consents, and keeps confirmed, recent and referred-to ones', async () => {
    const ids = await withClient(testDb.url, async (c) => {
      const insert = async (email: string, verified: boolean, age: string) =>
        (
          (
            await c.query<{ id: string }>(
              `INSERT INTO auth_user (email, email_verified, created_at) VALUES ($1, $2, now() - $3::interval) RETURNING id`,
              [email, verified, age],
            )
          ).rows[0] as { id: string }
        ).id;
      const old1 = await insert('demo-unconfirmed-old-1@example.test', false, '8 days');
      const old2 = await insert('demo-unconfirmed-old-2@example.test', false, '8 days');
      const referred = await insert('demo-unconfirmed-referred@example.test', false, '8 days');
      const recent = await insert('demo-unconfirmed-recent@example.test', false, '6 days');
      const confirmed = await insert('demo-confirmed-old@example.test', true, '30 days');
      for (const id of [old1, old2, referred, recent, confirmed]) {
        await c.query(`INSERT INTO consent_record (user_id, kind, document_version, action) VALUES ($1, 'terms', 'demo-v1', 'granted')`, [id]);
        await c.query(`INSERT INTO auth_account (user_id, provider_id, account_id) VALUES ($1, 'credential', $2)`, [id, id]);
      }
      await c.query(`INSERT INTO person (slug, kind, created_by_user_id) VALUES ('demo-retention-referred', 'living', $1)`, [referred]);
      return { old1, old2, referred, recent, confirmed };
    });

    expect(await purgeUnconfirmedAccounts(db, { batchSize: 1 })).toEqual({ accounts: 2, kept: 1 });
    expect(await purgeUnconfirmedAccounts(db)).toEqual({ accounts: 0, kept: 1 });
    await withClient(testDb.url, async (c) => {
      const left = (await rows(c, `SELECT id FROM auth_user WHERE email LIKE 'demo-%confirmed%' ORDER BY id`)).map((r) => (r as { id: string }).id);
      expect(left.sort()).toEqual([ids.referred, ids.recent, ids.confirmed].sort());
      expect(await rows(c, `SELECT count(*)::int AS n FROM consent_record WHERE user_id IN ($1, $2)`, [ids.old1, ids.old2])).toEqual([{ n: 0 }]);
      expect(await rows(c, `SELECT count(*)::int AS n FROM auth_account WHERE user_id IN ($1, $2)`, [ids.old1, ids.old2])).toEqual([{ n: 0 }]);
    });
    await expect(purgeUnconfirmedAccounts(db, { batchSize: 0 })).rejects.toThrow(/batchSize/);
  });
});
