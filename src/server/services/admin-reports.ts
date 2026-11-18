// The control panel's reports (owner request 2026-11-17, docs/adr/0041-control-panel-reports.md):
// /admin/reports and its CSV downloads, for staff whose session passed the second factor. Aggregate
// counts over a chosen period only: how the archive and the accounts grow, how review work flows,
// how complete each lineage's record is, where listed schools are (by country and city, from the
// school's place; never a point, CLAUDE.md §6) and, for administrators only (as admin.dashboard and
// /admin/billing), the paid plans in test mode at the proposed prices (DEFAULT D09). No row names a
// person, an account or an e-mail address; a lineage, a country and a city are named, as the
// archive editor and the school list already show them.
//
// The periods are buckets that end with the current one: 5 or 13 weeks (Monday 00:00 UTC, as the
// dashboard's growth chart), or 12 calendar months (UTC). Every figure is read from what the schema
// keeps; nothing is estimated.

import { and, type AnyColumn, count, eq, gte, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import {
  authUser,
  BILLING_SUBSCRIPTION_STATUSES,
  billingSubscription,
  decisionAppeal,
  lineage,
  OPEN_REVIEW_CASE_STATUSES,
  person,
  place,
  REVIEW_CASE_KINDS,
  reviewCase,
  school,
  teachingRelationship,
} from '../db/schema';
import { PLANS, type PlanCode } from '../entitlements/plans';
import { monthlyValueCents, REVIEW_KIND_GROUPS, weekStart } from './admin-dashboard';
import { ServiceError } from './errors';

const NO_REPORT = 'There is no such report or period.';

function parsed<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new ServiceError('BAD_REQUEST', NO_REPORT);
  return result.data;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const REPORT_PERIODS = ['30d', '90d', '12m'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
/** DEFAULT (ADR 0041): a quarter, enough weeks to see a trend in a pilot. */
export const DEFAULT_REPORT_PERIOD: ReportPeriod = '90d';
export const PERIOD_LABELS: Record<ReportPeriod, string> = { '30d': 'Last 30 days', '90d': 'Last 90 days', '12m': 'Last 12 months' };

/** The reports every staff role may read; billing is a procedure of its own, for administrators. */
export const STAFF_REPORTS = ['growth', 'review', 'archive', 'schools'] as const;
export type StaffReportKind = (typeof STAFF_REPORTS)[number];

export const adminReportInput = z.object({
  report: z.enum(STAFF_REPORTS),
  period: z.enum(REPORT_PERIODS).default(DEFAULT_REPORT_PERIOD),
});
export const adminBillingReportInput = z.object({ period: z.enum(REPORT_PERIODS).default(DEFAULT_REPORT_PERIOD) });

export type BucketUnit = 'week' | 'month';

export interface ReportRange {
  period: ReportPeriod;
  unit: BucketUnit;
  /** The first day of each bucket (ISO date, UTC), oldest first; the last one holds `now`. */
  starts: string[];
  /** Start of the first bucket (ISO 8601). */
  from: string;
  /** When the figures were read (ISO 8601). */
  to: string;
}

/** The buckets of a period at `now`: 5 or 13 weeks from Monday, or 12 calendar months (UTC). */
export function reportRange(period: ReportPeriod, now: Date): ReportRange {
  if (period === '12m') {
    const starts = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1)));
    return { period, unit: 'month', starts: starts.map(isoDay), from: starts[0]!.toISOString(), to: now.toISOString() };
  }
  const weeks = period === '30d' ? 5 : 13;
  const last = weekStart(now).getTime();
  const starts = Array.from({ length: weeks }, (_, i) => new Date(last - (weeks - 1 - i) * 7 * DAY_MS));
  return { period, unit: 'week', starts: starts.map(isoDay), from: starts[0]!.toISOString(), to: now.toISOString() };
}

