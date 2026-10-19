// Dashboard notifications (milestone M08; plan §5.6, §6.2): the signed-in account's own
// notifications, rendered from src/server/templates/notifications.ts, and marking them read. Marking
// read is the small, reversible personal action the dashboard shows optimistically (useOptimistic).

import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import * as z from 'zod';

import { hasStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { notification, person, personName, pilotAccessRequest } from '../db/schema';
import type { Executor } from '../entitlements/access';
import type { NameData } from '../templates/email/types';
import { type NotificationSegment, renderNotification } from '../templates/notifications';
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
 * renamed account shows its new name and a deleted one no name at all (plan §6.4).
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
        ? { ...row, payload: { ...(row.payload as Record<string, unknown>), requester: null, requesterDeleted: false, requesterHidden: true } }
        : row,
    );
  }
  const found = await getDb()
    .select({ id: pilotAccessRequest.id, value: personName.value, lang: personName.lang })
    .from(pilotAccessRequest)
    .leftJoin(person, and(eq(person.claimedByUserId, pilotAccessRequest.userId), isNull(person.deletedAt)))
    .leftJoin(personName, and(eq(personName.personId, person.id), eq(personName.isPrimary, true)))
    .where(inArray(pilotAccessRequest.id, ids));
  const names = new Map<string, NameData | null>(found.map((r) => [r.id, r.value !== null && r.lang !== null ? { value: r.value, lang: r.lang } : null]));
  return rows.map((row) => {
    const id = row.template === 'pilot-access.requested' ? pilotRequestIdOf(row.payload) : null;
    if (id === null) return row;
    // The looked-up requester replaces anything stored under that key.
    return {
      ...row,
      payload: { ...(row.payload as Record<string, unknown>), requester: names.get(id) ?? null, requesterDeleted: !names.has(id), requesterHidden: false },
    };
  });
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
  return { unread: await unreadCount(p.user.id), items: (await withPilotRequesters(rows, hasStaff2FA(p, ['admin']))).map(view) };
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
