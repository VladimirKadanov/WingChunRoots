// The training passport (milestone M19; specification §8, §3.1 row "Digital passport";
// docs/adr/0022-passport.md).
//
// A passport is the chronological record of one person's training: ranks (with the organization
// that issued them), examinations (the awarded rank and, optionally, the examiner from the archive),
// forms and skills (learning or approved), scanned certificates and attendance at past events (M17).
// The periods under each teacher are the existing training_period rows: never entered again.
//
// Every entry carries its own visibility (the student decides: private or public), a status (active,
// withdrawn by whoever wrote it, removed by staff with a reason) and who wrote it and when. Nothing is
// ever deleted: a withdrawn or removed entry is kept and shown to nobody, and a plan that shows less
// only hides (DEFAULT D08). Ranks, examinations and skills are written by the student's teacher (an
// established relationship) or by an admin of the organization that issued them, never by the
// student (DEFAULT M19, question 1); the student may propose a correction (correction_note).
//
// A certificate is a scanned document, not a certificate this platform issues (D21: serial
// numbers, QR codes and a status page are Phase 4). Its image is processed as a gallery photo (no
// EXIF, GPS, XMP or IPTC) and kept in the private store (the evidence bucket or folder, under its
// own `certificates/` keys, apart from galleries and from evidence, D13), served only through the
// app after the visibility check. app_public_ro reads none of these tables; the public reads go
// through v_public_passport (the migration), which only app_rw reads.

import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import {
  ATTENDANCE_STATUSES,
  DATE_PRECISIONS,
  idColumn,
  inList,
  PASSPORT_NOTE_MAX,
  PASSPORT_RANK_PHOTOS_MAX,
  PASSPORT_STATUSES,
  PASSPORT_TEXT_MAX,
  PASSPORT_TITLE_MAX,
  PASSPORT_VISIBILITIES,
  PHOTO_FULL_MAX_SIDE,
  RANK_LADDER_MAX,
  SKILL_PROGRESSES,
  timestamps,
} from './common';
import { event } from './events';
import { organization } from './organizations';
import { person, personPhoto } from './persons';

