// A party's own review cases (milestone M10b; plan §5.6, DEFAULT D19): the page
// /dashboard/cases/<id> where an invitee follows their profile claim, a Sifu their instructor
// verification, and both people of a relationship in arbitration read the reason and send
// evidence. Historical claims are followed on Your teachers (M10a) and stay there.
//
//   cases.mine   the account's cases: claims and instructor verifications it opened, disputes
//                about its relationships
//   cases.get    one of them: status, the reviewers' notes and the account's own replies, its own
//                files (each opens only for its uploader: evidence.ts), the decision and its reason
//   cases.reply  a reply to the reviewers while the case is open: a needs_info case goes back to
//                them (review_event `evidence`, audit review.reply, the assignee is told)
//
// Anyone else gets 404, the same answer as for no such case (plan §6.4). In a dispute each party
// reads the reviewers' words and their own, never the other party's replies or files (DEFAULT D19).
// Files are added with the evidence field (POST /api/evidence/upload?case=<id>, evidence.ts).

import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { person, reviewCase, reviewNote, teachingRelationship } from '../db/schema';
import type { Executor } from '../entitlements/access';
import type { NameData } from '../templates/email/types';
import { CLAIM_STATUS_LABELS, REVIEW_KIND_LABELS, type ReviewCaseKind, type ReviewCaseStatus } from '../templates/review';
import type { RequestMeta } from './context';
import { peopleRefs, type PersonRef } from './dashboard';
import { pgErrorOf, ServiceError } from './errors';
import { caseHasRoom, type EvidenceFileView, fileView, filesOfCases } from './evidence';
import { fieldErrors, idempotencyKey, keyReused, namesFor, rowById } from './relationships';
import { type CaseRow, caseById, caseNotFound, caseReplayOf, isCaseKeyConflict, isOpenCase, partiesOf, recordCaseEvent, tellAssignee } from './review-core';

export const CASE_REPLY_MAX = 2000;
const PARTY_KINDS: readonly ReviewCaseKind[] = ['person_claim', 'instructor_verification', 'relationship_dispute'];

export const caseIdInput = z.object({ id: z.uuid({ error: 'No such case.' }) });

