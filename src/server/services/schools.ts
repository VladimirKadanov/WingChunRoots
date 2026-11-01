// Schools and the school finder (milestone M11; plan §5.3, §6.2, §6.4, §6.5, §6.8).
//
// Public reads (anyone, no session needed):
//   schools.search      { center?, radiusKm, lineageRootId? }: the public schools within the radius
//                       of a centre, nearest first, or every public school without a centre; the
//                       lineage filter keeps the schools with an instructor in lineage_membership
//                       of a lineage rooted at that person (depth known: they descend from the root)
//   schools.inViewport  the public schools inside the map's bounding box
//   schools.get         a school's public page
//   places.search       cities of the GeoNames extract by any spelling (the forms' city pickers)
//
// The location rule (plan §6.4). Every public answer reads its columns from v_public_school, whose
// point is the city centroid for a city_only school (the exact point stays in
// school_private_location, which app_public_ro cannot read). The radius query is the literal
// ST_DWithin(public_point, ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography, $radius_m) on the
// geography column school.public_point, whose GiST index serves it (the trigger
// school_city_only_point keeps the centroid there for city_only, whoever writes the row); the same
// test on the view's point follows it, so a row whose point disagrees with the view's never
// matches. Distances are whole kilometres from the public point. Those reads join `school` (for the
// index) and lineage_membership (for the filter), which only app_rw reads, so they run as app_rw
// and select the view's columns only.
//
// The public cache (plan §6.4): the answers without a centre and the school pages are 'use cache'
// functions of public DTOs, tagged `schools` (every change to a listing, a pin grant or an account
// type drops it), person:<id> of every instructor (a renamed or hidden person) and, with the
// lineage filter, lineage-membership:<id> (the worker's recompute). They live for minutes, not
// hours: a test plan that ends by its date (no write, so no tag) hides its pins within minutes.
// Answers around a centre or in a viewport are not cached (any point on Earth is a key).
//
// The owner's side (a signed-in Sifu with their own profile):
//   schools.mine, schools.edit       their schools, and one for the editor (the exact point too:
//                                    it is theirs)
//   schools.create, schools.update   a draft; edits of a listed school stay listed, and an edit
//                                    of what it is, where, its website or its instructors opens
//                                    a school_listing case again (RE_REVIEWED_CHANGES)
//   schools.submit                   draft -> pending_review, with one open school_listing case
//                                    (M10a's queue); needs Professional Sifu (school_map, plan
//                                    §6.5), otherwise ENTITLEMENT_REQUIRED and the upgrade prompt
//   schools.confirm                  "This listing is current": last_activity_at (D17)
// DEFAULT D17: last_activity_at changes only on an edit or a confirmation, never on sign-in.
// DEFAULT D08/D18: the pin shows while the account that listed the school holds Professional Sifu;
// revoking the grant hides the pin and keeps the school (v_public_school).
// DEFAULT D12: no pins through an organization before Phase 3; only the listing account counts.
//
// Audit rows name the fields that changed, never a point, an address or a contact (plan §6.4).

import { randomBytes } from 'node:crypto';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { cacheLife } from 'next/cache';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, lineageMembershipTag, personTag, SCHOOLS_TAG, tagCacheEntry } from '../cache';
import { getDb } from '../db';
import { auditLog, authUser, notification, person, place, reviewCase, school, schoolInstructor, schoolPrivateLocation } from '../db/schema';
import { LOCATION_PRIVACIES, OPEN_REVIEW_CASE_STATUSES, PUBLIC_RELATIONSHIP_STATUSES, SCHOOL_FORMS, SCHOOL_INSTRUCTOR_ROLES, SCHOOL_STATUSES } from '../db/schema/common';
import {
  type GeoPointDto,
  type PlaceSearchDto,
  type SchoolPageDto,
  type SchoolPinDto,
  type SchoolSearchDto,
  type SchoolSitemapDto,
  toPublicSchoolPage,
  toPublicSchoolSearch,
  toPublicSchoolSitemap,
} from '../dto/schools';
import { type Executor, requireEntitlement } from '../entitlements/access';
import { feature, upgradeBenefits } from '../entitlements/plans';
import { LISTED_PLACE_MIN_POPULATION, type PlaceSearchHit, searchPlaces } from '../geo/places';
import { DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from '../../lib/school-finder';
import type { RequestMeta } from './context';
import type { UpgradeOffer } from './dashboard';
import { pgErrorOf, ServiceError } from './errors';
import { cleanName } from './names';
import { openPilotRequest, planSummary } from './plans';
import { idempotencyKey } from './relationships';

// --- Constants ---------------------------------------------------------------------------------

// The radius choices (any whole number up to MAX_RADIUS_KM is accepted) live with the finder's
// address state (src/lib/school-finder.ts), which the map island shares.
export { DEFAULT_RADIUS_KM, MAX_RADIUS_KM, RADIUS_CHOICES_KM } from '../../lib/school-finder';
/** At most this many schools in one answer (the nearest; `total` counts them all). */
export const SCHOOL_RESULT_LIMIT = 200;
/** A dropped pin must lie within this distance of the chosen city's centroid. */
export const PIN_MAX_KM_FROM_CITY = 50;

export const SCHOOL_FORM_LABELS: Record<(typeof SCHOOL_FORMS)[number], string> = {
  siu_nim_tao: 'Siu Nim Tao',
  chum_kiu: 'Chum Kiu',
  biu_jee: 'Biu Jee',
  muk_yan_jong: 'Wooden dummy (Muk Yan Jong)',
  luk_dim_boon_kwan: 'Long pole (Luk Dim Boon Kwan)',
  baat_jaam_do: 'Butterfly swords (Baat Jaam Do)',
};

export const SCHOOL_ROLE_LABELS: Record<(typeof SCHOOL_INSTRUCTOR_ROLES)[number], string> = {
  head_instructor: 'Head instructor',
  instructor: 'Instructor',
  assistant: 'Assistant instructor',
};

export const LOCATION_LABELS: Record<(typeof LOCATION_PRIVACIES)[number], string> = {
  exact: 'Exact pin: the address is public',
  city_only: 'City only: private club, by invitation',
};

const NO_SCHOOL = 'No such school.';
const notFound = () => new ServiceError('NOT_FOUND', NO_SCHOOL);
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

// --- Input -------------------------------------------------------------------------------------

// JSON numbers only (M11 review, code-5): every caller sends numbers (the Server Actions parse the
// form's text themselves), so null, '' or true is refused with 400 instead of becoming 0 or 1 (a
// silent search around 0, 0).
const latitude = z.number({ error: 'Give a latitude.' }).min(-90, { error: 'A latitude is between -90 and 90.' }).max(90, { error: 'A latitude is between -90 and 90.' });
const longitude = z.number({ error: 'Give a longitude.' }).min(-180, { error: 'A longitude is between -180 and 180.' }).max(180, { error: 'A longitude is between -180 and 180.' });
const pointInput = z.object({ lat: latitude, lng: longitude });

export const schoolSearchInput = z.object({
  /** The centre of the search; without one, every public school (still filtered by lineage). */
  center: pointInput.nullish(),
  radiusKm: z.number({ error: 'Give the radius in whole kilometres.' }).int({ error: 'Give the radius in whole kilometres.' }).min(1).max(MAX_RADIUS_KM, { error: `Use a radius up to ${MAX_RADIUS_KM} km.` }).default(DEFAULT_RADIUS_KM),
  /** The person at the root of a lineage: only schools with an instructor who descends from them. */
  lineageRootId: z.uuid({ error: 'Choose a lineage from the list.' }).nullish(),
});
export type SchoolSearchInput = z.input<typeof schoolSearchInput>;

/**
 * A map edge's longitude: any finite number. MapLibre's getBounds() goes beyond ±180 when world
 * copies show (west -200, east 160); schoolsInViewport wraps it (M11 review, code-1).
 */
const edgeLongitude = z.number({ error: 'Give a longitude.' }).min(-1e6, { error: 'Give a longitude.' }).max(1e6, { error: 'Give a longitude.' });

export const schoolViewportInput = z
  .object({ west: edgeLongitude, south: latitude, east: edgeLongitude, north: latitude, lineageRootId: z.uuid().nullish() })
  .refine((b) => b.south <= b.north, { error: 'The south edge must be below the north edge.', path: ['south'] });

/** The widest piece of a viewport tested as one geography box (well inside a hemisphere). */
const VIEWPORT_PIECE_DEGREES = 90;
/**
 * Degrees of latitude added to both edges of a piece for the index: more than the bow of a
 * great-circle edge one degree long (about 0.0011° at 45°), so each piece holds the whole box.
 */
const VIEWPORT_INDEX_MARGIN = 0.01;

/**
 * The longitude ranges of a viewport, each within [-180, 180] and at most VIEWPORT_PIECE_DEGREES
 * wide, or null for the whole world (east - west of 360° or more). `west > east` means the box
 * crosses the antimeridian (the old form); longitudes beyond ±180 (MapLibre's world copies) wrap.
 * Exported for the unit test.
 */
export function viewportPieces(west: number, east: number): [number, number][] | null {
  const span = west <= east ? east - west : east - west + 360;
  if (span >= 360) return null;
  const w = ((((west + 180) % 360) + 360) % 360) - 180;
  const e = w + span;
  const ranges: [number, number][] = e <= 180 ? [[w, e]] : [[w, 180], [-180, e - 360]];
  const pieces: [number, number][] = [];
  for (const [from, to] of ranges) {
    for (let start = from; ; start += VIEWPORT_PIECE_DEGREES) {
      const end = Math.min(to, start + VIEWPORT_PIECE_DEGREES);
      pieces.push([start, end]);
      if (end >= to) break;
    }
  }
  return pieces;
}

export const schoolSlugInput = z.object({ slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/, { error: NO_SCHOOL }) });
export const schoolIdInput = z.object({ id: z.uuid({ error: NO_SCHOOL }) });

