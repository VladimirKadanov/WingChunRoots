// Billing in test mode (milestone M22; docs/adr/0025-billing.md; plan §"Фаза 2"; D06, D08, D09):
// the checkout of a paid plan, the account's subscription and payment history, cancelling at the
// period end and resuming, the staff view of a subscription's events, the test clock, and applying
// the provider's events (the job billing.event) and the end of the grace (the job billing.grace).
// Every function checks the principal itself (CLAUDE.md §5). No real charge is ever made: the test
// provider is the default, and the Stripe adapter takes test keys only (src/server/billing/config.ts).
//
// The subscription drives one entitlement_grant with source 'stripe' (the source M08 kept for
// Phase 2): created by the first paid event, its ends_at moved to the paid-through date by every
// later state (the period end; the end of the grace while past due; the end itself), never a second
// grant for the same subscription, never a test or complimentary grant touched. The plan in effect
// is still resolveEffectivePlan of M08 over all the account's grants.
//
// Safety of the provider's events (the exit condition of Phase 2):
// - Duplicates: an event is stored once per provider event id (webhook.ts) and applied once (its
//   row's processed_at, under its row lock).
// - Order: a snapshot older than the provider version the app holds is stale and changes nothing;
//   a subscription that has ended stays ended.
// - Other accounts: the subject of a subscription comes from the app's own checkout row, and an
//   event whose customer or checkout belongs to another subject changes nothing (`mismatch`).
//
// DEFAULT D06/D08: a downgrade (the end of a paid plan) touches no relationship and deletes no
// record; confirmed links stay confirmed and public, school pins hide (DEFAULT D08/D18).
//
// M23 (docs/adr/0026-federation-billing.md): an organization's owner buys Federation for an
// approved federation, monthly or yearly (DEFAULT M23, question 1), also to continue its trial
// (the first charge then comes at the trial's end); a subscriber changes plan or billing period
// (an upgrade now, with proration; a downgrade at the period end: DEFAULT M23, question 2). An
// organization's subscription drives the organization's own grant only (specification §10.3): no
// state of it ever reads or writes a grant or a subscription of an account, so a lapsed Federation
// leaves every member school's and student's own plan as it is (DEFAULT M23, question 6).

