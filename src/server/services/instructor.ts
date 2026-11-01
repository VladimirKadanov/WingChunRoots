// Instructor verification (milestone M10b, In scope 3; plan §6.5, DEFAULT D04/D13). A Sifu account
// chose its type itself (M08) and is "Instructor (unverified)" until an archivist or an
// administrator approves an instructor_verification case with evidence (the M10a upload and review
// queue). Until then the Sifu may approve students (DEFAULT D04/D13), and the relationship panel
// says "Approved by an unverified instructor" (v_public_edge.approved_by_unverified_instructor).
//
//   instructor.mine     the account's status and its newest case (status, the reviewers' public
//                       notes, its own files)
//   instructor.request  a Sifu with a profile sends evidence (at least one file, at most 20:
//                       DEFAULT D25) and a note: a case of kind instructor_verification, open; at
//                       most one open at a time (a unique index), and a few a day
//   The decision is review.decide (review-kinds.ts; audit instructor.verify).
//
// The seeded Sifu accounts are verified (src/fixtures/generate.ts).

import { and, asc, count, desc, eq, gt, inArray } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { reviewCase, reviewEvent, reviewNote } from '../db/schema';
import { EVIDENCE_MAX_FILES_PER_CASE, OPEN_REVIEW_CASE_STATUSES } from '../db/schema/common';
import { effectivePlan } from '../entitlements/access';
import { CLAIM_STATUS_LABELS, type ReviewCaseStatus } from '../templates/review';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';
import { type EvidenceFileView, fileView, filesOfCases, linkFilesToCase } from './evidence';
import { INSTRUCTOR_LABELS, type InstructorStatus, instructorStatus } from './plans';
import { fieldErrors, idempotencyKey, keyReused, viewerOf } from './relationships';
import { caseReplayOf, isCaseKeyConflict, lockAccountCases, recordCaseEvent, tellStaff } from './review-core';

export const INSTRUCTOR_NOTE_MAX = 2000;
/** At most this many instructor verification requests of one account in 24 hours. */
export const INSTRUCTOR_REQUESTS_PER_DAY = 3;

