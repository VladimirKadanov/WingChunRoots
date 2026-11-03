// Organizations (M01 skeleton; milestone M15: application, review and administration; plan §6.2,
// docs/adr/0018-organizations.md).
//
// DEFAULT D12: three separate records. organization_membership is a person's affiliation with an
// organization (history, never authority); organization_admin is an account's authority over an
// organization (who manages it); teaching_relationship is the teaching history, which no
// organization action creates, verifies or edits. organization_school links a school that accepted
// it; the school and its pin never depend on the link (pins through a federation are Phase 3).
// DEFAULT D04: the organization's approval (status), its plan (entitlement_grant) and any
// verification of a person are three states, shown apart.

import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import {
  deletedAt,
  idColumn,
  inList,
  ORGANIZATION_ADMIN_ROLES,
  ORGANIZATION_KINDS,
  ORGANIZATION_ROLES,
  ORGANIZATION_SCHOOL_STATUSES,
  ORGANIZATION_SCHOOLS_ESTIMATE_MAX,
  ORGANIZATION_STATUSES,
  timestamps,
} from './common';
import { person, SLUG_PATTERN } from './persons';
import { school } from './schools';

export const organization = pgTable(
  'organization',
  {
    id: idColumn(),
    slug: text('slug').notNull(),
    /** The official name (Latin script, plan §5.3). */
    name: text('name').notNull(),
    kind: text('kind', { enum: ORGANIZATION_KINDS }).notNull(),
    status: text('status', { enum: ORGANIZATION_STATUSES }).notNull().default('pending'),
    /** The headquarters' country (ISO 3166-1 alpha-2). */
    countryCode: text('country_code'),
    websiteUrl: text('website_url'),
    // M15: the application (specification §4.3). The leader's name and title are for the reviewers
    // and the organization's admins only: the public page names a leader only through a public
    // person's membership (DEFAULT D03).
    leaderName: text('leader_name'),
    leaderTitle: text('leader_title'),
    schoolsEstimate: integer('schools_estimate'),
    /** The account that applied (the first owner); kept when that account is deleted (SET NULL). */
    createdByUserId: uuid('created_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByUserId: uuid('approved_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('organization_slug_key').on(t.slug),
    index('organization_created_by_user_id_idx').on(t.createdByUserId),
    index('organization_approved_by_user_id_idx').on(t.approvedByUserId),
    check('organization_slug_format', sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`),
    check('organization_kind_check', inList(t.kind.name, ORGANIZATION_KINDS)),
    check('organization_status_check', inList(t.status.name, ORGANIZATION_STATUSES)),
    check('organization_country_code_format', sql`${t.countryCode} IS NULL OR ${t.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      'organization_schools_estimate_range',
      sql`${t.schoolsEstimate} IS NULL OR ${t.schoolsEstimate} BETWEEN 0 AND ${sql.raw(String(ORGANIZATION_SCHOOLS_ESTIMATE_MAX))}`,
    ),
    check('organization_name_not_blank', sql`btrim(${t.name}) <> ''`),
  ],
);

export const organizationMembership = pgTable(
  'organization_membership',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ORGANIZATION_ROLES }).notNull().default('member'),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('organization_membership_key').on(t.organizationId, t.personId),
    index('organization_membership_person_id_idx').on(t.personId),
    check('organization_membership_role_check', inList(t.role.name, ORGANIZATION_ROLES)),
    check('organization_membership_dates', sql`${t.endsOn} IS NULL OR ${t.startsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
  ],
);

/**
 * M15 (DEFAULT D12): an account's authority over an organization, apart from any person's
 * membership. The applicant is its first owner; an owner adds and removes admins. A revoked row is
 * kept (who had authority, and until when).
 */
export const organizationAdmin = pgTable(
  'organization_admin',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ORGANIZATION_ADMIN_ROLES }).notNull().default('admin'),
    grantedByUserId: uuid('granted_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('organization_admin_one_active_key').on(t.organizationId, t.userId).where(sql`${t.revokedAt} IS NULL`),
    index('organization_admin_user_id_idx').on(t.userId),
    index('organization_admin_granted_by_user_id_idx').on(t.grantedByUserId),
    index('organization_admin_revoked_by_user_id_idx').on(t.revokedByUserId),
    check('organization_admin_role_check', inList(t.role.name, ORGANIZATION_ADMIN_ROLES)),
  ],
);

/**
 * M15: a school's link to an organization, asked by the organization and answered by the school's
 * listing account. At most one pending or accepted link per pair. DEFAULT D12: no pin through it.
 */
export const organizationSchool = pgTable(
  'organization_school',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => school.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ORGANIZATION_SCHOOL_STATUSES }).notNull().default('pending'),
    requestedByUserId: uuid('requested_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    answeredByUserId: uuid('answered_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    endedByUserId: uuid('ended_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('organization_school_one_open_key')
      .on(t.organizationId, t.schoolId)
      .where(sql`${inList(t.status.name, ['pending', 'accepted'])}`),
    index('organization_school_school_id_idx').on(t.schoolId),
    index('organization_school_requested_by_user_id_idx').on(t.requestedByUserId),
    index('organization_school_answered_by_user_id_idx').on(t.answeredByUserId),
    index('organization_school_ended_by_user_id_idx').on(t.endedByUserId),
    check('organization_school_status_check', inList(t.status.name, ORGANIZATION_SCHOOL_STATUSES)),
    check('organization_school_answered_has_time', sql`${t.status} NOT IN ('accepted', 'refused') OR ${t.answeredAt} IS NOT NULL`),
    check('organization_school_ended_has_time', sql`${t.status} <> 'ended' OR ${t.endedAt} IS NOT NULL`),
  ],
);
