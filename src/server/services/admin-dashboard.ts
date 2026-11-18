// The control panel (owner request 2026-11-17, docs/adr/0035-control-panel.md): the counts of its
// sidebar and the figures of its dashboard, for staff whose session passed the second factor.
// Counts and dates only, never a name, an e-mail address or a place (plan §6.4): the dashboard
// shows where work waits and how the archive grows, and each list it points to checks its own
// permissions again. Billing figures are for administrators only (as /admin/billing); they come
// from the test provider and the proposed prices (DEFAULT D09), so nothing is a real charge.

import { and, type AnyColumn, count, eq, gte, inArray, isNull, lt, min, sql } from 'drizzle-orm';

import { requireStaff2FA } from '../auth/guards';
import type { Principal, StaffRole } from '../auth/principal';
import { getDb } from '../db';
import {
  authUser,
  BILLING_LIVE_STATUSES,
  billingSubscription,
  emailDelivery,
  OPEN_REVIEW_CASE_STATUSES,
  person,
  REVIEW_CASE_KINDS,
  reviewCase,
  school,
  teachingRelationship,
} from '../db/schema';
import { billingPrice, PLANS, type PlanCode } from '../entitlements/plans';
import { failedJobCount } from '../jobs/stats';
import { systemStatus } from './system';

/** The weeks of the growth chart. */
export const GROWTH_WEEKS = 12;
/** The period of the "new" figures, in days. */
export const DASHBOARD_PERIOD_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ReviewCaseKind = (typeof REVIEW_CASE_KINDS)[number];

/** The groups of review cases the dashboard and the sidebar count (the queue's own filters). */
export const REVIEW_KIND_GROUPS: readonly { key: string; label: string; kinds: readonly ReviewCaseKind[] }[] = [
  { key: 'claims', label: 'Historical and profile claims', kinds: ['historical_claim', 'person_claim'] },
  { key: 'instructors', label: 'Instructor checks', kinds: ['instructor_verification'] },
  { key: 'schools', label: 'School listings', kinds: ['school_listing'] },
  { key: 'organizations', label: 'Organizations', kinds: ['organization_application'] },
  { key: 'records', label: 'Record proposals', kinds: ['record_proposal'] },
  { key: 'disputes', label: 'Disputes, reports and appeals', kinds: ['relationship_dispute', 'profile_report', 'lineage_report', 'decision_appeal', 'succession_request'] },
  { key: 'deletions', label: 'Account deletion requests', kinds: ['deletion_request'] },
];

export interface AdminNavCounts {
  /** Open review cases of every kind (open, in review, needs information). */
  openReview: number;
  /** Failed jobs plus e-mails that could not be delivered: something on the system page needs a look. */
  systemProblems: number;
}

/** The sidebar's counts: two cheap counts on every control panel page. */
export async function adminNavCounts(principal: Principal | null): Promise<AdminNavCounts> {
  requireStaff2FA(principal);
  const db = getDb();
  const [[review], [email], failedJobs] = await Promise.all([
    db.select({ n: count() }).from(reviewCase).where(inArray(reviewCase.status, OPEN_REVIEW_CASE_STATUSES)),
    db.select({ n: count() }).from(emailDelivery).where(eq(emailDelivery.status, 'failed')),
    failedJobCount(db),
  ]);
  return { openReview: review?.n ?? 0, systemProblems: (email?.n ?? 0) + failedJobs };
}

export interface DashboardFigure {
  total: number;
  /** Added in the last DASHBOARD_PERIOD_DAYS days. */
  recent: number;
}

export interface DashboardWeek {
  /** Monday of the week (ISO date, UTC). */
  weekStart: string;
  accounts: number;
  people: number;
}

export interface DashboardReviewGroup {
  key: string;
  label: string;
  open: number;
}

export interface DashboardBilling {
  /** Subscriptions that give access (active or past due) in test mode. */
  paidPlans: number;
  /** Their monthly value in US cents at the proposed prices (a yearly plan counts a twelfth). */
  monthlyCents: number;
  pastDue: number;
  byPlan: { code: PlanCode; name: string; count: number }[];
}

