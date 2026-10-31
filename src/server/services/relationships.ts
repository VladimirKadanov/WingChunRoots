// Teacher requests and independent approvals (milestone M09; plan §5.6, §6.3, §6.7). A student
// names a teacher and the training periods; only that teacher approves or declines, each request on
// its own (one student can have several teachers, each verified independently).
//
//   request   (student)  → pending_teacher, involved_only (DEFAULT D03)
//   approve   (teacher)  pending_teacher → verified, public; both people public
//   reject    (teacher)  pending_teacher → rejected, with a neutral reason
//   resubmit  (student)  rejected → pending_teacher, with corrected periods or lineage
//   withdraw  (student)  pending_teacher | rejected → withdrawn
//   end       (student or teacher)  verified: the training ended; the link stays, historical
//
// DEFAULT (milestone stop-and-ask): the student proposes and the teacher approves or declines with
// a reason; the teacher never edits the periods. A declined request is corrected and sent again by
// the student (docs/adr/0011-teacher-requests.md).
//
// Every transition writes a relationship_event and an audit_log row in its own transaction, with the
// notification rows and the queued e-mails, so all of it commits or none does. Every mutation takes
// an idempotency key (plan §5.6): the same key from the same account replays the stored outcome and
// changes nothing (a double click, a retried request).
//
// Approval order (plan §6.3), in one READ COMMITTED transaction:
//   1. pg_advisory_xact_lock(hashtext('teaching_relationship.verify')): one approval at a time;
//   2. requireEntitlement through withQuota (DEFAULT D06: Free Sifu approves up to 5 students);
//   3. the cycle check on teaching_relationship over verified and in_arbitration, whatever their
//      visibility (never v_public_edge: a hidden edge still closes a cycle);
//   4. the duplicate and self checks; then the writes.
// After the commit the public cache of both people, their neighbours, every teacher above them and
// the explorer's start list is dropped, and a lineage.recompute job recomputes lineage_membership
// and drops the cache once more from the worker (POST /api/internal/revalidate).
//
// Who may do what (the authorization matrix, relationships.int.test.ts):
//   - a person not involved and not a reviewer: 404, the same answer as for no such request (plan §6.4);
//   - reviewers (staff whose session proved the second factor) read every request, act on none (403);
//   - the student cannot answer their own request (403), the teacher cannot withdraw or resubmit it (403).
// Logs and audit rows carry ids and codes, never a name (plan §6.4).

import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import * as z from 'zod';

import { atPrecision, coarser, EARLIEST_TRAINING_YEAR, formatPartialDate, type PartialDate, parsePartialDate, todayUtc, toPrefix } from '../../lib/partial-date';
import { writeAudit } from '../audit';
import { appUrl } from '../auth/env';
import { hasStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic } from '../cache';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import {
  authUser,
  lineage,
  notification,
  person,
  personName,
  place,
  relationshipEvent,
  school,
  teachingRelationship,
  trainingPeriod,
} from '../db/schema';
import { PUBLIC_RELATIONSHIP_STATUSES, type RELATIONSHIP_STATUSES } from '../db/schema/common';
import { effectivePlan, type Executor } from '../entitlements/access';
import { withQuota } from '../entitlements/quota';
import { enqueue, queueEmail, type Transaction } from '../jobs/outbox';
import { QUEUE } from '../jobs/queues';
import type { NameData } from '../templates/email/types';
import { REJECTION_REASON_CODES, type RejectionReason, rejectionReasonText, isRejectionReason } from '../templates/relationships';
import type { RequestMeta } from './context';
import { approvalOffer, peopleRefs, type PersonRef, type UpgradeOffer, waitingRequests } from './dashboard';
import { pgErrorOf, ServiceError } from './errors';
import { planSummary } from './plans';
import { neighbourTags } from './profile';

export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];
export type RelationshipRole = 'student' | 'teacher' | 'reviewer';
type Precision = 'year' | 'month' | 'day' | 'unknown';

/** The global lock of every approval (plan §6.3); hashtext() gives an int4 key, apart from withQuota's 64-bit keys. */
export const VERIFY_LOCK = 'teaching_relationship.verify';
/** The int4 namespace of the per-student request lock: pg_advisory_xact_lock(REQUEST_LOCK_SPACE, hashtext(student)). */
const REQUEST_LOCK_SPACE = 9;
/** At most this many requests of one student wait for an answer at once (a limit against floods). */
export const MAX_PENDING_REQUESTS = 20;
export const MAX_PERIODS = 5;
/** A bound on the teachers above one person the cycle check walks: it only stops bad data. */
const CYCLE_WALK_CAP = 10_000;

// --- Input -------------------------------------------------------------------------------------

const idempotencyKey = z
  .string({ error: 'Send a request key.' })
  .regex(/^[A-Za-z0-9_-]{8,64}$/, { error: 'Send a request key of 8 to 64 letters, digits, - or _.' });

/** A date as remembered: "YYYY", "YYYY-MM" or "YYYY-MM-DD"; empty or null when not given. */
const partialDate = z
  .string()
  .trim()
  .max(10, { error: 'Write the year, the year and month, or the full date.' })
  .nullish()
  .transform((v) => (v ? v : null));

export const periodInput = z.object({
  from: partialDate,
  to: partialDate,
  ongoing: z.boolean().default(false),
  schoolId: z.uuid({ error: 'Choose a school from the list.' }).nullish(),
});
export type PeriodInput = z.input<typeof periodInput>;

const periods = z
  .array(periodInput, { error: 'Add at least one training period.' })
  .min(1, { error: 'Add at least one training period.' })
  .max(MAX_PERIODS, { error: `Add at most ${MAX_PERIODS} training periods.` });

export const requestInput = z.object({
  teacherId: z.uuid({ error: 'Choose your teacher from the search.' }),
  /** Optional: when left out, the lineage of the teacher's own primary line (see lineageFor). */
  lineageId: z.uuid({ error: 'Choose a lineage from the list.' }).nullish(),
  periods,
  /** DEFAULT D05: the student's wish that this teacher be drawn as the primary line; visual only. */
  displayPrimary: z.boolean().default(false),
  idempotencyKey,
});
export type RequestInput = z.input<typeof requestInput>;

export const resubmitInput = z.object({
  relationshipId: z.uuid({ error: 'Choose a request.' }),
  /** Left out: the request keeps its lineage; null: the teacher's own, as for a request (lineageFor). */
  lineageId: z.uuid({ error: 'Choose a lineage from the list.' }).nullish(),
  periods,
  displayPrimary: z.boolean().default(false),
  idempotencyKey,
});

export const relationshipActionInput = z.object({
  relationshipId: z.uuid({ error: 'Choose a request.' }),
  idempotencyKey,
});

export const rejectInput = relationshipActionInput.extend({
  reason: z.enum(REJECTION_REASON_CODES as [RejectionReason, ...RejectionReason[]], { error: 'Choose a reason.' }),
});

export const endInput = relationshipActionInput.extend({
  /** When the training ended: "YYYY", "YYYY-MM" or "YYYY-MM-DD". */
  endedOn: z.string({ error: 'Give the year the training ended.' }).trim().min(1, { error: 'Give the year the training ended.' }).max(10),
});

export const relationshipIdInput = z.object({ id: z.uuid({ error: 'No such request.' }) });

// --- Views -------------------------------------------------------------------------------------

export interface RelationshipPeriodView {
  /** ISO prefix by precision ("1985", "1992-02", "1992-02-03"), null when not recorded. */
  from: string | null;
  to: string | null;
  ongoing: boolean;
  precision: Precision;
  school: { id: string; name: string } | null;
}