import { and, count, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import * as z from 'zod';

import { formatDay } from '../../lib/dates';
import { writeAudit } from '../audit';
import { appUrl } from '../auth/env';
import { requireStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { billingProvider, testProvider } from '../billing/provider';
import { TEST_CARDS } from '../billing/test-provider';
import { BillingProviderError, type NormalizedEvent, type SubscriptionSnapshot } from '../billing/types';
import { getDb } from '../db';
import { authUser, billingCheckout, billingCustomer, billingEvent, billingInvoice, billingSubscription, entitlementGrant, federationTrial, organization } from '../db/schema';
import { BILLING_GRACE_DAYS, BILLING_INTERVALS, type FEDERATION_TRIAL_STATUSES, BILLING_SUBSCRIPTION_STATUSES, BILLING_TEST_CARDS, PLAN_CODES } from '../db/schema/common';
import { effectivePlan, type Executor, organizationPlan } from '../entitlements/access';
import {
  type AccountType,
  billingPrice,
  type BillingInterval,
  FEDERATION_BENEFITS_NOW,
  formatAmount,
  INTERVAL_WORDS,
  ORGANIZATION_PURCHASABLE_PLANS,
  type PlanDefinition,
  PLANS,
  type PlanCode,
  purchasablePlans,
  TEST_MODE_LABEL,
} from '../entitlements/plans';
import type { Transaction } from '../jobs/outbox';
import { logger } from '../log';
import { lockAccount } from './account-lock';
import type { RequestMeta } from './context';
import { type BillingSubject, liveSubscriptionOf } from './billing-subject';
import { ServiceError } from './errors';
import { notify, notifyEach, type NoticeProducer } from './notify';
import { adminIdsOf, adminRoleOf, APPROVAL_LABELS, ORGANIZATION_KIND_LABELS, organizationRow } from './organizations';
import { PROPOSED_PRICE_LABEL, planSummary, type PlanSummary } from './plans';

export { TEST_MODE_LABEL };

const DAY_MS = 24 * 60 * 60 * 1000;
/** DEFAULT M22 (question 7): a checkout the payer has not finished is replaced after an hour. */
export const CHECKOUT_TTL_MINUTES = 60;

type SubscriptionRow = typeof billingSubscription.$inferSelect;
type CheckoutRow = typeof billingCheckout.$inferSelect;
export type SubscriptionStatus = (typeof BILLING_SUBSCRIPTION_STATUSES)[number];
type Status = SubscriptionStatus;
type Subject = BillingSubject;

const NOT_FOUND = 'No such subscription.';
const subjectOf = (row: { subjectUserId: string | null; subjectOrganizationId: string | null }): Subject =>
  row.subjectUserId ? { userId: row.subjectUserId, organizationId: null } : { userId: null, organizationId: row.subjectOrganizationId! };
const sameSubject = (a: Subject, b: Subject) => a.userId === b.userId && a.organizationId === b.organizationId;
const isLive = (status: Status) => status === 'active' || status === 'past_due';

// --- what a subscription gives ---------------------------------------------------------------------

/**
 * Until when a subscription gives its plan (the grant's ends_at): the end of the paid period while
 * active (cancelled at the period end or not); BILLING_GRACE_DAYS after the failed renewal while past
 * due (DEFAULT D08: the paid period is honoured, the grace keeps access); the end itself once ended.
 */
export function accessUntil(sub: Pick<SubscriptionRow, 'status' | 'currentPeriodEnd' | 'pastDueSince' | 'endedAt'>): Date | null {
  switch (sub.status) {
    case 'active':
      return sub.currentPeriodEnd;
    case 'past_due':
      return new Date((sub.pastDueSince ?? sub.currentPeriodEnd).getTime() + BILLING_GRACE_DAYS * DAY_MS);
    case 'canceled':
      return sub.endedAt;
    default:
      return null;
  }
}

// --- views -------------------------------------------------------------------------------------------

const STATUS_LABELS: Record<Status, string> = { incomplete: 'Not paid', active: 'Active', past_due: 'Payment failed', canceled: 'Ended' };
const INTERVAL_NAMES: Record<BillingInterval, string> = { month: 'monthly', year: 'yearly' };
const priceText = (code: PlanCode, interval: BillingInterval): string => {
  const price = billingPrice(code, interval);
  return price ? `${formatAmount(price.amountCents, price.currency)} ${INTERVAL_WORDS[interval]}` : '';
};

export interface InvoiceView {
  id: string;
  status: 'paid' | 'failed';
  statusLabel: string;
  amount: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
}

export interface SubscriptionView {
  id: string;
  provider: 'test' | 'stripe';
  planCode: PlanCode;
  planName: string;
  interval: BillingInterval;
  price: string;
  status: Status;
  /** In words, beside the status's shape (never colour alone, CLAUDE.md §10). */
  statusLabel: string;
  /** One sentence: what happens next, with a date and no countdown (CLAUDE.md §11). */
  summary: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  accessUntil: string | null;
  endedAt: string | null;
  canCancel: boolean;
  canResume: boolean;
  invoices: InvoiceView[];
  /** M23: the plan and billing period that start at the period end (DEFAULT M23, question 2). */
  scheduledChange: { planCode: PlanCode; planName: string; interval: BillingInterval; price: string; startsOn: string } | null;
  /** M23: the plans and billing periods this subscription may change to, and when each change takes effect. */
  changeOptions: ChangeOption[];
}

export interface ChangeOption {
  planCode: PlanCode;
  planName: string;
  interval: BillingInterval;
  price: string;
  /** DEFAULT M23 (question 2): `now` for an upgrade (prorated), `period_end` for a downgrade. */
  when: 'now' | 'period_end';
  /** "Switch to yearly billing", "Switch to monthly billing", "Switch to <plan>". */
  label: string;
  /** One sentence: what the change does and when; no urgency (CLAUDE.md §11). */
  note: string;
}

function summaryOf(sub: SubscriptionRow): string {
  const plan = PLANS[sub.planCode].name;
  const until = accessUntil(sub);
  switch (sub.status) {
    case 'active':
      return sub.cancelAtPeriodEnd
        ? `Cancelled at the end of the period. You keep ${plan} until ${formatDay(sub.currentPeriodEnd)}; nothing more is charged.`
        : sub.scheduledPlanCode && sub.scheduledInterval
          ? `Renews on ${formatDay(sub.currentPeriodEnd)} as ${PLANS[sub.scheduledPlanCode].name}, billed ${INTERVAL_NAMES[sub.scheduledInterval]} at ${priceText(sub.scheduledPlanCode, sub.scheduledInterval)}.`
          : `Renews on ${formatDay(sub.currentPeriodEnd)}.`;
    case 'past_due':
      return `The renewal payment failed. You keep ${plan} until ${formatDay(until!)} while the payment is retried.`;
    case 'canceled':
      return `Ended on ${formatDay(sub.endedAt!)}. Your records, links and history are kept.`;
    default:
      return 'The payment was not completed.';
  }
}

async function invoicesOf(db: Executor, subscriptionIds: string[]): Promise<Map<string, InvoiceView[]>> {
  const map = new Map<string, InvoiceView[]>();
  if (subscriptionIds.length === 0) return map;
  const rows = await db.select().from(billingInvoice).where(inArray(billingInvoice.subscriptionId, subscriptionIds)).orderBy(desc(billingInvoice.issuedAt), desc(billingInvoice.id));
  for (const r of rows) {
    const list = map.get(r.subscriptionId) ?? [];
    list.push({
      id: r.id,
      status: r.status,
      statusLabel: r.status === 'paid' ? 'Paid (test)' : 'Failed (test)',
      amount: formatAmount(r.amountCents, r.currency),
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      issuedAt: r.issuedAt.toISOString(),
    });
    map.set(r.subscriptionId, list);
  }
  return map;
}

/**
 * DEFAULT M23 (question 2): a change to a higher plan, or from monthly to yearly billing of the same
 * plan, is an upgrade and takes effect now (prorated); any other change waits for the period end.
 * A subscription still in the free period of a Federation trial changes at its end only, so nothing
 * is charged before the trial ends.
 */
export function changeTiming(from: { planCode: PlanCode; interval: BillingInterval }, to: { planCode: PlanCode; interval: BillingInterval }, inTrial = false): 'now' | 'period_end' {
  if (inTrial) return 'period_end';
  const a = PLANS[from.planCode];
  const b = PLANS[to.planCode];
  if (b.rank !== a.rank) return b.rank > a.rank ? 'now' : 'period_end';
  return from.interval === 'month' && to.interval === 'year' ? 'now' : 'period_end';
}

/** The plans of the subscription's audience a subscriber may buy now (Federation for an organization). */
function sellable(audience: PlanDefinition['audience']): PlanCode[] {
  return audience === 'organization' ? [...ORGANIZATION_PURCHASABLE_PLANS] : purchasablePlans(audience);
}

/** M23: what a live, active subscription may change to (another plan of its audience or another billing period). */
function changeOptionsOf(sub: SubscriptionRow, now: Date, inTrial: boolean): ChangeOption[] {
  if (sub.status !== 'active' || sub.cancelAtPeriodEnd || sub.currentPeriodEnd.getTime() <= now.getTime()) return [];
  const audience = PLANS[sub.planCode].audience;
  return sellable(audience).flatMap((code) =>
    BILLING_INTERVALS.flatMap((interval): ChangeOption[] => {
      if (code === sub.planCode && interval === sub.interval) return [];
      if (code === sub.scheduledPlanCode && interval === sub.scheduledInterval) return [];
      if (!billingPrice(code, interval)) return [];
      const when = changeTiming(sub, { planCode: code, interval }, inTrial);
      const price = priceText(code, interval);
      const label = code === sub.planCode ? `Switch to ${INTERVAL_NAMES[interval]} billing` : `Switch to ${PLANS[code].name}`;
      const note =
        when === 'now'
          ? `${PLANS[code].name} at ${price} from today: a new period starts now, and the unused part of the current one is credited against the first payment.`
          : `${PLANS[code].name} at ${price} from ${formatDay(sub.currentPeriodEnd)}, when the current period ends; nothing changes before then.`;
      return [{ planCode: code, planName: PLANS[code].name, interval, price, when, label, note }];
    }),
  );
}

function viewOf(sub: SubscriptionRow, invoices: InvoiceView[], now: Date, inTrial = false): SubscriptionView {
  const price = billingPrice(sub.planCode, sub.interval);
  const until = accessUntil(sub);
  const live = isLive(sub.status) && (until === null || until.getTime() > now.getTime());
  return {
    id: sub.id,
    provider: sub.provider,
    planCode: sub.planCode,
    planName: PLANS[sub.planCode].name,
    interval: sub.interval,
    price: price ? `${formatAmount(price.amountCents, price.currency)} ${INTERVAL_WORDS[sub.interval]}` : '',
    status: sub.status,
    statusLabel: sub.status === 'active' && sub.cancelAtPeriodEnd ? 'Cancels at the period end' : STATUS_LABELS[sub.status],
    summary: summaryOf(sub),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    currentPeriodStart: sub.currentPeriodStart.toISOString(),
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
    accessUntil: until?.toISOString() ?? null,
    endedAt: sub.endedAt?.toISOString() ?? null,
    canCancel: live && !sub.cancelAtPeriodEnd,
    canResume: live && sub.status === 'active' && sub.cancelAtPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime(),
    invoices,
    scheduledChange:
      live && sub.scheduledPlanCode && sub.scheduledInterval
        ? {
            planCode: sub.scheduledPlanCode,
            planName: PLANS[sub.scheduledPlanCode].name,
            interval: sub.scheduledInterval,
            price: priceText(sub.scheduledPlanCode, sub.scheduledInterval),
            startsOn: sub.currentPeriodEnd.toISOString(),
          }
        : null,
    changeOptions: live ? changeOptionsOf(sub, now, inTrial) : [],
  };
}

/** M23: whether the subscription is still in the free first period of the Federation trial it continued. */
async function inTrialPeriod(db: Executor, sub: SubscriptionRow): Promise<boolean> {
  if (!sub.checkoutId || !sub.subjectOrganizationId) return false;
  const [row] = await db.select({ trialEndsAt: billingCheckout.trialEndsAt }).from(billingCheckout).where(eq(billingCheckout.id, sub.checkoutId));
  return row?.trialEndsAt != null && sub.currentPeriodEnd.getTime() <= row.trialEndsAt.getTime();
}

// --- the account's billing (billing.mine) --------------------------------------------------------

export interface BillingOffer {
  planCode: PlanCode;
  planName: string;
  interval: BillingInterval;
  price: string;
  priceLabel: typeof PROPOSED_PRICE_LABEL;
  summary: string;
}

export interface MyBilling {
  provider: 'test' | 'stripe';
  testModeLabel: typeof TEST_MODE_LABEL;
  accountType: AccountType;
  plan: PlanSummary;
  /** The live subscription, or else the latest one. */
  subscription: SubscriptionView | null;
  /** Earlier subscriptions, newest first (at most 10). */
  earlier: SubscriptionView[];
  /** The paid plans this account may start a checkout for now (none while it has a live subscription). */
  offers: BillingOffer[];
  /** `?checkout=<id>`: that checkout of this account and where it stands. */
  checkout: { id: string; planName: string; status: 'open' | 'completed' | 'expired' } | null;
}

export const billingMineInput = z.object({ checkout: z.uuid().optional() }).default({});

function offersFor(accountType: AccountType): BillingOffer[] {
  return purchasablePlans(accountType).flatMap((code) =>
    BILLING_INTERVALS.flatMap((interval) => {
      const price = billingPrice(code, interval);
      if (!price) return [];
      return [{ planCode: code, planName: PLANS[code].name, interval, price: priceText(code, interval), priceLabel: PROPOSED_PRICE_LABEL, summary: PLANS[code].summary }];
    }),
  );
}

/** The signed-in account's plan, subscription, payment history and offers (GET /api/v1/billing). */
export async function myBilling(principal: Principal | null, raw: unknown = {}, now: Date = new Date()): Promise<MyBilling> {
  const p = requireUser(principal);
  const parsed = billingMineInput.safeParse(raw ?? {});
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the request.');
  const db = getDb();
  const effective = await effectivePlan({ kind: 'user', userId: p.user.id }, { db, now });
  const subs = await db.select().from(billingSubscription).where(eq(billingSubscription.subjectUserId, p.user.id)).orderBy(desc(billingSubscription.createdAt), desc(billingSubscription.id)).limit(11);
  const invoices = await invoicesOf(db, subs.map((s) => s.id));
  const live = subs.find((s) => isLive(s.status)) ?? null;
  const current = live ?? subs[0] ?? null;
  let checkout: MyBilling['checkout'] = null;
  if (parsed.data.checkout) {
    const [row] = await db
      .select()
      .from(billingCheckout)
      .where(and(eq(billingCheckout.id, parsed.data.checkout), eq(billingCheckout.createdByUserId, p.user.id)));
    if (row) checkout = { id: row.id, planName: PLANS[row.planCode].name, status: checkoutStatus(row, now) };
  }
  return {
    provider: billingProvider().name,
    testModeLabel: TEST_MODE_LABEL,
    accountType: effective.accountType,
    plan: planSummary(effective.plan),
    subscription: current ? resumableBy(viewOf(current, invoices.get(current.id) ?? [], now), current, effective.accountType) : null,
    earlier: subs.filter((s) => s.id !== current?.id).slice(0, 10).map((s) => viewOf(s, invoices.get(s.id) ?? [], now)),
    offers: live ? [] : offersFor(effective.accountType),
    checkout,
  };
}

// --- an organization's billing (billing.organization; M23) ------------------------------------------

export const organizationBillingInput = z.object({
  organizationId: z.uuid({ error: 'No such organization.' }),
  checkout: z.uuid().optional(),
});

export interface TrialView {
  id: string;
  status: (typeof FEDERATION_TRIAL_STATUSES)[number];
  /** In words, beside a shape (never colour alone). */
  statusLabel: string;
  months: number;
  startsAt: string;
  endsAt: string;
  endedAt: string | null;
  /** One sentence with a date: what happens at the end; no countdown (CLAUDE.md §11). */
  summary: string;
}

export interface OrganizationBilling {
  provider: 'test' | 'stripe';
  testModeLabel: typeof TEST_MODE_LABEL;
  organization: { id: string; name: string; kind: string; kindLabel: string; status: string; approvalLabel: string };
  you: { role: 'owner' | 'admin'; canManage: boolean };
  /** The Federation plan in effect now and until when, from any grant (trial, subscription, test or complimentary). */
  plan: { code: 'federation' | null; label: string; until: string | null };
  trial: TrialView | null;
  subscription: SubscriptionView | null;
  earlier: SubscriptionView[];
  /** Monthly and yearly Federation, when an owner may start a checkout now. */
  offers: BillingOffer[];
  /** Why no checkout is offered, when none is (not a federation, not approved, not an owner). */
  offersNote: string | null;
  /** What Federation gives now (CLAUDE.md §11: only benefits that exist). */
  benefits: readonly string[];
  checkout: MyBilling['checkout'];
}

const TRIAL_STATUS_LABELS = { active: 'Trial running', converted: 'Continued as a subscription', ended: 'Trial ended', revoked: 'Trial ended early' } as const;

export function trialView(row: typeof federationTrial.$inferSelect): TrialView {
  const summary =
    row.status === 'active'
      ? `The trial runs until ${formatDay(row.endsAt)} with no card and no charge. To continue after that, choose monthly or yearly billing; if you do nothing, the trial simply ends and nothing is deleted.`
      : row.status === 'converted'
        ? `The organization subscribed during the trial on ${formatDay(row.endedAt!)}; the first payment is due when the trial period ends.`
        : row.status === 'ended'
          ? `The trial ended on ${formatDay(row.endsAt)} without a subscription. Nothing was charged, and the members, school links and history are kept.`
          : `An administrator ended the trial on ${formatDay(row.endedAt!)}. Nothing was charged, and the members, school links and history are kept.`;
  return {
    id: row.id,
    status: row.status,
    statusLabel: TRIAL_STATUS_LABELS[row.status],
    months: row.months,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    summary,
  };
}

/**
 * One organization's plan, trial, subscription and payment history (GET
 * /api/v1/billing/organizations/{organizationId}; M23): for its admins (404 for anyone else); its
 * owners also get the offers and the forms (DEFAULT M23, question 1).
 */
export async function organizationBilling(principal: Principal | null, raw: unknown, now: Date = new Date()): Promise<OrganizationBilling> {
  const p = requireUser(principal);
  const parsed = organizationBillingInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such organization.');
  const db = getDb();
  const org = await organizationRow(db, parsed.data.organizationId);
  const role = org ? await adminRoleOf(db, org.id, p.user.id) : null;
  if (!org || !role) throw new ServiceError('NOT_FOUND', 'No such organization.');
  const canManage = role === 'owner';
  const plan = await organizationPlan({ kind: 'organization', organizationId: org.id }, { db, now });
  const [trialRow] = await db.select().from(federationTrial).where(eq(federationTrial.organizationId, org.id)).orderBy(desc(federationTrial.createdAt)).limit(1);
  const subs = await db
    .select()
    .from(billingSubscription)
    .where(eq(billingSubscription.subjectOrganizationId, org.id))
    .orderBy(desc(billingSubscription.createdAt), desc(billingSubscription.id))
    .limit(11);
  const invoices = await invoicesOf(db, subs.map((s) => s.id));
  const live = subs.find((s) => isLive(s.status)) ?? null;
  const current = live ?? subs[0] ?? null;
  let checkout: MyBilling['checkout'] = null;
  if (parsed.data.checkout) {
    const [row] = await db
      .select()
      .from(billingCheckout)
      .where(and(eq(billingCheckout.id, parsed.data.checkout), eq(billingCheckout.subjectOrganizationId, org.id)));
    if (row) checkout = { id: row.id, planName: PLANS[row.planCode].name, status: checkoutStatus(row, now) };
  }
  const offersNote =
    org.kind !== 'federation'
      ? `Federation is for federations. This organization is registered as ${ORGANIZATION_KIND_LABELS[org.kind].toLowerCase()}.`
      : org.status !== 'active'
        ? 'Federation can be chosen once the reviewers approve the organization.'
        : !canManage
          ? 'Only an owner of the organization can choose its plan.'
          : null;
  const offers =
    live || offersNote
      ? []
      : ORGANIZATION_PURCHASABLE_PLANS.flatMap((code) =>
          BILLING_INTERVALS.flatMap((interval) =>
            billingPrice(code, interval)
              ? [{ planCode: code, planName: PLANS[code].name, interval, price: priceText(code, interval), priceLabel: PROPOSED_PRICE_LABEL, summary: PLANS[code].summary } satisfies BillingOffer]
              : [],
          ),
        );
  const view = (s: SubscriptionRow, trialPeriod: boolean) => {
    const v = viewOf(s, invoices.get(s.id) ?? [], now, trialPeriod);
    // Another admin reads; only an owner changes (DEFAULT M23, question 1).
    return canManage ? v : { ...v, canCancel: false, canResume: false, changeOptions: [] };
  };
  return {
    provider: billingProvider().name,
    testModeLabel: TEST_MODE_LABEL,
    organization: { id: org.id, name: org.name, kind: org.kind, kindLabel: ORGANIZATION_KIND_LABELS[org.kind], status: org.status, approvalLabel: APPROVAL_LABELS[org.status] },
    you: { role, canManage },
    plan: plan.plan ? { code: 'federation', label: PLANS.federation.name, until: plan.until?.toISOString() ?? null } : { code: null, label: 'No plan', until: null },
    trial: trialRow ? trialView(trialRow) : null,
    subscription: current ? view(current, await inTrialPeriod(db, current)) : null,
    earlier: subs.filter((s) => s.id !== current?.id).slice(0, 10).map((s) => view(s, false)),
    offers,
    offersNote: live ? null : offersNote,
    benefits: FEDERATION_BENEFITS_NOW,
    checkout,
  };
}

// --- checkout (billing.checkout) -------------------------------------------------------------------

export const checkoutInput = z.object({
  planCode: z.enum(PLAN_CODES, { error: 'Choose a plan.' }),
  interval: z.enum(BILLING_INTERVALS).default('month'),
  /** A Federation is bought by an owner of that organization, for it. */
  organizationId: z.uuid().optional(),
});

export interface CheckoutStarted {
  checkoutId: string;
  /** Where the browser goes to pay: the test checkout page of the app, or the provider's page. */
  url: string;
}

/** The subject's customer id at the provider, when it has one already. */
async function customerIdOf(tx: Executor, provider: 'test' | 'stripe', subject: Subject): Promise<string | null> {
  const [row] = await tx
    .select({ id: billingCustomer.providerCustomerId })
    .from(billingCustomer)
    .where(
      and(
        eq(billingCustomer.provider, provider),
        subject.userId ? eq(billingCustomer.subjectUserId, subject.userId) : eq(billingCustomer.subjectOrganizationId, subject.organizationId!),
      ),
    );
  return row?.id ?? null;
}

/**
 * Starts a checkout of a paid plan (POST /api/v1/billing/checkout). Only the paid plan of the
 * account's own type (a Student buys Premium Student, a Sifu Professional Sifu); a free plan has no
 * checkout; a Federation only by an owner of an approved organization, for it, and only once the
 * plan is available (DEFAULT M22, question 3: it is planned, so refused now). Refused while the
 * subject has a live subscription (it is managed on /dashboard/billing instead). An earlier open
 * checkout of the subject is replaced, so no two checkouts can both be paid.
 */
export async function startCheckout(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<CheckoutStarted> {
  const p = requireUser(principal);
  const parsed = checkoutInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose a plan.', { planCode: 'Choose a plan.' });
  const { planCode, interval, organizationId } = parsed.data;
  const plan = PLANS[planCode];
  const price = billingPrice(planCode, interval);
  if (plan.price.monthlyUsd === 0) throw new ServiceError('BAD_REQUEST', `${plan.name} is free: it needs no checkout.`, { planCode: `${plan.name} is free.` });
  if (!price) throw new ServiceError('BAD_REQUEST', `${plan.name} has no ${interval === 'year' ? 'yearly' : 'monthly'} price.`, { interval: 'Choose another billing period.' });
  // DEFAULT M22 (question 3): a planned plan is not sold before it exists (CLAUDE.md §11). DEFAULT
  // M23 (question 1): Federation is sold to an organization for what it gives now (FEDERATION_BENEFITS_NOW).
  if (plan.availability !== 'now' && !ORGANIZATION_PURCHASABLE_PLANS.includes(planCode)) {
    throw new ServiceError('CONFLICT', `${plan.name} is planned and not available yet, so it cannot be bought.`);
  }
  if (!p.user.emailVerified) throw new ServiceError('FORBIDDEN', 'Confirm your e-mail address first.');
  const provider = billingProvider();

  const checkout = await getDb().transaction(async (tx) => {
    // The account's lock first, as every write of its plan (services/account-lock.ts).
    const account = await lockAccount(tx, { id: p.user.id });
    if (!account) throw new ServiceError('UNAUTHORIZED', 'Sign in to continue.');
    let subject: Subject;
    let trialEndsAt: Date | null = null;
    if (plan.audience === 'organization') {
      if (!organizationId) throw new ServiceError('BAD_REQUEST', `${plan.name} is bought for an organization.`, { organizationId: 'Choose the organization.' });
      // The organization's row, locked: a checkout and an administrator's trial take it in turn.
      const [org] = await tx
        .select({ id: organization.id, status: organization.status, kind: organization.kind })
        .from(organization)
        .where(and(eq(organization.id, organizationId), isNull(organization.deletedAt)))
        .for('update');
      // DEFAULT M23 (question 1): an owner of the organization buys for it; another admin reads only.
      const role = org ? await adminRoleOf(tx, organizationId, p.user.id) : null;
      if (!org || !role) throw new ServiceError('NOT_FOUND', 'No such organization.');
      if (role !== 'owner') throw new ServiceError('FORBIDDEN', 'Only an owner of the organization can choose its plan.');
      if (org.status !== 'active') throw new ServiceError('CONFLICT', 'The organization is not approved yet.');
      if (org.kind !== 'federation') throw new ServiceError('CONFLICT', `${plan.name} is for federations. This organization is registered as ${ORGANIZATION_KIND_LABELS[org.kind].toLowerCase()}.`);
      subject = { userId: null, organizationId };
      // M23: during a trial the subscription starts now and is charged first when the trial ends.
      const [trial] = await tx
        .select({ endsAt: federationTrial.endsAt })
        .from(federationTrial)
        .where(and(eq(federationTrial.organizationId, organizationId), eq(federationTrial.status, 'active')));
      if (trial && trial.endsAt.getTime() > now.getTime()) trialEndsAt = trial.endsAt;
    } else {
      if (organizationId) throw new ServiceError('BAD_REQUEST', `${plan.name} is a plan of an account, not of an organization.`);
      if (plan.audience !== account.accountType) {
        const message = `${plan.name} is for ${plan.audience === 'sifu' ? 'Sifu' : 'Student'} accounts. You can change your account type in your settings.`;
        throw new ServiceError('BAD_REQUEST', message, { planCode: message });
      }
      subject = { userId: account.id, organizationId: null };
    }
    if (await liveSubscriptionOf(tx, subject)) throw new ServiceError('CONFLICT', 'You already have a subscription. You can manage it on your billing page.');
    // One open checkout per subject: the earlier one can no longer be paid.
    await tx
      .update(billingCheckout)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          eq(billingCheckout.status, 'open'),
          subject.userId ? eq(billingCheckout.subjectUserId, subject.userId) : eq(billingCheckout.subjectOrganizationId, subject.organizationId!),
        ),
      );
    const [row] = await tx
      .insert(billingCheckout)
      .values({
        provider: provider.name,
        subjectUserId: subject.userId,
        subjectOrganizationId: subject.organizationId,
        createdByUserId: account.id,
        planCode,
        interval,
        amountCents: price.amountCents,
        currency: price.currency,
        expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MINUTES * 60_000),
        trialEndsAt,
      })
      .returning();
    await writeAudit(tx, {
      action: 'billing.checkout',
      actorUserId: account.id,
      actorRole: p.user.role,
      subjectType: 'billing_checkout',
      subjectId: row!.id,
      after: {
        planCode,
        interval,
        provider: provider.name,
        ...(subject.organizationId ? { organizationId: subject.organizationId } : { userId: subject.userId }),
        ...(trialEndsAt ? { trialEndsAt: trialEndsAt.toISOString() } : {}),
      },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { row: row!, customerId: await customerIdOf(tx, provider.name, subject) };
  });

  const back = `${appUrl()}${billingPageOf(checkout.row)}`;
  try {
    const session = await provider.createCheckout({
      checkoutId: checkout.row.id,
      planCode,
      planName: plan.name,
      interval,
      amountCents: price.amountCents,
      currency: price.currency,
      customerId: checkout.customerId,
      successUrl: `${back}?checkout=${checkout.row.id}#outcome`,
      cancelUrl: `${back}?checkout=${checkout.row.id}&cancelled=1#outcome`,
      expiresAt: checkout.row.expiresAt,
      trialEndsAt: checkout.row.trialEndsAt,
    });
    if (session.sessionId) await getDb().update(billingCheckout).set({ providerSessionId: session.sessionId, updatedAt: new Date() }).where(eq(billingCheckout.id, checkout.row.id));
    return { checkoutId: checkout.row.id, url: session.url };
  } catch (error) {
    if (!(error instanceof BillingProviderError)) throw error;
    await getDb().update(billingCheckout).set({ status: 'expired', updatedAt: new Date() }).where(eq(billingCheckout.id, checkout.row.id));
    throw new ServiceError('CONFLICT', 'The payment provider did not answer. Nothing was charged; try again in a moment.');
  }
}

/** The billing page of a checkout's or a subscription's subject: the account's, or the organization's. */
export function billingPageOf(row: { subjectOrganizationId: string | null }): string {
  return row.subjectOrganizationId ? `/dashboard/organization/${row.subjectOrganizationId}/billing` : '/dashboard/billing';
}

// --- the test checkout (billing.testCheckout, billing.testPay) ---------------------------------------

export const checkoutIdInput = z.object({ checkoutId: z.uuid({ error: 'No such checkout.' }) });
export const testPayInput = z.object({
  checkoutId: z.uuid({ error: 'No such checkout.' }),
  card: z.enum(BILLING_TEST_CARDS, { error: 'Choose a test card.' }),
});

export interface TestCheckoutView {
  id: string;
  planCode: PlanCode;
  planName: string;
  interval: BillingInterval;
  amount: string;
  price: string;
  priceLabel: typeof PROPOSED_PRICE_LABEL;
  testModeLabel: typeof TEST_MODE_LABEL;
  status: 'open' | 'completed' | 'expired';
  cards: { card: (typeof BILLING_TEST_CARDS)[number]; label: string; number: string }[];
  /** M23: the billing page the checkout belongs to (the account's or the organization's). */
  backHref: string;
  /** M23: the end of the trial this checkout continues: nothing is charged before it. */
  trialEndsAt: string | null;
}

/** The account's own checkout of the test provider; 404 for anyone else, for Stripe's and for none. */
async function ownTestCheckout(db: Executor, p: Principal, checkoutId: string): Promise<CheckoutRow> {
  const [row] = await db
    .select()
    .from(billingCheckout)
    .where(and(eq(billingCheckout.id, checkoutId), eq(billingCheckout.createdByUserId, p.user.id), eq(billingCheckout.provider, 'test')));
  if (!row || billingProvider().name !== 'test') throw new ServiceError('NOT_FOUND', 'No such checkout.');
  return row;
}

const checkoutStatus = (row: CheckoutRow, now: Date): TestCheckoutView['status'] =>
  row.status === 'open' && row.expiresAt.getTime() <= now.getTime() ? 'expired' : row.status;

/** The test checkout page's data (GET /api/v1/billing/test-checkout/{checkoutId}). */
export async function testCheckout(principal: Principal | null, raw: unknown, now: Date = new Date()): Promise<TestCheckoutView> {
  const p = requireUser(principal);
  const parsed = checkoutIdInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', 'No such checkout.');
  const row = await ownTestCheckout(getDb(), p, parsed.data.checkoutId);
  return {
    id: row.id,
    planCode: row.planCode,
    planName: PLANS[row.planCode].name,
    interval: row.interval,
    amount: formatAmount(row.amountCents, row.currency),
    price: `${formatAmount(row.amountCents, row.currency)} ${INTERVAL_WORDS[row.interval]}`,
    priceLabel: PROPOSED_PRICE_LABEL,
    testModeLabel: TEST_MODE_LABEL,
    status: checkoutStatus(row, now),
    cards: TEST_CARDS.map((c) => ({ ...c })),
    backHref: billingPageOf(row),
    trialEndsAt: row.trialEndsAt && row.trialEndsAt.getTime() > now.getTime() ? row.trialEndsAt.toISOString() : null,
  };
}

export interface TestPayResult {
  outcome: 'paid' | 'declined';
  checkoutId: string;
}

/**
 * Pays the account's own open test checkout with a test card (POST /api/v1/billing/test-checkout/pay).
 * "succeeds" and "fails_at_renewal" create the test subscription; its events reach the webhook and
 * the plan follows when the job has applied them. "declines" creates nothing (409 with the reason,
 * as a declined card stays on the checkout page). No card data is taken: only which test card.
 */
export async function testPay(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<TestPayResult> {
  const p = requireUser(principal);
  const parsed = testPayInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Choose a test card.', { card: 'Choose a test card.' });
  const db = getDb();
  const row = await ownTestCheckout(db, p, parsed.data.checkoutId);
  const status = checkoutStatus(row, now);
  if (status === 'completed') return { outcome: 'paid', checkoutId: row.id };
  if (status === 'expired') throw new ServiceError('CONFLICT', 'This checkout has expired. Start again from your billing page; nothing was charged.');
  const provider = testProvider();
  if (!provider) throw new ServiceError('NOT_FOUND', 'No such checkout.');
  const subject = subjectOf(row);
  if (await liveSubscriptionOf(db, subject)) throw new ServiceError('CONFLICT', 'You already have a subscription. You can manage it on your billing page.');
  const result = await provider.pay(
    {
      checkoutId: row.id,
      planCode: row.planCode,
      interval: row.interval,
      amountCents: row.amountCents,
      currency: row.currency,
      customerId: await customerIdOf(db, 'test', subject),
      trialEndsAt: row.trialEndsAt,
    },
    parsed.data.card,
    now,
  );
  void meta;
  if (result.outcome === 'declined') {
    throw new ServiceError('CONFLICT', 'The test card was declined. No charge was made; choose another test card to try again.', { card: 'The test card was declined.' });
  }
  return { outcome: 'paid', checkoutId: row.id };
}

// --- cancel and resume (billing.cancel, billing.resume) --------------------------------------------

export const subscriptionIdInput = z.object({ subscriptionId: z.uuid({ error: NOT_FOUND }) });

/** The principal's own subscription (of the account, or of an organization it owns); 404 otherwise. */
async function ownSubscription(db: Executor, p: Principal, id: string): Promise<SubscriptionRow> {
  const [row] = await db.select().from(billingSubscription).where(eq(billingSubscription.id, id));
  if (!row) throw new ServiceError('NOT_FOUND', NOT_FOUND);
  if (row.subjectUserId === p.user.id) return row;
  if (row.subjectOrganizationId) {
    // DEFAULT M23 (question 1): an owner changes it; another admin reads it, so it is not hidden.
    const role = await adminRoleOf(db, row.subjectOrganizationId, p.user.id);
    if (role === 'owner') return row;
    if (role) throw new ServiceError('FORBIDDEN', 'Only an owner of the organization can change its plan.');
  }
  throw new ServiceError('NOT_FOUND', NOT_FOUND);
}

/** A paid plan of the other account type is not resumed (DEFAULT M22, question 8): it would renew unused. */
const ofAccountType = (sub: SubscriptionRow, accountType: AccountType) => sub.subjectUserId === null || PLANS[sub.planCode].audience === accountType;
const resumableBy = (view: SubscriptionView, sub: SubscriptionRow, accountType: AccountType): SubscriptionView =>
  view.canResume && !ofAccountType(sub, accountType) ? { ...view, canResume: false } : view;

async function changeAtProvider(
  principal: Principal | null,
  raw: unknown,
  meta: RequestMeta,
  action: 'billing.cancel' | 'billing.resume',
  now: Date,
): Promise<SubscriptionView> {
  const p = requireUser(principal);
  const parsed = subscriptionIdInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NOT_FOUND);
  const db = getDb();
  const sub = await ownSubscription(db, p, parsed.data.subscriptionId);
  const view = viewOf(sub, [], now);
  const provider = billingProvider();
  if (sub.provider !== provider.name) throw new ServiceError('CONFLICT', 'This subscription belongs to another payment provider than the one this app uses now.');
  if (action === 'billing.cancel' && !view.canCancel) {
    if (sub.cancelAtPeriodEnd && isLive(sub.status)) return view;
    throw new ServiceError('CONFLICT', 'This subscription has ended.');
  }
  if (action === 'billing.resume' && view.canResume && sub.subjectUserId) {
    const [account] = await db.select({ accountType: authUser.accountType }).from(authUser).where(eq(authUser.id, sub.subjectUserId));
    if (account && !ofAccountType(sub, account.accountType)) {
      throw new ServiceError('CONFLICT', `${PLANS[sub.planCode].name} is for ${PLANS[sub.planCode].audience === 'sifu' ? 'Sifu' : 'Student'} accounts, and your account type has changed, so it cannot be resumed. It ends at the end of the period.`);
    }
  }
  if (action === 'billing.resume' && !view.canResume) {
    if (!sub.cancelAtPeriodEnd && isLive(sub.status)) return view;
    throw new ServiceError('CONFLICT', sub.status === 'past_due' ? 'A subscription whose renewal failed cannot be resumed.' : 'This subscription has ended.');
  }
  let snapshot: SubscriptionSnapshot;
  try {
    snapshot = action === 'billing.cancel' ? await provider.cancelAtPeriodEnd(sub.providerSubscriptionId) : await provider.resume(sub.providerSubscriptionId);
  } catch (error) {
    if (!(error instanceof BillingProviderError)) throw error;
    throw new ServiceError('CONFLICT', error.code === 'refused' ? 'The payment provider refused the change.' : 'The payment provider did not answer; nothing changed. Try again in a moment.');
  }
  return applyAnswer(p, sub, provider.name, snapshot, meta, now, {
    action,
    before: { cancelAtPeriodEnd: sub.cancelAtPeriodEnd, status: sub.status },
    after: { cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd, status: snapshot.status },
  });
}

/**
 * The provider's answer to a change the subscriber asked for, applied at once (its webhook event
 * follows and is then a repeat), and audited. Stripe's answer carries no event time: it takes the
 * stored version, so it orders before any later event of Stripe's whatever this server's clock says.
 */
async function applyAnswer(
  p: Principal,
  sub: SubscriptionRow,
  provider: 'test' | 'stripe',
  snapshot: SubscriptionSnapshot,
  meta: RequestMeta,
  now: Date,
  audit: { action: 'billing.cancel' | 'billing.resume' | 'billing.change_plan' | 'billing.cancel_change'; before: Record<string, unknown>; after: Record<string, unknown> },
): Promise<SubscriptionView> {
  const ordered = provider === 'stripe' ? { ...snapshot, version: sub.providerVersion } : snapshot;
  return getDb().transaction(async (tx) => {
    const outcome = await applySnapshot(tx, provider, ordered, now, { at: now });
    await writeAudit(tx, {
      action: audit.action,
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'billing_subscription',
      subjectId: sub.id,
      before: audit.before,
      after: { ...audit.after, outcome: outcome.outcome },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    const [fresh] = await tx.select().from(billingSubscription).where(eq(billingSubscription.id, sub.id));
    const invoices = await invoicesOf(tx, [sub.id]);
    return viewOf(fresh!, invoices.get(sub.id) ?? [], now, await inTrialPeriod(tx, fresh!));
  });
}

/** Cancels at the end of the paid period (POST /api/v1/billing/cancel): access stays until then. */
export function cancelSubscription(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<SubscriptionView> {
  return changeAtProvider(principal, raw, meta, 'billing.cancel', now);
}

/** Takes back a cancellation before the period ends (POST /api/v1/billing/resume). */
export function resumeSubscription(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<SubscriptionView> {
  return changeAtProvider(principal, raw, meta, 'billing.resume', now);
}

// --- changing plan or billing period (billing.changePlan, billing.cancelChange; M23) -----------------

export const changePlanInput = z.object({
  subscriptionId: z.uuid({ error: NOT_FOUND }),
  planCode: z.enum(PLAN_CODES, { error: 'Choose a plan.' }),
  interval: z.enum(BILLING_INTERVALS, { error: 'Choose monthly or yearly billing.' }),
});

const providerRefusal = (error: BillingProviderError) =>
  new ServiceError(
    'CONFLICT',
    error.code === 'unsupported'
      ? 'The payment provider cannot make this change. Nothing changed.'
      : error.code === 'refused'
        ? 'The payment provider refused the change. Nothing changed.'
        : 'The payment provider did not answer; nothing changed. Try again in a moment.',
  );

/**
 * Changes the plan or the billing period of the principal's own subscription (POST
 * /api/v1/billing/change-plan; M23). DEFAULT M23 (question 2): an upgrade (a higher plan of the
 * same audience, or monthly to yearly billing) takes effect now, with a new period and the unused
 * part of the current one credited; a downgrade is scheduled for the period end, when the renewal
 * bills the new price; asking for the current plan and period takes back a scheduled change. Only
 * an active subscription that renews (not cancelled, not past due), of the account's own type, or
 * of an organization the principal owns. Audited.
 */
export async function changeSubscriptionPlan(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<SubscriptionView> {
  const p = requireUser(principal);
  const parsed = changePlanInput.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === 'subscriptionId') throw new ServiceError('NOT_FOUND', NOT_FOUND);
    throw new ServiceError('BAD_REQUEST', 'Choose a plan and a billing period.', { planCode: 'Choose a plan and a billing period.' });
  }
  const { planCode, interval } = parsed.data;
  const db = getDb();
  const sub = await ownSubscription(db, p, parsed.data.subscriptionId);
  const provider = billingProvider();
  if (sub.provider !== provider.name) throw new ServiceError('CONFLICT', 'This subscription belongs to another payment provider than the one this app uses now.');
  if (!isLive(sub.status) || accessUntil(sub)!.getTime() <= now.getTime()) throw new ServiceError('CONFLICT', 'This subscription has ended.');
  if (sub.status === 'past_due') throw new ServiceError('CONFLICT', 'The renewal payment failed. The plan can change once the payment goes through.');
  if (sub.cancelAtPeriodEnd) throw new ServiceError('CONFLICT', 'This subscription is cancelled at the end of the period. Resume it first to change its plan.');
  if (sub.subjectUserId) {
    const [account] = await db.select({ accountType: authUser.accountType }).from(authUser).where(eq(authUser.id, sub.subjectUserId));
    if (account && !ofAccountType(sub, account.accountType)) throw new ServiceError('CONFLICT', `${PLANS[sub.planCode].name} is for another account type; it ends at the end of the period.`);
  }
  const inTrial = await inTrialPeriod(db, sub);
  const before = { planCode: sub.planCode, interval: sub.interval, scheduledPlanCode: sub.scheduledPlanCode, scheduledInterval: sub.scheduledInterval };
  // The current plan and period: takes back a scheduled change, or changes nothing.
  if (planCode === sub.planCode && interval === sub.interval) {
    if (!sub.scheduledPlanCode) return viewOf(sub, (await invoicesOf(db, [sub.id])).get(sub.id) ?? [], now, inTrial);
    return cancelChangeAt(p, sub, meta, now, before);
  }
  const option = changeOptionsOf(sub, now, inTrial).find((o) => o.planCode === planCode && o.interval === interval);
  if (!option) {
    if (planCode === sub.scheduledPlanCode && interval === sub.scheduledInterval) return viewOf(sub, (await invoicesOf(db, [sub.id])).get(sub.id) ?? [], now, inTrial);
    throw new ServiceError('BAD_REQUEST', `${PLANS[planCode].name} billed ${INTERVAL_NAMES[interval]} is not a plan this subscription can change to.`, { planCode: 'Choose one of the plans shown.' });
  }
  const price = billingPrice(planCode, interval)!;
  let snapshot: SubscriptionSnapshot;
  try {
    snapshot = await provider.changePlan(sub.providerSubscriptionId, { planCode, planName: PLANS[planCode].name, interval, amountCents: price.amountCents, currency: price.currency, when: option.when });
  } catch (error) {
    if (!(error instanceof BillingProviderError)) throw error;
    throw providerRefusal(error);
  }
  return applyAnswer(p, sub, provider.name, snapshot, meta, now, { action: 'billing.change_plan', before, after: { planCode, interval, when: option.when } });
}

/** Takes back a change scheduled for the period end (POST /api/v1/billing/cancel-change; M23). Audited. */
export async function cancelPlanChange(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<SubscriptionView> {
  const p = requireUser(principal);
  const parsed = subscriptionIdInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NOT_FOUND);
  const db = getDb();
  const sub = await ownSubscription(db, p, parsed.data.subscriptionId);
  if (billingProvider().name !== sub.provider) throw new ServiceError('CONFLICT', 'This subscription belongs to another payment provider than the one this app uses now.');
  if (!isLive(sub.status)) throw new ServiceError('CONFLICT', 'This subscription has ended.');
  const before = { planCode: sub.planCode, interval: sub.interval, scheduledPlanCode: sub.scheduledPlanCode, scheduledInterval: sub.scheduledInterval };
  if (!sub.scheduledPlanCode) return viewOf(sub, (await invoicesOf(db, [sub.id])).get(sub.id) ?? [], now, await inTrialPeriod(db, sub));
  return cancelChangeAt(p, sub, meta, now, before);
}

async function cancelChangeAt(p: Principal, sub: SubscriptionRow, meta: RequestMeta, now: Date, before: Record<string, unknown>): Promise<SubscriptionView> {
  const provider = billingProvider();
  let snapshot: SubscriptionSnapshot;
  try {
    snapshot = await provider.cancelScheduledChange(sub.providerSubscriptionId);
  } catch (error) {
    if (!(error instanceof BillingProviderError)) throw error;
    throw providerRefusal(error);
  }
  return applyAnswer(p, sub, provider.name, snapshot, meta, now, { action: 'billing.cancel_change', before, after: { scheduledPlanCode: null, scheduledInterval: null } });
}

// --- applying provider state ------------------------------------------------------------------------

export type ApplyOutcome = 'applied' | 'stale' | 'unknown' | 'mismatch' | 'ignored' | 'conflict';

export interface ApplyResult {
  outcome: ApplyOutcome;
  subscriptionId: string | null;
  /** The plan's audience whose public answers change (a Sifu's school pins: DEFAULT D08/D18). */
  touchesSchools: boolean;
  /**
   * A live provider subscription that may not become a plan here (its checkout was replaced or
   * expired by a change of the account type, or the subject already has a live subscription): the
   * provider ends it at once, so it is never charged again (DEFAULT M22, question 7).
   */
  cancelAtProvider?: string;
}

const NO_CHANGE = (outcome: ApplyOutcome, subscriptionId: string | null = null): ApplyResult => ({ outcome, subscriptionId, touchesSchools: false });
/** A new provider subscription the app refuses: a live one is ended at the provider; an ended one changes nothing. */
const REFUSED = (snap: SubscriptionSnapshot): ApplyResult => (isLive(snap.status) ? { ...NO_CHANGE('conflict'), cancelAtProvider: snap.id } : NO_CHANGE('ignored'));

/**
 * Who hears of a subscription: the account; for an organization (M23), every current admin of it
 * (its owners decide, its admins read the billing page), or else the owner who bought it.
 */
async function recipientsOf(tx: Executor, sub: SubscriptionRow): Promise<string[]> {
  if (sub.subjectUserId) return [sub.subjectUserId];
  const admins = await adminIdsOf(tx, sub.subjectOrganizationId!);
  if (admins.length > 0) return admins;
  if (!sub.checkoutId) return [];
  const [row] = await tx.select({ userId: billingCheckout.createdByUserId }).from(billingCheckout).where(eq(billingCheckout.id, sub.checkoutId));
  return row ? [row.userId] : [];
}

/**
 * The plan grant of a subscription follows its access: created by the first live state, its end
 * moved to accessUntil() afterwards; never a second grant, never un-revoked (an admin's revocation
 * stands), never another source's grant.
 */
async function syncGrant(tx: Transaction, sub: SubscriptionRow, now: Date): Promise<{ changed: boolean; grantId: string | null }> {
  const until = accessUntil(sub);
  if (until === null) return { changed: false, grantId: sub.grantId };
  if (sub.grantId) {
    const [grant] = await tx.select().from(entitlementGrant).where(eq(entitlementGrant.id, sub.grantId)).for('update');
    if (!grant || grant.revokedAt !== null || grant.source !== 'stripe') return { changed: false, grantId: sub.grantId };
    const end = new Date(Math.max(until.getTime(), grant.startsAt.getTime() + 1000));
    if (grant.endsAt?.getTime() === end.getTime()) return { changed: false, grantId: grant.id };
    await tx.update(entitlementGrant).set({ endsAt: end, updatedAt: now }).where(eq(entitlementGrant.id, grant.id));
    return { changed: true, grantId: grant.id };
  }
  if (!isLive(sub.status) || until.getTime() <= now.getTime()) return { changed: false, grantId: null };
  const startsAt = new Date(Math.min(sub.currentPeriodStart.getTime(), now.getTime()));
  const [grant] = await tx
    .insert(entitlementGrant)
    .values({
      subjectUserId: sub.subjectUserId,
      subjectOrganizationId: sub.subjectOrganizationId,
      planCode: sub.planCode,
      // DEFAULT M22 (question 10): the paid source of both providers, as the technical plan foresees ('stripe').
      source: 'stripe',
      startsAt,
      endsAt: new Date(Math.max(until.getTime(), startsAt.getTime() + 1000)),
      grantedByUserId: null,
      reason: `Subscription ${sub.providerSubscriptionId} (${sub.provider === 'test' ? 'test provider' : 'Stripe test mode'}; no real charge)`,
    })
    .returning({ id: entitlementGrant.id });
  await tx.update(billingSubscription).set({ grantId: grant!.id }).where(eq(billingSubscription.id, sub.id));
  await writeAudit(tx, {
    action: 'grant.create',
    actorUserId: null,
    actorRole: null,
    subjectType: 'entitlement_grant',
    subjectId: grant!.id,
    after: { source: 'stripe', planCode: sub.planCode, subscriptionId: sub.id, startsAt: startsAt.toISOString(), endsAt: until.toISOString() },
    reason: 'A paid subscription in test mode',
  });
  return { changed: true, grantId: grant!.id };
}

/** The notices of a change of state (DEFAULT M22, question 6: billing category, e-mail never off). */
async function noticesOf(tx: Transaction, before: SubscriptionRow | null, after: SubscriptionRow, boss?: NoticeProducer): Promise<void> {
  const recipients = await recipientsOf(tx, after);
  if (recipients.length === 0) return;
  const base = { subscriptionId: after.id, planCode: after.planCode, ...(after.subjectOrganizationId ? { organizationId: after.subjectOrganizationId } : {}) };
  const send = async (kind: Parameters<typeof notify>[2], payload: Record<string, unknown>, key: string) => {
    // An account's own subscription keeps M22's keys; an organization's admins share one.
    if (!after.subjectOrganizationId) await notify(tx, recipients[0]!, kind, { ...base, ...payload }, { key, boss });
    else await notifyEach(tx, recipients, kind, { ...base, ...payload }, { key, boss });
  };
  const was = before?.status ?? null;
  if (!before && isLive(after.status)) {
    await send('billing.started', { renewsOn: after.currentPeriodEnd.toISOString(), cancelAtPeriodEnd: after.cancelAtPeriodEnd }, `billing.started:${after.id}`);
  }
  if (before && isLive(after.status)) {
    if (!before.cancelAtPeriodEnd && after.cancelAtPeriodEnd) await send('billing.cancel-scheduled', { endsOn: (accessUntil(after) ?? after.currentPeriodEnd).toISOString() }, `billing.cancel-scheduled:${after.id}:${after.providerVersion}`);
    if (before.cancelAtPeriodEnd && !after.cancelAtPeriodEnd) await send('billing.resumed', { renewsOn: after.currentPeriodEnd.toISOString() }, `billing.resumed:${after.id}:${after.providerVersion}`);
  }
  if (was !== 'past_due' && after.status === 'past_due') {
    await send('billing.payment-failed', { accessUntil: accessUntil(after)!.toISOString() }, `billing.payment-failed:${after.id}:${after.pastDueSince!.toISOString()}`);
  }
  if (was === 'past_due' && after.status === 'active') {
    await send('billing.payment-recovered', { renewsOn: after.currentPeriodEnd.toISOString() }, `billing.payment-recovered:${after.id}:${after.providerVersion}`);
  }
  // M23: a change of plan or billing period, now or scheduled for the period end.
  if (before && isLive(after.status) && (before.planCode !== after.planCode || before.interval !== after.interval)) {
    await send('billing.plan-changed', { interval: after.interval, renewsOn: after.currentPeriodEnd.toISOString() }, `billing.plan-changed:${after.id}:${after.providerVersion}`);
  }
  if (before && isLive(after.status) && after.scheduledPlanCode && after.scheduledInterval && (before.scheduledPlanCode !== after.scheduledPlanCode || before.scheduledInterval !== after.scheduledInterval)) {
    await send(
      'billing.change-scheduled',
      { toPlanCode: after.scheduledPlanCode, interval: after.scheduledInterval, startsOn: after.currentPeriodEnd.toISOString() },
      `billing.change-scheduled:${after.id}:${after.providerVersion}`,
    );
  }
  // A cancellation at the period end is announced when it is made and, at its end, by the plan
  // notices of M18 (plan.expiring, plan.expired); any other end is said here.
  if (was !== 'canceled' && after.status === 'canceled' && after.endReason !== 'canceled') {
    await send('billing.ended', { endedAt: after.endedAt!.toISOString(), reason: after.endReason }, `billing.ended:${after.id}`);
  }
}

/**
 * Applies one provider snapshot of a subscription, under the row locks of the subscription (and of
 * the account, for a new one). The subject always comes from the app's own checkout; a snapshot that
 * names another subject's customer or checkout changes nothing.
 */
export async function applySnapshot(
  tx: Transaction,
  provider: 'test' | 'stripe',
  snap: SubscriptionSnapshot,
  now: Date,
  context: { at: Date; boss?: NoticeProducer },
): Promise<ApplyResult> {
  const [existing] = await tx
    .select()
    .from(billingSubscription)
    .where(and(eq(billingSubscription.provider, provider), eq(billingSubscription.providerSubscriptionId, snap.id)))
    .for('update');
  const [checkout] = snap.checkoutRef
    ? await tx.select().from(billingCheckout).where(and(eq(billingCheckout.id, snap.checkoutRef), eq(billingCheckout.provider, provider)))
    : [];
  const [customer] = await tx
    .select()
    .from(billingCustomer)
    .where(and(eq(billingCustomer.provider, provider), eq(billingCustomer.providerCustomerId, snap.customerId)));
  const at = new Date(Math.min(context.at.getTime(), now.getTime()));

  if (!existing) {
    if (!checkout) return NO_CHANGE('unknown');
    if (snap.status === 'incomplete') return NO_CHANGE('ignored');
    const subject = subjectOf(checkout);
    if (customer && !sameSubject(subjectOf(customer), subject)) return NO_CHANGE('mismatch');
    if (checkout.providerSubscriptionId && checkout.providerSubscriptionId !== snap.id) return NO_CHANGE('mismatch');
    // A checkout that was replaced, or expired by a change of the account type, never becomes a plan.
    if (checkout.status === 'expired') return REFUSED(snap);
    if (subject.userId) await lockAccount(tx, { id: subject.userId });
    // The checkout's state as of the account lock (a change of the account type takes it too).
    const [current] = await tx.select({ status: billingCheckout.status }).from(billingCheckout).where(eq(billingCheckout.id, checkout.id));
    if (current?.status === 'expired') return REFUSED(snap);
    let customerRow = customer;
    if (!customerRow) {
      const [other] = await tx
        .select()
        .from(billingCustomer)
        .where(
          and(
            eq(billingCustomer.provider, provider),
            subject.userId ? eq(billingCustomer.subjectUserId, subject.userId) : eq(billingCustomer.subjectOrganizationId, subject.organizationId!),
          ),
        );
      // The subject has another customer at this provider: not the one the app sent.
      if (other) return NO_CHANGE('mismatch');
      [customerRow] = await tx
        .insert(billingCustomer)
        .values({ provider, providerCustomerId: snap.customerId, subjectUserId: subject.userId, subjectOrganizationId: subject.organizationId })
        .returning();
    }
    if (await liveSubscriptionOf(tx, subject)) return REFUSED(snap);
    const canceled = snap.status === 'canceled';
    const [created] = await tx
      .insert(billingSubscription)
      .values({
        provider,
        providerSubscriptionId: snap.id,
        customerId: customerRow!.id,
        checkoutId: checkout.id,
        subjectUserId: subject.userId,
        subjectOrganizationId: subject.organizationId,
        planCode: checkout.planCode,
        interval: snap.interval,
        status: snap.status,
        cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
        currentPeriodStart: snap.currentPeriodStart,
        currentPeriodEnd: snap.currentPeriodEnd,
        pastDueSince: snap.status === 'past_due' ? at : null,
        endedAt: canceled ? (snap.endedAt ?? at) : null,
        endReason: canceled ? 'provider' : null,
        providerVersion: snap.version,
        scheduledPlanCode: snap.scheduledChange?.planCode ?? null,
        scheduledInterval: snap.scheduledChange?.interval ?? null,
      })
      .returning();
    await tx
      .update(billingCheckout)
      .set({ status: 'completed', completedAt: now, providerSubscriptionId: snap.id, updatedAt: now })
      .where(and(eq(billingCheckout.id, checkout.id), sql`${billingCheckout.status} <> 'completed'`));
    const grant = await syncGrant(tx, created!, now);
    const fresh = { ...created!, grantId: grant.grantId };
    await auditState(tx, null, fresh);
    if (fresh.subjectOrganizationId && isLive(fresh.status)) await convertTrial(tx, fresh, now);
    await noticesOf(tx, null, fresh, context.boss);
    return { outcome: 'applied', subscriptionId: created!.id, touchesSchools: grant.changed && PLANS[created!.planCode].audience === 'sifu' };
  }

  // The customer and the checkout must be this subscription's own.
  const [own] = await tx.select().from(billingCustomer).where(eq(billingCustomer.id, existing.customerId));
  if (!own || own.providerCustomerId !== snap.customerId) return NO_CHANGE('mismatch', existing.id);
  if (checkout && !sameSubject(subjectOf(checkout), subjectOf(existing))) return NO_CHANGE('mismatch', existing.id);
  // An ended subscription stays ended; an older state never overwrites a newer one.
  if (existing.status === 'canceled' || snap.version < existing.providerVersion) return NO_CHANGE('stale', existing.id);
  if (snap.status === 'incomplete') return NO_CHANGE('ignored', existing.id);

  const canceled = snap.status === 'canceled';
  const endReason = canceled ? (existing.cancelAtPeriodEnd || snap.cancelAtPeriodEnd ? 'canceled' : existing.status === 'past_due' ? 'unpaid' : 'provider') : null;
  // M23: the plan the provider bills now; a new plan ends the old plan's grant now and starts its own.
  const planCode = snap.planCode && PLANS[snap.planCode].audience === PLANS[existing.planCode].audience ? snap.planCode : existing.planCode;
  const planChanged = planCode !== existing.planCode;
  if (planChanged && existing.grantId) await endGrantNow(tx, existing.grantId, now);
  const scheduled =
    snap.scheduledChange === undefined
      ? { scheduledPlanCode: existing.scheduledPlanCode, scheduledInterval: existing.scheduledInterval }
      : { scheduledPlanCode: snap.scheduledChange?.planCode ?? null, scheduledInterval: snap.scheduledChange?.interval ?? null };
  const next = {
    planCode,
    ...(canceled ? { scheduledPlanCode: null, scheduledInterval: null } : scheduled),
    ...(planChanged ? { grantId: null } : {}),
    interval: snap.interval,
    status: snap.status,
    cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
    currentPeriodStart: snap.currentPeriodStart,
    currentPeriodEnd: snap.currentPeriodEnd,
    pastDueSince: snap.status === 'past_due' ? (existing.pastDueSince ?? at) : null,
    endedAt: canceled ? (snap.endedAt ?? at) : null,
    endReason,
    providerVersion: snap.version,
    updatedAt: now,
  } satisfies Partial<SubscriptionRow>;
  const [updated] = await tx.update(billingSubscription).set(next).where(eq(billingSubscription.id, existing.id)).returning();
  const grant = await syncGrant(tx, updated!, now);
  const fresh = { ...updated!, grantId: grant.grantId };
  if (
    existing.status !== fresh.status ||
    existing.cancelAtPeriodEnd !== fresh.cancelAtPeriodEnd ||
    existing.currentPeriodEnd.getTime() !== fresh.currentPeriodEnd.getTime() ||
    existing.planCode !== fresh.planCode ||
    existing.interval !== fresh.interval ||
    existing.scheduledPlanCode !== fresh.scheduledPlanCode ||
    existing.scheduledInterval !== fresh.scheduledInterval
  ) {
    await auditState(tx, existing, fresh);
  }
  await noticesOf(tx, existing, fresh, context.boss);
  return { outcome: 'applied', subscriptionId: existing.id, touchesSchools: (grant.changed || planChanged) && PLANS[existing.planCode].audience === 'sifu' };
}

/** M23: a subscription's grant of its earlier plan ends now (a change of plan); an admin's revocation stands. */
async function endGrantNow(tx: Transaction, grantId: string, now: Date): Promise<void> {
  const [grant] = await tx.select().from(entitlementGrant).where(eq(entitlementGrant.id, grantId)).for('update');
  if (!grant || grant.revokedAt !== null || grant.source !== 'stripe') return;
  const end = new Date(Math.max(now.getTime(), grant.startsAt.getTime() + 1000));
  if (grant.endsAt && grant.endsAt.getTime() <= end.getTime()) return;
  await tx.update(entitlementGrant).set({ endsAt: end, updatedAt: now }).where(eq(entitlementGrant.id, grantId));
}

/**
 * M23 (specification §10.2): an organization that subscribes during its Federation trial continues
 * it: the trial is converted, its complimentary grant ends now, and the subscription's own grant
 * carries Federation on (its first period ends with the trial and costs nothing).
 */
async function convertTrial(tx: Transaction, sub: SubscriptionRow, now: Date): Promise<void> {
  const [trial] = await tx
    .select()
    .from(federationTrial)
    .where(and(eq(federationTrial.organizationId, sub.subjectOrganizationId!), eq(federationTrial.status, 'active')))
    .for('update');
  if (!trial) return;
  await tx.update(federationTrial).set({ status: 'converted', endedAt: now, convertedSubscriptionId: sub.id, updatedAt: now }).where(eq(federationTrial.id, trial.id));
  if (trial.grantId) {
    const [grant] = await tx.select().from(entitlementGrant).where(eq(entitlementGrant.id, trial.grantId)).for('update');
    if (grant && grant.revokedAt === null && (grant.endsAt === null || grant.endsAt.getTime() > now.getTime())) {
      await tx
        .update(entitlementGrant)
        .set({ endsAt: new Date(Math.max(now.getTime(), grant.startsAt.getTime() + 1000)), updatedAt: now })
        .where(eq(entitlementGrant.id, grant.id));
    }
  }
  await writeAudit(tx, {
    action: 'federation_trial.convert',
    actorUserId: null,
    actorRole: null,
    subjectType: 'federation_trial',
    subjectId: trial.id,
    before: { status: 'active', endsAt: trial.endsAt.toISOString() },
    after: { status: 'converted', subscriptionId: sub.id, organizationId: trial.organizationId },
  });
}

async function auditState(tx: Transaction, before: SubscriptionRow | null, after: SubscriptionRow): Promise<void> {
  const state = (s: SubscriptionRow) => ({
    status: s.status,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    endReason: s.endReason,
    providerVersion: s.providerVersion,
    planCode: s.planCode,
    interval: s.interval,
    scheduledPlanCode: s.scheduledPlanCode,
    scheduledInterval: s.scheduledInterval,
  });
  await writeAudit(tx, {
    action: 'billing.subscription',
    actorUserId: null,
    actorRole: null,
    subjectType: 'billing_subscription',
    subjectId: after.id,
    before: before ? state(before) : null,
    after: { ...state(after), provider: after.provider, grantId: after.grantId },
  });
}

/** Records an invoice of a known subscription; a paid invoice is never turned back to failed. */
async function recordInvoice(tx: Transaction, provider: 'test' | 'stripe', invoice: Extract<NormalizedEvent, { kind: 'invoice' }>['invoice']): Promise<ApplyResult> {
  const [sub] = await tx
    .select({ id: billingSubscription.id })
    .from(billingSubscription)
    .where(and(eq(billingSubscription.provider, provider), eq(billingSubscription.providerSubscriptionId, invoice.subscriptionId)));
  if (!sub) return NO_CHANGE('unknown');
  await tx
    .insert(billingInvoice)
    .values({
      subscriptionId: sub.id,
      provider,
      providerInvoiceId: invoice.id,
      status: invoice.status,
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      issuedAt: invoice.issuedAt,
    })
    .onConflictDoUpdate({
      target: [billingInvoice.provider, billingInvoice.providerInvoiceId],
      set: { status: sql`CASE WHEN ${billingInvoice.status} = 'paid' THEN 'paid' ELSE excluded.status END`, updatedAt: new Date() },
      // Only the subscription it was first recorded for.
      setWhere: eq(billingInvoice.subscriptionId, sub.id),
    });
  return { outcome: 'applied', subscriptionId: sub.id, touchesSchools: false };
}

/** The stored normalized event, with its dates read back from JSON. */
function revive(stored: unknown): NormalizedEvent {
  const dates = new Set(['currentPeriodStart', 'currentPeriodEnd', 'endedAt', 'periodStart', 'periodEnd', 'issuedAt']);
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, dates.has(k) && typeof v === 'string' ? new Date(v) : walk(v)]));
    }
    return value;
  };
  return walk(stored) as NormalizedEvent;
}

