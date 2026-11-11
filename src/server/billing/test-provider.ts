// The test provider (milestone M22; docs/adr/0025-billing.md): a local stand-in for a payment
// provider, the default and the only one CI uses. Test mode, no real charge, ever.
//
// - Its checkout is a page of the app, /billing/test-checkout/<checkout id>, labelled "Test mode, no
//   real charge" everywhere. The payer picks one of three test cards (BILLING_TEST_CARDS): one that
//   succeeds, one that is declined (nothing is created, no event), and one that succeeds now and
//   fails at the first renewal. No card number is ever typed, sent or stored.
// - It keeps its own side of each subscription in billing_test_subscription (what a real provider
//   would hold), with a version that grows on every change.
// - Every change is told to the app as an HMAC-signed event (X-WCR-Test-Signature, the scheme of
//   signature.ts) posted to the same webhook handler a real provider reaches
//   (src/server/billing/webhook.ts, POST /api/billing/webhook), in this process, after its own
//   change has committed. The handler verifies it, stores it and queues the job that applies it.
// - The test clock (advanceClock) simulates time for one subscription: "the end of the period" (a
//   renewal, paid or failed, or the end of a subscription cancelled at the period end) and "the end
//   of the grace" (the last retry of a past-due renewal fails and the subscription ends). It moves
//   the subscription's own period back so that the moment is now, so the app's real clock decides
//   access as it would after the time had passed.

import { randomBytes } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { appUrl } from '../auth/env';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { billingTestSubscription } from '../db/schema';
import { logger } from '../log';
import { testWebhookSecret } from './config';
import { redactEvent } from './redact';
import { signPayload, verifySignature } from './signature';
import {
  type BillingInterval,
  type BillingProvider,
  BillingProviderError,
  type CheckoutRequest,
  type InvoiceSnapshot,
  type NormalizedEvent,
  type SubscriptionSnapshot,
  type SubscriptionStatus,
  type TestCard,
  type VerifiedEvent,
  WebhookSignatureError,
} from './types';

export const TEST_SIGNATURE_HEADER = 'x-wcr-test-signature';
export const WEBHOOK_PATH = '/api/billing/webhook';

/** The three test cards, as the checkout page lists them. The numbers are Stripe's documented test numbers, shown only. */
export const TEST_CARDS: readonly { card: TestCard; label: string; number: string }[] = [
  { card: 'succeeds', label: 'Test card that succeeds', number: '4242 4242 4242 4242' },
  { card: 'declines', label: 'Test card that is declined', number: '4000 0000 0000 0002' },
  { card: 'fails_at_renewal', label: 'Test card that fails at renewal', number: '4000 0000 0000 0341' },
];

export type TestClockStep = 'period_end' | 'grace_end';

type Row = typeof billingTestSubscription.$inferSelect;
type Deliver = (request: Request) => Promise<Response>;

export interface TestPayRequest {
  checkoutId: string;
  planCode: CheckoutRequest['planCode'];
  interval: BillingInterval;
  amountCents: number;
  currency: string;
  customerId: string | null;
}

export type TestPayOutcome = { outcome: 'paid'; subscriptionId: string } | { outcome: 'declined' } | { outcome: 'already_paid'; subscriptionId: string };

export interface TestBillingProvider extends BillingProvider {
  readonly name: 'test';
  /** Pays a checkout with a test card: a subscription and its first invoice, or a decline. */
  pay(request: TestPayRequest, card: TestCard, now?: Date): Promise<TestPayOutcome>;
  /** The test clock: what happens to one subscription when its period or its grace ends. */
  advanceClock(subscriptionId: string, step: TestClockStep, now?: Date): Promise<SubscriptionSnapshot>;
}

