// The one place that sends a notice (milestone M18, In scope 2; docs/adr/0021-notices.md).
//
// notify(tx, userId, kind, payload, { key }) writes the notice to the account's dashboard and, when
// the kind has an e-mail channel and the account's preferences allow it (src/server/templates/
// catalog.ts), queues the e-mail through the outbox of M01b, in the caller's transaction: the notice
// and its e-mail commit with the change that caused them, or neither does.
//
// - Once: a `key` (built from ids) makes one notice per account and key (notification.dedupe_key);
//   a second call with it writes nothing and e-mails nothing, however often a job runs again. The
//   e-mail has its own idempotency key (the sender's, for a dedicated e-mail; else from the kind and
//   the notice), so a retried job never sends it twice either.
// - Budgets: at most NOTICE_EMAIL_HOURLY_CAP e-mails of one template to one account in an hour (the
//   rule of the account e-mails of M02, src/server/auth/emails.ts), counted under an advisory lock
//   per account and template. A notice over the budget stays in the dashboard; only its e-mail drops.
//   Security and account e-mails (categories that cannot be switched off) are always sent.
// - A deleted account (no row) or a blocked one (banned) gets nothing: no notice, no e-mail.
// - Unsubscribe: an e-mail whose category can be switched off carries a one-press link and the
//   List-Unsubscribe headers (src/server/services/unsubscribe.ts), sealed in the job.
// - Logs carry the kind and ids only, never an address, a name or the notice's text (plan §6.4).

import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { appUrl } from '../auth/env';
import { authUser, notification, notificationPreference, person, personName } from '../db/schema';
import { queueEmail, type Transaction } from '../jobs/outbox';
import { logger } from '../log';
import { CATEGORIES, catalogEntry, emailWanted, type NotificationCategory, type NotificationKind } from '../templates/catalog';
import { type EmailTemplateData, type EmailTemplateName, type NameData, TemplateDataError } from '../templates/email';
import { NotificationDataError, renderNotification } from '../templates/notifications';
import { enrichNoticePayload } from './notifications';
import { signUnsubscribeToken } from './unsubscribe';

/** This process's job producer, when the caller is the worker (its own pg-boss). */
export type NoticeProducer = Parameters<typeof queueEmail>[2];

/**
 * DEFAULT M18 (question 7): the e-mails of one template that one account gets in an hour, at most.
 * Above the busiest real use (a teacher approving a class), below a flood.
 */
export const NOTICE_EMAIL_HOURLY_CAP = 20;

/** A dedicated e-mail of the kind (the catalog names its template), with the sender's data and key. */
export type DedicatedEmail = {
  [N in EmailTemplateName]: { template: N; data: EmailTemplateData<N>; idempotencyKey: string };
}[EmailTemplateName];

export interface NotifyOptions {
  /** One notice per account and key; built from ids, never from text or an address. */
  key?: string;
  /**
   * For a kind whose e-mail is a dedicated template: its data and idempotency key. Left out, the
   * kind is not e-mailed this time (the sender has nothing to say in it, a name it may not show).
   */
  email?: DedicatedEmail;
  /** Also e-mail this address (security.email-changed: the old address), with the same notice. */
  alsoTo?: { address: string; payload: Record<string, unknown> };
  /** The worker's own pg-boss (jobs); the services use this process's producer. */
  boss?: NoticeProducer;
}

export interface NotifyResult {
  /** False when the account is gone or blocked, or the key was already used. */
  notified: boolean;
  /** Whether an e-mail was queued. */
  emailed: boolean;
}

const NOTHING: NotifyResult = { notified: false, emailed: false };

function log(kind: NotificationKind, userId: string, what: string) {
  logger().info(`[notify] ${kind} to account ${userId}: ${what}`);
}

/** The account, if it may get notices: it exists and is not blocked. */
async function recipient(tx: Transaction, userId: string): Promise<{ id: string; email: string } | null> {
  const [row] = await tx
    .select({ id: authUser.id, email: authUser.email })
    .from(authUser)
    .where(and(eq(authUser.id, userId), or(eq(authUser.banned, false), and(isNotNull(authUser.banExpires), sql`${authUser.banExpires} <= now()`))));
  return row ?? null;
}

/** The account's choice for a category and its version (0 without a row). */
export async function preferenceOf(tx: Transaction, userId: string, category: NotificationCategory): Promise<{ email: boolean | undefined; version: number }> {
  const [row] = await tx
    .select({ email: notificationPreference.email, version: notificationPreference.version })
    .from(notificationPreference)
    .where(and(eq(notificationPreference.userId, userId), eq(notificationPreference.category, category)));
  return { email: row?.email, version: row?.version ?? 0 };
}

/** Whether the account has budget left for one more e-mail of `template` this hour (locks it). */
async function withinBudget(tx: Transaction, userId: string, template: string): Promise<boolean> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`notice-email:${userId}:${template}`}, 0))`);
  const rows = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM email_delivery
     WHERE user_id = ${userId} AND template = ${template} AND created_at > now() - interval '1 hour'`);
  return (rows.rows[0]?.n ?? 0) < NOTICE_EMAIL_HOURLY_CAP;
}

