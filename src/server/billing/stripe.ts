// The Stripe adapter (milestone M22; docs/adr/0025-billing.md): Stripe's REST API with plain
// fetch and the Stripe-Signature check by hand (signature.ts), so no SDK and no new dependency.
//
// Test mode only: the adapter is made only with BILLING_PROVIDER=stripe and a STRIPE_SECRET_KEY
// that is a test key (config.ts refuses sk_live_ and anything else), and it refuses every event
// whose `livemode` is not false. It is never called in CI: its unit tests use recorded, fictional
// payloads (src/server/billing/fixtures/) and a fake fetch.
//
// M23 follow-up (2026-11-27): a change at the period end (Federation yearly → monthly) is a Stripe
// subscription schedule of two phases, the current price until the period end and the new one from
// then; the subscription's metadata says what is scheduled (scheduled_plan_code, scheduled_interval;
// `none` for nothing), so its webhook events carry it. With STRIPE_TEST_CLOCKS, each new customer is
// put on its own Stripe test clock, which the admin test clock moves (advanceClock).
//
// Requests carry ids, the plan's name and its proposed price only (DEFAULT D09): never a name or an
// e-mail address of the account (Stripe Checkout asks the payer itself). Errors carry no request
// or response body.

import * as z from 'zod';

import type { PLAN_CODES } from '../db/schema/common';

import { stripeSecretKey, stripeTestClocks, stripeWebhookSecret } from './config';
import { redactEvent } from './redact';
import { verifySignature } from './signature';
import {
  type BillingInterval,
  type BillingProvider,
  BillingProviderError,
  type CheckoutRequest,
  type CheckoutSession,
  type InvoiceSnapshot,
  type NormalizedEvent,
  type SubscriptionSnapshot,
  type SubscriptionStatus,
  type VerifiedEvent,
  WebhookSignatureError,
} from './types';

const API = 'https://api.stripe.com/v1';
type PlanCode = (typeof PLAN_CODES)[number];
const STRIPE_PLAN_CODES = new Set<string>(['premium_student', 'pro_sifu', 'federation'] satisfies PlanCode[]);
const TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
type Env = Record<string, string | undefined>;

/** `{ a: { b: 1 } }` → `a[b]=1`, Stripe's form encoding; undefined and null are left out. */
export function formEncode(value: Record<string, unknown>): string {
  const pairs: string[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    else if (typeof v === 'object') for (const [k, inner] of Object.entries(v as Record<string, unknown>)) walk(prefix ? `${prefix}[${k}]` : k, inner);
    else pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  walk('', value);
  return pairs.join('&');
}

// --- reading Stripe objects ------------------------------------------------------------------------

const seconds = z.number().int().nonnegative();
const idOf = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null);
const at = (s: number) => new Date(s * 1000);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
/** `none`: the metadata value of "nothing scheduled" (an empty value would remove the key). */
const NOTHING = 'none';

/** A calendar month (the last day of a shorter month) or a year later, in UTC (as test-provider.ts). */
export function addStripeInterval(date: Date, interval: BillingInterval): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Stripe's subscription status as the app's. */
export function stripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

const stripeItem = z
  .object({
    current_period_start: seconds.optional(),
    current_period_end: seconds.optional(),
    price: z.object({ recurring: z.object({ interval: z.string() }).nullish() }).nullish(),
    plan: z.object({ interval: z.string() }).nullish(),
  })
  .loose();

const stripeSubscription = z
  .object({
    id: z.string().regex(/^sub_[A-Za-z0-9]+$/),
    object: z.literal('subscription'),
    customer: z.unknown(),
    status: z.string(),
    cancel_at_period_end: z.boolean(),
    current_period_start: seconds.nullish(),
    current_period_end: seconds.nullish(),
    ended_at: seconds.nullish(),
    canceled_at: seconds.nullish(),
    metadata: z.record(z.string(), z.string()).nullish(),
    items: z.object({ data: z.array(stripeItem) }).nullish(),
  })
  .loose();

