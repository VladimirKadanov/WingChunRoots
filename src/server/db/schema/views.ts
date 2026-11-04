// The public views, the only relations app_public_ro can read (plan §6.2, §6.4). They are
// created in the custom migration drizzle/*_roles_views_audit (SQL kept compatible with
// PostgreSQL 16+) and declared here with .existing(), so Drizzle can query them but drizzle-kit
// never tries to manage them.

import { boolean, integer, jsonb, pgView, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { geographyPoint } from './geography';

export interface PublicName {
  value: string;
  script: string;
  lang: string;
  kind: string;
  romanization: string | null;
}

export interface PublicPeriod {
  startsOn: string | null;
  endsOn: string | null;
  precision: string;
  ongoing: boolean;
}

/** People with visibility = 'public' that are not deleted. No birth date, no account ids. */
export const vPublicPerson = pgView('v_public_person', {
  id: uuid('id').notNull(),
  slug: text('slug').notNull(),
  kind: text('kind').notNull(),
  lifeStatus: text('life_status').notNull(),
  stewardship: text('stewardship').notNull(),
  countryCode: text('country_code'),
  displayName: text('display_name').notNull(),
  altNames: jsonb('alt_names').$type<PublicName[]>().notNull(),
  bio: text('bio'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  // M04: the city of residence or activity, at city level only (never a point).
  cityName: text('city_name'),
  // M10b (plan §6.5, DEFAULT D04/D13): 'verified' or 'unverified' for the record of a Sifu account
  // ("Instructor" or "Instructor (unverified)"), null for anyone else. Never the account itself.
  instructorStatus: text('instructor_status'),
  // M14 (docs/adr/0016-profile-photos.md): the current profile photo, only while it is active;
  // the app builds its address from the id and the content hash. Never the storage key.
  photoId: uuid('photo_id'),
  photoSha256: text('photo_sha256'),
}).existing();

/**
 * Relationships with status verified or in_arbitration and visibility = 'public', between two
 * people that v_public_person shows (public, not deleted, a primary name; DEFAULT D03), so every
 * edge points at a node. Counters and lineage_membership read only this view (plan §6.2).
 */
export const vPublicEdge = pgView('v_public_edge', {
  id: uuid('id').notNull(),
  teacherPersonId: uuid('teacher_person_id').notNull(),
  studentPersonId: uuid('student_person_id').notNull(),
  lineageId: uuid('lineage_id').notNull(),
  status: text('status').notNull(),
  verificationPath: text('verification_path').notNull(),
  isDisplayPrimary: boolean('is_display_primary').notNull(),
  visibility: text('visibility').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  periods: jsonb('periods').$type<PublicPeriod[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  // M04: the lineage of the edge. The root is set only when v_public_person shows that person
  // (DEFAULT D22: a lineage's root may be unknown).
  lineageSlug: text('lineage_slug').notNull(),
  lineageName: text('lineage_name').notNull(),
  lineageRootPersonId: uuid('lineage_root_person_id'),
  // M10b (DEFAULT D04/D13): the teacher approved it from their own account and no archivist has
  // verified them as an instructor yet ("Approved by an unverified instructor").
  approvedByUnverifiedInstructor: boolean('approved_by_unverified_instructor').notNull(),
}).existing();

/**
 * Published schools. public_point is the city centroid for city_only schools (a trigger keeps
 * school.public_point so, and the view substitutes the centroid once more); the exact point is
 * never part of this view (plan §6.4). precision is 'exact' or 'city'.
 */
export const vPublicSchool = pgView('v_public_school', {
  id: uuid('id').notNull(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  locationPrivacy: text('location_privacy').notNull(),
  precision: text('precision').notNull(),
  publicPoint: geographyPoint('public_point').notNull(),
  placeId: uuid('place_id').notNull(),
  cityName: text('city_name').notNull(),
  countryCode: text('country_code').notNull(),
  description: text('description'),
  websiteUrl: text('website_url'),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
  instructorPersonIds: uuid('instructor_person_ids').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  // M11 (migration m11_schools_map): the listing's contact and forms.
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  formsTaught: text('forms_taught').array().notNull(),
}).existing();

/**
 * M15: approved organizations (status 'active', not deleted). The public identity only: no
 * applicant, no leader's name or title (a leader is named only through a public person's
 * membership, DEFAULT D03), no supporting document, no admins, no plan. app_public_ro reads it.
 */
export const vPublicOrganization = pgView('v_public_organization', {
  id: uuid('id').notNull(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  countryCode: text('country_code'),
  websiteUrl: text('website_url'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();

/** M17: a public person or organization named on an event (the organizer, an instructor). */
export interface PublicEventPerson {
  id: string;
  slug: string;
  display_name: string;
  lang: string | null;
}

/**
 * M17 (docs/adr/0020-events.md): the events the public sees, published or cancelled (never a
 * removed one), with their public fields only. The organizer and the instructors appear only while
 * v_public_person (or v_public_organization) shows them; a school only while v_public_school does,
 * by name and city (never a point); the place by its city and country. No account id, no staff's
 * reason, no storage key (the poster by id and content hash only). app_public_ro and app_rw read it.
 */
export const vPublicEvent = pgView('v_public_event', {
  id: uuid('id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  kind: text('kind').notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  timezone: text('timezone').notNull(),
  online: boolean('online').notNull(),
  venue: text('venue'),
  placeId: uuid('place_id'),
  cityName: text('city_name'),
  countryCode: text('country_code'),
  externalUrl: text('external_url'),
  status: text('status').notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationNote: text('cancellation_note'),
  organizerPersonId: uuid('organizer_person_id'),
  organizerPersonSlug: text('organizer_person_slug'),
  organizerPersonName: text('organizer_person_name'),
  organizerPersonLang: text('organizer_person_lang'),
  organizationId: uuid('organization_id'),
  organizationSlug: text('organization_slug'),
  organizationName: text('organization_name'),
  schoolId: uuid('school_id'),
  schoolSlug: text('school_slug'),
  schoolName: text('school_name'),
  schoolCity: text('school_city'),
  instructors: jsonb('instructors').$type<PublicEventPerson[]>().notNull(),
  posterSha256: text('poster_sha256'),
  posterWidth: integer('poster_width'),
  posterHeight: integer('poster_height'),
  revision: integer('revision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}).existing();