/** Thrown inside the job's transaction when an event's subscription is not known yet: the job retries. */
export class BillingEventNotReady extends Error {
  constructor() {
    super('The subscription of this billing event is not known yet.');
    this.name = 'BillingEventNotReady';
  }
}

export interface AppliedEvent {
  outcome: ApplyOutcome | 'duplicate';
  touchesSchools: boolean;
}

/**
 * Applies one stored provider event (the job billing.event), once: under the event row's lock, an
 * event already processed is a repeat and changes nothing. With `final` false, an event whose
 * subscription the app does not know yet (an invoice before its subscription) throws
 * BillingEventNotReady, so the job tries again later; the last attempt records it as `unknown`.
 */
export async function applyStoredEvent(eventId: string, options: { final?: boolean; boss?: NoticeProducer; now?: Date } = {}): Promise<AppliedEvent> {
  const now = options.now ?? new Date();
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(billingEvent).where(eq(billingEvent.id, eventId)).for('update');
    if (!row || row.processedAt) return { outcome: 'duplicate', touchesSchools: false };
    const event = revive(row.normalized);
    const ctx = { at: row.providerCreatedAt, boss: options.boss };
    let result: ApplyResult;
    if (event.kind === 'subscription') {
      result = await applySnapshot(tx, row.provider, event.subscription, now, ctx);
    } else if (event.kind === 'invoice') {
      const snap = event.subscription ? await applySnapshot(tx, row.provider, event.subscription, now, ctx) : null;
      const invoice = await recordInvoice(tx, row.provider, event.invoice);
      result = snap && snap.outcome !== 'applied' && invoice.outcome !== 'applied' ? snap : invoice.outcome === 'applied' ? { ...invoice, touchesSchools: snap?.touchesSchools ?? false } : (snap ?? invoice);
    } else if (event.kind === 'checkout') {
      // Stripe's checkout.session.completed: the subscription's own events carry its state; here the
      // checkout learns its subscription (a checkout of another subject cannot take this one).
      const [checkout] = await tx.select().from(billingCheckout).where(and(eq(billingCheckout.id, event.checkoutRef), eq(billingCheckout.provider, row.provider)));
      if (!checkout) result = NO_CHANGE('unknown');
      else if (checkout.providerSubscriptionId && event.subscriptionId && checkout.providerSubscriptionId !== event.subscriptionId) result = NO_CHANGE('mismatch');
      else {
        // A replaced checkout stays expired: its subscription is refused when its events arrive.
        const expired = checkout.status === 'expired';
        await tx
          .update(billingCheckout)
          .set({
            status: expired ? 'expired' : 'completed',
            completedAt: expired ? null : (checkout.completedAt ?? now),
            providerSubscriptionId: event.subscriptionId ?? checkout.providerSubscriptionId,
            updatedAt: now,
          })
          .where(eq(billingCheckout.id, checkout.id));
        result = NO_CHANGE(expired ? 'conflict' : 'applied');
      }
    } else {
      result = NO_CHANGE('ignored');
    }
    if (result.outcome === 'unknown' && options.final === false) throw new BillingEventNotReady();
    if (result.cancelAtProvider) {
      // Ended at the provider before the event counts as processed: a failure retries the job; the
      // last attempt records the event (the administrator sees it among the unmatched ones).
      const provider = billingProvider();
      try {
        if (provider.name !== row.provider) throw new BillingProviderError('unsupported', 'The event is of another provider than the one this app uses now.');
        await provider.cancelNow(result.cancelAtProvider);
      } catch (error) {
        if (!(error instanceof BillingProviderError)) throw error;
        if (error.code !== 'not_found' && options.final === false) throw error;
        if (error.code !== 'not_found') logger().error(`[billing] event ${row.providerEventId}: the refused subscription could not be ended at the provider (${error.code})`);
      }
    }
    await tx
      .update(billingEvent)
      .set({ outcome: result.outcome, processedAt: now, subscriptionId: result.subscriptionId, updatedAt: now })
      .where(eq(billingEvent.id, row.id));
    return { outcome: result.outcome, touchesSchools: result.touchesSchools };
  });
}