/** A Stripe subscription object as a snapshot; `version` orders it (event time in ms). */
export function subscriptionFromStripe(raw: unknown, version: number, eventAt: Date): SubscriptionSnapshot {
  const s = stripeSubscription.parse(raw);
  const item = s.items?.data[0];
  const start = s.current_period_start ?? item?.current_period_start;
  const end = s.current_period_end ?? item?.current_period_end;
  if (start === undefined || start === null || end === undefined || end === null || end <= start) throw new Error('stripe: a subscription without its period');
  const interval = item?.price?.recurring?.interval ?? item?.plan?.interval;
  if (interval !== 'month' && interval !== 'year') throw new Error('stripe: a subscription with an unknown interval');
  const customerId = idOf(s.customer);
  if (!customerId) throw new Error('stripe: a subscription without a customer');
  const ref = s.metadata?.checkout_ref ?? null;
  // M23: the plan the app wrote in the subscription's metadata at checkout and at a change of plan.
  const plan = s.metadata?.plan_code ?? null;
  const status = stripeStatus(s.status);
  // The change scheduled for the period end, as changePlan wrote it in the metadata: undefined when
  // the metadata does not say (the app keeps what it holds), null for none or for what runs already.
  const scheduledPlan = s.metadata?.scheduled_plan_code;
  const scheduledInterval = s.metadata?.scheduled_interval;
  let scheduledChange: SubscriptionSnapshot['scheduledChange'];
  if (scheduledPlan !== undefined) {
    const valid = STRIPE_PLAN_CODES.has(scheduledPlan) && (scheduledInterval === 'month' || scheduledInterval === 'year');
    const running = scheduledPlan === (plan ?? scheduledPlan) && scheduledInterval === interval;
    scheduledChange = valid && !running ? { planCode: scheduledPlan as PlanCode, interval: scheduledInterval } : null;
  }
  const endedSeconds = s.ended_at ?? (status === 'canceled' ? (s.canceled_at ?? null) : null);
  return {
    id: s.id,
    customerId,
    checkoutRef: ref && UUID.test(ref) ? ref.toLowerCase() : null,
    status,
    interval,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    currentPeriodStart: at(start),
    currentPeriodEnd: at(end),
    endedAt: status === 'canceled' ? (endedSeconds !== null ? at(endedSeconds) : eventAt) : null,
    // Only when the metadata names it.
    ...(plan && STRIPE_PLAN_CODES.has(plan) ? { planCode: plan as PlanCode } : {}),
    ...(scheduledChange !== undefined ? { scheduledChange } : {}),
    version,
  };
}

const stripeInvoice = z
  .object({
    id: z.string().regex(/^in_[A-Za-z0-9]+$/),
    object: z.literal('invoice'),
    subscription: z.unknown().optional(),
    parent: z.object({ subscription_details: z.object({ subscription: z.unknown() }).nullish() }).loose().nullish(),
    amount_paid: z.number().int().nonnegative(),
    amount_due: z.number().int().nonnegative(),
    currency: z.string().regex(/^[a-z]{3}$/),
    created: seconds,
    period_start: seconds.optional(),
    period_end: seconds.optional(),
    lines: z.object({ data: z.array(z.object({ period: z.object({ start: seconds, end: seconds }).optional(), subscription: z.unknown().optional() }).loose()) }).loose().nullish(),
  })
  .loose();

export function invoiceFromStripe(raw: unknown, status: 'paid' | 'failed'): InvoiceSnapshot {
  const i = stripeInvoice.parse(raw);
  const line = i.lines?.data[0];
  const subscriptionId = idOf(i.subscription) ?? idOf(i.parent?.subscription_details?.subscription) ?? idOf(line?.subscription);
  if (!subscriptionId) throw new Error('stripe: an invoice without a subscription');
  const periodStart = line?.period?.start ?? i.period_start ?? i.created;
  const periodEnd = line?.period?.end ?? i.period_end ?? i.created;
  return {
    id: i.id,
    subscriptionId,
    status,
    amountCents: status === 'paid' ? i.amount_paid : i.amount_due,
    currency: i.currency,
    periodStart: at(periodStart),
    periodEnd: at(Math.max(periodEnd, periodStart)),
    issuedAt: at(i.created),
  };
}

const stripeEvent = z
  .object({
    id: z.string().regex(/^evt_[A-Za-z0-9]+$/),
    object: z.literal('event'),
    type: z.string().max(100),
    created: seconds,
    livemode: z.boolean(),
    data: z.object({ object: z.record(z.string(), z.unknown()) }).loose(),
  })
  .loose();

