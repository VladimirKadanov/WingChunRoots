// Account erasure (review 2026-11; docs/adr/0030-takedown-suspension-erasure.md). One service for the
// two ways in: an administrator's audited `accounts.erase` (works on the hosted service) and the
// local command `pnpm account:delete --case <id>` (src/server/auth/account-delete-cli.ts, which
// refuses production and a database that is not on this machine and calls this same code).
//
// Until now the only erasure was the local command, and it stopped with CONFLICT whenever another
// table still pointed to the account with a RESTRICT foreign key (a relationship the account
// requested or confirmed, a review note, an invitation ...), which is most accounts that did
// anything. The rule here, DEFAULT review-2026-11 (docs/plan/questions/review-2026-11-takedown.md):
//
//   ANONYMISE IN PLACE. Everything that belongs to the person is removed or blanked in one
//   transaction. The `auth_user` row is then deleted when nothing that must stay still points to
//   it, and otherwise stays as a TOMBSTONE: address `erased-<id>@erased.invalid`, no name, no role,
//   banned for good, no sign-in data. A tombstone is a pseudonymous marker that keeps the records
//   others rely on (a relationship's confirmer, the append-only history) pointing somewhere.
//
// What is kept, and why:
//   - (DEFAULT review-2026-11: the Latin display name stays, so a verified lineage still reads as one)
//     the profile as an unclaimed record with its Latin display name only, public only when it was
//     public and has a relationship others verified (the M07 default, docs/plan/questions/M07.md);
//   - relationships others verified, with their history (append-only);
//   - evidence that a verified relationship rests on, without the uploaded file's name and hash;
//   - the audit log (ids and counts, never a name or an address).
//
// What is removed or blanked: the sign-in account, sessions, credentials and second factor;
// consents, notifications, preferences, plan grants, billing rows (a live subscription is ended at
// the provider first); the profile's other names, biographies, photos (files too), city, year,
// country and birth date; the schools the account listed (archived, with their photos and the trial
// inquiries sent to them) and its own events (with their posters); the passport of the kept record
// (certificate rows and their files in the private store, ranks, examinations, skills, attendance,
// organization memberships); the account's pending relationship requests (withdrawn, so nobody can
// approve them: flows-core L3) and the open claims and requests it made; invitations it sent or
// received (revoked, the address erased); trial-lesson inquiries it sent; the address in the
// e-mail delivery log; the evidence nothing live rests on (rows and files); the review notes it
// wrote (blanked); every nullable reference to it that the app may clear.
//
// The text of the kept record's archival revisions (record_revision.before and after) is redacted with
// the rest (docs/adr/0032-retention-and-withdrawal.md): who, when, which fields and why stay.
//
// The erasure is written to the erasure ledger (src/server/erasure-ledger.ts) before the first change, inside
// the transaction, and is refused when the ledger cannot be written: a restored backup brings the account
// back, and `pnpm erasures:replay` repeats the erasure from the ledger (services/erasure-replay.ts).
//
// A catalogue, USER_REFERENCES, lists every column that refers to auth_user with what erasure does to
// it; a test (account-erasure.int.test.ts) fails when a new table or column is not in it.
//
// Lock order, the same everywhere: the global verify lock (an approval and an erasure never
// interleave), the account (services/account-lock.ts), the deletion request, the person, then the
// rows below. Files are deleted after the commit, best effort, as photos always were. The caller
// drops the public cache with `tags` when it runs in the web process; the command line cannot (it
// says to restart the web server).

import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { erasedEmail, isErasedEmail } from '../auth/suspension';
import { EVENTS_TAG, invalidatePublic, ORGANIZATIONS_TAG, SCHOOLS_TAG } from '../cache';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { beginLedger, type LedgerHandle } from '../erasure-ledger';
import {
  authUser,
  event,
  eventAttendance,
  eventInstructor,
  evidenceLink,
  invitation,
  organizationAdmin,
  organizationMembership,
  organizationTeacherClaim,
  passportCertificate,
  passportExam,
  passportRank,
  passportSkill,
  person,
  personBio,
  personName,
  personPhoto,
  relationshipEvent,
  reviewCase,
  reviewEvent,
  reviewNote,
  school,
  schoolInstructor,
  schoolPhoto,
  schoolPrivateLocation,
  successionNomination,
  successionRequest,
  teachingRelationship,
  trialInquiry,
} from '../db/schema';
import { GALLERY_PHOTO_STATUSES, OPEN_REVIEW_CASE_STATUSES } from '../db/schema/common';
import type { Transaction } from '../jobs/outbox';
import { logger } from '../log';
import { getEvidenceStore, type ObjectStore } from '../storage';
import { lockAccount } from './account-lock';
import { endSubscriptionsBeforeDeletion } from './billing-subject';
import type { RequestMeta } from './context';
import { isServiceError, ServiceError } from './errors';
import { queueRecomputeForPerson } from './lineage-membership';
import { notify } from './notify';
import { deleteCertificateFiles } from './passport';
import { deletePhotoFiles } from './photos';
import { neighbourTags } from './profile';
import { lockStudentRequests, VERIFY_LOCK } from './relationships';
import { ERASE_DELIVERY_ADDRESS, isReferencedRowError } from './retention';
import { accountRef, parseOrThrow, reasonText, requireStandingAdmin, SUSPENSION_REASON_MAX } from './suspension';

export const ERASURE_REASON_MAX = SUSPENSION_REASON_MAX;

// --- The catalogue of references to auth_user ------------------------------------------------------

/**
 * What erasure does to a column that refers to auth_user:
 *   delete   the rows are deleted (they belong to the account);
 *   clear    the column is set to NULL (the row belongs to someone else or to the record);
 *   keep     the rows stay (a record others rely on, or a table the app cannot change): when one is
 *            left, the account row stays as a tombstone instead of being deleted;
 *   database a table the app may not update (append-only): the database sets it to NULL when the
 *            account row is deleted, and it stays pointing at the tombstone otherwise.
 */
export type ReferenceAction = 'delete' | 'clear' | 'keep' | 'database';

export interface UserReference {
  table: string;
  column: string;
  action: ReferenceAction;
  why: string;
}

/**
 * Every foreign key to auth_user(id) (the test reads them from pg_constraint) and what erasure does,
 * in the order the generic step runs them. A column the catalogue does not list fails the test.
 */