// --- the end of the grace (job billing.grace) --------------------------------------------------------

/**
 * Ends the subscriptions whose renewal failed BILLING_GRACE_DAYS ago or more (DEFAULT M22, question
 * 5): the subscription ends at the end of its grace, its grant with it, the account hears of it, and
 * the provider is asked to end it too (so nothing is charged later; its event is then a repeat).
 */
export async function endExpiredGrace(options: { now?: Date; boss?: NoticeProducer } = {}): Promise<{ ended: number; touchesSchools: boolean }> {
  const now = options.now ?? new Date();
  const db = getDb();
  const due = await db
    .select({ id: billingSubscription.id })
    .from(billingSubscription)
    .where(and(eq(billingSubscription.status, 'past_due'), lte(billingSubscription.pastDueSince, new Date(now.getTime() - BILLING_GRACE_DAYS * DAY_MS))));
  let ended = 0;
  let touchesSchools = false;
  for (const { id } of due) {
    const done = await db.transaction(async (tx) => {
      const [sub] = await tx.select().from(billingSubscription).where(eq(billingSubscription.id, id)).for('update');
      if (!sub || sub.status !== 'past_due') return null;
      const end = accessUntil(sub)!;
      if (end.getTime() > now.getTime()) return null;
      // The provider ends it first, so nothing is charged later. If it does not answer, nothing
      // changes here and the next hourly run asks again (access ended at accessUntil anyway).
      const provider = billingProvider();
      if (provider.name === sub.provider) {
        try {
          await provider.cancelNow(sub.providerSubscriptionId);
        } catch (error) {
          if (!(error instanceof BillingProviderError) || error.code === 'unavailable') {
            logger().warn(`[billing] grace end of subscription ${sub.id}: the provider did not answer; the next run tries again`);
            return null;
          }
        }
      }
      const [updated] = await tx
        .update(billingSubscription)
        .set({ status: 'canceled', endedAt: end, endReason: 'unpaid', cancelAtPeriodEnd: false, scheduledPlanCode: null, scheduledInterval: null, updatedAt: now })
        .where(eq(billingSubscription.id, id))
        .returning();
      const grant = await syncGrant(tx, updated!, now);
      const fresh = { ...updated!, grantId: grant.grantId };
      await auditState(tx, sub, fresh);
      await writeAudit(tx, { action: 'billing.grace_end', actorUserId: null, actorRole: null, subjectType: 'billing_subscription', subjectId: id, after: { endedAt: end.toISOString() } });
      await noticesOf(tx, sub, fresh, options.boss);
      return { sifu: PLANS[sub.planCode].audience === 'sifu' };
    });
    if (!done) continue;
    ended += 1;
    touchesSchools ||= done.sifu;
  }
  return { ended, touchesSchools };
}