export const placeSearchInput = z.object({
  q: z.string().max(100).transform((s) => s.normalize('NFC').trim()),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullish()
    .or(z.literal('').transform(() => null)),
});

const optionalText = (max: number, message: string) =>
  z
    .string()
    .max(max * 2, { error: message })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length <= max, { error: message })
    .nullish()
    .transform((s) => (s ? s : null));

export const schoolFieldsInput = z
  .object({
    name: z
      .string({ error: 'Give the school a name.' })
      .max(240, { error: 'Use at most 120 characters.' })
      .transform((s) => cleanName(s))
      .refine((s) => s.length >= 2, { error: 'Give the school a name of at least 2 characters.' })
      .refine((s) => s.length <= 120, { error: 'Use at most 120 characters.' }),
    placeId: z.uuid({ error: 'Choose the city from the list.' }),
    locationPrivacy: z.enum(LOCATION_PRIVACIES, { error: 'Choose how the location is shown.' }),
    /** The dropped pin. Required for an exact location; for city only it is kept private (or left out). */
    point: pointInput.nullish(),
    websiteUrl: optionalText(300, 'Use at most 300 characters.').refine((s) => s === null || /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s), {
      error: 'Give the full address of the website, starting with https://.',
    }),
    contactEmail: optionalText(254, 'Use at most 254 characters.').refine((s) => s === null || z.email().safeParse(s).success, { error: 'Give an e-mail address like name@example.com.' }),
    contactPhone: optionalText(40, 'Use at most 40 characters.').refine((s) => s === null || /^\+?[0-9 ()./-]{5,40}$/.test(s), {
      error: 'Use digits, spaces and + ( ) - only.',
    }),
    description: optionalText(2000, 'Use at most 2000 characters.'),
    formsTaught: z.array(z.enum(SCHOOL_FORMS, { error: 'Choose forms from the list.' })).max(SCHOOL_FORMS.length).default([]),
    /** Other instructors: people you confirmed as your students. You are the head instructor. */
    instructorIds: z.array(z.uuid({ error: 'Choose instructors from the list.' })).max(20, { error: 'List at most 20 instructors.' }).default([]),
  })
  .superRefine((input, ctx) => {
    if (input.locationPrivacy === 'exact' && !input.point) ctx.addIssue({ code: 'custom', path: ['point'], message: 'Drop the pin on the map, or give its latitude and longitude.' });
  });

export const schoolCreateInput = schoolFieldsInput.and(z.object({ idempotencyKey }));
export const schoolUpdateInput = schoolFieldsInput.and(z.object({ id: z.uuid({ error: NO_SCHOOL }) }));
export type SchoolFieldsInput = z.input<typeof schoolFieldsInput>;

function fieldErrors(error: z.ZodError): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fields[key === 'lat' || key === 'lng' ? 'point' : key] ??= issue.message;
  }
  return new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

// --- Public reads ------------------------------------------------------------------------------

interface PinRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  precision: 'exact' | 'city';
  lat: number;
  lng: number;
  city_name: string;
  country_code: string;
  distance_km: number | null;
}

interface InstructorRow extends Record<string, unknown> {
  school_id: string;
  role: (typeof SCHOOL_INSTRUCTOR_ROLES)[number];
  id: string;
  slug: string;
  display_name: string;
  lang: string | null;
}

/** The public point of v_public_school `v`, rounded to 5 decimals (about a metre). */
const PIN_COLUMNS = sql`v.id, v.slug, v.name, v.precision, v.city_name, v.country_code,
  round(ST_Y(v.public_point::geometry)::numeric, 5)::float8 AS lat,
  round(ST_X(v.public_point::geometry)::numeric, 5)::float8 AS lng`;

/** The lineage filter on v_public_school `v`: an instructor in a lineage rooted at `rootId`, below its root or the root. */
function lineageCondition(rootId: string | null | undefined) {
  if (!rootId) return sql`true`;
  return sql`EXISTS (
    SELECT 1 FROM lineage_membership lm JOIN lineage l ON l.id = lm.lineage_id AND l.deleted_at IS NULL
     WHERE l.root_person_id = ${rootId}::uuid AND lm.depth IS NOT NULL AND lm.person_id = ANY (v.instructor_person_ids))`;
}

