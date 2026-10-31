// Dashboard notifications (milestone M08; plan §5.6, §6.2): the signed-in account's own
// notifications, rendered from src/server/templates/notifications.ts, and marking them read. Marking
// read is the small, reversible personal action the dashboard shows optimistically (useOptimistic).

import { and, count, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import * as z from 'zod';

import { hasStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { formatPartialDate, toPrefix } from '../../lib/partial-date';
import { getDb } from '../db';
import { lineage, notification, person, personName, pilotAccessRequest, teachingRelationship, trainingPeriod } from '../db/schema';
import type { Executor } from '../entitlements/access';
import type { NameData } from '../templates/email/types';
import { type NotificationSegment, RELATIONSHIP_NOTIFICATIONS, renderNotification } from '../templates/notifications';
import { ServiceError } from './errors';

export const NOTIFICATION_PAGE_SIZE = 20;

export interface NotificationView {
  id: string;
  template: string;
  title: string;
  body: NotificationSegment[];
  action: { label: string; href: string } | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationList {
  unread: number;
  items: NotificationView[];
}

interface NotificationRow {
  id: string;
  template: string;
  payload: unknown;
  createdAt: Date;
  readAt: Date | null;
}

/** The request id of a "pilot-access.requested" payload, or null when it holds none. */
function pilotRequestIdOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const id = (payload as { requestId?: unknown }).requestId;
  return z.uuid().safeParse(id).success ? (id as string) : null;
}

/**
 * Adds the requester to each "pilot-access.requested" notification when the list is read: the
 * current primary name of the requesting account's person, never a copy kept in the payload, so a
 * renamed account shows its new name and a deleted one no name at all (plan §6.4). And whether the
 * request is still open (final check, screens-4): one given or closed, by any administrator, is
 * `answered`, and the notification no longer offers to review it.
 *
 * Who asked for which plan is staff data (plan §3.2): only an admin whose session proved the second
 * factor (`staff`, hasStaff2FA) reads it. Any other session gets `requesterHidden`, and the
 * notification says neither who asked nor for which plan (M08 review round 2, recheck-1): a
 * password alone must not reach it.
 */
async function withPilotRequesters(rows: NotificationRow[], staff: boolean): Promise<NotificationRow[]> {
  const ids = [...new Set(rows.filter((row) => row.template === 'pilot-access.requested').map((row) => pilotRequestIdOf(row.payload)))].filter(
    (id): id is string => id !== null,
  );
  if (ids.length === 0) return rows;
  if (!staff) {
    return rows.map((row) =>
      row.template === 'pilot-access.requested' && pilotRequestIdOf(row.payload) !== null
        ? { ...row, payload: { ...(row.payload as Record<string, unknown>), requester: null, requesterDeleted: false, requesterHidden: true, answered: false } }
        : row,
    );
  }
  const found = await getDb()
    .select({ id: pilotAccessRequest.id, status: pilotAccessRequest.status, value: personName.value, lang: personName.lang })
    .from(pilotAccessRequest)
    .leftJoin(person, and(eq(person.claimedByUserId, pilotAccessRequest.userId), isNull(person.deletedAt)))
    .leftJoin(personName, and(eq(personName.personId, person.id), eq(personName.isPrimary, true)))
    .where(inArray(pilotAccessRequest.id, ids));
  const names = new Map<string, NameData | null>(found.map((r) => [r.id, r.value !== null && r.lang !== null ? { value: r.value, lang: r.lang } : null]));
  const answered = new Set(found.filter((r) => r.status !== 'open').map((r) => r.id));
  return rows.map((row) => {
    const id = row.template === 'pilot-access.requested' ? pilotRequestIdOf(row.payload) : null;
    if (id === null) return row;
    // The looked-up requester replaces anything stored under that key.
    return {
      ...row,
      payload: {
        ...(row.payload as Record<string, unknown>),
        requester: names.get(id) ?? null,
        requesterDeleted: !names.has(id),
        requesterHidden: false,
        answered: answered.has(id),
      },
    };
  });
}

const RELATIONSHIP_TEMPLATES: ReadonlySet<string> = new Set(RELATIONSHIP_NOTIFICATIONS);

/** The relationship id of a teacher-request notification payload (M09), or null. */
function relationshipIdOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const id = (payload as { relationshipId?: unknown }).relationshipId;
  return z.uuid().safeParse(id).success ? (id as string) : null;
}

/**
 * Adds to each teacher-request notification (M09) what it shows when the list is read: the other
 * person's current primary name (never a copy kept in the payload: a renamed profile shows its new
 * name, a removed one none), the lineage and the relationship's status now, so a request that was
 * answered or withdrawn since no longer offers to answer it, and a request corrected since no
 * longer offers to correct it. Only for a relationship of the account's own person: anything else
 * shows no name (the notification was written for this account, so that never happens).
 */
async function withRelationships(rows: NotificationRow[], userId: string): Promise<NotificationRow[]> {
  const ids = [...new Set(rows.filter((row) => RELATIONSHIP_TEMPLATES.has(row.template)).map((row) => relationshipIdOf(row.payload)))].filter(
    (id): id is string => id !== null,
  );
  if (ids.length === 0) return rows;
  const db = getDb();
  const [own] = await db.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  const found = await db
    .select({
      id: teachingRelationship.id,
      teacher: teachingRelationship.teacherPersonId,
      student: teachingRelationship.studentPersonId,
      status: teachingRelationship.status,
      lineageName: lineage.name,
    })
    .from(teachingRelationship)
    .innerJoin(lineage, eq(lineage.id, teachingRelationship.lineageId))
    .where(inArray(teachingRelationship.id, ids));
  const mine = found.filter((r) => own && (r.teacher === own.id || r.student === own.id));
  const otherOf = new Map(mine.map((r) => [r.id, r.teacher === own!.id ? r.student : r.teacher]));
  const others = [...new Set(otherOf.values())];
  const names =
    others.length === 0
      ? []
      : await db
          .select({ personId: personName.personId, value: personName.value, lang: personName.lang })
          .from(personName)
          .innerJoin(person, and(eq(person.id, personName.personId), isNull(person.deletedAt)))
          .where(and(inArray(personName.personId, others), eq(personName.isPrimary, true)));
  const nameOf = new Map<string, NameData>(names.map((n) => [n.personId, { value: n.value, lang: n.lang }]));
  const byId = new Map(mine.map((r) => [r.id, r]));
  // The training start of each request (In scope 2 of M09): the earliest recorded start of its periods.
  const requested = mine.filter((r) => rows.some((row) => row.template === 'relationship.requested' && relationshipIdOf(row.payload) === r.id)).map((r) => r.id);
  const periods =
    requested.length === 0
      ? []
      : await db
          .select({ relationshipId: trainingPeriod.relationshipId, startsOn: trainingPeriod.startsOn, precision: trainingPeriod.precision })
          .from(trainingPeriod)
          .where(and(inArray(trainingPeriod.relationshipId, requested), isNotNull(trainingPeriod.startsOn), ne(trainingPeriod.precision, 'unknown')));
  const earliest = new Map<string, { startsOn: string; precision: 'year' | 'month' | 'day' }>();
  for (const p of periods) {
    const current = earliest.get(p.relationshipId);
    if (p.startsOn && p.precision !== 'unknown' && (!current || p.startsOn < current.startsOn)) earliest.set(p.relationshipId, { startsOn: p.startsOn, precision: p.precision });
  }
  return rows.map((row) => {
    const id = RELATIONSHIP_TEMPLATES.has(row.template) ? relationshipIdOf(row.payload) : null;
    if (id === null) return row;
    const r = byId.get(id);
    const other = otherOf.get(id);
    return {
      ...row,
      payload: {
        ...(row.payload as Record<string, unknown>),
        other: other ? (nameOf.get(other) ?? null) : null,
        lineageName: r?.lineageName ?? null,
        // A relationship this account can no longer see reads as answered: nothing to act on.
        status: r?.status ?? 'withdrawn',
        ...(row.template === 'relationship.requested' ? { trainingStart: startOf(earliest.get(id)) } : {}),
      },
    };
  });
}

/** "April 2019" for a recorded start, or null. */
function startOf(start: { startsOn: string; precision: 'year' | 'month' | 'day' } | undefined): string | null {
  return start ? formatPartialDate(toPrefix(start.startsOn, start.precision)) : null;
}

/** A rendered notification; one whose template or data no longer fits says so instead of failing. */
function view(row: NotificationRow): NotificationView {
  let rendered: ReturnType<typeof renderNotification>;
  try {
    rendered = renderNotification(row.template, row.payload, { createdAt: row.createdAt });
  } catch {
    rendered = { title: 'Notification', body: [{ text: 'This notification can no longer be shown.' }] };
  }
  const href = rendered.action?.href;
  return {
    id: row.id,
    template: row.template,
    title: rendered.title,
    body: rendered.body,
    // Only a local path is ever a link (never //host or a scheme).
    action: rendered.action && href && href.startsWith('/') && !href.startsWith('//') ? rendered.action : null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}

async function unreadCount(userId: string, db: Executor = getDb()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
  return row?.n ?? 0;
}

/** The newest notifications of the signed-in account and its unread count. */
export async function listNotifications(principal: Principal | null): Promise<NotificationList> {
  const p = requireUser(principal);
  const rows = await getDb()
    .select({ id: notification.id, template: notification.template, payload: notification.payload, createdAt: notification.createdAt, readAt: notification.readAt })
    .from(notification)
    .where(eq(notification.userId, p.user.id))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(NOTIFICATION_PAGE_SIZE);
  const enriched = await withRelationships(await withPilotRequesters(rows, hasStaff2FA(p, ['admin'])), p.user.id);
  return { unread: await unreadCount(p.user.id), items: enriched.map(view) };
}

export const markReadInput = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
  z.object({ all: z.literal(true) }),
]);

/**
 * Marks the account's own notifications read: some by id, or all. Ids of other accounts'
 * notifications match nothing (no error, no hint that they exist). Idempotent.
 */
export async function markNotificationsRead(principal: Principal | null, raw: unknown): Promise<{ updated: number; unread: number }> {
  const p = requireUser(principal);
  const parsed = markReadInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose the notifications to mark as read.');
  const input = parsed.data;
  // One transaction, the answer included (review round 2, recheck-2): a failure changes nothing.
  return getDb().transaction(async (tx) => {
    const updated = await tx
      .update(notification)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notification.userId, p.user.id), isNull(notification.readAt), 'ids' in input ? inArray(notification.id, input.ids) : undefined))
      .returning({ id: notification.id });
    return { updated: updated.length, unread: await unreadCount(p.user.id, tx) };
  });
}
