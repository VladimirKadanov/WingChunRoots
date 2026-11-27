// Impersonation reports (owner decisions 2026-11-27; docs/adr/0088-impersonation-reports.md;
// specification §16.1): "This account is pretending to be me". Every report is a review_case of kind
// identity_report; these tables hold what the case is about and the proofs gathered for it. The
// public role has no access to any of them (plan §6.4).

import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import {
  idColumn,
  IDENTITY_CODE_CHANNELS,
  IDENTITY_NOTE_MAX,
  IDENTITY_REPORT_STATUSES,
  IDENTITY_REPORT_TYPES,
  IDENTITY_ROUTES,
  IDENTITY_SIDES,
  IDENTITY_TARGET_MAX,
  IDENTITY_VOUCH_ANSWERS,
  IDENTITY_VOUCH_KINDS,
  inList,
  OPEN_IDENTITY_REPORT_STATUSES,
  timestamps,
} from './common';
import { reviewCase } from './evidence';
import { person } from './persons';

/**
 * One impersonation report: who reported which profile, the account that held the profile when it
 * was reported, the proof route, and where it stands. The profile's hold is person.identity_hold_at.
 */
export const identityReport = pgTable(
  'identity_report',
  {
    id: idColumn(),
    reviewCaseId: uuid('review_case_id')
      .notNull()
      .references(() => reviewCase.id, { onDelete: 'cascade' }),
    subjectPersonId: uuid('subject_person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    reporterUserId: uuid('reporter_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    // The account that held the profile when it was reported (the transfer moves it away from it).
    reportedUserId: uuid('reported_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    type: text('type', { enum: IDENTITY_REPORT_TYPES }).notNull(),
    route: text('route', { enum: IDENTITY_ROUTES }).notNull(),
    status: text('status', { enum: IDENTITY_REPORT_STATUSES }).notNull().default('open'),
    heldAt: timestamp('held_at', { withTimezone: true }),
    heldByUserId: uuid('held_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    // Set with the hold: the proof is due by proof_due_at, and the hold lifts by hold_until.
    proofDueAt: timestamp('proof_due_at', { withTimezone: true }),
    holdUntil: timestamp('hold_until', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // What a decision did, in ids and counts only (relationships sent back, photos removed, suspended).
    outcome: jsonb('outcome').$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('identity_report_review_case_id_key').on(t.reviewCaseId),
    // One open report per reporter (a double submit cannot send two).
    uniqueIndex('identity_report_one_open_key')
      .on(t.reporterUserId)
      .where(sql`${t.reporterUserId} IS NOT NULL AND ${inList(t.status.name, OPEN_IDENTITY_REPORT_STATUSES)}`),
    index('identity_report_subject_person_id_idx').on(t.subjectPersonId),
    index('identity_report_reported_user_id_idx').on(t.reportedUserId),
    index('identity_report_held_by_user_id_idx').on(t.heldByUserId),
    check('identity_report_type_check', inList(t.type.name, IDENTITY_REPORT_TYPES)),
    check('identity_report_route_check', inList(t.route.name, IDENTITY_ROUTES)),
    check('identity_report_status_check', inList(t.status.name, IDENTITY_REPORT_STATUSES)),
    // A duplicate's proof is the reporter's own profile; an impostor report names a route.
    check('identity_report_route_of_type', sql`(${t.type} = 'duplicate') = (${t.route} = 'own_profile')`),
    check('identity_report_held', sql`${t.status} <> 'held' OR (${t.heldAt} IS NOT NULL AND ${t.proofDueAt} IS NOT NULL AND ${t.holdUntil} IS NOT NULL)`),
  ],
);

/**
 * Decision 6: a vouch asked of a verified teacher or a verified peer by one side of a report. The
 * voucher answers once (yes, no, not sure) with an optional note only the administrators read.
 */
export const identityVouch = pgTable(
  'identity_vouch',
  {
    id: idColumn(),
    reviewCaseId: uuid('review_case_id')
      .notNull()
      .references(() => reviewCase.id, { onDelete: 'cascade' }),
    side: text('side', { enum: IDENTITY_SIDES }).notNull(),
    kind: text('kind', { enum: IDENTITY_VOUCH_KINDS }).notNull(),
    voucherUserId: uuid('voucher_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    voucherPersonId: uuid('voucher_person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    // A short message from the side that asked, which the voucher reads.
    message: text('message'),
    answer: text('answer', { enum: IDENTITY_VOUCH_ANSWERS }),
    note: text('note'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('identity_vouch_case_side_voucher_key').on(t.reviewCaseId, t.side, t.voucherUserId),
    index('identity_vouch_voucher_user_id_idx').on(t.voucherUserId),
    index('identity_vouch_voucher_person_id_idx').on(t.voucherPersonId),
    index('identity_vouch_requested_by_user_id_idx').on(t.requestedByUserId),
    check('identity_vouch_side_check', inList(t.side.name, IDENTITY_SIDES)),
    check('identity_vouch_kind_check', inList(t.kind.name, IDENTITY_VOUCH_KINDS)),
    check('identity_vouch_answer_check', sql`${t.answer} IS NULL OR ${inList(t.answer.name, IDENTITY_VOUCH_ANSWERS)}`),
    check('identity_vouch_answered', sql`(${t.answer} IS NULL) = (${t.answeredAt} IS NULL)`),
    check('identity_vouch_message', sql`${t.message} IS NULL OR char_length(${t.message}) BETWEEN 1 AND ${sql.raw(String(IDENTITY_NOTE_MAX))}`),
    check('identity_vouch_note', sql`${t.note} IS NULL OR (${t.answer} IS NOT NULL AND char_length(${t.note}) BETWEEN 1 AND ${sql.raw(String(IDENTITY_NOTE_MAX))})`),
  ],
);

/**
 * The own-channel route: a one-time code. `email`: sent to an address at the school's own domain
 * (only the domain is kept, the code as a SHA-256 hash), confirmed when the side types it back.
 * `page`: shown to the side to post on the school's website or official social page (kept as it is,
 * since it is meant to be public), confirmed by an administrator who saw it on the page.
 */
export const identityCode = pgTable(
  'identity_code',
  {
    id: idColumn(),
    reviewCaseId: uuid('review_case_id')
      .notNull()
      .references(() => reviewCase.id, { onDelete: 'cascade' }),
    side: text('side', { enum: IDENTITY_SIDES }).notNull(),
    channel: text('channel', { enum: IDENTITY_CODE_CHANNELS }).notNull(),
    requestedByUserId: uuid('requested_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    // `email`: the domain only (never the address); `page`: the page's address.
    target: text('target').notNull(),
    codeHash: text('code_hash'),
    publicCode: text('public_code'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    index('identity_code_review_case_id_idx').on(t.reviewCaseId),
    index('identity_code_requested_by_user_id_idx').on(t.requestedByUserId),
    index('identity_code_confirmed_by_user_id_idx').on(t.confirmedByUserId),
    check('identity_code_side_check', inList(t.side.name, IDENTITY_SIDES)),
    check('identity_code_channel_check', inList(t.channel.name, IDENTITY_CODE_CHANNELS)),
    check('identity_code_target_length', sql`char_length(${t.target}) BETWEEN 1 AND ${sql.raw(String(IDENTITY_TARGET_MAX))}`),
    check(
      'identity_code_secret',
      sql`(${t.channel} = 'email' AND ${t.codeHash} ~ '^[0-9a-f]{64}$' AND ${t.publicCode} IS NULL) OR (${t.channel} = 'page' AND ${t.codeHash} IS NULL AND ${t.publicCode} ~ '^WCR-[A-Z0-9]{8}$')`,
    ),
    check('identity_code_attempts', sql`${t.attempts} >= 0`),
  ],
);
