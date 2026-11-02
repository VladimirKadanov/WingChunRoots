// Organizations for the administrators (milestone M15; plan §6.5; docs/adr/0018-organizations.md):
// every organization with its approval and its plan, shown apart (DEFAULT D04), and the Federation
// plan as a test or complimentary grant (DEFAULT D09: never charged; there are no payments in the
// pilot). Only an administrator whose session proved the second factor; audited (grant.create,
// grant.revoke) in the transaction of the change, and the organization's admins are told.
//
//   organizations.adminList    every organization: approval, plan, admins, open application
//   organizations.adminGet     one organization with its grants
//   organizations.grant        Federation from a start to an optional end, with a reason
//   organizations.revokeGrant  revoke it now, with a reason. DEFAULT D08: only the organization's
//                              member and school administration closes; its members, its school
//                              links, its public page and every account's own plan stay as they are
//
// The grant is the organization's own (entitlement_grant.subject_organization_id): it never gives
// or takes a plan of an account, its admins' included.

import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as z from 'zod';

import { parseIsoDay } from '../../lib/dates';
import { writeAudit } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { authUser, entitlementGrant, organization, organizationAdmin, reviewCase } from '../db/schema';
import { OPEN_REVIEW_CASE_STATUSES } from '../db/schema/common';
import { type Executor, organizationGrantsOf } from '../entitlements/access';
import { type GrantState, grantState } from '../entitlements/effective';
import { ORGANIZATION_GRANTABLE_PLANS, type PlanCode, PLANS } from '../entitlements/plans';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { grantHorizon } from './grants';
import { APPROVAL_LABELS, ORGANIZATION_KIND_LABELS, type OrganizationStatus, organizationRow, type PlanView } from './organizations';

const STATE_LABELS: Record<GrantState, string> = { active: 'Active', scheduled: 'Starts later', ended: 'Ended', revoked: 'Revoked' };
const SOURCE_LABELS = { test_grant: 'Test plan', complimentary: 'Complimentary', stripe: 'Payment' } as const;
const NO_ORGANIZATION = 'No such organization.';

export interface AdminOrganizationRow {
  id: string;
  slug: string;
  name: string;
  kindLabel: string;
  countryCode: string | null;
  status: OrganizationStatus;
  approvalLabel: string;
  plan: PlanView;
  admins: number;
  /** The open application case, if any. */
  caseId: string | null;
}

async function planOf(db: Executor, organizationId: string, now: Date): Promise<PlanView> {
  const active = (await organizationGrantsOf(db, organizationId)).filter((g) => g.planCode === 'federation' && grantState(g, now) === 'active');
  if (active.length === 0) return { code: null, label: 'No plan', until: null };
  const until = active.some((g) => g.endsAt === null) ? null : new Date(Math.max(...active.map((g) => g.endsAt!.getTime())));
  return { code: 'federation', label: PLANS.federation.name, until: until?.toISOString() ?? null };
}

/** organizations.adminList: every organization (administrators with the second factor). */
export async function adminOrganizations(principal: Principal | null, now: Date = new Date()): Promise<{ organizations: AdminOrganizationRow[] }> {
  requireStaff2FA(principal, ['admin']);
  const db = getDb();
  const rows = await db
    .select({
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      kind: organization.kind,
      countryCode: organization.countryCode,
      status: organization.status,
      admins: sql<number>`(SELECT count(*)::int FROM organization_admin a WHERE a.organization_id = ${organization.id} AND a.revoked_at IS NULL)`,
      caseId: sql<string | null>`(SELECT c.id::text FROM review_case c WHERE c.organization_id = ${organization.id} AND c.kind = 'organization_application'
                 AND c.status IN (${sql.join(OPEN_REVIEW_CASE_STATUSES.map((s) => sql`${s}`), sql`, `)}) LIMIT 1)`,
    })
    .from(organization)
    .where(isNull(organization.deletedAt))
    .orderBy(sql`CASE ${organization.status} WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END`, asc(organization.name), asc(organization.id))
    .limit(500);
  return {
    organizations: await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        kindLabel: ORGANIZATION_KIND_LABELS[r.kind],
        countryCode: r.countryCode,
        status: r.status,
        approvalLabel: APPROVAL_LABELS[r.status],
        plan: await planOf(db, r.id, now),
        admins: r.admins,
        caseId: r.caseId,
      })),
    ),
  };
}