export const USER_REFERENCES: readonly UserReference[] = [
  // The sign-in account.
  { table: 'auth_account', column: 'user_id', action: 'delete', why: 'credentials' },
  { table: 'auth_session', column: 'user_id', action: 'delete', why: 'sessions' },
  { table: 'auth_two_factor', column: 'user_id', action: 'delete', why: 'second factor' },
  // Billing: a live subscription was ended at the provider before this runs.
  { table: 'billing_subscription', column: 'subject_user_id', action: 'delete', why: 'the account’s own plan payments (their invoices go with them)' },
  { table: 'billing_customer', column: 'subject_user_id', action: 'delete', why: 'the account’s own payment customer' },
  { table: 'billing_checkout', column: 'subject_user_id', action: 'delete', why: 'the account’s own checkouts' },
  { table: 'billing_checkout', column: 'created_by_user_id', action: 'keep', why: 'a checkout the account started for an organization stays with the organization (the organization’s billing history)' },
  { table: 'entitlement_grant', column: 'subject_user_id', action: 'delete', why: 'the account’s own plan grants' },
  { table: 'entitlement_grant', column: 'granted_by_user_id', action: 'clear', why: 'a grant the account gave stays; who gave it is in the audit log' },
  { table: 'entitlement_grant', column: 'revoked_by_user_id', action: 'clear', why: 'as above' },
  // What the account owns.
  { table: 'notification', column: 'user_id', action: 'delete', why: 'notifications' },
  { table: 'notification_preference', column: 'user_id', action: 'delete', why: 'preferences' },
  { table: 'consent_record', column: 'user_id', action: 'delete', why: 'consents (the M07 default: deleted with the account)' },
  { table: 'person_claim', column: 'user_id', action: 'delete', why: 'claims of a record by the account' },
  { table: 'person_claim', column: 'decided_by_user_id', action: 'clear', why: 'a claim the account decided stays decided' },
  { table: 'pilot_access_request', column: 'user_id', action: 'delete', why: 'plan requests' },
  { table: 'pilot_access_request', column: 'closed_by_user_id', action: 'clear', why: 'a request the account closed stays closed' },
  { table: 'trial_inquiry', column: 'sender_user_id', action: 'delete', why: 'trial-lesson inquiries the account sent (its name and contact detail)' },
  { table: 'trial_inquiry', column: 'handled_by_user_id', action: 'clear', why: 'an inquiry the account answered' },
  // Authority over organizations and successors.
  { table: 'organization_admin', column: 'user_id', action: 'keep', why: 'the row is revoked, not deleted (no DELETE privilege): who had authority over an organization stays' },
  { table: 'organization_admin', column: 'granted_by_user_id', action: 'clear', why: 'authority the account gave' },
  { table: 'organization_admin', column: 'revoked_by_user_id', action: 'clear', why: 'authority the account withdrew' },
  { table: 'succession_nomination', column: 'owner_user_id', action: 'keep', why: 'revoked; deleted when no succession request refers to it, otherwise it stays' },
  { table: 'succession_nomination', column: 'successor_user_id', action: 'keep', why: 'as above' },
  { table: 'succession_request', column: 'owner_user_id', action: 'clear', why: 'a request about the account' },
  { table: 'succession_request', column: 'requester_user_id', action: 'clear', why: 'a request the account made' },
  // The records the account made or acted on.
  { table: 'person', column: 'claimed_by_user_id', action: 'clear', why: 'the profile becomes an unclaimed record' },
  { table: 'person', column: 'created_by_user_id', action: 'clear', why: 'records the account added for other people' },
  { table: 'school', column: 'created_by_user_id', action: 'clear', why: 'schools the account listed are archived' },
  { table: 'review_case', column: 'opened_by_user_id', action: 'clear', why: 'cases the account opened keep no link to it' },
  { table: 'review_case', column: 'assigned_to_user_id', action: 'clear', why: 'cases assigned to the account' },
  { table: 'review_note', column: 'author_user_id', action: 'clear', why: 'notes the account wrote are blanked first' },
  { table: 'evidence_file', column: 'uploaded_by_user_id', action: 'clear', why: 'files the account uploaded: names and hashes cleared, unused ones deleted first' },
  { table: 'evidence_link', column: 'created_by_user_id', action: 'clear', why: 'links the account made: their notes are cleared first' },
  { table: 'invitation', column: 'invited_by_user_id', action: 'clear', why: 'invitations the account sent are revoked first' },
  { table: 'invitation', column: 'accepted_by_user_id', action: 'clear', why: 'an invitation the account accepted' },
  { table: 'teaching_relationship', column: 'requested_by_user_id', action: 'keep', why: 'who asked for a relationship others verified is part of its record' },
  { table: 'teaching_relationship', column: 'confirmed_by_user_id', action: 'keep', why: 'who confirmed a relationship is part of its record' },
  { table: 'relationship_event', column: 'actor_user_id', action: 'keep', why: 'append-only history of a relationship (no UPDATE, no DELETE)' },
  { table: 'review_event', column: 'actor_user_id', action: 'database', why: 'append-only history of a case; only the foreign key writes it' },
  { table: 'record_revision', column: 'actor_user_id', action: 'database', why: 'append-only history of a record; only the foreign key writes it' },
  { table: 'content_report', column: 'reporter_user_id', action: 'clear', why: 'a report stays, without who made it' },
  { table: 'lineage_report', column: 'reporter_user_id', action: 'clear', why: 'as above' },
  { table: 'decision_appeal', column: 'appellant_user_id', action: 'clear', why: 'an appeal stays, without who made it' },
  { table: 'decision_appeal', column: 'original_decider_user_id', action: 'clear', why: 'who decided' },
  { table: 'record_proposal', column: 'proposer_user_id', action: 'clear', why: 'a proposal stays, without who made it' },
  { table: 'email_delivery', column: 'user_id', action: 'clear', why: 'the delivery log keeps no link to the account (its address is erased first)' },
  // Events, photos, schools, organizations and the passport.
  { table: 'event', column: 'organizer_user_id', action: 'clear', why: 'own events are removed first; an organization’s events stay' },
  { table: 'event', column: 'created_by_user_id', action: 'clear', why: 'events the account created for an organization' },
  { table: 'event', column: 'cancelled_by_user_id', action: 'clear', why: 'events the account cancelled' },
  { table: 'event', column: 'removed_by_user_id', action: 'clear', why: 'events the account removed' },
  { table: 'event_attendance', column: 'created_by_user_id', action: 'clear', why: 'attendance the account marked' },
  { table: 'event_attendance', column: 'withdrawn_by_user_id', action: 'clear', why: 'as above' },
  { table: 'event_attendance', column: 'removed_by_user_id', action: 'clear', why: 'as above' },
  { table: 'federation_trial', column: 'started_by_user_id', action: 'clear', why: 'an organization’s trial the account started' },
  { table: 'federation_trial', column: 'ended_by_user_id', action: 'clear', why: 'as above' },
  { table: 'organization', column: 'created_by_user_id', action: 'clear', why: 'the organization stays, without who created it' },
  { table: 'organization', column: 'approved_by_user_id', action: 'clear', why: 'as above' },
  { table: 'organization_import', column: 'created_by_user_id', action: 'clear', why: 'an import the account ran' },
  { table: 'organization_import', column: 'ended_by_user_id', action: 'clear', why: 'as above' },
  { table: 'organization_school', column: 'requested_by_user_id', action: 'clear', why: 'a school link the account asked for or answered' },
  { table: 'organization_school', column: 'answered_by_user_id', action: 'clear', why: 'as above' },
  { table: 'organization_school', column: 'ended_by_user_id', action: 'clear', why: 'as above' },
  { table: 'organization_teacher_claim', column: 'created_by_user_id', action: 'clear', why: 'a claim an organization’s admin made' },
  { table: 'organization_teacher_claim', column: 'withdrawn_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_certificate', column: 'created_by_user_id', action: 'clear', why: 'passport entries the account wrote' },
  { table: 'passport_certificate', column: 'withdrawn_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_certificate', column: 'removed_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_exam', column: 'created_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_exam', column: 'withdrawn_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_exam', column: 'removed_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_rank', column: 'created_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_rank', column: 'withdrawn_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_rank', column: 'removed_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_skill', column: 'created_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_skill', column: 'withdrawn_by_user_id', action: 'clear', why: 'as above' },
  { table: 'passport_skill', column: 'removed_by_user_id', action: 'clear', why: 'as above' },
  { table: 'person_photo', column: 'uploaded_by_user_id', action: 'clear', why: 'photos the account uploaded (marked removed, their files deleted, first)' },
  { table: 'person_photo', column: 'removed_by_user_id', action: 'clear', why: 'photos the account removed' },
  { table: 'school_photo', column: 'uploaded_by_user_id', action: 'clear', why: 'as above' },
  { table: 'school_photo', column: 'removed_by_user_id', action: 'clear', why: 'as above' },
];