/** The columns every entry has: whose passport, who sees it, its status, who wrote and changed it. */
const entryColumns = () => ({
  id: idColumn(),
  /** The person whose passport it is. */
  personId: uuid('person_id')
    .notNull()
    .references(() => person.id, { onDelete: 'cascade' }),
  visibility: text('visibility', { enum: PASSPORT_VISIBILITIES }).notNull().default('public'),
  status: text('status', { enum: PASSPORT_STATUSES }).notNull().default('active'),
  /** The account that wrote it (a teacher, an organization's admin, the student for a certificate). */
  createdByUserId: uuid('created_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  withdrawnByUserId: uuid('withdrawn_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  removedByUserId: uuid('removed_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
  /** Staff's reason (audited, never public). */
  removalReason: text('removal_reason'),
  ...timestamps(),
});

/** The CHECKs every entry has. */
function entryChecks(
  name: string,
  t: { visibility: { name: string }; status: { name: string }; withdrawnAt: unknown; removedAt: unknown; removalReason: unknown },
  statuses: readonly string[] = PASSPORT_STATUSES,
) {
  return [
    check(`${name}_visibility_check`, inList(t.visibility.name, PASSPORT_VISIBILITIES)),
    check(`${name}_status_check`, inList(t.status.name, statuses)),
    check(`${name}_withdrawn_has_time`, sql`${sql.identifier(t.status.name)} <> 'withdrawn' OR ${sql.identifier('withdrawn_at')} IS NOT NULL`),
    check(`${name}_removed_has_time`, sql`${sql.identifier(t.status.name)} <> 'removed' OR ${sql.identifier('removed_at')} IS NOT NULL`),
    check(
      `${name}_removal_reason_length`,
      sql`${sql.identifier('removal_reason')} IS NULL OR char_length(${sql.identifier('removal_reason')}) BETWEEN 1 AND ${sql.raw(String(PASSPORT_NOTE_MAX))}`,
    ),
  ];
}

/** A date as people remember it (src/lib/partial-date.ts): the first day it covers and its precision; none when unknown. */
const datedColumns = (column: string) => ({
  on: date(column),
  precision: text('precision', { enum: DATE_PRECISIONS }).notNull().default('unknown'),
});

function datedChecks(name: string, column: string) {
  return [
    check(`${name}_precision_check`, inList('precision', DATE_PRECISIONS)),
    // A date with its precision, or none at all with `unknown`.
    check(`${name}_date_matches_precision`, sql`(${sql.identifier('precision')} = 'unknown') = (${sql.identifier(column)} IS NULL)`),
  ];
}

/** The proposal of the student to whoever wrote a rank, an examination or a skill. */
const correctionColumns = () => ({
  correctionNote: text('correction_note'),
  correctionAt: timestamp('correction_at', { withTimezone: true }),
});

function correctionChecks(name: string) {
  return [
    check(
      `${name}_correction_complete`,
      sql`(${sql.identifier('correction_note')} IS NULL) = (${sql.identifier('correction_at')} IS NULL) AND (${sql.identifier('correction_note')} IS NULL OR char_length(${sql.identifier('correction_note')}) BETWEEN 1 AND ${sql.raw(String(PASSPORT_NOTE_MAX))})`,
    ),
  ];
}

const textLength = (name: string, column: string, max: number, optional = false) =>
  check(
    name,
    optional
      ? sql`${sql.identifier(column)} IS NULL OR char_length(${sql.identifier(column)}) BETWEEN 1 AND ${sql.raw(String(max))}`
      : sql`char_length(${sql.identifier(column)}) BETWEEN 1 AND ${sql.raw(String(max))}`,
  );

/** M19: a rank (the current one is the latest by date), and the organization that issued it. */
export const passportRank = pgTable(
  'passport_rank',
  {
    ...entryColumns(),
    rank: text('rank').notNull(),
    organizationId: uuid('organization_id').references(() => organization.id, { onDelete: 'set null' }),
    ...datedColumns('awarded_on'),
    /** The teacher who wrote it (an established relationship), or null when an organization's admin did. */
    teacherPersonId: uuid('teacher_person_id').references(() => person.id, { onDelete: 'set null' }),
    ...correctionColumns(),
  },
  (t) => [
    index('passport_rank_person_id_idx').on(t.personId, t.on),
    index('passport_rank_organization_id_idx').on(t.organizationId),
    index('passport_rank_teacher_person_id_idx').on(t.teacherPersonId),
    index('passport_rank_created_by_user_id_idx').on(t.createdByUserId),
    index('passport_rank_withdrawn_by_user_id_idx').on(t.withdrawnByUserId),
    index('passport_rank_removed_by_user_id_idx').on(t.removedByUserId),
    textLength('passport_rank_rank_length', 'rank', PASSPORT_TEXT_MAX),
    ...entryChecks('passport_rank', t),
    ...datedChecks('passport_rank', 'awarded_on'),
    ...correctionChecks('passport_rank'),
  ],
);

/**
 * ADR 0046 (owner decision 2026-11-18): up to 3 photos of the student's own gallery on a rank of
 * their passport, chosen by the student (the grading history). A photo is shown only while it is
 * in the gallery (active or gallery), the rank is public and the passport shows the full timeline;
 * removing the photo from the gallery removes it here too.
 */
export const passportRankPhoto = pgTable(
  'passport_rank_photo',
  {
    rankId: uuid('rank_id')
      .notNull()
      .references(() => passportRank.id, { onDelete: 'cascade' }),
    photoId: uuid('photo_id')
      .notNull()
      .references(() => personPhoto.id, { onDelete: 'cascade' }),
    /** 0, 1 or 2: the student's order. */
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.rankId, t.photoId] }),
    uniqueIndex('passport_rank_photo_rank_position_key').on(t.rankId, t.position),
    index('passport_rank_photo_photo_id_idx').on(t.photoId),
    check('passport_rank_photo_position_check', sql`${t.position} BETWEEN 0 AND ${sql.raw(String(PASSPORT_RANK_PHOTOS_MAX - 1))}`),
  ],
);