/** A parsed Stripe event as the app reads it (no signature check here: see verifyWebhook). */
export function normalizeStripeEvent(raw: unknown): { id: string; type: string; createdAt: Date; normalized: NormalizedEvent } {
  const event = stripeEvent.parse(raw);
  // Test mode only: a live event is never applied, whatever signed it.
  if (event.livemode !== false) throw new WebhookSignatureError('Live billing events are refused: test mode only.');
  const createdAt = at(event.created);
  const version = event.created * 1000;
  const object = event.data.object;
  let normalized: NormalizedEvent;
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      normalized = { kind: 'subscription', subscription: subscriptionFromStripe(object, version, createdAt) };
      break;
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      normalized = { kind: 'invoice', invoice: invoiceFromStripe(object, 'paid'), subscription: null };
      break;
    case 'invoice.payment_failed':
      normalized = { kind: 'invoice', invoice: invoiceFromStripe(object, 'failed'), subscription: null };
      break;
    case 'checkout.session.completed': {
      const ref = typeof object.client_reference_id === 'string' ? object.client_reference_id : null;
      if (object.mode !== 'subscription' || !ref || !UUID.test(ref)) {
        normalized = { kind: 'ignored' };
        break;
      }
      normalized = { kind: 'checkout', checkoutRef: ref.toLowerCase(), customerId: idOf(object.customer), subscriptionId: idOf(object.subscription) };
      break;
    }
    default:
      normalized = { kind: 'ignored' };
  }
  return { id: event.id, type: event.type, createdAt, normalized };
}

// --- the adapter -------------------------------------------------------------------------------------

export interface StripeOptions {
  fetch?: Fetch;
  env?: Env;
  now?: () => Date;
}

