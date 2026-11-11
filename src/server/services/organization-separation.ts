// Organization separation (milestone M24; specification §10.3, §16.1; execution plan, Phase 3
// "Organization separation rules"; docs/adr/0027-organization-tools.md).
//
//   organizationTools.memberships   the signed-in account's own memberships (its own person
//                                   record), with what each organization records about it
//   organizationTools.leave         the account ends its own membership today
//   organizationTools.claims        an organization's teacher claims (its admins)
//   organizationTools.withdrawClaim an admin withdraws one of the organization's claims
//
// The rules (DEFAULT M24 questions 9 and 10; SEPARATION_RULES below, shown on the pages):
// - Who decides: either side, alone. A member leaves without the organization's approval; the
//   organization ends a membership without the member's (organizations.endMember); a school's
//   account ends its link and the organization ends it from its side (organizations.endSchoolLink).
//   Nobody else approves a separation: an affiliation is never a teaching relationship (DEFAULT D12).
// - What goes: the affiliation (the membership gets its end; a school link becomes `ended`), the
//   organization's own fields of the member (rank, city) and its open teacher claims about the
//   person (separation-core.ts).
// - What stays: the membership row as history, the person record, every teaching relationship and
//   its verification, the lineage, the school and its pin, and every plan or subscription of the
//   person's or the school's own (specification §10.3: no financial status is transferred).
// - Who is told: the other side, in the dashboard (organization.member_left to the admins,
//   organization.membership_ended to the member's account, organization.school_answered "ended").
//
// Authorization: a member leaves only its own membership (404 for any other); the claims are read
// and withdrawn only by the admins of their organization (404 for another organization's).

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { isoDay } from '../../lib/dates';
import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { organization, organizationMemberRecord, organizationMembership, organizationTeacherClaim, person } from '../db/schema';
import type { ORGANIZATION_CLAIM_STATUSES } from '../db/schema/organization-tools';
import type { RequestMeta } from './context';
import { peopleRefs, type PersonRef } from './dashboard';
import { ServiceError } from './errors';
import { separateMembership } from './organization-separation-core';
import { managed, MEMBER_ROLE_LABELS, membershipHasEnded, membershipIsCurrent, ORGANIZATION_KIND_LABELS, organizationRow, tellAdmins } from './organizations';
import { ORGANIZATIONS_TAG, invalidatePublic } from '../cache';

export type ClaimStatus = (typeof ORGANIZATION_CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  claimed_by_organization: 'Claimed by the organization, not verified',
  withdrawn: 'Withdrawn',
};

/** The separation rules in words, for the dashboard pages and the API (DEFAULT M24 question 9). */
export const SEPARATION_RULES = {
  decides: 'Either side decides alone: a member can leave, and an organization can end a membership or a school link, without the other’s approval.',
  goes: 'The affiliation ends, and the organization’s rank and city for the member and its teacher claims about the person are removed.',
  stays: 'The membership stays in the organization’s history. The person’s profile, teachers, students and verified relationships, the school and its pin, and every plan of their own stay as they are.',
  told: 'The other side is told in their dashboard.',
} as const;

const NO_MEMBERSHIP = 'No such membership.';
const NO_CLAIM = 'No such claim.';

export const leaveInput = z.object({ membershipId: z.uuid({ error: NO_MEMBERSHIP }) });
export const claimsInput = z.object({ organizationId: z.uuid({ error: 'No such organization.' }) });
export const withdrawClaimInput = z.object({ organizationId: z.uuid({ error: 'No such organization.' }), claimId: z.uuid({ error: NO_CLAIM }) });

function parseIds<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const field = String(parsed.error.issues[0]?.path[0] ?? '');
  throw new ServiceError('NOT_FOUND', field === 'claimId' ? NO_CLAIM : field === 'membershipId' ? NO_MEMBERSHIP : 'No such organization.');
}

// --- organizationTools.memberships ---------------------------------------------------------------

export interface MyMembership {
  id: string;
  organization: { name: string; slug: string; kindLabel: string; public: boolean };
  roleLabel: string;
  startsOn: string | null;
  endsOn: string | null;
  current: boolean;
  /** What the organization records about the member (its own fields; never public, never verified). */
  recorded: { rank: string | null; city: string | null } | null;
  /** The organization's open teacher claims about the member. */
  claims: { id: string; teacher: PersonRef | null; startYear: number | null; statusLabel: string }[];
}

