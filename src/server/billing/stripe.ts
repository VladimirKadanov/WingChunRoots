// The Stripe adapter (milestone M22; docs/adr/0025-billing.md): Stripe's REST API with plain
// fetch and the Stripe-Signature check by hand (signature.ts), so no SDK and no new dependency.
//
// Test mode only: the adapter is made only with BILLING_PROVIDER=stripe and a STRIPE_SECRET_KEY
// that is a test key (config.ts refuses sk_live_ and anything else), and it refuses every event
// whose `livemode` is not false. It is never called in CI: its unit tests use recorded, fictional
// payloads (src/server/billing/fixtures/) and a fake fetch.
//
// Requests carry ids, the plan's name and its proposed price only (DEFAULT D09): never a name or an
// e-mail address of the account (Stripe Checkout asks the payer itself). Errors carry no request
// or response body.

import * as z from 'zod';

import { stripeSecretKey, stripeWebhookSecret } from './config';
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
  const status = stripeStatus(s.status);
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

  const snapshot = (json: Record<string, unknown>) => {
    const t = now();
    return subscriptionFromStripe(json, t.getTime(), t);
  };

  const priceData = (planName: string, interval: BillingInterval, amountCents: number, currency: string) => ({
    currency,
    unit_amount: amountCents,
    recurring: { interval },
    product_data: { name: `WingChunRoots ${planName} (test mode)` },
  });

  return {
    name: 'stripe',
    async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
      const json = await call(
        'POST',
        '/checkout/sessions',
        {
          mode: 'subscription',
          client_reference_id: request.checkoutId,
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          customer: request.customerId ?? undefined,
          line_items: [{ quantity: 1, price_data: priceData(request.planName, request.interval, request.amountCents, request.currency) }],
          metadata: { checkout_ref: request.checkoutId },
          // The session cannot be paid after the app's checkout expired (DEFAULT M22, question 7).
          expires_at: Math.floor(request.expiresAt.getTime() / 1000),
          subscription_data: { metadata: { checkout_ref: request.checkoutId } },
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
      return snapshot(await call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: true }));
    },
    async resume(subscriptionId) {
      return snapshot(await call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: false }));
    },
    async cancelNow(subscriptionId) {
      return snapshot(await call('DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}`));
    },
    async changePlan(subscriptionId, change) {
      const current = await call('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
      const items = (current.items as { data?: { id?: string; price?: { product?: unknown } }[] } | undefined)?.data ?? [];
      const item = items[0];
      const product = idOf(item?.price?.product);
      if (!item?.id || !product) throw new BillingProviderError('unsupported', 'The Stripe subscription has no item to change.');
      return snapshot(
        await call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
          items: [{ id: item.id, price_data: { currency: change.currency, unit_amount: change.amountCents, recurring: { interval: change.interval }, product } }],
          proration_behavior: 'create_prorations',
        }),
      );
    },
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
