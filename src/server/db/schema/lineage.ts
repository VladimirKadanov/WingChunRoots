// Lineages and teacher–student relationships (plan §6.2, §6.7). One person is one node; every
// relationship carries its own status, verification path and training periods (DEFAULT D05:
// all active relationships are kept, the display preference is visual only).

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  ACTIVE_RELATIONSHIP_STATUSES,
  DATE_PRECISIONS,
  deletedAt,
  idColumn,
  inList,
  PUBLISHABLE_RELATIONSHIP_STATUSES,
  RELATIONSHIP_STATUSES,
  timestamps,
  VERIFICATION_PATHS,
  VISIBILITIES,
} from './common';
import { person, SLUG_PATTERN } from './persons';

export const lineage = pgTable(
  'lineage',
  {
    id: idColumn(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    // DEFAULT D22: the root may be unknown or disputed, so it can be empty.
    rootPersonId: uuid('root_person_id').references(() => person.id, { onDelete: 'set null' }),
    description: text('description'),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('lineage_slug_key').on(t.slug),
    index('lineage_root_person_id_idx').on(t.rootPersonId),
    check('lineage_slug_format', sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`),
  ],
);

export const teachingRelationship = pgTable(
  'teaching_relationship',
  {
    id: idColumn(),
    teacherPersonId: uuid('teacher_person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'restrict' }),
    studentPersonId: uuid('student_person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'restrict' }),
    lineageId: uuid('lineage_id')
      .notNull()
      .references(() => lineage.id, { onDelete: 'restrict' }),
    status: text('status', { enum: RELATIONSHIP_STATUSES }).notNull(),
    verificationPath: text('verification_path', { enum: VERIFICATION_PATHS }).notNull().default('teacher_approval'),
    // DEFAULT D05: which teacher the explorer draws as the primary line; never hides the others.
    isDisplayPrimary: boolean('is_display_primary').notNull().default(false),
    // DEFAULT D03: private to the people involved and the reviewers until verified.
    visibility: text('visibility', { enum: VISIBILITIES }).notNull().default('involved_only'),
    requestedByUserId: uuid('requested_by_user_id'),
    confirmedByUserId: uuid('confirmed_by_user_id'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    statusReason: text('status_reason'),
    ...timestamps(),
  },
  (t) => [
    check('teaching_relationship_not_self', sql`${t.teacherPersonId} <> ${t.studentPersonId}`),
    check('teaching_relationship_status_check', inList(t.status.name, RELATIONSHIP_STATUSES)),
    check('teaching_relationship_verification_path_check', inList(t.verificationPath.name, VERIFICATION_PATHS)),
    check('teaching_relationship_visibility_check', inList(t.visibility.name, VISIBILITIES)),
    // DEFAULT D03: only a relationship that was verified can be public; requests never are.
    check(
      'teaching_relationship_public_only_after_verification',
      sql`${t.visibility} = 'involved_only' OR ${inList(t.status.name, PUBLISHABLE_RELATIONSHIP_STATUSES)}`,
    ),
    // One active relationship per (teacher, student, lineage); ended requests may repeat.
    uniqueIndex('teaching_relationship_active_key')
      .on(t.teacherPersonId, t.studentPersonId, t.lineageId)
      .where(inList(t.status.name, ACTIVE_RELATIONSHIP_STATUSES)),
    // At most one display-primary teacher per student among the active relationships.
    uniqueIndex('teaching_relationship_one_display_primary_key')
      .on(t.studentPersonId)
      .where(sql`${t.isDisplayPrimary} AND ${inList(t.status.name, ACTIVE_RELATIONSHIP_STATUSES)}`),
    index('teaching_relationship_lineage_id_idx').on(t.lineageId),
    // The covering indexes (student|teacher) INCLUDE (...) are created in the custom migration
    // drizzle/*_roles_views_audit: Drizzle's index builder has no INCLUDE clause.
  ],
);

/** One or more training periods per relationship; coarse dates are stored as the first day. */
export const trainingPeriod = pgTable(
  'training_period',
  {
    id: idColumn(),
    relationshipId: uuid('relationship_id')
      .notNull()
      .references(() => teachingRelationship.id, { onDelete: 'cascade' }),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    precision: text('precision', { enum: DATE_PRECISIONS }).notNull().default('unknown'),
    ongoing: boolean('ongoing').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index('training_period_relationship_id_idx').on(t.relationshipId),
    check('training_period_precision_check', inList(t.precision.name, DATE_PRECISIONS)),
    check('training_period_ongoing_has_no_end', sql`NOT ${t.ongoing} OR ${t.endsOn} IS NULL`),
    check(
      'training_period_end_after_start',
      sql`${t.endsOn} IS NULL OR ${t.startsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`,
    ),
    check(
      'training_period_unknown_has_no_dates',
      sql`${t.precision} <> 'unknown' OR (${t.startsOn} IS NULL AND ${t.endsOn} IS NULL)`,
    ),
  ],
);

/**
 * The full status history of every relationship. Append-only: app_rw has SELECT and INSERT, and
 * the foreign key is RESTRICT, so deleting a relationship cannot remove its history through a
 * cascade (referential actions run with the table owner's rights). Relationships are never
 * deleted; they end (plan §6.7).
 */
export const relationshipEvent = pgTable(
  'relationship_event',
  {
    id: idColumn(),
    relationshipId: uuid('relationship_id')
      .notNull()
      .references(() => teachingRelationship.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status', { enum: RELATIONSHIP_STATUSES }),
    toStatus: text('to_status', { enum: RELATIONSHIP_STATUSES }).notNull(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    reason: text('reason'),
    ...timestamps(),
  },
  (t) => [
    index('relationship_event_relationship_id_idx').on(t.relationshipId, t.createdAt),
    check(
      'relationship_event_from_status_check',
      sql`${t.fromStatus} IS NULL OR ${inList(t.fromStatus.name, RELATIONSHIP_STATUSES)}`,
    ),
    check('relationship_event_to_status_check', inList(t.toStatus.name, RELATIONSHIP_STATUSES)),
  ],
);

/**
 * Which lineages a person belongs to, materialised from v_public_edge only (plan §6.2: counters
 * must never reveal private requests). Filled by a pg-boss job from M11; empty in M01.
 */
export const lineageMembership = pgTable(
  'lineage_membership',
  {
    lineageId: uuid('lineage_id')
      .notNull()
      .references(() => lineage.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    // Generations below the lineage root along public edges, when connected.
    depth: integer('depth'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'lineage_membership_pkey', columns: [t.lineageId, t.personId] }),
    index('lineage_membership_person_id_idx').on(t.personId),
    check('lineage_membership_depth_check', sql`${t.depth} IS NULL OR ${t.depth} >= 0`),
  ],
);