/** The public instructors of these schools, the head instructor first. */
async function instructorsOf(db: Executor, schoolIds: readonly string[]): Promise<Map<string, InstructorRow[]>> {
  const out = new Map<string, InstructorRow[]>();
  if (schoolIds.length === 0) return out;
  const result = await db.execute<InstructorRow>(sql`
    SELECT si.school_id, si.role, p.id, p.slug, p.display_name, pn.lang
      FROM school_instructor si
      JOIN v_public_person p ON p.id = si.person_id
      LEFT JOIN person_name pn ON pn.person_id = p.id AND pn.is_primary
     WHERE si.school_id = ANY (${sql`ARRAY[${sql.join(schoolIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})
     ORDER BY CASE si.role WHEN 'head_instructor' THEN 0 WHEN 'instructor' THEN 1 ELSE 2 END, p.display_name, p.id`);
  for (const row of result.rows) {
    const list = out.get(row.school_id) ?? [];
    list.push(row);
    out.set(row.school_id, list);
  }
  return out;
}

/** Every instructor of these schools, public or not: for the cache tags only (an id never leaves). */
async function allInstructorIds(db: Executor, schoolIds: readonly string[]): Promise<string[]> {
  if (schoolIds.length === 0) return [];
  const rows = await db.select({ id: schoolInstructor.personId }).from(schoolInstructor).where(inArray(schoolInstructor.schoolId, [...schoolIds]));
  return rows.map((r) => r.id);
}

const nameOf = (row: Pick<InstructorRow, 'display_name' | 'lang'>) => ({ value: row.display_name, lang: row.lang ?? 'und-Latn', script: 'Latn' });

async function pinsFrom(db: Executor, rows: readonly PinRow[]): Promise<SchoolPinDto[]> {
  const instructors = await instructorsOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    precision: r.precision,
    point: { lat: r.lat, lng: r.lng },
    city: r.city_name,
    countryCode: r.country_code,
    instructors: (instructors.get(r.id) ?? []).map((i) => ({ id: i.id, slug: i.slug, displayName: nameOf(i) })),
    distanceKm: r.distance_km,
  }));
}

/** The lineage filter as the answer names it: the root's public name, or null when it is not public. */
async function lineageRootOf(db: Executor, rootId: string | null | undefined): Promise<SchoolSearchDto['lineage']> {
  if (!rootId) return null;
  const result = await db.execute<{ id: string; slug: string; display_name: string }>(sql`SELECT id, slug, display_name FROM v_public_person WHERE id = ${rootId}::uuid`);
  const row = result.rows[0];
  return row ? { rootId: row.id, rootSlug: row.slug, rootName: row.display_name } : null;
}

async function lineageIdsOfRoot(db: Executor, rootId: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`SELECT id FROM lineage WHERE root_person_id = ${rootId}::uuid AND deleted_at IS NULL`);
  return result.rows.map((r) => r.id);
}

/**
 * The radius search (plan §6.4): within `radiusKm` of `center`, nearest first. Exported for the
 * integration tests (49 km in, 51 km out; the GiST index in EXPLAIN).
 */
export function radiusQuery(center: GeoPointDto, radiusKm: number, lineageRootId: string | null | undefined, limit: number = SCHOOL_RESULT_LIMIT) {
  const radiusM = radiusKm * 1000;
  const c = sql`ST_SetSRID(ST_MakePoint(${center.lng}::float8, ${center.lat}::float8), 4326)::geography`;
  return sql`
    SELECT ${PIN_COLUMNS}, round(ST_Distance(v.public_point, ${c}) / 1000)::int AS distance_km, count(*) OVER ()::int AS total
      FROM school s
      JOIN v_public_school v ON v.id = s.id
     WHERE ST_DWithin(s.public_point, ST_SetSRID(ST_MakePoint(${center.lng}::float8, ${center.lat}::float8), 4326)::geography, ${radiusM}::float8)
       AND ST_DWithin(v.public_point, ${c}, ${radiusM}::float8)
       AND ${lineageCondition(lineageRootId)}
     ORDER BY distance_km, v.name, v.id
     LIMIT ${limit}`;
}

async function liveSearch(input: z.output<typeof schoolSearchInput> & { center: GeoPointDto }): Promise<SchoolSearchDto> {
  const db = getDb();
  const result = await db.execute<PinRow & { total: number }>(radiusQuery(input.center, input.radiusKm, input.lineageRootId));
  return toPublicSchoolSearch({
    schools: await pinsFrom(db, result.rows),
    total: result.rows[0]?.total ?? 0,
    center: { lat: round5(input.center.lat), lng: round5(input.center.lng) },
    radiusKm: input.radiusKm,
    lineage: await lineageRootOf(db, input.lineageRootId),
  });
}

/** Every public school (optionally in a lineage), by country, city and name: cached. */
async function cachedSchoolList(lineageRootId: string | null): Promise<SchoolSearchDto> {
  'use cache';
  cacheLife('minutes');
  const db = getDb();
  const result = await db.execute<PinRow>(sql`
    SELECT ${PIN_COLUMNS}, NULL::int AS distance_km
      FROM v_public_school v
     WHERE ${lineageCondition(lineageRootId)}
     ORDER BY v.country_code, v.city_name, v.name, v.id`);
  const rows = result.rows;
  const lineage = await lineageRootOf(db, lineageRootId);
  tagCacheEntry([
    SCHOOLS_TAG,
    ...(await allInstructorIds(
      db,
      rows.map((r) => r.id),
    )).map(personTag),
    ...(lineageRootId ? [personTag(lineageRootId), ...(await lineageIdsOfRoot(db, lineageRootId)).map(lineageMembershipTag)] : []),
  ]);
  const schools = await pinsFrom(db, rows.slice(0, SCHOOL_RESULT_LIMIT));
  return toPublicSchoolSearch({ schools, total: rows.length, center: null, radiusKm: null, lineage });
}

/** schools.search: see the top of this file. */
export async function schoolsSearch(_principal: Principal | null, raw: SchoolSearchInput): Promise<SchoolSearchDto> {
  const parsed = schoolSearchInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  if (input.center) return liveSearch({ ...input, center: input.center });
  return cachedSchoolList(input.lineageRootId ?? null);
}

/**
 * schools.inViewport: the public schools inside a bounding box whose edges are parallels and
 * meridians (M11 review, code-1). A geography polygon's edges are great circles, so the box is not
 * one: its pieces (viewportPieces) only pick candidates through the GiST index on
 * school.public_point, each segmentized every degree (its edges then stay within metres of the
 * parallels) and widened by VIEWPORT_INDEX_MARGIN towards both poles, where a great circle bows
 * into or out of the box; the view's point is then compared with the edges themselves. A box of
 * 360° or more is the whole world (latitude only).
 */
export async function schoolsInViewport(_principal: Principal | null, raw: z.input<typeof schoolViewportInput>): Promise<SchoolSearchDto> {
  const parsed = schoolViewportInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const b = parsed.data;
  const db = getDb();
  const pieces = viewportPieces(b.west, b.east);
  const south = Math.max(-90, b.south - VIEWPORT_INDEX_MARGIN);
  const north = Math.min(90, b.north + VIEWPORT_INDEX_MARGIN);
  const box = ([west, east]: [number, number]) =>
    sql`ST_Segmentize(ST_MakeEnvelope(${west}::float8, ${south}::float8, ${east}::float8, ${north}::float8, 4326), 1)::geography`;
  const inBox = pieces ? sql`(${sql.join(pieces.map((piece) => sql`s.public_point && ${box(piece)}`), sql` OR `)})` : sql`true`;
  const lat = sql`ST_Y(v.public_point::geometry)`;
  const lng = sql`ST_X(v.public_point::geometry)`;
  const inViewBox = sql`${lat} BETWEEN ${b.south}::float8 AND ${b.north}::float8 AND ${
    pieces ? sql`(${sql.join(pieces.map(([west, east]) => sql`${lng} BETWEEN ${west}::float8 AND ${east}::float8`), sql` OR `)})` : sql`true`
  }`;
  const result = await db.execute<PinRow & { total: number }>(sql`
    SELECT ${PIN_COLUMNS}, NULL::int AS distance_km, count(*) OVER ()::int AS total
      FROM school s
      JOIN v_public_school v ON v.id = s.id
     WHERE ${inBox} AND ${inViewBox} AND ${lineageCondition(b.lineageRootId)}
     ORDER BY v.name, v.id
     LIMIT ${SCHOOL_RESULT_LIMIT}`);
  return toPublicSchoolSearch({
    schools: await pinsFrom(db, result.rows),
    total: result.rows[0]?.total ?? 0,
    center: null,
    radiusKm: null,
    lineage: await lineageRootOf(db, b.lineageRootId),
  });
}

interface PageRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  precision: 'exact' | 'city';
  lat: number;
  lng: number;
  city_name: string;
  country_code: string;
  description: string | null;
  website_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  forms_taught: string[];
  last_activity_at: Date | string;
}

async function cachedSchoolPage(slug: string): Promise<SchoolPageDto | null> {
  'use cache';
  cacheLife('minutes');
  const db = getDb();
  const result = await db.execute<PageRow>(sql`
    SELECT ${PIN_COLUMNS}, v.description, v.website_url, v.contact_email, v.contact_phone, v.forms_taught, v.last_activity_at
      FROM v_public_school v WHERE v.slug = ${slug}`);
  const row = result.rows[0];
  if (!row) {
    tagCacheEntry([SCHOOLS_TAG]);
    return null;
  }
  const instructors = (await instructorsOf(db, [row.id])).get(row.id) ?? [];
  const ids = instructors.map((i) => i.id);
  const originals =
    ids.length === 0
      ? []
      : (
          await db.execute<{ person_id: string; value: string; lang: string; script: string }>(sql`
            SELECT DISTINCT ON (pn.person_id) pn.person_id, pn.value, pn.lang, pn.script
              FROM person_name pn
             WHERE pn.person_id = ANY (${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`}) AND NOT pn.is_primary AND pn.kind = 'name' AND pn.script <> 'Latn'
             ORDER BY pn.person_id, pn.sort_order, pn.id`)
        ).rows;
  const lineages =
    ids.length === 0
      ? []
      : (
          await db.execute<{ person_id: string; id: string; slug: string; name: string }>(sql`
            SELECT DISTINCT x.person_id, e.lineage_id AS id, e.lineage_slug AS slug, e.lineage_name AS name
              FROM v_public_edge e
              CROSS JOIN LATERAL (VALUES (e.teacher_person_id), (e.student_person_id)) x(person_id)
             WHERE x.person_id = ANY (${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`})
             ORDER BY x.person_id, e.lineage_name, e.lineage_id`)
        ).rows;
  tagCacheEntry([SCHOOLS_TAG, ...(await allInstructorIds(db, [row.id])).map(personTag), ...ids.map(personTag)]);
  const last = row.last_activity_at instanceof Date ? row.last_activity_at : new Date(row.last_activity_at);
  return toPublicSchoolPage({
    id: row.id,
    slug: row.slug,
    name: row.name,
    precision: row.precision,
    point: { lat: row.lat, lng: row.lng },
    city: row.city_name,
    countryCode: row.country_code,
    description: row.description,
    websiteUrl: row.website_url,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    forms: row.forms_taught.filter((f): f is keyof typeof SCHOOL_FORM_LABELS => f in SCHOOL_FORM_LABELS).map((key) => ({ key, label: SCHOOL_FORM_LABELS[key] })),
    lastActivityOn: last.toISOString().slice(0, 10),
    instructors: instructors.map((i) => {
      const original = originals.find((o) => o.person_id === i.id);
      return {
        id: i.id,
        slug: i.slug,
        displayName: nameOf(i),
        role: i.role,
        original: original ? { value: original.value, lang: original.lang, script: original.script } : null,
        lineages: lineages.filter((l) => l.person_id === i.id).map((l) => ({ id: l.id, slug: l.slug, name: l.name })),
      };
    }),
  });
}

/** schools.get: a public school's page (404 when there is none, or it is not public). */
export async function schoolGet(_principal: Principal | null, raw: z.input<typeof schoolSlugInput>): Promise<SchoolPageDto> {
  const parsed = schoolSlugInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const page = await cachedSchoolPage(parsed.data.slug);
  if (!page) throw notFound();
  return page;
}

/** Every public school's address for the sitemap (plan §6.4: from the public DTO only). */
export async function schoolSitemap(): Promise<SchoolSitemapDto> {
  'use cache';
  // Minutes, as the finder's answers: a plan that ends by its date drops the school without a tag.
  cacheLife('minutes');
  tagCacheEntry([SCHOOLS_TAG]);
  const result = await getDb().execute<{ slug: string; updated_at: Date | string }>(sql`SELECT v.slug, v.updated_at FROM v_public_school v ORDER BY v.slug`);
  return toPublicSchoolSitemap(result.rows.map((r) => ({ slug: r.slug, updatedAt: new Date(r.updated_at).toISOString() })));
}

/** places.search: cities of the extract by any spelling, the larger first. */
export async function placesSearch(_principal: Principal | null, raw: z.input<typeof placeSearchInput>): Promise<PlaceSearchDto> {
  const parsed = placeSearchInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  if (parsed.data.q.length === 0) return { places: [] };
  return { places: await searchPlaces(getDb(), parsed.data.q, parsed.data.countryCode ?? null) };
}

// --- The owner's side --------------------------------------------------------------------------

/** Whether a listed school's pin is on the map now, and why not. */
export type PinState = 'shown' | 'needs_plan' | 'not_listed';

export interface OwnSchoolItem {
  id: string;
  slug: string;
  name: string;
  city: string;
  countryCode: string;
  status: (typeof SCHOOL_STATUSES)[number];
  statusLabel: string;
  locationPrivacy: (typeof LOCATION_PRIVACIES)[number];
  pin: PinState;
  lastActivityAt: string;
}

export interface SchoolEditorView {
  school: {
    id: string;
    slug: string;
    name: string;
    placeId: string;
    placeName: string;
    countryCode: string;
    cityCenter: GeoPointDto;
    locationPrivacy: (typeof LOCATION_PRIVACIES)[number];
    /** The dropped pin (exact, or the private point of a city-only school): the owner's own data. */
    point: GeoPointDto | null;
    websiteUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    description: string | null;
    formsTaught: (typeof SCHOOL_FORMS)[number][];
    instructorIds: string[];
    status: (typeof SCHOOL_STATUSES)[number];
    statusLabel: string;
    pin: PinState;
    lastActivityAt: string;
  } | null;
  /**
   * The cities the form offers: the matches of `city` (the editor's "Find a city or town"), the
   * school's own city, then the large cities (LISTED_PLACE_MIN_POPULATION and over), by country.
   */
  places: (PlaceSearchHit & { found: boolean })[];
  /** The people who can be listed as instructors: you (head instructor) and your confirmed students. */
  instructorOptions: { id: string; label: string; self: boolean }[];
  forms: { key: string; label: string }[];
  /** The open listing review, or the last decision on it. */
  review: { status: string; statusLabel: string; question: string | null; reason: string | null } | null;
  /** Professional Sifu is in effect: the school can be sent for review. */
  canSubmit: boolean;
  /** At the plan's limit (a Free Sifu): the upgrade prompt instead of the submit button. */
  upgrade: UpgradeOffer | null;
}

export interface MySchools {
  accountType: 'student' | 'sifu';
  hasProfile: boolean;
  schools: OwnSchoolItem[];
}

const STATUS_LABELS: Record<(typeof SCHOOL_STATUSES)[number], string> = {
  draft: 'Draft',
  pending_review: 'Waiting for review',
  active: 'Listed',
  hidden: 'Hidden by a moderator',
  archived: 'Archived',
};

async function ownPersonId(db: Executor, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  return row?.id ?? null;
}

async function accountTypeOf(db: Executor, userId: string): Promise<'student' | 'sifu'> {
  const [row] = await db.select({ accountType: authUser.accountType }).from(authUser).where(eq(authUser.id, userId));
  return row?.accountType ?? 'student';
}

/** The ids of the public schools among these (v_public_school decides: listed and the pin allowed). */
async function publicIds(db: Executor, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const result = await db.execute<{ id: string }>(sql`SELECT id FROM v_public_school WHERE id = ANY (${sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`})`);
  return new Set(result.rows.map((r) => r.id));
}

function pinState(status: (typeof SCHOOL_STATUSES)[number], shown: boolean): PinState {
  if (status !== 'active') return 'not_listed';
  return shown ? 'shown' : 'needs_plan';
}

/** schools.mine: the schools the signed-in account listed. */
export async function mySchools(principal: Principal | null): Promise<MySchools> {
  const p = requireUser(principal);
  const db = getDb();
  const rows = await db
    .select({
      id: school.id,
      slug: school.slug,
      name: school.name,
      city: place.name,
      countryCode: place.countryCode,
      status: school.status,
      locationPrivacy: school.locationPrivacy,
      lastActivityAt: school.lastActivityAt,
    })
    .from(school)
    .innerJoin(place, eq(place.id, school.placeId))
    .where(and(eq(school.createdByUserId, p.user.id), isNull(school.deletedAt)))
    .orderBy(asc(school.name), asc(school.id));
  const shown = await publicIds(
    db,
    rows.map((r) => r.id),
  );
  return {
    accountType: await accountTypeOf(db, p.user.id),
    hasProfile: (await ownPersonId(db, p.user.id)) !== null,
    schools: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      city: r.city,
      countryCode: r.countryCode,
      status: r.status,
      statusLabel: STATUS_LABELS[r.status],
      locationPrivacy: r.locationPrivacy,
      pin: pinState(r.status, shown.has(r.id)),
      lastActivityAt: r.lastActivityAt.toISOString(),
    })),
  };
}

