// Plans and the account type (milestone M08; plan §5.6, §6.5). The plan catalog for /plans and
// the API, the signed-in account's own plan, the Student/Sifu switch, and "Request pilot access"
// from an upgrade prompt. Every function checks the principal itself (CLAUDE.md §5).
//
// DEFAULT D04: the account type, a plan and a verification are separate. Switching to Sifu sets
// the free plan free_sifu and verifies nothing: a Sifu without an approved instructor
// verification is shown as "Instructor (unverified)" (DEFAULT D04/D13) until an archivist approves
// an instructor_verification case (M10b).

import { and, count, eq, gt, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { authUser, notification, person, personName, pilotAccessRequest, reviewCase } from '../db/schema';
import { ACCOUNT_TYPES } from '../db/schema/common';
import { effectivePlan, type Executor, grantsOf } from '../entitlements/access';
import { grantState } from '../entitlements/effective';
import {
  type AccountType,
  FEATURES,
  FEDERATION_EXTRAS,
  formatPrice,
  GRANTABLE_PLANS,
  PLAN_MATRIX_SOURCE,
  PLAN_MATRIX_VERSION,
  PLAN_ORDER,
  type PlanCode,
  PLANS,
} from '../entitlements/plans';
import type { NameData } from '../templates/email/types';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';

/** The label every price carries (plan §5.6, DEFAULT D09). */
export const PROPOSED_PRICE_LABEL = 'Proposed price (not final)';
/** The banner of /plans, word for word (milestone M08, In scope 5). */
export const PLANS_BANNER = 'Proposed prices — not final. Payments are not available during the pilot.';
/** How /plans marks a feature with availability 'planned'. */
export const PLANNED_LABEL = 'Planned — not available yet';

// --- The catalog -----------------------------------------------------------------------------------

export interface PlanSummary {
  code: PlanCode;
  tier: string;
  name: string;
  audience: 'student' | 'sifu' | 'organization';
  availability: 'now' | 'planned';
  summary: string;
  price: { monthlyUsd: number; yearlyUsd: number | null; text: string; label: typeof PROPOSED_PRICE_LABEL };
}

export function planSummary(code: PlanCode): PlanSummary {
  const plan = PLANS[code];
  return {
    code,
    tier: plan.tier,
    name: plan.name,
    audience: plan.audience,
    availability: plan.availability,
    summary: plan.summary,
    price: { monthlyUsd: plan.price.monthlyUsd, yearlyUsd: plan.price.yearlyUsd, text: formatPrice(plan.price), label: PROPOSED_PRICE_LABEL },
  };
}

export interface PlanCatalog {
  version: string;
  source: string;
  banner: string;
  plannedLabel: string;
  plans: PlanSummary[];
  features: {
    key: string;
    label: string;
    availability: 'now' | 'planned';
    phase: number | null;
    enforced: boolean;
    note: string | null;
    values: Record<PlanCode, { label: string; included: boolean }>;
  }[];
  federationExtras: readonly string[];
}

/** The plan matrix for /plans and GET /api/v1/plans: public, the same for everyone. */
export function planCatalog(): PlanCatalog {
  return {
    version: PLAN_MATRIX_VERSION,
    source: PLAN_MATRIX_SOURCE,
    banner: PLANS_BANNER,
    plannedLabel: PLANNED_LABEL,
    plans: PLAN_ORDER.map(planSummary),
    features: FEATURES.map((f) => ({
      key: f.key,
      label: f.label,
      availability: f.availability,
      phase: f.phase,
      enforced: f.enforced,
      note: f.note ?? null,
      values: Object.fromEntries(PLAN_ORDER.map((code) => [code, { label: f.values[code].label, included: f.values[code].included }])) as Record<
        PlanCode,
        { label: string; included: boolean }
      >,
    })),
    federationExtras: FEDERATION_EXTRAS,
  };
}

// --- The account's own plan ---------------------------------------------------------------------

export type InstructorStatus = 'not_instructor' | 'unverified' | 'verified';

/** The display label of an instructor status (DEFAULT D04/D13). */
export const INSTRUCTOR_LABELS: Record<InstructorStatus, string> = {
  not_instructor: 'Student',
  unverified: 'Instructor (unverified)',
  verified: 'Instructor',
};

/**
 * Whether a Sifu account is a verified instructor: an archivist approved an
 * instructor_verification case for its own person (M10b; the demo data has them). A Student
 * account is not an instructor, whatever its history (DEFAULT D04/D13).
 */
export async function instructorStatus(db: Executor, userId: string, accountType: AccountType): Promise<InstructorStatus> {
  if (accountType !== 'sifu') return 'not_instructor';
  const [row] = await db
    .select({ n: count() })
    .from(reviewCase)
    .innerJoin(person, eq(person.id, reviewCase.personId))
    .where(
      and(
        eq(person.claimedByUserId, userId),
        eq(reviewCase.kind, 'instructor_verification'),
        eq(reviewCase.status, 'resolved'),
        eq(reviewCase.resolution, 'approved'),
      ),
    );
  return (row?.n ?? 0) > 0 ? 'verified' : 'unverified';
}

export interface PilotRequestView {
  id: string;
  planCode: PlanCode;
  planName: string;
  status: 'open' | 'closed';
  createdAt: string;
}

async function openPilotRequest(db: Executor, userId: string): Promise<PilotRequestView | null> {
  const [row] = await db
    .select({ id: pilotAccessRequest.id, planCode: pilotAccessRequest.planCode, status: pilotAccessRequest.status, createdAt: pilotAccessRequest.createdAt })
    .from(pilotAccessRequest)
    .where(and(eq(pilotAccessRequest.userId, userId), eq(pilotAccessRequest.status, 'open')));
  return row ? { ...row, planName: PLANS[row.planCode].name, createdAt: row.createdAt.toISOString() } : null;
}

export interface MyPlan {
  accountType: AccountType;
  instructor: { status: InstructorStatus; label: string };
  plan: PlanSummary;
  /** The free plan of the account type (the floor). */
  floor: PlanSummary;
  /** When the plan in effect ends if nothing changes; null for no end or the free plan. */
  until: string | null;
  /** The account's grants that count now or later (active or scheduled), newest first. */
  grants: { id: string; planCode: PlanCode; planName: string; state: 'active' | 'scheduled'; startsAt: string; endsAt: string | null; inEffect: boolean }[];
  pilotRequest: PilotRequestView | null;
}

/** The signed-in account's type, plan and grants (GET /api/v1/plans/mine, the dashboard). */
export async function myPlan(principal: Principal | null, now: Date = new Date()): Promise<MyPlan> {
  const p = requireUser(principal);
  const db = getDb();
  const subject = { kind: 'user' as const, userId: p.user.id };
  const effective = await effectivePlan(subject, { db, now });
  const status = await instructorStatus(db, p.user.id, effective.accountType);
  const rows = (await grantsOf(db, p.user.id))
    .map((g) => ({ g, state: grantState(g, now) }))
    .filter((x): x is { g: (typeof x)['g']; state: 'active' | 'scheduled' } => x.state === 'active' || x.state === 'scheduled')
    .sort((a, b) => b.g.startsAt.getTime() - a.g.startsAt.getTime());
  return {
    accountType: effective.accountType,
    instructor: { status, label: INSTRUCTOR_LABELS[status] },
    plan: planSummary(effective.plan),
    floor: planSummary(effective.floor),
    until: effective.until?.toISOString() ?? null,
    grants: rows.map(({ g, state }) => ({
      id: g.id,
      planCode: g.planCode,
      planName: PLANS[g.planCode].name,
      state,
      startsAt: g.startsAt.toISOString(),
      endsAt: g.endsAt?.toISOString() ?? null,
      inEffect: state === 'active' && !effective.dormantGrantIds.includes(g.id),
    })),
    pilotRequest: await openPilotRequest(db, p.user.id),
  };
}

// --- Account type ------------------------------------------------------------------------------------

export const setAccountTypeInput = z.object({ accountType: z.enum(ACCOUNT_TYPES, { error: 'Choose Student or Sifu.' }) });

export interface AccountTypeChange {
  accountType: AccountType;
  plan: PlanSummary;
  instructor: { status: InstructorStatus; label: string };
  changed: boolean;
}

/**
 * Student or Sifu (plan §6.5): sets the free plan (free_student or free_sifu), audited as
 * account.type_change. It verifies nothing (DEFAULT D04) and never touches a relationship: from
 * Sifu to Student every confirmed link stays confirmed and public (DEFAULT D06/D08); only new
 * approvals are refused, because a Student plan approves no students.
 */
export async function setAccountType(principal: Principal | null, raw: unknown, meta: RequestMeta): Promise<AccountTypeChange> {
  const p = requireUser(principal);
  const parsed = setAccountTypeInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose Student or Sifu.', { accountType: 'Choose Student or Sifu.' });
  const next = parsed.data.accountType;
  const subject = { kind: 'user' as const, userId: p.user.id };

  const changed = await getDb().transaction(async (tx) => {
    const [account] = await tx.select({ accountType: authUser.accountType }).from(authUser).where(eq(authUser.id, p.user.id)).for('update');
    if (!account) throw new ServiceError('UNAUTHORIZED', 'Sign in to continue.');
    if (account.accountType === next) return false;
    const before = await effectivePlan(subject, { db: tx });
    await tx.update(authUser).set({ accountType: next, updatedAt: new Date() }).where(eq(authUser.id, p.user.id));
    const after = await effectivePlan(subject, { db: tx });
    await writeAudit(tx, {
      action: 'account.type_change',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'user',
      subjectId: p.user.id,
      before: { accountType: account.accountType, plan: before.plan },
      after: { accountType: next, plan: after.plan },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return true;
  });

  const db = getDb();
  const effective = await effectivePlan(subject, { db });
  const status = await instructorStatus(db, p.user.id, effective.accountType);
  return { accountType: effective.accountType, plan: planSummary(effective.plan), instructor: { status, label: INSTRUCTOR_LABELS[status] }, changed };
}

// --- Pilot access ------------------------------------------------------------------------------------

/** At most this many requests per account in PILOT_REQUEST_WINDOW_DAYS (against admin spam). */
export const PILOT_REQUESTS_PER_WINDOW = 3;
export const PILOT_REQUEST_WINDOW_DAYS = 30;

export const requestPilotAccessInput = z.object({
  planCode: z.enum(GRANTABLE_PLANS as readonly [PlanCode, ...PlanCode[]], { error: 'Choose a plan of the pilot.' }),
});

export interface PilotAccessOutcome {
  request: PilotRequestView;
  /** False when an open request already existed: nothing new was sent to the admins. */
  created: boolean;
  /** Always false: the pilot takes no payments (plan §5.6). */
  charged: false;
}

/** The Latin-script display name of the account's own person, for the admins' notification. */
async function ownName(db: Executor, userId: string): Promise<NameData | null> {
  const [row] = await db
    .select({ value: personName.value, lang: personName.lang })
    .from(personName)
    .innerJoin(person, eq(person.id, personName.personId))
    .where(and(eq(person.claimedByUserId, userId), eq(personName.isPrimary, true)));
  return row ?? null;
}

/**
 * "Request pilot access" (plan §5.6): asks the admins for a test plan instead of a payment. Every
 * admin gets a notification; nothing is charged and the plan does not change until an admin
 * grants it. One open request per account (a second click returns the same request), and at most
 * PILOT_REQUESTS_PER_WINDOW in PILOT_REQUEST_WINDOW_DAYS days, under a per-account advisory lock.
 */
export async function requestPilotAccess(principal: Principal | null, raw: unknown, meta: RequestMeta): Promise<PilotAccessOutcome> {
  const p = requireUser(principal);
  const parsed = requestPilotAccessInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose a plan of the pilot.', { planCode: 'Choose a plan of the pilot.' });
  const { planCode } = parsed.data;
  const subject = { kind: 'user' as const, userId: p.user.id };

  return getDb()
    .transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pilot_access_request:${p.user.id}`}, 0))`);
      const existing = await openPilotRequest(tx, p.user.id);
      if (existing) return { request: existing, created: false, charged: false as const };

      const effective = await effectivePlan(subject, { db: tx });
      const wanted = PLANS[planCode];
      if (wanted.audience !== PLANS[effective.floor].audience) {
        throw new ServiceError('BAD_REQUEST', `${wanted.name} is for ${wanted.audience === 'sifu' ? 'Sifu' : 'Student'} accounts.`, {
          planCode: `${wanted.name} is for ${wanted.audience === 'sifu' ? 'Sifu' : 'Student'} accounts.`,
        });
      }
      if (PLANS[effective.plan].rank >= wanted.rank) throw new ServiceError('CONFLICT', `Your account already has ${PLANS[effective.plan].name}.`);

      const since = new Date(Date.now() - PILOT_REQUEST_WINDOW_DAYS * 86_400_000);
      const [recent] = await tx
        .select({ n: count() })
        .from(pilotAccessRequest)
        .where(and(eq(pilotAccessRequest.userId, p.user.id), gt(pilotAccessRequest.createdAt, since)));
      if ((recent?.n ?? 0) >= PILOT_REQUESTS_PER_WINDOW) {
        throw new ServiceError('TOO_MANY_REQUESTS', 'You have asked for pilot access several times this month. An administrator will reply to your earlier requests.');
      }

      const [created] = await tx
        .insert(pilotAccessRequest)
        .values({ userId: p.user.id, planCode })
        .returning({ id: pilotAccessRequest.id, planCode: pilotAccessRequest.planCode, status: pilotAccessRequest.status, createdAt: pilotAccessRequest.createdAt });
      const request = created!;

      const admins = await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.role, 'admin'));
      if (admins.length > 0) {
        const requester = await ownName(tx, p.user.id);
        await tx.insert(notification).values(
          admins.map((admin) => ({
            userId: admin.id,
            template: 'pilot-access.requested',
            payload: { requestId: request.id, planCode, requester },
          })),
        );
      }
      // The audit keeps ids and the plan, never a name (plan §6.4).
      await writeAudit(tx, {
        action: 'pilot_access.request',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'pilot_access_request',
        subjectId: request.id,
        after: { planCode, currentPlan: effective.plan, notifiedAdmins: admins.length },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      return {
        request: { ...request, planName: wanted.name, createdAt: request.createdAt.toISOString() },
        created: true,
        charged: false as const,
      };
    })
    .catch(async (error: unknown) => {
      // Two requests at once from another process: the partial unique index decides.
      if (pgErrorOf(error)?.constraint === 'pilot_access_request_one_open_key') {
        const existing = await openPilotRequest(getDb(), p.user.id);
        if (existing) return { request: existing, created: false, charged: false as const };
      }
      throw error;
    });
}
