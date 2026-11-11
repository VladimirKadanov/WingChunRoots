// Organization analytics and the heatmap (milestone M24; specification §3.1 "Organization
// analytics by country and city", "Organization heatmap and school network", §10.3; plan §6.4;
// docs/adr/0027-organization-tools.md).
//
//   organizationTools.analytics   counts of the organization's own members, schools, verification
//                                 states and claims, by country and city and month by month
//   organizationTools.heatmap     the density of the organization's linked schools on a coarse grid
//
// Both are Federation features (specification §3.1, §10.3 "remove the organization heatmap … when a
// federation stops paying"): they need the approval and an active Federation plan
// (requireAdministration; DEFAULT D08), and only the organization's own admins read them (404 for
// any other account, organizations.ts managed()).
//
// Aggregates only (plan §6.4): counts, never a name, an id of a person or a coordinate of a school.
// The verification counts take only the public states of a relationship (verified, in arbitration;
// DEFAULT D03; DEFAULT M24 question 8), so a member’s private pending request is never counted or hinted at.
//
// The heatmap (DEFAULT M24 question 7): a school is placed at its city's centre (place.centroid,
// GeoNames), never at its own point (school_private_location or school.public_point are never
// read here); the cities are counted in squares of HEATMAP_CELL_DEGREES; a square with fewer than
// HEATMAP_MIN_SCHOOLS schools is not drawn, and its schools are counted by country only, so no
// single school can be located through the map.

import { sql } from 'drizzle-orm';
import * as z from 'zod';

import { isoDay } from '../../lib/dates';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { COUNTRIES } from './account';
import { ServiceError } from './errors';
import { managed, requireAdministration } from './organizations';

/** DEFAULT M24 question 7: the side of a heatmap square, in degrees (about 111 km north to south). */
export const HEATMAP_CELL_DEGREES = 1;
/** DEFAULT M24 question 7: the fewest schools a drawn square holds. */
export const HEATMAP_MIN_SCHOOLS = 3;
/** The months the analytics show, the current one included. */
export const ANALYTICS_MONTHS = 12;

export const insightsInput = z.object({ organizationId: z.uuid({ error: 'No such organization.' }) });

function parseOrg(raw: unknown): z.output<typeof insightsInput> {
  const parsed = insightsInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such organization.');
  return parsed.data;
}

const countryName = (code: string | null) => (code ? (COUNTRIES.find((c) => c.code === code)?.name ?? code) : 'Not given');

export interface CountRow {
  countryCode: string | null;
  country: string;
  count: number;
}

export interface MonthRow {
  /** YYYY-MM. */
  month: string;
  membersJoined: number;
  membersEnded: number;
  schoolsLinked: number;
  relationshipsVerified: number;
}

export interface OrganizationAnalytics {
  asOf: string;
  members: { current: number; publicProfiles: number; withAccount: number; recordsOnly: number; ended: number };
  membersByCountry: CountRow[];
  schools: { linked: number; waiting: number };
  schoolsByCity: { countryCode: string; country: string; city: string; count: number }[];
  /** Relationships of current members as students, by public state (DEFAULT D03). */
  verification: { verified: number; inArbitration: number; membersWithVerifiedTeacher: number };
  claims: { open: number; withdrawn: number };
  months: MonthRow[];
  note: string;
}

const CURRENT = (alias: string, today: string) =>
  sql.raw(
    `(${alias}.starts_on IS NULL OR ${alias}.starts_on <= '${today}'::date) AND (${alias}.ends_on IS NULL OR (${alias}.ends_on > '${today}'::date AND (${alias}.starts_on IS NULL OR ${alias}.ends_on > ${alias}.starts_on)))`,
  );