/** You, then the public people you confirmed as your students (verified or in arbitration). */
async function instructorOptions(db: Executor, ownId: string): Promise<{ id: string; label: string; self: boolean }[]> {
  const result = await db.execute<{ id: string; display_name: string }>(sql`
    SELECT DISTINCT p.id, p.display_name
      FROM teaching_relationship r
      JOIN v_public_person p ON p.id = r.student_person_id
     WHERE r.teacher_person_id = ${ownId}::uuid
       AND r.status IN (${sql.join(PUBLIC_RELATIONSHIP_STATUSES.map((s) => sql`${s}`), sql`, `)})
     ORDER BY p.display_name, p.id
     LIMIT 200`);
  const [own] = await db.execute<{ display_name: string | null }>(sql`
    SELECT (SELECT pn.value FROM person_name pn WHERE pn.person_id = ${ownId}::uuid AND pn.is_primary LIMIT 1) AS display_name`).then((r) => r.rows);
  return [{ id: ownId, label: `${own?.display_name ?? 'You'} (you)`, self: true }, ...result.rows.map((r) => ({ id: r.id, label: r.display_name, self: false }))];
}

/** The upgrade prompt for the public pin (plan §5.6), only at the real limit: a plan without school_map. */
async function pinOffer(db: Executor, userId: string): Promise<{ canSubmit: boolean; upgrade: UpgradeOffer | null }> {
  const decision = await requireEntitlement({ kind: 'user', userId }, 'school_map', { db });
  if (decision.ok) return { canSubmit: true, upgrade: null };
  if (!decision.grantedBy) return { canSubmit: false, upgrade: null };
  const from = planSummary(decision.plan);
  const to = planSummary(decision.grantedBy);
  const f = feature('school_map');
  return {
    canSubmit: false,
    upgrade: {
      feature: 'school_map',
      heading: (f.upgradeHeading ?? 'More with {plan}').replace('{plan}', to.name),
      allowance: { current: 0, limit: 0, sentence: `On ${from.name} your school stays a draft that only you see. A public pin needs ${to.name}.` },
      from,
      to,
      benefits: upgradeBenefits(decision.plan, decision.grantedBy),
      waiting: null,
      pilotRequest: await openPilotRequest(db, userId),
    },
  };
}