export interface RelationshipView {
  id: string;
  status: RelationshipStatus;
  statusLabel: string;
  /** The viewer's side of the relationship. */
  viewerRole: RelationshipRole;
  teacher: PersonRef;
  student: PersonRef;
  lineage: { id: string; slug: string; name: string };
  periods: RelationshipPeriodView[];
  /** "April 2019": the earliest recorded start, or null. */
  trainingStart: string | null;
  /** Every period has ended: the link stays, as historical. */
  historical: boolean;
  visibility: 'public' | 'involved_only';
  prefersDisplayPrimary: boolean;
  isDisplayPrimary: boolean;
  /** The neutral reason of a declined request. */
  rejection: { reason: RejectionReason; text: string } | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  /** What the viewer may do now. */
  can: { approve: boolean; reject: boolean; withdraw: boolean; resubmit: boolean; end: boolean };
}

export interface RelationshipResult {
  relationship: RelationshipView;
  /** True when the idempotency key had been used already: nothing changed. */
  replayed: boolean;
}

interface Viewer {
  userId: string;
  personId: string | null;
  /** Staff whose session proved the second factor: reviewers (plan §3.2, DEFAULT D03). */
  reviewer: boolean;
}

interface RelRow {
  id: string;
  teacherPersonId: string;
  studentPersonId: string;
  lineageId: string;
  lineageSlug: string;
  lineageName: string;
  status: RelationshipStatus;
  visibility: 'public' | 'involved_only';
  isDisplayPrimary: boolean;
  prefersDisplayPrimary: boolean;
  statusReason: string | null;
  requestedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
}

const relColumns = {
  id: teachingRelationship.id,
  teacherPersonId: teachingRelationship.teacherPersonId,
  studentPersonId: teachingRelationship.studentPersonId,
  lineageId: teachingRelationship.lineageId,
  lineageSlug: lineage.slug,
  lineageName: lineage.name,
  status: teachingRelationship.status,
  visibility: teachingRelationship.visibility,
  isDisplayPrimary: teachingRelationship.isDisplayPrimary,
  prefersDisplayPrimary: teachingRelationship.prefersDisplayPrimary,
  statusReason: teachingRelationship.statusReason,
  requestedByUserId: teachingRelationship.requestedByUserId,
  createdAt: teachingRelationship.createdAt,
  updatedAt: teachingRelationship.updatedAt,
  confirmedAt: teachingRelationship.confirmedAt,
};

const STATUS_LABELS: Record<RelationshipStatus, string> = {
  pending_teacher: 'Waiting for the teacher',
  awaiting_claim: 'Waiting for the teacher to join',
  under_review: 'Under review',
  verified: 'Verified',
  rejected: 'Not confirmed',
  withdrawn: 'Withdrawn',
  in_arbitration: 'In arbitration',
  revoked: 'Revoked',
};

function roleOf(row: Pick<RelRow, 'teacherPersonId' | 'studentPersonId'>, viewer: Viewer): RelationshipRole | null {
  if (viewer.personId !== null && row.teacherPersonId === viewer.personId) return 'teacher';
  if (viewer.personId !== null && row.studentPersonId === viewer.personId) return 'student';
  return viewer.reviewer ? 'reviewer' : null;
}

function prefix(date: string | null, precision: Precision): string | null {
  if (!date || precision === 'unknown') return null;
  return toPrefix(date, precision);
}

async function periodsOf(db: Executor, ids: string[]): Promise<Map<string, RelationshipPeriodView[]>> {
  const out = new Map<string, RelationshipPeriodView[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      relationshipId: trainingPeriod.relationshipId,
      startsOn: trainingPeriod.startsOn,
      endsOn: trainingPeriod.endsOn,
      precision: trainingPeriod.precision,
      ongoing: trainingPeriod.ongoing,
      schoolId: school.id,
      schoolName: school.name,
    })
    .from(trainingPeriod)
    // Only a school that is still listed is named; never its point (plan §6.4).
    .leftJoin(school, and(eq(school.id, trainingPeriod.schoolId), isNull(school.deletedAt)))
    .where(inArray(trainingPeriod.relationshipId, ids))
    .orderBy(asc(trainingPeriod.sortOrder), sql`${trainingPeriod.startsOn} NULLS FIRST`, asc(trainingPeriod.id));
  for (const r of rows) {
    const list = out.get(r.relationshipId) ?? [];
    list.push({
      from: prefix(r.startsOn, r.precision),
      to: prefix(r.endsOn, r.precision),
      ongoing: r.ongoing,
      precision: r.precision,
      school: r.schoolId && r.schoolName ? { id: r.schoolId, name: r.schoolName } : null,
    });
    out.set(r.relationshipId, list);
  }
  return out;
}

const isHistorical = (periods: readonly RelationshipPeriodView[]) =>
  periods.length > 0 && periods.every((p) => !p.ongoing) && periods.some((p) => p.to !== null);

const hasOngoing = (periods: readonly RelationshipPeriodView[]) => periods.length === 0 || periods.some((p) => p.ongoing);

function earliestStart(periods: readonly RelationshipPeriodView[]): string | null {
  const starts = periods.map((p) => p.from).filter((f): f is string => f !== null);
  if (starts.length === 0) return null;
  // Prefixes of one calendar compare as text once padded to a day.
  const first = starts.reduce((a, b) => (`${a}-01-01`.slice(0, 10) <= `${b}-01-01`.slice(0, 10) ? a : b));
  return formatPartialDate(first);
}

async function toViews(db: Executor, rows: RelRow[], viewer: Viewer): Promise<RelationshipView[]> {
  const visible = rows.map((row) => ({ row, role: roleOf(row, viewer) })).filter((v): v is { row: RelRow; role: RelationshipRole } => v.role !== null);
  if (visible.length === 0) return [];
  const periods = await periodsOf(db, visible.map((v) => v.row.id));
  const refs = await peopleRefs([...new Set(visible.flatMap((v) => [v.row.teacherPersonId, v.row.studentPersonId]))]);
  return visible.map(({ row, role }) => {
    const own = periods.get(row.id) ?? [];
    const established = row.status === 'verified' || row.status === 'in_arbitration';
    const historical = established && isHistorical(own);
    const reason = row.status === 'rejected' && isRejectionReason(row.statusReason) ? row.statusReason : row.status === 'rejected' ? 'details' : null;
    return {
      id: row.id,
      status: row.status,
      statusLabel: historical ? 'Verified · training ended' : STATUS_LABELS[row.status],
      viewerRole: role,
      teacher: refs.get(row.teacherPersonId)!,
      student: refs.get(row.studentPersonId)!,
      lineage: { id: row.lineageId, slug: row.lineageSlug, name: row.lineageName },
      periods: own,
      trainingStart: earliestStart(own),
      historical,
      visibility: row.visibility,
      prefersDisplayPrimary: row.prefersDisplayPrimary,
      isDisplayPrimary: row.isDisplayPrimary,
      rejection: reason ? { reason, text: rejectionReasonText(reason) } : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      can: {
        approve: role === 'teacher' && row.status === 'pending_teacher',
        reject: role === 'teacher' && row.status === 'pending_teacher',
        withdraw: role === 'student' && (row.status === 'pending_teacher' || row.status === 'rejected'),
        resubmit: role === 'student' && row.status === 'rejected',
        end: (role === 'teacher' || role === 'student') && established && hasOngoing(own),
      },
    };
  });
}

async function viewerOf(db: Executor, p: Principal): Promise<Viewer> {
  const [own] = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
  return { userId: p.user.id, personId: own?.id ?? null, reviewer: hasStaff2FA(p) };
}

async function rowById(db: Executor, id: string, lock = false): Promise<RelRow | null> {
  const query = db
    .select(relColumns)
    .from(teachingRelationship)
    .innerJoin(lineage, eq(lineage.id, teachingRelationship.lineageId))
    .where(eq(teachingRelationship.id, id));
  const [row] = lock ? await query.for('update', { of: teachingRelationship }) : await query;
  return row ?? null;
}