/** Columns of other tables that hold an account id without a foreign key (the audit log is append-only). */
export const USER_REFERENCES_WITHOUT_KEY: readonly { table: string; column: string; why: string }[] = [
  { table: 'audit_log', column: 'actor_user_id', why: 'append-only: ids and dates only, never a name or an address' },
  { table: 'auth_session', column: 'impersonated_by', why: 'the sessions of the account are deleted; the admin plugin’s impersonation is off' },
];

const ZERO_SHA = '0'.repeat(64);
const ERASED_TEXT = 'Erased';
const NOTE_REMOVED = 'Removed: the account that wrote this was erased.';
/** Open cases the account made on its own behalf: they end with it (the others stay for the reviewers). */
const OWN_CASE_KINDS = ['historical_claim', 'person_claim', 'instructor_verification', 'succession_request'] as const;

// --- Result and request ------------------------------------------------------------------------------

export interface ErasureRequest {
  /** The administrator, or null for the local command line. */
  actor: Principal | null;
  /** The account: by an open deletion request (its id), or directly by account id or address. */
  by: { caseId: string } | { userId: string } | { email: string };
  /** The administrator's own words (audited, never shown to the person). */
  reason: string;
  meta?: RequestMeta;
  /** What the deletion request is closed with. */
  caseNote?: string;
  /**
   * Only for the replay of the erasure ledger after a restore (services/erasure-replay.ts), which repeats
   * an erasure the ledger already records: no new line is written. Every other caller leaves it out.
   */
  skipLedger?: boolean;
}

export interface ErasureCounts {
  namesRemoved: number;
  biosRemoved: number;
  photosRemoved: number;
  consentsRemoved: number;
  schoolsArchived: number;
  eventsRemoved: number;
  requestsWithdrawn: number;
  casesDismissed: number;
  invitationsRevoked: number;
  certificatesRemoved: number;
  passportEntriesRemoved: number;
  evidenceDeleted: number;
  evidenceKept: number;
  deliveriesErased: number;
  /** Revisions of the kept record whose text was redacted (docs/adr/0032-retention-and-withdrawal.md). */
  revisionsRedacted: number;
}

export interface ErasureOutcome {
  userId: string;
  /** The deletion request that was closed, if there was one. */
  caseId: string | null;
  /** The profile that stays as an unclaimed record, or null. */
  personId: string | null;
  visibility: 'public' | 'involved_only' | null;
  /** True when the account row stays as a nameless tombstone (a record that must stay still points to it). */
  tombstone: boolean;
  counts: ErasureCounts;
  /** Public cache tags to drop after the commit, by the process that has the cache. */
  tags: string[];
}

interface Files {
  photos: { id: string; storageKey: string }[];
  schoolPhotos: { id: string; storageKey: string }[];
  posters: { id: string; storageKey: string }[];
  certificates: { id: string; storageKey: string }[];
  evidence: { id: string; storageKey: string }[];
}

const emptyCounts = (): ErasureCounts => ({
  namesRemoved: 0,
  biosRemoved: 0,
  photosRemoved: 0,
  consentsRemoved: 0,
  schoolsArchived: 0,
  eventsRemoved: 0,
  requestsWithdrawn: 0,
  casesDismissed: 0,
  invitationsRevoked: 0,
  certificatesRemoved: 0,
  passportEntriesRemoved: 0,
  evidenceDeleted: 0,
  evidenceKept: 0,
  deliveriesErased: 0,
  revisionsRedacted: 0,
});

const rowCount = (result: { rowCount?: number | null }): number => result.rowCount ?? 0;

// --- Deletion requests -------------------------------------------------------------------------------

const CASE_ID = z.uuid();

/** An open deletion request, locked (the account's lock first, as account.requestDeletion takes it). */
export async function lockOpenDeletionCase(tx: Transaction, caseId: string): Promise<{ id: string; userId: string }> {
  if (!CASE_ID.safeParse(caseId).success) throw new ServiceError('BAD_REQUEST', 'That is not the id of a case.');
  const find = () =>
    tx
      .select({ id: reviewCase.id, kind: reviewCase.kind, status: reviewCase.status, userId: reviewCase.openedByUserId })
      .from(reviewCase)
      .where(eq(reviewCase.id, caseId));
  const [seen] = await find();
  if (!seen || seen.kind !== 'deletion_request') throw new ServiceError('NOT_FOUND', 'No account deletion request has this id.');
  if (seen.userId) await lockAccount(tx, { id: seen.userId });
  const [found] = await find().for('update');
  if (!found || !found.userId || !(OPEN_REVIEW_CASE_STATUSES as readonly string[]).includes(found.status)) {
    throw new ServiceError('CONFLICT', 'This deletion request is already closed.');
  }
  return { id: found.id, userId: found.userId };
}

// --- The steps ---------------------------------------------------------------------------------------

/**
 * Dismisses the open cases matching `where` with a reason: the case, its history row, the pending
 * profile claim of a person_claim case, and a note to the reviewer it was assigned to. Returns the ids.
 */