interface OwnedRow {
  id: string;
  slug: string;
  name: string;
  status: (typeof SCHOOL_STATUSES)[number];
  locationPrivacy: (typeof LOCATION_PRIVACIES)[number];
  placeId: string;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  description: string | null;
  formsTaught: (typeof SCHOOL_FORMS)[number][];
  lastActivityAt: Date;
}

async function ownedSchool(db: Executor, userId: string, id: string, lock = false): Promise<OwnedRow | null> {
  const query = db
    .select({
      id: school.id,
      slug: school.slug,
      name: school.name,
      status: school.status,
      locationPrivacy: school.locationPrivacy,
      placeId: school.placeId,
      websiteUrl: school.websiteUrl,
      contactEmail: school.contactEmail,
      contactPhone: school.contactPhone,
      description: school.description,
      formsTaught: school.formsTaught,
      lastActivityAt: school.lastActivityAt,
    })
    .from(school)
    .where(and(eq(school.id, id), eq(school.createdByUserId, userId), isNull(school.deletedAt)));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

async function reviewOf(db: Executor, schoolId: string): Promise<SchoolEditorView['review']> {
  const result = await db.execute<{ id: string; status: string; resolution: string | null; resolution_reason: string | null; question: string | null }>(sql`
    SELECT c.id, c.status, c.resolution, c.resolution_reason,
           (SELECT n.body FROM review_note n WHERE n.review_case_id = c.id AND NOT n.is_internal ORDER BY n.created_at DESC, n.id DESC LIMIT 1) AS question
      FROM review_case c
     WHERE c.school_id = ${schoolId}::uuid AND c.kind = 'school_listing'
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 1`);
  const c = result.rows[0];
  if (!c) return null;
  const open = (OPEN_REVIEW_CASE_STATUSES as readonly string[]).includes(c.status);
  const statusLabel =
    c.status === 'needs_info'
      ? 'The reviewers ask for more information'
      : open
        ? 'Waiting for a reviewer'
        : c.resolution === 'approved'
          ? 'Approved'
          : c.resolution === 'rejected'
            ? 'Returned to draft'
            : 'Closed';
  return { status: c.status, statusLabel, question: c.status === 'needs_info' ? c.question : null, reason: c.resolution === 'rejected' ? c.resolution_reason : null };
}

/** The editor's own input: the school (none for a new one) and the city search. */
export const schoolEditorInput = z.object({
  id: z.uuid({ error: NO_SCHOOL }).nullish(),
  city: z
    .string()
    .max(100)
    .transform((s) => s.normalize('NFC').trim())
    .nullish(),
});

/** The cities of the editor (SchoolEditorView.places): found, the school's own, then the large ones. */
async function editorPlaces(db: Executor, currentPlaceId: string | null, query: string | null | undefined): Promise<SchoolEditorView['places']> {
  const found = query ? await searchPlaces(db, query, null, 20) : [];
  const listed = await db.execute<{ id: string; name: string; country_code: string; lat: number; lng: number }>(sql`
    SELECT p.id, p.name, p.country_code, ST_Y(p.centroid::geometry) AS lat, ST_X(p.centroid::geometry) AS lng
      FROM place p
     WHERE p.population >= ${LISTED_PLACE_MIN_POPULATION} OR p.id = ${currentPlaceId}::uuid
     ORDER BY p.id = ${currentPlaceId}::uuid DESC, p.country_code, p.name, p.id`);
  const seen = new Set(found.map((f) => f.id));
  return [
    ...found.map((f) => ({ ...f, found: true })),
    ...listed.rows
      .filter((r) => !seen.has(r.id))
      .map((r) => ({ id: r.id, name: r.name, countryCode: r.country_code, point: { lat: Math.round(Number(r.lat) * 1e4) / 1e4, lng: Math.round(Number(r.lng) * 1e4) / 1e4 }, found: false })),
  ];
}

/** schools.edit: one of the account's schools for the editor, or (id omitted) what a new one offers. */
export async function schoolEditor(principal: Principal | null, raw: z.input<typeof schoolEditorInput> = {}): Promise<SchoolEditorView> {
  const p = requireUser(principal);
  const db = getDb();
  const ownId = await ownPersonId(db, p.user.id);
  if (!ownId) throw new ServiceError('CONFLICT', 'Set up your profile first: you are the head instructor of the schools you list.');
  const parsed = schoolEditorInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const forms = SCHOOL_FORMS.map((key) => ({ key, label: SCHOOL_FORM_LABELS[key] }));
  const options = await instructorOptions(db, ownId);
  const offer = await pinOffer(db, p.user.id);
  if (!parsed.data.id) return { school: null, places: await editorPlaces(db, null, parsed.data.city), instructorOptions: options, forms, review: null, ...offer };
  const row = await ownedSchool(db, p.user.id, parsed.data.id);
  if (!row) throw notFound();
  const [city] = await db
    .select({ name: place.name, countryCode: place.countryCode, lat: sql<number>`ST_Y(${place.centroid}::geometry)`, lng: sql<number>`ST_X(${place.centroid}::geometry)` })
    .from(place)
    .where(eq(place.id, row.placeId));
  const pointResult = await db.execute<{ lat: number; lng: number }>(sql`
    SELECT ST_Y(exact_point::geometry) AS lat, ST_X(exact_point::geometry) AS lng FROM school_private_location WHERE school_id = ${row.id}::uuid`);
  const point = pointResult.rows[0] ? { lat: round5(pointResult.rows[0].lat), lng: round5(pointResult.rows[0].lng) } : null;
  const instructors = await db.select({ id: schoolInstructor.personId }).from(schoolInstructor).where(eq(schoolInstructor.schoolId, row.id));
  const shown = await publicIds(db, [row.id]);
  return {
    school: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      placeId: row.placeId,
      placeName: city?.name ?? '',
      countryCode: city?.countryCode ?? '',
      cityCenter: { lat: round5(city?.lat ?? 0), lng: round5(city?.lng ?? 0) },
      locationPrivacy: row.locationPrivacy,
      point,
      websiteUrl: row.websiteUrl,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      description: row.description,
      formsTaught: row.formsTaught,
      instructorIds: instructors.map((i) => i.id).filter((id) => id !== ownId),
      status: row.status,
      statusLabel: STATUS_LABELS[row.status],
      pin: pinState(row.status, shown.has(row.id)),
      lastActivityAt: row.lastActivityAt.toISOString(),
    },
    places: await editorPlaces(db, row.placeId, parsed.data.city),
    instructorOptions: options,
    forms,
    review: await reviewOf(db, row.id),
    ...offer,
  };
}