async function viewOf(db: Executor, id: string, viewer: Viewer): Promise<RelationshipView> {
  const row = await rowById(db, id);
  const [view] = row ? await toViews(db, [row], viewer) : [];
  if (!view) throw notFound();
  return view;
}

/** One answer for a request that does not exist and one the viewer may not see (plan §6.4). */
function notFound(): ServiceError {
  return new ServiceError('NOT_FOUND', 'No such request.');
}

// --- Reads -------------------------------------------------------------------------------------

/** relationships.get: one relationship, for its student, its teacher or a reviewer; 404 for anyone else. */
export async function getRelationship(principal: Principal | null, input: z.input<typeof relationshipIdInput>): Promise<RelationshipView> {
  const p = requireUser(principal);
  const parsed = relationshipIdInput.safeParse(input);
  if (!parsed.success) throw notFound();
  const db = getDb();
  return viewOf(db, parsed.data.id, await viewerOf(db, p));
}

export interface MyTeachers {
  hasProfile: boolean;
  /** Established links (verified, in arbitration), the current before the historical. */
  teachers: RelationshipView[];
  /** Requests waiting for a teacher or declined (to correct and send again). */
  requests: RelationshipView[];
}

/** relationships.mine: the signed-in account's own teachers and requests (as the student). */
export async function myTeachers(principal: Principal | null): Promise<MyTeachers> {
  const p = requireUser(principal);
  const db = getDb();
  const viewer = await viewerOf(db, p);
  if (!viewer.personId) return { hasProfile: false, teachers: [], requests: [] };
  const rows = await db
    .select(relColumns)
    .from(teachingRelationship)
    .innerJoin(lineage, eq(lineage.id, teachingRelationship.lineageId))
    .where(
      and(
        eq(teachingRelationship.studentPersonId, viewer.personId),
        inArray(teachingRelationship.status, ['pending_teacher', 'awaiting_claim', 'under_review', 'rejected', 'verified', 'in_arbitration']),
      ),
    )
    .orderBy(desc(teachingRelationship.createdAt), desc(teachingRelationship.id))
    .limit(100);
  const views = await toViews(db, rows, { ...viewer, reviewer: false });
  const teachers = views
    .filter((v) => v.status === 'verified' || v.status === 'in_arbitration')
    .sort((a, b) => Number(a.historical) - Number(b.historical) || a.teacher.name.value.localeCompare(b.teacher.name.value, 'en'));
  return { hasProfile: true, teachers, requests: views.filter((v) => v.status !== 'verified' && v.status !== 'in_arbitration') };
}

export interface StudentRequests {
  hasProfile: boolean;
  /** Requests waiting for this teacher, oldest first. */
  requests: RelationshipView[];
  /** Established students, the current before the historical. */
  students: RelationshipView[];
  allowance: { approved: number; limit: number | null; planName: string };
  /** A Student account's plan approves no one: the page says how to switch to Sifu. */
  accountType: 'student' | 'sifu';
  /** Only at a real limit, where a request waits because of it (plan §5.6). */
  upgrade: UpgradeOffer | null;
}

/** relationships.incoming: the requests waiting for the signed-in teacher, their students and the allowance. */
export async function studentRequests(principal: Principal | null): Promise<StudentRequests> {
  const p = requireUser(principal);
  const db = getDb();
  const viewer = await viewerOf(db, p);
  const offer = await approvalOffer(db, p.user.id, viewer.personId ? await waitingRequests(db, viewer.personId) : 0);
  const plan = await effectivePlan({ kind: 'user', userId: p.user.id }, { db });
  const allowance = { approved: offer.approved, limit: offer.limit, planName: planSummary(plan.plan).name };
  const accountType = plan.accountType;
  if (!viewer.personId) return { hasProfile: false, requests: [], students: [], allowance, accountType, upgrade: null };
  const rows = await db
    .select(relColumns)
    .from(teachingRelationship)
    .innerJoin(lineage, eq(lineage.id, teachingRelationship.lineageId))
    .innerJoin(person, and(eq(person.id, teachingRelationship.studentPersonId), isNull(person.deletedAt)))
    .where(
      and(
        eq(teachingRelationship.teacherPersonId, viewer.personId),
        inArray(teachingRelationship.status, ['pending_teacher', 'verified', 'in_arbitration']),
      ),
    )
    .orderBy(asc(teachingRelationship.createdAt), asc(teachingRelationship.id))
    .limit(200);
  const views = await toViews(db, rows, { ...viewer, reviewer: false });
  const students = views
    .filter((v) => v.status !== 'pending_teacher')
    .sort((a, b) => Number(a.historical) - Number(b.historical) || a.student.name.value.localeCompare(b.student.name.value, 'en'));
  return { hasProfile: true, requests: views.filter((v) => v.status === 'pending_teacher'), students, allowance, accountType, upgrade: offer.upgrade };
}

export interface RequestOptions {
  /** Every lineage on record, by name. */
  lineages: { id: string; slug: string; name: string }[];
  /** Published schools, by name: city level only (plan §6.4). */
  schools: { id: string; name: string; city: string; countryCode: string }[];
  /** The earliest year a period may start. */
  earliestYear: number;
  maxPeriods: number;
}

/** relationships.options: what the request form offers. */
export async function requestOptions(principal: Principal | null): Promise<RequestOptions> {
  requireUser(principal);
  const db = getDb();
  const lineages = await db
    .select({ id: lineage.id, slug: lineage.slug, name: lineage.name })
    .from(lineage)
    .where(isNull(lineage.deletedAt))
    .orderBy(asc(lineage.name), asc(lineage.id))
    .limit(500);
  const schools = await db
    .select({ id: school.id, name: school.name, city: place.name, countryCode: place.countryCode })
    .from(school)
    .innerJoin(place, eq(place.id, school.placeId))
    .where(and(eq(school.status, 'published'), isNull(school.deletedAt)))
    .orderBy(asc(school.name), asc(school.id))
    .limit(500);
  return { lineages, schools, earliestYear: EARLIEST_TRAINING_YEAR, maxPeriods: MAX_PERIODS };
}

// --- Shared checks -----------------------------------------------------------------------------

interface PeriodRow {
  startsOn: string | null;
  endsOn: string | null;
  precision: Precision;
  ongoing: boolean;
  schoolId: string | null;
  sortOrder: number;
}

function parseDate(value: string | null): PartialDate | null | 'bad' {
  if (value === null) return null;
  return parsePartialDate(value) ?? 'bad';
}

/**
 * The training periods as rows, or field errors keyed `periods.<i>.from|to|schoolId`. A period has
 * a start (a year, a month or a day) and either an end or "ongoing"; both ends keep the coarser of
 * their precisions. No date before EARLIEST_TRAINING_YEAR or after today (UTC).
 */
