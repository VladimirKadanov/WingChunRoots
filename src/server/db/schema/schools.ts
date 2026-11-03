// Schools and geography (plan §6.2, §6.4). The exact point of a school lives in a separate
// table that the public role cannot read; school.public_point is the exact point for
// location_privacy = 'exact' and the city centroid for 'city_only'. The trigger
// school_city_only_point (drizzle/*_school_public_point_and_views) enforces the centroid for
// city_only whoever writes the row, so the radius query of plan §6.3 can run on public_point.

import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import {
  deletedAt,
  idColumn,
  inList,
  LOCATION_PRIVACIES,
  PHOTO_CAPTION_MAX,
  PHOTO_FULL_MAX_SIDE,
  PHOTO_REASON_MAX,
  SCHOOL_FORMS,
  SCHOOL_PHOTO_KINDS,
  SCHOOL_PHOTO_STATUSES,
  SCHOOL_INSTRUCTOR_ROLES,
  SCHOOL_STATUSES,
  timestamps,
} from './common';
import { geographyPoint } from './geography';
import { person, SLUG_PATTERN } from './persons';

/**
 * An alternate name of a place (M11): used for search only, never shown. `lang` is the ISO 639
 * code when the source names it (GeoNames alternateNamesV2), null when only the script is known
 * (the `alternatenames` column of the cities files); `script` is ISO 15924 (Cyrl, Hani).
 */
export interface PlaceAltName {
  value: string;
  script: string;
  lang: string | null;
}

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
    // M11: the English name is shown; these serve the city search (src/server/geo/places.ts).
    alternateNames: jsonb('alternate_names').$type<PlaceAltName[]>().notNull().default([]),
    /** Every name of the place, folded for search (src/server/geo/places.ts), one per line. */
    searchText: text('search_text').notNull().default(''),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('place_geonames_id_key').on(t.geonamesId),
    index('place_country_code_idx').on(t.countryCode),
    index('place_centroid_gist_idx').using('gist', t.centroid),
    index('place_search_text_trgm_idx').using('gin', t.searchText.op('gin_trgm_ops')),
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
    // M11: the ways to get in touch that the listing shows (all optional) and the forms it teaches.
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    formsTaught: text('forms_taught', { enum: SCHOOL_FORMS }).array().notNull().default([]),
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
    check('school_name_length', sql`char_length(${t.name}) BETWEEN 2 AND 120`),
    check('school_forms_taught_check', sql`${t.formsTaught} <@ ARRAY[${sql.raw(SCHOOL_FORMS.map((f) => `'${f}'`).join(', '))}]::text[]`),
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

/**
 * M16 (docs/adr/0019-galleries.md): a school's logo (kind `logo`, at most one active) and the
 * photos of its training rooms (kind `room`, at most SCHOOL_ROOM_PHOTOS_MAX active, DEFAULT D07),
 * a gallery apart from every person's. Stored like profile photos (src/server/storage/photo.ts):
 * decoded, turned upright, every metadata block (EXIF with its GPS position) dropped and encoded
 * again as WebP under `<storage_key>/<rendition>` in the photo store, never in the evidence store.
 * The logo is fitted whole into a transparent square (96 and 512 px); a room photo is a centred
 * square (96 and 512 px) and the whole photo (`full`, at most PHOTO_FULL_MAX_SIDE). Shown only
 * while the school is public (v_public_school); a replaced or removed photo keeps its row (who and
 * why) while its files are deleted. app_public_ro has no right on the table.
 */
export const schoolPhoto = pgTable(
  'school_photo',
  {
    id: idColumn(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => school.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SCHOOL_PHOTO_KINDS }).notNull(),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    originalSha256: text('original_sha256'),
    // The square renditions' largest side (96 to 512).
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    fullWidth: integer('full_width'),
    fullHeight: integer('full_height'),
    sizeBytes: integer('size_bytes').notNull(),
    caption: text('caption'),
    position: integer('position').notNull().default(0),
    status: text('status', { enum: SCHOOL_PHOTO_STATUSES }).notNull().default('active'),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    removedByUserId: uuid('removed_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removalReason: text('removal_reason'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('school_photo_storage_key_key').on(t.storageKey),
    // One logo per school.
    uniqueIndex('school_photo_one_logo_key').on(t.schoolId).where(sql`${t.kind} = 'logo' AND ${t.status} = 'active'`),
    index('school_photo_school_idx').on(t.schoolId, t.kind, t.position).where(sql`${t.status} = 'active'`),
    index('school_photo_uploaded_by_user_id_idx').on(t.uploadedByUserId),
    index('school_photo_removed_by_user_id_idx').on(t.removedByUserId),
    check('school_photo_kind_check', inList(t.kind.name, SCHOOL_PHOTO_KINDS)),
    check('school_photo_status_check', inList(t.status.name, SCHOOL_PHOTO_STATUSES)),
    check('school_photo_storage_key_format', sql`${t.storageKey} ~ '^photos/[0-9a-f]{48}$'`),
    check('school_photo_sha256_format', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('school_photo_original_sha256_format', sql`${t.originalSha256} IS NULL OR ${t.originalSha256} ~ '^[0-9a-f]{64}$'`),
    check('school_photo_square', sql`${t.width} = ${t.height} AND ${t.width} BETWEEN 96 AND 512`),
    check(
      'school_photo_full_size',
      sql`(${t.fullWidth} IS NULL AND ${t.fullHeight} IS NULL) OR (${t.fullWidth} BETWEEN 1 AND ${sql.raw(String(PHOTO_FULL_MAX_SIDE))} AND ${t.fullHeight} BETWEEN 1 AND ${sql.raw(String(PHOTO_FULL_MAX_SIDE))})`,
    ),
    check('school_photo_size_check', sql`${t.sizeBytes} > 0`),
    check('school_photo_caption_length', sql`${t.caption} IS NULL OR char_length(${t.caption}) BETWEEN 1 AND ${sql.raw(String(PHOTO_CAPTION_MAX))}`),
    check('school_photo_removed_has_time', sql`${t.status} <> 'removed' OR ${t.removedAt} IS NOT NULL`),
    check('school_photo_reason_length', sql`${t.removalReason} IS NULL OR char_length(${t.removalReason}) BETWEEN 1 AND ${sql.raw(String(PHOTO_REASON_MAX))}`),
  ],
);