/** The checks every save makes: a Sifu with a profile, a city, a pin near it, instructors from the list. */
async function checkFields(db: Executor, userId: string, input: z.output<typeof schoolFieldsInput>): Promise<{ ownId: string; instructorIds: string[] }> {
  if ((await accountTypeOf(db, userId)) !== 'sifu') {
    throw new ServiceError('FORBIDDEN', 'Schools are listed from a Sifu account. Change your account type in Account type and plan.');
  }
  const ownId = await ownPersonId(db, userId);
  if (!ownId) throw new ServiceError('CONFLICT', 'Set up your profile first: you are the head instructor of the schools you list.');
  const [city] = await db.select({ id: place.id }).from(place).where(eq(place.id, input.placeId));
  if (!city) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { placeId: 'Choose the city from the list.' });
  if (input.point) {
    const near = await db.execute<{ near: boolean }>(sql`
      SELECT ST_DWithin(p.centroid, ST_SetSRID(ST_MakePoint(${input.point.lng}::float8, ${input.point.lat}::float8), 4326)::geography, ${PIN_MAX_KM_FROM_CITY * 1000}::float8) AS near
        FROM place p WHERE p.id = ${input.placeId}::uuid`);
    if (!near.rows[0]?.near) {
      throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { point: `The pin is more than ${PIN_MAX_KM_FROM_CITY} km from the chosen city. Drop it in that city, or choose another city.` });
    }
  }
  const others = [...new Set(input.instructorIds.filter((id) => id !== ownId))];
  if (others.length > 0) {
    const allowed = new Set((await instructorOptions(db, ownId)).map((o) => o.id));
    if (others.some((id) => !allowed.has(id))) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { instructorIds: 'Choose instructors from the list: people you confirmed as your students.' });
  }
  return { ownId, instructorIds: others };
}

/** Writes the location: public_point (the exact point, or the city centroid) and the private point. */
async function writeLocation(db: Executor, schoolId: string, input: z.output<typeof schoolFieldsInput>): Promise<void> {
  const exact = input.point ? sql`ST_SetSRID(ST_MakePoint(${input.point.lng}::float8, ${input.point.lat}::float8), 4326)::geography` : null;
  // For city_only the trigger school_city_only_point writes the centroid whatever is given here.
  await db.execute(sql`
    UPDATE school SET public_point = ${input.locationPrivacy === 'exact' && exact ? exact : sql`(SELECT centroid FROM place WHERE id = ${input.placeId}::uuid)`}
     WHERE id = ${schoolId}::uuid`);
  if (exact) {
    await db.execute(sql`
      INSERT INTO school_private_location (school_id, exact_point) VALUES (${schoolId}::uuid, ${exact})
      ON CONFLICT (school_id) DO UPDATE SET exact_point = EXCLUDED.exact_point, updated_at = now()`);
  } else {
    await db.delete(schoolPrivateLocation).where(eq(schoolPrivateLocation.schoolId, schoolId));
  }
}

