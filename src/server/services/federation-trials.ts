// Federation trials (milestone M23; specification §10.2; docs/adr/0026-federation-billing.md): an
// administrator gives an approved federation a complimentary Federation period of six or twelve
// months without a card; the organization's admins hear of it when it starts, 14 and 7 days before
// it ends and when it ends; an owner may continue it as a monthly or yearly subscription at any
// time (services/billing.ts: the first charge then comes at the trial's end), and a trial that runs
// out without one simply ends: no charge, nothing deleted (DEFAULT D08: only the member and school
// administration closes, as when a grant ends).
//
//   federationTrials.adminGet  the organization's trial and whether one can be started (administrators)
//   federationTrials.start     start one: months (6 or 12; DEFAULT M23, question 4: 12) and a reason
//   federationTrials.end       end it early, with a reason (the grant is revoked)
//   runFederationTrials        the daily part (the job plans.expiry): reminders, then the ends
//
// Every function checks the principal itself (CLAUDE.md §5); the writes are audited in their own
// transaction. The trial is the organization's own grant: it never gives or takes a plan of an
// account, an admin's included (specification §10.3).

import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { type Database, getDb } from '../db';
import { billingSubscription, entitlementGrant, federationTrial } from '../db/schema';
import { BILLING_LIVE_STATUSES, FEDERATION_TRIAL_DEFAULT_MONTHS, FEDERATION_TRIAL_MONTHS, FEDERATION_TRIAL_NOTICE_DAYS } from '../db/schema/common';
import { type Executor, organizationGrantsOf } from '../entitlements/access';
import { grantState } from '../entitlements/effective';
import type { Transaction } from '../jobs/outbox';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { notifyEach, type NoticeProducer } from './notify';
import { adminIdsOf, organizationRow } from './organizations';
import { type TrialView, trialView } from './billing';

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_ORGANIZATION = 'No such organization.';
const NO_TRIAL = 'No such trial.';
type TrialRow = typeof federationTrial.$inferSelect;

/** `at` plus `months` calendar months in UTC (31 Jan + 1 month = the last day of February). */
export function addMonths(at: Date, months: number): Date {
  const next = new Date(at.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}

export interface AdminTrialView {
  organizationId: string;
  trial: TrialView | null;
  /** Whether an administrator may start a trial now. */
  canStart: boolean;
  /** Why not, in words, when not. */
  startNote: string | null;
  canEnd: boolean;
  months: readonly number[];
  defaultMonths: number;
}

export const adminTrialInput = z.object({ organizationId: z.uuid({ error: NO_ORGANIZATION }) });

/** Why a trial cannot start for the organization now (null: it can). DEFAULT M23 (question 4). */
async function startRefusal(db: Executor, organizationId: string, now: Date): Promise<string | null> {
  const org = await organizationRow(db, organizationId);
  if (!org) return NO_ORGANIZATION;
  if (org.status !== 'active') return 'A trial is given to an approved organization. Approval is decided in the review queue.';
  if (org.kind !== 'federation') return 'A Federation trial is for federations; this organization is registered as another kind.';
  const [earlier] = await db.select({ id: federationTrial.id }).from(federationTrial).where(eq(federationTrial.organizationId, organizationId));
  if (earlier) return 'The organization has had its trial. An organization has one trial.';
  const [live] = await db
    .select({ id: billingSubscription.id })
    .from(billingSubscription)
    .where(and(eq(billingSubscription.subjectOrganizationId, organizationId), inArray(billingSubscription.status, [...BILLING_LIVE_STATUSES])));
  if (live) return 'The organization pays for Federation already.';
  const holding = (await organizationGrantsOf(db, organizationId)).some((g) => g.planCode === 'federation' && ['active', 'scheduled'].includes(grantState(g, now)));
  if (holding) return 'The organization holds Federation already. A trial is for an organization without it.';
  return null;
}

/** federationTrials.adminGet: the organization's trial (administrators with the second factor). */
export async function adminFederationTrial(principal: Principal | null, raw: unknown, now: Date = new Date()): Promise<AdminTrialView> {
  requireStaff2FA(principal, ['admin']);
  const parsed = adminTrialInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NO_ORGANIZATION);
  const db = getDb();
  const org = await organizationRow(db, parsed.data.organizationId);
  if (!org) throw new ServiceError('NOT_FOUND', NO_ORGANIZATION);
  const [row] = await db.select().from(federationTrial).where(eq(federationTrial.organizationId, org.id));
  const refusal = await startRefusal(db, org.id, now);
  return {
    organizationId: org.id,
    trial: row ? trialView(row) : null,
    canStart: refusal === null,
    startNote: refusal,
    canEnd: row?.status === 'active',
    months: FEDERATION_TRIAL_MONTHS,
    defaultMonths: FEDERATION_TRIAL_DEFAULT_MONTHS,
  };
}