async function dismissCases(
  tx: Transaction,
  where: SQL,
  reason: string,
  actor: Principal | null,
  erasedUserId: string,
): Promise<string[]> {
  const cases = await tx
    .select({ id: reviewCase.id, kind: reviewCase.kind, status: reviewCase.status, assignedTo: reviewCase.assignedToUserId, openedBy: reviewCase.openedByUserId })
    .from(reviewCase)
    .where(and(where, inArray(reviewCase.status, [...OPEN_REVIEW_CASE_STATUSES])))
    .for('update');
  if (cases.length === 0) return [];
  const now = new Date();
  const ids = cases.map((c) => c.id);
  await tx.update(reviewCase).set({ status: 'dismissed', resolutionReason: reason, resolvedAt: now, updatedAt: now }).where(inArray(reviewCase.id, ids));
  for (const c of cases) {
    await tx.insert(reviewEvent).values({
      reviewCaseId: c.id,
      action: c.kind === 'person_claim' ? 'withdraw' : 'dismiss',
      fromStatus: c.status,
      toStatus: 'dismissed',
      actorUserId: actor?.user.id ?? null,
      actorRole: actor?.user.role ?? 'system',
    });
    if (c.assignedTo && c.assignedTo !== erasedUserId) await notify(tx, c.assignedTo, 'review.updated', { caseId: c.id, change: 'withdrawn' });
    if (c.kind === 'person_claim' && c.openedBy && c.openedBy !== erasedUserId) await notify(tx, c.openedBy, 'claim.decided', { caseId: c.id, decision: 'closed' });
  }
  return ids;
}

/**
 * The relationships of the account's record that are still in flight are withdrawn, so nothing is
 * left to approve (flows-core L3): the student's own requests and claims in any state before a
 * decision (and a declined one), and requests waiting for this record as the teacher. Verified,
 * disputed and revoked relationships are the historical record and stay.
 */
async function withdrawOpenRequests(tx: Transaction, personId: string, actor: Principal | null, userId: string): Promise<{ withdrawn: number; cases: number; invitations: string[] }> {
  const rows = await tx
    .select({ id: teachingRelationship.id, status: teachingRelationship.status })
    .from(teachingRelationship)
    .where(
      or(
        and(eq(teachingRelationship.studentPersonId, personId), inArray(teachingRelationship.status, ['pending_teacher', 'awaiting_claim', 'under_review', 'rejected'])),
        and(eq(teachingRelationship.teacherPersonId, personId), eq(teachingRelationship.status, 'pending_teacher')),
      ),
    )
    .for('update');
  if (rows.length === 0) return { withdrawn: 0, cases: 0, invitations: [] };
  const ids = rows.map((r) => r.id);
  const now = new Date();
  const closed = await dismissCases(tx, inArray(reviewCase.relationshipId, ids), 'The account that made the request was erased.', actor, userId);
  const revoked = await tx
    .update(invitation)
    .set({ status: 'revoked', updatedAt: now })
    .where(and(inArray(invitation.relationshipId, ids), eq(invitation.status, 'pending')))
    .returning({ id: invitation.id });
  await tx.update(teachingRelationship).set({ status: 'withdrawn', updatedAt: now }).where(inArray(teachingRelationship.id, ids));
  await tx.insert(relationshipEvent).values(
    rows.map((r) => ({
      id: uuidv7(),
      relationshipId: r.id,
      fromStatus: r.status,
      toStatus: 'withdrawn' as const,
      actorUserId: actor?.user.id ?? null,
      actorRole: actor ? 'admin' : 'system',
      reason: 'account_erased',
    })),
  );
  return { withdrawn: rows.length, cases: closed.length, invitations: revoked.map((i) => i.id) };
}

/** The invitations the account sent or received (its address): revoked, and the address erased. Returns their ids. */
async function endInvitations(tx: Transaction, userId: string, email: string): Promise<string[]> {
  const rows = await tx
    .update(invitation)
    .set({
      status: sql`CASE WHEN ${invitation.status} = 'pending' THEN 'revoked' ELSE ${invitation.status} END`,
      email: null,
      updatedAt: new Date(),
    })
    .where(or(eq(invitation.invitedByUserId, userId), sql`lower(${invitation.email}) = ${email}`))
    .returning({ id: invitation.id });
  return rows.map((r) => r.id);
}

/** Erases the address of every delivery to the account's address and of the invitations ended above. */
async function eraseDeliveryAddresses(tx: Transaction, userId: string, email: string, invitationIds: string[]): Promise<number> {
  const keys = invitationIds.map((id) => `invitation:${id}`);
  const result = await tx.execute(sql`
    UPDATE email_delivery
       SET ${ERASE_DELIVERY_ADDRESS}
     WHERE to_email IS NOT NULL
       AND (user_id = ${userId}
            OR lower(to_email) = ${email}
            ${keys.length > 0 ? sql`OR idempotency_key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})` : sql``})`);
  return rowCount(result);
}

/**
 * The passport of the kept record (DEFAULT review-2026-11: it is the person's own account of their training,
 * not a record others rely on): certificates (row blanked and marked removed; the files go after
 * the commit), ranks, examinations, skills and attendance marked removed with their text blanked.
 * Nothing is deleted (app_rw has no DELETE here) and nothing stays readable.
 */
async function erasePassport(tx: Transaction, personId: string, files: Files): Promise<{ certificates: number; entries: number }> {
  const now = new Date();
  const removed = {
    status: 'removed' as const,
    removedAt: sql`coalesce(removed_at, ${now})`,
    removedByUserId: null,
    removalReason: sql`coalesce(removal_reason, 'The account was erased.')`,
    updatedAt: now,
  };
  const certificates = await tx
    .update(passportCertificate)
    .set({ ...removed, title: null, on: null, precision: 'unknown', sha256: ZERO_SHA })
    .where(eq(passportCertificate.personId, personId))
    .returning({ id: passportCertificate.id, storageKey: passportCertificate.storageKey });
  files.certificates.push(...certificates.map((c) => ({ id: c.id, storageKey: c.storageKey })));
  const ranks = await tx
    .update(passportRank)
    .set({ ...removed, rank: ERASED_TEXT, on: null, precision: 'unknown', organizationId: null, teacherPersonId: null, correctionNote: null, correctionAt: null })
    .where(eq(passportRank.personId, personId))
    .returning({ id: passportRank.id });
  const exams = await tx
    .update(passportExam)
    .set({ ...removed, awardedRank: ERASED_TEXT, on: null, precision: 'unknown', examinerPersonId: null, organizationId: null, teacherPersonId: null, correctionNote: null, correctionAt: null })
    .where(eq(passportExam.personId, personId))
    .returning({ id: passportExam.id });
  const skills = await tx
    .update(passportSkill)
    .set({ ...removed, name: ERASED_TEXT, on: null, precision: 'unknown', teacherPersonId: null, organizationId: null, correctionNote: null, correctionAt: null })
    .where(eq(passportSkill.personId, personId))
    .returning({ id: passportSkill.id });
  const attendance = await tx
    .update(eventAttendance)
    .set({ ...removed, teacherPersonId: null })
    .where(eq(eventAttendance.personId, personId))
    .returning({ id: eventAttendance.id });
  return { certificates: certificates.length, entries: ranks.length + exams.length + skills.length + attendance.length };
}

