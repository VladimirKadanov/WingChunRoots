// Basic school stats (milestone M21; Phase 2 "basic school analytics"; docs/adr/0024-trial-lessons.md).
//
//   schools.track   (anyone) one event of a public school: a view of its public page, an opening of
//                   its pin or card in the finder, a click on its contact or website. Counted on the
//                   server into school_stat_day, a counter per school and UTC day, and nothing else:
//                   no IP, no account, no cookie, no fingerprint (DEFAULT M21, question 7).
//   schools.stats   (the school's listing account) the last SCHOOL_STATS_WEEKS weeks, by ISO week;
//                   a Professional Sifu entitlement (`school_business`, plan §6.5), otherwise the
//                   numbers are not read at all and the answer carries the upgrade offer only.
//
// Left out of the counts: the school's own listing account and staff (moderator, archivist,
// admin), a user agent that looks like a bot (src/lib/bots.ts, a yes or no in RequestMeta), and any
// school that v_public_school does not show. Trial inquiries are counted by
// src/server/services/trial-lessons.ts in the transaction that stores them. Counters older than
// SCHOOL_STATS_RETENTION_DAYS are deleted by the daily job (purgeOldTrialData, retention.ts).
//
// Logs carry nothing of the visitor (plan §6.4): the route handler logs no request.

import { and, eq, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { isCalendarDay } from '../../lib/dates';
import { requireUser } from '../auth/guards';
import { isStaffRole, type Principal } from '../auth/principal';
import { getDb } from '../db';
import { school } from '../db/schema';
import { SCHOOL_STAT_EVENTS, SCHOOL_STATS_RETENTION_DAYS, SCHOOL_STATS_WEEKS } from '../db/schema/common';
import { type Executor, requireEntitlement } from '../entitlements/access';
import { feature, upgradeBenefits } from '../entitlements/plans';
import type { RequestMeta } from './context';
import type { UpgradeOffer } from './dashboard';
import { ServiceError } from './errors';
import { openPilotRequest, planSummary } from './plans';

export { SCHOOL_STATS_RETENTION_DAYS, SCHOOL_STATS_WEEKS };
export type SchoolStatEvent = (typeof SCHOOL_STAT_EVENTS)[number];

/** The events a browser may report; trial inquiries are counted by the server only. */
export const TRACKED_EVENTS = ['page_view', 'pin_open', 'contact_click'] as const;

const COLUMN: Record<SchoolStatEvent, string> = {
  page_view: 'page_views',
  pin_open: 'pin_opens',
  contact_click: 'contact_clicks',
  trial_inquiry: 'trial_inquiries',
};

export const schoolTrackInput = z.object({
  schoolId: z.uuid({ error: 'No such school.' }),
  event: z.enum(TRACKED_EVENTS, { error: 'Choose an event from the list.' }),
});

/** Adds one to today's (UTC) counter of `event` for the school. */
export async function countSchoolEvent(db: Executor, schoolId: string, event: SchoolStatEvent): Promise<void> {
  const column = sql.raw(COLUMN[event]);
  await db.execute(sql`
    INSERT INTO school_stat_day (school_id, day, ${column}) VALUES (${schoolId}::uuid, (now() AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (school_id, day) DO UPDATE SET ${column} = school_stat_day.${column} + 1, updated_at = now()`);
}

/**
 * schools.track: counts one event of a public school, unless the visitor is its listing account or
 * staff, or looks like a bot. Answers whether it counted; never an error for a school that is not
 * public (the beacon of a page that went private just counts nothing).
 */
export async function trackSchoolEvent(principal: Principal | null, raw: z.input<typeof schoolTrackInput>, meta: RequestMeta): Promise<{ counted: boolean }> {
  const parsed = schoolTrackInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { [String(parsed.error.issues[0]?.path[0] ?? 'form')]: parsed.error.issues[0]?.message ?? 'Check this field.' });
  const { schoolId, event } = parsed.data;
  if (meta.likelyBot) return { counted: false };
  if (principal && isStaffRole(principal.user.role)) return { counted: false };
  const db = getDb();
  const result = await db.execute<{ owner: string | null }>(sql`
    SELECT s.created_by_user_id AS owner FROM v_public_school v JOIN school s ON s.id = v.id WHERE v.id = ${schoolId}::uuid`);
  const row = result.rows[0];
  if (!row) return { counted: false };
  if (principal && row.owner === principal.user.id) return { counted: false };
  await countSchoolEvent(db, schoolId, event);
  return { counted: true };
}

export interface SchoolStatsWeek {
  /** The Monday the ISO week starts on, YYYY-MM-DD (UTC). */
  weekStart: string;
  pageViews: number;
  pinOpens: number;
  contactClicks: number;
  trialInquiries: number;
}

export interface SchoolStatsView {
  school: { id: string; slug: string; name: string; status: string };
  /** False on a plan without `school_business`: no numbers, the upgrade offer instead. */
  available: boolean;
  /** The last SCHOOL_STATS_WEEKS weeks, oldest first, the current week last (empty when not available). */
  weeks: SchoolStatsWeek[];
  /** The Monday of the last week shown, and whether a later or an earlier stretch of weeks has days kept. */
  lastWeekStart: string | null;
  later: boolean;
  earlier: boolean;
  totals: Omit<SchoolStatsWeek, 'weekStart'> | null;
  upgrade: UpgradeOffer | null;
}

