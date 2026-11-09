// School activity checks (milestone M20; specification §7.3; docs/adr/0023-school-activity.md).
//
// A listed school (status `active`, not deleted, listed by an account) whose listing account has
// not edited or confirmed it ("This listing is current", schools.confirm) moves through stored
// stages, so every public read filters one column (v_public_school) and nothing is computed from
// dates at read time:
//
//   current                -> awaiting_confirmation   at day 90 (SCHOOL_AWAITING_DAYS) without
//                                                     activity: the owner is asked to confirm, the
//                                                     admins of the organizations it accepted a link
//                                                     from are told; the listing stays public
//   awaiting_confirmation  -> hidden                  at day 105 (SCHOOL_HIDDEN_DAYS), and never less
//                                                     than SCHOOL_CONFIRM_GRACE_DAYS after the request:
//                                                     off every public answer, never deleted; the owner
//                                                     is told how to show it again
//   any stage              -> current                 an edit or a confirmation (schools.update,
//                                                     schools.confirm, schools.submit): resetActivity()
//
// DEFAULT D17: only an edit or a confirmation is activity. Signing in is not (no sign-in path
// touches school), and nothing else moves last_activity_at.
// DEFAULT D18: the pin returns only when every other condition still holds: the listing is active
// and moderated, and the listing account holds Professional Sifu (v_public_school). A Free Sifu's
// confirmation is recorded and unlocks no pin.
// DEFAULT D17 (M20): a school without a listing account (a record of the platform, the fictional
// demo schools of M01, D20) has nobody to ask, so the check leaves it alone.
//
// The daily job (src/server/jobs/school-activity.ts) calls runSchoolActivityCheck(). It is
// idempotent and safe on reruns and under clock skew:
// - Ages are measured with the database's clock (now() of the job's transaction, or the `now`
//   a test passes), never the worker's; a last_activity_at in the future (a web process whose
//   clock runs ahead) only makes the school younger.
// - Each school moves in its own transaction with an UPDATE that repeats every condition, so a
//   confirmation that commits first wins and the job writes nothing for that school.
// - Each notice has a key per school, stage and period without activity
//   (`school.activity-awaiting:<id>:<last activity in ms>`), so a rerun, a retried job or two
//   workers at once send it once; a later period after a confirmation gets new keys.
// - A run that missed days catches up without skipping the request: hiding needs the request to be
//   SCHOOL_CONFIRM_GRACE_DAYS old.
// - After it hides a school, the job drops the public cache of schools (the `schools` tag) through
//   the web process's internal route; the cached answers live for minutes in any case.
//
// Logs carry counts and ids only, never a name or a point (plan §6.4).

