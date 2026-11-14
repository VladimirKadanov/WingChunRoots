// Retention of e-mail addresses and of expired sign-in data (docs/data-model.md §7; milestones
// M01b and M02). Run daily by the worker's
// `retention.purge` job; a system task with no user, so there is no permission to check beyond
// being called by the worker, which connects as app_rw (plan §6.2).
//
//   email_delivery.to_email  erased 90 days after the e-mail was queued. One still queued by then
//                            was never going to be sent: it becomes `failed`.
//   invitation.email         erased 30 days after the invitation ended: accepted (accepted_at),
//                            expired (expires_at, or the time it was marked expired), revoked
//                            (the last change of the row). A pending invitation past its expiry
//                            becomes `expired` at the same time. The copy of the address in the
//                            invitation e-mail's delivery (email_delivery.to_email, key
//                            `invitation:<id>`) is erased on the same schedule, not after 90 days
//                            (M10b review, code-2): the e-mail tells the invitee so.
//
//   auth_session             deleted once expired (M02): the privacy notice keeps a session, with
//                            its ip_hmac and user agent, until it expires or the person signs out.
//                            Better Auth deletes an expired session only when its token comes back.
//   auth_verification        deleted once expired (M02): confirmation and reset tokens, pending
//                            second factors.
//   auth_throttle            deleted once expired (M02): sign-in failure counters, used TOTP codes.
//   auth_user (unconfirmed)  deleted 7 days after sign-up when the address was never confirmed
//                            (M02 fix round 1), with its consent records: nobody can sign in to it,
//                            and keeping it would keep the address of someone who may never have
//                            asked for an account. DEFAULT (not a D number; docs/adr/0004-auth.md).
//                            An account that something else refers to is left alone.
//
//   notification             deleted 180 days after it was created once read, 365 days after it
//                            was created while unread (M18; DEFAULT M18, question 3). The e-mail of
//                            a notice keeps the rules of email_delivery above (M01b).
//
//   trial_inquiry            deleted 365 days after it closed (answered, declined or closed; M21,
//                            DEFAULT M21 question 5): the sender's name, contact and message go
//                            with it. An open inquiry is never deleted by age.
//   school_stat_day          deleted 400 days after its day (M21, DEFAULT M21 question 7).
//
// The periods wait for the legal review (plan §10.2, row 11), like the rest of docs/data-model.md §7.
//
// The rows change in batches, each its own statement and transaction, so no statement comes near
// app_rw's statement_timeout (2 s) on a large first purge, and a failure keeps what earlier batches
// erased. A row another transaction holds (an e-mail being sent right now) is skipped and erased by
// the next run.

import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '../db';
import { SCHOOL_STATS_RETENTION_DAYS, TRIAL_INQUIRY_RETENTION_DAYS } from '../db/schema/common';

export { SCHOOL_STATS_RETENTION_DAYS, TRIAL_INQUIRY_RETENTION_DAYS };

export const EMAIL_DELIVERY_ADDRESS_RETENTION_DAYS = 90;
export const UNCONFIRMED_ACCOUNT_RETENTION_DAYS = 7;
/** DEFAULT M18 (question 3): a read notice is kept 180 days, an unread one 365. */
export const READ_NOTIFICATION_RETENTION_DAYS = 180;
export const UNREAD_NOTIFICATION_RETENTION_DAYS = 365;
export const INVITATION_EMAIL_RETENTION_DAYS = 30;
/** Rows per statement. */
export const RETENTION_BATCH_SIZE = 1000;

export interface RetentionResult {
  /** email_delivery rows whose address was erased (after 90 days, or with their invitation's). */
  emailDeliveries: number;
  /** invitation rows whose address was erased. */
  invitations: number;
}

/** Runs `statement(limit)` until a batch changes fewer than `batchSize` rows; returns the total. */
export async function inBatches(db: Database, batchSize: number, statement: (limit: number) => SQL): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(statement(batchSize));
    const changed = result.rowCount ?? 0;
    total += changed;
    if (changed < batchSize) return total;
  }
}

/** The SET list that erases a delivery's address; one still queued was never going to be sent. */
export const ERASE_DELIVERY_ADDRESS = sql.raw(`to_email = NULL,
             status = CASE WHEN status = 'queued' THEN 'failed' ELSE status END,
             error = CASE WHEN status = 'queued' THEN coalesce(error, 'not sent within the retention period') ELSE error END,
             updated_at = now()`);

