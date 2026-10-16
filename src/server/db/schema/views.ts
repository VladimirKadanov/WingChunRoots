// The three public views, the only relations app_public_ro can read (plan §6.2, §6.4). They are
// created in the custom migration drizzle/*_roles_views_audit (SQL kept compatible with
// PostgreSQL 16+) and declared here with .existing(), so Drizzle can query them but drizzle-kit
// never tries to manage them.

import { boolean, jsonb, pgView, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
}).existing();

/**
 * Relationships with status verified or in_arbitration and visibility = 'public', between two
 * public people (DEFAULT D03). Counters and lineage_membership read only this view (plan §6.2).
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
}).existing();

/**
 * Published schools. public_point is already the city centroid for city_only schools; the exact
 * point is never part of this view (plan §6.4). precision is 'exact' or 'city'.
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
}).existing();
