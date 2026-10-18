// Test plans (milestone M08; plan §6.5): an admin whose session proved the second factor gives
// or revokes a plan of the pilot, with a reason, a start and an optional end. Both are audited
// (grant.create, grant.revoke) in the transaction of the change, and the account gets a
// notification. There are no payments in the pilot: the sources are test_grant and complimentary.
//
// DEFAULT D06/D08: revoking a plan never touches a relationship. Every confirmed link stays
// confirmed and public; requireEntitlement() refuses only new approvals above the free limit.

import { and, asc, count, desc, eq, ilike, isNull, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as z from 'zod';

import { parseIsoDay } from '../../lib/dates';
import { writeAudit } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { authUser, entitlementGrant, notification, pilotAccessRequest } from '../db/schema';
import { type Executor, grantsOf } from '../entitlements/access';
import { type GrantState, grantState } from '../entitlements/effective';
import { type AccountType, GRANTABLE_PLANS, type PlanCode, PLANS } from '../entitlements/plans';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';

export const GRANT_PAGE_SIZE = 20;
export const GRANT_SORTS = ['created', 'email', 'plan', 'starts', 'ends', 'state'] as const;
export type GrantSort = (typeof GRANT_SORTS)[number];

const STATE_LABELS: Record<GrantState, string> = { active: 'Active', scheduled: 'Starts later', ended: 'Ended', revoked: 'Revoked' };

export interface GrantRow {
  id: string;
  email: string;
  accountType: AccountType;
  planCode: PlanCode;
  planName: string;
  source: 'test_grant' | 'complimentary' | 'stripe';
  sourceLabel: string;
  startsAt: string;
  endsAt: string | null;
  state: GrantState;
  stateLabel: string;
  /** Active, and the plan of the account's type (a Pro Sifu grant does nothing on a Student account). */
  inEffect: boolean;
  reason: string;
  grantedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export interface PilotRequestRow {
  id: string;
  email: string;
  accountType: AccountType;
  planCode: PlanCode;
  planName: string;
  createdAt: string;
}

export interface GrantList {
  rows: GrantRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  sort: GrantSort;
  dir: 'asc' | 'desc';
  q: string;
  requests: PilotRequestRow[];
  /** The account and plan of `?request=<id>`, to fill the form in. */
  prefill: { email: string; planCode: PlanCode; requestId: string } | null;
  grantablePlans: { code: PlanCode; name: string; audience: string }[];
}

const SOURCE_LABELS = { test_grant: 'Test plan', complimentary: 'Complimentary', stripe: 'Payment' } as const;

export const listGrantsInput = z.object({
  q: z.string().trim().max(320).optional(),
  sort: z.enum(GRANT_SORTS).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  request: z.uuid().optional(),
});

/** `%text%` for ILIKE with the wildcards of `text` escaped. */
function contains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const granter = alias(authUser, 'granter');
const revoker = alias(authUser, 'revoker');

/** The state of a grant in SQL, the same order as grantState(): revoked, scheduled, ended, active. */
const stateSql = sql<string>`CASE
  WHEN ${entitlementGrant.revokedAt} IS NOT NULL AND ${entitlementGrant.revokedAt} <= now() THEN 'revoked'
  WHEN ${entitlementGrant.startsAt} > now() THEN 'scheduled'
  WHEN ${entitlementGrant.endsAt} IS NOT NULL AND ${entitlementGrant.endsAt} <= now() THEN 'ended'
  ELSE 'active' END`;

function orderOf(sort: GrantSort, dir: 'asc' | 'desc'): SQL[] {
  const by = dir === 'asc' ? asc : desc;
  const column = {
    created: entitlementGrant.createdAt,
    email: authUser.email,
    plan: entitlementGrant.planCode,
    starts: entitlementGrant.startsAt,
    ends: entitlementGrant.endsAt,
    state: stateSql,
  }[sort];
  // NULL ends (no end date) sort last when ascending; the id keeps pages stable.
  if (sort === 'ends') return [sql`${entitlementGrant.endsAt} ${sql.raw(dir === 'asc' ? 'ASC NULLS LAST' : 'DESC NULLS FIRST')}`, by(entitlementGrant.id)];
  return [by(column), by(entitlementGrant.id)];
}

/** The grants and the open pilot requests (admin with a verified second factor). */
export async function listGrants(principal: Principal | null, raw: unknown = {}, now: Date = new Date()): Promise<GrantList> {
  requireStaff2FA(principal, ['admin']);
  const parsed = listGrantsInput.safeParse(raw ?? {});
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the filter.');
  const q = parsed.data.q ?? '';
  const sort = parsed.data.sort ?? 'created';
  const dir = parsed.data.dir ?? 'desc';
  const db = getDb();

  const where = and(
    sql`${entitlementGrant.subjectUserId} IS NOT NULL`,
    q ? ilike(authUser.email, contains(q.toLowerCase())) : undefined,
  );
  const [totalRow] = await db
    .select({ n: count() })
    .from(entitlementGrant)
    .innerJoin(authUser, eq(authUser.id, entitlementGrant.subjectUserId))
    .where(where);
  const total = totalRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / GRANT_PAGE_SIZE));
  const page = Math.min(parsed.data.page ?? 1, pages);

  const rows = await db
    .select({
      id: entitlementGrant.id,
      email: authUser.email,
      accountType: authUser.accountType,
      planCode: entitlementGrant.planCode,
      source: entitlementGrant.source,
      startsAt: entitlementGrant.startsAt,
      endsAt: entitlementGrant.endsAt,
      revokedAt: entitlementGrant.revokedAt,
      reason: entitlementGrant.reason,
      revokeReason: entitlementGrant.revokeReason,
      grantedBy: granter.email,
      revokedBy: revoker.email,
    })
    .from(entitlementGrant)
    .innerJoin(authUser, eq(authUser.id, entitlementGrant.subjectUserId))
    .leftJoin(granter, eq(granter.id, entitlementGrant.grantedByUserId))
    .leftJoin(revoker, eq(revoker.id, entitlementGrant.revokedByUserId))
    .where(where)
    .orderBy(...orderOf(sort, dir))
    .limit(GRANT_PAGE_SIZE)
    .offset((page - 1) * GRANT_PAGE_SIZE);

  const requests = await db
    .select({
      id: pilotAccessRequest.id,
      email: authUser.email,
      accountType: authUser.accountType,
      planCode: pilotAccessRequest.planCode,
      createdAt: pilotAccessRequest.createdAt,
    })
    .from(pilotAccessRequest)
    .innerJoin(authUser, eq(authUser.id, pilotAccessRequest.userId))
    .where(and(eq(pilotAccessRequest.status, 'open'), q ? ilike(authUser.email, contains(q.toLowerCase())) : undefined))
    .orderBy(asc(pilotAccessRequest.createdAt))
    .limit(50);

  let prefill: GrantList['prefill'] = null;
  if (parsed.data.request) {
    const [request] = await db
      .select({ id: pilotAccessRequest.id, email: authUser.email, planCode: pilotAccessRequest.planCode })
      .from(pilotAccessRequest)
      .innerJoin(authUser, eq(authUser.id, pilotAccessRequest.userId))
      .where(and(eq(pilotAccessRequest.id, parsed.data.request), eq(pilotAccessRequest.status, 'open')));
    if (request) prefill = { email: request.email, planCode: request.planCode, requestId: request.id };
  }

  return {
    rows: rows.map((r) => toRow(r, now)),
    total,
    page,
    pageSize: GRANT_PAGE_SIZE,
    pages,
    sort,
    dir,
    q,
    requests: requests.map((r) => ({ ...r, planName: PLANS[r.planCode].name, createdAt: r.createdAt.toISOString() })),
    prefill,
    grantablePlans: GRANTABLE_PLANS.map((code) => ({ code, name: PLANS[code].name, audience: PLANS[code].audience })),
  };
}