/** The end of each bucket (the next one's start; `to` for the last), ISO 8601. */
export function bucketEnds(range: ReportRange): string[] {
  return range.starts.map((_, i) => (i + 1 < range.starts.length ? new Date(`${range.starts[i + 1]}T00:00:00Z`).toISOString() : range.to));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** One series per key, a value per bucket (missing buckets are 0). */
export function fillSeries<K extends string>(range: ReportRange, keys: readonly K[], rows: readonly { bucket: string; key: K; n: number }[]): ({ start: string } & Record<K, number>)[] {
  const byBucket = new Map<string, Map<K, number>>();
  for (const row of rows) {
    const day = row.bucket.slice(0, 10);
    const map = byBucket.get(day) ?? new Map<K, number>();
    map.set(row.key, (map.get(row.key) ?? 0) + row.n);
    byBucket.set(day, map);
  }
  return range.starts.map((start) => {
    const map = byBucket.get(start);
    const entry = { start } as { start: string } & Record<K, number>;
    for (const key of keys) (entry as Record<K, number>)[key] = map?.get(key) ?? 0;
    return entry;
  });
}

/** The share as a whole percentage, or null when there is nothing to divide. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** The SQL bucket of a timestamp column: the first day of its week or month (UTC). */
function bucketOf(column: AnyColumn | SQL, unit: BucketUnit): SQL<string> {
  return sql<string>`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${column} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
}

const fromOf = (range: ReportRange) => new Date(range.from);

// --- Growth --------------------------------------------------------------------------------------

export const GROWTH_SERIES = ['accounts', 'people', 'verifiedLinks', 'schools'] as const;
export type GrowthSeries = (typeof GROWTH_SERIES)[number];
export const GROWTH_LABELS: Record<GrowthSeries, string> = {
  accounts: 'New accounts',
  people: 'New people on record',
  verifiedLinks: 'Links verified',
  schools: 'Schools added, listed now',
};

export interface GrowthReport {
  kind: 'growth';
  range: ReportRange;
  buckets: ({ start: string } & Record<GrowthSeries, number>)[];
  /** The total now and what the period added, per series. */
  totals: Record<GrowthSeries, { now: number; inPeriod: number }>;
}

async function growthReport(range: ReportRange): Promise<GrowthReport> {
  const db = getDb();
  const from = fromOf(range);
  const to = new Date(range.to);
  const listed = and(eq(school.status, 'active'), ne(school.activityStage, 'hidden'), isNull(school.deletedAt));
  const verified = eq(teachingRelationship.status, 'verified');
  const [accounts, people, links, schools, [totals]] = await Promise.all([
    db
      .select({ bucket: bucketOf(authUser.createdAt, range.unit), n: count() })
      .from(authUser)
      .where(and(gte(authUser.createdAt, from), sql`${authUser.createdAt} <= ${to}`))
      .groupBy(sql`1`),
    db
      .select({ bucket: bucketOf(person.createdAt, range.unit), n: count() })
      .from(person)
      .where(and(isNull(person.deletedAt), gte(person.createdAt, from), sql`${person.createdAt} <= ${to}`))
      .groupBy(sql`1`),
    db
      .select({ bucket: bucketOf(teachingRelationship.confirmedAt, range.unit), n: count() })
      .from(teachingRelationship)
      .where(and(verified, gte(teachingRelationship.confirmedAt, from), sql`${teachingRelationship.confirmedAt} <= ${to}`))
      .groupBy(sql`1`),
    db
      .select({ bucket: bucketOf(school.createdAt, range.unit), n: count() })
      .from(school)
      .where(and(listed, gte(school.createdAt, from), sql`${school.createdAt} <= ${to}`))
      .groupBy(sql`1`),
    db
      .select({
        accounts: sql<number>`(SELECT count(*)::int FROM ${authUser})`.mapWith(Number),
        people: sql<number>`(SELECT count(*)::int FROM ${person} WHERE ${person.deletedAt} IS NULL)`.mapWith(Number),
        verifiedLinks: sql<number>`(SELECT count(*)::int FROM ${teachingRelationship} WHERE ${verified})`.mapWith(Number),
        schools: sql<number>`(SELECT count(*)::int FROM ${school} WHERE ${listed})`.mapWith(Number),
      })
      .from(sql`(SELECT 1) AS one`),
  ]);
  const rows = [
    ...accounts.map((r) => ({ bucket: r.bucket, key: 'accounts' as const, n: r.n })),
    ...people.map((r) => ({ bucket: r.bucket, key: 'people' as const, n: r.n })),
    ...links.map((r) => ({ bucket: r.bucket, key: 'verifiedLinks' as const, n: r.n })),
    ...schools.map((r) => ({ bucket: r.bucket, key: 'schools' as const, n: r.n })),
  ];
  const buckets = fillSeries(range, GROWTH_SERIES, rows);
  const sum = (key: GrowthSeries) => buckets.reduce((total, b) => total + b[key], 0);
  return {
    kind: 'growth',
    range,
    buckets,
    totals: {
      accounts: { now: totals?.accounts ?? 0, inPeriod: sum('accounts') },
      people: { now: totals?.people ?? 0, inPeriod: sum('people') },
      verifiedLinks: { now: totals?.verifiedLinks ?? 0, inPeriod: sum('verifiedLinks') },
      schools: { now: totals?.schools ?? 0, inPeriod: sum('schools') },
    },
  };
}

// --- Review throughput ---------------------------------------------------------------------------

export interface ReviewGroupRow {
  key: string;
  label: string;
  /** Cases of the group opened in the period. */
  opened: number;
  /** Cases decided in the period (resolved or dismissed). */
  decided: number;
  approved: number;
  rejected: number;
  /** Closed without a decision on the merits (withdrawn, the account erased, …). */
  dismissed: number;
  /** Median days from opening to decision of the cases decided in the period; null when none. */
  medianDays: number | null;
  /** Appeals sent in the period against a decision of the group. */
  appealed: number;
  openNow: number;
}

export interface ReviewReport {
  kind: 'review';
  range: ReportRange;
  buckets: { start: string; opened: number; decided: number }[];
  groups: ReviewGroupRow[];
  totals: Omit<ReviewGroupRow, 'key' | 'label'>;
}

/** The groups a role sees: account deletion requests are for administrators (as the dashboard). */
export function reviewGroupsFor(isAdmin: boolean) {
  return REVIEW_KIND_GROUPS.filter((g) => isAdmin || g.key !== 'deletions');
}

/** The SQL CASE that names the group of a review case's kind. */
function groupKeyOf(kind: AnyColumn | SQL): SQL<string> {
  const branches = REVIEW_KIND_GROUPS.map((g) => sql`WHEN ${kind} IN (${sql.join(g.kinds.map((k) => sql`${k}`), sql`, `)}) THEN ${g.key}`);
  return sql<string>`CASE ${sql.join(branches, sql` `)} ELSE 'other' END`;
}

const DECIDED = ['resolved', 'dismissed'] as const;

/** Days, rounded to a tenth (the median comes from PostgreSQL in seconds). */
export function secondsToDays(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  return Math.round((seconds / 86400) * 10) / 10;
}

async function reviewReport(range: ReportRange, isAdmin: boolean): Promise<ReviewReport> {
  const db = getDb();
  const from = fromOf(range);
  const to = new Date(range.to);
  const groups = reviewGroupsFor(isAdmin);
  const kinds = groups.flatMap((g) => [...g.kinds]) as (typeof REVIEW_CASE_KINDS)[number][];
  const group = groupKeyOf(reviewCase.kind);
  const decidedIn = and(inArray(reviewCase.kind, kinds), inArray(reviewCase.status, DECIDED), gte(reviewCase.resolvedAt, from), sql`${reviewCase.resolvedAt} <= ${to}`);
  const median = sql<number | null>`percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ${reviewCase.resolvedAt} - ${reviewCase.createdAt}))`.mapWith((v) => (v === null ? null : Number(v)));
  const decidedColumns = {
    decided: count(),
    approved: sql<number>`count(*) FILTER (WHERE ${reviewCase.resolution} = 'approved')`.mapWith(Number),
    rejected: sql<number>`count(*) FILTER (WHERE ${reviewCase.resolution} = 'rejected')`.mapWith(Number),
    dismissed: sql<number>`count(*) FILTER (WHERE ${reviewCase.status} = 'dismissed')`.mapWith(Number),
    median,
  };
  const [openedBuckets, decidedBuckets, openedByGroup, decidedByGroup, [decidedAll], appealsByGroup, openByGroup] = await Promise.all([
    db
      .select({ bucket: bucketOf(reviewCase.createdAt, range.unit), n: count() })
      .from(reviewCase)
      .where(and(inArray(reviewCase.kind, kinds), gte(reviewCase.createdAt, from), sql`${reviewCase.createdAt} <= ${to}`))
      .groupBy(sql`1`),
    db.select({ bucket: bucketOf(reviewCase.resolvedAt, range.unit), n: count() }).from(reviewCase).where(decidedIn).groupBy(sql`1`),
    db
      .select({ key: group, n: count() })
      .from(reviewCase)
      .where(and(inArray(reviewCase.kind, kinds), gte(reviewCase.createdAt, from), sql`${reviewCase.createdAt} <= ${to}`))
      .groupBy(sql`1`),
    db.select({ key: group, ...decidedColumns }).from(reviewCase).where(decidedIn).groupBy(sql`1`),
    db.select(decidedColumns).from(reviewCase).where(decidedIn),
    db
      .select({ key: group, n: count() })
      .from(decisionAppeal)
      .innerJoin(reviewCase, eq(reviewCase.id, decisionAppeal.appealedCaseId))
      .where(and(inArray(reviewCase.kind, kinds), gte(decisionAppeal.createdAt, from), sql`${decisionAppeal.createdAt} <= ${to}`))
      .groupBy(sql`1`),
    db
      .select({ key: group, n: count() })
      .from(reviewCase)
      .where(and(inArray(reviewCase.kind, kinds), inArray(reviewCase.status, OPEN_REVIEW_CASE_STATUSES)))
      .groupBy(sql`1`),
  ]);

  const byKey = <T extends { key: string }>(rows: T[]) => new Map(rows.map((r) => [r.key, r]));
  const opened = byKey(openedByGroup);
  const decided = byKey(decidedByGroup);
  const appeals = byKey(appealsByGroup);
  const open = byKey(openByGroup);
  const rows: ReviewGroupRow[] = groups.map((g) => {
    const d = decided.get(g.key);
    return {
      key: g.key,
      label: g.label,
      opened: opened.get(g.key)?.n ?? 0,
      decided: d?.decided ?? 0,
      approved: d?.approved ?? 0,
      rejected: d?.rejected ?? 0,
      dismissed: d?.dismissed ?? 0,
      medianDays: secondsToDays(d?.median ?? null),
      appealed: appeals.get(g.key)?.n ?? 0,
      openNow: open.get(g.key)?.n ?? 0,
    };
  });
  const sum = (key: 'opened' | 'appealed' | 'openNow') => rows.reduce((total, r) => total + r[key], 0);
  const series = fillSeries(range, ['opened', 'decided'] as const, [
    ...openedBuckets.map((r) => ({ bucket: r.bucket, key: 'opened' as const, n: r.n })),
    ...decidedBuckets.map((r) => ({ bucket: r.bucket, key: 'decided' as const, n: r.n })),
  ]);
  return {
    kind: 'review',
    range,
    buckets: series,
    groups: rows,
    totals: {
      opened: sum('opened'),
      decided: decidedAll?.decided ?? 0,
      approved: decidedAll?.approved ?? 0,
      rejected: decidedAll?.rejected ?? 0,
      dismissed: decidedAll?.dismissed ?? 0,
      medianDays: secondsToDays(decidedAll?.median ?? null),
      appealed: sum('appealed'),
      openNow: sum('openNow'),
    },
  };
}

// --- Archive completeness ------------------------------------------------------------------------

/** The most lineages the report lists (the archive editor's own limit). */
export const ARCHIVE_REPORT_LIMIT = 500;

export interface ArchiveLineageRow {
  slug: string;
  name: string;
  /** People in the lineage's established links (verified or in arbitration), each counted once. */
  people: number;
  /** Established links. */
  links: number;
  /** Established links with a source: an archivist's source note or an evidence file. */
  sourced: number;
  /** sourced / links as a whole percentage; null without links. */
  sourcedPercent: number | null;
  /** Established links recorded in the period. */
  addedInPeriod: number;
}

export interface ArchiveReport {
  kind: 'archive';
  range: ReportRange;
  lineages: ArchiveLineageRow[];
  totals: Omit<ArchiveLineageRow, 'slug' | 'name'>;
}

async function archiveReport(range: ReportRange): Promise<ArchiveReport> {
  const db = getDb();
  const from = fromOf(range);
  // A link is sourced when an archivist noted where it was found, or an evidence file is attached
  // to it or to a review case about it (M10a). The evidence itself is never read here.
  const sourced = sql`(r.source_note IS NOT NULL OR EXISTS (SELECT 1 FROM evidence_link el WHERE el.relationship_id = r.id)
    OR EXISTS (SELECT 1 FROM evidence_link el JOIN review_case rc ON rc.id = el.review_case_id WHERE rc.relationship_id = r.id))`;
  const established = sql`r.status IN ('verified', 'in_arbitration')`;
  const rows = await db
    .select({
      slug: lineage.slug,
      name: lineage.name,
      links: sql<number>`(SELECT count(*)::int FROM teaching_relationship r WHERE r.lineage_id = lineage.id AND ${established})`.mapWith(Number),
      sourced: sql<number>`(SELECT count(*)::int FROM teaching_relationship r WHERE r.lineage_id = lineage.id AND ${established} AND ${sourced})`.mapWith(Number),
      added: sql<number>`(SELECT count(*)::int FROM teaching_relationship r WHERE r.lineage_id = lineage.id AND ${established} AND r.created_at >= ${from})`.mapWith(Number),
      people: sql<number>`(SELECT count(DISTINCT p)::int FROM teaching_relationship r, LATERAL (VALUES (r.teacher_person_id), (r.student_person_id)) AS v(p) WHERE r.lineage_id = lineage.id AND ${established})`.mapWith(Number),
    })
    .from(lineage)
    .where(isNull(lineage.deletedAt))
    .orderBy(sql`3 DESC`, sql`lower(${lineage.name})`, lineage.id)
    .limit(ARCHIVE_REPORT_LIMIT);
  // People are counted once across lineages for the total (one person can be in several).
  const [all] = await db
    .select({
      people: sql<number>`count(DISTINCT p)::int`.mapWith(Number),
    })
    .from(sql`teaching_relationship r JOIN lineage l ON l.id = r.lineage_id AND l.deleted_at IS NULL, LATERAL (VALUES (r.teacher_person_id), (r.student_person_id)) AS v(p)`)
    .where(established);
  const lineages = rows.map((r) => ({ slug: r.slug, name: r.name, people: r.people, links: r.links, sourced: r.sourced, sourcedPercent: percent(r.sourced, r.links), addedInPeriod: r.added }));
  const links = lineages.reduce((t, r) => t + r.links, 0);
  const sourcedTotal = lineages.reduce((t, r) => t + r.sourced, 0);
  return {
    kind: 'archive',
    range,
    lineages,
    totals: { people: all?.people ?? 0, links, sourced: sourcedTotal, sourcedPercent: percent(sourcedTotal, links), addedInPeriod: lineages.reduce((t, r) => t + r.addedInPeriod, 0) },
  };
}

// --- Schools -------------------------------------------------------------------------------------

export const SCHOOL_STAGE_ROWS = [
  { key: 'current', label: 'Listed, current' },
  { key: 'awaiting_confirmation', label: 'Listed, awaiting confirmation' },
  { key: 'activity_hidden', label: 'Hidden from the map (no confirmation)' },
  { key: 'pending_review', label: 'Waiting for review' },
  { key: 'draft', label: 'Draft' },
  { key: 'hidden', label: 'Hidden by staff or the owner' },
  { key: 'archived', label: 'Archived' },
] as const;
export type SchoolStageKey = (typeof SCHOOL_STAGE_ROWS)[number]['key'];

/** The most cities the report lists, the most schools first. */
export const SCHOOL_CITY_LIMIT = 200;

export interface SchoolsReport {
  kind: 'schools';
  range: ReportRange;
  stages: { key: SchoolStageKey; label: string; count: number; addedInPeriod: number }[];
  /** Listed schools (on the public map) by country. */
  countries: { countryCode: string; listed: number; cities: number; addedInPeriod: number }[];
  /** Listed schools by city: the place's English name, never a point. */
  cities: { countryCode: string; city: string; listed: number }[];
  listed: number;
}

/** The stage key of a school row (its status, and the activity check for an active one). */
export function schoolStageKey(status: string, activityStage: string): SchoolStageKey | null {
  if (status === 'active') return activityStage === 'hidden' ? 'activity_hidden' : activityStage === 'awaiting_confirmation' ? 'awaiting_confirmation' : 'current';
  return SCHOOL_STAGE_ROWS.some((r) => r.key === status) ? (status as SchoolStageKey) : null;
}

async function schoolsReport(range: ReportRange): Promise<SchoolsReport> {
  const db = getDb();
  const from = fromOf(range);
  const listed = and(eq(school.status, 'active'), ne(school.activityStage, 'hidden'), isNull(school.deletedAt));
  const added = sql<number>`count(*) FILTER (WHERE ${school.createdAt} >= ${from})`.mapWith(Number);
  const [stageRows, countryRows, cityRows] = await Promise.all([
    db
      .select({ status: school.status, activity: school.activityStage, n: count(), added })
      .from(school)
      .where(isNull(school.deletedAt))
      .groupBy(school.status, school.activityStage),
    db
      .select({ countryCode: place.countryCode, n: count(), cities: sql<number>`count(DISTINCT ${place.id})`.mapWith(Number), added })
      .from(school)
      .innerJoin(place, eq(place.id, school.placeId))
      .where(listed)
      .groupBy(place.countryCode)
      .orderBy(sql`2 DESC`, place.countryCode),
    db
      .select({ countryCode: place.countryCode, city: place.name, n: count() })
      .from(school)
      .innerJoin(place, eq(place.id, school.placeId))
      .where(listed)
      .groupBy(place.id, place.countryCode, place.name)
      .orderBy(sql`3 DESC`, place.countryCode, place.name)
      .limit(SCHOOL_CITY_LIMIT),
  ]);
  const stageCounts = new Map<SchoolStageKey, { n: number; added: number }>();
  for (const row of stageRows) {
    const key = schoolStageKey(row.status, row.activity);
    if (!key) continue;
    const prev = stageCounts.get(key) ?? { n: 0, added: 0 };
    stageCounts.set(key, { n: prev.n + row.n, added: prev.added + row.added });
  }
  return {
    kind: 'schools',
    range,
    stages: SCHOOL_STAGE_ROWS.map((r) => ({ key: r.key, label: r.label, count: stageCounts.get(r.key)?.n ?? 0, addedInPeriod: stageCounts.get(r.key)?.added ?? 0 })),
    countries: countryRows.map((r) => ({ countryCode: r.countryCode, listed: r.n, cities: r.cities, addedInPeriod: r.added })),
    cities: cityRows.map((r) => ({ countryCode: r.countryCode, city: r.city, listed: r.n })),
    listed: countryRows.reduce((t, r) => t + r.n, 0),
  };
}

// --- Billing (administrators) --------------------------------------------------------------------

export type SubscriptionStatus = (typeof BILLING_SUBSCRIPTION_STATUSES)[number];
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  incomplete: 'Not completed',
  active: 'Active',
  past_due: 'Payment overdue',
  canceled: 'Ended',
};

export interface BillingReport {
  kind: 'billing';
  range: ReportRange;
  /** Per bucket: subscriptions started and ended in it, and those running at its end with their monthly value. */
  buckets: { start: string; started: number; ended: number; running: number; monthlyCents: number }[];
  /** Every subscription now, by plan and status. */
  byPlan: { code: PlanCode; name: string; counts: Record<SubscriptionStatus, number>; total: number }[];
  /** The monthly value now of the subscriptions that give access (active or past due). */
  monthlyCents: number;
}

async function billingReport(range: ReportRange): Promise<BillingReport> {
  const db = getDb();
  const from = fromOf(range);
  const to = new Date(range.to);
  const ends = bucketEnds(range);
  const started = and(ne(billingSubscription.status, 'incomplete'), gte(billingSubscription.createdAt, from), sql`${billingSubscription.createdAt} <= ${to}`);
  // Running at the end of a bucket: started before it and not ended by it, at its current plan (a
  // plan change is not kept as history, so an older bucket shows the plan the subscription has now).
  const endsList = sql.join(ends.map((e) => sql`(${e}::timestamptz)`), sql`, `);
  const [startedRows, endedRows, runningRows, statusRows] = await Promise.all([
    db.select({ bucket: bucketOf(billingSubscription.createdAt, range.unit), n: count() }).from(billingSubscription).where(started).groupBy(sql`1`),
    db
      .select({ bucket: bucketOf(billingSubscription.endedAt, range.unit), n: count() })
      .from(billingSubscription)
      .where(and(gte(billingSubscription.endedAt, from), sql`${billingSubscription.endedAt} <= ${to}`))
      .groupBy(sql`1`),
    db.execute<{ bucket_end: string; plan_code: PlanCode; interval: 'month' | 'year'; n: number }>(sql`
      SELECT to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS bucket_end, s.plan_code, s.interval, count(*)::int AS n
      FROM (VALUES ${endsList}) AS e(at)
      JOIN billing_subscription s ON s.status <> 'incomplete' AND s.created_at <= e.at AND (s.ended_at IS NULL OR s.ended_at > e.at)
      GROUP BY 1, 2, 3`),
    db
      .select({ planCode: billingSubscription.planCode, interval: billingSubscription.interval, status: billingSubscription.status, n: count() })
      .from(billingSubscription)
      .groupBy(billingSubscription.planCode, billingSubscription.interval, billingSubscription.status),
  ]);
  const runningByEnd = new Map<string, { planCode: PlanCode; interval: 'month' | 'year'; n: number }[]>();
  for (const row of runningRows.rows) {
    const list = runningByEnd.get(row.bucket_end) ?? [];
    list.push({ planCode: row.plan_code, interval: row.interval, n: Number(row.n) });
    runningByEnd.set(row.bucket_end, list);
  }
  const series = fillSeries(range, ['started', 'ended'] as const, [
    ...startedRows.map((r) => ({ bucket: r.bucket, key: 'started' as const, n: r.n })),
    ...endedRows.map((r) => ({ bucket: r.bucket, key: 'ended' as const, n: r.n })),
  ]);
  const buckets = series.map((b, i) => {
    const running = runningByEnd.get(new Date(ends[i]!).toISOString()) ?? [];
    return { ...b, running: running.reduce((t, r) => t + r.n, 0), monthlyCents: monthlyValueCents(running) };
  });
  const plans = new Map<PlanCode, Record<SubscriptionStatus, number>>();
  for (const row of statusRows) {
    const counts = plans.get(row.planCode) ?? { incomplete: 0, active: 0, past_due: 0, canceled: 0 };
    counts[row.status] += row.n;
    plans.set(row.planCode, counts);
  }
  const live = statusRows.filter((r) => r.status === 'active' || r.status === 'past_due');
  return {
    kind: 'billing',
    range,
    buckets,
    byPlan: [...plans.entries()].map(([code, counts]) => ({ code, name: PLANS[code].name, counts, total: Object.values(counts).reduce((t, n) => t + n, 0) })),
    monthlyCents: monthlyValueCents(live),
  };
}

// --- The procedures ------------------------------------------------------------------------------

export type StaffReport = GrowthReport | ReviewReport | ArchiveReport | SchoolsReport;

/** admin.reports: one report of a period, for any staff role with a verified second factor. */
export async function adminReport(principal: Principal | null, raw: z.input<typeof adminReportInput>, now: Date = new Date()): Promise<StaffReport> {
  const p = requireStaff2FA(principal);
  const input = parsed(adminReportInput, raw);
  const range = reportRange(input.period, now);
  switch (input.report) {
    case 'growth':
      return growthReport(range);
    case 'review':
      return reviewReport(range, p.user.role === 'admin');
    case 'archive':
      return archiveReport(range);
    case 'schools':
      return schoolsReport(range);
  }
}

/** admin.billingReport: the paid plans in test mode over a period, for administrators only. */
export async function adminBillingReport(principal: Principal | null, raw: z.input<typeof adminBillingReportInput>, now: Date = new Date()): Promise<BillingReport> {
  requireStaff2FA(principal, ['admin']);
  const input = parsed(adminBillingReportInput, raw);
  return billingReport(reportRange(input.period, now));
}