export interface OrganizationGrantRow {
  id: string;
  planName: string;
  sourceLabel: string;
  startsAt: string;
  endsAt: string | null;
  state: GrantState;
  stateLabel: string;
  reason: string;
  grantedBy: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface AdminOrganizationView extends AdminOrganizationRow {
  websiteUrl: string | null;
  grants: OrganizationGrantRow[];
  /** Whether a plan can be given now: an approved organization without an active or scheduled grant. */
  canGrant: boolean;
  grantNote: string | null;
}

export const adminOrganizationInput = z.object({ organizationId: z.uuid({ error: NO_ORGANIZATION }) });

const granter = alias(authUser, 'granter');

async function grantRows(db: Executor, organizationId: string, now: Date): Promise<OrganizationGrantRow[]> {
  const rows = await db
    .select({
      id: entitlementGrant.id,
      planCode: entitlementGrant.planCode,
      source: entitlementGrant.source,
      startsAt: entitlementGrant.startsAt,
      endsAt: entitlementGrant.endsAt,
      revokedAt: entitlementGrant.revokedAt,
      reason: entitlementGrant.reason,
      revokeReason: entitlementGrant.revokeReason,
      grantedBy: granter.email,
    })
    .from(entitlementGrant)
    .leftJoin(granter, eq(granter.id, entitlementGrant.grantedByUserId))
    .where(eq(entitlementGrant.subjectOrganizationId, organizationId))
    .orderBy(desc(entitlementGrant.createdAt), desc(entitlementGrant.id));
  return rows.map((r) => {
    const state = grantState(r, now);
    return {
      id: r.id,
      planName: PLANS[r.planCode].name,
      sourceLabel: SOURCE_LABELS[r.source],
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt?.toISOString() ?? null,
      state,
      stateLabel: STATE_LABELS[state],
      reason: r.reason,
      grantedBy: r.grantedBy,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      revokeReason: r.revokeReason,
    };
  });
}

/** organizations.adminGet: one organization with its grants (administrators with the second factor). */
export async function adminOrganization(principal: Principal | null, raw: z.input<typeof adminOrganizationInput>, now: Date = new Date()): Promise<AdminOrganizationView> {
  requireStaff2FA(principal, ['admin']);
  const parsed = adminOrganizationInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NO_ORGANIZATION);
  const db = getDb();
  const org = await organizationRow(db, parsed.data.organizationId);
  if (!org) throw new ServiceError('NOT_FOUND', NO_ORGANIZATION);
  const [{ admins } = { admins: 0 }] = await db
    .select({ admins: count() })
    .from(organizationAdmin)
    .where(and(eq(organizationAdmin.organizationId, org.id), isNull(organizationAdmin.revokedAt)));
  const [open] = await db
    .select({ id: reviewCase.id })
    .from(reviewCase)
    .where(and(eq(reviewCase.organizationId, org.id), eq(reviewCase.kind, 'organization_application'), sql`${reviewCase.status} IN ('open', 'in_review', 'needs_info')`));
  const grants = await grantRows(db, org.id, now);
  const holding = grants.some((g) => g.state === 'active' || g.state === 'scheduled');
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    kindLabel: ORGANIZATION_KIND_LABELS[org.kind],
    countryCode: org.countryCode,
    status: org.status,
    approvalLabel: APPROVAL_LABELS[org.status],
    plan: await planOf(db, org.id, now),
    admins,
    caseId: open?.id ?? null,
    websiteUrl: org.websiteUrl,
    grants,
    canGrant: org.status === 'active' && !holding,
    grantNote:
      org.status !== 'active'
        ? 'A plan is given to an approved organization. Approval is decided in the review queue.'
        : holding
          ? 'The organization holds Federation already. Revoke that grant first to give it for other dates.'
          : null,
  };
}

// --- Give and revoke -----------------------------------------------------------------------------

const dayField = z
  .string()
  .trim()
  .max(10)
  .optional()
  .transform((s) => (s ? s : undefined));

export const organizationGrantInput = z.object({
  organizationId: z.uuid({ error: NO_ORGANIZATION }),
  planCode: z.enum(ORGANIZATION_GRANTABLE_PLANS as readonly [PlanCode, ...PlanCode[]], { error: 'Choose a plan.' }).default('federation'),
  source: z.enum(['test_grant', 'complimentary'], { error: 'Choose test plan or complimentary.' }).default('test_grant'),
  reason: z.string({ error: 'Give a reason; it is kept in the audit log.' }).trim().min(1, { error: 'Give a reason; it is kept in the audit log.' }).max(500),
  /** "YYYY-MM-DD", the first day (00:00 UTC); today when empty. */
  startsOn: dayField,
  /** "YYYY-MM-DD", the day the plan stops (00:00 UTC); no end when empty. */
  endsOn: dayField,
});