export function createStripeProvider(options: StripeOptions = {}): BillingProvider {
  const env = options.env ?? process.env;
  // Refused at once without a test key (config.ts): the adapter never holds a live key.
  const key = stripeSecretKey(env);
  const send: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  const clocks = stripeTestClocks(env);

  async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await send(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        ...(body ? { body: formEncode(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new BillingProviderError('unavailable', 'Stripe did not answer.');
    }
    if (response.status === 404) throw new BillingProviderError('not_found', 'Stripe does not know this object.');
    if (response.status >= 500 || response.status === 429) throw new BillingProviderError('unavailable', `Stripe answered ${response.status}.`);
    if (!response.ok) throw new BillingProviderError('refused', `Stripe refused the request (${response.status}).`);
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json || typeof json !== 'object') throw new BillingProviderError('unavailable', 'Stripe answered without JSON.');
    if (json.livemode === true) throw new BillingProviderError('refused', 'Stripe answered in live mode: test mode only.');
    return json;
  }

  // An API answer has no event time of Stripe's: version 0, and the service applies it at the stored
  // version (services/billing.ts, changeAtProvider), so this server's clock never orders Stripe's
  // events. The webhook event of the same change follows with its own time.
  const snapshot = (json: Record<string, unknown>) => subscriptionFromStripe(json, 0, now());

  const subPath = (subscriptionId: string) => `/subscriptions/${encodeURIComponent(subscriptionId)}`;
  const NO_SCHEDULE = { scheduled_plan_code: NOTHING, scheduled_interval: NOTHING };

  /** Lets go of the subscription's schedule, when it has one: the subscription keeps its current price. */
  async function releaseSchedule(current: Record<string, unknown>): Promise<boolean> {
    const schedule = idOf(current.schedule);
    if (!schedule) return false;
    await call('POST', `/subscription_schedules/${encodeURIComponent(schedule)}/release`, {});
    return true;
  }

  /** The subscription without a schedule; its metadata says nothing is scheduled. */
  async function unscheduled(subscriptionId: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const current = await call('GET', subPath(subscriptionId));
    await releaseSchedule(current);
    const metadata = (current.metadata as Record<string, string> | undefined) ?? {};
    const scheduled = metadata.scheduled_plan_code !== undefined && metadata.scheduled_plan_code !== NOTHING;
    if (!scheduled && Object.keys(extra).length === 0) return current;
    return call('POST', subPath(subscriptionId), { ...extra, ...(scheduled ? { metadata: NO_SCHEDULE } : {}) });
  }

  const priceData = (planName: string, interval: BillingInterval, amountCents: number, currency: string) => ({
    currency,
    unit_amount: amountCents,
    recurring: { interval },
    product_data: { name: `WingChunRoots ${planName} (test mode)` },
  });

  return {
    name: 'stripe',
    async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
      let customer = request.customerId;
      if (!customer && clocks) {
        // STRIPE_TEST_CLOCKS: a customer of its own on a test clock of its own, so the admin test clock
        // can move this subscription. No name or e-mail address: Stripe Checkout asks the payer.
        const clock = await call('POST', '/test_helpers/test_clocks', { frozen_time: unix(now()), name: `WingChunRoots ${request.checkoutId.slice(0, 8)}` }, `wcr-clock-${request.checkoutId}`);
        const clockId = idOf(clock);
        if (!clockId) throw new BillingProviderError('unavailable', 'Stripe answered without a test clock.');
        customer = idOf(await call('POST', '/customers', { test_clock: clockId, metadata: { checkout_ref: request.checkoutId } }, `wcr-customer-${request.checkoutId}`));
        if (!customer) throw new BillingProviderError('unavailable', 'Stripe answered without a customer.');
      }
      const json = await call(
        'POST',
        '/checkout/sessions',
        {
          mode: 'subscription',
          client_reference_id: request.checkoutId,
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          customer: customer ?? undefined,
          line_items: [{ quantity: 1, price_data: priceData(request.planName, request.interval, request.amountCents, request.currency) }],
          metadata: { checkout_ref: request.checkoutId },
          // The session cannot be paid after the app's checkout expired (DEFAULT M22, question 7).
          expires_at: Math.floor(request.expiresAt.getTime() / 1000),
          // M23: a checkout that continues a Federation trial is charged first when the trial ends.
          subscription_data: {
            metadata: { checkout_ref: request.checkoutId, plan_code: request.planCode },
            ...(request.trialEndsAt ? { trial_end: Math.floor(request.trialEndsAt.getTime() / 1000) } : {}),
          },
        },
        `wcr-checkout-${request.checkoutId}`,
      );
      // Only Stripe's own hosted checkout: the browser is sent to this address.
      const url = typeof json.url === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(json.url) ? json.url : null;
      const id = typeof json.id === 'string' ? json.id : null;
      if (!url || !id) throw new BillingProviderError('unavailable', 'Stripe answered without a checkout page.');
      return { url, sessionId: id };
    },
    async cancelAtPeriodEnd(subscriptionId) {
      // A change scheduled for the period end is dropped: nothing renews (as the test provider does).
      // Stripe refuses a cancellation of a subscription its schedule manages, so the schedule goes first.
      return snapshot(await unscheduled(subscriptionId, { cancel_at_period_end: true }));
    },
    async resume(subscriptionId) {
      return snapshot(await call('POST', subPath(subscriptionId), { cancel_at_period_end: false }));
    },
    async cancelNow(subscriptionId) {
      const current = await call('GET', subPath(subscriptionId));
      await releaseSchedule(current);
      return snapshot(await call('DELETE', subPath(subscriptionId)));
    },
    async changePlan(subscriptionId, change) {
      const current = await call('GET', subPath(subscriptionId));
      const items = (current.items as { data?: { id?: string; quantity?: number; price?: { id?: string; product?: unknown } }[] } | undefined)?.data ?? [];
      const item = items[0];
      const product = idOf(item?.price?.product);
      if (!item?.id || !product) throw new BillingProviderError('unsupported', 'The Stripe subscription has no item to change.');
      const metadata = (current.metadata as Record<string, string> | undefined) ?? {};
      const newPrice = { currency: change.currency, unit_amount: change.amountCents, recurring: { interval: change.interval }, product };

      if (change.when === 'now') {
        // A change now replaces any change scheduled for the period end.
        const released = await releaseSchedule(current);
        return snapshot(
          await call('POST', subPath(subscriptionId), {
            items: [{ id: item.id, price_data: newPrice }],
            // An upgrade now: a new period from now, the unused part of the old one credited and invoiced at once.
            proration_behavior: 'always_invoice',
            billing_cycle_anchor: 'now',
            metadata: { ...metadata, plan_code: change.planCode, ...(released || metadata.scheduled_plan_code !== undefined ? NO_SCHEDULE : {}) },
          }),
        );
      }

      // DEFAULT M23 (question 2): a downgrade at the period end. A subscription schedule of two phases:
      // the current price until the period ends, then the new price from a new period (charged then,
      // nothing prorated); the schedule lets go of the subscription after that phase.
      const scheduleId = idOf(current.schedule);
      const schedule = scheduleId
        ? await call('GET', `/subscription_schedules/${encodeURIComponent(scheduleId)}`)
        : await call('POST', '/subscription_schedules', { from_subscription: subscriptionId }, `wcr-schedule-${subscriptionId}-${unix(now())}`);
      const id = idOf(schedule);
      type Phase = { start_date?: number; end_date?: number; trial_end?: number | null; items?: { price?: unknown; quantity?: number }[] };
      const phases = (schedule.phases as Phase[] | undefined) ?? [];
      const moment = unix(now());
      // The phase that runs now (a schedule made from the subscription has only that one).
      const phase = phases.find((ph) => typeof ph.start_date === 'number' && typeof ph.end_date === 'number' && ph.start_date <= moment && moment < ph.end_date) ?? phases[0];
      if (!id || typeof phase?.start_date !== 'number' || typeof phase.end_date !== 'number') throw new BillingProviderError('unavailable', 'Stripe answered without the current phase of the subscription.');
      const scheduled = { scheduled_plan_code: change.planCode, scheduled_interval: change.interval };
      await call('POST', `/subscription_schedules/${encodeURIComponent(id)}`, {
        end_behavior: 'release',
        proration_behavior: 'none',
        phases: [
          {
            start_date: phase.start_date,
            end_date: phase.end_date,
            ...(typeof phase.trial_end === 'number' ? { trial_end: phase.trial_end } : {}),
            items: (phase.items ?? [{ price: item.price?.id, quantity: item.quantity ?? 1 }]).map((i) => ({ price: idOf(i.price), quantity: i.quantity ?? 1 })),
            metadata: { ...metadata, ...scheduled },
          },
          {
            items: [{ price_data: newPrice, quantity: 1 }],
            billing_cycle_anchor: 'phase_start',
            end_date: unix(addStripeInterval(at(phase.end_date), change.interval)),
            // Set on the subscription when this phase starts: the new plan runs, nothing is scheduled.
            metadata: { ...metadata, plan_code: change.planCode, ...NO_SCHEDULE },
          },
        ],
      });
      // The subscription's own metadata says it at once too (its webhook events carry it).
      let fresh: Record<string, unknown>;
      try {
        fresh = await call('POST', subPath(subscriptionId), { metadata: scheduled });
      } catch {
        fresh = await call('GET', subPath(subscriptionId));
      }
      return { ...snapshot(fresh), scheduledChange: { planCode: change.planCode, interval: change.interval } };
    },
    async cancelScheduledChange(subscriptionId) {
      return { ...snapshot(await unscheduled(subscriptionId)), scheduledChange: null };
    },
    ...(clocks
      ? {
          async advanceClock(subscriptionId: string, step: 'period_end' | 'grace_end') {
            const current = await call('GET', `${subPath(subscriptionId)}?expand[]=customer`);
            const state = snapshot(current);
            if (step === 'grace_end') {
              // The last retry of the unpaid renewal fails: the subscription ends now.
              await releaseSchedule(current);
              return snapshot(await call('DELETE', subPath(subscriptionId)));
            }
            const clockId = idOf((current.customer as { test_clock?: unknown } | null)?.test_clock);
            if (!clockId) throw new BillingProviderError('unsupported', 'This Stripe customer has no test clock: it was created before STRIPE_TEST_CLOCKS was on.');
            const clock = await call('GET', `/test_helpers/test_clocks/${encodeURIComponent(clockId)}`);
            if (clock.status !== 'ready') throw new BillingProviderError('refused', 'The Stripe test clock is still moving. Try again in a minute.');
            const frozen = typeof clock.frozen_time === 'number' ? clock.frozen_time : 0;
            // Two hours past the period end: Stripe finalizes and charges a renewal invoice about an hour after it is made.
            const target = Math.max(unix(state.currentPeriodEnd) + 2 * 3600, frozen + 60);
            await call('POST', `/test_helpers/test_clocks/${encodeURIComponent(clockId)}/advance`, { frozen_time: target });
            return state;
          },
        }
      : {}),
    verifyWebhook(body: string, headers: Headers, at = new Date()): VerifiedEvent {
      verifySignature(body, headers.get('stripe-signature'), stripeWebhookSecret(env), at);
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        throw new WebhookSignatureError('The billing event is not JSON.');
      }
      let read: ReturnType<typeof normalizeStripeEvent>;
      try {
        read = normalizeStripeEvent(raw);
      } catch (error) {
        if (error instanceof WebhookSignatureError) throw error;
        throw new WebhookSignatureError('The billing event could not be read.');
      }
      return { provider: 'stripe', eventId: read.id, type: read.type, createdAt: read.createdAt, normalized: read.normalized, raw: redactEvent(raw) };
    },
  };
}
