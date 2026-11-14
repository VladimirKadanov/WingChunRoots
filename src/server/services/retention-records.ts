// Retention of records and of what others wrote about people (review 2026-11;
// docs/adr/0032-retention-and-withdrawal.md; docs/data-model.md §7). Run daily by the worker's
// `retention.purge` job, after the steps of retention.ts; a system task with no user, connected as
// app_rw (plan §6.2). Every step is idempotent, works in batches, takes a row another transaction
// holds at the next run, and logs counts only (never a name, an address or a note).
//
// The periods below are defaults the owner left to us (2026-11-14); each one is marked
// `DEFAULT review-2026-11` and listed in docs/plan/questions/review-2026-11-retention.md.
//
//   person (third party)    a record a member made for someone who never joined (an invited teacher,
//                           a teacher named in a historical claim) is deleted 60 days after the last
//                           invitation, claim or request about it ended without a verified link.
//                           Nothing with a live tie is touched. Where a relationship still refers to
//                           the record (the history of relationships is append-only), the record
//                           stays as a removed, nameless row, without the country, city, start year,
//                           birth date and photo it held. A file that only the record's own evidence
//                           links held is due at once (retention_until) and deleted by the evidence step.
//   record_revision         the before and after text of a revision is redacted after 13 months (who,
//                           when, which fields, the reason and the case stay): the database function
//                           redact_record_revisions(), which is all app_rw may do to that table.
//   evidence_file           a file that only refused or withdrawn claims rest on gets retention_until
//                           (the end of the claim + 90 days) and is deleted then: the object from the
//                           private bucket, the row marked deleted. A file a verified link rests on,
//                           or an archival edit, is kept. Review notes of those claims lose their
//                           text at the same time.
//   ip_hmac                 audit_log.ip_hmac (null_old_audit_ip_hmac(), the only change the audit
//                           log allows) and auth_session.ip_address are set to NULL after 13 months.
//   trial_inquiry (open)    an inquiry nobody answered for 90 days is closed and scrubbed (name,
//                           contact, times, message); so is every open inquiry of a school that is
//                           hidden by a moderator, archived or removed. Closed ones are deleted after
//                           365 days (retention.ts, unchanged).

import { sql, type SQL } from 'drizzle-orm';

import { writeAudit } from '../audit';
import type { Database } from '../db';
import { TRIAL_OPEN_INQUIRY_DAYS } from '../db/schema/common';
import { getEvidenceStore, type ObjectStore } from '../storage';
import { inBatches, isReferencedRowError, RETENTION_BATCH_SIZE } from './retention';

export { TRIAL_OPEN_INQUIRY_DAYS };

/** DEFAULT review-2026-11 (question 1): a third party's record goes 60 days after its claim or invitation ended. */
export const THIRD_PARTY_RECORD_RETENTION_DAYS = 60;
/** DEFAULT review-2026-11 (question 2): the text of a record revision is redacted after 13 months. */
export const RECORD_REVISION_TEXT_RETENTION_MONTHS = 13;
/** DEFAULT review-2026-11 (question 3): evidence and notes of a refused or withdrawn claim go 90 days after it closed. */
export const ENDED_CLAIM_RETENTION_DAYS = 90;
/** DEFAULT review-2026-11 (question 4): ip_hmac values are removed after 13 months (the yearly key change, docs/operations/ip-hmac-rotation.md). */
export const IP_HMAC_RETENTION_MONTHS = 13;

/** The most evidence files one batch deletes: each one is an object-store call inside the transaction. */
const EVIDENCE_BATCH_MAX = 100;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function assertBatchSize(batchSize: number): void {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer');
}

// --- A third party's record ----------------------------------------------------------------------

/**
 * The reasons the audit row `person.create` carries when a member makes a record for someone else:
 * invitations.ts (createInvitedRecord) and historical.ts (createTeacherRecord). Only a record with
 * such a row is ever purged here, so seeds, organization imports and archival records never are.
 */
export const THIRD_PARTY_RECORD_REASONS = ['invited teacher', 'historical teacher claim'] as const;