/**
 * When an invitation ended, for the retention of its address: accepted (accepted_at), expired
 * (expires_at, or the time it was marked expired), pending past its expiry (expires_at), revoked
 * (the last change of the row). `alias` is a fixed table name or alias, never input.
 */
function invitationEnded(alias: 'i' | 'invitation'): SQL {
  return sql.raw(`CASE ${alias}.status
                        WHEN 'accepted' THEN coalesce(${alias}.accepted_at, ${alias}.updated_at)
                        WHEN 'expired' THEN least(${alias}.expires_at, ${alias}.updated_at)
                        WHEN 'pending' THEN ${alias}.expires_at
                        ELSE ${alias}.updated_at
                      END`);
}

/** Erases the addresses whose retention period is over. Idempotent; returns how many rows changed. */
export async function purgeExpiredEmailAddresses(
  db: Database,
  { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {},
): Promise<RetentionResult> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  const deliveriesAfter90Days = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      UPDATE email_delivery
         SET ${ERASE_DELIVERY_ADDRESS}
       WHERE id IN (
               SELECT id FROM email_delivery
                WHERE to_email IS NOT NULL
                  AND created_at < now() - make_interval(days => ${EMAIL_DELIVERY_ADDRESS_RETENTION_DAYS})
                LIMIT ${limit}
                  FOR UPDATE SKIP LOCKED)`,
  );
  // The invitation e-mail's delivery, before the invitation itself: erasing the invitation's address
  // moves its updated_at (the end of a revoked one). A delivery the Mailer held during that run goes
  // at the next one, since its invitation then has no address left.
  const invitationDeliveries = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      UPDATE email_delivery
         SET ${ERASE_DELIVERY_ADDRESS}
       WHERE id IN (
               SELECT d.id FROM email_delivery d
                 JOIN invitation i ON d.idempotency_key = 'invitation:' || i.id::text
                WHERE d.to_email IS NOT NULL
                  AND d.template = 'invitation'
                  AND (i.email IS NULL OR ${invitationEnded('i')} < now() - make_interval(days => ${INVITATION_EMAIL_RETENTION_DAYS}))
                LIMIT ${limit}
                  FOR UPDATE OF d SKIP LOCKED)`,
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
                  AND ${invitationEnded('invitation')} < now() - make_interval(days => ${INVITATION_EMAIL_RETENTION_DAYS})
                LIMIT ${limit}
                  FOR UPDATE SKIP LOCKED)`,
  );
  return { emailDeliveries: deliveriesAfter90Days + invitationDeliveries, invitations };
}

export interface SessionRetentionResult {
  /** Expired auth_session rows deleted. */
  sessions: number;
  /** Expired auth_verification rows deleted. */
  verifications: number;
  /** Expired auth_throttle rows deleted. */
  throttles: number;
}

/** Deletes expired sessions and verification values. Idempotent; returns how many rows went. */
export async function purgeExpiredSessions(
  db: Database,
  { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {},
): Promise<SessionRetentionResult> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  const sessions = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      DELETE FROM auth_session
       WHERE id IN (SELECT id FROM auth_session WHERE expires_at < now() LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
  );
  const verifications = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      DELETE FROM auth_verification
       WHERE id IN (SELECT id FROM auth_verification WHERE expires_at < now() LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
  );
  const throttles = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      DELETE FROM auth_throttle
       WHERE key IN (SELECT key FROM auth_throttle WHERE expires_at <= now() LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
  );
  return { sessions, verifications, throttles };
}

export interface AccountRetentionResult {
  /** Unconfirmed accounts deleted. */
  accounts: number;
  /** Unconfirmed accounts left because another row refers to them. */
  kept: number;
}

// A RESTRICT foreign key refuses the delete with 23503 (foreign_key_violation) up to PostgreSQL 17
// and with 23001 (restrict_violation) from PostgreSQL 18; the app runs on both (plan §3.2).
const REFERENCED_ROW_CODES: ReadonlySet<unknown> = new Set(['23503', '23001']);

/** True when a delete was refused because another row still refers to the row (RESTRICT). */
export function isReferencedRowError(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code ?? (error as { cause?: { code?: unknown } }).cause?.code;
  return REFERENCED_ROW_CODES.has(code);
}

/**
 * Deletes accounts whose address was not confirmed within UNCONFIRMED_ACCOUNT_RETENTION_DAYS, with
 * their consent records (sessions, credentials and 2FA rows go by cascade; e-mail deliveries keep
 * their row without the account). One account per transaction; an account another row refers to
 * (RESTRICT) is kept and counted.
 */
export async function purgeUnconfirmedAccounts(
  db: Database,
  { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {},
): Promise<AccountRetentionResult> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  let accounts = 0;
  let kept = 0;
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const { rows } = await db.execute<{ id: string }>(sql`
      SELECT id FROM auth_user
       WHERE NOT email_verified
         AND created_at < now() - make_interval(days => ${UNCONFIRMED_ACCOUNT_RETENTION_DAYS})
         AND id > ${after}::uuid
       ORDER BY id
       LIMIT ${batchSize}`);
    for (const { id } of rows) {
      try {
        const deleted = await db.transaction(async (tx) => {
          await tx.execute(sql`DELETE FROM consent_record WHERE user_id = ${id}`);
          const result = await tx.execute(sql`DELETE FROM auth_user WHERE id = ${id} AND NOT email_verified`);
          return result.rowCount ?? 0;
        });
        accounts += deleted;
      } catch (error) {
        if (!isReferencedRowError(error)) throw error;
        kept += 1;
      }
    }
    if (rows.length < batchSize) return { accounts, kept };
    after = rows[rows.length - 1]!.id;
  }
}

/**
 * Deletes the notices past their retention (M18; DEFAULT M18, question 3): read ones 180 days after
 * they were created, unread ones 365. Idempotent; returns how many rows went.
 */
export async function purgeOldNotifications(
  db: Database,
  { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {},
): Promise<{ notifications: number }> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  const notifications = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      DELETE FROM notification
       WHERE id IN (
               SELECT id FROM notification
                WHERE (read_at IS NOT NULL AND created_at < now() - make_interval(days => ${READ_NOTIFICATION_RETENTION_DAYS}))
                   OR created_at < now() - make_interval(days => ${UNREAD_NOTIFICATION_RETENTION_DAYS})
                LIMIT ${limit}
                  FOR UPDATE SKIP LOCKED)`,
  );
  return { notifications };
}

