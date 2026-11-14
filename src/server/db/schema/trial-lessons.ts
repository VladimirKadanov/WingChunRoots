// M21 (docs/adr/0024-trial-lessons.md; Phase 2 "Trial lesson inquiry flow and basic school
// analytics", plan §1 "График, такси, снимки и бутон за пробна тренировка"):
//
// - school_schedule_slot: a listed school's weekly schedule (weekday, start and end in the school's
//   own zone, the zone of its city; a short label). Public listing content, shown while the school
//   is public (v_public_school); read by app_rw only.
// - trial_inquiry: a signed-in adult's request for a trial lesson at a public school. The sender's
//   name and the contact detail they chose are copied in when it is sent, so the school sees what
//   the sender agreed to show. Read only by the sender, the school's listing account and the admins
//   of the organizations the school accepted a link from (src/server/services/trial-lessons.ts),
//   never by a public DTO, a cache or a log. Deleted TRIAL_INQUIRY_RETENTION_DAYS after it closed.
//   Review 2026-11 (docs/adr/0032-retention-and-withdrawal.md): the sender can withdraw an open
//   inquiry, and an open one that nobody answered is closed after 90 days; both leave the row
//   without the sender's name, contact, times, message and reply (scrubbed_at says so).
// - school_stat_day: counts per school and day (UTC), nothing else: no IP, account, cookie or
//   fingerprint. Deleted SCHOOL_STATS_RETENTION_DAYS after the day.

import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, primaryKey, smallint, text, time, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import {
  idColumn,
  inList,
  SCHOOL_SCHEDULE_LABEL_MAX,
  timestamps,
  TRIAL_CONTACT_METHODS,
  TRIAL_INQUIRY_STATUSES,
  TRIAL_MESSAGE_MAX,
  TRIAL_PREFERRED_MAX,
  TRIAL_REPLY_MAX,
} from './common';
import { school } from './schools';

export const schoolScheduleSlot = pgTable(
  'school_schedule_slot',
  {
    id: idColumn(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => school.id, { onDelete: 'cascade' }),
    /** ISO weekday: 1 is Monday, 7 is Sunday. */
    weekday: smallint('weekday').notNull(),
    /** Wall-clock times in the school's zone (its city's), "HH:MM:SS". */
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
    label: text('label'),
    position: integer('position').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index('school_schedule_slot_school_idx').on(t.schoolId, t.weekday, t.startsAt),
    check('school_schedule_slot_weekday_check', sql`${t.weekday} BETWEEN 1 AND 7`),
    check('school_schedule_slot_times', sql`${t.endsAt} > ${t.startsAt}`),
    check('school_schedule_slot_label_length', sql`${t.label} IS NULL OR char_length(${t.label}) BETWEEN 1 AND ${sql.raw(String(SCHOOL_SCHEDULE_LABEL_MAX))}`),
  ],
);

