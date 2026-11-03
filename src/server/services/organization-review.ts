// The organization application review (milestone M15; specification §4.3, §16.3; the queue of
// M10a, kind organization_application; the pattern of school-review.ts). review.ts lists, shows and
// assigns these cases with the others; this module adds what is their own: the organization on
// the case card and the three decisions.
//
//   verify      approve: the organization becomes active (approved_at, approved_by_user_id), its
//               public page goes online; audit organization.approve and review.resolve. DEFAULT
//               D04: approval gives no plan and verifies no person or relationship; DEFAULT D12: it
//               writes no teaching_relationship and no person's visibility.
//   reject      decline, with the reason the applicant reads: status rejected, kept private; audit
//               organization.reject and review.resolve. The account may apply again.
//   needs_info  ask the applicant a question; they answer on the case page (cases.reply) and may
//               edit their application meanwhile
//
// The version (as M11): the case card carries the organization's version (its updated_at in
// microseconds) and an approval sends it back; an application edited since the reviewer loaded
// the card is refused with CONFLICT, so nobody approves details they did not see.
//
// Who: an archivist or an administrator decides (review-core.ts DECIDERS: identity and
// authenticity, as for an instructor); any reviewer may take the case, ask and add notes. Nobody
// reviews the application of an organization they applied for or administer. Lock order: the
// organization, then its case (the order organizations.update takes the organization).

import { and, eq, inArray } from 'drizzle-orm';

import { writeAudit } from '../audit';
import { hasStaff2FA, requireStaff2FA } from '../auth/guards';
import type { Principal, StaffRole } from '../auth/principal';
import { invalidatePublic, ORGANIZATIONS_TAG } from '../cache';
import { getDb } from '../db';
import { notification, organization, reviewCase, reviewNote } from '../db/schema';
import { OPEN_REVIEW_CASE_STATUSES } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import { countryName } from '../../lib/regions';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { filesOfCases } from './evidence';
import { adminIdsOf, APPROVAL_LABELS, ORGANIZATION_KIND_LABELS, type OrganizationStatus, organizationRow } from './organizations';
import { keyReused } from './relationships';
import { caseReplayOf, DECIDERS, isCaseKeyConflict, partiesOf, recordCaseEvent } from './review-core';

/** The roles that approve or decline an organization's application. */
export const APPLICATION_DECIDE_ROLES: readonly StaffRole[] = DECIDERS.organization_application;
const APPROVED_NOTE = 'Application approved.';

export interface OrganizationCaseView {
  id: string;
  slug: string;
  name: string;
  kindLabel: string;
  status: OrganizationStatus;
  approvalLabel: string;
  countryCode: string | null;
  countryName: string | null;
  websiteUrl: string | null;
  leaderName: string | null;
  leaderTitle: string | null;
  schoolsEstimate: number | null;
  /** The version of the details on the card (updated_at in microseconds): an approval sends it back. */
  version: string;
}

/** The organization of an application case, as the case card shows it. */
export async function organizationCaseView(db: Executor, organizationId: string): Promise<OrganizationCaseView | null> {
  const org = await organizationRow(db, organizationId);
  if (!org) return null;
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    kindLabel: ORGANIZATION_KIND_LABELS[org.kind],
    status: org.status,
    approvalLabel: APPROVAL_LABELS[org.status],
    countryCode: org.countryCode,
    countryName: countryName(org.countryCode),
    websiteUrl: org.websiteUrl,
    leaderName: org.leaderName,
    leaderTitle: org.leaderTitle,
    schoolsEstimate: org.schoolsEstimate,
    version: org.version,
  };
}

/** The organizations of these application cases, for the queue's rows: name and country. */
export async function organizationRowsOf(db: Executor, ids: readonly string[]): Promise<Map<string, { name: string; countryCode: string | null }>> {
  const out = new Map<string, { name: string; countryCode: string | null }>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const rows = await db.select({ id: organization.id, name: organization.name, countryCode: organization.countryCode }).from(organization).where(inArray(organization.id, unique));
  for (const row of rows) out.set(row.id, { name: row.name, countryCode: row.countryCode });
  return out;
}

/** Locks an application case's organization (the case's lock comes second). */
export async function lockApplication(tx: Executor, organizationId: string): Promise<{ status: OrganizationStatus; version: string } | null> {
  const org = await organizationRow(tx, organizationId, true);
  return org ? { status: org.status, version: org.version } : null;
}

/** An application is decided while its organization waits for review. */
export const isDecidableApplication = (status: string | null | undefined) => status === 'pending';

export interface ApplicationDecision {
  caseId: string;
  decision: 'verify' | 'reject' | 'needs_info';
  reason: string | null;
  idempotencyKey: string;
  /** The version of the organization on the card the reviewer decided from (OrganizationCaseView.version). */
  organizationVersion?: string | null | undefined;
}

const isOpen = (status: string) => (OPEN_REVIEW_CASE_STATUSES as readonly string[]).includes(status);