/**
 * M21 (DEFAULT M21, questions 5 and 7): deletes the trial lesson inquiries closed more than
 * TRIAL_INQUIRY_RETENTION_DAYS ago and the school counters older than SCHOOL_STATS_RETENTION_DAYS
 * (UTC days). Idempotent; returns how many rows went.
 */
export async function purgeOldTrialData(
  db: Database,
  { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {},
): Promise<{ inquiries: number; counters: number }> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  const inquiries = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      DELETE FROM trial_inquiry
       WHERE id IN (
               SELECT id FROM trial_inquiry
                WHERE status <> 'open' AND closed_at < now() - make_interval(days => ${TRIAL_INQUIRY_RETENTION_DAYS})
                LIMIT ${limit}
                  FOR UPDATE SKIP LOCKED)`,
  );
  const counters = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      DELETE FROM school_stat_day
       WHERE (school_id, day) IN (
               SELECT school_id, day FROM school_stat_day
                WHERE day < (now() AT TIME ZONE 'UTC')::date - ${SCHOOL_STATS_RETENTION_DAYS}::int
                LIMIT ${limit}
                  FOR UPDATE SKIP LOCKED)`,
  );
  return { inquiries, counters };
}

/**
 * M24 (DEFAULT M24 question 2; docs/adr/0027-organization-tools.md): ends the organization import
 * previews past their expiry and clears the parsed fields of their rows (names, ranks, cities), so
 * no preview keeps them longer than ORGANIZATION_IMPORT_PREVIEW_HOURS. The services expire an
 * organization's own previews whenever it reads them; this catches the ones nobody opens again.
 * Idempotent; returns how many imports ended.
 */
export async function expireOrganizationImports(db: Database, { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {}): Promise<{ imports: number }> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
  let imports = 0;
  for (;;) {
    const result = await db.execute<{ n: number }>(sql`
      WITH ended AS (
        UPDATE organization_import SET status = 'expired', ended_at = now(), updated_at = now()
         WHERE id IN (SELECT id FROM organization_import WHERE status = 'previewed' AND expires_at <= now() LIMIT ${batchSize} FOR UPDATE SKIP LOCKED)
        RETURNING id),
      cleared AS (
        UPDATE organization_import_row SET data = NULL, updated_at = now() WHERE import_id IN (SELECT id FROM ended) RETURNING 1)
      SELECT (SELECT count(*) FROM ended)::int AS n`);
    const n = result.rows[0]?.n ?? 0;
    imports += n;
    if (n < batchSize) return { imports };
  }
}