export const organizationRevokeInput = z.object({
  grantId: z.uuid({ error: 'Choose a plan grant.' }),
  reason: z.string().trim().max(500),
});

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** organizations.grant: gives an approved organization Federation (DEFAULT D09: a test or complimentary plan only). */
export async function grantOrganizationPlan(principal: Principal | null, raw: z.input<typeof organizationGrantInput>, meta: RequestMeta, now: Date = new Date()): Promise<AdminOrganizationView> {
  const actor = requireStaff2FA(principal, ['admin']);
  const parsed = organizationGrantInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
    if (fields.organizationId) throw new ServiceError('NOT_FOUND', NO_ORGANIZATION);
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const input = parsed.data;
  const startsAt = input.startsOn ? parseIsoDay(input.startsOn) : startOfUtcDay(now);
  const endsAt = input.endsOn ? parseIsoDay(input.endsOn) : null;
  const errors: Record<string, string> = {};
  const horizon = grantHorizon(now);
  if (!startsAt) errors.startsOn = 'Enter the start as a date, for example 2026-11-01.';
  else if (startsAt.getTime() < startOfUtcDay(now).getTime()) errors.startsOn = 'The start cannot be before today.';
  else if (startsAt.getTime() > horizon.getTime()) errors.startsOn = 'Choose a date within the next two years.';
  if (input.endsOn && !endsAt) errors.endsOn = 'Enter the end as a date, for example 2026-12-31.';
  else if (endsAt && endsAt.getTime() > horizon.getTime()) errors.endsOn = 'Choose a date within the next two years.';
  else if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) errors.endsOn = 'The end must be after the start.';
  if (Object.keys(errors).length > 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', errors);

  await getDb().transaction(async (tx) => {
    // The organization's row first: it serializes two grants for it (a second submit of the form).
    const org = await organizationRow(tx, input.organizationId, true);
    if (!org) throw new ServiceError('NOT_FOUND', NO_ORGANIZATION);
    if (org.status !== 'active') throw new ServiceError('CONFLICT', 'A plan is given to an approved organization. Approval is decided in the review queue.');
    const holding = (await organizationGrantsOf(tx, org.id)).some((g) => {
      const state = grantState(g, now);
      return g.planCode === input.planCode && (state === 'active' || state === 'scheduled');
    });
    if (holding) throw new ServiceError('CONFLICT', 'The organization holds Federation already. Revoke that grant first to give it for other dates.');
    const [grant] = await tx
      .insert(entitlementGrant)
      .values({ subjectOrganizationId: org.id, planCode: input.planCode, source: input.source, startsAt: startsAt!, endsAt, grantedByUserId: actor.user.id, reason: input.reason })
      .returning({ id: entitlementGrant.id });
    await writeAudit(tx, {
      action: 'grant.create',
      actorUserId: actor.user.id,
      actorRole: actor.user.role,
      subjectType: 'entitlement_grant',
      subjectId: grant!.id,
      after: { organizationId: org.id, planCode: input.planCode, source: input.source, startsAt: startsAt!.toISOString(), endsAt: endsAt?.toISOString() ?? null },
      reason: input.reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
  });
  return adminOrganization(actor, { organizationId: input.organizationId }, now);
}

/**
 * organizations.revokeGrant: revokes an organization's grant now, with a reason (audited
 * grant.revoke). DEFAULT D08: only the member and school administration closes.
 */
export async function revokeOrganizationPlan(principal: Principal | null, raw: z.input<typeof organizationRevokeInput>, meta: RequestMeta, now: Date = new Date()): Promise<AdminOrganizationView> {
  const actor = requireStaff2FA(principal, ['admin']);
  const parsed = organizationRevokeInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such plan grant.');
  const { grantId, reason } = parsed.data;
  if (!reason) throw new ServiceError('BAD_REQUEST', 'Give a reason; it is kept in the audit log.', { reason: 'Give a reason; it is kept in the audit log.' });
  const organizationId = await getDb().transaction(async (tx) => {
    const [owner] = await tx.select({ organizationId: entitlementGrant.subjectOrganizationId }).from(entitlementGrant).where(eq(entitlementGrant.id, grantId));
    if (!owner?.organizationId) throw new ServiceError('NOT_FOUND', 'No such plan grant.');
    // The organization's row first, as grantOrganizationPlan takes it.
    await organizationRow(tx, owner.organizationId, true);
    const [grant] = await tx.select().from(entitlementGrant).where(eq(entitlementGrant.id, grantId)).for('update');
    if (!grant || grant.subjectOrganizationId === null) throw new ServiceError('NOT_FOUND', 'No such plan grant.');
    const state = grantState(grant, now);
    if (state === 'revoked') throw new ServiceError('CONFLICT', 'This plan was already revoked.');
    if (state === 'ended') throw new ServiceError('CONFLICT', 'This plan has already ended.');
    await tx
      .update(entitlementGrant)
      .set({ revokedAt: now, revokedByUserId: actor.user.id, revokeReason: reason, updatedAt: now })
      .where(and(eq(entitlementGrant.id, grantId), isNull(entitlementGrant.revokedAt)));
    await writeAudit(tx, {
      action: 'grant.revoke',
      actorUserId: actor.user.id,
      actorRole: actor.user.role,
      subjectType: 'entitlement_grant',
      subjectId: grantId,
      before: { state, planCode: grant.planCode, organizationId: grant.subjectOrganizationId },
      after: { state: 'revoked', revokedAt: now.toISOString() },
      reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return grant.subjectOrganizationId;
  });
  return adminOrganization(actor, { organizationId }, now);
}
