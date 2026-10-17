// The audit log (plan §6.6): append-only rows of who did what to which object, with the request
// id and ip_hmac, never a raw IP address, a name or an e-mail address (plan §6.4). Services write
// it in the transaction of the change they audit.

import { auditLog } from '../db/schema';
import type { Database } from '../db';
import { uuidv7 } from '../db/ids';
import type { Transaction } from '../jobs/outbox';

/** The actions of M02; later milestones add theirs (plan §6.6). */
export type AuditAction = 'role.change' | 'consent.grant' | 'auth.2fa.enable' | 'person.create';

export interface AuditEntry {
  action: AuditAction;
  actorUserId: string | null;
  actorRole: string | null;
  subjectType: string;
  subjectId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
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
    requestId: entry.requestId ?? uuidv7(),
    ipHmac: entry.ipHmac ?? null,
  });
}