import { type SQL, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { SCHOOLS_TAG } from '../cache-tags';
import type { Database } from '../db';
import { getDb } from '../db';
import { SCHOOL_ACTIVITY_STAGES, SCHOOL_AWAITING_DAYS, SCHOOL_CONFIRM_GRACE_DAYS, SCHOOL_HIDDEN_DAYS } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import { type NoticeProducer, notify, notifyEach } from './notify';

export { SCHOOL_AWAITING_DAYS, SCHOOL_CONFIRM_GRACE_DAYS, SCHOOL_HIDDEN_DAYS };
export type SchoolActivityStage = (typeof SCHOOL_ACTIVITY_STAGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stage a confirmation or an edit sets: current, without the job's timestamps. */
export const ACTIVITY_RESET = { activityStage: 'current', activityAwaitingSince: null, activityHiddenAt: null } as const;

/** The owner's words for each stage (status in text, never colour alone). */
export const ACTIVITY_LABELS: Record<SchoolActivityStage, string> = {
  current: 'Current',
  awaiting_confirmation: 'Awaiting confirmation',
  hidden: 'Hidden from the map',
};

/** The activity of one school, for its owner and for staff. */
export interface SchoolActivity {
  stage: SchoolActivityStage;
  label: string;
  /** When its listing account last edited or confirmed it. */
  lastActivityAt: string;
  /** awaiting_confirmation: when the owner was asked; hidden: when it was asked too. */
  awaitingSince: string | null;
  /** hidden: when the pin and the listing were taken off the public map and list. */
  hiddenAt: string | null;
  /**
   * awaiting_confirmation: the earliest day the job hides it without a confirmation (day 105, and
   * at least SCHOOL_CONFIRM_GRACE_DAYS after the request). Null in the other stages.
   */
  hiddenFrom: string | null;
}

/** The earliest moment the job hides a school that is awaiting confirmation. */
export function hiddenFrom(lastActivityAt: Date, awaitingSince: Date): Date {
  return new Date(Math.max(lastActivityAt.getTime() + SCHOOL_HIDDEN_DAYS * DAY_MS, awaitingSince.getTime() + SCHOOL_CONFIRM_GRACE_DAYS * DAY_MS));
}

export function activityOf(row: { activityStage: SchoolActivityStage; lastActivityAt: Date; activityAwaitingSince: Date | null; activityHiddenAt: Date | null }): SchoolActivity {
  return {
    stage: row.activityStage,
    label: ACTIVITY_LABELS[row.activityStage],
    lastActivityAt: row.lastActivityAt.toISOString(),
    awaitingSince: row.activityAwaitingSince?.toISOString() ?? null,
    hiddenAt: row.activityHiddenAt?.toISOString() ?? null,
    hiddenFrom: row.activityStage === 'awaiting_confirmation' && row.activityAwaitingSince ? hiddenFrom(row.lastActivityAt, row.activityAwaitingSince).toISOString() : null,
  };
}

// --- The daily job ---------------------------------------------------------------------------------

export interface SchoolActivityResult {
  /** Schools that moved to awaiting_confirmation in this run. */
  awaiting: number;
  /** Schools hidden in this run. */
  hidden: number;
  /** Notices written in this run (owners and organization admins). */
  notices: number;
}

export interface SchoolActivityOptions {
  /** The instant to measure ages from; the database's clock when left out (the job). Tests pass one. */
  now?: Date;
  /** The worker's own pg-boss, for the e-mails of the notices. */
  boss?: NoticeProducer;
  /** Called with the cache tags to drop when a school was hidden (the worker posts them to the web process). */
  revalidate?: (tags: string[]) => Promise<void>;
  /** At most this many schools per pass and run (the next run continues). */
  batch?: number;
}

/** The listed schools of an account, the only ones the check moves (DEFAULT D17: not platform records). */
const CHECKED = sql`s.status = 'active' AND s.deleted_at IS NULL AND s.created_by_user_id IS NOT NULL`;

interface MovedRow extends Record<string, unknown> {
  id: string;
  name: string;
  owner: string;
  last_activity_at: Date | string;
  activity_awaiting_since: Date | string | null;
}

const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

/** The admins of the active organizations that hold an accepted link to the school (not its owner). */
async function organizationAdminsOf(db: Executor, schoolId: string, ownerId: string): Promise<{ userId: string; organizationId: string }[]> {
  const result = await db.execute<{ user_id: string; organization_id: string }>(sql`
    SELECT DISTINCT a.user_id, o.id AS organization_id
      FROM organization_school l
      JOIN organization o ON o.id = l.organization_id AND o.status = 'active' AND o.deleted_at IS NULL
      JOIN organization_admin a ON a.organization_id = o.id AND a.revoked_at IS NULL
     WHERE l.school_id = ${schoolId}::uuid AND l.status = 'accepted' AND a.user_id <> ${ownerId}::uuid
     ORDER BY o.id, a.user_id`);
  return result.rows.map((r) => ({ userId: r.user_id, organizationId: r.organization_id }));
}

/** Whether v_public_school shows the school now (the plan, the listing, the stage). */
async function onPublicMap(db: Executor, schoolId: string): Promise<boolean> {
  const result = await db.execute<{ shown: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM v_public_school v WHERE v.id = ${schoolId}::uuid) AS shown`);
  return result.rows[0]?.shown === true;
}

/** Whether a school was hidden in the last day: a retried run drops the cache again for it. */
async function hiddenRecently(db: Database, at: SQL): Promise<boolean> {
  try {
    const result = await db.execute<{ recent: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM school s WHERE ${CHECKED} AND s.activity_stage = 'hidden' AND s.activity_hidden_at > ${at} - interval '1 day') AS recent`);
    return result.rows[0]?.recent === true;
  } catch {
    return false;
  }
}

/** Runs both passes once: day 90 (awaiting) first, then day 105 (hidden). */
export async function runSchoolActivityCheck(db: Database, options: SchoolActivityOptions = {}): Promise<SchoolActivityResult> {
  const batch = options.batch ?? 500;
  const at = options.now ? sql`${options.now.toISOString()}::timestamptz` : sql`now()`;
  const result: SchoolActivityResult = { awaiting: 0, hidden: 0, notices: 0 };
  try {
    await askAndHide(db, options, batch, at, result);
  } finally {
    // After a failure too, and on a retry: a school hidden by an earlier attempt (whose cache drop
    // was lost) is dropped from the public cache again, as lineageRecomputeHandler does.
    if (options.revalidate && (result.hidden > 0 || (await hiddenRecently(db, at)))) await options.revalidate([SCHOOLS_TAG]);
  }
  return result;
}