export async function myMemberships(principal: Principal | null): Promise<{ memberships: MyMembership[]; rules: typeof SEPARATION_RULES }> {
  const p = requireUser(principal);
  const db = getDb();
  const [own] = await db.select({ id: person.id }).from(person).where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
  if (!own) return { memberships: [], rules: SEPARATION_RULES };
  const rows = await db
    .select({
      id: organizationMembership.id,
      organizationId: organization.id,
      role: organizationMembership.role,
      startsOn: organizationMembership.startsOn,
      endsOn: organizationMembership.endsOn,
      name: organization.name,
      slug: organization.slug,
      kind: organization.kind,
      status: organization.status,
      rank: organizationMemberRecord.rankLabel,
      city: organizationMemberRecord.schoolCity,
      recordId: organizationMemberRecord.id,
    })
    .from(organizationMembership)
    .innerJoin(organization, and(eq(organization.id, organizationMembership.organizationId), isNull(organization.deletedAt)))
    .leftJoin(organizationMemberRecord, eq(organizationMemberRecord.membershipId, organizationMembership.id))
    .where(eq(organizationMembership.personId, own.id))
    .orderBy(sql`(${organizationMembership.endsOn} IS NOT NULL)`, asc(organization.name));
  const claims = await db
    .select({ id: organizationTeacherClaim.id, organizationId: organizationTeacherClaim.organizationId, teacherId: organizationTeacherClaim.teacherPersonId, startYear: organizationTeacherClaim.startYear, status: organizationTeacherClaim.status })
    .from(organizationTeacherClaim)
    .where(and(eq(organizationTeacherClaim.studentPersonId, own.id), eq(organizationTeacherClaim.status, 'claimed_by_organization')));
  const refs = await peopleRefs([...new Set(claims.map((c) => c.teacherId))]);
  const today = isoDay(new Date());
  return {
    rules: SEPARATION_RULES,
    memberships: rows.map((r) => ({
      id: r.id,
      organization: { name: r.name, slug: r.slug, kindLabel: ORGANIZATION_KIND_LABELS[r.kind], public: r.status === 'active' },
      roleLabel: MEMBER_ROLE_LABELS[r.role],
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      current: membershipIsCurrent(r, today),
      recorded: r.recordId ? { rank: r.rank, city: r.city } : null,
      claims: claims
        .filter((c) => c.organizationId === r.organizationId)
        .map((c) => ({ id: c.id, teacher: refs.get(c.teacherId) ?? null, startYear: c.startYear, statusLabel: CLAIM_STATUS_LABELS[c.status] })),
    })),
  };
}

// --- organizationTools.leave ----------------------------------------------------------------------

/**
 * The account ends its own membership today (its own person record only). No approval and no plan
 * is needed (DEFAULT M24 question 9): leaving is always possible, whatever the organization's state.
 */