export async function checkPeriods(db: Executor, input: z.output<typeof periods>, today = todayUtc()): Promise<{ rows: PeriodRow[]; fields: Record<string, string> }> {
  const fields: Record<string, string> = {};
  const rows: PeriodRow[] = [];
  const schoolIds = [...new Set(input.map((p) => p.schoolId).filter((id): id is string => Boolean(id)))];
  const listed = new Set(
    schoolIds.length === 0
      ? []
      : (
          await db
            .select({ id: school.id })
            .from(school)
            .where(and(inArray(school.id, schoolIds), eq(school.status, 'published'), isNull(school.deletedAt)))
        ).map((s) => s.id),
  );
  input.forEach((period, i) => {
    const key = (field: string) => `periods.${i}.${field}`;
    const from = parseDate(period.from);
    const to = parseDate(period.to);
    if (from === null) fields[key('from')] = 'Give the year you started (and the month, if you know it).';
    else if (from === 'bad') fields[key('from')] = 'Write the start as a year (2019), a month (2019-04) or a date (2019-04-12).';
    else if (Number(from.firstDay.slice(0, 4)) < EARLIEST_TRAINING_YEAR) fields[key('from')] = `The start can't be before ${EARLIEST_TRAINING_YEAR}.`;
    else if (from.firstDay > today) fields[key('from')] = "The start can't be in the future.";
    if (period.ongoing && to !== null) fields[key('to')] = 'Leave the end empty for training that goes on.';
    else if (!period.ongoing && to === null) fields[key('to')] = 'Give the year the training ended, or mark it as ongoing.';
    else if (to === 'bad') fields[key('to')] = 'Write the end as a year (2021), a month (2021-06) or a date (2021-06-30).';
    else if (to !== null && to.firstDay > today) fields[key('to')] = "The end can't be in the future.";
    if (period.schoolId && !listed.has(period.schoolId)) fields[key('schoolId')] = 'Choose a school from the list.';
    if (from === null || from === 'bad' || to === 'bad' || fields[key('from')] || fields[key('to')]) return;
    const precision = to ? coarser(from.precision, to.precision) : from.precision;
    const start = atPrecision(from, precision);
    const end = to ? atPrecision(to, precision) : null;
    if (end && end.firstDay < start.firstDay) {
      fields[key('to')] = "The end can't be before the start.";
      return;
    }
    rows.push({ startsOn: start.firstDay, endsOn: end?.firstDay ?? null, precision, ongoing: period.ongoing, schoolId: period.schoolId ?? null, sortOrder: i });
  });
  return { rows, fields };
}

/**
 * Whether the edge teacher → student would close a cycle: the student is already the teacher's
 * teacher, directly or further up, over established relationships (verified, in arbitration) of
 * any lineage and any visibility. Read from the base table, never v_public_edge (plan §6.3).
 */
export async function closesCycle(db: Executor, teacherId: string, studentId: string): Promise<boolean> {
  const result = await db.execute<{ cycle: boolean }>(sql`
WITH RECURSIVE up(id) AS (
  SELECT ${teacherId}::uuid
  UNION
  SELECT tr.teacher_person_id
    FROM up JOIN teaching_relationship tr ON tr.student_person_id = up.id
   WHERE tr.status IN ('verified', 'in_arbitration')
)
SELECT EXISTS (SELECT 1 FROM (SELECT id FROM up LIMIT ${CYCLE_WALK_CAP}) a WHERE a.id = ${studentId}::uuid) AS cycle`);
  return result.rows[0]?.cycle === true;
}

const CYCLE_MESSAGE =
  'This would create a cycle: this teacher is already recorded below you in the lineage, as your student or your student’s student. A person can’t be their own teacher’s teacher.';

/**
 * The lineage of a request that names none: the lineage of the teacher's own primary public line,
 * else of any public link of theirs, else a lineage the teacher founded. A default with no D number
 * (docs/adr/0011-teacher-requests.md); null when none fits, and the form asks for one.
 */
async function lineageFor(db: Executor, teacherId: string): Promise<string | null> {
  const result = await db.execute<{ id: string }>(sql`
SELECT id::text AS id FROM (
  (SELECT e.lineage_id AS id, 0 AS rank, e.is_display_primary AS primary_line, e.created_at
     FROM v_public_edge e WHERE e.student_person_id = ${teacherId}::uuid)
  UNION ALL
  (SELECT e.lineage_id, 1, false, e.created_at FROM v_public_edge e WHERE e.teacher_person_id = ${teacherId}::uuid)
  UNION ALL
  (SELECT l.id, 2, false, l.created_at FROM lineage l WHERE l.root_person_id = ${teacherId}::uuid AND l.deleted_at IS NULL)
) c
ORDER BY rank, primary_line DESC, created_at, id
LIMIT 1`);
  return result.rows[0]?.id ?? null;
}

/** A lineage that exists (not deleted), or null. */
async function lineageExists(db: Executor, id: string): Promise<boolean> {
  const [row] = await db.select({ id: lineage.id }).from(lineage).where(and(eq(lineage.id, id), isNull(lineage.deletedAt)));
  return Boolean(row);
}

/** The event an idempotency key already recorded for this account, if any. */
async function replayOf(db: Executor, userId: string, key: string) {
  const [row] = await db
    .select({ relationshipId: relationshipEvent.relationshipId, fromStatus: relationshipEvent.fromStatus, toStatus: relationshipEvent.toStatus, reason: relationshipEvent.reason })
    .from(relationshipEvent)
    .where(and(eq(relationshipEvent.actorUserId, userId), eq(relationshipEvent.idempotencyKey, key)));
  return row ?? null;
}

function keyReused(): ServiceError {
  return new ServiceError('CONFLICT', 'This request key was already used for another change. Reload the page and try again.');
}

/** The person's names for an e-mail: the Latin-script display name, then the first name in its own script. */
async function namesFor(db: Executor, personId: string): Promise<NameData[]> {
  const rows = await db
    .select({ value: personName.value, lang: personName.lang, kind: personName.kind, isPrimary: personName.isPrimary })
    .from(personName)
    .where(eq(personName.personId, personId))
    .orderBy(desc(personName.isPrimary), asc(personName.sortOrder), asc(personName.id));
  const primary = rows.find((r) => r.isPrimary);
  const original = rows.find((r) => !r.isPrimary && r.kind === 'name');
  return [primary, original].filter((r): r is NonNullable<typeof r> => Boolean(r)).map((r) => ({ value: r.value, lang: r.lang }));
}

/** The account behind a person (the claimed owner), for notifications and e-mail. */
async function accountOf(db: Executor, personId: string): Promise<{ id: string; email: string } | null> {
  const [row] = await db
    .select({ id: authUser.id, email: authUser.email })
    .from(person)
    .innerJoin(authUser, eq(authUser.id, person.claimedByUserId))
    .where(and(eq(person.id, personId), isNull(person.deletedAt)));
  return row ?? null;
}

const url = (path: string) => new URL(path, appUrl()).toString();

async function writePeriods(tx: Transaction, relationshipId: string, rows: PeriodRow[]): Promise<void> {
  await tx.delete(trainingPeriod).where(eq(trainingPeriod.relationshipId, relationshipId));
  if (rows.length > 0) await tx.insert(trainingPeriod).values(rows.map((r) => ({ ...r, relationshipId })));
}

async function recordEvent(
  tx: Transaction,
  event: { relationshipId: string; from: RelationshipStatus | null; to: RelationshipStatus; actor: Principal; role: string; reason?: string | null; key: string },
): Promise<string> {
  const id = uuidv7();
  await tx.insert(relationshipEvent).values({
    id,
    relationshipId: event.relationshipId,
    fromStatus: event.from,
    toStatus: event.to,
    actorUserId: event.actor.user.id,
    actorRole: event.role,
    reason: event.reason ?? null,
    idempotencyKey: event.key,
  });
  return id;
}

/** A unique violation of the idempotency key: another call with the key committed first. */
function isKeyConflict(error: unknown): boolean {
  const pg = pgErrorOf(error);
  return pg?.code === '23505' && pg.constraint === 'relationship_event_idempotency_key';
}

function isActiveConflict(error: unknown): boolean {
  const pg = pgErrorOf(error);
  return pg?.code === '23505' && pg.constraint === 'teaching_relationship_active_key';
}

const DUPLICATE_MESSAGE = 'You already have a request or a confirmed link with this teacher in this lineage. See My teachers.';