/**
 * Every table with a foreign key to person.id that is NOT removed together with a third party's
 * record, with the columns that refer to it: a row there is a live tie (a school lists the person
 * as an instructor, an organization counts them as a member, a passport names them as the teacher,
 * ...), and the record is left alone. A test compares this list with the foreign keys of the
 * database, so a new table cannot be forgotten.
 */
export const PERSON_LIVE_TIES: readonly (readonly [table: string, ...columns: string[]])[] = [
  ['event', 'organizer_person_id'],
  ['event_attendance', 'person_id', 'teacher_person_id'],
  ['event_instructor', 'person_id'],
  ['lineage', 'root_person_id'],
  ['organization_import_row', 'person_id'],
  ['organization_membership', 'person_id'],
  ['organization_teacher_claim', 'student_person_id', 'teacher_person_id'],
  ['passport_certificate', 'person_id'],
  ['passport_exam', 'person_id', 'teacher_person_id', 'examiner_person_id'],
  ['passport_rank', 'person_id', 'teacher_person_id'],
  ['passport_skill', 'person_id', 'teacher_person_id'],
  ['person_photo', 'person_id'],
  ['record_proposal', 'person_id'],
  ['school_instructor', 'person_id'],
  ['succession_nomination', 'owner_person_id', 'successor_person_id'],
];

/** The tables whose rows about the person go with it (cascade) or are cleared with it: see purgeOne(). */
export const PERSON_OWNED_TABLES: readonly string[] = [
  'evidence_link',
  'invitation',
  'lineage_membership',
  'person_bio',
  'person_claim',
  'person_name',
  'person_name_key',
  'record_revision',
  // Set to NULL when the record goes; the case itself is history.
  'review_case',
  // RESTRICT: decided by the relationship rules in the condition below.
  'teaching_relationship',
];

const OPEN_CASE = sql.raw(`('open', 'in_review', 'needs_info')`);

/** No live tie in any of the PERSON_LIVE_TIES tables. `p` is the person's alias. */
const NO_LIVE_TIES: SQL = sql.join(
  PERSON_LIVE_TIES.map(([table, ...columns]) => sql.raw(`NOT EXISTS (SELECT 1 FROM ${table} t WHERE ${columns.map((c) => `t.${c} = p.id`).join(' OR ')})`)),
  sql` AND `,
);

/** The moment the last invitation, claim or request about the record ended (never before it was made). */
const ENDED_AT: SQL = sql.raw(`greatest(
    p.created_at,
    (SELECT max(r.updated_at) FROM teaching_relationship r WHERE r.teacher_person_id = p.id OR r.student_person_id = p.id),
    (SELECT max(CASE i.status
                  WHEN 'accepted' THEN coalesce(i.accepted_at, i.updated_at)
                  -- Revoked: the last change of the row, as retention.ts reads it, while the address is still there. Erasing
                  -- the address (30 days later) touches the row again, so after that its own time says nothing; the
                  -- withdrawal or the newer invitation that revoked it is counted by the other terms.
                  WHEN 'revoked' THEN CASE WHEN i.email IS NOT NULL THEN i.updated_at END
                  ELSE i.expires_at
                END)
       FROM invitation i WHERE i.person_id = p.id),
    (SELECT max(c.updated_at) FROM person_claim c WHERE c.person_id = p.id),
    (SELECT max(rc.resolved_at) FROM review_case rc WHERE rc.person_id = p.id))`);

/**
 * Whether the person `p` is a third party's record past its retention: made by a member for someone
 * else, never claimed, never public, never verified (every relationship refused or withdrawn, or
 * still waiting for a claim that no live invitation can bring), nothing live tied to it, no open
 * case, and the last end more than THIRD_PARTY_RECORD_RETENTION_DAYS ago.
 */
