// The review queue (milestone M10a, In scope 4 and 5; plan §5.6, §6.6, §6.7). Staff whose session
// proved the second factor (archivist, moderator, administrator) read the open cases, take one,
// ask the claimant for more information and keep internal notes; an archivist or an administrator
// verifies or refuses a historical teacher claim. Every decision is a procedure (review.decide,
// review.assign) that writes a relationship_event and an audit row in one transaction with its
// notices.
//
//   review.list    the queue: filters by kind, status and assignee, sorted, paged (URL state)
//   review.get     one case: the relationship, the evidence (a link and the file's name only for
//                  those who may open it: evidence.ts accessOfFiles), the notes and what this
//                  reviewer may do; a reviewer who is a party to the case reads no internal note
//   review.assign  take a case (any reviewer) or give it to another (an administrator); unassign
//   review.decide  verify | reject (with a reason) | needs_info (with a question for the claimant)
//   review.note    an internal note, for reviewers only
//   archive.get / archive.update
//                  the archival edit (In scope 5, plan §6.6): only an archivist edits a record kept
//                  by the platform or unclaimed, with a required reason and optional evidence (files
//                  they uploaded for the edit, never a claim's); the audit row person.update keeps
//                  `reason` and `evidence_ids`
//
// Who may do what:
//   - a signed-in account without a staff role: 403 (the page shows the explicit denied state);
//     staff without the second factor in this session: SECOND_FACTOR_REQUIRED;
//   - verify and reject: an archivist or an administrator (plan §6.7), on a case assigned to them
//     (an administrator also on any other); needs_info: the assignee or an administrator;
//   - nobody reviews a claim of their own, as the student or the teacher (403), is given one, or
//     reads its internal notes;
//   - the archival edit: an archivist only; an administrator or a moderator gets 403.
// Verify runs in the order of an approval (plan §6.3): the global verify lock, then the rows (the
// relationship before its case, the order withdraw takes them), the cycle, duplicate and self
// checks, then the writes of relationships.ts markVerified. After the commit the public cache of
// both people and their neighbours is dropped and lineage.recompute is queued. Every decision and
// assignment locks the relationship before its case (FOR UPDATE both), so none of them deadlocks
// against another or against a withdrawal.
//
// Account deletion requests (kind deletion_request) stay on /admin and the command line (M07):
// they name an account, so they are not in this queue. M11: school listings (school_listing) are
// listed, assigned and noted here and decided by school-review.ts (a moderator or an administrator
// approves or returns them). The other kinds come with M10b; their cases are listed and can be
// assigned, but decided only from M10b.
//
// Logs and audit rows carry ids and codes. A reviewer's reason or note is kept in the case
// (review_case.resolution_reason, review_note), never in a log.

