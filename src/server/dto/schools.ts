// The public DTOs of the school finder (milestone M11; plan §6.4). Every answer of schools.search,
// schools.inViewport, schools.list and schools.get has one of these shapes, and only a value that
// went through one of the `toPublic…` functions below may enter a 'use cache' function or leave a
// procedure: z.object() drops every key the schema does not name.
//
// The location rule (plan §6.4): `point` is the exact point only for a school whose location
// privacy is `exact`; for `city_only` it is the city's centroid and `precision` is "city". Both
// come from v_public_school, which never holds the exact point of a city_only school, and a
// distance is whole kilometres from that public point, so many requests from different centres
// cannot triangulate anything finer.

import * as z from 'zod';

import { searchNameSchema } from './search';

/** Degrees, rounded to 5 decimals (about a metre) by the service. */
export const geoPointSchema = z.object({ lat: z.number(), lng: z.number() });
export type GeoPointDto = z.infer<typeof geoPointSchema>;

export const precisionSchema = z.enum(['exact', 'city']);

export const schoolInstructorRefSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  /** The primary display name (Latin script, plan §5.3). */
  displayName: searchNameSchema,
});
export type SchoolInstructorRefDto = z.infer<typeof schoolInstructorRefSchema>;

export const schoolPinSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  precision: precisionSchema,
  point: geoPointSchema,
  city: z.string(),
  countryCode: z.string(),
  /** The school's public instructors, the head instructor first. */
  instructors: z.array(schoolInstructorRefSchema),
  /** Whole kilometres from the search centre to the public point; null without a centre. */
  distanceKm: z.number().int().nullable(),
});
export type SchoolPinDto = z.infer<typeof schoolPinSchema>;

export const lineageFilterSchema = z.object({
  /** The person at the root of the lineage: the filter is "descends from this person". */
  rootId: z.uuid(),
  rootSlug: z.string(),
  rootName: z.string(),
});

export const schoolSearchSchema = z.object({
  schools: z.array(schoolPinSchema),
  /** Every public school that matches, of which `schools` holds the nearest (at most the limit). */
  total: z.number().int(),
  center: geoPointSchema.nullable(),
  radiusKm: z.number().int().nullable(),
  lineage: lineageFilterSchema.nullable(),
});
export type SchoolSearchDto = z.infer<typeof schoolSearchSchema>;

export const schoolFormSchema = z.object({ key: z.string(), label: z.string() });

export const schoolPageInstructorSchema = schoolInstructorRefSchema.extend({
  role: z.enum(['head_instructor', 'instructor', 'assistant']),
  /** The original-script name, when the person has one public (plan §5.3). */
  original: searchNameSchema.nullable(),
  /** The lineages of the instructor's public relationships, for the explorer and the list view. */
  lineages: z.array(z.object({ id: z.uuid(), slug: z.string(), name: z.string() })),
});

export const schoolPageSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  precision: precisionSchema,
  point: geoPointSchema,
  city: z.string(),
  countryCode: z.string(),
  description: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  forms: z.array(schoolFormSchema),
  /** When the listing was last edited or confirmed (DEFAULT D17), as YYYY-MM-DD. */
  lastActivityOn: z.string(),
  instructors: z.array(schoolPageInstructorSchema),
});
export type SchoolPageDto = z.infer<typeof schoolPageSchema>;

/** A school of the sitemap: its address and when it last changed. */
export const schoolSitemapSchema = z.array(z.object({ slug: z.string(), updatedAt: z.string() }));
export type SchoolSitemapDto = z.infer<typeof schoolSitemapSchema>;

export const placeHitSchema = z.object({ id: z.uuid(), name: z.string(), countryCode: z.string() });
export const placeSearchSchema = z.object({ places: z.array(placeHitSchema) });
export type PlaceSearchDto = z.infer<typeof placeSearchSchema>;

export function toPublicSchoolSearch(value: SchoolSearchDto): SchoolSearchDto {
  return schoolSearchSchema.parse(value);
}

export function toPublicSchoolPage(value: SchoolPageDto): SchoolPageDto {
  return schoolPageSchema.parse(value);
}

export function toPublicSchoolSitemap(value: SchoolSitemapDto): SchoolSitemapDto {
  return schoolSitemapSchema.parse(value);
}