/** M19: an examination: its date, the rank it awarded, the examiner (a person of the archive) and the organization. */
export const passportExam = pgTable(
  'passport_exam',
  {
    ...entryColumns(),
    ...datedColumns('exam_on'),
    awardedRank: text('awarded_rank').notNull(),
    /** Shown only while the viewer may see that person (v_public_person). */
    examinerPersonId: uuid('examiner_person_id').references(() => person.id, { onDelete: 'set null' }),
    organizationId: uuid('organization_id').references(() => organization.id, { onDelete: 'set null' }),
    teacherPersonId: uuid('teacher_person_id').references(() => person.id, { onDelete: 'set null' }),
    ...correctionColumns(),
  },
  (t) => [
    index('passport_exam_person_id_idx').on(t.personId, t.on),
    index('passport_exam_examiner_person_id_idx').on(t.examinerPersonId),
    index('passport_exam_organization_id_idx').on(t.organizationId),
    index('passport_exam_teacher_person_id_idx').on(t.teacherPersonId),
    index('passport_exam_created_by_user_id_idx').on(t.createdByUserId),
    index('passport_exam_withdrawn_by_user_id_idx').on(t.withdrawnByUserId),
    index('passport_exam_removed_by_user_id_idx').on(t.removedByUserId),
    textLength('passport_exam_awarded_rank_length', 'awarded_rank', PASSPORT_TEXT_MAX),
    check('passport_exam_examiner_not_self', sql`${t.examinerPersonId} IS NULL OR ${t.examinerPersonId} <> ${t.personId}`),
    ...entryChecks('passport_exam', t),
    ...datedChecks('passport_exam', 'exam_on'),
    ...correctionChecks('passport_exam'),
  ],
);

/** M19: a form or skill, being learned or approved by the teacher. */
export const passportSkill = pgTable(
  'passport_skill',
  {
    ...entryColumns(),
    name: text('name').notNull(),
    progress: text('progress', { enum: SKILL_PROGRESSES }).notNull().default('learning'),
    /** Since when it is learned, or when it was approved; optional. */
    ...datedColumns('since_on'),
    teacherPersonId: uuid('teacher_person_id').references(() => person.id, { onDelete: 'set null' }),
    organizationId: uuid('organization_id').references(() => organization.id, { onDelete: 'set null' }),
    ...correctionColumns(),
  },
  (t) => [
    index('passport_skill_person_id_idx').on(t.personId, t.on),
    index('passport_skill_teacher_person_id_idx').on(t.teacherPersonId),
    index('passport_skill_organization_id_idx').on(t.organizationId),
    index('passport_skill_created_by_user_id_idx').on(t.createdByUserId),
    index('passport_skill_withdrawn_by_user_id_idx').on(t.withdrawnByUserId),
    index('passport_skill_removed_by_user_id_idx').on(t.removedByUserId),
    textLength('passport_skill_name_length', 'name', PASSPORT_TEXT_MAX),
    check('passport_skill_progress_check', inList(t.progress.name, SKILL_PROGRESSES)),
    ...entryChecks('passport_skill', t),
    ...datedChecks('passport_skill', 'since_on'),
    ...correctionChecks('passport_skill'),
  ],
);

/**
 * M19: a scanned certificate or diploma the student uploads (DEFAULT M19, question 4: JPEG, PNG or
 * WebP only, processed as a gallery photo). Its files are in the private store under
 * `certificates/<48 hex>` (the whole image and its 96/512 px squares); never a presigned address.
 */