async function writeInstructors(db: Executor, schoolId: string, ownId: string, others: readonly string[]): Promise<void> {
  await db.delete(schoolInstructor).where(eq(schoolInstructor.schoolId, schoolId));
  await db.insert(schoolInstructor).values([
    { schoolId, personId: ownId, role: 'head_instructor' as const },
    ...others.map((personId) => ({ schoolId, personId, role: 'instructor' as const })),
  ]);
}

/** A slug from the name: Latin letters and digits, then a random suffix (any script is a valid name). */
function schoolSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return `${base || 'school'}-${randomBytes(3).toString('hex')}`;
}

export interface SchoolSaved {
  id: string;
  slug: string;
  status: (typeof SCHOOL_STATUSES)[number];
  replayed: boolean;
}

/** schools.create: a new draft listed by the signed-in Sifu, who is its head instructor. */
export async function createSchool(principal: Principal | null, raw: z.input<typeof schoolCreateInput>, meta: RequestMeta): Promise<SchoolSaved> {
  const p = requireUser(principal);
  const parsed = schoolCreateInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  return db.transaction(async (tx) => {
    // The same key again (a retried request): the school it created, not a second one.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`school.create:${p.user.id}`}))`);
    const [earlier] = await tx
      .select({ id: auditLog.subjectId })
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, p.user.id), eq(auditLog.action, 'school.create'), sql`${auditLog.after}->>'idempotencyKey' = ${input.idempotencyKey}`));
    if (earlier?.id) {
      const [row] = await tx.select({ id: school.id, slug: school.slug, status: school.status }).from(school).where(eq(school.id, earlier.id));
      if (row) return { ...row, replayed: true };
    }
    const { ownId, instructorIds } = await checkFields(tx, p.user.id, input);
    const [created] = await tx
      .insert(school)
      .values({
        slug: schoolSlug(input.name),
        name: input.name,
        placeId: input.placeId,
        locationPrivacy: input.locationPrivacy,
        publicPoint: sql`(SELECT centroid FROM place WHERE id = ${input.placeId}::uuid)` as never,
        status: 'draft',
        websiteUrl: input.websiteUrl,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        description: input.description,
        formsTaught: input.formsTaught,
        createdByUserId: p.user.id,
      })
      .returning({ id: school.id, slug: school.slug, status: school.status });
    await writeLocation(tx, created!.id, input);
    await writeInstructors(tx, created!.id, ownId, instructorIds);
    await writeAudit(tx, {
      action: 'school.create',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'school',
      subjectId: created!.id,
      after: { status: 'draft', locationPrivacy: input.locationPrivacy, pinDropped: input.point != null, instructors: instructorIds.length + 1, idempotencyKey: input.idempotencyKey },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { ...created!, replayed: false };
  });
}

const EDITABLE: readonly (typeof SCHOOL_STATUSES)[number][] = ['draft', 'pending_review', 'active'];

/**
 * The edits of a listed school that a reviewer checks again (M11 review, code-4): what the school
 * is and where, its website and who teaches there. Contacts, the description and the forms do not
 * reopen the review. `point` counts for an exact location only (a city-only school's point stays
 * private).
 */
export const RE_REVIEWED_CHANGES = ['name', 'city', 'locationPrivacy', 'point', 'websiteUrl', 'instructors'] as const;

/**
 * schools.update: edits the account's own school. last_activity_at moves (D17), and updated_at
 * moves on every edit (the version a listing decision carries, school-review.ts: a reviewer never
 * approves details they did not see).
 *
 * - A draft stays a draft.
 * - A school waiting for review waits on with the new details; a reviewer who opened the listing
 *   before the edit must reload it before deciding.
 * - A listed school stays listed with the edit (the pin follows at once). DEFAULT (no D number;
 *   docs/plan/questions/M11.md): an edit of RE_REVIEWED_CHANGES opens a school_listing case for
 *   the edited listing (one open case per school: a second edit joins it); the reviewer approves
 *   it (the school stays listed) or returns it to draft with a reason, which takes it off the map.
 */