export async function organizationAnalytics(principal: Principal | null, raw: z.input<typeof insightsInput>): Promise<OrganizationAnalytics> {
  const p = requireUser(principal);
  const input = parseOrg(raw);
  const db = getDb();
  return db.transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId, false);
    await requireAdministration(tx, org);
    // isoDay is YYYY-MM-DD (checked), so it is safe in the raw fragment.
    const today = isoDay(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('bad day');
    const id = org.id;
    const members = await tx.execute<{ current: number; public_profiles: number; with_account: number; records_only: number; ended: number }>(sql`
      SELECT count(*) FILTER (WHERE ${CURRENT('m', today)})::int AS current,
             count(*) FILTER (WHERE ${CURRENT('m', today)} AND EXISTS (SELECT 1 FROM v_public_person v WHERE v.id = p.id))::int AS public_profiles,
             count(*) FILTER (WHERE ${CURRENT('m', today)} AND p.claimed_by_user_id IS NOT NULL)::int AS with_account,
             count(*) FILTER (WHERE ${CURRENT('m', today)} AND p.claimed_by_user_id IS NULL)::int AS records_only,
             count(*) FILTER (WHERE NOT (${CURRENT('m', today)}) AND m.ends_on IS NOT NULL)::int AS ended
        FROM organization_membership m JOIN person p ON p.id = m.person_id AND p.deleted_at IS NULL
       WHERE m.organization_id = ${id}::uuid`);
    const byCountry = await tx.execute<{ country_code: string | null; n: number }>(sql`
      SELECT p.country_code, count(*)::int AS n
        FROM organization_membership m JOIN person p ON p.id = m.person_id AND p.deleted_at IS NULL
       WHERE m.organization_id = ${id}::uuid AND ${CURRENT('m', today)}
       GROUP BY p.country_code ORDER BY n DESC, p.country_code NULLS LAST`);
    const schools = await tx.execute<{ linked: number; waiting: number }>(sql`
      SELECT count(*) FILTER (WHERE l.status = 'accepted')::int AS linked, count(*) FILTER (WHERE l.status = 'pending')::int AS waiting
        FROM organization_school l JOIN school s ON s.id = l.school_id AND s.deleted_at IS NULL
       WHERE l.organization_id = ${id}::uuid`);
    const byCity = await tx.execute<{ country_code: string; city: string; n: number }>(sql`
      SELECT pl.country_code, pl.name AS city, count(*)::int AS n
        FROM organization_school l JOIN school s ON s.id = l.school_id AND s.deleted_at IS NULL JOIN place pl ON pl.id = s.place_id
       WHERE l.organization_id = ${id}::uuid AND l.status = 'accepted'
       GROUP BY pl.country_code, pl.name ORDER BY n DESC, pl.country_code, pl.name`);
    const verification = await tx.execute<{ verified: number; in_arbitration: number; with_teacher: number }>(sql`
      SELECT count(*) FILTER (WHERE t.status = 'verified')::int AS verified,
             count(*) FILTER (WHERE t.status = 'in_arbitration')::int AS in_arbitration,
             count(DISTINCT t.student_person_id) FILTER (WHERE t.status = 'verified')::int AS with_teacher
        FROM organization_membership m JOIN teaching_relationship t ON t.student_person_id = m.person_id
       WHERE m.organization_id = ${id}::uuid AND ${CURRENT('m', today)} AND t.status IN ('verified', 'in_arbitration')`);
    const claims = await tx.execute<{ open: number; withdrawn: number }>(sql`
      SELECT count(*) FILTER (WHERE status = 'claimed_by_organization')::int AS open, count(*) FILTER (WHERE status = 'withdrawn')::int AS withdrawn
        FROM organization_teacher_claim WHERE organization_id = ${id}::uuid`);
    const months = await tx.execute<{ month: string; joined: number; ended: number; linked: number; verified: number }>(sql`
      WITH months AS (
        SELECT to_char(d, 'YYYY-MM') AS month, d AS starts, d + interval '1 month' AS ends
          FROM generate_series(date_trunc('month', ${today}::date) - make_interval(months => ${ANALYTICS_MONTHS - 1}), date_trunc('month', ${today}::date), interval '1 month') d)
      SELECT mo.month,
             (SELECT count(*)::int FROM organization_membership m WHERE m.organization_id = ${id}::uuid AND coalesce(m.starts_on::timestamptz, m.created_at) >= mo.starts AND coalesce(m.starts_on::timestamptz, m.created_at) < mo.ends) AS joined,
             (SELECT count(*)::int FROM organization_membership m WHERE m.organization_id = ${id}::uuid AND m.ends_on >= mo.starts::date AND m.ends_on < mo.ends::date) AS ended,
             (SELECT count(*)::int FROM organization_school l WHERE l.organization_id = ${id}::uuid AND l.status IN ('accepted', 'ended') AND l.answered_at >= mo.starts AND l.answered_at < mo.ends) AS linked,
             (SELECT count(*)::int FROM organization_membership m JOIN teaching_relationship t ON t.student_person_id = m.person_id
               WHERE m.organization_id = ${id}::uuid AND ${CURRENT('m', today)} AND t.status IN ('verified', 'in_arbitration') AND t.confirmed_at >= mo.starts AND t.confirmed_at < mo.ends) AS verified
        FROM months mo ORDER BY mo.month`);
    const m = members.rows[0]!;
    const s = schools.rows[0]!;
    const v = verification.rows[0]!;
    const c = claims.rows[0]!;
    return {
      asOf: today,
      members: { current: m.current, publicProfiles: m.public_profiles, withAccount: m.with_account, recordsOnly: m.records_only, ended: m.ended },
      membersByCountry: byCountry.rows.map((r) => ({ countryCode: r.country_code, country: countryName(r.country_code), count: r.n })),
      schools: { linked: s.linked, waiting: s.waiting },
      schoolsByCity: byCity.rows.map((r) => ({ countryCode: r.country_code, country: countryName(r.country_code), city: r.city, count: r.n })),
      verification: { verified: v.verified, inArbitration: v.in_arbitration, membersWithVerifiedTeacher: v.with_teacher },
      claims: { open: c.open, withdrawn: c.withdrawn },
      months: months.rows.map((r) => ({ month: r.month, membersJoined: r.joined, membersEnded: r.ended, schoolsLinked: r.linked, relationshipsVerified: r.verified })),
      note: 'Counts of your organization’s own records. Verification counts take only verified relationships and those under arbitration; requests that wait are private to the people involved and are not counted.',
    };
  });
}