/** Takes the per-student request lock: a student's requests and resubmits see each other's checks. */
async function lockStudentRequests(tx: Transaction, studentId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${REQUEST_LOCK_SPACE}::int, hashtext(${studentId}::text))`);
}

/** Refuses one more pending request when the student already has MAX_PENDING_REQUESTS waiting. */
async function checkPendingCap(tx: Transaction, studentId: string): Promise<void> {
  const [pending] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(teachingRelationship)
    .where(and(eq(teachingRelationship.studentPersonId, studentId), eq(teachingRelationship.status, 'pending_teacher')));
  if ((pending?.n ?? 0) >= MAX_PENDING_REQUESTS) {
    throw new ServiceError('TOO_MANY_REQUESTS', `You have ${MAX_PENDING_REQUESTS} requests waiting for an answer. Wait for some of them, or withdraw one, before you send another.`);
  }
}

/** Notifies the teacher of a new or corrected request: a dashboard notification and an e-mail. */
async function tellTeacher(tx: Transaction, rel: { id: string; teacherPersonId: string; studentPersonId: string; lineageName: string }, rows: PeriodRow[], eventId: string, resubmitted: boolean) {
  const teacher = await accountOf(tx, rel.teacherPersonId);
  if (!teacher) return;
  await tx.insert(notification).values({ userId: teacher.id, template: 'relationship.requested', payload: { relationshipId: rel.id, resubmitted } });
  // As for an approval: no e-mail without the student's name, and no greeting without the teacher's.
  const studentNames = await namesFor(tx, rel.studentPersonId);
  if (studentNames.length === 0) return;
  const recipientNames = await namesFor(tx, rel.teacherPersonId);
  const starts = rows.map((r) => (r.startsOn ? toPrefix(r.startsOn, r.precision as 'year' | 'month' | 'day') : null)).filter((s): s is string => s !== null);
  const first = starts.sort((a, b) => `${a}-01-01`.slice(0, 10).localeCompare(`${b}-01-01`.slice(0, 10)))[0];
  await queueEmail(tx, {
    template: 'relationship-requested',
    to: teacher.email,
    userId: teacher.id,
    idempotencyKey: `relationship-requested:${eventId}`,
    data: {
      studentNames,
      trainingStart: first ? formatPartialDate(first) : 'Dates not given',
      lineageName: rel.lineageName,
      resubmitted,
      queueUrl: url('/dashboard/students/requests'),
      ...(recipientNames.length > 0 ? { recipientNames } : {}),
    },
  });
}

/** What the audit log keeps of periods: precisions and flags, no dates of a person's life beyond the year. */
function periodShape(rows: PeriodRow[]) {
  return rows.map((r) => ({ precision: r.precision, ongoing: r.ongoing, startYear: r.startsOn?.slice(0, 4) ?? null, endYear: r.endsOn?.slice(0, 4) ?? null, school: r.schoolId !== null }));
}

// --- request -----------------------------------------------------------------------------------

/**
 * relationships.request: the signed-in student names a teacher (a public person with an account),
 * a lineage (or the teacher's own) and one or more training periods. The request is pending_teacher
 * and involved_only (DEFAULT D03): only the two of them and the reviewers see it. The teacher gets a
 * dashboard notification and an e-mail.
 */
export async function requestTeacher(principal: Principal | null, raw: RequestInput, meta: RequestMeta): Promise<RelationshipResult> {
  const p = requireUser(principal);
  const parsed = requestInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const viewer = await viewerOf(db, p);
  if (!viewer.personId) throw new ServiceError('NOT_FOUND', 'Set up your profile before you name your teachers.');
  const studentId = viewer.personId;

  try {
    const outcome = await db.transaction(async (tx) => {
      // One request of a student at a time: the duplicate, pending and cycle checks see each other.
      await lockStudentRequests(tx, studentId);
      const replay = await replayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        // The same key replays only the same request: a request event (not a resubmit) to the same
        // teacher, in the lineage asked for. A key sent again with another teacher (a form brought
        // back by the browser's Back button, an API retry with a corrected body) is refused.
        if (replay.fromStatus !== null || replay.toStatus !== 'pending_teacher') throw keyReused();
        const [earlier] = await tx
          .select({ teacherId: teachingRelationship.teacherPersonId, lineageId: teachingRelationship.lineageId })
          .from(teachingRelationship)
          .where(eq(teachingRelationship.id, replay.relationshipId));
        if (!earlier || earlier.teacherId !== input.teacherId || (input.lineageId && earlier.lineageId !== input.lineageId)) throw keyReused();
        return { id: replay.relationshipId, replayed: true };
      }

      const [teacher] = await tx
        .select({ id: person.id, claimedBy: person.claimedByUserId, kind: person.kind, isPublic: sql<boolean>`EXISTS (SELECT 1 FROM v_public_person vp WHERE vp.id = ${input.teacherId}::uuid)` })
        .from(person)
        .where(and(eq(person.id, input.teacherId), isNull(person.deletedAt)));
      if (!teacher || !teacher.isPublic) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { teacherId: 'Choose your teacher from the search.' });
      if (teacher.id === studentId) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { teacherId: 'You can’t name yourself as your teacher.' });
      // Out of scope for M09: teachers without an account and historical teachers (the review path, plan §6.7).
      if (!teacher.claimedBy || teacher.kind !== 'living') {
        throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', {
          teacherId: 'This teacher has no account yet. Requests to teachers without an account open later in the pilot.',
        });
      }

      let lineageId = input.lineageId ?? null;
      if (lineageId && !(await lineageExists(tx, lineageId))) {
        throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { lineageId: 'Choose a lineage from the list.' });
      }
      lineageId ??= await lineageFor(tx, teacher.id);
      if (!lineageId) {
        throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { lineageId: 'Choose the lineage this training belongs to.' });
      }

      const { rows, fields } = await checkPeriods(tx, input.periods);
      if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);

      const [duplicate] = await tx
        .select({ id: teachingRelationship.id })
        .from(teachingRelationship)
        .where(
          and(
            eq(teachingRelationship.teacherPersonId, teacher.id),
            eq(teachingRelationship.studentPersonId, studentId),
            eq(teachingRelationship.lineageId, lineageId),
            inArray(teachingRelationship.status, ['pending_teacher', 'awaiting_claim', 'under_review', 'verified', 'in_arbitration']),
          ),
        );
      if (duplicate) throw new ServiceError('CONFLICT', DUPLICATE_MESSAGE, { teacherId: DUPLICATE_MESSAGE });

      await checkPendingCap(tx, studentId);

      // Early, so the student learns it now; the approval checks it again under the global lock.
      if (await closesCycle(tx, teacher.id, studentId)) throw new ServiceError('CONFLICT', CYCLE_MESSAGE, { teacherId: CYCLE_MESSAGE });

      const id = uuidv7();
      // DEFAULT D03: pending requests are involved_only.
      await tx.insert(teachingRelationship).values({
        id,
        teacherPersonId: teacher.id,
        studentPersonId: studentId,
        lineageId,
        status: 'pending_teacher',
        visibility: 'involved_only',
        verificationPath: 'teacher_approval',
        requestedByUserId: p.user.id,
        // DEFAULT D05: a wish, applied on approval; visual only.
        prefersDisplayPrimary: input.displayPrimary,
      });
      await writePeriods(tx, id, rows);
      const eventId = await recordEvent(tx, { relationshipId: id, from: null, to: 'pending_teacher', actor: p, role: 'student', key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.request',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: id,
        after: { status: 'pending_teacher', visibility: 'involved_only', teacherPersonId: teacher.id, studentPersonId: studentId, lineageId, periods: periodShape(rows), prefersDisplayPrimary: input.displayPrimary, lineageInferred: !input.lineageId },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      const [l] = await tx.select({ name: lineage.name }).from(lineage).where(eq(lineage.id, lineageId));
      await tellTeacher(tx, { id, teacherPersonId: teacher.id, studentPersonId: studentId, lineageName: l!.name }, rows, eventId, false);
      return { id, replayed: false };
    });
    return { relationship: await viewOf(db, outcome.id, viewer), replayed: outcome.replayed };
  } catch (error) {
    if (isActiveConflict(error)) throw new ServiceError('CONFLICT', DUPLICATE_MESSAGE, { teacherId: DUPLICATE_MESSAGE });
    if (isKeyConflict(error)) throw keyReused();
    throw error;
  }
}

function fieldErrors(error: z.ZodError): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : 'form';
    fields[key] ??= issue.message;
  }
  return new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

// --- Transitions on an existing relationship ---------------------------------------------------

type Action = 'approve' | 'reject' | 'withdraw' | 'resubmit' | 'end';

const ALLOWED_ROLE: Record<Action, readonly RelationshipRole[]> = {
  approve: ['teacher'],
  reject: ['teacher'],
  withdraw: ['student'],
  resubmit: ['student'],
  end: ['teacher', 'student'],
};

const FORBIDDEN_TEXT: Record<Action, string> = {
  approve: 'Only the teacher named in the request can approve it.',
  reject: 'Only the teacher named in the request can decline it.',
  withdraw: 'Only the student who sent the request can withdraw it.',
  resubmit: 'Only the student who sent the request can correct it.',
  end: 'Only the student or the teacher can mark the training as ended.',
};

/** 404 for a stranger (plan §6.4), 403 for a participant or reviewer whose side may not do this. */
function authorize(row: RelRow, viewer: Viewer, action: Action): RelationshipRole {
  const role = roleOf(row, viewer);
  if (role === null) throw notFound();
  if (!ALLOWED_ROLE[action].includes(role)) throw new ServiceError('FORBIDDEN', FORBIDDEN_TEXT[action]);
  return role;
}

function notWaiting(status: RelationshipStatus): ServiceError {
  const why =
    status === 'withdrawn'
      ? 'The student has withdrawn it.'
      : status === 'rejected'
        ? 'It was declined.'
        : status === 'verified' || status === 'in_arbitration'
          ? 'It was approved already.'
          : 'It is no longer waiting for an answer.';
  return new ServiceError('CONFLICT', `This request can't be answered now. ${why}`);
}