function thirdPartyRecordDue(): SQL {
  return sql`
    p.claimed_by_user_id IS NULL AND p.stewardship <> 'self' AND p.visibility = 'involved_only'
    AND p.deleted_at IS NULL AND p.taken_down_at IS NULL
    AND EXISTS (SELECT 1 FROM audit_log a
                 WHERE a.action = 'person.create' AND a.subject_type = 'person' AND a.subject_id = p.id::text
                   AND a.reason IN (${sql.join(THIRD_PARTY_RECORD_REASONS.map((r) => sql`${r}`), sql`, `)}))
    AND NOT EXISTS (
          SELECT 1 FROM teaching_relationship r
           WHERE (r.teacher_person_id = p.id OR r.student_person_id = p.id)
             AND (r.status IN ('verified', 'in_arbitration', 'revoked', 'pending_teacher', 'under_review')
                  OR (r.status = 'awaiting_claim'
                      AND EXISTS (SELECT 1 FROM invitation i WHERE i.relationship_id = r.id AND i.status = 'pending' AND i.expires_at > now()))))
    AND NOT EXISTS (SELECT 1 FROM invitation i WHERE i.person_id = p.id AND i.status = 'pending' AND i.expires_at > now())
    AND NOT EXISTS (SELECT 1 FROM person_claim c WHERE c.person_id = p.id AND c.status = 'pending')
    AND NOT EXISTS (
          SELECT 1 FROM review_case rc
           WHERE rc.status IN ${OPEN_CASE}
             AND (rc.person_id = p.id
                  OR rc.relationship_id IN (SELECT r.id FROM teaching_relationship r WHERE r.teacher_person_id = p.id OR r.student_person_id = p.id)))
    AND ${NO_LIVE_TIES}
    AND ${ENDED_AT} < now() - make_interval(days => ${THIRD_PARTY_RECORD_RETENTION_DAYS})`;
}

export interface ThirdPartyPurgeResult {
  /** Records deleted with every row about them. */
  deleted: number;
  /** Records a relationship still refers to: kept as a removed row without a name. */
  removed: number;
  /** Requests waiting for the teacher to join that were withdrawn first. */
  requestsWithdrawn: number;
}

type PurgeOutcome = 'deleted' | 'removed' | 'skipped';