function toRow(
  r: {
    id: string;
    email: string;
    accountType: AccountType;
    planCode: PlanCode;
    source: GrantRow['source'];
    startsAt: Date;
    endsAt: Date | null;
    revokedAt: Date | null;
    reason: string;
    revokeReason: string | null;
    grantedBy: string | null;
    revokedBy: string | null;
  },
  now: Date,
): GrantRow {
  const state = grantState({ id: r.id, planCode: r.planCode, source: r.source, startsAt: r.startsAt, endsAt: r.endsAt, revokedAt: r.revokedAt }, now);
  const sameAudience = PLANS[r.planCode].audience === (r.accountType === 'sifu' ? 'sifu' : 'student');
  return {
    id: r.id,
    email: r.email,
    accountType: r.accountType,
    planCode: r.planCode,
    planName: PLANS[r.planCode].name,
    source: r.source,
    sourceLabel: SOURCE_LABELS[r.source],
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt?.toISOString() ?? null,
    state,
    stateLabel: STATE_LABELS[state],
    inEffect: state === 'active' && sameAudience,
    reason: r.reason,
    grantedBy: r.grantedBy,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    revokedBy: r.revokedBy,
    revokeReason: r.revokeReason,
  };
}

async function rowById(db: Executor, id: string, now: Date): Promise<GrantRow> {
  const [r] = await db
    .select({
      id: entitlementGrant.id,
      email: authUser.email,
      accountType: authUser.accountType,
      planCode: entitlementGrant.planCode,
      source: entitlementGrant.source,
      startsAt: entitlementGrant.startsAt,
      endsAt: entitlementGrant.endsAt,
      revokedAt: entitlementGrant.revokedAt,
      reason: entitlementGrant.reason,
      revokeReason: entitlementGrant.revokeReason,
      grantedBy: granter.email,
      revokedBy: revoker.email,
    })
    .from(entitlementGrant)
    .innerJoin(authUser, eq(authUser.id, entitlementGrant.subjectUserId))
    .leftJoin(granter, eq(granter.id, entitlementGrant.grantedByUserId))
    .leftJoin(revoker, eq(revoker.id, entitlementGrant.revokedByUserId))
    .where(eq(entitlementGrant.id, id));
  if (!r) throw new ServiceError('NOT_FOUND', 'No such plan grant.');
  return toRow(r, now);
}

