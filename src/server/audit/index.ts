// The audit log (plan §6.6): append-only rows of who did what to which object, with the request
// id and ip_hmac, never a raw IP address, a name or an e-mail address (plan §6.4). Services write
// it in the transaction of the change they audit.

import { auditLog } from '../db/schema';
import type { Database } from '../db';
import { uuidv7 } from '../db/ids';
import type { Transaction } from '../jobs/outbox';

/** The actions of M02, M07, M08, M09, M10a, M11, M14, M15 and later milestones (plan §6.6). */
export type AuditAction =
  | 'role.change'
  | 'consent.grant'
  | 'auth.2fa.enable'
  | 'person.create'
  // M08: plans (plan §6.5, §6.6).
  | 'grant.create'
  | 'grant.revoke'
  | 'account.type_change'
  | 'pilot_access.request'
  | 'pilot_access.close'
  // M07: profiles, consents and account deletion (plan §6.6).
  | 'person.update'
  | 'consent.withdraw'
  | 'account.deletion_request'
  // pnpm account:delete (M07, until the review tool of M10a).
  | 'account.delete'
  | 'account.deletion_cancel'
  // M09: teacher requests and their answers (plan §6.6, §6.7).
  | 'relationship.request'
  | 'relationship.resubmit'
  | 'relationship.approve'
  | 'relationship.reject'
  | 'relationship.withdraw'
  | 'relationship.end'
  // M10a: evidence, historical teachers, the review queue and archival edits (plan §6.6).
  | 'evidence.upload'
  | 'evidence.view'
  | 'evidence.discard'
  | 'relationship.verify'
  | 'review.assign'
  | 'review.needs_info'
  | 'review.note'
  | 'review.resolve'
  // M11: schools (plan §6.6). The rows name the fields that changed, never a point or a contact.
  | 'school.create'
  | 'school.update'
  | 'school.submit'
  | 'school.confirm'
  | 'school.publish'
  | 'school.return'
  // M20: the activity check (docs/adr/0023-school-activity.md): the daily job's stages, by the
  // system (no actor). The rows carry the stage and the dates, never a name or a point.
  | 'school.activity_awaiting'
  | 'school.activity_hidden'
  // M21 (docs/adr/0024-trial-lessons.md): the schedule and fees of a listing (the fields that
  // changed), and the trial lesson inquiries (ids and states only, never a name, a contact or a message).
  | 'school.schedule_update'
  | 'trial.request'
  | 'trial.answer'
  | 'trial.decline'
  | 'trial.close'
  // M10b: invitations, profile claims, instructor verification, reports and arbitration (plan §6.6, §6.7).
  | 'invitation.create'
  | 'invitation.revoke'
  | 'person.claim'
  | 'relationship.claimed'
  | 'instructor.request'
  | 'instructor.verify'
  | 'report.create'
  | 'relationship.arbitration'
  | 'relationship.revoke'
  | 'review.reply'
  // M14: profile photos (docs/adr/0016-profile-photos.md). The rows carry photo ids, sizes and
  // hashes, never a storage key or a file name; a staff removal keeps its reason.
  | 'photo.upload'
  | 'photo.remove'
  // M16: galleries (docs/adr/0019-galleries.md): a person's gallery and a school's logo and room photos.
  | 'gallery.add'
  | 'gallery.remove'
  | 'gallery.update'
  | 'gallery.reorder'
  | 'gallery.profile'
  | 'school_photo.upload'
  | 'school_photo.remove'
  | 'school_photo.update'
  | 'school_photo.reorder'
  // M15: organizations (docs/adr/0018-organizations.md). The rows carry ids, statuses and the names
  // of the fields that changed, never a leader's name, a website or an e-mail address.
  | 'organization.apply'
  | 'organization.update'
  | 'organization.approve'
  | 'organization.reject'
  | 'organization.admin_add'
  | 'organization.admin_remove'
  | 'organization.member_add'
  | 'organization.member_end'
  | 'organization.school_request'
  | 'organization.school_answer'
  | 'organization.school_end'
  // M17: events (docs/adr/0020-events.md). The rows carry ids, the kind, the month and the fields
  // that changed, never a title, a description or a storage key; a staff removal keeps its reason.
  | 'event.create'
  | 'event.update'
  | 'event.cancel'
  | 'event.remove'
  | 'event.poster_upload'
  | 'event.poster_remove'
  // M19: the training passport (docs/adr/0022-passport.md). The rows carry ids, the kind, the
  // visibility and the names of the fields that changed, never a rank, a title, a correction or a
  // storage key; a staff removal keeps its reason.
  | 'passport.add'
  | 'passport.update'
  | 'passport.correction'
  | 'passport.withdraw'
  | 'passport.visibility'
  | 'passport.certificate_upload'
  | 'passport.certificate_remove'
  | 'passport.attendance'
  | 'passport.remove'
  // M22: billing in test mode (docs/adr/0025-billing.md). The rows carry ids, the plan, the
  // provider, states and dates, never a card detail, an amount a customer typed or an address.
  | 'billing.checkout'
  | 'billing.cancel'
  | 'billing.resume'
  | 'billing.subscription'
  | 'billing.grace_end'
  | 'billing.test_clock'
  // M25: governance (docs/adr/0028-governance.md). The rows carry ids, states, the basis and the
  // number of days without activity, never a name, a reason of a party or a file name.
  | 'succession.nominate'
  | 'succession.answer'
  | 'succession.revoke'
  | 'succession.request'
  | 'succession.transfer'
  | 'succession.decide'
  | 'dispute.report'
  | 'dispute.decide'
  | 'appeal.create'
  | 'appeal.decide'
  | 'record.propose'
  | 'record.decide';

export interface AuditEntry {
  action: AuditAction;
  actorUserId: string | null;
  actorRole: string | null;
  subjectType: string;
  subjectId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  /**
   * The evidence files the change relied on (plan §6.6: the person.update of an archival edit keeps
   * `reason` and `evidence_ids`), kept in the uuid[] column audit_log.evidence_ids; none is NULL.
   */
  evidenceIds?: readonly string[] | null;
  /** From the X-Request-Id header when a proxy sets one; otherwise a new id. */
  requestId?: string | null;
  ipHmac?: string | null;
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** A request id for the audit log: a well-formed X-Request-Id, or a new UUIDv7. */
export function requestIdFrom(headers: Headers | null | undefined): string {
  const given = headers?.get('x-request-id')?.trim();
  return given && REQUEST_ID.test(given) ? given : uuidv7();
}

export async function writeAudit(db: Database | Transaction, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    action: entry.action,
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    evidenceIds: entry.evidenceIds && entry.evidenceIds.length > 0 ? [...new Set(entry.evidenceIds)] : null,
    requestId: entry.requestId ?? uuidv7(),
    ipHmac: entry.ipHmac ?? null,
  });
}