// --- staff (billing.adminList, billing.adminGet, billing.testClock) ----------------------------------

export const BILLING_ADMIN_PAGE_SIZE = 25;
export const billingAdminListInput = z.object({
  status: z.enum(BILLING_SUBSCRIPTION_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export interface AdminSubscriptionRow {
  id: string;
  provider: 'test' | 'stripe';
  /** The account's e-mail address, or the organization's name. */
  holder: string;
  planName: string;
  status: Status;
  statusLabel: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string;
  accessUntil: string | null;
  events: number;
  createdAt: string;
}

export interface AdminSubscriptionList {
  rows: AdminSubscriptionRow[];
  total: number;
  page: number;
  pages: number;
  status: Status | null;
  /** Events the app could not tie to a subscription (unknown, mismatch, conflict), the newest first. */
  unmatched: AdminEventRow[];
}

export interface AdminEventRow {
  id: string;
  providerEventId: string;
  providerType: string;
  outcome: string;
  providerCreatedAt: string;
  receivedAt: string;
  processedAt: string | null;
}

const eventRow = (e: typeof billingEvent.$inferSelect): AdminEventRow => ({
  id: e.id,
  providerEventId: e.providerEventId,
  providerType: e.providerType,
  outcome: e.outcome,
  providerCreatedAt: e.providerCreatedAt.toISOString(),
  receivedAt: e.receivedAt.toISOString(),
  processedAt: e.processedAt?.toISOString() ?? null,
});

/** The subscriptions, newest first (GET /api/v1/admin/billing; admin with a verified second factor). */
export async function adminBillingList(principal: Principal | null, raw: unknown = {}, now: Date = new Date()): Promise<AdminSubscriptionList> {
  requireStaff2FA(principal, ['admin']);
  const parsed = billingAdminListInput.safeParse(raw ?? {});
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the filter.');
  const status = parsed.data.status ?? null;
  const page = parsed.data.page ?? 1;
  const db = getDb();
  const where = status ? eq(billingSubscription.status, status) : undefined;
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(billingSubscription).where(where);
  const events = db
    .select({ subscriptionId: billingEvent.subscriptionId, n: count().as('n') })
    .from(billingEvent)
    .groupBy(billingEvent.subscriptionId)
    .as('events');
  const rows = await db
    .select({ sub: billingSubscription, email: authUser.email, orgName: organization.name, events: events.n })
    .from(billingSubscription)
    .leftJoin(authUser, eq(authUser.id, billingSubscription.subjectUserId))
    .leftJoin(organization, eq(organization.id, billingSubscription.subjectOrganizationId))
    .leftJoin(events, eq(events.subscriptionId, billingSubscription.id))
    .where(where)
    .orderBy(desc(billingSubscription.createdAt), desc(billingSubscription.id))
    .limit(BILLING_ADMIN_PAGE_SIZE)
    .offset((page - 1) * BILLING_ADMIN_PAGE_SIZE);
  const unmatched = await db
    .select()
    .from(billingEvent)
    .where(inArray(billingEvent.outcome, ['unknown', 'mismatch', 'conflict']))
    .orderBy(desc(billingEvent.receivedAt))
    .limit(20);
  return {
    rows: rows.map(({ sub, email, orgName, events: n }) => {
      const view = viewOf(sub, [], now);
      return {
        id: sub.id,
        provider: sub.provider,
        holder: email ?? orgName ?? '—',
        planName: view.planName,
        status: sub.status,
        statusLabel: view.statusLabel,
        cancelAtPeriodEnd: view.cancelAtPeriodEnd,
        currentPeriodEnd: view.currentPeriodEnd,
        accessUntil: view.accessUntil,
        events: Number(n ?? 0),
        createdAt: sub.createdAt.toISOString(),
      };
    }),
    total: n,
    page,
    pages: Math.max(1, Math.ceil(n / BILLING_ADMIN_PAGE_SIZE)),
    status,
    unmatched: unmatched.map(eventRow),
  };
}

export interface AdminSubscriptionDetail {
  subscription: SubscriptionView & { holder: string; providerSubscriptionId: string; providerVersion: number; grantId: string | null; createdAt: string };
  /** Every stored event of the subscription, oldest first: read-only. */
  events: AdminEventRow[];
  /** The test clock is offered for a live subscription of the test provider, when it is this app's provider. */
  testClock: { available: boolean; steps: { step: 'period_end' | 'grace_end'; label: string }[] };
}

const CLOCK_STEPS = [
  { step: 'period_end', label: 'Move to the end of the period' },
  { step: 'grace_end', label: 'Move to the end of the grace period' },
] as const;

/** One subscription and its event history (GET /api/v1/admin/billing/{subscriptionId}). */
export async function adminBillingGet(principal: Principal | null, raw: unknown, now: Date = new Date()): Promise<AdminSubscriptionDetail> {
  requireStaff2FA(principal, ['admin']);
  const parsed = subscriptionIdInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NOT_FOUND);
  const db = getDb();
  const [row] = await db
    .select({ sub: billingSubscription, email: authUser.email, orgName: organization.name })
    .from(billingSubscription)
    .leftJoin(authUser, eq(authUser.id, billingSubscription.subjectUserId))
    .leftJoin(organization, eq(organization.id, billingSubscription.subjectOrganizationId))
    .where(eq(billingSubscription.id, parsed.data.subscriptionId));
  if (!row) throw new ServiceError('NOT_FOUND', NOT_FOUND);
  const invoices = await invoicesOf(db, [row.sub.id]);
  const events = await db.select().from(billingEvent).where(eq(billingEvent.subscriptionId, row.sub.id)).orderBy(billingEvent.providerCreatedAt, billingEvent.receivedAt, billingEvent.id);
  const live = isLive(row.sub.status);
  const available = live && row.sub.provider === 'test' && billingProvider().name === 'test';
  return {
    subscription: {
      ...viewOf(row.sub, invoices.get(row.sub.id) ?? [], now),
      holder: row.email ?? row.orgName ?? '—',
      providerSubscriptionId: row.sub.providerSubscriptionId,
      providerVersion: row.sub.providerVersion,
      grantId: row.sub.grantId,
      createdAt: row.sub.createdAt.toISOString(),
    },
    events: events.map(eventRow),
    testClock: { available, steps: CLOCK_STEPS.filter((s) => s.step === 'period_end' || row.sub.status === 'past_due').map((s) => ({ ...s })) },
  };
}

export const testClockInput = z.object({
  subscriptionId: z.uuid({ error: NOT_FOUND }),
  step: z.enum(['period_end', 'grace_end'], { error: 'Choose what the test clock moves to.' }),
});

/**
 * The test clock (POST /api/v1/admin/billing/test-clock; admin with a verified second factor, or the
 * CLI): the test provider moves one live subscription to the end of its period (a renewal, paid or
 * failed, or the end of a cancelled subscription) or to the end of its grace. Its events reach the
 * webhook and the job, as a real provider's would; nothing is applied here directly. Audited.
 */
export async function moveTestClock(principal: Principal | null, raw: unknown, meta: RequestMeta, now: Date = new Date()): Promise<{ subscriptionId: string; step: 'period_end' | 'grace_end' }> {
  const actor = requireStaff2FA(principal, ['admin']);
  const parsed = testClockInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { step: 'Choose what the test clock moves to.' });
  return runTestClock(parsed.data, { actorUserId: actor.user.id, actorRole: actor.user.role, meta, now });
}

/** The test clock itself, for the procedure above and `pnpm billing:test-clock` (local only). */
export async function runTestClock(
  input: { subscriptionId: string; step: 'period_end' | 'grace_end' },
  who: { actorUserId: string | null; actorRole: string | null; meta: RequestMeta; now?: Date },
): Promise<{ subscriptionId: string; step: 'period_end' | 'grace_end' }> {
  const db = getDb();
  const [sub] = await db.select().from(billingSubscription).where(eq(billingSubscription.id, input.subscriptionId));
  if (!sub) throw new ServiceError('NOT_FOUND', NOT_FOUND);
  const provider = testProvider();
  if (!provider || sub.provider !== 'test') throw new ServiceError('CONFLICT', 'The test clock moves only subscriptions of the test provider.');
  if (!isLive(sub.status)) throw new ServiceError('CONFLICT', 'This subscription has ended; the test clock has nothing to move.');
  if (input.step === 'grace_end' && sub.status !== 'past_due') throw new ServiceError('CONFLICT', 'Only a subscription whose renewal failed has a grace period to end.');
  try {
    await provider.advanceClock(sub.providerSubscriptionId, input.step, who.now ?? new Date());
  } catch (error) {
    if (error instanceof BillingProviderError) throw new ServiceError('CONFLICT', error.message);
    throw error;
  }
  await writeAudit(db, {
    action: 'billing.test_clock',
    actorUserId: who.actorUserId,
    actorRole: who.actorRole,
    subjectType: 'billing_subscription',
    subjectId: sub.id,
    after: { step: input.step },
    requestId: who.meta.requestId,
    ipHmac: who.meta.ipHmac,
  });
  return { subscriptionId: sub.id, step: input.step };
}