const reasonField = z
  .string({ error: 'Give a reason; it is kept in the audit log.' })
  .trim()
  .min(1, { error: 'Give a reason; it is kept in the audit log.' })
  .max(500, { error: 'Keep the reason under 500 characters.' });

export const startTrialInput = z.object({
  organizationId: z.uuid({ error: NO_ORGANIZATION }),
  // DEFAULT M23 (question 4): twelve months unless the administrator chooses six.
  months: z.coerce
    .number()
    .int()
    .refine((n) => (FEDERATION_TRIAL_MONTHS as readonly number[]).includes(n), { error: 'Choose 6 or 12 months.' })
    .default(FEDERATION_TRIAL_DEFAULT_MONTHS),
  reason: reasonField,
});

export const endTrialInput = z.object({
  trialId: z.uuid({ error: NO_TRIAL }),
  reason: reasonField,
});

function fieldsOf(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
  return fields;
}

/**
 * federationTrials.start: a Federation trial for an approved federation without Federation and
 * without an earlier trial; no card (specification §10.2). It gives a complimentary grant from now
 * to the end; the organization's admins are told. Audited (federation_trial.start, grant.create).
 */
export async function startFederationTrial(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<AdminTrialView> {
  const actor = requireStaff2FA(principal, ['admin']);
  const parsed = startTrialInput.safeParse(raw);
  if (!parsed.success) {
    const fields = fieldsOf(parsed.error);
    if (fields.organizationId) throw new ServiceError('NOT_FOUND', NO_ORGANIZATION);
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const { organizationId, months, reason } = parsed.data;
  await getDb().transaction(async (tx) => {
    // The organization's row first: it serializes a second submit and a checkout of the owner.
    const org = await organizationRow(tx, organizationId, true);
    if (!org) throw new ServiceError('NOT_FOUND', NO_ORGANIZATION);
    const refusal = await startRefusal(tx, organizationId, now);
    if (refusal) throw new ServiceError('CONFLICT', refusal);
    const endsAt = addMonths(now, months);
    const [grant] = await tx
      .insert(entitlementGrant)
      .values({
        subjectOrganizationId: organizationId,
        planCode: 'federation',
        source: 'complimentary',
        startsAt: now,
        endsAt,
        grantedByUserId: actor.user.id,
        reason: `Federation trial of ${months} months, no card: ${reason}`,
      })
      .returning({ id: entitlementGrant.id });
    const [trial] = await tx
      .insert(federationTrial)
      .values({ organizationId, months, startsAt: now, endsAt, grantId: grant!.id, startedByUserId: actor.user.id, reason })
      .returning();
    await writeAudit(tx, {
      action: 'grant.create',
      actorUserId: actor.user.id,
      actorRole: actor.user.role,
      subjectType: 'entitlement_grant',
      subjectId: grant!.id,
      after: { organizationId, planCode: 'federation', source: 'complimentary', startsAt: now.toISOString(), endsAt: endsAt.toISOString(), trialId: trial!.id },
      reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await writeAudit(tx, {
      action: 'federation_trial.start',
      actorUserId: actor.user.id,
      actorRole: actor.user.role,
      subjectType: 'federation_trial',
      subjectId: trial!.id,
      after: { organizationId, months, startsAt: now.toISOString(), endsAt: endsAt.toISOString(), grantId: grant!.id },
      reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await tellAdmins(tx, trial!, 'federation.trial-started', {}, `federation.trial-started:${trial!.id}`);
  });
  return adminFederationTrial(actor, { organizationId }, now);
}

async function tellAdmins(
  tx: Transaction,
  trial: TrialRow,
  kind: 'federation.trial-started' | 'federation.trial-ending' | 'federation.trial-ended',
  extra: Record<string, unknown>,
  key: string,
  boss?: NoticeProducer,
): Promise<number> {
  const admins = await adminIdsOf(tx, trial.organizationId);
  if (admins.length === 0) return 0;
  return notifyEach(tx, admins, kind, { organizationId: trial.organizationId, trialId: trial.id, endsAt: trial.endsAt.toISOString(), ...extra }, { key, boss });
}

/**
 * federationTrials.end: ends an active trial now, with a reason: its grant is revoked (DEFAULT D08:
 * only the member and school administration closes). Audited (federation_trial.end, grant.revoke).
 */
export async function endFederationTrial(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<AdminTrialView> {
  const actor = requireStaff2FA(principal, ['admin']);
  const parsed = endTrialInput.safeParse(raw);
  if (!parsed.success) {
    const fields = fieldsOf(parsed.error);
    if (fields.trialId) throw new ServiceError('NOT_FOUND', NO_TRIAL);
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const { trialId, reason } = parsed.data;
  const organizationId = await getDb().transaction(async (tx) => {
    const [found] = await tx.select({ organizationId: federationTrial.organizationId }).from(federationTrial).where(eq(federationTrial.id, trialId));
    if (!found) throw new ServiceError('NOT_FOUND', NO_TRIAL);
    await organizationRow(tx, found.organizationId, true);
    const [trial] = await tx.select().from(federationTrial).where(eq(federationTrial.id, trialId)).for('update');
    if (!trial) throw new ServiceError('NOT_FOUND', NO_TRIAL);
    if (trial.status !== 'active') throw new ServiceError('CONFLICT', 'This trial is not running.');
    await tx.update(federationTrial).set({ status: 'revoked', endedAt: now, endedByUserId: actor.user.id, updatedAt: now }).where(eq(federationTrial.id, trial.id));
    if (trial.grantId) {
      const [grant] = await tx.select().from(entitlementGrant).where(eq(entitlementGrant.id, trial.grantId)).for('update');
      if (grant && grant.revokedAt === null) {
        await tx.update(entitlementGrant).set({ revokedAt: now, revokedByUserId: actor.user.id, revokeReason: reason, updatedAt: now }).where(eq(entitlementGrant.id, grant.id));
        await writeAudit(tx, {
          action: 'grant.revoke',
          actorUserId: actor.user.id,
          actorRole: actor.user.role,
          subjectType: 'entitlement_grant',
          subjectId: grant.id,
          before: { planCode: grant.planCode, organizationId: trial.organizationId, trialId: trial.id },
          after: { state: 'revoked', revokedAt: now.toISOString() },
          reason,
          requestId: meta.requestId,
          ipHmac: meta.ipHmac,
        });
      }
    }
    await writeAudit(tx, {
      action: 'federation_trial.end',
      actorUserId: actor.user.id,
      actorRole: actor.user.role,
      subjectType: 'federation_trial',
      subjectId: trial.id,
      before: { status: 'active', endsAt: trial.endsAt.toISOString() },
      after: { status: 'revoked', endedAt: now.toISOString() },
      reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    await tellAdmins(tx, { ...trial, endsAt: now }, 'federation.trial-ended', { reason: 'revoked' }, `federation.trial-ended:${trial.id}`);
    return trial.organizationId;
  });
  return adminFederationTrial(actor, { organizationId }, now);
}

export interface TrialRunResult {
  reminders: number;
  ended: number;
}

/**
 * The daily part (the job plans.expiry; specification §10.2): a reminder 14 days and 7 days before
 * an active trial ends (one per trial and step: a trial with 7 days or fewer left gets only the
 * 7-day one, so a late start or a missed day never sends both at once), and the end of a trial that
 * ran out without a subscription: `ended`, its grant simply ends with it, no charge, nothing
 * deleted, and the admins hear of it. Idempotent: the notices carry keys, the end is under the
 * row's lock. Logs carry counts only (plan §6.4).
 */
export async function runFederationTrials(db: Database, now: Date = new Date(), boss?: NoticeProducer): Promise<TrialRunResult> {
  const [first] = FEDERATION_TRIAL_NOTICE_DAYS;
  const horizon = new Date(now.getTime() + first * DAY_MS);
  const active = await db
    .select()
    .from(federationTrial)
    .where(and(eq(federationTrial.status, 'active'), lte(federationTrial.endsAt, horizon)));
  const result: TrialRunResult = { reminders: 0, ended: 0 };
  // A trial whose grant an admin revoked directly (M15 revoke) is over too: it follows its grant,
  // so the page never shows an active trial without the plan.
  const orphaned = await db
    .select({ id: federationTrial.id, revokedAt: entitlementGrant.revokedAt })
    .from(federationTrial)
    .innerJoin(entitlementGrant, eq(entitlementGrant.id, federationTrial.grantId))
    .where(and(eq(federationTrial.status, 'active'), isNotNull(entitlementGrant.revokedAt)));
  for (const { id } of orphaned) {
    const ended = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(federationTrial).where(eq(federationTrial.id, id)).for('update');
      if (!row || row.status !== 'active') return false;
      const [grant] = row.grantId ? await tx.select().from(entitlementGrant).where(eq(entitlementGrant.id, row.grantId)) : [];
      if (!grant?.revokedAt) return false;
      await tx.update(federationTrial).set({ status: 'revoked', endedAt: grant.revokedAt, endedByUserId: grant.revokedByUserId, updatedAt: now }).where(eq(federationTrial.id, row.id));
      await writeAudit(tx, {
        action: 'federation_trial.end',
        actorUserId: null,
        actorRole: null,
        subjectType: 'federation_trial',
        subjectId: row.id,
        before: { status: 'active' },
        after: { status: 'revoked', endedAt: grant.revokedAt.toISOString(), organizationId: row.organizationId, cause: 'grant_revoked' },
      });
      await tellAdmins(tx, row, 'federation.trial-ended', { reason: 'revoked' }, `federation.trial-ended:${row.id}`, boss);
      return true;
    });
    if (ended) result.ended += 1;
  }
  for (const trial of active) {
    if (orphaned.some((o) => o.id === trial.id)) continue;
    if (trial.endsAt.getTime() <= now.getTime()) {
      const ended = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(federationTrial).where(eq(federationTrial.id, trial.id)).for('update');
        if (!row || row.status !== 'active' || row.endsAt.getTime() > now.getTime()) return false;
        await tx.update(federationTrial).set({ status: 'ended', endedAt: row.endsAt, updatedAt: now }).where(eq(federationTrial.id, row.id));
        await writeAudit(tx, {
          action: 'federation_trial.expire',
          actorUserId: null,
          actorRole: null,
          subjectType: 'federation_trial',
          subjectId: row.id,
          before: { status: 'active' },
          after: { status: 'ended', endedAt: row.endsAt.toISOString(), organizationId: row.organizationId },
        });
        await tellAdmins(tx, row, 'federation.trial-ended', { reason: 'expired' }, `federation.trial-ended:${row.id}`, boss);
        return true;
      });
      if (ended) result.ended += 1;
      continue;
    }
    const left = trial.endsAt.getTime() - now.getTime();
    // The latest step that has come: 7 when 7 days or fewer are left, else 14.
    const step = [...FEDERATION_TRIAL_NOTICE_DAYS].sort((a, b) => a - b).find((days) => left <= days * DAY_MS);
    if (step === undefined) continue;
    const sent = await db.transaction((tx) => tellAdmins(tx, trial, 'federation.trial-ending', { daysBefore: step }, `federation.trial-ending:${trial.id}:${step}`, boss));
    if (sent > 0) result.reminders += 1;
  }
  return result;
}
