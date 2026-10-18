// Schools and geography (plan §6.2, §6.4). The exact point of a school lives in a separate
// table that the public role cannot read; school.public_point is the exact point for
// location_privacy = 'exact' and the city centroid for 'city_only'. The trigger
// school_city_only_point (drizzle/*_school_public_point_and_views) enforces the centroid for
// city_only whoever writes the row, so the radius query of plan §6.3 can run on public_point.

import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import {
  deletedAt,
  idColumn,
  inList,
  LOCATION_PRIVACIES,
  SCHOOL_INSTRUCTOR_ROLES,
  SCHOOL_STATUSES,
  timestamps,
} from './common';
import { geographyPoint } from './geography';
import { person, SLUG_PATTERN } from './persons';

/** Cities from GeoNames (CC BY 4.0, https://www.geonames.org/). */
export const place = pgTable(
  'place',
  {
    id: idColumn(),
    geonamesId: integer('geonames_id').notNull(),
    name: text('name').notNull(),
    asciiName: text('ascii_name').notNull(),
    countryCode: text('country_code').notNull(),
    admin1Code: text('admin1_code'),
    featureCode: text('feature_code'),
    population: integer('population'),
    timezone: text('timezone'),
    centroid: geographyPoint('centroid').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('place_geonames_id_key').on(t.geonamesId),
    index('place_country_code_idx').on(t.countryCode),
    index('place_centroid_gist_idx').using('gist', t.centroid),
    check('place_country_code_format', sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
  ],
);

export const school = pgTable(
  'school',
  {
    id: idColumn(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    placeId: uuid('place_id')
      .notNull()
      .references(() => place.id, { onDelete: 'restrict' }),
    locationPrivacy: text('location_privacy', { enum: LOCATION_PRIVACIES }).notNull().default('city_only'),
    publicPoint: geographyPoint('public_point').notNull(),
    status: text('status', { enum: SCHOOL_STATUSES }).notNull().default('draft'),
    description: text('description'),
    websiteUrl: text('website_url'),
    // DEFAULT D17: changes only when the school is edited or confirmed, never on sign-in.
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => authUser.id, { onDelete: 'restrict' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('school_slug_key').on(t.slug),
    index('school_place_id_idx').on(t.placeId),
    index('school_status_idx').on(t.status),
    index('school_created_by_user_id_idx').on(t.createdByUserId),
    index('school_public_point_gist_idx').using('gist', t.publicPoint),
    check('school_slug_format', sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`),
    check('school_location_privacy_check', inList(t.locationPrivacy.name, LOCATION_PRIVACIES)),
    check('school_status_check', inList(t.status.name, SCHOOL_STATUSES)),
  ],
);

/** The exact location: never readable by app_public_ro (plan §6.4). */
export const schoolPrivateLocation = pgTable(
  'school_private_location',
  {
    schoolId: uuid('school_id')
      .primaryKey()
      .references(() => school.id, { onDelete: 'cascade' }),
    exactPoint: geographyPoint('exact_point').notNull(),
    addressLine: text('address_line'),
    ...timestamps(),
  },
  (t) => [index('school_private_location_exact_point_gist_idx').using('gist', t.exactPoint)],
);

export const schoolInstructor = pgTable(
  'school_instructor',
  {
    schoolId: uuid('school_id')
      .notNull()
      .references(() => school.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    role: text('role', { enum: SCHOOL_INSTRUCTOR_ROLES }).notNull().default('instructor'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'school_instructor_pkey', columns: [t.schoolId, t.personId] }),
    index('school_instructor_person_id_idx').on(t.personId),
    check('school_instructor_role_check', inList(t.role.name, SCHOOL_INSTRUCTOR_ROLES)),
  ],
);