export const passportCertificate = pgTable(
  'passport_certificate',
  {
    ...entryColumns(),
    // DEFAULT M19 (question 5): a certificate starts private; the student may publish it.
    visibility: text('visibility', { enum: PASSPORT_VISIBILITIES }).notNull().default('private'),
    title: text('title'),
    ...datedColumns('issued_on'),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
  },
  (t) => [
    index('passport_certificate_person_id_idx').on(t.personId),
    index('passport_certificate_created_by_user_id_idx').on(t.createdByUserId),
    index('passport_certificate_withdrawn_by_user_id_idx').on(t.withdrawnByUserId),
    index('passport_certificate_removed_by_user_id_idx').on(t.removedByUserId),
    uniqueIndex('passport_certificate_storage_key_key').on(t.storageKey),
    textLength('passport_certificate_title_length', 'title', PASSPORT_TITLE_MAX, true),
    check('passport_certificate_storage_key_format', sql`${t.storageKey} ~ '^certificates/[0-9a-f]{48}$'`),
    check('passport_certificate_sha256_format', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'passport_certificate_size_check',
      sql`${t.width} BETWEEN 1 AND ${sql.raw(String(PHOTO_FULL_MAX_SIDE))} AND ${t.height} BETWEEN 1 AND ${sql.raw(String(PHOTO_FULL_MAX_SIDE))} AND ${t.sizeBytes} > 0`,
    ),
    ...entryChecks('passport_certificate', t),
    ...datedChecks('passport_certificate', 'issued_on'),
  ],
);

/**
 * M19: attendance at a past event (M17), marked by its organizer or one of its instructors for
 * their own established students. One row per event and person that is not withdrawn or removed.
 *
 * Owner decision 2026-11-18 (docs/adr/0046-passport-extras.md): a student on a plan with the full
 * passport may claim attendance (`claimed`, status `pending`, written by the student). It shows
 * nowhere but in the student's own passport until the organizer, an instructor or an admin of the
 * organizing organization approves it (`active`, "Confirmed by the organizer") or refuses it
 * (`refused`, kept, shown to nobody; the student cannot claim the same event again).
 */
export const eventAttendance = pgTable(
  'event_attendance',
  {
    ...entryColumns(),
    status: text('status', { enum: ATTENDANCE_STATUSES }).notNull().default('active'),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    /** The teacher who marked or approved it (the organizer or an instructor); null when an organization's admin approved. */
    teacherPersonId: uuid('teacher_person_id').references(() => person.id, { onDelete: 'set null' }),
    /** The student claimed it (ADR 0046) rather than the organizer marking it. */
    claimed: boolean('claimed').notNull().default(false),
    /** When and by whom a claim was approved or refused. */
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedByUserId: uuid('decided_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('event_attendance_open_key').on(t.eventId, t.personId).where(sql`${t.status} IN ('active', 'pending', 'refused')`),
    index('event_attendance_event_pending_idx').on(t.eventId).where(sql`${t.status} = 'pending'`),
    index('event_attendance_decided_by_user_id_idx').on(t.decidedByUserId),
    check('event_attendance_claim_status', sql`${t.claimed} OR ${t.status} NOT IN ('pending', 'refused')`),
    // A claim waits undecided; a refusal says when it was decided.
    check('event_attendance_pending_undecided', sql`${t.status} <> 'pending' OR ${t.decidedAt} IS NULL`),
    check('event_attendance_refused_decided', sql`${t.status} <> 'refused' OR ${t.decidedAt} IS NOT NULL`),
    index('event_attendance_person_id_idx').on(t.personId),
    index('event_attendance_teacher_person_id_idx').on(t.teacherPersonId),
    index('event_attendance_created_by_user_id_idx').on(t.createdByUserId),
    index('event_attendance_withdrawn_by_user_id_idx').on(t.withdrawnByUserId),
    index('event_attendance_removed_by_user_id_idx').on(t.removedByUserId),
    ...entryChecks('event_attendance', t, ATTENDANCE_STATUSES),
  ],
);

/**
 * Role replay 2026-11-25 (P2-8, ADR 0072): the rank ladder of an account (a teacher, an
 * organization's admin), set once ("First level", "Second level"…) and offered as the pick list
 * wherever that account records a rank. Only words: never a person. It goes with the account.
 */
export const rankLadderStep = pgTable(
  'rank_ladder_step',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    /** 0 for the first step, in the order the account set. */
    position: integer('position').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.position] }),
    check('rank_ladder_step_position_check', sql`${t.position} BETWEEN 0 AND ${sql.raw(String(RANK_LADDER_MAX - 1))}`),
    textLength('rank_ladder_step_name_length', 'name', PASSPORT_TEXT_MAX),
  ],
);