import { and, asc, count, desc, eq, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { hasStaff2FA, requireStaff2FA } from '../auth/guards';
import type { Principal, StaffRole } from '../auth/principal';
import { invalidatePublic } from '../cache';
import { getDb } from '../db';
import { authUser, evidenceLink, notification, person, personBio, personName, reviewCase, reviewNote, teachingRelationship } from '../db/schema';
import { OPEN_REVIEW_CASE_STATUSES, PUBLIC_RELATIONSHIP_STATUSES, REVIEW_CASE_KINDS, REVIEW_CASE_STATUSES, STAFF_ROLES } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import { enqueue, queueEmail, type Transaction } from '../jobs/outbox';
import { QUEUE } from '../jobs/queues';
import { writePersonKeys } from '../search/store';
import { REVIEW_KIND_LABELS, REVIEW_STATUS_LABELS, type ReviewCaseKind, type ReviewCaseStatus } from '../templates/review';
import type { RequestMeta } from './context';
import { peopleRefs, type PersonRef } from './dashboard';
import { ARCHIVAL_EVIDENCE_MESSAGE, type EvidenceFileView, fileView, filesOfCases, filesOfPerson, linkFilesToPerson, openableFiles } from './evidence';
import { pgErrorOf, ServiceError } from './errors';
import { decideSchoolListing, LISTING_DECIDE_ROLES, lockListing, type SchoolCaseView, schoolCaseView, schoolRowsOf } from './school-review';
import { cleanName, isLatinName, matchesScript, NAME_MAX_LENGTH, ORIGINAL_SCRIPTS, originalScript } from './names';
import { BIO_MAX_LENGTH, neighbourTags } from './profile';
import {
  accountOf,
  closesCycle,
  CYCLE_MESSAGE,
  idempotencyKey,
  isKeyConflict,
  keyReused,
  markVerified,
  namesFor,
  publicTags,
  recordEvent,
  type RelationshipView,
  type RelRow,
  replayOf,
  rowById,
  url,
  VERIFY_LOCK,
  viewerOf,
  viewOf,
} from './relationships';

/** Cases of one page of the queue. */
export const REVIEW_PAGE_SIZE = 25;
export const REVIEW_TEXT_MAX = 2000;
/** The kinds this queue lists: every kind except account deletion requests (M07, on /admin). */
export const QUEUE_KINDS = REVIEW_CASE_KINDS.filter((k) => k !== 'deletion_request') as Exclude<ReviewCaseKind, 'deletion_request'>[];
/** The roles that verify or refuse a historical claim (plan §6.7). */
const DECIDE_ROLES: readonly StaffRole[] = ['archivist', 'admin'];
/** The only role that edits archival records (plan §6.6). */
const ARCHIVE_ROLES: readonly StaffRole[] = ['archivist'];

const NO_CASE = 'No such case.';
const notFound = () => new ServiceError('NOT_FOUND', NO_CASE);
const isOpen = (status: string) => (OPEN_REVIEW_CASE_STATUSES as readonly string[]).includes(status);

const reviewText = (empty: string) =>
  z
    .string({ error: empty })
    .max(REVIEW_TEXT_MAX * 2, { error: `Use at most ${REVIEW_TEXT_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length > 0, { error: empty })
    .refine((s) => s.length <= REVIEW_TEXT_MAX, { error: `Use at most ${REVIEW_TEXT_MAX} characters.` });

// --- Input -------------------------------------------------------------------------------------

export const reviewListInput = z.object({
  kind: z.enum(QUEUE_KINDS as [string, ...string[]]).nullish(),
  /** `waiting`: open, in review or needing information (the default); `all`: every status. */
  status: z.enum(['waiting', 'all', ...REVIEW_CASE_STATUSES]).default('waiting'),
  assigned: z.enum(['any', 'me', 'none']).default('any'),
  sort: z.enum(['oldest', 'newest']).default('oldest'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ReviewListInput = z.input<typeof reviewListInput>;

export const reviewIdInput = z.object({ id: z.uuid({ error: NO_CASE }) });

export const reviewAssignInput = z.object({
  caseId: z.uuid({ error: NO_CASE }),
  /** The reviewer to give the case to (yourself, or anyone for an administrator); null to unassign. */
  assigneeId: z.uuid({ error: 'Choose a reviewer from the list.' }).nullable(),
  idempotencyKey,
});

export const reviewDecideInput = z
  .object({
    caseId: z.uuid({ error: NO_CASE }),
    decision: z.enum(['verify', 'reject', 'needs_info'], { error: 'Choose a decision.' }),
    /** The reason of a refusal, the question of needs_info; optional for verify. */
    reason: z
      .string()
      .max(REVIEW_TEXT_MAX * 2, { error: `Use at most ${REVIEW_TEXT_MAX} characters.` })
      .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
      .nullish()
      .transform((s) => (s ? s : null)),
    idempotencyKey,
  })
  .superRefine((input, ctx) => {
    if (input.reason && input.reason.length > REVIEW_TEXT_MAX) ctx.addIssue({ code: 'custom', path: ['reason'], message: `Use at most ${REVIEW_TEXT_MAX} characters.` });
    if (!input.reason && input.decision === 'reject') ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Write the reason the claimant will read.' });
    if (!input.reason && input.decision === 'needs_info') ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Write what the claimant should add.' });
  });

export const reviewNoteInput = z.object({
  caseId: z.uuid({ error: NO_CASE }),
  body: reviewText('Write the note.'),
  idempotencyKey,
});

// --- Views -------------------------------------------------------------------------------------

export interface ReviewListRow {
  id: string;
  kind: ReviewCaseKind;
  kindLabel: string;
  status: ReviewCaseStatus;
  statusLabel: string;
  openedAt: string;
  updatedAt: string;
  assignee: 'me' | 'other' | null;
  /** The people of a relationship case (teacher and student), null for another kind. */
  teacher: PersonRef | null;
  /** M11: the school of a listing case, null for another kind. */
  school: { name: string; city: string; countryCode: string } | null;
  student: PersonRef | null;
  lineageName: string | null;
  files: number;
}

export interface ReviewList {
  rows: ReviewListRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: z.output<typeof reviewListInput>;
  kinds: { value: string; label: string }[];
  statuses: { value: string; label: string }[];
}

export interface ReviewNoteView {
  id: string;
  internal: boolean;
  body: string;
  createdAt: string;
  /** Who wrote it: the claimant, this reviewer, or another reviewer (by role). */
  author: 'claimant' | 'you' | 'reviewer';
  authorRole: string | null;
}

export interface ReviewCaseView {
  id: string;
  kind: ReviewCaseKind;
  kindLabel: string;
  status: ReviewCaseStatus;
  statusLabel: string;
  openedAt: string;
  updatedAt: string;
  resolution: 'approved' | 'rejected' | null;
  resolutionReason: string | null;
  resolvedAt: string | null;
  assignee: { me: boolean; role: string | null } | null;
  relationship: RelationshipView | null;
  /** The teacher's record: whether it is new (created with the claim), kept by the platform, public. */
  teacherRecord: { slug: string; kind: string; lifeStatus: string; stewardship: string; visibility: string; createdWithClaim: boolean } | null;
  /** M11: the school of a listing case (never the exact point of a city-only school). */
  school: SchoolCaseView | null;
  files: EvidenceFileView[];
  notes: ReviewNoteView[];
  can: { assignSelf: boolean; unassign: boolean; assignOthers: boolean; verify: boolean; reject: boolean; needsInfo: boolean; note: boolean };
  /** Why this reviewer may not decide, when they may not (shown on the card). */
  decideNote: string | null;
  /** For an administrator: the reviewers a case can be given to. */
  reviewers: { id: string; label: string }[];
}

interface CaseRow {
  id: string;
  kind: ReviewCaseKind;
  status: ReviewCaseStatus;
  relationshipId: string | null;
  personId: string | null;
  schoolId: string | null;
  openedByUserId: string | null;
  assignedToUserId: string | null;
  resolution: 'approved' | 'rejected' | null;
  resolutionReason: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const caseColumns = {
  id: reviewCase.id,
  kind: reviewCase.kind,
  status: reviewCase.status,
  relationshipId: reviewCase.relationshipId,
  personId: reviewCase.personId,
  schoolId: reviewCase.schoolId,
  openedByUserId: reviewCase.openedByUserId,
  assignedToUserId: reviewCase.assignedToUserId,
  resolution: reviewCase.resolution,
  resolutionReason: reviewCase.resolutionReason,
  resolvedAt: reviewCase.resolvedAt,
  createdAt: reviewCase.createdAt,
  updatedAt: reviewCase.updatedAt,
};

async function caseById(db: Executor, id: string, lock = false): Promise<CaseRow | null> {
  const query = db.select(caseColumns).from(reviewCase).where(and(eq(reviewCase.id, id), ne(reviewCase.kind, 'deletion_request')));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/**
 * The accounts a case is about: the claimant who opened it and the accounts of the relationship's
 * teacher and student. Nobody reviews a claim of their own, whatever their role: such a reviewer
 * takes no action on it, is not given it, and reads it as the parties do (no internal notes).
 */
async function partiesOf(db: Executor, c: Pick<CaseRow, 'relationshipId' | 'openedByUserId'>): Promise<Set<string>> {
  const out = new Set<string>();
  if (c.openedByUserId) out.add(c.openedByUserId);
  if (!c.relationshipId) return out;
  const rows = await db
    .select({ userId: person.claimedByUserId })
    .from(teachingRelationship)
    .innerJoin(person, or(eq(person.id, teachingRelationship.teacherPersonId), eq(person.id, teachingRelationship.studentPersonId)))
    .where(and(eq(teachingRelationship.id, c.relationshipId), isNull(person.deletedAt)));
  for (const row of rows) if (row.userId) out.add(row.userId);
  return out;
}

/** The reviewer's own side of a relationship, if any: nobody reviews their own claim. */
async function ownSide(db: Executor, p: Principal, c: Pick<CaseRow, 'relationshipId' | 'openedByUserId'>): Promise<boolean> {
  return (await partiesOf(db, c)).has(p.user.id);
}

// --- review.list -------------------------------------------------------------------------------

/** review.list: the queue (any reviewer with the second factor). */
export async function listReviewCases(principal: Principal | null, raw: ReviewListInput = {}): Promise<ReviewList> {
  const p = requireStaff2FA(principal);
  const parsed = reviewListInput.safeParse(raw);
  const filters = parsed.success ? parsed.data : reviewListInput.parse({});
  const db = getDb();
  const where: SQL[] = [ne(reviewCase.kind, 'deletion_request')];
  if (filters.kind) where.push(eq(reviewCase.kind, filters.kind as ReviewCaseKind));
  if (filters.status === 'waiting') where.push(inArray(reviewCase.status, [...OPEN_REVIEW_CASE_STATUSES]));
  else if (filters.status !== 'all') where.push(eq(reviewCase.status, filters.status));
  if (filters.assigned === 'me') where.push(eq(reviewCase.assignedToUserId, p.user.id));
  else if (filters.assigned === 'none') where.push(isNull(reviewCase.assignedToUserId));
  const condition = and(...where);
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(reviewCase).where(condition);
  const order = filters.sort === 'newest' ? [desc(reviewCase.createdAt), desc(reviewCase.id)] : [asc(reviewCase.createdAt), asc(reviewCase.id)];
  const rows = await db
    .select({
      ...caseColumns,
      teacherId: teachingRelationship.teacherPersonId,
      studentId: teachingRelationship.studentPersonId,
      lineageName: sql<string | null>`(SELECT l.name FROM lineage l WHERE l.id = ${teachingRelationship.lineageId})`,
      files: sql<number>`(SELECT count(*)::int FROM evidence_link el JOIN evidence_file ef ON ef.id = el.evidence_file_id AND ef.deleted_at IS NULL WHERE el.review_case_id = ${reviewCase.id})`,
    })
    .from(reviewCase)
    .leftJoin(teachingRelationship, eq(teachingRelationship.id, reviewCase.relationshipId))
    .where(condition)
    .orderBy(...order)
    .limit(REVIEW_PAGE_SIZE)
    .offset((filters.page - 1) * REVIEW_PAGE_SIZE);
  const refs = await peopleRefs([...new Set(rows.flatMap((r) => [r.teacherId, r.studentId]).filter((id): id is string => id !== null))]);
  const schools = await schoolRowsOf(db, [...new Set(rows.map((r) => r.schoolId).filter((id): id is string => id !== null))]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      kindLabel: REVIEW_KIND_LABELS[r.kind],
      status: r.status,
      statusLabel: REVIEW_STATUS_LABELS[r.status],
      openedAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      assignee: r.assignedToUserId === null ? null : r.assignedToUserId === p.user.id ? 'me' : 'other',
      teacher: r.teacherId ? (refs.get(r.teacherId) ?? null) : null,
      student: r.studentId ? (refs.get(r.studentId) ?? null) : null,
      school: r.schoolId ? (schools.get(r.schoolId) ?? null) : null,
      lineageName: r.lineageName,
      files: r.files,
    })),
    total,
    page: filters.page,
    pageSize: REVIEW_PAGE_SIZE,
    filters,
    kinds: QUEUE_KINDS.map((k) => ({ value: k, label: REVIEW_KIND_LABELS[k] })),
    statuses: [
      { value: 'waiting', label: 'Waiting for a decision' },
      ...REVIEW_CASE_STATUSES.map((s) => ({ value: s, label: REVIEW_STATUS_LABELS[s] })),
      { value: 'all', label: 'Any status' },
    ],
  };
}

// --- review.get --------------------------------------------------------------------------------

/** What this reviewer may do on a case, and why not. `subjectStatus`: the relationship's, or the listed school's (M11). */
function abilities(p: Principal, c: CaseRow, subjectStatus: string | null, own: boolean) {
  const admin = hasStaff2FA(p, ['admin']);
  const listing = c.kind === 'school_listing';
  const decider = hasStaff2FA(p, listing ? LISTING_DECIDE_ROLES : DECIDE_ROLES);
  const mine = c.assignedToUserId === p.user.id;
  const open = isOpen(c.status);
  const decidable = listing ? subjectStatus === 'pending_review' : c.kind === 'historical_claim' && subjectStatus === 'under_review';
  const may = !own && open;
  const decideNote = own
    ? listing
      ? 'This listing is yours: another reviewer decides it.'
      : 'This claim is about you: another reviewer decides it.'
    : !open
      ? null
      : c.kind !== 'historical_claim' && !listing
        ? 'Cases of this kind are decided from a later version of the review tool.'
        : !decider
          ? listing
            ? 'A moderator or an administrator approves or returns a school listing. You can ask the Sifu for more information and add notes.'
            : 'An archivist or an administrator verifies or refuses a historical claim. You can ask the claimant for more information and add notes.'
          : !mine && !admin
            ? listing
              ? 'Assign the case to yourself to decide it.'
              : 'Assign the case to yourself to decide it and to open the evidence.'
            : null;
  return {
    can: {
      assignSelf: may && !mine,
      unassign: may && c.assignedToUserId !== null && (mine || admin),
      assignOthers: may && admin,
      verify: may && decidable && decider && (mine || admin),
      reject: may && decidable && decider && (mine || admin),
      needsInfo: may && decidable && (mine || admin),
      note: !own,
    },
    decideNote,
  };
}

/** review.get: one case, for any reviewer with the second factor. */
export async function getReviewCase(principal: Principal | null, raw: z.input<typeof reviewIdInput>): Promise<ReviewCaseView> {
  const p = requireStaff2FA(principal);
  const parsed = reviewIdInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const db = getDb();
  const c = await caseById(db, parsed.data.id);
  if (!c) throw notFound();
  const viewer = await viewerOf(db, p);
  const relationship = c.relationshipId ? await viewOf(db, c.relationshipId, { ...viewer, reviewer: true }).catch(() => null) : null;
  const parties = await partiesOf(db, c);
  const own = parties.has(p.user.id);
  const files = (await filesOfCases(db, [c.id])).get(c.id) ?? [];
  // The download's own rule (evidence.ts accessOfFiles): a link and a name only for a file this
  // viewer may open.
  const opens = await openableFiles(db, p, files.map((f) => f.id));
  // A party to the case (a reviewer who is its claimant, teacher or student) reads it as the
  // parties do: no internal note, and no reviewer's role (M10a review, security-2).
  const notes = await db
    .select({ id: reviewNote.id, internal: reviewNote.isInternal, body: reviewNote.body, createdAt: reviewNote.createdAt, author: reviewNote.authorUserId, role: authUser.role })
    .from(reviewNote)
    .leftJoin(authUser, eq(authUser.id, reviewNote.authorUserId))
    .where(own ? and(eq(reviewNote.reviewCaseId, c.id), eq(reviewNote.isInternal, false)) : eq(reviewNote.reviewCaseId, c.id))
    .orderBy(asc(reviewNote.createdAt), asc(reviewNote.id));
  const [assignee] = c.assignedToUserId ? await db.select({ role: authUser.role }).from(authUser).where(eq(authUser.id, c.assignedToUserId)) : [];
  const teacherRecord = relationship
    ? await db
        .select({ slug: person.slug, kind: person.kind, lifeStatus: person.lifeStatus, stewardship: person.stewardship, visibility: person.visibility, createdBy: person.createdByUserId })
        .from(person)
        .where(eq(person.id, relationship.teacher.id))
        .then(([t]) => (t ? { slug: t.slug, kind: t.kind, lifeStatus: t.lifeStatus, stewardship: t.stewardship, visibility: t.visibility, createdWithClaim: t.createdBy !== null && t.createdBy === c.openedByUserId } : null))
    : null;
  const schoolView = c.kind === 'school_listing' && c.schoolId ? await schoolCaseView(db, c.schoolId) : null;
  const { can, decideNote } = abilities(p, c, relationship?.status ?? schoolView?.status ?? null, own);
  const reviewers = can.assignOthers
    ? (
        await db
          .select({ id: authUser.id, name: authUser.name, role: authUser.role })
          .from(authUser)
          .where(and(inArray(authUser.role, [...STAFF_ROLES]), eq(authUser.banned, false)))
          .orderBy(asc(authUser.name), asc(authUser.id))
          .limit(200)
      )
        .filter((r) => !parties.has(r.id))
        .map((r) => ({ id: r.id, label: `${r.name || 'Reviewer'} (${r.role})${r.id === p.user.id ? ' — you' : ''}` }))
    : [];
  return {
    id: c.id,
    kind: c.kind,
    kindLabel: REVIEW_KIND_LABELS[c.kind],
    status: c.status,
    statusLabel: REVIEW_STATUS_LABELS[c.status],
    openedAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    resolution: c.resolution,
    resolutionReason: c.resolutionReason,
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    assignee: c.assignedToUserId ? { me: c.assignedToUserId === p.user.id, role: own ? null : (assignee?.role ?? null) } : null,
    relationship,
    teacherRecord,
    school: schoolView,
    files: files.map((f) => fileView(f, opens.has(f.id))),
    notes: notes.map((n) => ({
      id: n.id,
      internal: n.internal,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      author: n.author !== null && n.author === c.openedByUserId ? 'claimant' : n.author === p.user.id ? 'you' : 'reviewer',
      authorRole: own || (n.author !== null && n.author === c.openedByUserId) ? null : (n.role ?? null),
    })),
    can,
    decideNote,
    reviewers,
  };
}

// --- review.assign -----------------------------------------------------------------------------

/** The replayed outcome of a review key, or null when the key is new. */
async function replayReview(tx: Executor, p: Principal, key: string, relationshipId: string | null, expect: { to: string; reason: string }): Promise<boolean> {
  const replay = await replayOf(tx, p.user.id, key);
  if (!replay) return false;
  if (replay.relationshipId !== relationshipId || replay.toStatus !== expect.to || replay.reason !== expect.reason) throw keyReused();
  return true;
}

export interface ReviewResult {
  case: ReviewCaseView;
  replayed: boolean;
}

/**
 * review.assign: a reviewer takes a case (assigneeId = their own id), an administrator gives it to
 * another reviewer, the assignee or an administrator unassigns it (null). An open case taken is in
 * review; one unassigned is open again. Written as a relationship_event (the relationship keeps its
 * status; the reason says assigned or unassigned) and the audit row review.assign.
 */
export async function assignReviewCase(principal: Principal | null, raw: z.input<typeof reviewAssignInput>, meta: RequestMeta): Promise<ReviewResult> {
  const p = requireStaff2FA(principal);
  const parsed = reviewAssignInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { assigneeId: parsed.error.issues[0]?.message ?? 'Choose a reviewer.' });
  const input = parsed.data;
  const db = getDb();
  const admin = hasStaff2FA(p, ['admin']);
  try {
    const replayed = await db.transaction(async (tx) => {
      const seen = await caseById(tx, input.caseId);
      if (!seen) throw notFound();
      const listing = seen.kind === 'school_listing' && seen.schoolId !== null;
      if (!listing && (seen.kind !== 'historical_claim' || !seen.relationshipId)) throw new ServiceError('CONFLICT', 'Cases of this kind are handled from a later version of the review tool.');
      // The relationship, then its case: the order of review.decide and relationships.withdraw. The
      // relationship_event written below takes a KEY SHARE lock on the relationship (its foreign
      // key), so taking the case first would deadlock against them (M10a review, code-1). A listing
      // case: its school, then the case (the order of schools.submit and school-review.ts).
      if (listing) await lockListing(tx, seen.schoolId!);
      else await rowById(tx, seen.relationshipId!, true);
      const c = await caseById(tx, input.caseId, true);
      if (!c || (!listing && !c.relationshipId)) throw notFound();
      const reason = input.assigneeId ? 'assigned' : 'unassigned';
      // A listing case has no relationship_event: the same assignment again changes nothing (below).
      if (c.relationshipId && (await replayReview(tx, p, input.idempotencyKey, c.relationshipId, { to: 'under_review', reason }))) return true;
      if (await ownSide(tx, p, c)) throw new ServiceError('FORBIDDEN', 'This claim is about you: another reviewer handles it.');
      if (!isOpen(c.status)) throw new ServiceError('CONFLICT', 'This case has been decided or closed.');
      if (input.assigneeId === null) {
        if (c.assignedToUserId === null) return false;
        if (c.assignedToUserId !== p.user.id && !admin) throw new ServiceError('FORBIDDEN', 'Only the reviewer it is assigned to, or an administrator, can unassign this case.');
      } else if (input.assigneeId !== p.user.id) {
        if (!admin) throw new ServiceError('FORBIDDEN', 'Only an administrator can give a case to another reviewer.');
        const [other] = await tx
          .select({ id: authUser.id })
          .from(authUser)
          .where(and(eq(authUser.id, input.assigneeId), inArray(authUser.role, [...STAFF_ROLES]), eq(authUser.banned, false)));
        if (!other) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { assigneeId: 'Choose a reviewer from the list.' });
        // Nor is a case given to one of its parties (M10a review, security-2).
        if ((await partiesOf(tx, c)).has(input.assigneeId)) {
          throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { assigneeId: 'This claim is about that reviewer: choose another one.' });
        }
      }
      if (c.assignedToUserId === input.assigneeId) return false;
      const status = input.assigneeId === null ? (c.status === 'in_review' ? 'open' : c.status) : c.status === 'open' ? 'in_review' : c.status;
      await tx.update(reviewCase).set({ assignedToUserId: input.assigneeId, status, updatedAt: new Date() }).where(eq(reviewCase.id, c.id));
      if (c.relationshipId) await recordEvent(tx, { relationshipId: c.relationshipId, from: 'under_review', to: 'under_review', actor: p, role: p.user.role, reason, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'review.assign',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'review_case',
        subjectId: c.id,
        before: { assignedToUserId: c.assignedToUserId, status: c.status },
        after: { assignedToUserId: input.assigneeId, status },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      return false;
    });
    return { case: await getReviewCase(p, { id: input.caseId }), replayed };
  } catch (error) {
    if (isKeyConflict(error)) throw keyReused();
    throw error;
  }
}

// --- review.decide -----------------------------------------------------------------------------

/** The notice and the e-mail of a decision, to the student. */
async function tellStudent(tx: Transaction, row: RelRow, decision: 'verified' | 'rejected' | 'needs_info', eventId: string): Promise<void> {
  const student = await accountOf(tx, row.studentPersonId);
  if (!student) return;
  await tx.insert(notification).values({ userId: student.id, template: 'review.decided', payload: { relationshipId: row.id, decision } });
  const teacherNames = await namesFor(tx, row.teacherPersonId);
  if (teacherNames.length === 0) return;
  const recipientNames = await namesFor(tx, row.studentPersonId);
  await queueEmail(tx, {
    template: 'review-decided',
    to: student.email,
    userId: student.id,
    idempotencyKey: `review-decided:${eventId}`,
    data: { decision, teacherNames, lineageName: row.lineageName, url: url('/dashboard/teachers'), ...(recipientNames.length > 0 ? { recipientNames } : {}) },
  });
}

/**
 * review.decide: verify, refuse (with the reason the claimant reads) or ask for more information
 * (needs_info, with the question) on a historical teacher claim (see the top of this file).
 */
export async function decideReviewCase(principal: Principal | null, raw: z.input<typeof reviewDecideInput>, meta: RequestMeta): Promise<ReviewResult> {
  const p = requireStaff2FA(principal);
  const parsed = reviewDecideInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const input = parsed.data;
  const db = getDb();
  // M11: a school listing is decided by school-review.ts (no relationship, no evidence).
  const [kindOf] = await db.select({ kind: reviewCase.kind }).from(reviewCase).where(eq(reviewCase.id, input.caseId));
  if (kindOf?.kind === 'school_listing') {
    const replayed = await decideSchoolListing(p, input, meta);
    return { case: await getReviewCase(p, { id: input.caseId }), replayed };
  }
  const admin = hasStaff2FA(p, ['admin']);
  const to = input.decision === 'verify' ? 'verified' : input.decision === 'reject' ? 'rejected' : 'under_review';
  const reason = input.decision === 'needs_info' ? 'needs_info' : 'review';
  try {
    const outcome = await db.transaction(async (tx) => {
      // 1. One verification at a time, everywhere (plan §6.3), as an approval.
      if (input.decision === 'verify') await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${VERIFY_LOCK}))`);
      const seen = await caseById(tx, input.caseId);
      if (!seen) throw notFound();
      if (seen.kind !== 'historical_claim' || !seen.relationshipId) throw new ServiceError('CONFLICT', 'Cases of this kind are decided from a later version of the review tool.');
      // 2. The relationship, then its case (the order relationships.withdraw takes them).
      const row = await rowById(tx, seen.relationshipId, true);
      const c = await caseById(tx, input.caseId, true);
      if (!row || !c) throw notFound();
      if (await replayReview(tx, p, input.idempotencyKey, row.id, { to, reason })) return { replayed: true, tags: [] as string[] };
      if (await ownSide(tx, p, c)) throw new ServiceError('FORBIDDEN', 'This claim is about you: another reviewer decides it.');
      if (input.decision !== 'needs_info' && !hasStaff2FA(p, DECIDE_ROLES)) {
        throw new ServiceError('FORBIDDEN', 'An archivist or an administrator verifies or refuses a historical claim.');
      }
      if (c.assignedToUserId !== p.user.id && !admin) throw new ServiceError('FORBIDDEN', 'Assign the case to yourself before you decide it.');
      if (!isOpen(c.status) || row.status !== 'under_review' || row.verificationPath !== 'committee_review') {
        throw new ServiceError('CONFLICT', row.status === 'withdrawn' ? 'The claimant has withdrawn this claim.' : 'This case has been decided or closed.');
      }
      const now = new Date();

      if (input.decision === 'needs_info') {
        await tx.update(reviewCase).set({ status: 'needs_info', updatedAt: now }).where(eq(reviewCase.id, c.id));
        await tx.insert(reviewNote).values({ reviewCaseId: c.id, authorUserId: p.user.id, body: input.reason!, isInternal: false, idempotencyKey: input.idempotencyKey });
        const eventId = await recordEvent(tx, { relationshipId: row.id, from: 'under_review', to: 'under_review', actor: p, role: p.user.role, reason, key: input.idempotencyKey });
        await writeAudit(tx, {
          action: 'review.needs_info',
          actorUserId: p.user.id,
          actorRole: p.user.role,
          subjectType: 'review_case',
          subjectId: c.id,
          before: { status: c.status },
          after: { status: 'needs_info', relationshipId: row.id },
          requestId: meta.requestId,
          ipHmac: meta.ipHmac,
        });
        await tellStudent(tx, row, 'needs_info', eventId);
        return { replayed: false, tags: [] as string[] };
      }

      // The files the decision rests on, for audit_log.evidence_ids.
      const basis = ((await filesOfCases(tx, [c.id])).get(c.id) ?? []).map((f) => f.id);

      if (input.decision === 'reject') {
        await tx.update(teachingRelationship).set({ status: 'rejected', statusReason: 'review', updatedAt: now }).where(eq(teachingRelationship.id, row.id));
        await tx
          .update(reviewCase)
          .set({ status: 'resolved', resolution: 'rejected', resolutionReason: input.reason, resolvedAt: now, updatedAt: now })
          .where(eq(reviewCase.id, c.id));
        const eventId = await recordEvent(tx, { relationshipId: row.id, from: 'under_review', to: 'rejected', actor: p, role: p.user.role, reason, key: input.idempotencyKey });
        await writeAudit(tx, {
          action: 'relationship.reject',
          actorUserId: p.user.id,
          actorRole: p.user.role,
          subjectType: 'teaching_relationship',
          subjectId: row.id,
          before: { status: 'under_review' },
          after: { status: 'rejected', verificationPath: 'committee_review', caseId: c.id },
          evidenceIds: basis,
          requestId: meta.requestId,
          ipHmac: meta.ipHmac,
        });
        await writeAudit(tx, {
          action: 'review.resolve',
          actorUserId: p.user.id,
          actorRole: p.user.role,
          subjectType: 'review_case',
          subjectId: c.id,
          before: { status: c.status },
          after: { status: 'resolved', resolution: 'rejected', relationshipId: row.id },
          requestId: meta.requestId,
          ipHmac: meta.ipHmac,
        });
        await tellStudent(tx, row, 'rejected', eventId);
        return { replayed: false, tags: [] as string[] };
      }

      // verify: 3. a removed profile, the cycle, self and duplicate checks, then the writes.
      const [removed] = await tx
        .select({ id: person.id })
        .from(person)
        .where(and(inArray(person.id, [row.teacherPersonId, row.studentPersonId]), sql`${person.deletedAt} IS NOT NULL`));
      if (removed) throw new ServiceError('CONFLICT', 'This claim can no longer be verified: a profile was removed.');
      if (await closesCycle(tx, row.teacherPersonId, row.studentPersonId)) throw new ServiceError('CONFLICT', CYCLE_MESSAGE);
      if (row.teacherPersonId === row.studentPersonId) throw new ServiceError('CONFLICT', 'A person can’t be their own teacher.');
      const [duplicate] = await tx
        .select({ id: teachingRelationship.id })
        .from(teachingRelationship)
        .where(
          and(
            eq(teachingRelationship.teacherPersonId, row.teacherPersonId),
            eq(teachingRelationship.studentPersonId, row.studentPersonId),
            eq(teachingRelationship.lineageId, row.lineageId),
            inArray(teachingRelationship.status, [...PUBLIC_RELATIONSHIP_STATUSES]),
            ne(teachingRelationship.id, row.id),
          ),
        );
      if (duplicate) throw new ServiceError('CONFLICT', 'This training is already confirmed in this lineage.');
      const verified = await markVerified(tx, row, p.user.id, now);
      await tx
        .update(reviewCase)
        .set({ status: 'resolved', resolution: 'approved', resolutionReason: input.reason, resolvedAt: now, updatedAt: now })
        .where(eq(reviewCase.id, c.id));
      const eventId = await recordEvent(tx, { relationshipId: row.id, from: 'under_review', to: 'verified', actor: p, role: p.user.role, reason, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.verify',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: row.id,
        before: { status: 'under_review', visibility: row.visibility, isDisplayPrimary: row.isDisplayPrimary },
        after: { status: 'verified', visibility: 'public', verificationPath: 'committee_review', caseId: c.id, ...verified, lineageId: row.lineageId },
        evidenceIds: basis,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await writeAudit(tx, {
        action: 'review.resolve',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'review_case',
        subjectId: c.id,
        before: { status: c.status },
        after: { status: 'resolved', resolution: 'approved', relationshipId: row.id },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellStudent(tx, row, 'verified', eventId);
      // The derived lineage_membership, from the worker (plan §6.3, §6.4), as for an approval.
      await enqueue(tx, QUEUE.lineageRecompute, { lineageIds: [row.lineageId] });
      return { replayed: false, tags: await publicTags(tx, row) };
    });
    if (outcome.tags.length > 0) invalidatePublic(outcome.tags, 'procedure');
    return { case: await getReviewCase(p, { id: input.caseId }), replayed: outcome.replayed };
  } catch (error) {
    if (isKeyConflict(error) || isNoteKeyConflict(error)) throw keyReused();
    throw error;
  }
}

function isNoteKeyConflict(error: unknown): boolean {
  const pg = pgErrorOf(error);
  return pg?.code === '23505' && pg.constraint === 'review_note_idempotency_key';
}

// --- review.note -------------------------------------------------------------------------------

/** review.note: an internal note on a case, for reviewers only (never shown to the parties). */
export async function addReviewNote(principal: Principal | null, raw: z.input<typeof reviewNoteInput>, meta: RequestMeta): Promise<ReviewResult> {
  const p = requireStaff2FA(principal);
  const parsed = reviewNoteInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const input = parsed.data;
  const db = getDb();
  try {
    const replayed = await db.transaction(async (tx) => {
      const c = await caseById(tx, input.caseId, true);
      if (!c) throw notFound();
      const [earlier] = await tx
        .select({ caseId: reviewNote.reviewCaseId, body: reviewNote.body })
        .from(reviewNote)
        .where(and(eq(reviewNote.authorUserId, p.user.id), eq(reviewNote.idempotencyKey, input.idempotencyKey)));
      if (earlier) {
        if (earlier.caseId !== c.id || earlier.body !== input.body) throw keyReused();
        return true;
      }
      if (await ownSide(tx, p, c)) throw new ServiceError('FORBIDDEN', 'This claim is about you: another reviewer handles it.');
      const [note] = await tx
        .insert(reviewNote)
        .values({ reviewCaseId: c.id, authorUserId: p.user.id, body: input.body, isInternal: true, idempotencyKey: input.idempotencyKey })
        .returning({ id: reviewNote.id });
      await tx.update(reviewCase).set({ updatedAt: new Date() }).where(eq(reviewCase.id, c.id));
      await writeAudit(tx, {
        action: 'review.note',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'review_case',
        subjectId: c.id,
        after: { noteId: note!.id, internal: true, length: input.body.length },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      return false;
    });
    return { case: await getReviewCase(p, { id: input.caseId }), replayed };
  } catch (error) {
    if (isNoteKeyConflict(error)) throw keyReused();
    throw error;
  }
}

// --- The archival edit (In scope 5, plan §6.6) --------------------------------------------------

export const archiveGetInput = z.object({ slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/, { error: 'No such record.' }) });

const optionalName = z
  .string()
  .max(NAME_MAX_LENGTH * 2)
  .transform((s) => cleanName(s))
  .nullish()
  .transform((s) => (s ? s : null));

export const archiveUpdateInput = z
  .object({
    personId: z.uuid({ error: 'No such record.' }),
    primaryName: z
      .string({ error: 'Enter the name in Latin letters.' })
      .max(NAME_MAX_LENGTH * 2)
      .transform((s) => cleanName(s)),
    originalName: optionalName,
    originalLang: z
      .string()
      .max(16)
      .nullish()
      .transform((s) => (s ? s : null)),
    lifeStatus: z.enum(['living', 'deceased', 'unknown'], { error: 'Choose a life status.' }),
    /** The English biography; empty removes it. */
    bio: z
      .string()
      .max(BIO_MAX_LENGTH * 2)
      .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
      .nullish()
      .transform((s) => (s ? s : null)),
    /** Required: why the record changes, kept in the audit row (plan §6.6). */
    reason: z
      .string({ error: 'Write the reason for this edit.' })
      .max(REVIEW_TEXT_MAX * 2)
      .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim()),
    /** Optional: files this archivist uploaded for the edit (never a claim's), linked to the record. */
    evidenceIds: z.array(z.uuid({ error: ARCHIVAL_EVIDENCE_MESSAGE })).max(20).default([]),
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!input.primaryName) issue('primaryName', 'Enter the name in Latin letters.');
    else if (input.primaryName.length > NAME_MAX_LENGTH) issue('primaryName', `Use at most ${NAME_MAX_LENGTH} characters.`);
    else if (!isLatinName(input.primaryName)) issue('primaryName', 'Use Latin letters here. Add the name in its own script below.');
    if (input.originalName) {
      const script = input.originalLang ? originalScript(input.originalLang) : undefined;
      if (!script) issue('originalLang', 'Choose the script of this name.');
      else if (input.originalName.length > NAME_MAX_LENGTH) issue('originalName', `Use at most ${NAME_MAX_LENGTH} characters.`);
      else if (!matchesScript(input.originalName, script.lang)) issue('originalName', `This name is not written in ${script.label}.`);
    }
    if (input.bio && input.bio.length > BIO_MAX_LENGTH) issue('bio', `Use at most ${BIO_MAX_LENGTH} characters.`);
    if (!input.reason) issue('reason', 'Write the reason for this edit.');
    else if (input.reason.length > REVIEW_TEXT_MAX) issue('reason', `Use at most ${REVIEW_TEXT_MAX} characters.`);
  });
export type ArchiveUpdateInput = z.input<typeof archiveUpdateInput>;

export interface ArchiveRecordView {
  id: string;
  slug: string;
  kind: string;
  lifeStatus: 'living' | 'deceased' | 'unknown';
  stewardship: 'self' | 'platform' | 'unclaimed';
  visibility: 'public' | 'involved_only';
  primaryName: string;
  original: { value: string; lang: string } | null;
  bio: string | null;
  files: EvidenceFileView[];
  /** Whether this reviewer may edit it, and why not. */
  editable: boolean;
  refusal: string | null;
  scripts: { lang: string; label: string }[];
}

const SELF_KEPT = 'This record is kept by its owner. Only records kept by the platform or unclaimed are edited here.';
const ARCHIVIST_ONLY = 'Only an archivist edits archival records.';

async function recordOf(db: Executor, where: SQL, lock = false) {
  const query = db
    .select({ id: person.id, slug: person.slug, kind: person.kind, lifeStatus: person.lifeStatus, stewardship: person.stewardship, visibility: person.visibility })
    .from(person)
    .where(and(where, isNull(person.deletedAt)));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

async function namesAndBio(db: Executor, personId: string) {
  const names = await db
    .select({ id: personName.id, kind: personName.kind, value: personName.value, script: personName.script, lang: personName.lang, isPrimary: personName.isPrimary, sortOrder: personName.sortOrder })
    .from(personName)
    .where(eq(personName.personId, personId))
    .orderBy(asc(personName.sortOrder), asc(personName.id));
  const [bio] = await db.select({ id: personBio.id, body: personBio.body }).from(personBio).where(and(eq(personBio.personId, personId), eq(personBio.lang, 'en')));
  return { names, primary: names.find((n) => n.isPrimary) ?? null, original: names.find((n) => !n.isPrimary && n.kind === 'name') ?? null, bio: bio ?? null };
}

/** archive.get: a record for the archival edit, for any reviewer (only an archivist may save). */
export async function getArchiveRecord(principal: Principal | null, raw: z.input<typeof archiveGetInput>): Promise<ArchiveRecordView> {
  const p = requireStaff2FA(principal);
  const parsed = archiveGetInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such record.');
  const db = getDb();
  const record = await recordOf(db, eq(person.slug, parsed.data.slug));
  if (!record) throw new ServiceError('NOT_FOUND', 'No such record.');
  const { primary, original, bio } = await namesAndBio(db, record.id);
  const archivist = hasStaff2FA(p, ARCHIVE_ROLES);
  const kept = record.stewardship !== 'self';
  const files = await filesOfPerson(db, record.id);
  // The download's own rule (evidence.ts accessOfFiles): the archivist who uploaded a file and the
  // administrators open it, and only they see its link and its name.
  const opens = await openableFiles(db, p, files.map((f) => f.id));
  return {
    ...record,
    primaryName: primary?.value ?? '',
    original: original ? { value: original.value, lang: original.lang } : null,
    bio: bio?.body ?? null,
    files: files.map((f) => fileView(f, opens.has(f.id))),
    editable: archivist && kept,
    refusal: !kept ? SELF_KEPT : !archivist ? ARCHIVIST_ONLY : null,
    scripts: ORIGINAL_SCRIPTS.map((s) => ({ lang: s.lang, label: s.label })),
  };
}

export interface ArchiveUpdateResult {
  record: ArchiveRecordView;
  /** False when the edit changed nothing (nothing was written). */
  changed: boolean;
}

/**
 * archive.update: an archivist corrects a record kept by the platform or unclaimed (plan §6.6):
 * the Latin-script display name, the name in its own script, the life status and the English
 * biography. The reason is required; evidence is optional. One audit row person.update with the
 * reason and evidence_ids (names and the biography are never copied into it, plan §6.4). An edit
 * that changes nothing writes nothing, so a repeated submit is harmless.
 */
export async function updateArchiveRecord(principal: Principal | null, raw: ArchiveUpdateInput, meta: RequestMeta): Promise<ArchiveUpdateResult> {
  const p = requireStaff2FA(principal);
  // Who first: a moderator or an administrator is refused before the input is judged.
  if (!hasStaff2FA(p, ARCHIVE_ROLES)) throw new ServiceError('FORBIDDEN', ARCHIVIST_ONLY);
  const parsed = archiveUpdateInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const input = parsed.data;
  const db = getDb();
  const outcome = await db.transaction(async (tx) => {
    const record = await recordOf(tx, eq(person.id, input.personId), true);
    if (!record) throw new ServiceError('NOT_FOUND', 'No such record.');
    if (record.stewardship === 'self') throw new ServiceError('FORBIDDEN', SELF_KEPT);
    const { names, primary, original, bio } = await namesAndBio(tx, record.id);
    const script = input.originalName && input.originalLang ? originalScript(input.originalLang)! : null;
    const nameChanged = primary?.value !== input.primaryName;
    const originalChanged = (original?.value ?? null) !== input.originalName || (input.originalName !== null && original?.lang !== input.originalLang);
    const lifeChanged = record.lifeStatus !== input.lifeStatus;
    const bioChanged = (bio?.body ?? null) !== input.bio;
    const linked = new Set(
      (await tx.select({ id: evidenceLink.evidenceFileId }).from(evidenceLink).where(eq(evidenceLink.personId, record.id))).map((r) => r.id),
    );
    const freshEvidence = [...new Set(input.evidenceIds)].filter((id) => !linked.has(id));
    if (!nameChanged && !originalChanged && !lifeChanged && !bioChanged && freshEvidence.length === 0) return { id: record.id, slug: record.slug, changed: false, tags: [] as string[] };

    const evidenceError = await linkFilesToPerson(tx, p, record.id, input.evidenceIds);
    if (evidenceError) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { evidenceIds: evidenceError });
    const now = new Date();
    if (nameChanged) {
      if (primary) await tx.update(personName).set({ value: input.primaryName, updatedAt: now }).where(eq(personName.id, primary.id));
      else await tx.insert(personName).values({ personId: record.id, kind: 'name', value: input.primaryName, script: 'Latn', lang: 'und-Latn', isPrimary: true, sortOrder: 0 });
    }
    if (originalChanged) {
      if (original && script && input.originalName) {
        await tx.update(personName).set({ value: input.originalName, script: script.script, lang: script.lang, updatedAt: now }).where(eq(personName.id, original.id));
      } else if (original) {
        await tx.delete(personName).where(eq(personName.id, original.id));
      } else if (script && input.originalName) {
        await tx.insert(personName).values({ personId: record.id, kind: 'name', value: input.originalName, script: script.script, lang: script.lang, sortOrder: Math.max(1, ...names.map((n) => n.sortOrder + 1)) });
      }
    }
    const keys = nameChanged || originalChanged ? await writePersonKeys(tx, record.id) : null;
    if (lifeChanged) await tx.update(person).set({ lifeStatus: input.lifeStatus, updatedAt: now }).where(eq(person.id, record.id));
    if (bioChanged) {
      if (bio && input.bio) await tx.update(personBio).set({ body: input.bio, updatedAt: now }).where(eq(personBio.id, bio.id));
      else if (bio) await tx.delete(personBio).where(eq(personBio.id, bio.id));
      else if (input.bio) await tx.insert(personBio).values({ personId: record.id, lang: 'en', body: input.bio });
    }
    await tx.update(person).set({ updatedAt: now }).where(eq(person.id, record.id));
    // Which fields changed, and on what basis: never a name or the biography (plan §6.4).
    await writeAudit(tx, {
      action: 'person.update',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: record.id,
      before: { lifeStatus: record.lifeStatus, stewardship: record.stewardship, original: original ? { lang: original.lang } : null, bio: bio ? { lang: 'en' } : null },
      after: {
        archival: true,
        changed: { primaryName: nameChanged, originalName: originalChanged, lifeStatus: lifeChanged, bio: bioChanged },
        lifeStatus: input.lifeStatus,
        original: input.originalName && script ? { lang: script.lang } : null,
        bio: input.bio ? { lang: 'en', length: input.bio.length } : null,
        ...(keys !== null ? { searchKeys: keys } : {}),
        evidence_ids: [...new Set(input.evidenceIds)],
      },
      reason: input.reason,
      // The column of plan §6.6 (M10a review, requirements-1), not only the copy in `after`.
      evidenceIds: input.evidenceIds,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { id: record.id, slug: record.slug, changed: true, tags: await neighbourTags(tx, record.id) };
  });
  if (outcome.tags.length > 0) invalidatePublic(outcome.tags, 'procedure');
  return { record: await getArchiveRecord(p, { slug: outcome.slug }), changed: outcome.changed };
}