export const instructorRequestInput = z.object({
  note: z
    .string()
    .max(INSTRUCTOR_NOTE_MAX * 2, { error: `Use at most ${INSTRUCTOR_NOTE_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length <= INSTRUCTOR_NOTE_MAX, { error: `Use at most ${INSTRUCTOR_NOTE_MAX} characters.` })
    .nullish()
    .transform((s) => (s ? s : null)),
  evidenceIds: z
    .array(z.uuid({ error: 'Upload the files again.' }), { error: 'Attach at least one file of evidence.' })
    .min(1, { error: 'Attach at least one file of evidence.' })
    .max(EVIDENCE_MAX_FILES_PER_CASE, { error: `Attach at most ${EVIDENCE_MAX_FILES_PER_CASE} files.` }),
  idempotencyKey,
});
export type InstructorRequestInput = z.input<typeof instructorRequestInput>;

export interface InstructorCaseView {
  id: string;
  status: ReviewCaseStatus;
  statusLabel: string;
  resolution: 'approved' | 'rejected' | null;
  /** The reviewers' reason of a refusal. */
  reason: string | null;
  messages: { fromYou: boolean; body: string; createdAt: string }[];
  /** The files of the case; each opens only for its uploader (and the reviewers). */
  files: EvidenceFileView[];
  open: boolean;
}

export interface InstructorOverview {
  accountType: 'student' | 'sifu';
  hasProfile: boolean;
  status: InstructorStatus;
  label: string;
  case: InstructorCaseView | null;
  /** A Sifu with a profile, not verified, with no case waiting. */
  canRequest: boolean;
  /** Why not, when the account cannot send a request. */
  refusal: string | null;
}

/** instructor.mine: the signed-in account's instructor status and its newest case. */
export async function instructorOverview(principal: Principal | null): Promise<InstructorOverview> {
  const p = requireUser(principal);
  const db = getDb();
  const viewer = await viewerOf(db, p);
  const plan = await effectivePlan({ kind: 'user', userId: p.user.id }, { db });
  const status = await instructorStatus(db, p.user.id, plan.accountType);
  const [latest] = viewer.personId
    ? await db
        .select({ id: reviewCase.id, status: reviewCase.status, resolution: reviewCase.resolution, reason: reviewCase.resolutionReason })
        .from(reviewCase)
        .where(and(eq(reviewCase.personId, viewer.personId), eq(reviewCase.kind, 'instructor_verification')))
        .orderBy(desc(reviewCase.createdAt), desc(reviewCase.id))
        .limit(1)
    : [];
  let view: InstructorCaseView | null = null;
  if (latest) {
    const notes = await db
      .select({ author: reviewNote.authorUserId, body: reviewNote.body, createdAt: reviewNote.createdAt })
      .from(reviewNote)
      .where(and(eq(reviewNote.reviewCaseId, latest.id), eq(reviewNote.isInternal, false)))
      .orderBy(asc(reviewNote.createdAt), asc(reviewNote.id));
    const files = (await filesOfCases(db, [latest.id])).get(latest.id) ?? [];
    const open = (OPEN_REVIEW_CASE_STATUSES as readonly string[]).includes(latest.status);
    view = {
      id: latest.id,
      status: latest.status,
      statusLabel: CLAIM_STATUS_LABELS[latest.status],
      resolution: latest.resolution,
      reason: latest.resolution === 'rejected' ? latest.reason : null,
      messages: notes.map((n) => ({ fromYou: n.author === p.user.id, body: n.body, createdAt: n.createdAt.toISOString() })),
      files: files.map((f) => fileView(f, f.uploadedByUserId === p.user.id)),
      open,
    };
  }
  const refusal =
    plan.accountType !== 'sifu'
      ? 'Instructor verification is for Sifu accounts. Choose the Sifu account type in Account type and plan first.'
      : !viewer.personId
        ? 'Set up your profile first.'
        : status === 'verified'
          ? null
          : view?.open
            ? 'Your evidence is with the reviewers.'
            : null;
  return {
    accountType: plan.accountType,
    hasProfile: viewer.personId !== null,
    status,
    label: INSTRUCTOR_LABELS[status],
    case: view,
    canRequest: plan.accountType === 'sifu' && viewer.personId !== null && status !== 'verified' && !view?.open,
    refusal,
  };
}

export interface InstructorRequestResult {
  caseId: string;
  replayed: boolean;
}

/** instructor.request: a Sifu sends evidence for instructor verification (see the top of this file). */
export async function requestInstructorVerification(principal: Principal | null, raw: InstructorRequestInput, meta: RequestMeta): Promise<InstructorRequestResult> {
  const p = requireUser(principal);
  const parsed = instructorRequestInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const viewer = await viewerOf(db, p);
  if (!viewer.personId) throw new ServiceError('NOT_FOUND', 'Set up your profile first.');
  const personId = viewer.personId;
  try {
    return await db.transaction(async (tx) => {
      // The account's case lock first: the open case and the requests of the day are counted one
      // call after the other (the unique index stays the last word on one open case).
      await lockAccountCases(tx, p.user.id);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        const [earlier] = await tx.select({ kind: reviewCase.kind }).from(reviewCase).where(eq(reviewCase.id, replay.caseId));
        if (replay.action !== 'open' || earlier?.kind !== 'instructor_verification') throw keyReused();
        return { caseId: replay.caseId, replayed: true };
      }
      const plan = await effectivePlan({ kind: 'user', userId: p.user.id }, { db: tx });
      if (plan.accountType !== 'sifu') throw new ServiceError('CONFLICT', 'Instructor verification is for Sifu accounts. Choose the Sifu account type in Account type and plan first.');
      if ((await instructorStatus(tx, p.user.id, plan.accountType)) === 'verified') throw new ServiceError('CONFLICT', 'You are a verified instructor already.');
      const [waiting] = await tx
        .select({ id: reviewCase.id })
        .from(reviewCase)
        .where(and(eq(reviewCase.personId, personId), eq(reviewCase.kind, 'instructor_verification'), inArray(reviewCase.status, [...OPEN_REVIEW_CASE_STATUSES])));
      if (waiting) throw new ServiceError('CONFLICT', 'Your evidence is with the reviewers already. You can add files to that case.');
      const [recent] = await tx
        .select({ n: count() })
        .from(reviewEvent)
        .innerJoin(reviewCase, eq(reviewCase.id, reviewEvent.reviewCaseId))
        .where(
          and(
            eq(reviewEvent.actorUserId, p.user.id),
            eq(reviewEvent.action, 'open'),
            eq(reviewCase.kind, 'instructor_verification'),
            gt(reviewEvent.createdAt, new Date(Date.now() - 86_400_000)),
          ),
        );
      if ((recent?.n ?? 0) >= INSTRUCTOR_REQUESTS_PER_DAY) throw new ServiceError('TOO_MANY_REQUESTS', 'You have sent several requests today. You can send another one tomorrow.');

      const caseId = uuidv7();
      await tx.insert(reviewCase).values({ id: caseId, kind: 'instructor_verification', status: 'open', personId, openedByUserId: p.user.id });
      // DEFAULT D13: instructor verification needs evidence; DEFAULT D25: at most 20 files.
      const evidenceError = await linkFilesToCase(tx, p.user.id, caseId, input.evidenceIds);
      if (evidenceError) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { evidenceIds: evidenceError });
      if (input.note) await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: p.user.id, body: input.note, isInternal: false });
      await recordCaseEvent(tx, { caseId, action: 'open', from: null, to: 'open', actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'instructor.request',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'person',
        subjectId: personId,
        after: { caseId, evidenceIds: [...new Set(input.evidenceIds)] },
        evidenceIds: input.evidenceIds,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellStaff(tx, caseId, 'instructor_verification', [p.user.id]);
      return { caseId, replayed: false };
    });
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'review_case_one_open_instructor_key') {
      throw new ServiceError('CONFLICT', 'Your evidence is with the reviewers already. You can add files to that case.');
    }
    throw error;
  }
}
