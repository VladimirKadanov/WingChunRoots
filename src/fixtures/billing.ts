// The demo subscriptions in test mode (milestone M22, D20; docs/adr/0025-billing.md), loaded by
// `pnpm db:seed` after the other fixtures:
//
// - demo-premium-student: an active Premium Student subscription of the test provider, paid with
//   the test card that succeeds, renewing a month after it started.
// - demo-free-sifu-5: an earlier Professional Sifu subscription, cancelled at the end of its period,
//   which ended about 20 days before the seed: the account is back on Free Sifu, and the billing
//   page shows the ended subscription and its payment, every record kept (DEFAULT M22, question 9:
//   not demo-pro-sifu-8, whose only Pro grant must stay its test plan for the M08 downgrade test,
//   and not a running cancellation, which would make demo-free-sifu-5 a Professional Sifu now).
//
// demo-premium-student keeps its test plan of M17 unchanged (a grant with no end), so nothing a
// demo screen shows moves; the paid plan only adds a grant of the same plan (source 'stripe') and
// the billing page's subscription, payment history and provider events.
//
// Unlike the other fixtures, the dates follow the day of the seed: a subscription is current only
// around now, so the active period starts 10 days before the start of the seed's UTC day (its end
// then lies about 20 days ahead, so no plan-ending notice is due), and the ended one ran from 50 to
// about 20 days before it (an end older than the 7 days of plan.expired). The ids come from a stream of
// their own (seed ^ 0x0b11_0022) on a fixed base time, so no other fixture id moves and two seeds
// of the same day are identical (seed.ts, contentHash). Fictional throughout: no card, no address.

import type {
  billingCheckout,
  billingCustomer,
  billingEvent,
  billingInvoice,
  billingSubscription,
  billingTestSubscription,
  entitlementGrant,
} from '../server/db/schema';
import { uuidv7FromParts } from '../server/db/ids';
import { createRandom } from './random';

type Row<T extends { $inferInsert: object }> = Required<T['$inferInsert']>;

export interface DemoBilling {
  billingCustomers: Row<typeof billingCustomer>[];
  billingCheckouts: Row<typeof billingCheckout>[];
  billingTestSubscriptions: Row<typeof billingTestSubscription>[];
  entitlementGrants: Row<typeof entitlementGrant>[];
  billingSubscriptions: Row<typeof billingSubscription>[];
  billingInvoices: Row<typeof billingInvoice>[];
  billingEvents: Row<typeof billingEvent>[];
}

/** The fixed base of the ids (never a date shown anywhere). */
const BILLING_ID_BASE = Date.UTC(2026, 10, 11);
const DAY_MS = 24 * 60 * 60 * 1000;
/** Days before the seed's day that the active demo period starts. */
export const DEMO_BILLING_PERIOD_STARTED_DAYS = 10;
/** Days before the seed's day that the ended demo subscription started (it ended a month later). */
export const DEMO_BILLING_ENDED_STARTED_DAYS = 50;

