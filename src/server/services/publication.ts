// Who may be made public (review 2026-11-14, docs/adr/0031-consent-and-living-gates.md). Two rules,
// both decided by the owner on 2026-11-14, kept in one place so that every path that publishes a
// person (a verified link: relationships.ts markVerified; staff establishing a death: review.ts,
// stewardship.ts; the restore of a take-down: takedown.ts) asks the same question.
//
//   1. DEFAULT D03: a person who has an account is public only while the account's latest
//      `publication` consent is a grant. No record at all means "not public", exactly like a
//      withdrawal: the member who leaves "Show my profile publicly" unticked is never published by
//      somebody else's approval. A grant of any document version counts (a new version of the
//      privacy notice asks the member again but does not undo their choice).
//   2. A person whose life status is `unknown` is treated as living: never public (the CHECK
//      person_unknown_not_public makes it true whatever code path writes), until a reviewer has
//      established that they have died (`deceased`, with a written reason; review.ts).
//
// A person without an account (a historical teacher, an invited record) has no consent to read:
// the verified link publishes it as before, subject to rule 2.

import { type SQL, sql } from 'drizzle-orm';

import { PUBLIC_RELATIONSHIP_STATUSES } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import type { Transaction } from '../jobs/outbox';

/**
 * The account's latest `publication` consent action, of any document version, or null when it has
 * no record. The latest row decides (ties on the time are broken by the id, as everywhere).
 */
export async function latestPublicationAction(db: Executor, userId: string): Promise<'granted' | 'withdrawn' | null> {
  const result = await db.execute<{ action: 'granted' | 'withdrawn' }>(sql`
SELECT c.action FROM consent_record c
 WHERE c.user_id = ${userId}::uuid AND c.kind = 'publication'
 ORDER BY c.occurred_at DESC, c.id DESC LIMIT 1`);
  return result.rows[0]?.action ?? null;
}

/** True only when the account's latest publication record is a grant (DEFAULT D03). */
export async function publicationGranted(db: Executor, userId: string): Promise<boolean> {
  return (await latestPublicationAction(db, userId)) === 'granted';
}

/**
 * The SQL condition "the person aliased `p` may be made public": a known life status, and an owner
 * whose latest publication record is a grant when the person has an account. Written against the
 * alias `p` of `person`, for the raw UPDATEs below.
 */
export const PERSON_MAY_BE_PUBLIC: SQL = sql`(p.life_status <> 'unknown' AND (p.claimed_by_user_id IS NULL OR COALESCE((
         SELECT c.action FROM consent_record c
          WHERE c.user_id = p.claimed_by_user_id AND c.kind = 'publication'
          ORDER BY c.occurred_at DESC, c.id DESC LIMIT 1), '') = 'granted'))`;

/**
 * Makes the given people public where the two rules allow it, and returns the ids that changed. A
 * removed person and a person staff hold (takedown.ts) are never touched; for a held person the
 * visibility its restore will give back is updated instead, so the restore finds the same answer.
 * Only the people of a verified link (or a record a reviewer has just established as deceased) are
 * passed: this is the one place that writes `visibility = 'public'` for a person.
 */
export async function publishPeople(tx: Transaction, personIds: readonly string[]): Promise<string[]> {
  if (personIds.length === 0) return [];
  const ids = sql.join(
    personIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const published = await tx.execute<{ id: string }>(sql`
UPDATE person p SET visibility = 'public', updated_at = now()
 WHERE p.id IN (${ids})
   AND p.visibility <> 'public' AND p.deleted_at IS NULL
   AND p.taken_down_at IS NULL
   AND ${PERSON_MAY_BE_PUBLIC}
RETURNING p.id::text AS id`);
  await tx.execute(sql`
UPDATE person p SET taken_down_visibility = 'public', updated_at = now()
 WHERE p.id IN (${ids})
   AND p.taken_down_at IS NOT NULL AND p.taken_down_visibility <> 'public' AND p.deleted_at IS NULL
   AND ${PERSON_MAY_BE_PUBLIC}`);
  return published.rows.map((r) => r.id);
}

/**
 * Whether the link between two people is shown publicly now: both are public and not removed. Read
 * inside the transaction that has just published them, to tell the people involved the truth
 * (a confirmed link whose end is private stays confirmed, and stays on their dashboards).
 */
export async function bothPublic(db: Executor, teacherPersonId: string, studentPersonId: string): Promise<boolean> {
  const result = await db.execute<{ n: number }>(sql`
SELECT count(*)::int AS n FROM person p
 WHERE p.id IN (${teacherPersonId}::uuid, ${studentPersonId}::uuid) AND p.visibility = 'public' AND p.deleted_at IS NULL`);
  return (result.rows[0]?.n ?? 0) === 2;
}

/** The refusal when a record that is shown publicly would be set to "unknown": it would have to be hidden first. */
export const UNKNOWN_STATUS_MESSAGE =
  'A person whose life status is unknown is treated as living and is never shown publicly. Choose “Deceased” (with the evidence) or “Living”, or take the record down first.';

/**
 * Publishes a record whose death a reviewer has just established, when it already has an
 * established link (verified or in arbitration) that was waiting for the record to be public: a
 * claim verified with "I cannot establish this" leaves the link verified and the record private
 * (review.ts), and this is what makes both public once the evidence is in. A record without such a
 * link stays as it is (D03: private until one of its links is verified). Returns whether the record
 * became public; the caller queues the lineage recompute and drops the cache.
 */
export async function publishIfEstablished(tx: Transaction, personId: string): Promise<boolean> {
  const link = await tx.execute<{ id: string }>(sql`
SELECT r.id::text AS id FROM teaching_relationship r
 WHERE (r.teacher_person_id = ${personId}::uuid OR r.student_person_id = ${personId}::uuid)
   AND r.status IN (${sql.join(PUBLIC_RELATIONSHIP_STATUSES.map((status) => sql`${status}`), sql`, `)}) AND r.visibility = 'public'
 LIMIT 1`);
  if (link.rows.length === 0) return false;
  return (await publishPeople(tx, [personId])).length > 0;
}