/**
 * The evidence the account uploaded (DEFAULT review-2026-11). A file that a relationship others verified (or a record's
 * archival edit) rests on stays, without the uploaded file's name and hash; a file nothing live
 * rests on (in no claim, or only in claims this erasure closed) is deleted, row and object. The
 * links the account made lose their notes.
 */
async function settleEvidence(tx: Transaction, userId: string, files: Files): Promise<{ deleted: number; kept: number }> {
  const now = new Date();
  const rows = await tx.execute<{ id: string; storage_key: string; retained: boolean }>(sql`
    SELECT f.id, f.storage_key,
           EXISTS (
             SELECT 1
               FROM evidence_link l
               LEFT JOIN teaching_relationship r ON r.id = l.relationship_id
               LEFT JOIN review_case c ON c.id = l.review_case_id
               LEFT JOIN teaching_relationship cr ON cr.id = c.relationship_id
              WHERE l.evidence_file_id = f.id
                AND (l.person_id IS NOT NULL
                     OR r.status IN ('verified', 'in_arbitration', 'revoked')
                     OR cr.status IN ('verified', 'in_arbitration', 'revoked'))
           ) AS retained
      FROM evidence_file f
     WHERE f.uploaded_by_user_id = ${userId} AND f.deleted_at IS NULL
       FOR UPDATE OF f`);
  const unused = rows.rows.filter((r) => !r.retained);
  if (unused.length > 0) {
    await tx.execute(sql`UPDATE evidence_file SET deleted_at = ${now}, updated_at = ${now} WHERE id IN (${sql.join(unused.map((r) => sql`${r.id}::uuid`), sql`, `)})`);
    files.evidence.push(...unused.map((r) => ({ id: r.id, storageKey: r.storage_key })));
  }
  await tx.execute(sql`UPDATE evidence_file SET original_name = NULL, original_sha256 = NULL, updated_at = ${now} WHERE uploaded_by_user_id = ${userId}`);
  await tx.update(evidenceLink).set({ note: null, updatedAt: now }).where(eq(evidenceLink.createdByUserId, userId));
  return { deleted: unused.length, kept: rows.rows.length - unused.length };
}

/**
 * The schools the account listed (M11 review, security-1; moved here from privacy.ts): each one is
 * archived and soft-deleted, off every public answer, with nothing of the Sifu's left on it (no
 * contact, website, description, private point or instructors), its photos marked removed (files
 * deleted after the commit), its open listing review dismissed and the trial inquiries sent to it
 * deleted (nobody is left to read them). The name, slug and city stay so the review history still
 * says which school a case was about. Returns the number archived.
 */
async function archiveListedSchools(tx: Transaction, userId: string, files: Files): Promise<number> {
  const listed = await tx.select({ id: school.id }).from(school).where(eq(school.createdByUserId, userId)).for('update');
  if (listed.length === 0) return 0;
  const ids = listed.map((r) => r.id);
  const now = new Date();
  files.schoolPhotos.push(
    ...(await tx
      .update(schoolPhoto)
      .set({ status: 'removed', removedAt: now, removedByUserId: null, updatedAt: now })
      .where(and(inArray(schoolPhoto.schoolId, ids), eq(schoolPhoto.status, 'active')))
      .returning({ id: schoolPhoto.id, storageKey: schoolPhoto.storageKey })),
  );
  await tx.update(schoolPhoto).set({ originalSha256: null, updatedAt: now }).where(inArray(schoolPhoto.schoolId, ids));
  await tx
    .update(reviewCase)
    .set({ status: 'dismissed', resolutionReason: 'The account that listed the school was deleted.', resolvedAt: now, updatedAt: now })
    .where(and(inArray(reviewCase.schoolId, ids), eq(reviewCase.kind, 'school_listing'), inArray(reviewCase.status, [...OPEN_REVIEW_CASE_STATUSES])));
  await tx.delete(schoolPrivateLocation).where(inArray(schoolPrivateLocation.schoolId, ids));
  await tx.delete(schoolInstructor).where(inArray(schoolInstructor.schoolId, ids));
  await tx.delete(trialInquiry).where(inArray(trialInquiry.schoolId, ids));
  // city_only: the trigger school_city_only_point puts the city centre into public_point.
  await tx
    .update(school)
    .set({
      status: 'archived',
      deletedAt: now,
      locationPrivacy: 'city_only',
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      description: null,
      createdByUserId: null,
      updatedAt: now,
    })
    .where(inArray(school.id, ids));
  return ids.length;
}

/**
 * M17 (docs/adr/0020-events.md): the events the account published as a Sifu go with it, as a
 * listing does: marked removed (404 everywhere), with nothing of the Sifu's left on them; the
 * poster files are deleted after the commit. An organization's events stay: they are the
 * organization's, and the account that published one is only cleared. Returns the number removed.
 */
async function removeOwnEvents(tx: Transaction, userId: string, files: Files): Promise<number> {
  const own = await tx
    .select({ id: event.id, posterStorageKey: event.posterStorageKey })
    .from(event)
    .where(and(eq(event.organizerUserId, userId), isNull(event.organizationId)))
    .for('update');
  if (own.length === 0) return 0;
  for (const row of own) if (row.posterStorageKey) files.posters.push({ id: row.id, storageKey: row.posterStorageKey });
  const now = new Date();
  await tx
    .update(event)
    .set({
      status: 'removed',
      removedAt: now,
      removedByUserId: null,
      removalReason: 'The organizer’s account was deleted.',
      description: null,
      venue: null,
      externalUrl: null,
      cancellationNote: null,
      organizerUserId: null,
      cancelledByUserId: null,
      posterStorageKey: null,
      posterSha256: null,
      posterWidth: null,
      posterHeight: null,
      posterSizeBytes: null,
      updatedAt: now,
    })
    .where(inArray(event.id, own.map((r) => r.id)));
  return own.length;
}

/**
 * Succession (M25): the account's live nominations, as owner or as successor, are revoked and the
 * requests waiting on them withdrawn (their cases dismissed). A nomination no request refers to is
 * deleted; one that a request refers to stays, and with it the account row as a tombstone.
 */
