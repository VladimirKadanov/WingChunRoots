// Dashboard notifications (milestone M08; plan §5.6, §6.2): the signed-in account's own
// notifications, rendered from src/server/templates/notifications.ts, and marking them read. Marking
// read is the small, reversible personal action the dashboard shows optimistically (useOptimistic).

import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import * as z from 'zod';

import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { notification } from '../db/schema';
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

/** A rendered notification; one whose template or data no longer fits says so instead of failing. */
function view(row: { id: string; template: string; payload: unknown; createdAt: Date; readAt: Date | null }): NotificationView {
  let rendered: ReturnType<typeof renderNotification>;
  try {
    rendered = renderNotification(row.template, row.payload);
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

async function unreadCount(userId: string): Promise<number> {
  const [row] = await getDb()
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
  return { unread: await unreadCount(p.user.id), items: rows.map(view) };
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
  const updated = await getDb()
    .update(notification)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notification.userId, p.user.id), isNull(notification.readAt), 'ids' in input ? inArray(notification.id, input.ids) : undefined))
    .returning({ id: notification.id });
  return { updated: updated.length, unread: await unreadCount(p.user.id) };
}