export interface AdminDashboard {
  /** When these numbers were read (ISO 8601). */
  checkedAt: string;
  role: StaffRole;
  periodDays: number;
  accounts: DashboardFigure;
  people: DashboardFigure;
  verifiedLinks: DashboardFigure;
  schools: { listed: number; awaitingConfirmation: number; hidden: number; pendingReview: number };
  review: {
    open: number;
    assignedToMe: number;
    unassigned: number;
    /** When the oldest open case was opened (ISO 8601), or null. */
    oldestOpenedAt: string | null;
    groups: DashboardReviewGroup[];
  };
  growth: DashboardWeek[];
  system: {
    failedJobs: number;
    failedEmails: number;
    /** When the newest local backup was written (ISO 8601), or null when there is none yet. */
    lastBackupAt: string | null;
  };
  /** Administrators only; null for other staff roles. */
  billing: DashboardBilling | null;
  /** Open account deletion requests: administrators only (they carry them out); 0 for others. */
  deletionRequests: number;
}

/** Monday 00:00 UTC of the week of `date`. */
export function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * DAY_MS);
}

/** The last `weeks` weeks, oldest first, with the counts of `rows` (missing weeks are 0). */
export function fillWeeks(now: Date, weeks: number, accounts: { week: string; n: number }[], people: { week: string; n: number }[]): DashboardWeek[] {
  const first = weekStart(now).getTime() - (weeks - 1) * 7 * DAY_MS;
  const byWeek = (rows: { week: string; n: number }[]) => new Map(rows.map((r) => [r.week.slice(0, 10), r.n]));
  const a = byWeek(accounts);
  const p = byWeek(people);
  return Array.from({ length: weeks }, (_, i) => {
    const key = new Date(first + i * 7 * DAY_MS).toISOString().slice(0, 10);
    return { weekStart: key, accounts: a.get(key) ?? 0, people: p.get(key) ?? 0 };
  });
}

/** The monthly value of live subscriptions at the proposed prices, in US cents. */
export function monthlyValueCents(rows: { planCode: PlanCode; interval: 'month' | 'year'; n: number }[]): number {
  return rows.reduce((total, row) => {
    const price = billingPrice(row.planCode, row.interval);
    if (!price) return total;
    return total + Math.round((row.interval === 'year' ? price.amountCents / 12 : price.amountCents) * row.n);
  }, 0);
}

