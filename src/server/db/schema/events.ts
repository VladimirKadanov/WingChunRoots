// The event calendar (milestone M17; specification §3.1 row Events, §11.1; docs/adr/0020-events.md).
//
// An event is organized either by a Sifu's account (organizer_user_id, with that account's own
// person: organizer_person_id) or by an organization (organization_id, M15); never both. Its time
// is an instant range (timestamptz) and its own IANA zone, in which every page shows it. Its place
// is a city (place) or online; `venue` is a line the organizer writes and publishes, never taken
// from a school's private address (plan §6.4). An optional school is the organizer's own listed
// school or one linked to the organization. The poster is stored like a gallery photo (no EXIF,
// GPS, XMP or IPTC) in the photo store, apart from every gallery and every allowance.
//
// DEFAULT M17 (question 2): published at once, no review first. The organizer cancels (the event
// stays shown, "Cancelled"); staff with a verified second factor remove it with a reason (audited;
// 404 everywhere). app_public_ro reads only v_public_event (the migration), never these tables.

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_KINDS,
  EVENT_REASON_MAX,
  EVENT_STATUSES,
  EVENT_TITLE_MAX,
  EVENT_URL_MAX,
  EVENT_VENUE_MAX,
  idColumn,
  inList,
  PHOTO_FULL_MAX_SIDE,
  timestamps,
} from './common';
import { organization } from './organizations';
import { person, SLUG_PATTERN } from './persons';
import { place, school } from './schools';