async function endSuccession(tx: Transaction, userId: string, actor: Principal | null): Promise<void> {
  const mine = await tx
    .select({ id: successionNomination.id })
    .from(successionNomination)
    .where(or(eq(successionNomination.ownerUserId, userId), eq(successionNomination.successorUserId, userId)))
    .for('update');
  if (mine.length === 0) return;
  const ids = mine.map((n) => n.id);
  const now = new Date();
  const pending = await tx
    .select({ id: successionRequest.id, reviewCaseId: successionRequest.reviewCaseId })
    .from(successionRequest)
    .where(and(inArray(successionRequest.nominationId, ids), eq(successionRequest.status, 'pending')));
  if (pending.length > 0) {
    await dismissCases(tx, inArray(reviewCase.id, pending.map((r) => r.reviewCaseId)), 'The account the request depends on was erased.', actor, userId);
    await tx
      .update(successionRequest)
      .set({ status: 'withdrawn', decidedAt: now, updatedAt: now })
      .where(inArray(successionRequest.id, pending.map((r) => r.id)));
  }
  await tx
    .update(successionNomination)
    .set({ status: 'revoked', revokedAt: sql`coalesce(revoked_at, ${now})`, updatedAt: now })
    .where(and(inArray(successionNomination.id, ids), inArray(successionNomination.status, ['pending', 'accepted'])));
  await tx.execute(sql`
    DELETE FROM succession_nomination n
     WHERE n.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
       AND NOT EXISTS (SELECT 1 FROM succession_request r WHERE r.nomination_id = n.id)`);
}

/** The generic step: every column of the catalogue that says delete or clear. */
async function applyCatalogue(tx: Transaction, userId: string): Promise<void> {
  for (const ref of USER_REFERENCES) {
    if (ref.action !== 'delete' && ref.action !== 'clear') continue;
    const table = sql.identifier(ref.table);
    const column = sql.identifier(ref.column);
    if (ref.action === 'delete') await tx.execute(sql`DELETE FROM ${table} WHERE ${column} = ${userId}`);
    else await tx.execute(sql`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ${userId}`);
  }
}

/** The `keep` columns that still refer to the account: when there are any, the account row stays. */
async function remainingKeepers(tx: Transaction, userId: string): Promise<string[]> {
  const left: string[] = [];
  for (const ref of USER_REFERENCES) {
    if (ref.action !== 'keep') continue;
    const found = await tx.execute(sql`SELECT 1 FROM ${sql.identifier(ref.table)} WHERE ${sql.identifier(ref.column)} = ${userId} LIMIT 1`);
    if (rowCount(found) > 0) left.push(`${ref.table}.${ref.column}`);
  }
  return left;
}

// --- The transaction ---------------------------------------------------------------------------------

