// What a separation removes (milestone M24; specification §10.3, §16.1; docs/adr/0027-organization-tools.md):
// the shared step of every end of a membership, whichever side ends it (organizations.endMember,
// organizationTools.leave). Imported only by the services; it imports nothing of them, so
// organizations.ts and organization-separation.ts can both call it.
//
// DEFAULT M24 question 9, what goes: the organization's own fields of the member (rank and city,
// organization_member_record) are deleted, and the organization's open teacher claims about the
// person are withdrawn (reason 'separation'). What stays: the membership row itself, with its end
// (history), the person record, every teaching relationship and its verification (DEFAULT D12:
// nothing here touches teaching_relationship), the person's visibility, and every plan and
// subscription of the person's own (specification §10.3).

import { and, eq, sql } from 'drizzle-orm';

import { organizationMemberRecord, organizationTeacherClaim } from '../db/schema';
import type { Transaction } from '../jobs/outbox';

export interface SeparationResult {
  /** Whether organization-managed fields were deleted. */
  fieldsRemoved: boolean;
  /** How many of the organization's claims about the person were withdrawn. */
  claimsWithdrawn: number;
}

export async function separateMembership(
  tx: Transaction,
  m: { membershipId: string; organizationId: string; personId: string; actorUserId: string },
): Promise<SeparationResult> {
  const removed = await tx.delete(organizationMemberRecord).where(eq(organizationMemberRecord.membershipId, m.membershipId)).returning({ id: organizationMemberRecord.id });
  const now = new Date();
  const withdrawn = await tx
    .update(organizationTeacherClaim)
    .set({ status: 'withdrawn', withdrawnAt: now, withdrawnByUserId: m.actorUserId, withdrawReason: 'separation', updatedAt: now })
    .where(
      and(
        eq(organizationTeacherClaim.organizationId, m.organizationId),
        eq(organizationTeacherClaim.studentPersonId, m.personId),
        eq(organizationTeacherClaim.status, 'claimed_by_organization'),
      ),
    )
    .returning({ id: organizationTeacherClaim.id });
  return { fieldsRemoved: removed.length > 0, claimsWithdrawn: withdrawn.length };
}

/** The account that holds a person's record (its own claimed profile), or null for a record without one. */
export async function accountOfPerson(tx: Transaction, personId: string): Promise<string | null> {
  const rows = await tx.execute<{ id: string | null }>(sql`SELECT claimed_by_user_id::text AS id FROM person WHERE id = ${personId}::uuid AND deleted_at IS NULL`);
  return rows.rows[0]?.id ?? null;
}
