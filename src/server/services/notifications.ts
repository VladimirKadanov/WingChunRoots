// Dashboard notifications (milestone M08; plan §5.6, §6.2): the signed-in account's own
// notifications, rendered from src/server/templates/notifications.ts, and marking them read. Marking
// read is the small, reversible personal action the dashboard shows optimistically (useOptimistic).
//
// M18 (docs/adr/0021-notices.md): every notice by pages and by category (/dashboard/notifications),
// "Mark all as read", the account's choice of e-mail per category (/dashboard/settings) and the
// unsubscribe link of an e-mail, which works without signing in (src/server/services/unsubscribe.ts).
// Sending is src/server/services/notify.ts.

import { and, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import * as z from 'zod';

import { formatPartialDate, toPrefix } from '../../lib/partial-date';
import { hasStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { authUser, lineage, notification, notificationPreference, person, personName, pilotAccessRequest, teachingRelationship, trainingPeriod } from '../db/schema';
import type { Executor } from '../entitlements/access';
import type { NameData } from '../templates/email/types';
import { CATEGORIES, isNotificationKind, kindsOf, NOTIFICATION_CATALOG, NOTIFICATION_CATEGORIES, type NotificationCategory } from '../templates/catalog';
import { type NotificationSegment, RELATIONSHIP_NOTIFICATIONS, renderNotification } from '../templates/notifications';
import { ServiceError } from './errors';
import { readUnsubscribeToken, UNSUBSCRIBE_TOKEN_MAX } from './unsubscribe';

export const NOTIFICATION_PAGE_SIZE = 20;

export interface NotificationView {
  id: string;
  template: string;
  /** M18: the notice's category (catalog), null for a kind no longer in it. */
  category: NotificationCategory | null;
  title: string;
  body: NotificationSegment[];
  action: { label: string; href: string } | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationList {
  /** Every unread notice of the account, whatever the page or the category shown. */
  unread: number;
  items: NotificationView[];
  /** M18: the page shown (from 1), how many there are, and the category filter, if any. */
  page: number;
  pages: number;
  total: number;
  category: NotificationCategory | null;
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
async function withRelationships(rows: NotificationRow[], userId: string, db: Executor = getDb()): Promise<NotificationRow[]> {
  const ids = [...new Set(rows.filter((row) => RELATIONSHIP_TEMPLATES.has(row.template)).map((row) => relationshipIdOf(row.payload)))].filter(
    (id): id is string => id !== null,
  );
  if (ids.length === 0) return rows;
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

/**
 * M18: the payload of a notice as the dashboard would show it, for its e-mail (src/server/services/
 * notify.ts): a relationship notice gets the other person's current name and the lineage, read in
 * the sender's transaction, so the e-mail names only what the recipient can see on the dashboard.
 */
export async function enrichNoticePayload(db: Executor, userId: string, kind: string, payload: Record<string, unknown>): Promise<unknown> {
  if (!RELATIONSHIP_TEMPLATES.has(kind)) return payload;
  const [row] = await withRelationships([{ id: '', template: kind, payload, createdAt: new Date(), readAt: null }], userId, db);
  return row?.payload ?? payload;
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
    category: isNotificationKind(row.template) ? NOTIFICATION_CATALOG[row.template].category : null,
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

export const listNotificationsInput = z
  .object({
    /** M18: only the notices of one category (the catalog's). */
    category: z.enum(NOTIFICATION_CATEGORIES).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .default({ page: 1 });

/**
 * The signed-in account's notifications, newest first, 20 a page (M18: by page and category), and
 * its unread count over every category.
 */
export async function listNotifications(principal: Principal | null, raw: unknown = {}): Promise<NotificationList> {
  const p = requireUser(principal);
  const parsed = listNotificationsInput.safeParse(raw ?? {});
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose a category and a page.');
  const { category = null, page } = parsed.data;
  const db = getDb();
  const where = and(eq(notification.userId, p.user.id), category ? inArray(notification.template, kindsOf(category)) : undefined);
  const [{ n: total } = { n: 0 }] = await db.select({ n: count() }).from(notification).where(where);
  const pages = Math.max(1, Math.ceil(total / NOTIFICATION_PAGE_SIZE));
  const rows = await db
    .select({ id: notification.id, template: notification.template, payload: notification.payload, createdAt: notification.createdAt, readAt: notification.readAt })
    .from(notification)
    .where(where)
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(NOTIFICATION_PAGE_SIZE)
    .offset((page - 1) * NOTIFICATION_PAGE_SIZE);
  const enriched = await withRelationships(await withPilotRequesters(rows, hasStaff2FA(p, ['admin'])), p.user.id);
  return { unread: await unreadCount(p.user.id), items: enriched.map(view), page, pages, total, category };
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

export const markAllReadInput = z.object({ category: z.enum(NOTIFICATION_CATEGORIES).optional() }).default({});

/** M18: "Mark all as read", of every category or of one. Idempotent. */
export async function markAllNotificationsRead(principal: Principal | null, raw: unknown = {}): Promise<{ updated: number; unread: number }> {
  const p = requireUser(principal);
  const parsed = markAllReadInput.safeParse(raw ?? {});
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose a category.');
  const { category } = parsed.data;
  return getDb().transaction(async (tx) => {
    const updated = await tx
      .update(notification)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notification.userId, p.user.id), isNull(notification.readAt), category ? inArray(notification.template, kindsOf(category)) : undefined))
      .returning({ id: notification.id });
    return { updated: updated.length, unread: await unreadCount(p.user.id, tx) };
  });
}

// --- Preferences and unsubscribing (M18, In scope 3 and 4) ------------------------------------------

export interface NotificationPreferenceView {
  category: NotificationCategory;
  label: string;
  description: string;
  /** Whether the account gets these e-mails now. */
  email: boolean;
  /** True for security and account: always e-mailed, never switched off. */
  locked: boolean;
  /** Whether the account chose, or the catalog's default holds. */
  chosen: boolean;
}

/** The e-mail of a category for an account: its choice, or the default of the category. */
function categoryEmail(category: NotificationCategory, choice: boolean | undefined): boolean {
  const def = CATEGORIES[category];
  if (!def.optOut) return true;
  return choice ?? def.emailDefault;
}

/**
 * notifications.preferences: the account's e-mail per category (DEFAULT M18, question 1). Dashboard
 * notices are always on and not listed as a choice.
 */
export async function notificationPreferences(principal: Principal | null): Promise<{ categories: NotificationPreferenceView[] }> {
  const p = requireUser(principal);
  const rows = await getDb()
    .select({ category: notificationPreference.category, email: notificationPreference.email })
    .from(notificationPreference)
    .where(eq(notificationPreference.userId, p.user.id));
  const chosen = new Map(rows.map((r) => [r.category, r.email]));
  return {
    categories: NOTIFICATION_CATEGORIES.map((category) => ({
      category,
      label: CATEGORIES[category].label,
      description: CATEGORIES[category].description,
      email: categoryEmail(category, chosen.get(category)),
      locked: !CATEGORIES[category].optOut,
      chosen: chosen.has(category),
    })),
  };
}

export const setPreferenceInput = z.object({ category: z.enum(NOTIFICATION_CATEGORIES), email: z.boolean() });

const LOCKED_MESSAGE = 'Security and account e-mails are always sent: they tell you about changes to your account.';

/**
 * Writes the account's choice for a category: a change moves its version, so every unsubscribe link
 * made before stops working. The same choice again changes nothing.
 */
async function writePreference(tx: Executor, userId: string, category: NotificationCategory, email: boolean): Promise<void> {
  await tx.execute(sql`
    INSERT INTO notification_preference (user_id, category, email, version)
    VALUES (${userId}::uuid, ${category}, ${email}, 1)
    ON CONFLICT (user_id, category) DO UPDATE
       SET email = excluded.email, version = notification_preference.version + 1, updated_at = now()
     WHERE notification_preference.email IS DISTINCT FROM excluded.email`);
}

/** notifications.setPreference: e-mail on or off for one category (never security or account). */
export async function setNotificationPreference(principal: Principal | null, raw: unknown): Promise<{ categories: NotificationPreferenceView[] }> {
  const p = requireUser(principal);
  const parsed = setPreferenceInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose a category and whether to get its e-mails.');
  const { category, email } = parsed.data;
  if (!CATEGORIES[category].optOut) throw new ServiceError('BAD_REQUEST', LOCKED_MESSAGE, { category: LOCKED_MESSAGE });
  await writePreference(getDb(), p.user.id, category, email);
  return notificationPreferences(p);
}

export const unsubscribeInput = z.object({ token: z.string().min(1).max(UNSUBSCRIBE_TOKEN_MAX) });

export interface UnsubscribeView {
  category: NotificationCategory;
  label: string;
  /** `ready`: one press switches it off; `done`: it is off (now or before). */
  state: 'ready' | 'done';
}

const STALE_LINK = 'This unsubscribe link no longer works: your e-mail settings changed after it was sent. Sign in and choose your e-mails in Account type and plan.';

/** The claim of a token when it is still good for its account and category; else NOT_FOUND. */
async function liveClaim(tx: Executor, raw: unknown, lock: boolean) {
  const parsed = unsubscribeInput.safeParse(raw);
  const claim = parsed.success ? readUnsubscribeToken(parsed.data.token) : null;
  if (!claim || !CATEGORIES[claim.category].optOut) throw new ServiceError('NOT_FOUND', STALE_LINK);
  const [account] = await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.id, claim.userId));
  if (!account) throw new ServiceError('NOT_FOUND', STALE_LINK);
  const query = tx
    .select({ email: notificationPreference.email, version: notificationPreference.version })
    .from(notificationPreference)
    .where(and(eq(notificationPreference.userId, claim.userId), eq(notificationPreference.category, claim.category)));
  const [row] = lock ? await query.for('update') : await query;
  return { claim, row };
}

/**
 * notifications.unsubscribeInfo: what an unsubscribe link switches off, for its page; no sign-in.
 * A link whose preference changed since, or that is not one, answers NOT_FOUND (one answer for both).
 */
export async function unsubscribeInfo(raw: unknown): Promise<UnsubscribeView> {
  const { claim, row } = await liveClaim(getDb(), raw, false);
  const label = CATEGORIES[claim.category].label;
  if ((row?.version ?? 0) === claim.version) return { category: claim.category, label, state: row?.email === false ? 'done' : 'ready' };
  // The press of this very link moved the version by one and switched it off: the answer stays "off".
  if (row && row.email === false && row.version === claim.version + 1) return { category: claim.category, label, state: 'done' };
  throw new ServiceError('NOT_FOUND', STALE_LINK);
}

/**
 * notifications.unsubscribe: switches the link's category off, without signing in (RFC 8058 one-click
 * included). Idempotent: pressing it again answers that it is off.
 */
export async function unsubscribe(raw: unknown): Promise<UnsubscribeView> {
  return getDb().transaction(async (tx) => {
    const { claim, row } = await liveClaim(tx, raw, true);
    const label = CATEGORIES[claim.category].label;
    const current = row?.version ?? 0;
    if (current !== claim.version) {
      if (row && row.email === false && row.version === claim.version + 1) return { category: claim.category, label, state: 'done' as const };
      throw new ServiceError('NOT_FOUND', STALE_LINK);
    }
    if (row?.email === false) return { category: claim.category, label, state: 'done' as const };
    // Written even when the default is off already (events, no row yet): the choice is the account's now.
    await writePreference(tx, claim.userId, claim.category, false);
    return { category: claim.category, label, state: 'done' as const };
  });
}

