// The schedule and fees of a school (milestone M21; plan §1 "График, такси, снимки и бутон за пробна
// тренировка"; docs/adr/0024-trial-lessons.md).
//
//   schools.schedule        the schedule and fees of one of the account's own schools, for its editor
//   schools.updateSchedule  replaces the weekly schedule (at most SCHOOL_SCHEDULE_MAX rows: weekday,
//                           start and end in the school's zone, a short label) and the fees (a short
//                           free text and "the first trial lesson is free")
//
// DEFAULT M21 (question 1): plain listing content of every listed school, with no plan gate. It is
// shown on the public page (schools.get) while the school is public (v_public_school).
// DEFAULT M21 (question 2): an edit is activity (M20, DEFAULT D17): last_activity_at moves and the
// activity check starts again (ACTIVITY_RESET). It goes through the moderation path of the other
// listing edits that a reviewer does not check again (the description, contacts and forms): the
// listing stays listed, updated_at moves (the version a listing decision carries, so a reviewer
// holding an older version reloads it), the audit row names the fields that changed, and a
// moderator can still hide the listing. Times are wall-clock times in the zone of the school's city
// (place.timezone; UTC when the extract names none).

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, SCHOOLS_TAG } from '../cache';
import { getDb } from '../db';
import { place, school, schoolScheduleSlot } from '../db/schema';
import { SCHOOL_FEES_MAX, SCHOOL_SCHEDULE_LABEL_MAX, SCHOOL_SCHEDULE_MAX, SCHOOL_STATUSES, WEEKDAYS } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { ACTIVITY_RESET } from './school-activity';

export { SCHOOL_FEES_MAX, SCHOOL_SCHEDULE_LABEL_MAX, SCHOOL_SCHEDULE_MAX };

export const WEEKDAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

const NO_SCHOOL = 'No such school.';
const notFound = () => new ServiceError('NOT_FOUND', NO_SCHOOL);
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const clockTime = (message: string) => z.string({ error: message }).trim().regex(HH_MM, { error: message });

export const scheduleSlotInput = z
  .object({
    weekday: z.number({ error: 'Choose a day.' }).int({ error: 'Choose a day.' }).min(1, { error: 'Choose a day.' }).max(7, { error: 'Choose a day.' }),
    startsAt: clockTime('Give the start as hours and minutes, like 18:30.'),
    endsAt: clockTime('Give the end as hours and minutes, like 20:00.'),
    label: z
      .string()
      .max(SCHOOL_SCHEDULE_LABEL_MAX * 2)
      .transform((s) => s.normalize('NFC').replace(/\s+/g, ' ').trim())
      .refine((s) => s.length <= SCHOOL_SCHEDULE_LABEL_MAX, { error: `Use at most ${SCHOOL_SCHEDULE_LABEL_MAX} characters for a label.` })
      .nullish()
      .transform((s) => (s ? s : null)),
  })
  .refine((s) => s.endsAt > s.startsAt, { error: 'A class ends after it starts, on the same day.', path: ['endsAt'] });