export async function updateSchool(principal: Principal | null, raw: z.input<typeof schoolUpdateInput>, meta: RequestMeta): Promise<SchoolSaved> {
  const p = requireUser(principal);
  const parsed = schoolUpdateInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const outcome = await db.transaction(async (tx) => {
    const row = await ownedSchool(tx, p.user.id, input.id, true);
    if (!row) throw notFound();
    if (!EDITABLE.includes(row.status)) throw new ServiceError('CONFLICT', 'A moderator hid this school or it is archived: it cannot be edited.');
    const { ownId, instructorIds } = await checkFields(tx, p.user.id, input);
    const before = await tx.execute<{ lat: number | null; lng: number | null; instructors: string[] }>(sql`
      SELECT (SELECT ST_Y(exact_point::geometry) FROM school_private_location WHERE school_id = ${row.id}::uuid) AS lat,
             (SELECT ST_X(exact_point::geometry) FROM school_private_location WHERE school_id = ${row.id}::uuid) AS lng,
             ARRAY(SELECT person_id::text FROM school_instructor WHERE school_id = ${row.id}::uuid ORDER BY person_id) AS instructors`);
    const was = before.rows[0]!;
    const changed: string[] = [];
    if (row.name !== input.name) changed.push('name');
    if (row.placeId !== input.placeId) changed.push('city');
    if (row.locationPrivacy !== input.locationPrivacy) changed.push('locationPrivacy');
    const samePoint = input.point ? was.lat !== null && round5(was.lat) === round5(input.point.lat) && round5(was.lng!) === round5(input.point.lng) : was.lat === null;
    if (!samePoint) changed.push('point');
    if (row.websiteUrl !== input.websiteUrl) changed.push('websiteUrl');
    if (row.contactEmail !== input.contactEmail || row.contactPhone !== input.contactPhone) changed.push('contact');
    if (row.description !== input.description) changed.push('description');
    if ([...row.formsTaught].sort().join() !== [...input.formsTaught].sort().join()) changed.push('formsTaught');
    if ([...was.instructors].sort().join() !== [ownId, ...instructorIds].sort().join()) changed.push('instructors');
    if (changed.length === 0) return { saved: { id: row.id, slug: row.slug, status: row.status, replayed: false }, publicChange: false };
    const now = new Date();
    await tx
      .update(school)
      .set({
        name: input.name,
        placeId: input.placeId,
        locationPrivacy: input.locationPrivacy,
        websiteUrl: input.websiteUrl,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        description: input.description,
        formsTaught: input.formsTaught,
        lastActivityAt: now,
        // Always later than the version a reviewer may hold, also within one millisecond.
        updatedAt: sql`greatest(now(), ${school.updatedAt} + interval '1 microsecond')`,
      })
      .where(eq(school.id, row.id));
    await writeLocation(tx, row.id, input);
    await writeInstructors(tx, row.id, ownId, instructorIds);
    const reReview =
      row.status === 'active' && changed.some((c) => (RE_REVIEWED_CHANGES as readonly string[]).includes(c) && (c !== 'point' || input.locationPrivacy === 'exact'))
        ? await openReReview(tx, row.id, p.user.id)
        : null;
    await writeAudit(tx, {
      action: 'school.update',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'school',
      subjectId: row.id,
      before: { status: row.status },
      after: { status: row.status, changed, ...(reReview ? { reviewCaseId: reReview } : {}) },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { saved: { id: row.id, slug: row.slug, status: row.status, replayed: false }, publicChange: row.status === 'active' };
  });
  if (outcome.publicChange) invalidatePublic([SCHOOLS_TAG], 'procedure');
  return outcome.saved;
}

/**
 * The school_listing case of an edited listed school (see updateSchool): the open one when there
 * is one (a second edit joins it; the reviewer reloads the case and sees both), else a new one.
 * The school is locked already, so the case's lock comes second, as in schools.submit.
 */
async function openReReview(tx: Executor, schoolId: string, userId: string): Promise<string> {
  const [open] = await tx
    .select({ id: reviewCase.id })
    .from(reviewCase)
    .where(and(eq(reviewCase.schoolId, schoolId), eq(reviewCase.kind, 'school_listing'), inArray(reviewCase.status, [...OPEN_REVIEW_CASE_STATUSES])))
    .for('update');
  if (open) return open.id;
  const [created] = await tx.insert(reviewCase).values({ kind: 'school_listing', status: 'open', schoolId, openedByUserId: userId }).returning({ id: reviewCase.id });
  await tellListingReviewers(tx, created!.id, userId);
  return created!.id;
}

/** Every moderator and administrator: they review listings (the queue's notification). */
async function tellListingReviewers(tx: Executor, caseId: string, exceptUserId: string): Promise<void> {
  const reviewers = await tx
    .select({ id: authUser.id })
    .from(authUser)
    .where(and(inArray(authUser.role, ['moderator', 'admin']), eq(authUser.banned, false)))
    .limit(200);
  const to = reviewers.filter((r) => r.id !== exceptUserId);
  if (to.length > 0) await tx.insert(notification).values(to.map((r) => ({ userId: r.id, template: 'school.submitted', payload: { caseId } })));
}

export interface SchoolSubmitted extends SchoolSaved {
  caseId: string;
}

/**
 * schools.submit: sends a draft for the listing review (pending_review, one open school_listing
 * case), or answers the reviewers' question (needs_info: the case is open again). Needs
 * Professional Sifu now (school_map, plan §6.5): a Free Sifu gets ENTITLEMENT_REQUIRED with the
 * refusal, from which the page shows the upgrade prompt.
 */
export async function submitSchool(principal: Principal | null, raw: z.input<typeof schoolIdInput>, meta: RequestMeta): Promise<SchoolSubmitted> {
  const p = requireUser(principal);
  const parsed = schoolIdInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const row = await ownedSchool(tx, p.user.id, parsed.data.id, true);
      if (!row) throw notFound();
      const decision = await requireEntitlement({ kind: 'user', userId: p.user.id }, 'school_map', { db: tx });
      if (!decision.ok) {
        const message =
          decision.grantedBy === 'pro_sifu'
            ? `A public pin needs ${planSummary('pro_sifu').name}. Your school stays a draft that only you see.`
            : 'A public pin needs a Sifu account with Professional Sifu. Your school stays a draft that only you see.';
        throw new ServiceError('ENTITLEMENT_REQUIRED', message, {}, { entitlement: decision });
      }
      const [open] = await tx
        .select({ id: reviewCase.id, status: reviewCase.status, assignedToUserId: reviewCase.assignedToUserId })
        .from(reviewCase)
        .where(and(eq(reviewCase.schoolId, row.id), eq(reviewCase.kind, 'school_listing'), inArray(reviewCase.status, [...OPEN_REVIEW_CASE_STATUSES])))
        .for('update');
      // A listing under review, or a listed school whose edit is under review (updateSchool).
      if ((row.status === 'pending_review' || row.status === 'active') && open) {
        if (open.status !== 'needs_info') return { id: row.id, slug: row.slug, status: row.status, caseId: open.id, replayed: true };
        // The answer to the reviewers' question: the case waits for them again.
        const status = open.assignedToUserId ? 'in_review' : 'open';
        await tx.update(reviewCase).set({ status, updatedAt: new Date() }).where(eq(reviewCase.id, open.id));
        await writeAudit(tx, {
          action: 'school.submit',
          actorUserId: p.user.id,
          actorRole: p.user.role,
          subjectType: 'school',
          subjectId: row.id,
          before: { status: row.status, caseStatus: 'needs_info' },
          after: { status: row.status, caseStatus: status, caseId: open.id },
          requestId: meta.requestId,
          ipHmac: meta.ipHmac,
        });
        if (open.assignedToUserId) await tx.insert(notification).values({ userId: open.assignedToUserId, template: 'school.submitted', payload: { caseId: open.id } });
        return { id: row.id, slug: row.slug, status: row.status, caseId: open.id, replayed: false };
      }
      if (row.status !== 'draft') throw new ServiceError('CONFLICT', row.status === 'active' ? 'This school is already listed.' : 'This school cannot be sent for review now.');
      const now = new Date();
      await tx.update(school).set({ status: 'pending_review', lastActivityAt: now, updatedAt: now }).where(eq(school.id, row.id));
      const [created] = await tx
        .insert(reviewCase)
        .values({ kind: 'school_listing', status: 'open', schoolId: row.id, openedByUserId: p.user.id })
        .returning({ id: reviewCase.id });
      await writeAudit(tx, {
        action: 'school.submit',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'school',
        subjectId: row.id,
        before: { status: 'draft' },
        after: { status: 'pending_review', caseId: created!.id },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellListingReviewers(tx, created!.id, p.user.id);
      return { id: row.id, slug: row.slug, status: 'pending_review' as const, caseId: created!.id, replayed: false };
    });
  } catch (error) {
    // Two submits at once: the second finds the case the first opened.
    if (pgErrorOf(error)?.constraint === 'review_case_one_open_per_school_key') throw new ServiceError('CONFLICT', 'This school is already waiting for review.');
    throw error;
  }
}

/** schools.confirm: "This listing is current" on a listed school (D17: last_activity_at). */
export async function confirmSchool(principal: Principal | null, raw: z.input<typeof schoolIdInput>, meta: RequestMeta): Promise<SchoolSaved> {
  const p = requireUser(principal);
  const parsed = schoolIdInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const row = await ownedSchool(tx, p.user.id, parsed.data.id, true);
    if (!row) throw notFound();
    if (row.status !== 'active') throw new ServiceError('CONFLICT', 'Only a listed school is confirmed as current.');
    const now = new Date();
    await tx.update(school).set({ lastActivityAt: now, updatedAt: now }).where(eq(school.id, row.id));
    await writeAudit(tx, {
      action: 'school.confirm',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'school',
      subjectId: row.id,
      after: { status: row.status },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { id: row.id, slug: row.slug, status: row.status, replayed: false };
  });
  invalidatePublic([SCHOOLS_TAG], 'procedure');
  return saved;
}
