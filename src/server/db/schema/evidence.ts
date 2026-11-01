// Evidence, review and reports (plan §6.2, §6.4). Evidence files live only in the private bucket
// or private folder; this table holds their metadata, and the public role has no access to it.
// DEFAULT D13: private evidence is separate from public media quotas.

import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import {
  deletedAt,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_MIME_TYPES,
  EVIDENCE_NAME_MAX,
  idColumn,
  inList,
  OPEN_REVIEW_CASE_STATUSES,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_SUBJECTS,
  REVIEW_CASE_KINDS,
  REVIEW_CASE_STATUSES,
  REVIEW_RESOLUTIONS,
  SCAN_STATUSES,
  timestamps,
} from './common';
import { teachingRelationship } from './lineage';
import { person } from './persons';
import { school } from './schools';

export const evidenceFile = pgTable(
  'evidence_file',
  {
    id: idColumn(),
    storageKey: text('storage_key').notNull(),
    // Hash of the stored object; original_sha256 is the uploaded original when an image was
    // re-encoded (plan §6.2).
    sha256: text('sha256').notNull(),
    originalSha256: text('original_sha256'),
    mime: text('mime', { enum: EVIDENCE_MIME_TYPES }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    // M10a: the uploaded file's own name, cleaned (no path, no control characters, at most
    // EVIDENCE_NAME_MAX characters), shown only to the people who may download the file.
    originalName: text('original_name'),
    scanStatus: text('scan_status', { enum: SCAN_STATUSES }).notNull().default('pending'),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('evidence_file_storage_key_key').on(t.storageKey),
    index('evidence_file_sha256_idx').on(t.sha256),
    index('evidence_file_uploaded_by_user_id_idx').on(t.uploadedByUserId),
    check('evidence_file_scan_status_check', inList(t.scanStatus.name, SCAN_STATUSES)),
    check('evidence_file_sha256_format', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('evidence_file_original_sha256_format', sql`${t.originalSha256} IS NULL OR ${t.originalSha256} ~ '^[0-9a-f]{64}$'`),
    // M10a: only the four types the upload accepts, by their magic bytes (plan §6.4).
    check('evidence_file_mime_check', inList(t.mime.name, EVIDENCE_MIME_TYPES)),
    check('evidence_file_original_name_length', sql`${t.originalName} IS NULL OR char_length(${t.originalName}) BETWEEN 1 AND ${sql.raw(String(EVIDENCE_NAME_MAX))}`),
    // DEFAULT D25: at most 20 MB per file.
    check('evidence_file_size_check', sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= ${sql.raw(String(EVIDENCE_MAX_BYTES))}`),
  ],
);

export const reviewCase = pgTable(
  'review_case',
  {
    id: idColumn(),
    kind: text('kind', { enum: REVIEW_CASE_KINDS }).notNull(),
    status: text('status', { enum: REVIEW_CASE_STATUSES }).notNull().default('open'),
    relationshipId: uuid('relationship_id').references(() => teachingRelationship.id, { onDelete: 'set null' }),
    personId: uuid('person_id').references(() => person.id, { onDelete: 'set null' }),
    schoolId: uuid('school_id').references(() => school.id, { onDelete: 'set null' }),
    openedByUserId: uuid('opened_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    assignedToUserId: uuid('assigned_to_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    resolution: text('resolution', { enum: REVIEW_RESOLUTIONS }),
    resolutionReason: text('resolution_reason'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('review_case_status_idx').on(t.status, t.kind),
    index('review_case_relationship_id_idx').on(t.relationshipId),
    index('review_case_person_id_idx').on(t.personId),
    index('review_case_school_id_idx').on(t.schoolId),
    index('review_case_assigned_to_user_id_idx').on(t.assignedToUserId),
    index('review_case_opened_by_user_id_idx').on(t.openedByUserId),
    // M10a: at most one case of a kind is open for a relationship at a time (a double submit of a
    // historical claim cannot open two).
    uniqueIndex('review_case_one_open_per_relationship_key')
      .on(t.relationshipId, t.kind)
      .where(sql`${t.relationshipId} IS NOT NULL AND ${inList(t.status.name, OPEN_REVIEW_CASE_STATUSES)}`),
    check('review_case_kind_check', inList(t.kind.name, REVIEW_CASE_KINDS)),
    check('review_case_status_check', inList(t.status.name, REVIEW_CASE_STATUSES)),
    check('review_case_resolution_check', sql`${t.resolution} IS NULL OR ${inList(t.resolution.name, REVIEW_RESOLUTIONS)}`),
  ],
);

/** Links an evidence file to exactly one subject. */
export const evidenceLink = pgTable(
  'evidence_link',
  {
    id: idColumn(),
    evidenceFileId: uuid('evidence_file_id')
      .notNull()
      .references(() => evidenceFile.id, { onDelete: 'cascade' }),
    reviewCaseId: uuid('review_case_id').references(() => reviewCase.id, { onDelete: 'cascade' }),
    relationshipId: uuid('relationship_id').references(() => teachingRelationship.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => person.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdByUserId: uuid('created_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    index('evidence_link_evidence_file_id_idx').on(t.evidenceFileId),
    index('evidence_link_review_case_id_idx').on(t.reviewCaseId),
    index('evidence_link_relationship_id_idx').on(t.relationshipId),
    index('evidence_link_person_id_idx').on(t.personId),
    index('evidence_link_created_by_user_id_idx').on(t.createdByUserId),
    check('evidence_link_one_subject', sql`num_nonnulls(${t.reviewCaseId}, ${t.relationshipId}, ${t.personId}) = 1`),
  ],
);

export const reviewNote = pgTable(
  'review_note',
  {
    id: idColumn(),
    reviewCaseId: uuid('review_case_id')
      .notNull()
      .references(() => reviewCase.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    // Internal notes are for reviewers only; the others are shown to the parties (needs_info).
    isInternal: boolean('is_internal').notNull().default(true),
    // M10a (plan §5.6): the idempotency key of the form that added the note; a second submit with
    // the same key from the same account adds nothing.
    idempotencyKey: text('idempotency_key'),
    ...timestamps(),
  },
  (t) => [
    index('review_note_review_case_id_idx').on(t.reviewCaseId, t.createdAt),
    index('review_note_author_user_id_idx').on(t.authorUserId),
    uniqueIndex('review_note_idempotency_key')
      .on(t.authorUserId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    check('review_note_idempotency_key_format', sql`${t.idempotencyKey} IS NULL OR ${t.idempotencyKey} ~ '^[A-Za-z0-9_-]{8,64}$'`),
    check('review_note_body_not_blank', sql`btrim(${t.body}) <> ''`),
  ],
);

export const contentReport = pgTable(
  'content_report',
  {
    id: idColumn(),
    subjectType: text('subject_type', { enum: REPORT_SUBJECTS }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    reason: text('reason', { enum: REPORT_REASONS }).notNull(),
    details: text('details'),
    reporterUserId: uuid('reporter_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    status: text('status', { enum: REPORT_STATUSES }).notNull().default('open'),
    reviewCaseId: uuid('review_case_id').references(() => reviewCase.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    index('content_report_subject_idx').on(t.subjectType, t.subjectId),
    index('content_report_status_idx').on(t.status),
    index('content_report_reporter_user_id_idx').on(t.reporterUserId),
    check('content_report_subject_type_check', inList(t.subjectType.name, REPORT_SUBJECTS)),
    check('content_report_reason_check', inList(t.reason.name, REPORT_REASONS)),
    check('content_report_status_check', inList(t.status.name, REPORT_STATUSES)),
  ],
);