/** One calendar month later, the last day of a shorter month when the day does not exist. */
function nextMonth(at: Date): Date {
  const next = new Date(at.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}

/** The start of the UTC day of `now`. */
export function seedDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The demo subscriptions of `accounts`, with dates around `day` (the start of a UTC day). */
export function demoBilling(seed: number, accounts: { premiumStudent: string; freeSifu: string }, day: Date): DemoBilling {
  const rng = createRandom((seed ^ 0x0b11_0022) >>> 0);
  let seq = 0;
  const id = () => uuidv7FromParts(BILLING_ID_BASE + seq++, 0, rng.bytes(8));
  const hex = (n: number) => Array.from(rng.bytes(n), (b) => b.toString(16).padStart(2, '0')).join('');
  const out: DemoBilling = {
    billingCustomers: [],
    billingCheckouts: [],
    billingTestSubscriptions: [],
    entitlementGrants: [],
    billingSubscriptions: [],
    billingInvoices: [],
    billingEvents: [],
  };
  const plans = [
    { userId: accounts.premiumStudent, planCode: 'premium_student' as const, amountCents: 400, startedDaysAgo: DEMO_BILLING_PERIOD_STARTED_DAYS, ended: false },
    { userId: accounts.freeSifu, planCode: 'pro_sifu' as const, amountCents: 1900, startedDaysAgo: DEMO_BILLING_ENDED_STARTED_DAYS, ended: true },
  ];
  for (const p of plans) {
    const start = new Date(day.getTime() - p.startedDaysAgo * DAY_MS + 9 * 3_600_000);
    const end = nextMonth(start);
    const cancel = p.ended;
    const customerId = id();
    const checkoutId = id();
    const grantId = id();
    const subscriptionId = id();
    const providerCustomer = `tcus_demo${hex(12)}`;
    const providerSubscription = `tsub_demo${hex(12)}`;
    const providerInvoice = `tin_demo${hex(12)}`;
    const version = p.ended ? 3 : 1;
    const paidAt = start;
    const cancelledAt = new Date(start.getTime() + 3 * DAY_MS);
    const updatedAt = p.ended ? end : paidAt;
    const status = p.ended ? ('canceled' as const) : ('active' as const);
    const times = { createdAt: paidAt, updatedAt };

    out.billingCustomers.push({ id: customerId, provider: 'test', providerCustomerId: providerCustomer, subjectUserId: p.userId, subjectOrganizationId: null, ...times, updatedAt: paidAt });
    out.billingCheckouts.push({
      id: checkoutId,
      provider: 'test',
      subjectUserId: p.userId,
      subjectOrganizationId: null,
      createdByUserId: p.userId,
      planCode: p.planCode,
      interval: 'month',
      amountCents: p.amountCents,
      currency: 'usd',
      status: 'completed',
      providerSessionId: null,
      providerSubscriptionId: providerSubscription,
      expiresAt: new Date(paidAt.getTime() + 3_600_000),
      completedAt: paidAt,
      createdAt: new Date(paidAt.getTime() - 60_000),
      updatedAt: paidAt,
    });
    out.billingTestSubscriptions.push({
      id: providerSubscription,
      customerId: providerCustomer,
      checkoutRef: checkoutId,
      planCode: p.planCode,
      interval: 'month',
      amountCents: p.amountCents,
      currency: 'usd',
      card: 'succeeds',
      status,
      cancelAtPeriodEnd: cancel,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      endedAt: p.ended ? end : null,
      version,
      ...times,
    });
    out.entitlementGrants.push({
      id: grantId,
      subjectUserId: p.userId,
      subjectOrganizationId: null,
      planCode: p.planCode,
      source: 'stripe',
      startsAt: start,
      endsAt: end,
      grantedByUserId: null,
      reason: `Subscription ${providerSubscription} (test provider; no real charge)`,
      revokedAt: null,
      revokedByUserId: null,
      revokeReason: null,
      createdAt: paidAt,
      updatedAt: paidAt,
    });
    out.billingSubscriptions.push({
      id: subscriptionId,
      provider: 'test',
      providerSubscriptionId: providerSubscription,
      customerId,
      checkoutId,
      subjectUserId: p.userId,
      subjectOrganizationId: null,
      planCode: p.planCode,
      interval: 'month',
      status,
      cancelAtPeriodEnd: cancel,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      pastDueSince: null,
      endedAt: p.ended ? end : null,
      endReason: p.ended ? 'canceled' : null,
      providerVersion: version,
      grantId,
      ...times,
    });
    out.billingInvoices.push({
      id: id(),
      subscriptionId,
      provider: 'test',
      providerInvoiceId: providerInvoice,
      status: 'paid',
      amountCents: p.amountCents,
      currency: 'usd',
      periodStart: start,
      periodEnd: end,
      issuedAt: paidAt,
      createdAt: paidAt,
      updatedAt: paidAt,
    });
    const wire = (at: Date, v: number, cancelled: boolean, ended: boolean) => ({
      id: providerSubscription,
      customer: providerCustomer,
      checkout_ref: checkoutId,
      status: ended ? 'canceled' : 'active',
      interval: 'month',
      cancel_at_period_end: cancelled,
      current_period_start: start.toISOString(),
      current_period_end: end.toISOString(),
      ended_at: ended ? end.toISOString() : null,
      version: v,
      created: at.toISOString(),
    });
    const event = (type: string, at: Date, v: number, cancelled: boolean, invoice: boolean, ended = false) => {
      const eventId = `tevt_demo${hex(12)}`;
      const subscription = {
        id: providerSubscription,
        customerId: providerCustomer,
        checkoutRef: checkoutId,
        status: ended ? 'canceled' : 'active',
        interval: 'month',
        cancelAtPeriodEnd: cancelled,
        currentPeriodStart: start.toISOString(),
        currentPeriodEnd: end.toISOString(),
        endedAt: ended ? end.toISOString() : null,
        version: v,
      };
      const invoiceData = { id: providerInvoice, subscription: providerSubscription, status: 'paid', amount: p.amountCents, currency: 'usd', period_start: start.toISOString(), period_end: end.toISOString(), created: at.toISOString() };
      out.billingEvents.push({
        id: id(),
        provider: 'test',
        providerEventId: eventId,
        providerType: type,
        normalized: invoice
          ? {
              kind: 'invoice',
              invoice: { id: providerInvoice, subscriptionId: providerSubscription, status: 'paid', amountCents: p.amountCents, currency: 'usd', periodStart: start.toISOString(), periodEnd: end.toISOString(), issuedAt: at.toISOString() },
              subscription,
            }
          : { kind: 'subscription', subscription },
        raw: { id: eventId, object: 'event', type, created: Math.floor(at.getTime() / 1000), livemode: false, data: { subscription: wire(at, v, cancelled, ended), ...(invoice ? { invoice: invoiceData } : {}) } },
        objectId: providerSubscription,
        outcome: 'applied',
        subscriptionId,
        providerCreatedAt: at,
        receivedAt: at,
        processedAt: new Date(at.getTime() + 2000),
        createdAt: at,
        updatedAt: new Date(at.getTime() + 2000),
      });
    };
    event('invoice.paid', paidAt, 1, false, true);
    event('subscription.created', paidAt, 1, false, false);
    if (p.ended) {
      event('subscription.updated', cancelledAt, 2, true, false);
      event('subscription.deleted', end, 3, true, false, true);
    }
  }
  return out;
}