/** The replayed outcome of a key this account used before, or null when the key is new. */
async function replayFor(tx: Transaction, p: Principal, key: string, relationshipId: string, expect: { to: RelationshipStatus; reason?: string | null }) {
  const replay = await replayOf(tx, p.user.id, key);
  if (!replay) return null;
  if (replay.relationshipId !== relationshipId || replay.toStatus !== expect.to || (expect.reason !== undefined && replay.reason !== expect.reason)) throw keyReused();
  return { id: relationshipId, replayed: true };
}

/** The tags the public cache of a relationship's two people carries, with every teacher above them. */
async function publicTags(tx: Executor, row: Pick<RelRow, 'teacherPersonId' | 'studentPersonId'>): Promise<string[]> {
  const tags = [...(await neighbourTags(tx, row.teacherPersonId, { ancestors: true })), ...(await neighbourTags(tx, row.studentPersonId, { ancestors: true }))];
  return [...new Set(tags)];
}

// --- approve -----------------------------------------------------------------------------------

/**
 * relationships.approve: the teacher confirms the request (see the top of this file for the order
 * of the checks). The link becomes verified and public, both people public (except a profile whose
 * owner withdrew its publication: DEFAULT D03, docs/plan/questions/M07.md), and both sides get a
 * notification and an e-mail. At the plan's limit the request stays pending and the error carries
 * requireEntitlement()'s refusal (`data.entitlement`) for the upgrade prompt. Approving a request
 * that is verified already changes nothing and sends nothing.
 */
export async function approveRelationship(principal: Principal | null, raw: z.input<typeof relationshipActionInput>, meta: RequestMeta): Promise<RelationshipResult> {
  const p = requireUser(principal);
  const parsed = relationshipActionInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const viewer = await viewerOf(db, p);
  try {
    const outcome = await db.transaction(async (tx) => {
      // 1. One approval at a time, everywhere (plan §6.3).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${VERIFY_LOCK}))`);
      const row = await rowById(tx, input.relationshipId, true);
      if (!row) throw notFound();
      authorize(row, viewer, 'approve');
      const replay = await replayFor(tx, p, input.idempotencyKey, row.id, { to: 'verified', reason: null });
      if (replay) return { ...replay, tags: [] as string[] };
      // Approved already (another tab, a retry with a new key): the same answer, nothing new.
      if (row.status === 'verified' || row.status === 'in_arbitration') return { id: row.id, replayed: true, tags: [] as string[] };
      if (row.status !== 'pending_teacher') throw notWaiting(row.status);
      // A removed profile's request waits for nobody (as in the dashboards): it is never approved.
      const [removed] = await tx
        .select({ id: person.id })
        .from(person)
        .where(and(inArray(person.id, [row.teacherPersonId, row.studentPersonId]), isNotNull(person.deletedAt)));
      if (removed) throw new ServiceError('CONFLICT', 'This request can no longer be answered: the profile was removed.');

      // 2. The plan's allowance (DEFAULT D06), with withQuota's own lock after the global one.
      // DEFAULT D04/D13: a Sifu who chose the account type and is not verified yet ("Instructor
      // (unverified)") may approve; verification is apart from the plan (D04). The relationship
      // panel's "Approved by an unverified instructor" comes with instructor verification (M10b).
      const quota = await withQuota(
        tx,
        { kind: 'user', userId: p.user.id },
        'approve_students',
        async () => {
          // 3. The cycle check, on the base table, whatever the visibility.
          if (await closesCycle(tx, row.teacherPersonId, row.studentPersonId)) throw new ServiceError('CONFLICT', CYCLE_MESSAGE);
          // 4. Duplicate and self.
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
          if (duplicate) throw new ServiceError('CONFLICT', 'This student is already confirmed with you in this lineage.');
          return applyApproval(tx, p, row, input.idempotencyKey, meta);
        },
        { unit: row.studentPersonId },
      );
      if (!quota.ok) {
        const message =
          quota.code === 'quota'
            ? `You have approved ${quota.current} of ${quota.limit} students on ${planSummary(quota.plan).name}. The request stays pending.`
            : 'Approving students needs a Sifu account. Change your account type in Account type and plan; the request stays pending.';
        throw new ServiceError('ENTITLEMENT_REQUIRED', message, {}, { entitlement: quota });
      }
      return { id: row.id, replayed: false, tags: quota.value };
    });
    if (outcome.tags.length > 0) invalidatePublic(outcome.tags, 'procedure');
    return { relationship: await viewOf(db, outcome.id, viewer), replayed: outcome.replayed };
  } catch (error) {
    if (isKeyConflict(error)) throw keyReused();
    throw error;
  }
}