export const trialInquiry = pgTable(
  'trial_inquiry',
  {
    id: idColumn(),
    schoolId: uuid('school_id')
      .notNull()
      .references(() => school.id, { onDelete: 'cascade' }),
    // An account's deletion deletes its inquiries.
    senderUserId: uuid('sender_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    /** The sender's name as the school sees it (their profile's primary name, else the account's). NULL once scrubbed. */
    senderName: text('sender_name'),
    contactMethod: text('contact_method', { enum: TRIAL_CONTACT_METHODS }).notNull(),
    /** The e-mail of the account, or the phone the sender typed: what the school may use. NULL once scrubbed. */
    contactValue: text('contact_value'),
    preferredTimes: text('preferred_times'),
    message: text('message'),
    status: text('status', { enum: TRIAL_INQUIRY_STATUSES }).notNull().default('open'),
    /** The school's reply (answered) or reason (declined), which the sender is told. */
    reply: text('reply'),
    /** Who answered, declined or closed it (the owner or an organization admin). */
    handledByUserId: uuid('handled_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    /** When it last left `open` or was closed: the start of the retention period. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /**
     * Review 2026-11: when the sender's name, contact, times, message and the school's reply were
     * removed (the sender withdrew the request, or it stayed open for TRIAL_OPEN_INQUIRY_DAYS). The
     * row stays, as a closed request without personal data, until its retention ends.
     */
    scrubbedAt: timestamp('scrubbed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // DEFAULT M21 (question 3): one open inquiry per sender and school.
    uniqueIndex('trial_inquiry_one_open_key').on(t.schoolId, t.senderUserId).where(sql`${t.status} = 'open'`),
    index('trial_inquiry_sender_idx').on(t.senderUserId, t.createdAt),
    index('trial_inquiry_school_idx').on(t.schoolId, t.status, t.createdAt),
    index('trial_inquiry_closed_at_idx').on(t.closedAt).where(sql`${t.closedAt} IS NOT NULL`),
    // Review 2026-11: the retention job finds the open requests nobody answered, oldest first.
    index('trial_inquiry_open_created_idx').on(t.createdAt).where(sql`${t.status} = 'open'`),
    index('trial_inquiry_handled_by_user_id_idx').on(t.handledByUserId),
    check('trial_inquiry_status_check', inList(t.status.name, TRIAL_INQUIRY_STATUSES)),
    check('trial_inquiry_contact_method_check', inList(t.contactMethod.name, TRIAL_CONTACT_METHODS)),
    check('trial_inquiry_closed_has_time', sql`(${t.status} = 'open') = (${t.closedAt} IS NULL)`),
    // Review 2026-11: a row is either complete or scrubbed, never half of each, and a withdrawn one is scrubbed.
    check(
      'trial_inquiry_scrub_state',
      sql`(${t.scrubbedAt} IS NULL AND ${t.senderName} IS NOT NULL AND ${t.contactValue} IS NOT NULL)
        OR (${t.scrubbedAt} IS NOT NULL AND ${t.status} <> 'open' AND ${t.senderName} IS NULL AND ${t.contactValue} IS NULL AND ${t.preferredTimes} IS NULL AND ${t.message} IS NULL AND ${t.reply} IS NULL)`,
    ),
    check('trial_inquiry_withdrawn_scrubbed', sql`${t.status} <> 'withdrawn' OR ${t.scrubbedAt} IS NOT NULL`),
    check('trial_inquiry_sender_name_length', sql`char_length(${t.senderName}) BETWEEN 1 AND 200`),
    check('trial_inquiry_contact_value_length', sql`char_length(${t.contactValue}) BETWEEN 3 AND 254`),
    check('trial_inquiry_preferred_length', sql`${t.preferredTimes} IS NULL OR char_length(${t.preferredTimes}) BETWEEN 1 AND ${sql.raw(String(TRIAL_PREFERRED_MAX))}`),
    check('trial_inquiry_message_length', sql`${t.message} IS NULL OR char_length(${t.message}) BETWEEN 1 AND ${sql.raw(String(TRIAL_MESSAGE_MAX))}`),
    check('trial_inquiry_reply_length', sql`${t.reply} IS NULL OR char_length(${t.reply}) BETWEEN 1 AND ${sql.raw(String(TRIAL_REPLY_MAX))}`),
  ],
);

export const schoolStatDay = pgTable(
  'school_stat_day',
  {
    schoolId: uuid('school_id')
      .notNull()
      .references(() => school.id, { onDelete: 'cascade' }),
    /** The UTC day. */
    day: date('day').notNull(),
    pageViews: integer('page_views').notNull().default(0),
    pinOpens: integer('pin_opens').notNull().default(0),
    contactClicks: integer('contact_clicks').notNull().default(0),
    trialInquiries: integer('trial_inquiries').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'school_stat_day_pkey', columns: [t.schoolId, t.day] }),
    index('school_stat_day_day_idx').on(t.day),
    check('school_stat_day_counts', sql`${t.pageViews} >= 0 AND ${t.pinOpens} >= 0 AND ${t.contactClicks} >= 0 AND ${t.trialInquiries} >= 0`),
  ],
);

export type TrialInquiryStatus = (typeof TRIAL_INQUIRY_STATUSES)[number];
