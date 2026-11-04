// events.notify (milestone M17, In scope 4; docs/adr/0020-events.md): the dashboard notices of a
// published or a cancelled event.
//
// DEFAULT M17 (question 3): a notice in the dashboard (never an e-mail) to every Premium Student
// (the plan in effect, a grant included) whose established teacher (a relationship `verified` or
// `in_arbitration`) organizes the event or teaches at it; one per person, event and change. The
// event is read from v_public_event, so a removed event, an event of an organization that is no
// longer approved and an organizer or instructor who is not a public person send nothing: a notice
// never tells a student about a teacher the public cannot see.
//
// Idempotent: the singleton key of the job (src/server/services/events.ts) keeps one job per event
// and change while it waits, and the unique index notification_event_once_key keeps one notice per
// person when the job runs again (ON CONFLICT DO NOTHING). Logs carry the job id and counts, never
// the event's text or a person's id (plan §6.4).

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { JobWithMetadata } from 'pg-boss';

import { formatEventWhen } from '../../lib/event-time';
import type { Database } from '../db';
import { authUser, entitlementGrant, notification, person, teachingRelationship, vPublicEvent } from '../db/schema';
import { PUBLIC_RELATIONSHIP_STATUSES } from '../db/schema/common';
import { resolveEffectivePlan } from '../entitlements/effective';
import { type EventsNotifyJob, QUEUE } from './queues';

export interface EventNoticeResult {
  /** Notices written now (a repeated run writes none). */
  written: number;
  /** Premium Students the event concerns. */
  recipients: number;
  /** The event no longer is in the state of the change, or is not public: nothing was sent. */
  skipped: boolean;
}

/** Writes the notices of one change of one event. */
export async function sendEventNotices(db: Database, job: EventsNotifyJob, now = new Date()): Promise<EventNoticeResult> {
  const [row] = await db
    .select({
      id: vPublicEvent.id,
      slug: vPublicEvent.slug,
      title: vPublicEvent.title,
      status: vPublicEvent.status,
      startsAt: vPublicEvent.startsAt,
      endsAt: vPublicEvent.endsAt,
      timezone: vPublicEvent.timezone,
      organizerPersonId: vPublicEvent.organizerPersonId,
      instructors: vPublicEvent.instructors,
    })
    .from(vPublicEvent)
    .where(eq(vPublicEvent.id, job.eventId));
  // A cancellation after the publication's job was queued: the publication sends nothing any more.
  if (!row || row.status !== job.change) return { written: 0, recipients: 0, skipped: true };

  const teachers = [...new Set([row.organizerPersonId, ...row.instructors.map((i) => i.id)].filter((id): id is string => typeof id === 'string'))];
  if (teachers.length === 0) return { written: 0, recipients: 0, skipped: false };

  // The accounts of the students of those teachers: their own (claimed) person, never a deleted one.
  // Only Student accounts: the organizer's own (Sifu) account is never one of them.
  const students = await db
    .selectDistinct({ userId: authUser.id, accountType: authUser.accountType })
    .from(teachingRelationship)
    .innerJoin(person, eq(person.id, teachingRelationship.studentPersonId))
    .innerJoin(authUser, eq(authUser.id, person.claimedByUserId))
    .where(
      and(
        inArray(teachingRelationship.teacherPersonId, teachers),
        inArray(teachingRelationship.status, [...PUBLIC_RELATIONSHIP_STATUSES]),
        isNull(person.deletedAt),
        eq(authUser.accountType, 'student'),
      ),
    );
  if (students.length === 0) return { written: 0, recipients: 0, skipped: false };

  const grants = await db
    .select({
      id: entitlementGrant.id,
      subjectUserId: entitlementGrant.subjectUserId,
      planCode: entitlementGrant.planCode,
      source: entitlementGrant.source,
      startsAt: entitlementGrant.startsAt,
      endsAt: entitlementGrant.endsAt,
      revokedAt: entitlementGrant.revokedAt,
    })
    .from(entitlementGrant)
    .where(inArray(entitlementGrant.subjectUserId, students.map((s) => s.userId)));
  const premium = students.filter(
    (s) => resolveEffectivePlan(s.accountType, grants.filter((g) => g.subjectUserId === s.userId), now).plan === 'premium_student',
  );
  if (premium.length === 0) return { written: 0, recipients: 0, skipped: false };

  const payload = {
    eventId: row.id,
    slug: row.slug,
    title: row.title,
    startDay: formatEventWhen(row.startsAt, row.endsAt, row.timezone).startDay,
  };
  const template = job.change === 'published' ? 'event.published' : 'event.cancelled';
  const written = await db
    .insert(notification)
    .values(premium.map((s) => ({ userId: s.userId, template, payload })))
    .onConflictDoNothing()
    .returning({ id: notification.id });
  return { written: written.length, recipients: premium.length, skipped: false };
}

/** Handles events.notify. A failure is logged and rethrown with its code only (plan §6.4). */
export function eventsNotifyHandler(db: Database, log: (line: string) => void) {
  return async (jobs: JobWithMetadata<EventsNotifyJob>[]): Promise<void> => {
    for (const job of jobs) {
      try {
        const result = await sendEventNotices(db, job.data);
        log(
          result.skipped
            ? `${QUEUE.eventsNotify}: job ${job.id}: nothing to send`
            : `${QUEUE.eventsNotify}: job ${job.id}: ${result.written} notice(s) written for ${result.recipients} recipient(s)`,
        );
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        const reason = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? `database error ${code}` : error instanceof Error ? error.name : 'unknown error';
        const last = job.retryCount >= job.retryLimit;
        log(`${QUEUE.eventsNotify}: job ${job.id}: attempt ${job.retryCount + 1} of ${job.retryLimit + 1} failed (${reason})${last ? '; no attempts left' : '; will retry'}`);
        throw new Error(`${QUEUE.eventsNotify} failed: ${reason}`);
      }
    }
  };
}