export const schoolStatsInput = z.object({
  id: z.uuid({ error: 'No such school.' }),
  /** A day (YYYY-MM-DD, UTC) of the last week shown; this week when left out. A later day counts as today. */
  weekOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Give a day as YYYY-MM-DD.' })
    // A day of the calendar (never 2026-02-31, which PostgreSQL refuses), from 1970 on.
    .refine(isCalendarDay, { error: 'Give a day as YYYY-MM-DD.' })
    .nullish(),
});

/** The upgrade offer at the real limit (plan §5.6): a Sifu plan without `school_business`. */
async function statsOffer(db: Executor, userId: string): Promise<{ ok: boolean; upgrade: UpgradeOffer | null }> {
  const decision = await requireEntitlement({ kind: 'user', userId }, 'school_business', { db });
  if (decision.ok) return { ok: true, upgrade: null };
  if (!decision.grantedBy) return { ok: false, upgrade: null };
  const from = planSummary(decision.plan);
  const to = planSummary(decision.grantedBy);
  return {
    ok: false,
    upgrade: {
      feature: 'school_business',
      heading: (feature('school_business').upgradeHeading ?? 'More with {plan}').replace('{plan}', to.name),
      allowance: { current: 0, limit: 0, sentence: `On ${from.name} your school shows its schedule and fees and takes trial lesson requests. Weekly statistics need ${to.name}.` },
      from,
      to,
      benefits: upgradeBenefits(decision.plan, decision.grantedBy, 'school_business'),
      waiting: null,
      pilotRequest: await openPilotRequest(db, userId),
    },
  };
}

/** schools.stats: see the top of this file. Only the school's listing account (404 for anyone else). */
export async function schoolStats(principal: Principal | null, raw: z.input<typeof schoolStatsInput>): Promise<SchoolStatsView> {
  const p = requireUser(principal);
  const parsed = schoolStatsInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such school.');
  const db = getDb();
  const [row] = await db
    .select({ id: school.id, slug: school.slug, name: school.name, status: school.status })
    .from(school)
    .where(and(eq(school.id, parsed.data.id), eq(school.createdByUserId, p.user.id), isNull(school.deletedAt)));
  if (!row) throw new ServiceError('NOT_FOUND', 'No such school.');
  const offer = await statsOffer(db, p.user.id);
  if (!offer.ok) return { school: row, available: false, weeks: [], lastWeekStart: null, later: false, earlier: false, totals: null, upgrade: offer.upgrade };
  // The last week shown: the week of `weekOf`, never later than this week, never before the counters kept.
  const today = sql`(now() AT TIME ZONE 'UTC')::date`;
  const anchor = parsed.data.weekOf
    ? sql`greatest(least(${parsed.data.weekOf}::date, ${today}), ${today} - ${SCHOOL_STATS_RETENTION_DAYS}::int)`
    : today;
  const result = await db.execute<{ week_start: string; page_views: number; pin_opens: number; contact_clicks: number; trial_inquiries: number; current_week: string }>(sql`
    WITH weeks AS (
      SELECT (date_trunc('week', ${anchor}) - make_interval(weeks => n))::date AS week_start
        FROM generate_series(0, ${SCHOOL_STATS_WEEKS - 1}) AS n)
    SELECT to_char(w.week_start, 'YYYY-MM-DD') AS week_start,
           coalesce(sum(d.page_views), 0)::int AS page_views,
           coalesce(sum(d.pin_opens), 0)::int AS pin_opens,
           coalesce(sum(d.contact_clicks), 0)::int AS contact_clicks,
           coalesce(sum(d.trial_inquiries), 0)::int AS trial_inquiries,
           to_char(date_trunc('week', ${today}), 'YYYY-MM-DD') AS current_week
      FROM weeks w
      LEFT JOIN school_stat_day d ON d.school_id = ${row.id}::uuid AND d.day >= w.week_start AND d.day < w.week_start + 7
     GROUP BY w.week_start
     ORDER BY w.week_start`);
  const weeks = result.rows.map((r) => ({ weekStart: r.week_start, pageViews: r.page_views, pinOpens: r.pin_opens, contactClicks: r.contact_clicks, trialInquiries: r.trial_inquiries }));
  const totals = weeks.reduce(
    (t, w) => ({ pageViews: t.pageViews + w.pageViews, pinOpens: t.pinOpens + w.pinOpens, contactClicks: t.contactClicks + w.contactClicks, trialInquiries: t.trialInquiries + w.trialInquiries }),
    { pageViews: 0, pinOpens: 0, contactClicks: 0, trialInquiries: 0 },
  );
  const lastWeekStart = weeks[weeks.length - 1]?.weekStart ?? null;
  const firstWeekStart = weeks[0]?.weekStart ?? null;
  const currentWeek = result.rows[0]?.current_week ?? null;
  const oldestKept = new Date(Date.now() - SCHOOL_STATS_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  return {
    school: row,
    available: true,
    weeks,
    lastWeekStart,
    later: lastWeekStart !== null && currentWeek !== null && lastWeekStart < currentWeek,
    earlier: firstWeekStart !== null && firstWeekStart > oldestKept,
    totals,
    upgrade: null,
  };
}