/** `at` plus one interval, in UTC (31 Jan + 1 month = the last day of February, as Stripe does). */
export function addInterval(at: Date, interval: BillingInterval): Date {
  const next = new Date(at.getTime());
  if (interval === 'year') {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function snapshotOf(row: Row): SubscriptionSnapshot {
  return {
    id: row.id,
    customerId: row.customerId,
    checkoutRef: row.checkoutRef,
    status: row.status,
    interval: row.interval,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    endedAt: row.endedAt,
    version: row.version,
  };
}

// --- the wire format of the test provider's events ---------------------------------------------------

interface WireSubscription {
  id: string;
  customer: string;
  checkout_ref: string;
  status: SubscriptionStatus;
  interval: BillingInterval;
  cancel_at_period_end: boolean;
  current_period_start: string;
  current_period_end: string;
  ended_at: string | null;
  version: number;
}

interface WireInvoice {
  id: string;
  subscription: string;
  status: 'paid' | 'failed';
  amount: number;
  currency: string;
  period_start: string;
  period_end: string;
  created: string;
}

interface WireEvent {
  id: string;
  object: 'event';
  type: 'subscription.created' | 'subscription.updated' | 'subscription.deleted' | 'invoice.paid' | 'invoice.payment_failed';
  created: number;
  livemode: false;
  data: { subscription: WireSubscription; invoice?: WireInvoice };
}

const wireSubscription = (s: SubscriptionSnapshot): WireSubscription => ({
  id: s.id,
  customer: s.customerId,
  checkout_ref: s.checkoutRef ?? '',
  status: s.status,
  interval: s.interval,
  cancel_at_period_end: s.cancelAtPeriodEnd,
  current_period_start: s.currentPeriodStart.toISOString(),
  current_period_end: s.currentPeriodEnd.toISOString(),
  ended_at: iso(s.endedAt),
  version: s.version,
});

const STATUSES = new Set<SubscriptionStatus>(['incomplete', 'active', 'past_due', 'canceled']);
const ID = /^t(sub|cus|in|evt)_[0-9a-z]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function dateOf(value: unknown): Date {
  const d = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(d.getTime())) throw new WebhookSignatureError('The billing event could not be read.');
  return d;
}

function readSubscription(value: unknown): SubscriptionSnapshot {
  const s = (value ?? {}) as Partial<WireSubscription>;
  if (typeof s.id !== 'string' || !ID.test(s.id) || typeof s.customer !== 'string' || !ID.test(s.customer)) throw new WebhookSignatureError('The billing event could not be read.');
  if (!s.status || !STATUSES.has(s.status) || (s.interval !== 'month' && s.interval !== 'year') || typeof s.cancel_at_period_end !== 'boolean') {
    throw new WebhookSignatureError('The billing event could not be read.');
  }
  if (typeof s.version !== 'number' || !Number.isSafeInteger(s.version) || s.version < 1) throw new WebhookSignatureError('The billing event could not be read.');
  return {
    id: s.id,
    customerId: s.customer,
    checkoutRef: typeof s.checkout_ref === 'string' && UUID.test(s.checkout_ref) ? s.checkout_ref : null,
    status: s.status,
    interval: s.interval,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    currentPeriodStart: dateOf(s.current_period_start),
    currentPeriodEnd: dateOf(s.current_period_end),
    endedAt: s.ended_at ? dateOf(s.ended_at) : null,
    version: s.version,
  };
}

function readInvoice(value: unknown): InvoiceSnapshot {
  const i = (value ?? {}) as Partial<WireInvoice>;
  if (typeof i.id !== 'string' || !ID.test(i.id) || typeof i.subscription !== 'string' || (i.status !== 'paid' && i.status !== 'failed')) {
    throw new WebhookSignatureError('The billing event could not be read.');
  }
  if (typeof i.amount !== 'number' || !Number.isInteger(i.amount) || i.amount < 0 || typeof i.currency !== 'string' || !/^[a-z]{3}$/.test(i.currency)) {
    throw new WebhookSignatureError('The billing event could not be read.');
  }
  return {
    id: i.id,
    subscriptionId: i.subscription,
    status: i.status,
    amountCents: i.amount,
    currency: i.currency,
    periodStart: dateOf(i.period_start),
    periodEnd: dateOf(i.period_end),
    issuedAt: dateOf(i.created),
  };
}

/** Reads a test provider event (after its signature was checked). */
export function normalizeTestEvent(raw: unknown): { id: string; type: string; createdAt: Date; normalized: NormalizedEvent } {
  const e = (raw ?? {}) as Partial<WireEvent>;
  if (typeof e.id !== 'string' || !ID.test(e.id) || e.object !== 'event' || e.livemode !== false || typeof e.created !== 'number' || !e.data) {
    throw new WebhookSignatureError('The billing event could not be read.');
  }
  const createdAt = new Date(e.created * 1000);
  const subscription = readSubscription(e.data.subscription);
  switch (e.type) {
    case 'subscription.created':
    case 'subscription.updated':
    case 'subscription.deleted':
      return { id: e.id, type: e.type, createdAt, normalized: { kind: 'subscription', subscription } };
    case 'invoice.paid':
    case 'invoice.payment_failed':
      return { id: e.id, type: e.type, createdAt, normalized: { kind: 'invoice', invoice: readInvoice(e.data.invoice), subscription } };
    default:
      return { id: e.id, type: String(e.type), createdAt, normalized: { kind: 'ignored' } };
  }
}

const newId = (prefix: 'tsub' | 'tcus' | 'tin' | 'tevt') => `${prefix}_${uuidv7().replaceAll('-', '')}${randomBytes(2).toString('hex')}`;

export interface TestProviderOptions {
  /** Where the events go: by default the webhook handler of this process (webhook.ts). */
  deliver?: Deliver;
  env?: Record<string, string | undefined>;
}

export function createTestProvider(options: TestProviderOptions = {}): TestBillingProvider {
  const env = options.env ?? process.env;
  const deliver: Deliver =
    options.deliver ??
    (async (request) => {
      const { receiveWebhook } = await import('./webhook');
      return receiveWebhook(request);
    });

  /** Signs and delivers one event; a failed delivery is logged with the event id only. */
  async function emit(type: WireEvent['type'], subscription: SubscriptionSnapshot, at: Date, invoice?: WireInvoice): Promise<void> {
    const event: WireEvent = {
      id: newId('tevt'),
      object: 'event',
      type,
      created: Math.floor(at.getTime() / 1000),
      livemode: false,
      data: { subscription: wireSubscription(subscription), ...(invoice ? { invoice } : {}) },
    };
    const body = JSON.stringify(event);
    const request = new Request(new URL(WEBHOOK_PATH, appUrl(env)), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TEST_SIGNATURE_HEADER]: signPayload(body, testWebhookSecret(env)) },
      body,
    });
    try {
      const response = await deliver(request);
      if (!response.ok) logger().warn(`[billing:test] event ${event.id} (${type}) was answered ${response.status}`);
    } catch (error) {
      logger().warn(`[billing:test] event ${event.id} (${type}) was not delivered (${error instanceof Error ? error.name : 'error'})`);
    }
  }

  const invoiceOf = (row: Row, status: 'paid' | 'failed', at: Date, period: { start: Date; end: Date }): WireInvoice => ({
    id: newId('tin'),
    subscription: row.id,
    status,
    amount: row.amountCents,
    currency: row.currency,
    period_start: period.start.toISOString(),
    period_end: period.end.toISOString(),
    created: at.toISOString(),
  });

  /** Changes one live subscription (active or past due) under its row lock; null when it is not live. */
  async function change(subscriptionId: string, update: (row: Row) => Partial<Row> | null): Promise<Row> {
    const row = await getDb().transaction(async (tx) => {
      const [current] = await tx.select().from(billingTestSubscription).where(eq(billingTestSubscription.id, subscriptionId)).for('update');
      if (!current) throw new BillingProviderError('not_found', 'The test provider does not know this subscription.');
      const next = update(current);
      if (!next) return current;
      const [saved] = await tx
        .update(billingTestSubscription)
        .set({ ...next, version: current.version + 1, updatedAt: new Date() })
        .where(eq(billingTestSubscription.id, subscriptionId))
        .returning();
      return saved!;
    });
    return row;
  }

  const live = (row: Row) => row.status === 'active' || row.status === 'past_due';

  return {
    name: 'test',

    async createCheckout(request) {
      // Nothing to hold until it is paid: the checkout page reads the app's own checkout row.
      return { url: `/billing/test-checkout/${request.checkoutId}`, sessionId: null };
    },

    async pay(request, card, now = new Date()) {
      // DEFAULT M22 (question 2): a declined test card creates nothing and sends no event, as a
      // hosted checkout keeps a declined payment on its own page.
      if (card === 'declines') return { outcome: 'declined' };
      const created = await getDb().transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-test-pay:${request.checkoutId}`}, 0))`);
        const [paid] = await tx.select().from(billingTestSubscription).where(eq(billingTestSubscription.checkoutRef, request.checkoutId));
        if (paid) return { row: paid, fresh: false };
        const [row] = await tx
          .insert(billingTestSubscription)
          .values({
            id: newId('tsub'),
            customerId: request.customerId && ID.test(request.customerId) ? request.customerId : newId('tcus'),
            checkoutRef: request.checkoutId,
            planCode: request.planCode,
            interval: request.interval,
            amountCents: request.amountCents,
            currency: request.currency,
            card,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: addInterval(now, request.interval),
            version: 1,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return { row: row!, fresh: true };
      });
      if (!created.fresh) return { outcome: 'already_paid', subscriptionId: created.row.id };
      const snap = snapshotOf(created.row);
      await emit('invoice.paid', snap, now, invoiceOf(created.row, 'paid', now, { start: created.row.currentPeriodStart, end: created.row.currentPeriodEnd }));
      await emit('subscription.created', snap, now);
      return { outcome: 'paid', subscriptionId: created.row.id };
    },

    async cancelAtPeriodEnd(subscriptionId) {
      const row = await change(subscriptionId, (r) => {
        if (!live(r)) throw new BillingProviderError('refused', 'This subscription has ended.');
        return r.cancelAtPeriodEnd ? null : { cancelAtPeriodEnd: true };
      });
      await emit('subscription.updated', snapshotOf(row), new Date());
      return snapshotOf(row);
    },

    async resume(subscriptionId) {
      const row = await change(subscriptionId, (r) => {
        if (!live(r)) throw new BillingProviderError('refused', 'This subscription has ended.');
        return r.cancelAtPeriodEnd ? { cancelAtPeriodEnd: false } : null;
      });
      await emit('subscription.updated', snapshotOf(row), new Date());
      return snapshotOf(row);
    },

    async cancelNow(subscriptionId) {
      const at = new Date();
      const row = await change(subscriptionId, (r) => (live(r) ? { status: 'canceled', endedAt: at } : null));
      await emit('subscription.deleted', snapshotOf(row), at);
      return snapshotOf(row);
    },

    async changePlan(subscriptionId, next) {
      const row = await change(subscriptionId, (r) => {
        if (!live(r)) throw new BillingProviderError('refused', 'This subscription has ended.');
        return { planCode: next.planCode, interval: next.interval, amountCents: next.amountCents, currency: next.currency };
      });
      await emit('subscription.updated', snapshotOf(row), new Date());
      return snapshotOf(row);
    },

    async advanceClock(subscriptionId, step, now = new Date()) {
      const events: { type: WireEvent['type']; invoice?: WireInvoice }[] = [];
      const row = await change(subscriptionId, (r) => {
        if (!live(r)) throw new BillingProviderError('refused', 'This subscription has ended; the test clock has nothing to move.');
        if (step === 'grace_end' || r.status === 'past_due') {
          if (r.status !== 'past_due') throw new BillingProviderError('refused', 'Only a past-due subscription has a grace period to end.');
          // The last retry fails: the subscription ends now.
          events.push({ type: 'subscription.deleted' });
          return { status: 'canceled', endedAt: now };
        }
        // The period ends now: its length is kept, its start moved back by the same amount.
        const length = r.currentPeriodEnd.getTime() - r.currentPeriodStart.getTime();
        const ended = { start: new Date(now.getTime() - length), end: now };
        if (r.cancelAtPeriodEnd) {
          events.push({ type: 'subscription.deleted' });
          return { status: 'canceled', endedAt: now, currentPeriodStart: ended.start, currentPeriodEnd: ended.end };
        }
        if (r.card === 'fails_at_renewal') {
          events.push({ type: 'invoice.payment_failed', invoice: invoiceOf(r, 'failed', now, { start: now, end: addInterval(now, r.interval) }) });
          events.push({ type: 'subscription.updated' });
          return { status: 'past_due', currentPeriodStart: ended.start, currentPeriodEnd: ended.end };
        }
        const next = { start: now, end: addInterval(now, r.interval) };
        events.push({ type: 'invoice.paid', invoice: invoiceOf(r, 'paid', now, next) });
        events.push({ type: 'subscription.updated' });
        return { currentPeriodStart: next.start, currentPeriodEnd: next.end };
      });
      const snap = snapshotOf(row);
      for (const e of events) await emit(e.type, snap, now, e.invoice);
      return snap;
    },

    verifyWebhook(body: string, headers: Headers, now = new Date()): VerifiedEvent {
      verifySignature(body, headers.get(TEST_SIGNATURE_HEADER), testWebhookSecret(env), now);
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        throw new WebhookSignatureError('The billing event is not JSON.');
      }
      const read = normalizeTestEvent(raw);
      return { provider: 'test', eventId: read.id, type: read.type, createdAt: read.createdAt, normalized: read.normalized, raw: redactEvent(raw) };
    },
  };
}