async function askAndHide(db: Database, options: SchoolActivityOptions, batch: number, at: SQL, result: SchoolActivityResult): Promise<void> {
  // Day 90: ask the owner. The candidates first (the partial index), then each school on its own.
  const awaitingCondition = sql`${CHECKED} AND s.activity_stage = 'current' AND s.last_activity_at <= ${at} - make_interval(days => ${SCHOOL_AWAITING_DAYS})`;
  const toAsk = await db.execute<{ id: string }>(sql`SELECT s.id FROM school s WHERE ${awaitingCondition} ORDER BY s.last_activity_at, s.id LIMIT ${batch}`);
  for (const { id } of toAsk.rows) {
    await db.transaction(async (tx) => {
      const moved = await tx.execute<MovedRow>(sql`
        UPDATE school s SET activity_stage = 'awaiting_confirmation', activity_awaiting_since = ${at}
         WHERE s.id = ${id}::uuid AND ${awaitingCondition}
        RETURNING s.id, s.name, s.created_by_user_id AS owner, s.last_activity_at, s.activity_awaiting_since`);
      const row = moved.rows[0];
      if (!row) return;
      result.awaiting += 1;
      const last = asDate(row.last_activity_at);
      const confirmBy = hiddenFrom(last, asDate(row.activity_awaiting_since!));
      const key = `school.activity-awaiting:${row.id}:${last.getTime()}`;
      // A listing that is not on the public map (a Free Sifu's, DEFAULT D18) is told so, never that it leaves the map.
      const onMap = await onPublicMap(tx, row.id);
      const payload = { schoolId: row.id, name: row.name, lastActivityAt: last.toISOString(), confirmBy: confirmBy.toISOString(), onMap };
      await writeAudit(tx, {
        action: 'school.activity_awaiting',
        actorUserId: null,
        actorRole: 'system',
        subjectType: 'school',
        subjectId: row.id,
        before: { activityStage: 'current' },
        after: { activityStage: 'awaiting_confirmation', lastActivityAt: last.toISOString() },
      });
      if ((await notify(tx, row.owner, 'school.activity-awaiting', { ...payload, organizationId: null }, { key, boss: options.boss })).notified) result.notices += 1;
      // The organization admins are told only about a school the public sees on the map.
      for (const admin of onMap ? await organizationAdminsOf(tx, row.id, row.owner) : []) {
        // The key (and so the e-mail's) names the organization and the admin: one each.
        result.notices += await notifyEach(tx, [admin.userId], 'school.activity-awaiting', { ...payload, organizationId: admin.organizationId }, {
          key: `${key}:${admin.organizationId}:${admin.userId}`,
          boss: options.boss,
        });
      }
    });
  }

  // Day 105: hide the pin and the listing, never sooner than the grace period after the request.
  const hiddenCondition = sql`${CHECKED} AND s.activity_stage = 'awaiting_confirmation'
    AND s.last_activity_at <= ${at} - make_interval(days => ${SCHOOL_HIDDEN_DAYS})
    AND s.activity_awaiting_since <= ${at} - make_interval(days => ${SCHOOL_CONFIRM_GRACE_DAYS})`;
  const toHide = await db.execute<{ id: string }>(sql`SELECT s.id FROM school s WHERE ${hiddenCondition} ORDER BY s.last_activity_at, s.id LIMIT ${batch}`);
  for (const { id } of toHide.rows) {
    await db.transaction(async (tx) => {
      // Whether hiding takes it off the public map, or it was not on it (a Free Sifu's, DEFAULT D18).
      const onMap = await onPublicMap(tx, id);
      const moved = await tx.execute<MovedRow>(sql`
        UPDATE school s SET activity_stage = 'hidden', activity_hidden_at = ${at}
         WHERE s.id = ${id}::uuid AND ${hiddenCondition}
        RETURNING s.id, s.name, s.created_by_user_id AS owner, s.last_activity_at, s.activity_awaiting_since`);
      const row = moved.rows[0];
      if (!row) return;
      result.hidden += 1;
      const last = asDate(row.last_activity_at);
      await writeAudit(tx, {
        action: 'school.activity_hidden',
        actorUserId: null,
        actorRole: 'system',
        subjectType: 'school',
        subjectId: row.id,
        before: { activityStage: 'awaiting_confirmation' },
        after: { activityStage: 'hidden', lastActivityAt: last.toISOString() },
      });
      const notice = await notify(
        tx,
        row.owner,
        'school.activity-hidden',
        { schoolId: row.id, name: row.name, lastActivityAt: last.toISOString(), onMap },
        { key: `school.activity-hidden:${row.id}:${last.getTime()}`, boss: options.boss },
      );
      if (notice.notified) result.notices += 1;
    });
  }
}

