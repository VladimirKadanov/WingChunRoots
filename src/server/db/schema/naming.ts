// Naming requests (review 2026-11-13: authz 1-4, flows-community H1, H2, M3, N7; owner decision
// 2026-11-27, docs/adr/0088-review-1113-leftovers.md). Nobody is attached to someone else's content
// without agreeing to it:
//
//   organization_member   an organization's admin lists a person as a member (organization_membership);
//   event_instructor      an organizer names a person as an instructor of an event (event_instructor);
//   exam_examiner         a passport writer names a person as an examination's examiner (passport_exam);
//   entry_issuer          a teacher names an organization as the issuer of a rank, exam or skill;
//   organization_admin    an organization's owner makes an account an administrator (organization_admin).
//
// A request waits here until it is answered; the content row gets the person, organization or
// account only then, so every existing read (public views, the right to write a passport, the
// right to manage) sees accepted attachments only and nothing else changed for them.
//
//   status 'pending'    the named account answers: the person's own account (person.claimed_by_user_id),
//                       an active admin of the named organization, or the account whose e-mail
//                       address an admin invitation names;
//   status 'in_review'  a person without an account (unclaimed or historical): the archivists and
//                       administrators decide, so the archive is not bent by whoever names them.
//
// An accepted or approved request is applied and deleted; a declined one is deleted. Who asked and
// what was decided stays in the audit log (naming.request, naming.answer, naming.review).
// An admin invitation stores the address it was sent to (any address: the owner's screen answers the
// same whether or not an account uses it) and expires NAMING_ADMIN_INVITE_DAYS after it was made;
// the daily retention job deletes it then (src/server/services/retention.ts).

import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { authUser } from './auth';
import { idColumn, inList, ORGANIZATION_ADMIN_ROLES, ORGANIZATION_ROLES, timestamps } from './common';
import { event } from './events';
import { organization } from './organizations';
import { passportExam, passportRank, passportSkill } from './passport';
import { person } from './persons';

export const NAMING_KINDS = ['organization_member', 'event_instructor', 'exam_examiner', 'entry_issuer', 'organization_admin'] as const;
export type NamingKind = (typeof NAMING_KINDS)[number];
export const NAMING_STATUSES = ['pending', 'in_review'] as const;
export type NamingStatus = (typeof NAMING_STATUSES)[number];
/** An administrator invitation is answered within this many days, or it goes. */
export const NAMING_ADMIN_INVITE_DAYS = 14;

export const namingRequest = pgTable(
  'naming_request',
  {
    id: idColumn(),
    kind: text('kind', { enum: NAMING_KINDS }).notNull(),
    status: text('status', { enum: NAMING_STATUSES }).notNull(),
    /** The person named (organization_member, event_instructor, exam_examiner). */
    personId: uuid('person_id').references(() => person.id, { onDelete: 'cascade' }),
    /** The organization: whose member or admin (organization_member, organization_admin), or the issuer named (entry_issuer). */
    organizationId: uuid('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    /** event_instructor: the event, and the place in its list of instructors. */
    eventId: uuid('event_id').references(() => event.id, { onDelete: 'cascade' }),
    position: integer('position'),
    /** exam_examiner, entry_issuer: the passport entry (one of the three). */
    rankId: uuid('rank_id').references(() => passportRank.id, { onDelete: 'cascade' }),
    examId: uuid('exam_id').references(() => passportExam.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').references(() => passportSkill.id, { onDelete: 'cascade' }),
    /** organization_member: the role and start; organization_admin: the admin role. */
    role: text('role'),
    startsOn: date('starts_on'),
    /** organization_admin: the address the invitation names (lower case). */
    email: text('email'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    askedByUserId: uuid('asked_by_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    check('naming_request_kind_check', inList(t.kind.name, NAMING_KINDS)),
    check('naming_request_status_check', inList(t.status.name, NAMING_STATUSES)),
    check(
      'naming_request_shape',
      // coalesce: a NULL position or role makes a branch NULL, which a CHECK would let through.
      sql`coalesce(CASE ${t.kind}
        WHEN 'organization_member' THEN ${t.personId} IS NOT NULL AND ${t.organizationId} IS NOT NULL AND ${t.role} IN (${sql.raw(ORGANIZATION_ROLES.map((r) => `'${r}'`).join(', '))})
        WHEN 'event_instructor' THEN ${t.personId} IS NOT NULL AND ${t.eventId} IS NOT NULL AND ${t.position} BETWEEN 0 AND 4
        WHEN 'exam_examiner' THEN ${t.personId} IS NOT NULL AND ${t.examId} IS NOT NULL
        WHEN 'entry_issuer' THEN ${t.organizationId} IS NOT NULL AND num_nonnulls(${t.rankId}, ${t.examId}, ${t.skillId}) = 1 AND ${t.status} = 'pending'
        WHEN 'organization_admin' THEN ${t.organizationId} IS NOT NULL AND ${t.email} IS NOT NULL AND ${t.expiresAt} IS NOT NULL AND ${t.status} = 'pending'
          AND ${t.role} IN (${sql.raw(ORGANIZATION_ADMIN_ROLES.map((r) => `'${r}'`).join(', '))})
      END, false)`,
    ),
    check('naming_request_email_lower', sql`${t.email} IS NULL OR ${t.email} = lower(${t.email})`),
    uniqueIndex('naming_request_member_key').on(t.organizationId, t.personId).where(sql`${t.kind} = 'organization_member'`),
    uniqueIndex('naming_request_instructor_key').on(t.eventId, t.personId).where(sql`${t.kind} = 'event_instructor'`),
    uniqueIndex('naming_request_examiner_key').on(t.examId).where(sql`${t.kind} = 'exam_examiner'`),
    uniqueIndex('naming_request_issuer_rank_key').on(t.rankId).where(sql`${t.kind} = 'entry_issuer'`),
    uniqueIndex('naming_request_issuer_exam_key').on(t.examId).where(sql`${t.kind} = 'entry_issuer'`),
    uniqueIndex('naming_request_issuer_skill_key').on(t.skillId).where(sql`${t.kind} = 'entry_issuer'`),
    uniqueIndex('naming_request_admin_key').on(t.organizationId, t.email).where(sql`${t.kind} = 'organization_admin'`),
    index('naming_request_person_id_idx').on(t.personId),
    index('naming_request_organization_id_idx').on(t.organizationId),
    index('naming_request_event_id_idx').on(t.eventId),
    index('naming_request_rank_id_idx').on(t.rankId),
    index('naming_request_exam_id_idx').on(t.examId),
    index('naming_request_skill_id_idx').on(t.skillId),
    index('naming_request_email_idx').on(t.email),
    index('naming_request_asked_by_user_id_idx').on(t.askedByUserId),
    index('naming_request_review_idx').on(t.status, t.createdAt),
  ],
);
