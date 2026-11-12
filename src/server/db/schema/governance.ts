// Governance (milestone M25; docs/adr/0028-governance.md; specification §15, §16.1, §16.3):
// digital successors and succession requests, evidence-based lineage dispute reports, appeals of a
// decision, and proposed changes to the shared archival records with their change history. Every
// decision is a review_case of the queue (M10a); these tables hold what the case is about. The
// public role has no access to any of them (plan §6.4).

import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import {
  APPEAL_STATUSES,
  APPEALABLE_KINDS,
  idColumn,
  inList,
  LINEAGE_REPORT_GROUNDS,
  LINEAGE_REPORT_STATUSES,
  LIVE_NOMINATION_STATUSES,
  RECORD_PROPOSAL_STATUSES,
  RECORD_REVISION_SOURCES,
  SUCCESSION_BASES,
  SUCCESSION_NOMINATION_STATUSES,
  SUCCESSION_REQUEST_STATUSES,
  timestamps,
} from './common';
import { reviewCase, reviewEvent } from './evidence';
import { teachingRelationship } from './lineage';
import { person } from './persons';

/**
 * M25: an owner's nomination of a digital successor among their verified students (specification
 * §15). Only the owner nominates and revokes; only the nominee accepts or declines.
 */
export const successionNomination = pgTable(
  'succession_nomination',
  {
    id: idColumn(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    ownerPersonId: uuid('owner_person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'restrict' }),
    successorUserId: uuid('successor_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    successorPersonId: uuid('successor_person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'restrict' }),
    status: text('status', { enum: SUCCESSION_NOMINATION_STATUSES }).notNull().default('pending'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // At most one live nomination per owner (a double submit cannot nominate two).
    uniqueIndex('succession_nomination_one_live_key')
      .on(t.ownerUserId)
      .where(sql`${inList(t.status.name, LIVE_NOMINATION_STATUSES)}`),
    index('succession_nomination_successor_user_id_idx').on(t.successorUserId),
    index('succession_nomination_owner_person_id_idx').on(t.ownerPersonId),
    index('succession_nomination_successor_person_id_idx').on(t.successorPersonId),
    check('succession_nomination_status_check', inList(t.status.name, SUCCESSION_NOMINATION_STATUSES)),
    check('succession_nomination_not_self', sql`${t.ownerUserId} <> ${t.successorUserId}`),
    check('succession_nomination_revoked_at', sql`(${t.status} = 'revoked') = (${t.revokedAt} IS NOT NULL)`),
  ],
);

/**
 * M25: an accepted successor's request to take over the owner's administration, after a reported
 * death or more than 180 days of inactivity, always with evidence and an administrator's review
 * (its review_case of kind succession_request). `transferred` records what the approval moved.
 */
export const successionRequest = pgTable(
  'succession_request',
  {
    id: idColumn(),
    nominationId: uuid('nomination_id')
      .notNull()
      .references(() => successionNomination.id, { onDelete: 'restrict' }),
    reviewCaseId: uuid('review_case_id')
      .notNull()
      .references(() => reviewCase.id, { onDelete: 'restrict' }),
    requesterUserId: uuid('requester_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    ownerUserId: uuid('owner_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    basis: text('basis', { enum: SUCCESSION_BASES }).notNull(),
    /** The owner's days without activity when the request was sent (a fact for the reviewer). */
    inactiveDays: integer('inactive_days').notNull(),
    status: text('status', { enum: SUCCESSION_REQUEST_STATUSES }).notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    transferred: jsonb('transferred').$type<{ schoolIds: string[]; organizationIds: string[] }>(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('succession_request_review_case_id_key').on(t.reviewCaseId),
    uniqueIndex('succession_request_one_pending_key').on(t.nominationId).where(sql`${t.status} = 'pending'`),
    index('succession_request_requester_user_id_idx').on(t.requesterUserId),
    index('succession_request_owner_user_id_idx').on(t.ownerUserId),
    check('succession_request_basis_check', inList(t.basis.name, SUCCESSION_BASES)),
    check('succession_request_status_check', inList(t.status.name, SUCCESSION_REQUEST_STATUSES)),
    check('succession_request_inactive_days', sql`${t.inactiveDays} >= 0`),
  ],
);

/**
 * M25: an evidence-based report that a public teaching relationship is wrong (specification
 * §16.1). It changes nothing by itself: a moderator upholds it (and sets the relationship in
 * arbitration) or does not, with a reason. The reported people never learn who reported.
 */
export const lineageReport = pgTable(
  'lineage_report',
  {
    id: idColumn(),
    relationshipId: uuid('relationship_id').references(() => teachingRelationship.id, { onDelete: 'set null' }),
    reporterUserId: uuid('reporter_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    reviewCaseId: uuid('review_case_id')
      .notNull()
      .references(() => reviewCase.id, { onDelete: 'restrict' }),
    grounds: text('grounds', { enum: LINEAGE_REPORT_GROUNDS }).notNull(),
    status: text('status', { enum: LINEAGE_REPORT_STATUSES }).notNull().default('open'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('lineage_report_review_case_id_key').on(t.reviewCaseId),
    // One open report per account and relationship (a double submit cannot send two).
    uniqueIndex('lineage_report_one_open_key')
      .on(t.reporterUserId, t.relationshipId)
      .where(sql`${t.status} = 'open' AND ${t.reporterUserId} IS NOT NULL`),
    index('lineage_report_relationship_id_idx').on(t.relationshipId),
    check('lineage_report_status_check', inList(t.status.name, LINEAGE_REPORT_STATUSES)),
    check('lineage_report_grounds_check', inList(t.grounds.name, LINEAGE_REPORT_GROUNDS)),
  ],
);

/**
 * M25: an appeal of one decision (the review_event that decided the appealed case), by one of its
 * parties, once per decision, decided by another member of staff than the one who decided.
 */
export const decisionAppeal = pgTable(
  'decision_appeal',
  {
    id: idColumn(),
    appealedCaseId: uuid('appealed_case_id')
      .notNull()
      .references(() => reviewCase.id, { onDelete: 'restrict' }),
    appealedKind: text('appealed_kind', { enum: APPEALABLE_KINDS }).notNull(),
    decisionEventId: uuid('decision_event_id')
      .notNull()
      .references(() => reviewEvent.id, { onDelete: 'restrict' }),
    reviewCaseId: uuid('review_case_id')
      .notNull()
      .references(() => reviewCase.id, { onDelete: 'restrict' }),
    appellantUserId: uuid('appellant_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    /** Who decided the appealed case: they never decide the appeal. */
    originalDeciderUserId: uuid('original_decider_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    status: text('status', { enum: APPEAL_STATUSES }).notNull().default('pending'),
    ...timestamps(),
  },
  (t) => [
    // One appeal per decision, whoever sends it.
    uniqueIndex('decision_appeal_one_per_decision_key').on(t.decisionEventId),
    uniqueIndex('decision_appeal_review_case_id_key').on(t.reviewCaseId),
    index('decision_appeal_appealed_case_id_idx').on(t.appealedCaseId),
    index('decision_appeal_appellant_user_id_idx').on(t.appellantUserId),
    index('decision_appeal_original_decider_user_id_idx').on(t.originalDeciderUserId),
    check('decision_appeal_status_check', inList(t.status.name, APPEAL_STATUSES)),
    check('decision_appeal_kind_check', inList(t.appealedKind.name, APPEALABLE_KINDS)),
  ],
);

/** The fields of an archival record a proposal or an edit may change (names, life status, biography). */
export interface RecordFields {
  primaryName: string;
  originalName: string | null;
  originalLang: string | null;
  lifeStatus: 'living' | 'deceased' | 'unknown';
  bio: string | null;
}

/**
 * M25: a proposed change to a shared archival record (a record kept by the platform or unclaimed,
 * specification §16.1): no school or organization edits it alone; an archivist approves (the change
 * is applied as a record_revision) or rejects it, with a reason.
 */
export const recordProposal = pgTable(
  'record_proposal',
  {
    id: idColumn(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    proposerUserId: uuid('proposer_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    reviewCaseId: uuid('review_case_id')
      .notNull()
      .references(() => reviewCase.id, { onDelete: 'restrict' }),
    /** The record as proposed (all of the editable fields), and as it was when proposed. */
    proposed: jsonb('proposed').$type<RecordFields>().notNull(),
    base: jsonb('base').$type<RecordFields>().notNull(),
    status: text('status', { enum: RECORD_PROPOSAL_STATUSES }).notNull().default('pending'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('record_proposal_review_case_id_key').on(t.reviewCaseId),
    // One pending proposal per account and record.
    uniqueIndex('record_proposal_one_pending_key')
      .on(t.proposerUserId, t.personId)
      .where(sql`${t.status} = 'pending' AND ${t.proposerUserId} IS NOT NULL`),
    index('record_proposal_person_id_idx').on(t.personId),
    check('record_proposal_status_check', inList(t.status.name, RECORD_PROPOSAL_STATUSES)),
  ],
);

/**
 * M25: the change history of an archival record, append-only (app_rw has SELECT and INSERT): every
 * archival edit and every approved proposal, with the fields before and after, who made it (the
 * account), the reason and the case. An organizational split never rewrites it.
 */
export const recordRevision = pgTable(
  'record_revision',
  {
    id: idColumn(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    source: text('source', { enum: RECORD_REVISION_SOURCES }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    reviewCaseId: uuid('review_case_id').references(() => reviewCase.id, { onDelete: 'set null' }),
    changed: text('changed').array().notNull(),
    before: jsonb('before').$type<RecordFields>().notNull(),
    after: jsonb('after').$type<RecordFields>().notNull(),
    reason: text('reason').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('record_revision_person_id_idx').on(t.personId, t.createdAt),
    index('record_revision_actor_user_id_idx').on(t.actorUserId),
    index('record_revision_review_case_id_idx').on(t.reviewCaseId),
    check('record_revision_source_check', inList(t.source.name, RECORD_REVISION_SOURCES)),
    check('record_revision_reason_not_blank', sql`btrim(${t.reason}) <> ''`),
  ],
);
