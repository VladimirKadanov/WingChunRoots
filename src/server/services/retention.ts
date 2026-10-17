// Retention of e-mail addresses (docs/data-model.md §7; milestone M01b). Run daily by the worker's
// `retention.purge` job; a system task with no user, so there is no permission to check beyond
// being called by the worker, which connects as app_rw (plan §6.2).
//
//   email_delivery.to_email  erased 90 days after the e-mail was queued. One still queued by then
//                            was never going to be sent: it becomes `failed`.
//   invitation.email         erased 30 days after the invitation ended: accepted (accepted_at),
//                            expired (expires_at, or the time it was marked expired), revoked
//                            (the last change of the row). A pending invitation past its expiry
//                            becomes `expired` at the same time.
//
// The periods wait for the legal review (plan §10.2, row 11), like the rest of docs/data-model.md §7.
//
// The rows change in batches, each its own statement and transaction, so no statement comes near
// app_rw's statement_timeout (2 s) on a large first purge, and a failure keeps what earlier batches
// erased. A row another transaction holds (an e-mail being sent right now) is skipped and erased by
// the next run.

import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '../db';

export const EMAIL_DELIVERY_ADDRESS_RETENTION_DAYS = 90;
export const INVITATION_EMAIL_RETENTION_DAYS = 30;
/** Rows per statement. */
export const RETENTION_BATCH_SIZE = 1000;

export interface RetentionResult {
  /** email_delivery rows whose address was erased. */
  emailDeliveries: number;
  /** invitation rows whose address was erased. */
  invitations: number;
}

/** Runs `statement(limit)` until a batch changes fewer than `batchSize` rows; returns the total. */
async function inBatches(db: Database, batchSize: number, statement: (limit: number) => SQL): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(statement(batchSize));
    const changed = result.rowCount ?? 0;
    total += changed;
    if (changed < batchSize) return total;
  }
}

/** Erases the addresses whose retention period is over. Idempotent; returns how many rows changed. */
export async function purgeExpiredEmailAddresses(
  db: Database,
  { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {},
): Promise<RetentionResult> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  const emailDeliveries = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      UPDATE email_delivery
         SET to_email = NULL,
             status = CASE WHEN status = 'queued' THEN 'failed' ELSE status END,
             error = CASE WHEN status = 'queued' THEN coalesce(error, 'not sent within the retention period') ELSE error END,
             updated_at = now()
       WHERE id IN (
               SELECT id FROM email_delivery
                WHERE to_email IS NOT NULL
                  AND created_at < now() - make_interval(days => ${EMAIL_DELIVERY_ADDRESS_RETENTION_DAYS})
                LIMIT ${limit}
                  FOR UPDATE SKIP LOCKED)`,
  );
  const invitations = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      UPDATE invitation
         SET email = NULL,
             status = CASE WHEN status = 'pending' THEN 'expired' ELSE status END,
             updated_at = now()
       WHERE id IN (
               SELECT id FROM invitation
                WHERE email IS NOT NULL
                  AND CASE status
                        WHEN 'accepted' THEN coalesce(accepted_at, updated_at)
                        WHEN 'expired' THEN least(expires_at, updated_at)
                        WHEN 'pending' THEN expires_at
                        ELSE updated_at
                      END < now() - make_interval(days => ${INVITATION_EMAIL_RETENTION_DAYS})
                LIMIT ${limit}
                  FOR UPDATE SKIP LOCKED)`,
  );
  return { emailDeliveries, invitations };
}