// --- Give ------------------------------------------------------------------------------------------

const optionalDay = z
  .string()
  .trim()
  .max(10)
  .optional()
  .transform((s) => (s ? s : undefined));

export const createGrantInput = z.object({
  email: z.string().trim().toLowerCase().max(320),
  planCode: z.enum(GRANTABLE_PLANS as readonly [PlanCode, ...PlanCode[]], { error: 'Choose Premium Student or Professional Sifu.' }),
  source: z.enum(['test_grant', 'complimentary']).default('test_grant'),
  reason: z.string().trim().max(500),
  /** "YYYY-MM-DD", the first day (00:00 UTC); today when empty. */
  startsOn: optionalDay,
  /** "YYYY-MM-DD", the day the plan stops (00:00 UTC); no end when empty. */
  endsOn: optionalDay,
  /** The pilot access request this grant answers, if any: closed with the grant when it is the account's. */
  requestId: z.uuid().optional().or(z.literal('').transform(() => undefined)),
});

/**
 * Gives a plan of the pilot to an account (admin with a verified second factor). Refused for a
 * plan of the other account type (a Student account switches to Sifu first), for an end that is
 * not after the start or has passed, and while the account already has the same plan for an
 * overlapping period (a second submit of the form, too). Closes the account's open pilot access
 * request for that plan.
 */