async function purgeOne(db: Database, id: string): Promise<{ outcome: PurgeOutcome; requestsWithdrawn: number }> {
  return db.transaction(async (tx) => {
    // Locked and checked again: the condition may have changed since the candidate list was read.
    const due = await tx.execute<{ id: string; kind: string; stewardship: string }>(sql`
      SELECT p.id, p.kind, p.stewardship FROM person p WHERE p.id = ${id}::uuid AND ${thirdPartyRecordDue()} FOR UPDATE OF p SKIP LOCKED`);
    const row = due.rows[0];
    if (!row) return { outcome: 'skipped' as const, requestsWithdrawn: 0 };

    // Requests that wait for a teacher who never joined end with the record: nobody can approve them.
    const waiting = await tx.execute<{ id: string }>(sql`
      UPDATE teaching_relationship
         SET status = 'withdrawn', status_reason = 'The teacher did not join, and the record made for them was removed.', updated_at = now()
       WHERE status = 'awaiting_claim' AND (teacher_person_id = ${id}::uuid OR student_person_id = ${id}::uuid)
      RETURNING id`);
    for (const r of waiting.rows) {
      await tx.execute(sql`
        INSERT INTO relationship_event (id, relationship_id, from_status, to_status, actor_user_id, actor_role, reason)
        VALUES (gen_random_uuid(), ${r.id}::uuid, 'awaiting_claim', 'withdrawn', NULL, 'system', 'record_purged')`);
    }
    // The address of an invitation that ended with the request goes with the record.
    await tx.execute(sql`
      UPDATE invitation SET email = NULL, status = CASE WHEN status = 'pending' THEN 'expired' ELSE status END, updated_at = now()
       WHERE person_id = ${id}::uuid AND (email IS NOT NULL OR status = 'pending')`);

    // A file that only this record's own links hold (an archival edit's evidence) has no reason to stay once the
    // record goes: it is due now, and purgeEndedClaimData() deletes the object once the links are gone.
    await tx.execute(sql`
      UPDATE evidence_file f SET retention_until = now(), updated_at = now()
       WHERE f.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM evidence_link l WHERE l.evidence_file_id = f.id AND l.person_id = ${id}::uuid)
         AND NOT EXISTS (SELECT 1 FROM evidence_link l WHERE l.evidence_file_id = f.id AND (l.person_id IS NULL OR l.person_id <> ${id}::uuid))`);

    // Delete the record, with the names, search keys, biography, claims and invitations that cascade.
    let outcome: PurgeOutcome = 'deleted';
    await tx.execute(sql`SAVEPOINT purge_person`);
    try {
      await tx.execute(sql`DELETE FROM person WHERE id = ${id}::uuid`);
      await tx.execute(sql`RELEASE SAVEPOINT purge_person`);
    } catch (error) {
      // A relationship refers to it (RESTRICT; relationship_event is append-only): the row stays as
      // a removed record without a name, which every list shows as "A removed profile".
      if (!isReferencedRowError(error)) throw error;
      await tx.execute(sql`ROLLBACK TO SAVEPOINT purge_person`);
      outcome = 'removed';
      await tx.execute(sql`DELETE FROM person_name WHERE person_id = ${id}::uuid`);
      await tx.execute(sql`DELETE FROM person_name_key WHERE person_id = ${id}::uuid`);
      await tx.execute(sql`DELETE FROM person_bio WHERE person_id = ${id}::uuid`);
      await tx.execute(sql`DELETE FROM person_claim WHERE person_id = ${id}::uuid`);
      // The record's own evidence links go (the files are stamped above, or stay for a link of something else).
      await tx.execute(sql`DELETE FROM evidence_link WHERE person_id = ${id}::uuid`);
      await tx.execute(sql`SELECT redact_person_revisions(${id}::uuid)`);
      // The slug came from the name: it goes too ('removed-' + the id's 32 hex digits matches the slug format), and
      // so does everything else the record said about the person.
      await tx.execute(sql`
        UPDATE person
           SET slug = 'removed-' || replace(id::text, '-', ''), deleted_at = now(), updated_at = now(),
               country_code = NULL, place_id = NULL, training_start_year = NULL, birth_date = NULL, photo_id = NULL
         WHERE id = ${id}::uuid`);
    }
    await writeAudit(tx, {
      action: 'person.purge',
      actorUserId: null,
      actorRole: 'system',
      subjectType: 'person',
      subjectId: id,
      before: { kind: row.kind, stewardship: row.stewardship, visibility: 'involved_only' },
      after: { outcome, requestsWithdrawn: waiting.rows.length },
      reason: 'retention: made for a third party who never joined',
    });
    return { outcome, requestsWithdrawn: waiting.rows.length };
  });
}

/**
 * Deletes the records members made for people who never joined, 60 days after the last
 * invitation, claim or request about them ended without a verified link. Idempotent; one record
 * per transaction.
 */