/** The names of the account's own profile, primary (Latin) first, for the greeting. */
async function recipientNames(tx: Transaction, userId: string): Promise<NameData[]> {
  const rows = await tx
    .select({ value: personName.value, lang: personName.lang, isPrimary: personName.isPrimary, sortOrder: personName.sortOrder })
    .from(personName)
    .innerJoin(person, eq(person.id, personName.personId))
    .where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt), eq(personName.kind, 'name')));
  const sorted = rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder);
  if (!sorted[0]?.isPrimary) return [];
  return sorted.slice(0, 2).map(({ value, lang }) => ({ value, lang }));
}

/** The unsubscribe link of a category for the account, valid until its preference changes. */
function unsubscribeLink(userId: string, category: NotificationCategory, version: number) {
  const token = signUnsubscribeToken({ userId, category, version });
  const base = appUrl();
  return {
    url: `${base}/unsubscribe?token=${encodeURIComponent(token)}`,
    oneClickUrl: `${base}/unsubscribe/one-click?token=${encodeURIComponent(token)}`,
    category: CATEGORIES[category].label,
  };
}

/** The data of the generic notice e-mail: the notice's own text (notifications.ts), with absolute links. */
async function noticeData(tx: Transaction, userId: string, kind: NotificationKind, payload: Record<string, unknown>): Promise<EmailTemplateData<'notice'>> {
  const enriched = await enrichNoticePayload(tx, userId, kind, payload);
  const rendered = renderNotification(kind, enriched, { createdAt: new Date() });
  const names = await recipientNames(tx, userId);
  const href = rendered.action?.href;
  return {
    title: rendered.title,
    body: rendered.body,
    ...(rendered.action && href && href.startsWith('/') && !href.startsWith('//') ? { action: { label: rendered.action.label, url: `${appUrl()}${href}` } } : {}),
    ...(names.length > 0 ? { recipientNames: names } : {}),
  };
}

/**
 * Sends one notice: to the dashboard always, by e-mail when the catalog and the account's
 * preferences allow it. Runs in the caller's transaction.
 */
export async function notify(
  tx: Transaction,
  userId: string,
  kind: NotificationKind,
  payload: Record<string, unknown>,
  options: NotifyOptions = {},
): Promise<NotifyResult> {
  const entry = catalogEntry(kind);
  const account = await recipient(tx, userId);
  if (!account) return NOTHING;
  const [written] = await tx
    .insert(notification)
    .values({ userId, template: kind, payload, dedupeKey: options.key ?? null })
    // The key (notification_dedupe_key), or M17's one notice per event and change.
    .onConflictDoNothing()
    .returning({ id: notification.id });
  if (!written) return NOTHING;
  if (entry.email === null) return { notified: true, emailed: false };
  if (entry.email !== 'notice' && !options.email) return { notified: true, emailed: false };

  const preference = await preferenceOf(tx, userId, entry.category);
  if (!emailWanted(kind, preference.email)) return { notified: true, emailed: false };
  const template = entry.email === 'notice' ? 'notice' : entry.email;
  // Security and account e-mails are never dropped: no other notice can spend their budget.
  if (CATEGORIES[entry.category].optOut && !(await withinBudget(tx, userId, template))) {
    log(kind, userId, 'e-mail dropped, the hourly budget of the account is spent');
    return { notified: true, emailed: false };
  }
  const unsubscribe = CATEGORIES[entry.category].optOut ? { unsubscribe: unsubscribeLink(userId, entry.category, preference.version) } : {};
  try {
    if (entry.email === 'notice') {
      const base = `notice:${kind}:${options.key ?? written.id}`;
      await queueEmail(
        tx,
        { template: 'notice', to: account.email, userId, idempotencyKey: base, data: await noticeData(tx, userId, kind, payload), ...unsubscribe },
        options.boss,
      );
      if (options.alsoTo) {
        await queueEmail(
          tx,
          { template: 'notice', to: options.alsoTo.address, userId, idempotencyKey: `${base}:also`, data: await noticeData(tx, userId, kind, options.alsoTo.payload), ...unsubscribe },
          options.boss,
        );
      }
    } else {
      const email = options.email!;
      if (email.template !== entry.email) throw new Error(`notify: ${kind} is e-mailed with ${entry.email}, not ${email.template}`);
      await queueEmail(tx, { template: email.template, to: account.email, userId, idempotencyKey: email.idempotencyKey, data: email.data, ...unsubscribe } as never, options.boss);
    }
  } catch (error) {
    // Data a template refuses never improves: the notice stays, its e-mail is not sent.
    if (!(error instanceof TemplateDataError) && !(error instanceof NotificationDataError)) throw error;
    log(kind, userId, `e-mail not sent (${error.name})`);
    return { notified: true, emailed: false };
  }
  return { notified: true, emailed: true };
}

/** The same notice to several accounts (staff, the admins of an organization, the students of a teacher). */
export async function notifyEach(
  tx: Transaction,
  userIds: readonly string[],
  kind: NotificationKind,
  payload: Record<string, unknown>,
  options: Omit<NotifyOptions, 'email' | 'alsoTo'> = {},
): Promise<number> {
  let notified = 0;
  for (const userId of new Set(userIds)) if ((await notify(tx, userId, kind, payload, options)).notified) notified++;
  return notified;
}