export const caseReplyInput = z.object({
  caseId: z.uuid({ error: 'No such case.' }),
  body: z
    .string({ error: 'Write your reply.' })
    .max(CASE_REPLY_MAX * 2, { error: `Use at most ${CASE_REPLY_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length > 0, { error: 'Write your reply.' })
    .refine((s) => s.length <= CASE_REPLY_MAX, { error: `Use at most ${CASE_REPLY_MAX} characters.` }),
  idempotencyKey,
});

export interface PartyCaseRow {
  id: string;
  kind: ReviewCaseKind;
  kindLabel: string;
  status: ReviewCaseStatus;
  statusLabel: string;
  openedAt: string;
}

export interface PartyCaseView extends PartyCaseRow {
  /** The viewer's side: the claimant (claim, verification) or a party of the disputed relationship. */
  role: 'claimant' | 'student' | 'teacher';
  /** The record a profile claim is about: its names and the "Unclaimed record" label until approved. */
  record: { names: NameData[]; unclaimed: boolean } | null;
  /** The relationship of a claim or a dispute. */
  relationship: { teacher: PersonRef; student: PersonRef; lineageName: string; status: string } | null;
  /** The reviewers' notes the parties read, and this account's own replies, oldest first. */
  messages: { fromYou: boolean; body: string; createdAt: string }[];
  /** This account's own files in the case. */
  files: EvidenceFileView[];
  decision: { resolution: 'approved' | 'rejected'; reason: string | null } | null;
  open: boolean;
  canAddFiles: boolean;
}

/** The viewer's side of a case, or null when they are none of its parties. */
async function roleIn(db: Executor, c: CaseRow, userId: string): Promise<PartyCaseView['role'] | null> {
  if (!PARTY_KINDS.includes(c.kind)) return null;
  if (c.kind !== 'relationship_dispute') return c.openedByUserId === userId ? 'claimant' : null;
  if (!c.relationshipId) return null;
  const result = await db.execute<{ side: 'teacher' | 'student' }>(sql`
SELECT CASE WHEN x.id = r.teacher_person_id THEN 'teacher' ELSE 'student' END AS side
  FROM teaching_relationship r
  JOIN person x ON x.id IN (r.teacher_person_id, r.student_person_id) AND x.deleted_at IS NULL
 WHERE r.id = ${c.relationshipId}::uuid AND x.claimed_by_user_id = ${userId}::uuid
 LIMIT 1`);
  return result.rows[0]?.side ?? null;
}

const rowOf = (c: CaseRow): PartyCaseRow => ({
  id: c.id,
  kind: c.kind,
  kindLabel: REVIEW_KIND_LABELS[c.kind],
  status: c.status,
  statusLabel: CLAIM_STATUS_LABELS[c.status],
  openedAt: c.createdAt.toISOString(),
});

/** cases.mine: the signed-in account's own cases, newest first. */
export async function myCases(principal: Principal | null): Promise<{ cases: PartyCaseRow[] }> {
  const p = requireUser(principal);
  const db = getDb();
  const [own] = await db.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
  const disputed = own
    ? db
        .select({ id: teachingRelationship.id })
        .from(teachingRelationship)
        .where(or(eq(teachingRelationship.teacherPersonId, own.id), eq(teachingRelationship.studentPersonId, own.id)))
    : null;
  const rows = await db
    .select({
      id: reviewCase.id,
      kind: reviewCase.kind,
      status: reviewCase.status,
      createdAt: reviewCase.createdAt,
    })
    .from(reviewCase)
    .where(
      or(
        and(inArray(reviewCase.kind, ['person_claim', 'instructor_verification']), eq(reviewCase.openedByUserId, p.user.id)),
        disputed ? and(eq(reviewCase.kind, 'relationship_dispute'), inArray(reviewCase.relationshipId, disputed)) : sql`false`,
      ),
    )
    .orderBy(desc(reviewCase.createdAt), desc(reviewCase.id))
    .limit(50);
  return { cases: rows.map((r) => ({ id: r.id, kind: r.kind, kindLabel: REVIEW_KIND_LABELS[r.kind], status: r.status, statusLabel: CLAIM_STATUS_LABELS[r.status], openedAt: r.createdAt.toISOString() })) };
}

/** cases.get: one of the signed-in account's cases; 404 for anyone else. */
export async function getPartyCase(principal: Principal | null, raw: z.input<typeof caseIdInput>): Promise<PartyCaseView> {
  const p = requireUser(principal);
  const parsed = caseIdInput.safeParse(raw);
  if (!parsed.success) throw caseNotFound();
  const db = getDb();
  const c = await caseById(db, parsed.data.id);
  if (!c) throw caseNotFound();
  const role = await roleIn(db, c, p.user.id);
  if (!role) throw caseNotFound();
  // The reviewers' notes (never an internal one) and this account's own replies: a note of another
  // party (the other side of a dispute) is not shown (DEFAULT D19).
  const parties = await partiesOf(db, c);
  const notes = await db
    .select({ author: reviewNote.authorUserId, body: reviewNote.body, createdAt: reviewNote.createdAt })
    .from(reviewNote)
    .where(and(eq(reviewNote.reviewCaseId, c.id), eq(reviewNote.isInternal, false)))
    .orderBy(asc(reviewNote.createdAt), asc(reviewNote.id));
  const files = ((await filesOfCases(db, [c.id])).get(c.id) ?? []).filter((f) => f.uploadedByUserId === p.user.id);
  const row = c.relationshipId ? await rowById(db, c.relationshipId) : null;
  const refs = row ? await peopleRefs([row.teacherPersonId, row.studentPersonId]) : new Map<string, PersonRef>();
  const [record] = c.kind === 'person_claim' && c.personId ? await db.select({ stewardship: person.stewardship }).from(person).where(eq(person.id, c.personId)) : [];
  const open = isOpenCase(c.status);
  // In a dispute, room among this party's own files only: the other side's never show (DEFAULT D19).
  const room = open && (await caseHasRoom(db, c, p.user.id));
  return {
    ...rowOf(c),
    role,
    record: record && c.personId ? { names: await namesFor(db, c.personId), unclaimed: record.stewardship === 'unclaimed' } : null,
    relationship:
      row && refs.get(row.teacherPersonId) && refs.get(row.studentPersonId)
        ? { teacher: refs.get(row.teacherPersonId)!, student: refs.get(row.studentPersonId)!, lineageName: row.lineageName, status: row.status }
        : null,
    messages: notes
      .filter((n) => n.author === p.user.id || (n.author !== null && !parties.has(n.author)))
      .map((n) => ({ fromYou: n.author === p.user.id, body: n.body, createdAt: n.createdAt.toISOString() })),
    files: files.map((f) => fileView(f, true)),
    decision: c.resolution ? { resolution: c.resolution, reason: c.resolutionReason } : null,
    open,
    canAddFiles: room,
  };
}

export interface CaseReplyResult {
  case: PartyCaseView;
  replayed: boolean;
}

/** cases.reply: a party answers the reviewers while the case is open (see the top of this file). */
export async function replyToCase(principal: Principal | null, raw: z.input<typeof caseReplyInput>, meta: RequestMeta): Promise<CaseReplyResult> {
  const p = requireUser(principal);
  const parsed = caseReplyInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    const replayed = await db.transaction(async (tx) => {
      const seen = await caseById(tx, input.caseId);
      if (!seen) throw caseNotFound();
      // The relationship, then its case (the lock order of review-core.ts).
      if (seen.relationshipId) await rowById(tx, seen.relationshipId, true);
      const c = await caseById(tx, input.caseId, true);
      if (!c || !(await roleIn(tx, c, p.user.id))) throw caseNotFound();
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        if (replay.caseId !== c.id || replay.action !== 'evidence') throw keyReused();
        return true;
      }
      if (!isOpenCase(c.status)) throw new ServiceError('CONFLICT', 'This case has been decided: it takes no more replies.');
      const status = c.status === 'needs_info' ? (c.assignedToUserId ? 'in_review' : 'open') : c.status;
      await tx.insert(reviewNote).values({ reviewCaseId: c.id, authorUserId: p.user.id, body: input.body, isInternal: false });
      await tx.update(reviewCase).set({ status, updatedAt: new Date() }).where(eq(reviewCase.id, c.id));
      await recordCaseEvent(tx, { caseId: c.id, action: 'evidence', from: c.status, to: status, actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'review.reply',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'review_case',
        subjectId: c.id,
        before: { status: c.status },
        after: { status, kind: c.kind, length: input.body.length },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellAssignee(tx, c, 'evidence');
      return false;
    });
    return { case: await getPartyCase(p, { id: input.caseId }), replayed };
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'review_note_idempotency_key') throw keyReused();
    throw error;
  }
}
