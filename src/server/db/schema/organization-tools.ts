// Organization tools (milestone M24; specification §9, §9.1, §10.3; plan §6.2, §6.4;
// docs/adr/0027-organization-tools.md): the federation bulk import, the organization-managed
// fields of a membership and the teacher claims an import records.
//
// DEFAULT D12 (as in M15): none of these tables is a teaching relationship. An imported teacher
// link is an organization_teacher_claim, "claimed by the organization": it never enters
// teaching_relationship, v_public_edge or the explorer, and only the teacher's own approval in the
// normal flow (M09) ever verifies a relationship. An imported person is an unclaimed, private
// person record (stewardship 'unclaimed', visibility 'involved_only'), never an account.
//
// Privacy (plan §6.4): an import row keeps its parsed fields only while its preview is open; when
// the import is committed, discarded or expired the data of every row is cleared (the row number,
// its outcome, its error codes and the person it created stay). The file itself is never stored:
// only its SHA-256 and size. The import's e-mail column is never read into the database (DEFAULT
// M24 question 3).

import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import { idColumn, inList, timestamps } from './common';
import { organization, organizationMembership } from './organizations';
import { person } from './persons';

// --- Value sets and limits (DEFAULT M24 questions 1, 2, 7, 8) --------------------------------------

export const ORGANIZATION_IMPORT_STATUSES = ['previewed', 'committed', 'discarded', 'expired'] as const;
export const ORGANIZATION_IMPORT_ROW_STATUSES = ['valid', 'error', 'imported', 'skipped'] as const;
export const ORGANIZATION_CLAIM_STATUSES = ['claimed_by_organization', 'withdrawn'] as const;
/** Why a claim was withdrawn: by the organization, or by a separation (the member left or was ended). */
export const ORGANIZATION_CLAIM_END_REASONS = ['organization', 'separation'] as const;

/** DEFAULT M24 question 2: at most this many data rows in one file. */
export const ORGANIZATION_IMPORT_MAX_ROWS = 500;
/** DEFAULT M24 question 2: at most this many bytes of CSV (UTF-8) in one file. */
export const ORGANIZATION_IMPORT_MAX_BYTES = 256 * 1024;
/** DEFAULT M24 question 2: at most this many previews by one organization in 24 hours. */
export const ORGANIZATION_IMPORTS_PER_DAY = 10;
/** DEFAULT M24 question 2: a preview can be committed for this many hours; then it expires. */
export const ORGANIZATION_IMPORT_PREVIEW_HOURS = 24;
/** The organization-managed text fields of a member (rank, training city): at most this long. */
export const ORGANIZATION_MEMBER_FIELD_MAX = 80;

export interface ImportRowData {
  /** The Latin-script name (First_Name and Last_Name joined), required. */
  name: string;
  /** Chinese_Name: the name in Chinese characters, optional. */
  chineseName: string | null;
  startYear: number | null;
  rank: string | null;
  /** The teacher's person record that Sifu_Database_ID named (its id), when the column was filled. */
  teacherPersonId: string | null;
  schoolCity: string | null;
}

export interface ImportRowError {
  /** The template's column (First_Name, Sifu_Database_ID, …) or `row`. */
  field: string;
  message: string;
}