/** review.decide on an organization_application case (see the top of this file). Returns whether it was a replay. */
export async function decideOrganizationApplication(principal: Principal | null, input: ApplicationDecision, meta: RequestMeta): Promise<boolean> {
  const p = requireStaff2FA(principal);
  const admin = hasStaff2FA(p, ['admin']);
  const db = getDb();
  const body = input.decision === 'verify' ? (input.reason ?? APPROVED_NOTE) : input.reason!;
  try {
    const outcome = await db.transaction(async (tx) => {
      const [seen] = await tx
        .select({ organizationId: reviewCase.organizationId })
        .from(reviewCase)
        .where(and(eq(reviewCase.id, input.caseId), eq(reviewCase.kind, 'organization_application')));
      if (!seen?.organizationId) throw new ServiceError('NOT_FOUND', 'No such case.');
      const application = await lockApplication(tx, seen.organizationId);
      const [c] = await tx
        .select({ id: reviewCase.id, status: reviewCase.status, assignedToUserId: reviewCase.assignedToUserId })
        .from(reviewCase)
        .where(eq(reviewCase.id, input.caseId))
        .for('update');
      if (!application || !c) throw new ServiceError('NOT_FOUND', 'No such case.');
      const action = input.decision === 'verify' ? 'approve' : input.decision === 'reject' ? 'reject' : 'needs_info';
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        if (replay.caseId !== c.id || replay.action !== action) throw keyReused();
        return { replayed: true, publicChange: false };
      }
      if ((await partiesOf(tx, { kind: 'organization_application', relationshipId: null, personId: null, openedByUserId: null, organizationId: seen.organizationId })).has(p.user.id)) {
        throw new ServiceError('FORBIDDEN', 'This organization is yours: another reviewer decides its application.');
      }
      if (input.decision !== 'needs_info' && !hasStaff2FA(p, APPLICATION_DECIDE_ROLES)) {
        throw new ServiceError('FORBIDDEN', 'An archivist or an administrator approves or declines an organization’s application.');
      }
      if (c.assignedToUserId !== p.user.id && !admin) throw new ServiceError('FORBIDDEN', 'Assign the case to yourself before you decide it.');
      if (!isOpen(c.status) || !isDecidableApplication(application.status)) throw new ServiceError('CONFLICT', 'This case has been decided or closed.');
      if (input.decision === 'verify' && !input.organizationVersion) {
        throw new ServiceError('BAD_REQUEST', 'Open the case again and decide from the application it shows.', {
          organizationVersion: 'Send the version of the application you reviewed (the case card has it).',
        });
      }
      if (input.organizationVersion && input.organizationVersion !== application.version) {
        throw new ServiceError('CONFLICT', 'The applicant changed this application after you opened it. Open the case again and review the new details before you decide.');
      }
      const now = new Date();
      const orgId = seen.organizationId;
      const admins = await adminIdsOf(tx, orgId);
      const tell = async (decision: 'approved' | 'declined' | 'needs_info') => {
        if (admins.length > 0) await tx.insert(notification).values(admins.map((userId) => ({ userId, template: 'organization.reviewed', payload: { organizationId: orgId, decision } })));
      };
      const audit = (auditAction: 'review.needs_info' | 'review.resolve' | 'organization.approve' | 'organization.reject', subjectType: string, subjectId: string, before: Record<string, unknown>, after: Record<string, unknown>, evidenceIds?: string[]) =>
        writeAudit(tx, { action: auditAction, actorUserId: p.user.id, actorRole: p.user.role, subjectType, subjectId, before, after, evidenceIds, requestId: meta.requestId, ipHmac: meta.ipHmac });

      if (input.decision === 'needs_info') {
        await tx.update(reviewCase).set({ status: 'needs_info', updatedAt: now }).where(eq(reviewCase.id, c.id));
        await tx.insert(reviewNote).values({ reviewCaseId: c.id, authorUserId: p.user.id, body, isInternal: false });
        await recordCaseEvent(tx, { caseId: c.id, action, from: c.status, to: 'needs_info', actor: p, key: input.idempotencyKey });
        await audit('review.needs_info', 'review_case', c.id, { status: c.status }, { status: 'needs_info', organizationId: orgId });
        await tell('needs_info');
        return { replayed: false, publicChange: false };
      }

      const approve = input.decision === 'verify';
      // DEFAULT D04/D12: only the organization's own status; no plan, no relationship, no person.
      await tx
        .update(organization)
        .set(approve ? { status: 'active', approvedAt: now, approvedByUserId: p.user.id, updatedAt: now } : { status: 'rejected', updatedAt: now })
        .where(eq(organization.id, orgId));
      await tx
        .update(reviewCase)
        .set({ status: 'resolved', resolution: approve ? 'approved' : 'rejected', resolutionReason: input.reason, resolvedAt: now, updatedAt: now })
        .where(eq(reviewCase.id, c.id));
      // The decision's note is for the reviewers: the applicant reads a decline's reason once, from
      // the case's resolution (applicationOf), and never an approval's note.
      await tx.insert(reviewNote).values({ reviewCaseId: c.id, authorUserId: p.user.id, body, isInternal: true });
      await recordCaseEvent(tx, { caseId: c.id, action, from: c.status, to: 'resolved', actor: p, key: input.idempotencyKey });
      const evidenceIds = ((await filesOfCases(tx, [c.id])).get(c.id) ?? []).map((f) => f.id);
      await audit(approve ? 'organization.approve' : 'organization.reject', 'organization', orgId, { status: 'pending' }, { status: approve ? 'active' : 'rejected', caseId: c.id }, evidenceIds);
      await audit('review.resolve', 'review_case', c.id, { status: c.status }, { status: 'resolved', resolution: approve ? 'approved' : 'rejected', organizationId: orgId }, evidenceIds);
      await tell(approve ? 'approved' : 'declined');
      return { replayed: false, publicChange: approve };
    });
    if (outcome.publicChange) invalidatePublic([ORGANIZATIONS_TAG], 'procedure');
    return outcome.replayed;
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    throw error;
  }
}
