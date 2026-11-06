// Consents, notifications, e-mail deliveries and the audit log (plan §6.2, §6.6).

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import { CONSENT_ACTIONS, CONSENT_KINDS, EMAIL_STATUSES, idColumn, inList, NOTIFICATION_CATEGORIES, timestamps } from './common';

/** Consent given or withdrawn: kind, document version, time and who (plan §6.2). */
export const consentRecord = pgTable(
  'consent_record',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: CONSENT_KINDS }).notNull(),
    documentVersion: text('document_version').notNull(),
    action: text('action', { enum: CONSENT_ACTIONS }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    index('consent_record_user_id_idx').on(t.userId, t.kind, t.occurredAt),
    check('consent_record_kind_check', inList(t.kind.name, CONSENT_KINDS)),
    check('consent_record_action_check', inList(t.action.name, CONSENT_ACTIONS)),
  ],
);

/** Dashboard notifications; the texts come from src/server/templates (template + payload). */
export const notification = pgTable(
  'notification',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    template: text('template').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    // M18 (src/server/services/notify.ts): the sender's key for "once": one notice per account and
    // key, however often the job or the action that sends it runs. Built from ids, never from text.
    dedupeKey: text('dedupe_key'),
    ...timestamps(),
  },
  (t) => [
    index('notification_user_id_idx').on(t.userId, t.createdAt),
    uniqueIndex('notification_dedupe_key').on(t.userId, t.dedupeKey).where(sql`${t.dedupeKey} IS NOT NULL`),
    // M18 (DEFAULT M18, question 3): the retention job deletes read notices after 180 days and
    // unread ones after 365, by creation time.
    index('notification_created_at_idx').on(t.createdAt),
    // The unread count of the dashboard (M08).
    index('notification_user_id_unread_idx').on(t.userId).where(sql`${t.readAt} IS NULL`),
    // M17 (DEFAULT M17, question 3): one notice per person, event and change (published or
    // cancelled), however often the job that sends them runs.
    uniqueIndex('notification_event_once_key')
      .on(t.userId, t.template, sql`(${t.payload} ->> 'eventId')`)
      .where(sql`${t.template} IN ('event.published', 'event.cancelled')`),
  ],
);

/**
 * M18 (DEFAULT M18, question 1): the account's choice of e-mail for one category of notices. No row
 * means the catalog's default (src/server/templates/catalog.ts). Dashboard notices are always on.
 * `version` grows with every change, and an unsubscribe link carries the version it was made for,
 * so a link stops working once the preference has changed (src/server/services/unsubscribe.ts).
 */
export const notificationPreference = pgTable(
  'notification_preference',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    category: text('category', { enum: NOTIFICATION_CATEGORIES }).notNull(),
    email: boolean('email').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.category], name: 'notification_preference_pkey' }),
    check('notification_preference_category_check', inList(t.category.name, NOTIFICATION_CATEGORIES)),
    // Security and the legal notices of the account are never switched off (In scope 3).
    check('notification_preference_locked_categories', sql`${t.email} OR ${t.category} NOT IN ('security', 'account')`),
    check('notification_preference_version_positive', sql`${t.version} > 0`),
  ],
);

/**
 * One row per e-mail; idempotent by key (plan §6.1, M01b). src/server/mail writes it: `attempts`
 * counts delivery attempts, `error` keeps the last failure (without addresses). `to_email` is
 * erased after 90 days by the retention job (docs/data-model.md, §7), an invitation e-mail's
 * sooner, with its invitation's address (M10b), so it may be null, but never while the e-mail
 * still waits to be sent.
 */
export const emailDelivery = pgTable(
  'email_delivery',
  {
    id: idColumn(),
    userId: uuid('user_id').references(() => authUser.id, { onDelete: 'set null' }),
    toEmail: text('to_email'),
    template: text('template').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status', { enum: EMAIL_STATUSES }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('email_delivery_idempotency_key_key').on(t.idempotencyKey),
    index('email_delivery_status_idx').on(t.status),
    index('email_delivery_created_at_idx').on(t.createdAt),
    index('email_delivery_user_id_idx').on(t.userId, t.createdAt),
    check('email_delivery_status_check', inList(t.status.name, EMAIL_STATUSES)),
    check('email_delivery_attempts_check', sql`${t.attempts} >= 0`),
    check('email_delivery_queued_has_address', sql`${t.status} <> 'queued' OR ${t.toEmail} IS NOT NULL`),
  ],
);

/**
 * Append-only audit log (plan §6.6). app_rw has SELECT and INSERT only, and a trigger refuses
 * UPDATE, DELETE and TRUNCATE for every role (custom migration *_roles_views_audit).
 * ip_hmac = HMAC-SHA-256(secret key, IP) in hex: personal data with a retention period
 * (docs/data-model.md); a plain SHA-256 of an IPv4 address is reversible by enumeration.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: idColumn(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    requestId: text('request_id'),
    ipHmac: text('ip_hmac'),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    evidenceIds: uuid('evidence_ids').array(),
    // Optional hash chain against tampering (plan §6.6).
    prevHash: text('prev_hash'),
    hash: text('hash'),
    ...timestamps(),
  },
  (t) => [
    index('audit_log_occurred_at_idx').on(t.occurredAt),
    index('audit_log_subject_idx').on(t.subjectType, t.subjectId),
    index('audit_log_actor_user_id_idx').on(t.actorUserId),
    check('audit_log_action_format', sql`${t.action} ~ '^[a-z0-9_]+(\\.[a-z0-9_]+)+$'`),
    check('audit_log_ip_hmac_format', sql`${t.ipHmac} IS NULL OR ${t.ipHmac} ~ '^[0-9a-f]{64}$'`),
  ],
);