export const scheduleUpdateInput = z.object({
  id: z.uuid({ error: NO_SCHOOL }),
  slots: z.array(scheduleSlotInput).max(SCHOOL_SCHEDULE_MAX, { error: `List at most ${SCHOOL_SCHEDULE_MAX} classes.` }).default([]),
  fees: z
    .string()
    .max(SCHOOL_FEES_MAX * 2, { error: `Use at most ${SCHOOL_FEES_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length <= SCHOOL_FEES_MAX, { error: `Use at most ${SCHOOL_FEES_MAX} characters.` })
    .nullish()
    .transform((s) => (s ? s : null)),
  firstTrialFree: z.boolean({ error: 'Say whether the first trial lesson is free.' }).default(false),
});
export type ScheduleUpdateInput = z.input<typeof scheduleUpdateInput>;
export const scheduleGetInput = z.object({ id: z.uuid({ error: NO_SCHOOL }) });

export interface ScheduleSlot {
  weekday: number;
  weekdayLabel: string;
  /** "HH:MM" in the school's zone. */
  startsAt: string;
  endsAt: string;
  label: string | null;
}

export interface SchoolScheduleView {
  id: string;
  slug: string;
  name: string;
  status: (typeof SCHOOL_STATUSES)[number];
  /** The zone of the school's city: the times are wall-clock times there. */
  timezone: string;
  slots: ScheduleSlot[];
  fees: string | null;
  firstTrialFree: boolean;
  limits: { slots: number; label: number; fees: number };
}

const hhmm = (t: string) => t.slice(0, 5);

/** The schedule of a school, by day and time (any reader: the caller decides who may see it). */
export async function scheduleOf(db: Executor, schoolId: string): Promise<ScheduleSlot[]> {
  const rows = await db
    .select({ weekday: schoolScheduleSlot.weekday, startsAt: schoolScheduleSlot.startsAt, endsAt: schoolScheduleSlot.endsAt, label: schoolScheduleSlot.label })
    .from(schoolScheduleSlot)
    .where(eq(schoolScheduleSlot.schoolId, schoolId))
    .orderBy(asc(schoolScheduleSlot.weekday), asc(schoolScheduleSlot.startsAt), asc(schoolScheduleSlot.position), asc(schoolScheduleSlot.id));
  return rows.map((r) => ({
    weekday: r.weekday,
    weekdayLabel: WEEKDAY_LABELS[r.weekday as keyof typeof WEEKDAY_LABELS] ?? 'Day',
    startsAt: hhmm(r.startsAt),
    endsAt: hhmm(r.endsAt),
    label: r.label,
  }));
}

/** The public schedule, zone and fees of a school that v_public_school shows (schools.get). */
export async function publicScheduleOf(db: Executor, schoolId: string): Promise<{ schedule: ScheduleSlot[]; timezone: string; fees: string | null; firstTrialFree: boolean }> {
  const [row] = await db
    .select({ fees: school.feesText, firstTrialFree: school.firstTrialFree, timezone: place.timezone })
    .from(school)
    .innerJoin(place, eq(place.id, school.placeId))
    .where(eq(school.id, schoolId));
  return { schedule: await scheduleOf(db, schoolId), timezone: row?.timezone ?? 'UTC', fees: row?.fees ?? null, firstTrialFree: row?.firstTrialFree ?? false };
}

async function ownSchool(db: Executor, userId: string, id: string, lock = false) {
  const query = db
    .select({
      id: school.id,
      slug: school.slug,
      name: school.name,
      status: school.status,
      fees: school.feesText,
      firstTrialFree: school.firstTrialFree,
      activityStage: school.activityStage,
      timezone: place.timezone,
    })
    .from(school)
    .innerJoin(place, eq(place.id, school.placeId))
    .where(and(eq(school.id, id), eq(school.createdByUserId, userId), isNull(school.deletedAt)));
  const [row] = lock ? await query.for('update', { of: school }) : await query;
  return row ?? null;
}

const LIMITS = { slots: SCHOOL_SCHEDULE_MAX, label: SCHOOL_SCHEDULE_LABEL_MAX, fees: SCHOOL_FEES_MAX };

/** schools.schedule: the schedule and fees of one of the account's own schools (404 for any other). */
export async function schoolSchedule(principal: Principal | null, raw: z.input<typeof scheduleGetInput>): Promise<SchoolScheduleView> {
  const p = requireUser(principal);
  const parsed = scheduleGetInput.safeParse(raw);
  if (!parsed.success) throw notFound();
  const db = getDb();
  const row = await ownSchool(db, p.user.id, parsed.data.id);
  if (!row) throw notFound();
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    timezone: row.timezone ?? 'UTC',
    slots: await scheduleOf(db, row.id),
    fees: row.fees,
    firstTrialFree: row.firstTrialFree,
    limits: LIMITS,
  };
}

function fieldErrors(error: z.ZodError): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    // slots.<n>.<field> becomes "slots.<n>.<field>", the name the form gives that input.
    const key = issue.path[0] === 'slots' && issue.path.length >= 3 ? `slots.${String(issue.path[1])}.${String(issue.path[2])}` : String(issue.path[0] ?? 'form');
    fields[key] ??= issue.message;
  }
  return new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

const EDITABLE: readonly (typeof SCHOOL_STATUSES)[number][] = ['draft', 'pending_review', 'active'];

export interface ScheduleSaved {
  id: string;
  slug: string;
  changed: string[];
}

/** schools.updateSchedule: see the top of this file. */
export async function updateSchoolSchedule(principal: Principal | null, raw: ScheduleUpdateInput, meta: RequestMeta): Promise<ScheduleSaved> {
  const p = requireUser(principal);
  const parsed = scheduleUpdateInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  const outcome = await db.transaction(async (tx) => {
    const row = await ownSchool(tx, p.user.id, input.id, true);
    if (!row) throw notFound();
    if (!EDITABLE.includes(row.status)) throw new ServiceError('CONFLICT', 'A moderator hid this school or it is archived: it cannot be edited.');
    const before = await scheduleOf(tx, row.id);
    const key = (s: { weekday: number; startsAt: string; endsAt: string; label: string | null }) => `${s.weekday}|${s.startsAt}|${s.endsAt}|${s.label ?? ''}`;
    const sorted = [...input.slots].sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt) || key(a).localeCompare(key(b)));
    const changed: string[] = [];
    // The same rows in another order are the same schedule (two classes may share a day and a time).
    if (before.map(key).sort().join('\n') !== sorted.map(key).sort().join('\n')) changed.push('schedule');
    if (row.fees !== input.fees) changed.push('fees');
    if (row.firstTrialFree !== input.firstTrialFree) changed.push('firstTrialFree');
    if (changed.length === 0) return { saved: { id: row.id, slug: row.slug, changed }, publicChange: false };
    if (changed.includes('schedule')) {
      await tx.delete(schoolScheduleSlot).where(eq(schoolScheduleSlot.schoolId, row.id));
      if (sorted.length > 0) {
        await tx.insert(schoolScheduleSlot).values(
          sorted.map((s, position) => ({ schoolId: row.id, weekday: s.weekday, startsAt: `${s.startsAt}:00`, endsAt: `${s.endsAt}:00`, label: s.label, position })),
        );
      }
    }
    await tx
      .update(school)
      .set({
        feesText: input.fees,
        firstTrialFree: input.firstTrialFree,
        // DEFAULT M21 (question 2): an edit of the schedule or the fees is activity (M20, DEFAULT D17).
        lastActivityAt: new Date(),
        ...ACTIVITY_RESET,
        updatedAt: sql`greatest(now(), ${school.updatedAt} + interval '1 microsecond')`,
      })
      .where(eq(school.id, row.id));
    await writeAudit(tx, {
      action: 'school.schedule_update',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'school',
      subjectId: row.id,
      before: { status: row.status, slots: before.length, ...(row.activityStage !== 'current' ? { activityStage: row.activityStage } : {}) },
      after: { status: row.status, slots: sorted.length, changed, ...(row.activityStage !== 'current' ? { activityStage: 'current' } : {}) },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { saved: { id: row.id, slug: row.slug, changed }, publicChange: row.status === 'active' };
  });
  if (outcome.publicChange) invalidatePublic([SCHOOLS_TAG], 'procedure');
  return outcome.saved;
}