// --- Staff: the listed schools by stage --------------------------------------------------------------

export const ADMIN_SCHOOL_STAGE_FILTERS = ['all', ...SCHOOL_ACTIVITY_STAGES] as const;
export const adminSchoolsInput = z.object({
  stage: z.enum(ADMIN_SCHOOL_STAGE_FILTERS, { error: 'Choose a stage from the list.' }).default('all'),
});

export interface AdminSchoolItem {
  id: string;
  slug: string;
  name: string;
  city: string;
  countryCode: string;
  /** A school without a listing account is a record of the platform: the check leaves it alone. */
  listedByAccount: boolean;
  /** Whether v_public_school shows it now (the plan, the stage, the listing). */
  public: boolean;
  activity: SchoolActivity;
}

export interface AdminSchools {
  stage: (typeof ADMIN_SCHOOL_STAGE_FILTERS)[number];
  counts: Record<SchoolActivityStage, number>;
  schools: AdminSchoolItem[];
  /** True when more schools match than the list shows. */
  truncated: boolean;
}

/** At most this many schools in the staff list (hidden and awaiting first). */
export const ADMIN_SCHOOL_LIMIT = 200;

/**
 * schools.adminList: the listed schools with their activity stage, for moderators and
 * administrators with a verified second factor (they moderate listings, M11). Hidden first, then
 * awaiting, then current; the listings of accounts before the platform's records; within each, the
 * longest without activity first; `stage` filters. No contact, no point, no account: the name, the city and dates.
 */
export async function adminSchools(principal: Principal | null, raw: z.input<typeof adminSchoolsInput> = {}): Promise<AdminSchools> {
  requireStaff2FA(principal, ['moderator', 'admin']);
  const parsed = adminSchoolsInput.safeParse(raw ?? {});
  const stage = parsed.success ? parsed.data.stage : 'all';
  const db = getDb();
  const counted = await db.execute<{ activity_stage: SchoolActivityStage; n: number }>(sql`
    SELECT s.activity_stage, count(*)::int AS n FROM school s WHERE s.status = 'active' AND s.deleted_at IS NULL GROUP BY s.activity_stage`);
  const counts: Record<SchoolActivityStage, number> = { current: 0, awaiting_confirmation: 0, hidden: 0 };
  for (const row of counted.rows) counts[row.activity_stage] = row.n;
  const result = await db.execute<{
    id: string;
    slug: string;
    name: string;
    city: string;
    country_code: string;
    listed: boolean;
    public: boolean;
    activity_stage: SchoolActivityStage;
    last_activity_at: Date | string;
    activity_awaiting_since: Date | string | null;
    activity_hidden_at: Date | string | null;
  }>(sql`
    SELECT s.id, s.slug, s.name, p.name AS city, p.country_code, s.created_by_user_id IS NOT NULL AS listed,
           v.id IS NOT NULL AS public,
           s.activity_stage, s.last_activity_at, s.activity_awaiting_since, s.activity_hidden_at
      FROM school s JOIN place p ON p.id = s.place_id
      LEFT JOIN v_public_school v ON v.id = s.id
     WHERE s.status = 'active' AND s.deleted_at IS NULL ${stage === 'all' ? sql`` : sql`AND s.activity_stage = ${stage}`}
     -- Hidden, then awaiting, then current; the schools the check moves before the platform's records.
     ORDER BY CASE s.activity_stage WHEN 'hidden' THEN 0 WHEN 'awaiting_confirmation' THEN 1 ELSE 2 END,
              (s.created_by_user_id IS NULL), s.last_activity_at, s.name, s.id
     LIMIT ${ADMIN_SCHOOL_LIMIT + 1}`);
  const rows = result.rows.slice(0, ADMIN_SCHOOL_LIMIT);
  return {
    stage,
    counts,
    truncated: result.rows.length > ADMIN_SCHOOL_LIMIT,
    schools: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      city: r.city,
      countryCode: r.country_code,
      listedByAccount: r.listed,
      public: r.public,
      activity: activityOf({
        activityStage: r.activity_stage,
        lastActivityAt: asDate(r.last_activity_at),
        activityAwaitingSince: r.activity_awaiting_since === null ? null : asDate(r.activity_awaiting_since),
        activityHiddenAt: r.activity_hidden_at === null ? null : asDate(r.activity_hidden_at),
      }),
    })),
  };
}