export async function leaveOrganization(principal: Principal | null, raw: z.input<typeof leaveInput>, meta: RequestMeta): Promise<{ membershipId: string; endsOn: string }> {
  const p = requireUser(principal);
  const input = parseIds(leaveInput, raw);
  const out = await getDb().transaction(async (tx) => {
    const [seen] = await tx
      .select({ organizationId: organizationMembership.organizationId })
      .from(organizationMembership)
      .innerJoin(person, eq(person.id, organizationMembership.personId))
      .where(and(eq(organizationMembership.id, input.membershipId), eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
    if (!seen) throw new ServiceError('NOT_FOUND', NO_MEMBERSHIP);
    // The organization first (the lock order of every organization write), then the membership.
    const org = await organizationRow(tx, seen.organizationId, true);
    if (!org) throw new ServiceError('NOT_FOUND', NO_MEMBERSHIP);
    const [row] = await tx
      .select({ id: organizationMembership.id, personId: organizationMembership.personId, startsOn: organizationMembership.startsOn, endsOn: organizationMembership.endsOn })
      .from(organizationMembership)
      .where(eq(organizationMembership.id, input.membershipId))
      .for('update');
    if (!row) throw new ServiceError('NOT_FOUND', NO_MEMBERSHIP);
    const today = isoDay(new Date());
    if (membershipHasEnded(row, today)) throw new ServiceError('CONFLICT', 'This membership has ended already.');
    const endsOn = row.startsOn !== null && row.startsOn > today ? row.startsOn : today;
    await tx.update(organizationMembership).set({ endsOn, updatedAt: new Date() }).where(eq(organizationMembership.id, row.id));
    const separated = await separateMembership(tx, { membershipId: row.id, organizationId: org.id, personId: row.personId, actorUserId: p.user.id });
    await writeAudit(tx, {
      action: 'organization.member_leave',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: org.id,
      before: { membershipId: row.id, endsOn: row.endsOn },
      after: { endsOn, side: 'member', fieldsRemoved: separated.fieldsRemoved, claimsWithdrawn: separated.claimsWithdrawn },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await tellAdmins(tx, org.id, 'organization.member_left', { organizationId: org.id }, [p.user.id]);
    return { membershipId: row.id, endsOn };
  });
  invalidatePublic([ORGANIZATIONS_TAG], 'procedure');
  return out;
}

// --- organizationTools.claims / withdrawClaim ------------------------------------------------------

export interface ClaimView {
  id: string;
  student: PersonRef | null;
  teacher: PersonRef | null;
  startYear: number | null;
  status: ClaimStatus;
  statusLabel: string;
  createdAt: string;
  withdrawnAt: string | null;
  withdrawnBecause: 'organization' | 'separation' | null;
}

export async function organizationClaims(principal: Principal | null, raw: z.input<typeof claimsInput>): Promise<{ claims: ClaimView[]; note: string }> {
  const p = requireUser(principal);
  const input = parseIds(claimsInput, raw);
  const db = getDb();
  const rows = await db.transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId);
    return tx
      .select()
      .from(organizationTeacherClaim)
      .where(eq(organizationTeacherClaim.organizationId, org.id))
      .orderBy(asc(organizationTeacherClaim.status), desc(organizationTeacherClaim.createdAt), desc(organizationTeacherClaim.id))
      .limit(500);
  });
  const refs = await peopleRefs([...new Set(rows.flatMap((r) => [r.studentPersonId, r.teacherPersonId]))]);
  return {
    note: 'A claim is what your organization stated in an import. It is not a teaching relationship and is never shown publicly; only the teacher’s own approval verifies a relationship.',
    claims: rows.map((r) => ({
      id: r.id,
      student: refs.get(r.studentPersonId) ?? null,
      teacher: refs.get(r.teacherPersonId) ?? null,
      startYear: r.startYear,
      status: r.status,
      statusLabel: CLAIM_STATUS_LABELS[r.status],
      createdAt: r.createdAt.toISOString(),
      withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
      withdrawnBecause: r.withdrawReason,
    })),
  };
}

export async function withdrawClaim(principal: Principal | null, raw: z.input<typeof withdrawClaimInput>, meta: RequestMeta): Promise<{ claimId: string; status: ClaimStatus }> {
  const p = requireUser(principal);
  const input = parseIds(withdrawClaimInput, raw);
  return getDb().transaction(async (tx) => {
    // Withdrawing needs no plan: an organization can always take back what it stated.
    const { org } = await managed(tx, p, input.organizationId);
    const [claim] = await tx
      .select({ id: organizationTeacherClaim.id, status: organizationTeacherClaim.status })
      .from(organizationTeacherClaim)
      .where(and(eq(organizationTeacherClaim.id, input.claimId), eq(organizationTeacherClaim.organizationId, org.id)))
      .for('update');
    if (!claim) throw new ServiceError('NOT_FOUND', NO_CLAIM);
    if (claim.status !== 'claimed_by_organization') throw new ServiceError('CONFLICT', 'This claim was withdrawn already.');
    const now = new Date();
    await tx
      .update(organizationTeacherClaim)
      .set({ status: 'withdrawn', withdrawnAt: now, withdrawnByUserId: p.user.id, withdrawReason: 'organization', updatedAt: now })
      .where(eq(organizationTeacherClaim.id, claim.id));
    await writeAudit(tx, {
      action: 'organization.claim_withdraw',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization',
      subjectId: org.id,
      before: { claimId: claim.id, status: claim.status },
      after: { status: 'withdrawn', reason: 'organization' },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { claimId: claim.id, status: 'withdrawn' as const };
  });
}
