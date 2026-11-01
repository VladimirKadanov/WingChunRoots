// Historical teachers (milestone M10a, In scope 1; plan §6.4, §6.7). A teacher who has died, or of
// whom nothing more is known than the record, cannot approve a request: the review committee
// confirms the training instead, from the student's evidence (verification_path committee_review).
//
//   relationships.requestHistorical (student)
//     → a new teacher record (kind historical, stewardship platform, involved_only: DEFAULT D03),
//       or an existing historical or deceased record the student found in search;
//     → the relationship under_review, involved_only (DEFAULT D03), committee_review;
//     → a review_case of kind historical_claim, open, with the evidence files linked to it (at
//       least one, at most 20: DEFAULT D25) and the student's optional note (shown to reviewers);
//     → relationship_event (null → under_review), audit relationship.request (and person.create for
//       a new record), and a notification to every archivist and administrator.
//   The decision is review.decide (review.ts), from /admin/review.
//
// Until it is verified the new record is involved_only: absent from anonymous pages, the API,
// search and the sitemap (v_public_person; the M10a E2E checks each). The same locks and limits as
// a request to a living teacher (relationships.ts): the student's request lock, the pending cap,
// the 24-hour request window and the cycle check for an existing teacher. One idempotency key per
// claim (plan §5.6): a double submit sends one claim.
//
// Logs and audit rows carry ids and codes, never a name (plan §6.4).

import { randomBytes } from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { authUser, notification, person, personName, reviewCase, reviewNote, teachingRelationship } from '../db/schema';
import { EVIDENCE_MAX_FILES_PER_CASE, STAFF_ROLES } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import type { Transaction } from '../jobs/outbox';
import { writePersonKeys } from '../search/store';
import type { RequestMeta } from './context';
import { linkFilesToCase } from './evidence';
import { cleanName, isLatinName, matchesScript, NAME_MAX_LENGTH, originalScript, slugFromName } from './names';
import {
  checkLineage,
  checkPendingCap,
  checkPeriods,
  checkRequestWindow,
  closesCycle,
  CYCLE_MESSAGE,
  DUPLICATE_MESSAGE,
  fieldErrors,
  idempotencyKey,
  isActiveConflict,
  isKeyConflict,
  keyReused,
  lockStudentRequests,
  periodShape,
  periods,
  recordEvent,
  type RelationshipView,
  replayOf,
  viewerOf,
  viewOf,
  writePeriods,
} from './relationships';
import { ServiceError } from './errors';

/** The longest note a student sends with a claim. */
export const CLAIM_NOTE_MAX = 2000;
const CHOOSE_TEACHER = 'Choose the teacher from the search, or enter a new teacher’s name.';
const NOT_HISTORICAL = 'This teacher is not a historical record. Living teachers confirm requests themselves: use “Name a teacher”.';

const optionalText = z
  .string()
  .max(NAME_MAX_LENGTH * 2)
  .transform((s) => cleanName(s))
  .nullish()
  .transform((s) => (s ? s : null));

const optionalLang = z
  .string()
  .max(16)
  .nullish()
  .transform((s) => (s ? s : null));

/**
 * The claim. The teacher is either `teacherId`, an existing historical or deceased record the
 * student found in search, or a new record: `teacherName` (Latin script, required), an optional
 * name in its own script (`originalName` with `originalLang`) and `lifeStatus`. The fields are flat,
 * so every field error is named by its own field (the router names an error by its first path part).
 */
export const historicalClaimInput = z
  .object({
    teacherId: z.uuid({ error: CHOOSE_TEACHER }).nullish(),
    teacherName: optionalText,
    originalName: optionalText,
    originalLang: optionalLang,
    /** Deceased, or not known: a living teacher answers their own request (M09). */
    lifeStatus: z.enum(['deceased', 'unknown'], { error: 'Choose whether the teacher has died or it is not known.' }).default('unknown'),
    /** Required for a new record; for an existing one, the record's own lineage when left out. */
    lineageId: z.uuid({ error: 'Choose a lineage from the list.' }).nullish(),
    periods,
    /** For the reviewers: where the evidence comes from, what it shows. */
    note: z
      .string()
      .max(CLAIM_NOTE_MAX * 2)
      .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
      .nullish()
      .transform((s) => (s ? s : null)),
    evidenceIds: z
      .array(z.uuid({ error: 'Upload the files again.' }), { error: 'Attach at least one file of evidence.' })
      .max(EVIDENCE_MAX_FILES_PER_CASE, { error: `Attach at most ${EVIDENCE_MAX_FILES_PER_CASE} files to one claim.` }),
    /** DEFAULT D05: the student's wish that this teacher be drawn as the primary line; visual only. */
    displayPrimary: z.boolean().default(false),
    idempotencyKey,
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (input.teacherId && input.teacherName) issue('teacherId', 'Choose a teacher on record or enter a new one, not both.');
    if (!input.teacherId) {
      if (!input.teacherName) issue('teacherName', 'Enter the teacher’s name in Latin letters.');
      else if (input.teacherName.length > NAME_MAX_LENGTH) issue('teacherName', `Use at most ${NAME_MAX_LENGTH} characters.`);
      else if (!isLatinName(input.teacherName)) issue('teacherName', 'Use Latin letters here. Add the name in its own script below.');
      if (input.originalName) {
        const script = input.originalLang ? originalScript(input.originalLang) : undefined;
        if (!script) issue('originalLang', 'Choose the script of this name.');
        else if (input.originalName.length > NAME_MAX_LENGTH) issue('originalName', `Use at most ${NAME_MAX_LENGTH} characters.`);
        else if (!matchesScript(input.originalName, script.lang)) issue('originalName', `This name is not written in ${script.label}.`);
      } else if (input.originalLang && !originalScript(input.originalLang)) {
        issue('originalLang', 'Choose one of the listed scripts.');
      }
      if (!input.lineageId) issue('lineageId', 'Choose the lineage this training belongs to.');
    }
    if (input.note && input.note.length > CLAIM_NOTE_MAX) issue('note', `Use at most ${CLAIM_NOTE_MAX} characters.`);
    if (input.evidenceIds.length === 0) issue('evidenceIds', 'Attach at least one file of evidence.');
  });
