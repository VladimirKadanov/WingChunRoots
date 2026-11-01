// Shared column helpers and the value sets of every status-like column (plan §6.2, §6.7).
//
// Status-like columns are `text` with a CHECK constraint rather than PostgreSQL enums: a later
// milestone can widen a CHECK in an append-only migration and use the new value in the same
// migration batch, which `ALTER TYPE ... ADD VALUE` does not allow inside the migrator's single
// transaction (docs/adr/0002-data-model.md).

import { sql, type SQL } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../ids';

/**
 * Primary key: UUIDv7 from the application ($defaultFn), with DEFAULT gen_random_uuid() as the
 * fallback for hand-written SQL. Never uuidv7() in SQL: PostgreSQL 16 lacks it (plan §3.2).
 */
export const idColumn = () => uuid('id').primaryKey().defaultRandom().$defaultFn(() => uuidv7());

/** created_at and updated_at on every table (plan §6.2). */
export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Soft delete, where a record must stay referable after removal (plan §6.2). */
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

/** `<column> IN ('a', 'b', ...)` for a CHECK constraint. */
export function inList(column: SQL | string, values: readonly string[]): SQL {
  const col = typeof column === 'string' ? sql.identifier(column) : column;
  return sql`${col} IN (${sql.join(
    values.map((v) => sql.raw(`'${v.replaceAll("'", "''")}'`)),
    sql`, `,
  )})`;
}

// --- People (plan §6.2) ----------------------------------------------------------------------
export const PERSON_KINDS = ['living', 'historical'] as const;
export const LIFE_STATUSES = ['living', 'deceased', 'unknown'] as const;
export const STEWARDSHIPS = ['self', 'platform', 'unclaimed'] as const;
// DEFAULT D03: pending relationships and records created by a request stay involved_only.
export const VISIBILITIES = ['involved_only', 'public'] as const;
export const NAME_KINDS = ['name', 'alias', 'romanization'] as const;
export const ROMANIZATIONS = ['jyutping', 'pinyin', 'yale', 'hk_gov', 'bg_streamlined'] as const;
export const NAME_KEY_KINDS = ['latin', 'jyutping', 'pinyin', 'han', 'cyrillic', 'alias'] as const;
export const CLAIM_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export const INVITATION_STATUSES = ['pending', 'accepted', 'expired', 'revoked'] as const;

// --- Lineage (plan §6.2, §6.7) ------------------------------------------------------------------
export const RELATIONSHIP_STATUSES = [
  'pending_teacher',
  'awaiting_claim',
  'under_review',
  'verified',
  'rejected',
  'withdrawn',
  'in_arbitration',
  'revoked',
] as const;
/** Statuses covered by the partial unique index (teacher, student, lineage). */
export const ACTIVE_RELATIONSHIP_STATUSES = [
  'pending_teacher',
  'awaiting_claim',
  'under_review',
  'verified',
  'in_arbitration',
] as const;
/** The only statuses v_public_edge can show (with visibility = 'public'; DEFAULT D03). */
export const PUBLIC_RELATIONSHIP_STATUSES = ['verified', 'in_arbitration'] as const;
/** Statuses that may carry visibility = 'public': the relationship was verified at some point. */
export const PUBLISHABLE_RELATIONSHIP_STATUSES = ['verified', 'in_arbitration', 'revoked'] as const;
export const VERIFICATION_PATHS = ['teacher_approval', 'committee_review'] as const;
export const DATE_PRECISIONS = ['year', 'month', 'day', 'unknown'] as const;

// --- Evidence and moderation (plan §6.2) -------------------------------------------------------
export const SCAN_STATUSES = ['pending', 'clean', 'rejected'] as const;
export const REVIEW_CASE_KINDS = [
  'historical_claim',
  'person_claim',
  'instructor_verification',
  'relationship_dispute',
  'profile_report',
  'school_listing',
  'deletion_request',
] as const;
export const REVIEW_CASE_STATUSES = ['open', 'in_review', 'needs_info', 'resolved', 'dismissed'] as const;
/** M10a: the statuses of a case that still waits for a decision. */
export const OPEN_REVIEW_CASE_STATUSES = ['open', 'in_review', 'needs_info'] as const;
export const REVIEW_RESOLUTIONS = ['approved', 'rejected'] as const;
/**
 * M10b: what a review_event records about a case: opened, assigned or unassigned, a question to its
 * parties (needs_info), evidence added, decided (approve, reject, dismiss) or withdrawn.
 */
export const REVIEW_EVENT_ACTIONS = ['open', 'assign', 'unassign', 'needs_info', 'evidence', 'approve', 'reject', 'dismiss', 'withdraw'] as const;
export const REPORT_SUBJECTS = ['person', 'teaching_relationship', 'school', 'person_name'] as const;
/** M10b: the reasons of "Report profile" (plan §6.2; the milestone's In scope 4). */
export const REPORT_REASONS = ['copyright', 'spam', 'inappropriate', 'misleading'] as const;
/** M10b: the longest details text a report takes. */
export const REPORT_DETAILS_MAX = 1000;
export const REPORT_STATUSES = ['open', 'triaged', 'resolved', 'dismissed'] as const;
// DEFAULT D25: evidence files are at most 20 MB each, and at most 20 files per case (M10a).
export const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
export const EVIDENCE_MAX_FILES_PER_CASE = 20;
/** M10a: the only types an evidence file can have, recognised by their magic bytes (plan §6.4). */
export const EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
/** M10a: the longest stored file name of an evidence file. */
export const EVIDENCE_NAME_MAX = 200;

// --- Schools and geography (plan §6.2) ----------------------------------------------------------
export const LOCATION_PRIVACIES = ['exact', 'city_only'] as const;
/**
 * M11: a listing is a draft, waits for review (a school_listing case of the review queue), then is
 * active. Only an active school can be public, and only while its pin is allowed (v_public_school:
 * DEFAULT D08/D18). `hidden` and `archived` are kept from M01 for moderation and removal.
 */
export const SCHOOL_STATUSES = ['draft', 'pending_review', 'active', 'hidden', 'archived'] as const;
/** M11: the forms a school teaches (the six forms of Wing Chun), stored by key, shown in English. */
export const SCHOOL_FORMS = ['siu_nim_tao', 'chum_kiu', 'biu_jee', 'muk_yan_jong', 'luk_dim_boon_kwan', 'baat_jaam_do'] as const;
export const SCHOOL_INSTRUCTOR_ROLES = ['head_instructor', 'instructor', 'assistant'] as const;

// --- Organizations (skeleton; DEFAULT D12) ----------------------------------------------------------
export const ORGANIZATION_KINDS = ['federation', 'association', 'school_group'] as const;
export const ORGANIZATION_STATUSES = ['pending', 'active', 'suspended'] as const;
export const ORGANIZATION_ROLES = ['leader', 'admin', 'member'] as const;

// --- Entitlements (plan §6.5) ----------------------------------------------------------------------
export const PLAN_CODES = ['free_student', 'premium_student', 'free_sifu', 'pro_sifu', 'federation'] as const;
export const GRANT_SOURCES = ['test_grant', 'complimentary', 'stripe'] as const;
/** What an account calls itself (M08): it picks the free plan (free_student or free_sifu), never a verification (D04). */
export const ACCOUNT_TYPES = ['student', 'sifu'] as const;
/** A request for pilot access to a plan (M08): open until an admin grants that plan or closes it. */
export const PILOT_REQUEST_STATUSES = ['open', 'closed'] as const;

// --- Accounts (Better Auth, M02; plan §3.2) ----------------------------------------------------------
export const USER_ROLES = ['user', 'moderator', 'archivist', 'admin'] as const;
/** Staff roles: only for an account with two_factor_enabled (CHECK auth_user_staff_needs_2fa). */
export const STAFF_ROLES = ['moderator', 'archivist', 'admin'] as const;

// --- Consents, notifications, e-mail ------------------------------------------------------------------
// The four ticks of the sign-up form (terms, privacy_ack, authenticity_declaration and age_18_plus,
// DEFAULT D10) and the optional publication of the own profile at onboarding (plan §6.2).
export const CONSENT_KINDS = [
  'terms',
  'privacy_ack',
  'authenticity_declaration',
  'age_18_plus',
  'publication',
] as const;
export const CONSENT_ACTIONS = ['granted', 'withdrawn'] as const;
export const EMAIL_STATUSES = ['queued', 'sent', 'failed'] as const;
