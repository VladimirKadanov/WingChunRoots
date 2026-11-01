// The audit log (plan §6.6): append-only rows of who did what to which object, with the request
// id and ip_hmac, never a raw IP address, a name or an e-mail address (plan §6.4). Services write
// it in the transaction of the change they audit.

import { auditLog } from '../db/schema';
import type { Database } from '../db';
import { uuidv7 } from '../db/ids';
import type { Transaction } from '../jobs/outbox';

/** The actions of M02, M07, M08, M09, M10a and M11; later milestones add theirs (plan §6.6). */
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
  | 'review.reply';

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