async function eraseInTransaction(tx: Transaction, request: ErasureRequest, files: Files, ledger: { handle: LedgerHandle | null }): Promise<ErasureOutcome> {
  const { actor } = request;
  // 1. The global verify lock, then the account, then the deletion request (see the top of the file).
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${VERIFY_LOCK}))`);
  let userId: string;
  let deletionCaseId: string | null = null;
  if ('caseId' in request.by) {
    const found = await lockOpenDeletionCase(tx, request.by.caseId);
    userId = found.userId;
    deletionCaseId = found.id;
  } else {
    const account = await lockAccount(tx, 'userId' in request.by ? { id: request.by.userId } : { email: request.by.email });
    if (!account) throw new ServiceError('NOT_FOUND', 'No account has this address.', { email: 'No account has this e-mail address.' });
    userId = account.id;
    const [open] = await tx
      .select({ id: reviewCase.id })
      .from(reviewCase)
      .where(and(eq(reviewCase.kind, 'deletion_request'), eq(reviewCase.openedByUserId, userId), inArray(reviewCase.status, [...OPEN_REVIEW_CASE_STATUSES])))
      .for('update');
    deletionCaseId = open?.id ?? null;
  }
  if (actor) await requireStandingAdmin(tx, actor);
  const [account] = await tx.select({ id: authUser.id, email: authUser.email, role: authUser.role }).from(authUser).where(eq(authUser.id, userId));
  if (!account) throw new ServiceError('NOT_FOUND', 'No account has this address.', { email: 'No account has this e-mail address.' });
  if (actor && account.id === actor.user.id) throw new ServiceError('FORBIDDEN', 'Another administrator erases your own account.');
  if (isErasedEmail(account.email)) throw new ServiceError('CONFLICT', 'This account was erased already.');
  // DEFAULT review-2026-11: a staff account is not erased: its role is taken away first (roles.ts), so
  // the last administrator and the moderators' own records cannot vanish with an erasure.
  if (account.role !== 'user') throw new ServiceError('CONFLICT', 'This account has a staff role. Take the role away first, then erase the account.');
  const email = account.email.toLowerCase();
  const counts = emptyCounts();
  const now = new Date();
  // Every refusal is behind us. The ledger line goes down BEFORE the first change, inside this
  // transaction: when it cannot be written the erasure is refused and nothing changes, because an
  // erasure that no restore can repeat is worse than a delayed one (src/server/erasure-ledger.ts).
  if (!request.skipLedger) ledger.handle = await beginLedger('account.erase', userId);

  // 2. The profile: the account's own record.
  const [own] = await tx
    .select({ id: person.id, visibility: person.visibility, takenDownAt: person.takenDownAt, takenDownVisibility: person.takenDownVisibility })
    .from(person)
    .where(eq(person.claimedByUserId, userId))
    .for('update');
  let visibility: ErasureOutcome['visibility'] = null;
  const tags: string[] = [SCHOOLS_TAG, EVENTS_TAG, ORGANIZATIONS_TAG];
  let invitationIds: string[] = [];
  if (own) {
    await lockStudentRequests(tx, own.id);
    tags.push(...(await neighbourTags(tx, own.id, { ancestors: true })));
    // The requests and claims still in flight are withdrawn before anything else (flows-core L3).
    const withdrawn = await withdrawOpenRequests(tx, own.id, actor, userId);
    counts.requestsWithdrawn = withdrawn.withdrawn;
    counts.casesDismissed += withdrawn.cases;
    invitationIds.push(...withdrawn.invitations);
    counts.namesRemoved = rowCount(await tx.delete(personName).where(and(eq(personName.personId, own.id), eq(personName.isPrimary, false))));
    counts.biosRemoved = rowCount(await tx.delete(personBio).where(eq(personBio.personId, own.id)));
    // M14/M16: every photo of the gallery, the profile photo among them: marked removed, files deleted
    // after the commit; no row keeps the hash of the file the account uploaded.
    const photos = await tx
      .update(personPhoto)
      .set({ status: 'removed', removedAt: now, removedByUserId: null, updatedAt: now })
      .where(and(eq(personPhoto.personId, own.id), inArray(personPhoto.status, [...GALLERY_PHOTO_STATUSES])))
      .returning({ id: personPhoto.id, storageKey: personPhoto.storageKey });
    files.photos.push(...photos);
    counts.photosRemoved = photos.length;
    await tx.update(personPhoto).set({ originalSha256: null, updatedAt: now }).where(eq(personPhoto.personId, own.id));
    // DEFAULT review-2026-11: the text of the record's archival revisions (a name or biography as it was before a
    // correction) goes with the person; who, when, which fields and the reason stay (docs/plan/questions/review-2026-11-retention.md, Q2).
    const redacted = await tx.execute(sql`SELECT redact_person_revisions(${own.id}::uuid) AS n`);
    counts.revisionsRedacted = Number((redacted.rows[0] as { n?: number } | undefined)?.n ?? 0);
    // The links of the person to organizations, schools and events, and the organizations' unverified claims.
    await tx.delete(organizationMembership).where(eq(organizationMembership.personId, own.id));
    await tx.delete(schoolInstructor).where(eq(schoolInstructor.personId, own.id));
    await tx.delete(eventInstructor).where(eq(eventInstructor.personId, own.id));
    await tx
      .update(organizationTeacherClaim)
      .set({ status: 'withdrawn', withdrawnAt: now, withdrawnByUserId: null, withdrawReason: 'separation', updatedAt: now })
      .where(and(or(eq(organizationTeacherClaim.studentPersonId, own.id), eq(organizationTeacherClaim.teacherPersonId, own.id)), eq(organizationTeacherClaim.status, 'claimed_by_organization')));
    const passport = await erasePassport(tx, own.id, files);
    counts.certificatesRemoved = passport.certificates;
    counts.passportEntriesRemoved = passport.entries;
    const [verified] = await tx
      .select({ id: teachingRelationship.id })
      .from(teachingRelationship)
      .where(
        and(
          eq(teachingRelationship.status, 'verified'),
          or(eq(teachingRelationship.teacherPersonId, own.id), eq(teachingRelationship.studentPersonId, own.id)),
        ),
      )
      .limit(1);
    // DEFAULT D03 and the M07 default: public only when it was public and a relationship others verified remains.
    // A record staff took down stays held (restore puts it back to this); its visibility column stays hidden.
    const held = own.takenDownAt !== null;
    const wasPublic = (held ? own.takenDownVisibility : own.visibility) === 'public';
    const next: 'public' | 'involved_only' = wasPublic && verified ? 'public' : 'involved_only';
    visibility = held ? 'involved_only' : next;
    await tx
      .update(person)
      .set({
        claimedByUserId: null,
        stewardship: 'unclaimed',
        ...(held ? { takenDownVisibility: next } : { visibility: next }),
        placeId: null,
        trainingStartYear: null,
        // DEFAULT review-2026-11: the country and the birth date go too (never public, D16).
        countryCode: null,
        birthDate: null,
        photoId: null,
        updatedAt: now,
      })
      .where(eq(person.id, own.id));
    // A profile that stops being public takes its edges out of v_public_edge (M11 review, code-2).
    if (!held && next !== own.visibility) await queueRecomputeForPerson(tx, own.id);
  }

  // 3. What the account made or holds apart from the profile.
  counts.schoolsArchived = await archiveListedSchools(tx, userId, files);
  counts.eventsRemoved = await removeOwnEvents(tx, userId, files);
  const ownCases = await dismissCases(
    tx,
    and(eq(reviewCase.openedByUserId, userId), inArray(reviewCase.kind, [...OWN_CASE_KINDS]))!,
    'The account that opened this case was erased.',
    actor,
    userId,
  );
  counts.casesDismissed += ownCases.length;
  invitationIds.push(...(await endInvitations(tx, userId, email)));
  invitationIds = [...new Set(invitationIds)];
  counts.invitationsRevoked = invitationIds.length;
  counts.deliveriesErased = await eraseDeliveryAddresses(tx, userId, email, invitationIds);
  const evidence = await settleEvidence(tx, userId, files);
  counts.evidenceDeleted = evidence.deleted;
  counts.evidenceKept = evidence.kept;
  await tx.update(reviewNote).set({ body: NOTE_REMOVED, updatedAt: now }).where(eq(reviewNote.authorUserId, userId));
  // DEFAULT review-2026-11: the authority rows are revoked, not deleted (who held authority stays on record, which
  // keeps the account row as a tombstone); an organization left without an administrator is not blocked.
  await tx.update(organizationAdmin).set({ revokedAt: now, updatedAt: now }).where(and(eq(organizationAdmin.userId, userId), isNull(organizationAdmin.revokedAt)));
  await endSuccession(tx, userId, actor);
  const consents = await tx.execute(sql`SELECT count(*)::int AS n FROM consent_record WHERE user_id = ${userId}`);
  counts.consentsRemoved = Number((consents.rows[0] as { n?: number } | undefined)?.n ?? 0);
  // The short-lived values of the account (reset tokens, the second-factor challenge, trusted devices) hold
  // its id as their value, the way the auth_user_end_sessions trigger finds them; the identifier is hashed.
  await tx.execute(sql`DELETE FROM auth_verification WHERE value = ${userId}`);

  // 4. The deletion request is closed; the audit row; then every reference of the catalogue.
  if (deletionCaseId) {
    await tx
      .update(reviewCase)
      .set({ status: 'resolved', resolution: 'approved', resolutionReason: request.caseNote ?? 'Carried out by an administrator.', resolvedAt: now, updatedAt: now })
      .where(eq(reviewCase.id, deletionCaseId));
  }
  await applyCatalogue(tx, userId);

  // 5. The account row: deleted, or a tombstone while a record that must stay refers to it.
  const keepers = await remainingKeepers(tx, userId);
  let tombstone = keepers.length > 0;
  if (!tombstone) {
    await tx.execute(sql`SAVEPOINT erase_account`);
    try {
      await tx.delete(authUser).where(eq(authUser.id, userId));
      await tx.execute(sql`RELEASE SAVEPOINT erase_account`);
    } catch (error) {
      // Something the catalogue calls delete or clear is still referenced: only a RESTRICT does this,
      // and the tombstone is safe (it holds nothing of the person), so the erasure goes on.
      if (!isReferencedRowError(error)) throw error;
      await tx.execute(sql`ROLLBACK TO SAVEPOINT erase_account`);
      tombstone = true;
    }
  }
  if (tombstone) {
    await tx
      .update(authUser)
      .set({
        name: '',
        email: erasedEmail(userId),
        emailVerified: false,
        image: null,
        role: 'user',
        banned: true,
        banReason: 'Account erased',
        banExpires: null,
        twoFactorEnabled: false,
        timezone: null,
        accountType: 'student',
        lastActiveAt: null,
        updatedAt: now,
      })
      .where(eq(authUser.id, userId));
  }
  await writeAudit(tx, {
    action: 'account.delete',
    actorUserId: actor?.user.id ?? null,
    actorRole: actor?.user.role ?? null,
    subjectType: deletionCaseId ? 'review_case' : 'user',
    subjectId: deletionCaseId ?? userId,
    before: { userId, personId: own?.id ?? null, visibility: own?.visibility ?? null },
    after: {
      personId: own?.id ?? null,
      stewardship: own ? 'unclaimed' : null,
      visibility,
      tombstone,
      ...(tombstone ? { keptBy: keepers } : {}),
      ...counts,
    },
    reason: request.reason,
    requestId: request.meta?.requestId,
    ipHmac: request.meta?.ipHmac,
  });
  return { userId, caseId: deletionCaseId, personId: own?.id ?? null, visibility, tombstone, counts, tags: [...new Set(tags)] };
}

/**
 * A paid subscription ends at the provider before the account goes (its rows go with the account), and
 * if the provider does not answer the erasure is refused with nothing changed. The call can take
 * seconds (10 s, billing/stripe.ts), so it runs before any lock is taken: under the global verify lock
 * an approval would wait for it and be cancelled by the pool's 2 s statement timeout. The account is
 * looked up without a lock and only when it is plainly erasable; the transaction checks everything again
 * under the locks, so a refusal there (a race) can leave a subscription ended for an account that stays.
 */
async function endSubscriptionsFirst(request: ErasureRequest): Promise<void> {
  const db = getDb();
  if (request.actor) {
    const actor = request.actor;
    await db.transaction((tx) => requireStandingAdmin(tx, actor));
  }
  let userId: string | null = null;
  // A malformed id is for the transaction to refuse, with its message.
  if ('caseId' in request.by && !z.uuid().safeParse(request.by.caseId).success) return;
  if ('userId' in request.by && !z.uuid().safeParse(request.by.userId).success) return;
  if ('caseId' in request.by) {
    const [open] = await db
      .select({ userId: reviewCase.openedByUserId })
      .from(reviewCase)
      .where(and(eq(reviewCase.id, request.by.caseId), eq(reviewCase.kind, 'deletion_request'), inArray(reviewCase.status, [...OPEN_REVIEW_CASE_STATUSES])));
    userId = open?.userId ?? null;
  } else if ('userId' in request.by) {
    userId = request.by.userId;
  } else {
    const [found] = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, request.by.email.trim().toLowerCase()));
    userId = found?.id ?? null;
  }
  if (!userId) return;
  const [account] = await db.select({ email: authUser.email, role: authUser.role }).from(authUser).where(eq(authUser.id, userId));
  if (!account || account.role !== 'user' || isErasedEmail(account.email) || userId === request.actor?.user.id) return;
  await endSubscriptionsBeforeDeletion(db, userId);
}

/** The files that no row refers to any more, deleted after the commit (best effort; the rows say what was there). */
async function deleteFiles(files: Files, evidenceStore: ObjectStore): Promise<void> {
  await deletePhotoFiles([...files.photos, ...files.schoolPhotos, ...files.posters]);
  for (const c of files.certificates) await deleteCertificateFiles(evidenceStore, c.storageKey, c.id);
  for (const e of files.evidence) {
    await evidenceStore.delete(e.storageKey).catch(() => {
      logger().error(`[erasure] the stored object of evidence file ${e.id} could not be removed`);
    });
  }
}

/**
 * Erases an account (see the top of the file). The caller checks who may (the procedure: an
 * administrator with a verified second factor; the command line: the machine). The callers that run
 * in the web process drop the public cache with `outcome.tags`.
 */
export async function eraseAccount(request: ErasureRequest, evidenceStore: ObjectStore = getEvidenceStore()): Promise<ErasureOutcome> {
  await endSubscriptionsFirst(request);
  const files: Files = { photos: [], schoolPhotos: [], posters: [], certificates: [], evidence: [] };
  const ledger: { handle: LedgerHandle | null } = { handle: null };
  let outcome: ErasureOutcome;
  try {
    outcome = await getDb().transaction((tx) => eraseInTransaction(tx, request, files, ledger));
  } catch (error) {
    // A refusal rolled the transaction back for certain: say so, so that a restore does not repeat it. Any other
    // failure (a lost connection can hide a commit) leaves the line unconfirmed, and replay asks before it repeats it.
    if (isServiceError(error)) await ledger.handle?.aborted();
    throw error;
  }
  await ledger.handle?.done();
  await deleteFiles(files, evidenceStore);
  return outcome;
}

// --- accounts.erase ----------------------------------------------------------------------------------

export const eraseInput = z
  .object({
    ...accountRef,
    /** An open deletion request, which this closes. */
    caseId: z.uuid({ error: 'That is not the id of a case.' }).nullish().transform((v) => v ?? null),
    reason: reasonText('Write the reason for the erasure.'),
    /** The administrator confirms that an erasure cannot be undone. */
    confirm: z.literal(true, { error: 'Confirm that the account is erased for good.' }),
  })
  .superRefine((input, ctx) => {
    const given = [input.caseId, input.userId, input.email].filter((v) => v !== null).length;
    if (given !== 1) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Give the e-mail address of the account, or the deletion request.' });
  });
export type EraseInput = z.input<typeof eraseInput>;

export interface ErasureResult {
  userId: string;
  /** The deletion request that was closed, or null. */
  caseId: string | null;
  /** The profile that stays as an unclaimed record, or null. */
  personId: string | null;
  visibility: 'public' | 'involved_only' | null;
  /** Whether the account row stays as a nameless tombstone. */
  tombstone: boolean;
  /** Pending relationship requests withdrawn so that nobody can approve them. */
  requestsWithdrawn: number;
}

/**
 * accounts.erase: an administrator (verified second factor) erases an account, with a reason that
 * goes to the audit log. The account is chosen by its address, its id or its open deletion request.
 * Not your own account; not an account with a staff role.
 */
export async function eraseAccountAsAdmin(principal: Principal | null, raw: EraseInput, meta: RequestMeta, evidenceStore: ObjectStore = getEvidenceStore()): Promise<ErasureResult> {
  const actor = requireStaff2FA(principal, ['admin']);
  const input = parseOrThrow(eraseInput, raw);
  const by = input.caseId ? { caseId: input.caseId } : input.userId ? { userId: input.userId } : { email: input.email! };
  const outcome = await eraseAccount({ actor, by, reason: input.reason, meta }, evidenceStore);
  // The person and the lineages around it, the schools, events and organizations (as after a profile save).
  invalidatePublic(outcome.tags, 'procedure');
  return {
    userId: outcome.userId,
    caseId: outcome.caseId,
    personId: outcome.personId,
    visibility: outcome.visibility,
    tombstone: outcome.tombstone,
    requestsWithdrawn: outcome.counts.requestsWithdrawn,
  };
}