export type HistoricalClaimInput = z.input<typeof historicalClaimInput>;

export interface HistoricalClaimResult {
  relationship: RelationshipView;
  caseId: string;
  replayed: boolean;
}

/**
 * Why an existing record cannot be claimed as a historical teacher (the field error of teacherId),
 * or null: it exists, is public (the student found it in search), is not the student and is
 * historical or deceased.
 */
async function existingTeacherRefusal(db: Executor, teacherId: string, studentId: string): Promise<string | null> {
  const [teacher] = await db
    .select({ id: person.id, kind: person.kind, lifeStatus: person.lifeStatus, isPublic: sql<boolean>`EXISTS (SELECT 1 FROM v_public_person vp WHERE vp.id = ${teacherId}::uuid)` })
    .from(person)
    .where(and(eq(person.id, teacherId), isNull(person.deletedAt)));
  if (!teacher || !teacher.isPublic) return CHOOSE_TEACHER;
  if (teacher.id === studentId) return 'You can’t name yourself as your teacher.';
  if (teacher.kind !== 'historical' && teacher.lifeStatus !== 'deceased') return NOT_HISTORICAL;
  return null;
}

/** The new teacher record: historical, stewarded by the platform, private until verified. */
async function createTeacherRecord(
  tx: Transaction,
  p: Principal,
  t: { teacherName: string; originalName: string | null; originalLang: string | null; lifeStatus: 'deceased' | 'unknown' },
  meta: RequestMeta,
): Promise<string> {
  const id = uuidv7();
  // DEFAULT D03: the record of a teacher named in a claim is involved_only until the claim is verified.
  await tx.insert(person).values({
    id,
    slug: slugFromName(t.teacherName, randomBytes(4).toString('hex')),
    kind: 'historical',
    lifeStatus: t.lifeStatus,
    stewardship: 'platform',
    visibility: 'involved_only',
    createdByUserId: p.user.id,
  });
  const script = t.originalName && t.originalLang ? originalScript(t.originalLang)! : null;
  const names: (typeof personName.$inferInsert)[] = [
    { personId: id, kind: 'name', value: t.teacherName, script: 'Latn', lang: 'und-Latn', isPrimary: true, sortOrder: 0 },
  ];
  if (script && t.originalName) names.push({ personId: id, kind: 'name', value: t.originalName, script: script.script, lang: script.lang, sortOrder: 1 });
  await tx.insert(personName).values(names);
  // The search keys, so the record is found by every spelling once it is public (M07).
  await writePersonKeys(tx, id);
  await writeAudit(tx, {
    action: 'person.create',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'person',
    subjectId: id,
    after: { kind: 'historical', lifeStatus: t.lifeStatus, stewardship: 'platform', visibility: 'involved_only', names: names.map((n) => ({ kind: n.kind, script: n.script, lang: n.lang })) },
    reason: 'historical teacher claim',
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  return id;
}

/** Every archivist and administrator: they review historical claims (the queue's notification). */
async function tellReviewers(tx: Transaction, caseId: string): Promise<void> {
  const reviewers = await tx
    .select({ id: authUser.id })
    .from(authUser)
    .where(and(inArray(authUser.role, STAFF_ROLES.filter((r) => r !== 'moderator')), eq(authUser.banned, false)))
    .limit(200);
  if (reviewers.length > 0) await tx.insert(notification).values(reviewers.map((r) => ({ userId: r.id, template: 'review.opened', payload: { caseId } })));
}

/**
 * relationships.requestHistorical: the signed-in student claims training with a historical or
 * deceased teacher, with evidence (see the top of this file).
 */
export async function requestHistoricalTeacher(principal: Principal | null, raw: HistoricalClaimInput, meta: RequestMeta): Promise<HistoricalClaimResult> {
  const p = requireUser(principal);
  const parsed = historicalClaimInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const viewer = await viewerOf(db, p);
  if (!viewer.personId) throw new ServiceError('NOT_FOUND', 'Set up your profile before you name your teachers.');
  const studentId = viewer.personId;

  try {
    const outcome = await db.transaction(async (tx) => {
      await lockStudentRequests(tx, studentId);
      const replay = await replayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        if (replay.fromStatus !== null || replay.toStatus !== 'under_review') throw keyReused();
        const [earlier] = await tx
          .select({ id: reviewCase.id })
          .from(reviewCase)
          .where(and(eq(reviewCase.relationshipId, replay.relationshipId), eq(reviewCase.kind, 'historical_claim')))
          .limit(1);
        if (!earlier) throw keyReused();
        return { id: replay.relationshipId, caseId: earlier.id, replayed: true };
      }

      // Every field error at once, as for a request (M09 review, screens-4).
      const teacherError = input.teacherId ? await existingTeacherRefusal(tx, input.teacherId, studentId) : null;
      const { lineageId, fields: lineageFields } = await checkLineage(tx, input.lineageId ?? null, input.teacherId && !teacherError ? input.teacherId : null);
      const { rows, fields: periodFields } = await checkPeriods(tx, input.periods);
      const fields = { ...(teacherError ? { teacherId: teacherError } : {}), ...lineageFields, ...periodFields };
      if (Object.keys(fields).length > 0 || !lineageId) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);

      if (input.teacherId) {
        const [duplicate] = await tx
          .select({ id: teachingRelationship.id })
          .from(teachingRelationship)
          .where(
            and(
              eq(teachingRelationship.teacherPersonId, input.teacherId),
              eq(teachingRelationship.studentPersonId, studentId),
              eq(teachingRelationship.lineageId, lineageId),
              inArray(teachingRelationship.status, ['pending_teacher', 'awaiting_claim', 'under_review', 'verified', 'in_arbitration']),
            ),
          );
        if (duplicate) throw new ServiceError('CONFLICT', DUPLICATE_MESSAGE, { teacherId: DUPLICATE_MESSAGE });
        if (await closesCycle(tx, input.teacherId, studentId)) throw new ServiceError('CONFLICT', CYCLE_MESSAGE, { teacherId: CYCLE_MESSAGE });
      }
      await checkPendingCap(tx, studentId);
      // A new record has no requests yet: only the account's own window counts for it.
      await checkRequestWindow(tx, p.user.id, input.teacherId ?? uuidv7());

      const teacherId = input.teacherId ?? (await createTeacherRecord(tx, p, { ...input, teacherName: input.teacherName! }, meta));
      const id = uuidv7();
      // DEFAULT D03: pending requests are involved_only; a historical claim is one until verified.
      await tx.insert(teachingRelationship).values({
        id,
        teacherPersonId: teacherId,
        studentPersonId: studentId,
        lineageId,
        status: 'under_review',
        visibility: 'involved_only',
        verificationPath: 'committee_review',
        requestedByUserId: p.user.id,
        prefersDisplayPrimary: input.displayPrimary,
      });
      await writePeriods(tx, id, rows);
      const caseId = uuidv7();
      await tx.insert(reviewCase).values({ id: caseId, kind: 'historical_claim', status: 'open', relationshipId: id, personId: teacherId, openedByUserId: p.user.id });
      // DEFAULT D25: at least one file and at most 20 per case; the files must be the student's own.
      const evidenceError = await linkFilesToCase(tx, p.user.id, caseId, input.evidenceIds);
      if (evidenceError) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { evidenceIds: evidenceError });
      if (input.note) await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: p.user.id, body: input.note, isInternal: false });
      await recordEvent(tx, { relationshipId: id, from: null, to: 'under_review', actor: p, role: 'student', key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.request',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: id,
        after: {
          status: 'under_review',
          visibility: 'involved_only',
          verificationPath: 'committee_review',
          teacherPersonId: teacherId,
          newTeacherRecord: !input.teacherId,
          studentPersonId: studentId,
          lineageId,
          periods: periodShape(rows),
          prefersDisplayPrimary: input.displayPrimary,
          caseId,
          evidenceIds: [...new Set(input.evidenceIds)],
        },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellReviewers(tx, caseId);
      return { id, caseId, replayed: false };
    });
    return { relationship: await viewOf(db, outcome.id, viewer), caseId: outcome.caseId, replayed: outcome.replayed };
  } catch (error) {
    if (isActiveConflict(error)) throw new ServiceError('CONFLICT', DUPLICATE_MESSAGE, { teacherId: DUPLICATE_MESSAGE });
    if (isKeyConflict(error)) throw keyReused();
    throw error;
  }
}