export interface HeatCell {
  /** The square's south-west corner and its side (degrees): never a school's own point. */
  south: number;
  west: number;
  size: number;
  count: number;
  /** The countries of the square's cities (a square may cross a border). */
  countries: string[];
}

export interface OrganizationHeatmap {
  cellDegrees: number;
  minSchools: number;
  cells: HeatCell[];
  /** Schools in squares with fewer than minSchools, counted by country only. */
  sparse: CountRow[];
  total: number;
  note: string;
}

export async function organizationHeatmap(principal: Principal | null, raw: z.input<typeof insightsInput>): Promise<OrganizationHeatmap> {
  const p = requireUser(principal);
  const input = parseOrg(raw);
  const db = getDb();
  return db.transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId, false);
    await requireAdministration(tx, org);
    // The city's centre only (place.centroid); the school's own point is never read.
    const rows = await tx.execute<{ south: number; west: number; country_code: string; n: number }>(sql`
      SELECT (floor(ST_Y(pl.centroid::geometry) / ${HEATMAP_CELL_DEGREES}) * ${HEATMAP_CELL_DEGREES})::float8 AS south,
             (floor(ST_X(pl.centroid::geometry) / ${HEATMAP_CELL_DEGREES}) * ${HEATMAP_CELL_DEGREES})::float8 AS west,
             pl.country_code, count(*)::int AS n
        FROM organization_school l JOIN school s ON s.id = l.school_id AND s.deleted_at IS NULL JOIN place pl ON pl.id = s.place_id
       WHERE l.organization_id = ${org.id}::uuid AND l.status = 'accepted'
       GROUP BY 1, 2, 3`);
    const cells = new Map<string, HeatCell>();
    for (const r of rows.rows) {
      const k = `${r.south}:${r.west}`;
      const cell = cells.get(k) ?? { south: r.south, west: r.west, size: HEATMAP_CELL_DEGREES, count: 0, countries: [] };
      cell.count += r.n;
      if (!cell.countries.includes(r.country_code)) cell.countries.push(r.country_code);
      cells.set(k, cell);
    }
    const shown: HeatCell[] = [];
    const sparse = new Map<string, number>();
    for (const cell of cells.values()) {
      if (cell.count >= HEATMAP_MIN_SCHOOLS) shown.push({ ...cell, countries: cell.countries.sort() });
    }
    // A sparse square's schools, by the country of each city.
    for (const r of rows.rows) {
      const cell = cells.get(`${r.south}:${r.west}`)!;
      if (cell.count < HEATMAP_MIN_SCHOOLS) sparse.set(r.country_code, (sparse.get(r.country_code) ?? 0) + r.n);
    }
    shown.sort((a, b) => b.count - a.count || b.south - a.south || a.west - b.west);
    return {
      cellDegrees: HEATMAP_CELL_DEGREES,
      minSchools: HEATMAP_MIN_SCHOOLS,
      cells: shown,
      sparse: [...sparse.entries()].map(([code, count]) => ({ countryCode: code, country: countryName(code), count })).sort((a, b) => b.count - a.count || a.country.localeCompare(b.country)),
      total: [...cells.values()].reduce((sum, cell) => sum + cell.count, 0),
      note: `Each square is ${HEATMAP_CELL_DEGREES}° of latitude and longitude, and a school counts at its city’s centre. A square with fewer than ${HEATMAP_MIN_SCHOOLS} schools is not drawn; its schools are counted by country, so no single school can be found on the map.`,
    };
  });
}