export async function createGrant(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<GrantRow> {
  const actor = requireStaff2FA(principal, ['admin']);
  const parsed = createGrantInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const input = parsed.data;
  const fields: Record<string, string> = {};
  if (!z.email().safeParse(input.email).success) fields.email = 'Enter the e-mail address of the account.';
  if (!input.reason) fields.reason = 'Give a reason; it is kept in the audit log.';
  const startsAt = input.startsOn ? parseIsoDay(input.startsOn) : now;
  const endsAt = input.endsOn ? parseIsoDay(input.endsOn) : null;
  if (!startsAt) fields.startsOn = 'Enter the start as a date, for example 2026-11-01.';
  if (input.endsOn && !endsAt) fields.endsOn = 'Enter the end as a date, for example 2026-12-31.';
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) fields.endsOn = 'The end must be after the start.';
  else if (endsAt && endsAt.getTime() <= now.getTime()) fields.endsOn = 'The end date has passed.';
  if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  const plan = PLANS[input.planCode];

  const id = await getDb().transaction(async (tx) => {
    const [account] = await tx
      .select({ id: authUser.id, accountType: authUser.accountType })
      .from(authUser)
      .where(eq(authUser.email, input.email))
      .for('update');
    if (!account) throw new ServiceError('NOT_FOUND', 'No account has this e-mail address.', { email: 'No account has this e-mail address.' });
    if (plan.audience !== account.accountType) {
      const kind = account.accountType === 'sifu' ? 'a Sifu' : 'a Student';
      const message = `This is ${kind} account; ${plan.name} is for ${plan.audience === 'sifu' ? 'Sifu' : 'Student'} accounts. The account changes its type in its dashboard settings.`;
      throw new ServiceError('BAD_REQUEST', message, { planCode: message });
    }
    // The row lock on the account serializes two grants for it; overlapping grants of the same
    // plan would count once anyway (resolveEffectivePlan), but are refused to keep the list clear.
    const overlapping = (await grantsOf(tx, account.id)).filter((g) => {
      if (g.planCode !== input.planCode) return false;
      const state = grantState(g, now);
      if (state === 'revoked' || state === 'ended') return false;
      const startsBeforeOtherEnds = g.endsAt === null || startsAt!.getTime() < g.endsAt.getTime();
      const endsAfterOtherStarts = endsAt === null || endsAt.getTime() > g.startsAt.getTime();
      return startsBeforeOtherEnds && endsAfterOtherStarts;
    });
    if (overlapping.length > 0) {
      throw new ServiceError('CONFLICT', `This account already has ${plan.name} for these dates. Revoke that plan first, or choose dates after it.`);
    }

    const [grant] = await tx
      .insert(entitlementGrant)
      .values({
        subjectUserId: account.id,
        planCode: input.planCode,
        source: input.source,
        startsAt: startsAt!,
        endsAt,
        grantedByUserId: actor.user.id,
        reason: input.reason,
      })
      .returning({ id: entitlementGrant.id });
    const grantId = grant!.id;
    await writeAudit(tx, {
      action: 'grant.create',
      actorUserId: actor.user.id,
      actorRole: actor.user.role,
      subjectType: 'entitlement_grant',
      subjectId: grantId,
      after: {
        userId: account.id,
        planCode: input.planCode,
        source: input.source,
        startsAt: startsAt!.toISOString(),
        endsAt: endsAt?.toISOString() ?? null,
      },
      reason: input.reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    // The grant answers the account's open request: the one the form came from (requestId), or
    // the one for this plan. A requestId of another account closes nothing of that account.
    const answers = input.requestId
      ? or(eq(pilotAccessRequest.id, input.requestId), eq(pilotAccessRequest.planCode, input.planCode))
      : eq(pilotAccessRequest.planCode, input.planCode);
    await tx
      .update(pilotAccessRequest)
      .set({ status: 'closed', closedAt: now, closedByUserId: actor.user.id, grantId, updatedAt: now })
      .where(and(eq(pilotAccessRequest.userId, account.id), eq(pilotAccessRequest.status, 'open'), answers));
    await tx.insert(notification).values({
      userId: account.id,
      template: 'plan.granted',
      payload: { planCode: input.planCode, endsAt: endsAt?.toISOString() ?? null },
    });
    return grantId;
  });
  return rowById(getDb(), id, now);
}

// --- Revoke ----------------------------------------------------------------------------------------

export const revokeGrantInput = z.object({
  grantId: z.uuid({ error: 'Choose a plan grant.' }),
  reason: z.string().trim().max(500),
});

/**
 * Revokes a grant now (admin with a verified second factor), with a reason, audited as
 * grant.revoke. DEFAULT D06/D08: no relationship changes; confirmed links stay confirmed and
 * public, and only new approvals above the limit of the plan left are refused.
 */
export async function revokeGrant(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<GrantRow> {
  const actor = requireStaff2FA(principal, ['admin']);
  const parsed = revokeGrantInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { grantId: 'Choose a plan grant.' });
  const { grantId, reason } = parsed.data;
  if (!reason) throw new ServiceError('BAD_REQUEST', 'Give a reason; it is kept in the audit log.', { reason: 'Give a reason; it is kept in the audit log.' });

  await getDb().transaction(async (tx) => {
    const [grant] = await tx.select().from(entitlementGrant).where(eq(entitlementGrant.id, grantId)).for('update');
    if (!grant || grant.subjectUserId === null) throw new ServiceError('NOT_FOUND', 'No such plan grant.');
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
      before: { state, planCode: grant.planCode, userId: grant.subjectUserId },
      after: { state: 'revoked', revokedAt: now.toISOString() },
      reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    // The account hears of every revocation (active or scheduled, in effect or kept for the other
    // account type): it is the account's plan either way.
    await tx.insert(notification).values({ userId: grant.subjectUserId, template: 'plan.revoked', payload: { planCode: grant.planCode } });
  });
  return rowById(getDb(), grantId, now);
}