export async function purgeThirdPartyRecords(db: Database, { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {}): Promise<ThirdPartyPurgeResult> {
  assertBatchSize(batchSize);
  const result: ThirdPartyPurgeResult = { deleted: 0, removed: 0, requestsWithdrawn: 0 };
  let after = NIL_UUID;
  for (;;) {
    const { rows } = await db.execute<{ id: string }>(sql`
      SELECT p.id FROM person p WHERE p.id > ${after}::uuid AND ${thirdPartyRecordDue()} ORDER BY p.id LIMIT ${batchSize}`);
    for (const { id } of rows) {
      const one = await purgeOne(db, id);
      if (one.outcome === 'deleted') result.deleted += 1;
      if (one.outcome === 'removed') result.removed += 1;
      result.requestsWithdrawn += one.requestsWithdrawn;
    }
    if (rows.length < batchSize) return result;
    after = rows[rows.length - 1]!.id;
  }
}

// --- Record revisions and ip_hmac ----------------------------------------------------------------

/** Writes the audit row of a bulk step (a count, never a value); nothing when nothing changed. */
async function auditBulk(db: Database, step: string, counts: Record<string, number>): Promise<void> {
  if (Object.values(counts).every((n) => n === 0)) return;
  await writeAudit(db, { action: 'retention.purge', actorUserId: null, actorRole: 'system', subjectType: 'retention', subjectId: step, after: counts });
}

/**
 * Redacts the before and after text of the record revisions older than 13 months, through the
 * database function redact_record_revisions() (SECURITY DEFINER; the table is append-only for
 * app_rw). Idempotent; returns how many revisions changed.
 */
export async function redactOldRevisions(db: Database, { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {}): Promise<{ revisions: number }> {
  assertBatchSize(batchSize);
  let revisions = 0;
  for (;;) {
    const result = await db.execute<{ n: number }>(sql`
      SELECT redact_record_revisions(now() - make_interval(months => ${RECORD_REVISION_TEXT_RETENTION_MONTHS}), ${batchSize}) AS n`);
    const n = Number(result.rows[0]?.n ?? 0);
    revisions += n;
    if (n < batchSize) break;
  }
  await auditBulk(db, 'record_revision_text', { revisions });
  return { revisions };
}

/**
 * Sets ip_hmac to NULL where it is older than 13 months: audit_log through the database function
 * null_old_audit_ip_hmac() (the only change the append-only log allows), auth_session.ip_address by
 * a plain update (a session is deleted when it expires, so this only matters if a lifetime grows).
 * Idempotent; returns how many values were removed.
 */
export async function nullOldIpHmacs(db: Database, { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {}): Promise<{ audit: number; sessions: number }> {
  assertBatchSize(batchSize);
  let audit = 0;
  for (;;) {
    const result = await db.execute<{ n: number }>(sql`
      SELECT null_old_audit_ip_hmac(now() - make_interval(months => ${IP_HMAC_RETENTION_MONTHS}), ${batchSize}) AS n`);
    const n = Number(result.rows[0]?.n ?? 0);
    audit += n;
    if (n < batchSize) break;
  }
  const sessions = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      UPDATE auth_session SET ip_address = NULL
       WHERE id IN (
               SELECT id FROM auth_session
                WHERE ip_address IS NOT NULL AND created_at < now() - make_interval(months => ${IP_HMAC_RETENTION_MONTHS})
                LIMIT ${limit}
                  FOR UPDATE SKIP LOCKED)`,
  );
  await auditBulk(db, 'ip_hmac', { audit, sessions });
  return { audit, sessions };
}

// --- Evidence and review notes of claims that ended without a verified link ----------------------

/** What a note says after its text is removed. */
export const NOTE_PURGED = 'Removed: the retention period of this claim ended.';

/**
 * When a claim case ended without a verified link (`c` is the case, `cr` its relationship, or NULL):
 * a person's claim (the evidence of other kinds of case is not touched here), withdrawn or refused,
 * with no verified relationship resting on it. NULL while it is open, approved or verified.
 */
const CASE_ENDED_AT = sql.raw(`
  CASE WHEN c.kind IN ('historical_claim', 'person_claim', 'instructor_verification')
        AND (c.status = 'dismissed' OR (c.status = 'resolved' AND c.resolution = 'rejected'))
        AND coalesce(cr.status, 'none') NOT IN ('verified', 'in_arbitration', 'revoked')
       THEN coalesce(c.resolved_at, c.updated_at) END`);

/**
 * The evidence files whose every link is to a claim that ended without a verified link (a case
 * refused or withdrawn, or a relationship rejected or withdrawn), with the time they are due: the end
 * of the last of those claims + 90 days. A file with a link to a person's record (an archival edit),
 * or to anything still open or verified is not in it; nor is a file with no link, unless the purge of a
 * third party's record left it with none and stamped it (the second SELECT).
 */
const ENDED_EVIDENCE: SQL = sql`
  SELECT s.file_id, max(s.ended_at) + make_interval(days => ${ENDED_CLAIM_RETENTION_DAYS}) AS due_at
    FROM (
      SELECT l.evidence_file_id AS file_id,
             CASE
               WHEN l.person_id IS NOT NULL THEN NULL
               WHEN l.relationship_id IS NOT NULL THEN CASE WHEN r.status IN ('rejected', 'withdrawn') THEN r.updated_at END
               ELSE ${CASE_ENDED_AT}
             END AS ended_at
        FROM evidence_link l
        LEFT JOIN teaching_relationship r ON r.id = l.relationship_id
        LEFT JOIN review_case c ON c.id = l.review_case_id
        LEFT JOIN teaching_relationship cr ON cr.id = c.relationship_id) s
   GROUP BY s.file_id
  HAVING bool_and(s.ended_at IS NOT NULL)
  UNION ALL
  -- A file the purge of a third party's record left with no link at all (its only links were to that record):
  -- purgeOne() gave it retention_until = the moment of the purge, and the object goes at the next step.
  SELECT f.id AS file_id, f.retention_until AS due_at
    FROM evidence_file f
   WHERE f.deleted_at IS NULL AND f.retention_until IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM evidence_link l WHERE l.evidence_file_id = f.id)`;

export interface ClaimDataPurgeResult {
  /** Evidence files whose retention_until was set or changed. */
  stamped: number;
  /** Evidence files deleted: the object from the private bucket and the row marked deleted. */
  files: number;
  /** Review notes whose text was removed. */
  notes: number;
  /** Objects the store would not delete: those files stay and are tried at the next run. */
  failed: number;
}

/**
 * Evidence files and review notes of claims that ended without a verified link (see the top of the
 * file). `retention_until` is set when a file becomes due for deletion and cleared again if a live
 * claim now rests on it (nothing else sets it). The object goes first and the row is marked deleted
 * in the same transaction, so a failed commit is retried and a failed delete leaves the file for
 * the next run; the failures are counted, and the step fails when none could be deleted (the
 * object store is not answering) so the job reports it.
 */
export async function purgeEndedClaimData(
  db: Database,
  { batchSize = RETENTION_BATCH_SIZE, evidenceStore = getEvidenceStore() }: { batchSize?: number; evidenceStore?: ObjectStore } = {},
): Promise<ClaimDataPurgeResult> {
  assertBatchSize(batchSize);
  const fileBatch = Math.min(batchSize, EVIDENCE_BATCH_MAX);

  // 1. retention_until follows the end of the last claim a file rests on.
  const stamped = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      UPDATE evidence_file f SET retention_until = e.due_at, updated_at = now()
        FROM (${ENDED_EVIDENCE}) e
       WHERE f.id = e.file_id AND f.id IN (
               SELECT f2.id FROM evidence_file f2 JOIN (${ENDED_EVIDENCE}) e2 ON e2.file_id = f2.id
                WHERE f2.deleted_at IS NULL AND f2.retention_until IS DISTINCT FROM e2.due_at
                LIMIT ${limit} FOR UPDATE OF f2 SKIP LOCKED)`,
  );
  await inBatches(
    db,
    batchSize,
    (limit) => sql`
      UPDATE evidence_file SET retention_until = NULL, updated_at = now()
       WHERE id IN (
               SELECT f.id FROM evidence_file f
                WHERE f.retention_until IS NOT NULL AND f.deleted_at IS NULL
                  AND f.id NOT IN (SELECT file_id FROM (${ENDED_EVIDENCE}) e)
                LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
  );

  // 2. The files that are due.
  let files = 0;
  let failed = 0;
  for (;;) {
    // Nothing due: no transaction at all.
    const waiting = await db.execute(sql`
      SELECT 1 FROM evidence_file f JOIN (${ENDED_EVIDENCE}) e ON e.file_id = f.id WHERE f.deleted_at IS NULL AND e.due_at <= now() LIMIT 1`);
    if ((waiting.rows?.length ?? 0) === 0) break;
    const batch = await db.transaction(async (tx) => {
      const due = await tx.execute<{ id: string; storage_key: string }>(sql`
        SELECT f.id, f.storage_key
          FROM evidence_file f JOIN (${ENDED_EVIDENCE}) e ON e.file_id = f.id
         WHERE f.deleted_at IS NULL AND e.due_at <= now()
         ORDER BY e.due_at, f.id
         LIMIT ${fileBatch}
           FOR UPDATE OF f SKIP LOCKED`);
      const gone: { id: string }[] = [];
      let notGone = 0;
      for (const f of due.rows) {
        try {
          await evidenceStore.delete(f.storage_key);
          gone.push({ id: f.id });
        } catch {
          notGone += 1;
        }
      }
      if (gone.length > 0) {
        const ids = sql.join(gone.map((g) => sql`${g.id}::uuid`), sql`, `);
        await tx.execute(sql`UPDATE evidence_file SET deleted_at = now(), original_name = NULL, original_sha256 = NULL, updated_at = now() WHERE id IN (${ids})`);
        await tx.execute(sql`UPDATE evidence_link SET note = NULL, updated_at = now() WHERE evidence_file_id IN (${ids}) AND note IS NOT NULL`);
        for (const g of gone) {
          await writeAudit(tx, {
            action: 'evidence.purge',
            actorUserId: null,
            actorRole: 'system',
            subjectType: 'evidence_file',
            subjectId: g.id,
            after: { reason: 'claim ended without a verified link' },
          });
        }
      }
      return { read: due.rows.length, gone: gone.length, notGone };
    });
    files += batch.gone;
    failed += batch.notGone;
    if (batch.read < fileBatch || batch.gone === 0) break;
  }

  // 3. The text of the review notes of those claims.
  const notes = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      UPDATE review_note SET body = ${NOTE_PURGED}, updated_at = now()
       WHERE id IN (
               SELECT n.id
                 FROM review_note n
                 JOIN review_case c ON c.id = n.review_case_id
                 LEFT JOIN teaching_relationship cr ON cr.id = c.relationship_id
                WHERE n.body <> ${NOTE_PURGED}
                  AND ${CASE_ENDED_AT} < now() - make_interval(days => ${ENDED_CLAIM_RETENTION_DAYS})
                LIMIT ${limit} FOR UPDATE OF n SKIP LOCKED)`,
  );
  await auditBulk(db, 'claim_notes', { notes });
  if (failed > 0 && files === 0) throw Object.assign(new Error('the evidence store did not delete any due object'), { name: 'EvidenceStoreUnavailable' });
  return { stamped, files, notes, failed };
}

// --- Trial lesson requests nobody answered -------------------------------------------------------

export interface StaleTrialResult {
  /** Open requests older than 90 days: closed and scrubbed. */
  stale: number;
  /** Open requests of a school that is hidden by a moderator, archived or removed: closed and scrubbed. */
  schoolGone: number;
}

/** The SET list of a closed and scrubbed request (trial_inquiry_scrub_state). */
const CLOSE_AND_SCRUB = sql.raw(`status = 'closed', closed_at = now(), handled_by_user_id = NULL,
             sender_name = NULL, contact_value = NULL, preferred_times = NULL, message = NULL, reply = NULL,
             scrubbed_at = now(), updated_at = now()`);

/**
 * Closes the open trial lesson requests that nobody answered within TRIAL_OPEN_INQUIRY_DAYS, and
 * those of a school that is hidden by a moderator, archived or removed (nobody reads them any
 * more), and removes the sender's name, contact, preferred times and message from them. The sender
 * sees "Closed"; nobody is told. Idempotent; returns how many requests were closed.
 */
export async function closeStaleTrialInquiries(db: Database, { batchSize = RETENTION_BATCH_SIZE }: { batchSize?: number } = {}): Promise<StaleTrialResult> {
  assertBatchSize(batchSize);
  const schoolGone = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      UPDATE trial_inquiry SET ${CLOSE_AND_SCRUB}
       WHERE id IN (
               SELECT t.id FROM trial_inquiry t JOIN school s ON s.id = t.school_id
                WHERE t.status = 'open' AND (s.status IN ('hidden', 'archived') OR s.deleted_at IS NOT NULL)
                LIMIT ${limit} FOR UPDATE OF t SKIP LOCKED)`,
  );
  const stale = await inBatches(
    db,
    batchSize,
    (limit) => sql`
      UPDATE trial_inquiry SET ${CLOSE_AND_SCRUB}
       WHERE id IN (
               SELECT t.id FROM trial_inquiry t
                WHERE t.status = 'open' AND t.created_at < now() - make_interval(days => ${TRIAL_OPEN_INQUIRY_DAYS})
                ORDER BY t.created_at, t.id
                LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
  );
  await auditBulk(db, 'trial_inquiry_open', { stale, schoolGone });
  return { stale, schoolGone };
}