/** One upload of a CSV file by an organization's admin: a preview first, then a commit (or a discard). */
export const organizationImport = pgTable(
  'organization_import',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    status: text('status', { enum: ORGANIZATION_IMPORT_STATUSES }).notNull().default('previewed'),
    /** SHA-256 of the uploaded bytes: the file itself is never stored. */
    fileSha256: text('file_sha256').notNull(),
    fileBytes: integer('file_bytes').notNull(),
    rowCount: integer('row_count').notNull(),
    validCount: integer('valid_count').notNull(),
    errorCount: integer('error_count').notNull(),
    importedCount: integer('imported_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedByUserId: uuid('ended_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    index('organization_import_organization_idx').on(t.organizationId, t.createdAt),
    index('organization_import_created_by_user_id_idx').on(t.createdByUserId),
    index('organization_import_ended_by_user_id_idx').on(t.endedByUserId),
    index('organization_import_open_idx').on(t.expiresAt).where(sql`${t.status} = 'previewed'`),
    check('organization_import_status_check', inList(t.status.name, ORGANIZATION_IMPORT_STATUSES)),
    check('organization_import_sha256_format', sql`${t.fileSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'organization_import_counts',
      sql`${t.rowCount} BETWEEN 0 AND ${sql.raw(String(ORGANIZATION_IMPORT_MAX_ROWS))} AND ${t.validCount} >= 0 AND ${t.errorCount} >= 0 AND ${t.validCount} + ${t.errorCount} = ${t.rowCount} AND ${t.importedCount} BETWEEN 0 AND ${t.validCount}`,
    ),
    check('organization_import_file_bytes', sql`${t.fileBytes} BETWEEN 0 AND ${sql.raw(String(ORGANIZATION_IMPORT_MAX_BYTES))}`),
    check('organization_import_ended_has_time', sql`${t.status} = 'previewed' OR ${t.endedAt} IS NOT NULL`),
  ],
);

/** One data row of an import: its parsed fields while the preview is open, its errors and its outcome. */
export const organizationImportRow = pgTable(
  'organization_import_row',
  {
    id: idColumn(),
    importId: uuid('import_id')
      .notNull()
      .references(() => organizationImport.id, { onDelete: 'cascade' }),
    /** The row's line in the file (the header is line 1). */
    rowNumber: integer('row_number').notNull(),
    status: text('status', { enum: ORGANIZATION_IMPORT_ROW_STATUSES }).notNull(),
    /** The parsed fields; cleared (null) once the import is committed, discarded or expired. */
    data: jsonb('data').$type<ImportRowData>(),
    errors: jsonb('errors').$type<ImportRowError[]>().notNull().default([]),
    /** The person record the commit created from this row. */
    personId: uuid('person_id').references(() => person.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('organization_import_row_key').on(t.importId, t.rowNumber),
    index('organization_import_row_person_id_idx').on(t.personId),
    check('organization_import_row_status_check', inList(t.status.name, ORGANIZATION_IMPORT_ROW_STATUSES)),
    check('organization_import_row_number', sql`${t.rowNumber} >= 2`),
    check('organization_import_row_imported_has_person', sql`${t.status} <> 'imported' OR ${t.personId} IS NOT NULL`),
  ],
);

/**
 * The organization-managed fields of a membership (DEFAULT M24 question 9): the rank the
 * organization gives and the city it names, as the organization states them; never verified,
 * never public. A separation (the membership ends) deletes the row: the organization's fields go,
 * the membership stays as history.
 */
export const organizationMemberRecord = pgTable(
  'organization_member_record',
  {
    id: idColumn(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => organizationMembership.id, { onDelete: 'cascade' }),
    rankLabel: text('rank_label'),
    schoolCity: text('school_city'),
    importId: uuid('import_id').references(() => organizationImport.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('organization_member_record_membership_key').on(t.membershipId),
    index('organization_member_record_import_id_idx').on(t.importId),
    check(
      'organization_member_record_lengths',
      sql`(${t.rankLabel} IS NULL OR char_length(${t.rankLabel}) BETWEEN 1 AND ${sql.raw(String(ORGANIZATION_MEMBER_FIELD_MAX))}) AND (${t.schoolCity} IS NULL OR char_length(${t.schoolCity}) BETWEEN 1 AND ${sql.raw(String(ORGANIZATION_MEMBER_FIELD_MAX))})`,
    ),
  ],
);

/**
 * A teacher link an organization stated (an import's Sifu_Database_ID): "claimed by the
 * organization", never verified. DEFAULT D12 and M24 question 4: it is not a teaching relationship
 * and nothing turns it into one; the student, once they hold their record, asks the teacher in the
 * normal flow (M09), and only that teacher's approval verifies it (specification §5.2).
 */
export const organizationTeacherClaim = pgTable(
  'organization_teacher_claim',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    studentPersonId: uuid('student_person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    teacherPersonId: uuid('teacher_person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    startYear: integer('start_year'),
    status: text('status', { enum: ORGANIZATION_CLAIM_STATUSES }).notNull().default('claimed_by_organization'),
    importId: uuid('import_id').references(() => organizationImport.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnByUserId: uuid('withdrawn_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    withdrawReason: text('withdraw_reason', { enum: ORGANIZATION_CLAIM_END_REASONS }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('organization_teacher_claim_open_key')
      .on(t.organizationId, t.studentPersonId, t.teacherPersonId)
      .where(sql`${t.status} = 'claimed_by_organization'`),
    index('organization_teacher_claim_student_idx').on(t.studentPersonId),
    index('organization_teacher_claim_teacher_idx').on(t.teacherPersonId),
    index('organization_teacher_claim_import_id_idx').on(t.importId),
    index('organization_teacher_claim_created_by_user_id_idx').on(t.createdByUserId),
    index('organization_teacher_claim_withdrawn_by_user_id_idx').on(t.withdrawnByUserId),
    check('organization_teacher_claim_status_check', inList(t.status.name, ORGANIZATION_CLAIM_STATUSES)),
    check('organization_teacher_claim_not_self', sql`${t.studentPersonId} <> ${t.teacherPersonId}`),
    check('organization_teacher_claim_start_year', sql`${t.startYear} IS NULL OR ${t.startYear} BETWEEN 1900 AND 2100`),
    check(
      'organization_teacher_claim_withdrawn',
      sql`(${t.status} = 'withdrawn') = (${t.withdrawnAt} IS NOT NULL) AND (${t.status} = 'withdrawn') = (${t.withdrawReason} IS NOT NULL)`,
    ),
    check('organization_teacher_claim_withdraw_reason_check', sql`${t.withdrawReason} IS NULL OR ${inList(t.withdrawReason.name, ORGANIZATION_CLAIM_END_REASONS)}`),
  ],
);