/** The writes of an approval, inside the transaction that holds both locks. Returns the cache tags. */
async function applyApproval(tx: Transaction, p: Principal, row: RelRow, key: string, meta: RequestMeta): Promise<string[]> {
  const now = new Date();
  // DEFAULT D05: the student's wish decides the primary line; without one, the first confirmed
  // teacher is drawn as it. Visual only: no other teacher is hidden.
  const [current] = await tx
    .select({ id: teachingRelationship.id })
    .from(teachingRelationship)
    .where(
      and(
        eq(teachingRelationship.studentPersonId, row.studentPersonId),
        eq(teachingRelationship.isDisplayPrimary, true),
        inArray(teachingRelationship.status, [...PUBLIC_RELATIONSHIP_STATUSES]),
      ),
    );
  const primary = row.prefersDisplayPrimary || !current;
  if (primary && current) await tx.update(teachingRelationship).set({ isDisplayPrimary: false, updatedAt: now }).where(eq(teachingRelationship.id, current.id));
  await tx
    .update(teachingRelationship)
    .set({ status: 'verified', visibility: 'public', isDisplayPrimary: primary, confirmedByUserId: p.user.id, confirmedAt: now, statusReason: null, updatedAt: now })
    .where(eq(teachingRelationship.id, row.id));
  // Both people become public (plan §6.2), except a self-stewarded profile whose owner withdrew
  // the publication consent: DEFAULT D03, the owner's choice wins (docs/plan/questions/M07.md).
  // Hiding a profile always leaves that withdrawal as the latest record, also when publication was
  // never granted (profile.ts setOwnVisibility, privacy.ts consentWithdraw; M09 review, code-1).
  const published = await tx.execute<{ id: string }>(sql`
UPDATE person p SET visibility = 'public', updated_at = now()
 WHERE p.id IN (${row.teacherPersonId}::uuid, ${row.studentPersonId}::uuid)
   AND p.visibility <> 'public' AND p.deleted_at IS NULL
   AND NOT (p.stewardship = 'self' AND COALESCE((
         SELECT c.action FROM consent_record c
          WHERE c.user_id = p.claimed_by_user_id AND c.kind = 'publication'
          ORDER BY c.occurred_at DESC, c.id DESC LIMIT 1), '') = 'withdrawn')
RETURNING p.id::text AS id`);
  const eventId = await recordEvent(tx, { relationshipId: row.id, from: 'pending_teacher', to: 'verified', actor: p, role: 'teacher', key });
  await writeAudit(tx, {
    action: 'relationship.approve',
    actorUserId: p.user.id,
    actorRole: p.user.role,
    subjectType: 'teaching_relationship',
    subjectId: row.id,
    before: { status: 'pending_teacher', visibility: row.visibility, isDisplayPrimary: row.isDisplayPrimary },
    after: {
      status: 'verified',
      visibility: 'public',
      isDisplayPrimary: primary,
      previousPrimaryId: primary && current ? current.id : null,
      publishedPersonIds: published.rows.map((r) => r.id),
      lineageId: row.lineageId,
    },
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  const teacher = await accountOf(tx, row.teacherPersonId);
  const student = await accountOf(tx, row.studentPersonId);
  const teacherNames = await namesFor(tx, row.teacherPersonId);
  const studentNames = await namesFor(tx, row.studentPersonId);
  for (const [side, account, other, own] of [
    ['student', student, teacherNames, studentNames],
    ['teacher', teacher, studentNames, teacherNames],
  ] as const) {
    if (!account) continue;
    await tx.insert(notification).values({ userId: account.id, template: 'relationship.approved', payload: { relationshipId: row.id, role: side } });
    if (other.length === 0) continue;
    await queueEmail(tx, {
      template: 'relationship-approved',
      to: account.email,
      userId: account.id,
      idempotencyKey: `relationship-approved:${eventId}:${side}`,
      data: {
        role: side,
        otherNames: [...other],
        lineageName: row.lineageName,
        url: url(side === 'student' ? '/dashboard/teachers' : '/dashboard/students/requests'),
        ...(own.length > 0 ? { recipientNames: [...own] } : {}),
      },
    });
  }
  const tags = await publicTags(tx, row);
  // The counters (lineage_membership) and the cache once more, from the worker (plan §6.3, §6.4).
  await enqueue(tx, QUEUE.lineageRecompute, { lineageIds: [row.lineageId], tags });
  return tags;
}

// --- reject ------------------------------------------------------------------------------------

/**
 * relationships.reject: the teacher declines the request with one of the neutral reasons
 * (src/server/templates/relationships.ts). The student gets a notification with the reason and a
 * link to correct the request and send it again, and an e-mail. Nothing public changes.
 */
export async function rejectRelationship(principal: Principal | null, raw: z.input<typeof rejectInput>, meta: RequestMeta): Promise<RelationshipResult> {
  const p = requireUser(principal);
  const parsed = rejectInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const viewer = await viewerOf(db, p);
  try {
    const outcome = await db.transaction(async (tx) => {
      const row = await rowById(tx, input.relationshipId, true);
      if (!row) throw notFound();
      authorize(row, viewer, 'reject');
      const replay = await replayFor(tx, p, input.idempotencyKey, row.id, { to: 'rejected' });
      if (replay) return replay;
      if (row.status !== 'pending_teacher') throw notWaiting(row.status);
      const now = new Date();
      await tx.update(teachingRelationship).set({ status: 'rejected', statusReason: input.reason, updatedAt: now }).where(eq(teachingRelationship.id, row.id));
      const eventId = await recordEvent(tx, { relationshipId: row.id, from: 'pending_teacher', to: 'rejected', actor: p, role: 'teacher', reason: input.reason, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.reject',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: row.id,
        before: { status: 'pending_teacher' },
        after: { status: 'rejected' },
        reason: input.reason,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      const student = await accountOf(tx, row.studentPersonId);
      if (student) {
        await tx.insert(notification).values({ userId: student.id, template: 'relationship.rejected', payload: { relationshipId: row.id, reason: input.reason } });
        const teacherNames = await namesFor(tx, row.teacherPersonId);
        const studentNames = await namesFor(tx, row.studentPersonId);
        if (teacherNames.length > 0) {
          await queueEmail(tx, {
            template: 'relationship-rejected',
            to: student.email,
            userId: student.id,
            idempotencyKey: `relationship-rejected:${eventId}`,
            data: {
              teacherNames,
              reason: rejectionReasonText(input.reason),
              lineageName: row.lineageName,
              // The form, filled in with the request as it was sent (the notification links there too).
              url: url(`/dashboard/teachers/new?resubmit=${row.id}`),
              ...(studentNames.length > 0 ? { recipientNames: studentNames } : {}),
            },
          });
        }
      }
      return { id: row.id, replayed: false };
    });
    return { relationship: await viewOf(db, outcome.id, viewer), replayed: outcome.replayed };
  } catch (error) {
    if (isKeyConflict(error)) throw keyReused();
    throw error;
  }
}

// --- withdraw ----------------------------------------------------------------------------------

/** relationships.withdraw: the student takes back a request that waits or was declined. Nothing public changes. */
export async function withdrawRelationship(principal: Principal | null, raw: z.input<typeof relationshipActionInput>, meta: RequestMeta): Promise<RelationshipResult> {
  const p = requireUser(principal);
  const parsed = relationshipActionInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const viewer = await viewerOf(db, p);
  try {
    const outcome = await db.transaction(async (tx) => {
      const row = await rowById(tx, input.relationshipId, true);
      if (!row) throw notFound();
      authorize(row, viewer, 'withdraw');
      const replay = await replayFor(tx, p, input.idempotencyKey, row.id, { to: 'withdrawn' });
      if (replay) return replay;
      if (row.status !== 'pending_teacher' && row.status !== 'rejected') {
        throw new ServiceError('CONFLICT', row.status === 'withdrawn' ? 'This request was withdrawn already.' : 'Only a request that waits or was declined can be withdrawn.');
      }
      await tx.update(teachingRelationship).set({ status: 'withdrawn', updatedAt: new Date() }).where(eq(teachingRelationship.id, row.id));
      await recordEvent(tx, { relationshipId: row.id, from: row.status, to: 'withdrawn', actor: p, role: 'student', key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.withdraw',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: row.id,
        before: { status: row.status },
        after: { status: 'withdrawn' },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      return { id: row.id, replayed: false };
    });
    return { relationship: await viewOf(db, outcome.id, viewer), replayed: outcome.replayed };
  } catch (error) {
    if (isKeyConflict(error)) throw keyReused();
    throw error;
  }
}

// --- resubmit ----------------------------------------------------------------------------------

/**
 * relationships.resubmit: the student corrects a declined request (periods, lineage, the display
 * wish) and sends it again: pending_teacher once more, involved_only, and the teacher is told.
 */
export async function resubmitRelationship(principal: Principal | null, raw: z.input<typeof resubmitInput>, meta: RequestMeta): Promise<RelationshipResult> {
  const p = requireUser(principal);
  const parsed = resubmitInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const viewer = await viewerOf(db, p);
  try {
    const outcome = await db.transaction(async (tx) => {
      // The student's request lock first, as in requestTeacher (the same order: no deadlock), so the
      // pending cap holds against a new request sent at the same time.
      if (viewer.personId) await lockStudentRequests(tx, viewer.personId);
      const row = await rowById(tx, input.relationshipId, true);
      if (!row) throw notFound();
      authorize(row, viewer, 'resubmit');
      const replay = await replayFor(tx, p, input.idempotencyKey, row.id, { to: 'pending_teacher', reason: 'resubmitted' });
      if (replay) return replay;
      if (row.status !== 'rejected') throw new ServiceError('CONFLICT', 'Only a declined request can be corrected and sent again.');
      await checkPendingCap(tx, row.studentPersonId);
      // Left out: the request keeps its lineage. null: the teacher's own, as for a request (the
      // form's "The teacher's own lineage"). An id: that lineage.
      let lineageId = input.lineageId === undefined ? row.lineageId : input.lineageId;
      if (lineageId && !(await lineageExists(tx, lineageId))) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { lineageId: 'Choose a lineage from the list.' });
      lineageId ??= await lineageFor(tx, row.teacherPersonId);
      if (!lineageId) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { lineageId: 'Choose the lineage this training belongs to.' });
      const { rows, fields } = await checkPeriods(tx, input.periods);
      if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
      if (await closesCycle(tx, row.teacherPersonId, row.studentPersonId)) throw new ServiceError('CONFLICT', CYCLE_MESSAGE);
      await tx
        .update(teachingRelationship)
        .set({ status: 'pending_teacher', lineageId, prefersDisplayPrimary: input.displayPrimary, statusReason: null, updatedAt: new Date() })
        .where(eq(teachingRelationship.id, row.id));
      await writePeriods(tx, row.id, rows);
      const eventId = await recordEvent(tx, { relationshipId: row.id, from: 'rejected', to: 'pending_teacher', actor: p, role: 'student', reason: 'resubmitted', key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.resubmit',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: row.id,
        before: { status: 'rejected', lineageId: row.lineageId, reason: row.statusReason },
        after: { status: 'pending_teacher', lineageId, periods: periodShape(rows), prefersDisplayPrimary: input.displayPrimary },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      const [l] = await tx.select({ name: lineage.name }).from(lineage).where(eq(lineage.id, lineageId));
      await tellTeacher(tx, { id: row.id, teacherPersonId: row.teacherPersonId, studentPersonId: row.studentPersonId, lineageName: l!.name }, rows, eventId, true);
      return { id: row.id, replayed: false };
    });
    return { relationship: await viewOf(db, outcome.id, viewer), replayed: outcome.replayed };
  } catch (error) {
    if (isActiveConflict(error)) throw new ServiceError('CONFLICT', DUPLICATE_MESSAGE);
    if (isKeyConflict(error)) throw keyReused();
    throw error;
  }
}

// --- end ---------------------------------------------------------------------------------------

/**
 * relationships.end: the student or the teacher marks the training as ended. Every ongoing period
 * gets the end date (at the coarser of its own precision and the end's); the relationship stays
 * verified and public, and reads as historical. Never deleted (plan §6.7). The other side is told.
 */
export async function endRelationship(principal: Principal | null, raw: z.input<typeof endInput>, meta: RequestMeta): Promise<RelationshipResult> {
  const p = requireUser(principal);
  const parsed = endInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const ended = parsePartialDate(input.endedOn);
  const today = todayUtc();
  if (!ended) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { endedOn: 'Write the end as a year (2021), a month (2021-06) or a date (2021-06-30).' });
  if (ended.firstDay > today) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { endedOn: "The end can't be in the future." });
  const db = getDb();
  const viewer = await viewerOf(db, p);
  try {
    const outcome = await db.transaction(async (tx) => {
      const row = await rowById(tx, input.relationshipId, true);
      if (!row) throw notFound();
      const role = authorize(row, viewer, 'end');
      const replay = await replayFor(tx, p, input.idempotencyKey, row.id, { to: row.status, reason: 'training_ended' });
      if (replay) return { ...replay, tags: [] as string[] };
      if (row.status !== 'verified' && row.status !== 'in_arbitration') throw new ServiceError('CONFLICT', 'Only a confirmed link can be marked as ended.');
      const periods = await tx
        .select({ id: trainingPeriod.id, startsOn: trainingPeriod.startsOn, precision: trainingPeriod.precision, ongoing: trainingPeriod.ongoing })
        .from(trainingPeriod)
        .where(eq(trainingPeriod.relationshipId, row.id));
      const ongoing = periods.filter((x) => x.ongoing);
      if (periods.length > 0 && ongoing.length === 0) throw new ServiceError('CONFLICT', 'This training is marked as ended already.');
      const now = new Date();
      const changed: { precision: Precision; endYear: string }[] = [];
      for (const period of ongoing) {
        const own = period.precision === 'unknown' ? ended.precision : coarser(period.precision, ended.precision);
        const end = atPrecision(ended, own);
        const start = period.startsOn && period.precision !== 'unknown' ? atPrecision(parsePartialDate(toPrefix(period.startsOn, period.precision))!, own) : null;
        if (start && end.firstDay < start.firstDay) {
          throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { endedOn: `The end can't be before the start (${formatPartialDate(start.prefix)}).` });
        }
        await tx
          .update(trainingPeriod)
          .set({ ongoing: false, endsOn: end.firstDay, startsOn: start?.firstDay ?? null, precision: own, updatedAt: now })
          .where(eq(trainingPeriod.id, period.id));
        changed.push({ precision: own, endYear: end.firstDay.slice(0, 4) });
      }
      // A link recorded without periods gets one that ends then (start not recorded).
      if (periods.length === 0) {
        await tx.insert(trainingPeriod).values({ relationshipId: row.id, startsOn: null, endsOn: ended.firstDay, precision: ended.precision, ongoing: false, sortOrder: 0 });
        changed.push({ precision: ended.precision, endYear: ended.firstDay.slice(0, 4) });
      }
      await tx.update(teachingRelationship).set({ updatedAt: now }).where(eq(teachingRelationship.id, row.id));
      await recordEvent(tx, { relationshipId: row.id, from: row.status, to: row.status, actor: p, role, reason: 'training_ended', key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.end',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: row.id,
        before: { status: row.status, ongoingPeriods: ongoing.length },
        after: { status: row.status, ended: changed },
        reason: 'training_ended',
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      const other = await accountOf(tx, role === 'teacher' ? row.studentPersonId : row.teacherPersonId);
      if (other) await tx.insert(notification).values({ userId: other.id, template: 'relationship.ended', payload: { relationshipId: row.id, by: role } });
      return { id: row.id, replayed: false, tags: await publicTags(tx, row) };
    });
    if (outcome.tags.length > 0) invalidatePublic(outcome.tags, 'procedure');
    return { relationship: await viewOf(db, outcome.id, viewer), replayed: outcome.replayed };
  } catch (error) {
    if (isKeyConflict(error)) throw keyReused();
    throw error;
  }
}