export const event = pgTable(
  'event',
  {
    id: idColumn(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    kind: text('kind', { enum: EVENT_KINDS }).notNull(),
    description: text('description'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** The event's own IANA zone (checked by the app with Intl; src/lib/event-time.ts). */
    timezone: text('timezone').notNull(),
    online: boolean('online').notNull().default(false),
    placeId: uuid('place_id').references(() => place.id, { onDelete: 'restrict' }),
    /** What the organizer publishes about where (a hall, a park); never a school's private address. */
    venue: text('venue'),
    schoolId: uuid('school_id').references(() => school.id, { onDelete: 'set null' }),
    externalUrl: text('external_url'),
    // The organizer: a Sifu's account and its person, or an organization.
    organizerUserId: uuid('organizer_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    organizerPersonId: uuid('organizer_person_id').references(() => person.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id').references(() => organization.id, { onDelete: 'restrict' }),
    /** The account that published it (for an organization's event, the admin who did). */
    createdByUserId: uuid('created_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    status: text('status', { enum: EVENT_STATUSES }).notNull().default('published'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    /** The organizer's note with the cancellation (public, optional). */
    cancellationNote: text('cancellation_note'),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedByUserId: uuid('removed_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    /** Staff's reason (audited, never public). */
    removalReason: text('removal_reason'),
    // The poster: the whole image (at most PHOTO_FULL_MAX_SIDE) and its 96/512 px squares.
    posterStorageKey: text('poster_storage_key'),
    posterSha256: text('poster_sha256'),
    posterWidth: integer('poster_width'),
    posterHeight: integer('poster_height'),
    posterSizeBytes: integer('poster_size_bytes'),
    /** Bumped by every change (the SEQUENCE of the .ics file). */
    revision: integer('revision').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('event_slug_key').on(t.slug),
    index('event_starts_at_idx').on(t.startsAt).where(sql`${t.status} IN ('published', 'cancelled')`),
    index('event_organizer_user_id_idx').on(t.organizerUserId, t.startsAt),
    index('event_organizer_person_id_idx').on(t.organizerPersonId),
    index('event_organization_id_idx').on(t.organizationId, t.startsAt),
    index('event_place_id_idx').on(t.placeId),
    index('event_school_id_idx').on(t.schoolId),
    index('event_created_by_user_id_idx').on(t.createdByUserId),
    index('event_cancelled_by_user_id_idx').on(t.cancelledByUserId),
    index('event_removed_by_user_id_idx').on(t.removedByUserId),
    uniqueIndex('event_poster_storage_key_key').on(t.posterStorageKey),
    check('event_slug_format', sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`),
    check('event_kind_check', inList(t.kind.name, EVENT_KINDS)),
    check('event_status_check', inList(t.status.name, EVENT_STATUSES)),
    check('event_title_length', sql`char_length(${t.title}) BETWEEN 2 AND ${sql.raw(String(EVENT_TITLE_MAX))}`),
    check('event_description_length', sql`${t.description} IS NULL OR char_length(${t.description}) BETWEEN 1 AND ${sql.raw(String(EVENT_DESCRIPTION_MAX))}`),
    check('event_venue_length', sql`${t.venue} IS NULL OR char_length(${t.venue}) BETWEEN 1 AND ${sql.raw(String(EVENT_VENUE_MAX))}`),
    check('event_ends_after_start', sql`${t.endsAt} > ${t.startsAt}`),
    check('event_timezone_format', sql`${t.timezone} ~ '^[A-Za-z][A-Za-z0-9_+/-]{1,80}$'`),
    // A city or online, never both and never neither; an online event has no venue.
    check('event_place_or_online', sql`(${t.online} AND ${t.placeId} IS NULL AND ${t.venue} IS NULL) OR (NOT ${t.online} AND ${t.placeId} IS NOT NULL)`),
    check('event_external_url_https', sql`${t.externalUrl} IS NULL OR (${t.externalUrl} ~ '^https://[^[:space:]]+$' AND char_length(${t.externalUrl}) <= ${sql.raw(String(EVENT_URL_MAX))})`),
    // A Sifu's event (an account and its person, while the account exists) or an organization's.
    check(
      'event_one_organizer',
      sql`(${t.organizationId} IS NULL AND ${t.organizerPersonId} IS NOT NULL) OR (${t.organizationId} IS NOT NULL AND ${t.organizerPersonId} IS NULL AND ${t.organizerUserId} IS NULL)`,
    ),
    check('event_cancelled_has_time', sql`${t.status} <> 'cancelled' OR ${t.cancelledAt} IS NOT NULL`),
    check('event_removed_has_time', sql`${t.status} <> 'removed' OR ${t.removedAt} IS NOT NULL`),
    check('event_cancellation_note_length', sql`${t.cancellationNote} IS NULL OR char_length(${t.cancellationNote}) BETWEEN 1 AND ${sql.raw(String(EVENT_REASON_MAX))}`),
    check('event_removal_reason_length', sql`${t.removalReason} IS NULL OR char_length(${t.removalReason}) BETWEEN 1 AND ${sql.raw(String(EVENT_REASON_MAX))}`),
    check(
      'event_poster_complete',
      sql`(${t.posterStorageKey} IS NULL AND ${t.posterSha256} IS NULL AND ${t.posterWidth} IS NULL AND ${t.posterHeight} IS NULL AND ${t.posterSizeBytes} IS NULL) OR (${t.posterStorageKey} ~ '^photos/[0-9a-f]{48}$' AND ${t.posterSha256} ~ '^[0-9a-f]{64}$' AND ${t.posterWidth} BETWEEN 1 AND ${sql.raw(String(PHOTO_FULL_MAX_SIDE))} AND ${t.posterHeight} BETWEEN 1 AND ${sql.raw(String(PHOTO_FULL_MAX_SIDE))} AND ${t.posterSizeBytes} > 0)`,
    ),
    check('event_revision_check', sql`${t.revision} >= 0`),
  ],
);

/** M17: up to EVENT_INSTRUCTORS_MAX people of the archive teaching at an event, in order. */
export const eventInstructor = pgTable(
  'event_instructor',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'event_instructor_pkey', columns: [t.eventId, t.personId] }),
    index('event_instructor_person_id_idx').on(t.personId),
    check('event_instructor_position_check', sql`${t.position} BETWEEN 0 AND 4`),
  ],
);
