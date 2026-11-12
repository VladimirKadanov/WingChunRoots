// What a separation removes (milestone M24; specification §10.3, §16.1; docs/adr/0027-organization-tools.md):
// the shared step of every end of a membership, whichever side ends it (organizations.endMember,
// organizationTools.leave). Imported only by the services; it imports nothing of them, so
// organizations.ts and organization-separation.ts can both call it.
//
// DEFAULT M24 question 9, what goes: the organization's own fields of the member (rank and city,
// organization_member_record) are deleted, and the organization's open teacher claims about the
// person, as the student or as the teacher, are withdrawn (reason 'separation'). What stays: the membership row itself, with its end
// (history), the person record, every teaching relationship and its verification (DEFAULT D12:
// nothing here touches teaching_relationship), the person's visibility, and every plan and
// subscription of the person's own (specification §10.3).

import { and, eq, or, sql } from 'drizzle-orm';

import { isoDay } from '../../lib/dates';

import { organizationMemberRecord, organizationTeacherClaim } from '../db/schema';
import type { Executor } from '../entitlements/access';
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
        // The claims about the person, as the student or as the teacher: a former member is no
        // longer the organization's to state anything about.
        or(eq(organizationTeacherClaim.studentPersonId, m.personId), eq(organizationTeacherClaim.teacherPersonId, m.personId)),
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

/**
 * Of `ids`, the people a reader may see by name in the organization tools: a public profile
 * (v_public_person), or, when `organizationId` is given, a current member of that organization
 * (its own records, private ones included). Anyone else (a profile that became private, a member
 * who left) is shown without a name, so a claim never keeps a private person readable.
 */
export async function shownPeople(tx: Executor, ids: readonly string[], organizationId: string | null): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const list = sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
  const today = isoDay(new Date());
  const members = organizationId
    ? sql`
    UNION
    SELECT m.person_id FROM organization_membership m
      JOIN person p ON p.id = m.person_id AND p.deleted_at IS NULL
     WHERE m.organization_id = ${organizationId}::uuid AND m.person_id = ANY (${list})
       AND (m.starts_on IS NULL OR m.starts_on <= ${today}::date)
       AND (m.ends_on IS NULL OR (m.ends_on > ${today}::date AND (m.starts_on IS NULL OR m.ends_on > m.starts_on)))`
    : sql``;
  const rows = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM (SELECT v.id AS id FROM v_public_person v WHERE v.id = ANY (${list})${members}) shown`);
  return new Set(rows.rows.map((r) => r.id));
}
