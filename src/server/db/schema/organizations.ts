// Organizations (skeleton). DEFAULT D12: membership in an organization is separate from the
// teaching history; federation pins and controls arrive in Phase 3.

import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import {
  deletedAt,
  idColumn,
  inList,
  ORGANIZATION_KINDS,
  ORGANIZATION_ROLES,
  ORGANIZATION_STATUSES,
  timestamps,
} from './common';
import { person, SLUG_PATTERN } from './persons';

export const organization = pgTable(
  'organization',
  {
    id: idColumn(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ORGANIZATION_KINDS }).notNull(),
    status: text('status', { enum: ORGANIZATION_STATUSES }).notNull().default('pending'),
    countryCode: text('country_code'),
    websiteUrl: text('website_url'),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('organization_slug_key').on(t.slug),
    check('organization_slug_format', sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`),
    check('organization_kind_check', inList(t.kind.name, ORGANIZATION_KINDS)),
    check('organization_status_check', inList(t.status.name, ORGANIZATION_STATUSES)),
    check('organization_country_code_format', sql`${t.countryCode} IS NULL OR ${t.countryCode} ~ '^[A-Z]{2}$'`),
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