export async function adminDashboard(principal: Principal | null, now: Date = new Date()): Promise<AdminDashboard> {
  const p = requireStaff2FA(principal);
  const isAdmin = p.user.role === 'admin';
  const db = getDb();
  const since = new Date(now.getTime() - DASHBOARD_PERIOD_DAYS * DAY_MS);
  const growthFrom = new Date(weekStart(now).getTime() - (GROWTH_WEEKS - 1) * 7 * DAY_MS);
  const recent = (column: AnyColumn) => sql<number>`count(*) FILTER (WHERE ${column} >= ${since})`.mapWith(Number);
  const week = (column: AnyColumn) => sql<string>`to_char(date_trunc('week', ${column} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

  const [[accounts], [people], [links], [schools], reviewRows, [reviewSummary], accountWeeks, peopleWeeks, system, billingRows] = await Promise.all([
    db.select({ total: count(), recent: recent(authUser.createdAt) }).from(authUser),
    db.select({ total: count(), recent: recent(person.createdAt) }).from(person).where(isNull(person.deletedAt)),
    db
      .select({ total: count(), recent: recent(teachingRelationship.confirmedAt) })
      .from(teachingRelationship)
      .where(eq(teachingRelationship.status, 'verified')),
    db
      .select({
        listed: sql<number>`count(*) FILTER (WHERE ${school.status} = 'active' AND ${school.activityStage} <> 'hidden')`.mapWith(Number),
        awaiting: sql<number>`count(*) FILTER (WHERE ${school.status} = 'active' AND ${school.activityStage} = 'awaiting_confirmation')`.mapWith(Number),
        hidden: sql<number>`count(*) FILTER (WHERE ${school.status} = 'active' AND ${school.activityStage} = 'hidden')`.mapWith(Number),
        pendingReview: sql<number>`count(*) FILTER (WHERE ${school.status} = 'pending_review')`.mapWith(Number),
      })
      .from(school),
    db
      .select({ kind: reviewCase.kind, n: count() })
      .from(reviewCase)
      .where(inArray(reviewCase.status, OPEN_REVIEW_CASE_STATUSES))
      .groupBy(reviewCase.kind),
    db
      .select({
        oldest: min(reviewCase.createdAt),
        mine: sql<number>`count(*) FILTER (WHERE ${reviewCase.assignedToUserId} = ${p.user.id})`.mapWith(Number),
        unassigned: sql<number>`count(*) FILTER (WHERE ${reviewCase.assignedToUserId} IS NULL)`.mapWith(Number),
      })
      .from(reviewCase)
      .where(inArray(reviewCase.status, OPEN_REVIEW_CASE_STATUSES)),
    db
      .select({ week: week(authUser.createdAt), n: count() })
      .from(authUser)
      .where(and(gte(authUser.createdAt, growthFrom), lt(authUser.createdAt, now)))
      .groupBy(sql`1`),
    db
      .select({ week: week(person.createdAt), n: count() })
      .from(person)
      .where(and(isNull(person.deletedAt), gte(person.createdAt, growthFrom), lt(person.createdAt, now)))
      .groupBy(sql`1`),
    systemStatus(p),
    isAdmin
      ? db
          .select({ planCode: billingSubscription.planCode, interval: billingSubscription.interval, status: billingSubscription.status, n: count() })
          .from(billingSubscription)
          .where(inArray(billingSubscription.status, BILLING_LIVE_STATUSES))
          .groupBy(billingSubscription.planCode, billingSubscription.interval, billingSubscription.status)
      : Promise.resolve(null),
  ]);

  const openByKind = new Map(reviewRows.map((r) => [r.kind as ReviewCaseKind, r.n]));
  const groups = REVIEW_KIND_GROUPS.filter((g) => isAdmin || g.key !== 'deletions').map((g) => ({
    key: g.key,
    label: g.label,
    open: g.kinds.reduce((total, kind) => total + (openByKind.get(kind) ?? 0), 0),
  }));
  const open = reviewRows.reduce((total, r) => total + r.n, 0);
  const oldest = reviewSummary?.oldest ?? null;

  let billing: DashboardBilling | null = null;
  if (billingRows) {
    const byCode = new Map<PlanCode, number>();
    for (const row of billingRows) byCode.set(row.planCode, (byCode.get(row.planCode) ?? 0) + row.n);
    billing = {
      paidPlans: billingRows.reduce((total, r) => total + r.n, 0),
      monthlyCents: monthlyValueCents(billingRows),
      pastDue: billingRows.filter((r) => r.status === 'past_due').reduce((total, r) => total + r.n, 0),
      byPlan: [...byCode.entries()].map(([code, n]) => ({ code, name: PLANS[code].name, count: n })),
    };
  }

  return {
    checkedAt: now.toISOString(),
    role: p.user.role,
    periodDays: DASHBOARD_PERIOD_DAYS,
    accounts: { total: accounts?.total ?? 0, recent: accounts?.recent ?? 0 },
    people: { total: people?.total ?? 0, recent: people?.recent ?? 0 },
    verifiedLinks: { total: links?.total ?? 0, recent: links?.recent ?? 0 },
    schools: { listed: schools?.listed ?? 0, awaitingConfirmation: schools?.awaiting ?? 0, hidden: schools?.hidden ?? 0, pendingReview: schools?.pendingReview ?? 0 },
    review: {
      open,
      assignedToMe: reviewSummary?.mine ?? 0,
      unassigned: reviewSummary?.unassigned ?? 0,
      oldestOpenedAt: oldest ? new Date(oldest).toISOString() : null,
      groups,
    },
    growth: fillWeeks(now, GROWTH_WEEKS, accountWeeks, peopleWeeks),
    system: { failedJobs: system.queue.failed, failedEmails: system.email.failed, lastBackupAt: system.backup.latest?.createdAt ?? null },
    billing,
    deletionRequests: isAdmin ? (openByKind.get('deletion_request') ?? 0) : 0,
  };
}
